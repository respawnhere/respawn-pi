/*
 * RespawnPack · core/_io.js — the host-neutral persistence boundary for the rollover core.
 *
 * ⛔ WHY A THIRD ATOMIC WRITER EXISTS IN THIS REPOSITORY, AND WHY IT IS NOT DRIFT. `hooks/_runtime.js`
 * and `kernel/lib/state.js` each carry one because neither tree can require the other on an installed
 * target. `core/` may require NEITHER: adapters and the kernel consume core/, never the reverse, and a
 * core module reaching into hooks/ would invert that arrow the moment a second host adapter existed.
 * This is the MIGRATION TARGET for the other two, not a fourth spelling of a solved problem — the
 * Windows contention set, the deadline, the per-CALL temporary name and the asymmetric read budgets are
 * carried over verbatim from the measured prior art, so a lesson learned there is not re-learned here.
 *
 * ⭐ WHAT IS GUARANTEED, stated in full because the rollover journal's crash-safety rests on it:
 *
 *   writeAtomicText   ✅ atomic replacement of CONTENT · ✅ last-completed-writer wins · ✅ a failure
 *                     before replacement preserves the prior target byte-for-byte and leaves no
 *                     temporary · ❌ NOT atomic AVAILABILITY (a concurrent reader can observe the target
 *                     momentarily absent or locked on Windows — that is what readTextClassified's retry
 *                     budget exists for) · ❌ NOT a merge · ❌ NOT a multi-file transaction.
 *
 *   appendLine        ✅ ordering: a line that is read back was appended after every line before it ·
 *                     ✅ a crash mid-append is DETECTABLE, because the incomplete tail is the only line
 *                     that fails to parse and it is always the LAST one · ❌ NOT an atomicity claim: no
 *                     promise is made that a partially written line cannot exist. The fold discards a
 *                     torn TAIL and repairs the file; a parse failure anywhere EARLIER is corruption and
 *                     is refused, never silently skipped.
 *
 *   createExclusive   ✅ the portable compare-and-swap: `wx` maps to O_EXCL / CREATE_NEW, so exactly one
 *                     caller across any number of processes creates the file and every other caller
 *                     learns it already existed. This is the whole basis of the exactly-once handoff
 *                     consumption; a read-then-write check would not survive two SessionStart hooks.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ENOENT is in this set ON PURPOSE: "the file is not there" and "the file is being replaced right now"
// are the same errno, and only retrying separates them.
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOENT', 'EMFILE', 'ENFILE']);
const REPLACE_CONTENTION_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const REPLACE_DEADLINE_MS = 2000;
// Asymmetric on purpose: ENOENT is the common legitimate answer and is on the boot path, so it gets a
// handful of very short retries. EPERM/EACCES/EBUSY mean the file DEFINITELY EXISTS and is momentarily
// locked, so reporting it absent would be a lie about the project.
const ABSENT_RETRIES = 4;
const ABSENT_PAUSE_MS = 3;
const LOCKED_DEADLINE_MS = 1000;
const LOCKED_PAUSE_MS = 5;

// A real pause with no async boundary: an async read here would make every caller async, including
// hooks that must answer on stdout synchronously.
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function digest(text) { return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex'); }

/**
 * Stable-key JSON, so a digest of a RECORD is reproducible in another process. Property order is an
 * accident of construction; a digest that depends on it would report drift where there is none.
 */
function canonical(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}

const canonicalDigest = (v) => digest(canonical(v));

/*
 * ⛔ A PATH SEGMENT IS DERIVED FROM A HOST-SUPPLIED IDENTIFIER, WHICH IS UNTRUSTED TEXT. A thread id
 * containing a separator would escape the runtime directory; on Windows a segment that lands on a
 * reserved DEVICE name (CON, NUL, COM1…) is not a file at all and every write to it silently succeeds
 * against a device. Both are closed here rather than at each call site.
 */
const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
function safeSegment(raw) {
  const s = String(raw === undefined || raw === null || raw === '' ? 'unknown' : raw)
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, 120);
  const trimmed = s.replace(/^\.+$/, '_');
  return RESERVED_WINDOWS.test(trimmed) ? `${trimmed}_` : trimmed;
}

let tmpSeq = 0;

/**
 * Atomic replacement. Returns the digest of exactly the bytes written, which is what a read-back
 * comparison must be made against — a digest of the OBJECT would still match after a truncated write.
 */
function writeAtomicText(file, text) {
  let tmp = null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Per-CALL, not per-process: a pid-derived name is a function of the process, so anything sharing
    // one shares the buffer and two writers publish a mixture.
    tmp = `${file}.${process.pid}.${(tmpSeq += 1)}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, text);
    const deadline = Date.now() + REPLACE_DEADLINE_MS;
    for (;;) {
      try { fs.renameSync(tmp, file); break; }
      catch (e) {
        const code = (e && e.code) || 'UNKNOWN';
        if (!REPLACE_CONTENTION_CODES.has(code) || Date.now() > deadline) throw e;
        pause(3);
      }
    }
    return { ok: true, bytes: Buffer.byteLength(text), digest: digest(text), detail: null };
  } catch (e) {
    // A failed write must not leave its temporary behind, one per attempt, in a runtime directory.
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* already gone, or unremovable */ } }
    return { ok: false, bytes: 0, digest: null, detail: `${(e && e.code) || 'UNKNOWN'}: ${e && e.message}` };
  }
}

const writeAtomicJSON = (file, obj) => writeAtomicText(file, `${JSON.stringify(obj, null, 2)}\n`);

/**
 * Read a file, separating ABSENT from UNREADABLE.
 * @returns {{status:'OK'|'ABSENT'|'UNREADABLE', text:string|null, digest:string|null, detail:string|null, attempts:number}}
 */
function readTextClassified(file) {
  const deadline = Date.now() + LOCKED_DEADLINE_MS;
  let attempts = 0, enoent = 0;
  for (;;) {
    attempts += 1;
    try {
      const text = fs.readFileSync(file, 'utf8');
      return { status: 'OK', text, digest: digest(text), detail: null, attempts };
    } catch (e) {
      const code = (e && e.code) || 'UNKNOWN';
      if (!TRANSIENT.has(code)) return { status: 'UNREADABLE', text: null, digest: null, detail: `${code} — not a transient condition`, attempts };
      if (code === 'ENOENT') {
        enoent += 1;
        if (enoent > ABSENT_RETRIES) return { status: 'ABSENT', text: null, digest: null, detail: `not present after ${attempts} attempt(s)`, attempts };
        pause(ABSENT_PAUSE_MS);
        continue;
      }
      if (Date.now() > deadline) {
        return {
          status: 'UNREADABLE', text: null, digest: null, attempts,
          detail: `${code} — the file EXISTS but stayed unreadable for ${LOCKED_DEADLINE_MS}ms across ${attempts} attempt(s). This is NOT the same as absent.`,
        };
      }
      pause(LOCKED_PAUSE_MS);
    }
  }
}

/** @returns {{status:'OK'|'ABSENT'|'UNREADABLE'|'MALFORMED', doc:any, digest:string|null, detail:string|null}} */
function readJSONClassified(file) {
  const r = readTextClassified(file);
  if (r.status !== 'OK') return { status: r.status, doc: null, digest: null, detail: r.detail };
  try { return { status: 'OK', doc: JSON.parse(r.text), digest: r.digest, detail: null }; }
  catch (e) { return { status: 'MALFORMED', doc: null, digest: r.digest, detail: `not parseable JSON (${e.message})` }; }
}

/** Append one line. Durability is best-effort; ORDER and torn-tail detectability are the guarantees. */
function appendLine(file, text) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, 'a');
    try {
      fs.writeSync(fd, `${text}\n`);
      try { fs.fsyncSync(fd); } catch { /* some filesystems refuse fsync on a handle; the write still landed */ }
    } finally { fs.closeSync(fd); }
    return { ok: true, detail: null };
  } catch (e) {
    return { ok: false, detail: `${(e && e.code) || 'UNKNOWN'}: ${e && e.message}` };
  }
}

/**
 * Split an append-only log into complete lines and, separately, an incomplete trailing one.
 *
 * ⛔ A COMPLETE-LOOKING LINE WITH NO TRAILING NEWLINE IS ALSO A TORN TAIL. The two cases — half a line,
 * and a whole line whose newline never landed — are indistinguishable from the bytes and must be
 * treated identically: discarded and REPORTED. Guessing that the second one is fine would accept
 * exactly the record a crash was in the middle of writing.
 */
function readLinesClassified(file) {
  const r = readTextClassified(file);
  if (r.status !== 'OK') return { status: r.status, lines: [], tornTail: null, detail: r.detail };
  const parts = r.text.split('\n');
  const last = parts.pop();
  return {
    status: 'OK',
    lines: parts.filter((l) => l.length > 0),
    tornTail: last.length > 0 ? last : null,
    detail: null,
  };
}

/**
 * The portable compare-and-swap. Exactly one caller gets CREATED.
 * @returns {{status:'CREATED'|'EXISTS'|'ERROR', detail:string|null}}
 */
function createExclusive(file, text) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, 'wx');
    try {
      fs.writeSync(fd, text);
      try { fs.fsyncSync(fd); } catch { /* best-effort durability; exclusivity is the guarantee */ }
    } finally { fs.closeSync(fd); }
    return { status: 'CREATED', detail: null };
  } catch (e) {
    const code = (e && e.code) || 'UNKNOWN';
    if (code === 'EEXIST') return { status: 'EXISTS', detail: 'the receipt already exists' };
    return { status: 'ERROR', detail: `${code}: ${e && e.message}` };
  }
}

module.exports = {
  TRANSIENT, REPLACE_CONTENTION_CODES, REPLACE_DEADLINE_MS,
  digest, canonical, canonicalDigest, safeSegment,
  writeAtomicText, writeAtomicJSON,
  readTextClassified, readJSONClassified, readLinesClassified,
  appendLine, createExclusive,
};

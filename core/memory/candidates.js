/*
 * RespawnPack · core/memory/candidates.js — candidate memories, and the wall between a lead and a fact.
 *
 * ⛔ THE RISK THIS MODULE EXISTS TO CONTAIN. A savepoint that automatically writes what it "learned"
 * turns a model inference into permanent project truth, silently, at the exact moment nobody is reading.
 * Continuity state and durable memory are different products with different trust levels, so a
 * candidate is stored with its PROVENANCE and a verification state, and:
 *
 *   · a candidate is NEVER injected as established fact — `renderForRecall` prefixes every unverified
 *     item with an unverified-lead marker, and there is no rendering path that omits it;
 *   · promotion REQUIRES supporting evidence paths. "Only verified findings, decisions, constraints, or
 *     root-cause/fix pairs may be promoted", and a promotion with nothing behind it is exactly the
 *     implementer qualifying its own work;
 *   · a rejected candidate cannot be promoted. Reversing a rejection is a deliberate act with its own
 *     record, not a retry of promote();
 *   · promotion and rejection are IDEMPOTENT and AUDITABLE — a repeat returns the original result and
 *     still appends a no-op row, because "somebody tried again" is information and losing it makes the
 *     audit a summary rather than a record.
 *
 * ⭐ THE RECORD IS MUTABLE, THE AUDIT IS NOT. Unlike the handoff, a candidate's file is rewritten as its
 * state changes; the append-only audit journal beside it is the authority for how it got there. That is
 * the opposite trade from core/state/handoff.js and it is deliberate: a handoff is delivered once and
 * its bytes are the evidence, while a memory has a lifetime and its HISTORY is the evidence.
 *
 * Savepoint wiring is W5. This module owns the record, the store and the two verbs; nothing here calls
 * a host.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const io = require('../_io.js');

const SCHEMA_VERSION = '2.0.0';
const KIND = 'candidate-memory';

// What a memory may be ABOUT. Anything else is a note, and notes do not become project truth.
const KLASSES = ['finding', 'decision', 'constraint', 'root-cause-fix'];
const VERIFICATION_STATES = ['candidate', 'verified', 'rejected'];

const UNVERIFIED_MARKER = 'UNVERIFIED LEAD';

/*
 * ⛔ WHERE THE RECORDS LIVE, AND WHY THE LEAF IS AN ARGUMENT NOW. This module was scaffolded for a
 * per-conversation RUNTIME caller, so `storeDir` appended a fixed `memory` leaf to whatever directory it
 * was handed. A caller whose store is NOT a conversation's had exactly two options: accept the leaf
 * wherever it landed, or pass a parent chosen to make the leaf come out right — both of which are a
 * module deciding a path its caller owns. The kernel took the first and its candidates landed beside the
 * project's memory engine instead of in a store of their own.
 *
 *   storeDir('<conversationDir>')     → '<conversationDir>/memory'  the DEFAULT, byte-for-byte unchanged
 *   storeDir({ dir: '<exactDir>' })   → '<exactDir>'                the OPT-IN: this exact directory
 *
 * ⛔ THE DEFAULT DOES NOT MOVE, AND THE OPT-IN IS SPELLED DIFFERENTLY FROM IT. A string means what it
 * has always meant. Relocating a store by changing what its existing callers already say would strand
 * records where nothing looks for them — and a store's inventory is a directory listing, which cannot
 * report the records left behind in the old one.
 */
const DEFAULT_STORE_LEAF = 'memory';
const isExactDir = (store) => Boolean(store) && typeof store === 'object' && typeof store.dir === 'string' && store.dir.length > 0;
const storeDir = (store) => (isExactDir(store) ? store.dir : path.join(store, DEFAULT_STORE_LEAF));
const auditPath = (store) => path.join(storeDir(store), 'audit.jsonl');
const recordPath = (store, id) => path.join(storeDir(store), `${io.safeSegment(id)}.json`);

const newId = () => `cm_${crypto.randomBytes(8).toString('hex')}`;

function build({ claim, klass, provenance = {}, id = null, at = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    id: id || newId(),
    claim: String(claim || ''),
    klass,
    provenance: {
      by: provenance.by || null,                 // which agent/session captured it
      at: provenance.at || at || new Date().toISOString(),
      cycleId: provenance.cycleId || null,       // WHICH CONTEXT CYCLE — a memory outlives the cycle that made it
      conversationId: provenance.conversationId || null,
      host: provenance.host || null,
      sourceKind: provenance.sourceKind || null, // savepoint | closeout | operator | adapter
      evidencePaths: Array.isArray(provenance.evidencePaths) ? provenance.evidencePaths.slice() : [],
    },
    verificationState: 'candidate',
    verification: null,
    rejection: null,
    supersededBy: null,
  };
}

const isStr = (v) => typeof v === 'string' && v.length > 0;

/** @returns {{ok:true}|{ok:false, reason}} */
function validate(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { ok: false, reason: 'a candidate memory must be a JSON object' };
  if (rec.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: `schemaVersion ${JSON.stringify(rec.schemaVersion)}; this core implements ${SCHEMA_VERSION}` };
  if (rec.kind !== KIND) return { ok: false, reason: `kind ${JSON.stringify(rec.kind)}, expected ${KIND}` };
  if (!isStr(rec.id)) return { ok: false, reason: 'id is required' };
  if (!isStr(rec.claim)) return { ok: false, reason: 'claim is required — a memory with no assertion asserts nothing and cannot be checked' };
  if (!KLASSES.includes(rec.klass)) return { ok: false, reason: `klass ${JSON.stringify(rec.klass)} is not one of ${KLASSES.join(', ')}` };
  if (!VERIFICATION_STATES.includes(rec.verificationState)) return { ok: false, reason: `verificationState ${JSON.stringify(rec.verificationState)} is not one of ${VERIFICATION_STATES.join(', ')}` };
  const p = rec.provenance;
  if (!p || typeof p !== 'object') return { ok: false, reason: 'provenance is required' };
  if (!isStr(p.cycleId)) return { ok: false, reason: 'provenance.cycleId is required — a memory that cannot say which context cycle produced it cannot be audited' };
  if (!Array.isArray(p.evidencePaths)) return { ok: false, reason: 'provenance.evidencePaths must be an array (an empty one is a real answer)' };
  return { ok: true };
}

function appendAudit(store, row) {
  return io.appendLine(auditPath(store), JSON.stringify({ at: new Date().toISOString(), ...row }));
}

/** @returns {{ok:true, record, file}|{ok:false, reason}} */
function write(store, rec) {
  const v = validate(rec);
  if (!v.ok) return { ok: false, reason: v.reason };
  const file = recordPath(store, rec.id);
  const w = io.writeAtomicJSON(file, rec);
  if (!w.ok) return { ok: false, reason: `the candidate could not be written: ${w.detail}` };
  return { ok: true, record: rec, file };
}

/** Capture a new candidate and audit the capture. */
function capture(store, fields) {
  const rec = build(fields);
  const w = write(store, rec);
  if (!w.ok) return w;
  appendAudit(store, { action: 'capture', id: rec.id, klass: rec.klass, cycleId: rec.provenance.cycleId, by: rec.provenance.by });
  return w;
}

function read(store, id) {
  const r = io.readJSONClassified(recordPath(store, id));
  if (r.status !== 'OK') return { status: r.status, record: null, detail: r.detail };
  const v = validate(r.doc);
  if (!v.ok) return { status: 'INVALID', record: null, detail: v.reason };
  return { status: 'OK', record: r.doc, detail: null };
}

/**
 * Every candidate in the store.
 * ⛔ This IS a directory listing, and a directory listing cannot report a record that was never written.
 * It is the store's own inventory, so nothing is being inferred from presence — but a caller asking
 * "did the savepoint capture anything" must read the AUDIT, which is append-only, not this.
 */
function list(store) {
  let names = [];
  try { names = fs.readdirSync(storeDir(store)).filter((f) => f.endsWith('.json')); }
  catch { return { status: 'ABSENT', records: [], unreadable: [] }; }
  const records = [], unreadable = [];
  for (const n of names) {
    const r = io.readJSONClassified(path.join(storeDir(store), n));
    if (r.status === 'OK' && validate(r.doc).ok) records.push(r.doc);
    else unreadable.push({ file: n, why: r.detail || r.status });
  }
  return { status: 'OK', records, unreadable };
}

/**
 * Promote a candidate to verified.
 * @returns {{status:'PROMOTED'|'ALREADY_VERIFIED'|'REFUSED'|'CANNOT_DETERMINE', record?, reason?}}
 */
function promote(store, id, { by, evidencePaths = [], note = null } = {}) {
  const r = read(store, id);
  if (r.status === 'ABSENT') return { status: 'REFUSED', reason: `no candidate ${id} in this store` };
  if (r.status !== 'OK') return { status: 'CANNOT_DETERMINE', reason: `${id} could not be read (${r.detail || r.status})` };
  const rec = r.record;

  if (rec.verificationState === 'verified') {
    // Idempotent, and the retry is still audited: "somebody tried again" is information.
    appendAudit(store, { action: 'promote-noop', id, by: by || null, of: rec.verification });
    return { status: 'ALREADY_VERIFIED', record: rec };
  }
  if (rec.verificationState === 'rejected') {
    appendAudit(store, { action: 'promote-refused', id, by: by || null, reason: 'rejected' });
    return { status: 'REFUSED', record: rec, reason: `${id} was rejected (${(rec.rejection && rec.rejection.reason) || 'no reason recorded'}); reversing a rejection is a deliberate act with its own record, not a retry of promote()` };
  }
  if (!Array.isArray(evidencePaths) || !evidencePaths.length) {
    appendAudit(store, { action: 'promote-refused', id, by: by || null, reason: 'no evidence' });
    return { status: 'REFUSED', record: rec, reason: 'promotion requires at least one supporting evidence path — a promotion with nothing behind it is the implementing context qualifying its own work' };
  }

  const next = {
    ...rec,
    verificationState: 'verified',
    verification: { by: by || null, at: new Date().toISOString(), evidencePaths: evidencePaths.slice(), note: note || null },
  };
  const w = write(store, next);
  if (!w.ok) return { status: 'CANNOT_DETERMINE', reason: w.reason };
  appendAudit(store, { action: 'promote', id, by: by || null, evidencePaths, note: note || null });
  return { status: 'PROMOTED', record: next };
}

/**
 * Reject a candidate.
 * @returns {{status:'REJECTED'|'ALREADY_REJECTED'|'REFUSED'|'CANNOT_DETERMINE', record?, reason?}}
 */
function reject(store, id, { by, reason } = {}) {
  const r = read(store, id);
  if (r.status === 'ABSENT') return { status: 'REFUSED', reason: `no candidate ${id} in this store` };
  if (r.status !== 'OK') return { status: 'CANNOT_DETERMINE', reason: `${id} could not be read (${r.detail || r.status})` };
  const rec = r.record;
  if (!isStr(reason)) return { status: 'REFUSED', record: rec, reason: 'a rejection must state why — an unexplained rejection cannot be reviewed' };

  if (rec.verificationState === 'rejected') {
    appendAudit(store, { action: 'reject-noop', id, by: by || null, of: rec.rejection });
    return { status: 'ALREADY_REJECTED', record: rec };
  }

  // A VERIFIED memory may be rejected later: findings are overturned. The prior verification is kept on
  // the record rather than overwritten, so the audit shows what was believed and for how long.
  const next = {
    ...rec,
    verificationState: 'rejected',
    rejection: { by: by || null, at: new Date().toISOString(), reason, previousState: rec.verificationState },
  };
  const w = write(store, next);
  if (!w.ok) return { status: 'CANNOT_DETERMINE', reason: w.reason };
  appendAudit(store, { action: 'reject', id, by: by || null, reason, previousState: rec.verificationState });
  return { status: 'REJECTED', record: next };
}

/**
 * The ONLY rendering path. An unverified candidate is always marked; a rejected one is never rendered
 * at all. There is deliberately no `renderRaw` — a second path is how the marker gets dropped.
 */
function renderForRecall(records) {
  return records
    .filter((r) => r.verificationState !== 'rejected')
    .map((r) => (r.verificationState === 'verified'
      ? `VERIFIED (${r.klass}): ${r.claim} — evidence: ${(r.verification && r.verification.evidencePaths || []).join(', ') || 'none recorded'}`
      : `${UNVERIFIED_MARKER} (${r.klass}, captured in cycle ${r.provenance.cycleId} by ${r.provenance.by || 'an unrecorded author'}): ${r.claim} — NOT established; verify before relying on it`));
}

module.exports = {
  SCHEMA_VERSION, KIND, KLASSES, VERIFICATION_STATES, UNVERIFIED_MARKER, DEFAULT_STORE_LEAF,
  storeDir, auditPath, recordPath, newId,
  build, validate, capture, write, read, list, promote, reject, appendAudit, renderForRecall,
};

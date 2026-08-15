/*
 * RespawnPack · core/lifecycle/cycle.js — CONTEXT CYCLE IDENTITY: the thing v0.2 did not have a name for.
 *
 * A context cycle is the work performed between two compactions. It is NOT a session: a compacted
 * conversation keeps its session id, which is precisely why v0.2's per-session threshold latch fired
 * once and then went silent forever. Anything that must re-arm "after a compaction" has to be keyed on
 * this, and nothing else.
 *
 * ⭐ THE SCHEME
 *
 *   cycleId = `${host}:${conversationId}:${cycleIndex}:${cycleNonce}`
 *
 *   host           claude-code | codex | pi. A conversation id is unique only WITHIN a host, and two
 *                  adapters writing into one project must not be able to collide.
 *   conversationId the host's own stable identity — Claude session_id, Codex thr_*, Pi session id.
 *   cycleIndex     0-based, monotone, INCREMENTED EXACTLY ONCE PER OBSERVED COMPACTION COMPLETION. The
 *                  increment happens inside the REHYDRATING→ACTIVE transition, which is itself gated on
 *                  an identity-verification record, so an unobserved or failed compaction cannot advance
 *                  it and a duplicate completion event cannot advance it twice.
 *   cycleNonce     12 hex characters, minted with the cycle. This is what makes REUSE DETECTABLE rather
 *                  than merely unlikely: any artifact bound to cycle N carries N's nonce, so a restart
 *                  that re-mints N — the crash case below — cannot silently adopt the orphaned cycle's
 *                  latches, receipts or transition keys.
 *
 * ⛔ CRASH AND RESTART SEMANTICS, stated because getting them wrong re-arms a threshold that should be
 * latched (a loop) or latches one that should be armed (silence at 85%):
 *
 *   RESTART IS NOT A NEW CYCLE. A process that dies and comes back reads the journal and RESTORES the
 *   cycle verbatim — same index, same nonce. Nothing about a crash means the model forgot less.
 *
 *   AN ABSENT RECORD IS A MINT, AND SAYS SO. `provenance` is 'minted' or 'restored', never inferred by
 *   the reader. "Cycle 0 because this is the first cycle" and "cycle 0 because the file is gone" are
 *   different facts, and only the second one means the previous cycle's latches were lost.
 *
 *   A CYCLE THAT CANNOT BE PERSISTED DOES NOT EXIST. The record is written atomically and read back
 *   before it is used; a failed read-back is CYCLE_UNESTABLISHED (CANNOT_DETERMINE), and the machine
 *   refuses to advance rather than running on a cycle it cannot prove.
 *
 *   A CRASH BETWEEN THE CYCLE WRITE AND THE JOURNAL APPEND RE-MINTS. The journal is the authority, so a
 *   cycle file that is ahead of the log is discarded and the advance is re-applied with a FRESH nonce.
 *   The orphaned nonce is then bound to nothing, which is the intended outcome — it can never be
 *   confused with the cycle that actually exists.
 */
const path = require('path');
const crypto = require('crypto');
const io = require('../_io.js');
const { failure } = require('../policy/failures.js');

const RUNTIME_SUBDIR = path.join('.respawnpack', 'runtime', 'rollover');
const NONCE_BYTES = 6; // 12 hex chars

const cycleIdOf = (c) => `${c.host}:${c.conversationId}:${c.index}:${c.nonce}`;

/** The per-conversation runtime directory. Host and id are both sanitized before they touch a path. */
function conversationDir(projectDir, host, conversationId) {
  return path.join(projectDir, RUNTIME_SUBDIR, `${io.safeSegment(host)}-${io.safeSegment(conversationId)}`);
}

function mint({ host, conversationId, index = 0, provenance = 'minted', at = null }) {
  const c = {
    host: String(host),
    conversationId: String(conversationId),
    index,
    nonce: crypto.randomBytes(NONCE_BYTES).toString('hex'),
    startedAt: at || new Date().toISOString(),
    provenance,
  };
  return { ...c, cycleId: cycleIdOf(c) };
}

/** The next cycle. A fresh nonce every time — an index alone would repeat across a clone or a restart. */
function advance(cycle, at = null) {
  return mint({ host: cycle.host, conversationId: cycle.conversationId, index: cycle.index + 1, provenance: 'advanced', at });
}

/**
 * Persist the cycle record and PROVE it landed.
 * @returns {{ok:true, record}|{ok:false, failure}}
 */
function persist(dir, cycle) {
  const file = path.join(dir, 'cycle.json');
  const w = io.writeAtomicJSON(file, cycle);
  if (!w.ok) return { ok: false, failure: failure('CYCLE_UNESTABLISHED', `the cycle record could not be written: ${w.detail}`) };
  const back = io.readJSONClassified(file);
  if (back.status !== 'OK') return { ok: false, failure: failure('CYCLE_UNESTABLISHED', `the cycle record was written and could not be read back: ${back.detail || back.status}`) };
  if (!back.doc || back.doc.cycleId !== cycle.cycleId) {
    return { ok: false, failure: failure('CYCLE_UNESTABLISHED', `the cycle record read back as ${JSON.stringify(back.doc && back.doc.cycleId)}, not ${JSON.stringify(cycle.cycleId)}`) };
  }
  return { ok: true, record: back.doc };
}

/** @returns {{status:'OK'|'ABSENT'|'UNREADABLE'|'MALFORMED', cycle:object|null, detail:string|null}} */
function readPersisted(dir) {
  const r = io.readJSONClassified(path.join(dir, 'cycle.json'));
  if (r.status !== 'OK') return { status: r.status, cycle: null, detail: r.detail };
  const c = r.doc;
  const shaped = c && typeof c === 'object' && typeof c.cycleId === 'string' && Number.isInteger(c.index) && typeof c.nonce === 'string';
  if (!shaped) return { status: 'MALFORMED', cycle: null, detail: 'the cycle record is present and is not a cycle record' };
  return { status: 'OK', cycle: c, detail: null };
}

module.exports = { RUNTIME_SUBDIR, cycleIdOf, conversationDir, mint, advance, persist, readPersisted };

/*
 * RespawnPack · core/state/handoff.js — the rollover handoff, schema v2, and the v1 records it must not
 * orphan.
 *
 * ⛔ THE DOCUMENT IS IMMUTABLE ONCE WRITTEN, AND THAT IS THE CHANGE FROM v1. The v1 handoff was written,
 * re-written to stamp `readBackVerified: true`, and re-written again to stamp `consumedAt` — so the
 * bytes that were verified were never the bytes that were injected, and the file's own digest could not
 * be used as evidence of anything. Here the verification and the consumption are SEPARATE RECEIPTS
 * beside the document:
 *
 *   <id>.json           the handoff. Written once, atomically. Its digest is stable and is the evidence.
 *   <id>.verified.json  written after the bytes were read back and compared. No receipt ⇒ unverified.
 *   <id>.consumed.json  created with `wx`. Exactly one caller creates it; see lifecycle/consumable.js.
 *
 * ⛔ AND THE VERIFICATION IS RE-CHECKED AT CONSUME TIME. A receipt proves the file was right when it was
 * written; injecting it later proves nothing about the file NOW. The digest is recomputed before the
 * consumption is claimed, which closes the window between verification and delivery.
 *
 * ⛔ v1 RECORDS STAY READABLE, AND MIGRATION INVENTS NOTHING. `fromV1` carries the original document
 * verbatim and leaves `exactNextAction` NULL when v1 recorded none — a migration that manufactured a
 * next action from an atomic-task note would be reconstructing a conclusion from memory, which is the
 * failure the handoff exists to prevent.
 */
const path = require('path');
const io = require('../_io.js');
const crypto = require('crypto');
const consumable = require('../lifecycle/consumable.js');
const evidence = require('../lifecycle/evidence.js');
const { failure } = require('../policy/failures.js');

const SCHEMA_VERSION = '2.0.0';
const KIND = 'rollover-handoff';
const V1_KIND = 'precompact-handoff';
const MAX_LISTED_FILES = 60; // a handoff, not a tree dump — the same bound v1 used, and it is REPORTED

const newHandoffId = () => `ho_${crypto.randomBytes(8).toString('hex')}`;

const pathFor = (dir, handoffId) => path.join(dir, `${io.safeSegment(handoffId)}.json`);
const verifiedPathFor = (dir, handoffId) => path.join(dir, `${io.safeSegment(handoffId)}.verified.json`);
const consumedPathFor = (dir, handoffId) => path.join(dir, `${io.safeSegment(handoffId)}.consumed.json`);

/** The empty-but-legal shape. Every list is present so a reader never has to distinguish [] from absent. */
function build(fields = {}) {
  const uncommitted = (fields.git && fields.git.uncommittedFiles) || [];
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    handoffId: fields.handoffId || newHandoffId(),
    writtenAt: fields.writtenAt || new Date().toISOString(),
    identity: {
      host: (fields.identity && fields.identity.host) || null,
      conversationId: (fields.identity && fields.identity.conversationId) || null,
      // Which FIELD of the host's payload the id came from: session_id, threadId, sessionId. Recorded
      // because the hosts do not agree on the name and a bare id cannot say where it was read.
      conversationIdField: (fields.identity && fields.identity.conversationIdField) || null,
    },
    contextCycleId: fields.contextCycleId || null,
    atomicActionId: fields.atomicActionId || null,
    exactNextAction: fields.exactNextAction || null,
    git: {
      head: (fields.git && fields.git.head) || null,
      uncommittedFiles: uncommitted.slice(0, MAX_LISTED_FILES),
      uncommittedTruncated: uncommitted.length > MAX_LISTED_FILES,
      sessionDelta: (fields.git && fields.git.sessionDelta) || { status: 'CANNOT_DETERMINE', files: [], headMoved: false },
    },
    userConstraints: fields.userConstraints || [],
    verificationEvidence: fields.verificationEvidence || [],
    unresolvedQuestions: fields.unresolvedQuestions || [],
    // IDS ONLY. A candidate memory is an unverified lead; inlining its text here would deliver it into
    // the next cycle looking exactly like the verified facts beside it.
    candidateMemories: fields.candidateMemories || [],
    migratedFrom: fields.migratedFrom || null,
    source: fields.source || { kind: 'native', raw: null },
  };
}

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** @returns {{ok:true}|{ok:false, reason:string}} */
function validate(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { ok: false, reason: 'a handoff must be a JSON object' };
  if (rec.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: `schemaVersion ${JSON.stringify(rec.schemaVersion)}; this core implements ${SCHEMA_VERSION}` };
  if (rec.kind !== KIND) return { ok: false, reason: `kind ${JSON.stringify(rec.kind)}, expected ${KIND}` };
  if (!isStr(rec.handoffId)) return { ok: false, reason: 'handoffId is required' };
  if (!rec.identity || !isStr(rec.identity.host) || !isStr(rec.identity.conversationId)) {
    return { ok: false, reason: 'identity.host and identity.conversationId are required — a handoff that cannot say which conversation it belongs to cannot prove an in-place rollover' };
  }
  if (!isStr(rec.contextCycleId)) return { ok: false, reason: 'contextCycleId is required — a handoff not bound to a cycle can be re-injected into any of them' };
  for (const f of ['userConstraints', 'unresolvedQuestions', 'candidateMemories']) {
    if (!isStrArray(rec[f])) return { ok: false, reason: `${f} must be an array of strings; a string here would spread into single characters` };
  }
  if (!Array.isArray(rec.verificationEvidence)) return { ok: false, reason: 'verificationEvidence must be an array' };
  if (!rec.git || typeof rec.git !== 'object') return { ok: false, reason: 'git facts are required (head, uncommittedFiles, sessionDelta)' };
  return { ok: true };
}

/**
 * Write the handoff, read it back, compare the BYTES, and leave a verification receipt.
 *
 * @returns {{ok:true, handoffPath, writtenDigest, readBackDigest, equal:true, evidence:{written, readback}}
 *          |{ok:false, failure, evidence?:{written, readback}}}
 */
function writeVerified(dir, record) {
  const v = validate(record);
  if (!v.ok) return { ok: false, failure: failure('EVIDENCE_MALFORMED', `handoff refused before it was written: ${v.reason}`) };

  const file = pathFor(dir, record.handoffId);
  const w = io.writeAtomicText(file, `${JSON.stringify(record, null, 2)}\n`);
  if (!w.ok) return { ok: false, failure: failure('HANDOFF_WRITE_FAILED', w.detail) };

  const back = io.readTextClassified(file);
  if (back.status !== 'OK') {
    return { ok: false, failure: failure('HANDOFF_READBACK_MISMATCH', `the handoff was written and could not be read back (${back.detail || back.status})`) };
  }

  const equal = back.digest === w.digest;
  const written = evidence.make(evidence.KINDS.HANDOFF_WRITTEN, {
    handoffId: record.handoffId, handoffPath: file, writtenDigest: w.digest, bytes: w.bytes, observedAt: record.writtenAt,
  });
  const readback = evidence.make(evidence.KINDS.HANDOFF_READBACK, {
    handoffId: record.handoffId, handoffPath: file, writtenDigest: w.digest, readBackDigest: back.digest, equal,
  });

  if (!equal) {
    return { ok: false, failure: failure('HANDOFF_READBACK_MISMATCH', `wrote ${w.digest.slice(0, 12)}…, read back ${String(back.digest).slice(0, 12)}…`), evidence: { written, readback } };
  }

  const receipt = io.writeAtomicJSON(verifiedPathFor(dir, record.handoffId), {
    kind: 'handoff-verification', handoffId: record.handoffId, handoffPath: file,
    writtenDigest: w.digest, readBackDigest: back.digest, equal: true, verifiedAt: new Date().toISOString(),
  });
  if (!receipt.ok) return { ok: false, failure: failure('HANDOFF_WRITE_FAILED', `the verification receipt could not be written: ${receipt.detail}`), evidence: { written, readback } };

  return { ok: true, handoffPath: file, writtenDigest: w.digest, readBackDigest: back.digest, equal: true, evidence: { written, readback } };
}

/** @returns {{status:'OK'|'ABSENT'|'UNREADABLE'|'MALFORMED'|'INVALID', doc, digest, detail}} */
function read(dir, handoffId) {
  const file = pathFor(dir, handoffId);
  const r = io.readTextClassified(file);
  if (r.status !== 'OK') return { status: r.status, doc: null, digest: null, detail: r.detail };
  let doc;
  try { doc = JSON.parse(r.text); } catch (e) { return { status: 'MALFORMED', doc: null, digest: r.digest, detail: e.message }; }
  const v = validate(doc);
  if (!v.ok) return { status: 'INVALID', doc: null, digest: r.digest, detail: v.reason };
  return { status: 'OK', doc, digest: r.digest, detail: null };
}

/**
 * Claim the handoff exactly once.
 *
 * @returns {{status:'CONSUMED', handoff, receipt, receiptPath}
 *          |{status:'ALREADY_CONSUMED', receipt, receiptPath, firstConsumption}
 *          |{status:'REFUSED'|'CANNOT_DETERMINE', failure}}
 */
function consume(dir, handoffId, { consumerId, at = null } = {}) {
  const verified = io.readJSONClassified(verifiedPathFor(dir, handoffId));
  if (verified.status === 'ABSENT') {
    return { status: 'REFUSED', failure: failure('HANDOFF_UNVERIFIED', `no verification receipt for ${handoffId} — it was never read back and compared, so it may not be injected`) };
  }
  if (verified.status !== 'OK' || !verified.doc || verified.doc.equal !== true) {
    return { status: 'CANNOT_DETERMINE', failure: failure('HANDOFF_RECEIPT_UNREADABLE', `the verification receipt for ${handoffId} could not be trusted (${verified.detail || verified.status})`) };
  }

  const now = read(dir, handoffId);
  if (now.status !== 'OK') {
    return { status: 'CANNOT_DETERMINE', failure: failure('HANDOFF_RECEIPT_UNREADABLE', `${handoffId} is verified and its document is ${now.status}: ${now.detail || 'no detail'}`) };
  }
  if (now.digest !== verified.doc.readBackDigest) {
    return { status: 'REFUSED', failure: failure('HANDOFF_CHANGED_SINCE_VERIFICATION', `${handoffId} digests ${now.digest.slice(0, 12)}… now, verified at ${String(verified.doc.readBackDigest).slice(0, 12)}…`) };
  }

  const r = consumable.consume(consumedPathFor(dir, handoffId), {
    subjectId: handoffId, consumerId, at,
    note: 'the rollover handoff was injected into the next context cycle',
    extra: { verifiedDigest: verified.doc.readBackDigest, contextCycleId: now.doc.contextCycleId, exactNextAction: now.doc.exactNextAction },
  });

  if (r.status === 'CONSUMED') return { status: 'CONSUMED', handoff: now.doc, receipt: r.receipt, receiptPath: r.receiptPath };
  if (r.status === 'ALREADY_CONSUMED') {
    return { status: 'ALREADY_CONSUMED', receipt: r.receipt, receiptPath: r.receiptPath, firstConsumption: r.firstConsumption };
  }
  return { status: 'CANNOT_DETERMINE', failure: r.failure, receiptPath: r.receiptPath };
}

/**
 * v1 (`precompact-handoff`, schemaVersion 1.0.0) → v2, without inventing anything.
 *
 * The v1 record is kept VERBATIM under `source.raw`: it is the only copy of what that session actually
 * recorded, and a migration that summarised it would delete the evidence to save a few bytes.
 */
function fromV1(v1, { host, contextCycleId, conversationIdField = 'session_id' } = {}) {
  if (!v1 || v1.kind !== V1_KIND) return { ok: false, reason: `not a v1 ${V1_KIND} record` };
  const unresolved = ['migrated from a v1 precompact handoff: it recorded no exactNextAction, so the next action must be re-derived from the atomic task and the git facts below'];
  if (v1.readBackVerified !== true) unresolved.push('the v1 handoff was never read back — treat every fact in it as unverified');
  if (v1.ledgerBehindHead === true) unresolved.push('the v1 handoff recorded .respawnpack/wave-ledger.md as BEHIND HEAD — a completed wave may be unrecorded');

  return {
    ok: true,
    handoff: build({
      handoffId: `ho_v1_${io.safeSegment(v1.sessionId)}`,
      writtenAt: v1.writtenAt,
      identity: { host, conversationId: v1.sessionId, conversationIdField },
      contextCycleId,
      atomicActionId: typeof v1.atomicTask === 'string' ? v1.atomicTask : (v1.atomicTask && v1.atomicTask.id) || null,
      exactNextAction: null,
      git: {
        head: v1.head || null,
        uncommittedFiles: Array.isArray(v1.uncommittedFiles) ? v1.uncommittedFiles : [],
        sessionDelta: v1.sessionDelta || { status: 'CANNOT_DETERMINE', files: [], headMoved: false },
      },
      userConstraints: [],
      verificationEvidence: [],
      unresolvedQuestions: unresolved,
      candidateMemories: [],
      migratedFrom: '1.0.0',
      source: { kind: 'v1-precompact', raw: v1 },
    }),
  };
}

module.exports = {
  SCHEMA_VERSION, KIND, V1_KIND, MAX_LISTED_FILES,
  build, validate, writeVerified, read, consume, fromV1,
  pathFor, verifiedPathFor, consumedPathFor, newHandoffId,
};

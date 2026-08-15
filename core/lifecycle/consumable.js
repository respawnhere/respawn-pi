/*
 * RespawnPack · core/lifecycle/consumable.js — the exactly-once primitive.
 *
 * ⛔ WHY NOT "READ THE FLAG, THEN SET IT". v0.2 consumed its compaction handoff by reading the record,
 * checking `consumedAt`, and writing it back — a read-modify-write with no lock, on a file that two
 * SessionStart hooks can reach at the same instant on the same machine (a resume racing a compact, a
 * background session and a foreground one). Both read "unconsumed", both inject, and the atomic action
 * runs twice. Atomicity of the WRITE was never the missing piece; atomicity of the DECISION was.
 *
 * ⭐ SO THE DECISION IS THE FILE. `open(path, 'wx')` is the portable compare-and-swap — O_EXCL on POSIX,
 * CREATE_NEW on Windows — and exactly one caller across any number of processes creates the receipt.
 * Every other caller gets EEXIST, which is not an error but the ANSWER: someone else consumed this, and
 * here is their record.
 *
 * ⛔ AND THE SECOND CALLER GETS A POINTER, NOT A BOOLEAN. "Already consumed" with no way to see WHO
 * consumed it, WHEN, and what they were told to do next is how a duplicate delivery becomes an
 * unexplained one. The first consumption record is returned verbatim.
 *
 * ⛔ AN UNREADABLE RECEIPT IS NOT A FRESH ONE. If the receipt exists and cannot be read, the answer is
 * CANNOT_DETERMINE — never "consume it again". Injecting an atomic action twice costs more than
 * stopping to ask.
 */
const io = require('../_io.js');
const { failure } = require('../policy/failures.js');

/**
 * Claim a subject exactly once.
 *
 * @returns {{status:'CONSUMED', receipt, receiptPath}
 *          |{status:'ALREADY_CONSUMED', receipt, receiptPath, firstConsumption}
 *          |{status:'CANNOT_DETERMINE', failure, receiptPath}}
 */
function consume(receiptPath, { subjectId, consumerId, at = null, note = null, extra = null } = {}) {
  const receipt = {
    kind: 'consumption-receipt',
    subjectId: String(subjectId),
    consumerId: String(consumerId),
    consumedAt: at || new Date().toISOString(),
    note: note || null,
    ...(extra ? { extra } : {}),
  };
  const created = io.createExclusive(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  if (created.status === 'CREATED') return { status: 'CONSUMED', receipt, receiptPath };

  if (created.status === 'EXISTS') {
    const back = io.readJSONClassified(receiptPath);
    if (back.status !== 'OK' || !back.doc) {
      return {
        status: 'CANNOT_DETERMINE', receiptPath,
        failure: failure('HANDOFF_RECEIPT_UNREADABLE', `a receipt exists at ${receiptPath} and could not be read (${back.detail || back.status})`),
      };
    }
    return { status: 'ALREADY_CONSUMED', receipt: back.doc, receiptPath, firstConsumption: back.doc };
  }

  return {
    status: 'CANNOT_DETERMINE', receiptPath,
    failure: failure('HANDOFF_RECEIPT_UNREADABLE', `the receipt could not be created and does not exist: ${created.detail}`),
  };
}

/** Look without claiming. FRESH means no receipt was found — it does NOT reserve anything. */
function inspect(receiptPath) {
  const r = io.readJSONClassified(receiptPath);
  if (r.status === 'ABSENT') return { status: 'FRESH', receipt: null, detail: null };
  if (r.status === 'OK') return { status: 'CONSUMED', receipt: r.doc, detail: null };
  return { status: 'CANNOT_DETERMINE', receipt: null, detail: r.detail || r.status };
}

module.exports = { consume, inspect };

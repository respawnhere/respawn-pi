/*
 * RespawnPack · core/lifecycle/states.js — the rollover state machine's DECLARED transition table.
 *
 * ⛔ THE TABLE IS DATA, NOT CONTROL FLOW, BECAUSE AN INVENTORY BUILT FROM WHAT THE CODE HAPPENS TO DO
 * CANNOT REPORT AN ABSENCE. A machine written as a switch statement has no answer to "which transitions
 * require a completion record" other than reading every branch; this one is enumerable, so the suites
 * can fence it in both directions — every transition names its required evidence, and every state is
 * reachable or explicitly terminal.
 *
 * ⭐ THE THREE INVARIANTS THE TABLE EXISTS TO MAKE UNSKIPPABLE, in the order they were violated in v0.2:
 *   1. Nothing reaches COMPACTING except from HANDOFF_VERIFIED, and only with a read-back comparison
 *      that actually compared two digests.
 *   2. Nothing reaches REHYDRATING without an OBSERVED completion record naming a declared host signal.
 *   3. Nothing returns to ACTIVE without an identity-verification record whose expected and observed
 *      conversation ids are present and equal. That check is EMPIRICAL PER ROLLOVER: same-id-across-
 *      compact is strongly evidenced in every host's documentation and verbatim in none of them.
 */
const { KINDS } = require('./evidence.js');

const STATES = {
  ACTIVE: 'ACTIVE',
  CHECKPOINT: 'CHECKPOINT',
  CLOSEOUT: 'CLOSEOUT',
  ROLLOVER_PENDING: 'ROLLOVER_PENDING',
  HANDOFF_VERIFIED: 'HANDOFF_VERIFIED',
  COMPACTING: 'COMPACTING',
  REHYDRATING: 'REHYDRATING',
  HALTED: 'HALTED',
};

// HALTED is terminal by construction: no transition declares it as a `from`, and the machine refuses
// every event once halted. A rollover that could resume past its own halt would make the halt advisory.
const TERMINAL = new Set([STATES.HALTED]);

const TRANSITIONS = {
  checkpoint: {
    from: STATES.ACTIVE, to: STATES.CHECKPOINT,
    requires: [KINDS.CONTEXT_MEASUREMENT],
    guard: 'measurementUsable',
    why: 'a threshold was crossed on a measurement from a declared source, with its confidence attached',
  },
  closeout: {
    from: STATES.CHECKPOINT, to: STATES.CLOSEOUT,
    requires: [KINDS.SAFE_BOUNDARY],
    guard: null,
    why: 'the current atomic operation finished or stopped at a boundary the host reported; no new model turn was begun',
  },
  'stage-handoff': {
    from: STATES.CLOSEOUT, to: STATES.ROLLOVER_PENDING,
    requires: [KINDS.HANDOFF_WRITTEN],
    guard: null,
    why: 'the handoff was written atomically; it is not yet trusted, because a write is not a read',
  },
  'verify-handoff': {
    from: STATES.ROLLOVER_PENDING, to: STATES.HANDOFF_VERIFIED,
    requires: [KINDS.HANDOFF_READBACK],
    guard: 'readbackAgrees',
    records: 'verifiedHandoff',
    why: 'the handoff was read back and the digests were compared; a mismatch halts rather than degrades',
  },
  'request-compact': {
    from: STATES.HANDOFF_VERIFIED, to: STATES.COMPACTING,
    requires: [KINDS.COMPACT_REQUESTED],
    guard: 'verifiedHandoffPresent',
    why: 'compaction was requested through a documented host mechanism, with a verified handoff on disk',
  },
  'observe-completion': {
    from: STATES.COMPACTING, to: STATES.REHYDRATING,
    requires: [KINDS.COMPACT_COMPLETED],
    guard: null,
    why: 'the host emitted a declared completion signal — not a timeout, not an exit, not a delay',
  },
  'verify-identity': {
    from: STATES.REHYDRATING, to: STATES.ACTIVE,
    requires: [KINDS.IDENTITY_VERIFICATION],
    guard: 'identityAgrees',
    advancesCycle: true,
    clears: 'verifiedHandoff',
    why: 'the same conversation identity survived the compaction, so this is an in-place rollover and a new context cycle begins',
  },
  'noop-return': {
    from: STATES.COMPACTING, to: STATES.ACTIVE,
    requires: [KINDS.COMPACT_NOOP, KINDS.IDENTITY_VERIFICATION],
    guard: 'identityAgrees',
    advancesCycle: false,
    clears: 'verifiedHandoff',
    why: 'the host declined to compact ("Not enough messages to compact.") and emitted no boundary. A typed NON-FAILURE, '
      + 'distinct from success-with-rollover: no cycle advances, so every threshold latch stays latched and the '
      + 'checkpoint does not immediately re-fire. The handoff stays unconsumed and the next attempt must re-verify it.',
  },
  halt: {
    from: '*', to: STATES.HALTED,
    requires: [],
    guard: null,
    why: 'an invariant failed, or a proof will not arrive; the recovery instruction travels with the code',
  },
};

/** Which transitions may legally be attempted from a state. Ordered, so a caller can present them. */
function legalFrom(state) {
  return Object.entries(TRANSITIONS)
    .filter(([, t]) => t.from === state || t.from === '*')
    .map(([name]) => name);
}

const isState = (s) => Object.prototype.hasOwnProperty.call(STATES, s);
const isTransition = (t) => Object.prototype.hasOwnProperty.call(TRANSITIONS, t);

module.exports = { STATES, TERMINAL, TRANSITIONS, legalFrom, isState, isTransition };

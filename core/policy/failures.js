/*
 * RespawnPack · core/policy/failures.js — the typed failure taxonomy of the rollover.
 *
 * ⛔ EVERY FAILURE CARRIES ITS OWN RECOVERY SENTENCE, AND THE SENTENCE IS THE POINT. The v0.2 messaging
 * failure this replaces told an operator to "start a fresh session", which is a different product from
 * the one that failed: it discards the conversation identity the rollover exists to preserve. A code
 * with no instruction is a label, so a code with no `recovery` cannot be constructed here.
 *
 * ⛔ AND THE OUTCOME IS PART OF THE TYPE, drawn from the pack's four-outcome vocabulary (see
 * kernel/lib/outcome.js — the names are deliberately identical, and core/ carries its own copy only
 * because the dependency arrow forbids requiring the kernel). The split that matters:
 *
 *   FAIL              something was OBSERVED to be wrong: a digest disagreed, an identity changed, a
 *                     transition was attempted that the protocol forbids.
 *   CANNOT_DETERMINE  the proof never arrived: a timeout, an unreadable journal, an unobservable
 *                     identity. NOT a pass, NOT a warning, and above all NOT a FAIL — an adapter that
 *                     cannot tell "compaction did not happen" from "I did not see it happen" will
 *                     eventually report the second as the first, or worse, as success.
 *
 * A timeout, an elapsed delay and a process exit are never evidence of anything having completed. They
 * land here, as CANNOT_DETERMINE, which is why COMPLETION_UNOBSERVED exists as a first-class code
 * rather than as a fallthrough.
 */

// The four-outcome vocabulary, for CHECK-shaped results. Distinct from the capability vocabulary in
// capabilities.js — the two share the name CANNOT_DETERMINE and nothing else, and must never be mixed.
const OUTCOME = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  CANNOT_DETERMINE: 'CANNOT_DETERMINE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
};

const RANK = { NOT_APPLICABLE: 0, PASS: 1, CANNOT_DETERMINE: 2, FAIL: 3 };

/*
 * The taxonomy. `halts` records whether reaching this condition ends the rollover (an invariant about
 * the WORLD was violated, or a proof will never arrive) or merely refuses the attempted step (the
 * protocol forbids it HERE AND NOW, and the adapter may legitimately do something else and try again).
 * That split is what keeps a refused `request-compact` from destroying a session that only needed to
 * verify its handoff first.
 */
const FAILURES = {
  // --- handoff -------------------------------------------------------------------------------------
  HANDOFF_WRITE_FAILED: {
    outcome: OUTCOME.FAIL, halts: true,
    recovery: 'The handoff could not be written to .respawnpack/runtime/. Do NOT compact: check that the runtime directory is writable, then re-run the savepoint. Compacting now would discard the session with nothing persisted.',
  },
  HANDOFF_READBACK_MISMATCH: {
    outcome: OUTCOME.FAIL, halts: true,
    recovery: 'The handoff read back differently from what was written, so what is on disk is not what this session meant to save. Do NOT compact. Re-write the handoff; if the digests disagree a second time, the runtime directory is being written by something else and must be inspected before any rollover.',
  },
  HANDOFF_UNVERIFIED: {
    outcome: OUTCOME.FAIL, halts: false,
    recovery: 'Compaction was requested with no read-back verification for the handoff. Write the handoff and verify it (write → read → compare digests) first; only a verified handoff may precede a compaction.',
  },
  HANDOFF_CHANGED_SINCE_VERIFICATION: {
    outcome: OUTCOME.FAIL, halts: true,
    recovery: 'The handoff file changed after it was verified, so the verification no longer describes the bytes that would be injected. Re-write and re-verify the handoff before continuing; do not inject the current file.',
  },
  HANDOFF_RECEIPT_UNREADABLE: {
    outcome: OUTCOME.CANNOT_DETERMINE, halts: false,
    recovery: 'A consumption receipt exists for this handoff and could not be read, so whether it was already consumed is UNKNOWN. Do not inject it again: inspect .respawnpack/runtime/rollover/ for the receipt file and resolve it by hand rather than risking a second delivery of the same atomic action.',
  },

  // --- compaction ----------------------------------------------------------------------------------
  COMPACT_MECHANISM_UNAVAILABLE: {
    outcome: OUTCOME.CANNOT_DETERMINE, halts: true,
    recovery: 'This host profile has no documented mechanism to request compaction, so RespawnPack will not claim to have started one. Present the manual command to the operator (Claude Code and Codex interactive: /compact) and resume once the host reports the compaction completed.',
  },
  COMPACT_REQUEST_REFUSED: {
    outcome: OUTCOME.FAIL, halts: true,
    recovery: 'The host refused the compaction request (a PreCompact veto, or a rejected app-server call). The verified handoff is still on disk and unconsumed. Resolve whatever blocked the compaction, then request it again from a fresh checkpoint.',
  },
  COMPLETION_UNOBSERVED: {
    outcome: OUTCOME.CANNOT_DETERMINE, halts: true,
    recovery: 'No documented completion signal arrived before the observation window closed. This is NOT evidence that compaction failed and NOT evidence that it succeeded. Ask the host for its current state before doing anything else; never continue on the assumption that enough time has passed.',
  },
  COMPLETION_EVIDENCE_UNTYPED: {
    outcome: OUTCOME.CANNOT_DETERMINE, halts: false,
    recovery: 'The payload offered as completion evidence names no signal this taxonomy declares. Record the raw payload and extend core/lifecycle/evidence.js COMPLETION_SIGNALS with the host-documented name before treating it as proof.',
  },
  PROOF_SUBSTITUTION_ATTEMPT: {
    outcome: OUTCOME.FAIL, halts: false,
    recovery: 'A timeout, elapsed delay or process exit was offered as completion evidence. None of those observes a compaction. Keep waiting for the host signal, or stop with COMPLETION_UNOBSERVED — but do not record it as completion.',
  },
  COMPACT_NOOP_MISREAD: {
    outcome: OUTCOME.FAIL, halts: false,
    recovery: 'A no-op compaction result ("not enough messages to compact") was offered as a completed compaction. It is a typed non-failure and it advances no context cycle: return to ACTIVE in the SAME cycle with thresholds still latched.',
  },

  // --- identity ------------------------------------------------------------------------------------
  IDENTITY_MISMATCH: {
    outcome: OUTCOME.FAIL, halts: true,
    recovery: 'The conversation identity observed after compaction is not the one this rollover started from, so this is a REPLACEMENT session, not an in-place rollover. Do not report a rollover. The verified handoff is unconsumed on disk and can be transferred deliberately into the new conversation.',
  },
  IDENTITY_UNOBSERVABLE: {
    outcome: OUTCOME.CANNOT_DETERMINE, halts: true,
    recovery: 'The host did not expose a conversation identity after compaction, so sameness could not be checked. Report CANNOT_DETERMINE rather than claiming an in-place rollover; the identity check is empirical per rollover and is not satisfied by prior runs having agreed.',
  },

  // --- protocol and bookkeeping --------------------------------------------------------------------
  ILLEGAL_TRANSITION: {
    outcome: OUTCOME.FAIL, halts: false,
    recovery: 'The requested transition is not legal from the current state. Read the current state from the journal before acting; the rollover protocol has no shortcuts, and skipping one is how a compaction happens without a verified handoff.',
  },
  EVIDENCE_MISSING: {
    outcome: OUTCOME.FAIL, halts: false,
    recovery: 'The transition was attempted with no evidence of the kind it requires. Every transition in this machine is evidence-gated; supply the required record, or stop.',
  },
  EVIDENCE_MALFORMED: {
    outcome: OUTCOME.FAIL, halts: false,
    recovery: 'The evidence record is missing a field its kind requires — most often the verbatim host payload. Host field names change and several are undocumented, so the raw payload is what makes a record survivable; a typed wrapper alone is not evidence.',
  },
  CYCLE_UNESTABLISHED: {
    outcome: OUTCOME.CANNOT_DETERMINE, halts: true,
    recovery: 'The context-cycle record could not be persisted or read back, so which cycle this session is in is UNKNOWN. Thresholds cannot re-arm correctly without it. Fix the runtime directory before continuing; do not proceed on a guessed cycle.',
  },
  CYCLE_FORK: {
    outcome: OUTCOME.FAIL, halts: true,
    recovery: 'Two different cycle advances were recorded from the same cycle index, which means two processes drove one conversation. Stop both, decide which journal is authoritative, and restart the rollover from a fresh checkpoint.',
  },
  JOURNAL_UNWRITABLE: {
    outcome: OUTCOME.CANNOT_DETERMINE, halts: false,
    recovery: 'The transition could not be journaled, so it was NOT applied. A rollover that cannot record what it did cannot prove exactly-once delivery. Make .respawnpack/runtime/ writable and retry.',
  },
  JOURNAL_CORRUPT: {
    outcome: OUTCOME.CANNOT_DETERMINE, halts: true,
    recovery: 'The rollover journal has an unparseable record that is NOT its last line, so history cannot be replayed and duplicate suppression cannot be trusted. Preserve the file for inspection and start a new journal deliberately; do not continue against a partially readable one.',
  },
};

/** Build a failure result. Constructing one for an unknown code is a programming error, not a runtime state. */
function failure(code, detail) {
  const spec = FAILURES[code];
  if (!spec) throw new Error(`unknown rollover failure code: ${code}`);
  return { code, outcome: spec.outcome, halts: spec.halts, recovery: spec.recovery, detail: detail || null };
}

const isFailureCode = (code) => Object.prototype.hasOwnProperty.call(FAILURES, code);

/** Roll many outcomes into one. The worst wins; there is no averaging and no "mostly fine". */
function rollup(outcomes) {
  if (!outcomes.length) return OUTCOME.CANNOT_DETERMINE; // ran nothing ⇒ determined nothing
  return outcomes.reduce((worst, o) => (RANK[o] > RANK[worst] ? o : worst), OUTCOME.NOT_APPLICABLE);
}

/** Process exit code. CANNOT_DETERMINE gets its OWN code, for the reason kernel/lib/outcome.js states. */
const exitCodeFor = (outcome) => ({ PASS: 0, NOT_APPLICABLE: 0, FAIL: 1, CANNOT_DETERMINE: 2 }[outcome] ?? 1);

module.exports = { OUTCOME, RANK, FAILURES, failure, isFailureCode, rollup, exitCodeFor };

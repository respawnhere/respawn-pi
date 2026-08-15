/*
 * RespawnPack · adapters/pi/bridge/rollover-bridge.js — everything about a Pi rollover that can be
 * PROVEN without Pi installed.
 *
 * ⭐ THE SPLIT THIS FILE EXISTS TO CREATE. Pi extensions are TypeScript files that Pi itself loads and
 * runs; this repository has no TypeScript toolchain and must not grow one, so an invariant written inside
 * `package/extensions/respawnpack-rollover.ts` would be covered by NO test in this pack — it could only
 * be checked by reading it. So the extension is kept THIN (it calls Pi's API and forwards payloads) and
 * every decision lives HERE, in CommonJS that `node --test` drives directly: what a measurement means,
 * when a threshold fires, whether a compaction was observed, whether the conversation is the same one,
 * and whether a handoff may be injected. The `.ts` file has no branch that this file does not own.
 *
 * ⛔ THE THREE THINGS PI DOES NOT DO, AND THEREFORE THIS DOES (R5, verbatim in the digest):
 *   1. NO exactly-once / duplicate-turn guard. `pi.sendMessage(...)` will deliver the same message twice
 *      if it is called twice. The receipt in core/lifecycle/consumable.js is the guard — see `injectOnce`.
 *   2. NO competing-client protection on a session. That one is the RPC supervisor's lock
 *      (`../rpc-supervisor/session-lock.js`), not this module's, but it is why identity is re-verified
 *      here after every compaction rather than assumed.
 *   3. NO built-in sandbox. Nothing in this file may write outside the project's runtime directory, and
 *      unattended write mode stays off until `canaries/canary-isolation.js` proves an external one.
 *
 * ⛔ TWO PLACES WHERE THE HONEST ANSWER COST SOMETHING, recorded because both are load-bearing:
 *
 *   `ctx.getContextUsage()` RETURNS TOKENS AND NO PERCENTAGE. A percentage needs a denominator, and Pi's
 *   documented capacity rule is `contextWindow - reserveTokens` (reserveTokens defaults to 16384) — but
 *   `getContextUsage()` does not carry `contextWindow`. So `measureContext` below produces a usable
 *   percentage ONLY when a context window was actually supplied; with none, `usedPercent` is null and the
 *   whole rollover is CANNOT_DETERMINE rather than firing on a denominator this pack picked. When the
 *   window comes from operator configuration instead of the host, the measurement is still produced —
 *   it is genuinely useful — but it is stamped `capacityAssumed:true`, and `decide()` forces operator
 *   confirmation at the final threshold even though the numerator's confidence is HIGH.
 *
 *   THE DECLARED COMPLETION SIGNAL IS `pi_session_compact` FOR BOTH SURFACES. core/lifecycle/evidence.js
 *   declares exactly one Pi signal, and an evidence record naming anything else is refused as
 *   COMPLETION_EVIDENCE_UNTYPED — correctly, since that check is what stops an adapter inventing proof.
 *   The RPC surface's real signal is `compaction_end`, which is NOT the extension's `session_compact`, so
 *   every record carries `hostSignal` (the name the host actually used) beside the declared one, plus the
 *   verbatim payload. Extending core's COMPLETION_SIGNALS with an RPC-specific name is a CORE change and
 *   is therefore reported upward rather than made here.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { EMPTY_NOTE_FIELDS, projectPendingNoteFields } = require('./pending-note.js');

// core/ is the only cross-tree dependency, and it is read-only from here (core/index.js's banner).
// Resolved relative to THIS file so an installed copy finds its OWN core/, not a stray one.
const core = require(path.join(__dirname, '..', '..', '..', 'core', 'index.js'));

const HOST = core.evidence.HOSTS.PI; // 'pi'
const { KINDS } = core.evidence;

/** The one Pi completion signal core declares today. See the banner for why both surfaces map onto it. */
const DECLARED_COMPLETION_SIGNAL = 'pi_session_compact';

/** Pi's documented compaction defaults. Named constants so a reader can see WHICH number was assumed. */
const PI_DEFAULT_RESERVE_TOKENS = 16384;

/** The measurement source, as core/lifecycle/evidence.js declares it — its own comment names getContextUsage(). */
const MEASUREMENT_SOURCE = 'documented-api';

const nowISO = () => new Date().toISOString();
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// --- paths -------------------------------------------------------------------------------------------

const RUNTIME_ROLLOVER_DIR = (projectDir) => path.join(projectDir, core.cycle.RUNTIME_SUBDIR);
const conversationDir = (projectDir, sessionId) => core.machine.conversationDir(projectDir, HOST, sessionId);

// Project-level files, siblings of the per-conversation `pi-<sid>/` directories and never inside one.
// The leading underscore keeps them visually distinct from io.safeSegment-derived directory names, the
// same convention adapters/codex/hooks/_shared.js uses (credited: that file established it).
const extensionCanaryPath = (projectDir) => path.join(RUNTIME_ROLLOVER_DIR(projectDir), '_pi-extension-canary.json');
const pendingNotePath = (projectDir) => path.join(RUNTIME_ROLLOVER_DIR(projectDir), '_pi-pending-note.json');
const lastActivePath = (projectDir) => path.join(RUNTIME_ROLLOVER_DIR(projectDir), '_pi-last-active.json');
// Session-lifecycle marker — written on every exit path (clean session_shutdown, abnormal exit, and
// orphan detection on the next session's start). The dogfood report (`2026-08-08-dogfood-respawn-pi.md`)
// observed that rollover state.json remained "ACTIVE" for ~3 minutes after a session was killed mid-
// tool-call, with no session_end, halted, or pid-liveness signal — so the next session started cold with
// zero carry-over. This file is the carry-over. Same leading-underscore convention as the canary.
const lifecycleMarkerPath = (projectDir) => path.join(RUNTIME_ROLLOVER_DIR(projectDir), '_pi-session-lifecycle.json');

// Per-conversation files, siblings of that conversation's journal.jsonl / cycle.json / state.json.
const latestHandoffPointerPath = (dir) => path.join(dir, 'latest-handoff.json');
const pendingInjectionPath = (dir) => path.join(dir, 'pending-injection.json');
const eventLogPath = (dir) => path.join(dir, 'pi-event-log.jsonl');

// --- small shared helpers ----------------------------------------------------------------------------

/** Bounded verbatim payloads, mirroring core/lifecycle/evidence.js's withBoundedRaw for adapter-local files. */
function boundedRaw(raw) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const bytes = Buffer.byteLength(text || '', 'utf8');
  if (bytes <= core.evidence.MAX_RAW_BYTES) return { raw, rawBytes: bytes, rawTruncated: false };
  return { raw: String(text).slice(0, core.evidence.MAX_RAW_BYTES), rawBytes: bytes, rawTruncated: true };
}

/**
 * A stable event id for a host payload.
 *
 * ⭐ WHY IT IS A DIGEST AND NOT A COUNTER. Pi has no exactly-once guard, so the same `session_compact` or
 * `compaction_end` can be delivered twice — and the state machine's duplicate suppression is keyed on the
 * eventId, which therefore has to be a function of WHAT THE HOST SENT, not of how many times this process
 * has been called. The cycle id is folded in so that two genuinely different compactions can never
 * collide on one id even if their payloads were byte-identical: they are in different cycles by
 * construction, because a compaction is what advances a cycle.
 */
function eventIdFor(cycleId, label, payload) {
  return `${label}:${core.io.canonicalDigest({ cycleId, payload }).slice(0, 16)}`;
}

/** Append an observational line. Corroboration a later reviewer can read — never a source the machine folds. */
function appendEvent(dir, record) {
  try { return core.io.appendLine(eventLogPath(dir), JSON.stringify({ at: nowISO(), ...record })); }
  catch (e) { return { ok: false, detail: String(e && e.message) }; }
}

// --- machine ------------------------------------------------------------------------------------------

/** Open (or restore) the rollover machine for one Pi session. @returns {{ok:true, machine, dir, opened}|{ok:false, failure}} */
function openMachine({ projectDir, sessionId }) {
  if (!isStr(projectDir) || !isStr(sessionId)) {
    return { ok: false, failure: core.failures.failure('CYCLE_UNESTABLISHED', 'a Pi rollover needs a project directory and a session id; neither may be empty') };
  }
  const r = core.machine.open({ projectDir, host: HOST, conversationId: sessionId });
  if (!r.ok) return r;
  return { ok: true, machine: r.machine, dir: r.machine.dir, opened: r.opened };
}

// --- measurement --------------------------------------------------------------------------------------

/**
 * Turn `ctx.getContextUsage()` into a percentage, or refuse to.
 *
 * @param tokens         number  — `usage.tokens` from Pi. The ONLY number Pi gives.
 * @param contextWindow  number|null — the model's window. Pi does not return it from getContextUsage().
 * @param windowSource   'host-reported'|'operator-configured'|null — WHERE the window came from. Required
 *                       whenever a window is supplied; an unattributed denominator is refused.
 * @param reserveTokens  number|null — Pi's compaction reserve. Defaults to the documented 16384, and the
 *                       fact that it was defaulted is recorded rather than hidden.
 * @returns {{measurable:boolean, usedPercent:number|null, capacity:number|null, capacityAssumed:boolean,
 *            clamped:boolean, exactPercent:number|null, record:object|null, why:string}}
 */
function measureContext({ tokens, contextWindow = null, windowSource = null, reserveTokens = null, raw = null, mechanism = 'pi-getContextUsage' } = {}) {
  const reserve = isNum(reserveTokens) ? reserveTokens : PI_DEFAULT_RESERVE_TOKENS;
  const reserveDefaulted = !isNum(reserveTokens);
  const rawPayload = raw === null || raw === undefined ? { tokens, contextWindow, reserveTokens: reserve, mechanism } : raw;

  const base = {
    measurable: false, usedPercent: null, capacity: null, capacityAssumed: false,
    clamped: false, exactPercent: null, record: null, tokens: isNum(tokens) ? tokens : null,
    reserveTokens: reserve, reserveDefaulted, windowSource: windowSource || null,
  };

  if (!isNum(tokens) || tokens < 0) {
    return { ...base, why: 'Pi reported no usable token count — ctx.getContextUsage() returned nothing this bridge could read as usage.tokens. An unmeasured context is CANNOT_DETERMINE, never 0.' };
  }
  if (!isNum(contextWindow) || contextWindow <= 0) {
    return {
      ...base,
      why: 'Pi\'s getContextUsage() reports TOKENS ONLY and no context window was supplied, so there is no denominator. '
        + 'RespawnPack will not divide by a number it chose: configure the model\'s context window (see adapters/pi/README.md) '
        + 'or leave this CANNOT_DETERMINE.',
    };
  }
  if (windowSource !== 'host-reported' && windowSource !== 'operator-configured') {
    return {
      ...base,
      why: `a context window of ${contextWindow} was supplied with windowSource ${JSON.stringify(windowSource)}; a denominator whose provenance is unstated cannot carry a confidence, so it is refused`,
    };
  }

  const capacity = contextWindow - reserve;
  if (!(capacity > 0)) {
    return { ...base, capacity, why: `contextWindow ${contextWindow} minus reserveTokens ${reserve} is ${capacity} — a non-positive capacity measures nothing` };
  }

  const exactPercent = (tokens / capacity) * 100;
  // ⛔ CLAMPED, AND THE CLAMP IS REPORTED. core's measurementUsable guard refuses anything outside 0–100,
  // and Pi's own auto-compaction trigger is `contextTokens > contextWindow - reserveTokens` — i.e. over
  // 100% of this capacity is a state Pi expects to reach. Silently clamping would erase how far over it
  // went, so the true ratio travels in `exactPercent` and in the record.
  const clamped = exactPercent > 100;
  const usedPercent = clamped ? 100 : Math.round(exactPercent * 100) / 100;
  const capacityAssumed = windowSource === 'operator-configured';

  const record = core.evidence.make(KINDS.CONTEXT_MEASUREMENT, {
    source: MEASUREMENT_SOURCE,
    usedPercent,
    // Everything below is ADDITIONAL to what core requires: core validates `source` + `usedPercent`, and
    // these are what let a later reader recompute the number instead of trusting it.
    mechanism,
    tokens,
    contextWindow,
    reserveTokens: reserve,
    reserveTokensDefaulted: reserveDefaulted,
    capacity,
    capacityAssumed,
    windowSource,
    exactPercent,
    clamped,
    raw: rawPayload,
  });

  return {
    ...base,
    measurable: true, usedPercent, capacity, capacityAssumed, clamped, exactPercent, record,
    why: `${tokens} tokens of ${capacity} usable (${contextWindow} window − ${reserve} reserve${reserveDefaulted ? ', defaulted' : ''}) = ${usedPercent}%`
      + (capacityAssumed ? ' — the window is OPERATOR-CONFIGURED, not host-reported' : '')
      + (clamped ? `; the true ratio is ${exactPercent.toFixed(2)}% and was clamped to 100 for the state machine's 0–100 guard` : ''),
  };
}

/**
 * Decide what a measurement means for THIS cycle, and persist the latch.
 *
 * ⛔ AN UNREADABLE LATCH RECORD IS TREATED AS ABSENT, DELIBERATELY. core/policy/thresholds.js returns the
 * status rather than deciding, so the choice has to be visible in an adapter's code: re-arming costs one
 * redundant checkpoint (a handoff written twice), assuming-latched costs SILENCE at the final threshold.
 * This adapter pays the first price. `latchReadStatus` is returned so the caller can say so out loud.
 *
 * @returns {{fire:string[], crossed:string[], outcome, confidence, requiresOperatorConfirmation:boolean,
 *            rearmed:boolean, latchReadStatus:string, actions, why:string, latchWritten:boolean}}
 */
function decide({ dir, cycleId, measurement, thresholds: config = null }) {
  const norm = core.thresholds.normalize(config);
  if (!norm.ok) {
    return {
      fire: [], crossed: [], outcome: core.failures.OUTCOME.CANNOT_DETERMINE, confidence: null,
      requiresOperatorConfirmation: false, rearmed: false, latchReadStatus: 'NOT_READ', actions: [],
      latchWritten: false, why: `threshold configuration refused: ${norm.reason}`,
    };
  }

  const read = core.thresholds.readLatches(dir);
  const forCycle = core.thresholds.forCycle(read.record, cycleId);
  const evaluation = core.thresholds.evaluate({
    usedPercent: measurement.measurable ? measurement.usedPercent : null,
    source: MEASUREMENT_SOURCE,
    thresholds: norm.thresholds,
    record: forCycle.record,
  });

  // The capacity caveat is ADDED to core's own rule, never subtracted from it: core already forces
  // operator confirmation on a low-confidence final threshold; this ORs in "the denominator was ours".
  const requiresOperatorConfirmation = evaluation.requiresOperatorConfirmation
    || (evaluation.fire.includes('final') && Boolean(measurement.capacityAssumed));

  let latchWritten = false;
  if (evaluation.fire.length) {
    let record = forCycle.record;
    for (const name of evaluation.fire) record = core.thresholds.latch(record, name, { atPercent: measurement.usedPercent });
    latchWritten = core.thresholds.writeLatches(dir, record).ok;
  } else if (forCycle.rearmed) {
    latchWritten = core.thresholds.writeLatches(dir, forCycle.record).ok;
  }

  return {
    ...evaluation,
    requiresOperatorConfirmation,
    rearmed: forCycle.rearmed,
    previousCycleId: forCycle.previousCycleId || null,
    latchReadStatus: read.status,
    latchWritten,
    thresholds: norm.thresholds,
    why: measurement.capacityAssumed && evaluation.fire.includes('final')
      ? `${evaluation.why}; the context window was operator-configured, so the final threshold requires operator confirmation`
      : evaluation.why,
  };
}

/**
 * Should this settle boundary become a rollover?
 *
 * ⛔ THE POLICY LIVES HERE, NOT IN THE .ts. The extension is a forwarder; if this rule were written there
 * it would be covered by nothing. The rule itself is small and deliberately conservative: only the FINAL
 * threshold triggers a rollover, and a final threshold that core (or the assumed-capacity caveat) flagged
 * as needing operator confirmation does NOT auto-compact — it asks. Compacting on a number this pack
 * computed from a denominator it guessed is the one way an "automatic" rollover becomes a surprise.
 *
 * @returns {{go:boolean, ask:boolean, why:string}}
 */
function shouldRollover(decision) {
  const fire = (decision && decision.fire) || [];
  if (!fire.includes('final')) {
    return { go: false, ask: false, why: decision && decision.why ? decision.why : 'the final threshold has not fired in this cycle' };
  }
  if (decision.requiresOperatorConfirmation) {
    return { go: false, ask: true, why: `${decision.why} — the final threshold fired on a measurement that requires operator confirmation, so this bridge will report rather than compact` };
  }
  return { go: true, ask: false, why: decision.why };
}

// --- the rollover steps -------------------------------------------------------------------------------

/** ACTIVE → CHECKPOINT. */
function checkpoint(m, measurementRecord, eventId = null) {
  const id = eventId || eventIdFor(m.cycleId(), 'measure', { usedPercent: measurementRecord.usedPercent, at: measurementRecord.observedAt });
  return m.apply({ transition: 'checkpoint', eventId: id, evidence: [measurementRecord] });
}

/**
 * CHECKPOINT → CLOSEOUT, on `agent_settled`.
 *
 * ⭐ `agent_settled` IS THE BOUNDARY, AND `agent_end` IS NOT. Pi documents settled as the point where "no
 * automatic retry, compaction retry, or queued continuation remains" — `agent_end` can be followed by a
 * retry, so compacting there can cut a turn that Pi still intends to finish. This function refuses any
 * mechanism it does not recognise as a settle boundary, which is the only place that distinction can be
 * enforced for the extension (the `.ts` file simply passes the event name through).
 */
const SETTLE_MECHANISMS = Object.freeze(['agent_settled', 'pi-ctx-waitForIdle', 'operator']);

function closeout(m, { mechanism, raw, eventId = null } = {}) {
  if (!SETTLE_MECHANISMS.includes(mechanism)) {
    return {
      status: 'REFUSED',
      state: m.state(),
      failure: core.failures.failure('EVIDENCE_MALFORMED',
        `${JSON.stringify(mechanism)} is not a Pi safe boundary. Pi's settle boundary is "agent_settled" — "agent_end" is NOT sufficient, `
        + 'because an automatic retry, a compaction retry or a queued continuation may still follow it.'),
    };
  }
  const record = core.evidence.make(KINDS.SAFE_BOUNDARY, { mechanism, raw: raw === undefined || raw === null ? { mechanism } : raw });
  const id = eventId || eventIdFor(m.cycleId(), 'settle', record.raw);
  return m.apply({ transition: 'closeout', eventId: id, evidence: [record] });
}

/**
 * CLOSEOUT → ROLLOVER_PENDING → HANDOFF_VERIFIED. Writes the document, reads it back, compares digests,
 * and only then advances — the two transitions are applied together because a staged-but-unverified
 * handoff is a state no caller has any use for.
 *
 * @returns {{ok:boolean, handoffId, handoffPath, staged, verified, failure?}}
 */
function stageAndVerifyHandoff(m, fields = {}) {
  const dir = m.dir;
  const record = core.handoff.build({
    ...fields,
    identity: {
      host: HOST,
      conversationId: m.conversationId,
      // Pi names it `sessionId` — in get_state's answer and in the session file's version:3 header.
      conversationIdField: 'sessionId',
      ...(fields.identity || {}),
    },
    contextCycleId: fields.contextCycleId || m.cycleId(),
  });

  const w = core.handoff.writeVerified(dir, record);
  if (!w.ok) return { ok: false, handoffId: record.handoffId, handoffPath: null, staged: null, verified: null, failure: w.failure };

  const staged = m.apply({ transition: 'stage-handoff', eventId: eventIdFor(m.cycleId(), 'staged', { handoffId: record.handoffId }), evidence: [w.evidence.written] });
  if (staged.status !== 'APPLIED') return { ok: false, handoffId: record.handoffId, handoffPath: w.handoffPath, staged, verified: null, failure: staged.failure || null };

  const verified = m.apply({ transition: 'verify-handoff', eventId: eventIdFor(m.cycleId(), 'verified', { handoffId: record.handoffId }), evidence: [w.evidence.readback] });
  if (verified.status !== 'APPLIED') return { ok: false, handoffId: record.handoffId, handoffPath: w.handoffPath, staged, verified, failure: verified.failure || null };

  // The pointer is how a later process discovers WHICH handoff to consume: ids are random, so without it
  // a rehydrating session would have to guess. Best-effort: its absence degrades rehydration, never the
  // rollover's correctness, because the machine's own journal still names the handoff.
  core.io.writeAtomicJSON(latestHandoffPointerPath(dir), {
    schemaVersion: '1.0.0', kind: 'pi-latest-handoff-pointer',
    handoffId: record.handoffId, cycleIdAtWrite: m.cycleId(), writtenAt: nowISO(),
  });

  return { ok: true, handoffId: record.handoffId, handoffPath: w.handoffPath, staged, verified, document: record };
}

/** HANDOFF_VERIFIED → COMPACTING. `mechanism` names the documented API actually called. */
function requestCompact(m, { mechanism = 'pi-ctx-compact', raw = null, eventId = null } = {}) {
  const record = core.evidence.make(KINDS.COMPACT_REQUESTED, { mechanism, raw: raw === null || raw === undefined ? { mechanism } : raw });
  const id = eventId || eventIdFor(m.cycleId(), 'request', { mechanism, at: record.observedAt });
  return m.apply({ transition: 'request-compact', eventId: id, evidence: [record] });
}

/**
 * Read a `session_compact` payload (the EXTENSION surface) without deciding for the caller.
 * Documented shape: `{compactionEntry, fromExtension, reason: manual|threshold|overflow, willRetry}`.
 */
function readSessionCompact(payload) {
  const v = payload && typeof payload === 'object' ? payload : {};
  const willRetryPresent = Object.prototype.hasOwnProperty.call(v, 'willRetry');
  const willRetry = v.willRetry === true;
  return {
    compactionEntry: v.compactionEntry === undefined ? null : v.compactionEntry,
    hasCompactionEntry: v.compactionEntry !== undefined && v.compactionEntry !== null,
    fromExtension: v.fromExtension === true,
    fromExtensionPresent: Object.prototype.hasOwnProperty.call(v, 'fromExtension'),
    reason: isStr(v.reason) ? v.reason : null,
    willRetry, willRetryPresent,
    // A compaction Pi intends to retry has not settled, and a compaction that appended no entry has not
    // demonstrably done anything. Either one means: keep waiting, do not advance the cycle.
    settled: !willRetry,
    why: willRetry
      ? 'session_compact reported willRetry:true — Pi intends another compaction attempt, so this is not the settled end of one'
      : 'session_compact reported no pending retry',
  };
}

/**
 * COMPACTING → REHYDRATING, on an OBSERVED host completion.
 *
 * @param signals  string[] — the host signal names that actually arrived, e.g. ['compact-response-success',
 *                 'compaction_end'] for the RPC surface or ['session_compact'] for the extension.
 * @param hostSignal string — the primary host name, recorded beside the declared one.
 * @returns {{status, dualSignal:boolean, standing:'FULL'|'PARTIAL', ...}}
 */
function observeCompletion(m, { signals = [], hostSignal = null, raw = null, eventId = null, note = null } = {}) {
  const arrived = Array.isArray(signals) ? signals.filter(isStr) : [];
  if (!arrived.length) {
    return {
      status: 'REFUSED', state: m.state(), dualSignal: false, standing: 'NONE',
      failure: core.failures.failure('COMPLETION_UNOBSERVED', 'observeCompletion was called with no host signal at all — nothing was observed, so nothing is proven'),
    };
  }
  if (raw === null || raw === undefined) {
    return {
      status: 'REFUSED', state: m.state(), dualSignal: false, standing: 'NONE',
      failure: core.failures.failure('EVIDENCE_MALFORMED', 'a completion claim with no verbatim host payload cannot be re-checked later; core refuses it and so does this'),
    };
  }

  const dualSignal = arrived.length > 1;
  const record = core.evidence.make(KINDS.COMPACT_COMPLETED, {
    // The declared name core/ knows. The name the host ACTUALLY used travels beside it — see the banner.
    signal: DECLARED_COMPLETION_SIGNAL,
    hostSignal: hostSignal || arrived[0],
    hostSignalsArrived: arrived,
    dualSignal,
    note,
    raw,
  });
  const id = eventId || eventIdFor(m.cycleId(), 'complete', raw);
  const applied = m.apply({ transition: 'observe-completion', eventId: id, evidence: [record] });
  return {
    ...applied,
    dualSignal,
    // ⭐ THE STANDING IS NOT A SCORE, IT IS A CAPABILITY CLAIM. Both signals arriving is what a SUPPORTED
    // declaration rests on; one alone is real evidence and a named limitation, which is exactly the
    // difference between SUPPORTED and SUPPORTED_WITH_LIMITATIONS in core/policy/capabilities.js.
    standing: dualSignal ? 'FULL' : 'PARTIAL',
    hostSignalsArrived: arrived,
    record,
  };
}

/** COMPACTING → ACTIVE without a rollover: the host declined to compact. Advances NO cycle; latches survive. */
function noopReturn(m, { hostResult, expectedId, observedId, raw = null, eventId = null } = {}) {
  const noop = core.evidence.make(KINDS.COMPACT_NOOP, { hostResult: isStr(hostResult) ? hostResult : 'the host reported it did not compact', raw: raw === null || raw === undefined ? { hostResult } : raw });
  const identity = core.evidence.make(KINDS.IDENTITY_VERIFICATION, {
    expectedId, observedId: observedId === undefined ? null : observedId,
    equal: observedId === null || observedId === undefined ? null : observedId === expectedId,
    idField: 'sessionId', raw: raw === null || raw === undefined ? { hostResult } : raw,
  });
  const id = eventId || eventIdFor(m.cycleId(), 'noop', { hostResult, observedId });
  return m.apply({ transition: 'noop-return', eventId: id, evidence: [noop, identity] });
}

/**
 * REHYDRATING → ACTIVE. The identity check is EMPIRICAL PER ROLLOVER.
 *
 * ⛔ AND `observedId` MUST COME FROM A FRESH READ. Pi's session documentation shows a compaction appending
 * a CompactionEntry to the same file, and nowhere states that the id never changes; the R5 check also
 * flagged the terminology trap where "fresh routing session IDs" in the compaction docs means a PROVIDER
 * CACHE concept, not a Pi session id. So this compares an id read AFTER the compaction (get_state on the
 * RPC surface, ctx on the extension surface) against the one captured before it — passing the same
 * variable in twice would make the check tautological and it would pass forever.
 */
function verifyIdentity(m, { expectedId, observedId, raw = null, eventId = null, idField = 'sessionId' } = {}) {
  const record = core.evidence.make(KINDS.IDENTITY_VERIFICATION, {
    expectedId,
    observedId: observedId === undefined ? null : observedId,
    equal: observedId === null || observedId === undefined ? null : observedId === expectedId,
    idField,
    raw: raw === null || raw === undefined ? { expectedId, observedId, idField } : raw,
  });
  const id = eventId || eventIdFor(m.cycleId(), 'identity', { expectedId, observedId });
  return m.apply({ transition: 'verify-identity', eventId: id, evidence: [record] });
}

// --- injection, exactly once ---------------------------------------------------------------------------

/**
 * Claim the handoff and render the text to inject — or report that someone already did.
 *
 * ⛔ THIS IS THE GUARD PI DOES NOT HAVE. `pi.sendMessage(..., {triggerTurn:true})` called twice delivers
 * twice, and a `before_agent_start` handler can legitimately run more than once (a retry, a second
 * client, a supervisor and an extension both wired). The `wx` receipt in core/lifecycle/consumable.js
 * decides ONCE, across processes, and every later caller gets a pointer to the first consumption rather
 * than a boolean — so a duplicate delivery becomes an explained non-delivery.
 *
 * @returns {{status:'CONSUMED'|'ALREADY_CONSUMED'|'REFUSED'|'CANNOT_DETERMINE', text?, handoff?, failure?}}
 */
function injectOnce({ dir, handoffId, consumerId, machine = null }) {
  const r = core.handoff.consume(dir, handoffId, { consumerId });
  if (machine) {
    machine.journalConsumption({ handoffId, status: r.status, consumerId, receiptPath: r.receiptPath || null });
  }
  if (r.status !== 'CONSUMED') return r;
  return { ...r, text: renderInjection(r.handoff) };
}

/**
 * The text a rehydrated Pi turn receives.
 *
 * ⛔ WHAT IT REFUSES TO SAY. It does not claim the conversation is the same one unless an identity check
 * actually passed (the caller passes `identityConfirmed`), and it never inlines a candidate memory's
 * text — core/state/handoff.js carries IDS ONLY there precisely so an unverified lead cannot arrive
 * looking exactly like the verified facts printed beside it.
 */
function renderInjection(doc, { identityConfirmed = null } = {}) {
  if (!doc || typeof doc !== 'object') return '';
  const lines = [];
  lines.push(`RespawnPack: rehydrated handoff ${doc.handoffId} (context cycle ${doc.contextCycleId}).`);
  lines.push(identityConfirmed === true
    ? 'Same conversation confirmed: the session id observed after compaction matched the one recorded before it.'
    : 'Conversation identity was NOT cross-checked at injection time — treat continuity as unverified until something checks it.');
  lines.push('');
  lines.push(`EXACT NEXT ACTION: ${doc.exactNextAction || '(none was recorded — re-derive it from the atomic action and the git facts below before doing anything else)'}`);
  if (doc.atomicActionId) lines.push(`Atomic action in flight: ${doc.atomicActionId}`);
  lines.push('');
  lines.push(`git HEAD at handoff: ${doc.git && doc.git.head ? doc.git.head : '(unknown)'}`);
  const files = (doc.git && doc.git.uncommittedFiles) || [];
  lines.push(files.length ? `Uncommitted (${files.length}${doc.git.uncommittedTruncated ? ', TRUNCATED' : ''}): ${files.join(', ')}` : 'Uncommitted: none recorded');
  if ((doc.userConstraints || []).length) {
    lines.push('');
    lines.push('Constraints the user stated:');
    for (const c of doc.userConstraints) lines.push(`  - ${c}`);
  }
  if ((doc.unresolvedQuestions || []).length) {
    lines.push('');
    lines.push('Unresolved — do NOT assume these were answered:');
    for (const q of doc.unresolvedQuestions) lines.push(`  - ${q}`);
  }
  if ((doc.candidateMemories || []).length) {
    lines.push('');
    lines.push(`Candidate memories (IDS ONLY — unverified leads, not facts): ${doc.candidateMemories.join(', ')}`);
  }
  return lines.join('\n');
}

/** Record which handoff a rehydrating turn should look for. Best-effort; the journal remains authoritative. */
function setPendingInjection(dir, { handoffId, cycleId, identityConfirmed }) {
  return core.io.writeAtomicJSON(pendingInjectionPath(dir), {
    schemaVersion: '1.0.0', kind: 'pi-pending-injection',
    handoffId, cycleId, identityConfirmed: identityConfirmed === true, writtenAt: nowISO(),
  });
}

function readPendingInjection(dir) {
  const r = core.io.readJSONClassified(pendingInjectionPath(dir));
  if (r.status !== 'OK' || !r.doc || !isStr(r.doc.handoffId)) return null;
  return r.doc;
}

function readLatestHandoffPointer(dir) {
  const r = core.io.readJSONClassified(latestHandoffPointerPath(dir));
  if (r.status !== 'OK' || !r.doc || !isStr(r.doc.handoffId)) return null;
  return r.doc;
}

// --- the activation canary -----------------------------------------------------------------------------

/**
 * THE activation evidence for the extension surface.
 *
 * ⛔ INSTALLING A .ts FILE IS NOT ACTIVATION. Project extensions are trust-gated. Interactive Pi can save
 * trust and an intentional non-interactive run can use `--approve`; neither is evidence that the handler
 * actually fired. This marker is written by the extension itself the first time
 * Pi actually calls it; `profile.js` reads it and downgrades every canary-requiring capability without it.
 */
function refreshExtensionCanary(projectDir, { event, sessionId, piVersion = null, raw = null, nonce = null } = {}) {
  const file = extensionCanaryPath(projectDir);
  const prior = core.io.readJSONClassified(file);
  const firstSeenAt = (prior.status === 'OK' && prior.doc && isStr(prior.doc.firstSeenAt)) ? prior.doc.firstSeenAt : nowISO();
  const fireCount = (prior.status === 'OK' && prior.doc && Number.isFinite(prior.doc.fireCount)) ? prior.doc.fireCount + 1 : 1;
  const bounded = boundedRaw(raw === undefined ? null : raw);
  const doc = {
    schemaVersion: '1.0.0',
    kind: 'pi-extension-activation-canary',
    event: event || null,
    at: nowISO(),
    sessionId: sessionId || null,
    piVersion,
    ran: true,
    nonce: typeof nonce === 'string' && nonce ? nonce : null,
    firstSeenAt,
    fireCount,
    ...bounded,
  };
  try { return core.io.writeAtomicJSON(file, doc); } catch (e) { return { ok: false, detail: String(e && e.message) }; }
}

function readExtensionCanary(projectDir) {
  const r = core.io.readJSONClassified(extensionCanaryPath(projectDir));
  if (r.status !== 'OK' || !r.doc) return { present: false, doc: null, status: r.status, detail: r.detail };
  return { present: true, doc: r.doc, status: 'OK', detail: null };
}

// -------------------------------------------------------------------------------------------------
// session-lifecycle marker
//
// ⛔ WHY THIS EXISTS. The dogfood (`.scratch/orchestration/2026-08-08-dogfood-respawn-pi.md`,
// §4.1 / §4.4 / §4.6) observed: rollover state.json stayed `"state":"ACTIVE"`, `verifiedHandoff: null`,
// canary `fireCount` climbing, with NO `session_end`, `halted`, or pid-liveness signal after a session
// was killed mid-tool-call. The next session had zero carry-over and was indistinguishable from a
// fresh boot. This marker is the carry-over — written on every exit path so the next session can see
// "the previous one ended normally / ended on signal-N / ended mid-event X at ts Y."
//
// Three writers:
//   1. writeSessionEndMarker  — clean exit (session_shutdown, or a happy agent_end the host converted)
//   2. writeHaltedMarker     — abnormal exit (process.on('exit') on a non-zero code, SIGTERM/SIGINT)
//   3. detectOrphanSession   — on session_start, reads the previous session's state.json; if it still
//                             says ACTIVE and the recorded pid is dead, writes a halted marker
//                             retroactively and returns the orphan's data for the new session to
//                             surface (e.g. "previous session died mid-event X at ts Y").
//
// All three write the SAME marker file (one per project), so the next session always reads a single
// file and gets the most recent lifecycle event. The marker is a CARRY-OVER HINT, not a verified
// handoff — its `kind` field names what kind of exit happened, and a `verifiedHandoff: null` companion
// field tells the next session there is no v2 handoff to consume.
// -------------------------------------------------------------------------------------------------

/** Last-event tracking, threaded through the rollover lifecycle. Pure read/write of the lifecycle file. */
function readLifecycleMarker(projectDir) {
  const r = core.io.readJSONClassified(lifecycleMarkerPath(projectDir));
  if (r.status !== 'OK' || !r.doc) return { present: false, doc: null, status: r.status, detail: r.detail };
  return { present: true, doc: r.doc, status: 'OK', detail: null };
}

/** Internal: write the marker. Both clean and abnormal writers call this; the `kind` field differs. */
function _writeLifecycleMarker(projectDir, fields) {
  const prior = readLifecycleMarker(projectDir);
  const doc = {
    schemaVersion: '1.0.0',
    kind: 'pi-session-lifecycle',
    at: fields.at || nowISO(),
    sessionId: fields.sessionId || null,
    outcome: fields.outcome || null, // 'session_end' | 'halted'
    reason: fields.reason || null,    // human-readable, when outcome === 'halted'
    lastEvent: fields.lastEvent || null, // {kind, at} — the last event the extension processed before exit
    pid: fields.pid || null,          // the exiting process's pid, recorded for orphan-detection's liveness check
    previousOutcome: prior.status === 'OK' && prior.doc ? prior.doc.outcome : null,
    verifiedHandoff: null,           // a v2 handoff is a separate file; this marker never lies about having one
  };
  try { return { ok: !!core.io.writeAtomicJSON(lifecycleMarkerPath(projectDir), doc).ok, doc };
  } catch (e) { return { ok: false, doc: null, detail: String(e && e.message) }; }
}

/**
 * Clean exit. Called from the rollover extension's `session_shutdown` handler AND, in the same-process
 * fallback, from a `process.on('exit')` with code 0.
 */
function writeSessionEndMarker(projectDir, { sessionId, lastEvent } = {}) {
  return _writeLifecycleMarker(projectDir, { outcome: 'session_end', sessionId, lastEvent });
}

/**
 * Abnormal exit. Called from a SIGTERM/SIGINT handler or a `process.on('exit')` with non-zero code. The
 * `reason` field is REQUIRED and should name what the extension knows: the signal, the non-zero exit
 * code, or "abnormal: <last event seen>".
 */
function writeHaltedMarker(projectDir, { sessionId, reason, lastEvent } = {}) {
  if (!reason) throw new Error('writeHaltedMarker requires a reason');
  return _writeLifecycleMarker(projectDir, { outcome: 'halted', sessionId, reason, lastEvent });
}

/**
 * Orphan detection. Called at session_start. Reads the most recent lifecycle marker AND, if its pid is
 * dead AND its outcome is not session_end, returns the orphan's data so the new session can surface it.
 *
 * ⛔ PID LIVENESS IS OS-DEPENDENT. `process.kill(pid, 0)` is the cross-platform probe: it sends no signal
 * and throws ESRCH if the pid is dead, EPERM if alive-but-not-ours. We treat EPERM as "alive" because
 * the kernel is telling us the pid EXISTS even if we don't own it (which can happen with reused pids
 * from a different uid — we record `error: 'EPERM'` on the returned object so the caller can downgrade
 * if they care).
 */
function detectOrphanSession(projectDir) {
  const r = readLifecycleMarker(projectDir);
  if (!r.present) return { orphan: false };
  const doc = r.doc || {};
  if (doc.outcome === 'session_end') return { orphan: false, lastLifecycle: doc };
  if (!doc.pid) {
    // Pre-lifecycle-marker installs (older versions) have no pid. Don't claim orphan status; just surface
    // what we know.
    return { orphan: 'unknown', lastLifecycle: doc, reason: 'lifecycle marker pre-dates pid recording — cannot tell live from dead' };
  }
  let alive = false, probeError = null;
  try { process.kill(doc.pid, 0); alive = true; }
  catch (e) { probeError = String((e && e.code) || e && e.message || e); }
  if (alive) return { orphan: false, lastLifecycle: doc };
  // ⛔ PID is dead. Record this as the canonical halted event retroactively — the writer is the same
  // one abnormal exits use, so the next session sees one shape of "this is what happened."
  const haltReason = `orphan detected at ${nowISO()}: previous session pid ${doc.pid} is dead without a session_end marker`;
  const written = writeHaltedMarker(projectDir, { sessionId: doc.sessionId, reason: haltReason, lastEvent: doc.lastEvent });
  return {
    orphan: true,
    lastLifecycle: { ...doc, retroactivelyHalted: true, haltReason, haltedWrite: written },
  };
}

/*
 * The other canaries leave markers too, for one reason: `profile.js` must be able to answer "is this
 * capability active" WITHOUT running a compaction or a container. A canary that only printed to a
 * terminal would make the capability matrix depend on somebody remembering what they saw.
 *
 * ⛔ ONLY A PASS IS EVER RECORDED. A CANNOT_DETERMINE marker would be read by the next reader as "a
 * canary ran here", and the difference between "ran and could not tell" and "never ran" is not something
 * a downgrade rule should have to disentangle — absence is the honest representation of both.
 */
const canaryMarkerPath = (projectDir, name) => path.join(RUNTIME_ROLLOVER_DIR(projectDir), `_pi-${core.io.safeSegment(name)}-canary.json`);

function writeCanaryMarker(projectDir, name, result) {
  if (!result || result.outcome !== core.failures.OUTCOME.PASS) return { ok: false, detail: 'only a PASS is recorded as a canary marker' };
  const bounded = boundedRaw(result.raw === undefined ? null : result.raw);
  try {
    return core.io.writeAtomicJSON(canaryMarkerPath(projectDir, name), {
      schemaVersion: '1.0.0',
      kind: `pi-${name}-canary`,
      at: result.observedAt || nowISO(),
      ran: true,
      outcome: result.outcome,
      proves: result.proves || null,
      detail: result.detail || null,
      ...bounded,
    });
  } catch (e) { return { ok: false, detail: String(e && e.message) }; }
}

function readCanaryMarker(projectDir, name) {
  const r = core.io.readJSONClassified(canaryMarkerPath(projectDir, name));
  if (r.status !== 'OK' || !r.doc) return { present: false, doc: null, status: r.status, detail: r.detail };
  return { present: true, doc: r.doc, status: 'OK', detail: null };
}

// --- the operator's savepoint note ----------------------------------------------------------------------

/*
 * The same shape adapters/codex/hooks/_shared.js established (credited): a project-scoped JSON note the
 * agent writes before a compaction, sanitised against the handoff schema's real constraints, and only
 * cleared once a handoff carrying it was written AND read back — never on read, because a failed write is
 * exactly when the note still needs to exist.
 */
function candidateTreeForProject(projectRoot) {
  try {
    const stat = fs.lstatSync(projectRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
  } catch { return null; }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-bridge-index-'));
  fs.chmodSync(tempDir, 0o700);
  const objectDir = path.join(tempDir, 'objects');
  fs.mkdirSync(objectDir, { mode: 0o700 });
  try {
    const objects = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'objects'], { cwd: projectRoot, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index'), GIT_OBJECT_DIRECTORY: objectDir, GIT_ALTERNATE_OBJECT_DIRECTORIES: objects };
    const options = { cwd: projectRoot, env, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] };
    execFileSync('git', ['read-tree', 'HEAD'], options);
    execFileSync('git', ['add', '-A', '--', '.'], options);
    execFileSync('git', ['reset', '-q', 'HEAD', '--', 'docs/derived/STATE.json', '.respawnpack'], options);
    return execFileSync('git', ['write-tree'], options).trim();
  } catch { return null; }
  finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
}

function candidateTreeForPackage() {
  return candidateTreeForProject(path.join(__dirname, '..', '..', '..'));
}

function pendingNoteAuthorityErrors(doc, projectRoot = path.join(__dirname, '..', '..', '..')) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['note must be an object'];
  if (doc.schemaVersion !== '2.0.0') errors.push('schemaVersion');
  if (doc.kind !== 'respawn-pi-pending-note') errors.push('kind');
  if (!Number.isFinite(Date.parse(doc.at))) errors.push('at');
  const working = doc.workingTree;
  if (!working || typeof working !== 'object') errors.push('workingTree');
  else {
    if (working.sourceRevision !== gitHead(projectRoot)) errors.push('sourceRevision');
    const tree = candidateTreeForProject(projectRoot);
    if (!tree || working.snapshotAlgorithm !== 'git-tree' || working.candidateTree !== tree) errors.push('candidateTree');
  }
  return errors;
}

function peekPendingNote(projectDir) {
  const r = core.io.readJSONClassified(pendingNotePath(projectDir));
  if (r.status !== 'OK' || !r.doc) return { present: false, fields: { ...EMPTY_NOTE_FIELDS }, dropped: [], invalid: [] };
  const doc = r.doc;
  const authorityErrors = pendingNoteAuthorityErrors(doc, projectDir);
  if (authorityErrors.length) return { present: false, fields: { ...EMPTY_NOTE_FIELDS }, dropped: [], invalid: authorityErrors };
  const projected = projectPendingNoteFields(doc);
  return { present: true, ...projected, invalid: [] };
}

function clearPendingNote(projectDir) {
  try { fs.unlinkSync(pendingNotePath(projectDir)); } catch { /* already gone, or unremovable; never fatal */ }
}

// --- git facts, best-effort ------------------------------------------------------------------------------

function gitHead(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || null;
  } catch { return null; }
}

/*
 * Ported from hooks/precompact-ledger-nudge.js's `unmergedPaths()` (credited there to the W6c repo-state
 * preservation battery): a second, independent, cheap source for "which paths are unmerged RIGHT NOW" — a
 * plain point-in-time fact that needs no baseline and is always safe to fold into gitUncommittedFiles's
 * result. See the fold-in comment inside gitUncommittedFiles below for why this closes a real blind spot
 * in precompact-ledger-nudge.js's caller but is deliberate defense-in-depth here rather than a blind-spot
 * closure — `git status --porcelain` (this file's own source) never had that blind spot to begin with.
 */
function unmergedPaths(cwd) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], {
      cwd, encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))].sort();
  } catch { return []; }
}

function gitUncommittedFiles(cwd) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd, encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    /*
     * ⛔ PORTED FROM adapters/codex/hooks/_shared.js's `gitUncommittedFiles`, credited: until this fix,
     * this function was the BYTE-FOR-BYTE IDENTICAL copy-pasted three-line parse the W6c repo-state
     * preservation battery found three bugs in — none reachable by THIS file's own suite either, and for
     * the identical reason: no fixture in pi-adapter.test.mjs had ever `git init`'d a real repository
     * before the W6d battery that ported this fix.
     *   (1) `.map((l) => l.trim())` ran BEFORE `.slice(3)`. Porcelain's status prefix is a fixed two
     *       columns (X, Y) plus one separating space, and for the single most common case — an unstaged
     *       modification — X is a literal space (" M path"). Trimming first eats that leading space, so
     *       the subsequent `.slice(3)` then cuts three characters off a line with only TWO of prefix
     *       left, silently dropping the path's first character (" M tracked.txt" -> "racked.txt").
     *   (2) no exclusion for this pack's OWN runtime directory. `core.machine.open()` can mint
     *       `.respawnpack/runtime/rollover/pi-<sid>/` for the first time in a repo that has not yet
     *       gitignored it — this adapter's package/ install, like the Codex adapter's, goes through no
     *       install.js .gitignore self-heal — so the handoff could name its own bookkeeping directory as
     *       if it were the user's uncommitted work.
     *   (3) no `-uall`. Porcelain's default untracked mode collapses a brand-new untracked DIRECTORY to
     *       one line naming the directory, not its contents (`?? src/`, not `?? src/scratch.ts`).
     * Fixed identically to `_shared.js`: never trim before the fixed-width slice, request the uncollapsed
     * (`-uall`) listing, and drop this pack's own tree. No rename-specific parsing is added either — the
     * audited fix in `_shared.js` does not split "R  old -> new" into two paths, so this does not invent
     * that behavior: an `R  ` line still slices to the single string "old -> new", matching the reference.
     */
    const notOwnRuntime = (p) => p !== '.respawnpack' && !p.startsWith('.respawnpack/') && !p.startsWith('.respawnpack\\');
    const files = out.split(/\r?\n/)
      .filter((l) => l.length > 3)
      .map((l) => l.slice(3).trim())
      .filter(Boolean)
      .filter(notOwnRuntime);
    /*
     * ⛔ MERGE-CONFLICT FOLD-IN, credited to hooks/precompact-ledger-nudge.js's `unmergedPaths()` (also a
     * W6c finding). THAT fix closed a real blind spot specific to `_runtime.js`'s treeState(), which
     * parses `git diff`'s per-file `diff --git` headers and never sees a conflicted path's COMBINED
     * `diff --cc` format — a mid-conflict repo made treeState() report nothing for that path at all. THIS
     * function's source is `git status --porcelain`, which already reports an unmerged path directly via
     * its own two-letter code (`UU`, `AA`, `DD`, `AU`, `UA`, `UD`, `DU` — all caught by the generic slice
     * above with no special-casing needed), so this function was never blind to a conflict the way
     * treeState() was. The fold-in below is therefore deliberate defense-in-depth, not a blind-spot
     * closure: a second, independent source for "which paths are unmerged right now", kept for parity
     * with the rest of the ported fix family and as a backstop if a future git version or status flag
     * ever narrowed porcelain's own conflict reporting. Passed through the SAME `.respawnpack` exclusion
     * as `files` above — precompact-ledger-nudge.js's fold does not need that (Claude's standard install
     * already gitignores `.respawnpack/`), but this adapter has no such self-heal, per (2) above.
     */
    return [...new Set([...files, ...unmergedPaths(cwd).filter(notOwnRuntime)])].sort();
  } catch { return []; }
}

/** Assemble the handoff fields from the operator's note plus whatever git can be read. */
function handoffFieldsFor(projectDir, { note = null, extra = null } = {}) {
  const n = note || peekPendingNote(projectDir);
  return {
    exactNextAction: n.fields.exactNextAction,
    atomicActionId: n.fields.atomicActionId,
    userConstraints: n.fields.userConstraints,
    unresolvedQuestions: n.fields.unresolvedQuestions,
    candidateMemories: n.fields.candidateMemories,
    verificationEvidence: n.fields.verificationEvidence,
    git: {
      head: gitHead(projectDir),
      uncommittedFiles: gitUncommittedFiles(projectDir),
      // ⛔ ALREADY THE W6c-CONSERVATIVE ANSWER, UNCONDITIONALLY — credited to the same battery.
      // hooks/precompact-ledger-nudge.js's fix downgrades sessionDelta to CANNOT_DETERMINE ONLY when a
      // conflict is present, because that hook can otherwise report a real CHANGED/UNCHANGED verdict from
      // its baseline/treeState layer. This bridge has no baseline layer at all — no SessionStart-time
      // snapshot exists anywhere in adapters/pi/ to diff against — so sessionDelta is CANNOT_DETERMINE on
      // EVERY cycle, conflict or not; this literal also matches core/state/handoff.js's own build()
      // default for an unset git.sessionDelta. That is a strict subset of the W6c downgrade rule, not an
      // exemption from it: the conservative value is not waiting for a conflict to appear before it is
      // chosen, so no additional conflict-detection logic belongs here.
      sessionDelta: { status: 'CANNOT_DETERMINE', files: [], headMoved: false },
    },
    ...(extra || {}),
  };
}

module.exports = {
  HOST, DECLARED_COMPLETION_SIGNAL, PI_DEFAULT_RESERVE_TOKENS, MEASUREMENT_SOURCE, SETTLE_MECHANISMS,
  core,
  RUNTIME_ROLLOVER_DIR, conversationDir,
  extensionCanaryPath, pendingNotePath, lastActivePath,
  lifecycleMarkerPath,
  latestHandoffPointerPath, pendingInjectionPath, eventLogPath,
  boundedRaw, eventIdFor, appendEvent,
  openMachine, measureContext, decide, shouldRollover,
  checkpoint, closeout, stageAndVerifyHandoff, requestCompact,
  readSessionCompact, observeCompletion, noopReturn, verifyIdentity,
  injectOnce, renderInjection, setPendingInjection, readPendingInjection, readLatestHandoffPointer,
  refreshExtensionCanary, readExtensionCanary,
  readLifecycleMarker, writeSessionEndMarker, writeHaltedMarker, detectOrphanSession,
  canaryMarkerPath, writeCanaryMarker, readCanaryMarker,
  peekPendingNote, clearPendingNote, handoffFieldsFor, candidateTreeForPackage, candidateTreeForProject, pendingNoteAuthorityErrors,
  gitHead, gitUncommittedFiles, unmergedPaths,
};

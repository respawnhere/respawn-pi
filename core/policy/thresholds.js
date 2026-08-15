/*
 * RespawnPack · core/policy/thresholds.js — the percentage thresholds, and the re-arm contract that is
 * the whole reason this module exists.
 *
 * ⛔ THE DEFECT. v0.2 latched each threshold PER SESSION ID. A compacted conversation keeps its session
 * id — that is the definition of an in-place rollover — so every threshold fired exactly once in the
 * life of a conversation and then went silent for every cycle after it. The session that most needed a
 * checkpoint, the third one, got nothing.
 *
 * ⭐ THE CONTRACT. Latches are keyed on the CONTEXT CYCLE ID, which carries the cycle index and its
 * nonce. A new cycle is a new latch record and every threshold is armed again; the session id is not
 * consulted and cannot be, because it does not change across the event that must re-arm them.
 *
 *   forCycle(record, cycleId)  →  the same record when the cycle is unchanged
 *                              →  an EMPTY record, flagged `rearmed`, when it is not
 *
 * ⛔ AND A NO-OP COMPACTION MUST NOT RE-ARM. When a host declines to compact it advances no cycle, so
 * the cycleId is unchanged, so the latches survive — which is what stops a checkpoint firing in a loop
 * against a context that never got smaller. That behaviour is a consequence of the keying rather than a
 * special case, which is why the keying is the contract.
 *
 * ⛔ AN UNMEASURED CONTEXT NEVER FIRES AND IS NEVER ZERO. `usedPercent: null` is CANNOT_DETERMINE. A
 * missing measurement read as 0% is silence at 85%, and read as 100% is a checkpoint every turn.
 *
 * The functions are PURE. Persistence is two thin calls at the bottom, so the Claude adapter (W2) wires
 * them to the runtime directory without this module knowing where that is.
 */
const path = require('path');
const io = require('../_io.js');
const { OUTCOME } = require('./failures.js');
const { CONFIDENCE, confidenceOf } = require('../lifecycle/evidence.js');

// Weakest to strongest. The v0.3 design keeps 60/75/85 as DEFAULTS, not as host assumptions.
const THRESHOLD_ORDER = ['advisory', 'checkpoint', 'final'];
const DEFAULT_THRESHOLDS = { advisory: 60, checkpoint: 75, final: 85 };

const ACTIONS = {
  advisory: 'prefer smaller atomic operations from here; a rollover is foreseeable in this cycle',
  checkpoint: 'prepare the checkpoint: write the handoff and the candidate memories now, while there is room to do it well',
  final: 'finish or stop the current atomic operation and begin the rollover — do not start another model turn',
};

/** @returns {{ok:true, thresholds}|{ok:false, reason}} */
function normalize(config) {
  const t = { ...DEFAULT_THRESHOLDS, ...(config || {}) };
  for (const name of THRESHOLD_ORDER) {
    const v = t[name];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 100) {
      return { ok: false, reason: `threshold ${name} must be a number in (0, 100]; got ${JSON.stringify(v)}` };
    }
  }
  const extra = Object.keys(t).filter((k) => !THRESHOLD_ORDER.includes(k));
  if (extra.length) return { ok: false, reason: `unknown threshold(s): ${extra.join(', ')}` };
  if (!(t.advisory < t.checkpoint && t.checkpoint < t.final)) {
    return { ok: false, reason: `thresholds must ascend: advisory ${t.advisory} < checkpoint ${t.checkpoint} < final ${t.final}` };
  }
  return { ok: true, thresholds: t };
}

const emptyLatches = (cycleId) => ({ kind: 'threshold-latches', cycleId, latched: {} });

/**
 * The re-arm. A record from another cycle is not migrated, merged or partially kept — it is REPLACED,
 * because "which thresholds already fired" is a fact about one cycle and means nothing in the next.
 */
function forCycle(record, cycleId) {
  if (record && record.cycleId === cycleId) return { record, rearmed: false };
  return {
    record: emptyLatches(cycleId),
    rearmed: true,
    previousCycleId: (record && record.cycleId) || null,
  };
}

function latch(record, name, { at = null, atPercent = null } = {}) {
  if (!THRESHOLD_ORDER.includes(name)) throw new Error(`unknown threshold: ${name}`);
  return {
    ...record,
    latched: { ...record.latched, [name]: { at: at || new Date().toISOString(), atPercent } },
  };
}

/**
 * Decide what a measurement means for this cycle. PURE.
 *
 * @param usedPercent  number|null — null when the host exposed nothing measurable
 * @param source       a declared measurement source (see evidence.SOURCE_CONFIDENCE); its confidence travels
 * @param record       the latch record for THIS cycle (call forCycle first)
 * @returns {{measurable, outcome, confidence, crossed, fire, alreadyLatched, actions, requiresOperatorConfirmation, why}}
 */
function evaluate({ usedPercent, source, thresholds = DEFAULT_THRESHOLDS, record }) {
  const confidence = confidenceOf(source);
  const latched = (record && record.latched) || {};

  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) {
    return {
      measurable: false, outcome: OUTCOME.CANNOT_DETERMINE, confidence,
      crossed: [], fire: [], alreadyLatched: Object.keys(latched), actions: [], requiresOperatorConfirmation: false,
      why: 'no usable context measurement — an unmeasured context is CANNOT_DETERMINE. It is not 0% (which would be silence at the final threshold) and not 100% (which would checkpoint every turn).',
    };
  }
  if (!confidence) {
    return {
      measurable: false, outcome: OUTCOME.CANNOT_DETERMINE, confidence: null,
      crossed: [], fire: [], alreadyLatched: Object.keys(latched), actions: [], requiresOperatorConfirmation: false,
      why: `measurement source ${JSON.stringify(source)} is not declared, so the number's provenance is unknown and it will not be acted on`,
    };
  }

  const crossed = THRESHOLD_ORDER.filter((n) => usedPercent >= thresholds[n]);
  const fire = crossed.filter((n) => !latched[n]);
  /*
   * ⛔ THE FINAL THRESHOLD ON A LOW-CONFIDENCE NUMBER IS FLAGGED, NOT SUPPRESSED AND NOT TRUSTED.
   * Claude's transcript format is explicitly internal and a byte proxy is our arithmetic, not the
   * host's; stopping the session on either without saying so would present an estimate as a reading.
   */
  const requiresOperatorConfirmation = fire.includes('final') && confidence !== CONFIDENCE.HIGH;

  return {
    measurable: true,
    outcome: OUTCOME.PASS,
    confidence,
    crossed,
    fire,
    alreadyLatched: Object.keys(latched),
    actions: fire.map((n) => ({ threshold: n, atPercent: thresholds[n], action: ACTIONS[n] })),
    requiresOperatorConfirmation,
    why: fire.length
      ? `${usedPercent}% crossed ${fire.join(', ')} (confidence ${confidence})`
      : `${usedPercent}% crossed nothing new in this cycle (already latched: ${Object.keys(latched).join(', ') || 'none'})`,
  };
}

// --- persistence, deliberately thin ------------------------------------------------------------------

const latchPath = (dir) => path.join(dir, 'thresholds.json');

function readLatches(dir) {
  const r = io.readJSONClassified(latchPath(dir));
  if (r.status === 'OK' && r.doc && typeof r.doc.cycleId === 'string') return { status: 'OK', record: r.doc, detail: null };
  if (r.status === 'ABSENT') return { status: 'ABSENT', record: null, detail: null };
  // A latch record that cannot be read is treated as ABSENT BY THE CALLER at its own risk: re-arming
  // costs a duplicate checkpoint, while assuming latched costs silence at the final threshold. The
  // status is returned rather than decided here, so the adapter's choice is visible in its code.
  return { status: r.status, record: null, detail: r.detail };
}

const writeLatches = (dir, record) => io.writeAtomicJSON(latchPath(dir), record);

module.exports = {
  THRESHOLD_ORDER, DEFAULT_THRESHOLDS, ACTIONS, CONFIDENCE,
  normalize, emptyLatches, forCycle, latch, evaluate,
  latchPath, readLatches, writeLatches,
};

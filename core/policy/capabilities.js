/*
 * RespawnPack · core/policy/capabilities.js — what an adapter may CLAIM, and what it must show first.
 *
 * ⛔ TWO ENUMS, DIFFERENT JOBS, NEVER MERGED.
 *   OUTCOME (policy/failures.js)  PASS · FAIL · CANNOT_DETERMINE · NOT_APPLICABLE — the verdict of a
 *                                 CHECK that ran against a subject.
 *   SUPPORT (here)                SUPPORTED · SUPPORTED_WITH_LIMITATIONS · NOT_SUPPORTED ·
 *                                 CANNOT_DETERMINE — what a HOST PROFILE can do.
 * They share the name CANNOT_DETERMINE and nothing else. Collapsing them would let "the probe passed"
 * be read as "the capability is supported", which is precisely the inference that makes an installed
 * file look like a working integration.
 *
 * ⛔ INSTALLING FILES IS NOT PROOF THAT A CAPABILITY IS ACTIVE. A declaration of SUPPORTED or
 * SUPPORTED_WITH_LIMITATIONS without an ACTIVATION-CANARY evidence record is DOWNGRADED here to
 * CANNOT_DETERMINE, and the downgrade is reported on the declaration rather than swallowed. This is the
 * whole reason the capability matrix is generated from declarations instead of being a table someone
 * maintains: a table gets edited when a feature is written, a declaration only moves when something ran.
 *
 * ⛔ AND A LIMITATION MUST BE NAMED. SUPPORTED_WITH_LIMITATIONS with an empty limitations list is a
 * SUPPORTED claim wearing a hedge; it is downgraded too. Codex app server is EXPERIMENTAL and Pi is not
 * installed in this development environment — those are limitations, and they have to be written down
 * where a reader of the matrix will see them.
 */
const { OUTCOME } = require('./failures.js');

// The adapter interface, verbatim from the v0.3 design. Every adapter answers for all seven.
const CAPABILITIES = [
  'probe',            // prove the configured integration is active
  'measureContext',   // return usage, capacity, source, and confidence
  'settleOrStop',     // reach a safe boundary without duplicating work
  'requestCompact',   // ask the host to compact through a documented API
  'observeCompact',   // prove completion or return a typed failure
  'injectHandoff',    // add verified continuation context
  'resume',           // continue the same conversation identity
];

const SUPPORT = {
  SUPPORTED: 'SUPPORTED',
  SUPPORTED_WITH_LIMITATIONS: 'SUPPORTED_WITH_LIMITATIONS',
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  CANNOT_DETERMINE: 'CANNOT_DETERMINE',
};

// The claims that require something to have RUN. The other two require a reason, which is cheaper to
// give and impossible to fake into a capability.
const REQUIRES_CANARY = new Set([SUPPORT.SUPPORTED, SUPPORT.SUPPORTED_WITH_LIMITATIONS]);

const isStr = (v) => typeof v === 'string' && v.length > 0;

/**
 * An activation canary: something OBSERVED, at a time, with the host's own payload kept.
 * @returns {{ok:boolean, why:string|null}}
 */
function canaryUsable(c) {
  if (!c || typeof c !== 'object') return { ok: false, why: 'no activation canary was supplied' };
  if (!isStr(c.kind)) return { ok: false, why: 'the canary does not say what it observed' };
  if (!isStr(c.observedAt)) return { ok: false, why: 'the canary carries no observation time' };
  if (c.raw === undefined || c.raw === null || c.raw === '') {
    return { ok: false, why: 'the canary keeps no verbatim host payload, so nothing about it can be re-checked later' };
  }
  if (c.ran !== true) return { ok: false, why: 'the canary record does not assert that it ran' };
  return { ok: true, why: null };
}

/**
 * Build one capability declaration, applying the downgrade rules.
 *
 * @returns {{capability, support, declaredSupport, downgraded:boolean, why, limitations, mechanism, canary, docs}}
 */
function declare({ capability, support, canary = null, limitations = [], mechanism = null, why = null, docs = [] }) {
  if (!CAPABILITIES.includes(capability)) throw new Error(`unknown capability: ${capability}`);
  if (!Object.prototype.hasOwnProperty.call(SUPPORT, support)) throw new Error(`unknown support level: ${support}`);

  const base = {
    capability, declaredSupport: support, support, downgraded: false, why,
    limitations: Array.isArray(limitations) ? limitations.slice() : [],
    mechanism, canary, docs: Array.isArray(docs) ? docs.slice() : [],
  };

  if (REQUIRES_CANARY.has(support)) {
    const c = canaryUsable(canary);
    if (!c.ok) {
      return { ...base, support: SUPPORT.CANNOT_DETERMINE, downgraded: true, why: `${support} was claimed and ${c.why}` };
    }
    if (support === SUPPORT.SUPPORTED_WITH_LIMITATIONS && !base.limitations.length) {
      return { ...base, support: SUPPORT.CANNOT_DETERMINE, downgraded: true, why: 'SUPPORTED_WITH_LIMITATIONS was claimed with no limitation named — an unnamed limitation is a SUPPORTED claim wearing a hedge' };
    }
    return base;
  }

  if (!isStr(why)) {
    return { ...base, support: SUPPORT.CANNOT_DETERMINE, downgraded: true, why: `${support} was claimed with no reason; an unexplained ${support} is indistinguishable from an unrun probe` };
  }
  return base;
}

/**
 * Roll a host profile's declarations into a matrix row.
 * A profile is only `rolloverCapable` when every capability the in-place rollover NEEDS is at least
 * SUPPORTED_WITH_LIMITATIONS — and the list is explicit, because a profile that cannot observe
 * completion is not "mostly capable", it is unable to prove a rollover happened.
 */
const ROLLOVER_REQUIRED = ['probe', 'measureContext', 'settleOrStop', 'requestCompact', 'observeCompact', 'injectHandoff', 'resume'];

function matrix(profileName, declarations) {
  const byCap = {};
  for (const d of declarations) byCap[d.capability] = d;
  const missing = CAPABILITIES.filter((c) => !byCap[c]);
  const unmet = ROLLOVER_REQUIRED.filter((c) => {
    const d = byCap[c];
    return !d || (d.support !== SUPPORT.SUPPORTED && d.support !== SUPPORT.SUPPORTED_WITH_LIMITATIONS);
  });
  return {
    profile: profileName,
    declarations: CAPABILITIES.map((c) => byCap[c] || { capability: c, support: SUPPORT.CANNOT_DETERMINE, downgraded: true, why: 'the adapter declared nothing for this capability', limitations: [], mechanism: null, canary: null, docs: [] }),
    // An undeclared capability is CANNOT_DETERMINE, never absent: an inventory built from what is
    // present cannot report an absence.
    undeclared: missing,
    rolloverCapable: unmet.length === 0,
    unmet,
    downgraded: declarations.filter((d) => d.downgraded).map((d) => d.capability),
    outcome: unmet.length === 0 ? OUTCOME.PASS : OUTCOME.CANNOT_DETERMINE,
  };
}

/*
 * ⛔ THE PLANNED MATRIX IS NOT A DECLARATION, AND THIS MODULE WILL NOT LET IT BECOME ONE.
 *
 * These are the TARGET statuses from the v0.3 design document. They are recorded so W2–W4 have a
 * denominator to work against — and `fromPlan` deliberately returns CANNOT_DETERMINE for every one of
 * them, because a plan is a statement about intent and a declaration is a statement about a canary that
 * ran. The one function that could turn the first into the second is the one that refuses to.
 */
const PLANNED = {
  'claude-code/hooks': { target: SUPPORT.SUPPORTED_WITH_LIMITATIONS, note: 'the operator runs /compact; hook output cannot make an unmanaged interactive client compact itself' },
  'claude-code/sdk-supervisor': { target: SUPPORT.SUPPORTED, note: 'documented /compact command, compact_boundary, resume same session id' },
  'codex/hooks': { target: SUPPORT.SUPPORTED_WITH_LIMITATIONS, note: 'the operator runs /compact; SessionStart(source=compact) carries additionalContext' },
  'codex/app-server': { target: SUPPORT.SUPPORTED, note: 'thread/compact/start plus the contextCompaction item; app server is EXPERIMENTAL and tokenUsage field names are undocumented' },
  'pi/extension': { target: SUPPORT.SUPPORTED, note: 'PROVISIONAL — Pi is not installed in this environment; activation is CANNOT_DETERMINE until a canary proves it' },
  'pi/rpc-supervisor': { target: SUPPORT.SUPPORTED, note: 'PROVISIONAL — same; and unattended write mode stays disabled until external isolation is proven' },
};

function fromPlan(profile, capability) {
  const p = PLANNED[profile];
  return declare({
    capability,
    support: SUPPORT.CANNOT_DETERMINE,
    why: p
      ? `planned status for ${profile} is ${p.target} (${p.note}) — a plan is not an observation, so nothing here is declared active`
      : `${profile} has no planned status recorded, and a plan would not be an observation in any case`,
  });
}

module.exports = { CAPABILITIES, SUPPORT, REQUIRES_CANARY, ROLLOVER_REQUIRED, PLANNED, canaryUsable, declare, matrix, fromPlan };

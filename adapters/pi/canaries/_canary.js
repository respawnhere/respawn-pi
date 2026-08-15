/*
 * RespawnPack · adapters/pi/canaries/_canary.js — the shared shape of a Pi canary's answer.
 *
 * ⛔ A CANARY THAT CANNOT RUN MUST SAY WHAT STOPPED IT, IN A TYPE. "Failed" is the wrong word for "Pi is
 * not installed on this machine": nothing was observed to be broken, and reporting FAIL would make a
 * missing precondition indistinguishable from a real defect — which is how a red board gets ignored. So
 * every canary here answers in core/policy/failures.js's four-outcome vocabulary, CANNOT_DETERMINE names
 * the PRECONDITION it lacked, and the process exit code is core's own: 0 PASS · 1 FAIL · 2 CANNOT_DETERMINE.
 *
 * ⛔ AND THE PRECONDITIONS ARE AN ENUMERATION, NOT PROSE. A free-text reason cannot be counted, matched by
 * a doctor, or fenced by a test; three canaries would spell the same condition three ways within a month.
 * `PRECONDITIONS` below is the closed set, and the suite asserts each canary emits one of them verbatim.
 *
 * ⭐ EVERY RESULT CARRIES `raw`. What a canary OBSERVED — the exit status of `where pi`, the marker file it
 * read, the frames a live install actually sent — travels with the verdict, for the same reason
 * core/lifecycle/evidence.js keeps a verbatim payload on every host observation: a verdict with no
 * underlying observation cannot be re-checked by anyone, including its author a month later.
 */
'use strict';
const path = require('path');

const core = require(path.join(__dirname, '..', '..', '..', 'core', 'index.js'));

const { OUTCOME, exitCodeFor } = core.failures;

/** The closed set of things that can stop a Pi canary before it observes anything. */
const PRECONDITIONS = Object.freeze({
  PI_NOT_INSTALLED: 'pi not installed',
  PI_UNRESPONSIVE: 'pi found but did not answer --version',
  TRUST_NOT_ESTABLISHED: 'trust not established',
  BRIDGE_NOT_LOADED: 'the extension fired but could not load its bridge',
  NO_ISOLATION_COMMAND: 'no isolation command provided',
  NO_RPC_SESSION: 'no pi --mode rpc session could be attached',
  SESSION_ALREADY_CLAIMED: 'session already claimed by another supervisor',
  NO_SETTLE_SIGNAL: 'no agent_settled signal on the RPC stream',
});

const PRECONDITION_VALUES = Object.freeze(Object.values(PRECONDITIONS));

const SCHEMA_VERSION = '1.0.0';
const KIND = 'pi-canary-result';

const nowISO = () => new Date().toISOString();

/** Build a result. Nothing is printed and nothing exits — callers decide, and tests call this directly. */
function result(canary, outcome, { precondition = null, detail = null, recovery = null, raw = null, proves = null, notes = [] } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    canary,
    outcome,
    precondition,
    detail,
    recovery,
    proves,
    notes: Array.isArray(notes) ? notes : [],
    observedAt: nowISO(),
    exitCode: exitCodeFor(outcome),
    raw,
  };
}

/**
 * The typed "I could not tell".
 * @param precondition MUST be one of PRECONDITIONS — an unlisted one throws, because a precondition that
 *        is not in the enumeration cannot be matched by anything downstream and would silently rot.
 */
function cannotDetermine(canary, precondition, fields = {}) {
  if (!PRECONDITION_VALUES.includes(precondition)) {
    throw new Error(`unknown canary precondition ${JSON.stringify(precondition)} — add it to PRECONDITIONS or use one of: ${PRECONDITION_VALUES.join(' | ')}`);
  }
  return result(canary, OUTCOME.CANNOT_DETERMINE, { ...fields, precondition });
}

const pass = (canary, fields = {}) => result(canary, OUTCOME.PASS, fields);
const fail = (canary, fields = {}) => result(canary, OUTCOME.FAIL, fields);
const notApplicable = (canary, fields = {}) => result(canary, OUTCOME.NOT_APPLICABLE, fields);

/**
 * Render a result for a human AND for a machine. The human block comes first so a terminal reader sees
 * the verdict without scrolling; the JSON follows on its own lines so `node canary-x.js | tail -n +N`
 * style parsing, and a future doctor, both work.
 */
function render(r) {
  const lines = [
    `RespawnPack · Pi canary: ${r.canary}`,
    `OUTCOME: ${r.outcome}`,
  ];
  if (r.precondition) lines.push(`PRECONDITION: ${r.precondition}`);
  if (r.proves) lines.push(`PROVES: ${r.proves}`);
  if (r.detail) lines.push(`DETAIL: ${r.detail}`);
  if (r.recovery) lines.push(`RECOVERY: ${r.recovery}`);
  for (const n of r.notes) lines.push(`NOTE: ${n}`);
  lines.push('---');
  lines.push(JSON.stringify(r, null, 2));
  return lines.join('\n');
}

/** Print and exit with core's own code for the outcome. The only place any canary calls process.exit. */
function emit(r) {
  process.stdout.write(`${render(r)}\n`);
  process.exit(r.exitCode);
}

/**
 * A deliberately small flag reader: `--flag value` and `--flag=value` and bare `--flag`.
 * No dependency, no clever coercion — a canary's argv is three flags at most.
 */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i += 1; }
    else out[a.slice(2)] = true;
  }
  return out;
}

/**
 * Wrap a canary body so an unforeseen throw becomes a typed FAIL rather than a stack trace and an exit
 * code nobody classified. Mirrors adapters/codex/hooks/_shared.js's `installSafetyNet` in spirit
 * (credited): the conservative answer is produced by the thing that knows what conservative means here.
 */
async function guard(canary, body) {
  try {
    return await body();
  } catch (e) {
    return fail(canary, {
      detail: `the canary itself threw: ${(e && e.stack) || String(e)}`,
      recovery: 'This is a defect in the canary, not a verdict about Pi. Fix the canary before drawing any conclusion from this run.',
      raw: { error: String(e && e.message) },
    });
  }
}

module.exports = {
  PRECONDITIONS, PRECONDITION_VALUES, SCHEMA_VERSION, KIND, OUTCOME,
  result, cannotDetermine, pass, fail, notApplicable, render, emit, parseArgs, guard,
};

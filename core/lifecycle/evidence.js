/*
 * RespawnPack · core/lifecycle/evidence.js — the typed evidence records every transition is gated on.
 *
 * ⛔ THE TYPED WRAPPER NEVER REPLACES THE HOST PAYLOAD. Codex's usage event (`thread/tokenUsage/updated`)
 * carries FIELD NAMES THAT ARE NOT DOCUMENTED; Claude's transcript JSONL is explicitly internal; Pi's
 * signal names are provisional until an installation proves them. A record that keeps only this pack's
 * interpretation of such a payload becomes unreadable the day the host renames a field, and — worse —
 * unfalsifiable, because nothing is left to re-interpret. So `raw` is stored VERBATIM beside the typed
 * fields, and a record that claims a host observation without one is REFUSED rather than trusted.
 *
 * ⛔ AND ABSENCE OF PROOF IS NEVER PROOF. A timeout, an elapsed delay, a process exit and "no error was
 * reported" are not observations of a compaction; they are observations of a clock. Any of them offered
 * as a completion signal is a PROOF_SUBSTITUTION_ATTEMPT, which is a FAIL, not a slightly weaker pass.
 * The forbidden set below is checked with a known-good/known-bad control pair in core/core.test.mjs —
 * a check that accepts `compact_boundary` and also accepts `timeout` discriminates nothing.
 *
 * ⭐ THE TAXONOMY IS EXTENSIBLE BY DESIGN. Pi's kinds are marked PROVISIONAL because R5 verification is
 * pending; W4 may rename them without reshaping any record, because the shape is {kind, …typed, raw}.
 */
const io = require('../_io.js');
const { failure } = require('../policy/failures.js');

// Host tags. A conversation id is only unique WITHIN a host, so every identity carries its host.
const HOSTS = { CLAUDE_CODE: 'claude-code', CODEX: 'codex', PI: 'pi' };

const KINDS = {
  CONTEXT_MEASUREMENT: 'context-measurement',
  SAFE_BOUNDARY: 'safe-boundary',
  HANDOFF_WRITTEN: 'handoff-written',
  HANDOFF_READBACK: 'handoff-readback',
  COMPACT_REQUESTED: 'compact-requested',
  COMPACT_COMPLETED: 'compact-completed',
  COMPACT_NOOP: 'compact-noop',
  COMPACT_UNOBSERVED: 'compact-unobserved',
  IDENTITY_VERIFICATION: 'identity-verification',
  HANDOFF_CONSUMPTION: 'handoff-consumption',
};

/*
 * Every completion signal this core will accept, the hosts that emit it, and how well documented it is.
 * `documented:false` records a signal that is real but whose SHAPE is not published — it is accepted and
 * flagged, never silently promoted to the same standing as a documented one.
 */
const COMPLETION_SIGNALS = {
  compact_boundary: { hosts: [HOSTS.CLAUDE_CODE], documented: true, note: 'Agent SDK system message with compact_metadata.{trigger,pre_tokens}' },
  session_start_compact: { hosts: [HOSTS.CLAUDE_CODE, HOSTS.CODEX], documented: true, note: 'SessionStart hook with source "compact"; runs before the next model request' },
  postcompact_hook: { hosts: [HOSTS.CODEX], documented: true, note: 'Codex PostCompact hook' },
  codex_context_compaction: { hosts: [HOSTS.CODEX], documented: true, provisionalShape: true, note: 'app-server contextCompaction item/started → item/completed, same item id and threadId; app-server is EXPERIMENTAL' },
  pi_session_compact: { hosts: [HOSTS.PI], documented: false, note: 'PROVISIONAL — design-doc claim; R5 verification and a real canary are pending' },
};

/*
 * ⛔ THE FORBIDDEN SET IS MATCHED ON THE SIGNAL NAME, NOT ON THE RECORD KIND. Declaring a timeout is
 * legitimate — that is what `compact-unobserved` is FOR. Dressing one up as `compact-completed` is not.
 * The distinction is the whole check: same word, opposite meaning, decided by which field it appears in.
 */
const FORBIDDEN_PROOF_TOKENS = ['timeout', 'timed_out', 'elapsed', 'process_exit', 'exit_code', 'exited', 'sleep', 'delay', 'assumed', 'optimistic', 'no_error', 'probably'];

// Kinds that describe something a HOST did or reported. These require the verbatim payload.
const HOST_OBSERVED = new Set([
  KINDS.CONTEXT_MEASUREMENT, KINDS.SAFE_BOUNDARY, KINDS.COMPACT_REQUESTED,
  KINDS.COMPACT_COMPLETED, KINDS.COMPACT_NOOP, KINDS.COMPACT_UNOBSERVED, KINDS.IDENTITY_VERIFICATION,
]);

// Verbatim has a ceiling, and hitting it is REPORTED. A capped payload that does not say it was capped
// reads as complete, which is the same defect as a truncated file list with no truncation flag.
const MAX_RAW_BYTES = 65536;

// Measurement confidence. A number's provenance travels with it: an internal transcript format and a
// documented usage field are not the same claim, and a byte proxy is a third thing again.
const CONFIDENCE = { HIGH: 'HIGH', LOW: 'LOW', PROXY: 'PROXY' };
const SOURCE_CONFIDENCE = {
  'documented-api': CONFIDENCE.HIGH,       // SDK usage fields, statusline JSON, getContextUsage()
  'documented-event': CONFIDENCE.HIGH,     // thread/tokenUsage/updated — the EVENT is documented
  'internal-format': CONFIDENCE.LOW,       // transcript JSONL — explicitly internal, may change silently
  'byte-proxy': CONFIDENCE.PROXY,          // characters/bytes counted by us, not tokens reported by the host
};

const isString = (v) => typeof v === 'string' && v.length > 0;
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** Field requirements per kind. `raw` is added for every HOST_OBSERVED kind by the validator itself. */
const REQUIRED = {
  [KINDS.CONTEXT_MEASUREMENT]: (r) => (
    (isString(r.source) ? null : 'source must name where the number came from')
    || (Object.prototype.hasOwnProperty.call(SOURCE_CONFIDENCE, r.source) ? null : `source ${JSON.stringify(r.source)} is not a declared measurement source`)
    || (isFiniteNumber(r.usedPercent) ? null : 'usedPercent must be a finite number — an unmeasured context is CANNOT_DETERMINE, never 0')
  ),
  [KINDS.SAFE_BOUNDARY]: (r) => (isString(r.mechanism) ? null : 'mechanism must name the boundary that was reached (unblocked Stop hook, turn/completed, idle, operator)'),
  [KINDS.HANDOFF_WRITTEN]: (r) => (
    (isString(r.handoffId) ? null : 'handoffId is required')
    || (isString(r.handoffPath) ? null : 'handoffPath is required')
    || (isString(r.writtenDigest) ? null : 'writtenDigest is required — a write with no digest cannot be read back and compared')
  ),
  [KINDS.HANDOFF_READBACK]: (r) => (
    (isString(r.handoffId) ? null : 'handoffId is required')
    || (isString(r.writtenDigest) ? null : 'writtenDigest is required')
    || (isString(r.readBackDigest) ? null : 'readBackDigest is required')
    || (typeof r.equal === 'boolean' ? null : 'equal must be a boolean — an unstated comparison is not a comparison')
  ),
  [KINDS.COMPACT_REQUESTED]: (r) => (isString(r.mechanism) ? null : 'mechanism must name the documented API used (sdk-slash-command, app-server-thread-compact, pi-ctx-compact, operator-manual)'),
  [KINDS.COMPACT_COMPLETED]: (r) => (isString(r.signal) ? null : 'signal must name the host completion signal'),
  [KINDS.COMPACT_NOOP]: (r) => (isString(r.hostResult) ? null : 'hostResult must carry the host\'s own words (e.g. "Not enough messages to compact.")'),
  [KINDS.COMPACT_UNOBSERVED]: (r) => (
    (isString(r.reason) ? null : 'reason is required (timeout, stream-closed, no-signal)')
    || (isFiniteNumber(r.waitedMs) ? null : 'waitedMs is required — how long nothing happened is the only fact this record has')
  ),
  [KINDS.IDENTITY_VERIFICATION]: (r) => (
    (isString(r.expectedId) ? null : 'expectedId is required')
    || (r.observedId === null || isString(r.observedId) ? null : 'observedId must be a string, or null when the host exposed none')
    || (typeof r.equal === 'boolean' || r.equal === null ? null : 'equal must be true, false, or null for "the host exposed no identity"')
  ),
  [KINDS.HANDOFF_CONSUMPTION]: (r) => (
    (isString(r.handoffId) ? null : 'handoffId is required')
    || (isString(r.status) ? null : 'status is required')
  ),
};

/**
 * Build a record. `at` defaults to now; `raw` is stored verbatim up to the ceiling.
 * Constructing an unknown kind is a programming error and throws — an evidence record whose kind
 * nothing declares would be gate-able by nothing.
 */
function make(kind, fields = {}) {
  if (!Object.values(KINDS).includes(kind)) throw new Error(`unknown evidence kind: ${kind}`);
  const rec = { kind, observedAt: fields.observedAt || new Date().toISOString(), ...fields };
  if (rec.raw !== undefined && rec.raw !== null) return withBoundedRaw(rec);
  return rec;
}

function withBoundedRaw(rec) {
  const text = typeof rec.raw === 'string' ? rec.raw : JSON.stringify(rec.raw);
  const bytes = Buffer.byteLength(text || '', 'utf8');
  if (bytes <= MAX_RAW_BYTES) return { ...rec, rawBytes: bytes, rawTruncated: false, rawDigest: io.digest(text || '') };
  return {
    ...rec,
    raw: `${String(text).slice(0, MAX_RAW_BYTES)}`,
    rawBytes: bytes, rawTruncated: true, rawDigest: io.digest(text),
  };
}

/**
 * Accept or refuse one evidence record.
 * @returns {{ok:true, record, provisional:boolean}|{ok:false, failure}}
 */
function validate(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, failure: failure('EVIDENCE_MALFORMED', 'an evidence record must be a JSON object') };
  }
  const check = REQUIRED[record.kind];
  if (!check) return { ok: false, failure: failure('EVIDENCE_MALFORMED', `unknown evidence kind ${JSON.stringify(record.kind)}`) };

  if (!isString(record.observedAt)) {
    return { ok: false, failure: failure('EVIDENCE_MALFORMED', `${record.kind}: observedAt is required — an observation with no time cannot be ordered against a compaction`) };
  }
  const why = check(record);
  if (why) return { ok: false, failure: failure('EVIDENCE_MALFORMED', `${record.kind}: ${why}`) };

  if (HOST_OBSERVED.has(record.kind) && (record.raw === undefined || record.raw === null || record.raw === '')) {
    return {
      ok: false,
      failure: failure('EVIDENCE_MALFORMED',
        `${record.kind}: no verbatim host payload. Several host fields this core reads are undocumented or explicitly internal, so the typed wrapper alone is not evidence — store what the host actually said.`),
    };
  }

  let provisional = false;
  if (record.kind === KINDS.COMPACT_COMPLETED) {
    const forbidden = forbiddenToken(record.signal);
    if (forbidden) {
      return {
        ok: false,
        failure: failure('PROOF_SUBSTITUTION_ATTEMPT',
          `${record.signal} contains "${forbidden}" — a clock is not a completion signal. Declare it as ${KINDS.COMPACT_UNOBSERVED} instead.`),
      };
    }
    const spec = COMPLETION_SIGNALS[record.signal];
    if (!spec) return { ok: false, failure: failure('COMPLETION_EVIDENCE_UNTYPED', `${JSON.stringify(record.signal)} is not a declared completion signal`) };
    provisional = spec.documented === false;
  }
  return { ok: true, record, provisional };
}

function forbiddenToken(signal) {
  const s = String(signal || '').toLowerCase();
  return FORBIDDEN_PROOF_TOKENS.find((t) => s.includes(t)) || null;
}

/** The confidence of a measurement, from its declared source. An undeclared source has none. */
const confidenceOf = (source) => SOURCE_CONFIDENCE[source] || null;

module.exports = {
  HOSTS, KINDS, COMPLETION_SIGNALS, FORBIDDEN_PROOF_TOKENS, HOST_OBSERVED,
  CONFIDENCE, SOURCE_CONFIDENCE, MAX_RAW_BYTES,
  make, validate, forbiddenToken, confidenceOf,
};

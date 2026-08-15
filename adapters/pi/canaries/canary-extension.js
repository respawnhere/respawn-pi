#!/usr/bin/env node
/*
 * RespawnPack · adapters/pi/canaries/canary-extension.js — did the extension actually LOAD and FIRE?
 *
 * PROVES: Pi called `respawnpack-rollover.ts` in this project — i.e. the file was found, the project was
 * trusted, and the extension ran — because the extension itself wrote the marker this reads.
 * DOES NOT PROVE: that a compaction works, that injection is delivered, or that the model read anything.
 *
 * ⛔ WHY THE MARKER IS CHECKED BEFORE PI IS EVEN LOOKED FOR. The subject of this canary is the EXTENSION
 * FIRING, and the marker is the direct observation of exactly that. `pi` being absent from PATH is a
 * contributing fact (reported in `notes`), not the finding — a marker could legitimately exist from a
 * machine or container where Pi lives somewhere this shell cannot see.
 *
 * Non-interactive modes do not display the trust prompt. Trust can be saved by an interactive run or
 * intentionally overridden for one non-interactive run with Pi's documented `--approve` flag.
 *
 *   node adapters/pi/canaries/canary-extension.js [--project <dir>] [--max-age-days <n>]
 *
 * Exit: 0 PASS · 2 CANNOT_DETERMINE.
 */
'use strict';
const c = require('./_canary.js');
const bridge = require('../bridge/rollover-bridge.js');
const supervisor = require('../rpc-supervisor/supervisor.js');

const NAME = 'canary-extension';

/** 30 days, matching adapters/codex/profile.js's CANARY_FRESHNESS_MS — one pack, one staleness rule. */
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const TRUST_RECOVERY = 'Run `pi` interactively in this project and approve trust, then restart so session_start '
  + 'fires. For an intentional one-run non-interactive launch, use Pi\'s `--approve` flag.';

/*
 * ⛔ STRICT MARKER SCHEMA — DEFENCE AGAINST FORGED ACTIVATION EVIDENCE.
 *
 * The strict schema is enforced ONLY when the canary runs under a per-run nonce
 * (RESPAWNPACK_CANARY_NONCE is set in the environment), which is the mode scripts/canary-fresh-target.sh
 * uses. Outside that mode the existing lenient checks apply, so historical ad-hoc canary probes and
 * existing test fixtures (which sometimes pass opaque sessionId strings) keep working. Inside the
 * strict mode, every identity field the bridge documents must be present, well-typed, and within the
 * closed set of allowed field names. This is an integrity check, not executable authentication: a
 * full-shape writer can copy public fields. `scripts/canary-fresh-target.sh` separately binds the PATH
 * executable to this Node installation's declared global `bin.pi`; the end-to-end gate requires both.
 *
 * The shape check fires before content reasoning so malformed evidence is never credited.
 */
const STRICT_MARKER_FIELDS = Object.freeze(new Set([
  'schemaVersion', 'kind', 'event', 'at', 'sessionId',
  'piVersion', 'ran', 'nonce', 'firstSeenAt', 'fireCount',
  'raw', 'rawBytes', 'rawTruncated',
  'degraded', 'degradedReason', 'triedPaths', 'recovery',
]));

/**
 * Pi generates UUIDv7 session ids (per @earendil-works/pi-coding-agent/dist/core/session-manager.js's
 * `createSessionId()` → `uuidv7()`). They look like `01900000-0000-7000-8000-000000000000` — the
 * canonical 8-4-4-4-12 hex layout. Accept that shape, in upper or lower case, with strict hyphens.
 */
const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_RE = /^[0-9a-f]{32}$/;
const NORMAL_REQUIRED_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'event', 'at', 'sessionId', 'piVersion', 'ran', 'nonce',
  'firstSeenAt', 'fireCount', 'raw', 'rawBytes', 'rawTruncated',
]);

function strictShapeError(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'the activation marker is not a JSON object';
  const unknown = Object.keys(doc).filter((k) => !STRICT_MARKER_FIELDS.has(k));
  if (unknown.length) {
    return `the activation marker has unknown identity field(s): ${unknown.map((k) => JSON.stringify(k)).join(', ')}`;
  }
  if (doc.schemaVersion !== '1.0.0') {
    return `the activation marker has schemaVersion=${JSON.stringify(doc.schemaVersion)}; expected "1.0.0"`;
  }
  if (doc.kind !== 'pi-extension-activation-canary') {
    return `the activation marker has kind=${JSON.stringify(doc.kind)}; expected "pi-extension-activation-canary"`;
  }
  if (doc.event !== 'session_start') {
    return `the activation marker has event=${JSON.stringify(doc.event)}; expected "session_start"`;
  }
  if (doc.ran !== true) return `the activation marker has ran=${JSON.stringify(doc.ran)}; expected true`;
  if (typeof doc.sessionId !== 'string' || !UUID_LIKE_RE.test(doc.sessionId)) {
    return `the activation marker has sessionId=${JSON.stringify(doc.sessionId)}; expected a UUIDv7 string`;
  }
  const atMs = typeof doc.at === 'string' ? Date.parse(doc.at) : NaN;
  if (!Number.isFinite(atMs)) return `the activation marker has at=${JSON.stringify(doc.at)}; expected a parseable timestamp`;

  // A degraded marker is never PASS evidence. Its writer intentionally has no bridge-provided nonce
  // or boundedRaw metadata, so validate only its own documented branch and let BRIDGE_NOT_LOADED win.
  if (doc.degraded === true) {
    if (typeof doc.degradedReason !== 'string' || !doc.degradedReason) return 'the degraded activation marker has no degradedReason';
    if (!Array.isArray(doc.triedPaths) || doc.triedPaths.some((p) => typeof p !== 'string')) return 'the degraded activation marker has invalid triedPaths';
    if (typeof doc.recovery !== 'string' || !doc.recovery) return 'the degraded activation marker has no recovery';
    return null;
  }

  const missing = NORMAL_REQUIRED_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(doc, field));
  if (missing.length) return `the activation marker is missing required field(s): ${missing.join(', ')}`;
  if (doc.piVersion !== null && (typeof doc.piVersion !== 'string' || !doc.piVersion)) {
    return `the activation marker has piVersion=${JSON.stringify(doc.piVersion)}; expected null or a non-empty string`;
  }
  const firstSeenMs = typeof doc.firstSeenAt === 'string' ? Date.parse(doc.firstSeenAt) : NaN;
  if (!Number.isFinite(firstSeenMs) || firstSeenMs > atMs) {
    return `the activation marker has firstSeenAt=${JSON.stringify(doc.firstSeenAt)} after or outside its observation time`;
  }
  if (!doc.raw || typeof doc.raw !== 'object' || Array.isArray(doc.raw)) return 'the activation marker raw field is not an event object';
  if (!Number.isInteger(doc.rawBytes) || doc.rawBytes < 0) return `the activation marker has rawBytes=${JSON.stringify(doc.rawBytes)}; expected a non-negative integer`;
  if (doc.rawTruncated !== false) return `the fresh session_start marker has rawTruncated=${JSON.stringify(doc.rawTruncated)}; expected false`;
  const actualRawBytes = Buffer.byteLength(JSON.stringify(doc.raw), 'utf8');
  if (doc.rawBytes !== actualRawBytes) return `the activation marker rawBytes=${doc.rawBytes} does not match raw payload bytes=${actualRawBytes}`;
  return null;
}

function strictFireCountError(doc) {
  if (doc.fireCount !== 1) {
    return `the activation marker has fireCount=${JSON.stringify(doc.fireCount)}; a fresh target with its prior marker removed must record exactly one firing`;
  }
  return null;
}

function strictNonceError(doc, expected) {
  if (typeof expected !== 'string' || !NONCE_RE.test(expected)) {
    return `the canary expected nonce ${JSON.stringify(expected)} is not 16-byte lowercase hex`;
  }
  if (typeof doc.nonce !== 'string' || !NONCE_RE.test(doc.nonce)) {
    return `the activation marker has nonce=${JSON.stringify(doc.nonce)}; expected a 16-byte lowercase-hex per-run nonce`;
  }
  if (doc.nonce !== expected) {
    return `the activation marker has nonce=${JSON.stringify(doc.nonce)}; expected the per-run nonce "${expected}" — a marker that does not carry this run's nonce cannot have been written by THIS invocation`;
  }
  return null;
}

function run({ projectDir = process.cwd(), maxAgeMs = DEFAULT_MAX_AGE_MS, env = process.env, now = Date.now } = {}) {
  const read = bridge.readExtensionCanary(projectDir);
  const piSeen = supervisor.probe({ env, cwd: projectDir });
  const piNote = piSeen.outcome === c.OUTCOME.PASS
    ? `pi ${piSeen.version || '(version unreadable)'} is on PATH at ${piSeen.piPath}`
    : 'no pi executable is on PATH in this shell (a contributing fact, not the finding — the marker is what this canary reads)';

  if (!read.present) {
    return c.cannotDetermine(NAME, c.PRECONDITIONS.TRUST_NOT_ESTABLISHED, {
      detail: `no extension activation marker at ${bridge.extensionCanaryPath(projectDir)} — Pi has never called this pack's extension in ${projectDir}`
        + (read.status && read.status !== 'ABSENT' ? ` (the path was ${read.status}: ${read.detail || 'no detail'})` : ''),
      recovery: TRUST_RECOVERY,
      notes: [
        piNote,
        'installing the .ts file is not activation: project extensions are trust-gated, and an untrusted one is silently skipped',
      ],
      raw: { markerPath: bridge.extensionCanaryPath(projectDir), status: read.status, probe: piSeen.raw },
    });
  }

  const doc = read.doc;

  // ⛔ STRICT SCHEMA GATE — only when a per-run nonce is in play, i.e. under scripts/canary-fresh-target.sh.
  // This is the canary's defence against a fake `pi` on PATH that knows the nonce but cannot imitate the
  // full documented shape of a real extension's marker. A forged or hand-written marker is rejected here
  // before any further reasoning can accidentally credit it.
  const expectedNonce = env.RESPAWNPACK_CANARY_NONCE || null;
  const strictMode = expectedNonce !== null;

  if (strictMode) {
    const shapeError = strictShapeError(doc);
    if (shapeError) {
      return c.cannotDetermine(NAME, c.PRECONDITIONS.TRUST_NOT_ESTABLISHED, {
        detail: shapeError,
        recovery: 'Re-run scripts/canary-fresh-target.sh against a real Pi installation. A forged or hand-edited marker that misses the documented schema cannot be honoured.',
        notes: [piNote, 'this canary only passes when the marker was written by a real Pi session_start handler with the documented rollover-bridge.js shape'],
        raw: { doc, strictFields: [...STRICT_MARKER_FIELDS] },
      });
    }
    const fireCountError = doc.degraded === true ? null : strictFireCountError(doc);
    if (fireCountError) {
      return c.cannotDetermine(NAME, c.PRECONDITIONS.TRUST_NOT_ESTABLISHED, {
        detail: fireCountError,
        recovery: 'Re-run the canary against a real Pi session.',
        notes: [piNote],
        raw: { doc },
      });
    }
    const nonceError = doc.degraded === true ? null : strictNonceError(doc, expectedNonce);
    if (nonceError) {
      return c.cannotDetermine(NAME, c.PRECONDITIONS.TRUST_NOT_ESTABLISHED, {
        detail: nonceError,
        recovery: 'Re-run scripts/canary-fresh-target.sh; a real Pi session writes a marker carrying the per-run nonce exported by the script.',
        notes: [piNote],
        raw: { doc, expectedNonce },
      });
    }
  }

  // ⛔ DEGRADED IS ITS OWN ANSWER. The extension fired — so trust IS established and the file IS loaded —
  // and it could not reach the bridge that holds every decision, so it did nothing. Reporting this as
  // "trust not established" would send an operator to re-approve a trust prompt that is already approved.
  if (doc.degraded === true) {
    return c.cannotDetermine(NAME, c.PRECONDITIONS.BRIDGE_NOT_LOADED, {
      detail: `the extension fired at ${doc.at} and is INERT: ${doc.degradedReason || 'it could not load adapters/pi/bridge/rollover-bridge.js'}`,
      recovery: doc.recovery || 'Reinstall respawn-pi, or set RESPAWN_PI_BRIDGE to the absolute path of adapters/pi/bridge/rollover-bridge.js, then restart Pi.',
      notes: [piNote, 'trust IS established — the extension loaded and ran; nothing about the trust prompt needs revisiting'],
      raw: { doc },
    });
  }

  // R11: per-run nonce correlation. If the script exported one, the marker MUST carry it. The strict
  // gate above already enforces this in strictMode; this is the legacy lenient-mode hook kept for
  // backwards compatibility with callers that pass a nonce but don't opt into strict schema.
  if (expectedNonce && doc.nonce !== expectedNonce) {
    return c.cannotDetermine(NAME, c.PRECONDITIONS.TRUST_NOT_ESTABLISHED, {
      detail: `marker nonce (${doc.nonce || 'absent'}) does not match the per-run nonce expected by this canary (${expectedNonce}) — the marker could not have been written by this invocation`,
      recovery: 'Re-run the canary; a real Pi session will write a marker with the matching nonce.',
      notes: [piNote],
      raw: { doc, expectedNonce },
    });
  }

  // R11: tighter freshness check. Default allows the historical 30-day window for sanity probes;
  // scripts that explicitly set RESPAWNPACK_CANARY_MAX_AGE_MS tighten it to a couple of minutes.
  const overrideAgeMs = env.RESPAWNPACK_CANARY_MAX_AGE_MS && Number.isFinite(Number(env.RESPAWNPACK_CANARY_MAX_AGE_MS))
    ? Number(env.RESPAWNPACK_CANARY_MAX_AGE_MS)
    : null;
  const effectiveMax = overrideAgeMs !== null ? overrideAgeMs : maxAgeMs;

  const ageMs = now() - Date.parse(doc.at || '');
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return c.cannotDetermine(NAME, c.PRECONDITIONS.TRUST_NOT_ESTABLISHED, {
      detail: 'the activation marker has no parseable or non-future observation time',
      recovery: 'Delete the marker and trigger a fresh Pi session so the extension rewrites it.',
      notes: [piNote],
      raw: { doc },
    });
  }
  if (doc.ran !== true) {
    return c.cannotDetermine(NAME, c.PRECONDITIONS.TRUST_NOT_ESTABLISHED, {
      detail: 'the activation marker exists and does not assert that the extension ran',
      recovery: TRUST_RECOVERY,
      notes: [piNote],
      raw: { doc },
    });
  }
  if (ageMs > effectiveMax) {
    const windowText = `${Math.round(effectiveMax / 1000)}s`; // approximate — appropriate for canary windows
    return c.cannotDetermine(NAME, c.PRECONDITIONS.TRUST_NOT_ESTABLISHED, {
      detail: `the last observed extension firing was ${Math.round(ageMs / 1000)}s ago, past the ${windowText} freshness window — a pre-existing marker is not a PASS`,
      recovery: 'Re-run the canary to write a fresh marker, or widen the window if you intentionally accept a stale one.',
      notes: [piNote],
      raw: { doc, ageMs, effectiveMax },
    });
  }

  return c.pass(NAME, {
    proves: `Pi loaded and called this pack's extension in ${projectDir}`,
    detail: `the extension last fired at ${doc.at} on event ${doc.event || '(unnamed)'} for session ${doc.sessionId || '(unknown)'}; nonce=${doc.nonce || '(absent)'}; ${doc.fireCount} firing(s) recorded since ${doc.firstSeenAt}`,
    notes: [piNote, 'this proves the extension RAN; it does not prove a compaction was observed or a handoff delivered'],
    raw: { doc },
  });
}

if (require.main === module) {
  const args = c.parseArgs(process.argv.slice(2));
  const maxAgeDays = Number(args['max-age-days']);
  c.guard(NAME, () => run({
    projectDir: typeof args.project === 'string' ? args.project : process.cwd(),
    maxAgeMs: Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? maxAgeDays * 86400000 : DEFAULT_MAX_AGE_MS,
    env: process.env,
  })).then(c.emit);
}

module.exports = {
  NAME, run, DEFAULT_MAX_AGE_MS,
  STRICT_MARKER_FIELDS, UUID_LIKE_RE,
  strictShapeError, strictFireCountError, strictNonceError,
};

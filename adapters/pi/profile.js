/*
 * RespawnPack · adapters/pi/profile.js — capability declarations for 'pi-extension' and 'pi-rpc-supervisor'.
 *
 * Every live capability remains CANNOT_DETERMINE until a target Pi installation writes a usable canary.
 * Documentation and deterministic tests establish the mechanism; they do not replace live evidence.
 * core/policy/capabilities.js downgrades any SUPPORTED / SUPPORTED_WITH_LIMITATIONS claim that arrives
 * without a usable activation canary, and this file relies on that downgrade rather than routing around
 * it. `readCanary` returns a real marker when a canary actually wrote one, and null when none did — which
 * is the state of a freshly authored adapter on a machine with no Pi.
 *
 * ⛔ THE PLANNED MATRIX IS NOT A DECLARATION. core's `PLANNED` records `pi/extension` and
 * `pi/rpc-supervisor` as TARGET SUPPORTED, and its `fromPlan()` deliberately returns CANNOT_DETERMINE for
 * every one of them. Nothing here promotes a target into a status. The targets appear only in `why`
 * strings, so a reader of the matrix can see what this is aiming at without being able to mistake it for
 * what has been shown.
 *
 * ⭐ TWO PROFILES, BECAUSE THEY FAIL DIFFERENTLY.
 *   pi-extension       the native surface: getContextUsage, agent_settled, ctx.compact, session_compact,
 *                      before_agent_start injection. It can MEASURE and it can TRIGGER — and it only
 *                      loads when the project is trusted; non-interactive runs can use `--approve`.
 *   pi-rpc-supervisor  the managed surface: an out-of-process driver over `pi --mode rpc`. It can compact
 *                      and observe both documented signals — and it cannot measure context at all, because
 *                      no RPC command reports context usage.
 * A single merged profile would have had to average those into one misleading row.
 *
 * ⛔ AND UNATTENDED WRITE MODE IS NOT ONE OF THE SEVEN CAPABILITIES. core's `CAPABILITIES` list is closed
 * (declare() throws on anything else) and rightly so — it describes the ROLLOVER interface. Unattended
 * write is an operating MODE layered on top, so it is declared by this adapter's own
 * `declareUnattendedWrite()`, in core's SUPPORT vocabulary, reusing core's `canaryUsable` for the gate. It
 * is reported beside the matrix, never inside it.
 */
'use strict';
const path = require('path');

const bridge = require('./bridge/rollover-bridge.js');

const core = bridge.core;
const { capabilities } = core;
const { SUPPORT } = capabilities;

const PROFILE_EXTENSION = 'pi-extension';
const PROFILE_RPC = 'pi-rpc-supervisor';

/** 30 days — the same window adapters/codex/profile.js uses. One pack, one staleness rule. */
const CANARY_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;

const DOCS = {
  extension: ['adapters/pi/package/extensions/respawnpack-rollover.ts', 'adapters/pi/bridge/rollover-bridge.js', 'adapters/pi/README.md'],
  rpc: ['adapters/pi/rpc-supervisor/supervisor.js', 'adapters/pi/bridge/rpc-frames.js', 'adapters/pi/README.md'],
  isolation: ['adapters/pi/canaries/canary-isolation.js', 'adapters/pi/README.md'],
};

/**
 * Read one canary marker and decide whether it is USABLE: present, asserting it ran, and FRESH.
 *
 * Freshness is checked ON TOP of core's `canaryUsable()`, never instead of it — core checks shape, this
 * adds the judgement call about how old is too old to keep calling a thing active.
 *
 * @returns {{present, usable, canary, why}}
 */
function readCanary(projectDir, name, { now = Date.now, maxAgeMs = CANARY_FRESHNESS_MS } = {}) {
  const read = name === 'extension' ? bridge.readExtensionCanary(projectDir) : bridge.readCanaryMarker(projectDir, name);
  const where = name === 'extension' ? bridge.extensionCanaryPath(projectDir) : bridge.canaryMarkerPath(projectDir, name);
  if (!read.present) {
    return { present: false, usable: false, canary: null, why: `no ${name} canary marker at ${where} — nothing has proven this surface live in this project` };
  }
  const doc = read.doc;
  const ageMs = now() - Date.parse((doc && doc.at) || '');
  if (!Number.isFinite(ageMs)) return { present: true, usable: false, canary: null, why: `the ${name} canary marker has no parseable observation time` };
  if (doc.ran !== true) return { present: true, usable: false, canary: null, why: `the ${name} canary marker does not assert that anything ran` };
  /*
   * ⛔ A DEGRADED MARKER IS WELL-FORMED AND MEANS THE OPPOSITE OF WHAT IT LOOKS LIKE. The extension writes
   * one when it fired and could NOT load its bridge: `ran: true`, a real timestamp, a verbatim payload —
   * everything core's `canaryUsable()` checks for, on a run where the extension measured nothing,
   * compacted nothing and injected nothing. Shape-checking alone would promote an INERT extension to
   * SUPPORTED, which is precisely the "installed files look like a working integration" failure the
   * canary rule exists to prevent. Checked here, on top of core's shape check, never instead of it.
   */
  if (doc.degraded === true) {
    return {
      present: true, usable: false, canary: null,
      why: `the ${name} canary marker is stamped degraded: the extension fired and could not load its bridge, so it is INERT (${doc.degradedReason || 'no reason recorded'})`,
    };
  }
  if (ageMs > maxAgeMs) {
    return {
      present: true, usable: false, canary: null,
      why: `the last ${name} observation was ${Math.floor(ageMs / 86400000)} day(s) ago, past the ${Math.round(maxAgeMs / 86400000)}-day freshness window — re-run adapters/pi/canaries/canary-${name}.js`,
    };
  }
  return {
    present: true, usable: true,
    canary: { kind: doc.kind || `pi-${name}-canary`, observedAt: doc.at, ran: true, raw: doc.raw === undefined ? doc : doc.raw },
    why: null,
  };
}

/**
 * `capabilities.declare()` downgrades a canary-less claim with its own generic message ("no activation
 * canary was supplied"), which is right for "never ran" and says nothing about a marker that exists and
 * is merely STALE. This wrapper calls declare() normally — core's validation is never bypassed — and
 * replaces only the `why` in the present-but-unusable case. `support` and `downgraded` are core's.
 * (The pattern is adapters/codex/profile.js's `declareCanaryGated`, credited.)
 */
function declareCanaryGated(args, read) {
  const d = capabilities.declare(args);
  if (d.downgraded && read.present && !read.usable && read.why) return { ...d, why: `${args.support} was claimed and ${read.why}` };
  return d;
}

// =====================================================================================================
// pi-extension — the native surface
// =====================================================================================================

function declareExtension(projectDir, opts = {}) {
  const read = readCanary(projectDir, 'extension', opts);
  const canary = read.usable ? read.canary : null;

  const declarations = [
    declareCanaryGated({
      capability: 'probe',
      support: SUPPORT.SUPPORTED,
      canary,
      mechanism: 'the extension writes _pi-extension-canary.json the first time Pi calls it (session_start), and refreshes it on every firing',
      docs: DOCS.extension,
    }, read),

    declareCanaryGated({
      capability: 'measureContext',
      support: SUPPORT.SUPPORTED_WITH_LIMITATIONS,
      canary,
      mechanism: 'ctx.getContextUsage() → usage.tokens, divided by (contextWindow − reserveTokens); see bridge/rollover-bridge.js measureContext()',
      limitations: [
        'getContextUsage() returns TOKENS ONLY — there is no percentage field and no context-window field, so the denominator must come from somewhere else',
        'when the context window is operator-configured rather than host-reported, the ratio is stamped capacityAssumed and the FINAL threshold requires operator confirmation; with no window at all the measurement is CANNOT_DETERMINE and never fires',
        'reserveTokens defaults to Pi\'s documented 16384 when the real setting cannot be read, and the record says it was defaulted',
      ],
      docs: DOCS.extension,
    }, read),

    declareCanaryGated({
      capability: 'settleOrStop',
      support: SUPPORT.SUPPORTED,
      canary,
      mechanism: 'the agent_settled event — documented as the point where no automatic retry, compaction retry, or queued continuation remains',
      docs: DOCS.extension,
    }, read),

    declareCanaryGated({
      capability: 'requestCompact',
      support: SUPPORT.SUPPORTED,
      canary,
      mechanism: 'ctx.compact({customInstructions, onComplete, onError}) — a documented, callable API, which is why the extension profile can do what the interactive Claude and Codex profiles cannot',
      docs: DOCS.extension,
    }, read),

    declareCanaryGated({
      capability: 'observeCompact',
      support: SUPPORT.SUPPORTED_WITH_LIMITATIONS,
      canary,
      mechanism: 'the session_compact event {compactionEntry, fromExtension, reason, willRetry}',
      limitations: [
        'core/lifecycle/evidence.js declares this signal `pi_session_compact` with documented:false, so every completion record built from it is flagged PROVISIONAL until an install confirms the payload shape',
        'willRetry:true is NOT a completion — Pi intends another attempt, and the bridge keeps the machine in COMPACTING rather than advancing the cycle',
      ],
      docs: DOCS.extension,
    }, read),

    declareCanaryGated({
      capability: 'injectHandoff',
      support: SUPPORT.SUPPORTED_WITH_LIMITATIONS,
      canary,
      mechanism: 'before_agent_start returns {message}, gated by the wx consumption receipt in core/lifecycle/consumable.js',
      limitations: [
        'Pi has NO duplicate-delivery guard of its own (pi.sendMessage will deliver twice if called twice) — exactly-once is entirely RespawnPack\'s receipt, so it holds only for deliveries that go through this bridge',
        'the receipt proves the handoff was CLAIMED once; whether the model read the injected text is a separate and currently unobservable question',
      ],
      docs: DOCS.extension,
    }, read),

    declareCanaryGated({
      capability: 'resume',
      support: SUPPORT.SUPPORTED_WITH_LIMITATIONS,
      canary,
      mechanism: 'the same Pi session id observed after the compaction as before it; compaction appends a CompactionEntry to the same session file',
      limitations: [
        'no Pi documentation states that a session id NEVER changes across compaction, so the check is empirical per rollover and is not satisfied by earlier rollovers having agreed',
        'the compaction documentation\'s phrase "fresh routing session IDs" is a PROVIDER CACHE concept, not a Pi session id — it must not be read as evidence either way',
      ],
      docs: DOCS.extension,
    }, read),
  ];

  const matrix = capabilities.matrix(PROFILE_EXTENSION, declarations);
  return { ...matrix, canaryStatus: read, trustNote: TRUST_NOTE };
}

const TRUST_NOTE = 'Project extensions (.pi/extensions/*.ts) are TRUST-GATED, and `pi --mode rpc`, `pi -p` and '
  + '`pi --mode json` do not show a trust prompt. Interactive Pi can save trust with `/trust`; non-interactive '
  + 'runs can opt in for one run with `--approve`. The respawn-pi RPC supervisor uses `--approve` by default.';

// =====================================================================================================
// pi-rpc-supervisor — the managed surface
// =====================================================================================================

function declareRpc(projectDir, opts = {}) {
  const read = readCanary(projectDir, 'rpc', opts);
  const canary = read.usable ? read.canary : null;

  const declarations = [
    declareCanaryGated({
      capability: 'probe',
      support: SUPPORT.SUPPORTED,
      canary,
      mechanism: '`where pi` / `command -v pi` then `pi --version`, then an attached `pi --mode rpc` answering get_state — recorded verbatim by supervisor.probe()',
      docs: DOCS.rpc,
    }, read),

    capabilities.declare({
      capability: 'measureContext',
      support: SUPPORT.NOT_SUPPORTED,
      why: 'no documented `pi --mode rpc` command reports context usage. ctx.getContextUsage() lives on the extension surface, so the managed RPC profile has no independent measurement of its own. Counting get_messages output would be a byte proxy presented as a token reading, which core/lifecycle/evidence.js grades PROXY for exactly this reason.',
      docs: DOCS.rpc,
    }),

    declareCanaryGated({
      capability: 'settleOrStop',
      support: SUPPORT.SUPPORTED_WITH_LIMITATIONS,
      canary,
      mechanism: 'waiting for an agent_settled event on the RPC stream (supervisor.SETTLE_EVENT_NAMES)',
      limitations: [
        'agent_settled is documented on the EXTENSION event surface; whether the RPC stream emits it at all is unverified until an install shows one',
        'there is deliberately NO fallback: a command response coming back does not observe "no automatic retry, compaction retry, or queued continuation remains", which is Pi\'s own definition of settled',
      ],
      docs: DOCS.rpc,
    }, read),

    declareCanaryGated({
      capability: 'requestCompact',
      support: SUPPORT.SUPPORTED,
      canary,
      mechanism: 'the documented `compact` command, sent as a correlated JSONL frame',
      docs: DOCS.rpc,
    }, read),

    declareCanaryGated({
      capability: 'observeCompact',
      support: SUPPORT.SUPPORTED_WITH_LIMITATIONS,
      canary,
      mechanism: 'the dual signal: a {command:"compact", success:true} response AND a compaction_end event, both awaited, with which arrived recorded',
      limitations: [
        'a rollover proven by only ONE of the two signals is recorded standing:PARTIAL — real evidence with a named limitation, never the same claim as both arriving',
        'the response alone is an ACK of the request; only compaction_end reports what happened, and only when it carries neither aborted:true nor willRetry:true',
        'which envelope key names an event (`event` / `type` / `kind` / …) is unverified; bridge/rpc-frames.js accepts several and records which one matched',
        'core declares only `pi_session_compact` for this host, so an RPC completion record carries that declared name with hostSignal:"compaction_end" beside it — see the bridge banner',
      ],
      docs: DOCS.rpc,
    }, read),

    declareCanaryGated({
      capability: 'injectHandoff',
      support: SUPPORT.SUPPORTED_WITH_LIMITATIONS,
      canary,
      mechanism: 'the `follow_up` command (underscored) carrying the consumed handoff, gated by the wx receipt',
      limitations: [
        'Pi has no exactly-once guard; the receipt is RespawnPack\'s and covers deliveries made through this supervisor only',
        'whether follow_up or prompt is the right verb for injected continuation context is a judgement, not a documented rule — the command used is recorded on every run',
      ],
      docs: DOCS.rpc,
    }, read),

    declareCanaryGated({
      capability: 'resume',
      support: SUPPORT.SUPPORTED_WITH_LIMITATIONS,
      canary,
      mechanism: 'get_state before and after the compaction, comparing sessionId — a FRESH read each time, never the same variable twice',
      limitations: [
        'same empirical caveat as the extension profile: no documentation states the id cannot change',
        'Pi has NO competing-client protection, so the identity check is only meaningful while this supervisor holds the exclusive session lock (rpc-supervisor/session-lock.js)',
      ],
      docs: DOCS.rpc,
    }, read),
  ];

  const matrix = capabilities.matrix(PROFILE_RPC, declarations);
  return { ...matrix, canaryStatus: read, lockNote: LOCK_NOTE };
}

const LOCK_NOTE = 'Pi arbitrates nothing between two clients on one session. Every capability above is conditional on '
  + 'this supervisor holding the exclusive `wx` session lock: without it, an agent_settled or a compaction_end this '
  + 'supervisor attributes to its own request may be the answer to somebody else\'s, and no later check can tell.';

// =====================================================================================================
// unattended write mode — a MODE, gated by the isolation canary, and not one of the seven
// =====================================================================================================

const UNATTENDED_WRITE = 'unattendedWrite';

/**
 * @returns {{capability:'unattendedWrite', support, declaredSupport, downgraded, why, limitations, gate, canary}}
 *          Declaration-SHAPED so a matrix renderer can print it beside the seven, and explicitly NOT part
 *          of core's matrix — see this file's banner.
 */
function declareUnattendedWrite(projectDir, opts = {}) {
  const read = readCanary(projectDir, 'isolation', opts);
  const usable = read.usable ? capabilities.canaryUsable(read.canary) : { ok: false, why: read.why };

  const base = {
    capability: UNATTENDED_WRITE,
    declaredSupport: SUPPORT.NOT_SUPPORTED,
    gate: 'adapters/pi/canaries/canary-isolation.js',
    limitations: [],
    canary: read.usable ? read.canary : null,
    docs: DOCS.isolation,
    partOfCoreMatrix: false,
  };

  if (!usable.ok) {
    return {
      ...base,
      support: SUPPORT.NOT_SUPPORTED,
      downgraded: false,
      why: `Pi ships NO built-in sandbox (its own documentation, verbatim), and ${usable.why}. An unattended agent with write tools and no PROVEN boundary is not a configuration this adapter will enable: `
        + 'run canary-isolation.js with your real isolation wrapper and have it PASS first. Default profiles stay read-only / ask-first.',
    };
  }

  return {
    ...base,
    support: SUPPORT.SUPPORTED_WITH_LIMITATIONS,
    downgraded: false,
    limitations: [
      'the canary proved ONE filesystem-write boundary held for ONE probe; it is not a security assessment and says nothing about network egress, credentials readable inside the sandbox, or what the sandbox can reach',
      'the proof is bound to the exact isolation command recorded in the marker — a different wrapper, or an edited one, is an unproven boundary again',
      'a passing canary is the PRECONDITION for enabling unattended write mode, not the decision to enable it',
    ],
    why: `the isolation canary passed at ${read.canary.observedAt}: a probe that provably writes on this host was denied that write inside the supplied boundary`,
  };
}

/** Everything a status command needs, in one call. */
function declareAll(projectDir, opts = {}) {
  return {
    project: path.resolve(projectDir),
    profiles: {
      [PROFILE_EXTENSION]: declareExtension(projectDir, opts),
      [PROFILE_RPC]: declareRpc(projectDir, opts),
    },
    unattendedWrite: declareUnattendedWrite(projectDir, opts),
    plannedTargets: {
      'pi/extension': capabilities.PLANNED['pi/extension'],
      'pi/rpc-supervisor': capabilities.PLANNED['pi/rpc-supervisor'],
    },
  };
}

module.exports = {
  PROFILE_EXTENSION, PROFILE_RPC, UNATTENDED_WRITE, CANARY_FRESHNESS_MS, TRUST_NOTE, LOCK_NOTE, DOCS,
  readCanary, declareCanaryGated, declareExtension, declareRpc, declareUnattendedWrite, declareAll,
};

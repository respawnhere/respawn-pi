/*
 * RespawnPack · Pi extension — the native rollover profile.
 *
 * ⛔ THIS FILE IS DELIBERATELY THE THINNEST PART OF THE ADAPTER, AND THE REASON IS TESTABILITY, NOT STYLE.
 * Pi loads extensions as TypeScript and runs them itself. RespawnPack has NO TypeScript toolchain and must
 * not grow one — so nothing in this file can be reached by `node --test`, which means any invariant
 * written here would be checked by reading it and by nothing else. Every decision therefore lives in
 * `../../bridge/rollover-bridge.js` (CommonJS, driven directly by adapters/pi/pi-adapter.test.mjs): what a
 * measurement means, when a threshold fires, whether a compaction was observed, whether the conversation
 * is the same one, whether a handoff may be delivered. What is left here is: call Pi's API, hand the
 * payload over VERBATIM, do what the bridge says.
 *
 * ⛔ AND IT IS WRITTEN AS PLAIN MODERN JAVASCRIPT — no type annotations, no enums, no decorators, no
 * namespaces, no parameter properties. Every valid JavaScript file is valid TypeScript, so this loads as
 * either; nothing in it has TypeScript-only runtime semantics that could behave differently once erased.
 * If you add an annotation later, keep it type-level: the moment this file needs compiling, the pack needs
 * a toolchain, and the split above stops paying for itself.
 *
 * ⭐ WHAT IT DOES, in the order Pi calls it:
 *   session_start          record the session id as the identity baseline; write the ACTIVATION CANARY
 *   before_agent_start     deliver a pending handoff — through the bridge's exactly-once receipt — or nothing
 *   agent_settled          THE safe boundary: measure, and if the final threshold fires, write+verify the
 *                          handoff and call ctx.compact()
 *   session_before_compact record that a compaction is starting (observational only)
 *   session_compact        verify it completed and that the session id survived; arm the injection
 *
 * ⛔ agent_end IS NOT HANDLED, ON PURPOSE. Pi documents `agent_settled` as the point where "no automatic
 * retry, compaction retry, or queued continuation remains"; `agent_end` can be followed by any of those
 * three. Compacting at agent_end would cut a turn Pi still intends to finish.
 *
 * ⛔ FINDING THE BRIDGE IS A REAL PRECONDITION AND IT REPORTS ITSELF. The standalone respawn-pi package
 * includes the CommonJS bridge and core. It is located relative to this file, by RESPAWN_PI_BRIDGE, or by
 * a small list of compatibility paths. When it cannot be found, this extension
 * goes INERT — it never guesses, never compacts, never injects — and writes an activation marker stamped
 * `degraded: true` with the load error, so `canary-extension.js` reports "the extension fired but could
 * not load its bridge" instead of the wrong diagnosis, "the extension never fired".
 */

import { loadPackageGoalContract } from './goal-contract-loader.ts';

const EXTENSION_NAME = 'respawn-pi-rollover';

function sessionSessionStartNonce() {
  // R11: per-run nonce baked into the activation marker. The shell wraps `pi` and
  // exports RESPAWNPACK_CANARY_NONCE=<random hex>; we copy it into the marker so the canary
  // can prove the marker it just read came from THIS Pi invocation, not from a stale
  // forger.
  const nonce = typeof process !== 'undefined' && process.env && process.env.RESPAWNPACK_CANARY_NONCE;
  return typeof nonce === 'string' && nonce ? nonce : null;
}

/** Everything mutable this extension holds, per Pi process. Small on purpose: the journal on disk is the state. */
const state = {
  bridge: null,
  bridgeError: null,
  projectDir: null,
  sessionId: null,
  baselineSessionId: null,
  machine: null,
  lastDecision: null,
  pendingHandoffId: null,
  registeredVia: null,
  // Goal-mode wiring. Populated at session_start when .respawnpack/runtime/contract.json says mode:goal
  // and docs/goal.md parses cleanly. goalThresholds is passed to bridge.decide() so the per-goal
  // contextStages (e.g. {checkpoint:60, closeout:75, handoff:85}) drive the lifecycle instead of the
  // global defaults. See scripts/goal-contract.mjs and D-005 for the contract.
  goalMode: null,
  goalThresholds: null,
  goalContractRef: null,
};

/**
 * Goal-mode contract loader. Imported via dynamic import() so this file stays a plain modern-JS module
 * that doubles as TypeScript — the goal-contract module is the ESM single-source-of-truth for the
 * durable goal.md shape, the runtime contract.json pointer, and the threshold mapping. Returns
 * `{ok, mode, thresholds, contract}` or `{ok:false, reason}`; a miss (no goal.md, no contract.json)
 * is treated as no-goal-mode, never as an error.
 */
async function loadGoalContract(projectDir) {
  try {
    const gc = await loadPackageGoalContract();
    if (!gc || typeof gc.readGoalMd !== 'function' || typeof gc.readRuntimeContract !== 'function' || typeof gc.thresholdsForGoal !== 'function') {
      return { ok: false, reason: 'package goal-contract module has an invalid interface' };
    }
    const durable = gc.readGoalMd(projectDir);
    if (!durable.ok) return { ok: false, reason: `goal.md: ${durable.reason}` };
    const runtime = gc.readRuntimeContract(projectDir);
    if (!runtime.ok || !runtime.contract) return { ok: false, reason: `contract.json: ${runtime.reason}` };
    if (runtime.contract.activeGoalId !== durable.goal.goalId) return { ok: false, reason: `contract.json activeGoalId (${runtime.contract.activeGoalId}) does not match docs/goal.md goalId (${durable.goal.goalId})` };
    const t = gc.thresholdsForGoal(durable.goal);
    if (!t.ok) return { ok: false, reason: `thresholdsForGoal: ${t.reason}` };
    return { ok: true, mode: 'goal', thresholds: t.thresholds, contract: runtime.contract, goal: durable.goal };
  } catch (e) {
    return { ok: false, reason: `loadGoalContract failed: ${String((e && e.message) || e)}` };
  }
}

// ---------------------------------------------------------------------------------------------------
// loading the bridge
// ---------------------------------------------------------------------------------------------------

/**
 * Dynamic `import()` loads the CommonJS bridge without a compile step. The source-relative candidate is
 * tried first so a normal installation needs no environment variable.
 */
async function loadBridge(cwd) {
  const nodePath = await import('node:path');
  const nodeUrl = await import('node:url');
  const path = nodePath.default || nodePath;
  const url = nodeUrl.default || nodeUrl;
  const pathToFileURL = url.pathToFileURL;
  const fileURLToPath = url.fileURLToPath;

  const candidates = [];
  const fromEnv = typeof process !== 'undefined' && process.env
    && (process.env.RESPAWN_PI_BRIDGE || process.env.RESPAWNPACK_PI_BRIDGE);
  if (fromEnv) candidates.push(fromEnv);
  candidates.push(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bridge', 'rollover-bridge.js'));
  const root = cwd || (typeof process !== 'undefined' ? process.cwd() : '.');
  candidates.push(path.join(root, 'adapters', 'pi', 'bridge', 'rollover-bridge.js'));
  candidates.push(path.join(root, '.pi', 'respawnpack', 'bridge', 'rollover-bridge.js'));
  candidates.push(path.join(root, 'node_modules', 'respawnpack', 'adapters', 'pi', 'bridge', 'rollover-bridge.js'));

  const tried = [];
  for (const candidate of candidates) {
    try {
      const mod = await import(pathToFileURL(candidate).href);
      const bridge = mod && (mod.default || mod);
      if (bridge && typeof bridge.openMachine === 'function') return { ok: true, bridge, from: candidate, tried };
      tried.push({ candidate, error: 'loaded, but does not look like the RespawnPack Pi bridge' });
    } catch (e) {
      tried.push({ candidate, error: String((e && e.message) || e) });
    }
  }
  return { ok: false, bridge: null, from: null, tried };
}

/** The inert-mode marker. The ONLY file this extension writes without the bridge, and it exists so a
 * missing bridge is diagnosed as a missing bridge. Kept to a fixed shape with no decisions in it. */
async function writeDegradedMarker(projectDir, event, sessionId, tried) {
  try {
    const nodeFs = await import('node:fs');
    const nodePath = await import('node:path');
    const fs = nodeFs.default || nodeFs;
    const path = nodePath.default || nodePath;
    const dir = path.join(projectDir, '.respawnpack', 'runtime', 'rollover');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '_pi-extension-canary.json'), `${JSON.stringify({
      schemaVersion: '1.0.0',
      kind: 'pi-extension-activation-canary',
      event: event || null,
      at: new Date().toISOString(),
      sessionId: sessionId || null,
      ran: true,
      degraded: true,
      degradedReason: 'the extension loaded and fired, and could not load ../../bridge/rollover-bridge.js — it is INERT: no measurement, no compaction, no injection',
      recovery: 'Reinstall respawn-pi, or set RESPAWN_PI_BRIDGE to the absolute path of adapters/pi/bridge/rollover-bridge.js, then restart Pi.',
      triedPaths: tried,
      raw: { tried },
    }, null, 2)}\n`);
  } catch { /* nothing left to tell; the extension stays inert either way */ }
}

async function ensureBridge(ctx, event) {
  if (state.bridge) return state.bridge;
  state.projectDir = projectDirOf(ctx);
  const loaded = await loadBridge(state.projectDir);
  if (!loaded.ok) {
    state.bridgeError = loaded.tried;
    await writeDegradedMarker(state.projectDir, event, state.sessionId, loaded.tried);
    return null;
  }
  state.bridge = loaded.bridge;
  return state.bridge;
}

// ---------------------------------------------------------------------------------------------------
// tiny readers over Pi's context object — every one of them tolerates the field being absent
// ---------------------------------------------------------------------------------------------------

function projectDirOf(ctx) {
  const c = ctx || {};
  if (typeof c.projectDir === 'string' && c.projectDir) return c.projectDir;
  if (typeof c.cwd === 'string' && c.cwd) return c.cwd;
  if (c.session && typeof c.session.projectDir === 'string' && c.session.projectDir) return c.session.projectDir;
  return typeof process !== 'undefined' ? process.cwd() : '.';
}

function sessionIdOf(ctx, payload) {
  const p = payload || {};
  const c = ctx || {};
  if (typeof p.sessionId === 'string' && p.sessionId) return p.sessionId;
  if (typeof c.sessionId === 'string' && c.sessionId) return c.sessionId;
  if (c.session && typeof c.session.id === 'string' && c.session.id) return c.session.id;
  if (c.sessionManager && typeof c.sessionManager.getSessionId === 'function') {
    try { const v = c.sessionManager.getSessionId(); if (typeof v === 'string' && v) return v; } catch { /* absent */ }
  }
  if (typeof c.getSessionId === 'function') { try { const v = c.getSessionId(); if (typeof v === 'string' && v) return v; } catch { /* absent */ } }
  return null;
}

/** `ctx.getContextUsage()` → `usage.tokens`. NO percentage field exists; the denominator comes from elsewhere. */
async function readUsage(ctx) {
  const c = ctx || {};
  if (typeof c.getContextUsage !== 'function') return { tokens: null, raw: { error: 'ctx.getContextUsage is not a function on this Pi version' } };
  try {
    const usage = await c.getContextUsage();
    const u = usage || {};
    const tokens = typeof u.tokens === 'number' ? u.tokens : (u.usage && typeof u.usage.tokens === 'number' ? u.usage.tokens : null);
    const modelWindow = c.model && typeof c.model.contextWindow === 'number' ? c.model.contextWindow : null;
    const contextWindow = typeof u.contextWindow === 'number' ? u.contextWindow : modelWindow;
    const reserveTokens = typeof u.reserveTokens === 'number' ? u.reserveTokens : null;
    return { tokens, contextWindow, reserveTokens, raw: usage };
  } catch (e) {
    return { tokens: null, raw: { error: String((e && e.message) || e) } };
  }
}

/**
 * The context window, and WHERE it came from. Pi's own usage object is preferred; an operator-configured
 * value is accepted and REPORTED AS SUCH, because the bridge grades a configured denominator differently
 * from a host-reported one. Anything else is null — never a default that looks like a reading.
 */
function windowFor(usage) {
  if (usage && typeof usage.contextWindow === 'number' && usage.contextWindow > 0) {
    return { contextWindow: usage.contextWindow, windowSource: 'host-reported' };
  }
  const configured = typeof process !== 'undefined' && process.env && Number(process.env.RESPAWNPACK_PI_CONTEXT_WINDOW);
  if (Number.isFinite(configured) && configured > 0) return { contextWindow: configured, windowSource: 'operator-configured' };
  return { contextWindow: null, windowSource: null };
}

function reserveFor(usage) {
  if (usage && typeof usage.reserveTokens === 'number' && usage.reserveTokens >= 0) return usage.reserveTokens;
  const configured = typeof process !== 'undefined' && process.env && Number(process.env.RESPAWNPACK_PI_RESERVE_TOKENS);
  return Number.isFinite(configured) && configured >= 0 ? configured : null;
}

function say(ctx, message) {
  try {
    if (ctx && ctx.ui && typeof ctx.ui.notify === 'function') { ctx.ui.notify(`respawn-pi: ${message}`, 'info'); return; }
  } catch { /* fall through */ }
  try {
    if (ctx && typeof ctx.log === 'function') { ctx.log(`respawn-pi: ${message}`); return; }
  } catch { /* fall through */ }
  try { if (typeof console !== 'undefined') console.error(`respawn-pi: ${message}`); } catch { /* nothing left */ }
}

// ---------------------------------------------------------------------------------------------------
// the event handlers
// ---------------------------------------------------------------------------------------------------

async function onSessionStart(ctx, payload) {
  const bridge = await ensureBridge(ctx, 'session_start');
  state.sessionId = sessionIdOf(ctx, payload);
  if (!bridge) { say(ctx, 'the rollover bridge could not be loaded — this extension is INERT. See .respawnpack/runtime/rollover/_pi-extension-canary.json.'); return undefined; }

  bridge.refreshExtensionCanary(state.projectDir, { event: 'session_start', sessionId: state.sessionId, raw: payload === undefined ? null : payload, nonce: sessionSessionStartNonce() });
  if (!state.sessionId) { say(ctx, 'Pi exposed no session id at session_start; rollover bookkeeping is disabled for this session.'); return undefined; }

  // ⛔ ⛔ ORPHAN DETECTION. Run BEFORE opening the machine so abnormal previous exits can surface
  // as a single line of carry-over context to the lead before the first tool call.

  // 1) ORPHAN DETECTION — the dogfood (§4.1, §4.4) showed rollover state staying "ACTIVE" for minutes
  // after a process died with no exit handler. detectOrphanSession re-reads the lifecycle marker and,
  // if the recorded pid is dead, writes a halted marker retroactively. Returns the orphan's lastEvent
  // so we can surface it. We do NOT fail session_start if this throws — orphan detection is a hint,
  // not a precondition.
  try {
    const orphan = bridge.detectOrphanSession(state.projectDir);
    state.lastOrphan = orphan || { orphan: false };
    if (orphan && orphan.orphan === true) {
      say(ctx, `respawn-pi: previous session (pid ${orphan.lastLifecycle && orphan.lastLifecycle.pid}) ended abnormally at ${orphan.lastLifecycle && orphan.lastLifecycle.at}; marked halted. Last seen event: ${(orphan.lastLifecycle && orphan.lastLifecycle.lastEvent && orphan.lastLifecycle.lastEvent.kind) || 'unknown'}.`);
    } else if (orphan && orphan.orphan === 'unknown') {
      say(ctx, 'respawn-pi: previous lifecycle marker pre-dates pid recording; cannot tell live from dead.');
    }
  } catch (e) {
    say(ctx, `respawn-pi: orphan detection failed: ${(e && e.message) || e}`);
  }

  const opened = bridge.openMachine({ projectDir: state.projectDir, sessionId: state.sessionId });
  if (!opened.ok) { say(ctx, `the rollover journal could not be opened: ${opened.failure.detail}`); return undefined; }
  state.machine = opened.machine;
  state.baselineSessionId = state.sessionId;

  // ⭐ GOAL-MODE RESOLUTION. Runs AFTER the machine is opened so the lifecycle is unaffected by a
  // missing goal.md or stale contract.json. A successful resolution populates state.goalThresholds,
  // which agent_settled passes to bridge.decide() so the per-goal contextStages drive the ladder
  // instead of the global defaults. A failure is silent — no goal mode, the bridge uses defaults.
  try {
    const gc = await loadGoalContract(state.projectDir);
    if (gc.ok) {
      state.goalMode = gc.mode;
      state.goalThresholds = gc.thresholds;
      state.goalContractRef = { goalId: gc.contract.activeGoalId, atomicTask: gc.contract.currentAtomicTask || null };
      say(ctx, `goal-mode active: ${gc.contract.activeGoalId} — ${gc.contract.goal || '(no goal text)'} (thresholds: ${gc.thresholds.advisory}/${gc.thresholds.checkpoint}/${gc.thresholds.final})`);
    } else {
      state.goalMode = null;
      state.goalThresholds = null;
      state.goalContractRef = null;
    }
  } catch { state.goalMode = null; state.goalThresholds = null; state.goalContractRef = null; }

  // ⛔ PROCESS EXIT HANDLERS. Registered on the FIRST session_start after bridge load, never again.
  // The handlers write a halted marker synchronously and never call into the bridge's async surface
  // — process.on('exit') is the LAST thing that runs, and the event loop is no longer draining. The
  // ONLY writes we do here are sync fs.writeFileSync of a small JSON file. They run on:
  //   • process.on('exit')        — clean exit (code 0) or process.exit() with non-zero; fires once
  //   • process.on('SIGTERM')      — Pi / the OS asked for graceful shutdown
  //   • process.on('SIGINT')       — Ctrl+C (interactive shell)
  // They do NOT run on SIGKILL. Orphan detection (above) is the fallback for the SIGKILL case.
  if (!state.exitHandlersInstalled) {
    state.lastEvent = { kind: 'session_start', at: new Date().toISOString() };
    const writeHaltedOnExit = (reason) => {
      try {
        if (state.machine && state.machine.dir && state.sessionId) {
          // We intentionally do NOT call bridge.writeHaltedMarker (async / IO under the bridge name)
          // because process.on('exit') runs after the event loop is empty — we mirror the shape of
          // bridge.writeHaltedMarker's JSON synchronously, keeping the marker file's contract identical.
          // The bridge's readLifecycleMarker can parse this either way (no schema difference).
          const fs = require('node:fs');
          const path = require('node:path');
          const markerPath = path.join(state.projectDir, '.respawnpack', 'runtime', 'rollover', '_pi-session-lifecycle.json');
          const doc = {
            schemaVersion: '1.0.0',
            kind: 'pi-session-lifecycle',
            at: new Date().toISOString(),
            sessionId: state.sessionId,
            outcome: 'halted',
            reason,
            lastEvent: state.lastEvent || null,
            pid: process.pid,
            verifiedHandoff: null,
          };
          fs.writeFileSync(markerPath, JSON.stringify(doc, null, 2) + '\n');
        }
      } catch { /* the only safe thing left to do is nothing */ }
    };
    process.on('exit', (code) => {
      // code is 0 on clean exit AND on session_shutdown; we still write a halted marker here because
      // we don't actually know the difference, and the lifecycle marker's `outcome` field names what
      // happened — session_shutdown's onSessionShutdown handler will overwrite this with outcome:
      // 'session_end' BEFORE this fires (Node fires 'exit' AFTER all 'beforeExit' handlers complete).
      // The clean exit case: session_shutdown wrote session_end first; exit overwrites with halted.
      // ⛔ THAT'S A BUG. We only write halted if the lastOutcome was NOT session_end. See below.
      if (state.lastOutcome !== 'session_end') {
        writeHaltedOnExit(`process exited with code ${code}; last event: ${(state.lastEvent && state.lastEvent.kind) || 'unknown'}`);
      }
    });
    process.on('SIGTERM', () => writeHaltedOnExit('SIGTERM received'));
    process.on('SIGINT', () => writeHaltedOnExit('SIGINT received'));
    state.exitHandlersInstalled = true;
  }

  return undefined;
}

/**
 * Clean session exit. Pi emits `session_shutdown` (used here) and `session_end` (not wired by
 * respawn-pi). This handler writes the canonical session_end marker so the next session sees a
 * normal "this session ended cleanly" rather than inferring it from "no halted marker exists."
 *
 * We also flip `state.lastOutcome` so the process.on('exit') guard above does NOT overwrite the
 * session_end marker with halted on a clean exit. Without that guard the race would write halted
 * AFTER session_end, every clean exit, and the marker would lie.
 */
async function onSessionShutdown(ctx, payload) {
  const bridge = state.bridge;
  if (!bridge || !state.projectDir || !state.sessionId) return undefined;
  try {
    const last = state.lastEvent || { kind: 'session_shutdown', at: new Date().toISOString() };
    bridge.writeSessionEndMarker(state.projectDir, { sessionId: state.sessionId, lastEvent: last });
    state.lastOutcome = 'session_end';
    bridge.appendEvent(state.machine ? state.machine.dir : null, { kind: 'session_shutdown', raw: payload === undefined ? null : payload });
  } catch { /* the best we can do */ }
  return undefined;
}

/**
 * The injection point. Returns `{message}` when — and only when — the bridge's exactly-once receipt was
 * claimed by THIS call. A second firing gets nothing, which is the guard Pi does not provide.
 */
async function onBeforeAgentStart(ctx, payload) {
  const bridge = state.bridge;
  if (!bridge || !state.machine) return undefined;

  const pending = bridge.readPendingInjection(state.machine.dir);
  if (!pending) return undefined;

  const claimed = bridge.injectOnce({
    dir: state.machine.dir,
    handoffId: pending.handoffId,
    consumerId: `pi-extension:${state.sessionId}`,
    machine: state.machine,
  });
  bridge.appendEvent(state.machine.dir, { kind: 'before_agent_start', handoffId: pending.handoffId, status: claimed.status, raw: payload === undefined ? null : payload });
  state.lastEvent = { kind: 'before_agent_start', at: new Date().toISOString(), handoffId: pending.handoffId };

  if (claimed.status !== 'CONSUMED') {
    if (claimed.status === 'ALREADY_CONSUMED') say(ctx, `handoff ${pending.handoffId} was already delivered; it will not be sent again.`);
    return undefined;
  }
  return {
    message: {
      customType: 'respawn-pi-handoff',
      content: bridge.renderInjection(claimed.handoff, { identityConfirmed: pending.identityConfirmed === true }),
      display: true,
      details: { handoffId: pending.handoffId },
    },
  };
}

/**
 * THE safe boundary. Everything decided here is decided by the bridge; this function measures, asks, and
 * either does what it is told or reports why it is not doing it.
 */
async function onAgentSettled(ctx, payload) {
  const bridge = state.bridge;
  if (!bridge || !state.machine) return undefined;

  const usage = await readUsage(ctx);
  const win = windowFor(usage);
  const measurement = bridge.measureContext({
    tokens: usage.tokens,
    contextWindow: win.contextWindow,
    windowSource: win.windowSource,
    reserveTokens: reserveFor(usage),
    mechanism: 'pi-getContextUsage',
    raw: { getContextUsage: usage.raw, windowSource: win.windowSource, agentSettled: payload === undefined ? null : payload },
  });

  const decision = bridge.decide({ dir: state.machine.dir, cycleId: state.machine.cycleId(), measurement, thresholds: state.goalThresholds || null });
  state.lastDecision = decision;
  state.lastEvent = { kind: 'agent_settled', at: new Date().toISOString(), usedPercent: measurement.usedPercent };
  bridge.appendEvent(state.machine.dir, { kind: 'agent_settled', usedPercent: measurement.usedPercent, fire: decision.fire, why: decision.why });

  const verdict = bridge.shouldRollover(decision);
  if (!verdict.go) {
    if (verdict.ask) say(ctx, `context is at ${measurement.usedPercent}% but the window was operator-configured — run /compact yourself if that number looks right. ${verdict.why}`);
    return undefined;
  }

  const cp = bridge.checkpoint(state.machine, measurement.record);
  if (cp.status !== 'APPLIED') { say(ctx, `checkpoint refused: ${cp.failure && cp.failure.detail}`); return undefined; }

  const co = bridge.closeout(state.machine, { mechanism: 'agent_settled', raw: payload === undefined ? { event: 'agent_settled' } : payload });
  if (co.status !== 'APPLIED') { say(ctx, `closeout refused: ${co.failure && co.failure.detail}`); return undefined; }

  const handoff = bridge.stageAndVerifyHandoff(state.machine, bridge.handoffFieldsFor(state.projectDir));
  if (!handoff.ok) {
    say(ctx, `NOT compacting: the handoff could not be written and read back verified (${handoff.failure && handoff.failure.code}). ${handoff.failure && handoff.failure.recovery}`);
    return undefined;
  }
  bridge.clearPendingNote(state.projectDir);

  const requested = bridge.requestCompact(state.machine, { mechanism: 'pi-ctx-compact', raw: { handoffId: handoff.handoffId, at: new Date().toISOString() } });
  if (requested.status !== 'APPLIED') { say(ctx, `compaction not requested: ${requested.failure && requested.failure.detail}`); return undefined; }

  state.pendingHandoffId = handoff.handoffId;
  try {
    // Non-blocking by documentation. The completion is observed in session_compact, never assumed here.
    ctx.compact({
      customInstructions: `A respawn-pi handoff (${handoff.handoffId}) has been written and verified for this rollover; preserve the current atomic task, its constraints, and its unresolved questions.`,
      onError: (error) => say(ctx, `compaction failed: ${String((error && error.message) || error)}. The verified handoff remains on disk and unconsumed.`),
    });
  } catch (e) {
    say(ctx, `ctx.compact() threw: ${String((e && e.message) || e)}. The verified handoff is on disk and unconsumed; nothing was lost.`);
  }
  return undefined;
}

async function onSessionBeforeCompact(ctx, payload) {
  const bridge = state.bridge;
  if (!bridge || !state.machine) return undefined;
  bridge.appendEvent(state.machine.dir, { kind: 'session_before_compact', raw: payload === undefined ? null : payload });
  state.lastEvent = { kind: 'session_before_compact', at: new Date().toISOString() };
  return undefined;
}

/** The completion. Observed, then identity-checked, then — and only then — the injection is armed. */
async function onSessionCompact(ctx, payload) {
  const bridge = state.bridge;
  if (!bridge || !state.machine) return undefined;

  const read = bridge.readSessionCompact(payload);
  bridge.appendEvent(state.machine.dir, { kind: 'session_compact', reason: read.reason, willRetry: read.willRetry, settled: read.settled, raw: payload === undefined ? null : payload });
  state.lastEvent = { kind: 'session_compact', at: new Date().toISOString(), settled: read.settled };

  if (!read.settled) { say(ctx, read.why); return undefined; }

  const observed = bridge.observeCompletion(state.machine, {
    signals: ['session_compact'],
    hostSignal: 'session_compact',
    raw: payload === undefined ? { event: 'session_compact' } : payload,
  });
  if (observed.status !== 'APPLIED') { say(ctx, `the compaction could not be recorded as observed: ${observed.failure && observed.failure.detail}`); return undefined; }

  const observedId = sessionIdOf(ctx, payload);
  const identity = bridge.verifyIdentity(state.machine, {
    expectedId: state.baselineSessionId,
    observedId,
    raw: { observedId, from: 'ctx/session_compact payload', payload: payload === undefined ? null : payload },
  });
  if (identity.status !== 'APPLIED') {
    say(ctx, `identity check after compaction did not pass (${identity.failure && identity.failure.code}): ${identity.failure && identity.failure.recovery}`);
    return undefined;
  }

  if (state.pendingHandoffId) {
    bridge.setPendingInjection(state.machine.dir, { handoffId: state.pendingHandoffId, cycleId: state.machine.cycleId(), identityConfirmed: true });
    state.pendingHandoffId = null;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------------------------------

/* Pi's documented contract is a default-exported factory. Event callbacks receive (event, ctx). */
const handlers = {
  session_start: onSessionStart,
  before_agent_start: onBeforeAgentStart,
  agent_settled: onAgentSettled,
  session_before_compact: onSessionBeforeCompact,
  session_compact: onSessionCompact,
  session_shutdown: onSessionShutdown,
};

function activate(pi) {
  const on = pi && typeof pi.on === 'function' ? pi.on.bind(pi) : null;
  if (!on) throw new Error('respawn-pi requires Pi ExtensionAPI.on()');
  for (const name of Object.keys(handlers)) {
    on(name, (event, ctx) => handlers[name](ctx, event));
  }
  state.registeredVia = 'extension-factory';
}

export { activate, handlers, state, EXTENSION_NAME };
export default activate;

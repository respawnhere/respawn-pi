#!/usr/bin/env node
/*
 * RespawnPack · adapters/pi/canaries/canary-rpc.js — THE proof: three verified in-place rollovers over
 * `pi --mode rpc`, back to back, in one session.
 *
 * PROVES (when it passes): compaction can be REQUESTED through a documented command, its completion can be
 * OBSERVED (and which of the two documented signals arrived is recorded), the session identity SURVIVES it,
 * a verified handoff is delivered EXACTLY ONCE afterwards — and that all four hold on the second and third
 * rollover too, which is the part a single-rollover test cannot see.
 *
 * ⭐ WHY THREE. The v0.2 defect this whole redesign exists to end was a threshold latch keyed on the
 * session id: it fired once per CONVERSATION and then went silent for every cycle after it, so the third
 * session — the one that most needed a checkpoint — got nothing. A one-rollover canary passes cleanly
 * against that bug. Three consecutive rollovers make the per-cycle re-arm observable: the cycle index must
 * reach 3, and each cycle must have re-armed its own latches.
 *
 * ⛔ WHAT THIS CANARY DOES *NOT* PROVE, and why it forces its own trigger. `pi --mode rpc` exposes NO
 * documented command that reports context usage — `ctx.getContextUsage()` lives on the EXTENSION surface.
 * So the RPC supervisor cannot measure its own context, and this canary supplies the measurement rather than
 * pretending to have taken one: with `--tokens`/`--context-window` it uses the operator's numbers, and
 * without them it uses a SYNTHETIC pair that is labelled synthetic in the result. Either way the
 * measurement path is NOT what is being proven here; the compact → observe → rehydrate loop is.
 *
 * ⛔ WHAT THIS CANARY NEEDS TO RUN UNATTENDED. Two documented Pi 0.84.0 behaviors force the surface:
 *   1. Manual compact on a sub-keep-recent session is refused with `errorMessage:"Nothing to compact
 *      (session too small)"`. The default `keepRecentTokens` is 20000, so a fresh session has no content
 *      past the keep-recent cut-point and the synthetic measurement triggers a rollover that Pi refuses to
 *      execute. `--build-prompts <n>` pre-fills the session with N substantive prompts; the
 *      `--keep-recent-tokens-override <n>` flag (test-only, with backup/restore) lowers the threshold for
 *      unattended runs that cannot pre-grow a session to 20K tokens of content.
 *   2. `agent_settled` is edge-triggered, not level-triggered. After pre-build settles the agent, no new
 *      `agent_settled` fires until the next prompt. The rollover cycle uses `--settle operator` whenever
 *      `--build-prompts > 0`, which asserts idleness from the wrapper side rather than waiting for a signal
 *      that will not arrive.
 *
 *   node adapters/pi/canaries/canary-rpc.js [--project <dir>] [--pi <path>] [--cycles 3]
 *                                           [--tokens <n> --context-window <n>] [--settle operator]
 *                                           [--build-prompts <n>] [--keep-recent-tokens-override <n>]
 *                                           [--session-file <path>]
 *
 * Exit: 0 PASS · 1 FAIL (something was observed to be wrong) · 2 CANNOT_DETERMINE (a precondition was missing).
 */
'use strict';
const path = require('path');
const fs = require('fs');

const c = require('./_canary.js');
const supervisor = require('../rpc-supervisor/supervisor.js');
const bridge = require('../bridge/rollover-bridge.js');
const frames = require('../bridge/rpc-frames.js');

const NAME = 'canary-rpc';

/** The synthetic pair. Named constants so "where did 100% come from" has a one-line answer. */
const SYNTHETIC_WINDOW = bridge.PI_DEFAULT_RESERVE_TOKENS + 1000;
const SYNTHETIC_TOKENS = 1000;

/** The project's `.pi/settings.json` is the place Pi reads its compaction config from. */
const SETTINGS_PATH = (projectDir) => path.join(projectDir, '.pi', 'settings.json');

/**
 * The prompts the pre-build step sends. They are short, self-contained, and request technical content
 * the model can generate cleanly without tool calls. The order matters only for the build trace.
 */
const BUILD_PROMPTS = Object.freeze([
  'Write a brief technical overview of the Markdown format, covering its syntax for headers, lists, links, and code blocks.',
  'Write a brief technical overview of the JSON Schema specification, covering its core types and composition keywords.',
  'Write a brief technical overview of the Model Context Protocol, covering its handshake, transport, and tool-calling semantics.',
]);

/**
 * Send `count` prompts to the attached RPC client and wait for each turn to settle.
 *
 * ⛔ THE WAIT IS NOT OPTIONAL. Sending a second prompt into a still-running turn is a steer by definition,
 * and the supervisor's caller did not ask for steering. The wait uses `agent_settled` first, then
 * `agent_end` and `turn_end` as documentation-permitted fallbacks — Pi's R5 surface names all three.
 *
 * @param tag  'pre-build' or 'regrow-<n>' — only changes the bookkeeping in the trace, not the prompts.
 * @returns {ok:true, promptsSent, built} | {ok:false, stage, step, reason, detail, built}
 */
async function buildSession({ client, count = 2, tag = 'pre-build', requestTimeoutMs = 120000, settleTimeoutMs = 300000 }) {
  const built = [];
  for (let i = 0; i < count; i += 1) {
    const prompt = BUILD_PROMPTS[i % BUILD_PROMPTS.length];
    const sent = await client.request(frames.build.prompt(prompt), { timeoutMs: requestTimeoutMs });
    if (!sent.ok) {
      return { ok: false, stage: 'build-prompt', step: i, reason: sent.reason, detail: sent.detail, built, tag };
    }
    const settled = await client.waitForEvent(['agent_settled', 'agent_end', 'turn_end'], { timeoutMs: settleTimeoutMs });
    built.push({
      step: i,
      phase: tag,
      promptLength: prompt.length,
      promptReceived: sent.ok,
      settled: settled.ok ? settled.event : (settled.reason || 'no-signal'),
    });
    if (!settled.ok) {
      return { ok: false, stage: 'build-settle', step: i, reason: settled.reason, detail: settled.detail, built, tag };
    }
  }
  return { ok: true, promptsSent: count, built, tag };
}

/**
 * Apply a TEST-ONLY override of `compaction.keepRecentTokens` in the project's `.pi/settings.json`,
 * run `body`, then restore the original file (or remove it if there was none).
 *
 * ⛔ THE OVERRIDE IS A TEST KNOB, NOT A FEATURE. Pi's default `keepRecentTokens: 20000` means manual
 * compact refuses to compact sub-20K sessions. Lowering it lets the canary prove a real compaction on
 * a freshly built session. The original value is restored on the way out, even on throw, so an
 * exception inside `body` does not leave the target project with a stealth config change.
 */
async function withKeepRecentTokensOverride({ projectDir, value, body }) {
  const settingsPath = SETTINGS_PATH(projectDir);
  let original = null;
  let hadFile = false;
  try {
    original = fs.readFileSync(settingsPath, 'utf8');
    hadFile = true;
  } catch {
    /* no settings file yet — that is fine, we create one */
  }
  let settings = {};
  if (original) {
    try { settings = JSON.parse(original); } catch { settings = {}; }
  }
  const modified = { ...settings, compaction: { ...(settings.compaction || {}), keepRecentTokens: value } };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(modified, null, 2));
  try {
    return await body();
  } finally {
    if (hadFile && original !== null) {
      fs.writeFileSync(settingsPath, original);
    } else {
      try { fs.unlinkSync(settingsPath); } catch { /* already gone */ }
    }
  }
}

async function run({
  projectDir = process.cwd(), piPath = null, cycles = 3, env = process.env,
  tokens = null, contextWindow = null, settleMechanism = 'agent_settled', sessionFile = null,
  buildPrompts = 2, keepRecentTokensOverride = null,
} = {}) {
  // ⛔ PROJECTDIR MUST EXIST BEFORE WE PASS IT AS A SPAWN CWD. `spawnSync` returns ENOENT — not a
  // descriptive error — when cwd is a path that does not resolve to a real directory. Tests that pass
  // a fresh tmp path are the usual trigger; an operator running the canary against a deleted target
  // directory hits the same wall. Creating it here is the cheapest fix: the canary writes evidence
  // there anyway, so an empty directory is a perfectly valid starting state.
  fs.mkdirSync(projectDir, { recursive: true });

  const probe = supervisor.probe({ piPath, env, cwd: projectDir });
  if (probe.outcome !== c.OUTCOME.PASS) {
    const pre = probe.precondition === 'pi found but did not answer --version' ? c.PRECONDITIONS.PI_UNRESPONSIVE : c.PRECONDITIONS.PI_NOT_INSTALLED;
    return c.cannotDetermine(NAME, pre, {
      detail: probe.detail,
      recovery: probe.recovery,
      notes: [
        'the three-rollover proof cannot even be attempted without a Pi to attach to',
        'until this canary passes, adapters/pi/profile.js declares every canary-gated capability CANNOT_DETERMINE — that is the canary-or-downgrade rule, not a placeholder',
      ],
      raw: probe.raw,
    });
  }

  const synthetic = !(Number.isFinite(tokens) && Number.isFinite(contextWindow));
  const measurement = bridge.measureContext({
    tokens: synthetic ? SYNTHETIC_TOKENS : tokens,
    contextWindow: synthetic ? SYNTHETIC_WINDOW : contextWindow,
    windowSource: 'operator-configured',
    mechanism: synthetic ? 'canary-synthetic-measurement' : 'operator-supplied-measurement',
    raw: { synthetic, tokens: synthetic ? SYNTHETIC_TOKENS : tokens, contextWindow: synthetic ? SYNTHETIC_WINDOW : contextWindow, note: 'pi --mode rpc exposes no documented context-usage command; this measurement did not come from Pi' },
  });

  // When we pre-build the session, the agent is idle by the time the rollover cycle runs and
  // agent_settled does not fire again. Operator-settle is the only mechanism that works in that shape.
  const effectiveSettle = (buildPrompts > 0 && !sessionFile) ? 'operator' : settleMechanism;

  const body = async () => {
    const attached = await supervisor.attach({ piPath: probe.piPath, cwd: projectDir, env, projectDir, sessionFile });
    if (!attached.ok) {
      const pre = attached.precondition === 'session already claimed' ? c.PRECONDITIONS.SESSION_ALREADY_CLAIMED : c.PRECONDITIONS.NO_RPC_SESSION;
      return c.cannotDetermine(NAME, pre, { detail: attached.detail, recovery: attached.recovery, raw: attached.raw });
    }

    try {
      if (buildPrompts > 0 && !sessionFile) {
        const build = await buildSession({ client: attached.client, count: buildPrompts });
        if (!build.ok) {
          return c.cannotDetermine(NAME, c.PRECONDITIONS.NO_RPC_SESSION, {
            detail: `session pre-build failed at step ${build.step + 1} (${build.stage}): ${build.detail || build.reason}`,
            recovery: build.stage === 'build-prompt'
              ? 'The prompt command did not return a response. Pi RPC may have rejected the prompt, or the model timed out. Try --build-prompts 0 with --session-file <path> to skip pre-build.'
              : 'A turn did not settle within the wait window. Increase --settle-timeout or drive the canary with --build-prompts 0.',
            notes: [`built ${build.built.length} prompt(s) before failure`],
            raw: { build },
          });
        }
      }

      const opened = bridge.openMachine({ projectDir, sessionId: attached.state.sessionId });
      if (!opened.ok) {
        return c.cannotDetermine(NAME, c.PRECONDITIONS.NO_RPC_SESSION, {
          detail: `the rollover journal for session ${attached.state.sessionId} could not be opened: ${opened.failure.detail}`,
          recovery: opened.failure.recovery,
          raw: { failure: opened.failure },
        });
      }

      const machine = opened.machine;
      const cycleIndexBefore = machine.cycleIndex();
      const regrowBetween = buildPrompts > 0 && !sessionFile
        ? async (cycleIndex) => {
            const r = await buildSession({ client: attached.client, count: buildPrompts, tag: `regrow-${cycleIndex + 1}` });
            return r.ok ? { ok: true, promptsSent: r.promptsSent } : { ok: false, stage: r.stage, detail: r.detail };
          }
        : null;
      const run3 = await supervisor.runCycles({
        client: attached.client,
        machine,
        projectDir,
        expectedSessionId: attached.state.sessionId,
        cycles,
        settleMechanism: effectiveSettle,
        measurementFor: () => measurement,
        regrowBetween,
      });

      const notes = [
        synthetic
          ? `the rollover was triggered by a SYNTHETIC measurement (${SYNTHETIC_TOKENS} tokens of a ${SYNTHETIC_WINDOW}-token window); pi --mode rpc reports no usage this canary could read`
          : 'the rollover was triggered by an OPERATOR-SUPPLIED measurement, not one read from Pi',
        buildPrompts > 0 && !sessionFile
          ? `session pre-built with ${buildPrompts} prompt(s) (settle mechanism: ${effectiveSettle})`
          : `settle mechanism: ${effectiveSettle}`,
        `trust status for project extensions under --mode rpc: ${attached.trustEstablished} — ${attached.trustNote}`,
        `session lock: ${attached.lock.scope} scope at ${attached.lock.lockPath}`,
      ];
      if (keepRecentTokensOverride !== null) {
        notes.push(`TEST-ONLY: compaction.keepRecentTokens was overridden to ${keepRecentTokensOverride} for this run; the original value was restored on exit`);
      }
      if (run3.standing === 'PARTIAL') {
        notes.push('at least one rollover was proven by only ONE of the two documented compaction signals — that is SUPPORTED_WITH_LIMITATIONS evidence, never SUPPORTED');
      }

      const raw = {
        sessionId: attached.state.sessionId,
        sessionFile: attached.state.sessionFile,
        piVersion: attached.version,
        cycleIndexBefore,
        cycleIndexAfter: machine.cycleIndex(),
        preBuild: buildPrompts > 0 && !sessionFile ? { promptsSent: buildPrompts } : null,
        keepRecentTokensOverride: keepRecentTokensOverride,
        results: run3.results,
        // Every frame the live install actually sent — including which envelope key named an event, which
        // is the one wire fact this adapter had to guess at (see bridge/rpc-frames.js EVENT_NAME_KEYS).
        frames: attached.client.frames(),
        unparseableFrames: attached.client.unparseable(),
        stderr: attached.stderr(),
      };

      if (!run3.ok) {
        const last = run3.results[run3.results.length - 1] || {};
        const outcome = last.outcome === c.OUTCOME.FAIL ? c.OUTCOME.FAIL : c.OUTCOME.CANNOT_DETERMINE;
        if (outcome === c.OUTCOME.FAIL) {
          return c.fail(NAME, {
            detail: `rollover ${run3.completed + 1} of ${cycles} failed at stage "${last.stage}": ${last.detail}`,
            recovery: 'Read the journal at the conversation directory printed in raw.sessionId — the machine records exactly which transition was refused and why, with its recovery instruction attached.',
            notes, raw,
          });
        }
        const pre = last.stage === 'settle' ? c.PRECONDITIONS.NO_SETTLE_SIGNAL : c.PRECONDITIONS.NO_RPC_SESSION;
        return c.cannotDetermine(NAME, pre, {
          detail: `rollover ${run3.completed + 1} of ${cycles} could not be completed at stage "${last.stage}": ${last.detail}`,
          recovery: last.recovery || 'Nothing was observed to be wrong; a proof did not arrive. Do not treat this as a passing run.',
          notes, raw,
        });
      }

      const advanced = machine.cycleIndex() - cycleIndexBefore;
      if (advanced !== cycles) {
        return c.fail(NAME, {
          detail: `${cycles} rollovers reported success but the context cycle advanced ${advanced} time(s) — a rollover that does not advance the cycle leaves every threshold latched, which is the exact v0.2 defect this design replaces`,
          notes, raw,
        });
      }

      const passed = c.pass(NAME, {
        proves: `${cycles} consecutive in-place rollovers over pi --mode rpc: compaction requested, completion observed, identity unchanged, handoff consumed exactly once, cycle advanced each time`,
        detail: `cycle index ${cycleIndexBefore} → ${machine.cycleIndex()}; standing ${run3.standing}`,
        notes, raw,
      });
      // The marker is what adapters/pi/profile.js reads to satisfy core's canary-or-downgrade rule without
      // re-running three compactions. Only a PASS is ever written — see bridge.writeCanaryMarker.
      bridge.writeCanaryMarker(projectDir, 'rpc', {
        ...passed,
        raw: { sessionId: raw.sessionId, piVersion: raw.piVersion, cycles, standing: run3.standing, signalsPerCycle: run3.results.map((r) => r.signalsArrived || []) },
      });
      return passed;
    } finally {
      attached.release();
    }
  };

  if (keepRecentTokensOverride !== null) {
    return await withKeepRecentTokensOverride({ projectDir, value: keepRecentTokensOverride, body });
  }
  return await body();
}

if (require.main === module) {
  const args = c.parseArgs(process.argv.slice(2));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const overrideVal = num(args['keep-recent-tokens-override']);
  const buildVal = num(args['build-prompts']);
  c.guard(NAME, () => run({
    projectDir: typeof args.project === 'string' ? path.resolve(args.project) : process.cwd(),
    piPath: typeof args.pi === 'string' ? args.pi : null,
    cycles: num(args.cycles) || 3,
    tokens: num(args.tokens),
    contextWindow: num(args['context-window']),
    settleMechanism: args.settle === 'operator' ? 'operator' : 'agent_settled',
    sessionFile: typeof args['session-file'] === 'string' ? args['session-file'] : null,
    buildPrompts: buildVal === null ? 2 : buildVal,
    keepRecentTokensOverride: overrideVal,
  })).then(c.emit);
}

module.exports = { NAME, run, SYNTHETIC_WINDOW, SYNTHETIC_TOKENS, BUILD_PROMPTS, buildSession, withKeepRecentTokensOverride };

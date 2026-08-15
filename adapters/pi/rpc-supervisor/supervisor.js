/*
 * RespawnPack · adapters/pi/rpc-supervisor/supervisor.js — the managed Pi profile: drive `pi --mode rpc`
 * through a verified in-place rollover, three times, and prove each one.
 *
 * ⛔ FOUR THINGS THIS FILE REFUSES TO DO, each one a thing the documentation makes tempting:
 *
 *   1. IT WILL NOT SPEAK TO A SESSION IT HAS NOT LOCKED. Pi has no competing-client protection (R5), so
 *      the exclusive `wx` claim in ./session-lock.js comes first. The single exception is documented and
 *      bounded — see `attach()`'s "the bootstrap read" below — and it is one READ-ONLY `get_state`.
 *
 *   2. IT WILL NOT TREAT A `compact` RESPONSE AS A COMPACTION. `{command:"compact", success:true}` says
 *      the REQUEST was accepted. `compaction_end` says something happened, and even then only when it
 *      reports neither `aborted` nor `willRetry`. The supervisor waits for both, records WHICH arrived,
 *      and a rollover proven by only one of them is SUPPORTED_WITH_LIMITATIONS evidence — never the same
 *      claim as a rollover proven by both.
 *
 *   3. IT WILL NOT SUBSTITUTE A CLOCK FOR A SIGNAL. Every wait resolves to a typed result, and the
 *      timeout branch produces `compact-unobserved` (reason + waitedMs), never `compact-completed`.
 *      core/lifecycle/evidence.js would refuse the second anyway — the point is that this file never
 *      tries, because an adapter that has to be caught by the validator has already made the mistake.
 *
 *   4. IT WILL NOT CLAIM `agent_settled` IT DID NOT SEE. `agent_settled` is documented on the EXTENSION
 *      event surface; whether the RPC stream emits it at all is CANNOT_DETERMINE until an install shows
 *      one. The supervisor waits for it by name, reports honestly when none arrives, and does NOT fall
 *      back to "the prompt response came back, so the agent must be done" — Pi's own definition of settled
 *      is "no automatic retry, compaction retry, or queued continuation remains", and a command response
 *      does not observe any of those three.
 *
 * ⭐ THE TRANSPORT IS INJECTABLE, AND THAT IS WHY ANY OF THIS IS TESTED. `createClient({write})` speaks
 * frames to a function, not to a pipe; `attach()` wires that function to a real child process's stdin.
 * The suite drives the entire rollover sequence against an in-process fake that emits R5-shaped frames,
 * so the sequencing, the dual-signal accounting and the identity re-check are all covered on a machine
 * where Pi does not exist — which is the only kind of machine this was written on.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const core = require(path.join(__dirname, '..', '..', '..', 'core', 'index.js'));
const frames = require('../bridge/rpc-frames.js');
const bridge = require('../bridge/rollover-bridge.js');
const lockLib = require('./session-lock.js');

const nowISO = () => new Date().toISOString();
const isStr = (v) => typeof v === 'string' && v.length > 0;

/** Default waits. Generous, because a wait that expires produces CANNOT_DETERMINE and costs a whole run. */
const DEFAULTS = Object.freeze({
  requestTimeoutMs: 60000,
  settleTimeoutMs: 300000,
  compactionTimeoutMs: 300000,
});

/** The event names that would mean "the agent has settled", most specific first. */
const SETTLE_EVENT_NAMES = Object.freeze(['agent_settled']);

// =====================================================================================================
// probe — is there a Pi at all, and what is it?
// =====================================================================================================

/*
 * ⛔ PI'S BINARY LAYOUT IS CANNOT_DETERMINE UNTIL IT IS INSTALLED. The Codex probe (W3) could resolve a
 * real entry point because Codex is installed on this machine — its npm shim pair (`codex.cmd`/`codex.ps1`
 * delegating to `bin/codex.js`) was READ, not guessed. Nothing equivalent can be read for Pi here, so this
 * function DISCOVERS rather than assumes: it asks the OS where `pi` is, records the answer verbatim, runs
 * `--version`, and records that verbatim too. What it must never do is hardcode a path shape that happens
 * to be true of one packaging and call it support.
 */
function probe({ piPath = null, cwd = process.cwd(), env = process.env, timeoutMs = 15000 } = {}) {
  const observedAt = nowISO();
  const attempts = [];

  const resolveCandidates = () => {
    if (isStr(piPath)) return { from: 'explicit', candidates: [piPath], raw: { piPath } };
    const win = process.platform === 'win32';
    if (win) {
      const pathEntry = Object.entries(env || {}).find(([key]) => key.toLowerCase() === 'path');
      const pathValue = pathEntry ? String(pathEntry[1] || '') : '';
      const candidates = [];
      for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
        for (const name of ['pi.cmd', 'pi.exe', 'pi.bat', 'pi']) {
          const candidate = path.join(dir, name);
          if (fs.existsSync(candidate)) candidates.push(candidate);
        }
      }
      attempts.push({ step: 'locate', command: 'search PATH for pi.cmd/pi.exe/pi.bat/pi', status: 0, stdout: candidates.join('\n'), stderr: '', error: null });
      return { from: 'PATH', candidates, raw: { status: 0, stdout: candidates.join('\n'), stderr: '' } };
    }
    const finder = 'sh';
    const args = ['-c', 'command -v pi || true'];
    const r = spawnSync(finder, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env });
    attempts.push({ step: 'locate', command: `${finder} ${args.join(' ')}`, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? String(r.error.message) : null });
    const lines = String(r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return { from: 'command -v', candidates: lines, raw: { status: r.status, stdout: r.stdout, stderr: r.stderr } };
  };

  const found = resolveCandidates();
  if (!found.candidates.length) {
    return {
      outcome: core.failures.OUTCOME.CANNOT_DETERMINE,
      installed: false, piPath: null, version: null, observedAt,
      precondition: 'pi not installed',
      detail: 'no `pi` executable is on PATH, and none was supplied. Every live Pi capability of this adapter is unprovable until one exists.',
      recovery: 'Install Pi and make it reachable on PATH, or pass an explicit path (--pi <path> / {piPath}). Then re-run this canary.',
      raw: { attempts, ...found.raw },
    };
  }

  const resolved = found.candidates[0];
  const v = runCapture(resolved, ['--version'], { cwd, env, timeoutMs });
  attempts.push({ step: 'version', command: `${resolved} --version`, status: v.status, stdout: v.stdout, stderr: v.stderr, error: v.error });

  if (v.status !== 0) {
    return {
      outcome: core.failures.OUTCOME.CANNOT_DETERMINE,
      installed: true, piPath: resolved, version: null, observedAt,
      precondition: 'pi found but did not answer --version',
      detail: `\`${resolved} --version\` exited ${v.status}${v.error ? ` (${v.error})` : ''}. Something named pi is on PATH; whether it is Pi is unproven.`,
      recovery: 'Run `pi --version` by hand and read the error. A shim that resolves but cannot run is usually a broken install or a name collision with an unrelated tool called `pi`.',
      raw: { attempts, candidates: found.candidates },
    };
  }

  return {
    outcome: core.failures.OUTCOME.PASS,
    installed: true,
    piPath: resolved,
    version: String(v.stdout || '').trim() || null,
    observedAt,
    precondition: null,
    detail: null,
    // Verbatim, because "the version string looked like X" is the kind of claim that has to survive Pi
    // changing its output format.
    raw: { attempts, candidates: found.candidates, versionStdout: v.stdout, versionStderr: v.stderr },
  };
}

/** Run something and capture it, with the Windows shim rule applied. Never throws. */
function runCapture(exe, args, { cwd, env, timeoutMs = 15000, input = undefined } = {}) {
  const opts = { cwd, env, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, ...(input === undefined ? {} : { input }) };
  const shimmed = needsShell(exe);
  const r = shimmed
    ? spawnSync(shellCommandLine(exe, args), { ...opts, shell: true })
    : spawnSync(exe, args, opts);
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? String(r.error.message) : null, shell: shimmed };
}

/*
 * ⛔ THE WINDOWS SHIM RULE, AND WHY IT IS A RULE RATHER THAN A TRY/CATCH. Node refuses to spawn `.cmd` and
 * `.bat` files without `shell:true` (the CVE-2024-27980 fix), and npm-installed CLIs on Windows are
 * precisely `.cmd` shims. So the extension of the resolved path decides the spawn shape.
 *
 * ⛔ AND WHEN A SHELL IS USED, THE WHOLE LINE IS BUILT HERE, QUOTED, WITH NO ARGS ARRAY. Node deprecated
 * passing an args array alongside `shell:true` precisely because the arguments are concatenated rather
 * than escaped — the caller ends up believing in a separation that does not exist. One quoted command
 * line makes the concatenation visible instead of implied. `C:\Program Files\...` is not an exotic install
 * location, and an unquoted path with a space in it is where this class of bug starts.
 */
const SHIM_EXTENSIONS = new Set(['.cmd', '.bat']);
const needsShell = (exe) => process.platform === 'win32' && SHIM_EXTENSIONS.has(path.extname(String(exe || '')).toLowerCase());

/** Quote for cmd.exe. Every argument this adapter passes is a fixed literal from this file (`--mode`,
 * `rpc`, `--version`) or an operator-supplied path; neither is model output, and both are quoted anyway. */
const quoteArg = (a) => `"${String(a).replace(/"/g, '""')}"`;
const shellCommandLine = (exe, args) => [quoteArg(exe), ...(args || []).map(quoteArg)].join(' ');

// =====================================================================================================
// the RPC client — frames over an injectable write()
// =====================================================================================================

/**
 * @param write  (text:string) => void — where an outgoing frame goes. A pipe, or a test's fake.
 * @returns a client whose every wait resolves to a TYPED result; nothing here throws on a timeout.
 */
function createClient({ write, label = 'rp', clock = Date.now } = {}) {
  const splitter = frames.createFrameSplitter();
  const correlator = frames.createCorrelator(label);
  const pending = new Map();          // id -> {resolve, timer, command, sentAt}
  const eventWaiters = [];            // {names:Set, resolve, timer, since}
  const seen = [];                    // every frame, verbatim, in arrival order
  const unparseable = [];
  let ended = false;

  const record = (entry) => { seen.push({ at: nowISO(), ...entry }); };

  function deliverEvent(name, value, text) {
    for (let i = eventWaiters.length - 1; i >= 0; i -= 1) {
      const w = eventWaiters[i];
      if (!w.names.has(name)) continue;
      eventWaiters.splice(i, 1);
      if (w.timer) clearTimeout(w.timer);
      w.resolve({ ok: true, event: name, value, text, waitedMs: clock() - w.since });
    }
  }

  return {
    /** Feed raw stdout. Returns the frames this chunk completed, already classified. */
    feed(chunk) {
      const out = [];
      for (const text of splitter.push(chunk)) {
        const parsed = frames.parseFrame(text);
        if (!parsed.ok) {
          if (parsed.kind !== 'blank') { unparseable.push(parsed); record({ dir: 'in', kind: 'unparseable', text, detail: parsed.detail }); }
          continue;
        }
        const cls = frames.classifyFrame(parsed.value, { isKnownId: correlator.isKnownId });
        record({ dir: 'in', kind: cls.type, event: cls.event, command: cls.command, id: cls.id, matchedBy: cls.matchedBy, value: parsed.value });
        out.push({ ...cls, text });

        if (cls.type === 'response' && cls.id && pending.has(cls.id)) {
          const p = pending.get(cls.id);
          pending.delete(cls.id);
          correlator.settle(cls.id);
          if (p.timer) clearTimeout(p.timer);
          p.resolve({ ok: true, id: cls.id, command: cls.command, value: parsed.value, text, waitedMs: clock() - p.sentAt });
        } else if (cls.type === 'event' && cls.event) {
          deliverEvent(cls.event, parsed.value, text);
        } else if (cls.type === 'unknown' && cls.event) {
          // An unrecognised NAMED frame still wakes a waiter that asked for that exact name, so a live
          // install using a different envelope key is discoverable rather than invisible.
          deliverEvent(cls.event, parsed.value, text);
        }
      }
      return out;
    },

    /** Stream closed. Every outstanding wait resolves as UNOBSERVED — never as anything having succeeded. */
    end(reason = 'stream-closed') {
      if (ended) return;
      ended = true;
      const tail = splitter.flush();
      if (tail) { unparseable.push({ ok: false, kind: 'truncated-tail', text: tail, detail: 'the stream ended mid-frame' }); record({ dir: 'in', kind: 'truncated-tail', text: tail }); }
      for (const [id, p] of pending) {
        if (p.timer) clearTimeout(p.timer);
        p.resolve({ ok: false, id, reason, waitedMs: clock() - p.sentAt, detail: `the RPC stream closed with ${p.command} outstanding` });
      }
      pending.clear();
      while (eventWaiters.length) {
        const w = eventWaiters.pop();
        if (w.timer) clearTimeout(w.timer);
        w.resolve({ ok: false, reason, waitedMs: clock() - w.since, detail: `the RPC stream closed while waiting for ${[...w.names].join(' or ')}` });
      }
    },

    /** Send a built frame and wait for its correlated response. @returns Promise<{ok, value}|{ok:false, reason, waitedMs}> */
    request(frame, { timeoutMs = DEFAULTS.requestTimeoutMs } = {}) {
      const id = frame.id || correlator.newId();
      const withId = { ...frame, id };
      const requestType = withId.type;
      correlator.register(id, { command: requestType });
      const text = frames.encodeFrame(withId);
      record({ dir: 'out', kind: 'request', id, command: requestType, value: withId });
      return new Promise((resolve) => {
        if (ended) { resolve({ ok: false, id, reason: 'stream-closed', waitedMs: 0, detail: 'the RPC stream was already closed' }); return; }
        const sentAt = clock();
        const timer = setTimeout(() => {
          pending.delete(id);
          correlator.settle(id);
          resolve({ ok: false, id, command: requestType, reason: 'no-response', waitedMs: clock() - sentAt, detail: `no response to ${requestType} within ${timeoutMs}ms` });
        }, timeoutMs);
        if (timer.unref) timer.unref();
        pending.set(id, { resolve, timer, command: requestType, sentAt });
        try { write(text); } catch (e) {
          clearTimeout(timer);
          pending.delete(id);
          resolve({ ok: false, id, command: requestType, reason: 'write-failed', waitedMs: 0, detail: String(e && e.message) });
        }
      });
    },

    /** Wait for any of `names`. Resolves {ok:false, reason:'no-signal'|'stream-closed', waitedMs} — never throws. */
    waitForEvent(names, { timeoutMs = DEFAULTS.compactionTimeoutMs } = {}) {
      const wanted = new Set(Array.isArray(names) ? names : [names]);
      return new Promise((resolve) => {
        if (ended) { resolve({ ok: false, reason: 'stream-closed', waitedMs: 0, detail: 'the RPC stream was already closed' }); return; }
        const since = clock();
        const w = { names: wanted, resolve, since, timer: null };
        w.timer = setTimeout(() => {
          const i = eventWaiters.indexOf(w);
          if (i !== -1) eventWaiters.splice(i, 1);
          resolve({ ok: false, reason: 'no-signal', waitedMs: clock() - since, detail: `no ${[...wanted].join(' or ')} within ${timeoutMs}ms` });
        }, timeoutMs);
        if (w.timer.unref) w.timer.unref();
        eventWaiters.push(w);
      });
    },

    frames: () => seen.slice(),
    unparseable: () => unparseable.slice(),
    outstanding: () => correlator.outstanding(),
    ended: () => ended,
  };
}

// =====================================================================================================
// attach — a client bound to a real `pi --mode rpc` child, behind the lock
// =====================================================================================================

/**
 * Start `pi --mode rpc`, learn which session it is driving, and CLAIM that session exclusively.
 *
 * ⭐ THE BOOTSTRAP READ, stated because it is the one place the lock is not first. To lock a session you
 * need its file path; to learn its file path you must ask `get_state`. So when no `sessionFile` is known
 * in advance, exactly ONE read-only `get_state` precedes the lock — a command that reads and mutates
 * nothing — and the lock is taken immediately on its answer. If a caller already knows the session file
 * (`{sessionFile}`), the lock is taken FIRST and `get_state` merely confirms it; the answer is compared
 * against what was locked and a mismatch aborts, because a lock on the wrong file protects nothing.
 *
 * Non-interactive RPC mode does not display a trust prompt. The default args include `--approve`, Pi's
 * documented one-run override, so intentional project-local resources load. Callers can supply different
 * args when the project must remain untrusted.
 *
 * @returns {{ok:true, client, child, lock, state, release}|{ok:false, outcome, precondition, detail, recovery, raw}}
 */
async function attach({
  piPath = null, cwd = process.cwd(), env = process.env, args = ['--approve', '--mode', 'rpc'],
  sessionFile = null, projectDir = null, lockDir = null,
  requestTimeoutMs = DEFAULTS.requestTimeoutMs, spawnImpl = spawn,
} = {}) {
  const p = probe({ piPath, cwd, env });
  if (p.outcome !== core.failures.OUTCOME.PASS) return { ok: false, ...p };

  let lock = null;
  if (isStr(sessionFile)) {
    lock = lockLib.acquire({ sessionFile, projectDir: projectDir || cwd, lockDir, note: 'pi rpc supervisor (session file known in advance)' });
    if (lock.status !== 'ACQUIRED') return { ok: false, outcome: core.failures.OUTCOME.CANNOT_DETERMINE, precondition: 'session already claimed', detail: lock.why, recovery: 'Stop the other supervisor, or wait for it to finish. Do not break the lock unless you know the holder is gone — see session-lock.js breakLock().', raw: lock };
  }

  const useShell = needsShell(p.piPath);
  const child = useShell
    ? spawnImpl(shellCommandLine(p.piPath, args), { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: true })
    : spawnImpl(p.piPath, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  const stderrChunks = [];
  const client = createClient({ write: (text) => child.stdin.write(text) });
  child.stdout.on('data', (c) => client.feed(c));
  child.stderr.on('data', (c) => stderrChunks.push(String(c)));
  child.on('close', (code) => client.end(`process-exited-${code}`));
  child.on('error', () => client.end('process-error'));

  const cleanup = (why) => {
    try { child.kill(); } catch { /* already gone */ }
    if (lock && lock.status === 'ACQUIRED') lock.release();
    return why;
  };

  const stateResp = await client.request(frames.build.getState(), { timeoutMs: requestTimeoutMs });
  if (!stateResp.ok) {
    cleanup();
    return {
      ok: false, outcome: core.failures.OUTCOME.CANNOT_DETERMINE,
      precondition: 'pi --mode rpc did not answer get_state',
      detail: `${stateResp.reason} after ${stateResp.waitedMs}ms. stderr: ${stderrChunks.join('').slice(0, 2000) || '(empty)'}`,
      recovery: 'Run `pi --mode rpc` by hand and send {"command":"get_state","id":"1"} on stdin. If nothing comes back, the RPC mode or the flag spelling differs from what this adapter was written against — record the real behaviour before changing anything here.',
      raw: { stateResp, stderr: stderrChunks.join('') },
    };
  }

  const state = frames.readState(stateResp.value);
  if (!isStr(state.sessionId)) {
    cleanup();
    return {
      ok: false, outcome: core.failures.OUTCOME.CANNOT_DETERMINE,
      precondition: 'get_state exposed no sessionId',
      detail: 'Pi answered get_state with no readable sessionId, so this supervisor has no conversation identity to verify a rollover against.',
      recovery: 'Capture the raw get_state frame and compare it against R5\'s documented shape {sessionId, sessionFile, sessionName}; identity verification cannot be faked around.',
      raw: { value: stateResp.value },
    };
  }

  if (lock) {
    // The lock was taken on a caller-supplied path. Confirm Pi agrees, and abort if it does not.
    const lockedKey = lockLib.lockPathFor(sessionFile, { lockDir, projectDir: projectDir || cwd }).key;
    const actualKey = lockLib.lockPathFor(state.sessionFile || sessionFile, { lockDir, projectDir: projectDir || cwd }).key;
    if (state.sessionFile && lockedKey !== actualKey) {
      const detail = `the lock was taken on ${sessionFile} and Pi reports it is driving ${state.sessionFile}; a lock on the wrong file protects nothing`;
      cleanup();
      return { ok: false, outcome: core.failures.OUTCOME.CANNOT_DETERMINE, precondition: 'session file mismatch', detail, recovery: 'Re-run without a --session-file argument and let the supervisor lock what get_state reports.', raw: { supplied: sessionFile, reported: state.sessionFile } };
    }
  } else {
    lock = lockLib.acquire({
      sessionFile: state.sessionFile || `pi-session-${state.sessionId}`,
      sessionId: state.sessionId, projectDir: projectDir || cwd, lockDir,
      note: 'pi rpc supervisor (session file learned from the bootstrap get_state)',
    });
    if (lock.status !== 'ACQUIRED') {
      cleanup();
      return {
        ok: false, outcome: core.failures.OUTCOME.CANNOT_DETERMINE,
        precondition: 'session already claimed',
        detail: lock.why,
        recovery: 'Another RespawnPack supervisor is driving this session. Stop it, or wait. Pi itself would let both of you talk at once; that is the situation this lock exists to make visible.',
        raw: lock,
      };
    }
  }

  return {
    ok: true, client, child, lock, state, piPath: p.piPath, version: p.version,
    trustEstablished: args.includes('--approve') || args.includes('-a') ? true : 'CANNOT_DETERMINE',
    trustNote: 'The default supervisor command includes --approve so project-local resources load in RPC mode. Remove it only when the project must stay untrusted.',
    stderr: () => stderrChunks.join(''),
    release: () => { try { child.kill(); } catch { /* already gone */ } return lock.release(); },
  };
}

// =====================================================================================================
// the rollover sequence
// =====================================================================================================

/**
 * One complete rollover over an attached client.
 *
 * The sequence, and what gates each step:
 *   get_state           → the identity baseline (already read by attach; re-read here per cycle)
 *   wait agent_settled  → the ONLY safe boundary Pi documents; no fallback, see the banner
 *   write + verify      → core/state/handoff.js writes, reads back, compares digests
 *   compact             → sent as a correlated command
 *   response AND event  → both awaited; which arrived is recorded and decides FULL vs PARTIAL standing
 *   get_state           → identity re-check against the baseline, EMPIRICALLY, per rollover
 *   follow_up           → the consumed handoff, delivered exactly once via the wx receipt
 *
 * @returns {{ok:boolean, stage:string, standing, cycleIdBefore, cycleIdAfter, ...}}
 */
async function runRollover({
  client, machine, projectDir, expectedSessionId,
  settleTimeoutMs = DEFAULTS.settleTimeoutMs,
  compactionTimeoutMs = DEFAULTS.compactionTimeoutMs,
  requestTimeoutMs = DEFAULTS.requestTimeoutMs,
  measurement = null,
  settleMechanism = 'agent_settled',
  handoffFields = null,
  injectCommand = 'follow_up',
} = {}) {
  const dir = machine.dir;
  const cycleIdBefore = machine.cycleId();
  const trail = [];
  const step = (name, value) => { trail.push({ step: name, at: nowISO(), ...value }); return value; };

  // --- 1. checkpoint on a measurement -----------------------------------------------------------------
  const m = measurement || bridge.measureContext({ tokens: null });
  if (!m.measurable) {
    return { ok: false, stage: 'measure', standing: 'NONE', cycleIdBefore, trail, outcome: core.failures.OUTCOME.CANNOT_DETERMINE, detail: m.why };
  }
  const cp = bridge.checkpoint(machine, m.record);
  step('checkpoint', { status: cp.status, failure: cp.failure ? cp.failure.code : null });
  if (cp.status !== 'APPLIED') return { ok: false, stage: 'checkpoint', standing: 'NONE', cycleIdBefore, trail, outcome: core.failures.OUTCOME.FAIL, detail: cp.failure && cp.failure.detail };

  // --- 2. the safe boundary ---------------------------------------------------------------------------
  let settleRaw;
  if (settleMechanism === 'operator') {
    // The operator asserts idleness. Recorded AS an operator assertion, never as a host observation.
    settleRaw = { mechanism: 'operator', assertedAt: nowISO(), note: 'an operator asserted the agent was idle; Pi emitted no agent_settled this supervisor saw' };
  } else {
    const settled = await client.waitForEvent(SETTLE_EVENT_NAMES, { timeoutMs: settleTimeoutMs });
    step('settle', { ok: settled.ok, reason: settled.reason || null, waitedMs: settled.waitedMs });
    if (!settled.ok) {
      return {
        ok: false, stage: 'settle', standing: 'NONE', cycleIdBefore, trail,
        outcome: core.failures.OUTCOME.CANNOT_DETERMINE,
        detail: `no agent_settled arrived on the RPC stream within ${settleTimeoutMs}ms (${settled.reason}). `
          + 'agent_settled is documented on Pi\'s EXTENSION event surface; whether --mode rpc emits it is unverified. '
          + 'This is not evidence that the agent is busy and not evidence that it is idle.',
        recovery: 'Confirm against a live install whether the RPC stream carries agent_settled. Until then, drive this canary with --settle operator only when you have independently confirmed the agent is idle.',
      };
    }
    settleRaw = settled.value;
  }
  const co = bridge.closeout(machine, { mechanism: settleMechanism, raw: settleRaw });
  step('closeout', { status: co.status, failure: co.failure ? co.failure.code : null });
  if (co.status !== 'APPLIED') return { ok: false, stage: 'closeout', standing: 'NONE', cycleIdBefore, trail, outcome: core.failures.OUTCOME.FAIL, detail: co.failure && co.failure.detail };

  // --- 3. the handoff ---------------------------------------------------------------------------------
  const fields = handoffFields || bridge.handoffFieldsFor(projectDir);
  const h = bridge.stageAndVerifyHandoff(machine, fields);
  step('handoff', { ok: h.ok, handoffId: h.handoffId, failure: h.failure ? h.failure.code : null });
  if (!h.ok) return { ok: false, stage: 'handoff', standing: 'NONE', cycleIdBefore, trail, outcome: core.failures.OUTCOME.FAIL, detail: h.failure && h.failure.detail };
  bridge.clearPendingNote(projectDir);

  // --- 4. request the compaction ----------------------------------------------------------------------
  /*
   * ⛔ THE ORDER OF THESE THREE LINES IS THE DESIGN.
   *   journal FIRST  — a compact frame that went out without a COMPACTING transition behind it is a
   *                    compaction this rollover has no record of asking for.
   *   listen SECOND  — compaction_end can legitimately arrive before the command response, and a listener
   *                    attached afterwards would miss it and report a compaction nobody observed.
   *   send LAST      — by then the machine says COMPACTING and something is already listening.
   */
  const compactFrame = frames.build.compact();
  const rq = bridge.requestCompact(machine, { mechanism: 'pi-rpc-compact', raw: { frame: compactFrame, note: 'the correlation id is assigned by the client at send time; the definitive frame is in the client frame log' } });
  step('request-compact', { status: rq.status, failure: rq.failure ? rq.failure.code : null });
  if (rq.status !== 'APPLIED') return { ok: false, stage: 'request-compact', standing: 'NONE', cycleIdBefore, trail, outcome: core.failures.OUTCOME.FAIL, detail: rq.failure && rq.failure.detail };

  const eventPromise = client.waitForEvent([frames.EVENTS.COMPACTION_END], { timeoutMs: compactionTimeoutMs });
  const responsePromise = client.request(compactFrame, { timeoutMs: compactionTimeoutMs });

  const [response, endEvent] = await Promise.all([responsePromise, eventPromise]);
  const resp = response.ok ? frames.readResponse(response.value) : { success: null, present: false, error: null };
  const end = endEvent.ok ? frames.readCompactionEnd(endEvent.value) : null;
  step('compact-signals', {
    responseArrived: response.ok, responseSuccess: resp.success,
    eventArrived: endEvent.ok, eventSettled: end ? end.settled : null,
    eventAborted: end ? end.aborted : null, eventWillRetry: end ? end.willRetry : null,
  });

  // --- 5. what actually arrived -----------------------------------------------------------------------
  const arrived = [];
  if (response.ok && resp.success === true) arrived.push('compact-response-success');
  if (endEvent.ok && end && end.settled) arrived.push(frames.EVENTS.COMPACTION_END);

  if (endEvent.ok && end && end.aborted) {
    const halt = machine.halt(core.failures.failure('COMPACT_REQUEST_REFUSED', `compaction_end reported aborted:true — ${end.why}`));
    return { ok: false, stage: 'observe', standing: 'NONE', cycleIdBefore, trail, outcome: core.failures.OUTCOME.FAIL, detail: end.why, halt };
  }
  if (endEvent.ok && end && end.willRetry) {
    return {
      ok: false, stage: 'observe', standing: 'NONE', cycleIdBefore, trail,
      outcome: core.failures.OUTCOME.CANNOT_DETERMINE,
      detail: `${end.why}. The rollover stays in COMPACTING: a retry Pi has not performed yet is not a completed compaction, and the verified handoff is still unconsumed on disk.`,
    };
  }
  if (!arrived.length) {
    const waited = Math.max(response.waitedMs || 0, endEvent.waitedMs || 0);
    const unobserved = core.evidence.make(core.evidence.KINDS.COMPACT_UNOBSERVED, {
      reason: (endEvent.reason || response.reason || 'no-signal'),
      waitedMs: waited,
      raw: { response: response.value || null, event: endEvent.value || null, responseReason: response.reason || null, eventReason: endEvent.reason || null },
    });
    bridge.appendEvent(dir, { kind: 'compact-unobserved', record: unobserved });
    return {
      ok: false, stage: 'observe', standing: 'NONE', cycleIdBefore, trail,
      outcome: core.failures.OUTCOME.CANNOT_DETERMINE,
      detail: `neither a successful compact response nor a settled compaction_end arrived within ${compactionTimeoutMs}ms. This is NOT evidence the compaction failed and NOT evidence it succeeded.`,
      evidence: unobserved,
    };
  }

  const obs = bridge.observeCompletion(machine, {
    signals: arrived,
    hostSignal: arrived.includes(frames.EVENTS.COMPACTION_END) ? frames.EVENTS.COMPACTION_END : 'compact-response-success',
    note: arrived.length === 1
      ? 'only one of the two documented compaction signals arrived; this rollover is proven with a named limitation, not fully'
      : 'both documented compaction signals arrived',
    raw: { response: response.value || null, compactionEnd: endEvent.value || null },
  });
  step('observe-completion', { status: obs.status, standing: obs.standing, failure: obs.failure ? obs.failure.code : null });
  if (obs.status !== 'APPLIED') return { ok: false, stage: 'observe', standing: obs.standing, cycleIdBefore, trail, outcome: core.failures.OUTCOME.FAIL, detail: obs.failure && obs.failure.detail };

  // --- 6. identity, empirically -----------------------------------------------------------------------
  const after = await client.request(frames.build.getState(), { timeoutMs: requestTimeoutMs });
  const afterState = after.ok ? frames.readState(after.value) : { sessionId: null };
  const vi = bridge.verifyIdentity(machine, {
    expectedId: expectedSessionId,
    observedId: afterState.sessionId,
    raw: { getState: after.value || null, reason: after.ok ? null : after.reason },
  });
  step('verify-identity', { status: vi.status, observed: afterState.sessionId, failure: vi.failure ? vi.failure.code : null });
  if (vi.status !== 'APPLIED') {
    return { ok: false, stage: 'identity', standing: obs.standing, cycleIdBefore, trail, outcome: vi.failure ? vi.failure.outcome : core.failures.OUTCOME.FAIL, detail: vi.failure && vi.failure.detail };
  }

  // --- 7. inject, exactly once ------------------------------------------------------------------------
  const claimed = bridge.injectOnce({ dir, handoffId: h.handoffId, consumerId: `pi-rpc-supervisor:${process.pid}`, machine });
  step('consume', { status: claimed.status });
  if (claimed.status !== 'CONSUMED') {
    return {
      ok: false, stage: 'inject', standing: obs.standing, cycleIdBefore, cycleIdAfter: machine.cycleId(), trail,
      outcome: claimed.status === 'ALREADY_CONSUMED' ? core.failures.OUTCOME.FAIL : core.failures.OUTCOME.CANNOT_DETERMINE,
      detail: claimed.status === 'ALREADY_CONSUMED'
        ? `handoff ${h.handoffId} was already consumed by ${claimed.firstConsumption && claimed.firstConsumption.consumerId} at ${claimed.firstConsumption && claimed.firstConsumption.consumedAt} — it will NOT be delivered a second time`
        : (claimed.failure && claimed.failure.detail) || 'the consumption receipt could not be decided',
    };
  }

  const text = bridge.renderInjection(claimed.handoff, { identityConfirmed: true });
  const injectFrame = injectCommand === 'prompt' ? frames.build.prompt(text) : frames.build.followUp(text);
  const injected = await client.request(injectFrame, { timeoutMs: requestTimeoutMs });
  step('inject', { ok: injected.ok, command: injectFrame.type, reason: injected.reason || null });

  bridge.setPendingInjection(dir, { handoffId: h.handoffId, cycleId: machine.cycleId(), identityConfirmed: true });

  return {
    ok: injected.ok,
    stage: injected.ok ? 'complete' : 'inject',
    standing: obs.standing,
    cycleIdBefore,
    cycleIdAfter: machine.cycleId(),
    handoffId: h.handoffId,
    signalsArrived: arrived,
    injectCommand: injectFrame.type,
    outcome: injected.ok ? core.failures.OUTCOME.PASS : core.failures.OUTCOME.CANNOT_DETERMINE,
    detail: injected.ok ? null : `the handoff was consumed and the ${injectFrame.type} delivering it did not come back (${injected.reason}); the receipt exists, so it will NOT be re-sent automatically`,
    trail,
  };
}

/**
 * The three-rollover proof.
 *
 * ⭐ WHY THREE AND NOT ONE. The v0.2 defect this whole design exists to end was a threshold latch keyed on
 * the session id, which fired once per CONVERSATION and then went silent — a bug that a single-rollover
 * test passes with flying colours. Three consecutive rollovers are what make a per-cycle re-arm
 * observable: cycle index must reach 3, and each cycle's latches must have re-armed.
 */
async function runCycles({ client, machine, projectDir, expectedSessionId, cycles = 3, measurementFor = null, regrowBetween = null, ...rest }) {
  const results = [];
  for (let i = 0; i < cycles; i += 1) {
    const measurement = typeof measurementFor === 'function' ? measurementFor(i) : null;
    // eslint-disable-next-line no-await-in-loop -- the cycles are sequential BY DEFINITION; a compaction
    // cannot overlap the next one, and running them concurrently would be testing a different product.
    const r = await runRollover({ client, machine, projectDir, expectedSessionId, measurement, ...rest });
    results.push({ cycle: i, ...r });
    if (!r.ok) break;
    if (i < cycles - 1 && typeof regrowBetween === 'function') {
      // eslint-disable-next-line no-await-in-loop -- regrowth is sequential BY DEFINITION: the next cycle
      // cannot observe what the regrowth produced until the regrowth has produced it.
      const regrow = await regrowBetween(i);
      if (regrow) results[results.length - 1].regrow = regrow;
    }
  }
  const completed = results.filter((r) => r.ok).length;
  const partial = results.some((r) => r.ok && r.standing === 'PARTIAL');
  return {
    ok: completed === cycles,
    completed,
    requested: cycles,
    cycleIndex: machine.cycleIndex(),
    standing: partial ? 'PARTIAL' : (completed === cycles ? 'FULL' : 'NONE'),
    outcome: completed === cycles ? core.failures.OUTCOME.PASS : (results.length && results[results.length - 1].outcome) || core.failures.OUTCOME.CANNOT_DETERMINE,
    results,
  };
}

module.exports = {
  DEFAULTS, SETTLE_EVENT_NAMES, SHIM_EXTENSIONS,
  probe, runCapture, needsShell, quoteArg, shellCommandLine, createClient, attach, runRollover, runCycles,
  frames, bridge, lock: lockLib,
};

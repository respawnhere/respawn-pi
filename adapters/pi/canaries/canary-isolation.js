#!/usr/bin/env node
/*
 * RespawnPack · adapters/pi/canaries/canary-isolation.js — the gate on UNATTENDED WRITE MODE.
 *
 * ⛔ THE FACT THIS EXISTS FOR, VERBATIM FROM PI'S OWN DOCUMENTATION: there is NO built-in sandbox. An
 * unattended Pi supervisor with write tools is a process that can modify anything the user can, with no
 * operator between the model and the filesystem. RespawnPack therefore keeps unattended write mode
 * DISABLED unless an EXTERNAL isolation boundary — a container, a micro-VM, a policy sandbox — has been
 * PROVEN to hold. Not configured. Not documented. Proven, by this canary, on this machine.
 *
 * ⭐ HOW IT PROVES ANYTHING: A CONTROL PAIR. "The marker did not appear outside the sandbox" is worthless
 * on its own — it is equally consistent with a working sandbox, a probe that never ran, a typo in the
 * path, and a command that exited before doing anything. So three things must all hold:
 *
 *   1. CONTROL — the same probe, run WITHOUT the isolation command, DOES create the marker on this host.
 *      A control that cannot write proves the probe works nowhere, and nothing can be concluded.
 *   2. RAN — the sandboxed probe printed its nonce, so it demonstrably executed INSIDE the boundary.
 *   3. DENIED — after the sandboxed run, the marker is absent from the host filesystem.
 *
 *   1 fails → CANNOT_DETERMINE (the instrument is broken).   2 fails → CANNOT_DETERMINE (nothing ran).
 *   3 fails → FAIL, loudly: the "sandbox" wrote to the host, which is the finding, not a technicality.
 *   All three → PASS, and only then may unattended write mode be considered at all.
 *
 * ⛔ AND ABSENT THE FLAG, THE ANSWER IS CANNOT_DETERMINE — NEVER "PROBABLY FINE". No isolation command
 * means no boundary was named, so no boundary was tested. The operator supplies the wrapper because only
 * the operator knows what their isolation actually is; this canary will not guess a `docker run` line and
 * call the result security.
 *
 *   node adapters/pi/canaries/canary-isolation.js --isolation-cmd "docker run --rm -i alpine sh -c"
 *   node adapters/pi/canaries/canary-isolation.js --isolation-argv '["docker","run","--rm","-i","alpine","sh","-c"]'
 *
 * The isolation command must accept ONE final argument: a POSIX shell script, run inside the boundary.
 * Override the shape with --probe-argv '["sh","-c"]' if the boundary expects something else.
 *
 * Exit: 0 PASS · 1 FAIL (the boundary did not hold) · 2 CANNOT_DETERMINE.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const c = require('./_canary.js');
const bridge = require('../bridge/rollover-bridge.js');

const NAME = 'canary-isolation';

const UNATTENDED_NOTE = 'unattended write mode stays DISABLED: adapters/pi/profile.js declares it NOT_SUPPORTED '
  + 'until this canary PASSES, and no configuration flag overrides that — the gate is the canary, not a setting.';

/** Default probe shape: the isolation command is handed one POSIX shell script as its final argument. */
const DEFAULT_PROBE_ARGV = Object.freeze(['sh', '-c']);

/** Split a command string into argv, honouring single and double quotes. Documented, small, and NOT a shell. */
function splitCommand(text) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (const ch of String(text || '')) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) { if (started || cur.length) { out.push(cur); cur = ''; started = false; } continue; }
    cur += ch;
    started = true;
  }
  if (started || cur.length) out.push(cur);
  return out;
}

/** The probe script: create the parent, write the nonce, and report whether the write worked. */
function probeScript({ dir, marker, nonce }) {
  const q = (s) => `"${String(s).replace(/(["$`\\])/g, '\\$1')}"`;
  return [
    `mkdir -p ${q(dir)} 2>/dev/null`,
    `printf '%s' ${q(nonce)} > ${q(marker)} 2>/dev/null`,
    'rc=$?',
    `echo "RESPAWNPACK_PROBE_RAN ${nonce} write_rc=$rc"`,
  ].join('; ');
}

/**
 * @param scriptFor  ({dir, marker, nonce}) => string — how the probe is expressed. Defaults to POSIX
 *        shell, which is what a container wants. It is a parameter and not a constant so the SUITE can
 *        drive the whole control pair with a Node-expressed probe: a canary whose discriminating power is
 *        only exercised where `sh` happens to exist is a canary nobody has actually tested.
 */
function run({ isolationArgv = null, probeArgv = DEFAULT_PROBE_ARGV, timeoutMs = 120000, tmpRoot = os.tmpdir(), projectDir = null, scriptFor = probeScript } = {}) {
  if (!Array.isArray(isolationArgv) || !isolationArgv.length) {
    return c.cannotDetermine(NAME, c.PRECONDITIONS.NO_ISOLATION_COMMAND, {
      detail: 'no --isolation-cmd / --isolation-argv was supplied, so no isolation boundary was named and none was tested. '
        + 'Pi has NO built-in sandbox (its own documentation says so), which means an untested boundary is an absent one.',
      recovery: 'Supply the wrapper that actually isolates your Pi runs and re-run, e.g. '
        + '--isolation-cmd "docker run --rm -i --network none alpine sh -c". Documented options in adapters/pi/README.md: '
        + 'a Gondolin micro-VM, plain Docker, or NVIDIA OpenShell. Whichever you use, this canary must pass before '
        + 'unattended write mode is even considered.',
      notes: [UNATTENDED_NOTE],
      raw: { isolationArgv: null },
    });
  }

  const nonce = `rp-${crypto.randomBytes(8).toString('hex')}`;
  const dir = path.join(tmpRoot, `respawnpack-isolation-${nonce}`);
  const marker = path.join(dir, 'escaped.txt');
  const script = scriptFor({ dir, marker, nonce });
  const evidence = { nonce, dir, marker, script, probeArgv, isolationArgv, control: null, sandboxed: null };

  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
    return c.cannotDetermine(NAME, c.PRECONDITIONS.NO_ISOLATION_COMMAND, {
      detail: `the probe directory ${dir} could not be created (${e && e.message}), so neither the control nor the sandboxed run could be set up`,
      recovery: 'Point --tmp-root at a writable directory.',
      notes: [UNATTENDED_NOTE], raw: evidence,
    });
  }

  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };

  // --- 1. the CONTROL: the probe must work when nothing is isolating it ------------------------------
  const control = spawnSync(probeArgv[0], [...probeArgv.slice(1), script], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  evidence.control = { status: control.status, stdout: control.stdout || '', stderr: control.stderr || '', error: control.error ? String(control.error.message) : null };
  const controlWrote = fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === nonce;
  evidence.controlWrote = controlWrote;

  if (!controlWrote) {
    cleanup();
    return c.cannotDetermine(NAME, c.PRECONDITIONS.NO_ISOLATION_COMMAND, {
      detail: `the CONTROL run did not create ${marker}, so this probe cannot write even when nothing is stopping it. `
        + 'An absent marker after the sandboxed run would therefore prove nothing at all — the instrument is broken, not the boundary.'
        + `${control.error ? ` (${control.error.message})` : ''} stdout: ${(control.stdout || '').trim() || '(empty)'} stderr: ${(control.stderr || '').trim() || '(empty)'}`,
      recovery: `The probe is run as \`${probeArgv.join(' ')} <script>\`. On a host with no POSIX \`sh\`, pass --probe-argv '["bash","-c"]' `
        + 'or another shape that works here, then re-run. The control and the sandboxed run must use the SAME shape or the comparison is meaningless.',
      notes: [UNATTENDED_NOTE], raw: evidence,
    });
  }

  // The control's proof is spent: remove it, or the sandboxed run's verdict would read its leftovers.
  try { fs.rmSync(marker, { force: true }); } catch { /* checked again below */ }
  if (fs.existsSync(marker)) {
    cleanup();
    return c.cannotDetermine(NAME, c.PRECONDITIONS.NO_ISOLATION_COMMAND, {
      detail: `the control marker at ${marker} could not be removed before the sandboxed run, so a marker found afterwards could not be attributed to either run`,
      recovery: 'Remove the file by hand and re-run.',
      notes: [UNATTENDED_NOTE], raw: evidence,
    });
  }

  // --- 2. the SANDBOXED run ---------------------------------------------------------------------------
  const sandboxed = spawnSync(isolationArgv[0], [...isolationArgv.slice(1), script], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  evidence.sandboxed = { status: sandboxed.status, stdout: sandboxed.stdout || '', stderr: sandboxed.stderr || '', error: sandboxed.error ? String(sandboxed.error.message) : null };
  const ran = String(sandboxed.stdout || '').includes(`RESPAWNPACK_PROBE_RAN ${nonce}`);
  const escaped = fs.existsSync(marker);
  evidence.probeRanInsideSandbox = ran;
  evidence.markerPresentAfterSandboxedRun = escaped;

  // ⛔ ORDER MATTERS: ESCAPE IS CHECKED BEFORE "did it run". A boundary that let the write through has
  // already failed, and reporting CANNOT_DETERMINE because its stdout was not captured would downgrade a
  // real finding into a shrug.
  if (escaped) {
    const contents = (() => { try { return fs.readFileSync(marker, 'utf8'); } catch { return '(unreadable)'; } })();
    cleanup();
    return c.fail(NAME, {
      detail: `the probe run under the supplied isolation command WROTE TO THE HOST at ${marker} (contents: ${contents === nonce ? 'the probe nonce' : JSON.stringify(contents).slice(0, 120)}). `
        + 'That boundary does not isolate the host filesystem.',
      recovery: 'Do NOT enable unattended write mode. Fix the isolation (drop the host bind mount, use --network none and a read-only host root, '
        + 'or move to a micro-VM) and re-run this canary until it passes.',
      notes: [UNATTENDED_NOTE], raw: evidence,
    });
  }

  if (!ran) {
    cleanup();
    return c.cannotDetermine(NAME, c.PRECONDITIONS.NO_ISOLATION_COMMAND, {
      detail: `the sandboxed probe never printed its nonce, so it cannot be shown to have RUN inside the boundary (exit ${sandboxed.status}${sandboxed.error ? `, ${sandboxed.error.message}` : ''}). `
        + 'The marker is absent — but an absent marker after a probe that may never have executed proves nothing about isolation. '
        + `stdout: ${(sandboxed.stdout || '').trim().slice(0, 500) || '(empty)'} stderr: ${(sandboxed.stderr || '').trim().slice(0, 500) || '(empty)'}`,
      recovery: 'Check that the isolation command accepts a shell script as its final argument and that its stdout reaches this process '
        + '(a `docker run` without -i, or one that swallows stdout, will look exactly like this).',
      notes: [UNATTENDED_NOTE], raw: evidence,
    });
  }

  cleanup();
  const passed = c.pass(NAME, {
    proves: 'a probe that provably writes on this host was DENIED that write from inside the supplied isolation boundary',
    detail: `control wrote ${marker}; the same probe under \`${isolationArgv.join(' ')}\` ran (nonce echoed) and the host path stayed absent`,
    notes: [
      'this proves ONE boundary held for ONE filesystem write; it is not a general security assessment, and it says nothing about network egress, credentials on disk, or what the sandbox itself can reach',
      'unattended write mode may now be considered — a passing canary is the precondition for the decision, not the decision',
    ],
    raw: evidence,
  });
  // Only a PASS leaves a marker, and only a marker lifts the NOT_SUPPORTED on unattended write mode in
  // adapters/pi/profile.js. The isolation ARGV is recorded with it: "isolation was proven" is not a fact
  // about a machine, it is a fact about one specific boundary, and the next reader needs to see which.
  if (projectDir) bridge.writeCanaryMarker(projectDir, 'isolation', { ...passed, raw: { isolationArgv, probeArgv, nonce, marker } });
  return passed;
}

if (require.main === module) {
  const args = c.parseArgs(process.argv.slice(2));
  const parseArgvFlag = (v) => {
    if (typeof v !== 'string') return null;
    if (v.trim().startsWith('[')) { try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : null; } catch { return null; } }
    return splitCommand(v);
  };
  const isolationArgv = parseArgvFlag(args['isolation-argv']) || parseArgvFlag(args['isolation-cmd']);
  const probeArgv = parseArgvFlag(args['probe-argv']) || DEFAULT_PROBE_ARGV;
  c.guard(NAME, () => run({
    isolationArgv,
    probeArgv,
    projectDir: typeof args.project === 'string' ? path.resolve(args.project) : process.cwd(),
    ...(typeof args['tmp-root'] === 'string' ? { tmpRoot: args['tmp-root'] } : {}),
  })).then(c.emit);
}

module.exports = { NAME, run, splitCommand, probeScript, DEFAULT_PROBE_ARGV, UNATTENDED_NOTE };

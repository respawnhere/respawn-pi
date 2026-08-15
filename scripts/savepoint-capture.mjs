#!/usr/bin/env node
/*
 * RespawnPack · scripts/savepoint-capture.mjs — Tier 2 savepoint auto-filler.
 *
 * Merges agent-written Tier 1 + Tier 2 fields with auto-captured git state and the most recent
 * verification run, then writes the final savepoint to .respawnpack/runtime/rollover/_pi-pending-note.json.
 *
 * Usage:
 *   node scripts/savepoint-capture.mjs \
 *     --note /tmp/my-note.json \
 *     --output ../.respawnpack/runtime/rollover/_pi-pending-note.json \
 *     [--verify-cmd "node --test ..."] [--no-verify]
 *
 * Flags:
 *   --note <path>       Path to the agent-written note (JSON with Tier 1 + Tier 2 agent fields).
 *                       Required unless --from-stdin.
 *   --from-stdin        Read the agent-written note from stdin instead of --note.
 *   --output <path>     Path to write the final savepoint. Defaults to the conventional
 *                       .respawnpack/runtime/rollover/_pi-pending-note.json at the project root.
 *   --verify-cmd <cmd>  The exact verification command to run. Defaults to the project-standard
 *                       'node --test $(find . -name "*.test.mjs" -not -path star-slash node_modules -not -path star-slash .respawnpack)'.
 *   --no-verify         Skip running the verification command (still fills workingTree from git).
 *                       Use only when verification is genuinely impossible (env issue, network down).
 *   --verify-timeout-ms <n>   Max ms to wait for the verification command. Defaults to 120000.
 *
 * Output:
 *   Writes a single JSON object with all Tier 1 + Tier 2 fields. The agent-written note's fields
 *   take precedence; auto-captured fields fill in only what the agent didn't provide.
 *
 * Failure modes:
 *   - git not available: workingTree is filled with `null` for branch/head, counts come from
 *     a best-effort `git status --short` parse (empty if git is missing).
 *   - verification command times out: verification.lastResult.wallClockMs records the timeout,
 *     pass/fail/skip are recorded as 0, and a `lastResult.error: "timeout"` flag is added.
 *   - verification command exits non-zero: pass/fail/skip are still recorded from the parser
 *     output, and a `lastResult.failed: true` flag is added so the resume can tell.
 *
 * This script never THROWS on verification failure — it records the failure and writes the note
 * anyway, because the handoff must always be durable.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// The savepoint lives at the project root's .respawnpack/runtime/rollover/. The project root is
// the nearest ancestor of the package that already contains a .respawnpack/ directory; if none
// is found, we walk up to /home/<user> or /. This lets the script be run from inside the package
// without the caller having to know how deep it is nested.
function findProjectRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, '.respawnpack'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // No .respawnpack/ found — fall back to two levels up (works for respawn-pi-0.1.0/respawn-pi/ layout)
  return path.resolve(PACKAGE_ROOT, '..', '..');
}
const PROJECT_ROOT = findProjectRoot(PACKAGE_ROOT);

// --- arg parsing ---------------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { fromStdin: false, noVerify: false, verifyTimeoutMs: 120000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--note') args.note = argv[++i];
    else if (a === '--from-stdin') args.fromStdin = true;
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--verify-cmd') args.verifyCmd = argv[++i];
    else if (a === '--no-verify') args.noVerify = true;
    else if (a === '--verify-timeout-ms') args.verifyTimeoutMs = parseInt(argv[++i], 10);
    else throw new Error(`unknown flag: ${a}`);
  }
  return args;
}

// --- auto-capture: git state --------------------------------------------------------------------
function captureWorkingTree() {
  const wt = { branch: null, head: null, headMessage: null, staged: 0, modified: 0, untracked: 0 };
  try {
    const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', cwd: PACKAGE_ROOT });
    if (branch.status === 0) wt.branch = branch.stdout.trim();
    const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd: PACKAGE_ROOT });
    if (head.status === 0) wt.head = head.stdout.trim();
    const log = spawnSync('git', ['log', '-1', '--pretty=%s'], { encoding: 'utf8', cwd: PACKAGE_ROOT });
    if (log.status === 0) wt.headMessage = log.stdout.trim();
    const status = spawnSync('git', ['status', '--short'], { encoding: 'utf8', cwd: PACKAGE_ROOT });
    if (status.status === 0) {
      const lines = status.stdout.split('\n').filter(Boolean);
      for (const line of lines) {
        const x = line[0], y = line[1];
        if (x === '?' && y === '?') wt.untracked++;
        else if (x !== ' ') wt.staged++;
        else if (y !== ' ') wt.modified++;
      }
    }
  } catch {
    // git not available — leave the fields null; resume can re-derive
  }
  return wt;
}

// --- auto-capture: verification run -------------------------------------------------------------
const DEFAULT_VERIFY_CMD =
  'node --test $(find . -name "*.test.mjs" -not -path "*/node_modules/*" -not -path "*/.respawnpack/*")';

function captureVerification(command, timeoutMs) {
  const startedAt = Date.now();
  const result = {
    ranAt: new Date(startedAt).toISOString(),
    pass: 0,
    fail: 0,
    skip: 0,
    total: 0,
    wallClockMs: 0,
    preCommit: true,
    suites: [],
    command,
  };
  let run;
  try {
    run = spawnSync('bash', ['-c', command], {
      encoding: 'utf8',
      cwd: PACKAGE_ROOT,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024, // 32 MiB — full-suite output can exceed 1 MiB
    });
  } catch (err) {
    result.wallClockMs = Date.now() - startedAt;
    result.error = `spawn_failed: ${err.message}`;
    return result;
  }
  result.wallClockMs = Date.now() - startedAt;
  if (run.error) {
    if (run.error.code === 'ETIMEDOUT' || run.signal === 'SIGTERM') {
      result.error = 'timeout';
    } else {
      result.error = `spawn_failed: ${run.error.message}`;
    }
    return result;
  }
  // The reporter prints `ℹ tests <N>`, `ℹ pass <N>`, `ℹ fail <N>`, `ℹ skipped <N>`, `ℹ duration_ms <N>`.
  // Suites are reported per-file in TAP or spec; for `node --test` with multiple files, the totals
  // are on the last summary block. Suites-by-file come from `ℹ <path> -> ℹ pass/fail/skipped/tests`
  // but the standard reporter doesn't print per-file summaries, so suites[] is best-effort empty
  // unless a custom reporter is wired. We parse what's available.
  const out = (run.stdout || '') + '\n' + (run.stderr || '');
  const m = (re) => { const x = re.exec(out); return x ? parseInt(x[1], 10) : null; };
  const tests = m(/^ℹ tests\s+(\d+)/m);
  const pass = m(/^ℹ pass\s+(\d+)/m);
  const fail = m(/^ℹ fail\s+(\d+)/m);
  const skipped = m(/^ℹ skipped\s+(\d+)/m);
  if (tests !== null) result.total = tests;
  if (pass !== null) result.pass = pass;
  if (fail !== null) result.fail = fail;
  if (skipped !== null) result.skip = skipped;
  if (run.status !== 0) result.failed = true;
  return result;
}

// --- main --------------------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  let agentNote = {};
  if (args.fromStdin) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    agentNote = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } else if (args.note) {
    agentNote = JSON.parse(fs.readFileSync(args.note, 'utf8'));
  } else {
    throw new Error('--note <path> or --from-stdin is required');
  }
  const verifyCmd = args.verifyCmd || DEFAULT_VERIFY_CMD;
  const verification = args.noVerify
    ? { command: verifyCmd, skipped: true }
    : captureVerification(verifyCmd, args.verifyTimeoutMs);
  const workingTree = captureWorkingTree();
  const final = {
    ...agentNote,
    verification: { ...(agentNote.verification || {}), ...verification },
    workingTree: { ...(agentNote.workingTree || {}), ...workingTree },
  };
  const outputPath = args.output || path.resolve(PROJECT_ROOT, '.respawnpack', 'runtime', 'rollover', '_pi-pending-note.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(final, null, 2) + '\n');
  process.stderr.write(`savepoint-capture: wrote ${outputPath} (verify pass=${verification.pass ?? '?'} fail=${verification.fail ?? '?'} skip=${verification.skip ?? '?'} wall=${verification.wallClockMs ?? '?'}ms)\n`);
}

main().catch((err) => {
  process.stderr.write(`savepoint-capture: fatal — ${err.message}\n`);
  process.exit(1);
});

/*
 * RespawnPack · adapters/pi/package/extensions/index-guard.ts
 *
 * Pi extension port of RespawnPack hooks/index-guard.js. Preserves the load-bearing semantic:
 * a FILE-BASED EXCLUSIVE WRITER LEASE on the git INDEX, keyed by the absolute path of the index
 * file (so linked worktrees get their own lease by construction and isolated writers never collide).
 *
 * Acts ONLY on bash commands that mutate the git index — git add / commit / rm / mv / reset — AND
 * ONLY when parallel agents are sharing this index (concurrent writers). In single-agent mode the
 * gate is a no-op: nobody else to lease against.
 *
 * Opt-out marker: .respawnpack/index-guard.disable at the project root (presence disables).
 *
 * Concurrent-writer detection: any `.respawnpack/spawn-state-*.json` with a fresh mtime and a
 * positive `count` — mirror of spawn-guard.js's counter. Absent file → no wave → no enforcement.
 * Stale mtime → ignored. Unreadable counter → AMBIGUOUS → treated as in-flight (fail closed).
 *
 * Pi contract: subscribes to `tool_call`, only acts when `event.toolName === "bash"`. Reads
 * `event.input.command`. Returns `{block: true, reason}` when the lease is invalid or the
 * concurrent-writer gate is ambiguous; returns `undefined` otherwise.
 *
 * ⛔ Fail closed: any error that prevents lease establishment is treated as another principal
 * holding it — refusal, never silent allow. A guard that proceeds when its own guarantee is
 * unavailable is not a guard.
 *
 * Deliberate limitations of this port vs. the source hook:
 *   • NO editor-tool containment (Edit / Write / MultiEdit / NotebookEdit) — the source hook also
 *     enforces a per-agent scratch-namespace rule on those, which is a separate concern from the
 *     index lease and lives in worktree-guard.js conceptually. This port is the lease layer.
 *   • NO shell-parsing of compound commands — the source unwraps `sh -c "…"`, `eval`, xargs, $()
 *     substitutions, etc. This port inspects the surface command line only. A genuinely-dynamic
 *     `-C "$VAR"` is treated as a literal `$VAR` path, which `git` will reject — but a more
 *     elaborate hidden form is out of scope for the lease layer.
 *   • NO PostToolUse confirmation of provisional leases, NO SessionEnd global release — leases
 *     time out by TTL instead. The source hook has both; we trade them for simplicity and the
 *     fact that Pi's tool_call is the only event this port subscribes to.
 *   • NO foreign-staged-state protection — the source also reads `git diff --cached` and refuses to
 *     overwrite stages the session did not create. That belongs to a separate guard; the lease here
 *     only arbitrates WHO may write, not WHAT they may write over.
 */

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { guardedGovernanceEnabled } from "./governance-profile.ts";

const EXTENSION_NAME = "index-guard";

// Bash-side detection of index-mutating git subcommands. Optional `-C <dir>` / `--git-dir=<dir>`
// / `--work-tree=<dir>` prefixes are matched (separately from the subcommand) so we can resolve
// the right index identity; we don't try to be a full shell parser (that's the source hook's job
// and out of scope for the lease layer).
const GIT_MUT_RE = /\bgit\b(?:\s+(?:-C\s+\S+|--git-dir(?:=|\s+)\S+|--work-tree(?:=|\s+)\S+))*\s+(add|commit|rm|mv|reset)\b/;

// Spawn-state window: stale counters are ignored (spawn-guard self-heals them).
const SPAWN_STALE_MS = Number(process.env.RESPAWNPACK_SPAWN_STALE_MS) || 30 * 60 * 1000;
// Lease TTL — generous because heartbeats are the freshness signal, not expiry.
const LEASE_TTL_MS = Number(process.env.RESPAWNPACK_INDEX_LEASE_TTL_MS) || 15 * 60 * 1000;
// Lock contention: 5s is enough for any genuine handoff and short enough to fail closed promptly.
const STALE_LOCK_MS = 5000;

const DISABLE_MARKER = ".respawnpack/index-guard.disable";
const LEASE_FILE = ".respawnpack/index-guard.lease";

const LOCK_CONTENTION_CODES = new Set(["EEXIST", "EPERM", "EACCES", "EBUSY"]);

// --- tiny resolvers -------------------------------------------------------------------------------

/** Project dir for the disable marker / lease file. Pi's payload varies across versions; tolerant. */
function projectDirOf(event: any, ctx: any): string {
  const cands = [
    event?.cwd,
    event?.projectDir,
    event?.input?.cwd,
    ctx?.cwd,
    ctx?.projectDir,
    typeof process !== "undefined" && process.env
      ? (process.env.RESPAWN_PI_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR)
      : null,
    typeof process !== "undefined" ? process.cwd() : ".",
  ];
  for (const c of cands) if (typeof c === "string" && c) return c;
  return ".";
}

/** Session id for the lease principal key. Pi does not always expose it; fall back to "unknown". */
function sessionIdOf(event: any, ctx: any): string {
  const cands = [event?.sessionId, ctx?.sessionId, ctx?.session?.id];
  for (const c of cands) if (typeof c === "string" && c) return c;
  return "unknown";
}

// --- lease primitives ------------------------------------------------------------------------------

/**
 * Run `fn` under an exclusive lock on `<file>.lock`, or report that exclusivity could not be
 * established. Returns `{locked:true, value}` or `{locked:false, why}`. ⛔ Never runs `fn` unlocked.
 *
 * Mirrors `_index-lease.js` `withLock`: retry on Windows-specific EPERM / EACCES, reclaim stale
 * locks (older than STALE_LOCK_MS), and fail closed on a fresh lock we waited too long for.
 */
function withLock<T>(projectDir: string, file: string, fn: () => T): { locked: true; value: T } | { locked: false; why: string } {
  const lock = `${file}.lock`;
  try { mkdirSync(join(projectDir, ".respawnpack"), { recursive: true }); }
  catch (e) { return { locked: false, why: `cannot create the runtime directory: ${(e as any).code || (e as Error).message}` }; }

  const deadline = Date.now() + 4000;
  for (;;) {
    let fd: number | undefined;
    try {
      fd = openSync(lock, "wx");
    } catch (e) {
      const code = ((e as any) && (e as any).code) || "UNKNOWN";
      if (!LOCK_CONTENTION_CODES.has(code)) return { locked: false, why: `cannot create the lock file: ${code === "UNKNOWN" ? (e as Error).message : code}` };
      let age: number | null = null;
      try { age = Date.now() - statSync(lock).mtimeMs; }
      catch {
        if (Date.now() > deadline) return { locked: false, why: `timed out contending for the lock file (last error ${code})` };
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3);
        continue;
      }
      if (age > STALE_LOCK_MS) { try { unlinkSync(lock); } catch { /* raced */ } continue; }
      if (Date.now() > deadline) return { locked: false, why: "timed out waiting for the lease lock while it was still fresh — another principal is active" };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3);
      continue;
    }
    try {
      return { locked: true, value: fn() };
    } finally {
      try { closeSync(fd); } catch { /* ignore */ }
      try { unlinkSync(lock); } catch { /* already gone */ }
    }
  }
}

/**
 * The lease map: `{ [indexIdentity]: { holderKey, acquiredAt, heartbeatAt } }`. ENOENT is an empty
 * map; any other failure returns `ok:false` so callers can fail closed.
 */
type LeaseRecord = { holderKey: string; acquiredAt: string; heartbeatAt: string };
type LeaseMap = Record<string, LeaseRecord>;

function readLeaseMap(projectDir: string): { ok: true; map: LeaseMap } | { ok: false; reason: string } {
  const file = join(projectDir, LEASE_FILE);
  try {
    const txt = readFileSync(file, "utf8");
    const parsed = JSON.parse(txt);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false as const, reason: "the lease file is not a JSON object" };
    }
    return { ok: true as const, map: parsed as LeaseMap };
  } catch (e) {
    if (e && (e as any).code === "ENOENT") return { ok: true as const, map: {} };
    return { ok: false as const, reason: `the lease file could not be read (${(e as any).code || (e as Error).message})` };
  }
}

function writeLeaseMap(projectDir: string, map: LeaseMap): boolean {
  const file = join(projectDir, LEASE_FILE);
  try {
    mkdirSync(join(projectDir, ".respawnpack"), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(map, null, 2));
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** A lease is stale when born or heartbeat age exceed the TTL — heartbeat is the freshness signal. */
function isLeaseStale(rec: LeaseRecord, now = Date.now()): boolean {
  if (!rec) return true;
  const born = Date.parse(rec.acquiredAt || "") || 0;
  const beat = Date.parse(rec.heartbeatAt || rec.acquiredAt || "") || 0;
  if (!born) return true;
  if (now - born > LEASE_TTL_MS) return true;
  if (now - beat > LEASE_TTL_MS / 3) return true;
  return false;
}

// --- index identity -------------------------------------------------------------------------------

/**
 * The canonical absolute path of the index a git command run in `dir` would mutate. This is the
 * lease key: linked worktrees get their own index by construction, so isolated writers never collide.
 *
 * Mirrors `_index-lease.js` `indexIdentity`: tries `--path-format=absolute` first (git 2.31+), falls
 * back to the relative form joined with `--show-toplevel`. Returns null on any git failure.
 */
function gitIndexIdentity(dir: string): string | null {
  try {
    const abs = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-path", "index"],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (abs) return abs.replace(/\\/g, "/").toLowerCase();
  } catch {
    // older git or not a repo — try the relative form
  }
  try {
    const rel = execFileSync(
      "git",
      ["rev-parse", "--git-path", "index"],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!rel) return null;
    const top = execFileSync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim() || dir;
    return join(top, rel).replace(/\\/g, "/").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Resolve the target directory of a `git …` command statically. The source hook uses a real shell
 * parser to handle quoted paths and substitutions; this port extracts the most common shapes and
 * treats anything more dynamic as a literal, which `git` will reject — and which
 * `gitIndexIdentity()` will then return null for, triggering the fail-closed deny path.
 */
function targetDirFromGitCmd(cmd: string, defaultDir: string): string {
  const cMatch = cmd.match(/(?:^|\s)-C\s+(\S+)/);
  if (cMatch) return cMatch[1];
  const gdMatch = cmd.match(/(?:^|\s)--git-dir(?:=|\s+)(\S+)/);
  if (gdMatch) return gdMatch[1];
  const wtMatch = cmd.match(/(?:^|\s)--work-tree(?:=|\s+)(\S+)/);
  if (wtMatch) return wtMatch[1];
  return defaultDir;
}

// --- concurrent-writer detection -------------------------------------------------------------------

/**
 * Is a parallel wave in flight? Reads any `.respawnpack/spawn-state-*.json` with a fresh mtime and a
 * positive `count`. Mirrors `waveInFlight()` in hooks/index-guard.js.
 *
 * ⛔ FAIL CLOSED on ambiguity: an unreadable counter cannot say there is NO wave, so the conservative
 * answer is to assume concurrent writers MAY exist. The alternative — silent no — is exactly the
 * failure mode the source hook explicitly rejects.
 */
function waveInFlight(projectDir: string): { inFlight: boolean; ambiguous: boolean; reason?: string } {
  const runtimeDir = join(projectDir, ".respawnpack");
  let names: string[];
  try { names = readdirSync(runtimeDir); }
  catch (e) {
    if (e && (e as any).code === "ENOENT") return { inFlight: false, ambiguous: false };
    return { inFlight: false, ambiguous: true, reason: `the wave-counter directory could not be opened (${(e as any).code || (e as Error).message})` };
  }
  for (const entry of names) {
    if (!/^spawn-state-[A-Za-z0-9_-]+\.json$/.test(entry)) continue;
    const file = join(runtimeDir, entry);
    let stat;
    try { stat = statSync(file); } catch { continue; }
    if (Date.now() - stat.mtimeMs > SPAWN_STALE_MS) continue; // stale → spawn-guard has self-healed it
    let text;
    try { text = readFileSync(file, "utf8"); }
    catch (e) { return { inFlight: false, ambiguous: true, reason: `the wave counter could not be opened (${(e as any).code || (e as Error).message})` }; }
    let count;
    try {
      const obj = JSON.parse(text);
      count = Number(obj && obj.count);
    } catch {
      return { inFlight: false, ambiguous: true, reason: "the wave counter is corrupt or unreadable" };
    }
    if (!Number.isFinite(count)) return { inFlight: false, ambiguous: true, reason: "the wave counter holds no usable count" };
    if (count > 0) return { inFlight: true, ambiguous: false };
  }
  return { inFlight: false, ambiguous: false };
}

// --- the deny shape --------------------------------------------------------------------------------

function deny(reason: string): { block: true; reason: string } {
  return { block: true, reason };
}

// --- the event handler -----------------------------------------------------------------------------

export default function (pi: any) {
  pi.on("tool_call", (event: any, ctx: any) => {
    if (!event || event.toolName !== "bash") return undefined;
    if (!guardedGovernanceEnabled(event, ctx)) return undefined;
    const cmd: string = (event.input && typeof event.input.command === "string") ? event.input.command : "";
    if (!cmd) return undefined;
    if (!GIT_MUT_RE.test(cmd)) return undefined;

    const projectDir = projectDirOf(event, ctx);

    // Opt-out: any single .respawnpack/index-guard.disable disables the whole extension.
    if (existsSync(join(projectDir, DISABLE_MARKER))) return undefined;

    const principalKey = `pi:${sessionIdOf(event, ctx)}`;

    // Concurrent-writer gate. Absent / stale counter → no wave → not our fight.
    const wave = waveInFlight(projectDir);
    if (!wave.inFlight && !wave.ambiguous) return undefined;

    const file = join(projectDir, LEASE_FILE);
    const targetDir = targetDirFromGitCmd(cmd, projectDir);
    const identity = gitIndexIdentity(targetDir);
    if (!identity) {
      return deny(
        `🔒 index-guard: a parallel wave is in flight and "git …" targets a directory whose git index ` +
        `cannot be identified ("${targetDir}"). Refused fail-closed — when the writer lease cannot be ` +
        `established against a known index, the only safe answer is to refuse.\n` +
        `If this command should not need a lease, dispatch with isolation ("worktree") so the parallel ` +
        `wave does not apply to this work, or run git from the directory you mean to affect.`,
      );
    }

    type Locked = { locked: true; value: { ok: true } | { ok: false; reason: string } };
    type Unlocked = { locked: false; why: string };
    type InnerResult = { ok: true } | { ok: false; reason: string };

    function acquire(): InnerResult {
      const r = readLeaseMap(projectDir);
      if (r.ok !== true) {
        return { ok: false, reason: r.reason };
      }
      const map = r.map;
      const held = map[identity];

      // ⛔ Unreadable lease file is NOT "nobody holds it" — the source's lesson. We surfaced the reason
      // via `readLeaseMap` already, so we only handle the in-lock verdict here.
      if (held && !isLeaseStale(held) && held.holderKey !== principalKey) {
        return { ok: false, reason: `held by ${held.holderKey} since ${held.acquiredAt}` };
      }

      const now = new Date().toISOString();
      map[identity] = {
        holderKey: principalKey,
        acquiredAt: held && held.holderKey === principalKey ? held.acquiredAt : now,
        heartbeatAt: now,
      };
      if (!writeLeaseMap(projectDir, map)) {
        return { ok: false, reason: "the lease could not be persisted" };
      }
      // Read back: a write that did not land is not an acquisition.
      const back = readLeaseMap(projectDir);
      if (back.ok !== true) {
        return { ok: false, reason: back.reason };
      }
      if (back.map[identity]?.holderKey !== principalKey) {
        return { ok: false, reason: "the lease did not read back as held by this principal" };
      }
      return { ok: true };
    }

    const out: Locked | Unlocked = withLock<InnerResult>(projectDir, file, acquire);

    if (!out.locked) {
      return deny(
        `🔒 index-guard: the writer lease on this index could not be established (${(out as Unlocked).why}). ` +
        `Denied fail-closed — a guard that proceeds when its own guarantee is unavailable is not a guard.`,
      );
    }
    const verdict = out.value;
    if (verdict.ok !== true) {
      if (verdict.reason.startsWith("held by")) {
        return deny(
          `🔒 index-guard: another principal (${verdict.reason}) holds the writer lease on this git index. ` +
          `Two sessions staging into one index is the DF-004 collision with different actors.\n` +
          `Wait for it to finish, or work in a separate worktree — \`git worktree add ../side -b side\` — ` +
          `which has its own index and so its own lease.\n` +
          `Target index: ${identity}`,
        );
      }
      return deny(
        `🔒 index-guard: the writer lease could not be acquired (${verdict.reason}). Denied fail-closed.`,
      );
    }
    return undefined;
  });
}

export {
  EXTENSION_NAME,
  GIT_MUT_RE,
  DISABLE_MARKER,
  LEASE_FILE,
  SPAWN_STALE_MS,
  LEASE_TTL_MS,
  STALE_LOCK_MS,
  projectDirOf,
  sessionIdOf,
  gitIndexIdentity,
  targetDirFromGitCmd,
  waveInFlight,
  readLeaseMap,
  writeLeaseMap,
  isLeaseStale,
  withLock,
};
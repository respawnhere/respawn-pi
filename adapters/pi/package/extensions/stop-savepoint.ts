/*
 * RespawnPack · adapters/pi/package/extensions/stop-savepoint.ts
 *
 * Active advisory port of RespawnPack/hooks/stop-savepoint.js. At `session_start` it captures a
 * content-addressed tree baseline. At `agent_settled` it records and reports a new session delta,
 * without asking the model whether closeout is warranted.
 *
 * ⛔ COMPACTION HAS ONE OWNER. This extension never requests compaction. The rollover extension is
 * the sole production owner of `ctx.compact()` because it stages and reads back a verified handoff
 * before exposing that irreversible effect. A custom instruction is not a handoff and cannot make
 * an early compaction safe.
 *
 * ⛔ DETECTION IS PER-FILE CONTENT IDENTITY, NOT STATUS FLAGS. A path moving between Git buckets
 * without byte changes must compare equal. Working, staged, and untracked digests are retained for
 * diagnostics; the content digest is the comparison identity. Deletions fall back to bucket keys.
 * `.respawnpack/*` is excluded so runtime bookkeeping cannot make the session dirty by itself.
 *
 * ⛔ THE ADVISORY MUST NOT LOOP. The `(session, HEAD, delta digest)` fingerprint suppresses an
 * unchanged retry while genuinely new work re-arms the nudge. Missing baselines and non-Git trees
 * remain CANNOT_DETERMINE and quiet.
 *
 * Pi contract: registered in `package.json`; subscribes to `session_start` and `agent_settled`;
 * persists the baseline and stop record; bumps an active goal cycle; emits a bounded advisory.
 * The user-facing `ctx.ui.notify` is the cross-platform notification surface.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { loadPackageGoalContract } from "./goal-contract-loader.ts";

const EXTENSION_NAME = "stop-savepoint";

// Pack's own scratch directory — recording its digests would make every session look dirty to itself.
const SELF_PREFIX = ".respawnpack";

// Cap so a single large file cannot dominate the per-path digest; size is folded in below.
const MAX_HASH_BYTES = 1024 * 1024;

// ---- tiny utilities -------------------------------------------------------------------------------

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

function safeId(id: string | null | undefined): string {
  return String(id || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isSelfPath(p: string): boolean {
  return p === SELF_PREFIX || p.startsWith(`${SELF_PREFIX}/`) || p.startsWith(`${SELF_PREFIX}\\`);
}

/** execFileSync wrapper — never a shell string, stdio swallowed so a noisy repo can't corrupt the channel. */
function git(dir: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function isRepo(dir: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

// ---- per-file digest capture (mirrors _runtime.js `treeState` + `contentIdentity`) -----------------

/**
 * Per-file diff digests from ONE `git diff` call, split on `diff --git` headers. The map's keys
 * are paths, NOT bucket-prefixed keys — the bucket prefixes (`W:` / `S:` / `U:` / `C:`) live in
 * `treeState`, which composes the diagnostic picture from these per-path digests.
 */
function perFileDiffDigests(dir: string, cached: boolean): Record<string, string> {
  const map: Record<string, string> = {};
  const out = git(dir, ["diff", ...(cached ? ["--cached"] : []), "--no-color", "--no-ext-diff"]);
  if (!out) return map;
  for (const chunk of out.split(/^diff --git /m)) {
    if (!chunk.trim()) continue;
    const m = /^a\/(.+?) b\/(.+?)$/m.exec(chunk);
    const p = m ? m[2] : null;
    if (!p || isSelfPath(p)) continue;
    map[p] = sha(chunk);
  }
  return map;
}

/** Content digest of the file at `abs`. Null for unreadable / directory. */
function fileDigest(abs: string): string | null {
  try {
    const st = statSync(abs);
    if (st.isDirectory()) return null;
    const fd = openSync(abs, "r");
    try {
      const len = Math.min(st.size, MAX_HASH_BYTES);
      const buf = Buffer.alloc(len);
      if (len) readSync(fd, buf, 0, len, 0);
      // Size participates so appending past the cap still changes the digest.
      return sha(`${st.size}:${buf.toString("binary")}`);
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * A content-addressed snapshot of everything a session could plausibly change. Records THREE
 * buckets (W: / S: / U:) for diagnostics AND a per-path `C:` content digest for comparison — the
 * `C:` key is what makes "an untracked file got `git add`'d with no byte changes" compare equal
 * instead of registering as a phantom modification.
 */
function treeState(dir: string): { head: string | null; files: Record<string, string>; capturedAt: string } | null {
  if (!isRepo(dir)) return null;
  let headRev: string | null = null;
  try {
    const rev = git(dir, ["rev-parse", "HEAD"]).trim();
    headRev = rev || null;
  } catch {
    headRev = null;
  }

  const files: Record<string, string> = {};
  for (const [p, d] of Object.entries(perFileDiffDigests(dir, false))) files[`W:${p}`] = d;
  for (const [p, d] of Object.entries(perFileDiffDigests(dir, true))) files[`S:${p}`] = d;

  try {
    const porcelain = git(dir, ["status", "--porcelain", "-uall", "--no-renames"]);
    for (const line of porcelain.split(/\r?\n/)) {
      if (!line.startsWith("?? ")) continue;
      const p = line.slice(3).replace(/^"(.*)"$/, "$1");
      if (isSelfPath(p)) continue;
      const d = fileDigest(join(dir, p));
      if (d) files[`U:${p}`] = d;
    }
  } catch {
    /* status unavailable — diff digests still carry most of the signal */
  }

  for (const p of new Set(Object.keys(files).map((k) => k.slice(2)))) {
    const d = fileDigest(join(dir, p));
    if (d) files[`C:${p}`] = d;
  }

  return { head: headRev, files, capturedAt: new Date().toISOString() };
}

function pathOf(key: string): string {
  return key.slice(2);
}

/**
 * Reduce a tree-state snapshot to a path → identity map. The identity is `C:<digest>` when a
 * content digest exists for the path (the SAME thing in every bucket), and `B:<bucket-digest-set>`
 * otherwise (a deleted path, where no content is available and the bucket digests are the only
 * signal left). Sorting the bucket set keeps equal states rendering to the same string.
 */
function contentIdentity(state: { files: Record<string, string> }): Map<string, string> {
  const byPath = new Map<string, { content: string | null; buckets: Set<string> }>();
  for (const [k, v] of Object.entries(state.files)) {
    const p = pathOf(k);
    if (!byPath.has(p)) byPath.set(p, { content: null, buckets: new Set() });
    const rec = byPath.get(p)!;
    if (k.startsWith("C:")) rec.content = v;
    else rec.buckets.add(v);
  }
  return new Map(
    [...byPath].map(([p, rec]) => [
      p,
      rec.content !== null ? `C:${rec.content}` : `B:${[...rec.buckets].sort().join("|")}`,
    ]),
  );
}

/**
 * Compare a snapshot against the session baseline. Outcomes are explicit: CHANGED / UNCHANGED /
 * CANNOT_DETERMINE. A check that cannot tell must say so rather than pick the quiet answer. A HEAD
 * that moved counts as changed even when file content did not — work happened, the session ended
 * with a tree that differs from when it began.
 */
function diffStates(
  baseline: { head: string | null; files: Record<string, string> } | null,
  current: { head: string | null; files: Record<string, string> } | null,
) {
  if (!baseline || !current) {
    return { status: "CANNOT_DETERMINE", files: [], headMoved: false };
  }
  const headMoved = Boolean(baseline.head !== current.head);
  const changed = new Set<string>();
  const before = contentIdentity(baseline);
  const after = contentIdentity(current);
  for (const [p, id] of after) if (before.get(p) !== id) changed.add(p);
  for (const p of before.keys()) if (!after.has(p)) changed.add(p);
  const files = [...changed].sort();
  return {
    status: files.length || headMoved ? "CHANGED" : "UNCHANGED",
    files,
    headMoved,
    baselineHead: baseline.head,
    currentHead: current.head,
  };
}

// ---- runtime bookkeeping (baseline + stop-record) ------------------------------------------------

function runtimeDir(dir: string): string {
  return join(dir, ".respawnpack", "runtime");
}

function baselinePath(dir: string, sessionId: string): string {
  return join(runtimeDir(dir), `session-${safeId(sessionId)}.json`);
}

function stopRecordPath(dir: string, sessionId: string): string {
  return join(runtimeDir(dir), `stop-${safeId(sessionId)}.json`);
}

/** Retrying read — atomic replacement can make a target momentarily absent. */
function readJSON(file: string): any {
  // A small bounded retry covers the Windows EPERM/ENOENT window on an in-flight atomic rename.
  for (let i = 0; i < 4; i++) {
    try {
      const s = readFileSync(file, "utf8");
      return JSON.parse(s);
    } catch (e: any) {
      const code = (e && (e as any).code) || "UNKNOWN";
      if (code === "ENOENT" || code === "EPERM" || code === "EACCES") {
        // 3ms spin — same primitive _index-lease.js uses for contention.
        try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3); } catch { /* absent */ }
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Atomic replacement: write to a per-call temp, rename over the target. Best-effort — never
 * crashes the turn. Mirrors _runtime.js `atomicWriteJSON` minus the withLock piece (the stop record
 * is an append-only ledger, not a read-modify-write counter, so contention is benign).
 */
function atomicWriteJSON(file: string, obj: any): boolean {
  let tmp: string | null = null;
  try {
    mkdirSync(dirname(file), { recursive: true });
    tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2, 8)}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj, null, 2));
    renameSync(tmp, file);
    return true;
  } catch {
    if (tmp) {
      try { unlinkSync(tmp); } catch { /* already gone */ }
    }
    return false;
  }
}

/**
 * Capture what the tree looked like when the session started. Idempotent per session — re-baselining
 * after a compaction would erase the session's own accumulated work from the comparison.
 */
function captureBaseline(dir: string, sessionId: string): any {
  const file = baselinePath(dir, sessionId);
  const existing = readJSON(file);
  if (existing && existing.head !== undefined) return existing;
  const state = treeState(dir);
  if (!state) return null;
  const record = {
    sessionId: String(sessionId || "unknown"),
    head: state.head,
    files: state.files,
    capturedAt: state.capturedAt,
  };
  atomicWriteJSON(file, record);
  return record;
}

function readBaseline(dir: string, sessionId: string): any {
  return readJSON(baselinePath(dir, sessionId));
}

function sessionDelta(dir: string, sessionId: string) {
  return diffStates(readBaseline(dir, sessionId), treeState(dir));
}

// ---- the loop guard -------------------------------------------------------------------------------

function deltaFingerprint(delta: { currentHead: string | null; files: string[] }): string {
  return sha(`${delta.currentHead || ""}|${delta.files.join(",")}`);
}

/**
 * The fingerprint guard. An unchanged retry (same session, same HEAD, same file-set) gets a pass,
 * so a session that reasons for a turn and tries to stop again does not spend that turn in a
 * block-loop. Genuinely new work changes the fingerprint and re-arms the nudge.
 */
function alreadyStoppedOn(dir: string, sessionId: string, delta: ReturnType<typeof sessionDelta>): boolean {
  const rec = readJSON(stopRecordPath(dir, sessionId));
  return Boolean(rec && rec.fingerprint === deltaFingerprint(delta));
}

function recordStop(dir: string, sessionId: string, delta: ReturnType<typeof sessionDelta>): void {
  atomicWriteJSON(stopRecordPath(dir, sessionId), {
    sessionId: String(sessionId || "unknown"),
    fingerprint: deltaFingerprint(delta),
    head: delta.currentHead || null,
    files: delta.files,
    branch: "savepoint-required",
    at: new Date().toISOString(),
  });
}

// ---- tiny context resolvers -----------------------------------------------------------------------

/**
 * Project dir for the runtime directory. Pi's payload varies across versions; tolerant of absent
 * fields and falls back to env / cwd. Matches the source hook's `process.env.CLAUDE_PROJECT_DIR ||
 * process.cwd()` baseline.
 */
function projectDirOf(event: any, ctx: any): string {
  const candidates = [
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
  for (const c of candidates) if (typeof c === "string" && c) return c;
  return ".";
}

/**
 * Session id — keying the baseline + stop-record on this is what isolates concurrent sessions in
 * the same runtime directory. Falls back to "unknown" only as a last resort (a shared key would
 * mean sessions could see each other's stop records; this port keeps the same isolation the source
 * hook keeps, with a clear log line when the host exposed no id).
 */
function sessionIdOf(event: any, ctx: any): string {
  const candidates = [
    event?.sessionId,
    ctx?.sessionId,
    ctx?.session?.id,
    typeof ctx?.sessionManager?.getSessionId === "function"
      ? (() => { try { return ctx.sessionManager.getSessionId(); } catch { return null; } })()
      : null,
    typeof ctx?.getSessionId === "function"
      ? (() => { try { return ctx.getSessionId(); } catch { return null; } })()
      : null,
  ];
  for (const c of candidates) if (typeof c === "string" && c) return c;
  return "";
}

// ---- the trigger payload --------------------------------------------------------------------------

/** Render a one-line summary of the delta — file list (capped) plus HEAD move, joined by `; `. */
function describeDelta(delta: ReturnType<typeof sessionDelta>): string {
  const shown = delta.files.slice(0, 5);
  const more = Math.max(0, delta.files.length - shown.length);
  const parts: string[] = [];
  if (shown.length) parts.push(shown.join(", ") + (more > 0 ? ` (+${more} more)` : ""));
  if (delta.headMoved) {
    parts.push(`HEAD moved ${String(delta.baselineHead).slice(0, 7)}→${String(delta.currentHead).slice(0, 7)}`);
  }
  return parts.join("; ") || "files";
}

/** Best-effort UI surface — matches the rollover extension's `say` ladder (ui → log → console). */
function notify(ctx: any, message: string, level: "info" | "warning" = "info"): void {
  const tagged = `${EXTENSION_NAME}: ${message}`;
  try {
    if (ctx?.ui?.notify) { ctx.ui.notify(tagged, level); return; }
  } catch { /* fall through */ }
  try { if (typeof ctx?.log === "function") { ctx.log(tagged); return; } } catch { /* fall through */ }
  try { if (typeof console !== "undefined") console.error(tagged); } catch { /* nothing left */ }
}

// ---- the event handlers ---------------------------------------------------------------------------

/**
 * session_start: capture the baseline ONCE per session. Idempotent — if a baseline already exists
 * (resume, compact-replay, etc.), we keep it; otherwise we write a new one. A non-git dir writes no
 * baseline and the agent_settled path goes quiet.
 */
function onSessionStart(event: any, ctx: any): void {
  const dir = projectDirOf(event, ctx);
  const sid = sessionIdOf(event, ctx);
  if (!sid) {
    notify(ctx, "Pi exposed no session id at session_start; stop-savepoint is disabled for this session.", "warning");
    return;
  }
  if (!existsSync(dir)) return;
  const baseline = captureBaseline(dir, sid);
  if (!baseline) {
    notify(ctx, `no baseline captured for ${sid} (not a git repo or tree unreadable); stop-savepoint will stay quiet this session.`, "info");
    return;
  }
  notify(ctx, `baseline captured for session ${sid} at ${baseline.capturedAt}.`, "info");
}

/**
 * agent_settled: the safe boundary. Decision tree:
 *   1. No baseline or non-git-repo → quiet (CANNOT_DETERMINE).
 *   2. Tree unchanged AND HEAD did not move → quiet (UNCHANGED).
 *   3. Tree changed AND fingerprint matches the prior stop record → quiet (unchanged retry).
 *   4. Tree changed AND fingerprint is new → record the stop, bump an active goal cycle, and
 *      advise that rollover will compact only after it has staged and verified a handoff.
 *
 * The fingerprint guard (case 3) is the Pi analogue of Claude Code's `stop_hook_active`: an
 * unchanged retry does not pay for another turn.
 */
/**
 * Async helper for the goal-mode lifecycle. Runs in the background (fire-and-forget at the
 * registration site) so this hook's `onAgentSettled` stays synchronous and matches the source
 * hook's contract — Pi's documented event surface is synchronous at agent_settled. The helper
 * reads the package-owned goal contract module and bumps the target contract's cycleCount when
 * goal-mode is active. Failure is silent: absence of an active contract is not an error.
 */
async function goalModeBump(dir: string, sid: string, ctx: any): Promise<void> {
  try {
    const mod: any = await loadPackageGoalContract().catch(() => null);
    if (!mod || typeof mod.bumpCycleCount !== "function" || typeof mod.readRuntimeContract !== "function") return;
    const existing = mod.readRuntimeContract(dir);
    if (!existing.ok || !existing.contract || !existing.contract.activeGoalId) return;
    const r = mod.bumpCycleCount(dir, sid);
    if (r && r.ok) {
      notify(ctx, `goal-mode cycleCount bumped to ${r.contract.cycleCount} for ${existing.contract.activeGoalId}.`, "info");
    }
  } catch { /* goal-mode is a side grade; never throw out of an async helper */ }
}

function onAgentSettled(event: any, ctx: any): undefined {
  const dir = projectDirOf(event, ctx);
  const sid = sessionIdOf(event, ctx);
  if (!sid) return undefined;

  const delta = sessionDelta(dir, sid);
  if (delta.status !== "CHANGED") return undefined; // CANNOT_DETERMINE or UNCHANGED — go quiet.

  if (alreadyStoppedOn(dir, sid, delta)) {
    // Same session, same HEAD, same delta digest — the previous block already covered this state.
    return undefined;
  }

  recordStop(dir, sid, delta);

  const summary = describeDelta(delta);

  // ⭐ GOAL-MODE LIFECYCLE. When the rollover bridge has flipped goal-mode on (i.e. an active goal
  // contract exists), this hook also bumps the goal's cycleCount and appends the session id to the
  // contract's sessions[] log (capped at 32 entries by bumpCycleCount). The atomic-write keeps the
  // contract consistent if the rollover extension's own closeout path runs concurrently. Goal-mode
  // is opt-in: when no contract exists, the call is a no-op with ok:false (logged at info, not
  // warning — absence of a goal is not an error). See D-005 / skills/run-goal for the contract.
  // Fire-and-forget — `onAgentSettled` is synchronous to match Pi's documented surface; the helper
  // suspends internally and reports back via ctx.ui.notify if it succeeds.
  void goalModeBump(dir, sid, ctx).catch(() => { /* never throw out of an event handler */ });

  notify(
    ctx,
    `this session changed ${summary}; savepoint required. The rollover extension owns compaction ` +
      `and will request it only after a verified handoff is written and read back. ` +
      `(Fingerprint-keyed — unchanged retries are accepted.)`,
    "warning",
  );

  return undefined;
}

// ---- registration ---------------------------------------------------------------------------------

export default function (pi: any) {
  if (!pi || typeof pi.on !== "function") {
    throw new Error("stop-savepoint requires Pi ExtensionAPI.on()");
  }
  pi.on("session_start", (event: any, ctx: any) => onSessionStart(event, ctx));
  pi.on("agent_settled", (event: any, ctx: any) => onAgentSettled(event, ctx));
}

// ---- public surface (for tests / canaries / future ports) -----------------------------------------

export {
  EXTENSION_NAME,
  SELF_PREFIX,
  MAX_HASH_BYTES,
  // pure helpers (no fs / git side effects)
  sha,
  safeId,
  isSelfPath,
  pathOf,
  contentIdentity,
  diffStates,
  describeDelta,
  // filesystem / git-backed helpers (have side effects; exported for tests)
  perFileDiffDigests,
  fileDigest,
  treeState,
  isRepo,
  git,
  readJSON,
  atomicWriteJSON,
  baselinePath,
  stopRecordPath,
  captureBaseline,
  readBaseline,
  sessionDelta,
  deltaFingerprint,
  alreadyStoppedOn,
  recordStop,
  projectDirOf,
  sessionIdOf,
};
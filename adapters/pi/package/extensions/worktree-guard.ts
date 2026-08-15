/*
 * RespawnPack · worktree-guard.ts — Pi extension that hard-binds writes to the current git worktree.
 *
 * Port of RespawnPack/hooks/worktree-guard.js. The wire format is rewritten (Pi tool_call →
 * {block, reason} vs. Claude Code PreToolUse stdin/stdout JSON) but the deny rules and the
 * linked-worktree-only activation are preserved exactly.
 *
 * The gap it closes: RespawnPack's EnterWorktree / wave-ledger model runs work inside a linked git
 * worktree, but nothing stops an Edit/Write from resolving to a path OUTSIDE that worktree (into the
 * main checkout or a sibling worktree). The prose "stay in your worktree" rule is the only guard
 * today, and prose guards fail under load. This extension hard-binds writes to the worktree root.
 *
 * Two-line activation model:
 *   1. Auto: whenever the session sits in a linked worktree (a realpath-aware shell walk for a `.git`
 *      FILE — a linked worktree's `.git` is a file containing `gitdir: …`, the main checkout's is a
 *      directory). The shell walk is preferred over `git rev-parse --show-toplevel` so the capture
 *      costs zero git exec; `git rev-parse --show-toplevel` is the fallback when the shell walk
 *      returns nothing (the case where we are inside a worktree but the walk didn't find a `.git`
 *      file — should not happen, but the fallback prevents a soft-deny that nothing actually
 *      warrants).
 *   2. Opt-out: a human can lift containment for one worktree by creating
 *      <worktree-root>/.respawnpack/worktree-guard.off. The marker is read on every tool call, so
 *      dropping it in mid-session takes effect immediately.
 *
 * Tools covered: edit, write, multi_edit, notebook_edit (the four file-mutating tools in Pi's
 * tool_call surface). bash is intentionally NOT covered — the destructive-bash surface is owned by
 * push-guard, secret-scan, and shell-guard, and a worktree-containment rule on shell commands would
 * be either too narrow (missing the wrappers) or too broad (denying legitimate out-of-tree probes).
 *
 * ⛔ The path comparison is `path.relative` based, not a string prefix check. `path.relative` handles
 *   Windows drive letters (different drive → absolute result → "outside"), case-insensitive
 *   separators on Windows, and the leading ".." that an escaping path produces. A naive
 *   `resolved.startsWith(root + sep)` would silently let `/root-evil/x` through when root is
 *   `/root`.
 *
 * ⛔ The opt-out marker is `.respawnpack/worktree-guard.off` (the source hook's marker), not
 *   `.disable`. The task description's `.disable` is a paraphrase; the source's marker is the
 *   load-bearing name.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve as resolvePath, sep, isAbsolute } from "node:path";

const WRITE_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "multi_edit", "notebook_edit"]);

/** Walked once per process; git is not re-exec'd on every tool call. */
let cachedRoot: string | null | undefined = undefined;

/**
 * Walk up from `from` for the nearest `.git`. The worktree root is the directory whose `.git` is a
 * FILE (a linked worktree's `.git` is a file containing `gitdir: …`). If `.git` is a directory, we
 * are in the main checkout and the guard does nothing. If `.git` is missing, we fall back to
 * `git rev-parse --show-toplevel` so the guard still activates inside a worktree whose `.git`
 * the walk missed for any reason.
 *
 * Mirrors the source hook's `worktreeRoot(from)` exactly, including the FILE-vs-DIRECTORY
 * distinction that is the load-bearing check.
 */
function worktreeRootFromWalk(from: string): string | null {
  let dir = resolvePath(from);
  for (;;) {
    const dotgit = join(dir, ".git");
    let stat = null;
    try { stat = statSync(dotgit); } catch { stat = null; }
    if (stat) {
      if (stat.isDirectory()) return null; // main working tree — not a linked worktree
      if (stat.isFile()) {
        try {
          const body = readFileSync(dotgit, "utf8");
          if (/^gitdir:\s*\S/m.test(body)) return dir;
        } catch { /* unreadable .git file — treat as not-a-worktree */ }
        return null;
      }
    }
    const parent = resolvePath(dir, "..");
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
}

/**
 * Fallback: `git rev-parse --show-toplevel`. Returns the root of the current worktree (linked or
 * main). One git exec per process; cached.
 */
function worktreeRootFromGit(): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
    const root = out.trim();
    return root ? root : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the project directory from whatever the host offers. Pi's `tool_call` payload does not
 * always carry a working-directory field, so we read defensively: explicit event fields first, then
 * an env override, then process.cwd(). The fallback matches the standalone hook's contract.
 */
function projectDirOf(event: any): string {
  const e = event || {};
  const candidates = [
    e.cwd,
    e.input && e.input.cwd,
    e.projectDir,
    typeof process !== "undefined" && process.env
      ? (process.env.RESPAWN_PI_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR)
      : null,
    typeof process !== "undefined" ? process.cwd() : ".",
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
  }
  return ".";
}

/**
 * Compute the worktree root ONCE per process. The walk is preferred (zero git exec, accurate
 * linked-vs-main distinction). The git fallback is consulted only when the walk returns null AND
 * `git rev-parse` succeeds — this is the "we are inside a worktree but the walk missed" case.
 */
function getWorktreeRoot(startDir: string): string | null {
  if (cachedRoot !== undefined) return cachedRoot;
  const fromWalk = worktreeRootFromWalk(startDir);
  if (fromWalk) {
    cachedRoot = fromWalk;
    return cachedRoot;
  }
  const fromGit = worktreeRootFromGit();
  cachedRoot = fromGit;
  return cachedRoot;
}

/**
 * True when `resolved` sits outside `root`. `path.relative` returns:
 *   - ""                  → resolved IS root
 *   - "subdir/x"          → resolved is inside root
 *   - "../x" or "../../x" → resolved is outside root (escaped upward)
 *   - absolute path       → resolved is on a different drive (Windows) — outside root
 * A simple `startsWith(root + sep)` would let `/root-evil/x` through when root is `/root`.
 */
function isOutside(root: string, resolved: string): boolean {
  const rel = relative(root, resolved);
  if (rel === "") return false;
  if (isAbsolute(rel)) return true; // different drive (Windows)
  if (rel === "..") return true;
  if (rel.startsWith(".." + sep)) return true;
  return false;
}

/** Read the file path from a tool_call event. Mirrors the source's
 * `input.tool_input.file_path || input.tool_input.notebook_path` resolution, mapped to Pi's
 * `event.input.file_path || event.input.path` shape. Trailing whitespace tolerated. */
function readFilePath(event: any): string | null {
  const input = (event && event.input) || {};
  const raw = input.file_path || input.path || input.notebook_path;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

/**
 * Resolve `filePath` against `projectDir` to produce an absolute path. `resolvePath` is
 * `path.resolve` — the source hook's tool of choice. It treats an absolute `filePath` as-is
 * (ignoring `projectDir`) and makes a relative `filePath` absolute against `projectDir`. We
 * deliberately do NOT realpath: the source does not, and realpath would introduce an
 * existence-or-fall-back split that diverges from the source's "logical root" semantic.
 */
function resolveAgainstProject(projectDir: string, filePath: string): string {
  return resolvePath(projectDir, filePath);
}

export default function (pi: any) {
  pi.on("tool_call", (event: any, ctx: any) => {
    if (!event || !WRITE_TOOLS.has(event.toolName)) return;

    const projectDir = projectDirOf(event);
    const root = getWorktreeRoot(projectDir);
    if (!root) return; // not in a linked worktree → nothing to contain

    // Opt-out marker: drop <worktree-root>/.respawnpack/worktree-guard.off to lift containment.
    if (existsSync(join(root, ".respawnpack", "worktree-guard.off"))) return;

    const filePath = readFilePath(event);
    if (!filePath) return; // tool call with no file path — nothing to gate

    const resolved = resolveAgainstProject(projectDir, filePath);
    if (!isOutside(root, resolved)) return;

    const offMarker = join(root, ".respawnpack", "worktree-guard.off");
    const reason =
      `🔒 worktree-guard blocked a write to "${resolved}" — it resolves OUTSIDE this session's worktree root ` +
      `(${root}). Edits that need to land elsewhere belong to the session that owns that tree; keep this one ` +
      `inside its worktree. If crossing the boundary is genuinely intended, create "${offMarker}" to lift containment.`;

    if (ctx && ctx.ui && typeof ctx.ui.notify === "function") {
      try { ctx.ui.notify("worktree-guard: blocked an out-of-worktree write", "warn"); } catch { /* best-effort */ }
    }

    return { block: true, reason };
  });
}

export { WRITE_TOOLS, worktreeRootFromWalk, worktreeRootFromGit, getWorktreeRoot, isOutside, readFilePath, projectDirOf };

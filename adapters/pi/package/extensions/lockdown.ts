/*
 * RespawnPack · lockdown.ts — Pi extension that scopes Edit/Write tools to an allowed path set.
 *
 * Mirrors the standalone hook at RespawnPack/hooks/lockdown.js in semantic, not in implementation
 * detail: Pi exposes a different event surface (`tool_call` returning `{block, reason}`) than Claude
 * Code's PreToolUse stdin/stdout JSON contract, so the wire format is rewritten while the deny rule
 * is preserved exactly.
 *
 * ⛔ WHAT THIS EXTENSION ACTUALLY DOES — read this before changing anything else.
 *
 * Enforcement is OFF unless a scope file exists at <project>/.respawnpack/lockdown.allow AND that
 * file is non-empty. Each line is one allowed path prefix (repo-relative), e.g.
 *
 *   apps/web/app/(app)/feed
 *   packages/lib
 *
 * While that file exists + is non-empty, any Edit/Write to a file OUTSIDE those prefixes is DENIED.
 * Delete the file (or empty it) to lift the lockdown.
 *
 * Pi event: `tool_call` — act only when `event.toolName` is `edit` or `write` (Pi exposes two tools;
 * the Claude Code source gates four: Edit|Write|MultiEdit|NotebookEdit — MultiEdit maps onto `edit`
 * in Pi and NotebookEdit has no Pi equivalent). Read `event.input.file_path`. Resolve it against the
 * project directory, then compare against the allow-list prefixes. Return `{block: true, reason}` to
 * deny, return undefined to allow.
 *
 * Default behavior — default-allow when no allow file is present, default-deny (within the Edit/Write
 * surface) when one is. The presence of the file IS the arming switch.
 *
 * Set scope:    touch <project>/.respawnpack/lockdown.allow and write one prefix per line.
 * Clear:        delete the file (or `truncate -s 0` it).
 * Status:       `cat <project>/.respawnpack/lockdown.allow` — non-empty means ON.
 *
 * ⛔ PATH-PREFIX MATCHING IS LOAD-BEARING. The naive `path.startsWith(prefix)` is WRONG: it lets
 * `apps/web` match `apps/web-extra`. The contract, copied verbatim from the standalone hook, is:
 *   rel === pre   OR   rel.startsWith(pre + '/')
 * where `rel` is the repo-relative path with `\` normalized to `/`, and `pre` has any trailing slash
 * stripped. That is the only way `apps/web` does not also authorize `apps/webhooks`. Do not "simplify"
 * this — the bug is silent and the failure mode is an unauthorized edit slipping through.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** Pi tool names that this extension gates. Pi's two-file edit surface, mapped onto the four tools
 * (Edit|Write|MultiEdit|NotebookEdit) the standalone hook checks against. MultiEdit is folded into
 * `edit` because Pi exposes it as one tool; NotebookEdit has no Pi counterpart. */
const WRITE_TOOLS = new Set<string>(["edit", "write"]);

/** The scope file that arms the lockdown. Single-file, multi-line, repo-relative prefixes. */
const SCOPE_FILE_NAME = "lockdown.allow";

/**
 * Resolve the project directory from whatever the host offers. Pi's `tool_call` payload does not
 * always carry a working-directory field, so we read defensively: explicit event fields first, then
 * an env override, then `session_start`-cached state, then process.cwd(). The fallback matches the
 * standalone hook's `CLAUDE_PROJECT_DIR || cwd` contract.
 */
function projectDirOf(event: any, ctx: any): string {
  const e = event || {};
  const candidates: Array<string | null | undefined> = [
    e.cwd,
    e.input && e.input.cwd,
    e.projectDir,
    ctx && ctx.cwd,
    ctx && ctx.projectDir,
    ctx && ctx.session && ctx.session.projectDir,
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
 * Load the allow-list from disk. Returns the trimmed, non-empty prefixes, in file order, OR an empty
 * array when the file is missing or empty.
 *
 * The file is the arming switch: when missing, this function returns `[]`, and `[]` means lockdown
 * is OFF — `tool_call` never denies on an empty allow list. That is the default-allow-if-absent
 * contract from the standalone hook.
 */
function loadAllowList(projectDir: string): string[] {
  const scopeFile = join(projectDir, ".respawnpack", SCOPE_FILE_NAME);
  if (!existsSync(scopeFile)) return [];
  try {
    const text = readFileSync(scopeFile, "utf8");
    return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    // Unreadable (race, permission): treat as no scope — fail OPEN. Failing closed here would
    // silently lock the operator out of their own project on a transient filesystem error.
    return [];
  }
}

/**
 * The load-bearing predicate. `rel` must equal a prefix exactly, OR live strictly UNDER it
 * (`rel === pre || rel.startsWith(pre + '/')`). A trailing-slash trim on the prefix keeps
 * `apps/web/` and `apps/web` semantically equivalent as written by the operator.
 *
 * Why this is not `rel.startsWith(pre)`: an allowed prefix `apps/web` would otherwise also
 * authorize `apps/webhooks`, `apps/web-old`, etc. — a silent authorization leak. The explicit
 * separator character is the only thing that draws the boundary.
 */
function isUnderPrefix(rel: string, pre: string): boolean {
  return rel === pre || rel.startsWith(pre + "/");
}

/**
 * Resolve a file path the tool is targeting into a repo-relative, forward-slash-normalized form.
 * Absolute paths are made relative to the project directory; relative paths are taken as-is from
 * the operator's working directory at the time the tool was invoked. Backslashes (Windows) are
 * normalized to forward slashes so prefix matching is platform-agnostic.
 */
function relativize(filePath: string, projectDir: string): string {
  const abs = resolve(projectDir, filePath);
  const rel = relative(projectDir, abs).replace(/\\/g, "/");
  return rel;
}

/** Build a deny payload in the shape Pi expects from a tool_call handler. */
function deny(reason: string): { block: true; reason: string } {
  return { block: true, reason };
}

/**
 * Decide whether the given file path is allowed under the current scope. Returns `undefined` when
 * the tool call should pass through, or a `{block, reason}` when it should be denied. The empty
 * allow list is treated as "no lockdown active" and never produces a deny — that is the contract.
 */
function checkScope(filePath: string, prefixes: string[], projectDir: string): { block: true; reason: string } | undefined {
  if (!filePath) return undefined;
  if (prefixes.length === 0) return undefined; // no scope file / empty scope → lockdown OFF

  const rel = relativize(filePath, projectDir);
  const inScope = prefixes.some((p) => isUnderPrefix(rel, p));
  if (inScope) return undefined;

  return deny(
    `🔒 lockdown active — edits are scoped to [${prefixes.join(", ")}]. ` +
    `"${rel}" is outside that scope. Edit within scope, or clear the lockdown ` +
    `(delete <project>/.respawnpack/${SCOPE_FILE_NAME}) if you need to touch it.`,
  );
}

/**
 * Optional: write a one-line evidence marker describing what this extension did, on every deny, so an
 * operator can audit guard activity without re-running the conversation. Best-effort: a failed write
 * is reported via ctx.ui when available, otherwise silently dropped — never the cause of a deny.
 */
function recordDecision(projectDir: string, payload: { kind: "deny" | "allow"; filePath: string; rel: string; prefixes: string[]; at: string }): void {
  try {
    const dir = join(projectDir, ".respawnpack", "runtime", "lockdown");
    const fs = require("node:fs") as typeof import("node:fs");
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ...payload, schemaVersion: "1.0.0" });
    fs.writeFileSync(join(dir, "decisions.jsonl"), `${line}\n`, { flag: "a" });
  } catch {
    // best-effort; never block a deny on telemetry
  }
}

// ---------------------------------------------------------------------------------------------------
// extension registration
// ---------------------------------------------------------------------------------------------------

/** Cached allow-list, refreshed on session_start so the operator can edit the file mid-session and
 * have it picked up at the next session. Per-process state; Pi runs one extension instance per
 * process, so a module-scoped variable is sufficient. */
let cachedPrefixes: string[] = [];
let cachedProjectDir: string | null = null;

/** The contract: a default-exported factory that takes Pi's extension API and wires event handlers. */
export default function (pi: any) {
  if (!pi || typeof pi.on !== "function") {
    throw new Error("lockdown: Pi ExtensionAPI.on() is required");
  }

  pi.on("session_start", (_event: any, ctx: any) => {
    const projectDir = projectDirOf({}, ctx);
    cachedProjectDir = projectDir;
    cachedPrefixes = loadAllowList(projectDir);
  });

  pi.on("tool_call", (event: any, ctx: any) => {
    if (!event || !WRITE_TOOLS.has(event.toolName)) return;

    // Re-resolve the project dir on every call: the standalone hook recomputes it per-stdin, and
    // doing so here lets the guard work even if session_start was never observed (e.g. an extension
    // loaded mid-session by /reload). The resolver is cheap — a few string checks.
    const projectDir = cachedProjectDir || projectDirOf(event, ctx);
    const prefixes = cachedProjectDir === projectDir ? cachedPrefixes : loadAllowList(projectDir);

    // Pi's edit tool's file path lives at event.input.file_path; some internal callers also surface
    // it under event.input.path. The standalone hook also reads notebook_path for NotebookEdit —
    // Pi has no NotebookEdit equivalent, so that case does not arise here.
    const filePath: string =
      (event.input && (event.input.file_path || event.input.path)) || "";

    const decision = checkScope(filePath, prefixes, projectDir);
    if (decision) {
      const rel = relativize(filePath, projectDir);
      recordDecision(projectDir, { kind: "deny", filePath, rel, prefixes, at: new Date().toISOString() });
      if (ctx && ctx.ui && typeof ctx.ui.notify === "function") {
        try { ctx.ui.notify("lockdown: denied an edit outside the allowed scope", "warn"); } catch { /* best-effort */ }
      }
      return decision;
    }
    return undefined;
  });
}

export {
  WRITE_TOOLS,
  SCOPE_FILE_NAME,
  projectDirOf,
  loadAllowList,
  isUnderPrefix,
  relativize,
  checkScope,
};
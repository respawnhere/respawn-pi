/*
 * RespawnPack · push-guard.ts — Pi extension that mechanizes "push is authorized, never automatic"
 * (skills/README.md principle 7). Mirrors the standalone hook at
 * RespawnPack/hooks/push-guard.js in semantic, not in implementation detail: Pi exposes a different
 * event surface (`tool_call` returning `{block, reason}`) than Claude Code's PreToolUse stdin/stdout
 * JSON contract, so the wire format is rewritten while the deny rules are preserved exactly.
 *
 * Two tiers, applied in order:
 *   1. `git push` (incl. `--force` / `--force-with-lease`) — DENIED unless a single-use marker exists
 *      at <project>/.respawnpack/push.allowed. The marker is DELETED at the moment it allows one push.
 *      One marker, one push. This is the only tier that can be lifted by a marker.
 *   2. `git reset --hard` / `git clean -f`|`-fd` / `git branch -D` / `git checkout .` / `git restore .` —
 *      DENIED unconditionally. No marker lifts these: RespawnPack's flows have no legitimate autonomous
 *      use for them, unlike an authorized push. Escape hatch is the same one every guard here relies on:
 *      remove this extension from the loaded list (or set the matching regex to a non-match shape) if
 *      you need to run one of these yourself.
 *
 * Pi event: `tool_call` — only act when event.toolName === "bash". The command string lives at
 * event.input.command. To deny, return {block: true, reason: "..."}; to allow, return nothing.
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guardedGovernanceEnabled } from "./governance-profile.ts";

// Unconditionally-denied destructive ops. Each pattern is matched against the raw command string, so
// these are intentionally narrow — a quoted mention in a shell comment, a grep target, or a heredoc
// may slip through, and that is the documented cost of running on a regex over a shell line.
//
// ⛔ THE TRAILING `\b` IS DELIBERATELY OMITTED WHERE IT WOULD MASK THE MATCH. The naive `\bgit\s+clean
// \s+-[a-zA-Z]*f\b` silently fails on `git clean -fd` because `f` (word) → `d` (word) has no boundary,
// and `\bgit\s+checkout\s+\.\b` silently fails on `git checkout .` because `.` (non-word) → end-of-string
// (non-word) has no boundary. Both are the very commands this guard exists to block, so the boundary
// is dropped in those positions; the other end still requires `git` to be its own token.
//
// ⛔ `git checkout -- .` IS HANDLED, ON PURPOSE. The standalone source treats `-- .` as the same
// destructive op as `.` (both discard working-tree changes). The pattern explicitly accepts the
// optional `-- ` separator between `checkout` and `.`.
const DESTRUCTIVE: RegExp[] = [
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  /\bgit\s+branch\s+-D\b/,
  /\bgit\s+checkout\s+(?:--\s+)?\./,
  /\bgit\s+restore\s+\./,
];

// Any `git push …` invocation, including global-option forms (`git --no-pager push`, `git -C <dir>
// push`) and any flags after the subcommand (`git push --force`, `git push --force-with-lease`).
// The substring `git push` is what we gate on; everything after is the model's responsibility.
const PUSH_PATTERN = /\bgit\s+push\b/;

/** Human labels paired 1:1 with DESTRUCTIVE, used to name the offending rule in the deny reason. */
const DESTRUCTIVE_LABELS: string[] = [
  "git reset --hard",
  "git clean -f/-fd",
  "git branch -D",
  "git checkout .",
  "git restore .",
];

/**
 * Resolve the project directory from whatever the host offers. Pi's `tool_call` payload does not
 * always carry a working-directory field, so we read defensively: explicit event fields first, then
 * an env override, then process.cwd(). The fallback matches the standalone hook's contract.
 */
function projectDirOf(event: any, ctx: any = {}): string {
  const e = event || {};
  const candidates = [
    ctx && ctx.cwd,
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

/** Build a deny payload in the shape Pi expects from a tool_call handler. */
function deny(reason: string): { block: true; reason: string } {
  return { block: true, reason };
}

/**
 * Deny one of the destructive git subcommands. Each pattern names the specific shape we blocked so the
 * reason string does not leave the operator guessing which rule fired.
 */
function checkDestructive(cmd: string, projectDir: string): { block: true; reason: string } | undefined {
  for (let i = 0; i < DESTRUCTIVE.length; i++) {
    if (DESTRUCTIVE[i].test(cmd)) {
      return deny(
        `🔒 push-guard blocked "${DESTRUCTIVE_LABELS[i]}" — this destructive op has no legitimate autonomous use in ` +
        `RespawnPack's flows and is always denied. If you genuinely need to run it yourself, disable this ` +
        `extension (remove it from the loaded extensions list) and run it directly.`,
      );
    }
  }
  return undefined;
}

/**
 * Gate `git push` on the single-use marker. The marker is DELETED the moment it allows one push —
 * one marker, one push. Anything that needs an authorized push needs a fresh human go-ahead to mint
 * the marker again.
 */
function checkPush(cmd: string, projectDir: string): { block: true; reason: string } | undefined {
  if (!PUSH_PATTERN.test(cmd)) return undefined;

  const markerFile = join(projectDir, ".respawnpack", "push.allowed");
  if (existsSync(markerFile)) {
    try {
      // Consume the marker at the moment it grants one push. A subsequent push — even with the same
      // command, even a few seconds later — finds no marker and is denied until a human re-authorizes.
      unlinkSync(markerFile);
    } catch {
      // Marker already gone (race with another guard, a parallel session, manual removal): still allow
      // this one push. Failing closed here would deny an authorized push on a filesystem we can't
      // touch, which is the worse failure.
    }
    return undefined;
  }

  return deny(
    `🔒 push-guard blocked this push — "push is authorized, never automatic" (skills/README.md ` +
    `principle 7) has no marker on file. Mint a fresh single-use marker at ` +
    `"${markerFile}" (a touch, an empty file is enough) and retry.`,
  );
}

/**
 * Optional: write a one-line evidence marker describing what this extension did, on every deny, so an
 * operator can audit guard activity without re-running the conversation. Best-effort: a failed write
 * is reported via ctx.ui when available, otherwise silently dropped — never the cause of a deny.
 */
function recordDecision(projectDir: string, payload: { kind: "destructive" | "push" | "allowed"; cmd: string; pattern?: string; at: string }): void {
  try {
    const dir = join(projectDir, ".respawnpack", "runtime", "push-guard");
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ...payload, schemaVersion: "1.0.0" });
    writeFileSync(join(dir, "decisions.jsonl"), `${line}\n`, { flag: "a" });
  } catch {
    // best-effort; never block a deny on telemetry
  }
}

export default function (pi: any) {
  pi.on("tool_call", (event: any, ctx: any) => {
    if (!event || event.toolName !== "bash") return;
    if (!guardedGovernanceEnabled(event, ctx)) return;
    const cmd: string = (event.input && event.input.command) || "";
    if (!cmd) return;

    const projectDir = projectDirOf(event, ctx);

    const destructiveHit = checkDestructive(cmd, projectDir);
    if (destructiveHit) {
      recordDecision(projectDir, { kind: "destructive", cmd, pattern: "DESTRUCTIVE_REGEX", at: new Date().toISOString() });
      if (ctx && ctx.ui && typeof ctx.ui.notify === "function") {
        try { ctx.ui.notify("push-guard: denied a destructive git op", "warn"); } catch { /* best-effort */ }
      }
      return destructiveHit;
    }

    const pushDecision = checkPush(cmd, projectDir);
    if (pushDecision) {
      recordDecision(projectDir, { kind: "push", cmd, pattern: "PUSH_NO_MARKER", at: new Date().toISOString() });
      if (ctx && ctx.ui && typeof ctx.ui.notify === "function") {
        try { ctx.ui.notify("push-guard: denied an unauthorized git push", "warn"); } catch { /* best-effort */ }
      }
      return pushDecision;
    }

    return undefined;
  });
}

export { DESTRUCTIVE, DESTRUCTIVE_LABELS, PUSH_PATTERN, projectDirOf, checkDestructive, checkPush };
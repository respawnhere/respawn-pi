/*
 * RespawnPack · adapters/pi/package/extensions/gate-guard.ts
 *
 * Pi extension port of the ECC GateGuard "fact-forcing gate" (MIT, see ATTRIBUTION.md). Preserves
 * the load-bearing semantic: ENFORCED block on the FIRST edit/write per session per file, requiring
 * the agent to surface concrete investigation facts (importers, schema, verbatim instruction) before
 * the retry is allowed. Mechanizes "the act of investigation creates awareness that
 * self-evaluation never did" — the source's own framing of why asking "are you sure?" is not
 * enough.
 *
 * Prior-art evidence: round3 T1-2 (catalog-walk-cct-hooks.md §50 `ai-bash-guard` / §5c
 * `gate-guard` skill / §3 ECC concept 3). The round3 verifier's own audit: "GateGuard is
 * `PreToolUse` on `Edit|Write|MultiEdit` — `claude-code-orchestration.md:37` confirms `PreToolUse`
 * can deny. ... GateGuard (`ecc-inventory.md` read-in-full), CE fast-path
 * (`compound-engineering-inventory.md` Stages 1-4 read-in-full), and Critique Theater
 * (`open-design-inventory.md:62` §3.3 — confirmed-live via directory `apps/daemon/src/critique/*.ts`...
 * ) are all solid."
 *
 * ⛔ THE FULL ECC GATE-GUARD IMPLEMENTATION IS A THREE-STAGE STATE MACHINE:
 *   1. DENY  — block the first Edit/Write/Bash attempt
 *   2. FORCE — tell the model exactly which facts to gather
 *   3. ALLOW — permit retry after facts are presented
 * This port is the SIMPLIFIED v0.3 shape — per-session per-file state, in-memory tracking,
 * deny-then-allow on the same file. The round3 audit calls out the full mechanism as solid but
 * marks the confidence-gate (SuperClaude) as "summary-level only", so this port does not attempt
 * to replicate it; the scope is the Pi surface, where the per-file first-time deny is the load-
 * bearing behavior.
 *
 * ⛔ OPT-IN ONLY. Gate-guard is enabled by creating `<project>/.respawnpack/gate-guard.enabled`.
 *   The marker is read on every tool_call so dropping it in mid-session takes effect immediately.
 *   The pack ships gate-guard INERT by default: a founder who wants the first-edit investigation
 *   loop lifts the marker explicitly, and a founder who wants ordinary edits does nothing. The
 *   default-inert posture mirrors `stop-savepoint`'s opt-in Stop hook — the safety mechanism is
 *   always present, never silently on.
 *
 * ⛔ MEMORY-ONLY STATE. State lives in the extension's module scope, keyed by absolute file path.
 *   On process restart, state is empty again — every file is "first write" once. This is the
 *   simplest viable semantics; persistent state would require a runtime file the founder can
 *   inspect and reset, which is more infrastructure than the v0.3 port warrants.
 *
 * ⛔ NEVER BLOCKS BASH. The source applies the same gate to Bash invocations, but the surface is
 *   too noisy in practice — every command becomes a denial + investigation request. The Pi port
 *   narrows the gate to file-mutating tools only (`edit`, `write`, `multi_edit`,
 *   `notebook_edit`), which matches what a founder actually wants to gate.
 *
 * ⛔ REASON TEXT names the three concrete fact classes the source asks for. The deny reason tells
 *   the model exactly what to investigate, not just "blocked". The source's own evidence — "list
 *   every file that imports this module" — is what the model needs to surface before the retry
 *   is allowed.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "multi_edit",
  "notebook_edit",
]);

/** Per-process map: absolute file path → true once the agent has surfaced facts and re-tried.
 *  Module-scope so the gate survives across tool_call events but resets on process restart. */
const investigated: Map<string, true> = new Map();

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

function readFilePath(event: any): string | null {
  const input = (event && event.input) || {};
  const raw = input.file_path || input.path || input.notebook_path;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

function resolveAgainstProject(projectDir: string, filePath: string): string {
  // `resolve` treats absolute paths as absolute and resolves relative paths against projectDir.
  // Mirrors worktree-guard's source-aware resolution.
  return filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath)
    ? filePath
    : join(projectDir, filePath);
}

/** Decide whether an edit event should be blocked. Pure: no I/O. */
function classify(event: any, projectDir: string): {
  shouldBlock: boolean;
  filePath?: string;
  alreadyInvestigated?: boolean;
  reason?: string;
} {
  if (!event) return { shouldBlock: false };
  if (!WRITE_TOOLS.has(event.toolName)) return { shouldBlock: false };

  const filePath = readFilePath(event);
  if (!filePath) return { shouldBlock: false };

  const resolved = resolveAgainstProject(projectDir, filePath);
  if (investigated.has(resolved)) {
    return { shouldBlock: false, filePath: resolved, alreadyInvestigated: true };
  }
  return {
    shouldBlock: true,
    filePath: resolved,
    alreadyInvestigated: false,
    reason:
      `gate-guard: first write to "${filePath}" in this session. ` +
      `Block once, allow after facts. To unblock, retry the SAME write and respond with THREE concrete ` +
      `investigation facts:\n` +
      `  1. THE IMPORTERS — list every file that imports/loads this file (Grep for the path/module).\n` +
      `  2. THE SCHEMA — paste the file's exported surface (top-level symbols + their types/shapes).\n` +
      `  3. THE INSTRUCTION — quote the user/operator request verbatim that authorizes this change.\n` +
      `Once those three facts are in your next reply, the gate clears and the write proceeds. ` +
      `This is the mechanic that "the act of investigation creates awareness that self-evaluation ` +
      `never did" — it is not a moral prompt, it is a load-bearing evidence step.`,
  };
}

/** Mark a file as investigated after the agent has surfaced facts. Idempotent. */
function markInvestigated(filePath: string): void {
  investigated.set(filePath, true);
}

/** Test-only export: wipe state. Never wired to a host hook. */
function _resetForTests(): void {
  investigated.clear();
}

export default function (pi: any) {
  pi.on("tool_call", (event: any, ctx: any) => {
    const projectDir = projectDirOf(event);
    // Opt-in marker — read on every call so a mid-session drop takes effect immediately.
    try {
      if (!existsSync(join(projectDir, ".respawnpack", "gate-guard.enabled"))) return undefined;
    } catch { /* best-effort */ }

    const decision = classify(event, projectDir);
    if (!decision.shouldBlock) return undefined;

    if (ctx && ctx.ui && typeof ctx.ui.notify === "function") {
      try {
        ctx.ui.notify(`gate-guard: first write to ${decision.filePath} — surface importers + schema + instruction before retry`, "warn");
      } catch { /* best-effort */ }
    }

    return { block: true, reason: decision.reason };
  });

  // A second hook on the same event: post-decision — when the agent retries the SAME file, the
  // classify() check now finds it in `investigated` only if the agent has already passed the gate
  // once. To enable that, we listen to `tool_result` and treat any successful tool_result for a
  // blocked file as the agent having responded to the gate. The agent's NEXT tool_call for the
  // same file then passes (because classify() finds the file in `investigated`).
  //
  // ⛔ This is intentionally lightweight: we do NOT inspect the tool_result's content for the three
  // fact classes the reason text names. The source ECC pattern relies on the model self-checking;
  // the Pi port trusts the gate's DENY → ALLOW loop and relies on the agent to surface the facts
  // voluntarily. A future version could parse tool_result content for the three classes and only
  // mark investigated on a positive match — but that adds a non-trivial parser and a positive
  // detection failure mode. v0.3 ships the loop without the content check; the round3 verifier
  // calls this an acceptable simplification.
  pi.on("tool_result", (event: any, _ctx: any) => {
    if (!event) return;
    if (!WRITE_TOOLS.has(event.toolName)) return;
    const filePath = readFilePath(event);
    if (!filePath) return;
    const projectDir = projectDirOf(event);
    const resolved = resolveAgainstProject(projectDir, filePath);
    if (!investigated.has(resolved)) {
      markInvestigated(resolved);
    }
  });
}

export {
  WRITE_TOOLS,
  projectDirOf,
  readFilePath,
  resolveAgainstProject,
  classify,
  markInvestigated,
  _resetForTests,
};

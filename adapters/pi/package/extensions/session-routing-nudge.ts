/*
 * RespawnPack · adapters/pi/package/extensions/session-routing-nudge.ts
 *
 * Pi extension port of RespawnPack/hooks/session-routing-nudge.js. Preserves the load-bearing
 * semantic: on session start, inject the routing reminder into the agent's context. The reminder is
 * the same content every session — a brief, ordered list of the typical priorities the session should
 * honor before acting.
 *
 * Also grafts the **AGENTS.md loader** (prior-art cct hook item #1): if `<project>/AGENTS.md` exists,
 * its body is appended to the routing injection so the repo's own cross-tool instructions surface
 * alongside the routing priorities. Concept re-derived from claude-code-templates' agents-md-loader
 * (MIT); see ATTRIBUTION.md. The graft is in-process only — no new file, no new package.json entry.
 *
 * Why the priority order IS the design (verbatim from the source):
 *   1. the generated durable state (docs/derived/STATE.json), REVISION-VALIDATED before it is trusted;
 *   2. any verified compaction handoff written for this session, then marked consumed;
 *   3. the bounded human note from CONTINUITY.md — prose a person wrote, not numbers;
 *   4. the active interaction contract, when it is not the default;
 *   5. the routing reminder itself.
 *
 * Pi event: `before_agent_start` — the documented Pi hook for prompt injection. The `input` event is
 * also a viable injection point, but `before_agent_start` is the one that runs once per session and
 * reaches the agent's pre-flight context. The injection is delivered via `message` in the return
 * value with `display: false`: the agent receives the routing context, but Pi does not print the
 * synthetic turn in the visible transcript. `customType` lets downstream consumers recognize it
 * without parsing free text.
 *
 * Deliberate limitations of this port vs. the source hook:
 *   • STATIC INJECTION. The source hook performs rich read-side work: it parses SessionStart JSON on
 *     stdin, reads docs/derived/STATE.json, revision-validates it, reads the v1/v2 compaction
 *     handoff, drives the rollover machine (core/lifecycle/machine.js), reads the human note from
 *     CONTINUITY.md, composes the runtime contract from goal.json, and emits a budget-bounded
 *     multi-section injection. ALL of that is already handled by the rollover extension in this
 *     adapter (respawnpack-rollover.ts) — STATE freshness, handoff consumption, contract composition,
 *     and the budget gates. What is left here is the ONE thing that source hook does that the
 *     rollover extension deliberately does not: a static routing reminder that names the priorities
 *     so the agent sees the routing map every session, not just when a handoff happens to exist.
 *   • NO priority-1 STATE injection. STATE.json is owned by the rollover extension's bridge. The
 *     source hook's "STATE leads, and STATE is never trusted unchecked" discipline belongs to one
 *     owner, not two; this extension names STATE in the priority list and leaves the injection to
 *     the rollover extension.
 *   • NO priority-2 handoff injection. Consumed by respawnpack-rollover.ts at before_agent_start,
 *     exactly once, via the bridge's O_EXCL receipt. A second owner here would re-inject the
 *     handoff's content twice — which is exactly the failure mode (REDELIVERED SessionStart(compact))
 *     the source hook guards against, and the rollover extension carries that guard.
 *   • NO priority-3 CONTINUITY note. Handled by the rollover extension alongside the handoff path.
 *   • NO priority-4 contract. The source hook's contract composition reads docs/derived/state/goal.json
 *     and the runtime contract ledger; that is the rollover extension's job. This extension names the
 *     contract in the priority list and stops there.
 *   • NO revision validation, NO rollover machine, NO receipts. All of those are bridge concerns.
 *
 * Routing-reminder concept credited to obra/superpowers' session-start routing reminder (MIT) —
 * re-derived for RespawnPack's own routing map (see ATTRIBUTION.md in the source tree).
 *
 * AGENTS.md loader (graft, cct prior-art #1): MIT, re-derived — see ATTRIBUTION.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NUDGE =
  "\n[RespawnPack routing]\n" +
  "Priorities for this session, in order:\n" +
  "  1. the generated STATE.json (revision-validated)\n" +
  "  2. any verified compaction handoff for this session, then mark consumed\n" +
  "  3. the bounded human note from CONTINUITY.md\n" +
  "  4. the active interaction contract, when not the default\n" +
  "  5. the routing reminder itself\n" +
  "Type /savepoint to close out. Type /respawn to resume.\n";

/** Custom-type tag for downstream consumers that want to recognize the nudge without parsing text. */
const CUSTOM_TYPE = "session-routing-nudge";

/** Hard cap on AGENTS.md body bytes surfaced into the routing message. 32 KiB is the same budget
 *  RespawnPack uses for any user-authored markdown fed into agent context (see hooks/injection-scan.js
 *  and the source-hook comment on text budgets) — large enough for a real project's cross-tool
 *  conventions, small enough that a 5 MB AGENTS.md does not blow the routing reminder's share of
 *  the model's listing budget. */
const AGENTS_MD_MAX_BYTES = 32 * 1024;

/**
 * Resolve the project directory the same way every Pi extension resolves it: explicit event fields
 * first, then RESPAWN_PI_PROJECT_DIR / CLAUDE_PROJECT_DIR env, then process.cwd(). The routing
 * reminder fires before any work has happened, so cwd() is the typical answer.
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
 * Read AGENTS.md from the project root, if present, and return a bounded slice. Three failure modes
 * are handled silently (no AGENTS.md, unreadable, empty after trim) — the routing reminder is
 * useful on its own and the AGENTS.md load is a strict enhancement, never a hard dependency. A
 * non-UTF-8 file or a directory at that path both read as "no body" rather than as an error.
 */
function readAgentsMd(projectDir: string): string | null {
  const p = join(projectDir, "AGENTS.md");
  if (!existsSync(p)) return null;
  let raw: string;
  try { raw = readFileSync(p, "utf8"); }
  catch { return null; }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > AGENTS_MD_MAX_BYTES) {
    return trimmed.slice(0, AGENTS_MD_MAX_BYTES) +
      `\n\n[…AGENTS.md truncated at ${AGENTS_MD_MAX_BYTES} bytes; full file at ${p}]`;
  }
  return trimmed;
}

export default function (pi: any) {
  pi.on("before_agent_start", (event: any, _ctx: any) => {
    const projectDir = projectDirOf(event);
    const agentsMd = readAgentsMd(projectDir);
    let content = NUDGE;
    if (agentsMd) {
      // AGENTS.md comes AFTER the routing reminder so the reminder's priority list is still the
      // first thing the agent reads; this matches the cct upstream's own ordering (the loader is
      // an addition, not a replacement).
      content += "\n[Project AGENTS.md — repo's own cross-tool instructions]\n" + agentsMd + "\n";
    }
    return {
      message: {
        customType: CUSTOM_TYPE,
        content,
        display: false,
      },
    };
  });
}

export { NUDGE, CUSTOM_TYPE, AGENTS_MD_MAX_BYTES, projectDirOf, readAgentsMd };

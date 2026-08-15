/*
 * RespawnPack · adapters/pi/package/extensions/context-monitor.ts
 *
 * Pi extension port of RespawnPack hooks/context-monitor.js. Preserves the load-bearing semantic:
 * ADVISORY. Warns when the session's context fills up — so the operator can run /compact at a clean
 * boundary BEFORE an auto-compaction drops state. Concept credited to gsd-core's gsd-context-monitor /
 * `gsd-health --context` and the aggregator's context-monitor statusline (MIT); re-derived in
 * RespawnPack's file shape (see ATTRIBUTION.md in the source tree).
 *
 * The Pi equivalent of the source's transcript-tail usage read is `ctx.getContextUsage()` — the host-
 * reported usage object (`{tokens, contextWindow, ...}`). The source hook's three-tier ladder
 * (statusline tee HIGH → transcript-tail usage LOW → byte-proxy PROXY) collapses to ONE on Pi: the
 * host API is the documented, host-reported signal, so the lower-confidence rungs (transcript-tail
 * JSONL parse and byte-proxy fallback) are NOT load-bearing here and are omitted. Pi's
 * `agent_settled` is the safest boundary — it fires once per turn, after Pi has settled all
 * automatic retries and queued continuations; `tool_result` could fire mid-turn and `agent_end` can
 * be followed by a continuation, neither of which is a clean advisory moment.
 *
 * Pi contract: subscribes to `agent_settled`. Reads `ctx.getContextUsage()`. Issues
 * `ctx.ui.notify(..., "warning")` at 60% and 80% thresholds. NEVER blocks, NEVER returns a
 * `block: true` decision. Per-process latch so each threshold fires at most ONCE per session — the
 * same "do not nag every turn" intent the source hook achieves with its per-cycle latch store.
 *
 * Deliberate limitations of this port vs. the source hook:
 *   • Goal-mode is now reflected here as well (the rollover extension has always driven the
 *     lifecycle; this port previously had no goal-mode awareness and used 60/80 regardless). When
 *     scripts/goal-contract.mjs resolves AND a goal-mode contract is active at session_start, the
 *     advisory thresholds shift to goal.contextStages.checkpoint / goal.contextStages.handoff (default
 *     60/85). This is the operator-visible mirror of the rollover extension's load-bearing ladder — it
 *     nudges the operator at the per-goal checkpoints, but the closeout/handoff decisions live in the
 *     rollover extension. Collaborate / delegate mode differentiation is NOT ported (Pi does not
 *     surface those modes through the documented event surface; the source hook escalates only on the
 *     goal-mode path).
 *   • NO statusline tee reader. Pi has no documented statusline-tee file of the same shape, and
 *     the host API is preferred (documented-api, HIGH).
 *   • NO byte-proxy fallback. See top-of-file; Pi does not expose a transcript JSONL in the same
 *     shape Claude Code's PostToolUse does, so the source hook's "if neither usage nor tee parses,
 *     fall back to file size / BYTE_BUDGET" rung has no transcript to read. When the host API is
 *     absent or returns no usable token count, the right move is to be silent (no proxy) rather
 *     than to over-state context from a signal the source hook itself calls PROXY.
 *   • NO per-cycle re-arm machinery. The source re-arms on context-cycle id (a managed SDK
 *     supervisor concept). Pi's `agent_settled` is per-process; the in-memory latch is the
 *     appropriate granularity here.
 *   • NO policy/lifecycle/evidence vocabulary (source-name + confidence). The rollover extension
 *     carries that discipline on Pi; this port is the user-visible advisory, not the bridge.
 */

import { loadPackageGoalContract } from "./goal-contract-loader.ts";

// Default advisory thresholds (decimal fractions). Goal-mode can override these at session_start
// when scripts/goal-contract.mjs resolves and a goal-mode contract exists — the per-goal
// contextStages.checkpoint and contextStages.handoff become the advisory and handoff-advice
// thresholds. The rollover extension (respawnpack-rollover.ts) carries the load-bearing threshold
// ladder via bridge.decide({thresholds}); this module is the operator-visible advisory layer.
const DEFAULT_THRESHOLDS = [0.6, 0.8];
// Per-process latch so the same threshold does not nag on every turn once it has fired. Reset only
// by process restart — matches the source's "fires at most once per cycle" intent at the
// granularity Pi actually exposes.
const lastNotified = { value: 0 };
// Resolved at session_start. When null, use DEFAULT_THRESHOLDS. When set, the array is
// `[advisory / 100, final / 100]` derived from goal.contextStages.
let THRESHOLDS = DEFAULT_THRESHOLDS.slice();

export default function (pi: any) {
  // Resolve goal-mode thresholds at session_start. Best-effort: a missing goal-contract module,
  // missing goal.md, or malformed contract is silently non-goal-mode — the rollover extension
  // does its own goal resolution and is the load-bearing path; this is the advisory mirror.
  pi.on("session_start", async (_event: any, ctx: any) => {
    THRESHOLDS = DEFAULT_THRESHOLDS.slice();
    try {
      const projectDir = (ctx && (ctx.projectDir || ctx.cwd)) || (typeof process !== "undefined" ? process.cwd() : ".");
      const mod = await loadPackageGoalContract();
      if (mod && typeof mod.readGoalMd === "function" && typeof mod.readRuntimeContract === "function" && typeof mod.thresholdsForGoal === "function") {
        const durable = mod.readGoalMd(projectDir);
        const runtime = mod.readRuntimeContract(projectDir);
        if (durable.ok && runtime.ok && runtime.contract && runtime.contract.activeGoalId === durable.goal.goalId) {
          const t = mod.thresholdsForGoal(durable.goal);
          if (t.ok) {
            THRESHOLDS = [t.thresholds.advisory / 100, t.thresholds.final / 100];
            if (ctx && ctx.ui && typeof ctx.ui.notify === "function") {
              ctx.ui.notify(`context-monitor: goal-mode thresholds active (${t.thresholds.advisory}/${t.thresholds.final})`, "info");
            }
          }
        }
      }
    } catch { /* advisory only — never throw out of an event handler */ }
  });

  pi.on("agent_settled", (_event: any, ctx: any) => {
    if (!ctx || typeof ctx.getContextUsage !== "function") return;
    const usage = ctx.getContextUsage();
    if (!usage || typeof usage.tokens !== "number" || typeof usage.contextWindow !== "number" || usage.contextWindow <= 0) return;

    const ratio = usage.tokens / usage.contextWindow;
    for (const t of THRESHOLDS) {
      if (ratio >= t && lastNotified.value < t) {
        try {
          if (ctx.ui && typeof ctx.ui.notify === "function") {
            ctx.ui.notify(`context-monitor: ${(ratio * 100).toFixed(0)}% of context window`, "warning");
          }
        } catch {
          /* advisory only — never throw out of an event handler */
        }
        lastNotified.value = t;
      }
    }
  });
}

export { DEFAULT_THRESHOLDS, THRESHOLDS, lastNotified };
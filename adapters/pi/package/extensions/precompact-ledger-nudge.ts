/*
 * RespawnPack · adapters/pi/package/extensions/precompact-ledger-nudge.ts
 *
 * Pi extension port of RespawnPack/hooks/precompact-ledger-nudge.js. In this lean Pi package it is
 * advisory: it warns when compaction starts without a verified handoff, but it does not cancel the
 * compaction. The hard-block recovery path depended on the removed kernel/savepoint surface.
 *
 * ⛔ LOAD-BEARING: compacting without a verified handoff can lose continuity. This extension makes
 * that risk visible but leaves the final compaction decision to Pi/the operator.
 *
 * ⛔ "VERIFIED" MEANS A `*.verified.json` RECEIPT SITS BESIDE THE HANDOFF. core/state/handoff.js
 * writes the handoff once atomically and then writes a sibling `<handoffId>.verified.json` receipt
 * only after the bytes were read back and compared. A handoff without a receipt is NOT a verified
 * handoff — it was written and may or may not have landed, and the resumed session would trust it
 * either way. The source hook enforces the same rule via `core.handoff.writeVerified` and gates on
 * `w.ok`. This extension gates on the same shape: a `*.verified.json` present in the handoffs dir.
 *
 * ⛔ HOST-SCOPED PATH. core/lifecycle/cycle.js writes per-conversation state at
 *   `<projectDir>/.respawnpack/runtime/rollover/<host>-<conversationId>/handoffs/`
 * and the rollover extension's `openMachine({ projectDir, sessionId })` uses `host = 'pi'` — so
 * the real directory is `pi-<sessionId>/handoffs/`, not `<sessionId>/handoffs/`. The user's
 * pseudocode uses the unsuffixed form; the load-bearing rule (verified handoff must be found)
 * demands the host-suffixed form here, because that is where the rollover extension actually
 * stages handoffs and where the rest of the pack looks for them.
 *
 * Pi contract: subscribes to `session_before_compact`. Always returns undefined so compaction can
 * continue. Emits a `ctx.ui.notify(...)` notification on BOTH paths so the operator sees what
 * happened.
 *
 * Deliberate limitations of this port vs. the source hook:
 *   • NO v1 handoff re-write. The source hook writes a `precompact-<sid>.json` (v1 schema, kept
 *     for one release for readers the pack does not control) AND a v2 handoff (the load-bearing
 *     precondition). v1 is intentionally retained for backward compatibility, but it is NOT the
 *     gate. This extension checks for v2 only.
 *   • NO rollover-machine chain. The source hook best-effort drives
 *     `checkpoint → closeout → stage-handoff → verify-handoff → request-compact` alongside the
 *     precondition, never as part of it. The rollover extension in this adapter already walks
 *     that chain at `agent_settled`, before requesting compaction. Re-driving it here would
 *     duplicate journal entries and stage the same handoff twice.
 *   • NO block/cancel path. Pi's session_before_compact can cancel compaction, but this lean package
 *     intentionally treats missing handoffs as advisory.
 *   • NO `core/` import. This extension is a gatekeeper, not a writer; it observes the handoff
 *     shape on disk and decides. The writer is the rollover extension at agent_settled.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const EXTENSION_NAME = "precompact-ledger-nudge";

/** The host this adapter identifies as. Matches rollover-bridge.js's `HOST = core.evidence.HOSTS.PI`. */
const HOST_TAG = "pi";

/** Receipt suffix, verbatim from core/state/handoff.js's `verifiedPathFor`. */
const VERIFIED_SUFFIX = ".verified.json";

// --- tiny resolvers, matched to the rollover extension's session/project plumbing --------------------

/**
 * Project dir. Tolerates Pi's field drift across versions and the same env override the rollover
 * extension respects (`RESPAWN_PI_PROJECT_DIR`, `CLAUDE_PROJECT_DIR`).
 */
function projectDirOf(event: any, ctx: any): string {
  const cands = [
    event?.projectDir,
    event?.cwd,
    event?.input?.cwd,
    event?.input?.projectDir,
    event?.compaction?.projectDir,
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

/**
 * Session id. Mirrors the rollover extension's `sessionIdOf` precedence — payload first, then ctx,
 * then `ctx.sessionManager.getSessionId()`. `unknown` is the source's fallback when nothing can be
 * determined; we keep that here so a missing id is observable, never silently substituted with a
 * real-looking but wrong value.
 */
function sessionIdOf(event: any, ctx: any): string {
  const cands = [
    event?.sessionId,
    event?.input?.sessionId,
    event?.compaction?.sessionId,
    ctx?.sessionId,
    ctx?.session?.id,
  ];
  for (const c of cands) if (typeof c === "string" && c) return c;
  if (ctx?.sessionManager && typeof ctx.sessionManager.getSessionId === "function") {
    try {
      const v = ctx.sessionManager.getSessionId();
      if (typeof v === "string" && v) return v;
    } catch { /* absent */ }
  }
  if (typeof ctx?.getSessionId === "function") {
    try {
      const v = ctx.getSessionId();
      if (typeof v === "string" && v) return v;
    } catch { /* absent */ }
  }
  return "unknown";
}

/**
 * Sanitize a segment for safe path use. Mirrors core/_io.js's `safeSegment` discipline — strip
 * path separators and the obvious traversal markers so a hostile session id cannot escape the
 * handoff directory.
 */
function safeSegment(s: string): string {
  if (!s) return "unknown";
  return String(s).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 128) || "unknown";
}

// --- the verification check -------------------------------------------------------------------------

/**
 * Does a verified handoff exist for THIS session?
 *
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   handoffDir: string,
 *   verifiedReceipts: string[],
 * }}
 */
function checkVerifiedHandoff(handoffDir: string): { ok: boolean; reason?: string; handoffDir: string; verifiedReceipts: string[] } {
  if (!existsSync(handoffDir)) {
    return {
      ok: false,
      handoffDir,
      verifiedReceipts: [],
      reason: `no handoff record — the directory ${handoffDir} does not exist. A verified handoff must be written (by the rollover extension at agent_settled, or by an explicit /savepoint) before compaction, otherwise unsaved state WILL be lost.`,
    };
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(handoffDir);
  } catch (e) {
    return {
      ok: false,
      handoffDir,
      verifiedReceipts: [],
      reason: `the handoff directory ${handoffDir} could not be listed (${String((e && (e as any).message) || e)}). A verified handoff must be readable before compaction.`,
    };
  }
  const verifiedReceipts = entries.filter((name) => typeof name === "string" && name.endsWith(VERIFIED_SUFFIX));
  if (verifiedReceipts.length === 0) {
    return {
      ok: false,
      handoffDir,
      verifiedReceipts: [],
      reason: `no verified handoff in ${handoffDir} — found ${entries.length} entr(ies) but none carries the .verified.json receipt that proves the bytes were read back. Compaction would risk trusting a handoff that may or may not have landed.`,
    };
  }
  return { ok: true, handoffDir, verifiedReceipts };
}

// --- notification -----------------------------------------------------------------------------------

/**
 * Operator-facing notice on BOTH paths — mirrors the source's `systemMessage` discipline (the
 * operator is told what happened regardless of verdict). Tries `ctx.ui.notify`, falls back to
 * `ctx.log`, then `console.error`. Never throws.
 */
function notify(ctx: any, severity: "info" | "warning" | "error", message: string): void {
  const tagged = `${EXTENSION_NAME}: ${message}`;
  try { if (ctx?.ui?.notify) { ctx.ui.notify(tagged, severity); return; } } catch { /* fall through */ }
  try { if (typeof ctx?.log === "function") { ctx.log(tagged); return; } } catch { /* fall through */ }
  try { if (typeof console !== "undefined") console.error(tagged); } catch { /* nothing left */ }
}

// --- the event handler ------------------------------------------------------------------------------

export default function (pi: any) {
  pi.on("session_before_compact", (event: any, ctx: any) => {
    const projectDir = projectDirOf(event, ctx);
    const sessionId = sessionIdOf(event, ctx);
    const handoffDir = join(
      projectDir,
      ".respawnpack",
      "runtime",
      "rollover",
      `${HOST_TAG}-${safeSegment(sessionId)}`,
      "handoffs",
    );

    const check = checkVerifiedHandoff(handoffDir);

    if (!check.ok) {
      notify(
        ctx,
        "warning",
        `advisory: compaction is continuing without a verified handoff (${check.reason}). ` +
        `Continuity for this session may be incomplete after compaction.`,
      );
      return undefined;
    }

    // Verified handoff exists. Allow compaction. Notify on the success path too — same discipline as
    // the source's `systemMessage` on the normal path — so the operator sees which handoff is being
    // consumed, not silence.
    notify(
      ctx,
      "info",
      `verified handoff(s) present at ${handoffDir} (${check.verifiedReceipts.length} receipt(s): ` +
      `${check.verifiedReceipts.slice(0, 3).join(", ")}${check.verifiedReceipts.length > 3 ? ", …" : ""}). ` +
      `Allowing compaction.`,
    );
    return undefined;
  });
}

export {
  EXTENSION_NAME,
  HOST_TAG,
  VERIFIED_SUFFIX,
  projectDirOf,
  sessionIdOf,
  safeSegment,
  checkVerifiedHandoff,
};

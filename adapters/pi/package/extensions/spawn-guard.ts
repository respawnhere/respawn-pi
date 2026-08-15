/*
 * RespawnPack · adapters/pi/package/extensions/spawn-guard.ts — D-011 Phase 2 update.
 *
 * Pi extension port of RespawnPack/hooks/spawn-guard.js (see ATTRIBUTION.md). This file is the
 * D-011 Phase 2 migration of the legacy single-counter guard into a CANONICAL reservation
 * tracker that names the actual shipped public surface.
 *
 * D-011 (approved 2026-08-12, see docs/DECISIONS.md and docs/SUBAGENT-ALIGNMENT-PLAN.md Phase 2
 * step 5) aligns the package with Pi 0.84.0's subagent example. The shipped public dispatch
 * tool is `respawn-pi-subagent`, registered in adapters/pi/package/extensions/agents-runtime/
 * index.ts as `TOOL_SUBAGENT_NAME = "respawn-pi-subagent"`. The legacy three-way union
 * (`subagent | task | agent`) remains recognized for backward compatibility (older Pi versions,
 * a globally-installed Pi example, vendor forks), but is reserved as a single slot per dispatch;
 * the canonical tool now reserves by mode cardinality.
 *
 * Reservation policy (D-011 Phase 2 Batch B3):
 *   • canonical single ({agent, task})         → reserve 1
 *   • canonical parallel ({tasks: [N items]})  → reserve min(N, MAX_PARALLEL_CONCURRENCY = 4)
 *     because the runtime executes at most four simultaneous children, not all queued task
 *     cardinality (see adapters/pi/package/extensions/agents-runtime/subagent.ts MAX_CONCURRENCY).
 *   • canonical chain ({chain: [...]})         → reserve 1 (sequential; never more than 1 in flight)
 *   • missing/invalid canonical args           → reserve 1 (NEVER attacker-controlled cardinality)
 *   • historical generic `subagent`/`task`/`agent` tool names → reserve 1 (unchanged)
 *
 * Reservation tracking is keyed by the COMPOSITE `(counterFile, toolCallId)` so a parallel
 * call's tool_result releases exactly its own reservation, even if other reservations have
 * settled in the meantime, AND so two projects dispatching under the same Pi-issued
 * `toolCallId` cannot shadow each other (D-011 Phase 2 fix F2). Same-ID same-file replacement
 * (the same `(counterFile, toolCallId)` arriving twice — typically a re-dispatch) first
 * releases the old reservation's amount, then applies the new one. The reservation map is
 * bounded by RESERVATION_MAP_CAP; at cap, strict mode denies and persists neither counter nor
 * map (no eviction of an active reservation under a lock that does not own its counter file),
 * and advisory mode allows the dispatch but increments the persisted counter by the canonical
 * amount WITHOUT adding a map entry beyond the cap. This is deliberately conservative overflow
 * accounting: the cap-reached dispatch has no map entry, so its later tool_result cannot
 * decrement, and the count may overcount until SPAWN_STALE_MS self-heal. It must never
 * undercount. Across projects the map size stays ≤ cap.
 *
 * Strict-mode denials do NOT persist a partial reservation — the read-decide-write happens
 * inside one mutex; the counter is only written when the dispatch is allowed to proceed.
 *
 * Preserved semantics from the source hook and the prior Pi port (do NOT regress):
 *   • per-file in-process mutex (defect 2 in the source header)
 *   • stale counter self-heal (SPAWN_STALE_MS shared with index-guard.ts)
 *   • strict mode fail-closed (no silent allow on AMBIGUOUS counter state)
 *   • advisory mode never blocks (only notifies)
 *   • counter file keyed by sanitized session id matching index-guard's regex
 *   • counter file keyed by project root, never the tool-call cwd
 *
 * Two Pi events, two responsibilities, two ends of the same counter:
 *   tool_call   on a subagent-dispatching tool (respawn-pi-subagent | subagent | task | agent)
 *               — read counter, decide under ceiling, persist + record reservation only when
 *               the dispatch is actually allowed to proceed.
 *   tool_result on the same set of tools — release exactly the reservation's amount by
 *               toolCallId (canonical) or 1 slot (legacy three-way union).
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// --- Recognized tool names (D-011 Phase 2) -------------------------------------------------------

/** Canonical package dispatch tool (D-011 — public surface shipped in
 *  adapters/pi/package/extensions/agents-runtime/index.ts as `TOOL_SUBAGENT_NAME`). */
const CANONICAL_SUBAGENT_TOOL = "respawn-pi-subagent";

/** Historical three-way union for backward compatibility with Pi versions / vendor forks /
 *  globally-installed Pi example that still register under one of these names. The canonical
 *  `respawn-pi-subagent` always wins cardinality resolution when both shapes fire. */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(["subagent", "task", "agent"]);

// --- Tunables (preserved from the prior Pi port) -------------------------------------------------

/** Default ceiling: skills/README.md principle 4 ("stay single-digit"). Operator-overridable. */
const DEFAULT_CEILING = 8;

/** 30 minutes, matching index-guard.ts's SPAWN_STALE_MS so the two extensions share one opinion
 *  about "in flight". A parent killed mid-wave must not wedge a future session. */
const SPAWN_STALE_MS = Number(process.env.RESPAWNPACK_SPAWN_STALE_MS) || 30 * 60 * 1000;

/** Path to the strict-mode marker; presence switches the post-CEILING behavior from advisory to deny. */
const STRICT_MARKER = ".respawnpack/spawn-guard.strict";

/** Maximum simultaneous children the canonical parallel runner executes at any moment. Mirrors
 *  subagent.ts's MAX_CONCURRENCY (Pi 0.84.0 example parity). Mirrored here as a constant so the
 *  spawn-guard is self-contained for unit tests and does not have to import the agents-runtime
 *  module (which would create a cross-extension import). */
const MAX_PARALLEL_CONCURRENCY = 4;

/** Reservation map cardinality cap. NO EVICTION at cap: strict mode denies and persists
 *  neither counter nor map; advisory mode increments the persisted counter by the canonical
 *  amount WITHOUT adding a map entry beyond the cap (conservative overflow accounting). The
 *  cap is a load-bearing ceiling — evicting an active reservation would undercount the wave
 *  in flight. 64 mirrors the PENDING_FAILURES_CAP the agents-runtime uses for its own bounded
 *  map. */
const RESERVATION_MAP_CAP = 64;

// --- Per-file mutex (preserved) -----------------------------------------------------------------

/** Per-file mutex. Pi's tool_call preflight is already sequential, but tool_result fires in tool-
 *  completion order and can interleave with the next preflight — so the read-decide-write is
 *  guarded here to make the source's defect 2 unreproducible in this port. The same lock also
 *  guards the in-memory reservation map for the same counter file, so a tool_call that decides
 *  to reserve N and a tool_result that releases N are atomic against a concurrent re-dispatch
 *  of the same toolCallId. */
const locks: Map<string, Promise<void>> = new Map();

async function withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(key) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  // D-011 Phase 2 fix (F3): the chained promise stored in the map is `prev.then(() => next)`,
  // not `next` itself. The prior implementation compared `locks.get(key) === next` for cleanup,
  // which could never succeed — the stored value is the chained promise. Capture the actual
  // chained promise and compare against THAT on cleanup, so cold sessions actually release
  // their lock entry (regression test below hammers many unique counter files and asserts the
  // map stays bounded).
  const chained = prev.then(() => next);
  locks.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // Best-effort cleanup so the map doesn't accumulate entries for cold sessions. The
    // comparison is against the chained promise we just stored — same instance, not `next`.
    if (locks.get(key) === chained) locks.delete(key);
  }
}

/** Test-only seam: read the lock map size. Production never calls this. */
function _lockMapSizeForTests(): number { return locks.size; }

// --- Reservation map (process-local; D-011 Phase 2 fix F2) ---------------------------------------

type ReservationEntry = {
  /** Number of slots this tool_call reserved against the persisted counter. */
  amount: number;
  /** Absolute path to the counter file this reservation is recorded against. Carrying the path
   *  lets a tool_result for a cold session decrement the right file even when the current
   *  process has rotated its project root. */
  counterFile: string;
  /** True iff this entry was registered against the canonical `respawn-pi-subagent` tool. Kept
   *  for test introspection; not consulted by the runtime code path. */
  canonical: boolean;
};

/**
 * In-memory reservation map, keyed by the COMPOSITE (counterFile, toolCallId) so a same-ID
 * tool_call across two different projects does not collide on a single global key. Before
 * this fix the map was keyed by toolCallId alone — two projects dispatching with the same
 * Pi-issued toolCallId would shadow each other, and a tool_result for project A could
 * subtract from project B's counter (or release B's reservation under the wrong lock). F2
 * closes both holes:
 *
 *   - composite key: project A's `id=X` reservation is unreachable from project B's `id=X`
 *     tool_call / tool_result, and vice versa;
 *   - the SAME (counterFile, toolCallId) replacement still releases the old reservation
 *     first then applies the new amount (same-ID same-file semantics preserved);
 *   - at RESERVATION_MAP_CAP the guard NEVER evicts an active reservation (evicting would
 *     undercount the wave in flight, and cross-file eviction would write to a lock that
 *     does not own the persisted counter). Strict mode denies and persists neither counter
 *     nor map; advisory mode increments the persisted counter by the canonical amount but
 *     does NOT add a map entry beyond the cap. The cap-reached entry has no map entry, so
 *     its later tool_result cannot decrement — this is deliberately conservative overflow
 *     accounting; the SPAWN_STALE_MS self-heal resets the count at the next dispatch.
 *
 * The map is process-local by design: each Pi process owns its own session; cross-process
 * consistency is owned by the persisted counter file (which mirrors the sum of currently-
 * active reservations on this process).
 */
const reservations: Map<string, ReservationEntry> = new Map();

/** Build the composite map key. Exposed for tests that need to inspect the map directly. */
function reservationKey(counterFile: string, toolCallId: string): string {
  return `${counterFile}\u0000${toolCallId}`;
}

/** Iterate live reservations in insertion order, paired with their composite keys.
 *  Exposed for tests + for the cap-reached probe. */
function _liveReservationsForTests(): Array<{ key: string; entry: ReservationEntry }> {
  const out: Array<{ key: string; entry: ReservationEntry }> = [];
  for (const [key, entry] of reservations) out.push({ key, entry });
  return out;
}

/** Test-only seam: wipe the in-memory reservation map. Production never calls this. */
function _resetReservationsForTests(): void {
  reservations.clear();
}

// --- Helpers (preserved) ------------------------------------------------------------------------

/** Sanitize a session id for the filename so the file always matches index-guard's
 *  `spawn-state-[A-Za-z0-9_-]+\.json` regex. A session id that contains a path separator or other
 *  illegal char would either escape the .respawnpack dir or silently evade index-guard's reader. */
function sanitizeSessionId(sessionId: string | null | undefined): string {
  return String(sessionId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Path to the counter file. ALWAYS keyed on the project root (header defect M.1c), never on the
 *  tool call's working directory. */
function counterPath(projectDir: string, sessionId: string): string {
  return join(projectDir, ".respawnpack", `spawn-state-${sanitizeSessionId(sessionId)}.json`);
}

/** Read the current count as an EXPLICIT verdict — absent and corrupt are different facts (mirror
 *  of readCountState in the source). Missing or stale → 0 (self-heal). Unreadable / corrupt →
 *  AMBIGUOUS, which strict mode treats as a denial trigger and advisory mode treats as silent. */
type ReadState =
  | { status: "PASS"; count: number }
  | { status: "AMBIGUOUS"; reason: string };

function readCount(file: string): ReadState {
  let stat: ReturnType<typeof statSync>;
  try { stat = statSync(file); }
  catch (e: any) {
    if (e && e.code === "ENOENT") return { status: "PASS", count: 0 };
    return { status: "AMBIGUOUS", reason: `the counter file could not be opened (${e && e.code ? e.code : "unknown"})` };
  }
  if (Date.now() - stat.mtimeMs > SPAWN_STALE_MS) return { status: "PASS", count: 0 };
  let data: any;
  try { data = JSON.parse(readFileSync(file, "utf8")); }
  catch (e: any) {
    return { status: "AMBIGUOUS", reason: `the counter file is corrupt or unreadable (${e && e.code ? e.code : "CORRUPT"})` };
  }
  const n = Number(data && data.count);
  if (!Number.isFinite(n)) return { status: "AMBIGUOUS", reason: "the counter file holds no usable count" };
  return { status: "PASS", count: Math.max(0, n) };
}

/** Persist a count. `mkdirSync` is idempotent and recursive. */
function writeCount(file: string, count: number): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify({ count: Math.max(0, count), updatedAt: new Date().toISOString() }));
}

// --- Project / session resolution (preserved) --------------------------------------------------

function projectDirOf(event: any, ctx: any): string {
  const e = event || {};
  const c = ctx || {};
  const candidates = [
    c.cwd,
    e.cwd,
    e.input && e.input.cwd,
    e.projectDir,
    typeof process !== "undefined" && process.env
      ? (process.env.RESPAWN_PI_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR)
      : null,
    typeof process !== "undefined" ? process.cwd() : ".",
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return ".";
}

function sessionIdOf(event: any, ctx: any): string {
  const e = event || {};
  const c = ctx || {};
  if (c.sessionManager && typeof c.sessionManager.getSessionId === "function") {
    try { const v = c.sessionManager.getSessionId(); if (typeof v === "string" && v) return v; }
    catch { /* absent */ }
  }
  if (typeof c.sessionId === "string" && c.sessionId) return c.sessionId;
  if (c.session && typeof c.session.id === "string" && c.session.id) return c.session.id;
  if (typeof e.sessionId === "string" && e.sessionId) return e.sessionId;
  return "unknown";
}

/** Operator-overridable ceiling. Default is 8 (skills/README.md principle 4). */
function ceiling(): number {
  const v = Number(process.env && process.env.RESPAWNPACK_SPAWN_CEILING);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CEILING;
}

/** Test-only seam: override the ceiling for a single process. Production never calls this. */
function _setCeilingForTests(value: number): void {
  (process.env as Record<string, string | undefined>).RESPAWNPACK_SPAWN_CEILING = String(value);
}

// --- D-011 Phase 2 reservation arithmetic ------------------------------------------------------

/** Pure helper: compute the canonical reservation amount for a `respawn-pi-subagent` tool_call.
 *  Pi's runtime enforces "exactly one mode" via a modeCount check; this helper mirrors that
 *  decision and never trusts attacker-controlled cardinalities.
 *
 *  Cardinality bounds (defense against hostile callers passing a huge tasks array):
 *  - chain is sequential: 1 simultaneous child regardless of chain length.
 *  - parallel is bounded by MAX_PARALLEL_CONCURRENCY (4) — the runtime limit, not the array
 *    length — so a caller passing tasks:[1000000] reserves 4, not 1000000.
 *  - empty / malformed / missing canonical args → 1 conservative; never 0 and never an
 *    attacker-controlled number. */
function canonicalReservationAmount(input: any): number {
  if (!input || typeof input !== "object") return 1;

  // chain mode: sequential, so exactly 1 simultaneous child regardless of length.
  if (Array.isArray(input.chain)) return 1;

  // parallel mode: max simultaneous children = min(tasks.length, MAX_PARALLEL_CONCURRENCY).
  // Empty array → 1 (the runtime won't spawn, but conservative reservation keeps the counter
  // honest for tracking purposes). Non-array → 1 (malformed input — the runtime rejects, but
  // we still record a slot so a malicious caller cannot squat the counter to bypass ceiling).
  if (Array.isArray(input.tasks)) {
    const n = input.tasks.length;
    if (!Number.isInteger(n) || n <= 0) return 1;
    return Math.min(n, MAX_PARALLEL_CONCURRENCY);
  }

  // single mode: 1 simultaneous child iff agent AND task are present and non-empty.
  if (typeof input.agent === "string" && input.agent.trim() !== ""
      && typeof input.task === "string" && input.task.trim() !== "") {
    return 1;
  }

  // Missing/malformed canonical args: 1 conservative. Never 0 (would let an attacker squat
  // the counter below zero); never attacker-controlled (e.g., input.tasks=99999 if non-array).
  return 1;
}

// --- Pi handler primitives ---------------------------------------------------------------------

function deny(reason: string): { block: true; reason: string } {
  return { block: true, reason };
}

function notify(ctx: any, message: string, level: "info" | "warning" | "warn"): void {
  try {
    if (ctx && ctx.ui && typeof ctx.ui.notify === "function") {
      ctx.ui.notify(message, level);
      return;
    }
  } catch { /* best-effort */ }
}

// --- Extension entrypoint -----------------------------------------------------------------------

export default function (pi: any) {
  // --- PREFLIGHT: increment-and-gate on every subagent-dispatching tool_call ---------------------
  pi.on("tool_call", async (event: any, ctx: any) => {
    if (!event) return undefined;
    const toolName = event.toolName;
    let amount: number;
    let canonical: boolean;
    if (toolName === CANONICAL_SUBAGENT_TOOL) {
      canonical = true;
      amount = canonicalReservationAmount(event.input);
    } else if (SUBAGENT_TOOLS.has(toolName)) {
      canonical = false;
      amount = 1;
    } else {
      return undefined;
    }

    const projectDir = projectDirOf(event, ctx);
    const sessionId = sessionIdOf(event, ctx);
    const file = counterPath(projectDir, sessionId);
    const limit = ceiling();
    const strict = existsSync(join(projectDir, STRICT_MARKER));
    const toolCallId = (typeof event.toolCallId === "string" && event.toolCallId) ? event.toolCallId : null;

    // Read → decide → write, all under one mutex that ALSO owns the in-memory reservation
    // map for this counter file. Same-ID replacement is applied atomically against the
    // persisted counter so a denied dispatch never persists a partial reservation. At cap,
    // strict mode denies and persists neither counter nor map; advisory mode increments the
    // persisted counter by the canonical amount WITHOUT adding a map entry beyond the cap.
    //
    // The reservation map is keyed by (counterFile, toolCallId) so a same-ID tool_call across
    // two different projects cannot collide. Cross-project counter writes would require a lock
    // that does not own the target file — the policy is therefore conservative: never evict.
    let capReached = false;
    type Decision =
      | { kind: "allow"; count: number; candidate: number; capReached: boolean }
      | { kind: "deny"; candidate: number; reason: "ceiling" | "cap_reached" }
      | { kind: "ambiguous"; reason: string };
    const decision: Decision = await withLock(file, () => {
      const state = readCount(file);
      if (state.status !== "PASS") {
        return { kind: "ambiguous" as const, reason: state.reason };
      }
      // Same-ID replacement (same file, same id): deduct the prior reservation (if any) before
      // computing candidate. The composite key is (counterFile, toolCallId); an entry for the
      // SAME id in a DIFFERENT file is not visible here, so cross-project same-ID entries
      // cannot underflow this counter.
      let oldAmount = 0;
      let priorKey: string | null = null;
      if (canonical && toolCallId) {
        const key = reservationKey(file, toolCallId);
        const prior = reservations.get(key);
        if (prior) { oldAmount = prior.amount; priorKey = key; }
      }
      const effectiveCurrent = Math.max(0, state.count - oldAmount);
      const candidate = effectiveCurrent + amount;

      // Cap-reached (F2): if this canonical call would push the map beyond
      // RESERVATION_MAP_CAP, NEVER evict an active reservation. Eviction would either
      // undercount the wave in flight (the evicted entry's tool_result would then
      // decrement by an unknown amount) or write under a lock that does not own the
      // evicted entry's counter file (cross-project subtraction is unsound). The policy:
      //   • strict  → deny and persist neither counter nor map;
      //   • advisory → allow, increment persisted counter by the canonical amount, but
      //                 DO NOT add a map entry beyond the cap. The cap-reached entry has
      //                 no map entry, so its later tool_result cannot decrement — this is
      //                 deliberately conservative overflow accounting; the count may
      //                 overcount until SPAWN_STALE_MS self-heal. It must never undercount.
      // Across projects the map size stays ≤ cap. Existing known map entries still release
      // exactly via tool_result.
      if (canonical && toolCallId && reservations.size >= RESERVATION_MAP_CAP && priorKey === null) {
        if (strict) {
          return { kind: "deny" as const, candidate, reason: "cap_reached" };
        }
        capReached = true;
      }

      const denying = strict && candidate > limit;
      if (denying) return { kind: "deny" as const, candidate, reason: "ceiling" };

      // Same-ID replacement (priorKey !== null): drop the old entry and apply the new
      // amount. This branch is independent of cap-reached — a same-id replacement always
      // takes one slot out and (possibly a different size) puts one back in.
      if (canonical && priorKey !== null) {
        reservations.delete(priorKey);
      }
      const newCount = Math.max(0, state.count - oldAmount + amount);
      writeCount(file, newCount);
      // Record the map entry ONLY when we have room for it. capReached advisory calls do
      // not get a map entry: their tool_result will observe no reservation and decrement
      // nothing (conservative overflow until SPAWN_STALE_MS self-heal).
      if (canonical && toolCallId && !capReached) {
        reservations.set(reservationKey(file, toolCallId), { amount, counterFile: file, canonical: true });
      }
      return { kind: "allow" as const, count: newCount, candidate, capReached };
    });

    if (decision.kind === "ambiguous") {
      if (strict) {
        return deny(
          `🔒 spawn-guard is in STRICT mode (.respawnpack/spawn-guard.strict present), which is a HARD ceiling ` +
          `(${limit}) — and the number of agents already in flight could not be established: ${decision.reason}. ` +
          `A ceiling that quietly allows the dispatches it cannot count is not a ceiling. Remove or repair ` +
          `"${file}", wait for the current wave to land, or remove the strict marker to go back to advisory-only.`,
        );
      }
      return undefined;
    }
    if (decision.kind === "deny") {
      if (decision.reason === "cap_reached") {
        return deny(
          `🔒 spawn-guard is in STRICT mode (.respawnpack/spawn-guard.strict present) and the in-process ` +
          `reservation map is at its cap (${RESERVATION_MAP_CAP}). A strict-mode dispatch must NEVER evict ` +
          `an active reservation (eviction would undercount the wave in flight, or write under a lock that ` +
          `does not own the persisted counter). The cap must drop before a new dispatch can proceed — ` +
          `wait for the current wave to land and the reservations to drain, or remove the strict marker ` +
          `to go back to advisory-only (advisory will allow the dispatch and increment the persisted ` +
          `counter, but cannot extend the in-memory map beyond the cap — count may overcount until ` +
          `SPAWN_STALE_MS self-heal).`,
        );
      }
      notify(ctx, "spawn-guard: denied an over-ceiling dispatch (strict)", "warning");
      return deny(
        `spawn-guard: this dispatch would push the active counter to ${decision.candidate}, above the STRICT ceiling ` +
        `(${limit} — skills/README.md principle 4, "stay single-digit"). ` +
        `spawn-guard is in STRICT mode (.respawnpack/spawn-guard.strict present) — wait for the current wave to land, ` +
        `or remove the strict marker to go back to advisory-only.`,
      );
    }
    // decision.kind === "allow"
    if (decision.capReached) {
      // Cap-reached advisory: the dispatch was allowed and the counter incremented, but no
      // map entry was recorded. The operator should know reservation detail is saturated and
      // the persisted count is conservative (may overcount until SPAWN_STALE_MS self-heal).
      // It must never undercount: known map entries still release exactly via tool_result.
      notify(ctx,
        `spawn-guard: reservation map saturated (cap=${RESERVATION_MAP_CAP}) — dispatch allowed but ` +
        `no map entry; persisted count for this file is conservative and may overcount until ` +
        `the SPAWN_STALE_MS self-heal at the next dispatch.`,
        "warning");
    }
    if (decision.count > limit) {
      // Advisory mode: notify, but do not block. The source returns additionalContext as a JSON
      // payload; Pi's tool_call channel has no equivalent, so ctx.ui.notify is the closest load-
      // bearing surface for "the human should see this number".
      notify(ctx, `spawn-guard: ${decision.count} in flight (CEILING=${limit}) — consider lowering concurrency`, "warning");
    }
    return undefined;
  });

  // --- COMPLETION: decrement on tool_result for the same set of tools ----------------------------
  // Pi's tool_result is the closest analog to Claude Code's SubagentStop — a tool that ran to
  // completion must release its slot. The canonical tool releases EXACTLY the amount its
  // tool_call reserved (looked up by toolCallId), so a parallel call cannot accidentally
  // release a neighbor's slots and a serial chain cannot over-release.
  pi.on("tool_result", async (event: any, _ctx: any) => {
    if (!event) return undefined;
    const toolName = event.toolName;
    if (toolName !== CANONICAL_SUBAGENT_TOOL && !SUBAGENT_TOOLS.has(toolName)) return undefined;

    const projectDir = projectDirOf(event, _ctx);
    const sessionId = sessionIdOf(event, _ctx);
    const file = counterPath(projectDir, sessionId);
    const toolCallId = (typeof event.toolCallId === "string" && event.toolCallId) ? event.toolCallId : null;
    const isCanonical = toolName === CANONICAL_SUBAGENT_TOOL;

    await withLock(file, () => {
      if (isCanonical) {
        // Canonical tool_result semantics: release EXACTLY the amount the matching tool_call
        // reserved, looked up by the composite (counterFile, toolCallId) key. If no toolCallId
        // was provided, or no reservation exists for this composite key (e.g. the dispatch was
        // a cap-reached advisory call that never recorded a map entry, or the dispatch was
        // denied in strict mode and never persisted a reservation), we CANNOT determine the
        // original amount — so we do NOT decrement. A guess would be wrong more often than not:
        // a denied strict-mode dispatch has amount=0 in the counter (no reservation recorded,
        // no increment persisted), and a cap-reached advisory dispatch has its amount in the
        // counter but no map entry (its tool_result is a no-op by design — conservative
        // overflow accounting). The stale window self-heals any drift at the next dispatch.
        // Same-ID same-file replacement (tool_call replacing its own reservation) already
        // releases the old amount at the tool_call side; this lookup would observe the
        // post-replacement entry, not the old one, so a double-decrement cannot occur.
        if (!toolCallId) return;
        const key = reservationKey(file, toolCallId);
        const prior = reservations.get(key);
        if (!prior) return; // unknown composite key → no decrement (cross-project / cap-reached safety)
        reservations.delete(key);
        const state = readCount(file);
        if (state.status === "PASS") writeCount(file, Math.max(0, state.count - prior.amount));
        return;
      }
      // Historical (legacy three-way union): 1-slot release per call. Historical tools are not
      // tracked in the reservation map (the spec requires by-ID tracking only for the canonical
      // tool), so a 1-slot decrement is the best information available.
      const state = readCount(file);
      if (state.status === "PASS") writeCount(file, Math.max(0, state.count - 1));
      // AMBIGUOUS — leave the counter alone. Resetting it on a guess would be worse than skipping
      // the decrement; the stale window self-heals the counter at the next dispatch.
    });

    return undefined;
  });
}

export {
  SUBAGENT_TOOLS,
  CANONICAL_SUBAGENT_TOOL,
  SPAWN_STALE_MS,
  STRICT_MARKER,
  MAX_PARALLEL_CONCURRENCY,
  RESERVATION_MAP_CAP,
  sanitizeSessionId,
  counterPath,
  readCount,
  writeCount,
  projectDirOf,
  sessionIdOf,
  ceiling,
  canonicalReservationAmount,
  reservationKey,
  _liveReservationsForTests,
  _resetReservationsForTests,
  _lockMapSizeForTests,
  _setCeilingForTests,
};

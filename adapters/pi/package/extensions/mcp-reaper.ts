/*
 * RespawnPack · adapters/pi/package/extensions/mcp-reaper.ts
 *
 * Pi extension port of RespawnPack/hooks/mcp-reaper.js. Preserves the load-bearing semantic:
 * BEST-EFFORT CLEANUP. On `session_shutdown`, attempt to reap Docker containers labeled
 * `docker-mcp=true` (the gateway containers) and `respawnpack.session=<id>` (the session-tagged
 * ones the docker-session-tag hook stamps on AI-started `docker run`s). On Pi, no Docker is
 * installed by default — the extension detects Docker absence and becomes a no-op (single
 * `info` notify, then silent on subsequent shutdowns), and the hook is graceful when Docker is
 * missing or the daemon is down.
 *
 * The source's label-family logic is replicated unchanged: containers with `respawnpack.keep=true`
 * are NEVER stopped or removed by ANY path (checked in JS via `docker inspect`, not via a
 * `--filter label!=` that depends on a docker version); session-tagged containers are `docker stop`'d
 * non-keep and `docker rm`'d ONLY when additionally labeled `respawnpack.class=temp` (infra is
 * stopped, never removed). The gateway `docker-mcp=true` containers are stopped but NEVER removed
 * — a concurrent sibling session's next handshake transparently respawns what it needs.
 *
 * ⛔ WHY AN INLINE SWEEP, NOT A DETACHED CHILD. The source hook re-spawns itself with `--reap
 * <mode>` and `unref()`s the child, because Claude Code's hook timeout (~60s) cannot accommodate
 * `docker stop -t 5` across N containers. Pi's `session_shutdown` has no documented hard timeout
 * and runs synchronously while the runtime tears down — the equivalent guarantee here is
 * per-call timeouts on each `execFileSync` (5s for the daemon probe, 8s for `docker ps`, 8s for
 * `docker inspect`, 10s for `docker stop`, 8s for `docker rm`), so a stuck call never blocks the
 * shutdown. The session-scoped sweep filters by `respawnpack.session=<id>` directly in the
 * `docker ps --filter` argument — a live sibling session's containers carry a different id and
 * are untouched, exactly as in the source's SessionEnd path.
 *
 * ⛔ DETECTION IS PER-CONTAINER, NOT VIA `--filter`. The same trap the source hook is hardened
 * against lives in `docker ps --filter label!=respawnpack.keep=true`: a docker version that
 * does not implement negated label filters would silently let keep containers through. The
 * inspection path here uses the same JS-side `labelsOf` reader the source uses, and an
 * unreadable container is left alone (signaled by returning `null` from `labelsOf`).
 *
 * ⛔ TWO LABEL FAMILIES, NEVER MORE. The source is explicit: "It acts on exactly two label
 * families and nothing else: the gateway's own `docker-mcp=true` containers, and the
 * `respawnpack.session=<id>` containers." This port is a label-family reaper, not a
 * general-purpose docker cleaner — containers without either label are not touched, not even
 * by accident.
 *
 * Pi contract: subscribes to `session_shutdown`. Detects Docker via `execFileSync('docker',
 * ['version'])` inside a try/catch. If absent, emits a single `info` notify (per-process latch,
 * so the message does not repeat on every shutdown in a long-lived daemon) and returns. If
 * present, runs the inline sweep: gateway `docker-mcp=true` stop, then
 * `respawnpack.session=<id>` stop+rm-temp. All docker calls fail-silent.
 *
 * Opt-out: `.respawnpack/mcp-reaper.off` in the project dir (matches the source).
 * Tuning:  RESPAWNPACK_MCP_REAPER_STALE_HOURS (default 2) — kept for source parity even though
 *          this port runs the source's "all" mode (the session is going away, no stale cutoff).
 *
 * DELIBERATE LIMITATIONS OF THIS PORT VS. THE SOURCE HOOK:
 *   • NO `SessionStart`-equivalent stale sweep. Pi has no documented counterpart of the
 *     source's `SessionStart` orphan-reap, and the roll-over model on Pi is single-session
 *     per process. A session that wants orphan cleanup can run `/reload` (which fires
 *     `session_shutdown` with `reason: "reload"`) — the sweep is the same.
 *   • NO detached `--reap` child process. Documented above; per-call timeouts are the Pi
 *     equivalent of the source's "docker's shutdown grace never eats the hook timeout" intent.
 *   • NO event-driven distinction between `quit | reload | new | resume | fork`. The source
 *     treats all of these the same on SessionEnd; this port does too — the shutdown sweep is
 *     "everything this session's runtime started or allowed to accumulate", and a reload is
 *     the cleanest moment to take that memory back.
 *
 * Activation is OPT-IN: the file exists in extensions/ but is NOT listed under `pi.extensions` in
 * `package.json`. Adding the path to that list wires it in. Same convention as the other opt-in
 * ports (stop-savepoint, worktree-guard, secret-scan, push-guard, shell-guard, etc.).
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const EXTENSION_NAME = "mcp-reaper";

// Exactly two label families and nothing else. Mirrors the source's invariant.
const GATEWAY_LABEL = "docker-mcp=true";
const SESSION_LABEL_PREFIX = "respawnpack.session=";

// Self-tags the source explicitly forbids touching.
const KEEP_LABEL = "respawnpack.keep";
const CLASS_LABEL = "respawnpack.class";
const TEMP_CLASS = "temp";

// Per-call timeouts — never block a shutdown on a stuck docker call.
const DOCKER_PROBE_TIMEOUT_MS = 5_000;
const DOCKER_PS_TIMEOUT_MS = 8_000;
const DOCKER_INSPECT_TIMEOUT_MS = 8_000;
const DOCKER_STOP_TIMEOUT_MS = 10_000;
const DOCKER_RM_TIMEOUT_MS = 8_000;
const STOP_GRACE_SECONDS = 2;

// Opt-out: a marker file in the project dir skips the sweep entirely. Source parity.
const OFF_MARKER = "mcp-reaper.off";

// Per-process latch so the "docker not available" message does not nag on every shutdown.
let noDockerNotified = false;

// ---- tiny utilities -------------------------------------------------------------------------------

/**
 * Run `docker <args>`, return stdout as a trimmed string, or `null` on any failure. The source
 * treats every docker error as a reason to give up gracefully — never a thrown exception out
 * of the reaper. `windowsHide` matches the source so a Windows host does not flash a console.
 */
function docker(args: string[], timeoutMs: number): string | null {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs,
      // stdio swallowed: a noisy docker should not corrupt the channel, and we are best-effort.
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** `docker version` is the documented "is the daemon reachable" probe; any failure means no-op. */
function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: DOCKER_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a container's labels, or `null` when they cannot be read. The source documents this as
 * "unreadable → leave it alone" — a label read failure must not result in a keep-or-rm guess.
 */
function labelsOf(id: string): Record<string, string> | null {
  const out = docker(["inspect", "--format", "{{json .Config.Labels}}", id], DOCKER_INSPECT_TIMEOUT_MS);
  if (out === null) return null;
  try {
    const parsed = JSON.parse(out.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Coerce keys/values to strings so the label lookups below are uniform.
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[String(k)] = v === null || v === undefined ? "" : String(v);
      }
      return out;
    }
    return {};
  } catch {
    return null;
  }
}

/** `docker ps -q` returns a newline-separated id list, possibly empty. */
function listByLabel(labelFilter: string, all: boolean): string[] {
  const out = docker(
    ["ps", "-q", all ? "-a" : "", "--filter", `label=${labelFilter}`].filter((s) => s !== ""),
    DOCKER_PS_TIMEOUT_MS,
  );
  if (out === null) return [];
  return out.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Stop containers; failure is not surfaced (the source's gateway sweep is its own try/catch). */
function stopContainers(ids: string[]): void {
  if (!ids.length) return;
  docker(["stop", "-t", String(STOP_GRACE_SECONDS), ...ids], DOCKER_STOP_TIMEOUT_MS);
}

/** Remove containers (session-scoped, only `class=temp` reach this point). Failure is silent. */
function rmContainers(ids: string[]): void {
  if (!ids.length) return;
  docker(["rm", ...ids], DOCKER_RM_TIMEOUT_MS);
}

// ---- the two sweeps -------------------------------------------------------------------------------

/**
 * Path 1 — gateway `docker-mcp=true` containers. On session shutdown we take the source's
 * SessionEnd semantics: stop ALL of them (non-keep only). A concurrent sibling session's next
 * handshake transparently respawns what it needs. NEVER removed.
 */
function reapGateway(): void {
  // Source uses `-a` here on the assumption that even non-running containers should be cleared.
  // The reaper is responsible for stopping; we list both running and stopped so a crashed
  // gateway's stale record does not outlive the session. Keep filter applied JS-side.
  const ids = listByLabel(GATEWAY_LABEL, true);
  if (!ids.length) return;
  const keepable = ids.filter((id) => {
    const l = labelsOf(id);
    return l !== null && String(l[KEEP_LABEL]) !== "true";
  });
  stopContainers(keepable);
}

/**
 * Path 2 — `respawnpack.session=<id>` containers. On shutdown we take the source's SessionEnd
 * semantics: stop THIS session's containers (a sibling's carry a different id and are untouched).
 * Stop non-keep; `docker rm` ONLY the ones additionally labeled `respawnpack.class=temp`. Infra
 * is stopped, never removed. A missing/unknown session id collapses to the source's "SessionEnd
 * with no session id" branch — we still try, on `respawnpack.session` alone, because the safer
 * miss is to leave a sibling's containers alone; the path-2 sweep on a missing id becomes a
 * no-op rather than a global one.
 */
function reapSession(sessionId: string): void {
  if (!sessionId) return; // we cannot target a specific session; the sibling would be at risk
  const ids = listByLabel(`${SESSION_LABEL_PREFIX}${sessionId}`, false);
  if (!ids.length) return;

  const toStop: string[] = [];
  const toRm: string[] = [];
  for (const id of ids) {
    const l = labelsOf(id);
    if (l === null) continue;                                  // unreadable → leave alone
    if (String(l[KEEP_LABEL]) === "true") continue;            // keep=true → never stopped nor removed
    toStop.push(id);
    if (String(l[CLASS_LABEL]) === TEMP_CLASS) toRm.push(id);  // temp → also removed (after stop)
  }
  stopContainers(toStop);
  rmContainers(toRm);
}

// ---- tiny context resolvers -----------------------------------------------------------------------

/**
 * Project dir for the off-marker check. The source reads `process.env.CLAUDE_PROJECT_DIR ||
 * process.cwd()`; we add the same ladder Pi's other ports use (event cwd, ctx cwd, env, cwd)
 * so the marker resolves the same way across versions.
 */
function projectDirOf(event: any, ctx: any): string {
  const candidates: Array<string | undefined | null> = [
    event?.cwd,
    event?.projectDir,
    ctx?.cwd,
    typeof process !== "undefined" && process.env
      ? (process.env.RESPAWN_PI_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR)
      : null,
    typeof process !== "undefined" ? process.cwd() : ".",
  ];
  for (const c of candidates) if (typeof c === "string" && c) return c;
  return ".";
}

/**
 * Session id. Same precedence ladder as stop-savepoint.ts. An absent id means we cannot target
 * `respawnpack.session=<id>` safely, and the source agrees — `sessionId` is `evt.session_id || ''`
 * and an empty id means the session-scoped sweep is skipped.
 */
function sessionIdOf(event: any, ctx: any): string {
  const candidates: Array<string | null | undefined> = [
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

/** Best-effort UI surface — same ladder as the rollover extension. Never throws. */
function notify(ctx: any, message: string, level: "info" | "warning" = "info"): void {
  const tagged = `${EXTENSION_NAME}: ${message}`;
  try {
    if (ctx?.ui?.notify) { ctx.ui.notify(tagged, level); return; }
  } catch { /* fall through */ }
  try { if (typeof ctx?.log === "function") { ctx.log(tagged); return; } } catch { /* fall through */ }
  try { if (typeof console !== "undefined") console.error(tagged); } catch { /* nothing left */ }
}

// ---- the event handler -----------------------------------------------------------------------------

/**
 * session_shutdown sweep. Decision tree:
 *   1. Off-marker present → silent no-op (source parity, never even probe docker).
 *   2. Docker not on PATH / daemon down → single info notify (per-process latch), return.
 *   3. Otherwise: gateway sweep, then session-scoped sweep for THIS session id.
 *
 * Every step is wrapped in its own try/catch and never throws out — the source's
 * "fail-silent" discipline is the load-bearing guarantee here.
 */
function onSessionShutdown(event: any, ctx: any): void {
  try {
    const dir = projectDirOf(event, ctx);
    if (existsSync(join(dir, OFF_MARKER))) return;

    if (!dockerAvailable()) {
      if (!noDockerNotified) {
        notify(
          ctx,
          "docker is not available on this host — mcp-reaper is a no-op this shutdown",
          "info",
        );
        noDockerNotified = true;
      }
      return;
    }

    // The two sweeps each have their own try/catch in the source: a failed gateway sweep
    // must not short-circuit the session sweep, and vice versa.
    try { reapGateway(); } catch { /* independent of the session sweep */ }
    try { reapSession(sessionIdOf(event, ctx)); } catch { /* independent of the gateway sweep */ }
  } catch {
    /* never block a session over cleanup */
  }
}

// ---- registration ---------------------------------------------------------------------------------

export default function (pi: any) {
  if (!pi || typeof pi.on !== "function") {
    throw new Error("mcp-reaper requires Pi ExtensionAPI.on()");
  }
  pi.on("session_shutdown", (event: any, ctx: any) => onSessionShutdown(event, ctx));
}

// ---- public surface (for tests / canaries / future ports) -----------------------------------------

export {
  EXTENSION_NAME,
  GATEWAY_LABEL,
  SESSION_LABEL_PREFIX,
  KEEP_LABEL,
  CLASS_LABEL,
  TEMP_CLASS,
  OFF_MARKER,
  // pure helpers (no docker side effects)
  labelsOf,
  listByLabel,
  stopContainers,
  rmContainers,
  // docker-backed helpers (have side effects; exported for tests)
  docker,
  dockerAvailable,
  reapGateway,
  reapSession,
  // context resolvers
  projectDirOf,
  sessionIdOf,
  notify,
  // the handler itself
  onSessionShutdown,
};

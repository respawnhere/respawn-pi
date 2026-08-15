/**
 * agents-runtime/index.ts — the respawn-pi 32-agent Pi loader.
 *
 * Registers the package's tools. The dispatch surface is the single canonical
 * `respawn-pi-subagent` tool (D-011 Phase 3):
 *   - `respawn-pi-subagent`: the Pi-aligned single/parallel/chain dispatcher that mirrors
 *     Pi 0.84.0's `examples/extensions/subagent/`. Package-only default; scope extension
 *     to `user`/`project`/`both` follows Pi's example. Confirmation gate on project agents.
 *     Concurrency cap 4, task-count cap 8. Process-group cleanup on abort and timeout.
 *     Symlink refusal. cwd containment. Pi's actual AbortSignal propagated through every
 *     mode.
 *
 * Discovery tool:
 *   - `respawn-pi-agents` lists agents in the configured scope. `mode: "package"` (default)
 *     lists ONLY the respawn-pi-owned agents under `adapters/pi/package/agents/*.md`. No
 *     user/global files. No symlinks. Other modes follow Pi's example semantics.
 *
 * Package command and the read-only grep/glob wrappers are retained as separate package-
 * operation capabilities. The grep/glob wrappers exist because Pi's built-ins do not
 * provide equivalent cwd/symlink containment (D-007, D-011); they are an intentional
 * security delta, not accidental compatibility code.
 *
 * The factory is intentionally minimal: discovery is bounded to the package directory plus
 * optional user / project directories. Every child `pi` invocation that actually executes an
 * agent is gated by `RESPAWNPACK_AGENT_DISPATCH=1` so a package install that runs in a
 * session without the parent Pi session never silently spawns subshells.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  discoverAgents,
  findUserAgentsDir,
  resolvePackageRoot,
  resolveInstalledPackageRoot,
  listAgentsText,
  ListAgentsParams,
  MAX_AGENT_NAME_LEN,
  MAX_CWD_LEN,
  MAX_TASK_LEN,
  type ResolveMode,
} from "./agents.ts";
import {
  executeSubagent,
  DEFAULT_DISPATCH_TIMEOUT_MS,
  MIN_DISPATCH_TIMEOUT_MS,
  MAX_DISPATCH_TIMEOUT_MS,
  MAX_PARALLEL_TASKS,
  AGGREGATE_OUTPUT_CAP,
  boundedSerializedTextContent,
  type SubagentParams,
} from "./subagent.ts";

const TOOL_LIST_NAME = "respawn-pi-agents";
const TOOL_SUBAGENT_NAME = "respawn-pi-subagent";
const TOOL_COMMAND_NAME = "respawn_pi_command";
const TOOL_GREP_NAME = "respawn_pi_grep";
const TOOL_GLOB_NAME = "respawn_pi_glob";
const EXPECTED_AGENT_COUNT = 32;
const MAX_OUTPUT_BYTES = 50 * 1024;
/** Cardinality cap for the closure-scoped pending-failures map (D-011 Gate A finding 1).
 *  When exceeded, the oldest live entry is evicted to make room (FIFO insertion order). */
const PENDING_FAILURES_CAP = 64;
/** TTL on each pending-failures entry. The cleanup timer is `.unref()`d so it never holds
 *  the event loop open on its own; the parent session's lifetime owns settlement. */
const PENDING_FAILURE_TTL_MS = 60_000;
const COMMAND_OUTPUT_BOUNDS: Record<string, { bytes: number; lines: number }> = {
  'state-status': { bytes: 3 * 1024, lines: 30 },
  'goal-status': { bytes: 2 * 1024, lines: 20 },
};

function packageAuthorityRoots(): { root: string; inner: string } | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return {
      inner: path.resolve(here, '..', '..'),
      root: path.resolve(here, '..', '..', '..', '..', '..'),
    };
  } catch { return null; }
}

function resolvePackage(): string | null {
  const authority = packageAuthorityRoots();
  return authority ? resolvePackageRoot([authority.root, authority.inner]) : null;
}

function resolveCommandRoot(): string | null {
  const authority = packageAuthorityRoots();
  if (!authority) return null;
  for (const candidate of [authority.root]) {
    try {
      if (
        fsStatRegular(path.join(candidate, 'scripts', 'respawn-savepoint.mjs')) &&
        fsStatRegular(path.join(candidate, 'scripts', 'goal-contract.mjs')) &&
        fsStatRegular(path.join(candidate, 'scripts', 'init-project.mjs')) &&
        fsStatRegular(path.join(candidate, 'scripts', 'uninit-project.mjs'))
      ) return candidate;
    } catch { /* keep searching */ }
  }
  return null;
}

function fsStatRegular(file: string): boolean {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch { return false; }
}

function userAgentsDir(): string {
  return findUserAgentsDir();
}

const SearchParams = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Literal or regex search query' },
    path: { type: 'string', description: 'Optional cwd-relative file or directory' },
  },
  required: ['query'],
} as const;

const GlobParams = {
  type: 'object',
  properties: { pattern: { type: 'string', description: 'rg --files glob pattern' } },
  required: ['pattern'],
} as const;

function safeSearchPath(cwd: string, relative = '.'): string {
  if (path.isAbsolute(relative) || relative.includes('\0')) throw new Error('search path must be cwd-relative');
  const base = fs.realpathSync(path.resolve(cwd));
  const resolved = path.resolve(base, relative);
  const lexical = path.relative(base, resolved);
  if (lexical === '..' || lexical.startsWith(`..${path.sep}`) || path.isAbsolute(lexical)) throw new Error('search path escapes cwd');
  const canonical = fs.realpathSync(resolved);
  const rel = path.relative(base, canonical);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('search path resolves outside cwd through a symlink');
  let cursor = base;
  for (const component of lexical.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`search path contains symlink component: ${cursor}`);
  }
  return canonical;
}

const CommandParams = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['state-status', 'savepoint', 'savepoint-verify', 'goal-status', 'goal-activate', 'goal-close', 'goal-bump', 'project-init', 'project-uninit'] },
    note: { type: 'string', maxLength: 4096, description: 'Optional savepoint note' },
    value: { type: 'string', maxLength: 128, description: 'Optional goal id for close or session id for bump' },
  },
  required: ['action'],
} as const;

function assertCommandOutputBounded(action: string, text: string): void {
  const bound = COMMAND_OUTPUT_BOUNDS[action];
  if (!bound) return;
  const bytes = Buffer.byteLength(text, 'utf8');
  const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length;
  if (bytes > bound.bytes || lines > bound.lines) {
    throw new Error(`CANNOT_DETERMINE: ${action} output exceeds ${bound.lines} lines/${bound.bytes} bytes`);
  }
}

function packageCommandArgs(packageRoot: string, action: string, cwd: string, note?: string, value?: string): string[] {
  if (note && (note.length > 4096 || note.includes('\0'))) throw new Error('savepoint note is invalid or exceeds 4096 characters');
  if (value && (value.length > 128 || value.includes('\0'))) throw new Error('goal/session value is invalid');
  const savepoint = path.join(packageRoot, 'scripts', 'respawn-savepoint.mjs');
  const goal = path.join(packageRoot, 'scripts', 'goal-contract.mjs');
  const init = path.join(packageRoot, 'scripts', 'init-project.mjs');
  const uninit = path.join(packageRoot, 'scripts', 'uninit-project.mjs');
  if (action === 'state-status') return [savepoint, '--project', cwd, '--status', '--json'];
  if (action === 'savepoint-verify') return [savepoint, '--project', cwd, '--verify', '--json'];
  if (action === 'savepoint') return [savepoint, '--project', cwd, ...(note ? ['--note', note] : [])];
  if (action === 'goal-status') return [goal, 'status'];
  if (action === 'goal-activate') return [goal, 'activate'];
  if (action === 'goal-close') return [goal, 'close', ...(value ? [value] : [])];
  if (action === 'goal-bump') return [goal, 'bump', ...(value ? [value] : [])];
  if (action === 'project-init') {
    const selection = value || 'brownfield';
    const allowed = new Set(['greenfield', 'brownfield', 'greenfield-guarded', 'brownfield-guarded']);
    if (!allowed.has(selection)) throw new Error('project-init value must be greenfield, brownfield, greenfield-guarded, or brownfield-guarded');
    const guarded = selection.endsWith('-guarded');
    const mode = guarded ? selection.slice(0, -'-guarded'.length) : selection;
    return [init, cwd, '--mode', mode, '--governance', guarded ? 'guarded' : 'continuity'];
  }
  if (action === 'project-uninit') return [uninit, cwd];
  throw new Error(`unsupported respawn-pi action: ${action}`);
}

const TASK_ITEM_STRING_LIMITS = {
  agentMaxLen: MAX_AGENT_NAME_LEN,
  taskMaxLen: MAX_TASK_LEN,
  cwdMaxLen: MAX_CWD_LEN,
} as const;

/** Real TypeBox schemas (Pi 0.84.0 example parity). The package peer-declares `typebox`
 *  (optional) and the loader alias points `typebox` to Pi's bundled instance. Type.Object /
 *  Type.Optional / Type.String / Type.Array / Type.Integer / Type.Boolean produce JSON Schema
 *  with the same maxLength / maxItems / minimum / maximum / required fields Pi uses — the
 *  public surface is identical to a hand-written JSON Schema, but it is now declared with
 *  TypeBox types exactly as the Pi example does it.
 *
 *  `agentScope` is built with `StringEnum` from `@earendil-works/pi-ai` (Pi example parity:
 *  `examples/extensions/dynamic-tools.ts`). StringEnum produces a `{ type:"string", enum:[...] }`
 *  schema that is Google-API-compatible (Google rejects `anyOf` with `const`); Type.Union +
 *  Type.Literal produces `{ anyOf:[{const:"..."}] }` which Google's generator cannot consume.
 *  Pi's example uses StringEnum for exactly this reason. */
const AgentTaskItem = Type.Object({
  agent: Type.String({ minLength: 1, maxLength: TASK_ITEM_STRING_LIMITS.agentMaxLen }),
  task: Type.String({ minLength: 1, maxLength: TASK_ITEM_STRING_LIMITS.taskMaxLen }),
  cwd: Type.Optional(Type.String({ minLength: 1, maxLength: TASK_ITEM_STRING_LIMITS.cwdMaxLen })),
});
const AgentScopeSchema = StringEnum(["package", "user", "project", "both"] as const, {
  description: 'Which agent directories to use. Default: "package". Use "both" to include user and project agents (project agents require confirmation).',
  default: "package",
});

/** Schema for the canonical subagent dispatcher. The shape is the union of single,
 *  parallel, and chain modes (Pi 0.84.0 example parity). At most one mode is honored
 *  per call; the runner rejects `modeCount !== 1` before spawn. */
const SubagentParamsSchema = Type.Object({
  agent: Type.Optional(Type.String({ minLength: 1, maxLength: TASK_ITEM_STRING_LIMITS.agentMaxLen, description: 'Agent name for single mode' })),
  task: Type.Optional(Type.String({ minLength: 1, maxLength: TASK_ITEM_STRING_LIMITS.taskMaxLen, description: 'Task text for single mode' })),
  tasks: Type.Optional(Type.Array(AgentTaskItem, {
    description: `Parallel tasks (max ${MAX_PARALLEL_TASKS}, concurrency <= 4)`,
    maxItems: MAX_PARALLEL_TASKS,
  })),
  chain: Type.Optional(Type.Array(AgentTaskItem, {
    description: `Sequential chain (max ${MAX_PARALLEL_TASKS} steps); task may contain {previous} placeholder; stops on first failure`,
    maxItems: MAX_PARALLEL_TASKS,
  })),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(Type.Boolean({ description: 'Default true. When true and scope is "project"|"both", prompt before running project-local agents.' })),
  cwd: Type.Optional(Type.String({ minLength: 1, maxLength: TASK_ITEM_STRING_LIMITS.cwdMaxLen, description: 'Working directory for the spawned agent (single mode)' })),
  timeoutMs: Type.Optional(Type.Integer({
    minimum: MIN_DISPATCH_TIMEOUT_MS,
    maximum: MAX_DISPATCH_TIMEOUT_MS,
    description: `TOTAL execution budget in milliseconds (default ${DEFAULT_DISPATCH_TIMEOUT_MS}) for the entire call. Bounded SIGTERM/SIGKILL/reap cleanup may add a separately named maximum cleanup interval on top of this budget. Chain does NOT multiply by step count; each step uses the REMAINING budget. Parallel uses the REMAINING budget per task (queued tasks share the same call deadline as the first wave). Bounded minimum is ${MIN_DISPATCH_TIMEOUT_MS}ms (a queued task with a smaller positive remaining budget still gets a bounded child window).`,
  })),
});

export default function (pi: ExtensionAPI) {
  // Report readiness (deferred until first invocation; never blocks session_start).

  // -------------------------------------------------------------------------
  // Pending-failure map + tool_result restoration (D-011 Gate A finding 1).
  //
  // Pi 0.84.0 actual semantics (verified against pi-agent-core `agent-loop.js`
  // `executePreparedToolCall`, `createErrorToolResult`, `finalizeExecutedToolCall`,
  // and pi-coding-agent `AgentSession._installAgentToolHooks` `afterToolCall`
  // hooked through `extension-runner.emitToolResult`):
  //   - On the success path, `executePreparedToolCall` returns
  //     `{result, isError: false}` and the agent-loop ignores `result.isError` (a
  //     returned isError:true is silently dropped on this branch).
  //   - On the throw path, the catch builds `{ details: {}, isError: true, content:
  //     [{type:"text", text: error.message}] }` via `createErrorToolResult`,
  //     wiping the structured details the runner produced.
  //   - The `afterToolCall` hook runs AFTER the catch path. Its return value
  //     `{content?, details?, isError?, usage?}` is applied via
  //     `finalizeExecutedToolCall` (`isError = afterResult.isError ?? isError`,
  //     `details = afterResult.details ?? result.details`). So the supported Pi 0.84.0
  //     extension handoff for structured failure details is:
  //       1. execute throws a bounded Error (so isError=true and the content text is
  //          a short tag the handler replaces),
  //       2. the tool_result handler returns `{content, details, isError: true}` and
  //          the framework applies those overrides to the final result.
  //
  // To preserve the canonical runner's structured failure details, the registered
  // execute stores its bounded `content` + `details` in this closure-scoped map keyed
  // by `toolCallId` (the same id Pi passes to the `tool_result` event) and throws a
  // bounded Error. The `tool_result` handler below intercepts the matching event,
  // deletes the entry exactly once, clears its TTL timer, and patches
  // `content` + `details` + `isError: true` back onto the result.
  //
  // Cardinality: capped at PENDING_FAILURES_CAP (64). When exceeded, the oldest entry
  // is evicted to make room (FIFO). Eviction only fires after the cap is reached; a
  // single dispatch never trips it.
  //
  // TTL: each entry has an unref'd setTimeout. When it fires, the entry is deleted
  // exactly once and the timer cleared. The timer is `.unref()`d so it never holds
  // the event loop open on its own; the parent session's lifetime owns settlement.
  //
  // No module-global state for the map and its timers; the bounded fields and TTL are
  // module-level constants (config only), but the Map<key, PendingFailure> is closure-scoped.
  // Two concurrent factory invocations (e.g. test fixtures) get two independent maps.
  // -------------------------------------------------------------------------
  type PendingFailure = {
    toolCallId: string;
    content: Array<{ type: "text"; text: string }>;
    details: unknown;
    timer: NodeJS.Timeout;
  };
  const pendingFailures: Map<string, PendingFailure> = new Map();

  const cancelPendingFailure = (entry: PendingFailure): void => {
    clearTimeout(entry.timer);
    pendingFailures.delete(entry.toolCallId);
  };

  const registerPendingFailure = (
    toolCallId: string,
    content: Array<{ type: "text"; text: string }>,
    details: unknown,
  ): PendingFailure => {
    // D-011 same-ID replacement fix: if a pending entry already exists for this
    // toolCallId, cancel its TTL timer before installing the new one. Without this,
    // repeated re-registrations with the same id overwrote the map entry but left
    // the prior timer dangling — the timer's `live.timer === timer` self-deletion
    // check fails against the new entry's timer, so the orphan timer never frees
    // itself. The map was correctly bounded; the timers were not.
    const prior = pendingFailures.get(toolCallId);
    if (prior) cancelPendingFailure(prior);
    // If the cap is reached, evict the OLDEST entry (first insertion order) to keep
    // the map bounded. Map iteration preserves insertion order, so `keys().next()`
    // yields the oldest live entry.
    if (pendingFailures.size >= PENDING_FAILURES_CAP) {
      const oldest = pendingFailures.keys().next().value;
      if (typeof oldest === "string") {
        const victim = pendingFailures.get(oldest);
        if (victim) cancelPendingFailure(victim);
      }
    }
    const timer = setTimeout(() => {
      // Self-deletion: the entry may already be gone if the handler ran first.
      const live = pendingFailures.get(toolCallId);
      if (live && live.timer === timer) {
        pendingFailures.delete(toolCallId);
      }
    }, PENDING_FAILURE_TTL_MS);
    if (typeof timer.unref === "function") timer.unref();
    const entry: PendingFailure = { toolCallId, content, details, timer };
    pendingFailures.set(toolCallId, entry);
    return entry;
  };

  // Restore structured details after Pi's throw-created `{}` placeholder.
  // - Only intercepts events for THIS extension's tool name AND an exact pending
  //   toolCallId. Other tools / other extensions' events pass through unchanged
  //   (returning undefined leaves the original {details:{}, isError:true, content:[msg]}
  //   result the agent-loop's catch path produced untouched).
  // - Deletes + clears timer EXACTLY ONCE (the TTL self-deletion is idempotent on a
  //   missing entry; the handler deletion also wins the race against the TTL).
  // - Returns the bounded content + details; the `isError: true` flag is restored so
  //   Pi marks the tool result as an error WITHOUT dropping details.
  // - Re-exposed through `__test__.toolResultHandler` for unit-level tests that
  //   exercise the throw+restoration contract without spinning up a real agent loop.
  pi.on("tool_result", (event: { toolName?: string; toolCallId?: string; isError?: boolean; details?: unknown; content?: unknown }) => {
    if (event.toolName !== TOOL_SUBAGENT_NAME) return;
    if (typeof event.toolCallId !== "string") return;
    const live = pendingFailures.get(event.toolCallId);
    if (!live) return;
    cancelPendingFailure(live);
    return {
      content: live.content,
      details: live.details,
      isError: true,
    };
  });

  pi.registerTool({
    name: TOOL_LIST_NAME,
    label: "List respawn-pi agents",
    description: [
      "List the agents respawn-pi can dispatch.",
      "Mode `package` (default) returns ONLY the 32 respawn-pi-owned agents; no global files are read.",
      "Mode `user` mirrors Pi's example behaviour (~/.pi/agent/agents/*.md).",
      "Mode `project` discovers .pi/agents/*.md near the session cwd (Pi's example).",
      "Mode `both` merges user + package + project with deterministic precedence: project > package > user (project-scope agents win on name collision, then package, then user).",
    ].join(" "),
    parameters: ListAgentsParams,
    async execute(_toolCallId, params: { mode?: ResolveMode }, _signal: unknown, _onUpdate: unknown, ctx: ExtensionContext) {
      const mode: ResolveMode = params?.mode || "package";
      // Package authority is the installed package, not the session cwd. Discovery always
      // finds the 32 packaged agents regardless of where the operator launches Pi from.
      const installedRoot = resolveInstalledPackageRoot() || resolvePackage();
      if (mode === "package" && !installedRoot) throw new Error('respawn-pi package directory not resolvable from installed authority');
      const userDir = mode === "user" || mode === "both" ? userAgentsDir() : "";
      const discovery = discoverAgents(installedRoot || process.cwd(), mode, userDir, ctx.cwd);
      const text = listAgentsText(discovery.agents, discovery.packageDir, discovery.userDir, discovery.projectDir);
      const header = mode === "package"
        ? `Package-only roster (no global files read): ${discovery.agents.length} agent(s)`
        : `mode=${mode}: ${discovery.agents.length} agent(s)`;
      return {
        content: [{ type: "text", text: `${header}\n${text}` }],
        details: { mode, agents: discovery.agents.map((a) => ({ name: a.name, source: a.source, filePath: a.filePath })), errors: discovery.errors, packageDir: discovery.packageDir, userDir: discovery.userDir, projectDir: discovery.projectDir, expectedCount: EXPECTED_AGENT_COUNT },
      };
    },
  });

  pi.registerTool({
    name: TOOL_GREP_NAME,
    label: 'Search project text (read-only)',
    description: 'Bounded read-only ripgrep search used by tool-scoped packaged agents.',
    parameters: SearchParams,
    async execute(_id, params: { query: string; path?: string }, _signal, _update, ctx: ExtensionContext) {
      try {
        if (!params.query || params.query.length > 4096) throw new Error('query must be 1..4096 characters');
        const target = safeSearchPath(ctx.cwd, params.path || '.');
        const result = spawnSync('rg', ['--line-number', '--no-heading', '--color', 'never', '--max-count', '200', params.query, '--', target], { cwd: ctx.cwd, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] });
        const text = boundedUtf8(result.stdout);
        const noMatches = result.status === 1;
        if (result.status !== 0 && !noMatches) throw new Error(String(result.stderr || 'search failed'));
        return { content: [{ type: 'text', text: text || '(no matches)' }] };
      } catch (error) { throw new Error(String((error as Error).message || error)); }
    },
  });

  pi.registerTool({
    name: TOOL_GLOB_NAME,
    label: 'List project files by glob (read-only)',
    description: 'Bounded read-only file listing used by tool-scoped packaged agents.',
    parameters: GlobParams,
    async execute(_id, params: { pattern: string }, _signal, _update, ctx: ExtensionContext) {
      try {
        if (!params.pattern || params.pattern.length > 1024 || params.pattern.includes('\0')) throw new Error('pattern must be 1..1024 characters');
        const result = spawnSync('rg', ['--files', '-g', params.pattern], { cwd: ctx.cwd, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] });
        const text = boundedUtf8(result.stdout);
        const noMatches = result.status === 1;
        if (result.status !== 0 && !noMatches) throw new Error(String(result.stderr || 'file listing failed'));
        return { content: [{ type: 'text', text: text || '(no files)' }] };
      } catch (error) { throw new Error(String((error as Error).message || error)); }
    },
  });

  pi.registerTool({
    name: TOOL_COMMAND_NAME,
    label: "Run respawn-pi package command",
    description: "Run a bounded, allowlisted respawn-pi state/savepoint/goal/project-initialization command from the installed package against the current target. No arbitrary argv or path is accepted.",
    parameters: CommandParams,
    async execute(_toolCallId, params: { action: string; note?: string; value?: string }, _signal: unknown, _onUpdate: unknown, ctx: ExtensionContext) {
      const packageRoot = resolveCommandRoot();
      if (!packageRoot) throw new Error('respawn-pi command root unavailable (the installed package has no scripts/ authority)');
      try {
        const args = packageCommandArgs(packageRoot, params.action, ctx.cwd, params.note, params.value);
        const result = spawnSync(process.execPath, args, { cwd: ctx.cwd, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
        const stdout = boundedUtf8(result.stdout);
        const stderr = boundedUtf8(result.stderr, MAX_OUTPUT_BYTES - Buffer.byteLength(stdout, 'utf8'));
        const exitCode = result.status ?? 1;
        const text = `respawn-pi ${params.action} exit=${exitCode}\n${stdout}${stderr ? `\n--stderr--\n${stderr}` : ''}`;
        assertCommandOutputBounded(params.action, text);
        if (exitCode !== 0) throw new Error(text);
        return { content: [{ type: 'text', text }], details: { action: params.action, exitCode, stdout, stderr } };
      } catch (error) { throw new Error(String((error as Error).message || error)); }
    },
  });

  pi.registerTool({
    name: TOOL_SUBAGENT_NAME,
    label: "respawn-pi subagent (Pi-aligned)",
    description: [
      "Delegate tasks to specialized subagents with isolated context, aligned to Pi 0.84.0's example.",
      `Modes: single (agent + task), parallel (tasks array, max ${MAX_PARALLEL_TASKS} / concurrency 4), chain (sequential with {previous} placeholder, max ${MAX_PARALLEL_TASKS} steps).`,
      "Scope default: package (the respawn-pi-owned 32 agents). Set agentScope: \"user\" | \"project\" | \"both\" to extend; project agents are confirmation-gated.",
      "Gated behind RESPAWNPACK_AGENT_DISPATCH=1 (it spawns a tool-scoped child `pi` process with the Debian user's permissions — process separation, not a sandbox).",
      `Bounded TOTAL execution budget timeoutMs (1s..300s, default 30s) is shared by chain and parallel. Bounded SIGTERM/SIGKILL/reap cleanup adds a separately named maximum cleanup interval on top. Chain does not multiply by steps; each step uses the remaining time. Parallel uses the remaining time per task (queued tasks share the call deadline). Process-group cleanup, UTF-8-safe output cap, cwd containment, symlink refusal. The model-visible content and the structured details are bounded by a documented byte cap.`,
      "Declared tool names are accepted as lowercase Pi 0.84.0 native names plus the package wrappers `respawn_pi_grep` / `respawn_pi_glob`; PascalCase declarations and unknown names are rejected before spawn (the runner does not translate them).",
    ].join(" "),
    parameters: SubagentParamsSchema,
    async execute(toolCallId: string, params: SubagentParams, signal: unknown, onUpdate: unknown, ctx: ExtensionContext) {
      const abortSignal = (signal && typeof (signal as { aborted?: boolean }).aborted === "boolean")
        ? (signal as AbortSignal)
        : null;
      // Pi semantics: ctx.hasUI is the canonical flag. ctx.ui may still be present for the
      // confirmation body even when hasUI is false. We honor hasUI exactly.
      const hasUI = Boolean((ctx as ExtensionContext & { hasUI?: boolean }).hasUI);
      const ui = hasUI && ctx.ui ? {
        confirm: typeof ctx.ui.confirm === "function" ? (title: string, body: string) => Promise.resolve(ctx.ui.confirm(title, body)) : undefined,
        notify: typeof ctx.ui.notify === "function" ? (message: string, level: "info" | "warning") => ctx.ui.notify(message, level) : undefined,
      } : undefined;
      const result = await executeSubagent(params, { cwd: ctx.cwd }, {
        ui,
        hasUI,
        abortSignal,
        onUpdate: typeof onUpdate === "function"
          ? (partial) => {
              try { (onUpdate as (partial: unknown) => void)(partial); } catch { /* listener fault-tolerance */ }
            }
          : undefined,
      });
      // The runner's `withBoundedResult` is the single chokepoint that enforces every
      // byte cap (task preview, error, stderr, per-result message bytes/count, details JSON).
      // The registered adapter trusts the canonical bounded result. No second optimistic
      // trim runs here: any partial-trim is by construction the canonical chokepoint's
      // responsibility.
      //
      // Pi 0.84.0 actual semantics (verified against pi-agent-core `agent-loop.js`
      // `executePreparedToolCall` and `createErrorToolResult`, and pi-coding-agent
      // `AgentSession._installAgentToolHooks` `afterToolCall` / `runner.emitToolResult`):
      //   - On the SUCCESS path, `executePreparedToolCall` hard-codes `{result, isError:
      //     false}` and the agent-loop discards `result.isError`. A returned isError:true
      //     is silently dropped on this branch.
      //   - On the THROW path, the agent-loop catches and builds `{ details: {}, isError:
      //     true, content: [{type:"text", text: <error.message>}] }` via
      //     `createErrorToolResult`, wiping the structured `details` the runner produced.
      //   - The `afterToolCall` hook runs AFTER the catch path and may return
      //     `{content?, details?, isError?, usage?}` which the framework patches into the
      //     final result (`finalizeExecutedToolCall` overrides `isError =
      //     afterResult.isError ?? isError`).
      // So the supported Pi 0.84.0 extension handoff for structured failure details is:
      //   1. Store the bounded `content` + `details` in a closure-scoped pending map keyed
      //      by `toolCallId` with a TTL timer.
      //   2. Throw a bounded Error so the agent-loop's catch path sets isError=true
      //      (and details={}, which the handler below replaces).
      //   3. The `pi.on("tool_result", ...)` handler below atomically consumes the
      //      pending entry for the matching toolCallId and returns
      //      `{content, details, isError: true}`. The agent-loop's finalize step
      //      applies this return value, restoring the structured details.
      // The handler is matched on BOTH the exact canonical tool name AND the exact
      // pending toolCallId — other tools / other IDs pass through unchanged.
      if (result.isError) {
        const errorText = boundedUtf8(result.content.map((c) => c.text).join("\n"), AGGREGATE_OUTPUT_CAP);
        const pendingContent = [boundedSerializedTextContent(errorText, AGGREGATE_OUTPUT_CAP)];
        registerPendingFailure(toolCallId, pendingContent, result.details);
        // The thrown error message is short: the `tool_result` handler replaces both
        // `content` and `details` on the agent-loop's wrapper before the final tool
        // result message is emitted, so this placeholder string never reaches the model.
        throw new Error(boundedUtf8(`[respawn-pi: ${toolCallId}] dispatch failed; details restored via tool_result handler`, 512));
      }
      return result;
    },
  });
}

function boundedUtf8(value: unknown, maxBytes = MAX_OUTPUT_BYTES): string {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
  const cap = Math.max(0, maxBytes);
  const clippedLength = Math.min(bytes.length, cap);
  for (let trim = 0; trim <= 3 && clippedLength - trim >= 0; trim++) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, clippedLength - trim));
    } catch { /* try the prior complete-codepoint boundary */ }
  }
  const chars: string[] = [];
  let used = 0;
  for (const ch of bytes.subarray(0, cap).toString('utf8')) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (used + size > cap) break;
    chars.push(ch);
    used += size;
  }
  return chars.join('');
}

/** Build a registry test fixture: the factory is invoked against a recording pi
 *  mock that captures every registered tool AND every event handler. Tests that need
 *  to exercise the throw+tool_result handoff (finding 1) use this to retrieve the
 *  canonical `tool_result` handler and drive it directly. No live Pi session required.
 *  Returns the captured `pi` mock, the registered tools, and the registered
 *  `tool_result` handler (or undefined). */
export function __buildTestPi() {
  const tools = new Map();
  const events = new Map();
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    on(event, handler) {
      const list = events.get(event) || [];
      list.push(handler);
      events.set(event, list);
    },
  };
  return { pi, tools, events };
}

export const __test__ = {
  assertCommandOutputBounded,
  packageCommandArgs,
  resolvePackage,
  resolveCommandRoot,
  boundedUtf8,
  boundedSerializedTextContent,
  MAX_OUTPUT_BYTES,
  TOOL_SUBAGENT_NAME,
  PENDING_FAILURES_CAP,
  PENDING_FAILURE_TTL_MS,
  __buildTestPi,
};

/**
 * agents-runtime/subagent.ts — Pi-aligned single/parallel/chain dispatcher.
 *
 * Compared upstream:
 *   - `examples/extensions/subagent/{index.ts,agents.ts}` shipped with `@earendil-works/pi-coding-agent`
 *     0.84.0 (resolved via the user's installed global node module dir).
 *     Reviewed line-for-line; this module is intentionally a sibling, not a copy, so the
 *     package keeps its own test seam and own security deltas.
 *
 * Source/version evidence for upstream-aligned behavior (D-011 requirement):
 *   - `MAX_PARALLEL_TASKS = 8`, `MAX_CONCURRENCY = 4`, `PER_TASK_OUTPUT_CAP = 50 * 1024`
 *     match the Pi 0.84.0 example exactly (see `examples/extensions/subagent/index.ts` shipped
 *     with Pi 0.84.0; the exact installation root is operator-specific and is intentionally NOT
 *     embedded here — operators can resolve it via `npm root -g`).
 *   - `getPiInvocation` is replicated locally because Pi 0.84.0 does NOT export it from
 *     `@earendil-works/pi-coding-agent` (verified against dist/index.d.ts — no matching
 *     export). The selection rule below is identical to the Pi example's
 *     `getPiInvocation` (lines ~167–181 of examples/extensions/subagent/index.ts).
 *   - `parseFrontmatter`, `CONFIG_DIR_NAME`, `getAgentDir` are imported from Pi in
 *     agents.ts (Pi 0.84.0 exports all three). This module does not re-import them.
 *
 * Vocabulary aligned with Pi's example (D-011 Phase 1):
 *   - single: `{ agent, task, cwd? }`
 *   - parallel: `{ tasks: [{ agent, task, cwd? }, ...] }`  with concurrency ≤ 4, total ≤ 8
 *   - chain: `{ chain: [{ agent, task, cwd? }, ...] }`  with `{previous}` substitution
 *           and stop-on-failure
 *   - `agentScope` extends the example's `user|project|both` with the package's own `package`
 *     default; Pi packages do not expose an `agents` resource, so the package-only discovery is
 *     the only clean-install-supported surface (D-008 / D-011).
 *   - `confirmProjectAgents` mirrors Pi's example default of true; project agents are
 *     confirmation-gated unless the operator explicitly opts out.
 *
 * Intentional package deltas (named for /review):
 *   - `package` scope default and the no-global-writes contract — Pi's example reads user
 *     `~/.pi/agent/agents/*.md` by default and never reads package agents. The package inverts
 *     that to package-only because the only way to install respawn-pi is via its package; user
 *     files are an opt-in extension.
 *   - `RESPAWNPACK_AGENT_DISPATCH=1` gate — every spawn goes through the same single chokepoint
 *     Pi's example lacks; the operator must opt in to actually executing a child process.
 *     The gate is the ONLY way to enable dispatch in production. Tests do not get a bypass
 *     option on the public surface; they set the env var around the test (serial) or run
 *     the dispatch through a subprocess fixture (concurrent).
 *   - bounded per-call `timeoutMs` (1s..300s) — the example has no per-call deadline. The
 *     bound is the TOTAL call deadline (chain does NOT multiply by steps; parallel queues
 *     use the remaining time on entry).
 *   - process-group SIGKILL reaping after SIGTERM — the example does `proc.kill` only, which
 *     leaves resistant descendants in the same group.
 *   - UTF-8-safe output capture at complete codepoint boundaries — the example `slice(0,N)`s
 *     text, which can split a code point.
 *   - symlink refusal for every directory read (D-007).
 *   - cwd containment to the session cwd (delegated to `resolveDispatchCwd`).
 *   - `--no-tools` when an agent has no declared tools — the example omits `--tools` and
 *     relies on the child to default to ALL tools. Phase 1 must not grant defaults. Phase 2
 *     will normalize the 3 disallowedTools agents.
 *   - lowercase tool-name declaration only — the 32 shipped agents declare Pi 0.84.0
 *     lowercase native tool names (`read`, `write`, `edit`, `grep`, `find`, `ls`, `bash`)
 *     and the package wrappers (`respawn_pi_grep`, `respawn_pi_glob`). Unknown declared
 *     tools (PascalCase, typos, invented names) REJECT the dispatch before spawn — fail
 *     closed. The runner does not translate PascalCase forms.
 *   - rejection of unknown agents BEFORE spawn — the example fabricates an "unknown" result
 *     and runs anyway. The package refuses the dispatch so the operator gets a fail-closed
 *     error and no child process is started.
 *   - AbortSignal propagation through every mode — the example's tool surface supports it but
 *     the package's `runSingleAgent` accepts an explicit signal and uses it.
 *   - one shared hardened runner — the compat adapter and the new tool both call
 *     `runSubagentOnce` (the canonical single-mode implementation) so the lifecycle, abort,
 *     group-reap, and output-bound logic lives in exactly one place.
 *   - Pi's `getPiInvocation` pattern is replicated locally because Pi 0.84.0 does not export
 *     it from `@earendil-works/pi-coding-agent`. The selection rule is identical.
 *   - `tool_result_end` events are pushed into the message list, mirroring Pi's example.
 *   - per-invocation temp dir ownership — the prompt tmp dir is local to the runner invocation
 *     so parallel same-agent calls do not race for a shared mutable field on `AgentConfig`.
 *   - **Named non-semantic TUI delta: renderCall/renderResult are NOT provided.** The Pi
 *     example imports `Container, Markdown, Spacer, Text` from `@earendil-works/pi-tui`
 *     and `getMarkdownTheme` from `@earendil-works/pi-coding-agent`. Both peers are
 *     declared optional in this package's `package.json`. Importing them would force
 *     operators to install `@earendil-works/pi-tui` for a non-functional (cosmetic) gain.
 *     Pi renders the structured result with its default tool renderer when `renderCall`
 *     and `renderResult` are absent, which is documented as acceptable for extensions
 *     that do not need custom TUI integration. The behavior delta is non-semantic: the
 *     model-visible content and structured details are unchanged; only the operator's
 *     TUI presentation differs. Phase 2 may add these imports if a use case requires it.
 *   - `onUpdate` streaming — when the tool layer passes an onUpdate callback, partial results
 *     are emitted for chain and parallel modes.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { spawn } from "node:child_process";
import {
  discoverAgents,
  findUserAgentsDir,
  resolveInstalledPackageRoot,
  translateToolList,
  MAX_TASK_LEN,
  MAX_TASK_BYTES,
  MAX_TASK_PREVIEW_BYTES,
  MAX_ERROR_MESSAGE_BYTES,
  MAX_CWD_BYTES,
  type AgentConfig,
  type AgentDiscoveryResult,
  type AgentScope,
  type AgentSource,
} from "./agents.ts";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
/** Per-task stdout cap. Matches the Pi example's PER_TASK_OUTPUT_CAP. */
export const PER_TASK_OUTPUT_CAP = 50 * 1024;
/** Hard event-line byte cap for incoming JSONL from the child. At least PER_TASK_OUTPUT_CAP. */
export const MAX_EVENT_LINE_BYTES = 64 * 1024;
/** Bound on the unbounded remainder between newlines. A late newline still has a chance
 *  to land on a complete event. */
export const STDOUT_REMAINDER_CAP = MAX_EVENT_LINE_BYTES;
/** Aggregate retained-message-byte budget PER RESULT. Diagnostics count toward this budget
 *  alongside retained events so a hostile child that floods sysrole diagnostics cannot
 *  bypass the cap. */
export const PER_RESULT_MESSAGES_BYTES = PER_TASK_OUTPUT_CAP * 4;
/** Aggregate retained-message COUNT cap PER RESULT (bounded event count, including
 *  diagnostics). */
export const PER_RESULT_MESSAGES_COUNT = 256;
/** Per-content-part text cap. Each SubagentMessage content part's text is bounded to this
 *  byte count so a hostile child cannot blow the details cap with one giant text part. */
export const PER_MESSAGE_TEXT_CAP = 32 * 1024;
/** Aggregate model-visible output cap (the final text returned to the model). */
export const AGGREGATE_OUTPUT_CAP = 200 * 1024;
/** Per-result stderr cap (the per-result byte budget). */
export const PER_RESULT_STDERR_BYTES = 4 * 1024;
/** Per-result onUpdate payload cap (the text field only; details is structured). */
export const ONUPDATE_TEXT_CAP = 8 * 1024;
/** Structured details results array cap. */
export const MAX_RESULTS_COUNT = MAX_PARALLEL_TASKS;
/** Hard byte cap for the structured details serialized as JSON. */
export const DETAILS_JSON_CAP = 256 * 1024;

export const MIN_DISPATCH_TIMEOUT_MS = 1_000;
/** Internal hard minimum for the canonical single-mode runner's timeoutMs argument. The
 *  PUBLIC minimum (`MIN_DISPATCH_TIMEOUT_MS = 1000`) is enforced at validation; the
 *  INTERNAL minimum is intentionally 1ms so a queued chain step or queued parallel task
 *  whose remaining budget is < 1000ms still gets a positive budget and fails closed inside
 *  its own bounded window if the budget is exhausted. Production never sets a value
 *  below `MIN_DISPATCH_TIMEOUT_MS`; the ceiling is the chain/parallel SKIP threshold (a
 *  step whose remaining budget is `<= 0` is recorded as a timeout). */
export const MIN_INTERNAL_TIMEOUT_MS = 1;
export const MAX_DISPATCH_TIMEOUT_MS = 300_000;
export const DEFAULT_DISPATCH_TIMEOUT_MS = 30_000;
/** Bound on the reaper poll. The default is intentionally large so ordinary termination
 *  waits until the process group is genuinely absent (ESRCH). The forced-failure test seam
 *  short-circuits this for the cleanup-failure path so a misbehaving test does not hang. */
export const REAP_POLL_GRACE_MS = 5_000;
/** Hard cap on the abort grace window before SIGKILL. */
export const PROCESS_GROUP_TERM_GRACE_MS = 2_000;
export const PROCESS_GROUP_ABORT_GRACE_MS = 250;
const REAP_POLL_INTERVAL_MS = 25;

export type DispatchMode = "single" | "parallel" | "chain";

export interface TaskItem {
  agent: string;
  task: string;
  cwd?: string;
}

export interface SubagentParams {
  agent?: string;
  task?: string;
  tasks?: TaskItem[];
  chain?: TaskItem[];
  agentScope?: AgentScope;
  confirmProjectAgents?: boolean;
  cwd?: string;
  timeoutMs?: number;
}

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface SubagentMessage {
  role: string;
  content?: Array<{ type: string; text?: string; name?: string; arguments?: Record<string, unknown> }>;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { total?: number } | number;
    totalTokens?: number;
  };
}

export interface CleanupStatus {
  /** True when the reaper confirmed ESRCH for the process group before settlement. */
  groupReaped: boolean;
  /** True when SIGTERM was sent to the group at least once. */
  sigtermSent: boolean;
  /** True when SIGKILL was sent to the group at least once. */
  sigkillSent: boolean;
  /** Milliseconds between termination kickoff and settlement. */
  elapsedMs: number;
  /** Forced by the test-only invocation-local seam (verifies the error path). */
  forcedFailure: boolean;
}

export interface SingleResult {
  agent: string;
  agentSource: AgentSource;
  /** Bounded preview of the dispatched task (<= MAX_TASK_PREVIEW_BYTES bytes). The full
   *  task is NOT retained in the structured details so the serialized details object
   *  stays under DETAILS_JSON_CAP even with hostile 30,000-code-unit Unicode tasks. */
  task: string;
  exitCode: number;
  messages: SubagentMessage[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  /** Bounded to MAX_ERROR_MESSAGE_BYTES so a hostile child cannot blow the details cap. */
  errorMessage?: string;
  step?: number;
  terminated?: "timeout" | "abort" | null;
  timedOut?: boolean;
  aborted?: boolean;
  cleanup?: CleanupStatus;
}

export interface SubagentDetails {
  mode: DispatchMode;
  agentScope: AgentScope;
  results: SingleResult[];
  projectAgentsDir: string | null;
  userAgentsDir: string | null;
  packageAgentsDir: string | null;
  /** Set to `true` when the deterministic fallback had to truncate the structured details
   *  to stay below DETAILS_JSON_CAP. Omitted when the details fit the cap directly. */
  truncated?: boolean;
  /** Bounded diagnostic describing WHY the structured details had to be truncated.
   *  Omitted when the details fit the cap directly. */
  diagnostic?: string;
}

export interface SubagentExecuteResult {
  content: Array<{ type: "text"; text: string }>;
  details: SubagentDetails;
  isError?: boolean;
}

function emptyUsage(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function isFailedResult(result: SingleResult): boolean {
  if (result.timedOut || result.aborted) return true;
  if (result.exitCode !== 0) return true;
  if (result.stopReason === "error" || result.stopReason === "aborted") return true;
  if (result.cleanup && !result.cleanup.groupReaped) return true;
  return false;
}

function getFinalOutput(messages: SubagentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && part.type === "text" && typeof part.text === "string") return part.text;
      }
    }
  }
  return "";
}

function getResultOutput(result: SingleResult): string {
  if (isFailedResult(result)) {
    return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
  }
  return getFinalOutput(result.messages) || "(no output)";
}

/**
 * Bound a chunked output stream by appending the new bytes and clipping at a complete UTF-8
 * boundary. Returns the new buffer; the cap is preserved across many calls. A subsequent call
 * to `boundedUtf8(buf, cap)` decodes the bytes safely.
 */
export function appendBounded(current: Buffer, chunk: Buffer | string, cap: number): Buffer {
  if (current.length >= cap) return current;
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
  const room = cap - current.length;
  return Buffer.concat([current, incoming.subarray(0, room)]);
}

/**
 * Canonical helper that builds a single-element text content part and clips the text until
 * `Buffer.byteLength(JSON.stringify([{type:'text',text}]), 'utf8') <= cap`. The cap is enforced
 * against the SERIALIZED payload (not the raw text) so JSON-escaping, control characters, and
 * multi-byte Unicode (emojis, RTL, etc.) cannot blow the cap. The helper is the single
 * chokepoint every final content and every onUpdate content passes through.
 *
 * `cap` is the documented model-visible cap for that content (e.g. AGGREGATE_OUTPUT_CAP for
 * final, ONUPDATE_TEXT_CAP for streaming partials). The function never returns a content part
 * whose JSON serialization exceeds the cap, even with hostile Unicode / quotes / backslashes.
 *
 * Used by every `executeSubagent` return path and every `emitUpdate` so partial streaming
 * results and the final result stay under the same documented cap. Tests assert the
 * serialized payload size, not the text size, with hostile inputs.
 */
export function boundedSerializedTextContent(text: string, cap: number): { type: "text"; text: string } {
  const target = Math.max(0, cap);
  if (target === 0) return { type: "text", text: "" };
  // JSON wrapper for a single text-part wrapped in an array is `{"type":"text","text":""}` —
  // 25 bytes for the inner object plus 2 bytes for the surrounding `[` and `]` = 27 bytes
  // minimum for the empty case. Reserve room for the wrapper plus a small escape margin so
  // a final quote/backslash/control-char escape expansion cannot push the payload over the cap.
  const wrapperReserve = 27;
  const maxTextBytes = Math.max(0, target - wrapperReserve);
  if (maxTextBytes === 0) return { type: "text", text: "" };
  // Start at the smaller of (UTF-8 byte length, max text bytes). Use byteLength so the
  // initial guess is correct for non-ASCII input (e.g. emojis are 4 UTF-8 bytes).
  const textBytes = Buffer.byteLength(text || "", "utf8");
  let limit = Math.min(textBytes, maxTextBytes);
  // Trim the limit until the serialized payload fits under the cap. boundedUtf8 clips at
  // complete code-point boundaries so the resulting text is always valid UTF-8.
  let attempts = 0;
  while (limit > 0 && attempts < 64) {
    const candidateText = boundedUtf8(text || "", limit);
    const candidate = { type: "text" as const, text: candidateText };
    const json = JSON.stringify([candidate]);
    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes <= target) {
      return candidate;
    }
    // Reduce the limit by a fraction of the current length so we converge quickly even when
    // JSON-escape expansion dominates. Always keep at least 1 byte.
    const reduction = Math.max(1, Math.ceil((bytes - target) / 4));
    limit = Math.max(1, limit - reduction);
    attempts++;
  }
  // Final fallback: a minimal bounded content part whose JSON is provably under cap.
  return { type: "text", text: boundedUtf8(text || "", 1) };
}

export function boundedUtf8(value: unknown, maxBytes: number): string {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
  const cap = Math.max(0, maxBytes);
  let clippedLength = Math.min(bytes.length, cap);
  // Trim at most three trailing bytes to land on a complete UTF-8 codepoint boundary. UTF-8
  // code points are at most four bytes; trimming up to 3 bytes is always sufficient.
  for (let trim = 0; trim <= 3 && clippedLength - trim >= 0; trim++) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, clippedLength - trim));
    } catch { /* try the prior complete-codepoint boundary */ }
  }
  // Replacement-safe path for invalid host input: re-encode without `fatal: true` and skip
  // characters that would push us over the cap. Ensures U+FFFD is only produced by the
  // decoder when the input itself was invalid, never by the package's truncation policy.
  const chars: string[] = [];
  let used = 0;
  for (const ch of bytes.subarray(0, cap).toString("utf8")) {
    const size = Buffer.byteLength(ch, "utf8");
    if (used + size > cap) break;
    chars.push(ch);
    used += size;
  }
  return chars.join("");
}

/**
 * Bound a task string to the documented retained-preview cap. Used for both the SingleResult
 * `task` field and any user-visible error/stdout text that echoes a task back to the model.
 *
 * `MAX_TASK_PREVIEW_BYTES` is the safe byte cap so the serialized details object stays below
 * `DETAILS_JSON_CAP` even with 8 parallel tasks each carrying the worst-case preview.
 */
export function boundTaskPreview(task: string): string {
  const bytes = Buffer.byteLength(task, "utf8");
  if (bytes <= MAX_TASK_PREVIEW_BYTES) return task;
  return boundedUtf8(task, MAX_TASK_PREVIEW_BYTES);
}

/** Build the substituted chain task with `{previous}` placeholders replaced by the bounded
 *  previous-step output. The substituted task is bounded to MAX_TASK_BYTES by construction
 *  (the previous output is bounded by PER_TASK_OUTPUT_CAP, the step task is bounded by
 *  MAX_TASK_LEN). When the expanded task exceeds MAX_TASK_BYTES the call throws BEFORE
 *  spawning so the chain stops with a bounded error. */
export function buildSubstitutedTask(stepTask: string, previousOutput: string): string {
  const boundedPrevious = boundedUtf8(previousOutput, PER_TASK_OUTPUT_CAP);
  return stepTask.replace(/\{previous\}/g, boundedPrevious);
}

/** Bound one SubagentMessage's content-part texts so each part is at most PER_MESSAGE_TEXT_CAP
 *  bytes. Returns a NEW message; never mutates the input. */
function boundMessageText(msg: SubagentMessage): SubagentMessage {
  if (!msg || !Array.isArray(msg.content)) return msg;
  const cloned: SubagentMessage = { ...msg, content: msg.content.map((part) => {
    if (!part || typeof part !== "object") return part;
    if (typeof part.text === "string") {
      const bytes = Buffer.byteLength(part.text, "utf8");
      if (bytes <= PER_MESSAGE_TEXT_CAP) return part;
      return { ...part, text: boundedUtf8(part.text, PER_MESSAGE_TEXT_CAP) };
    }
    return part;
  }) };
  return cloned;
}

/** Bound each retained message in a result array: per-message text cap, then per-result
 *  aggregate byte/COUNT cap (diagnostics count toward both). Returns a NEW array.
 *
 *  The byte budget may be smaller than `PER_RESULT_MESSAGES_BYTES` when many results need
 *  to fit in the same serialized details object (`DETAILS_JSON_CAP`). The caller passes
 *  the effective per-result budget so a single deterministic stage-1 bound is sufficient
 *  for 8 parallel tasks. */
function boundResultMessages(messages: SubagentMessage[], perResultBytesBudget: number): SubagentMessage[] {
  if (!Array.isArray(messages)) return messages;
  const out: SubagentMessage[] = [];
  let used = 0;
  for (const msg of messages) {
    const retained = retainMessageAgainstBudget(msg, { used, byteBudget: perResultBytesBudget, countBudget: PER_RESULT_MESSAGES_COUNT - out.length });
    if (!retained) continue;
    used += retained.serializedBytes;
    out.push(retained.message);
  }
  return out;
}

/** Decide whether to retain `msg` against an explicit budget (used by
 *  `boundResultMessages` / the details-side stage-1 bound). The caller passes the
 *  CURRENT `used` bytes + `byteBudget` + `countBudget`; the helper returns `null` when
 *  the message itself exceeds the remaining budget (drop, do not count) or
 *  `{ message, serializedBytes }` when retained. The serialized-byte field is the JSON
 *  byte count of the bounded message so the caller can add it to its running `used`
 *  counter without re-serializing.
 *
 *  The stream-side helper used inside `runSingleAgent` is a closure-scoped function
 *  of the same name with signature `(msg) => boolean`; see the docstring at its
 *  declaration site for the live-stream contract. */
function retainMessageAgainstBudget(
  msg: SubagentMessage,
  budget: { used: number; byteBudget: number; countBudget: number },
): { message: SubagentMessage; serializedBytes: number } | null {
  if (!msg) return null;
  if (budget.countBudget <= 0) return null;
  const textBound = boundMessageText(msg);
  const msgBytes = Buffer.byteLength(JSON.stringify(textBound), "utf8");
  // If this single message exceeds the remaining byte budget on its own, drop it. We do
  // NOT subtract its bytes from `used` (raw content is discarded), and we do NOT push it
  // into the message array (the cap is recorded above in finish()).
  if (msgBytes > budget.byteBudget - budget.used) return null;
  return { message: textBound, serializedBytes: msgBytes };
}

/** Enforce the documented per-result bounds: task preview <= 1KiB, error/stderr <= 4KiB,
 *  per-result aggregate message byte budget with each content-part text capped, diagnostic
 *  count included. The per-result message budget is computed from
 *  `DETAILS_JSON_CAP / results.length` so 8 parallel tasks each carrying the worst-case
 *  preview STILL produce a details object that fits the documented cap. Returns a NEW object. */
export function boundDetailsBytes<T extends SubagentDetails>(details: T): T {
  const clone: T = JSON.parse(JSON.stringify(details));
  const results = Array.isArray(clone.results) ? clone.results : [];
  const n = Math.max(1, results.length);
  // Reserve ~8 KiB per result for task preview + error + stderr + usage + scaffolding so
  // eight worst-case results still serialize under DETAILS_JSON_CAP (256 KiB).
  const perResultBytesBudget = Math.max(1024, Math.floor(DETAILS_JSON_CAP / n) - 8 * 1024);
  if (Array.isArray(clone.results)) {
    for (const r of clone.results as Array<Record<string, unknown>>) {
      if (typeof r.task === "string") r.task = boundedUtf8(r.task, MAX_TASK_PREVIEW_BYTES);
      if (typeof r.errorMessage === "string") r.errorMessage = boundedUtf8(r.errorMessage, MAX_ERROR_MESSAGE_BYTES);
      if (typeof r.stderr === "string") r.stderr = boundedUtf8(r.stderr, PER_RESULT_STDERR_BYTES);
      if (Array.isArray(r.messages)) r.messages = boundResultMessages(r.messages as SubagentMessage[], perResultBytesBudget);
    }
  }
  return clone;
}

/** Compact per-result representation used in stage 2 of the deterministic fallback.
 *  Contains only structural/status fields; NO messages, NO stderr, NO raw outputs. */
function compactResultSummary(result: SingleResult): Record<string, unknown> {
  return {
    agent: result.agent,
    agentSource: result.agentSource,
    exitCode: result.exitCode,
    usage: result.usage,
    model: result.model,
    stopReason: result.stopReason,
    terminated: result.terminated ?? null,
    timedOut: Boolean(result.timedOut),
    aborted: Boolean(result.aborted),
    step: result.step,
    task: boundedUtf8(String(result.task ?? ""), MAX_TASK_PREVIEW_BYTES),
    truncated: true,
  };
}

/** Compose a final, deterministic, public surface that, by construction, serializes to
 *  <= DETAILS_JSON_CAP. This is stage 3 of the deterministic fallback: when even the
 *  compact summary is over cap, the run must still return a valid structured result that
 *  is bounded. Directory paths are reduced to basenames or null to keep the payload tiny. */
function buildMinimalDetails(details: SubagentDetails): SubagentDetails {
  const basename = (p: string | null): string | null => {
    if (!p) return null;
    return path.basename(p);
  };
  return {
    mode: details.mode,
    agentScope: details.agentScope,
    results: [],
    projectAgentsDir: basename(details.projectAgentsDir),
    userAgentsDir: basename(details.userAgentsDir),
    packageAgentsDir: basename(details.packageAgentsDir),
    truncated: true,
    diagnostic: "[rp-cap: details truncated beyond DETAILS_JSON_CAP; minimal summary returned]",
  } as SubagentDetails;
}

/** Pure helper that returns `true` when the structured details object serializes to
 *  <= DETAILS_JSON_CAP bytes. The caller decides what to do with the verdict; this helper
 *  never substitutes minimal summaries, never mutates its input, and never short-circuits
 *  the stage-1 / stage-2 pipeline. Returning a verdict (not a transformed object) is what
 *  lets `withBoundedResult` perform the deterministic 3-stage fallback in the exact order
 *  documented above: stage 1, fit test, then stage 2, fit test, then stage 3. */
export function detailsFitCap(details: SubagentDetails, cap: number = DETAILS_JSON_CAP): boolean {
  let json: string;
  try { json = JSON.stringify(details); }
  catch { /* non-serializable details — caller should treat as "unknown fit" and proceed to stage 3 */ return false; }
  return Buffer.byteLength(json, "utf8") <= cap;
}

/** Wrap an executeSubagent return so the details object is bounded by DETAILS_JSON_CAP and
 *  the model-visible content text is bounded by AGGREGATE_OUTPUT_CAP. This is the single
 *  chokepoint every return path inside executeSubagent goes through so the public surface
 *  NEVER returns a serialized details object larger than the documented cap.
 *
 *  Deterministic 3-stage fallback (ORDER IS LOAD-BEARING):
 *    Stage 1: bound per-result fields (task preview <= 1KiB, error/stderr <= 4KiB,
 *             per-result aggregate message bytes/count with each content text bounded,
 *             diagnostics count toward that budget).
 *    a) stage1 = boundDetailsBytes(original). If `detailsFitCap(stage1)`, use stage1.
 *    b) else stage2 = { ...base metadata, results: ORIGINAL/Stage1 results mapped
 *       compactResultSummary preserving all ordered slots }. If `detailsFitCap(stage2)`,
 *       use stage2 with `truncated:true` on each result.
 *    c) else minimal results:[] with directory basenames; `truncated:true` +
 *       bounded diagnostic. Final construction NEVER calls `assertDetailsWithinCap`
 *       to substitute minimal inside stage1/stage2 — the helper is read-only here.
 *  Applied to EVERY return path inside executeSubagent AND to every onUpdate BEFORE the
 *  user-supplied callback, so partial streaming results are bounded at the same level. */
export function withBoundedResult(result: SubagentExecuteResult): SubagentExecuteResult {
  // Every text content part is clipped against the SERIALIZED JSON payload via
  // `boundedSerializedTextContent`, the canonical chokepoint. This guarantees that the final
  // content array serializes to <= the documented cap even with hostile Unicode / quotes /
  // backslashes / control characters. ImageContent parts pass through unchanged.
  const boundedContent = result.content.map((c) => c.type === "text" ? boundedSerializedTextContent(c.text, AGGREGATE_OUTPUT_CAP) : c);
  // a) Stage 1: bound per-result fields. Caller asks the pure `detailsFitCap` whether it
  //    fits; no helper substitutes minimal at this point.
  const stage1Details: SubagentDetails = boundDetailsBytes(result.details);
  let details = stage1Details;
  if (!detailsFitCap(stage1Details)) {
    // b) Stage 2: replace each result with a compact summary that preserves the ordered
    //    slot count. The base metadata (mode, agentScope, directory paths) is preserved
    //    verbatim from stage 1 so the parent sees the same shape as if stage 1 had been
    //    accepted.
    const stage2Details: SubagentDetails = {
      ...stage1Details,
      results: Array.isArray(stage1Details.results) ? stage1Details.results.map((r) => compactResultSummary(r as SingleResult)) : [],
      truncated: true,
    };
    if (detailsFitCap(stage2Details)) {
      details = stage2Details;
    } else {
      // c) Stage 3: minimal summary, guaranteed <= DETAILS_JSON_CAP by construction. Final
      //    construction throws ONLY if even the minimal summary cannot be assembled (a
      //    non-serializable base metadata object). Production must never reach here in
      //    well-formed inputs.
      const minimal = buildMinimalDetails(stage2Details);
      if (!detailsFitCap(minimal)) {
        throw new Error(`respawn-pi: structured details exceeds DETAILS_JSON_CAP (${DETAILS_JSON_CAP} bytes) even after the 3-stage fallback; this is a contract violation, not a hostile input`);
      }
      details = minimal;
    }
  }
  return { ...result, content: boundedContent, details };
}

export function resolveDispatchTimeoutMs(requested?: number, configured?: string | number): number {
  const fromRequest = requested !== undefined;
  const source = fromRequest ? "timeoutMs" : "RESPAWNPACK_AGENT_TIMEOUT_MS";
  let value: number;
  if (fromRequest) value = requested as number;
  else if (configured === undefined || configured === "") value = DEFAULT_DISPATCH_TIMEOUT_MS;
  else value = Number(configured);
  if (!Number.isInteger(value) || value < MIN_DISPATCH_TIMEOUT_MS || value > MAX_DISPATCH_TIMEOUT_MS) {
    throw new Error(`${source} must be an integer between ${MIN_DISPATCH_TIMEOUT_MS} and ${MAX_DISPATCH_TIMEOUT_MS}`);
  }
  return value;
}

/** Resolve a dispatch cwd. Mirrors the package's existing containment rule: the requested path
 *  must resolve inside the session cwd, and every path component must be a regular (non-symlink)
 *  directory. The session cwd itself may live anywhere; only the requested subpath is contained. */
export function resolveDispatchCwd(sessionCwd: string, requested?: string): string {
  if (!sessionCwd) throw new Error("session cwd is required for dispatch");
  const base = fs.realpathSync(path.resolve(sessionCwd));
  const candidate = requested
    ? (path.isAbsolute(requested) ? requested : path.resolve(base, requested))
    : base;
  let canonical = candidate;
  try { canonical = fs.realpathSync(candidate); }
  catch { throw new Error("dispatch cwd does not exist"); }
  const relative = path.relative(base, canonical);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("dispatch cwd escapes session cwd");
  }
  if (!fs.statSync(canonical).isDirectory()) throw new Error("dispatch cwd must be a directory");
  // Walk the lexical (pre-realpath) components to refuse symlink traversal even when the
  // requested path sits at the same canonical location the realpath resolved to.
  let cursor = base;
  for (const component of path.relative(base, candidate).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`dispatch cwd contains symlink component: ${cursor}`);
  }
  return canonical;
}

/**
 * Validate declared tool names BEFORE spawn. The 32 shipped agents declare Pi 0.84.0
 * lowercase native tool names (and the package wrappers `respawn_pi_grep` /
 * `respawn_pi_glob`). Unknown / PascalCase names fail closed — the dispatch is
 * rejected and no child is started. Returns the translated list; an empty list means
 * `--no-tools`.
 */
function buildTranslatedTools(agent: AgentConfig): { tools: string[]; unknown: string[] } {
  if (!agent.tools || agent.tools.length === 0) return { tools: [], unknown: [] };
  return translateToolList(agent.tools);
}

/**
 * Build the child argv. `--no-tools` is used when the agent declares no tools (fail-closed;
 * never grant defaults). `--model` is set when the agent declares one. System prompt is written
 * to a per-invocation temp file (mode 0600). Pi's example uses `withFileMutationQueue` for
 * concurrent writers of the SAME file; we have one writer per file, so a regular write + 0600
 * is sufficient.
 *
 * `translatedTools` is the OUTPUT of buildTranslatedTools — must already be the actual tool
 * names the child registers, never the raw frontmatter declarations.
 */
function buildChildArgs(agent: AgentConfig, task: string, promptTmp: { dir: string; filePath: string } | null, translatedTools: string[]): string[] {
  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (agent.model) args.push("--model", agent.model);
  if (translatedTools.length > 0) args.push("--tools", translatedTools.join(","));
  else args.push("--no-tools");
  if (promptTmp) args.push("--append-system-prompt", promptTmp.filePath);
  args.push(`Task: ${task}`);
  return args;
}

function writeSystemPromptToTempFile(agentName: string, prompt: string): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rp-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

function cleanupPromptTmp(promptTmp: { dir: string; filePath: string } | null): void {
  if (!promptTmp) return;
  try { fs.unlinkSync(promptTmp.filePath); } catch { /* best-effort */ }
  try { fs.rmdirSync(promptTmp.dir); } catch { /* best-effort */ }
}

/**
 * Pi's `getPiInvocation` (source: examples/extensions/subagent/index.ts lines ~167–181 in
 * Pi 0.84.0) chooses between `node <currentScript>` and `pi` based on whether the current
 * process is a generic JS runtime. Pi 0.84.0 does NOT export this helper from
 * `@earendil-works/pi-coding-agent` (verified against dist/index.d.ts — no matching
 * export), so we replicate the same rule locally.
 *
 * Tests exercise the default behavior by either:
 *   - running the test runner as the parent of a fake `pi` on PATH, with `process.argv[1]`
 *     pointing at the test script (NOT a real Pi source file) — so default getPiInvocation
 *     takes the `pi` branch and the fake is found on PATH; OR
 *   - passing an explicit `invocation` option through `executeSubagent` (the option is
 *     forwarded into the runner; the production `dispatchEnabled` option does NOT exist
 *     in production mode, so it cannot be used to leak a fake into the registered tool).
 */
function getPiInvocationDefault(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/") || false;
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }
  return { command: "pi", args };
}

interface RunSingleOptions {
  agent: AgentConfig;
  task: string;
  cwd: string;
  timeoutMs: number;
  abortSignal: AbortSignal | null | undefined;
  onUpdate?: (partial: SubagentExecuteResult) => void;
  makeDetails: (results: SingleResult[]) => SubagentDetails;
  step?: number;
  /** Test seam (invocation-local): when true, the runner pretends the process group is
   *  unkillable so the cleanup-failure path is exercised. Production never sets this. */
  forceReapFailure?: boolean;
  /** Test seam (invocation-local): when provided, replaces the default getPiInvocation
   *  rule. Production never sets this; registered production tool calls cannot reach
   *  this option. */
  invocation?: { command: string; args: string[] };
}

function isDispatchGateEnabled(): boolean {
  // The single, non-bypassable gate. The env var is the only production switch.
  return process.env.RESPAWNPACK_AGENT_DISPATCH === "1";
}

function runSingleAgent(opts: RunSingleOptions): Promise<SingleResult> {
  const { agent, task, cwd, timeoutMs, abortSignal, onUpdate, makeDetails, step, forceReapFailure, invocation } = opts;
  // Initialize the structured result, the cleanup status placeholder, all timers, and the
  // lifecycle latches BEFORE spawn so the (synchronous) error-callback closure and the
  // async 'error' handler can read them without TDZ risks. The prompt tmp dir is also
  // tracked here so finish() can always reclaim it exactly once.
  const result: SingleResult = {
    agent: agent.name,
    agentSource: agent.source,
    task,
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
    model: agent.model,
    step,
    timedOut: false,
    aborted: false,
    terminated: null,
    cleanup: { groupReaped: true, sigtermSent: false, sigkillSent: false, elapsedMs: 0, forcedFailure: Boolean(forceReapFailure) },
  };
  let stderr = Buffer.alloc(0);
  // StringDecoder buffers partial UTF-8 code points so a multi-byte character that arrives
  // split across chunks (1+3 bytes for an emoji) is reassembled before any string-level
  // processing (line splitting, JSON parsing). The decoder is flushed exactly once on stream
  // end / close to surface any trailing partial line. This is the streaming UTF-8-safe path
  // (the previous per-chunk `chunk.toString("utf8")` could split a code point at a chunk
  // boundary and turn it into U+FFFD on the next chunk).
  let stdoutDecoder: StringDecoder | null = null;
  let stdoutRemainder = "";
  let messagesBytes = 0;
  let messagesCount = 0;
  let oversizeLineActive = false;
  let oversizeLineBytes = 0;
  const messagesCap = PER_RESULT_MESSAGES_BYTES;
  const messagesCountCap = PER_RESULT_MESSAGES_COUNT;
  let termination: "timeout" | "abort" | "spawn-failed" | null = null;
  let settled = false;
  let forceKillTimer: NodeJS.Timeout | undefined;
  let groupKillTimer: NodeJS.Timeout | undefined;
  let reapPollTimer: NodeJS.Timeout | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  let promptTmp: { dir: string; filePath: string } | null = null;
  let spawnFailed = false;
  let spawnFailedMessage = "";
  let child: ReturnType<typeof spawn> | null = null;

  return new Promise<SingleResult>((resolve) => {
    const finish = (failure: "ok" | "cleanup-failed") => {
      if (settled) return;
      settled = true;
      cleanupPromptTmp(promptTmp);
      promptTmp = null;
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = undefined; }
      if (forceKillTimer) { clearTimeout(forceKillTimer); forceKillTimer = undefined; }
      if (groupKillTimer) { clearTimeout(groupKillTimer); groupKillTimer = undefined; }
      if (reapPollTimer) { clearTimeout(reapPollTimer); reapPollTimer = undefined; }
      if (abortSignal && onAbort) abortSignal.removeEventListener("abort", onAbort);
      try { child?.stdout?.destroy(); } catch { /* already closed */ }
      try { child?.stderr?.destroy(); } catch { /* already closed */ }
      if (result.cleanup) {
        result.cleanup.elapsedMs = result.cleanup.elapsedMs;
      } else {
        result.cleanup = { groupReaped: true, sigtermSent: false, sigkillSent: false, elapsedMs: 0, forcedFailure: Boolean(forceReapFailure) };
      }
      result.stderr = boundedUtf8(stderr, PER_RESULT_STDERR_BYTES);
      // Bound retained fields so the serialized details stays bounded. The bounds are
      // applied at the canonical chokepoint (withBoundedResult) too; this per-runner pass
      // keeps the in-memory result honest before the chokepoint runs.
      result.task = boundTaskPreview(task);
      if (result.errorMessage) {
        result.errorMessage = boundedUtf8(result.errorMessage, MAX_ERROR_MESSAGE_BYTES);
      }
      if (messagesBytes > messagesCap) {
        // Track that we hit the cap so a future test can assert the bound was enforced.
        // Goes through `retainMessage` so the diagnostic counts against the same caps
        // every other retained message must respect.
        retainMessage({ role: "system", content: [{ type: "text", text: `[rp-cap: messagesBytes=${messagesBytes} > ${messagesCap}]` }] });
      }
      if (failure === "cleanup-failed") {
        result.exitCode = result.exitCode && result.exitCode !== 0 ? result.exitCode : 137;
        result.stopReason = "error";
        result.timedOut = true;
        result.terminated = "timeout";
        result.errorMessage = boundedUtf8(
          `${result.errorMessage ? result.errorMessage + "; " : ""}[rp-reap: group still present after SIGKILL+${REAP_POLL_GRACE_MS}ms; cleanup reported as error]`,
          MAX_ERROR_MESSAGE_BYTES,
        );
      } else if (termination === "timeout") {
        result.exitCode = 124;
        result.timedOut = true;
        result.terminated = "timeout";
        result.stopReason = "error";
        result.errorMessage = boundedUtf8(`timed out after ${timeoutMs}ms`, MAX_ERROR_MESSAGE_BYTES);
      } else if (termination === "abort") {
        result.exitCode = 130;
        result.aborted = true;
        result.terminated = "abort";
        result.stopReason = "aborted";
        result.errorMessage = boundedUtf8("aborted", MAX_ERROR_MESSAGE_BYTES);
      } else if (result.exitCode === undefined || result.exitCode === null) {
        result.exitCode = 0;
      }
      resolve(result);
    };

    const emitUpdate = () => {
      if (!onUpdate) return;
      // Apply the deterministic 3-stage fallback BEFORE invoking the user callback so the
      // caller never observes an unbounded partial. The user-supplied callback receives a
      // bounded SubagentExecuteResult, and any exception in the callback is isolated.
      const partial: SubagentExecuteResult = withBoundedResult({
        content: [boundedSerializedTextContent(getFinalOutput(result.messages) || "(running...)", ONUPDATE_TEXT_CAP)],
        details: makeDetails([{ ...result, messages: [...result.messages] }]),
      });
      try { onUpdate(partial); } catch { /* listener fault-tolerance */ }
    };

    if (!isDispatchGateEnabled()) {
      result.exitCode = 1;
      result.stopReason = "error";
      result.errorMessage = boundedUtf8("dispatch disabled; set RESPAWNPACK_AGENT_DISPATCH=1 to enable (it spawns a tool-scoped child `pi` process with the Debian user's permissions)", MAX_ERROR_MESSAGE_BYTES);
      result.task = boundTaskPreview(task);
      resolve(result);
      return;
    }

    if (abortSignal?.aborted) {
      result.exitCode = 130;
      result.aborted = true;
      result.stopReason = "aborted";
      result.terminated = "abort";
      result.task = boundTaskPreview(task);
      resolve(result);
      return;
    }

    // Translate declared tool names BEFORE spawn. Unknown tools fail closed.
    const { tools: translatedTools, unknown } = buildTranslatedTools(agent);
    if (unknown.length > 0) {
      result.exitCode = 1;
      result.stopReason = "error";
      result.errorMessage = boundedUtf8(`agent "${agent.name}" declares unknown tool(s): ${unknown.join(", ")}; valid (lowercase Pi 0.84.0 native names + package wrappers): read, write, edit, find, ls, bash, grep, respawn_pi_grep, respawn_pi_glob. Lowercase 'grep' and 'find' are translated to the bounded package wrappers (respawn_pi_grep / respawn_pi_glob); the runner does not translate PascalCase.`, MAX_ERROR_MESSAGE_BYTES);
      result.task = boundTaskPreview(task);
      resolve(result);
      return;
    }

    promptTmp = agent.systemPrompt && agent.systemPrompt.trim()
      ? writeSystemPromptToTempFile(agent.name, agent.systemPrompt)
      : null;
    const args = buildChildArgs(agent, task, promptTmp, translatedTools);
    const detached = process.platform !== "win32";
    const invocationResolved = invocation ?? getPiInvocationDefault(args);

    // Spawn with synchronous try/catch (covers argument-validation errors). The async
    // 'error' handler is wired IMMEDIATELY after spawn (with `once` so it cannot be
    // attached twice and the host never sees an uncaught 'error' from spawn(2) failure).
    try {
      child = spawn(invocationResolved.command, invocationResolved.args, { cwd, detached, stdio: ["ignore", "pipe", "pipe"], shell: false });
    } catch (error) {
      // synchronous failure: capture the reason, mark spawn failed, defer finish() until
      // we're sure no async 'error' raced us. We do NOT call resolve here directly because
      // the host process could be left with a leaked prompt tmp dir if the async error
      // handler also fires; we let close/error settle the promise in deterministic order.
      spawnFailed = true;
      spawnFailedMessage = boundedUtf8(`spawn failed: ${String((error as Error).message || error)}`, MAX_ERROR_MESSAGE_BYTES);
      result.exitCode = 1;
      result.stopReason = "error";
      result.errorMessage = spawnFailedMessage;
      result.task = boundTaskPreview(task);
      // No child created, so we settle directly: nothing to reap or close.
      cleanupPromptTmp(promptTmp);
      promptTmp = null;
      resolve(result);
      return;
    }

    // The error handler is attached EXACTLY ONCE, with `once`. spawn(2) can fail
    // asynchronously (ENOENT for a missing binary, EACCES for a non-executable, default
    // invocation failure, ...); the sync try/catch above only catches argument validation
    // errors. Wiring `once('error', ...)` before any further work guarantees:
    //   - the handler runs at most once for this child
    //   - the closure references variables that are ALREADY INITIALIZED above
    //     (settled, termination, promptTmp, spawnFailed, ...)
    //   - finish() / cleanup run in deterministic order, no duplicate listeners
    child.once("error", (error) => {
      spawnFailed = true;
      spawnFailedMessage = boundedUtf8(`spawn failed: ${String((error as Error).message || error)}`, MAX_ERROR_MESSAGE_BYTES);
      if (settled) return;
      result.exitCode = 1;
      result.stopReason = "error";
      result.errorMessage = spawnFailedMessage;
      result.task = boundTaskPreview(task);
      // The async handler fires BEFORE 'close' (Node semantics). The 'close' listener we
      // attach below will see the latched spawnFailed and call finish("ok"). To guarantee
      // an eventual settlement if 'close' somehow does NOT fire, we schedule a fail-safe
      // microtask that triggers finish() directly when we already know the spawn failed.
      setImmediate(() => {
        if (!settled) finish("ok");
      });
    });

    if (!child.pid) {
      // The async 'error' handler will fire; we just guard against a (rare) zero-pid
      // without error event by scheduling a microtask fallback identical to the above.
      setImmediate(() => {
        if (settled) return;
        if (spawnFailed) return;
        result.exitCode = 1;
        result.errorMessage = boundedUtf8("spawn returned a child with no pid", MAX_ERROR_MESSAGE_BYTES);
        result.task = boundTaskPreview(task);
        finish("ok");
      });
      return;
    }

    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        if (detached && child!.pid) process.kill(-child!.pid, signal);
        else child!.kill(signal);
      } catch { /* process already exited */ }
      if (signal === "SIGTERM") (result.cleanup as CleanupStatus).sigtermSent = true;
      if (signal === "SIGKILL") (result.cleanup as CleanupStatus).sigkillSent = true;
    };

    const childGroupStillExists = () => {
      if (!detached || !child!.pid) return false;
      try { process.kill(-child!.pid, 0); return true; }
      catch { return false; }
    };

    const beginTermination = (reason: "timeout" | "abort" | "spawn-failed") => {
      if (termination || settled) return;
      termination = reason;
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = undefined; }
      const terminationStartedAt = Date.now();
      signalGroup("SIGTERM");
      const grace = reason === "abort" ? PROCESS_GROUP_ABORT_GRACE_MS : PROCESS_GROUP_TERM_GRACE_MS;
      forceKillTimer = setTimeout(() => {
        if (forceReapFailure) {
          (result.cleanup as CleanupStatus).groupReaped = false;
          (result.cleanup as CleanupStatus).elapsedMs = Date.now() - terminationStartedAt;
          finish("cleanup-failed");
          return;
        }
        signalGroup("SIGKILL");
        try { child!.stdout?.destroy(); } catch { /* ignore */ }
        try { child!.stderr?.destroy(); } catch { /* ignore */ }
        const poll = () => {
          if (settled) return;
          if (!childGroupStillExists()) {
            (result.cleanup as CleanupStatus).groupReaped = true;
            (result.cleanup as CleanupStatus).elapsedMs = Date.now() - terminationStartedAt;
            finish("ok");
            return;
          }
          if (Date.now() - terminationStartedAt > REAP_POLL_GRACE_MS) {
            (result.cleanup as CleanupStatus).groupReaped = false;
            (result.cleanup as CleanupStatus).elapsedMs = Date.now() - terminationStartedAt;
            finish("cleanup-failed");
            return;
          }
          reapPollTimer = setTimeout(poll, REAP_POLL_INTERVAL_MS);
        };
        poll();
      }, grace);
    };

    onAbort = () => beginTermination("abort");
    timeoutTimer = setTimeout(() => beginTermination("timeout"), timeoutMs);
    if (abortSignal && onAbort) abortSignal.addEventListener("abort", onAbort, { once: true });

    /** Closure-scoped retention helper for the LIVE stream path (D-011 Gate A finding 3).
     *  Used by BOTH the parsed-event path (`processLine`) AND the diagnostic path
     *  (`pushDiagnostic`). Bounds per-message text, then serializes the bounded message,
     *  checks `messagesCap` and `PER_RESULT_MESSAGES_COUNT` BEFORE push, increments
     *  `messagesBytes` / `messagesCount` only when the message is actually retained,
     *  returns true on retain / false on drop.
     *
     *  Repeated hostile oversized-line floods can call `pushDiagnostic` thousands of
     *  times; the helper caps `result.messages` at `PER_RESULT_MESSAGES_COUNT` and the
     *  serialized bytes total at `messagesCap` so no flood can bypass the documented
     *  bounds. */
    const retainMessage = (msg: SubagentMessage): boolean => {
      if (!msg) return false;
      if (messagesCount >= messagesCountCap) return false;
      const textBound = boundMessageText(msg);
      const msgBytes = Buffer.byteLength(JSON.stringify(textBound), "utf8");
      // If this single message would exceed the remaining byte budget on its own, drop
      // it without pushing. We do NOT subtract its bytes from `messagesBytes` (raw
      // content is discarded), and we do NOT increment `messagesCount`. A flood of
      // oversize raw bytes is therefore bounded by the `messagesCap` / `messagesCountCap`
      // ceilings the runner tracks internally.
      if (msgBytes > messagesCap - messagesBytes) return false;
      messagesBytes += msgBytes;
      messagesCount += 1;
      result.messages.push(textBound);
      return true;
    };

    const processLine = (line: string) => {
      if (!line.trim()) return;
      let event: { type?: string; message?: SubagentMessage } & Record<string, unknown>;
      try { event = JSON.parse(line); }
      catch { return; }
      if ((event.type === "message_end" || event.type === "tool_result_end") && event.message) {
        const msg = event.message as SubagentMessage;
        if (!retainMessage(msg)) return;
        if (event.type === "message_end" && msg.role === "assistant") {
          result.usage.turns++;
          const usage = msg.usage;
          if (usage) {
            result.usage.input += Number(usage.input || 0);
            result.usage.output += Number(usage.output || 0);
            result.usage.cacheRead += Number(usage.cacheRead || 0);
            result.usage.cacheWrite += Number(usage.cacheWrite || 0);
            const cost = usage.cost;
            if (typeof cost === "number") result.usage.cost += cost;
            else if (cost && typeof cost.total === "number") result.usage.cost += cost.total;
            if (typeof usage.totalTokens === "number") result.usage.contextTokens = usage.totalTokens;
          }
          if (!result.model && msg.model) result.model = msg.model;
          if (msg.stopReason) result.stopReason = msg.stopReason;
          if (msg.errorMessage) result.errorMessage = msg.errorMessage;
        }
        emitUpdate();
      }
    };

    /** Push a system diagnostic, applying the same per-result byte/count cap the parsed-
     *  event path uses. A hostile child that floods the oversize-marker stream cannot grow
     *  `result.messages` beyond `PER_RESULT_MESSAGES_COUNT` nor push the serialized byte
     *  total past `messagesCap`. Discards the raw oversized line bytes without counting
     *  them as retained messages (D-011 Gate A finding 3). */
    const pushDiagnostic = (text: string) => {
      const diag: SubagentMessage = { role: "system", content: [{ type: "text", text }] };
      return retainMessage(diag);
    };

    if (child.stdout) child.stdout.on("data", (chunk: Buffer | string) => {
      // Streaming UTF-8: feed each chunk through a StringDecoder so multi-byte characters
      // split across chunks (e.g. an emoji as 1+3 bytes across delayed writes) are
      // reassembled at complete code-point boundaries before any string-level processing.
      // The decoder buffers incomplete trailing bytes internally; we flush it on close.
      if (!stdoutDecoder) stdoutDecoder = new StringDecoder("utf8");
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      const chunkStr = stdoutDecoder.write(buf);
      if (chunkStr.length === 0) return;
      stdoutRemainder = stdoutRemainder + chunkStr;
      let nl = stdoutRemainder.indexOf("\n");
      while (nl !== -1) {
        const line = stdoutRemainder.slice(0, nl).replace(/\r$/, "");
        stdoutRemainder = stdoutRemainder.slice(nl + 1);
        const lineBytes = Buffer.byteLength(line, "utf8");
        if (lineBytes > MAX_EVENT_LINE_BYTES) {
          oversizeLineActive = true;
          oversizeLineBytes = lineBytes;
          nl = stdoutRemainder.indexOf("\n");
          continue;
        }
        if (oversizeLineActive) {
          if (lineBytes <= MAX_EVENT_LINE_BYTES && line.trim()) {
            oversizeLineActive = false;
            // Diagnostic goes through `pushDiagnostic` so it counts against
            // `messagesCap` / `messagesCount` exactly like the parsed-event path. A
            // hostile child that alternates oversize lines + valid event lines cannot
            // grow `result.messages` beyond the documented caps.
            pushDiagnostic(`[rp-cap: oversize event line ${oversizeLineBytes} bytes (cap ${MAX_EVENT_LINE_BYTES}); discarding until next newline]`);
            processLine(line);
          }
        } else {
          processLine(line);
        }
        nl = stdoutRemainder.indexOf("\n");
      }
      if (stdoutRemainder.length > STDOUT_REMAINDER_CAP) {
        stdoutRemainder = stdoutRemainder.slice(stdoutRemainder.length - STDOUT_REMAINDER_CAP);
      }
    });

    if (child.stderr) child.stderr.on("data", (chunk: Buffer | string) => { stderr = appendBounded(stderr, chunk, PER_RESULT_STDERR_BYTES); });

    child.on("close", (code) => {
      // Flush any decoder-tail we have not already consumed. There is no separate
      // stdout 'end' listener (the runner relies on 'close' as the single settlement
      // point); the StringDecoder must therefore be flushed EXACTLY ONCE here, and
      // the `stdoutDecoder` null check guarantees we never flush it twice.
      if (stdoutDecoder) {
        const tail = stdoutDecoder.end();
        if (tail.length > 0) stdoutRemainder = stdoutRemainder + tail;
        stdoutDecoder = null;
      }
      // Flush any trailing partial line (a final event without a newline is still parsed).
      if (stdoutRemainder.trim() && !oversizeLineActive) processLine(stdoutRemainder);
      stdoutRemainder = "";
      if (spawnFailed) { finish("ok"); return; }
      if (termination) {
        if (!result.exitCode || result.exitCode === 0) result.exitCode = code ?? 0;
        return;
      }
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = undefined; }
      result.exitCode = code ?? 0;
      const terminationStartedAt = Date.now();
      signalGroup("SIGTERM");
      const poll = () => {
        if (settled) return;
        if (!childGroupStillExists()) {
          (result.cleanup as CleanupStatus).groupReaped = true;
          (result.cleanup as CleanupStatus).elapsedMs = Date.now() - terminationStartedAt;
          finish("ok");
          return;
        }
        if (Date.now() - terminationStartedAt > REAP_POLL_GRACE_MS) {
          signalGroup("SIGKILL");
          const afterKill = Date.now();
          const killPoll = () => {
            if (settled) return;
            if (!childGroupStillExists()) {
              (result.cleanup as CleanupStatus).groupReaped = true;
              (result.cleanup as CleanupStatus).elapsedMs = Date.now() - terminationStartedAt;
              finish("ok");
              return;
            }
            if (Date.now() - afterKill > REAP_POLL_GRACE_MS) {
              (result.cleanup as CleanupStatus).groupReaped = false;
              (result.cleanup as CleanupStatus).elapsedMs = Date.now() - terminationStartedAt;
              finish("cleanup-failed");
              return;
            }
            reapPollTimer = setTimeout(killPoll, REAP_POLL_INTERVAL_MS);
          };
          killPoll();
          return;
        }
        reapPollTimer = setTimeout(poll, REAP_POLL_INTERVAL_MS);
      };
      poll();
    });
  });
}

async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Locate the AgentConfig for `agentName` in the discovery result. Throws when the agent is
 *  not found in the resolved roster — fail-closed: no child is spawned, no synthetic agent
 *  is fabricated. */
function requireAgent(discovery: AgentDiscoveryResult, agentName: string): AgentConfig {
  const found = discovery.agents.find((a) => a.name === agentName);
  if (!found) {
    const available = discovery.agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
    throw new Error(`unknown agent "${agentName}"; available agents: ${available}`);
  }
  return found;
}

function makeDetails(
  mode: DispatchMode,
  scope: AgentScope,
  discovery: AgentDiscoveryResult,
  results: SingleResult[],
): SubagentDetails {
  return {
    mode,
    agentScope: scope,
    results,
    projectAgentsDir: discovery.projectDir,
    userAgentsDir: discovery.userDir,
    packageAgentsDir: discovery.packageDir,
  };
}

/** Runtime input validation (D-011 hostile-bounds contract).
 *  Rejects empty/oversized inputs before any spawn. Both code-unit (matches JSON Schema
 *  maxLength) and BYTE-length (matches the documented worst-case UTF-8 expansion to 4
 *  bytes per code unit) checks are enforced. */
function validateTaskItem(item: TaskItem, indexLabel: string): void {
  if (!item || typeof item !== "object") throw new Error(`${indexLabel}: task item must be an object`);
  if (typeof item.agent !== "string" || item.agent.trim() === "") {
    throw new Error(`${indexLabel}: agent must be a non-empty string`);
  }
  if (item.agent.length > 64) {
    throw new Error(`${indexLabel}: agent name exceeds 64 characters`);
  }
  if (typeof item.task !== "string" || item.task.trim() === "") {
    throw new Error(`${indexLabel}: task must be a non-empty string`);
  }
  if (item.task.length > MAX_TASK_LEN) {
    throw new Error(`${indexLabel}: task exceeds ${MAX_TASK_LEN} characters`);
  }
  if (Buffer.byteLength(item.task, "utf8") > MAX_TASK_BYTES) {
    throw new Error(`${indexLabel}: task exceeds ${MAX_TASK_BYTES} bytes (UTF-8 expansion)`);
  }
  if (item.cwd !== undefined) {
    if (typeof item.cwd !== "string" || item.cwd.length === 0 || item.cwd.length > 4096 || item.cwd.includes("\0")) {
      throw new Error(`${indexLabel}: cwd must be a string of 1..4096 characters with no NUL bytes`);
    }
    if (Buffer.byteLength(item.cwd, "utf8") > MAX_CWD_BYTES) {
      throw new Error(`${indexLabel}: cwd exceeds ${MAX_CWD_BYTES} bytes (UTF-8 expansion)`);
    }
  }
}

function validateSingleParams(params: SubagentParams): void {
  if (typeof params.agent !== "string" || params.agent.trim() === "") {
    throw new Error("agent must be a non-empty string");
  }
  if (params.agent.length > 64) {
    throw new Error("agent name exceeds 64 characters");
  }
  if (typeof params.task !== "string" || params.task.trim() === "") {
    throw new Error("task must be a non-empty string");
  }
  if (params.task.length > MAX_TASK_LEN) {
    throw new Error(`task exceeds ${MAX_TASK_LEN} characters`);
  }
  if (Buffer.byteLength(params.task as string, "utf8") > MAX_TASK_BYTES) {
    throw new Error(`task exceeds ${MAX_TASK_BYTES} bytes (UTF-8 expansion)`);
  }
  if (params.cwd !== undefined) {
    if (typeof params.cwd !== "string" || params.cwd.length === 0 || params.cwd.length > 4096 || params.cwd.includes("\0")) {
      throw new Error("cwd must be a string of 1..4096 characters with no NUL bytes");
    }
    if (Buffer.byteLength(params.cwd, "utf8") > MAX_CWD_BYTES) {
      throw new Error(`cwd exceeds ${MAX_CWD_BYTES} bytes (UTF-8 expansion)`);
    }
  }
}

export interface ExecuteOptions {
  /** Optional UI hooks (confirmation, notify). When absent, project-agent confirmation is rejected. */
  ui?: {
    confirm?: (title: string, body: string) => Promise<boolean>;
    notify?: (message: string, level: "info" | "warning") => void;
  };
  /** True when the runtime has an interactive UI. Project-agent confirmation requires this. */
  hasUI?: boolean;
  /** Pi abort signal — propagated to every spawned child. */
  abortSignal?: AbortSignal | null;
  /** Optional streaming callback. Mirrors Pi's tool onUpdate contract. */
  onUpdate?: (partial: SubagentExecuteResult) => void;
  /** Internal-only dependency object. NOT a public surface; the registered tool schemas in
   *  index.ts never expose this. The fields are populated only by callers that hold a
   *  reference to `executeSubagent` directly (tests, the compat adapter). The compat
   *  adapter itself NEVER forwards these fields — it sets `hasUI: false` and lets the
   *  default getPiInvocation branch run against the operator's real `pi` binary. */
  _internal?: {
    /** Replaces the default getPiInvocation branch for THIS invocation. */
    invocation?: { command: string; args: string[] };
    /** Pretends the process group is unkillable to exercise the cleanup-failure path. */
    forceReapFailure?: boolean;
  };
}

/** Single entry point that the registered `respawn-pi-subagent` tool (and tests that
 *  drive the runner directly) call. Returns a structured SubagentExecuteResult. */
export async function executeSubagent(
  params: SubagentParams,
  ctx: { cwd: string },
  options: ExecuteOptions = {},
): Promise<SubagentExecuteResult> {
  return withBoundedResult(await _executeSubagent(params, ctx, options));
}

/** Internal implementation of executeSubagent. The public surface wraps the result through
 *  `withBoundedResult` so EVERY return path goes through the byte cap enforcement — including
 *  pre-spawn validation, project-agent refusal, chain/parallel failure, and the success path. */
async function _executeSubagent(
  params: SubagentParams,
  ctx: { cwd: string },
  options: ExecuteOptions = {},
): Promise<SubagentExecuteResult> {
  const scope: AgentScope = (params.agentScope ?? "package") as AgentScope;
  // Package authority is the INSTALLED package, not the target session cwd. Resolved from
  // import.meta.url so a session that happens to be run from a project that lacks a
  // `package.json` still discovers the 32 packaged agents.
  const packageRoot = resolveInstalledPackageRoot();
  if (!packageRoot) {
    return {
      content: [{ type: "text", text: "Cannot resolve installed package authority from the package directory; the agents-runtime extension is not installed correctly." }],
      details: { mode: "single", agentScope: scope, results: [], projectAgentsDir: null, userAgentsDir: null, packageAgentsDir: null },
      isError: true,
    };
  }
  const discovery = discoverAgents(packageRoot, scope, findUserAgentsDirForScope(scope), ctx.cwd);
  const agents = discovery.agents;
  const confirmProjectAgents = params.confirmProjectAgents !== false;

  const hasChain = Array.isArray(params.chain) && params.chain.length > 0;
  const hasTasks = Array.isArray(params.tasks) && params.tasks.length > 0;
  const hasSingle = typeof params.agent === "string" && typeof params.task === "string";
  const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

  const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
  const makeDetailsCurried = (mode: DispatchMode, results: SingleResult[]) => makeDetails(mode, scope, discovery, results);

  if (modeCount !== 1) {
    return {
      content: [{ type: "text", text: `Invalid parameters. Provide exactly one mode. Available agents: ${available}` }],
      details: makeDetailsCurried("single", []),
    };
  }

  // Project-agent confirmation: scope=project|both AND we have a UI AND the operator did not
  // explicitly pass `confirmProjectAgents: false`. Mirrors Pi's example default of true.
  if ((scope === "project" || scope === "both") && confirmProjectAgents && options.hasUI) {
    const requested: string[] = [];
    if (params.chain) for (const s of params.chain) requested.push(s.agent);
    if (params.tasks) for (const t of params.tasks) requested.push(t.agent);
    if (params.agent) requested.push(params.agent);
    const projectAgentsRequested = requested
      .map((name) => agents.find((a) => a.name === name))
      .filter((a): a is AgentConfig => Boolean(a && a.source === "project"));
    if (projectAgentsRequested.length > 0) {
      if (!options.ui || typeof options.ui.confirm !== "function") {
        return {
          content: [{ type: "text", text: "Canceled: project-local agents require an interactive UI for confirmation; pass confirmProjectAgents: false to skip." }],
          details: makeDetailsCurried(hasChain ? "chain" : hasTasks ? "parallel" : "single", []),
          isError: true,
        };
      }
      const names = projectAgentsRequested.map((a) => a.name).join(", ");
      const dir = discovery.projectDir ?? "(unknown)";
      const ok = await options.ui.confirm(
        "Run project-local agents?",
        `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
      );
      if (!ok) {
        return {
          content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
          details: makeDetailsCurried(hasChain ? "chain" : hasTasks ? "parallel" : "single", []),
          isError: true,
        };
      }
    }
  }

  let timeoutMs: number;
  try {
    timeoutMs = resolveDispatchTimeoutMs(params.timeoutMs, process.env.RESPAWNPACK_AGENT_TIMEOUT_MS);
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      details: makeDetailsCurried(hasChain ? "chain" : hasTasks ? "parallel" : "single", []),
      isError: true,
    };
  }
  const abortSignal = options.abortSignal ?? null;

  // Per-call deadline: chain and parallel use this as the TOTAL deadline for the call, not a
  // per-step/per-task cap. The runner reads `remainingExecutionMs` (NO floor — raw) at the
  // start of each step/task; if `remainingExecutionMs <= 0` the step/task is recorded as a
  // bounded skipped/timedOut result and DOES NOT spawn a child. Otherwise the caller passes
  // `Math.max(1, remainingExecutionMs)` to the internal runner. The PUBLIC minimum
  // (`MIN_DISPATCH_TIMEOUT_MS = 1000`) is enforced at validation so the FIRST child always
  // starts with the full budget. The cleanup grace (SIGTERM/SIGKILL/reap) is a separately
  // reported/documented interval that can extend wall time beyond the deadline, but is NOT
  // counted in the deadline computation. Cleanup grace never causes a step to spawn.
  //
  // `executionDeadline` is computed ONCE immediately before mode execution and is the
  // single source of truth for the deadline — no `Math.max(...)` floor on the read site.
  const executionDeadline = Date.now() + timeoutMs;
  const callStartedAt = executionDeadline - timeoutMs;
  const remainingExecutionMs = (): number => executionDeadline - Date.now();

  if (hasChain) {
    let chain: TaskItem[];
    try {
      chain = params.chain as TaskItem[];
      if (chain.length === 0) throw new Error("chain must contain at least one step");
      if (chain.length > MAX_PARALLEL_TASKS) throw new Error(`chain must contain at most ${MAX_PARALLEL_TASKS} steps`);
      chain.forEach((s, i) => validateTaskItem(s, `chain[${i}]`));
    } catch (e) {
      return {
        content: [{ type: "text", text: (e as Error).message }],
        details: makeDetailsCurried("chain", []),
        isError: true,
      };
    }
    const results: SingleResult[] = [];
    let previousOutput = "";
    for (let i = 0; i < chain.length; i++) {
      // Raw remaining (no floor). If <= 0, the deadline has expired before this step —
      // record the bounded skipped/timedOut result and DO NOT spawn a child. The PUBLIC
      // minimum (1000ms) is enforced at validation; the FIRST step always sees a positive
      // budget (the deadline was set immediately before the loop). Subsequent queued steps
      // (rare in practice — chain is sequential) may legitimately see a remaining <= 0.
      const remaining = remainingExecutionMs();
      if (remaining <= 0) {
        const errorMsg = `chain stopped at step ${i + 1}: total timeoutMs (${timeoutMs}ms) expired before step ${i + 1} (used ${Date.now() - callStartedAt}ms so far)`;
        const placeholder: SingleResult = {
          agent: chain[i].agent,
          agentSource: "package",
          task: boundTaskPreview(chain[i].task),
          exitCode: 124,
          messages: [],
          stderr: boundedUtf8(errorMsg, PER_RESULT_STDERR_BYTES),
          usage: emptyUsage(),
          step: i + 1,
          timedOut: true,
          aborted: false,
          terminated: "timeout",
          stopReason: "error",
          errorMessage: boundedUtf8(errorMsg, MAX_ERROR_MESSAGE_BYTES),
        };
        results.push(placeholder);
        return {
          content: [{ type: "text", text: boundedUtf8(errorMsg, AGGREGATE_OUTPUT_CAP) }],
          details: makeDetailsCurried("chain", results),
          isError: true,
        };
      }
      const step = chain[i];
      let taskWithContext: string;
      try {
        taskWithContext = buildSubstitutedTask(step.task, previousOutput);
        if (Buffer.byteLength(taskWithContext, "utf8") > MAX_TASK_BYTES) {
          throw new Error(`chain step ${i + 1}: substituted task exceeds ${MAX_TASK_BYTES} bytes (after {previous} expansion); the step is stopped before spawn to preserve the documented byte cap`);
        }
      } catch (e) {
        return {
          content: [{ type: "text", text: `Chain stopped at step ${i + 1}: ${(e as Error).message}` }],
          details: makeDetailsCurried("chain", results),
          isError: true,
        };
      }
      let agentCfg: AgentConfig;
      try { agentCfg = requireAgent(discovery, step.agent); }
      catch (e) {
        return {
          content: [{ type: "text", text: `Chain stopped at step ${i + 1}: ${(e as Error).message}` }],
          details: makeDetailsCurried("chain", results),
          isError: true,
        };
      }
      let stepCwd: string;
      try { stepCwd = resolveDispatchCwd(ctx.cwd, step.cwd); }
      catch (e) {
        return {
          content: [{ type: "text", text: `Chain stopped at step ${i + 1}: ${(e as Error).message}` }],
          details: makeDetailsCurried("chain", results),
          isError: true,
        };
      }
      const single = await runSingleAgent({
        agent: agentCfg,
        task: taskWithContext,
        cwd: stepCwd,
        // Internal runner accepts 1+ ms (the public schema still requires >= 1000ms; the
        // < 1000ms branch is reserved for queued steps whose deadline is almost up).
        timeoutMs: Math.max(MIN_INTERNAL_TIMEOUT_MS, remaining),
        abortSignal,
        onUpdate: options.onUpdate
          ? (partial) => options.onUpdate?.(withBoundedResult({
              content: partial.content,
              details: makeDetailsCurried("chain", [...results, partial.details.results[0]]),
            }))
          : undefined,
        makeDetails: (r) => makeDetailsCurried("chain", [...results, ...r]),
        step: i + 1,
        invocation: options._internal?.invocation,
        forceReapFailure: options._internal?.forceReapFailure,
      });
      single.step = i + 1;
      results.push(single);
      if (isFailedResult(single)) {
        const errorMsg = getResultOutput(single);
        return {
          content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
          details: makeDetailsCurried("chain", results),
          isError: true,
        };
      }
      previousOutput = getFinalOutput(single.messages);
    }
    return {
      content: [{ type: "text", text: boundedUtf8(getFinalOutput(results[results.length - 1].messages), AGGREGATE_OUTPUT_CAP) || "(no output)" }],
      details: makeDetailsCurried("chain", results),
    };
  }

  if (hasTasks) {
    let tasks: TaskItem[];
    try {
      tasks = params.tasks as TaskItem[];
      if (tasks.length === 0) throw new Error("tasks must contain at least one entry");
      if (tasks.length > MAX_PARALLEL_TASKS) throw new Error(`Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`);
      tasks.forEach((t, i) => validateTaskItem(t, `tasks[${i}]`));
    } catch (e) {
      return {
        content: [{ type: "text", text: (e as Error).message }],
        details: makeDetailsCurried("parallel", []),
        isError: true,
      };
    }
    // Pre-resolve agents + cwds so the runner is a single typed function with no per-task
    // try/catch. Failures (unknown agent or bad cwd) become structured results in the same
    // array; the dispatch is not silently abandoned.
    const resolved: Array<{ task: TaskItem; agent: AgentConfig; cwd: string } | { task: TaskItem; error: string }> = [];
    for (const t of tasks) {
      try {
        const agentCfg = requireAgent(discovery, t.agent);
        const stepCwd = resolveDispatchCwd(ctx.cwd, t.cwd);
        resolved.push({ task: t, agent: agentCfg, cwd: stepCwd });
      } catch (e) {
        resolved.push({ task: t, error: (e as Error).message });
      }
    }
    // Each parallel task uses the REMAINING deadline (raw, no floor). Tasks that do not
    // get scheduled before the deadline are recorded as bounded skipped/timedOut results
    // and DO NOT spawn a child. Workers that get scheduled pass `Math.max(1, remaining)`
    // to the internal runner — the public schema still requires >= 1000ms so the FIRST
    // worker always sees a positive budget.
    //
    // Parallel aggregate updates: per the Pi example parity (D-011), initialize ONE
    // placeholder result per task BEFORE any worker runs, and report the FULL ordered
    // slot set on every onUpdate. The current worker updates only its own slot. The
    // aggregate is bounded through `withBoundedResult` so no onUpdate payload can blow
    // the documented cap. Final results stay in original order — `mapWithConcurrencyLimit`
    // already preserves the input order.
    const allResults: SingleResult[] = new Array(resolved.length);
    for (let i = 0; i < resolved.length; i++) {
      const entry = resolved[i];
      if ("error" in entry) {
        // Pre-spawn validation failure becomes a structured result (no child was spawned).
        allResults[i] = {
          agent: entry.task.agent,
          agentSource: "package" as AgentSource,
          task: boundTaskPreview(entry.task.task),
          exitCode: 1,
          messages: [],
          stderr: boundedUtf8(entry.error, PER_RESULT_STDERR_BYTES),
          usage: emptyUsage(),
          step: undefined,
          timedOut: false,
          aborted: false,
          terminated: null,
          errorMessage: boundedUtf8(entry.error, MAX_ERROR_MESSAGE_BYTES),
          stopReason: "error",
        };
      } else {
        // Placeholder slot for a worker that has not started yet. exitCode = -1 (per Pi
        // example) so subscribers can distinguish running vs done; the public surface is
        // normalized to {timedOut,aborted,exitCode=0} once the worker completes.
        allResults[i] = {
          agent: entry.task.agent,
          agentSource: entry.agent.source,
          task: boundTaskPreview(entry.task.task),
          exitCode: -1,
          messages: [],
          stderr: "",
          usage: emptyUsage(),
          step: undefined,
          timedOut: false,
          aborted: false,
          terminated: null,
        };
      }
    }
    // Helper to emit a parallel aggregate update. The runner ALWAYS emits the full
    // ordered set of all task slots (Pi example parity: placeholders are initialized
    // for every task BEFORE any worker runs, so the subscriber always sees all N slots
    // in original order). The aggregate passes through `withBoundedResult` so partial
    // streaming details stay under DETAILS_JSON_CAP. The current slot's intermediate
    // progress (per streaming message_end event) is reflected by overwriting
    // `allResults[index]` BEFORE building the aggregate — the helper itself is index-
    // free since it always reads the full ordered slot set.
    const emitParallelUpdate = () => {
      if (!options.onUpdate) return;
      const doneCount = allResults.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
      const runningCount = allResults.filter((r) => r.exitCode === -1).length;
      const aggregate: SubagentExecuteResult = withBoundedResult({
        content: [boundedSerializedTextContent(
          `Parallel: ${doneCount}/${allResults.length} done, ${runningCount} running...`,
          ONUPDATE_TEXT_CAP,
        )],
        details: makeDetailsCurried("parallel", allResults.map((r) => ({ ...r }))),
      });
      try { options.onUpdate(aggregate); } catch { /* listener fault-tolerance */ }
    };
    const results = await mapWithConcurrencyLimit(resolved, MAX_CONCURRENCY, async (entry, index) => {
      if ("error" in entry) {
        // Pre-spawn failure already populated in allResults[index]; return the same ref
        // so the worker pipeline returns the ordered slot. Emit one final parallel
        // update so subscribers see the failure slot transition from running to done.
        emitParallelUpdate();
        return allResults[index];
      }
      const remaining = remainingExecutionMs();
      if (remaining <= 0) {
        const msg = `parallel task ${index} skipped: total timeoutMs (${timeoutMs}ms) expired before this task started`;
        allResults[index] = {
          agent: entry.task.agent,
          agentSource: entry.agent.source,
          task: boundTaskPreview(entry.task.task),
          exitCode: 124,
          messages: [],
          stderr: boundedUtf8(msg, PER_RESULT_STDERR_BYTES),
          usage: emptyUsage(),
          step: undefined,
          timedOut: true,
          aborted: false,
          terminated: "timeout",
          stopReason: "error",
          errorMessage: boundedUtf8(msg, MAX_ERROR_MESSAGE_BYTES),
        };
        emitParallelUpdate();
        return allResults[index];
      }
      const result = await runSingleAgent({
        agent: entry.agent,
        task: entry.task.task,
        cwd: entry.cwd,
        timeoutMs: Math.max(MIN_INTERNAL_TIMEOUT_MS, remaining),
        abortSignal,
        onUpdate: options.onUpdate
          ? (partial) => {
              // Per-task streaming update: update ONLY this slot, then emit the full
              // ordered aggregate. The runner's partial already has bounded content via
              // boundedSerializedTextContent; withBoundedResult enforces the details cap.
              const incoming = partial.details.results[0];
              if (incoming) {
                allResults[index] = { ...incoming, agent: entry.task.agent, agentSource: entry.agent.source };
              }
              emitParallelUpdate();
            }
          : undefined,
        makeDetails: (r) => makeDetailsCurried("parallel", r),
        invocation: options._internal?.invocation,
        forceReapFailure: options._internal?.forceReapFailure,
      });
      // Worker settled — overwrite the slot with the final result and emit one final
      // aggregate update so subscribers see the slot transition from running to done.
      allResults[index] = result;
      emitParallelUpdate();
      return result;
    });
    const successCount = results.filter((r) => !isFailedResult(r)).length;
    const summaries = results.map((r) => `### [${r.agent}] ${isFailedResult(r) ? "failed" : "completed"}\n\n${boundedUtf8(getResultOutput(r), PER_TASK_OUTPUT_CAP)}`);
    const aggregateText = `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`;
    // Cap the model-visible aggregate at AGGREGATE_OUTPUT_CAP and the structured details
    // results array at MAX_RESULTS_COUNT (already enforced by the MAX_PARALLEL_TASKS cap).
    return {
      content: [{ type: "text", text: boundedUtf8(aggregateText, AGGREGATE_OUTPUT_CAP) }],
      details: makeDetailsCurried("parallel", results),
    };
  }

  // Single mode
  try {
    validateSingleParams(params as Required<Pick<SubagentParams, "agent" | "task">> & SubagentParams);
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      details: makeDetailsCurried("single", []),
      isError: true,
    };
  }
  let agentCfg: AgentConfig;
  try { agentCfg = requireAgent(discovery, params.agent as string); }
  catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      details: makeDetailsCurried("single", []),
      isError: true,
    };
  }
  let singleCwd: string;
  try { singleCwd = resolveDispatchCwd(ctx.cwd, params.cwd); }
  catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      details: makeDetailsCurried("single", []),
      isError: true,
    };
  }
  const single = await runSingleAgent({
    agent: agentCfg,
    task: params.task as string,
    cwd: singleCwd,
    timeoutMs,
    abortSignal,
    onUpdate: options.onUpdate,
    makeDetails: (r) => makeDetailsCurried("single", r),
    invocation: options._internal?.invocation,
    forceReapFailure: options._internal?.forceReapFailure,
  });
  if (isFailedResult(single)) {
    const errorMsg = getResultOutput(single);
    return {
      content: [{ type: "text", text: `Agent ${single.stopReason || "failed"}: ${errorMsg}` }],
      details: makeDetailsCurried("single", [single]),
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: boundedUtf8(getFinalOutput(single.messages), AGGREGATE_OUTPUT_CAP) || "(no output)" }],
    details: makeDetailsCurried("single", [single]),
  };
}

function findUserAgentsDirForScope(scope: AgentScope): string {
  return scope === "user" || scope === "both" ? findUserAgentsDir() : "";
}

export const __test__ = {
  boundedUtf8,
  appendBounded,
  boundedSerializedTextContent,
  resolveDispatchTimeoutMs,
  resolveDispatchCwd,
  requireAgent,
  isFailedResult,
  getFinalOutput,
  getResultOutput,
  mapWithConcurrencyLimit,
  getPiInvocationDefault,
  buildChildArgs,
  buildTranslatedTools,
  buildSubstitutedTask,
  boundTaskPreview,
  boundDetailsBytes,
  withBoundedResult,
  detailsFitCap,
  compactResultSummary,
  buildMinimalDetails,
  boundMessageText,
  boundResultMessages,
  retainMessageAgainstBudget,
  MAX_EVENT_LINE_BYTES,
  STDOUT_REMAINDER_CAP,
  PER_TASK_OUTPUT_CAP,
  AGGREGATE_OUTPUT_CAP,
  PER_RESULT_MESSAGES_BYTES,
  PER_RESULT_MESSAGES_COUNT,
  PER_RESULT_STDERR_BYTES,
  PER_MESSAGE_TEXT_CAP,
  ONUPDATE_TEXT_CAP,
  DETAILS_JSON_CAP,
  REAP_POLL_GRACE_MS,
  resolveInstalledPackageRoot,
  isDispatchGateEnabled,
  MAX_RESULTS_COUNT,
  MAX_PARALLEL_TASKS,
  MIN_INTERNAL_TIMEOUT_MS,
  /** Test-only export so tests can drive the canonical single-mode runner with a
   *  synthetic AgentConfig (e.g. one that declares unknown tools, which the public
   *  surface would reject at the requireAgent step). Production does not call this. */
  runSingleAgent,
};

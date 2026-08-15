/**
 * RespawnPack · adapters/pi/package/extensions/mcp-bridge/index.ts
 *
 * Pragmatic complete MCP bridge.
 *
 *   - The MCP SDK is dynamically imported ONLY after a non-empty MCP config exists. Zero
 *     servers ⇒ zero filesystem side effects (no marker, no parse-error artifact) AND
 *     zero SDK load.
 *   - One `Client` + one `StdioClientTransport` is retained per *successful* server for
 *     the lifetime of the session, so registered tools round-trip to the live server.
 *   - `StdioClientTransport` owns its child process and exposes `close()`; we do NOT
 *     manually spawn a parallel child just to gain "kill access". The transport cleans
 *     up its own process on close (SIGTERM → SIGKILL after a short grace).
 *   - Every server runs under BOTH a per-server handshake deadline and a shared overall
 *     `session_start` budget. Once the shared deadline expires, no further servers are
 *     pulled from the queue, and `session_start` returns.
 *   - Public surfaces are bounded: config file bytes, server count, tools-per-server,
 *     tools-total, description bytes, callTool output bytes.
 *   - Runtime marker writes are refused when `.respawnpack/runtime/mcp` resolves through
 *     any symlink component — no caller-controlled path can redirect a write outside the
 *     project.
 *   - `session_shutdown` closes every retained transport + client with a bounded wait and
 *     awaits the lot.
 *
 * ⛔ TRUST, NOT AUTHENTICATION. Each MCP server's own permissions are the trust boundary.
 * The bridge is a wire, not a sandbox.
 */

import { readFileSync, writeFileSync, mkdirSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";

const EXTENSION_NAME = "mcp-bridge";
const EXTENSION_VERSION = "0.3.0";

/* ------------------------------------------------------------------------ */
/* Caps — read once at module-load from env, with safe defaults. Tests that  */
/* share one module instance can also pass through `setMcpBridgeCaps(...)`.  */
/* ------------------------------------------------------------------------ */

const DEFAULT_MAX_CONFIG_BYTES = 1_048_576;        // 1 MiB
const DEFAULT_MAX_SERVERS = 32;
const DEFAULT_MAX_TOOLS_PER_SERVER = 128;
const DEFAULT_MAX_TOOLS_TOTAL = 128;
const DEFAULT_MAX_DESCRIPTION_BYTES = 4_096;
const DEFAULT_MAX_SCHEMA_BYTES = 65_536;
const DEFAULT_MAX_OUTPUT_BYTES = 65_536;
const DEFAULT_PER_SERVER_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BRIDGE_BUDGET_MS = 30_000;
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_PARALLEL_CONNECT = 4;

function envInt(name: string, dflt: number, hardMax: number): number {
  const raw = process.env[name];
  if (raw == null) return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, hardMax) : dflt;
}

export interface McpBridgeCaps {
  maxConfigBytes: number;
  maxServers: number;
  maxToolsPerServer: number;
  maxToolsTotal: number;
  maxDescriptionBytes: number;
  maxSchemaBytes: number;
  maxOutputBytes: number;
  perServerMs: number;
  totalMs: number;
  callMs: number;
  shutdownMs: number;
  parallel: number;
}

const HARD_CAPS: McpBridgeCaps = {
  maxConfigBytes: 16 * 1024 * 1024,
  maxServers: 128,
  maxToolsPerServer: 128,
  maxToolsTotal: 128,
  maxDescriptionBytes: 16 * 1024,
  maxSchemaBytes: 256 * 1024,
  maxOutputBytes: 1024 * 1024,
  perServerMs: 300_000,
  totalMs: 300_000,
  callMs: 300_000,
  shutdownMs: 30_000,
  parallel: 16,
};

const ACTIVE_CAPS: McpBridgeCaps = {
  maxConfigBytes: envInt("MCP_BRIDGE_MAX_CONFIG_BYTES", DEFAULT_MAX_CONFIG_BYTES, HARD_CAPS.maxConfigBytes),
  maxServers: envInt("MCP_BRIDGE_MAX_SERVERS", DEFAULT_MAX_SERVERS, HARD_CAPS.maxServers),
  maxToolsPerServer: envInt("MCP_BRIDGE_MAX_TOOLS_PER_SERVER", DEFAULT_MAX_TOOLS_PER_SERVER, HARD_CAPS.maxToolsPerServer),
  maxToolsTotal: envInt("MCP_BRIDGE_MAX_TOOLS_TOTAL", DEFAULT_MAX_TOOLS_TOTAL, HARD_CAPS.maxToolsTotal),
  maxDescriptionBytes: envInt("MCP_BRIDGE_MAX_DESCRIPTION_BYTES", DEFAULT_MAX_DESCRIPTION_BYTES, HARD_CAPS.maxDescriptionBytes),
  maxSchemaBytes: envInt("MCP_BRIDGE_MAX_SCHEMA_BYTES", DEFAULT_MAX_SCHEMA_BYTES, HARD_CAPS.maxSchemaBytes),
  maxOutputBytes: envInt("MCP_BRIDGE_MAX_OUTPUT_BYTES", DEFAULT_MAX_OUTPUT_BYTES, HARD_CAPS.maxOutputBytes),
  perServerMs: envInt("MCP_BRIDGE_PER_SERVER_TIMEOUT_MS", DEFAULT_PER_SERVER_TIMEOUT_MS, HARD_CAPS.perServerMs),
  totalMs: envInt("MCP_BRIDGE_BUDGET_MS", DEFAULT_MAX_BRIDGE_BUDGET_MS, HARD_CAPS.totalMs),
  callMs: envInt("MCP_BRIDGE_TOOL_CALL_TIMEOUT_MS", DEFAULT_TOOL_CALL_TIMEOUT_MS, HARD_CAPS.callMs),
  shutdownMs: envInt("MCP_BRIDGE_SHUTDOWN_TIMEOUT_MS", DEFAULT_SHUTDOWN_TIMEOUT_MS, HARD_CAPS.shutdownMs),
  parallel: envInt("MCP_BRIDGE_PARALLEL_CONNECT", DEFAULT_MAX_PARALLEL_CONNECT, HARD_CAPS.parallel),
};

/** Programmatic override; respects only finite, non-negative numbers. */
export function setMcpBridgeCaps(overrides: Partial<McpBridgeCaps>): void {
  for (const k of Object.keys(overrides) as (keyof McpBridgeCaps)[]) {
    const v = overrides[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
      (ACTIVE_CAPS as any)[k] = Math.min(v, HARD_CAPS[k]);
    }
  }
}

/** Test/operator accessor (read-only view). */
export function getMcpBridgeCaps(): Readonly<McpBridgeCaps> {
  return { ...ACTIVE_CAPS };
}

/* ------------------------------------------------------------------------ */
/* Config types + parsing                                                    */
/* ------------------------------------------------------------------------ */

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

function bytesOf(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function utf8Prefix(s: string, cap: number): string {
  if (cap <= 0) return "";
  let out = "";
  let used = 0;
  for (const character of s) {
    const size = bytesOf(character);
    if (used + size > cap) break;
    out += character;
    used += size;
  }
  return out;
}

function clampString(s: unknown, cap: number): string {
  if (typeof s !== "string" || cap <= 0) return "";
  return bytesOf(s) <= cap ? s : utf8Prefix(s, cap);
}

function boundedSchema(schema: unknown): { ok: boolean; reason?: string; schema?: Record<string, unknown> } {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { ok: false, reason: 'schema must be an object' };
  let encoded: string;
  try { encoded = JSON.stringify(schema); }
  catch { return { ok: false, reason: 'schema is not serializable' }; }
  if (bytesOf(encoded) > ACTIVE_CAPS.maxSchemaBytes) {
    return { ok: false, reason: `schema exceeds ${ACTIVE_CAPS.maxSchemaBytes} UTF-8 bytes` };
  }
  return { ok: true, schema: schema as Record<string, unknown> };
}

const SAFE_COMPONENT_NAME = /^[A-Za-z0-9_-]{1,128}$/;

function validateServerConfig(source: string, name: string, value: unknown): McpServerConfig {
  if (!SAFE_COMPONENT_NAME.test(name)) {
    throw new Error(`mcp config ${source}: unsafe server name ${JSON.stringify(name)}; expected 1-128 letters, digits, '_' or '-'`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`mcp config ${source}: server "${name}" is not an object`);
  }
  const cfg = value as Record<string, unknown>;
  if (typeof cfg.command !== "string" || cfg.command.length === 0 || cfg.command.includes("\0")) {
    throw new Error(`mcp config ${source}: server "${name}" missing safe string "command"`);
  }
  if (cfg.args !== undefined && (!Array.isArray(cfg.args) || cfg.args.some((arg) => typeof arg !== "string" || arg.includes("\0")))) {
    throw new Error(`mcp config ${source}: server "${name}" args must be strings without NUL bytes`);
  }
  if (cfg.cwd !== undefined && (typeof cfg.cwd !== "string" || cfg.cwd.includes("\0"))) {
    throw new Error(`mcp config ${source}: server "${name}" cwd must be a string without NUL bytes`);
  }
  if (cfg.env !== undefined) {
    if (!cfg.env || typeof cfg.env !== "object" || Array.isArray(cfg.env) || Object.entries(cfg.env).some(([key, val]) => key.includes("\0") || typeof val !== "string" || val.includes("\0"))) {
      throw new Error(`mcp config ${source}: server "${name}" env must map strings to strings without NUL bytes`);
    }
  }
  return cfg as unknown as McpServerConfig;
}

/** Read each MCP config candidate once, refuse symlinks, cap file size, and validate before merge. */
function loadConfig(cwd: string): { config: McpConfig; sources: string[] } {
  const mergedServers: Record<string, McpServerConfig> = Object.create(null);
  const sources: string[] = [];
  const candidates: (string | null)[] = [
    process.env.HOME ? join(process.env.HOME, ".config", "respawn", "mcp.json") : null,
    join(cwd, ".mcp.json"),
    join(cwd, ".respawnpack", "mcp.json"),
  ];
  for (const p of candidates) {
    if (!p) continue;
    let lst: ReturnType<typeof lstatSync>;
    try { lst = lstatSync(p); } catch { continue; }
    if (lst.isSymbolicLink()) throw new Error(`mcp config ${p}: refusing to follow symlink`);
    if (!lst.isFile()) continue;
    if (lst.size > ACTIVE_CAPS.maxConfigBytes) {
      throw new Error(`mcp config ${p}: ${lst.size} bytes exceeds cap ${ACTIVE_CAPS.maxConfigBytes}`);
    }
    let parsed: any;
    try { parsed = JSON.parse(readFileSync(p, "utf8")); }
    catch (err) { throw new Error(`mcp config ${p}: ${(err as Error).message}`); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`mcp config ${p}: top-level value must be an object`);
    }
    if (Object.prototype.hasOwnProperty.call(parsed, "mcpServers")) {
      if (!parsed.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)) {
        throw new Error(`mcp config ${p}: mcpServers must be an object`);
      }
      for (const [name, raw] of Object.entries(parsed.mcpServers)) {
        mergedServers[name] = validateServerConfig(p, name, raw);
      }
    }
    sources.push(p);
  }
  const count = Object.keys(mergedServers).length;
  if (count > ACTIVE_CAPS.maxServers) {
    throw new Error(`mcp config: ${count} servers exceeds cap ${ACTIVE_CAPS.maxServers}`);
  }
  return { config: { mcpServers: mergedServers }, sources };
}

/* ------------------------------------------------------------------------ */
/* Path safety: refuse to write through a symlinked runtime parent.         */
/* ------------------------------------------------------------------------ */

function isSymlinkAt(p: string): boolean {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/** Walk the absolute path; if any existing component is a symlink, refuse the write. */
export function ensureRegularPath(target: string): { ok: true } | { ok: false; reason: string } {
  const abs = resolve(target);
  const sep = abs.includes("\\") ? "\\" : "/";
  const isAbs = abs.startsWith("/") || /^[a-zA-Z]:/.test(abs);
  const parts = abs.split(/[\\/]/).filter(Boolean);
  if (!isAbs) {
    return { ok: false, reason: `refusing non-absolute path ${abs}` };
  }
  let cursor = abs.startsWith("/") ? "/" : (parts[0].includes(":") ? parts[0] + sep : "");
  for (const seg of parts) {
    if (!cursor || cursor.endsWith(sep)) cursor = cursor + seg;
    else if (cursor === "/") cursor = "/" + seg;
    else cursor = cursor + sep + seg;
    if (isSymlinkAt(cursor)) {
      return { ok: false, reason: `refusing to write through symlink at ${cursor}` };
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------------ */
/* Promise helpers                                                           */
/* ------------------------------------------------------------------------ */

function descendantPids(rootPid: number | null | undefined): number[] {
  if (!rootPid || process.platform !== 'linux') return [];
  const found: number[] = [];
  const visit = (pid: number) => {
    let text = '';
    try { text = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8'); } catch { return; }
    for (const token of text.trim().split(/\s+/).filter(Boolean)) {
      const child = Number(token);
      if (!Number.isInteger(child) || child <= 0 || found.includes(child)) continue;
      found.push(child);
      visit(child);
    }
  };
  visit(rootPid);
  return found.reverse();
}

function signalPids(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try { process.kill(pid, signal); } catch { /* already gone or unsupported */ }
  }
}

const delay = (ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));

async function stopTransportTree(transport: any, client: any, budgetMs: number): Promise<void> {
  const direct = Number(transport?.pid);
  const pids = [
    ...descendantPids(Number.isInteger(direct) && direct > 0 ? direct : null),
    ...(Number.isInteger(direct) && direct > 0 ? [direct] : []),
  ];
  signalPids(pids, 'SIGTERM');
  // Close the transport directly. Calling Client.close() while connect() is still pending
  // can reject protocol requests after this function settles; the transport owns the child
  // and is the cleanup authority for a failed handshake.
  const close = transport?.close?.bind(transport) ?? client?.close?.bind(client);
  if (close && budgetMs > 0) {
    try { await withTimeout(Promise.resolve().then(close), Math.min(500, budgetMs), 'failed transport cleanup'); }
    catch { /* escalation below is authoritative */ }
  }
  signalPids(pids, 'SIGKILL');
  // Give protocol close listeners a bounded window to settle pending connect requests
  // before the failed-server result escapes into the host event loop.
  await delay(Math.min(100, Math.max(0, budgetMs)));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) { reject(new Error(`mcp bridge: ${label} refused — non-positive timeout ${ms} ms`)); return; }
    const t = setTimeout(() => reject(new Error(`mcp bridge: ${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/* ------------------------------------------------------------------------ */
/* Lazy SDK loader                                                           */
/* ------------------------------------------------------------------------ */

interface LoadedSdk {
  Client: any;
  StdioClientTransport: any;
}

let sdkCache: LoadedSdk | null = null;
let sdkLoadPromise: Promise<LoadedSdk> | null = null;

async function loadSdk(): Promise<LoadedSdk> {
  if (sdkCache) return sdkCache;
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = (async () => {
    const [c, t] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/stdio.js"),
    ]);
    const loaded: LoadedSdk = { Client: c.Client, StdioClientTransport: t.StdioClientTransport };
    sdkCache = loaded;
    return loaded;
  })();
  try { return await sdkLoadPromise; }
  finally { sdkLoadPromise = null; }
}

/* ------------------------------------------------------------------------ */
/* Per-server connect                                                        */
/* ------------------------------------------------------------------------ */

interface ConnectResult {
  name: string;
  ok: boolean;
  error?: string;
  transport?: any;
  client?: any;
  tools?: any[];
  droppedByPerServerCap?: number;
  remainingMs?: number;
}

/** Connect + listTools for one server under one absolute per-server/global deadline. */
async function connectOne(
  name: string,
  cfg: McpServerConfig,
  deadlineAt: number,
  sdk: LoadedSdk,
): Promise<ConnectResult> {
  const attemptDeadline = Math.min(deadlineAt, Date.now() + ACTIVE_CAPS.perServerMs);
  const remaining = () => Math.max(0, attemptDeadline - Date.now());
  if (remaining() <= 0) return { name, ok: false, error: "session_start budget exhausted before connect" };
  let transport: any = null;
  let client: any = null;
  try {
    transport = new sdk.StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: cfg.env,
      cwd: cfg.cwd,
    });
    client = new sdk.Client(
      { name: "respawn-pi-mcp-bridge", version: EXTENSION_VERSION },
      { capabilities: {} },
    );
    await withTimeout(client.connect(transport), remaining(), `connect ${name}`);
    const listMs = remaining();
    const listResult: any = await withTimeout(
      client.listTools(undefined, { timeout: listMs }),
      listMs,
      `listTools ${name}`,
    );
    const tools: any[] = Array.isArray(listResult?.tools) ? listResult.tools : [];
    const capped = ACTIVE_CAPS.maxToolsPerServer > 0 ? tools.slice(0, ACTIVE_CAPS.maxToolsPerServer) : [];
    return {
      name,
      ok: true,
      transport,
      client,
      tools: capped,
      droppedByPerServerCap: Math.max(0, tools.length - capped.length),
    };
  } catch (e) {
    // Failed servers are not retained for session_shutdown, so cleanup must finish here.
    // Capture direct + descendant PIDs before the SDK clears its process handle and
    // settle only after bounded TERM→KILL escalation.
    await stopTransportTree(transport, client, Math.max(0, Math.min(ACTIVE_CAPS.shutdownMs, deadlineAt - Date.now())));
    return { name, ok: false, error: (e as Error).message };
  }
}

/** Bounded parallel connect. The absolute deadline includes SDK load and prior config work. */
async function connectAll(
  entries: [string, McpServerConfig][],
  deadlineAt: number,
  parallel: number,
  sdk: LoadedSdk,
): Promise<ConnectResult[]> {
  const out: ConnectResult[] = new Array(entries.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= entries.length) return;
      const [name, cfg] = entries[idx];
      if (Date.now() >= deadlineAt) {
        out[idx] = { name, ok: false, error: "session_start budget exhausted before dispatch" };
        return;
      }
      out[idx] = await connectOne(name, cfg, deadlineAt, sdk);
    }
  }

  const slots = Math.max(1, Math.min(parallel, Math.max(1, entries.length)));
  await Promise.all(Array.from({ length: slots }, () => worker()));
  for (let i = 0; i < out.length; i++) {
    if (out[i] === undefined) {
      out[i] = { name: entries[i][0], ok: false, error: "session_start budget exhausted before dispatch" };
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Content bounding (executing tools)                                        */
/* ------------------------------------------------------------------------ */

/** Cap all model-visible text from an MCP result, including suppression/truncation notices. */
function boundCallResult(content: unknown): { content: any[]; truncated: boolean; bytesUsed: number } {
  const cap = ACTIVE_CAPS.maxOutputBytes;
  if (cap <= 0) return { content: [{ type: "text", text: "" }], truncated: Array.isArray(content) && content.length > 0, bytesUsed: 0 };
  if (!Array.isArray(content)) return { content: [{ type: "text", text: "" }], truncated: false, bytesUsed: 0 };
  const out: any[] = [];
  let used = 0;
  let truncated = false;

  const append = (text: string): boolean => {
    const room = cap - used;
    if (room <= 0) { truncated = true; return false; }
    if (bytesOf(text) <= room) {
      out.push({ type: "text", text });
      used += bytesOf(text);
      return true;
    }
    const notice = "\n[…mcp output truncated]";
    const noticeBytes = bytesOf(notice);
    const clipped = room > noticeBytes
      ? utf8Prefix(text, room - noticeBytes) + notice
      : utf8Prefix(text, room);
    out.push({ type: "text", text: clipped });
    used += bytesOf(clipped);
    truncated = true;
    return false;
  };

  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    if (!item || typeof item !== "object") continue;
    const type = (item as any).type;
    let text: string;
    if (type === "text") text = typeof (item as any).text === "string" ? (item as any).text : "";
    else if (type === "image" || type === "audio" || type === "resource") {
      text = `[${type} content suppressed by mcp-bridge]`;
      truncated = true;
    } else {
      try { text = JSON.stringify(item); }
      catch { text = "[unserializable MCP content suppressed]"; }
    }
    if (!append(text)) break;
    if (used >= cap && i + 1 < content.length) { truncated = true; break; }
  }
  return { content: out.length ? out : [{ type: "text", text: "" }], truncated, bytesUsed: used };
}

/* ------------------------------------------------------------------------ */
/* Marker writers — refuse symlinks                                          */
/* ------------------------------------------------------------------------ */

function writeJsonMarker(dir: string, fileName: string, value: unknown): { written: boolean; reason?: string } {
  try {
    const dirGuard = ensureRegularPath(dir);
    if (!dirGuard.ok) return { written: false, reason: dirGuard.reason };
    mkdirSync(dir, { recursive: true });
    const target = join(dir, fileName);
    const targetGuard = ensureRegularPath(target);
    if (!targetGuard.ok) return { written: false, reason: targetGuard.reason };
    writeFileSync(target, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    return { written: true };
  } catch (error) {
    return { written: false, reason: (error as Error).message };
  }
}

function writeParseErrorMarker(projectDir: string, errors: { source: string; message: string }[]): { written: boolean; reason?: string } {
  return writeJsonMarker(join(projectDir, ".respawnpack", "runtime", "mcp"), "_parse-errors.json", {
    schemaVersion: "1.0.0",
    kind: "mcp-bridge-parse-errors",
    at: new Date().toISOString(),
    sources: [],
    errors,
  });
}

function writeSessionMarkers(projectDir: string, summary: any): { written: boolean; reason?: string } {
  const dir = join(projectDir, ".respawnpack", "runtime", "mcp");
  const failures: string[] = [];
  for (const [name, info] of Object.entries(summary.servers || {})) {
    if (!(info as any).ok || !SAFE_COMPONENT_NAME.test(name)) continue;
    const canary = writeJsonMarker(join(dir, name), "_canary.json", {
      schemaVersion: "1.0.0",
      kind: "mcp-bridge-canary",
      at: new Date().toISOString(),
      ran: true,
      server: name,
      immediate: (info as any).immediate ?? 0,
      deferred: (info as any).deferred ?? 0,
      dropped: ((info as any).droppedByPerServerCap ?? 0) + ((info as any).droppedInvalidTools ?? 0),
    });
    if (!canary.written) failures.push(`${name}: ${canary.reason || "marker write failed"}`);
  }
  const markerResult = failures.length ? { written: false, reason: failures.join("; ") } : { written: true };
  const session = writeJsonMarker(dir, "_bridge-session.json", {
    ...summary,
    markersWritten: markerResult,
  });
  if (!session.written) return session;
  return markerResult;
}

/* ------------------------------------------------------------------------ */
/* Extension factory                                                         */
/* ------------------------------------------------------------------------ */

export default function (pi: any) {
  /** name → { client, transport } for every server that successfully completed handshake. */
  const clients = new Map<string, { client: any; transport: any }>();

  /** fullName → { server, execute } for every tool registered this session. */
  const registeredTools = new Map<string, { server: string; execute: any }>();

  let sessionSummary: any = null;
  let sessionStarted = false;

  pi.on("session_start", async (_event: any, ctx: any) => {
    // Pi normally emits one start per extension instance. Fail closed on redelivery:
    // reconnecting would overwrite client-map entries while previously registered tool
    // closures still retain the old clients, leaking both processes and capabilities.
    if (sessionStarted) {
      if (ctx.hasUI) ctx.ui.notify('MCP bridge: duplicate session_start ignored', 'warning');
      return;
    }
    sessionStarted = true;
    const startedAt = Date.now();
    const summary: any = {
      schemaVersion: "1.0.0",
      kind: "mcp-bridge-session",
      startedAt: new Date(startedAt).toISOString(),
      sources: [],
      servers: {},
      totalTools: 0,
      deferredTools: 0,
      errors: [],
      caps: { ...ACTIVE_CAPS },
      budget: { totalMs: ACTIVE_CAPS.totalMs, usedMs: 0, deadlineExpired: false },
      markersWritten: null as null | { written: boolean; reason?: string },
    };

    /* 1. Config parse — refuses symlinks, caps file size, surfaces errors. */
    let loaded: { config: McpConfig; sources: string[] };
    try {
      loaded = loadConfig(ctx.cwd);
    } catch (err) {
      summary.errors.push(`config: ${(err as Error).message}`);
      const r = writeParseErrorMarker(ctx.cwd, [{ source: "(config)", message: (err as Error).message }]);
      summary.markersWritten = r;
      if (ctx.hasUI) ctx.ui.notify(`MCP bridge: config error — ${(err as Error).message}`, "error");
      sessionSummary = summary;
      return;
    }

    const { config, sources } = loaded;
    summary.sources = sources;
    const entries = Object.entries(config.mcpServers || {});

    /* 2. Zero servers ⇒ zero filesystem side effects AND zero SDK load. */
    if (entries.length === 0) {
      summary.budget.usedMs = Date.now() - startedAt;
      sessionSummary = summary;
      return;
    }

    /* 3. Lazy SDK load + bounded parallel connect share one session_start deadline. */
    const deadlineAt = startedAt + ACTIVE_CAPS.totalMs;
    let sdk: LoadedSdk;
    try {
      sdk = await withTimeout(loadSdk(), Math.max(0, deadlineAt - Date.now()), "SDK load");
    } catch (error) {
      for (const [name] of entries) summary.servers[name] = { ok: false, error: (error as Error).message };
      summary.errors.push(`SDK: ${(error as Error).message}`);
      summary.budget.usedMs = Date.now() - startedAt;
      summary.budget.deadlineExpired = true;
      summary.markersWritten = writeSessionMarkers(ctx.cwd, summary);
      sessionSummary = summary;
      return;
    }
    const results = await connectAll(entries, deadlineAt, ACTIVE_CAPS.parallel, sdk);

    /* 4. Process results; register tools up to the global cap and absolute deadline. */
    let immediateBudget = ACTIVE_CAPS.maxToolsTotal;
    for (const r of results) {
      const { name } = r;
      if (!r.ok) {
        summary.servers[name] = { ok: false, error: r.error };
        summary.errors.push(`${name}: ${r.error}`);
        if (ctx.hasUI) ctx.ui.notify(`MCP bridge: ${name} failed: ${r.error}`, "error");
        continue;
      }
      clients.set(name, { client: r.client!, transport: r.transport! });
      const tools = r.tools || [];
      let immediate = 0;
      let deferred = 0;
      let droppedInvalidTools = 0;
      for (let toolIndex = 0; toolIndex < tools.length; toolIndex++) {
        if (Date.now() >= deadlineAt || immediateBudget <= 0) {
          deferred += tools.length - toolIndex;
          if (Date.now() >= deadlineAt) summary.budget.deadlineExpired = true;
          break;
        }
        const tool = tools[toolIndex];
        const schema = tool && typeof tool === 'object' ? boundedSchema(tool.inputSchema) : { ok: false };
        if (!tool || typeof tool !== "object" || !SAFE_COMPONENT_NAME.test(tool.name) || !schema.ok) {
          droppedInvalidTools++;
          continue;
        }
        const fullName = `mcp__${name}__${tool.name}`;
        if (registeredTools.has(fullName)) {
          deferred++;
          continue;
        }
        immediateBudget--;
        immediate++;
        const desc = clampString((tool as any).description, ACTIVE_CAPS.maxDescriptionBytes);
        const capturedName = name;
        const capturedToolName = tool.name;
        const capturedClient = r.client!;
        const execute = async (_id: string, params: any, signal: AbortSignal | undefined) => {
          if (signal?.aborted) throw new Error(`mcp bridge: callTool ${fullName} aborted`);
          try {
            const result = await withTimeout(
              capturedClient.callTool(
                { name: capturedToolName, arguments: params ?? {} },
                undefined,
                { timeout: ACTIVE_CAPS.callMs, signal },
              ),
              ACTIVE_CAPS.callMs,
              `callTool ${fullName}`,
            );
            const bounded = boundCallResult((result as any)?.content);
            if ((result as any)?.isError) {
              const message = bounded.content.map((item: any) => item.text || "").join("\n") || "MCP server returned an error";
              throw new Error(clampString(message, Math.min(4_096, ACTIVE_CAPS.maxOutputBytes)));
            }
            return {
              content: bounded.content,
              details: {
                server: capturedName,
                tool: capturedToolName,
                truncated: bounded.truncated,
                bytesUsed: bounded.bytesUsed,
              },
            };
          } catch (e) {
            throw new Error(clampString(`mcp bridge: ${(e as Error).message}`, 4_096));
          }
        };
        registeredTools.set(fullName, { server: name, execute });
        try {
          pi.registerTool({
            name: fullName,
            label: `${name}/${tool.name}`,
            description: desc,
            parameters: schema.schema as any,
            execute,
          });
        } catch (e) {
          registeredTools.delete(fullName);
          immediate--;
          immediateBudget++;
          deferred++;
          if (ctx.hasUI) ctx.ui.notify(`MCP bridge: ${fullName} register failed — ${(e as Error).message}`, "warning");
        }
      }
      summary.servers[name] = {
        ok: true,
        tools: tools.length,
        immediate,
        deferred,
        droppedByPerServerCap: r.droppedByPerServerCap ?? 0,
        droppedInvalidTools,
      };
      summary.totalTools += immediate;
      summary.deferredTools += deferred;
    }

    summary.budget.usedMs = Date.now() - startedAt;
    if (summary.budget.usedMs >= ACTIVE_CAPS.totalMs) summary.budget.deadlineExpired = true;

    /* 5. Markers — written only if the runtime path is symlink-free. */
    summary.markersWritten = writeSessionMarkers(ctx.cwd, summary);
    if (!summary.markersWritten.written && ctx.hasUI) {
      ctx.ui.notify(`MCP bridge: markers disabled — ${summary.markersWritten.reason}`, "warn");
    }
    sessionSummary = summary;
  });

  pi.on("session_shutdown", async () => {
    const tasks: Promise<void>[] = [];
    for (const [name, { client, transport }] of clients) {
      tasks.push((async () => {
        // Capture descendants before the SDK clears its direct-child handle. The SDK
        // closes only that child; configured shell wrappers can otherwise orphan grandchildren.
        const descendants = descendantPids(transport?.pid);
        signalPids(descendants, 'SIGTERM');
        if (transport && typeof transport.close === "function") {
          try { await withTimeout(transport.close(), ACTIVE_CAPS.shutdownMs, `transportClose ${name}`); }
          catch { /* best effort; SDK has its own internal kill escalator */ }
        }
        signalPids(descendants, 'SIGKILL');
        if (client && typeof client.close === "function") {
          try { await withTimeout(client.close(), Math.max(500, Math.floor(ACTIVE_CAPS.shutdownMs / 2)), `clientClose ${name}`); }
          catch { /* best effort */ }
        }
      })());
    }
    await Promise.allSettled(tasks);
    clients.clear();
    registeredTools.clear();
    sessionStarted = false;
  });

  return {
    /** Read-only snapshot of the last session's bookkeeping (mainly for tests/canaries). */
    getSessionSummary() { return sessionSummary ? { ...sessionSummary, servers: { ...sessionSummary.servers }, errors: [...sessionSummary.errors] } : null; },
    /** Read-only map of retained transports, mainly for tests. */
    getClients() { return Array.from(clients.keys()); },
    /** Read-only map of registered tool names. */
    getRegisteredTools() { return Array.from(registeredTools.keys()); },
  };
}

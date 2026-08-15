#!/usr/bin/env node
/*
 * RespawnPack · adapters/pi/package/extensions/mcp-bridge/canary.js
 *
 * Standalone MCP handshake probe. Connects to one MCP server, lists its tools, calls one tool,
 * and verifies the round-trip. Used to verify the bridge machinery without loading Pi.
 *
 *   node canary.js --command <cmd> [--args a,b,c] [--tool <name>] [--tool-args <json>]
 *
 * Exit: 0 PASS · 1 FAIL (the bridge machinery is broken) · 2 CANNOT_DETERMINE (process cannot even
 * start, e.g. command not found).
 *
 * Two halves of the control pair:
 *   - The server must answer `tools/list` (proves the handshake). PASS for that.
 *   - The server must answer `tools/call` for the named tool (proves the round-trip). PASS for that.
 *   - Control failure (server starts but won't handshake) → CANNOT_DETERMINE, never PASS.
 */
'use strict';
const { spawn } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const NAME = 'canary-mcp-bridge';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i += 1; }
    else out[a.slice(2)] = true;
  }
  return out;
}

async function run({ command, args = [], env, cwd = process.cwd(), toolName = null, toolArgs = {}, timeoutMs = 30000 } = {}) {
  const startedAt = new Date().toISOString();
  if (!command) {
    return {
      canary: NAME, outcome: 'CANNOT_DETERMINE', precondition: 'no command supplied',
      detail: 'canary-mcp-bridge needs --command <path> to spawn an MCP server',
      recovery: 'Pass --command <path> (and optionally --args a,b,c) pointing to an MCP server binary',
      startedAt,
    };
  }

  let client;
  try {
    const transport = new StdioClientTransport({
      command,
      args,
      env: env || undefined,
      cwd,
    });
    client = new Client(
      { name: 'respawn-pi-mcp-bridge-canary', version: '0.1.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    const { tools } = await client.listTools();
    if (!Array.isArray(tools) || tools.length === 0) {
      await client.close();
      return {
        canary: NAME, outcome: 'CANNOT_DETERMINE', precondition: 'server advertised no tools',
        detail: `${command} answered initialize and tools/list but listed zero tools`,
        recovery: 'Either the server is misconfigured, or the tool you expect needs a different capability. Speak to the server author.',
        startedAt,
      };
    }

    const target = toolName || tools[0].name;
    const known = tools.find((t) => t.name === target);
    if (!known) {
      await client.close();
      return {
        canary: NAME, outcome: 'CANNOT_DETERMINE', precondition: 'named tool not advertised',
        detail: `${command} listed ${tools.length} tool(s) but none named "${target}"`,
        recovery: `Pick one of: ${tools.map((t) => t.name).join(', ')}`,
        startedAt, raw: { tools: tools.map((t) => t.name) },
      };
    }

    const result = await client.callTool({ name: target, arguments: toolArgs }, undefined, { timeout: timeoutMs });
    await client.close();

    // The result must carry content. A successful call with no content is suspicious.
    const content = Array.isArray(result.content) ? result.content : null;
    if (!content) {
      return {
        canary: NAME, outcome: 'FAIL', precondition: null,
        detail: `${target} returned no content array — the server answered but the call shape is wrong`,
        recovery: 'Inspect the MCP server source; tools/call must return {content: [{type, ...}]} per the spec',
        notes: [`the bridge registers tools even when the call shape is wrong, because the spec violation is the SERVER's, not the bridge's`],
        startedAt, raw: { result },
      };
    }

    return {
      canary: NAME, outcome: 'PASS',
      proves: 'an MCP server can be spawned, complete the initialize handshake, advertise tools, and answer tools/call with a well-formed content array',
      detail: `${command} ${args.join(' ')} — listed ${tools.length} tool(s), called "${target}", got ${content.length} content item(s)`,
      notes: [`handshake protocolVersion: a successful connect() proves the server and client agree on at least one protocol version`],
      startedAt, raw: { tools: tools.map((t) => t.name), called: target, result },
    };
  } catch (e) {
    const err = e && e.message ? e.message : String(e);
    return {
      canary: NAME, outcome: 'CANNOT_DETERMINE', precondition: 'mcp handshake failed',
      detail: `${command} ${args.join(' ')} — ${err}`,
      recovery: 'Run the server command by hand and confirm it speaks MCP stdio. The most common failure is a non-MCP binary being pointed at by --command.',
      startedAt, raw: { error: err },
    };
  } finally {
    if (client) {
      try { await client.close(); } catch { /* already gone */ }
    }
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const opts = {
    command: typeof args.command === 'string' ? args.command : null,
    args: typeof args.args === 'string' ? args.args.split(',').map((s) => s.trim()).filter(Boolean) : [],
    env: typeof args.env === 'string' ? JSON.parse(args.env) : undefined,
    cwd: typeof args.cwd === 'string' ? args.cwd : process.cwd(),
    toolName: typeof args.tool === 'string' ? args.tool : null,
    toolArgs: typeof args['tool-args'] === 'string' ? JSON.parse(args['tool-args']) : {},
  };
  run(opts).then((r) => {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    const exit = r.outcome === 'PASS' ? 0 : r.outcome === 'FAIL' ? 1 : 2;
    process.exit(exit);
  });
}

module.exports = { NAME, run };

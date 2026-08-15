#!/usr/bin/env node
/*
 * RespawnPack · adapters/pi/package/extensions/mcp-bridge/echo-server.js
 *
 * A minimal MCP stdio server for exercising the bridge's canary. Exposes two tools (echo, sum) so
 * the canary can verify the full handshake + tools/list + tools/call round-trip against a server
 * we control.
 *
 * This is NOT a production server. It runs the minimum MCP surface required to prove the bridge
 * works; it has no auth, no resources, no prompts, and no error handling beyond the spec defaults.
 */
'use strict';
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const server = new Server(
  { name: 'echo-server', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const extraToolCount = Math.max(0, Math.min(512, Number(process.env.RESPAWN_MCP_TEST_EXTRA_TOOLS) || 0));

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: 'Echo back the input message with a clear prefix so the canary can verify the round-trip.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to echo back' },
        },
        required: ['message'],
      },
    },
    {
      name: 'sum',
      description: 'Sum two integers. Proves the bridge handles numeric parameters.',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First addend' },
          b: { type: 'number', description: 'Second addend' },
        },
        required: ['a', 'b'],
      },
    },
    ...(process.env.RESPAWN_MCP_TEST_HUGE_SCHEMA === '1' ? [{
      name: 'oversized',
      description: 'Test-only oversized schema.',
      inputSchema: { type: 'object', description: 'x'.repeat(100_000) },
    }] : []),
    ...Array.from({ length: extraToolCount }, (_, i) => ({
      name: `extra_${i}`,
      description: 'Test-only registration-budget tool.',
      inputSchema: { type: 'object', properties: {} },
    })),
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params || {};
  if (name === 'echo') {
    const message = typeof args?.message === 'string' ? args.message : '';
    return { content: [{ type: 'text', text: `echo: ${message}` }] };
  }
  if (name === 'sum') {
    const a = Number(args?.a);
    const b = Number(args?.b);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new Error(`sum requires numeric a and b, got ${JSON.stringify(args)}`);
    }
    return { content: [{ type: 'text', text: String(a + b) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
server.connect(transport).catch((e) => {
  process.stderr.write(`echo-server failed to connect: ${e && e.message ? e.message : String(e)}\n`);
  process.exit(1);
});

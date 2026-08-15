# mcp-bridge

A Pi extension that surfaces [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers as native Pi tools. Each discovered MCP tool becomes `mcp__<server>__<tool>` and is forwarded to the underlying server on every call.

## What it does

1. On `session_start`, reads the merged MCP config from `~/.config/respawn/mcp.json`, `<project>/.mcp.json`, and `<project>/.respawnpack/mcp.json` (later wins).
2. Spawns each configured server over stdio, completes the MCP `initialize` handshake, and calls `tools/list`.
3. Registers bounded, valid discovered tools as Pi tools named `mcp__<server>__<tool>`; invalid or over-budget tools are dropped and counted in the session summary.
4. Forwards each registered Pi tool call to the server via `tools/call`, with bounded output and a call timeout.
5. Writes a per-server evidence marker at `<project>/.respawnpack/runtime/mcp/<server>/_canary.json`.
6. On `session_shutdown`, attempts bounded client/transport cleanup; on Linux it also terminates descendants left by configured shell wrappers.

## What it does NOT do

- Sandbox. Each MCP server's own permissions are the trust boundary.
- Authenticate. The bridge forwards credentials via the server's `env` config.
- Restrict network egress. Whatever the server can reach, the bridge can reach.
- Negotiate MCP streamable-HTTP. Stdio is the only transport; HTTP lands when the upstream spec stabilises.

## Config

Either of these files works:

```json
// .mcp.json (Claude-compatible)
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<from operator env>" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    }
  }
}
```

```json
// .respawnpack/mcp.json (RespawnPack-native)
{
  "mcpServers": {
    "github": { "command": "gh-mcp-server", "args": ["--stdio"] }
  }
}
```

## Resource limits

The bridge defaults to 32 servers, 128 retained tools per server, and 128 registered tools total, with 4 KiB descriptions, 64 KiB input schemas, and 64 KiB returned output. Startup (including schema processing and registration), calls, shutdown, and parallel connection count are bounded too. Over-budget tools are reported but not exposed as callable Pi tools. Operators may override limits with the `MCP_BRIDGE_MAX_*`, `MCP_BRIDGE_*_TIMEOUT_MS`, `MCP_BRIDGE_BUDGET_MS`, and `MCP_BRIDGE_PARALLEL_CONNECT` environment variables; values must be finite non-negative integers and are clamped to implementation hard maxima. A configured server still runs with the operator's permissions—these limits are resource controls, not a sandbox.

## Verifying

```sh
cd adapters/pi/package/extensions/mcp-bridge
npm install                                 # already done if you cloned with deps
node canary.js --command "$(pwd)/echo-server.js" --tool echo --tool-args '{"message":"hi"}'
```

The canary spawns the named server, completes the handshake, lists tools, calls one, and reports PASS / FAIL / CANNOT_DETERMINE with the same vocabulary the rest of the adapters use.

## Layout

```
adapters/pi/package/extensions/mcp-bridge/
  package.json          # @modelcontextprotocol/sdk
  index.ts              # the extension entry Pi loads
  canary.js             # standalone handshake probe
  echo-server.js        # a tiny MCP server used by the canary for verification
  README.md
```

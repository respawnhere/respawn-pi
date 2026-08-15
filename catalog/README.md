# Optional integration catalog

RespawnPi ships thin operational skills for these external services. The skills provide routing, safety, and fallback guidance; they do not install, authenticate, or enable a service automatically.

| Integration | Shipped skill | Default posture |
|---|---|---|
| Context7 | `mcp-context7` | Optional hosted documentation lookup; verify returned material against the pinned dependency. |
| Fly.io | `mcp-fly` | Read-only diagnostics by default; state changes require explicit authorization. |
| GitHub | `mcp-github` | MCP-first repository operations with explicit authorization for outward changes. |
| Graphify | `mcp-graphify` | Optional code-graph analysis with a documented local fallback. |
| Docker MCP Gateway | `mcp-runtime` | Optional gateway operations; secrets remain outside repository configuration. |
| JavaScript dependency audit | `mcp-security-audit` | Optional dependency CVE analysis; unavailable service is reported, not passed. |
| Supabase | `mcp-supabase` | Read-only by default; migrations, production writes, and costs require authorization. |

An integration is available only when its required client, credentials, and service are configured by the operator. Installing RespawnPi alone does not create external connections or grant production access.

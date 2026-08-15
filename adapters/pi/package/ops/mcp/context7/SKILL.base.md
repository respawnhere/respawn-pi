---
name: mcp-context7
description: MCP-first access to current, authoritative docs for external libraries and APIs via the Context7 (Upstash) docs MCP, so build/loadout work on third-party SDKs uses live docs instead of stale model memory. This is a wrap-thin skill — it references the vendor `upstash/context7` `context7-mcp` skill for the workflow rather than restating it, and adds only RespawnPack guardrails on top.
when_to_use: ["context7", "/context7", "current docs", "library docs", "external SDK docs", "is this API still right", "look up the docs for a library", "during /loadout or /build on a third-party SDK"]
---

# /context7 — current external-library docs (MCP-first)

Use this when you need CURRENT, authoritative docs for an external library or API and model training data may be stale — typically during `/loadout` (picking/pinning deps) and `/build` (writing against a third-party SDK). This fills the one knowledge gap the RespawnPack spine + memory engine structurally cannot cover: external-dependency freshness.

## Vendor skill is the source of truth
The workflow lives in the vendor `upstash/context7` skill — `context7-mcp` (Upstash, MIT; also ships `context7-cli` and `find-docs`). Install/use that skill for the documented flow; do NOT restate or fork it here. This file adds only RespawnPack-specific usage and guardrails.

## Tool surface (already wired)
On managed infra the Context7 MCP is connected via the Docker gateway. Two tools, used in order:
1. `resolve-library-id` — resolve a library name to its Context7 id.
2. `get-library-docs` — fetch docs for that id (scope by topic/query when supported).

## Steps
1. Confirm you actually need external freshness (third-party SDK/API, version-sensitive). If it is RespawnPack-internal, use the spine + memory instead.
2. Call `resolve-library-id` FIRST to get the canonical id. <!-- invariant -->
3. Call `get-library-docs` with that id (never guess the id; never skip step 2). <!-- invariant -->
4. Treat the result as reference: verify against the project's pinned version and actual behavior before relying on it.

## Do NOT set up the CLI / OAuth
On managed infra the MCP is already wired. Do NOT run `ctx7 setup`, install the CLI, or do OAuth. <!-- invariant --> If the MCP is genuinely not connected, say so and fall back to the vendor `context7-cli` / `find-docs` per the vendor skill — and state that you are falling back.

## Caveats (state plainly)
- Hosted SaaS: your library name and query leave the box. There is no true offline mode. <!-- invariant -->
- Docs are community-crawled and un-vetted by Context7 — treat as reference, not ground truth; verify against the project before relying. <!-- invariant -->

## Invariants
- `resolve-library-id` BEFORE `get-library-docs` — never skip the resolve step, never hand-craft a library id. <!-- invariant -->
- On managed infra the MCP is pre-wired: do NOT run `ctx7 setup`, install the CLI, or perform OAuth. <!-- invariant -->
- Do not duplicate the vendor `upstash/context7` skill — reference it; it stays the source of truth. <!-- invariant -->
- Context7 is hosted SaaS: the query leaves the box, no offline mode — say so. <!-- invariant -->
- Community-crawled docs are un-vetted: treat as reference and verify against the project before relying. <!-- invariant -->
- Reads only — Context7 fetches docs and never performs a prod write; no secrets are sent (reference keys by name, never values). <!-- invariant -->

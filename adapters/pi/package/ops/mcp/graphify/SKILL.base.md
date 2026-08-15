---
name: mcp-graphify
description: "MCP-first wrapper over Graphify (Graphify-Labs/graphify, MIT): a tree-sitter code graph. Ten read-only MCP tools plus a CLI (query/path/explain/affected) answer what-calls-X, blast-radius, and symbol-path questions; routes why-questions to the memory layer instead."
when_to_use: ["graphify", "/mcp-graphify", "what calls X", "who calls this function", "blast radius", "affected by this change", "call graph", "path between two symbols", "god nodes", "hotspot review", "structural code graph", "orient in unfamiliar code", "code structure query"]
disable-model-invocation: true
---

# /mcp-graphify — structural code graph via Graphify, read-only

Drive Graphify (`Graphify-Labs/graphify`, MIT; PyPI package `graphifyy`, CLI/import name `graphify`) through its stdio MCP server or CLI. No vendor skill exists for it, so this skill orchestrates the tool directly rather than restating an upstream skill. Every tool it exposes is a **read**. <!-- invariant -->

## When to use it
Structural code questions, seeded by symbol/path, not meaning:
- "What calls `X`?" / "who depends on this function?" → `get_neighbors` / `query_graph` / `explain`.
- Blast radius of a change → `affected`.
- Path between two symbols → `shortest_path` / `path`.
- Orientation in an unfamiliar area of the codebase → `get_community` / `graph_stats` / `query_graph`.
- God-node / hotspot review → `god_nodes`.

## When NOT to use it
- **"Why is it this way" questions** — decisions, constraints, past incidents. Graphify has no concept of rationale beyond `# NOTE:`/`# WHY:`/`# HACK:` comment nodes on the Python/JS-TS AST path. Route these through `/knowledge` or `/debug` instead. <!-- invariant -->
- **Semantic / meaning-based search.** Graphify's natural-language `query` is keyword/fuzzy-seeded, not semantic — empirically it missed "what calls the lead assignment logic" because the real logic lives in `resolve_recipient()` with no keyword overlap. When a query names a *concept* rather than a *symbol*, route it through the memory layer or an agent search first to find the vocabulary (the actual function/file name), then hand that symbol to Graphify. <!-- invariant -->

## Setup (pinned)
```
pip install graphifyy==0.9.10        # pinned; or: uv tool install graphifyy==0.9.10
```
Version-pinned deliberately: upstream ships roughly 1.58 releases/day and is pre-1.0 (graph.json content drifts on most releases even without a formally marked break). Upgrade on purpose and re-test before moving the pin. <!-- invariant -->

## Build the graph (CLI)
```
graphify extract <repo> --out <dir-OUTSIDE-repo> --code-only --timing --max-workers 8
graphify cluster-only <dir> --no-label          # produces GRAPH_REPORT.md, zero-key, no LLM
```
- `--code-only` skips the LLM semantic pass entirely and needs zero API keys — the default mode for this skill.
- `--out DIR` writes to `DIR\graphify-out\`, not `DIR` itself.
- `--out` must point **outside** the repo being scanned. Even so, `extract` currently leaks `<repo>\graphify-out\cache\stat-index.json` (a stat index, no code content) back into the scanned repo — clean it up after every run, or gitignore `graphify-out/` in the target so it can never land in a commit. <!-- invariant -->
- `graphify update` (incremental re-extract) has **no** `--out` flag; it writes `graphify-out` relative to the scanned path. Override with the `GRAPHIFY_OUT` env var (absolute path; documented only in `paths.py`, not `--help`).

## Query (CLI)
```
graphify query "<text>"           --graph <dir>\graphify-out\graph.json
graphify path <idA> <idB>         --graph ...\graph.json
graphify explain <symbol>         --graph ...\graph.json
graphify affected <symbol>        --graph ...\graph.json
```

## Serve (MCP)
```
python -m graphify.serve <abs path>\graph.json            # stdio, default transport
claude mcp add graphify -- python -m graphify.serve <abs path>\graph.json
```
Use the absolute path to `graph.json` — the graph must already exist (run `extract` first). All 10 MCP tools (`query_graph`, `get_node`, `get_neighbors`, `get_community`, `god_nodes`, `graph_stats`, `shortest_path`, `list_prs`, `get_pr_impact`, `triage_prs`) plus its resources are read-only; per the pack's reads-free/writes-authorized tenet, none of this needs human authorization to run. <!-- invariant -->

HTTP transport (`--transport http`) is opt-in and off by default (stdio). If a task genuinely needs it, never bind `0.0.0.0` without `--api-key` / `GRAPHIFY_API_KEY` — an unauthenticated keyless bind still serves (only a warning prints) and there is no CORS middleware. <!-- invariant -->

## Containerized / shared serve (team)
The solo default above (pinned `pip install` + stdio serve) stays the default for a single developer: zero-secret, zero-network (code-only), installs in ~50s from prebuilt Windows wheels, and the MCP server is filesystem-coupled to a local `graph.json` anyway — nothing about a container improves that case. Reach for the container only when multiple clients need one shared team graph over the network.

Graphify ships its own Dockerfile for exactly this (upstream issue #1143). It builds from source with the `.[mcp]` extra (pulls in `mcp` + `starlette` + `uvicorn` for the HTTP transport), runs as a non-root user (uid 10001), and `EXPOSE`s 8080:
```
docker build -t graphify <graphify-source>
docker run -p 8080:8080 -v "<host graphify-out>:/data" graphify \
    /data/graph.json --transport http --host 0.0.0.0 --api-key "$SECRET"
```
`graph.json` is mounted at runtime via `-v`, never baked into the image — consistent with treating it as a disposable build artifact, not a source of truth. The `extract` step itself is not containerized; run `graphify extract` locally (or in your own build step) first to produce the `graphify-out/graph.json` that gets mounted in. Binding `0.0.0.0` inside the container is still subject to the api-key invariant above — non-negotiable, container or not.

Do not route this through RespawnPack's own Docker MCP Gateway (`/mcp-runtime`): that gateway earns its keep on keychain secret injection and signed `mcp/`-catalog isolation, neither of which applies to a keyless, non-catalog, filesystem-coupled tool — and on Windows it additionally requires WSL2 for no corresponding gain here.

## Invariants
- Never hand-edit or inject nodes/edges into `graph.json`. A `graphify update` (incremental) keeps injected nodes but silently drops injected edges; a full re-extract without `manifest.json` silently wipes everything injected. Every failure mode here is silent — there is no validator warning on load. <!-- invariant -->
- Never persist a Graphify node id anywhere durable (docs, memory, config). Ids embed the **absolute scan path** (e.g. `c_users_kraken_documents_..._lead_lead`) and are not portable across machines or checkout paths; the id algorithm has also churned across versions upstream. Record **file path + symbol name** coordinates instead, and resolve against whatever `graph.json` currently exists at read time. <!-- invariant -->
- Treat `graph.json` and `graphify-out/` as disposable, rebuildable build artifacts — never a source of truth, never referenced as if permanent. Gitignore `graphify-out/` in the target repo being scanned (see the pack's own `.gitignore` entry for the vendored evaluation copy and the `graphify-out/` rule). <!-- invariant -->
- Never `--transport http` bound to `0.0.0.0` without `--api-key` / `GRAPHIFY_API_KEY`. <!-- invariant -->
- Version-pinned (`graphifyy==0.9.10`); upgrade deliberately and re-test rather than floating the version. <!-- invariant -->
- Route "why" questions (decisions, constraints, past incidents) and vocabulary-gap searches (a concept, not a known symbol) to `/knowledge` or `/debug` first; only hand Graphify a resolved symbol/path. <!-- invariant -->

## Handoff to memory
Graphify answers what the code IS (calls / imports / blast-radius / paths — structural, keyword entry). It never explains WHY. When a structural discovery is worth keeping past this session — a real hotspot, a surprising dependency, a blast-radius finding that changed a plan — capture it as a memory entity (`gotcha:<slug>` or `infra:<component>`) via `/knowledge`, with the observation text carrying the **file path + symbol name** coordinates (never the Graphify node id). This is the query-first/capture-back discipline the memory layer already runs on: query memory for context before investigating, capture what you learned back into it on resolution.

Pairs with `/knowledge`, `/debug` (structural orientation at Step 0), `/loadout` (orientation in unfamiliar code), and `/review` (blast-radius scoping).

---
name: knowledge
description: Query or extend the project's operational memory (knowledge graph + learnings ledger). The read+write side of the memory discipline — query before investigating, capture gotchas/learnings on resolution.
when_to_use: ["what do we know about", "have we seen this", "remember this", "capture this gotcha", "log a learning", "extend the graph", "knowledge", "/knowledge"]
---

# /knowledge — query + capture operational memory

The companion to `/debug`. Two modes.

**Optional target dependencies:** `memory/graph/` may be absent on a fresh target; treat that as an empty backend, and report `CANNOT_DETERMINE` rather than inventing history when no configured memory backend is available. If an MCP or memory-engine capability is unavailable, fall back to the file backend when present, otherwise use the same `CANNOT_DETERMINE` posture.

## Query mode ("what do we know about X / have we hit this before")
1. Search the memory backend for the topic/symptom — same schema, pick what's wired: `memory_query` / `memory_recall` (the respawn-memory engine — hybrid + graph-augmented), `search_nodes` (Anthropic Memory MCP), or grep the entity files under `memory/graph/` (file backend).
2. Return the matching gotchas/infra-facts/learnings with their root-cause + fix.
3. **Verify currency** before relying on a hit — confirm the named file/flag/endpoint still exists (memory reflects when it was written).

## Capture mode ("remember this / log this gotcha")
1. Classify it (see `docs/reference/memory/knowledge-graph.md`): a **Gotcha** (symptom → root cause → fix), an **Infrastructure** fact, a **Compatibility** constraint, or a **learning** (pattern/pitfall/preference/operational).
2. **Extend, don't duplicate**: `memory_add_observation` (engine) / `add_observations` (MCP) on the right existing entity if the fact belongs to it; `memory_remember` / `create_entities` only for a genuinely new thing. Add `relations` (`fixed-by` / `relates-to` / `applies-to|skill:<name>` to feed a living skill / …) where they aid traversal.
3. For a learning, record **confidence + source** (`stated` is durable + cross-project; `observed`/`inferred` decay). Cross-project recall is allowlisted to `stated` only.
4. Use the naming convention (`gotcha:<slug>`, `infra:<component>`, …) so relations + references stay stable.

## Boundary
- Operational gotcha / infra fact / learning → here.
- Product/architecture **decision or removal** → propose a `docs/DECISIONS.md` entry instead (canonical).

## Invariants
- Query before investigating (this is what makes memory worth keeping).
- Extend over duplicate; promote confirmed hypotheses, prune disproven ones.
- Record source + confidence on learnings; gate cross-project recall to `stated`.

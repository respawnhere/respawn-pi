# Operational knowledge graph

The project memory stores verified operational knowledge separately from product decisions. Product and architecture decisions remain canonical in `docs/DECISIONS.md`.

## Entity classes

- **Gotcha:** symptom, verified root cause, fix or recovery, and evidence source.
- **Infrastructure:** a current operational fact about a service or component.
- **Compatibility:** a version, host, or integration constraint.
- **Learning:** a reusable pattern, pitfall, preference, or procedure with confidence and source.

Use stable names such as `gotcha:<slug>` and `infra:<component>`. Extend an existing entity instead of creating a duplicate. Relations such as `fixed-by`, `relates-to`, and `applies-to|skill:<name>` should exist only when they improve retrieval.

## File backend

When no memory engine or MCP is connected, store one Markdown entity per file under `memory/graph/<class>/`. A missing `memory/graph/` directory means no project memories have been captured yet; it is not evidence that a search succeeded. Query by bounded file search, verify every hit against current code, and report `CANNOT_DETERMINE` when the unavailable backend is required to answer.

## Confidence and promotion

Record the evidence source and confidence for learnings. `stated` facts may be eligible for cross-project recall; `observed` and `inferred` facts remain project-scoped and should decay or be rechecked. Candidate hypotheses are not facts: promote them only after verification, and retain rejection evidence so the same disproven lead is not recycled.

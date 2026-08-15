---
name: checkup
description: The codebase-health role — a periodic architecture scan that scores a codebase's modules against the deep-module standard (a simple interface over substantial implementation) and reports ranked deepening, merging, and deletion opportunities with file citations. Command-only; proposes structural changes, never auto-refactors. The structural-quality complement to /secure and /comply's audit loop.
when_to_use: ["/checkup", "checkup", "codebase health scan", "module health", "architecture scan", "deep-module audit", "find shallow modules", "deletion test"]
disable-model-invocation: true
---

# /checkup — codebase-health scan (module-shape lens)

A periodic architecture-health pass in the same audit-loop shape as `/secure` and `/comply`: scope the surface, score it against a standard, verify, and report ranked opportunities — proposals only, never an auto-refactor. Where `/secure` scores for vulnerabilities and `/comply` for regulatory posture, `/checkup` scores for *structural quality*: are the modules deep, or is complexity leaking through thin abstractions? Command-only by design — run it deliberately, on a cadence, not off a keyword.

## Step 0 — Read the standard + scope the surface
Read the module-shape section of `docs/reference/coding-standards.md` — it is the rubric this scan grades against. Decide the surface: the whole repo (a periodic health check) or a subsystem (a targeted look after a burst of growth). Inventory the module boundaries in scope — the packages, services, or directories that expose an interface to the rest of the code.

## Step 1 — Score each boundary against the deep-module standard
For each module, weigh interface against implementation:
- **Depth.** A good module is *deep*: a simple interface over substantial implementation, so a caller learns little and gets a lot. A *shallow* module — a wide interface over thin implementation, pass-throughs, wrappers that only forward — costs more to learn than it saves.
- **The deletion test.** For each abstraction, ask: if it were removed and folded into its caller, would the code get *simpler*? If yes, the abstraction is negative-value — it adds an interface without hiding complexity.
- **Leakage.** Does using the module force callers to know its internals — implementation types in the signature, ordering constraints, obligatory follow-up calls? Leaked complexity is depth thrown away.

## Step 2 — Rank the opportunities by leverage
Sort findings by how much complexity each change removes for its cost:
- **Deepen** — a shallow module that should hide more behind its interface.
- **Merge** — two modules so coupled the boundary between them is noise; joining them deletes an interface.
- **Delete** — an abstraction that fails the deletion test; removing it simplifies its callers.

Each finding cites the file(s) and names the concrete change.

## Step 3 — Verify, then report (propose, never refactor)
Sanity-check each finding against the code before reporting it — a boundary that looks shallow may hide real complexity you didn't read. Drop what doesn't survive. Report the ranked list: each opportunity with its file citation, the change proposed, and the complexity it would remove. **Propose only** — `/checkup` never refactors on its own; a structural change is the human's call and, if taken, becomes a `/loadout` → `/build` job with its own `DECISIONS.md` entry.

## Invariants
- Score against the module-shape section of `docs/reference/coding-standards.md` — deep modules, the deletion test, depth-as-leverage. <!-- invariant -->
- Every finding cites files and is ranked by leverage (complexity removed per unit cost). <!-- invariant -->
- Propose, never auto-refactor — a structural change routes through `/loadout` → `/build`. <!-- invariant -->
- Command-only (`disable-model-invocation`): run on a cadence, deliberately, not off a keyword. <!-- invariant -->

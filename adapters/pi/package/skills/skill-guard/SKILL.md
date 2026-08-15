---
name: skill-guard
description: Operates the living-skill mechanism — checks whether a RespawnPack-owned skill's living form (SKILL.md) has drifted from its frozen baseline (SKILL.base.md), and resets it when it has drifted too far or broken. Regenerates the "## Learned (living)" overlay from the memory engine. Applies only to RespawnPack's own skills; never touches vendor/developer-maintained skills. Aliases /skill-drift, /skill-reset.
when_to_use: ["skill-guard", "/skill-drift", "skill drift", "did my skills drift", "/skill-reset", "reset skill to baseline", "skill broke", "regenerate skill overlay", "living skill", "skill baseline"]
disable-model-invocation: true
---

# /skill-guard — keep living skills true to their baseline

If the optional memory engine is unavailable, fall back to the file backend; if neither is available, report `CANNOT_DETERMINE` and do not regenerate an overlay.

Operates the two-tier skill model in [`docs/reference/living-skills.md`](../../../../../docs/reference/living-skills.md): a frozen `SKILL.base.md` + a living `SKILL.md` (base + a regenerated `## Learned (living)` overlay) + `.skill-meta.json`. **Only RespawnPack-owned skills** (the `create-custom` skills and the thin overlay half of a `wrap-thin`). **Never** vendor skills — those adapt via memory references, not edits.

## Mode A — drift-check (`/skill-drift`)
⛔ **WHAT IS EXECUTABLE HERE, AND WHAT IS NOT.** `respawnpack living status <canary>` implements checks
2 and 4 below for the three opt-in canaries — `debug`, `savepoint`, `knowledge`. Checks **1 and 3 are
NOT IMPLEMENTED**: nothing in the kernel reads an `<!-- invariant -->` marker (124 of them ship in the
tree and no code path opens one) and there is no smoke check. Do not rely on either.

⚠️ And the gate is the CANARY LIST, not "ships a `SKILL.base.md`" — those are different sets. The nine
skills that ship a baseline today are all non-canaries; a canary has no baseline until `living enable`
freezes one. Running this mode over "every skill with a base" points it at exactly the skills
`living status` never examines.

For each ENABLED canary, diff `SKILL.md` against its `SKILL.base.md` and report (flag, don't silently fix):
1. ⛔ **NOT IMPLEMENTED — Invariant violation** (do this by hand or not at all) — the living form contradicts or drops a base rule marked `<!-- invariant -->`. This is the serious one: a living skill that lost "a prod write needs approval" is broken, not improved.
2. **Over budget** — the `## Learned (living)` overlay exceeds `overlayBudgetLines` in `.skill-meta.json`.
3. ⛔ **NOT IMPLEMENTED — Smoke failure** (do this by hand or not at all) — the skill no longer parses, or references a file / tool / command that no longer exists.
4. **Base hash mismatch** — `SKILL.base.md`'s hash differs from `.skill-meta.json.baseHash` (the baseline itself was edited — confirm that was an intentional intent change, then re-stamp).
Run on demand and as a step in [`/savepoint`](../savepoint/SKILL.md)'s drift-check. Output: per-skill status (clean / overlay-refreshed / **flagged**) with the specific finding.

## Mode B — regenerate the overlay
When lessons have accrued: pull the lessons keyed to this skill — **`memory_lessons <skill>`** (the respawn-memory engine returns the entities related to it by `applies-to|skill:<name>`, highest-confidence first; or grep the file backend for that relation). Dedupe against the base, and rewrite **only** the `## Learned (living)` section of `SKILL.md` — within budget, each line carrying its date · confidence · memory ref. The base body is referenced, never restated. Never hand-author overlay content; it must trace to a memory entry. (Lessons get linked to a skill when `/debug` or `/knowledge` captures them with an `applies-to|skill:<name>` relation.)

## Mode C — reset (`/skill-reset <skill>`)
Restore `SKILL.md` from `SKILL.base.md`; archive the current overlay (to `.skill-meta` history). The source lessons remain in the memory engine, so the next regeneration can re-propose them minus whatever caused the drift. Use when a living skill drifted too far, broke, or a `/skill-drift` invariant flag can't be cleanly reconciled. Then re-stamp `lastReset`.

## Invariants
- **Canaries only.** A skill outside the three-name canary list is out of scope — `living enable` refuses it, and a `SKILL.base.md` on disk does NOT make a skill in scope (the nine that ship one are all non-canaries). Record its lessons in memory keyed to it; do not edit it.
- **Flag, don't auto-fix** invariant/smoke findings — surface for the human, like the spine drift-check.
- **The overlay is derived** — regenerated from memory, never hand-edited; the base is canonical, edited only to change intent.
- **Reset is always safe** — the baseline is the guaranteed-good floor; lessons survive in memory.

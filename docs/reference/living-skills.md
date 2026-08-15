# Living skills

RespawnPack's living-skill mechanism separates authored intent from a bounded, regenerable learning overlay.

## Files

- `SKILL.base.md` — frozen authored baseline.
- `SKILL.md` — the active skill: baseline plus a generated `## Learned (living)` overlay.
- `.skill-meta.json` — baseline digest, overlay budget, reset metadata, and canary state.

Only explicitly enabled RespawnPack-owned canaries participate. The presence of `SKILL.base.md` alone does not enable a skill, and vendor/developer-owned skills are never rewritten by this mechanism.

## Operations

- **Status:** compare the enabled canary's base digest and overlay budget.
- **Regenerate:** rebuild only the learned overlay from verified memory entries related by `applies-to|skill:<name>`.
- **Reset:** restore the active skill from its baseline while retaining source memories for later review.

Invariant and smoke interpretation remains human-reviewed unless executable code explicitly implements it. Missing memory or metadata must produce a flagged or `CANNOT_DETERMINE` result, never an invented clean status. See the [`skill-guard` skill](../../adapters/pi/package/skills/skill-guard/SKILL.md) for the executable boundary and current canary list.

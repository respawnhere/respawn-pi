# Skill-authoring standards

How RespawnPack writes and maintains skills — the pack's own, and the project skills a target grows. The through-line: **a skill is context spent on every session before it ever fires; every line must buy routing accuracy or execution correctness, or it is a tax.** The listing (description + `when_to_use`) is paid always, by every session; the body is paid on every invocation; only on-demand reference files are close to free. Budget accordingly.

Pack contributors write new skills to this standard; `/skill-guard` audits living skills against it when regenerating overlays; the pack repo's skill-eval suite enforces the mechanically-checkable subset (caps, structure, collisions) in CI. It is the sixth standard, sibling of [`coding-standards.md`](coding-standards.md), [`writing-standards.md`](writing-standards.md), [`performance-standards.md`](performance-standards.md), [`behavior-standards.md`](behavior-standards.md), [`design-standards.md`](design-standards.md), and [`testing-standards.md`](testing-standards.md).

## Scope: skills AND agents

The same listing-budget truth applies to the 32-role agent bench. Agents are model-routed exactly the way skills are — the `description` + `when_to_use` frontmatter is paid on every session against a per-agent and an aggregate budget. Rules 1–5 below apply to **both** skills (`adapters/pi/package/skills/*/SKILL.md`) and agents (`adapters/pi/package/agents/*.md`); only the field names (`name`, `description`, `when_to_use`) and the per-field caps are shared. Skills additionally have a body; agents have a body too — the body rules (6–9) apply to both, with agents additionally using `tools:` / `disallowedTools:` to declare the host surface they operate on. The skill suite (`adapters/pi/package/skills/skills.test.mjs`) and the agent suite (`adapters/pi/package/agents/agents.test.mjs`) enforce the same mechanically-checkable subset in parallel, and a `when_to_use` claim that lives in one suite is treated as sharp by the other — a skill and an agent may share a routing phrase only when the intent is the same.

## The listing: description and `when_to_use`

**1. Front-load the leading concept.** The skill's core noun — the tool it wraps, the role it plays — sits in the first few words of `description`, connective prose after. The listing is read under a hard combined cap (1,536 chars) and an overflowing skill list truncates late text first; whatever sits at the end is the first thing the model never sees.

**2. One trigger per branch; no synonym restates a covered branch.** If two `when_to_use` phrases fire the skill for the same underlying case, keep the sharper one. A duplicated branch spends finite listing budget twice for zero added routing coverage.

**3. The description states WHAT and its boundary — never the workflow.** A description that summarizes the steps becomes a shortcut that *replaces* the skill: the model acts on the summary and skips the body. Say what the skill is for; let the body say how.

**4. At most one negative-trigger clause, aimed at a real confusable neighbor.** "Routes X to `/other-skill` instead" earns its chars when a specific sibling causes mis-routing; a running list of hypothetical exclusions is budget spent on failures that don't occur.

**5. Budget against the combined listing cap, not the field's validation ceiling.** The 1,024-char description validation limit and the 1,536-char combined listing cap are different numbers for different purposes — and the real constraint is tighter still: the whole skill list shares one per-session budget, so one long listing crowds out every other skill's routing. Know the pack's aggregate number before adding to it.

## The body

**6. Every step ends on a checkable completion criterion.** "Every modified caller accounted for," not "update the callers." A vague bound invites declaring victory before the legwork the step implied is done.

**7. Match the guidance form to the failure it defends against.** A skip-under-pressure failure gets a stated rule plus a rebuttal at the point of temptation; a wrong-shaped-output failure gets a positive recipe; an omitted-element failure gets a required slot in a template; a context-dependent behavior gets a conditional keyed to an observable predicate. Defaulting everything to prohibition backfires — a "don't" aimed at a shaping problem produces more of the unwanted output, not less.

**8. Co-locate rules with their exceptions.** A caveat three headings away from its rule might as well not exist at the moment the rule is applied mid-task. Same breath, same paragraph.

**9. Put the rebuttal at the point of temptation.** If a step is one an agent plausibly skips ("this is simple enough," "I already checked"), the counter-argument lives inline right there — a rebuttal that must be looked up doesn't fire when the rationalization does.

## Reference files

**10. Disclose what only some branches need; inline what every branch needs.** A fact every run touches stays in SKILL.md; a fact one branch reaches moves to a named sibling file behind a pointer that says what it holds. This is the lever that keeps the file legible without deleting content the skill still needs.

**11. Fix a weak pointer by rewording it, not by inlining its target.** Whether the model follows a pointer is decided by the sentence that points, not the file it points to. Sharpen the pointer first; un-disclosing is the last resort.

**12. TOC any reference file past ~100 lines; keep pointers one level deep from SKILL.md.** Deeper nesting breaks discovery; the `design-standards.md` index plus per-section files is the house pattern to replicate.

## Anti-patterns

**13. Reuse the pack's leading words; don't coin a synonym.** "Spine," "WRITE-ONCE," "blast radius," "canonical" — the same token in a prompt, a description, and a body links them for the model at a fraction of the cost of re-deriving the concept. A new coinage is justified only for a genuinely new concept, and then used everywhere.

**14. State target behavior positively.** "Write one-line comments," not "don't write verbose comments" — naming a forbidden behavior drags it into attention instead of suppressing it. Keep prohibitions for hard guardrails, and even then pair them with the positive alternative.

**15. Prune on a cadence: every line must pass the relevance test and the no-op test.** Does the line still bear on the task; would removing it change behavior. A line that fails either is deleted, not softened — sediment (stale layers) and sprawl (honest length, nothing individually wrong) are silent failures no single edit reverses. `/skill-guard` regenerates the Learned overlay from memory; the frozen base underneath deserves the same periodic audit.

## The one-line test

Before shipping a skill change, ask: **"Which failure does this line prevent, and is it in the cheapest tier that prevents it — reference file over body, body over listing?"** If a line has no failure to point to, delete it; if it sits a tier too high, move it down.

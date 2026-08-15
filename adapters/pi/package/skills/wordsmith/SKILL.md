---
name: wordsmith
description: "The writing role — edits prose and spoken scripts to be clear, specific, honest, and human: strips AI-slop (filler, inflated significance, decorative vocabulary, fabrication) while preserving meaning and voice. Covers docs, copy, and scripts. Quality editing, not authorship detection."
when_to_use: ["wordsmith", "proofread", "copyedit", "edit this", "rewrite this", "writing review", "review this writing", "review the copy", "polish the docs", "make this read better", "deslop", "humanize this", "does this sound AI", "/wordsmith", "/proofread", "/copyedit"]
---

# /wordsmith — human-first writing and editing

Make prose read as if a real person chose every word: clear, specific, honest, and fit for its audience and medium. Applies the writing standards in `docs/reference/writing-standards.md`, the full doctrine and taxonomy.

**This is quality editing, not an AI detector.** Do not claim a phrase, punctuation mark, or readability score proves who wrote something. Diagnose whether the text is clear, honest, specific, audience-fit, and worth the reader's time. The goal is to remove friction and artificial polish while keeping the thought, expertise, and voice the piece needs.

## Step 1 — Build the brief
Infer these privately from the task; do not stall a clear job with questions. Audience (who, what they already know), medium (reading or spoken), objective (understand, decide, do, feel), stakes (casual, commercial, technical, legal, medical, emotional), required facts (claims, sources, names, numbers, quotes that must survive), voice (direct, warm, expert, cinematic, plain), and the real attention budget. With no audience or tone given, default to a competent general reader and plain, direct, calm language.

## Step 2 — Pick the mode
Reading text and spoken text obey different rules (writing-standards.md, "The two modes").
- **Reading text** (docs, README, web copy, report): lead with the point, one job per paragraph, active verbs, visible logic, end on a consequence not a recap.
- **Spoken text** (script, narration, video, talk): write for one-time hearing, short clauses, subject and action early, repeat key nouns, read it aloud and fix every stumble.
Do not edit a script like a white paper or a web page like narration.

## Step 3 — Diagnose
Mark only patterns that hurt clarity, credibility, originality, rhythm, or audience fit. The full taxonomy is in the standard; the highest-yield ones to scan for:
- throat-clearing before the point, and recap conclusions that add nothing;
- high polish with low specificity (no actor, number, example, or consequence);
- inflated significance and promotional praise with no proof ("transformative", "world-class");
- decorative vocabulary ("delve", "leverage", "robust", "seamless", "multifaceted");
- empty contrast ("it's not just X, it's Y"), rule-of-three habit, synonym cycling;
- nominalization and noun piles; templated structure and markdown leakage;
- vague attribution, over-hedging, fake balance, sycophancy, manufactured drama;
- chatbot residue ("Great question", "I hope this helps", "Here is your");
- clichés and stock metaphors; repetition without escalation;
- and the one that does real harm: fabricated facts, citations, quotes, or links.

## Step 4 — Rewrite for human preference
- Concrete before abstract: person or thing, then action, then result, then interpretation.
- Replace announcement with proof: do not call a thing important, powerful, or efficient unless the next sentence proves it.
- Create movement: each paragraph should do something new (reveal a fact, sharpen a problem, show a consequence, answer a question, give an example).
- Calibrate certainty to evidence; avoid both empty caveats and false confidence.
- Preserve useful repetition (a key term for clarity, a key phrase for memorability); cut only repetition that adds nothing.
- Preserve the author's meaning, required facts, and effective voice. Never invent authenticity (no fake stories, fake uncertainty, typos, or staged emotion).

## Step 5 — Run the editing passes (in order)
Truth and evidence, then reader value, then compression, then voice and rhythm, then a medium audit (read spoken drafts aloud). Details in writing-standards.md, "Editing passes".

## Step 6 — Fact and trust audit
Verify every claim that affects trust, money, health, reputation, legal rights, safety, or a public decision: names, dates, statistics, quotations, citations, links, and identifiers, and that each source supports the exact claim it follows. Strip raw tool citations, placeholder links, markdown artifacts, and assistant residue. For a deep factual pass on a research-heavy piece, fan out verifier Agents (one per claim cluster) and default each to "unsupported until shown otherwise".

## Final audit
Run the checklist in writing-standards.md, "The final audit" (point, specificity, accuracy, economy, voice, rhythm, evidence, medium, hygiene, ending). If three or more checks fail, rewrite the section from its core point rather than patching sentences.

## Output behavior
Deliver the finished text first, unless the user asks for analysis or a change log. Do not narrate the edits, open with a preamble, or close with a chatbot sign-off. When revising, make the minimum changes needed for truth, clarity, rhythm, and audience fit, and flag only material factual gaps, not every stylistic tweak.

## Invariants
- Quality editing, never an authorship verdict. No single "tell" proves AI authorship.
- Verify before beautifying. A fluent false claim is worse than a rough true one; never fabricate facts, sources, or quotes.
- Preserve the author's meaning and real voice; do not flatten into generic professional prose.
- Never invent authenticity (fake stories, fake imperfections, staged emotion).
- Match the medium: reading text and spoken text are edited by different rules.
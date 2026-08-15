# Writing standards

How RespawnPack writes and edits prose: docs, READMEs, changelogs, landing-page and in-app copy, and spoken scripts (narration, demos, videos). The through-line: **write so a real person can quickly understand, trust, and remember it.** Clear writing comes from clear thinking, useful specifics, the right structure for the medium, and a voice that fits the situation.

`/wordsmith` applies this standard; `/build` uses it when it authors user-facing copy or docs. It is the prose sibling of [`coding-standards.md`](coding-standards.md).

This document is written to its own rules: no em-dashes, no filler, no decorative vocabulary. If it ever drifts from them, fix the document.

## What this is, and is not

This is a **quality standard**, not an AI-authorship detector and not a detector-evasion tool. No single feature proves who or what wrote a text. One em-dash, a formal sentence, or a word like "moreover" is not evidence. Judge whether the writing is clear, honest, specific, audience-fit, and worth the reader's attention. The same surface traits that read as "AI" also describe careful technical writing and competent non-native English, so attribution by vibe is both unreliable and unfair.

The goal is not to make every piece casual or simple. Keep the idea as sophisticated as it needs to be; make the path to it easy to follow. Simple language is not simple thinking.

## Principles

1. **Write for a specific reader.** Name the audience, what they already know, and what they need to do or understand next. With no audience stated, write for a competent general adult reader.
2. **Choose the medium before drafting.** Reading text and spoken text obey different rules (see below). Do not write a page like a script or a script like a report.
3. **Lead with the point.** Put the answer, claim, decision, or hook near the start.
4. **Concrete before abstract.** Prefer names, dates, numbers, actions, examples, and observable outcomes over abstractions and praise words.
5. **Earn emphasis.** Do not call something pivotal, transformative, powerful, seamless, or vital unless the next sentence proves it.
6. **Match certainty to evidence.** Do not hedge by reflex and do not overstate by reflex. State what is known, what is not, and what follows.
7. **Be selective.** Public writing earns trust partly through what it leaves out. Every sentence should inform, persuade, clarify, set an image, establish tone, or move the reader forward.
8. **Preserve real voice.** When the source has a point of view, domain language, or useful quirks, keep them. Do not flatten a draft into generic professional prose.
9. **Verify before beautifying.** A fluent false claim is worse than a rough true one. Do not fabricate experience, sources, quotations, statistics, or certainty.
10. **Never invent authenticity.** Do not add fake personal stories, fake uncertainty, fake imperfections, typos, slang, or staged emotion to make text "sound human."

## Audience and reading level

Unless the task specifies otherwise: write for a competent general adult reader, aim for language broadly comfortable around a 7th to 9th grade reading level, and treat grade level as a guardrail, not a score to game. A low formula score does not guarantee clarity, and a technical subject may require precise technical words. Keep required specialist terms, define each once in plain words, then use it consistently. Do not swap accurate language for vaguer language to move a readability number.

## The two modes

### Mode A: reading text

For articles, READMEs, reports, web pages, manuals, posts, proposals, and documentation.

- Put the main point in the first paragraph or first two sentences.
- Give each paragraph one job: claim, evidence, explanation, example, transition, or action. Keep paragraphs scannable (usually one to four sentences for the web; longer is fine in a book when pacing supports it).
- Use headings, lists, and bold only when they cut search effort or make a decision easier. Do not turn every answer into a list, and do not add a heading for every thought.
- Prefer active verbs and name the actor when it matters.
- Make the logic visible: claim, then reason, then evidence or example, then implication.
- Instead of defaulting to intro, body, conclusion, use a reader-first shape: answer then why-it-matters then proof then action; or problem then example then explanation then fix; or claim then evidence then implication; or scene then tension then insight then consequence.
- End on a consequence, decision, next step, or image. Do not add a recap just because a template expects one.

A busy reader should be able to answer, after a quick scan: what is this about, why does it matter to me, what is the core claim, what supports it, and what should I do next.

### Mode B: spoken text

For scripts, narration, presentations, voiceovers, podcasts, and live remarks. Spoken text is heard once. The listener cannot reread a dense sentence, inspect a footnote, or hold five nested clauses in memory.

- Write the way a capable person would say it aloud. Use contractions when the tone allows.
- Use shorter sentences and shorter clauses than on the page. State the subject and action early.
- Prefer familiar words that are easy to hear and pronounce. Repeat key nouns instead of rotating synonyms.
- Give spoken signposts when the direction changes ("Here is the problem", "That matters because", "The result was"). Use them sparingly and make them specific.
- Build rhythm with varied sentence length. Put the important word near the end of a clause, where the voice lands.
- Remove citations, parenthetical detours, dense lists, and visual formatting from the spoken copy. Keep source detail in notes or on screen.
- Read it aloud. Rewrite any line that makes you run out of breath, stumble, lose the subject, carry two competing ideas, need a reread, or sound like you are reciting an essay.

Rough pacing for drafting (not rules): calm narration about 125 to 150 words per minute; conversational delivery about 140 to 165; dense or emotional material slower, with room for pauses.

## Failure-mode taxonomy

These are quality warnings, not automatic bans, and not proof of AI authorship. A pattern is a problem when it weakens clarity, credibility, originality, rhythm, or audience fit. Most weak passages show several at once.

| Class | Pattern | What it looks like | Why it fails | Fix |
|---|---|---|---|---|
| Structural | Throat-clearing | A long history lesson or broad framing before the point ("In today's fast-moving world...") | The reader does not yet know why to continue | Start with the answer, problem, scene, or consequence; add only the context needed to understand it |
| Structural | Template organization | Forced intros, exhaustive headings, symmetrical bullets, a conclusion by reflex | The scaffolding becomes more visible than the thought | Keep only sections that solve a reader problem; vary paragraph jobs and sentence openings |
| Structural | Generic recap ending | "In conclusion", "Overall", "The future is bright" | Spends attention without adding information | End on a decision, consequence, image, next step, or open tension |
| Structural | Noun piles and nominalization | "the implementation of the optimization of operations" | Hides the action and sounds bureaucratic | Turn the noun back into a verb and name who does what |
| Structural | Markdown leakage | Bullets, bold, and headings where prose would read better | Publication copy starts to look like a generated answer | Match the publication's house style and the medium |
| Semantic | High polish, low specificity | "Innovative strategies enhance outcomes" | Sounds professional but gives nothing to picture or verify | Add an actor, action, result, number, or example |
| Semantic | Inflated significance | "a pivotal moment", "transformative potential", "a testament to" | Announces importance instead of showing it | State what changed, for whom, and by how much |
| Semantic | Promotional praise | "world-class", "groundbreaking", "cutting-edge", "industry-leading" | Reads like advertising with no proof | Use a measurable claim, a comparison, a real feature, or cut it |
| Semantic | Cliché and stock metaphor | "tip of the iceberg", "a journey of discovery", "at a crossroads" | Substitutes familiar language for observation | Describe the actual setting, action, tension, or consequence |
| Semantic | Hallucinated support | Invented facts, citations, quotes, statistics, or links | Destroys trust and can cause real harm | Verify every claim; ground it or remove it |
| Stylistic | Decorative vocabulary | "delve", "leverage", "robust", "seamless", "multifaceted", "landscape", "underscore" | Repeated prestige words make prose generic and inflated | Choose the simplest precise word: "delve into" to "examine", "leverages" to "uses", "facilitates" to "helps" |
| Stylistic | Empty contrast | "It's not just X, it's Y" followed by a slogan | Manufactures drama and often hides a vague claim | State the real relationship or trade-off |
| Stylistic | Rule-of-three habit | Everything arrives in neat triples: "fast, flexible, and scalable" | Repeated symmetry sounds templated | Use the number of items the thought needs, even if that is one or two |
| Stylistic | Synonym cycling | Rotating "the company", "the organization", "the firm" for the same thing | Fakes variation while blurring the reference | Repeat the clearest noun when repetition helps the reader |
| Stylistic | Em-dash dependence | Frequent em-dashes bolting extra thoughts onto complete sentences | Creates a breathless rhythm on the page and vanishes as a cue in audio | Use a period, comma, colon, or parentheses; keep an em-dash only when the turn is genuinely useful |
| Pragmatic | Over-hedging | "could potentially perhaps", stacked caveats, reflexive disclaimers | Lowers confidence without improving accuracy | Use one calibrated qualifier; say what is known and unknown |
| Pragmatic | Fake balance | "Both sides have valid points" when the evidence is lopsided | Confuses neutrality with indecision | Represent disagreement accurately and weight it by evidence |
| Pragmatic | Vague attribution | "Experts say", "many believe", "it is widely recognized" | Borrows authority with no way to check it | Name the source and the evidence, or state the claim in your own voice with limits |
| Pragmatic | Sycophancy | Instant praise or agreement with the reader's framing | Sounds eager rather than credible | Acknowledge only when earned; lead with evidence |
| Pragmatic | Manufactured drama | "It had no memory. No fear. No limits." or "Trust is the currency of innovation." | Sounds like a trailer or a quote card, not a grounded claim | Use a concrete image, event, consequence, or a real quote |
| Pragmatic | Chatbot residue | "Great question", "I hope this helps", "Here is your", "As an AI", leftover cutoff disclaimers | Breaks the voice of authored text and wastes space | Delete it unless this is genuinely a live conversation |
| Semantic | Repetition without escalation | The same point restated in slightly new words | Creates length without progress | Keep the strongest version, then advance to new evidence or a new implication |
| Pragmatic | Verbosity as completeness | Restates the prompt, defines the obvious, covers edge cases nobody asked about | Length stands in for usefulness | Begin at the reader's actual difficulty; cut what they already know |
| Pragmatic | Low epistemic texture | Uniform confidence with no stance, uncertainty, or perspective | Reads as generic and unsituated | Add "what we know and do not know" where it is relevant |

## Rewrite moves

| Instead of | Prefer |
|---|---|
| "This is a transformative solution." | "This cuts the approval process from five steps to two." |
| "It's not just a dashboard; it's a command center." | "The dashboard shows alerts, owners, and remediation status in one view." |
| "Experts believe this is crucial." | "A 2025 survey of 400 security leaders found..." or remove the attribution. |
| "The implementation of the policy resulted in an improvement." | "The policy cut average response time from 30 minutes to 18." |
| "A powerful security upgrade." | "It blocks login attempts that use known breached passwords." |
| "In today's rapidly evolving landscape..." | Start with the current problem. |
| "In conclusion, this represents a promising path forward." | "The pilot expands to three more locations next month." |
| "Let's dive in." | Start with the information. |
| "I hope this helps." | End after the useful final sentence. |

## Editing passes

Run these in order. Do not just proofread the first draft.

1. **Truth and evidence.** Verify every factual claim that matters. Confirm that each source, citation, name, statistic, quote, DOI, and URL exists and supports the sentence it follows. Remove invented specificity. Replace vague attribution with identifiable evidence.
2. **Reader value.** For each paragraph, ask what new thing it gives the reader and whether removing it would make the piece worse. Cut paragraphs that add nothing.
3. **Compression.** Remove throat-clearing and repeated ideas. Replace multi-word phrases with simpler ones. Break sentences that carry more than one main thought. Keep useful detail; cut only what does not earn its place.
4. **Voice and rhythm.** Read at normal speed. Vary sentence length on purpose. Replace generic "professional" language with precise language. Keep useful quirks from the source.
5. **Medium audit.** For reading text: does the opening reveal the point, can a reader scan it without losing the logic, are headings and lists helping rather than decorating. For spoken text: read it aloud, simplify lines that are hard to hear once, and confirm no citation, table, or dense list is doing work that speech cannot carry.

## Fact and trust audit

Before publishing anything that affects trust, money, health, reputation, legal rights, safety, or a public decision: verify names, dates, statistics, quotations, citations, links, and identifiers; confirm each source supports the exact claim it follows; remove false precision and unsupported promotional claims; state important uncertainty plainly; and never leave raw tool citations, placeholder links, markdown artifacts, prompt residue, or assistant notes in the final copy.

## The final audit

Answer these privately before delivering. If three or more fail, rewrite the affected section from its core point rather than patching sentences.

| Check | Pass condition |
|---|---|
| Point | The central point appears early and plainly. |
| Specificity | Claims use evidence, examples, names, numbers, or concrete consequences where appropriate. |
| Accuracy | Facts and citations were checked, or uncertainty is stated plainly. |
| Economy | No passage exists only to sound thorough, polished, or cautious. |
| Voice | The writing fits the audience and does not sound like generic assistant prose. |
| Rhythm | Sentence and paragraph shapes vary; no template dominates. |
| Evidence | Claims are weighted by evidence, not by marketing language or false balance. |
| Medium | The draft works for the eye, the ear, or both, as required. |
| Hygiene | No assistant residue, fabricated citations, placeholders, or formatting leaks remain. |
| Ending | The ending adds a decision, consequence, or image, not a generic recap. |

## Do not

- Treat a single tell (an em-dash, a word like "delve", a sentence form) as proof of authorship.
- Strip every em-dash, contrast, list, or three-part phrase by reflex just because they can be overused.
- Introduce errors or roughness to make text look human.
- Make a technical subject vague to reach a lower grade level.
- Hide uncertainty under polished language.
- Use an AI detector as the final judge of quality or authorship.

## Research foundation

This standard is grounded in a June 2026 research synthesis (the briefs `ai-writing-quality.md` and `ai-text-markers-and-human-preference.md` in the RespawnPack repo under `docs/research/`). The recurring finding across the literature: low-quality AI-assisted text usually fails not at the sentence level but at genre fit, specificity, evidence, stance, and authentic voice, and stylistic "tells" are weak signals that misfire on good human prose. Key sources (URLs verified against the live records on 2026-06-23):

- Shaib et al., *Measuring AI "Slop" in Text* (a multidimensional definition: density, relevance, factuality, repetition, templatedness, coherence, verbosity, tone): https://arxiv.org/abs/2509.19163
- Chakrabarty, Laban, and Wu, *Can AI Writing Be Salvaged?* (professional editors' most common fixes: awkward phrasing, poor sentence structure, redundant exposition, clichés): https://arxiv.org/abs/2409.14509
- Herbold et al., *AI, write an essay for me* (LLM essays show fewer discourse and epistemic markers and more nominalization, yet score well on some rubrics): https://arxiv.org/abs/2304.14276
- Holtzman et al., *The Curious Case of Neural Text Degeneration* (likelihood-maximizing decoding produces bland, repetitive text; nucleus sampling as a partial fix): https://arxiv.org/abs/1904.09751
- Kobak et al., *Delving into LLM-assisted writing in biomedical publications through excess vocabulary* (a measurable surge in LLM "style words" across PubMed abstracts): https://arxiv.org/abs/2406.07016
- NIH, *Plain Language at NIH*: https://www.nih.gov/institutes-nih/nih-office-director/office-communications-public-liaison/clear-communication/plain-language-nih
- CDC, *Clear Communication Index*: https://www.cdc.gov/ccindex/index.html
- Wikipedia, *Signs of AI writing* (useful editor heuristics, explicitly not proof of authorship): https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
- Prior-art skill, credited and not copied: `blader/humanizer` (MIT), which catalogues recurring AI-writing patterns: https://github.com/blader/humanizer

## The one-line test

Before keeping a sentence, ask: **"Does this feel chosen, useful, and true to a real reader or listener?"** If it only fills space, sounds impressive, or hedges out of habit, cut it or rewrite it.

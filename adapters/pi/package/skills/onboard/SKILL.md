---
name: onboard
description: The brownfield-onboarding role — turns an un-spined existing codebase into first-draft spine docs a human confirms. Fans out 4 write-scoped code-mappers + a docs-ingestor over `.respawnpack/onboarding/` scratch, adjudicates pre-existing-doc claims against code (code wins), and promotes only human-confirmed sections into PRODUCT/FEATURES-PAGES/DECISIONS. Command-only; canonical edits proposed, never auto-written.
when_to_use: ["/onboard", "onboard", "onboard an existing codebase", "adopt a brownfield repo", "map my codebase into the spine", "bootstrap spine docs from code"]
disable-model-invocation: true
---

# /onboard — brownfield onboarding (un-spined codebase → first-draft spine)

**Optional target dependencies:** onboarding scratch, wave-ledger, project config, and spine paths named below may be absent before onboarding; create only the declared scratch outputs, and report `CANNOT_DETERMINE` rather than guessing when the code/config cannot establish a draft.

The once-per-repo bridge for a codebase that already exists but has no spine: hundreds of files of real product, canonical docs still full of empty placeholders. It maps that reality into first-draft `PRODUCT`/`FEATURES-PAGES`/`ARCHITECTURE-ROADMAP`/`DECISIONS` drafts, then promotes only what the human confirms — honoring WRITE-ONCE (propose, never auto-write) and code-wins. Reached via `/respawn`'s first-run handoff or typed `/onboard`; a greenfield repo (nothing built yet) wants the bare adoption interview instead, not this. Orientation-and-propose against the product code: it never edits or refactors it.

## Step 0 — Preflight: confirm un-spined brownfield, on a clean tree
- **Confirm the condition.** The spine must be un-spined *and* the codebase real: canonical docs still templates (unfilled `<PLACEHOLDER>`s in `PRODUCT.md`/`FEATURES-PAGES.md`/`DECISIONS.md`) or `respawnpack.config.json.codeTruth` unset — **and** substantial pre-existing code (a populated `routeSource`, real `opsTargets`, a source tree). If the spine is already filled, stop and say so: this is a first-run op, and the work belongs in `/loadout`. If the repo is genuinely greenfield, hand back to `/respawn`'s adoption interview.
- **Require a clean git tree.** `git status --porcelain` must be empty. If it isn't, ask the human to commit or stash first — the containment gate in Step 2 reads any tracked-file change as a mapper escaping its scratch boundary, and a dirty baseline makes that check meaningless.
- **Read the target shapes.** Load `respawnpack.config.json` (`routeSource`, `opsTargets` — already installer-detected) and skim the empty spine templates so the drafts match their canonical shapes.

## Step 1 — Declare the wave (the resume anchor)
Write `.respawnpack/wave-ledger.md`: the 5 lanes, each with its disjoint scope and its one output path under `.respawnpack/onboarding/`. Declare file ownership up front — no two lanes write the same file (overlapping writers is the classic stale-coordination failure). This ledger is what makes a mid-run kill resumable: `/respawn` Step 4 rehydrates it and relaunches only the lanes whose `*.map.md` is missing or incomplete.

## Step 2 — Fan out (parallel, single-digit) → verify containment
Spawn all five in one message, at **standard model tier** (structured extraction against a rubric):
- **4× [`codebase-mapper`](../../agents/codebase-mapper.md)** — scopes `product` · `routes` · `architecture` · `decisions`. Pass each: its scope, the detected `routeSource`/`opsTargets`, its files-read cap, and its output file (`product.map.md` · `features-pages.map.md` · `architecture.map.md` · `decisions.map.md`).
- **1× [`docs-ingestor`](../../agents/docs-ingestor.md)** — extract + self-verify every claim in pre-existing prose docs → `ingested-claims.map.md`.

Each reads its slice, samples under its depth cap, writes one evidence-annotated map, and returns a **confirmation line only** (path · row count · top-3 uncertainties) — the orchestrator never holds the full content. Mark each lane complete in the ledger as its line lands. **Monorepo:** if a single lane overflows its cap, shard it by subtree (`apps/*` · `services/*` · `packages/*`) into sequential sub-passes appending to that one map file.

**Containment gate (load-bearing).** After the wave, run `git status --porcelain`. `.respawnpack/` is gitignored, so with the clean Step-0 baseline the only acceptable result is **zero tracked-file changes**. Any tracked change means a mapper wrote outside its scratch boundary → **abort**, retain the scratch + ledger for inspection, and report the offending path. (Where the write-containment hook is installed it is the enforcement backstop; this git-status gate is the check that must pass regardless.)

## Step 3 — Synthesize (sequential, in the orchestrator)
With all five maps on disk, adjudicate here (top-tier judgment — not delegated): cross-check each ingested doc-claim against the four code-drafts and classify —
- **CONFIRMED** (doc matches code) → folds into the draft as a high-confidence row (doc + code agreeing is the strongest evidence).
- **STALE / conflicting** (doc says X, code does Y) → **code wins**; the conflict lands in `.respawnpack/onboarding/CONFLICTS.md` as a decisions-needed item. A doc that reflects intent the code hasn't caught up to becomes a build-gap (🧩), not a correction.
- **UNVERIFIABLE** (no code evidence either way) → carried as `inferred`, low confidence, never silently promoted.

Emit the four proposed drafts (`product` · `features-pages` · `architecture` · `decisions`) + `CONFLICTS.md` + an aggregate **coverage note** (what was *not* read, rolled up from the mapper footers), all under `.respawnpack/onboarding/`. Nothing in `docs/` yet.

## Step 4 — Confirm (human, triage-ordered)
Walk it decision-first, not per-row and not silent-per-file: lead with `CONFLICTS.md` and every `inferred` row (the things that actually need a human call), then present the `evidence`-backed bulk for a fast glance-and-accept. Per-section **accept / edit / reject**; rejecting an `inferred` section drops it rather than guessing. Checkpoint each accepted section in the ledger so a kill doesn't re-ask what the human already settled.

## Step 5 — Promote (propose, never auto-write)
Write **only human-confirmed sections** into the canonical `docs/*.md`. Propose — for the human, never auto-written (WRITE-ONCE, user sovereignty) — the `respawnpack.config.json.codeTruth` fill from the token/copy/schema paths the mappers surfaced, plus any conflict-resolved `DECISIONS.md` D-entries. Never touch the derived set (`CONTINUITY`/`GAPS`/`CHANGELOG` — that is `/savepoint`'s job).

## Step 6 — Hand off + clean up
Recommend `/walkthrough` on the new `FEATURES-PAGES` matrix (walk the rendered pages against it — the natural accuracy gate for the routes doc) and `/savepoint` (fold + delete the ledger, regenerate the derived set). On a **clean completion**, delete the `.respawnpack/onboarding/` scratch; on an **aborted or partial** run, retain it and the ledger for resume. The spine is now canonical — the same placeholder detection `/respawn`, `/loadout`, and `/build` already run flips these docs from "template" to trusted.

## Invariants
- **Reads product code; the only writes are scratch + human-confirmed promotion** — never edits or refactors the product. <!-- invariant -->
- **Evidence or explicitly inferred, never a silent guess** — every promoted claim carries a `path:line` or an `inferred` mark; unresolved conflicts go to `CONFLICTS.md`. <!-- invariant -->
- **WRITE-ONCE** — no section enters `docs/*.md` without a human yes; `codeTruth` and `DECISIONS` edits are proposed, never auto-written. <!-- invariant -->
- **Containment** — mappers write only under `.respawnpack/onboarding/`; the `git status` gate after the wave aborts the run on any tracked-file change. <!-- invariant -->
- **Wave-ledger resume** — the 5 lanes and the accepted sections are ledger-checkpointed, so a mid-run kill resumes instead of restarting (`/respawn` rehydrates, `/savepoint` folds and deletes). <!-- invariant -->
- **Command-only** (`disable-model-invocation`) — a once-per-repo op reached via `/respawn`'s handoff or typed `/onboard`; re-runnable, but not prose-routed. <!-- invariant -->

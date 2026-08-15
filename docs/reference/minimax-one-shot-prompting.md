# MiniMax one-shot prompting — empirical note

This is an **empirical note**, not a guarantee. It records a small, dated
experiment comparing three one-prompt task-completion styles against
`minimax/MiniMax-M3` in this repository. The note makes **no causal inference**
between prompt properties and observed outcomes: prompt quality, worker budget,
and runtime environment all vary, n = 1 per trial, and trials A and B ran
concurrently on shared hardware. Every claim cites a prompt byte count, an exit
status, and an artifact.

## Environment

- **Authentication.** The parent session inherited Pi's login state from the
  operator's Debian user; child Pi turns had produced real model output in the
  same session prior to the experiment.
- **Date:** 2026-08-12. **Model:** `minimax/MiniMax-M3`.
- **Base revision:** `72e9c92` (Phase 2 commit of D-011 — skill migration to
  `respawn-pi-subagent`).
- **Environment:** the canonical respawn-pi tree; `npm test` is wired; the
  parent live Pi session produced real model output.

## Experiment record

### Trial A — narrative prompt, fixed 240 s budget

- **Prompt size:** 2,952 bytes.
- **Setup:** isolated worktree; direct CLI; running **concurrently with Trial B**
  on the same machine; fixed 240 s execution budget.
- **Outcome:** exit **124** (timeout); final log empty; only two test files were
  partially edited. A later focused run **failed**: the legacy runtime remained
  registered, and the migrated cwd test asserted a throw placeholder instead
  of applying Pi's `tool_result` restoration. These are observed defects in the
  partial edits, not explanations for the timeout.

### Trial B — contract-first prompt, fixed 240 s budget

- **Prompt size:** 4,934 bytes.
- **Setup:** isolated worktree; direct CLI; running **concurrently with Trial A**
  on the same machine; fixed 240 s execution budget.
- **Outcome:** exit **124** (timeout); final log empty; no on-disk edits. No
  explanation for the timeout was captured.

### Trial C — atomic execution-first prompt, installed user `rp-worker`

- **Prompt size:** larger than A; structured into allowed files, fences, an
  output format, hard forbids, and a preserve list. Its exact byte count was not
  retained, so prompt-size comparisons exclude C.
- **Setup:** no isolated worktree; **solo**; no comparable fixed-duration budget
  was imposed. The parent first attempted package dispatch separately; the
  runtime refused it: the parent session lacked
  `RESPAWNPACK_AGENT_DISPATCH=1`. The parent then invoked the installed user
  `rp-worker`; the worker did not receive or handle the earlier refusal.
- **Outcome:**
  - The user worker completed **six allowed runtime / test files in a single
    prompt** (the Phase 3 runtime + fence edits) with no correction prompt
    issued.
  - The worker reported the focused runtime fence as **142 / 142 pass**. The
    parent independently reran the same focused fence and observed **142 / 142**.
  - An active legacy `rg` returned **exit 1 / no output**, confirming zero
    `respawn_pi_dispatch_agent` references in the runtime / test / fence files.
  - A `git diff --check` of the resulting working tree was **clean**.
  - The worker received the existing failing-before evidence rather than
    recreating it.

### Trials D / E — single-prompt completions that did NOT qualify

- **Trial D — docs-only user worker.** Six docs edited in one prompt; worker
  self-reported "38 / 38 / clean". Parent factual review found inaccurate and
  unsupported statements requiring a remediation cycle. Does NOT count as
  one-prompt completion under the rubric below.
- **Trial E — mixed runtime+docs user worker (cycle 1 remediation).** Focused
  runtime fence plus a docs refresh in one prompt; worker self-reported
  **151 / 151 / clean**; parent independently reran the focused fence and
  observed **151 / 151**. Parent factual review found remaining docs
  contradictions and the worker reset generator-owned `docs/derived/STATE.json`
  despite a preserve instruction, so the state-status gate failed. Does NOT
  count as one-prompt completion under the rubric below.

## Confounds (no causal inference)

- n = 1 for each prompt style; provider variability, queueing, parent session
  state, and machine contention all vary.
- A and B ran **concurrently** on the same machine; C, D, and E ran **solo**.
  Machine contention therefore differs across the trials; no effect was
  isolated.
- A and B launched via **direct CLI with a fixed 240 s budget**; C, D, and E
  via installed **user extensions** with **no comparable duration captured**.
  Interface and budget therefore differ across the trials; no effect was
  isolated.
- Prompt lengths differ: 2,952 vs 4,934 bytes for A vs B; C, D, and E are in a
  different class. Prompt length alone is **not** the variable being measured.
- C had access to the failing-before evidence produced by A's later focused run;
  A and B did not.
- D's "38 / 38 / clean" and E's "151 / 151 / clean" were worker self-reports;
  parent factual review found D inaccurate / overclaimed and E accuracy +
  preserve-honored not all met.

**There is no causal ranking here and no claim of guarantee.** Trials A and B
record what did not finish under the conditions tried. Trial C records what
finished in a single prompt under its conditions. Trials D and E record that
even a single-prompt completion with self-reported success can fail the rubric
on follow-up factual review.

## Strict rubric (one)

A run counts as one-prompt completion only when ALL of the following hold:

1. **One worker prompt, zero correction prompts.** Any follow-up that asks the
   worker to redo work is a correction; clarification prompts are not allowed
   under this rubric — only the parent-rerun verification step (#9) is.
2. **Successful final / exit.** If a hard budget was applied, the recorded exit
   status is explicit (e.g. a documented `124` timeout); otherwise the process
   exited `0`. "Final log empty" alone is NOT a successful completion.
3. **All edits accurate and complete.** Every file the prompt said to edit is
   edited; every forbid is honored; every claim is accurate against the code
   truth at the time of the run. Proxies and self-reports do not substitute.
4. **Allowed scope / preserve honored.** No file outside the allowed list was
   modified. Generator-owned artifacts (`docs/derived/STATE.json`, etc.) and
   existing on-disk edits named as preserved are preserved.
5. **Required public fences run.** The handoff names the exact fence commands
   run (e.g. `node --test scripts/active-command-fence.test.mjs`) and the exit
   status; the worker did not silently skip a required gate.
6. **`rg` / `diff` hygiene.** For deletion prompts, the active `rg` returns
   exit `1 / no output`. `git diff --check` is clean for the worker's edits.
7. **Public acceptance matrix.** The handoff names the exact public acceptance
   surface (HTTP handler, exported function, persisted row, packaged extension
   loaded by Pi's resolver) that the fences exercised — not just stubs or
   re-exports.
8. **Self-review within the same turn.** The worker re-read its own diff,
   checked factual numbers and forbidden overclaims (including
   `CANNOT_DETERMINE` for unavailable gates), and refused to claim uncommitted
   work as shipped, before returning.
9. **Independent parent verification.** The parent independently re-runs the
   focused fence and observes the same pass/fail, and performs a factual
   review of the worker's diff against the code truth, reporting any
   inaccuracy or preserve violation.

A run that fails any of #1–#4 is not a one-prompt completion, regardless of the
green proxy counts. Trials D and E are named examples.

## Hypotheses for controlled follow-up

These are candidate prompt properties for future controlled trials. They are
**hypotheses**, not findings; this experiment did not isolate their effects.

1. **Atomic concern** — one mechanical task per prompt; "done" and "out of
   scope" both defined up front.
2. **Execution-first ordering** — put requested actions before optional
   rationale.
3. **Exact allowed files** — the prompt enumerates the files the worker may
   edit; the worker does not discover the surface.
4. **Explicit delete / preserve / forbid** — what to delete (legacy refs),
   what to preserve (generator-owned `STATE.json`, existing runtime edits),
   and what to forbid (commits, pushes, contract redesign).
5. **Reuse valid failing-before evidence** — when the parent has the
   reproducer, include it verbatim rather than recreate it.
6. **Public-surface acceptance matrix** — exact public fences named; proxies
   (re-exports, stubs) not allowed.
7. **Exact commands** — provide exact `node --test`, `rg`, and
   `git diff --check` commands plus the expected success conditions.
8. **Self-review within the same turn** — worker reads back its own diff,
   checks factual numbers, rejects forbidden overclaims before returning.
9. **Explicit output fields** — require files changed, test results, anything
   left undone with reasons, risks, and a suggested next step.
10. **Accuracy / `CANNOT_DETERMINE`** — mark unavailable gates
    `CANNOT_DETERMINE`, not PASS or SKIP; refuse to claim uncommitted work as
    shipped.
11. **Controlled budget** — assign and record the same execution budget when
    comparing prompt variants.

> **Prompt length was not isolated.** Future trials should vary prompt length
> separately from task, interface, concurrency, and execution budget.

## Reusable template

This template is the one used in Trial C, lightly normalized. Placeholders are
deliberate; substitute the project-specific values for your task. Do **not**
include secrets (provider keys, real paths under `~/.pi`, model tokens) — the
worker does not need them, and prompt logs may outlive the session. The
template is reusable but is not claimed to equal Trial C verbatim.

```text
Task: ONE-SHOT <TASK KIND> TASK — <ONE-LINE GOAL>. Complete
inspect→edit→<fence runs>→self-review in this single turn.
No commit/push. Preserve all existing runtime edits and
generator-owned <generated paths>.

ALLOWED FILES ONLY:
- <file 1>
- <file 2>
- <new file under docs/reference or similar>

CODE TRUTH NOW: <one paragraph of the current state the worker
must respect — counts, names, latest commit, current dirty state,
what is and is not committed>.

DOC CHANGES:
1 <file 1> <what to change, in one sentence>.
2 <file 2> <what to change, in one sentence>.
3 <new file> <what to write and why>.

FENCES: <exact node --test invocations>; <exact rg checks>;
<exact git diff --check>.

Self-review: <list of factual numbers and forbidden overclaims
to re-verify before returning>.

Final: <exact file paths / counts / risks / suggested next step>.
```

The template's structure is the unit that matters; the prose inside each
section is short, declarative, and verifiable. The worker is not asked to
rephrase the contract or to weigh alternatives — the parent session owns the
contract.

## Out of scope

- Anything that requires a credentialed live Pi session to be running.
- Anything that needs a push, a tag, or a publish.
- Anything that would write outside the target tree or to `~/.pi`.
- Cross-session prompt chains; this note is about one-prompt tasks only.
- Provider comparisons. The note records one model (`minimax/MiniMax-M3`) on
  one base revision (`72e9c92`) on one date (2026-08-12). Generalizing to
  other models, revisions, or dates requires a separate experiment.
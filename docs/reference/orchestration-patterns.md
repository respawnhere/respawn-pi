# Orchestration patterns

This reference is the canonical operating policy for bounded multi-agent work. Skills and `AGENTS.md` may summarize it, but they must not invent different limits. The governing decision is D-012.

## Review convergence: expand once, then converge

A rigorous review finds defects without turning closure into an unlimited search. Use this state machine for any build, review, or playtest that can enter a review → remediation loop.

### 1. One broad discovery review

Run one broad discovery review against the approved scope. It may use multiple lenses and hostile probes. Verify the findings, then publish a **frozen findings batch** with severity, reproducer, affected acceptance criterion, and snapshot identity. This is the only phase that searches the whole approved surface for new findings.

### 2. Closure reviews do not reopen discovery

A closure review checks only:

- the frozen findings batch;
- direct regressions introduced by its remediation;
- the named acceptance gates.

It is not another broad audit. Unrelated cleanup, pre-existing defects outside the frozen batch, speculative hardening, and newly imagined improvements go to a follow-up backlog instead of restarting closure.

### 3. Maximum of two remediation cycles

A remediation cycle is one owned batch of fixes followed by focused verification. The hard limit is a **maximum of two remediation cycles** after the discovery review:

1. fix the frozen findings batch;
2. fix incomplete remedies or direct regressions found by the first closure check.

If an admissible blocker remains after cycle two, **stop and ask the operator**. Report the unresolved reproducer and options; do not silently start cycle three, broaden the audit, switch workers repeatedly, or grind until context exhaustion.

### 4. New-blocker admission rule

After discovery freezes, a newly reported issue may block the current closure only when verified evidence shows one of:

- a **P0** safety or data-loss defect;
- violation of an **explicit acceptance criterion** or named invariant in the approved contract;
- a **regression introduced by the remediation**.

A new P2 is non-blocking and goes to the backlog. A P1 that does not violate the current contract and was not introduced by the remediation also becomes separately scoped follow-up work. Reviewers must state which admission fence a new blocker satisfies; “worth fixing” is not enough.

### 5. Focused-first verification

Use the smallest reproducer while remediating. Run focused tests before the full suite. Run the **full suite once** after focused tests pass and the candidate is ready; if the candidate changes afterward, rerun affected focused tests and then one final full-suite fence. Do not tax every edit with the whole suite.

### 6. One owner per findings batch

Assign **one worker to own the findings batch** through both allowed cycles. Other agents may investigate or review read-only, but they do not concurrently patch the same batch. The parent coordinates, freezes scope, and verifies evidence rather than repeatedly redesigning the solution or handing the batch to a new interpretation.

### 7. Progress communication

Report at the end of every review/remediation cycle or after **ten minutes**, whichever comes first. Keep the update to:

- focused/full fences currently passing;
- blockers remaining;
- current cycle number (`0/2`, `1/2`, or `2/2`);
- the next action or operator decision needed.

Do not narrate every probe. Silence while repeatedly rerunning reviews is not progress communication.

### 8. Immutable closure snapshot

When focused and full gates pass, record an **immutable closure snapshot**: commit hash, or HEAD plus a dirty-tree fingerprint. Run **one independent closure review** against exactly that snapshot. A changed tree invalidates that closure result. If the review finds an admissible blocker, consume the next remediation cycle; if no cycle remains, stop and ask the operator. If it finds only non-blocking follow-ups, record them and close.

## Roles

- **Discovery reviewer:** searches broadly once, verifies, and freezes the batch.
- **Fix owner:** applies the frozen batch and direct-regression fixes within two cycles.
- **Closure reviewer:** verifies the frozen batch and named gates against one immutable snapshot; it does not reopen discovery.
- **Parent/coordinator:** enforces scope, cycle count, status cadence, snapshot identity, and escalation.

## Competing hypotheses for debugging

When a defect will not reproduce and the single-threaded investigation stalls, send two or three read-only investigators different falsifiable hypotheses. Each tries to refute the others. Synthesize once, choose the cheapest surviving reproducer, and return to the normal three-attempt `/debug` cap. Parallel agreement is evidence, not permission for an unlimited investigation loop.

## Unattended batches

Unattended work still requires an approved spec, isolated worktree, one owner, atomic rollback units, and an explicit stop condition. Review convergence remains in force: one discovery pass, at most two remediation cycles, concise status updates, and operator escalation at the cap.

## One-shot prompting for M3 workers

The empirical note at `docs/reference/minimax-one-shot-prompting.md` records a dated set of one-prompt M3 worker trials, the hypotheses those trials test, and one strict rubric that decides whether a trial counted as a one-prompt completion. The note is descriptive, not prescriptive: it records observations and a re-applicable rubric, and explicitly disclaims causal inference between prompt properties and observed outcomes. Trial counts, exit statuses, and the parent-rerun behaviour are cited verbatim in the note so a reader can verify them against the working tree. The note's strict rubric is the single source of truth for "one-prompt completion"; this reference does not duplicate it.

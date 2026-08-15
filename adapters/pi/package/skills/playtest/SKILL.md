---
name: playtest
description: The QA / playtest role — exercise the real surface, find issues across tiers, FIX them, and write a regression test encoding each bug, with an atomic commit per fix and a self-regulating stop heuristic. Turns "found a bug" into "fixed + can't regress."
when_to_use: ["playtest", "/playtest", "qa", "/qa", "test this", "smoke test", "find bugs", "qa the feature", "check it works"]
---

# /playtest — find → fix → regression-test loop

Find issues on the real surface, fix them, and lock each fix with a regression test. The core discipline: **every fix gets a regression test**, committed atomically.

**Optional target dependencies:** feature-matrix and orchestration documents may be absent; derive only what the live surface and code establish and report `CANNOT_DETERMINE` for the missing oracle. Browser/MCP capabilities are optional: fall back to an available project test driver, or report `CANNOT_DETERMINE` when no real-surface driver exists.

## Step 1 — Exercise the surface
Drive the real thing — for browser UI, use the official [`anthropics/skills` **webapp-testing**](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) skill (Playwright scripts) or the connected **`browser_*`** MCP tools (the managed-infra path), plus `chrome-devtools-mcp` where wired for console/network/perf probes; the API/CLI for backends; the test suite where it exists. Drive the live app, not a mock. Cross-reference `docs/FEATURES-PAGES.md` for the surface's expected features (and its reverse index — a feature that should be there but isn't is a finding, not a non-event).

## Step 2 — Find across tiers
Collect issues by tier: (1) broken/incorrect behavior, (2) missing states (empty/loading/error), (3) a11y/perf/polish. Note repro for each.

## Step 3 — Fix → regression-test → atomic commit (per issue)
For each issue, in order:
1. **Fix** it in source (in scope).
2. **Write a regression test** that encodes the exact bug (fails before, passes after). If the repo has no test setup, scaffold the minimal one — this is how the no-tests baseline gets broken. **For a timing or async bug, poll for the real condition with a deadline — never a fixed `sleep`.** A hardcoded wait is flaky by construction: too short and it false-fails on a slow run, too long and it taxes every run forever. Wait on the actual post-condition (the element appears, the row lands, the state settles) up to a timeout instead.
3. **Commit atomically** — one fix + its test per commit (`fix(<area>): <bug>`), so each is revertable + reviewable.
4. **Verify** before/after (screenshot or test run).

**Running the loop unattended? Isolate it in a worktree.** If a background agent drives this find→fix→test loop instead of you interactively, run it in a dedicated worktree: the per-issue atomic commit above is already the unit of rollback — back a bad fix out with `git revert`, never a corrective Write over it — and leave a recovery note (issues fixed, worktree path) so a crashed run is cleanable. One fix agent owns the whole issue list, not one per issue.

## Step 4 — Self-regulating stop

For open-ended exploratory QA, stop when the surface is clean, you hit the issue cap (default ~10), or risk is rising. For remediation of a frozen review batch, respawn-pi:D-012 is stricter: use one fix owner, focused tests before the full suite, and a maximum of two remediation cycles. Closure checks do not reopen discovery; new issues block only when they are a P0, violate an explicit acceptance criterion, or are regressions introduced by remediation. After cycle two, stop and ask the operator. Report passing fences, remaining blockers, cycle count, and next action after each cycle or every ten minutes. Close with one independent review of the immutable snapshot. See `docs/reference/orchestration-patterns.md`.

Don't grind past either cap or the point of confidence — report what remains.

## Step 5 — Hand off
Summarize: fixed (with commits + tests), still-open (with repro), and any spine edits implied (a missing feature → propose the `PRODUCT`/`FEATURES-PAGES` update). Hand off to `ship`.

## Invariants
- Every fix gets a regression test.
- One fix + test per atomic commit.
- A timing/async regression test polls for the condition with a deadline, never a fixed `sleep`.
- An unattended find→fix loop runs in a dedicated worktree — the atomic commit per issue is the rollback unit, git revert (never a corrective Write), a recovery note, one fix agent for the whole list.
- Stop on the cap or rising risk; report the remainder rather than over-fixing.
- A frozen review batch follows respawn-pi:D-012: one owner, at most two remediation cycles, focused-first/full-once verification, ten-minute status cadence, and one immutable-snapshot closure review.

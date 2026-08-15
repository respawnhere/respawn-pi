---
name: run-goal
description: Activates the goal-mode contract for an explicit goal in docs/goal.md — validates the goal, refuses if a different goal is already active, writes .respawnpack/runtime/contract.json, and surfaces the active goal + completion checklist as the first thing to work on. The closeout → handoff → compact chain is then driven by the rollover extension on the per-goal contextStages ladder. Counterpart to /respawn's goal-mode resume (Step 0b).
when_to_use: ["run-goal", "/run-goal", "activate goal", "set the goal", "start the goal", "pick up the goal", "begin goal mode", "enter goal mode", "go into goal", "what's the active goal"]
---

# /run-goal — activate goal mode for `docs/goal.md`

**Optional target dependencies:** goal and runtime-contract paths are absent outside goal mode; stop with the documented missing/invalid result and report `CANNOT_DETERMINE` rather than creating or activating an inferred goal.

Flips the rollover bridge into **goal mode** for an explicit goal written at `docs/goal.md`. The
operator reads/writes `docs/goal.md` (the durable, operator-tracked goal doc); the skill writes
`.respawnpack/runtime/contract.json` (the runtime, gitignored pointer). The bridge then drives the
context ladder from `goal.contextStages` instead of the global defaults.

A goal session is autonomous by design: the operator hands the goal to the session and the session
works through `completion[]` items in order, respawning at every context limit. The skill is the
entry point; `/respawn` Step 0b is the resume; `/run-goal close` is the exit.

## Step 0 — Confirm `docs/goal.md` is parseable

Call the packaged `respawn_pi_command` tool with `{"action":"goal-status"}`.

The `status` subcommand returns the parsed `goal` block (id, status, completion, contextStages) and
the current runtime contract (or a clear "no contract" answer). A `goalReason` other than `null`
means the goal doc is missing or malformed — **fix the doc before activating, not after.** The
validator's errors are mechanical and exhaustive; a missing `constraints` array, a descending
`contextStages` ladder, a `goalId` that doesn't match `^G-[A-Za-z0-9_-]+$`, or a non-string
`completion` item will all surface here.

If `status` returns `goal: null` with a clear `goalReason`, the goal doc is the problem — there is
no contract to refuse, so go straight to "create the doc, then `/run-goal` again".

## Step 1 — Refuse if a different goal is already running

`status` returns a non-null `contract` block when `.respawnpack/runtime/contract.json` exists. Read
`contract.activeGoalId`:

- **`null`** — no goal is currently active. Proceed to Step 2.
- **Same as `goal.goalId`** — a stale contract for the same goal (e.g. left over from an earlier
  session). `/run-goal` will refresh it; cycleCount and handoffs are preserved.
- **Different** — refuse. Print: "Goal `<new>` cannot start: goal `<existing>` is already running.
  Close it first (`/run-goal close` or hand-edit `.respawnpack/runtime/contract.json` to null out
  `activeGoalId`)." Do NOT overwrite the contract silently — the operator's intent for the existing
  goal is the load-bearing thing; erasing it would break the active session's resumption.

⛔ **An unclosed goal blocks a new one.** If you genuinely need to abandon the current goal, use
`/run-goal close` (Step 4 below) so the audit trail (`cycleCount`, `sessions[]`, `closedAt`) is
preserved — do not hand-delete `contract.json`.

## Step 2 — Activate

Call `respawn_pi_command` with `{"action":"goal-activate"}`.

The `activate` subcommand:
- Re-validates `docs/goal.md` (Step 0 may have been a while ago).
- Reads the existing contract; refuses if a different goal is active (the belt-and-braces for the
  Step 1 check, executed by code, not by operator attention).
- Derives `currentAtomicTask` from `nextUnmetCompletion(goal)` — the first string in `completion[]`,
  or `gate-complete: <gate>` for an object-form `{kind: "gate-complete", gate: "X"}` item.
- Atomic-writes `.respawnpack/runtime/contract.json` with `mode: "goal"`, the derived thresholds,
  and either `cycleCount` from the prior contract (same goalId) or `0` (fresh).

A non-zero exit means the activation failed; the error message names the failing check. Do not retry
silently — the validator is deterministic and the failure will repeat.

## Step 3 — Surface the active goal + completion checklist

Print a single, scannable block to the operator (do not write it to a doc — it goes in the
session's chat output only):

```
Goal mode active: G-1 — ship the goal-mode CLI
  Thresholds: advisory 60% · closeout 75% · handoff 85%
  Atomic task: all-mandatory-conformant
  Completion (4 items, 0 met):
    [ ] all-mandatory-conformant
    [ ] scripts/goal-contract.test.mjs green
    [ ] gate-complete: G-agents-and-skills
    [ ] the rollover bridge accepts goal-derived thresholds at agent_settled
  Constraints: no pushes · preserve unrelated working-tree changes
  Forbidden:   git push · delete docs/derived/CONTINUITY.md or docs/DECISIONS.md entries
```

The checklist is the contract: every item the operator sees here is one `/savepoint` checkpoint, and
the next session after each compact resumes at the first `[ ]`.

## Step 4 — Document the lifecycle (so the operator knows when each piece fires)

Once the contract is active, three independent mechanisms drive the rest of the flow:

1. **`adapters/pi/package/extensions/context-monitor.ts`** at `session_start` re-reads
   `goal.contextStages` and shifts its advisory `ui.notify` thresholds to `advisory / handoff`. At
   each `agent_settled` where `usage ≥ threshold`, the operator sees a `context-monitor: NN% of
   context window` warning. **Advisory only — does not block, does not compact.**

2. **`adapters/pi/package/extensions/respawnpack-rollover.ts`** at `session_start` resolves the
   contract and stores `state.goalThresholds`. At each `agent_settled`, it calls
   `bridge.decide({thresholds: state.goalThresholds})`:
   - `usage ≥ goal.contextStages.checkpoint` (default 60%) → fires the `advisory` threshold.
   - `usage ≥ goal.contextStages.closeout` (default 75%) → fires `checkpoint` → calls
     `bridge.checkpoint()` → `bridge.closeout()` → writes the handoff.
   - `usage ≥ goal.contextStages.handoff` (default 85%) → fires `final` → verifies the handoff
     → requests `ctx.compact()`.

3. **`adapters/pi/package/extensions/stop-savepoint.ts`** at every `agent_settled` with a changed
   tree, in goal mode, calls `bumpCycleCount(projectDir, sessionId)` which increments
   `contract.cycleCount` and appends a `{sessionId, at}` entry to `contract.sessions[]` (capped at
   32 entries). This is what tells the operator how many session-resume cycles the goal has been
   through — useful for spotting a goal that's been bouncing around too long.

The three goal stages must ascend strictly (`checkpoint < closeout < handoff`); the goal
validator rejects equal stages. The default `60/75/85` ladder leaves a 10-point window between
closeout and handoff for corrective action (for example, land the pending edit and verify the
handoff before compacting). A tighter ladder is valid only if it still ascends, such as
`contextStages: { checkpoint: 60, closeout: 70, handoff: 80 }`.

## Step 5 — Close the goal

When every item in `completion[]` is met (operator moves them from `[ ]` to `[x]` in the doc, or
removes them), run:

Call `respawn_pi_command` with `{"action":"goal-close"}`.

This nulls `activeGoalId`, stamps `closedAt`, and **preserves** the contract (cycleCount, sessions,
handoffs) for audit. Subsequent `status` calls show the goal is closed. To reactivate the same
goal, re-edit `docs/goal.md` (status: in_progress or pending) and run `activate` again — cycleCount
is preserved across the gap.

⛔ **Never delete `.respawnpack/runtime/contract.json` directly.** The bridge reads it on every
session_start to decide whether goal-mode is active; a deleted file looks identical to "never
activated", and the audit trail is lost.

## Invariants
- **durable ↔ runtime split** — `docs/goal.md` is operator-tracked, schema-validated, and survives
  fresh clones. `.respawnpack/runtime/contract.json` is gitignored, atomic-written by the bridge,
  and carries the active-goal pointer + audit (cycleCount, sessions, handoffs).
- **One active goal** — the skill refuses a new goal when a different one is running. Closing is
  the only path forward.
- **Thresholds come from the goal, not the operator** — the operator edits `goal.contextStages`;
  the skill does not accept a threshold override. This keeps the contract surface small and the
  threshold ladder reviewable in code review.
- **Operator owns completion[]** — the bridge never auto-marks items done. The operator edits
  `docs/goal.md` (moves items from `completion:` to a `done:` section, or removes them) and the
  bridge picks up the new first-unmet item on the next session_start.
- **Idempotent on re-activate** — running `activate` twice for the same goalId is safe: cycleCount,
  handoff history, and session entries are preserved. A different goalId would have been refused
  in Step 2.
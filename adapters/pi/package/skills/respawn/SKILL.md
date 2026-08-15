---
name: respawn
description: The session-start role — boots within a hard context budget from revision-validated STATE.json, a verified compaction handoff, the bounded CONTINUITY note, the active contract, and a short tree summary. Canonical and memory reads are deferred until a concrete task. Surfaces contradictions instead of picking a source.
when_to_use: ["respawn", "/respawn", "start", "/start", "resume", "/resume", "boot the session", "load the handoff", "where did we leave off", "pick up where we left off", "what's next", "new session", "catch me up"]
---

# /respawn — boot a session from the last savepoint

The first thing you run in a new session. `/savepoint` writes the handoff at session end; `/respawn` loads it at the start, so you begin oriented instead of cold and don't re-investigate a solved problem or re-propose a killed feature. Orientation only: it **reads and proposes**, and does not change code until you confirm the direction.

**Optional target dependencies:** derived state/continuity, goal/runtime, catalog, config, and wave-ledger paths named below may be absent; follow the documented fallback, keep the boot bound, and report `CANNOT_DETERMINE` rather than fabricating missing state.

## Boot budget (hard limit)

A normal boot may consume at most **5 tool calls**, **150 total output lines**, and **12 KiB** of tool output. Stop at the first limit and report anything not checked as `CANNOT_DETERMINE`; do not expand the search to make the brief look complete. Boot execution order is Step 0 → Step 0b → Step 4 → Step 5; Steps 1–3 are post-brief, on-demand work.

The per-call ceilings make the aggregate limit enforceable even on a hostile tree:

| Boot input | Calls | Maximum output |
|---|---:|---:|
| `state-status` | 1 | 30 lines / 3 KiB (enforced by `respawn_pi_command`) |
| direct handoff fallback, only when injection is missing | 1 | 25 lines / 2 KiB |
| CONTINUITY note | 1 | 30 lines / 2 KiB |
| `goal-status` | 1 | 20 lines / 2 KiB (enforced by `respawn_pi_command`) |
| tree summary | 1 | 45 lines / 3 KiB |

An injected handoff costs no tool call/output. Any direct fallback must resolve only this session's `latest-handoff.json` target and cap the single command with `head -n 25 | head -c 2048`; if that cannot establish and consume a verified handoff in one call, report `CANNOT_DETERMINE` and continue without it. Extract the note with `awk '/<!-- RESPAWNPACK:NOTE/{on=1} /<!-- \/RESPAWNPACK:NOTE/{print; exit} on' docs/derived/CONTINUITY.md 2>&1 | head -n 30 | head -c 2048`.

- Read only the validated state result, an already-injected verified compaction handoff (when present), the bounded `RESPAWNPACK:NOTE` block, one contract status, and a short working-tree summary. Generated prose below CONTINUITY's marker duplicates STATE and is not boot context.
- Canonical and memory reads happen after the boot brief, once the operator confirms a concrete task. Do not read whole canonical documents speculatively during boot.
- Never run recursive `find`, broad `rg`, an unbounded directory listing, or a full generated-doc read during boot.
- Never dispatch an agent during boot. Dispatch begins only after the operator confirms a concrete task.
- Do not run savepoint automatically during boot. A stale state fails closed; report `CANNOT_DETERMINE` and propose `/savepoint` rather than spending the boot budget regenerating state.
- Do not re-run boot because a routing reminder repeats. Reuse the state already loaded in the current context unless the operator explicitly requests `/respawn` or HEAD/input digests changed.

## Step 0 — Load current state, and validate it before trusting it

Call the packaged `respawn_pi_command` tool with `{"action":"state-status"}`.

**`docs/derived/STATE.json` is the primary handoff** — generated, schema-versioned, revision-bound. It
carries the live facts: goal and milestone *as separate things*, the current atomic task, per-requirement
status, counts derived from rows, open P0/P1, scoped blockers with their exact missing authority, next
unblocked work, evidence freshness, and an explicit list of what could not be determined.

⛔ **Validate before quoting — and a matching revision is NOT enough.** `status` now checks the
recorded digest of every compiler input, so an UNCOMMITTED edit to `requirements.json` makes the state
stale at an unchanged HEAD; when it does, `status` exits 2 and WITHHOLDS the counts rather than printing
them beside a warning. Treat a non-zero exit as "there is no current count", not as "the tool complained".
`state-status` performs the HEAD and input-digest comparison itself; do not spend a separate boot call on `git rev-parse`. If it reports a source-revision mismatch, STATE.json is a projection of an older revision — say so, return `CANNOT_DETERMINE`, and do not repeat a number from it as current. Propose `/savepoint` as the next action, but do not execute it during boot. A stale projection presented confidently is the failure this whole layer exists to prevent.

⛔ **Surface contradictions; never pick a source silently.** If STATE.json, the git tree, and the wave
ledger disagree, report the disagreement. The kernel exits `2` (`CANNOT_DETERMINE`) rather than choosing,
and so should you.

Then, and only then:
- **Verified compaction handoff** — use the handoff already injected for this session and mark it consumed through the rollover mechanism. Read a runtime handoff file directly only when injection is missing, and only the session's `latest-handoff.json` target; never enumerate rollover history.
- **`docs/derived/CONTINUITY.md`** — read only the `RESPAWNPACK:NOTE` block. That is the human note: prose a person wrote about where things stand. Everything below the `GENERATED` marker is rendered from STATE.json, so reading it is redundant and *quoting* it instead of the source is how prose and truth drift apart.
- **`docs/derived/GAPS.md` and `CHANGELOG.md`** — not default boot context. STATE already carries current gap rows; history is opened only for a concrete task that needs it.

If there is no `STATE.json`, say so — either this project has not adopted the state kernel (boot from
CONTINUITY.md and treat its contents as **unverified assertions**, not derived facts), or `/savepoint`
has not run yet.

## Step 0b — Know which contract you are in

After reading the CONTINUITY note, call `respawn_pi_command` with `{"action":"goal-status"}` **exactly once**. The goal-mode check below consumes this same result; do not call it again.

`collaborate` (the default) means orientation only: read, propose, and wait for direction. `delegate`
means one bounded task with acceptance criteria. `goal` means explicit autonomous work — select the next
bounded unblocked unit from `nextUnblockedWork` and honor the goal's constraints and forbidden actions.

⛔ **Never infer `goal` from a task looking big.** If the user wants autonomous completion they say so,
and it gets recorded with completion criteria.

### Step 0b (respawn-pi extension) — If a goal is active, surface it BEFORE the brief

On a respawn-pi target, the goal-mode bridge maintains `.respawnpack/runtime/contract.json` (gitignored,
atomic-written by `/run-goal` and the rollover extension). Use the single Step 0b status result.

If the response includes `contract.activeGoalId` (non-null), this is a **goal-mode session**. Three
things change about the boot:

1. **The brief must lead with the goal**, not the open gaps. Open gaps are still listed, but
   under "within goal" — i.e. "open work toward the active goal." The next-action recommendation in Step 5 comes from the goal-status result or verified handoff. If neither identifies the first unmet completion item, report it as `CANNOT_DETERMINE`; do not add a boot-time `docs/goal.md` read.
2. **The contextStages ladder is per-goal**, not the defaults. The rollover extension already
   passed `goal.contextStages` to `bridge.decide({thresholds})` at session_start, so the closeout
   and handoff thresholds this session will hit are the goal's, not the global 60/75/85. The
   operator's chosen ladder is visible in the `status` output's `goal.contextStages`.
3. **`/savepoint` writes the goal-mode handoff, not just CONTINUITY.** The handoff at the
   verified-compaction boundary carries `currentAtomicTask` from the contract, so the next
   session after compact knows what to resume.

A session where `goal.status` is `done` but `contract.activeGoalId` is non-null means the operator
forgot to close — surface it as "goal `<id>` is marked done in `docs/goal.md` but the runtime
contract is still active; run `/run-goal close` to retire it."

## Step 1 — Orient to canonical truth after task confirmation
After the boot brief and once the operator confirms the likely task, inspect only its relevant canonical sections:
- `docs/PRODUCT.md` — the matching feature row and status (live / held / deferred / **killed**).
- `docs/DECISIONS.md` — decisions/removals matching that feature; never read the whole append-only history merely to orient.
- `docs/FEATURES-PAGES.md` — only the matching route/flow row when the likely work touches routes/flows.

## Step 2 — First-run adoption interview (skip once the pack is configured)
Trigger: `respawnpack.config.json` still carries a placeholder value (`codeTruth` unset) or the canonical docs are still templates (unfilled `<PLACEHOLDERS>` in `PRODUCT.md`/`DECISIONS.md`/etc.). If neither is true, skip straight to Step 3. If the docs are unfilled **and the repo already holds a real codebase** (a brownfield adoption), recommend typing `/onboard` before hand-filling anything — it drafts the spine docs from code evidence and walks a per-section confirmation (proposals only; WRITE-ONCE holds) — then continue the interview below either way.

(a) **Optional extras.** Ask the operator directly with an enumerated multi-select list: the Compound Engineering plugin, the ui-ux-pro-max design pack, the Cloudflare skills pack, the Anthropic official plugins, the vendor MCP servers for the stack `respawnpack.config.json.opsTargets` already detected (Supabase/Fly/Cloudflare), the research-reach MCP pack (default: playwright-mcp + firecrawl — universal, not stack-gated), and Graphify (structural code graph via the `/mcp-graphify` skill — a read-only, optional external tool: `pip install graphifyy==0.9.10`, needs Python + pip, not installed by the RespawnPack installer; answers what-calls-X, blast-radius, and symbol-path questions, while WHY-questions and concept searches still go to the memory layer). For each one accepted, print its add command from `catalog/README.md` and propose an edit adding it under the `extras` key in `respawnpack.config.json` (array of accepted extra names + the date offered); Graphify has no ready-to-run add command yet at this point (its MCP server needs an extracted `graph.json` path first), so accepting it just records `"graphify"` under `extras` and points the user at `/mcp-graphify` for the extract-then-serve setup. That printed command follows the routing rule (`ops/README.md`, "Which way does a server connect?") for the MCP-server extras: firecrawl (the default-pack keyed/third-party instance) prints the gateway path (`docker mcp secret set` then enable via `/mcp-runtime`) as primary with the direct `--env` command flagged as fallback only; the vendor servers (Supabase/Fly/Cloudflare) and playwright print the direct command as today. Scrapling and CloakBrowser are situational, not offered by default here — point to `catalog/README.md` if asked; CloakBrowser gets a "read the warning on the catalog page first" flag.

(b) **Compliance scope.** Ask what personal-data classes the product touches, which jurisdictions it serves, and any sector triggers (health, finance, children, AI features, card payments, enterprise/EU sales) — the same axes as `compliance.config.md` §1–3. Propose the `compliance.config.md` deltas (WRITE-ONCE: propose, never auto-write); the human approves, `/comply` consumes it later, and `/loadout` keeps asking as new data flows appear rather than re-litigating this every session once it's answered.

## Step 3 — Query memory after task confirmation (don't re-derive solved problems)
After the boot brief, search the knowledge layer for the confirmed task: the knowledge graph (Memory MCP `search_nodes`, if installed) and any learnings/gotchas store. Surface prior root-cause→fix pairs before investigating. (This is the read side of the discipline `/debug` enforces on the write side.)

## Step 4 — Reconcile the working tree
- One bounded command: `{ git status --short --branch | head -n 40; git log --oneline -5; } 2>&1 | head -n 45 | head -c 3072` → what's uncommitted, what branch, anything mid-flight. If truncation hides needed detail, report it as post-brief follow-up; never expand during boot.
- Cross-check against CONTINUITY's "current state": if the tree shows work that the handoff doesn't mention (or vice-versa), flag the mismatch — the last session may have ended without a `/savepoint`.
- Do not probe for a wave ledger by default. If STATE, the handoff, or the short status explicitly says a multi-wave run was interrupted, inspect only `.respawnpack/wave-ledger.md` after the brief, cross-check its commit ranges against git, and resume at the first task it does not close.

## Step 5 — Brief + propose the next move
Give a short, scannable boot summary:
- **Where we are** — current state in 1–2 lines (from CONTINUITY + git).
- **Open** — the live gaps worth attention (from validated STATE rows; do not reread GAPS).
- **Reminders** — only standing constraints present in validated STATE or the verified handoff. Task-specific ⛔ killed-feature checks happen in Step 1 after task confirmation.
- **Next** — a recommended first action, and the role to hand to (`/loadout` to plan new work · `/build` to continue a spec · `/debug` if something's broken · `/review` / `/playtest` / `/ship` if mid-pipeline · `/savepoint` if this was a quick orientation with nothing to build).

Recommend; let the human pick. Don't auto-start work.

## Invariants
- **Orientation only** — read and propose; never start changing code before the direction is confirmed.
- **Respect ⛔ killed features** — load DECISIONS removals in Step 1 so nothing resurrects them.
- **Symmetric with `/savepoint`** — it consumes the CONTINUITY/GAPS/CHANGELOG that `/savepoint` regenerates. If the handoff is stale or missing, surface that rather than trusting it blindly.
- **Memory precedes investigation** (Step 3), after task confirmation — so the session compounds prior knowledge without bloating the boot.
- **Adoption interview is proposal-only and once-per-config** (Step 2) — extras and compliance-scope deltas are always proposed for approval, never auto-written, and it skips itself once `respawnpack.config.json` and the canonical docs are filled in.

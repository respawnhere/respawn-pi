---
name: walkthrough
description: The site-testing role — walk the running product page by page from the user's seat, against a per-page contract (purpose, states, elements, flows, capability parity), and report what's missing, broken, or misleading. Catches the classic AI-build failure of coded-but-unreachable capabilities. Finds and reports; /build and /playtest fix.
when_to_use: ["walkthrough", "/walkthrough", "test the site", "test the pages", "test the page", "site test", "page test", "test the app", "check the pages", "ui test", "test the flow", "test functionality"]
---

# /walkthrough — play the product like a user

**Optional target dependencies:** page contracts, feature/spine documents, and route-specific reference paths named below may be absent; continue from the rendered surface where possible and report `CANNOT_DETERMINE` for claims that require a missing oracle.

The role that catches what's missing before a human does. The hard rule: **the verdict comes from the rendered page, never from the code.** The bug class this skill exists for — a capability that's coded but unreachable (a debate with no *End* or *Leave* control; a sent message its author can't edit or delete) — is invisible to code review, because the code is *correct*; it's the page that never offered it. Code is consulted to build the test (the capability inventory); only the driven page can pass it.

Scope: rendered, user-facing surfaces. The lane split with [`/playtest`](../playtest/SKILL.md) is by *motion*, not by layer: walkthrough is the systematic, contract-driven page sweep that finds and reports; playtest is the find→fix→regression-test loop (and drives UI ad hoc while it hunts). [`/review`](../review/SKILL.md) reads diffs. If the product has no rendered user-facing surface at all, walkthrough is not applicable — say so, hand the testing to `/playtest`, and stop. A non-browser UI (native mobile, desktop) walks the same contracts with the platform's UI-driving tool (simulator + accessibility tree) in place of the browser. Run it on the routes a change touched after [`/build`](../build/SKILL.md), as part of the `/ship` gate for UI-touching changes, or as a full-site sweep on demand.

## Step 0 — Ground in the spine
Read `docs/FEATURES-PAGES.md` (the route×feature matrix, reverse index, nav model, key flows — the test oracle), `docs/PRODUCT.md` (feature status — never fail a page for a 📋 planned, 🧩 build-gap, 🔒 built-but-held, or ⛔ killed feature), and `docs/DECISIONS.md`. If live routes and §2 rows disagree in either direction, that is finding #1 and a proposed spine edit — a wrong oracle makes every other test unreliable. If the spine docs are missing or still unfilled templates, that is also finding #1 (propose the fill): derive the route list from the route source directly and scope contracts to what code and rendered pages reveal — the run proceeds, just against a weaker oracle.

## Step 1 — Page contracts (create or refresh)
Every route under test gets a contract at `docs/reference/page-tests/<route-slug>.md` (slug: strip the leading `/`, convert remaining `/` to `--`, drop param brackets and any catch-all `...` — `/debate/[id]` → `debate--id.md`, `/docs/[...slug]` → `docs--slug.md`). In an app whose "pages" are modals, panels, or drawer states rather than URLs, treat each as a pseudo-route keyed by its trigger + state, with `source:` pointing at the component or route-table entry. The contract is what makes tests *per page* instead of generic — same skeleton, different substance:

```markdown
---
route: <path>            # the §2 row this contract tests
source: <route file or route-table entry>
validated: <date>        # bumped only by a fully-DRIVEN passing run (Step 3)
---
# Contract: <route>

## Purpose
<one sentence: which user, doing what job. If this can't be written, the page has no reason to exist — file that.>

## States
<every meaningful state: empty / loading / error / populated — and every role variant: anon / member / owner / admin, plus paid/entitled where tiers exist (reached via a seeded or test-mode entitlement, never a live purchase). For each non-default state, name how a tester reaches it: a seed script, create-via-UI steps, or a fixture id. Owner-only and state-dependent controls live or die here.>

## Must be present — per state
<the elements and affordances each state owes the user, from the §2 row + §3 reverse index + §1 nav model. Includes the shell: nav, active-state, escape routes.>

## Capability parity
| Capability (code ref) | UI affordance | Reachable in state / by role |
|---|---|---|
<one row per user-triggerable capability in code that touches this page's entities>

## Flows through this page
<the §4 flows that enter, cross, or end here — entry point → this page → exit, incl. abandon/cancel paths>

## Non-goals
<deliberately absent things — ⛔ killed per DECISIONS, 📋/🧩 not yet built, 🔒 built-but-held (coded on purpose, exposed later on purpose) — so a run doesn't false-positive them>
```

**The parity table is the heart.** Build it from code: identify the page's entities, then inventory every user-triggerable capability on them — API routes, mutations/server actions, socket events, store methods (the write surface). Before a capability gets a parity row, check its feature's status in §2/`PRODUCT.md`: 🔒/📋/🧩/⛔ capabilities go to Non-goals, not the table — a deliberately-held feature is not an unreachable one. Each remaining row: where does a user reach this, in which state, as which role? The canonical catches:
- **Lifecycle exits** — anything a user can create or join must offer the exits its lifecycle implies (end, leave, cancel, archive) in the states where they apply.
- **Author rights** — anything a user authors must offer author-scoped edit and delete.
- **Role variants** — owner/admin-only controls actually render for that role, and don't for others.

A capability with no affordance row is the finding this skill was built to catch: *feature exists, users can't reach it.* An existing contract is refreshed when its route file or §2 row changed: the reality-describing sections (Purpose, States, Must-be-present) may be rewritten to match the current code, but hand-added parity rows and Non-goals lines are delete-protected — flag them stale, never remove them (contracts are living documents the human may tune).

## Step 2 — Drive the pages
For each contract, drive the real running app — the official [`anthropics/skills` **webapp-testing**](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) skill (Playwright), the connected **`browser_*`** MCP tools, or the harness preview pane. If no app URL was given, find it in the project's dev-server config (launch config, package scripts) and reuse or start the preview; if the app cannot be brought up at all, stop and report that as a hard blocker — don't convert "couldn't run it" into page findings. Drive only the project's own surfaces (localhost / preview / staging) — walkthrough never pilots third-party sites, and never a production surface with destructive actions unless the human explicitly scopes it. Where wired, `chrome-devtools-mcp` adds the introspection the driver lacks — console errors during flows, network requests (the double-submit probe becomes observable: two POSTs in the log, not a guess), performance traces — run it `--isolated`, and keep its extension-install tools out of the allowlist. For flows behind login, each contract role (anon / member / owner / paid) maps to a dedicated test account and profile — provision in order: the app's own signup flow, else a seed script, else ask the human for test credentials; a role that can't be provisioned gets its checks marked INFERRED, never skipped silently. Never the developer's personal logged-in browser.

**Adopt the page's user persona** from `PRODUCT.md`: click what they'd click, look for what they'd need. Developer instruments are banned for *comprehension* — if you must read code (or the console) to understand what a control does, the page failed the self-explanatory test; file it. The same instruments are the right tool for *verifying observable effects* (the double-POST in the network log, an error in the console) — that is what the introspection probe is for. Per contract:

1. **Purpose** — can the stated user actually complete the stated job on this page, end to end?
2. **Presence** — every "must be present" item, in each reachable state (drive to the state the contract names how to reach; empty and error states included).
3. **Parity** — every parity row's affordance, in its declared state/role. Verify the affordance *works*, not just renders.
4. **Flows** — each §-flow end to end, including the abandon/cancel path and the re-entry (refresh and Back mid-flow: does the user keep their place?).
5. **Interactions** — every control does what its label says; the double-trigger probe (fire an async action twice fast — one result or two?); feedback inside the response window.
6. **Trip-over design findings** — anything you stumble on gets cited against `docs/reference/design-standards.md` by § / SC number (a full design pass stays `/review`'s design-reviewer lens; you report what the walk surfaced).

**Fallback mode (browser tooling not wired in this environment — rare; the installer suggests `playwright-mcp` by default):** do the static half honestly — build/refresh contracts and the parity inventory from code, mark presence checks **INFERRED** (never passed), and say exactly which probes need a browser. A parity gap is often visible statically (no component renders the affordance); an inferred *pass* is not a pass.

## Step 3 — Report
Findings ranked: **Blocker** — the page's purpose can't be completed, a status-checked coded capability is unreachable, or a flow loses user data; **Major** — a presence/flow/parity gap in a state a real user reaches in normal use; **Minor** — a gap confined to an edge-case state or role, or polish. Each finding: **route + state**, what the user experienced, the violated contract clause (or design-standards § / WCAG SC), the concrete fix, and confidence. Close with the honesty line: which pages, states, and flows were **driven** versus **inferred**. Discovered a missing-from-spine feature? Propose the `FEATURES-PAGES`/`PRODUCT` edit (never auto-write). Hand off by motion: well-scoped defects go to the [`/playtest`](../playtest/SKILL.md) fix loop (fix + regression test per issue); gaps needing spec or design work (a missing affordance that implies new UI) go to [`/build`](../build/SKILL.md), via `/loadout` when the scope is real. A contract's `validated:` date is bumped only when every check for it was **driven and passed** — any INFERRED check leaves the date unbumped and marks the contract partial.

## Orchestration
A sweep fans out one packaged subagent per page via the canonical `respawn-pi-subagent` package tool in **parallel mode** — one call, one `tasks: [...]` array, **max 4 concurrent** (≤ the package's `MAX_PARALLEL_TASKS=8` / concurrency-4 cap, sized to Pi example parity) — each task carrying this skill, the contract path, and the app URL — and the dispatching agent synthesizes: reports naming the same shell element or route pattern merge into one finding (a broken nav is one finding, not one per page). A **single page** runs **fully inline in the parent** — NO `respawn-pi-subagent` call, NO single-mode child dispatch, NO one-element `tasks: [...]` array. The parent drives the page itself and issues the verdict; see the fenced note below. Canonical shapes:

```
// Multi-page sweep — parallel mode, max 4 concurrent (static preflight only;
// children run as design-reviewer, NOT walkthrough; the parent drives every page in browser)
respawn-pi-subagent({
  tasks: [
    { agent: "design-reviewer", task: "<this skill> + <contract path 1> + 'static preflight only: re-read the contract + the route source + the rendered-page parity inventory; do NOT drive the page in a browser; emit a structural-preflight report (missing affordances, parity gaps visible statically, presence-list gaps) that the parent will verify in the browser. Mark this report 'preflight; not driven'. Do not mark any item pass/driver; the parent alone issues the verdict after driving the page'>" },
    { agent: "design-reviewer", task: "<this skill> + <contract path 2> + 'static preflight only ...'>" },
    { agent: "design-reviewer", task: "<this skill> + <contract path 3> + 'static preflight only ...'>" },
    { agent: "design-reviewer", task: "<this skill> + <contract path 4> + 'static preflight only ...'>" },
  ],
  agentScope: "package",  // respawn-pi-owned 32 agents
  timeoutMs: 240000,      // 4 minutes: parallel static-preflight fan-out is the only child budget
});

// Single page — fully INLINE in the parent (NO subagent call).
// The shipped 32-agent bench has NO `walkthrough` agent and no browser tools; package agents
// are read-only (read, grep, find) plus `write` for the two mapper classes. No agent in the
// bench can drive a page in a browser. A single-page run is therefore wholly inline: the
// parent drives the page itself, issues the verdict, and never spawns a child for the walk.
```

Pi-aligned semantics: `tasks` accepts up to 8 items with a package-internal concurrency ≤ 4 (the cap is structural, not the `length(tasks)`); the single `timeoutMs` is the TOTAL call deadline, NOT multiplied per page — every concurrent static-preflight task shares the same budget. **Children cannot mark items driven or pass.** Children are static-only; the parent drives every page in a browser and alone issues the verdict. A page whose check was driven in browser remains driven; a check that a child surfaced but was never driven in browser remains INFERRED. When browser tooling is unavailable in this environment, the whole sweep remains INFERRED (never silently passed) and the parent records that explicitly in the report. **No invented browser capability** — if no package agent holds a browser tool and no MCP browser tool is wired, the run is INFERRED end-to-end, not silently passed via a child that could not actually drive the page. A `changed` run resolves the current diff to routes via the project's routing convention (file path under the route source, or a route-table lookup); if the mapping is ambiguous, widen to a sweep rather than guess.

## Invariants
- The verdict comes from the rendered page; code builds the inventory, the browser delivers the pass. No browser → INFERRED, never passed.
- The 32-agent bench has NO `walkthrough` agent and NO browser tools; never dispatch a `walkthrough` agent, never assume any package agent can drive a page in a browser. Static preflight is the only honest child work; the parent drives every page.
- Children are static-only — they cannot mark items driven or pass. The parent alone issues verdicts after driving each page in a browser.
- Multi-page sweep: at most 4 tasks per canonical parallel call (design-reviewer, static preflight only). Single page: fully inline in the parent (NO subagent call). Never use single-mode dispatch for a single page; never use one-element `tasks: [...]` arrays.
- Every coded user-capability has a reachable affordance in the right state for the right role — unless its status (🔒/📋/🧩/⛔) marks it deliberately unexposed — or it's a finding.
- Test from the user's seat — a control that needs the source to be understood already failed.
- The spine is the oracle: never fail 📋/🧩/🔒/⛔ features; oracle-vs-reality drift is itself finding #1.
- Contracts are living documents — reality sections may be rewritten to match code; hand-added lines are flagged stale, never silently deleted.
- Report driven vs inferred, always; `validated:` bumps only on a fully-driven pass.

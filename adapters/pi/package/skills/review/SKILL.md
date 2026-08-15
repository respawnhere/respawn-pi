---
name: review
description: "The review role — multi-lens review of a change via packaged-agent fan-out, with adversarial verification before reporting. Covers correctness, security, performance, maintainability, spine-consistency (does the change match the docs, resurrect a killed feature, or drift tokens?), and design (UI-touching diffs only). Refuses unverified claims; demands named fences; uses CANNOT_DETERMINE when a gate is unavailable."
when_to_use: ["review", "review this", "review the diff", "review the PR", "code review", "check my changes", "/review"]
---

# /review — multi-lens change review

Catches what passes CI but breaks prod (or breaks the spine). Harness-native: independent lenses run in parallel, findings are verified before they're reported.

**Optional target dependencies:** project spine, design, performance, and orchestration references named below may be absent; scope from verified code/diff evidence and report `CANNOT_DETERMINE` for any lens whose required oracle or tool is unavailable.

## Step 1 — Scope the change
`git diff` for the change set (uncommitted, a branch range, or a PR). Note the risk surface — auth, payments, data mutations, external APIs, and migrations get extra scrutiny, and so do hot paths + growth surfaces (request-path code, lists that grow, high-traffic tables).

**Dependency changes get read, not waved through.** A diff that adds or bumps a dependency ideally moves one at a time; read the lockfile diff (new transitive packages, unexpected version jumps), don't rubber-stamp it — a lockfile is where a supply-chain surprise hides.

If Graphify is available (`/mcp-graphify`), run `affected <symbol>` on the changed symbols to bound the blast radius — feed that into the correctness and spine-consistency lenses in Step 2. Skip it when Graphify isn't set up; scoping proceeds from the diff alone.

## Step 2 — Fan out review lenses (parallel)
Call the canonical `respawn-pi-subagent` package tool in **parallel mode** — one call, one `tasks: [...]` array carrying every independent reviewer (NOT one-call-per-agent dispatches):

```
respawn-pi-subagent({
  tasks: [
    { agent: "correctness-reviewer",       task: "<diff + 'find logic errors / edge cases / error propagation / intent-vs-implementation. Refute, don't validate'>" },
    { agent: "security-reviewer",          task: "<diff + 'find authz / injection / authn / SSRF / deserialization / sensitive-data exposure issues, weighted by risk surface. Scan new/changed deps for CVEs (security-audit MCP). Refute, don't validate'>" },
    { agent: "performance-reviewer",       task: "<diff + 'find N+1 / unbounded reads / unindexed filters / per-request connections / heavy hot-path work / payload bloat, against docs/reference/performance-standards.md. Refute, don't validate'>" },
    { agent: "maintainability-reviewer",   task: "<diff + 'find complexity / coupling / naming / dead code / leaked abstractions / comment-quality issues, against docs/reference/coding-standards.md. Refute, don't validate'>" },
    { agent: "spine-consistency-reviewer", task: "<diff + 'find PRODUCT.md / FEATURES-PAGES.md mismatches, resurrected ⛔ killed features, hardcoded values contradicting the token/copy source, missing matrix rows. Refute, don't validate'>" },
    // design-reviewer only when the diff touches UI code, templates, or styles; reports not-applicable otherwise:
    ...(diffTouchesUi ? [{ agent: "design-reviewer", task: "<diff + 'find interaction craft / visual system / psychology-of-use / WCAG 2.2 accessibility baseline issues, against docs/reference/design-standards.md. Run §5 validation probes (keyboard-only / narrow-viewport / reduced-motion). Refute, don't validate'>" }] : []),
  ],
  agentScope: "package",  // respawn-pi-owned 32 agents; user/project opt-in only when the surface demands it
  timeoutMs: 180000,      // multi-lens review of a non-trivial diff; 3 minutes is the room the deepest lens needs to land
});
```

Each lens ships at `adapters/pi/package/agents/<name>-reviewer.md` (the 32-agent bench the package owns at runtime). The full lens definitions (what to hunt for, the evidence bar, the skeptic rule, output format) live in those files; they are the source of truth. Pi-aligned semantics: `tasks` accepts up to 8 items with a package-internal concurrency ≤ 4 (the cap is structural, not the `length(tasks)`); the single `timeoutMs` is the TOTAL call deadline, NOT multiplied per task — every lens shares the same `timeoutMs` budget. This is the one-line essence of each, for orientation:
- **[`correctness-reviewer`](../../agents/correctness-reviewer.md)** — logic errors, edge cases, error propagation, intent-vs-implementation.
- **[`security-reviewer`](../../agents/security-reviewer.md)** — authz/access control (IDOR, ownership checks), injection (SQL/command/XSS), authn/session, SSRF/deserialization, and sensitive-data exposure, weighted by risk surface. Scan new/changed dependencies for CVEs (the `security-audit` MCP). For a deep pass on sensitive changes, hand to [`/secure`](../secure/SKILL.md); secret hygiene is [`/secrets-audit`](../../ops/secrets-audit/SKILL.md); changes touching regulated personal/health/financial data go to [`/comply`](../comply/SKILL.md).
- **[`performance-reviewer`](../../agents/performance-reviewer.md)** — the scale failures cheap to catch in a diff, against `docs/reference/performance-standards.md`: queries inside loops (N+1), unbounded/unpaginated reads, `SELECT *` on hot or wide tables, new filters/sorts without an index (flags the risk from the code and schema; a live `EXPLAIN` or Supabase advisor check is a `/db-ops` or human follow-up), per-request connections, heavy work on the request path, external calls without a timeout, and payload/bundle bloat. Weighted like security by the risk surface (hot paths + growth surfaces).
- **[`maintainability-reviewer`](../../agents/maintainability-reviewer.md)** — complexity, coupling, naming, dead code, leaked abstractions, and comment quality against `docs/reference/coding-standards.md`.
- **[`spine-consistency-reviewer`](../../agents/spine-consistency-reviewer.md)** — match against `docs/PRODUCT.md` + `docs/FEATURES-PAGES.md`, resurrected ⛔ killed features (`docs/DECISIONS.md` removals), hardcoded values contradicting the token/copy source, routes missing a matrix row.
- **[`design-reviewer`](../../agents/design-reviewer.md)** — interaction craft, visual system, psychology-of-use traps, and the accessibility baseline against `docs/reference/design-standards.md`, with the §5 validation passes run as review probes (keyboard-only, narrow-viewport, reduced-motion). Only fires when the diff touches UI code, templates, or styles; reports not-applicable otherwise.

Keep concurrency moderate (single-digit). If the harness cannot issue packaged dispatch calls in parallel, switch to **chain mode** with a `chain: [...]` array (use the `{previous}` placeholder where each lens should see the previous lens's verdict) and run the same lenses sequentially. If `RESPAWNPACK_AGENT_DISPATCH=1` is not authorized, report the independent-review gate as `CANNOT_DETERMINE`; do not substitute an unshipped tool.

## Step 3 — Adversarially verify (before reporting)
For each finding, run a skeptic pass that tries to **refute** it (default to "not a real issue" unless the evidence holds). Drop or downgrade findings that don't survive. Force any finding you can't verify to low confidence. This is what keeps the review trustworthy.

**Optional cross-vendor second opinion.** For a high-stakes diff, the skeptic pass can be escalated to a different-vendor model for an independent read — same discipline as `/build`'s: ask first, pipe content via stdin (never shell argv), read-only, skip-and-announce when non-interactive.

## Step 3b — Freeze and converge (respawn-pi:D-012)

The first broad review ends by freezing one verified findings batch against a named snapshot. A closure review is narrower: it verifies that batch, direct regressions introduced by its remedies, and the named acceptance gates. It does **not** reopen discovery.

A new issue blocks the current closure only if it is a verified P0, violates an explicit acceptance criterion/named invariant, or is a regression introduced by remediation. New P2s and unrelated or pre-existing P1s become follow-up work. Name the admission fence for every post-freeze blocker.

One owner fixes the batch. Allow at most two remediation cycles, using focused tests before one full-suite candidate run. Report status after every cycle or ten minutes. After cycle two, stop and ask the operator. Once green, fingerprint the immutable candidate and run one independent closure review against that exact snapshot. The complete protocol is canonical in `docs/reference/orchestration-patterns.md`.

## Step 4 — Report (+ optionally fix)
Report surviving findings ranked by severity, each with file:line + a concrete fix. If asked, apply the fixes (in scope) and re-verify. Spine-consistency findings → propose the canonical edit (e.g. a missing `FEATURES-PAGES` row), don't just flag.

**Applying a batch of fixes? Isolate them in a worktree.** When you're asked to apply the findings rather than just report them, run the fix pass in a dedicated worktree so a bad fix can't reach the main working tree: one commit per finding (revertable and reviewable in isolation), and back a wrong fix out with `git revert`/`git reset` — never a corrective Write layered on top. Leave a short recovery note (findings done, worktree path) so a crashed run can be cleaned up. One fix agent owns the whole findings list — not one agent per finding, which races on shared files.

## Invariants
- Verify before reporting — no unverified finding presented as high-confidence.
- Always run the spine-consistency lens (it's the differentiator).
- Moderate concurrency; synthesis after the fan-out.
- Reviews propose canonical edits; they don't silently rewrite the spine.
- Applying fixes runs in a dedicated worktree — one commit per finding, roll back with git (never a corrective Write), one fix agent per findings list, plus a recovery note.
- Graphify blast-radius check (if available) is an optional input to scoping — complements, never replaces, the lens fan-out.
- Review expands once, then converges under respawn-pi:D-012: frozen batch, one owner, at most two remediation cycles, focused-first/full-once verification, and one same-snapshot closure review.

## Audit-proof policy (non-negotiable)
A review that reports green without producing admissible evidence is a review that cannot be cited. Every step below is enforced; no finding leaves this skill without it.

- **Claims require named fences.** A surviving finding names (a) the exact script / test / canary that backs it, (b) the exact revision plus a diff fingerprint when the tree was dirty, and (c) the exit status / artifact it produced. A finding without a named fence is downgraded to low-confidence or dropped. "Looks wrong" is not a finding.
- **Real public surface, not a proxy.** Verification exercises the surface a caller observes — the exported function, the HTTP handler, the persisted row, the packaged extension loaded by Pi's resolver. A skeptic pass against a stub, a re-export, or a private helper is not verification; it is the mocks agreeing with themselves.
- **Hostile-path coverage.** When the diff changes input handling, the verification suite has to exercise the hostile inputs (empty / null / oversized / malformed, unicode boundaries, expired tokens, malformed paths). A diff that added a guard without a hostile-input exercise is a diff that left the guard untested.
- **Failure-triggered rollback.** Where the diff ships a rollback / uninstall / revert path, the review demands a forced failure after each mutating stage (permissions, missing target, interrupted write) and verifies byte-identical pre-operation state. "Has a rollback" is not "rollback restores after failure"; the injected operation failure is the proof.
- **Strict evidence + schema.** When a finding cites a JSON / structured artifact, the schema is enforced and a non-conformant run is itself a finding. "It works" / "the gate is green" / "passes locally" is rejected at face value.
- **CANNOT_DETERMINE for unavailable gates.** If a gate wasn't wired in this environment, wasn't run this session, or its artifact was deleted, the closure for that gate is recorded as `CANNOT_DETERMINE` in the report — not silently passed. The reviewer names what could not be checked and why, so the operator can decide what to re-run.
- **Independent same-snapshot closure.** A finding from one lens is independently re-read by a second lens (or a fresh subagent, or a different-vendor model) against the same immutable tree snapshot (commit hash, or HEAD plus diff fingerprint) before it is reported as high-confidence. Self-attestation is not closure; the cross-check is.
- **One canonical source.** The review proposes the canonical edit (a `PRODUCT.md` row, a `FEATURES-PAGES.md` row, a `DECISIONS.md` entry); it does not silently rewrite the spine or hand-edit derived docs.

These rules travel with the work. The `AGENTS.md` audit-proof policy is the project-level anchor; this section is the review-time application of it.

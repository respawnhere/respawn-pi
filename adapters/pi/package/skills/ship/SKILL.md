---
name: ship
description: "The release role — pre-ship gate, an AUTHORIZED push (never automatic), MCP-first deploy verification, and a savepoint. Optionally runs an independent cross-model review on sensitive paths first. Audit policy: clean git-archive + npm-ci reproducible build; failure-triggered rollback; same-snapshot independent closure."
when_to_use: ["ship", "ship it", "release", "deploy", "push it", "land this", "/ship"]
---

# /ship — gate → authorized push → verify

The role that gets a change to prod safely. The hard rule: **push is authorized, never automatic.**

**Optional target dependencies:** project spine/reference files and the push marker named below may be absent; block the dependent release claim and report `CANNOT_DETERMINE` rather than bypassing a missing gate.

## Step 1 — Pre-ship gate
Confirm the change is releasable: `review` clean, `playtest` clean, and the project gates green (typecheck / lint / build). Confirm the spine is consistent (the change's `PRODUCT`/`FEATURES-PAGES`/`DECISIONS` edits are in). For **sensitive paths** (auth / payments / webhooks / migrations), run [`/secure`](../secure/SKILL.md) as a release gate — **block on unresolved HIGH-severity findings** — plus [`/comply`](../comply/SKILL.md) for changes touching regulated personal data, and optionally an **independent cross-model review** (a second model is a real catch on what one rationalizes). At minimum apply the verification gate: any finding you can't verify is low-confidence. For **hot-path changes** (new/changed queries on high-traffic tables, list endpoints, bundle-affecting frontend work), gate on `docs/reference/performance-standards.md`: `EXPLAIN` the new queries MCP-first (the Supabase advisors catch unindexed FKs; for latency, `EXPLAIN` or `pg_stat_statements` via `execute_sql`), confirm pagination on anything unbounded, and check the client bundle delta. For **UI-touching changes** (new/changed components, views, templates, styles), gate on `docs/reference/design-standards.md`: run the §5 validation passes (keyboard-only, narrow-viewport, reduced-motion) and confirm the WCAG 2.2 A/AA accessibility baseline holds — and run [`/walkthrough`](../walkthrough/SKILL.md) on the affected pages (contract + capability-parity check: catches coded-but-unreachable features before users do).

## Step 2 — Stage + describe (don't push yet)
Commit locally with a clear conventional message. Then **stop**: list the staged commits, state exactly what a push triggers (which CI/deploy workflows fire, expected wall-clock + cost), and **ask for explicit authorization.** Past-turn or earlier-in-session authorizations expire — each push needs its own go-ahead. On that go-ahead, mint the single-use marker the `push-guard` extension (Pi: `adapters/pi/package/extensions/push-guard.ts`) requires by touching `<project>/.respawnpack/push.allowed` (an empty file is enough). The rule stays exactly what it was — push is authorized, never automatic — it's just mechanical now: the marker is consumed by the very next `git push` attempt, so the authorization can't quietly outlive this moment.

## Step 3 — Migration-before-deploy check
If the change needs a schema/migration or a config/secret that must exist before the code runs, apply it **first** (MCP-first — e.g. the DB migration via the Supabase/DB MCP) so the deploy doesn't ship a broken endpoint. Verify it landed before pushing.

## Step 4 — Push (only on the go-ahead) + deploy-verify
On the explicit go-ahead, push to the correct remote only. Then verify the deploy MCP-first: health endpoint, the changed surface works in prod, logs clean. Don't declare shipped until verified. If the verify fails, follow `/deploy-verify`'s roll-back-or-roll-forward procedure instead of declaring shipped.

## Step 5 — Savepoint
Run `/savepoint` to record the release (changelog), reconcile gaps, and refresh the handoff.

## Invariants
- **No `git push` without an explicit human go-ahead in the current session.** Default after every commit is wait.
- Migrations/secrets land before the code that needs them.
- Sensitive paths pass `/secure` (no unresolved HIGH-severity findings), and regulated-data changes pass `/comply`, before the push.
- Hot-path changes pass the performance gate (EXPLAIN + pagination + bundle delta) before the push.
- UI-touching changes pass the design gate (§5 validation passes + WCAG 2.2 A/AA baseline) before the push.
- Verify post-deploy before claiming done.
- Push to the correct remote only; know what each push costs.

## Audit-proof policy (non-negotiable)
A push that ships under this skill is final — there is no later “redo” that erases the audit trail. Every step below is enforced; no push goes out without it.

- **Clean reproducible build, not a local install.** “Loads under Pi” is proven against a clean `git archive HEAD` artifact + `npm ci --ignore-scripts --omit=dev` + the Pi resolver — never the developer’s working tree. A local install can mask missing files, stale artifacts, or hand-edited state; the archive + `npm ci` path proves the shipped shape.
- **Real public surface, not a proxy.** Pre-ship verification exercises the surface a caller observes (the packaged extension loaded by Pi, the HTTP handler, the persisted row). Stubbed collaborators, re-exports, or private helpers prove the mocks agree with themselves; they don’t prove the shipped shape.
- **Hostile-path coverage.** Anything user-input-shaped on the hot path was exercised with hostile inputs in `/build`; the ship gate re-confirms it (no regression in the hostile-path test list since the last green push).
- **Failure-triggered rollback.** Every change that ships with a rollback / uninstall / revert path has an injected-failure test on record: a failure was forced after each mutating stage (permissions, missing target, interrupted write), rollback ran, and the system landed byte-identical in the pre-operation state. Without it, the rollback claim is unverified and the push is blocked.
- **Strict evidence + schema.** Every gate reports its exit status and (where applicable) a schema-validated artifact. A non-conformant artifact is itself a block. “Tests pass” without the exact `.test.mjs` files invoked and the exit codes observed is not admissible.
- **CANNOT_DETERMINE for unavailable gates.** If a gate wasn’t wired in this environment, wasn’t run this session, or its artifact was deleted, the ship closure for that gate is `CANNOT_DETERMINE` — recorded explicitly in the ship report, not elided. The operator decides whether to push anyway; the skill does not.
- **Independent same-snapshot closure.** Before the push, a second reading of the same immutable tree snapshot (commit hash, or HEAD plus diff fingerprint) by a different subagent, fresh lens, or different-vendor model confirms the first. Self-attestation is not closure; the cross-check is.
- **Claims require named fences.** Every claim in the ship report names the exact script / canary / migration, the exact revision plus a diff fingerprint when dirty, and the exit status / artifact produced. Anything else is opinion, not evidence.

These rules travel with the work. The `AGENTS.md` audit-proof policy is the project-level anchor; this section is the ship-time application of it.

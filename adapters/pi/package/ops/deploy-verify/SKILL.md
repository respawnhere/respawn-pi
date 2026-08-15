---
name: deploy-verify
description: Confirm a deploy actually landed and works in prod — CI/build status, platform rollout, health endpoint, the changed surface, and clean logs. MCP-first. Pairs with /ship step 4. Reports pass/fail with evidence; never declares "deployed" unverified.
when_to_use: ["verify the deploy", "did it deploy", "is it live", "check prod", "post-deploy check", "/deploy-verify"]
---

# /deploy-verify — confirm prod, don't assume it

**Optional target dependencies:** `respawnpack.config.json` may be absent; infer the platform only from verified project evidence, and report `CANNOT_DETERMINE` for any deploy surface that has neither configuration nor an available MCP/CLI.

## Step 1 — Run the infra snapshot
Run [`/infra-status`](../infra-status/SKILL.md)'s quick snapshot: the health endpoint (`GET /health` or the project's) with its sub-checks (DB / cache / storage / media — a failing sub-check is a real finding even if the page loads), host rollout (MCP-first per `respawnpack.config.json` `opsTargets`: Fly `fly status` / Fly MCP — machines `started`, new release id; Cloudflare Workers deployment; Vercel deployment `READY`; note the version actually serving), and recent errors (logs MCP / `fly logs` / platform logs scanned for a spike since the rollout).

When `opsTargets` names a self-managed or PaaS host (docker-compose, Render, k8s) with no managed-service MCP wired, run these same three checks — rollout, health, logs — through that platform's CLI instead: `docker compose ps` / `kubectl rollout status` / `render deploys list` for rollout, the same health endpoint, and `docker compose logs` / `kubectl logs` / the platform's log stream for errors.

## Step 2 — Build / CI status for this commit
Check the pipeline that builds + deploys (`gh run` / the CI MCP). Confirm the relevant workflow(s) succeeded for the specific commit just pushed. A green push ≠ a healthy deploy — keep going.

## Step 3 — The changed surface
Exercise what this deploy changed, in prod — the new endpoint returns 2xx (not 500), the new page renders, the migration-backed feature works. This is the step that catches "deployed but broken" (e.g. a missing migration → 500).

## When the verify fails — roll back or roll forward
**Decision rule:** roll FORWARD when the cause is already known, the fix is small, and the breakage is contained (a narrow surface, not core auth/payments/data). Roll BACK when users are actively hitting the breakage and the cause is unknown or the fix isn't quick — don't let people eat a live incident while you investigate.
- **Fly:** `fly releases` to find the prior working image, then redeploy that release.
- **Cloudflare Workers:** `wrangler rollback`, or redeploy the previous Worker version.
- **Vercel:** promote the previous deployment (dashboard or `vercel promote`).
- **Migration caveat:** an already-applied schema migration usually makes roll-forward the safer path — **never auto-revert a migration** to match old code. Reconcile schema and code deliberately (see `/db-ops`'s ordering rule) rather than reflexively rolling the DB back with the app.
- **Authorization:** a rollback is a prod write — it needs the same explicit human go-ahead as any deploy. Don't self-authorize it because it "undoes" a change.
- **Afterward:** hand the root cause to `/debug`, and capture the incident (symptom → cause → which direction was chosen and why) via `/knowledge` once resolved.

## Output
A pass/fail with evidence per step. If anything failed, surface it precisely (and, if it's a known class, `/knowledge` it). Only now is it "shipped."

## Invariants
- Never declare deployed without exercising the changed surface in prod.
- MCP-first; fall back to the vendor CLI and say so.
- A green CI run is necessary, not sufficient.

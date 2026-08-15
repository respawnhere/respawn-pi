---
name: db-ops
description: Database operations via the DB MCP (schema, migrations, safe queries, advisors). Enforces migration-before-deploy, an RLS baseline on new tables, parameterized reads, and write-authorization. MCP-first (Supabase/Postgres); falls back to the DB CLI.
when_to_use: ["run a migration", "db", "database", "apply migration", "check the schema", "query prod", "db advisors", "/db-ops"]
---

# /db-ops — schema + data, safely

If the DB MCP is unavailable, fall back to the project's DB CLI as described below; if neither interface is available, report `CANNOT_DETERMINE` and make no write.

## Step 0 — Look before you touch
List tables / inspect the schema (DB MCP `list_tables` / `list_migrations`) before any change. Read the model from `packages/.../schema` (or the ORM source) — **the schema source is the truth**; the migration must match it exactly (names, types, nullability, indexes, FKs).

## Step 1 — Migrations (write — needs authorization)
- Apply DDL via the migration tool (`apply_migration`), **not** ad-hoc SQL.
- Make it **idempotent** (`IF NOT EXISTS`, `DO $$ … duplicate_object` guards) so a partial prior run is safe.
- **RLS baseline** on every new table (deny-all + a `service_role`/owner allow), matching the project's policy.
- **Migration-before-deploy:** apply it *before* the code that reads it ships, then verify it landed. A prod write needs explicit human authorization — name the table, state the effect, ask.
- **No DB MCP wired?** When `opsTargets` names a self-managed or PaaS host (docker-compose, Render, k8s), run this same migration-before-deploy check (and the backup checks below) via `psql` and the project's migration tool (e.g. `alembic upgrade head` / `alembic current`) instead of `apply_migration` — the ordering, idempotency, and authorization rules hold identically.

**Evolve a column, don't rename it in place.** A rename or type-change while old and new code run side-by-side mid-rollout drops writes on the floor. Use the expand/contract sequence across *separate* deploys:
1. **Expand** — add the new column as nullable (or the new table); never drop or rename the old one yet.
2. **Dual-write** — write both old and new from the app so neither goes stale.
3. **Backfill in batches** — copy historical rows in bounded chunks, not one giant `UPDATE` that locks the table.
4. **Switch reads** — point reads at the new column once it's fully populated and verified.
5. **Contract (a later deploy)** — drop the old column only after nothing reads or writes it, in a *separate* deploy from the expand.

The rule that makes it safe: never rename or drop in place while both code versions are live — expand first, contract last, always in different deploys.

## Step 2 — Reads (safe)
Parameterized queries only — never interpolate user input into SQL. Some harnesses **soft-block direct prod reads**; if blocked, surface it and ask, don't route around it. Prefer the smallest query that answers the question.

## Step 3 — Advisors / health
Run the DB advisors (security + performance) where available; surface unindexed FKs, missing RLS, slow patterns. Feed real findings to `/knowledge` (gotchas) or propose a `docs/DECISIONS.md` entry if it's a structural call.

## Backups and recovery
- **Confirm it's actually on.** Managed-provider backups/PITR are a plan-tier setting, not a universal default — check the current tier actually has them enabled, don't assume.
- **Test a restore periodically**, against a branch or a scratch project — never against prod. Verify representative row counts on the restored copy; an unverified backup is a hope, not a recovery plan.
- **Ordering rule:** a restored database may be behind the schema the deployed code expects. Reconcile migrations (apply what's missing, or roll code back to match) before redeploying against a restored DB.
- Where wired, the Supabase MCP's restore surface is gated (`restore_project`) — same authorization bar as any prod write.

## Invariants
- Schema source is the truth; migrations mirror it.
- New tables get the RLS baseline; migrations are idempotent.
- Migrations land + are verified before the dependent deploy.
- Column/table changes evolve via expand → dual-write → backfill → switch reads → contract; never rename or drop in place while old and new code are both live, and never expand and contract in the same deploy.
- Prod writes need authorization; prod reads respect any gate.
- No raw user input in SQL.
- Backups are confirmed enabled and periodically restore-tested, never rehearsed against prod.

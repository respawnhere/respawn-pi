---
name: mcp-supabase
description: "MCP-first wrapper over Supabase via the official Supabase MCP (execute_sql, apply_migration, deploy_edge_function, branches, get_advisors, get_cost/confirm_cost, etc.). References the vendor `supabase/agent-skills` for product knowledge rather than restating it, and layers RespawnPack guardrails on top: cost gating, tracked migrations, advisor-driven security, and prod-write authorization."
when_to_use: ["supabase", "/mcp-supabase", "db migration", "edge function", "rls", "supabase branch", "schema change on supabase", "supabase advisors / cost"]
---

# /mcp-supabase — Supabase ops via MCP, guardrailed

Drive Supabase through the connected Supabase MCP. For Supabase *product knowledge* (DB, Auth, Edge Functions, Realtime, Storage, Vectors, Cron, Queues, RLS, migrations, client libs, Postgres best practices), use the vendor skill as the source of truth — do not restate it here.

## Vendor skill (source of truth — credited)
Install and follow `supabase/agent-skills` (MIT): `npx skills add supabase/agent-skills`. It ships `supabase` (full product surface) and `supabase-postgres-best-practices`. Treat those as canonical for *how* Supabase features work; this skill adds only RespawnPack ops guardrails. <!-- invariant -->

## Tool surface (MCP-first)
- **Reads (free, ungated):** `list_projects`, `get_project`, `list_tables`, `list_migrations`, `list_branches`, `list_edge_functions`, `get_logs`, `get_advisors`, `generate_typescript_types`, `get_cost`, `search_docs`.
- **Writes (gated):** `apply_migration`, `execute_sql` (data DML only), `deploy_edge_function`, `create_branch` / `merge_branch` / `rebase_branch` / `delete_branch`, `create_project`, `pause_project` / `restore_project`, secret/config changes.
- **CLI fallback:** if the MCP is not connected, fall back to the `supabase` CLI (`supabase db push`, `supabase functions deploy`, `supabase branches ...`) and say you are using the CLI fallback.

## Flow
1. **Read first.** Inspect with `list_tables` / `list_migrations` / `get_logs` to ground the change. Reads need no approval.
2. **Cost gate.** Before `create_project` or creating a branch, run `get_cost` then `confirm_cost`; surface the figure and get human sign-off before proceeding. <!-- invariant -->
3. **Schema changes = tracked migrations.** Author DDL through `apply_migration` on a dev branch, then `merge_branch` (rebase if behind). Do NOT run DDL through `execute_sql`. <!-- invariant --> Reserve `execute_sql` for read queries and data-only DML.
4. **Authorize the prod write.** Name the target project/branch, state the effect (e.g. "adds NOT NULL column to `public.orders` on prod"), and ask before applying any migration, secret, or destructive SQL. <!-- invariant -->
5. **Sequence.** Apply the migration / set the secret BEFORE shipping code that depends on it. <!-- invariant -->
6. **Advise after every schema change.** Run `get_advisors` for both `security` and `performance`; route findings to `/secure` and `/comply`. <!-- invariant -->
7. **Types.** After a merged schema change, run `generate_typescript_types` and update the client.

## Secrets
Reference secrets and keys by name only — never print service-role keys, anon/publishable keys, JWT secrets, or DB connection strings. Use `get_publishable_keys` only to confirm presence, not to echo values. <!-- invariant -->

## Invariants
- Run `get_cost` + `confirm_cost` before `create_project` or any branch creation; human signs off on spend. <!-- invariant -->
- Schema changes ship as tracked migrations via `apply_migration` (branch → merge), never DDL through `execute_sql`. <!-- invariant -->
- Reads are free; prod writes (migrations, secrets, destructive SQL, deploys, scale, project lifecycle) require explicit human authorization naming target + effect. <!-- invariant -->
- Run `get_advisors` (security + performance) after every schema change; feed findings to `/secure` and `/comply`. <!-- invariant -->
- Never print secret values — reference keys by name only. <!-- invariant -->
- Apply migrations/secrets before the code that depends on them. <!-- invariant -->
- Vendor `supabase/agent-skills` stays the source of truth for product knowledge; this skill never forks or restates it. <!-- invariant -->
- When the MCP is not connected, fall back to the `supabase` CLI and say so. <!-- invariant -->

Pairs with `/db-ops` and `/ship`.

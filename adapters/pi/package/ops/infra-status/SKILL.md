---
name: infra-status
description: A fast health snapshot across the managed services — health endpoint + DB/cache/storage/media/host status via MCP, plus advisors/alerts. The "is everything up?" check, with an optional deeper drill.
when_to_use: ["infra status", "is everything up", "health check", "are we down", "status", "/infra-status"]
---

# /infra-status — is everything up?

**Optional target dependencies:** `respawnpack.config.json` may be absent; use verified project/platform evidence when available and report `CANNOT_DETERMINE` for services whose MCP/CLI or configuration cannot be observed.

## Quick snapshot
1. **App health** — hit the health endpoint; report `status` + each sub-check (DB / cache / storage / media). A failing sub-check is the headline.
2. **Host** — the compute platform (Fly machines / CF Worker / Vercel) is serving the current release (MCP per `respawnpack.config.json` `opsTargets`).
3. **Data plane** — DB reachable (a trivial read or the DB MCP), cache reachable, storage reachable.
4. **Recent errors** — a quick scan of prod logs / the error reporter for a spike since the last deploy.

Report a one-line GREEN/DEGRADED/DOWN verdict + the per-service line. Keep it cheap — this is a glance, run often.

## Deeper drill (on a DEGRADED/DOWN signal)
- Pull the failing service's logs (logs MCP / CLI) and the platform's recent events/releases.
- Check advisors (DB security/perf) if the DB is implicated.
- Hand a real root-cause hunt to `/debug` (which will query memory first).

## Invariants
- Reads only — never mutate infra from a status check.
- MCP-first; fall back to vendor CLI and say which you used.
- A degraded sub-check is reported even if the app "loads."

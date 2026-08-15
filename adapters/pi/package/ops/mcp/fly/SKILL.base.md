---
name: mcp-fly
description: MCP-first runbook for operating Fly.io apps from Claude Code via the official Fly MCP (tools namespaced mcp__fly__fly-*). Defaults to read-only diagnostics (status, logs, machine/app state) and gates every state-changing op (machine, secrets, volumes, scale, certs, IPs) behind explicit human approval. No vendor skill exists for Fly; flyctl is the CLI fallback.
when_to_use: ["fly", "/mcp-fly", "fly.io", "flyctl", "check fly status", "fly logs", "fly machines", "deploy to fly", "fly secrets", "scale fly app", "fly volumes", "fly certs"]
---

# /mcp-fly — operate Fly.io apps MCP-first, reads-free and writes-gated

Drive Fly.io through the connected Fly MCP (`mcp__fly__fly-*`). Prefer MCP tools; if the Fly MCP is not connected, fall back to `flyctl` and say so. <!-- invariant -->

No vendor skill exists for Fly. The community `jeremylongshore/flyio-pack` is MIT prior art only — credited here, not copied or restated.

## Default: read-only diagnostics (free, no approval)
Run these freely to answer "what's the state?" / "why is it broken?":
- `fly-status` — app health, current release, machine roll-up.
- `fly-apps-list` — apps in the org.
- `fly-machine-list` / `fly-machine-status` — per-machine state, region, health checks.
- `fly-logs` — recent app/machine logs (do not echo secret values that appear in logs). <!-- invariant -->
- `fly-platform-status` / `fly-platform-regions` / `fly-platform-vm-sizes` — platform health and capacity reference.
- `fly-secrets-list` — secret KEY names only (never values). <!-- invariant -->
- `fly-volumes-list` / `fly-volumes-show` / `fly-volumes-snapshots-list`, `fly-certs-list` / `fly-certs-show` / `fly-certs-check`, `fly-ips-list` — inventory reads.

## State-changing ops (require explicit approval)
Before any of the below, name the target (app + machine/volume/region), state the effect, and ask for authorization. Do not proceed until granted. <!-- invariant -->
- Machines: `fly-machine-run` / `-update` / `-clone` / `-restart` / `-stop` / `-destroy` / `-cordon` / `-kill` / `-exec`.
- Secrets: `fly-secrets-set` / `-unset` / `-deploy`. Reference keys by name; never print values. <!-- invariant -->
- Volumes: `fly-volumes-create` / `-destroy` / `-extend` / `-fork`, `fly-volumes-snapshots-create`.
- Scaling: machine count/size changes via `fly-machine-*` or VM-size updates.
- Networking/TLS: `fly-certs-add` / `-remove`, `fly-ips-allocate-v4` / `-allocate-v6` / `-release`, egress IP changes.
- App lifecycle: `fly-apps-create` / `-destroy` / `-move` / `-restart`.

## Ordering: migrations & secrets before the deploy
Apply migrations and set/deploy secrets BEFORE rolling the code that depends on them. <!-- invariant --> Sequence: set secrets (`fly-secrets-set` then `fly-secrets-deploy`) → run/update machines on the new release → verify.

## Verify after every change
After an approved write, confirm with reads: `fly-status` + `fly-machine-status` + `fly-logs`. Hand off to `/deploy-verify` for full post-deploy checks. This skill sits behind the `/ship` gate — ship only after verify is green.

## CLI fallback (MCP not connected)
Map MCP tools to `flyctl` and state that you fell back:
- `flyctl status` / `flyctl logs` / `flyctl machine list` / `flyctl apps list` — reads.
- `flyctl secrets set KEY=… && flyctl secrets list` (names only), `flyctl machine run/update/destroy`, `flyctl volumes …`, `flyctl certs …`, `flyctl ips …` — writes, still gated.

## Invariants
- Prefer the Fly MCP (`mcp__fly__fly-*`); fall back to `flyctl` only when the MCP is not connected, and say so. <!-- invariant -->
- Reads (status/list/logs/show/check) need no approval; every PROD WRITE (machine run/update/destroy/restart/stop/kill/exec/cordon, secrets set/unset/deploy, volume create/destroy/extend/fork/snapshot, scale, cert add/remove, IP allocate/release, app create/destroy/move/restart) requires naming the target + stating the effect + explicit human authorization first. <!-- invariant -->
- NEVER print secret values; reference secrets by KEY name only — in `fly-secrets-*`, logs, and output. <!-- invariant -->
- Apply migrations and set/deploy secrets BEFORE deploying the code that needs them. <!-- invariant -->
- After any approved write, verify with `fly-status` + `fly-machine-status` + `fly-logs`; ship only through `/deploy-verify` and the `/ship` gate. <!-- invariant -->
- Credit `jeremylongshore/flyio-pack` (MIT) as prior art; do not copy or restate it. <!-- invariant -->

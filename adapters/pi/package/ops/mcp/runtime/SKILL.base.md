---
name: mcp-runtime
description: "Operates RespawnPack's Docker MCP Gateway: one endpoint Claude Code connects to; servers added from the signed catalog or OCI images, discovered at runtime via its dynamic tools (CLI fallback: `docker mcp`). Secrets live in the OS keychain, injected at runtime, never in plaintext config."
when_to_use: ["run the mcp gateway", "/mcp-runtime", "add an mcp server", "connect claude code to mcp", "store an mcp secret", "switch mcp profile", "discover mcp servers at runtime", "my mcp server needs an api key", "move a plaintext mcp credential into the keychain"]
---

# /mcp-runtime — operate the Docker MCP Gateway that runs RespawnPack's MCP servers

**Optional target dependencies:** `memory/` and `.respawnpack/mcp-reaper.off` may be absent; skip their dependent checks, and report `CANNOT_DETERMINE` when neither the gateway tools nor the documented CLI fallback is available.

RespawnPack runs its MCP servers behind ONE gateway endpoint instead of N stdio servers spawned per-client. Claude Code connects to that single endpoint; the gateway runs each server in an isolated container and injects keychain-held secrets at runtime. No vendor skill teaches gateway operation — Docker ships only docs plus a thin diagnostic plugin; reference it, don't rewrite it.

## Tool surface
- **MCP_DOCKER dynamic tools (MCP-first):** `mcp-find` (search the catalog), `mcp-add` (add a server to the active config), `mcp-config-set` (set a server's config value), `mcp-exec` (call a tool on a running server). Prefer these when the gateway's dynamic tools are connected. <!-- invariant -->
- **`docker mcp` CLI (fallback):** `gateway run`, `profile`, `catalog`, `client connect`, `secret`, `tools`. Use when the dynamic tools are not connected, and say you fell back. <!-- invariant -->
- **Diagnostics (vendor, reference-only):** `/docker-mcp-toolkit:gateway-status` and `/docker-mcp-toolkit:gateway-debug` from Docker's plugin. Invoke them for health/debug; do not restate or fork their content. <!-- invariant -->

## When the gateway is the right home (and when it is not)
Not every server RespawnPack drives belongs here; this gateway is the right home for one bucket of them, not all three. Route by what the server actually is:
- **Remote-OAuth endpoints (Supabase, Cloudflare) stay on direct `claude mcp add`.** This gateway proxies them as remote OAuth endpoints rather than local signed containers (see "Honest caveats" below) — no container isolation or secret-injection benefit applies, so routing them here only adds a hop.
- **Filesystem- or host-CLI-coupled local tools stay on direct `claude mcp add` too.** respawn-memory's `rmem mcp` reads this repo's `memory/` dir directly, and Graphify serves a local `graph.json` and rules this gateway out in its own skill for that exact reason (see `/mcp-graphify`). Containerizing either buys volume mounts and re-auth, not isolation that matters here.
- **Keyed and/or third-party-code servers are this gateway's job.** `mcp-security-audit` and other `npx -y` servers, Context7, and Playwright (when adopted) belong here: `docker mcp secret set` keeps the key out of plaintext `.mcp.json`/`.claude.json`, the container isolates code this pack didn't write, and one endpoint serves every client.

Route by what the server is, not by habit: keyed/third-party servers through the gateway; remote-OAuth and filesystem-coupled local tools stay on direct `claude mcp add`. <!-- invariant -->

This skill owns the routing rule above. For available server choices and source annotations, use the [catalog page](../../../../../../catalog/README.md); verify exact commands against the current vendor documentation before making a state-changing call.

Code-structure queries (what-calls-X, blast radius, symbol-to-symbol paths) route to `/mcp-graphify` instead, where the Graphify extra has been adopted.

## Run the gateway and connect Claude Code
1. **Pick/define a profile** (the named set of servers for this project): `docker mcp profile` to list; a profile groups the servers a project needs.
2. **Run one gateway endpoint:** `docker mcp gateway run --profile <name>`. This is the single endpoint all clients attach to.
3. **Connect Claude Code:** `docker mcp client connect claude-code --profile <name>`. Claude Code now sees every server in the profile through one connection.
4. **Verify:** run `/docker-mcp-toolkit:gateway-status` (vendor) or `docker mcp tools` to list the live tools.

Once wired, the chain needs no manual step: Claude Code launches the gateway process at session start; the gateway boots each enabled server's container at the client **handshake** (tool enumeration requires a running server — enablement costs containers, not just listings; see Container lifecycle below); the only prerequisite is Docker Desktop itself running, so enable its "Start Docker Desktop when you sign in" setting (Settings → General) to make the whole thing hands-off.

**Profiles are shareable:** a profile publishes as an OCI artifact — `docker mcp profile push <ref>` / `docker mcp profile pull <ref>` — so a team distributes a reference server-set instead of everyone hand-building one (RespawnPack's own reference profile: `respawnhere/respawn_pack`). `profile export`/`profile import` cover file-based sharing when a registry isn't in play.

## Add a server
- **From the signed catalog (preferred):** `mcp-find <query>` (or `docker mcp catalog`) to locate a server in the `mcp/` namespace, then `mcp-add` (or `docker mcp catalog enable <server>`). Signed `mcp/` images run in container isolation. <!-- invariant -->
- **From an OCI image:** add the image reference to the profile/catalog when no `mcp/` entry exists; it still runs containerized.
- **Prefer signed `mcp/` images over `npx -y @untrusted/server`** — the unpinned-npx path runs third-party code on the host with no isolation; the container path closes that supply-chain hole. <!-- invariant -->
- Apply the server's config/secret BEFORE connecting the code that calls it. <!-- invariant -->

## Secrets posture (the point)
- **Store every credential in the OS keychain:** `docker mcp secret set NAME` — the gateway injects it into the container at runtime. <!-- invariant -->
- **Credentials NEVER live in `.mcp.json` / `.claude.json` plaintext.** Reference keys by name only; never print a secret value. <!-- invariant -->
- This removes the exact artifact the `secret-scan` hook and the `/secrets-audit` skill hunt for — when you migrate a server onto the gateway, move its key out of any plaintext config into `docker mcp secret set` and cross-check with `secret-scan` / `/secrets-audit` that no plaintext copy remains. <!-- invariant -->
- A PROD WRITE here — adding/enabling a server, setting a secret, switching the live profile, or connecting a client — names the target, states the effect, and asks for explicit human authorization before running. <!-- invariant -->

## Discover/add at runtime
- `mcp-find <query>` searches the catalog from inside the session; `mcp-add` enables the chosen server; `mcp-config-set` sets its config; `mcp-exec` calls one of its tools — all without restarting the client.
- After a runtime add, re-run `docker mcp tools` (or the vendor `gateway-status`) to confirm the new tools are live.

## Container lifecycle (why idle MCP containers appear, and who stops them)
- **Every enabled container-backed server boots on every client handshake** — each connecting session or subagent can wake all of them, used or not, and sandbox orchestrators hold `docker.sock` by design while idling. So keep the enabled set lean: disable servers nobody calls (Toolkit UI or the catalog CLI) — that, not cleanup, is the primary lever.
- **The gateway reaps lazily and only on clean disconnects;** a crashed session's containers linger. The `mcp-reaper` hook makes shutdown deterministic: SessionEnd stops every `docker-mcp=true`-labeled container (stateless by design — a concurrent session's next handshake transparently respawns what it needs), SessionStart sweeps stale orphans (>2h; tune `RESPAWNPACK_MCP_REAPER_STALE_HOURS`). Opt-out: `.respawnpack/mcp-reaper.off`.
- **Session-started containers are auto-labeled, and auto-closed on the same policy.** When Claude runs a plain `docker run`/`docker create`, the `docker-session-tag` hook stamps `--label respawnpack.session=<id>` (plus a readable `--name respawnpack-<image>-<hex>` when you didn't name it), so every AI-started container is session-scoped and human-identifiable. Declare its *class* deliberately: `--label respawnpack.class=temp` marks a disposable — `mcp-reaper` **stops and removes** it at session end — whereas no class = infra, which is **stopped but never removed** (a restartable persistent container), and `--label respawnpack.keep=true` is left completely untouched by every reaper path. Name containers for humans (`<project>-<service>`) so a `docker ps` stays legible.

## Honest caveats
- **Remote-OAuth endpoints (Supabase, Cloudflare) are proxied, not contained:** the gateway brokers them as remote OAuth endpoints rather than local signed containers — secret-injection isolation applies to local containerized servers, not these. Treat their auth as the vendor's OAuth flow.
- **Windows needs the WSL2 backend:** Docker Desktop must run on the WSL2 backend, but the gateway and `docker mcp` CLI run fine invoked from Windows itself (PowerShell, Claude Code on the Windows side) — no need to run them from inside WSL2.
- **Pure Docker Engine / headless has rough edges with `docker mcp secret set`** (no Desktop keychain backend); on headless hosts, verify the secret store works before relying on injection, and fall back to the host's secret manager if it does not.

## CLI fallback (when MCP_DOCKER dynamic tools are not connected)
- find → `docker mcp catalog`; add → `docker mcp catalog enable <server>`; config → `docker mcp config`; exec → call the tool after `client connect`. State that you fell back to the CLI. <!-- invariant -->

## Invariants
- Route keyed/third-party servers through the gateway; leave remote-OAuth and filesystem-coupled local tools on direct `claude mcp add`. <!-- invariant -->
- Credentials live in the OS keychain via `docker mcp secret set` and are injected at container runtime; they NEVER appear in `.mcp.json`/`.claude.json` plaintext, and secret values are never printed. <!-- invariant -->
- A PROD WRITE (add/enable a server, set a secret, switch the live profile, connect a client) requires explicit human authorization — name the target, state the effect, ask first. <!-- invariant -->
- Prefer signed `mcp/`-namespace catalog images (container-isolated) over `npx -y @untrusted/server`; use OCI images when no catalog entry exists. <!-- invariant -->
- Apply a server's config/secret BEFORE connecting the code that depends on it. <!-- invariant -->
- MCP-first: drive the gateway via the MCP_DOCKER dynamic tools; fall back to the `docker mcp` CLI only when they are not connected, and say so. <!-- invariant -->
- Reference Docker's diagnostic plugin (`/docker-mcp-toolkit:gateway-status`, `gateway-debug`) for health/debug; do not restate or fork vendor content. <!-- invariant -->
- After migrating a server onto the gateway, cross-check with the `secret-scan` hook and `/secrets-audit` skill that no plaintext credential copy remains. <!-- invariant -->

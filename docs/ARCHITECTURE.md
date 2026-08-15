# Architecture

## Layers

1. **Pi package surface** — the root `package.json` exposes the rollover extension and skills.
2. **Pi adapter** — `adapters/pi/` translates Pi lifecycle and RPC events into continuity operations.
3. **Continuity core** — `core/` owns state transitions, evidence, handoffs, thresholds, and candidate memory.
4. **Project framework** — `AGENTS.md`, `skills/`, and `docs/` guide normal coding work.
5. **VM boundary** — Debian permissions, mounts, snapshots, and network policy contain the process.

Dependencies point inward: the project framework can invoke the adapter; the adapter can use `core/`; the
core cannot depend on Pi, skills, hooks, or host automation.

## Package lifecycle and project initialization

Pi owns package lifecycle through `pi install`, `pi update`, `pi config`, and `pi remove`. Project-local
installation (`-l`) is the recommended default. Respawn-pi never independently appends package entries to
`.pi/settings.json` and never chooses a provider, model, thinking level, or compaction configuration.

Project initialization is a separate explicit operation. `scripts/init-project.mjs` adds only the managed
workflow instruction block, runtime ignore, target configuration, and—only in greenfield mode—neutral,
explicitly uninitialized canonical templates. Brownfield mode creates no project truth and routes to
`/onboard`. Target docs and the target `D-*` namespace are never inherited from package docs.

## Package implementation vs target data authority

Extensions, scripts, and schemas execute from the installed package. The active target directory owns its
Git revision and candidate tree, requirements/evidence when configured, canonical docs, generated
`docs/derived/STATE.json`, and pending handoff. Savepoint and pending-note verification bind the target;
they do not mutate or qualify the installed package checkout. Two projects using one package installation
therefore retain independent continuity state.

## Governance profiles

The default `continuity` profile does not impose blocking push, secret, shell, index, or configuration
policy. A target opts into those repository rules through `respawnpack.config.json` with
`governance.profile: "guarded"` (or an explicit process environment override). Intrinsic execution bounds,
worktree containment, and marker-armed controls remain active because they constrain package execution
rather than asserting target product policy.

## Rollover path

At `agent_settled`, the extension reads Pi's context usage. When the final threshold fires, it writes and
reads back a handoff, requests `ctx.compact()`, observes `session_compact`, verifies the session identity,
and injects the handoff once at the next `before_agent_start` event.

The out-of-process RPC supervisor is included for controlled experiments and integration. It uses strict
JSONL framing and the documented `type` request envelope. The extension is the normal interactive profile.

## Runtime data

Continuity state lives under a target's `.respawnpack/runtime/` directory and is ignored by git. Pi's own
credentials and sessions remain in its user configuration directory. These are operational records, not
source artifacts.

## Package-agent orchestration boundary

The package-owned 32-agent bench lives entirely under the package root; no global files, no
symlinks, no `pi.agents` manifest field. The public dispatch surface is the canonical Pi-aligned
`respawn-pi-subagent` tool (`respawn-pi:D-011`), with three Pi-compatible modes — `single`, `parallel`,
`chain` — and four scopes — `package` (default), `user`, `project`, `both` — with deterministic
precedence `project > package > user`. Parallel is bounded to 8 tasks per call with concurrency
≤ 4; chain is bounded to 8 steps; every call is bounded by a single TOTAL `timeoutMs` (1 s…300 s,
default 30 s) that chain and parallel do not multiply by step/task count (each subsequent unit
uses the REMAINING budget). The dispatch is gated behind `RESPAWNPACK_AGENT_DISPATCH=1`; without
the env var the runner returns a structured refusal and no child process is started. The child
`pi` process receives the agent's system prompt via `--append-system-prompt` and the agent's
declared lowercase Pi 0.84.0 tool allowlist; intermediate JSONL/tool events are suppressed; the
result is bounded (model-visible ≤ 200 KiB; structured details ≤ 256 KiB; per-task preview ≤
1 KiB; stderr ≤ 4 KiB per result).

## Retained wrapper security delta

Pi 0.84.0 ships native lowercase tool names (`read`, `write`, `edit`, `grep`, `find`, `ls`,
`bash`). The package's `respawn_pi_grep` and `respawn_pi_glob` are retained as separate
package-operation wrappers because Pi's native `grep` and `find` ship without the
package's strict cwd / symlink containment contract (`respawn-pi:D-007`) — the wrappers wrap `rg`
with cwd containment, lexical symlink-component refusal, bounded byte/line caps, and
per-call timeouts. They are an intentional security delta, not accidental compatibility
code. The 32 shipped agents declare lowercase `read`, `grep`, `find` (plus `write` for
the two write-scoped onboarding mappers); the runtime maps BOTH declared lowercase
`grep` and `find` to the bounded package wrappers so the child receives the contained
wrappers, NOT the uncontained native primitives. Direct wrapper names
(`respawn_pi_grep`, `respawn_pi_glob`) remain accepted internally as a translation
target so the runtime can resolve them without an alias, but they are not the shipped
declaration norm — the shipped norm is lowercase `read`, `grep`, `find` (plus `write`
for the two write-scoped onboarding mappers); operator-facing declaration guidance
lives in `docs/USER-GUIDE.md` §5.4 and is not duplicated here. The runner rejects
PascalCase declarations and unknown names before spawn. `respawn_pi_command` is a
separate package-operation capability for the bounded `state-status` / `savepoint` /
`savepoint-verify` / `goal-*` action allowlist; it does not accept arbitrary argv or
path.

## Deliberately absent

There are no `.claude/` hooks, Docker files, MCP configurations, background daemons, network listeners, or
cross-agent coordination services in this package. The generic Pi-example tool name `subagent`
is intentionally not registered, so a globally installed Pi example extension can coexist
without tool override or agent-name leakage.

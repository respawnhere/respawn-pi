# Security policy

## Security model

`respawn-pi` is a Pi package, not a sandbox. Pi extensions execute in the Pi process and child Pi agents run with the Debian user's permissions. The primary containment boundary is the operator's non-root account plus the VM, container, mounts, and network policy around it.

Installation alone does not authorize a push, tag, publish, production write, or deploy.

## Current security scope

Reports are in scope when they affect the active Pi package, including:

- `scripts/init-project.mjs` and `scripts/uninit-project.mjs` target containment, rollback, template provenance, and managed-file handling;
- extension loading and project trust interactions;
- `respawn-pi-subagent` authorization, agent discovery, tool grants, cwd containment, output/deadline bounds, abort handling, and process-group cleanup;
- rollover state, handoff identity, savepoint verification, and compaction lifecycle;
- nonce-bound fresh-target canary behavior;
- MCP bridge startup bounds, tool registration limits, and child cleanup;
- governance extensions such as push, shell, worktree, index, secret, supply-chain, and configuration guards;
- accidental credential or sensitive-data disclosure by package code or logs.

The maintained surface is the Pi-only Git package and its generated install-only release projection. Historical Claude-oriented and custom package-registration installers are development history, not active release paths. A vulnerability that demonstrates a reusable flaw in current code remains in scope even if first noticed in retired code.

## Report a vulnerability

Use private vulnerability reporting on the repository host for the checkout you received. If private reporting is unavailable, contact the maintainer through a non-public channel before sharing reproduction details.

Include:

- the affected revision or package version;
- the operating system, Node version, and Pi version;
- the smallest safe reproduction;
- expected and actual behavior;
- whether credentials, filesystem paths, subprocesses, project trust, or a remote service are involved;
- any evidence that the issue is exploitable across a target or package boundary.

Do not include live credentials, private repository content, or destructive payloads. Do not open a public issue until the maintainer confirms disclosure is safe. There is no bounty program or guaranteed response time.

## Operator responsibilities

- Review package and project-agent source before trusting it.
- Run Pi as a non-root user in an appropriate OS boundary.
- Keep provider credentials in Pi's auth store or environment, never in the repository.
- Start Pi with `RESPAWNPACK_AGENT_DISPATCH=1` only when child-agent execution is intended.
- Treat user/project agents and configured MCP servers as additional trust boundaries.
- Inspect requested tool grants. Package defaults reduce agency but cannot contain arbitrary code executed by the parent Pi process.
- Prefer project-local Pi installation pinned to an immutable Git ref; a local-path package loads code from that live directory.

## Built-in controls

The active package includes:

- whole-operation project initializer/uninitializer preflight and rollback;
- refusal of symlinked package, target, managed, agent, marker, and search paths;
- package-only agent discovery by default;
- explicit lowercase tool allowlists for all 32 agents;
- an execution gate for child Pi dispatch;
- bounded parallelism, deadlines, output, and structured details;
- process-group termination and reap checks;
- nonce-bound activation markers;
- bounded MCP startup and registration;
- an explicit `guarded` profile for blocking push, secret, shell, index, and configuration policy; the default `continuity` profile does not impose those project rules;
- worktree containment and explicitly marker-armed controls.

These are defense-in-depth controls. They do not turn Pi into a permission sandbox.

## Out of scope

- Provider outages, billing disputes, or model-quality issues without a package security defect.
- Vulnerabilities in Pi itself, Node.js, a model provider, or an MCP server that do not arise from `respawn-pi` integration code.
- Operator-authored agents, skills, or project instructions outside this package.
- A hostile user who already controls the Debian account running Pi.
- Claims based only on the retired Claude Code installer when no current Pi path is affected.

Report upstream issues to the component that owns them, while privately notifying this project if `respawn-pi` needs a mitigation.

# RespawnPi package surface

This document describes the installed package. It is package-owned documentation and is never copied into target projects.

**License:** AGPL-3.0-or-later. Modified versions offered for remote network interaction are subject to AGPL section 13. Attributed third-party material retains its source license.

## Runtime resources

- 22 Pi extensions for continuity, package-agent tooling, optional MCP integration, advisories, containment, and opt-in repository governance.
- 29 workflow and operations skills.
- 32 package-owned specialist agents exposed through `respawn-pi-agents` and `respawn-pi-subagent`.
- A bounded `respawn_pi_command` tool for target state, goals, and explicit project initialization.

The exact resource paths are declared in root `package.json#pi`.

## Package lifecycle

Pi exclusively owns registration, update, filtering, and removal:

```bash
pi install -l https://github.com/respawnhere/respawn-pi
pi update --extensions
pi config -l
pi remove -l https://github.com/respawnhere/respawn-pi
```

RespawnPi does not select a provider/model or independently edit `.pi/settings.json`.

## Project initialization

Initialization is explicit and separate from package installation.

- **Greenfield:** creates neutral, visibly uninitialized `PRODUCT`, `FEATURES-PAGES`, `ARCHITECTURE`, `DECISIONS`, and `ROADMAP` templates.
- **Brownfield:** creates no canonical project truth and routes the operator to `/skill:onboard`.
- **Uninitialization:** removes managed workflow material while preserving project docs by default.

The target owns its `D-*` decision namespace. Package decisions use a `respawn-pi:D-*` namespace when referenced from target workflows.

## Continuity authority

Installed package code and schemas implement continuity. The active target owns:

- Git revision and candidate tree;
- requirements, fence declarations, and evidence when configured;
- canonical project docs;
- `docs/derived/STATE.json`;
- `.respawnpack/runtime/` handoffs and journals.

Target savepoints do not mutate the installed package checkout. Projects sharing one installation retain independent state.

## Governance

The default `continuity` profile leaves blocking push, secret, shell, index, and configuration policy disabled. A target explicitly selects `guarded` in `respawnpack.config.json` to activate those rules. Worktree containment, execution/output bounds, dispatch authorization, and marker-armed controls remain safety boundaries.

## Deliberately absent

- Pi-core patches
- a `pi.agents` manifest field
- global agent-file installation
- required Docker or MCP servers
- provider credentials
- automatic production writes, pushes, tags, publications, or deployments
- symlink-dependent package resources
- target product decisions copied from the package

## Security boundary

Pi and child Pi processes run with the operating-system user's permissions. Process separation is not a sandbox. Use a non-root account and an OS boundary appropriate to the target repository.

# RespawnPi operator guide

This guide covers project-local installation, explicit project initialization, normal use, verification, and removal.

## 1. Understand the boundary

RespawnPi is a Pi package containing extensions, skills, packaged agents, continuity code, and optional repository policy. It does not modify Pi core.

Pi packages execute with the operating-system user's permissions. Extensions can run code and skills can direct tools. Review package source before installation and use an appropriate VM or container boundary.

Three authorities remain separate:

1. **Pi package lifecycle:** Pi owns registration, update, filtering, and removal.
2. **RespawnPi implementation:** installed package code and schemas implement the workflows.
3. **Target project data:** the active project owns its code, Git tree, product docs, decisions, requirements, evidence, and continuity state.

## 2. Install Pi and RespawnPi

Requirements:

- Node.js 20 or newer;
- Git;
- Pi on `PATH`;
- a non-symlink target directory.

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
cd /absolute/path/to/your/project
pi install -l https://github.com/respawnhere/respawn-pi
```

`-l` records the package in project settings. This is preferred over a global install because package behavior should be selected repository by repository.

Pi clones Git packages, installs their runtime dependencies, and loads resources declared in `package.json#pi`. Use an immutable tag or commit for reproducible team installation:

```bash
pi install -l git:github.com/respawnhere/respawn-pi@<immutable-ref>
```

RespawnPi never sets `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, `enabledModels`, or compaction preferences. Authenticate and select a model through Pi itself:

```text
/login
/model
```

## 3. Initialize a target

Installation makes package resources available. It does not assert product truth about the target.

Start Pi from the target and choose one initialization mode.

### 3.1 Brownfield

For an existing codebase:

```text
Use respawn_pi_command with action "project-init" and value "brownfield".
Run /skill:onboard.
```

Brownfield initialization writes only:

- the marked RespawnPi block in `AGENTS.md`;
- `.respawnpack/` in `.gitignore`;
- neutral `respawnpack.config.json` with `spine.status: "onboarding-required"`.

It creates no `PRODUCT`, `DECISIONS`, architecture, roadmap, or feature-surface claims. `/skill:onboard` maps existing code and asks for confirmation before project truth is written.

### 3.2 Greenfield

For a new project:

```text
Use respawn_pi_command with action "project-init" and value "greenfield".
```

Greenfield initialization also creates five explicitly uninitialized templates under `docs/`:

- `PRODUCT.md` — purpose, feature inventory, scope;
- `FEATURES-PAGES.md` — features mapped to real public surfaces;
- `ARCHITECTURE.md` — components, boundaries, data, runtime;
- `DECISIONS.md` — empty target-owned decision ledger;
- `ROADMAP.md` — proposed now/next/later work.

The templates contain visible placeholders and an uninitialized marker. No `D-*` identifier is allocated. Confirm and replace placeholders before treating them as authority.

`GAPS`, `CONTINUITY`, `CHANGELOG`, and `STATE` are generated under `docs/derived/`; they are not starter templates.

### 3.3 Guarded profile

Blocking repository policy is opt-in. Append `-guarded` to either mode:

```text
Use respawn_pi_command with action "project-init" and value "brownfield-guarded".
```

Supported values:

- `greenfield`
- `brownfield`
- `greenfield-guarded`
- `brownfield-guarded`

The default `continuity` profile leaves push, secret, shell, Git-index, and configuration policy to the project. `guarded` enables those RespawnPi controls. The selection is stored at `respawnpack.config.json#governance.profile`.

## 4. What belongs to the target

When operating in a target, RespawnPi resolves these from the target—not from the installed package clone:

- Git HEAD and the bounded candidate tree;
- `requirements.json`, when the target adopts one;
- target `scripts/fence-registry.json` and target evidence, when requirements are active;
- target `docs/PRODUCT.md` identities;
- target `docs/derived/STATE.json`;
- target `.respawnpack/runtime/` handoffs and journals;
- target `docs/goal.md` and active goal contract.

A target without approved requirements receives the smaller honest `tracksRequirements: false` STATE branch. RespawnPi's own package requirements are never treated as another project's completion denominator.

The package checkout supplies executable code, schemas, and package-capability metadata. Target savepoints do not write into it.

## 5. Work with skills

| Need | Command |
|---|---|
| Resume and orient | `/skill:respawn` |
| Plan | `/skill:loadout` |
| Implement | `/skill:build` |
| Diagnose | `/skill:debug` |
| Review | `/skill:review` |
| Exercise the product | `/skill:playtest` |
| Security review | `/skill:secure` |
| Compliance review | `/skill:comply` |
| Improve writing | `/skill:wordsmith` |
| Save and hand off | `/skill:savepoint` |
| Run an explicit goal | `/skill:run-goal` |
| Release | `/skill:ship` |

Package policy references use a descriptive name or a `respawn-pi:D-*` namespace. Bare `D-*` identifiers belong to the target project's own `docs/DECISIONS.md`.

## 6. Continuity and savepoints

The rollover extension observes Pi lifecycle events and measures context use. The executable default ladder is **60/75/85** for advisory/checkpoint/final; an active goal may provide its own strictly ascending thresholds. Before compaction it stages and verifies a target-bound handoff, requests compaction at a safe boundary, and injects the handoff once after rollover.

Run before pausing or manually compacting:

```text
/skill:savepoint
```

A savepoint writes:

- `<target>/docs/derived/STATE.json`;
- `<target>/.respawnpack/runtime/rollover/_pi-pending-note.json`.

Both are bound to the target's revision/candidate tree and compiler inputs. If the target changes after savepoint, verification becomes stale rather than silently passing.

Resume with:

```text
/skill:respawn
```

## 7. Package agents

Ask Pi to use `respawn-pi-agents` in `package` mode to list the 32 shipped roles. Listing starts no child process.

Child dispatch requires explicit opt-in before starting the parent Pi process:

```bash
RESPAWNPACK_AGENT_DISPATCH=1 pi
```

`respawn-pi-subagent` supports:

- single mode;
- parallel mode, up to eight tasks with concurrency at most four;
- chain mode, up to eight steps using `{previous}`.

Every call has one total bounded deadline. Child Pi processes still have the operating-system user's permissions.

## 8. Optional integrations

MCP-facing skills and the MCP bridge are optional. Installing RespawnPi does not configure a server, inject credentials, or grant production access. An unavailable service is reported as `CANNOT_DETERMINE` or follows the fallback documented by its skill.

## 9. Verify

From a package checkout:

```bash
npm ci --ignore-scripts
node scripts/check-pi-installable.mjs
node scripts/bootstrap-load.mjs
npm test
```

A release candidate additionally requires:

- deterministic projection from the positive release manifest;
- clean `npm ci` using the shipped lockfile;
- 22/22 extension loading with zero errors;
- all 29 skill dependencies closed;
- isolated target initialization tests;
- two-target state isolation;
- a real project-local Pi Git installation;
- no forbidden development surfaces or credential patterns.

## 10. Update and remove

Update through Pi:

```bash
pi update --extensions
```

To remove target initialization while preserving project docs:

```text
Use respawn_pi_command with action "project-uninit".
```

Then remove package registration:

```bash
pi remove -l https://github.com/respawnhere/respawn-pi
```

Uninitialization removes the managed `AGENTS.md` block, runtime ignore, and untouched managed configuration. Canonical project docs remain. The standalone script supports an explicit `--remove-stubs` option that deletes only byte-identical, still-uninitialized templates.

Runtime state is preserved for recovery unless the operator deliberately removes `.respawnpack/` after review.

## 11. Troubleshooting

- **Package behavior appears stale:** restart Pi or use `/reload` after updating extension source.
- **Project initialization refuses greenfield:** an existing canonical doc was found; use brownfield mode and `/skill:onboard`.
- **A guarded action is unexpectedly allowed:** verify `respawnpack.config.json#governance.profile` is `guarded`, then reload.
- **A savepoint is stale:** inspect target Git changes and rerun `/skill:savepoint`; do not hand-edit STATE.
- **A package command cannot resolve:** verify the Git checkout contains the required `scripts/` runtime files and run `pi update --extensions`.

## 12. Package documentation versus project documentation

The repository's `docs/PRODUCT.md`, `docs/DECISIONS.md`, and `docs/ARCHITECTURE.md` describe RespawnPi itself. They remain inside the installed package for transparency and are not copied to targets. Only neutral files under `templates/project/docs/` can seed a greenfield target.

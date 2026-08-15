# respawn-pi

RespawnPi is an installable development-reliability package for [Pi](https://pi.dev). It adds durable session continuity, structured engineering workflows, packaged specialist agents, repository guardrails, and evidence-backed completion without modifying Pi core.

## Safety boundary

Pi packages execute with the operating-system user's permissions. Pi is not a sandbox. Review this repository before installation, use a non-root account, and use a VM or container when the repository requires stronger isolation.

## Requirements

- Node.js 20 or newer
- Pi installed and available as `pi`
- Git
- A target project that is not a symlink

Install Pi using its documented package:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

## Install the package

Project-local installation is recommended so one repository does not silently affect every Pi session:

```bash
cd /absolute/path/to/your/project
pi install -l https://github.com/respawnhere/respawn-pi
```

Pi owns package registration, updates, filtering, and removal. RespawnPi does not independently modify `.pi/settings.json` and does not select a provider, model, thinking level, or compaction configuration.

For a reproducible team installation, pin the Git source to an immutable release tag or commit once one is published:

```bash
pi install -l git:github.com/respawnhere/respawn-pi@<immutable-ref>
```

## Initialize the project workflow

Package installation and project initialization are deliberately separate. Start Pi in the target and invoke the bounded package command.

### Existing project

```text
Use respawn_pi_command with action "project-init" and value "brownfield".
Then run /skill:onboard.
```

Brownfield initialization adds the managed `AGENTS.md` instructions, `.respawnpack/` ignore, and neutral RespawnPi configuration. It creates no canonical product or decision documents. `/skill:onboard` inspects the existing code and proposes project truth for human confirmation.

### New project

```text
Use respawn_pi_command with action "project-init" and value "greenfield".
```

Greenfield initialization creates explicitly uninitialized, target-owned templates:

- `docs/PRODUCT.md`
- `docs/FEATURES-PAGES.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/ROADMAP.md`

No decision identifier is preallocated. The target project owns its entire `D-*` namespace. RespawnPi's package decisions remain package documentation and are never copied into the target.

## Governance profiles

The default `continuity` profile does not impose blocking push, secret, shell, index, or configuration policy. To opt into those repository guardrails during initialization, use:

```text
Use respawn_pi_command with action "project-init" and value "brownfield-guarded".
```

or `greenfield-guarded` for a new project. The choice is stored in target-owned `respawnpack.config.json` and can be reviewed in source control.

Worktree containment, bounded process execution, output limits, explicit subagent authorization, and marker-armed controls remain active because they constrain package execution rather than asserting product policy.

## Daily workflow

Pi exposes skills as `/skill:<name>`:

```text
/skill:respawn       # validate target state and resume
/skill:loadout       # plan a non-trivial change
/skill:build         # implement the approved plan
/skill:review        # run bounded multi-lens review
/skill:playtest      # exercise the real surface and add regressions
/skill:savepoint     # generate target state and verify the handoff
```

Other useful skills include `/skill:debug`, `/skill:secure`, `/skill:comply`, `/skill:wordsmith`, `/skill:run-goal`, and `/skill:ship`.

## Target-owned continuity

Package scripts and schemas execute from the installed package, but continuity data belongs to the active target project:

- target Git revision and candidate tree;
- target requirements and evidence when configured;
- target canonical docs and `D-*` decisions;
- `docs/derived/STATE.json`;
- `.respawnpack/runtime/` journals and pending handoffs.

The installed package checkout remains implementation authority and is not mutated by target savepoints. Two projects using the same package installation have independent state.

Derived files are generated under `docs/derived/`; they are not starter templates. Never hand-edit `docs/derived/STATE.json`.

## Packaged agents

`respawn-pi-agents` lists the 32 package-owned roles without spawning a process. Child dispatch requires an explicit environment opt-in before starting Pi:

```bash
RESPAWNPACK_AGENT_DISPATCH=1 pi
```

Then use `respawn-pi-subagent` in single, parallel, or chain mode. Package agents execute as child Pi processes with the same operating-system permissions; process separation is not sandboxing.

## Verify a checkout

```bash
npm ci --ignore-scripts --omit=dev
node scripts/check-pi-installable.mjs
node scripts/bootstrap-load.mjs
```

Release qualification additionally exercises a clean public Git installation through real Pi. An unavailable provider, credential, or external service is `CANNOT_DETERMINE`, never PASS.

## Remove

First remove optional target initialization from inside Pi:

```text
Use respawn_pi_command with action "project-uninit".
```

Project docs are preserved by default. Then remove the project-local package registration:

```bash
pi remove -l https://github.com/respawnhere/respawn-pi
```

Runtime data remains available for recovery unless the operator explicitly deletes it after review.

## Documentation

- [Operator guide](docs/USER-GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Package feature inventory](docs/PRODUCT.md)
- [Package decisions](docs/DECISIONS.md)
- [Security policy](SECURITY.md)
- [Attribution](ATTRIBUTION.md)

These files document the RespawnPi package. They are not copied into target projects.

## License

Copyright (C) 2026 respawnhere (RespawnPack).

RespawnPi is licensed under **AGPL-3.0-or-later**. When you convey a covered modified or derivative version, the AGPL's source, notice, and same-license obligations apply. If you modify RespawnPi and let users interact with it remotely through a computer network, section 13 requires an opportunity for those users to receive the corresponding source. Mere aggregation does not place unrelated works under the AGPL.

Third-party works and references retain the licenses recorded in [ATTRIBUTION.md](ATTRIBUTION.md). See [LICENSE](LICENSE) for the complete AGPLv3 terms. This summary is not legal advice.

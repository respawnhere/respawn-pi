# Features and public surfaces

This is the installed package's user-facing surface map. It is not a target-project feature matrix.

| Capability | Public surface |
|---|---|
| Install/update/filter/remove | Pi-native `pi install -l`, `pi update`, `pi config -l`, `pi remove -l` |
| Explicit project initialization | `respawn_pi_command` action `project-init` |
| Explicit project uninitialization | `respawn_pi_command` action `project-uninit` |
| Resume target continuity | `/skill:respawn` and `respawn_pi_command` action `state-status` |
| Save and verify target handoff | `/skill:savepoint`; actions `savepoint` and `savepoint-verify` |
| Goal mode | `/skill:run-goal`; target `docs/goal.md`; goal command actions |
| Plan/build/review/test | `/skill:loadout`, `/skill:build`, `/skill:review`, `/skill:playtest` |
| Debug/security/compliance | `/skill:debug`, `/skill:secure`, `/skill:comply` |
| Package agent listing | `respawn-pi-agents` |
| Bounded child dispatch | `respawn-pi-subagent` single/parallel/chain |
| Bounded package search | `respawn_pi_grep`, `respawn_pi_glob` |
| Optional MCP operations | MCP bridge and shipped MCP-facing skills |
| Default continuity profile | rollover, state, advisories, and intrinsic execution bounds |
| Guarded repository profile | explicit target opt-in for push/secret/shell/index/configuration policy |

## Primary flows

1. Install the package project-locally with Pi.
2. Explicitly initialize as greenfield or brownfield.
3. Start work with `/skill:respawn`.
4. Plan and implement with `/skill:loadout` and `/skill:build`.
5. Review through one bounded discovery/remediation sequence.
6. End with `/skill:savepoint` so target state and handoff are verified.
7. Remove initialization and package registration independently when needed.

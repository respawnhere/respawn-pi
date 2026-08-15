---
name: respawn-rollover
description: Prepare and verify a durable handoff across Pi context compaction. Use before /compact, when context is getting full, or when asked to checkpoint, save progress, prepare to compact, or resume from a respawn-pi handoff.
when_to_use: ["/savepoint", "/respawn", "savepoint", "respawn", "context getting full", "before /compact", "checkpoint progress", "prepare to compact", "resume from handoff", "compaction handoff", "save context", "durable handoff", "preserve state across compaction"]
---

# Respawn rollover

**Optional target dependencies:** rollover runtime markers and the savepoint reference/script named below may be absent; use the manual bounded handoff path where documented and report `CANNOT_DETERMINE` if no activation or verified artifact can be observed.

## Check activation

Look for `.respawnpack/runtime/rollover/_pi-extension-canary.json` in the target project.

- Missing: the extension has not been observed here; save the note and compact manually.
- `degraded: true`: the extension is inert. Reinstall the package or set `RESPAWN_PI_BRIDGE` to the bridge.
- Present and recent: the extension is live and evaluates rollover at `agent_settled`.

An interactive launch can establish project trust. For an intentional non-interactive run, Pi supports the
one-run `--approve` override.

## Write the pending note

Create `.respawnpack/runtime/rollover/_pi-pending-note.json`:

```json
{
  "exactNextAction": "one concrete step that can be started cold",
  "atomicActionId": "optional short task id",
  "userConstraints": ["constraints that must survive compaction"],
  "unresolvedQuestions": ["facts that remain unverified"],
  "candidateMemories": ["ids only, never unverified claim text"]
}
```

Finish or cleanly stop the current atomic edit first. A precise next action names a file, symbol, command,
or verification step; “continue working” is not sufficient.

### Tier 2 (structured fields, optional but recommended)

For high-context sessions, also include the structured fields below so the resume can be a thin pointer
instead of a recap. See `docs/reference/savepoint-schema.md` for the full schema and rationale.

```json
{
  "goal": {
    "summary": "what the agent is trying to accomplish this session",
    "goalId": "G-... | null",
    "inScope": ["deliverable 1", "deliverable 2"],
    "outOfScope": ["explicitly excluded thing"]
  },
  "decisionsLocked": [
    {
      "id": "D-NNN",
      "decision": "decision summary",
      "rationale": "why",
      "decidedAt": "ISO-8601",
      "supersedes": "D-MMM | null"
    }
  ],
  "verification": {
    "command": "node --test ...",
    "lastResult": {
      "ranAt": "ISO-8601",
      "pass": 523,
      "fail": 0,
      "skip": 100,
      "total": 623,
      "wallClockMs": 77000,
      "preCommit": true
    },
    "suites": [
      { "file": "skills/skills-frontmatter.test.mjs", "pass": 7, "fail": 0, "skip": 0, "total": 7 }
    ]
  },
  "workingTree": {
    "branch": "master",
    "head": "17fc9f2",
    "headMessage": "v0.3.0 (continued) — ...",
    "staged": 0,
    "modified": 0,
    "untracked": 0
  },
  "fileRefs": [
    { "path": "docs/reference/savepoint-schema.md", "purpose": "Tier 2 schema doc" }
  ]
}
```

The capture script `scripts/savepoint-capture.mjs` (run from the package root) auto-fills
`verification` and `workingTree` from the live project, so the agent only writes the
prose-derived fields (`goal`, `decisionsLocked`, `fileRefs`) and lets the script merge them
with the auto-captured data. Tier 1 readers ignore the Tier 2 fields; Tier 2 readers fall back
to prose if a Tier 2 field is missing.

The note is removed only after its handoff has been written and read back successfully. It is project
scoped, so do not use one pending note for competing Pi sessions in the same target.

## Compact

When the extension is live, it waits for `agent_settled`, uses Pi's reported usage and context window,
writes and verifies the handoff, and calls `ctx.compact()`. If verification fails, it deliberately does not
compact. When the extension is not live, run `/compact` manually after writing the note.

## Resume

After a verified extension rollover, the next agent start receives one `respawn-pi-handoff` custom message.
Confirm the identity line before relying on continuity. The message is delivered exactly once; its absence
on a later turn is expected.

Do not put secrets, raw credentials, full transcripts, or unverified memory claims into the pending note.

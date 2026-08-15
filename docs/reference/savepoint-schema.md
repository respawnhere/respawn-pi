# Savepoint schema — Tier 2 (structured-handoff)

The rollover extension writes `.respawnpack/runtime/rollover/_pi-pending-note.json` at every `agent_settled` so a future compaction has a durable cold-start anchor. Tier 1 (the five minimal fields — `exactNextAction`, `atomicActionId`, `userConstraints`, `unresolvedQuestions`, `candidateMemories`) is enough to resume but requires the resuming agent to RE-INFER project state from prose: the test count, the branch state, what's already been decided, which files matter.

Tier 2 adds six structured fields so the resume can be a thin pointer rather than a recap. Each field is computable from the live project (git, test runner, file system) and the agent's own context — none of them carry secrets, raw transcripts, or unverified memory claims.

```json
{
  "exactNextAction": "one concrete cold-startable step",
  "atomicActionId": "short task id",
  "userConstraints": ["..."],
  "unresolvedQuestions": ["..."],
  "candidateMemories": ["M-NNN:title"],

  "goal": {
    "summary": "what the agent is trying to accomplish in this session",
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
    "command": "node --test ... # exact command the agent ran",
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
    { "path": "docs/GAPS.md", "purpose": "audit findings + open work" }
  ]
}
```

## What each field does for the resume

| Field | Resumes don't need to re-derive | Failure mode if missing |
|---|---|---|
| `goal.summary` | the objective | resume re-infers from prose, may misread |
| `decisionsLocked` | what's already been resolved | resume may re-litigate D-005 etc. |
| `verification.lastResult` | exact pass/fail/skip | resume re-runs the suite (slow + flaky) |
| `verification.suites` | which suites contribute what | resume can't say "skills-frontmatter is the new one" |
| `workingTree.{branch,head}` | git state | resume runs `git status` / `git log` |
| `workingTree.{staged,modified,untracked}` | working tree health | resume can't say "tree is clean" |
| `fileRefs` | which files matter | resume reads everything in docs/ |

The prose `exactNextAction` becomes a TINY one-sentence pointer at one concrete step. The agent on resume reads structured fields directly; the prose recap that previously filled several paragraphs collapses to a line.

## Who fills what

| Field | Filled by |
|---|---|
| `exactNextAction` | agent (manually, just before `agent_settled`) |
| `atomicActionId` | agent |
| `userConstraints` | agent |
| `unresolvedQuestions` | agent |
| `candidateMemories` | agent |
| `goal.*` | agent |
| `decisionsLocked` | agent (appends per resolved decision) |
| `verification.command` | agent (or the capture script's default) |
| `verification.lastResult` | capture script `scripts/savepoint-capture.mjs` |
| `verification.suites` | capture script |
| `workingTree.*` | capture script |
| `fileRefs` | agent |

## Capture script

`scripts/savepoint-capture.mjs` is the auto-filler. It:

1. Reads the agent-written Tier 2 fields (if any) from an input file.
2. Runs `git status` + `git log -1` to fill `workingTree`.
3. Runs the verification command (or the default `node --test $(find . -name "*.test.mjs" -not -path "*/node_modules/*" -not -path "*/.respawnpack/*")` from the package root) and parses the `ℹ pass / fail / skipped / tests` lines to fill `verification.lastResult` and `verification.suites`.
4. Merges agent-written fields + capture-written fields into a final JSON.
5. Writes `.respawnpack/runtime/rollover/_pi-pending-note.json`.

Usage:

```bash
# from inside respawn-pi-0.1.0/respawn-pi/
node scripts/savepoint-capture.mjs \
  --note /tmp/my-note.json \
  --output ../.respawnpack/runtime/rollover/_pi-pending-note.json
```

The agent writes its prose fields (`exactNextAction`, `goal.*`, `decisionsLocked`, etc.) to `/tmp/my-note.json`, runs the capture script, and the output file is the verified final savepoint. A manual run is also supported: write the full JSON by hand if the test suite is genuinely unverifiable (env issue, network down, etc.).

## Graceful degradation

A Tier 2 savepoint with only Tier 1 fields is a valid Tier 1 savepoint — older readers ignore unknown keys. A Tier 2 reader that finds a Tier 1 savepoint treats missing structured fields as "needs re-derivation" and falls back to the prose path. No migration is required.

## What stays out

- Secrets, raw credentials, full transcripts (skill rule — never in the pending note).
- Unverified memory claims (only `M-NNN:title` style IDs).
- File CONTENTS (paths only — resume reads the file itself).

## Why this is the biggest single lever

Before Tier 2, every compaction burned ~5–10 KB of context recapitulating state. After Tier 2, the structured fields are ~1–2 KB and the prose summary is one sentence. Net: 60–80% less context pressure from the handoff itself, which directly extends the working window before the next compaction.

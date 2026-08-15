---
name: savepoint
description: "End-of-session documentation procedure for a RespawnPack docs/ spine: regenerates the DERIVED docs (CHANGELOG/GAPS/CONTINUITY) from git and the canonical docs, surfaces any CANONICAL edits for owner confirmation, and runs a drift-check. The counterpart to /respawn."
when_to_use: ["savepoint", "/savepoint", "save", "save the session", "checkpoint", "closeout", "/closeout", "close out", "wrap up the session", "end of session", "session handoff", "update the docs", "regenerate the changelog / gaps / continuity"]
---

# /savepoint — end-of-session documentation procedure

Keeps the `docs/` spine from drifting: it writes the handoff the next `/respawn` loads. If `docs/README.md` exists, read it for the project's documentation model; otherwise use the classifications below.

**Optional target dependencies:** derived docs, compliance records, wave ledger, and `docs/README.md` may be absent; skip only their dependent judgement checks and report `CANNOT_DETERMINE` rather than claiming they were regenerated or reviewed.

In short:

- **CANONICAL** (`docs/*.md`, root `CLAUDE.md`/`AGENTS.md`) — hand-authored at decision time. `/savepoint` **proposes** edits but **never writes them without owner confirmation**.
- **DERIVED** (`docs/derived/*.md`) — **regenerated here, never hand-edited.**
- **REFERENCE / SKILLS** — touched only when a procedure changes.

> Run manually at the end of each session (~2 weeks to stabilize the steps), then a `Stop` hook can run it automatically. **This skill never pushes; it commits only when explicitly asked.**

## Config (set per repo)
- `ROUTE_SOURCE` — how routes are discovered (e.g. `app/**/page.tsx`, `pages/**`, `src/routes/**`, a router manifest). Used by the routes↔matrix drift-check.
- `CODE_TRUTH` — the canonical-by-code paths (design tokens, copy strings, schema) used by the tokens↔docs drift-check.

## Step 0 — Scope the session
- `git log --oneline -20` → find the range since the last `docs(savepoint)` commit (or session start) = `<SINCE>`.
- `git diff --stat <SINCE>..HEAD` + `git status` (include uncommitted work).
- Read the scratch activity log if a PostToolUse capture hook is installed (optional).

## Step 1 — Regenerate the DERIVED set (wholesale, never hand-edit)
- **`docs/derived/CHANGELOG.md`** — append a session entry from the git log (group feat/fix/docs). Removals reference `DECISIONS.md` by `D-id`, never re-described.
- **`docs/derived/GAPS.md`** — roll up OPEN gaps; **recompute counts FROM the rows**. Pull build-gaps from `FEATURES-PAGES.md` §5 + deferred from `PRODUCT.md`. Drop anything closed this session.
- **`docs/derived/CONTINUITY.md`** — a fresh next-session snapshot (the handoff `/respawn` reads). **Strip ephemeral git state** (commit hashes, "N ahead"). Point to canon. Capture current state + standing reminders.
- **`.respawnpack/wave-ledger.md`**, if present — fold its lines into this session's `CHANGELOG.md` entry (one changelog line per wave, not per raw ledger line) and into `CONTINUITY.md`'s "Current state" section, then **delete the ledger file**. It's scratch, mid-run state; its permanent home is always these derived docs, never itself.

## Step 2 — Surface CANONICAL edits the session implies (PROPOSE, don't auto-write)
Scan the diff for anything that changes product truth; present a checklist for owner confirmation; apply only what's confirmed.
- New / changed / **removed** feature → `PRODUCT.md` row + status (a removal → flip to ⛔ killed **and** add a `DECISIONS.md` entry via the ⛔ removal channel).
- New route/page or nav change → `FEATURES-PAGES.md` row (+ the routes↔matrix check, Step 3).
- A decision or reversal → a new `DECISIONS.md` `D-NNN` entry.
- A token/brand/design change → `DESIGN.md` (defers to code).
- An architecture/roadmap shift → `ARCHITECTURE-ROADMAP.md`.

## Step 2b — Write, then run the executable verification

From the package root, target the project explicitly when it differs from the package:

Call the packaged `respawn_pi_command` tool twice:

1. `{"action":"savepoint"}` (optionally include `"note":"…"`).
2. `{"action":"savepoint-verify"}`.

The write command regenerates schema-valid `docs/derived/STATE.json`, records full `sourceRevision`
plus SHA-256 digests for every compiler input, atomically writes the pending note, and reads that note
through `bridge.peekPendingNote`. The verify command rechecks the schema, HEAD, source digests, and
actual pending-note consumer without rewriting either artifact.

**Exit codes are three-valued:** `0` PASS · `1` FAIL · `2` CANNOT_DETERMINE. Do not pipe the command
before reading `$?`; a missing/stale artifact is not green. A source digest mismatch at unchanged HEAD
is exit `2`, because the generated state no longer describes the working tree.

⛔ **Do not report a successful savepoint on a non-zero exit.** Fix exit `1`; name the missing or
stale authority on exit `2`.

## Step 2c — Review candidate memory IDs honestly

`--candidate <id>` carries an **ID only** in the pending handoff. The Pi-native savepoint command does
not create, promote, or reject memory records, and this package ships no `memory candidates` CLI. Do
not invent one. Review each carried ID as an unverified lead; use `/knowledge` to capture a verified
gotcha or learning, or explicitly defer/reject it in the handoff summary. Never present a candidate
ID as an established fact.

## Step 3 — Drift-check (flag, don't silently fix)

The Pi-native verifier covers STATE freshness and handoff consumption. The checks below remain
judgement work; do not imply the verifier performed them.
- **Routes ↔ matrix:** enumerate `ROUTE_SOURCE` ↔ `FEATURES-PAGES.md` §2 — every route has a row and every row a route (no orphans). Check the diff for added/removed routes.
- **Code ↔ docs:** no doc hardcodes a value contradicting `CODE_TRUTH` (tokens, copy, schema).
- **Killed features not resurrected:** compare the diff and live package surface against every ⛔ removal in `DECISIONS.md`. The current STATE compiler reports this check as `CANNOT_DETERMINE` because no removal-registry scanner is configured; a schema-valid STATE is not proof that removals were scanned.
- **Built-vs-held conflicts:** a `PRODUCT.md` 🔒 feature that gained/lost a live route.
- **Stale cross-refs:** broken links to moved/renamed docs.
- **Counts:** model/route/etc. counts cited in docs vs reality.
- **Skills' referenced facts:** light pass — does any `adapters/pi/package/skills/*/SKILL.md` reference a file/flag/endpoint that changed?
- **Living-skill drift:** run [`/skill-guard`](../skill-guard/SKILL.md)'s drift-check (Mode A) over the pack's owned skills, flagging any that drifted from their frozen baseline.
- **Compliance regime drift:** a new data class / jurisdiction / sub-processor in the diff that isn't reflected in `compliance.config.md`, `docs/compliance/RoPA.md`, or `docs/compliance/REGISTER.md` — flag it for a `/comply` pass.
- **Dependency currency:** flag dependencies one or more major versions behind (e.g. `npm outdated`) as a `GAPS.md` row — this is currency drift, not a vulnerability finding, so keep it separate from any CVE/security results.

## Step 4 — Output
Write a short savepoint summary: what shipped (the changelog entry), which derived docs were regenerated, which canonical edits were applied (owner-confirmed) vs proposed-and-deferred, and the drift-check findings. Optionally stage a `docs(savepoint): <summary>` commit. **Do not push** without an explicit go-ahead.

## Invariants
1. **Never hand-edit a DERIVED doc** — regenerate it.
2. **Never auto-write a CANONICAL doc** — propose in Step 2, apply only on confirmation.
3. **WRITE-ONCE:** each fact has one canonical home; everything else references or is generated from it.
4. **No push; commit only when asked.**

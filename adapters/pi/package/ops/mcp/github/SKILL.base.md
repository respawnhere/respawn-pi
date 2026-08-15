---
name: mcp-github
description: "MCP-first GitHub workflow for solo founders on managed infra. Drives the official github-mcp-server (repos, issues, pull_requests, actions, code_security, dependabot) plus the gh CLI for fast scripted ops. Wrap-thin: references Anthropic's first-party git/PR plugins (code-review, commit-commands, pr-review-toolkit) rather than restating them, adding only RespawnPack guardrails on top."
when_to_use: ["github", "/github", "open a PR", "cut a release", "review code", "check CI", "dependabot", "code scanning alerts", "push to origin"]
---

# /mcp-github — GitHub via MCP + gh CLI, the solo-founder push gate

RespawnPack-specific layer over GitHub. The vendor surface stays the source of truth; this skill adds the safe-ops discipline and the solo-founder flow.

## Vendor surface — reference, do not recreate
- Use Anthropic's first-party plugins for git/PR workflow; install and credit them, do not restate their content: `commit-commands` (staging + commit hygiene), `code-review` (diff review), `pr-review-toolkit` (PR review personas). <!-- invariant -->
- The github-mcp-server is self-describing — list its tools at connect time rather than hardcoding a tool catalog here. <!-- invariant -->
- This skill contributes only RespawnPack guardrails + the solo-founder flow on top of those.

## Toolsets to enable (solo founder)
Enable on the github-mcp-server: `repos`, `issues`, `pull_requests`, `actions`, `code_security`, `dependabot`. Leave others off until needed — fewer tools, less surface.

## MCP vs gh CLI
- **MCP (typed)**: structured reads and writes where the typed result matters — PR/issue bodies, review threads, run status, scanning alerts. Prefer it when connected.
- **gh CLI (fast, scriptable)**: bulk/loop ops, one-liners, scripting, and anything not exposed by the MCP. `gh` is also the fallback when the MCP is not connected — say so when you fall back. <!-- invariant -->

## Reads are free
Status, schema, logs, diffs, run history, issue/PR bodies, code-scanning and dependabot alerts — read freely, no approval needed.

## Solo-founder PR + release flow
1. **Branch + commit** — work on a branch; stage and commit via `commit-commands`. Never commit straight to the default branch unless the user said so. <!-- invariant -->
2. **Review before push** — run `code-review` / `pr-review-toolkit` on the diff. Fix what they flag.
3. **Push** — pushing to a remote is an OUTWARD action: name the branch + remote, state the effect, ask before pushing. <!-- invariant -->
4. **Open PR** — opening a PR is an OUTWARD action: name the base ← head and title, ask before creating. Prefer the MCP (typed body) or `gh pr create`. <!-- invariant -->
5. **CI gate** — read Actions run status; do not merge on red. Surface failing jobs + logs.
6. **Merge** — merging is an OUTWARD action: name the PR + merge method, ask before merging. <!-- invariant -->
7. **Release** — cutting a tag/release is an OUTWARD action: name the tag + target, ask before creating. <!-- invariant -->

## Ties to RespawnPack
- This skill IS the push gate behind `/ship` — `/ship` routes its push/PR/release steps through this skill's authorization discipline. <!-- invariant -->
- `code_security` (code scanning) and `dependabot` alerts feed `/secure` — surface open alerts here; `/secure` triages them. Read alerts freely; opening fix PRs follows the OUTWARD-action rule. <!-- invariant -->
- Apply any required migrations/secrets (Supabase/Fly/CF/Vercel) BEFORE merging or releasing the code that depends on them. <!-- invariant -->

## CLI fallback
When the MCP is not connected, use `gh` for everything (`gh pr`, `gh release`, `gh run`, `gh api` for code-scanning/dependabot) and state that you fell back to the CLI. Auth via `gh auth status`; never echo tokens. <!-- invariant -->

## Invariants
- OUTWARD actions (push, open/merge PR, create release, comment on behalf of the user) need explicit human authorization — name the target, state the effect, ask before acting. <!-- invariant -->
- Never print secret or token values; reference credentials by key name only. <!-- invariant -->
- Never commit or push to the default branch without explicit authorization; branch first. <!-- invariant -->
- Do not merge on red CI; surface failing jobs and logs instead. <!-- invariant -->
- Reads (status/logs/diffs/run history/scanning + dependabot alerts) are free; writes and OUTWARD actions are gated. <!-- invariant -->
- Reference the vendor plugins (`commit-commands`, `code-review`, `pr-review-toolkit`) and the self-describing MCP; do not restate or fork their content. <!-- invariant -->
- `gh` CLI is the fallback when the MCP is not connected — say so when you fall back. <!-- invariant -->
- Apply migrations/secrets before the code that depends on them ships. <!-- invariant -->

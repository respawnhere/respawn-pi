---
name: secrets-audit
description: Secret hygiene — scan the repo for leaked secrets, confirm env is gitignored + logs/Sentry are redacted, reconcile the secret inventory against what's set on the platform, and flag rotation needs. Pairs with the secret-scan hook. Never prints secret values.
when_to_use: ["secrets audit", "check for leaked secrets", "secret hygiene", "are secrets safe", "rotate secrets", "/secrets-audit"]
---

# /secrets-audit — secret hygiene

## Step 1 — Leak scan (repo)
Scan tracked files + history for credential patterns (the same patterns as the [secret-scan hook](../../extensions/secret-scan.ts) — private keys, `sk_live_`, `AKIA…`, GH/Slack/Google tokens, generic `key=…` assignments). The hook is the push-time backstop; this is the audit. Report HIGH-severity hits with file:line — **but reference, never echo, the value.**

## Step 2 — Config hygiene
Confirm: `.env*` is gitignored (only `.env.example` tracked); a runtime **log redaction** list scrubs secrets/PII; the error reporter (Sentry/etc.) scrubs `extra`/headers; no secret is inlined in client/build code where it would be bundled.

## Step 3 — Inventory vs platform
Reconcile the documented secret set (the `.env.example` schema + the runbook) against what's actually set on the platform (Fly/CF/Vercel secrets via MCP or CLI — **names only**). Flag: required-but-unset (will break at boot), set-but-undocumented, and wrong-scheme values (e.g. a `rediss://` URL against a plain-TCP service — a real prod-fail class).

## Step 4 — Rotation
Flag anything that should rotate (committed-then-removed secrets must be rotated, not just deleted; long-lived keys past policy). Give the rotation path; the human executes it.

## Invariants
- Never print a secret value — reference keys by name; verify presence, not contents.
- Anything that touched git history is "exposed" → rotate, don't just remove.
- Reads only; rotation/secret-set is a human (or authorized) action.

---
name: secure
description: "The security-audit role — a defense-in-depth pass over a change or the repo: OWASP code vulnerabilities, dependency/supply-chain CVEs, and managed-infra advisories. Fans out packaged lenses and adversarially verifies each finding. Delegates secrets to /secrets-audit."
when_to_use: ["secure", "/secure", "audit", "/audit", "security", "/security", "security audit", "threat scan", "is this safe to ship", "owasp", "vuln scan", "check for vulnerabilities", "pentest the change"]
---

# /secure — security audit (defense-in-depth)

A defense-in-depth security pass over a change or the whole repo. Cross-cutting: run it any time; `/review` and `/ship` call into it for sensitive changes. Like `/review`, it **adversarially verifies every finding before reporting** — an unverified finding is reported as low-confidence, not as fact.

**Optional target dependencies:** architecture/config files named below may be absent; infer only from verified code and report `CANNOT_DETERMINE` for unavailable trust-boundary or managed-service evidence.

## Step 0 — Scope the audit surface
Decide the surface: a change (`git diff` — uncommitted / branch / PR) or the whole repo (a periodic audit). Identify the **risk surfaces** that get extra weight: auth/session, access control, payments, file upload, user input → query/DOM/shell, webhooks, deserialization, SSRF-prone fetches, and anything internet-facing. Read `docs/ARCHITECTURE-ROADMAP.md` for trust boundaries and `respawnpack.config.json` `opsTargets` for the managed services in play.

## Step 1 — Secrets (delegate, don't re-implement)
Secret hygiene lives in [`/secrets-audit`](../../ops/secrets-audit/SKILL.md) — run it (or confirm it's already clean); the [`secret-scan`](../../extensions/secret-scan.ts) hook is the push-time backstop. **Don't duplicate it here** (WRITE-ONCE) — fold its HIGH-severity findings into this report by reference. Never echo a secret value; reference it by name.

## Step 2 — Dependencies & supply chain (SBOM)
- **CVE scan** — audit the dependency set for known vulnerabilities via [`/mcp-security-audit`](../../ops/mcp/security-audit/SKILL.base.md) (the JS leg — drives the `security-audit` MCP `audit_nodejs_dependencies` over `package.json` deps where connected), else the stack's auditor (`npm audit --audit-level=high` / `pnpm audit` / `yarn npm audit` / `pip-audit` / `cargo audit` / `govulncheck`). The MCP leg is Node/npm only — use the matching auditor for Python/Go/Rust.
- **Supply-chain hygiene** — flag unpinned ranges on security-sensitive deps, lockfile drift (missing or out-of-sync), typosquat-risk / freshly-published / low-reputation packages, and `postinstall` scripts pulled in transitively.
- **SBOM** — produce or refresh a software bill of materials (resolved dependency tree + versions + licenses) so "what are we actually shipping" is answerable. Call out deps newly introduced in the diff.

## Step 3 — Code-level audit (OWASP) — fan out + verify
Call independent packaged lenses via the canonical `respawn-pi-subagent` package tool in **parallel mode** — one call, one `tasks: [...]` array weighted by Step 0's risk surfaces (NOT one-call-per-agent dispatches). Pi-compatible shape:

```
respawn-pi-subagent({
  tasks: [
    { agent: "security-reviewer", task: "<diff + Step 0 risk-surface weight + 'find missing/incorrect ownership checks, IDOR, privilege escalation, default-allow (authz). Refute, don't validate'>" },
    { agent: "security-reviewer", task: "<diff + 'find SQL/NoSQL/command/XSS (stored, reflected, DOM)/template/header/CRLF injection; untrusted input reaching a sink without parameterization/escaping. Refute, don't validate'>" },
    { agent: "security-reviewer", task: "<diff + 'find weak token handling, missing expiry/rotation, fixation, predictable secrets, auth bypass (authn/session). Refute, don't validate'>" },
    { agent: "security-reviewer", task: "<diff + 'find user-controlled URLs / hosts; unsafe pickle / yaml.load / eval; prototype pollution (SSRF / unsafe fetch / deserialization). Refute, don't validate'>" },
    { agent: "security-reviewer", task: "<diff + 'find code paths that reach a log / response / error sink with PII or secrets; missing transport security; over-broad CORS (sensitive-data exposure). The redaction *config* itself is /secrets-audit's domain; here we flag the leaking code path. Refute, don't validate'>" },
    // LLM / AI surfaces (OWASP LLM Top 10) only when the target calls a model or runs an agent:
    ...(targetCallsModel ? [{ agent: "security-reviewer", task: "<diff + 'find prompt-injection paths (direct + indirect via retrieved documents / tool output); insecure model output handling (rendered/executed/run-as-query without validation); excessive agency (tool or permission grants beyond need); PII leakage into prompts/logs; unbounded or unauthenticated calls to a paid endpoint (OWASP LLM Top 10). Refute, don't validate'>" }] : []),
  ],
  agentScope: "package",  // respawn-pi-owned 32 agents
  timeoutMs: 180000,      // 4–6 risk-weighted lenses; 3 minutes is the room a deep lens needs on a non-trivial diff
});
```

The pack ships one security-reviewer agent; parallel mode dispatches it as multiple tasks (one per risk surface) so each task carries its own focused lens prompt. Pi-aligned semantics: `tasks` accepts up to 8 items with a package-internal concurrency ≤ 4; the single `timeoutMs` is the TOTAL call deadline, NOT multiplied per task. The risk surfaces — summarized for orientation:
- **Access control (authz)** — missing/incorrect ownership checks, IDOR, privilege escalation, default-allow.
- **Injection** — SQL/NoSQL, command, XSS (stored/reflected/DOM), template, header/CRLF; untrusted input reaching a sink without parameterization/escaping.
- **Authn / session** — weak token handling, missing expiry/rotation, fixation, predictable secrets, auth bypass.
- **SSRF / unsafe fetch / deserialization** — user-controlled URLs or hosts; unsafe `pickle`/`yaml.load`/`eval`; prototype pollution.
- **Sensitive-data exposure** — code paths that reach a log / response / error sink with PII or secrets; missing transport security; over-broad CORS.
- **LLM / AI surfaces (OWASP LLM Top 10)** — *only when the target calls a model or runs an agent.* No AI surface → skip this lens entirely; don't invent one.

Keep concurrency moderate (single-digit). **Adversarially verify** each finding — a skeptic pass that tries to *refute* it (default "not exploitable" unless the evidence holds); drop or downgrade what doesn't survive; force any finding you can't verify to low confidence. If packaged dispatch is unavailable or unauthorized, record that lane as `CANNOT_DETERMINE`; do not substitute an unshipped tool.

## Step 4 — Infra / config advisories (MCP-first)
For the managed services (`opsTargets`), pull real advisories rather than guessing:
- **Supabase / Postgres** — `get_advisors(type: security)`: missing RLS, exposed tables/views, `security definer` risks, weak policies.
- **Cloudflare / Fly / Vercel** — WAF/firewall posture, public bindings, over-broad tokens/scopes, missing security headers (CSP / HSTS / `X-Content-Type-Options`).
- **Config** — debug endpoints reachable in prod, permissive CORS, default credentials, verbose errors leaking internals.

## Step 5 — Report (+ optionally fix)
Rank surviving findings by **severity × exploitability**. Each gets: file:line (or the dependency / advisory), a one-line **exploit scenario** (how it's actually abused), and a concrete **fix**. State what was clean. If asked, apply fixes (in scope) and re-verify. For an **accepted risk** (won't-fix, with rationale), propose a `DECISIONS.md` entry so the call is recorded, not lost.

## Invariants
- **Verify before reporting** — no unverified vuln presented as high-confidence (adversarial refute pass, like `/review`).
- **Never print a secret value** — reference by name; the secrets dimension is delegated to `/secrets-audit` (WRITE-ONCE).
- **Defense-in-depth, not theater** — prioritize real risk reduction; rank by exploitability; don't bury the report in lint-level noise.
- **Reads + proposes** — findings and fixes are proposed; a prod change (rotating a key, tightening a policy) needs the same authorization as any prod write.
- Cross-cutting: `/review` runs the lighter security lens inline; `/secure` is the deep pass `/ship` gates on for sensitive paths.

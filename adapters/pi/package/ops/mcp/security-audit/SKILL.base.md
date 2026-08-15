---
name: mcp-security-audit
description: MCP-first thin orchestration skill that runs the security-audit MCP (audit_nodejs_dependencies) against a project's npm dependency map, summarizing CRITICAL/HIGH CVE findings with concrete version-bump fixes. It is the JS/npm leg of /secure — feeding findings into the remediation loop and the dep-audit step in templates/ci/security.yml. No vendor or community skill exists for this server, so this skill orchestrates the tool directly; it does not duplicate an upstream skill.
when_to_use: ["audit npm dependencies", "scan node dependencies for CVEs", "check package.json for vulnerabilities", "dependency audit", "JS dependency security scan"]
---

# /mcp-security-audit — JS/npm dependency CVE scan, the JS leg of /secure

Runs the security-audit MCP (`qianniuspace/mcp-security-audit`, MIT) to scan Node.js dependencies against the npm advisory CVE database. Reads-only — a scan, never a write. Covers **Node.js / npm only**; it is not a universal auditor. <!-- invariant -->

## Tool surface
- `audit_nodejs_dependencies` (MCP) — the single tool; takes the dependency map (package name → version) and returns CVE advisories per package.
- CLI fallback (MCP not connected): `npm audit --json` from the project root. State that the MCP is unavailable and you are falling back. <!-- invariant -->

## Steps
1. **Locate inputs.** Find `package.json` (deps + devDeps) and a lockfile (`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, or `yarn.lock`). If no lockfile, scan declared ranges and note that resolved versions are unverified.
2. **Extract the dependency map.** Build name → resolved-version pairs, preferring locked versions from the lockfile over the `package.json` ranges. Include transitive deps from the lockfile when present.
3. **Invoke the scan.** Call `audit_nodejs_dependencies` with the map (CLI fallback per above if the MCP is not connected).
4. **Summarize.** Group findings by severity; report CRITICAL and HIGH first, each with: package, installed version, advisory ID/CVE, and the fixed version. Note MODERATE/LOW as a count.
5. **Give fix guidance.** For each CRITICAL/HIGH: the concrete version bump (e.g. `lodash 4.17.20 → 4.17.21`), whether it is a direct or transitive dep (transitive → bump the parent or add an override/resolution), and a one-line breaking-change flag if the bump crosses a major.
6. **Feed the loop.** Emit findings into the `/secure` remediation loop as the JS leg, and reference the dep-audit job in `templates/ci/security.yml` so the same scan runs in CI. Flag that Python / Go / Rust deps are out of scope here and need their own ecosystem auditors. <!-- invariant -->

## Safe-ops
- Scan only — no migration, secret, scale, deploy, or destroy. No human authorization gate needed because nothing is written. <!-- invariant -->
- Never print secret values; reference any registry tokens or `.npmrc` credentials by key name only. <!-- invariant -->
- Reading dependency manifests and lockfiles is free; do it without prompting.

## Invariants
- Scope is Node.js / npm only — this skill does NOT cover Python / Go / Rust; `/secure` treats it as the JS leg, not a universal auditor. <!-- invariant -->
- MCP-first: prefer `audit_nodejs_dependencies`; fall back to `npm audit --json` only when the MCP is not connected, and say so. <!-- invariant -->
- Reads-only: a dependency scan performs no prod write, so it needs no approval gate. <!-- invariant -->
- Never print secret values; reference registry tokens / `.npmrc` credentials by key name. <!-- invariant -->
- Report CRITICAL and HIGH findings first, each with installed version, advisory/CVE ID, and the fixed version. <!-- invariant -->
- Findings feed the `/secure` remediation loop and the dep-audit job in `templates/ci/security.yml`. <!-- invariant -->

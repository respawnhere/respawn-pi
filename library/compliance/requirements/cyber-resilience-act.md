# EU Cyber Resilience Act (CRA) — requirements checklist
> Source: https://eur-lex.europa.eu/eli/reg/2024/2847/oj · Regulation (EU) 2024/2847 · retrieved 2026-06-22 · EU law — © European Union, reuse permitted with attribution (Decision 2011/833/EU). Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- You are a **manufacturer** that develops/produces a **product with digital elements (PDE)** — software or hardware-plus-software — and **places it on the EU market** (Art. 1, Art. 3(1)). **Importers** and **distributors** carry flow-down obligations (Art. 19–20), so an enterprise customer who resells/bundles your artifact will push CRA terms down your supply chain by contract.
- "PDE" scope hinges on a **direct or indirect logical or physical data connection** to a device or network in intended or reasonably foreseeable use (Art. 3(1)). **Pure SaaS / hosted services are out of CRA scope** — they fall under NIS2 — **unless** you also ship an **installable artifact**: a downloadable agent, desktop/mobile app, CLI, SDK, browser extension, self-hosted/on-prem distribution, container image, or IoT firmware. The remote SaaS backend itself is only in scope where it is **remote data processing** necessary for the PDE to perform its functions (Art. 3(2)).
- A solo founder on managed infra (Supabase / Fly / Cloudflare / Vercel / Postgres) is **directly in scope as a manufacturer** the moment a shippable client/installable is offered to EU users — open-source, free, and paid all count once placed on the market in the course of a commercial activity (recitals on placing on the market in the course of a commercial activity; non-commercial OSS stewards have a lighter regime, Art. 24).
- **Effective dates:** in force 10 Dec 2024. Most obligations apply from **11 Dec 2027** (Art. 71(2)). **Article 14 reporting obligations apply earlier, from 11 Sep 2026** (Art. 71(2)). Chapter IV (notified bodies) applies from 11 Jun 2026 (Art. 71(2)).
- **Lawyer / notified-body sign-off needed for:** the conformity-assessment route (self-assessment vs. third-party module, driven by whether the product is **important** (Annex III) or **critical** (Annex IV)), the **EU declaration of conformity** and **CE marking**, technical-documentation sufficiency, and the legally-determined **support period**. These are attestations of legal conformity, not dev tasks.

## Requirements

### Annex I, Part I(1) — Secure by design (risk-based baseline)
- **Requires:** PDEs shall be designed, developed and produced to ensure an **appropriate level of cybersecurity based on the risks**, and delivered **without known exploitable vulnerabilities** (Annex I Part I(1) and I(2)(a)).
- **In code:** run the security CI gate before any release tag — `templates/ci/security.yml` (gitleaks + dep-audit) blocks a build that ships a known-CVE dependency; pin/lock all dependencies; document a cybersecurity risk assessment in the technical documentation (Annex VII).
- **Primitive:** 4 (Data inventory + sensitive-field tagging), 9 (Vendor / sub-processor register)
- **Cite:** Annex I, Part I, points (1) and (2)(a)

### Annex I, Part I(2)(b) — Secure-by-default configuration
- **Requires:** made available with a **secure by default configuration**, with the ability to reset to original state (unless otherwise agreed for a tailor-made product).
- **In code:** ship hardened defaults — auth on, no default/blank credentials, TLS enforced, debug/telemetry off; provide a documented factory-reset path for installables.
- **Primitive:** 5 (Access control — RLS / RBAC / MFA / least-privilege)
- **Cite:** Annex I, Part I, point (2)(b)

### Annex I, Part I(2)(c) — Secure updates incl. automatic security updates
- **Requires:** vulnerabilities can be addressed through **security updates**, including **automatic security updates** enabled by default within an appropriate timeframe where applicable, with an easy opt-out, **user notification** of available updates, and an option to postpone.
- **In code:** ship a **signed, secure auto-update channel** for the installable (signature verification before apply, rollback-safe); surface an in-app update notice; gate releases behind a patch step in CI. Shares the secure-update control with Annex I Part II(7).
- **Primitive:** 9 (Vendor / sub-processor register — patch supply chain), 1 (Encryption — update signing keys)
- **Cite:** Annex I, Part I, point (2)(c)

### Annex I, Part I(2)(d) — Protection from unauthorised access
- **Requires:** protect from unauthorised access by **appropriate control mechanisms** — authentication, identity/access management — and **report on possible unauthorised access**.
- **In code:** Supabase Auth + MFA; Postgres RLS for tenant isolation; RBAC/least-privilege; surface failed/anomalous-access signals into the audit log.
- **Primitive:** 5 (Access control), 6 (Immutable audit logging)
- **Cite:** Annex I, Part I, point (2)(d)

### Annex I, Part I(2)(e) — Confidentiality (encryption)
- **Requires:** protect **confidentiality** of stored, transmitted or processed data (personal or other), e.g. by **encrypting data at rest or in transit by state-of-the-art mechanisms**.
- **In code:** TLS 1.2+ everywhere (Cloudflare/Fly edge); AES-256 at rest (Supabase/Postgres, object storage); managed KMS for key handling. Same control as **GDPR Art. 32** and **HIPAA Security Rule encryption** — build once, map to many.
- **Primitive:** 1 (Encryption)
- **Cite:** Annex I, Part I, point (2)(e)

### Annex I, Part I(2)(f) — Integrity of data, commands, programs, config
- **Requires:** protect **integrity** of stored/transmitted/processed data, **commands, programs and configuration** against unauthorised manipulation, and **report on corruptions**.
- **In code:** signed releases and config; integrity checks on update artifacts; tamper-evident audit logging; checksum/verify on critical command paths.
- **Primitive:** 1 (Encryption — signing/MAC), 6 (Immutable audit logging)
- **Cite:** Annex I, Part I, point (2)(f)

### Annex I, Part I(2)(g) — Data minimisation
- **Requires:** process only data **adequate, relevant and limited to what is necessary** for the intended purpose.
- **In code:** tag sensitive fields in the data inventory; strip/avoid collecting unneeded fields in the installable's telemetry and payloads. Mirrors **GDPR Art. 5(1)(c)**.
- **Primitive:** 4 (Data inventory + sensitive-field tagging)
- **Cite:** Annex I, Part I, point (2)(g)

### Annex I, Part I(2)(h) — Availability / DoS resilience
- **Requires:** protect **availability of essential and basic functions**, including resilience and mitigation against **denial-of-service** attacks.
- **In code:** Cloudflare WAF/rate-limiting/DDoS protection at the edge; backpressure and graceful degradation in the service; health checks on Fly.
- **Primitive:** 5 (Access control — rate limits), 8 (Incident-response + breach pipeline)
- **Cite:** Annex I, Part I, point (2)(h)

### Annex I, Part I(2)(i) — Minimise impact on other devices/networks
- **Requires:** minimise the product's **negative impact on the availability of services** provided by other devices or networks.
- **In code:** outbound rate-limiting and egress controls; no amplification behaviour; bounded retries/backoff in the installable.
- **Primitive:** 5 (Access control — least-privilege egress)
- **Cite:** Annex I, Part I, point (2)(i)

### Annex I, Part I(2)(j) — Limit attack surface
- **Requires:** designed/developed/produced to **limit attack surfaces, including external interfaces**.
- **In code:** close unused ports/endpoints; minimise exposed APIs; least-privilege service tokens; lean dependency tree (fewer deps in the SBOM).
- **Primitive:** 5 (Access control), 4 (Data inventory)
- **Cite:** Annex I, Part I, point (2)(j)

### Annex I, Part I(2)(k) — Reduce incident impact (exploitation mitigation)
- **Requires:** designed/developed/produced to **reduce the impact of an incident** using appropriate **exploitation-mitigation mechanisms and techniques**.
- **In code:** enable compiler/runtime hardening (ASLR, stack protections, sandboxing) for native installables; isolation between components; fail-closed defaults.
- **Primitive:** 8 (Incident-response + breach pipeline)
- **Cite:** Annex I, Part I, point (2)(k)

### Annex I, Part I(2)(l) — Security logging / monitoring
- **Requires:** provide security-related information by **recording and monitoring relevant internal activity** — access to or modification of data, services or functions — with a user opt-out.
- **In code:** immutable audit logs covering auth events, data access/modification, privilege changes; timestamped, append-only; user-facing opt-out where the activity is the user's own.
- **Primitive:** 6 (Immutable audit logging)
- **Cite:** Annex I, Part I, point (2)(l)

### Annex I, Part I(2)(m) — Secure data/settings deletion
- **Requires:** let users **securely and permanently remove all data and settings**, and where data can be transferred to other products/systems, ensure that transfer is secure.
- **In code:** wire deletion into the DSAR engine and retention/deletion jobs; secure export path for data portability; cascade deletes across Postgres + object storage.
- **Primitive:** 2 (DSAR engine), 7 (Retention + deletion jobs)
- **Cite:** Annex I, Part I, point (2)(m)

### Annex I, Part II(1) — Vulnerability & component inventory incl. SBOM
- **Requires:** **identify and document** vulnerabilities and components, including by drawing up a **software bill of materials (SBOM)** in a **commonly used, machine-readable format**, covering **at least the top-level dependencies**.
- **In code:** generate and retain an **SBOM (CycloneDX or SPDX)** in CI on every build; commit/attach it as a release artifact. Extends the existing `templates/ci/security.yml`. Same SBOM control demanded by **NIS2** supply-chain and feeding US EO 14028 / FDA expectations.
- **Primitive:** 9 (Vendor / sub-processor register — component manifest), 4 (Data inventory)
- **Cite:** Annex I, Part II, point (1)

### Annex I, Part II(2) — Remediate vulnerabilities without delay
- **Requires:** **address and remediate vulnerabilities without delay**, including by providing security updates.
- **In code:** continuous dependency-CVE scanning (dep-audit) with a **patch gate** that fails the build on unremediated high/critical findings; SLA-tracked remediation tied to the support period.
- **Primitive:** 9 (Vendor / sub-processor register), 8 (Incident-response)
- **Cite:** Annex I, Part II, point (2)

### Annex I, Part II(3) — Regular security testing & reviews
- **Requires:** apply **effective and regular tests and reviews** of the product's security.
- **In code:** SAST/DAST and dependency scanning in CI; periodic pen-test / code review; record cadence and results in the technical documentation.
- **Primitive:** 8 (Incident-response + breach pipeline)
- **Cite:** Annex I, Part II, point (3)

### Annex I, Part II(4) — Public disclosure of fixed vulnerabilities
- **Requires:** once a security update is available, **share and publicly disclose** fixed-vulnerability information — description, affected-product identification, impact, severity, and clear remediation guidance.
- **In code:** publish security advisories (e.g. GitHub Security Advisories / CSAF), map fixes to CVEs, link from release notes; reference from `security.txt`.
- **Primitive:** 8 (Incident-response + breach pipeline)
- **Cite:** Annex I, Part II, point (4)

### Annex I, Part II(5) — Coordinated vulnerability disclosure policy
- **Requires:** **put in place and enforce a policy on coordinated vulnerability disclosure (CVD)**.
- **In code:** publish a CVD policy (scope, safe-harbour, response timelines) alongside `security.txt`.
- **Primitive:** 8 (Incident-response + breach pipeline)
- **Cite:** Annex I, Part II, point (5)

### Annex I, Part II(6) — Reporting contact for vulnerabilities
- **Requires:** facilitate information-sharing about potential vulnerabilities in the product **and in third-party components**, including by providing a **contact address** for reporting.
- **In code:** ship a `security.txt` (RFC 9116) with a monitored contact and PGP key; document the intake path; track third-party component advisories against the SBOM.
- **Primitive:** 8 (Incident-response), 9 (Vendor / sub-processor register)
- **Cite:** Annex I, Part II, point (6)

### Annex I, Part II(7) — Secure distribution of updates
- **Requires:** provide mechanisms to **securely distribute updates** so vulnerabilities are fixed/mitigated in a timely manner, automatically where applicable.
- **In code:** signed update channel with authenticated delivery over TLS; verify signature/checksum before apply; staged rollout + rollback. Same control as Annex I Part I(2)(c).
- **Primitive:** 1 (Encryption — signing), 9 (Vendor / sub-processor register)
- **Cite:** Annex I, Part II, point (7)

### Annex I, Part II(8) — Free, prompt security updates with advisories
- **Requires:** disseminate available security updates **without delay** and, unless otherwise agreed for a tailor-made product, **free of charge**, with **advisory messages** telling users what action to take.
- **In code:** decouple security patches from paid feature gating; attach advisory text + remediation steps to each security release.
- **Primitive:** 8 (Incident-response + breach pipeline)
- **Cite:** Annex I, Part II, point (8)

### Art. 13 — Manufacturer obligations & support period
- **Requires:** ensure PDEs are designed/developed to meet Annex I; carry out a cybersecurity **risk assessment**; perform the applicable **conformity assessment**, draw up **technical documentation** (Annex VII), issue the **EU declaration of conformity** and affix **CE marking**; exercise **due diligence on third-party/integrated components**; and **determine and communicate a support period** that reflects the product's expected lifetime and is **at least 5 years** (shorter only if the expected lifetime is shorter) (Art. 13(8)).
- **In code:** automate SBOM + scan evidence to back the technical documentation; record the chosen support period and bind your remediation SLA and patch-gate retention to it; component due diligence flows from the SBOM + vendor register. **Conformity route, CE marking, and support-period determination need legal / notified-body sign-off** — especially for Annex III "important" or Annex IV "critical" products.
- **Primitive:** 9 (Vendor / sub-processor register), 4 (Data inventory)
- **Cite:** Art. 13 (incl. Art. 13(8) on the support period)

### Art. 14 — Reporting actively-exploited vulnerabilities & severe incidents
- **Requires:** report, via the **ENISA single reporting platform** to the **CSIRT designated as coordinator** (simultaneously accessible to **ENISA**): (i) any **actively exploited vulnerability** and (ii) any **severe incident having an impact on the security** of the PDE, on this cadence —
  - **Early warning: within 24 hours** of becoming aware (Art. 14(2)(a) / 14(4)(a));
  - **Notification: within 72 hours** (Art. 14(2)(b) / 14(4)(b));
  - **Final report:** for vulnerabilities, **no later than 14 days after a corrective or mitigating measure is available** (Art. 14(2)(c)); for severe incidents, **within one month after the submission of the incident notification** (Art. 14(4)(c)).
  - You must also **inform affected users** of the incident and, where relevant, corrective measures (Art. 14(8)). **These reporting duties apply from 11 Sep 2026** (Art. 71(2)).
- **In code:** wire the incident-response/breach pipeline to a 24h / 72h / 14d (vulnerabilities) / 1 month (severe incidents) clock with the CRA recipients; reuse the breach-notification machinery built for **GDPR Art. 33** and **NIS2** with CRA-specific deadlines and the ENISA platform endpoint.
- **Primitive:** 8 (Incident-response + breach pipeline), 6 (Immutable audit logging)
- **Cite:** Art. 14 (paras 1–4, 7–8)

## Evidence to retain
- **Technical documentation (Annex VII)** — risk assessment, Annex I conformity mapping, secure-development records — kept and made available to authorities for **at least 10 years** after placing on the market or the support period, whichever is longer (Art. 31).
- **EU declaration of conformity** and CE-marking records (Art. 28, Annex V); conformity-assessment results / notified-body certificates where third-party assessment applied.
- **SBOM** (CycloneDX/SPDX) per release, retained for the support period; dependency-CVE scan reports and patch-gate logs from `templates/ci/security.yml`.
- **Declared support period** and the channel(s) used to communicate it to users.
- **Coordinated-vulnerability-disclosure policy**, `security.txt`, and published advisories mapping fixes to CVEs.
- **Vulnerability-handling and remediation records** — discovery, triage, fix, disclosure timestamps.
- **Art. 14 reporting records** — early-warning, 72h notification, and final reports, with timestamps and the ENISA-platform submission references; user-notification records.
- **Security test/review records** (SAST/DAST, pen-test, code review) and their cadence.
- **Signed-update / release-signing key management** records and update-distribution logs.

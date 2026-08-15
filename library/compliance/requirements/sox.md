# Sarbanes-Oxley Act (SOX) — IT general controls for financial reporting — requirements checklist
> Source: https://www.law.cornell.edu/uscode/text/15/7241 (§302), https://www.law.cornell.edu/uscode/text/15/7262 (§404), https://www.law.cornell.edu/uscode/text/15/78m (§409 → 15 U.S.C. §78m(l)), https://www.law.cornell.edu/uscode/text/18/1519 (§802), https://www.law.cornell.edu/uscode/text/18/1350 (§906), https://pcaobus.org/oversight/standards/auditing-standards/details/AS2201 (PCAOB AS 2201) · Sarbanes-Oxley Act of 2002, Pub. L. 107-204 / PCAOB AS 2201 / COSO Internal Control–Integrated Framework (2013) · retrieved 2026-06-22 · US federal statute, public domain; PCAOB standards © PCAOB, COSO framework © COSO (proprietary, used by reference). Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- You are a publicly traded company filing periodic reports with the SEC under §13(a) or §15(d) of the Securities Exchange Act. SOX obligations attach at IPO; the certifications and ICFR assessment apply to your first annual report as a registrant.
- You are a pre-IPO, acquisition-target, or enterprise-sale-stage company: not yet legally bound, but adopt these controls early. ITGC maturity is diligence-gated in S-1 readiness, acquisitions, and enterprise procurement/security reviews. "Adopt early for IPO/enterprise readiness."
- Practical relevance for a solo founder / small team on managed infra is **IT general controls (ITGCs)** over any system in the financial-reporting boundary: billing/revenue (Stripe and its ledger), the application Postgres/Supabase tables that feed revenue, ARR, and balances, and the pipelines/jobs that move that data. Marketing-site infra is typically out of scope; the systems that produce a number in the financials are in scope.
- §404(a) (management assessment of ICFR) applies to all filers. §404(b) (external auditor attestation) applies to **accelerated and large accelerated filers**; emerging growth companies (EGCs, up to 5 years post-IPO; exemption per the JOBS Act, referenced in 15 U.S.C. §7262(b)) and non-accelerated filers (exemption at 15 U.S.C. §7262(c)) are exempt from §404(b) but still owe §404(a), §302, and §906. Confirm filer status with counsel/auditors — this gates the most expensive obligation.
- Effective dates: SOX core provisions effective from July 30, 2002 (§302 rules within 30 days). PCAOB AS 2201 is the current ICFR audit standard; amendments to .09 and new .99 (PCAOB Release 2024-005; SEC Release 34-100968) take effect **December 15, 2026**. (The one-year delay to that date was effected by PCAOB Release/File PCAOB-2025-01, SEC Release 34-103803, Aug 2025; Release 2024-005 / 34-100968 was the original adoption.)
- A lawyer, auditor, and (for §404) a PCAOB-registered audit firm must sign off on scoping, materiality, the control framework selection, and the attestation. This checklist scopes the ITGCs; it does not substitute for that sign-off.

## Requirements

### §302 (15 U.S.C. §7241) — CEO/CFO certification of reports and disclosure controls
- **Requires:** Signing officers certify each periodic report: they reviewed it; based on their knowledge it contains no material misstatement or omission; the financials fairly present financial condition; they have established and maintain disclosure controls and internal controls; they evaluated the effectiveness of disclosure controls as of the end of the period covered by the report; they disclosed to auditors and the audit committee all significant deficiencies, material weaknesses, and any fraud involving anyone with a role in internal controls; and they report material changes to controls. (The statutory text at §7241(a)(4)(C) says "within 90 days," but SEC Rules 13a-15(b)/15d-15(b) supersede that with an as-of-period-end evaluation.)
- **In code:** Make the underlying control evidence producible on demand — immutable audit/deploy logs (primitive 6), access-review exports (primitive 5), and a deficiency/fraud register the officers can attest against. The period-end evaluation maps to an access-review and change-log review job (templates/ci or a scheduled task) that generates a dated evidence snapshot as of fiscal-period end.
- **Primitive:** 5 (Access control — RLS/RBAC/MFA), 6 (Immutable audit logging)
- **Cite:** SOX §302; 15 U.S.C. §7241(a)(1)–(6), §7241(b); SEC Rules 13a-15(b)/15d-15(b) (period-end evaluation)

### §404(a) (15 U.S.C. §7262(a)) — management assessment of internal control over financial reporting
- **Requires:** The annual report must contain an internal control report stating management's responsibility for establishing and maintaining adequate ICFR, and management's assessment, as of fiscal year-end, of ICFR effectiveness. Assessment must use a suitable, recognized control framework (COSO Internal Control–Integrated Framework in practice).
- **In code:** Document the ITGC control set (the four AS 2201 domains below), test it on a cadence, and retain dated evidence. Tag every Postgres/Supabase table, view, and job inside the financial-reporting boundary in the data inventory (primitive 4) so scope is explicit and defensible. The management assessment is built from the ITGC evidence the primitives generate.
- **Primitive:** 4 (Data inventory + sensitive-field tagging), 5, 6, 7 (Retention + deletion jobs)
- **Cite:** SOX §404(a); 15 U.S.C. §7262(a)(1)–(2)

### §404(b) (15 U.S.C. §7262(b)) — external auditor attestation (accelerated/large filers)
- **Requires:** The registered public accounting firm that audits the financials must attest to and report on management's ICFR assessment, under PCAOB standards. Independent auditor, not a separate engagement from the financial-statement audit (integrated audit, AS 2201). EGCs and non-accelerated filers are exempt.
- **In code:** No new control — this is auditor-facing. Ensure ITGC evidence is auditor-ready: query-able audit logs, change tickets linked to PRs and approvals, access-review artifacts, backup/restore test records. Auditor and management must use the **same** control framework (AS 2201 .05).
- **Primitive:** 6, 5, 7
- **Cite:** SOX §404(b); 15 U.S.C. §7262(b); PCAOB AS 2201 .05

### §409 (15 U.S.C. §78m(l)) — rapid/real-time disclosure of material changes
- **Requires:** Issuers must disclose to the public on a rapid and current basis, in plain English, material changes in financial condition or operations, as the SEC determines necessary for investor protection (implemented via Form 8-K current-report triggers).
- **In code:** Operationally, ensure the systems feeding the numbers can surface a material event quickly — monitoring/alerting on revenue and balance anomalies, an incident pipeline that escalates events affecting financial data, and audit logs that establish *when* a material change was known. Shares the incident-detection plumbing with breach response (primitive 8).
- **Primitive:** 8 (Incident-response + breach pipeline), 6
- **Cite:** SOX §409; 15 U.S.C. §78m(l)

### §802 (18 U.S.C. §1519) — records integrity, anti-tampering, audit workpaper retention
- **Requires:** Criminal prohibition on knowingly altering, destroying, mutilating, concealing, falsifying, or making false entries in any record or document with intent to impede a federal investigation or bankruptcy matter; up to 20 years' imprisonment. The companion §802 provision (18 U.S.C. §1520(a)(1)) sets a **5-year** statutory retention for audit/review workpapers and carries a separate penalty of up to 10 years' imprisonment for failure to retain them; the SEC implementing rule (17 CFR 210.2-06) extends the retention period to **7 years**.
- **In code:** Make financial-data history tamper-evident and append-only — immutable audit log (hash-chained or WORM/object-lock storage in R2/S3), no in-place rewriting of financial records, no destructive deletes of audited data without a logged, retained record. **No unlogged production database edits**: block direct console/`psql` writes to financial tables; route all changes through reviewed, logged migrations. Retention jobs (primitive 7) must enforce a legal-hold floor, not just expiry.
- **Primitive:** 6 (Immutable audit logging), 7 (Retention + deletion jobs — 7-year floor for workpapers/audit records per SEC Rule 2-06)
- **Cite:** SOX §802; 18 U.S.C. §1519 (anti-tampering, up to 20 years); 18 U.S.C. §1520(a)(1) (5-year statutory workpaper retention, failure-to-retain penalty up to 10 years); 7-year retention at 17 CFR 210.2-06 (SEC Rule 2-06)

### §906 (18 U.S.C. §1350) — criminal CEO/CFO certification
- **Requires:** Each periodic report containing financials must include a written CEO/CFO certification that it fully complies with securities-law requirements and fairly presents financial condition and results. Knowing false certification: up to $1,000,000 and/or 10 years; willful: up to $5,000,000 and/or 20 years.
- **In code:** Same evidentiary backbone as §302 — the certification is only as defensible as the ITGC evidence behind it. No new technical control beyond making audit logs, access reviews, and change history reliably reproducible for the certifying officers.
- **Primitive:** 6, 5
- **Cite:** SOX §906; 18 U.S.C. §1350(a)–(b) (certification requirement), §1350(c)(1)–(c)(2) (knowing/willful penalties)

### ITGC Domain 1 — Access to programs and data
- **Requires:** Logical access to financial-reporting systems and data is restricted to authorized users on least privilege, with segregation of incompatible duties, and is reviewed periodically. (AS 2201 treats ITGC effectiveness as supporting reliance on automated/application controls.)
- **In code:** Postgres **RLS** plus application **RBAC** scoping access to financial tables; **MFA** enforced on Supabase Auth, the Supabase/Fly/Cloudflare/Vercel dashboards, the database, and the deploy pipeline. **Least privilege**: no shared admin accounts, scoped service-role keys, no broad `service_role` use from app code paths that touch revenue. **Segregation of duties (SoD)**: the person who writes a change cannot be the sole approver/deployer of it; production DB credentials are not in developer hands for ad-hoc use. **Periodic access reviews**: a scheduled (e.g. quarterly) export of who-has-access-to-what, with attestation. This is the same access-control primitive as SOC 2 CC6, ISO 27001 A.5.15/A.8.2–.8.3, and HIPAA §164.312(a) — build once, map to many.
- **Primitive:** 5 (Access control — RLS/RBAC/MFA/least-privilege; SoD)
- **Cite:** PCAOB AS 2201 .36, .47 (IT general controls supporting automated controls)

### ITGC Domain 2 — Program changes (change management)
- **Requires:** Changes to applications and database schema in the financial-reporting boundary are authorized, tested, reviewed, and approved before production, with an audit trail; no unauthorized or unreviewed changes reach production.
- **In code:** All changes via **pull request** with **mandatory review** (branch protection requiring ≥1 reviewer who is not the author — enforces SoD), required status checks, and **no direct pushes to the production branch**. Schema changes ship as reviewed, version-controlled **migrations** only — **no direct prod DB edits** via console or `psql`. Deploys (Fly/Vercel/Cloudflare) are pipeline-gated and **logged immutably** with who/what/when, linked back to the PR. The security CI (templates/ci/security.yml: SBOM, gitleaks, dep-audit) runs as a required gate so changes are scanned before merge. Same change-control spine as SOC 2 CC8.
- **Primitive:** 6 (Immutable audit logging — change/deploy trail), 5 (SoD via review separation)
- **Cite:** PCAOB AS 2201 .36–.38 (understanding flow of transactions, walkthroughs), .47

### ITGC Domain 3 — Program development (SDLC controls)
- **Requires:** New systems and significant development affecting financial reporting follow a controlled SDLC: requirements, testing, approval, and authorized migration to production; development/test separated from production.
- **In code:** Separate environments (Supabase/Fly project per environment; no prod data in dev/test, or masked if used). Code review and automated tests as merge gates; security checks (gitleaks secret scan, dependency audit, SBOM generation) in CI before release. Document the SDLC once as policy; the CI config is the enforcing artifact. Overlaps Domain 2 for ongoing changes — Domain 3 governs net-new systems entering scope.
- **Primitive:** 6 (audit trail of approvals/releases), 5 (authorization to promote)
- **Cite:** PCAOB AS 2201 .36 (how IT affects the flow of transactions)

### ITGC Domain 4 — Computer operations
- **Requires:** Production processing is reliable: backups taken and restorability verified; scheduled jobs (batch/cron) monitored for completion and failure; incidents detected, logged, escalated, and resolved.
- **In code:** Automated **backups** of Postgres/Supabase with periodic **restore tests** (a backup never test-restored is not a control). **Job monitoring** for the pipelines and retention/billing jobs that feed financial data — alert on failure, missed run, or anomalous output; failures logged. **Incident management**: detect → log → escalate → resolve, with records retained; reuse the same pipeline as the security incident-response primitive. Cloudflare/Fly health checks and alerting close the loop on availability.
- **Primitive:** 8 (Incident-response + breach pipeline), 7 (backup/retention jobs)
- **Cite:** PCAOB AS 2201 .36, .47 (reliance on IT general controls)

### Control framework + entity-level controls (COSO / AS 2201)
- **Requires:** Management's ICFR assessment and the auditor's audit must use the same suitable, recognized control framework (COSO Internal Control–Integrated Framework, 2013, in practice). Entity-level controls (tone, oversight, monitoring, the control environment) are assessed and can reduce required testing of other controls.
- **In code:** Document which framework you adopted (COSO) and map each ITGC to its COSO principle/component and to your unified primitives — this is the "build once, map to many" register that also satisfies SOC 2 and ISO 27001 control mappings. Entity-level: an immutable monitoring/audit log plus the access-review and change-review cadences are the technical entity-level evidence.
- **Primitive:** 4 (data inventory defining the scope boundary), 6 (monitoring evidence)
- **Cite:** PCAOB AS 2201 .05 (same suitable framework), .22–.26 (entity-level controls), .87 (COSO as illustrative criteria)

## Evidence to retain
- **CEO/CFO certifications** (§302 and §906) filed with each periodic report, plus the dated disclosure-controls and ICFR effectiveness evaluation that backs them, performed as of fiscal-period end (§302 period-end evaluation per SEC Rules 13a-15(b)/15d-15(b)).
- **Management's §404(a) ICFR report** and the underlying control-testing evidence for each ITGC, dated as of fiscal year-end.
- **Audit workpapers and review records: retain 7 years** (17 CFR 210.2-06, SEC Rule 2-06; the statutory floor under 18 U.S.C. §1520(a)(1) is 5 years). Keep financial-data audit logs and supporting ITGC evidence at least as long; align deletion jobs to a 7-year legal-hold floor.
- **Access register and periodic access reviews** — who had access to financial systems/data, with provisioning/deprovisioning records, MFA enforcement evidence, and SoD conflict checks; reviewer attestation per cycle.
- **Change-management trail** — for each change in scope: PR, reviewer approval (distinct from author), CI/security-check results, migration record, and immutable deploy log with timestamp and actor; evidence that no direct prod DB edits occurred.
- **SDLC artifacts** for new in-scope systems — design/approval records, test evidence, authorized promotion to production.
- **Operations evidence** — backup completion logs, restore-test records, job-success/failure monitoring history, and the incident log (detection → escalation → resolution) for in-scope systems.
- **Deficiency / material-weakness / fraud register** disclosed to auditors and the audit committee, with remediation tracking.
- **Control framework mapping** — the COSO (and cross-framework SOC 2 / ISO 27001) mapping of each ITGC, and the documented financial-reporting scope boundary from the data inventory.
- **Vendor / sub-processor records** for in-scope managed providers (Stripe, Supabase, Fly, Cloudflare, Vercel) — their SOC 1 / SOC 2 reports and DPAs, reviewed annually, evidencing reliance on their controls within your scope boundary (primitive 9).

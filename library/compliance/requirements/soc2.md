# SOC 2 (AICPA Trust Services Criteria) — requirements checklist
> Source: https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services + AICPA 2017 Trust Services Criteria (with Revised Points of Focus — 2022) · retrieved 2026-06-20 · **COPYRIGHTED (AICPA/ASEC).** The criteria text and points of focus are a paid AICPA publication and are **NOT reproduced here** — this enumerates the public CC1–CC9 / category structure by reference and links the source. Reference only — not legal advice, not an audit. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- SOC 2 is **voluntary, customer/market-driven** — there is no legal threshold. You pursue it when enterprise prospects, security questionnaires, or MSAs demand it (typical for B2B SaaS once you sell upmarket).
- **Scope = the system** that delivers the service to user entities (your product + the managed infra it runs on: Supabase / Fly / Cloudflare / Vercel, plus the sub-service orgs behind them).
- **Mandatory category:** **Security (Common Criteria, CC1–CC9)** is required in every SOC 2. The other four — **Availability, Confidentiality, Processing Integrity, Privacy** — are **opt-in**; include each only if you make commitments in that area (see triggers per category below).
- **Report types:** **Type I** = design of controls at a point in time. **Type II** = design **and operating effectiveness** over a period (typically 3–12 months). Type II is what buyers actually want; it requires evidence that controls *ran* throughout the window — design the primitives to emit that evidence continuously, not retroactively.
- A SOC 2 is a **CPA attestation**; you cannot self-certify. This checklist gets the *system* audit-ready; the auditor still tests it.

## Requirements

### CC1 — Control Environment (maps to COSO component 1; CC1.1–CC1.5)
- **Requires:** Demonstrate a commitment to integrity/ethics, board/owner oversight independent of management, an org structure with defined authority and reporting lines, a commitment to attract/develop/retain competent people, and that individuals are held accountable for control responsibilities. (CC1.1 integrity & ethical values; CC1.2 oversight; CC1.3 structure/authority/responsibility; CC1.4 competence; CC1.5 accountability.)
- **In code:** Mostly governance, but make it machine-evidenced for a solo/small team: codify roles and who-can-do-what in an `org/roles.md` + an RBAC role matrix in the DB (`roles`, `role_assignments` tables); require a signed code-of-conduct / acceptable-use acknowledgment stored with timestamp; record onboarding/offboarding checklists. Tie "accountability" to identity in your access-control layer so every privileged action is attributable to a named human.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** TSC CC1.1–CC1.5

### CC2 — Communication & Information (maps to COSO component 4; CC2.1–CC2.3)
- **Requires:** Obtain/generate relevant quality information to support internal control (CC2.1); internally communicate objectives and control responsibilities, including security policies, to personnel (CC2.2); communicate with external parties (customers, vendors, regulators) on matters affecting controls (CC2.3).
- **In code:** Version-control security policies in the repo (`/policies/*.md`) so changes are diffable and dated; surface security commitments and contact channels publicly (Trust page, `/.well-known/security.txt`, status page); generate the "quality information" stream from your audit log + monitoring dashboards. Keep a published incident/breach communication channel wired to the incident pipeline.
- **Primitive:** 6. Immutable audit logging (with 8. Incident-response pipeline for external comms)
- **Cite:** TSC CC2.1–CC2.3

### CC3 — Risk Assessment (maps to COSO component 3; CC3.1–CC3.4)
- **Requires:** Specify objectives clearly enough to identify/assess risk (CC3.1); identify and analyze risks to objectives across the entity (CC3.2); consider the potential for **fraud** in assessing risk (CC3.3); identify and assess **changes** (to the business, systems, vendors, regulations) that could significantly affect the system of internal control (CC3.4).
- **In code:** Maintain a living risk register (`risk-register.md` or a tracked table) listing assets, threats, likelihood/impact, and treatment — driven off your data inventory. Run it at least annually and on major change. Tag which sensitive data stores/flows drive each risk so the register and the inventory stay consistent.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** TSC CC3.1–CC3.4

### CC4 — Monitoring Activities (maps to COSO component 5; CC4.1–CC4.2)
- **Requires:** Select/develop and perform ongoing and/or separate evaluations to ascertain whether the components of internal control are present and functioning (CC4.1); evaluate and communicate control deficiencies in a timely manner to those responsible for corrective action (CC4.2).
- **In code:** Stand up continuous control monitoring: scheduled checks that assert MFA-on-everyone, no public buckets, RLS enabled on every table, backups succeeding, certs valid, logging intact — failures open a ticket automatically. Use the platform advisors (e.g. Supabase security/performance advisors) and dependency/secret scanners in CI as recurring evaluations; route findings to a tracked remediation queue with SLAs.
- **Primitive:** 6. Immutable audit logging (continuous monitoring + alerting)
- **Cite:** TSC CC4.1–CC4.2

### CC5 — Control Activities (maps to COSO component 2; CC5.1–CC5.3)
- **Requires:** Select/develop control activities that mitigate risks to acceptable levels (CC5.1); select/develop **general controls over technology** (CC5.2); deploy control activities through **policies that establish expectations and procedures that put them into action** (CC5.3).
- **In code:** Implement the technical general controls themselves: branch protection + required PR review, IaC for infra (so config is reviewable), least-privilege service accounts, automated tests in CI as preventive controls. Each policy in `/policies` must have a corresponding *enforced* mechanism (policy-as-code where possible), not just a document.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** TSC CC5.1–CC5.3

### CC6 — Logical & Physical Access Controls (CC6.1–CC6.8)
- **Requires:** The heart of the Security category. CC6.1 logical access security software/infrastructure/architecture protecting information assets (identification, authentication, **encryption**, network segmentation); CC6.2 registration/authorization of new users and timely de-provisioning; CC6.3 role-based authorization, modification, and removal of access following **least privilege / segregation of duties**; CC6.4 restrict **physical** access to facilities/assets; CC6.5 secure **disposal** of data and physical media before reuse/retirement; CC6.6 protect against threats from **outside the system boundary** (firewalls/WAF, perimeter); CC6.7 restrict **transmission/movement** of information and protect it in transit/on removable media (encryption in transit, DLP-style controls); CC6.8 prevent/detect **unauthorized or malicious software**.
- **In code:**
  - **CC6.1/6.7 (encryption):** Force TLS 1.2+ everywhere (Cloudflare/Fly/Vercel edge), HSTS, AES-256 at rest (Supabase Postgres + storage default), encrypt sensitive columns/secrets via KMS/Vault; store keys in a managed secret store (Fly secrets / platform vault), never in env files in the repo.
  - **CC6.1–6.3 (access):** Postgres **RLS on every table**, app **RBAC**, **MFA mandatory** on all human accounts and the cloud consoles; scoped service tokens with least privilege; deny-by-default.
  - **CC6.2/6.3 (lifecycle):** Automated provisioning/deprovisioning tied to the roles table; access reviews quarterly with evidence; immediate revoke on offboarding.
  - **CC6.4 (physical):** Inherited from sub-service orgs — cover via their SOC 2 reports in the vendor register (carve-out / inclusive method).
  - **CC6.5 (disposal):** Crypto-erase / verified deletion in the retention-jobs pipeline; document destruction of decommissioned volumes/buckets.
  - **CC6.6 (perimeter):** Cloudflare WAF + rate limiting + DDoS, restrict ingress, private networking for DB.
  - **CC6.8 (malicious software):** Dependency scanning (SCA), image/container scanning, branch protection preventing unreviewed code, runtime anomaly alerts.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege (primary); 1. Encryption (CC6.1/6.7); 7. Retention + deletion jobs (CC6.5)
- **Cite:** TSC CC6.1–CC6.8

### CC7 — System Operations (CC7.1–CC7.5)
- **Requires:** CC7.1 detect/monitor for new **vulnerabilities** and config changes (vuln management); CC7.2 monitor system components for **anomalies/security events**; CC7.3 evaluate detected events to determine whether they are **security incidents**; CC7.4 **respond** to identified security incidents via a defined program; CC7.5 identify/develop and implement activities to **recover** from incidents (and from availability failures).
- **In code:** Centralized, immutable logging (app + infra + auth) shipped off-box; alerting on anomalies; a written **incident-response runbook** with severities, on-call, and timelines; a breach-handling pipeline (triage → contain → eradicate → recover → notify) wired to comms templates; regular vulnerability scanning (CC7.1) and recovery testing tied to backups. Every incident produces a dated record (detection, actions, resolution) retained as Type II evidence.
- **Primitive:** 8. Incident-response + breach pipeline (CC7.3–7.5); 6. Immutable audit logging (CC7.1–7.2)
- **Cite:** TSC CC7.1–CC7.5

### CC8 — Change Management (CC8.1)
- **Requires:** Authorize, design, develop/acquire, configure, document, test, approve, and **implement changes** to infrastructure, data, software, and procedures to meet objectives — i.e. a controlled SDLC change process.
- **In code:** All changes via PR with required review + status checks; CI tests gate merge; infrastructure-as-code with reviewed plans; migrations versioned and reviewed (no ad-hoc prod DB edits); separate staging/prod with promotion; deployment + migration history retained as the change-record evidence. Emergency-change path is documented and after-the-fact reviewed.
- **Primitive:** 6. Immutable audit logging (change/deploy/migration trail)
- **Cite:** TSC CC8.1

### CC9 — Risk Mitigation (CC9.1–CC9.2)
- **Requires:** CC9.1 identify, select, and develop risk-mitigation activities for **disruptions** (including business continuity / insurance considerations); CC9.2 assess and manage risks associated with **vendors and business partners** (sub-service organizations) — due diligence, contracts, and ongoing monitoring.
- **In code:** Maintain a **vendor / sub-processor register** for every managed-infra provider and tool touching data (Supabase, Fly, Cloudflare, Vercel, email, analytics, error tracking) with: data shared, location, their SOC 2 / ISO report on file, DPA/BAA status, and review date. Re-review annually and on onboarding a new vendor. Document BC/DR posture (backups, RTO/RPO, failover) for CC9.1.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA) (CC9.2); 8. Incident-response + breach pipeline (CC9.1 continuity)
- **Cite:** TSC CC9.1–CC9.2

### A1 — Availability (include if you commit to SLAs / uptime; A1.1–A1.3)
- **Requires:** A1.1 maintain/monitor **capacity** to meet demand; A1.2 environmental protections, **backup**, and recovery infrastructure to meet availability objectives; A1.3 **test** recovery / business-continuity procedures.
- **In code:** Autoscaling/capacity monitoring + alerts on resource thresholds; automated backups (Supabase PITR / scheduled dumps) with off-region copies; periodic **restore drills** with documented results; multi-region/failover where SLA demands; public status page with incident history. Trigger to include: any contractual SLA or public uptime promise.
- **Primitive:** 7. Retention + deletion jobs (backup/restore lifecycle) + 8. Incident-response (recovery)
- **Cite:** TSC A1.1–A1.3

### C1 — Confidentiality (include if you commit to protecting confidential/proprietary data; C1.1–C1.2)
- **Requires:** C1.1 **identify and maintain** confidential information per commitments/requirements (classification); C1.2 **dispose of** confidential information when no longer needed.
- **In code:** Data classification baked into the **data inventory** (tag fields/tables as confidential/PII/secret); access scoped to classification via RLS/RBAC; encryption for confidential stores; **retention + deletion jobs** that purge confidential data at end of need or contract termination, with deletion evidence. Trigger: NDAs/MSAs with confidentiality or data-retention commitments.
- **Primitive:** 4. Data inventory + sensitive-field tagging (C1.1); 7. Retention + deletion jobs (C1.2)
- **Cite:** TSC C1.1–C1.2

### PI1 — Processing Integrity (include if customers rely on your processing being correct; PI1.1–PI1.5)
- **Requires:** PI1.1 use of quality **information** about processing objectives/definitions; PI1.2 **inputs** are complete, accurate, and authorized; PI1.3 **processing** is complete, accurate, timely, and authorized; PI1.4 **outputs** are delivered completely, accurately, and timely per specifications; PI1.5 **store** inputs/outputs completely, accurately, and timely.
- **In code:** Input validation + schema/constraint enforcement at every boundary; idempotency keys and transactional integrity for processing; reconciliation/checksum jobs that detect dropped or duplicated records; output validation and delivery confirmation; audit log of processing steps so completeness/accuracy is provable. Trigger: your product computes results customers use for business decisions (billing, analytics, financial, etc.).
- **Primitive:** 6. Immutable audit logging (processing trail / reconciliation evidence)
- **Cite:** TSC PI1.1–PI1.5

### P1–P8 — Privacy (include if you collect personal information directly from data subjects)
- **Requires:** The Privacy category mirrors the eight Generally Accepted Privacy Principles:
  - **P1 Notice & communication** — provide notice about privacy practices/objectives.
  - **P2 Choice & consent** — communicate choices and obtain consent for collection/use/disclosure.
  - **P3 Collection** — collect personal information consistent with objectives (lawful, limited).
  - **P4 Use, retention & disposal** — limit use to stated purposes, retain only as needed, dispose securely.
  - **P5 Access** — provide data subjects access to their personal information for review/correction.
  - **P6 Disclosure & notification** — disclose to third parties only per consent/commitments and handle breach notification of personal data.
  - **P7 Quality** — maintain accurate, complete, relevant personal information.
  - **P8 Monitoring & enforcement** — monitor compliance, handle inquiries/complaints/disputes about privacy.
- **In code:** This is where SOC 2 Privacy overlaps with GDPR/CCPA primitives:
  - **P1:** versioned privacy notice surfaced in-product.
  - **P2:** **consent + preference store** (granular, GPC-aware, gating collection until consent).
  - **P3/P4/P7:** **data inventory** with purpose tags + **retention/deletion jobs** + correction flows.
  - **P5:** **DSAR engine** (access/export/correct).
  - **P6:** disclosure controlled via the **vendor/sub-processor register** (who personal data goes to) + **breach-notification pipeline**.
  - **P8:** privacy-request intake, complaint log, and monitoring tied to the audit log.
- **Primitive:** 3. Consent + preference store (P2); 2. DSAR engine (P5, access/correct/export); 4. Data inventory (P3/P4/P7); 7. Retention + deletion jobs (P4); 9. Vendor/sub-processor register (P6); 8. Incident-response/breach pipeline (P6)
- **Cite:** TSC P1.0–P8.1 (Privacy category)

## Evidence to retain
SOC 2 Type II is **evidence over a period** — auditors sample the whole window, so primitives must emit dated, tamper-evident artifacts continuously. Retain:
- **Policies & governance (CC1/CC2/CC5):** version-controlled security/privacy policies with change history; signed code-of-conduct/acceptable-use acknowledgments; org/role definitions.
- **Risk (CC3/CC9):** dated risk register + annual assessment; vendor due-diligence records and their SOC 2/ISO reports; BC/DR plan.
- **Access (CC6):** MFA-enforcement proof, RBAC/RLS config, provisioning/deprovisioning tickets, **quarterly access-review** records, list of privileged users.
- **Encryption (CC6.1/6.7):** TLS config / cert inventory, at-rest encryption settings, key-management evidence.
- **Monitoring & ops (CC4/CC7):** immutable logs covering the period, alert history, vulnerability-scan results, dependency/secret-scan reports, the incident-response runbook + every incident record (detection→resolution).
- **Change (CC8):** PR/review history, CI run records, migration/deploy history, sampling of changes showing test+approval.
- **Availability (A1):** uptime/capacity metrics, backup success logs, **restore-test** results, status-page incident history.
- **Confidentiality (C1):** data-classification matrix, secure-disposal/deletion logs.
- **Processing Integrity (PI1):** validation/reconciliation job outputs, error-handling records.
- **Privacy (P1–P8):** privacy notice versions, consent/preference records, DSAR fulfillment logs, retention/deletion job runs, complaint log.
- **System description:** a written description of the system (boundaries, infrastructure, sub-service orgs, complementary user-entity controls) — required component of the report.

Treat every primitive's output as Type II evidence: timestamped, append-only, retained for the full audit window plus a margin.

# NIST Privacy Framework 1.0 — requirements checklist
> Source: https://www.nist.gov/privacy-framework · NIST.CSWP.01162020 (Privacy Framework v1.0, Jan 16 2020), Table 2 Core (Appendix A) · retrieved 2026-06-20 · US Government work, public domain — free to summarize with attribution. Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- **Voluntary, always-relevant scaffold.** No statutory trigger, threshold, or jurisdiction — it is a risk-management tool, not a law. Adopt it as the privacy-side umbrella the moment you process any personal data.
- **Use it to operationalize the laws you *are* subject to.** The Core is outcome-based and crosswalks to GDPR, CPRA/CCPA, the US state laws, PIPEDA, and Quebec Law 25 — it turns "comply with X" into concrete engineering subcategories. NIST publishes a GDPR/Privacy Framework crosswalk and the framework pairs with **NIST CSF 2.0** for the security side.
- **Structure:** 5 Functions → 18 Categories → 100 Subcategories. Pick a **Profile** (Current vs Target) and **Implementation Tier** (1 Partial → 4 Adaptive) for your risk appetite; you are not expected to implement all 100 — select subcategories by privacy risk.
- For a solo/small team on managed infra (Supabase/Fly/Cloudflare/Vercel), the high-value subset is IDENTIFY-P (inventory), CONTROL-P (DSAR/consent), COMMUNICATE-P (notice/breach), and PROTECT-P (security baseline); GOVERN-P is lightweight policy/role docs.

## Requirements

### ID.IM-P — Inventory and Mapping (IDENTIFY-P)
- **Requires:** Understand and map all data processing so privacy risk can be managed. Subcategories: **ID.IM-P1** inventory systems/products/services that process data; **ID.IM-P2** inventory owners/operators (incl. third parties) and their roles; **ID.IM-P3** inventory categories of individuals whose data is processed; **ID.IM-P4** inventory the data actions; **ID.IM-P5** inventory the purposes for those data actions; **ID.IM-P6** inventory the data elements within data actions; **ID.IM-P7** identify the data processing environment (geographic location, internal, cloud, third parties); **ID.IM-P8** produce a data map illustrating data actions, elements, component owner roles, and individual/third-party interactions.
- **In code:** Maintain a machine-readable data inventory (`data-inventory.yaml` / a registry table) listing each table/bucket/queue, the personal-data fields it holds, purpose, data subject category, and storage region (Supabase project region, R2 bucket, Fly volume). Tag sensitive fields (PII/PHI/PCI/child) at the column level. Derive a data-flow map (source → store → sub-processor → deletion) from it; regenerate in CI so it can't drift. ID.IM-P7 = record residency per managed-infra resource.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** §A / Table 2 — ID.IM-P1…P8

### ID.BE-P — Business Environment (IDENTIFY-P)
- **Requires:** Understand and prioritize mission, objectives, stakeholders, and activities to inform privacy roles and risk decisions. **ID.BE-P1** identify and communicate the organization's role(s) in the data processing ecosystem (controller/processor/joint); **ID.BE-P2** establish and communicate priorities for mission/objectives/activities; **ID.BE-P3** identify systems/products/services that support priorities and communicate key requirements.
- **In code:** A short `STRATEGY.md`/`DECISIONS.md` entry stating whether you are a controller or processor for each data flow (drives which contracts you owe — DPA vs BAA) and which systems are privacy-critical. Mostly documentation, not code.
- **Primitive:** 4. Data inventory + sensitive-field tagging (controller/processor role classification)
- **Cite:** §A / Table 2 — ID.BE-P1…P3

### ID.RA-P — Risk Assessment (IDENTIFY-P)
- **Requires:** Understand privacy risks to individuals and follow-on organizational impacts. **ID.RA-P1** identify contextual factors of systems/data actions (demographics, sensitivity, data types, visibility of processing); **ID.RA-P2** identify and evaluate data-analytic inputs/outputs for bias; **ID.RA-P3** identify potential problematic data actions and associated problems; **ID.RA-P4** use problematic data actions + likelihood + impact to determine and prioritize risk; **ID.RA-P5** identify, prioritize, and implement risk responses.
- **In code:** A lightweight DPIA/PIA template run per new feature that touches personal data (a `pia/` doc per feature), scoring problematic-data-action likelihood × impact and recording the chosen mitigation. For any ML/analytics feature, document a bias evaluation (ID.RA-P2). Gate risky features behind this assessment in the dev loop.
- **Primitive:** 4. Data inventory + sensitive-field tagging (feeds DPIA/risk scoring)
- **Cite:** §A / Table 2 — ID.RA-P1…P5

### ID.DE-P — Data Processing Ecosystem Risk Management (IDENTIFY-P)
- **Requires:** Manage privacy risk from third parties in the data processing ecosystem. **ID.DE-P1** establish/assess/manage ecosystem risk-management policies agreed by stakeholders; **ID.DE-P2** identify, prioritize, and assess ecosystem parties (service providers, customers, partners, manufacturers, developers) via a privacy risk process; **ID.DE-P3** use contracts to implement measures meeting the privacy program's objectives; **ID.DE-P4** use interoperability frameworks/multi-party approaches to manage ecosystem risks; **ID.DE-P5** routinely assess ecosystem parties via audits/test results/evaluations against contractual obligations.
- **In code:** A sub-processor register (`sub-processors.yaml`) listing every vendor that touches personal data (Supabase, Fly, Cloudflare, Vercel, email/SMS, LLM APIs, analytics), the contract type on file (DPA/BAA/security addendum), data categories shared, and region. ID.DE-P3 = confirm the vendor offers the needed contract *before* routing data to it; ID.DE-P5 = a scheduled review of vendor SOC 2/security attestations.
- **Primitive:** 9. Vendor / sub-processor register (BAA/DPA)
- **Cite:** §A / Table 2 — ID.DE-P1…P5

### GV.PO-P — Governance Policies, Processes, and Procedures (GOVERN-P)
- **Requires:** Policies/processes to manage regulatory, legal, risk, environmental, and operational requirements and inform privacy-risk management. **GV.PO-P1** establish and communicate organizational privacy values/policies (e.g., conditions on processing such as uses/retention periods, individuals' prerogatives); **GV.PO-P2** establish processes to instill privacy values in SDLC and operations; **GV.PO-P3** establish workforce privacy roles/responsibilities; **GV.PO-P4** coordinate privacy roles with third-party stakeholders; **GV.PO-P5** understand and manage legal/regulatory/contractual privacy requirements; **GV.PO-P6** governance and risk-management policies address privacy risks.
- **In code:** A versioned privacy policy + internal data-handling policy in-repo (`policies/`), a CONTRIBUTING/CLAUDE.md note baking privacy-by-design into the build loop (GV.PO-P2), and a documented owner/role for privacy decisions. GV.PO-P1 retention conditions feed the retention jobs.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege (role definition) + 7. Retention (policy source)
- **Cite:** §A / Table 2 — GV.PO-P1…P6

### GV.RM-P — Risk Management Strategy (GOVERN-P)
- **Requires:** Establish priorities, constraints, risk tolerances, and assumptions to support operational risk decisions. **GV.RM-P1** establish and agree risk-management processes among stakeholders; **GV.RM-P2** determine and clearly express organizational risk tolerance; **GV.RM-P3** inform risk tolerance by the organization's role(s) in the data processing ecosystem.
- **In code:** A short risk-tolerance statement in `DECISIONS.md` (acceptable residual privacy risk, which mitigations are mandatory vs deferred); set the Implementation Tier target here. Documentation, not code.
- **Primitive:** 4. Data inventory + sensitive-field tagging (risk decisions reference the inventory)
- **Cite:** §A / Table 2 — GV.RM-P1…P3

### GV.AT-P — Awareness and Training (GOVERN-P)
- **Requires:** Provide privacy awareness/training to workforce and third parties so they perform privacy duties consistent with policies. **GV.AT-P1** inform/train the workforce on roles/responsibilities; **GV.AT-P2** senior executives understand their roles; **GV.AT-P3** privacy personnel understand their roles; **GV.AT-P4** third parties understand their roles.
- **In code:** For a solo/small team, a brief onboarding checklist and a recorded annual privacy-awareness acknowledgment; ensure contractor/vendor agreements state privacy responsibilities (ties to ID.DE-P3 contracts). Mostly process.
- **Primitive:** 9. Vendor / sub-processor register (third-party role awareness via contracts)
- **Cite:** §A / Table 2 — GV.AT-P1…P4

### GV.MT-P — Monitoring and Review (GOVERN-P)
- **Requires:** Ongoing review of privacy posture. **GV.MT-P1** re-evaluate privacy risk on an ongoing basis and as business environment/governance/data-processing/systems change; **GV.MT-P2** review privacy values/policies/training and communicate updates; **GV.MT-P3** establish processes to assess compliance with legal requirements and privacy policies; **GV.MT-P4** establish processes to communicate progress managing privacy risks; **GV.MT-P5** establish processes to receive/analyze/respond to problematic data actions disclosed from internal and external sources (incl. privacy researchers); **GV.MT-P6** incorporate lessons learned from problematic data actions; **GV.MT-P7** establish processes to receive/track/respond to individuals' complaints, concerns, and questions about privacy practices.
- **In code:** A scheduled privacy re-check tied to `/savepoint` when new data flows appear (GV.MT-P1); a `privacy@`/security.txt intake plus an issue label for privacy complaints and disclosures (GV.MT-P5, P7); a post-incident lessons-learned log feeding back into the IR runbook (GV.MT-P6). Pairs with the immutable audit log to evidence "progress."
- **Primitive:** 8. Incident-response + breach pipeline (intake/triage of problematic data actions + complaints)
- **Cite:** §A / Table 2 — GV.MT-P1…P7

### CT.PO-P — Data Processing Policies, Processes, and Procedures (CONTROL-P)
- **Requires:** Maintain policies to manage data processing with sufficient granularity. **CT.PO-P1** establish processes for authorizing data processing (organizational decisions, individual consent), revoking, and maintaining authorizations; **CT.PO-P2** establish processes enabling data review, transfer, sharing/disclosure, alteration, and deletion (to maintain data quality and manage retention); **CT.PO-P3** establish processes enabling individuals' data-processing preferences and requests; **CT.PO-P4** align a data life cycle with the system development life cycle.
- **In code:** A consent + preference store (granular, timestamped, withdrawable) backing CT.PO-P1/P3; a DSAR intake route that accepts and tracks access/correct/delete/export requests (CT.PO-P3); retention/deletion configuration per data category tying the data life cycle to releases (CT.PO-P4). Server-side GPC honoring belongs here.
- **Primitive:** 3. Consent + preference store (authorization/preferences) — also 2. DSAR engine (request intake) and 7. Retention
- **Cite:** §A / Table 2 — CT.PO-P1…P4

### CT.DM-P — Data Processing Management (CONTROL-P)
- **Requires:** Manage data to enable individual participation, data quality, and minimization. **CT.DM-P1** data elements can be accessed for review; **CT.DM-P2** accessed for transmission or disclosure; **CT.DM-P3** accessed for alteration; **CT.DM-P4** accessed for deletion; **CT.DM-P5** data destroyed according to policy; **CT.DM-P6** data transmitted using standardized formats; **CT.DM-P7** mechanisms for transmitting processing permissions and related values with data elements; **CT.DM-P8** audit/log records determined, documented, implemented, and reviewed per policy and incorporating data minimization; **CT.DM-P9** technical measures managing data processing are tested and assessed; **CT.DM-P10** stakeholder privacy preferences included in algorithmic design objectives and outputs evaluated against them.
- **In code:** The DSAR engine implements P1–P4 as queryable access/export/correct/delete operations across DB + backups + caches + analytics + sub-processors, keyed by (user, jurisdiction). P5 = the retention/deletion jobs proving destruction. P6 = portable export in machine-readable JSON/CSV. P8 = the immutable audit log, scoped to minimize logged personal data. P10 = enforce stored consent preferences in any recommendation/ML output and log the evaluation.
- **Primitive:** 2. DSAR engine (access/delete/correct/export) — with 6. Immutable audit logging (P8) and 7. Retention (P5)
- **Cite:** §A / Table 2 — CT.DM-P1…P10

### CT.DP-P — Disassociated Processing (CONTROL-P)
- **Requires:** Increase disassociability to protect privacy and enable minimization. **CT.DP-P1** process data to limit observability and linkability (local-device processing, privacy-preserving cryptography); **CT.DP-P2** limit identification of individuals (de-identification, tokenization); **CT.DP-P3** limit inference about behavior/activities (decentralized/distributed architectures); **CT.DP-P4** system/device configurations permit selective collection or disclosure of data elements; **CT.DP-P5** substitute attribute references for attribute values.
- **In code:** Pseudonymize/tokenize identifiers (store a surrogate key, not raw email/SSN, where possible) — Supabase column-level encryption or a separate vault for the linking table (CT.DP-P2/P5). Collect only fields the feature needs (CT.DP-P4 selective collection). Where feasible, aggregate or compute client-side to reduce linkable server data (CT.DP-P1/P3). Overlaps GDPR Art. 32 pseudonymisation.
- **Primitive:** 1. Encryption (TLS+AES, key mgmt) — tokenization/pseudonymisation/key separation
- **Cite:** §A / Table 2 — CT.DP-P1…P5

### CM.PO-P — Communication Policies, Processes, and Procedures (COMMUNICATE-P)
- **Requires:** Maintain policies to increase transparency of data processing practices and associated privacy risks. **CM.PO-P1** establish transparency policies/processes for communicating data-processing purposes, practices, and associated privacy risks; **CM.PO-P2** establish roles/responsibilities (e.g., public relations) for that communication.
- **In code:** A versioned, in-repo privacy notice rendered to users (purposes, categories, retention, rights), updated via PR so changes are diffable; a designated owner for breach/privacy communications. Documentation + a published page.
- **Primitive:** 3. Consent + preference store (notice is the front door to consent/preferences)
- **Cite:** §A / Table 2 — CM.PO-P1…P2

### CM.AW-P — Data Processing Awareness (COMMUNICATE-P)
- **Requires:** Give individuals/organizations reliable knowledge of processing and effective mechanisms to increase predictability. **CM.AW-P1** mechanisms (notices, internal/public reports) communicating purposes, practices, risks, and options for enabling individuals' preferences/requests; **CM.AW-P2** mechanisms for obtaining feedback from individuals (surveys, focus groups); **CM.AW-P3** system/product/service design enables data-processing visibility; **CM.AW-P4** records of data disclosures and sharing maintained and accessible for review/transmission; **CM.AW-P5** data corrections/deletions can be communicated to individuals/organizations in the ecosystem; **CM.AW-P6** data provenance and lineage maintained and accessible; **CM.AW-P7** impacted individuals and organizations notified about a privacy breach or event; **CM.AW-P8** individuals provided mitigation mechanisms (credit monitoring, consent withdrawal, data alteration/deletion) for impacts of problematic data actions.
- **In code:** A user-facing privacy dashboard exposing consent state, request controls, and a "your data" view (CM.AW-P1/P3); a disclosure/sharing log table queryable per user (CM.AW-P4) and provenance/lineage metadata on records (CM.AW-P6); a propagation step that pushes corrections/deletions to sub-processors and downstream sources (CM.AW-P5); a breach-notification pipeline that produces and sends notices on the tightest applicable clock (CM.AW-P7) and offers withdrawal/deletion remedies in-product (CM.AW-P8).
- **Primitive:** 8. Incident-response + breach pipeline (P7/P8) — with 6. Immutable audit logging (P4/P6 disclosure & lineage records) and 2. DSAR engine (P5 correction/deletion propagation)
- **Cite:** §A / Table 2 — CM.AW-P1…P8

### PR.PO-P — Data Protection Policies, Processes, and Procedures (PROTECT-P)
- **Requires:** Security/privacy policies, processes, and procedures to manage protection of data. **PR.PO-P1** create/maintain a baseline IT configuration incorporating security principles (least functionality); **PR.PO-P2** configuration change-control processes; **PR.PO-P3** backups conducted, maintained, and tested; **PR.PO-P4** physical-environment policy/regulations met; **PR.PO-P5** protection processes improved; **PR.PO-P6** effectiveness of protection technologies shared; **PR.PO-P7** Incident Response + Business Continuity response plans and Incident/Disaster Recovery plans established and managed; **PR.PO-P8** response and recovery plans tested; **PR.PO-P9** privacy procedures included in HR practices (deprovisioning, personnel screening); **PR.PO-P10** vulnerability-management plan developed and implemented.
- **In code:** Infra-as-code/baseline config in the repo (PR.PO-P1/P2 via PR-gated changes); automated backups with periodic restore tests (PR.PO-P3 — Supabase PITR, Fly volume snapshots); an IR + DR runbook with RTO/RPO, exercised (PR.PO-P7/P8); a dependency-CVE scan + patch SLA in CI (PR.PO-P10); a deprovisioning checklist revoking tokens/access on offboarding (PR.PO-P9). PR.PO-P4 physical environment is satisfied by the managed providers' attestations.
- **Primitive:** 8. Incident-response + breach pipeline (P7/P8/P10) — with 5. Access control (P9 deprovisioning) and 1. Encryption (backup protection, P3)
- **Cite:** §A / Table 2 — PR.PO-P1…P10

### PR.AC-P — Identity Management, Authentication, and Access Control (PROTECT-P)
- **Requires:** Limit access to data and devices to authorized individuals/processes/devices per assessed risk. **PR.AC-P1** issue/manage/verify/revoke/audit identities and credentials; **PR.AC-P2** manage physical access to data/devices; **PR.AC-P3** manage remote access; **PR.AC-P4** manage permissions/authorizations incorporating least privilege and separation of duties; **PR.AC-P5** protect network integrity (segregation/segmentation); **PR.AC-P6** proof and bind individuals/devices to credentials and authenticate commensurate with transaction risk.
- **In code:** MFA + SSO on all admin/console access (PR.AC-P1/P6); Postgres RLS + RBAC with scoped, short-lived tokens enforcing least privilege (PR.AC-P4); private networking between services (Fly private network, Cloudflare-fronted ingress) for segmentation (PR.AC-P5); restricted, logged remote/console access (PR.AC-P3); credential rotation + revocation on offboarding, audited (PR.AC-P1). Physical access (PR.AC-P2) inherited from providers.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** §A / Table 2 — PR.AC-P1…P6

### PR.DS-P — Data Security (PROTECT-P)
- **Requires:** Manage data to protect privacy and maintain confidentiality, integrity, availability. **PR.DS-P1** protect data-at-rest; **PR.DS-P2** protect data-in-transit; **PR.DS-P3** formally manage systems/data through removal, transfers, and disposition; **PR.DS-P4** maintain adequate capacity for availability; **PR.DS-P5** implement protections against data leaks; **PR.DS-P6** integrity-checking mechanisms verify software/firmware/information integrity; **PR.DS-P7** development/testing environments separate from production; **PR.DS-P8** integrity-checking mechanisms verify hardware integrity.
- **In code:** AES-256 at rest (Supabase/Fly/R2 default + column-level for sensitive fields) and TLS 1.2+ in transit everywhere (PR.DS-P1/P2); secure-disposal procedures for decommissioned volumes/buckets and transfers (PR.DS-P3); DLP/egress controls and secret-scanning to prevent leaks (PR.DS-P5); separate prod vs preview/staging projects and branches (PR.DS-P7); checksums/signatures + SRI on shipped assets and dependency integrity (lockfile, signed releases) for PR.DS-P6. PR.DS-P4 = autoscaling/capacity monitoring; PR.DS-P8 hardware integrity inherited from providers.
- **Primitive:** 1. Encryption (TLS+AES, key mgmt)
- **Cite:** §A / Table 2 — PR.DS-P1…P8

### PR.MA-P — Maintenance (PROTECT-P)
- **Requires:** Perform system maintenance/repairs consistent with policy. **PR.MA-P1** maintenance and repair of assets performed and logged with approved/controlled tools; **PR.MA-P2** remote maintenance approved, logged, and performed to prevent unauthorized access.
- **In code:** Route all maintenance through audited, logged channels — no unlogged prod DB edits; migrations via PR + CI with an audit trail (PR.MA-P1); admin/console actions require MFA and are recorded (PR.MA-P2). Ties to the immutable audit log.
- **Primitive:** 6. Immutable audit logging
- **Cite:** §A / Table 2 — PR.MA-P1…P2

### PR.PT-P — Protective Technology (PROTECT-P)
- **Requires:** Manage technical security solutions for resilience of systems and data. **PR.PT-P1** protect and restrict removable media per policy; **PR.PT-P2** incorporate least functionality (only essential capabilities); **PR.PT-P3** protect communications and control networks; **PR.PT-P4** implement mechanisms (failsafe, load balancing, hot swap) to achieve resilience in normal and adverse situations.
- **In code:** Minimal container images / disabled unused services and ports (PR.PT-P2 least functionality); WAF + TLS + private networking on Cloudflare/Fly (PR.PT-P3); load balancing, health checks, and multi-region/hot-standby for resilience (PR.PT-P4). PR.PT-P1 removable media largely N/A on managed infra — document the exclusion.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege (least functionality / network protection)
- **Cite:** §A / Table 2 — PR.PT-P1…P4

## Evidence to retain
- **Current & Target Profiles** — the selected subcategories with implementation status and prioritized gap list (the framework's expected artifact for demonstrating program maturity).
- **Implementation Tier** statement (1–4) and the GV.RM-P risk-tolerance rationale.
- **Data inventory + data map** (ID.IM-P): systems, owners, individual categories, data actions, purposes, elements, environment/residency — version-controlled and dated.
- **Sub-processor / ecosystem register** (ID.DE-P) with contract type (DPA/BAA), assessment date, and latest vendor attestation.
- **PIAs/DPIAs** per risky feature (ID.RA-P / CT.DM-P9) with likelihood × impact scoring and chosen risk responses.
- **Consent & preference records** (CT.PO-P/CM.PO-P): timestamped, granular, withdrawable; GPC-honoring logs.
- **DSAR logs** (CT.DM-P1–P4): requests received, fulfilled, timestamps, and propagation to sub-processors.
- **Disclosure/sharing records, provenance & lineage** (CM.AW-P4/P6).
- **Audit logs** of access to and maintenance of regulated data (CT.DM-P8, PR.MA-P), tamper-resistant and retained.
- **Backup + restore test results** and **IR/DR plan + exercise records** (PR.PO-P3/P7/P8).
- **Breach/event notifications** issued to individuals and partners (CM.AW-P7) and remediation offered (CM.AW-P8).
- **Crosswalk mapping** of these subcategories to the laws you are subject to (GDPR/CPRA/PIPEDA/Law 25), showing reuse of the 9 unified primitives — the artifact that proves the privacy program is grounded, not ad hoc.

# HIPAA Security / Privacy / Breach Rules — requirements checklist
> Source: https://www.hhs.gov/hipaa/for-professionals/ · 45 CFR Part 164 subparts C (Security §§164.302–318), E (Privacy §§164.500–534), D (Breach §§164.400–414), via eCFR / Cornell LII mirror · retrieved 2026-06-20 · US federal regulation, public domain (HHS / Office for Civil Rights). Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- You **create, receive, maintain, or transmit electronic Protected Health Information (ePHI)** for a HIPAA Covered Entity (health provider, plan, or clearinghouse). As a SaaS handling that data you are almost always a **Business Associate (BA)** and are directly liable for the Security Rule, the BA-applicable parts of the Privacy Rule, and the Breach Rule. **No size or revenue threshold.**
- A signed **Business Associate Agreement (BAA)** must be in place **before any PHI flows** — both upstream (covered entity → you) and downstream (you → every sub-processor that touches PHI: Supabase, Fly, Cloudflare, Vercel, email/SMS, error trackers, analytics, LLM APIs). If a vendor won't sign a BAA, PHI must not reach it.
- "Required" specs must be implemented as written. "Addressable" specs are **not optional** — you must assess them and either implement, implement an equivalent alternative, or document why neither is reasonable/appropriate (§164.306(d)(3)).
- PHI is **"unsecured"** unless rendered unusable/unreadable per HHS guidance (encryption or destruction). Securing PHI this way unlocks the breach-notification **safe harbor** — encrypted-data exposure is generally not a reportable breach (§164.402; §164.404(a)).

## Requirements

### General rules (§164.306)
- **Requires:** Ensure confidentiality, integrity, availability of all ePHI; protect against reasonably anticipated threats and impermissible uses/disclosures; ensure workforce compliance (§164.306(a)). Flexibility of approach — scale measures to size, complexity, cost, and risk (§164.306(b)). Comply with all standards in §§164.308–316 (§164.306(c)). Treat addressable specs as assess-then-implement-or-document-alternative (§164.306(d)). Review and modify measures continually (§164.306(e)).
- **In code:** Anchor the whole control set to a documented risk analysis; record every addressable decision (implement / alternative / not-reasonable) in DECISIONS.md with rationale. Re-evaluate on each new data flow or infra change.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** §164.306(a)–(e)

---

### §164.308(a)(1) — Security Management Process
- **Requires:** Policies/procedures to prevent, detect, contain, correct security violations. Specs: **Risk Analysis** (R) §164.308(a)(1)(ii)(A) — assess risks/vulnerabilities to ePHI; **Risk Management** (R) §164.308(a)(1)(ii)(B) — reduce risk to reasonable levels; **Sanction Policy** (R) §164.308(a)(1)(ii)(C) — discipline workforce violators; **Information System Activity Review** (R) §164.308(a)(1)(ii)(D) — regularly review audit logs, access reports, incident tracking.
- **In code:** Maintain a written risk register over the PHI inventory; remediation backlog tied to it. Documented sanction policy. Scheduled review of Supabase/Cloudflare/Fly logs + DB access logs (the audit-log primitive feeds activity review).
- **Primitive:** 4. Data inventory + sensitive-field tagging (risk analysis); 6. Immutable audit logging (activity review)
- **Cite:** §164.308(a)(1)

### §164.308(a)(2) — Assigned Security Responsibility
- **Requires:** Identify the security official responsible for developing/implementing the security policies and procedures.
- **In code:** Name a Security Official (the founder for a solo team) in the security policy doc; record in the spine.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege (ownership/accountability)
- **Cite:** §164.308(a)(2)

### §164.308(a)(3) — Workforce Security
- **Requires:** Ensure workforce members have appropriate ePHI access and prevent those without authorization from getting it. Specs: **Authorization and/or Supervision** (A) (a)(3)(ii)(A); **Workforce Clearance Procedure** (A) (a)(3)(ii)(B) — verify access is appropriate; **Termination Procedures** (A) (a)(3)(ii)(C) — revoke access on departure.
- **In code:** RBAC roles mapped to job function; least-privilege grants; documented onboarding/offboarding checklist that revokes Supabase/Fly/Cloudflare/repo/SSO access immediately on termination.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** §164.308(a)(3)

### §164.308(a)(4) — Information Access Management
- **Requires:** Policies for authorizing access to ePHI consistent with the Privacy Rule. Specs: **Isolating Health Care Clearinghouse Functions** (R) (a)(4)(ii)(A) — only if clearinghouse functions exist; **Access Authorization** (A) (a)(4)(ii)(B) — grant access via workstation/transaction/program/process; **Access Establishment and Modification** (A) (a)(4)(ii)(C) — establish, document, review, modify access rights.
- **In code:** Postgres RLS enforcing per-tenant/per-user PHI isolation; documented access-grant workflow; periodic access reviews. Implement minimum-necessary at the query/policy layer.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** §164.308(a)(4)

### §164.308(a)(5) — Security Awareness and Training
- **Requires:** A security awareness/training program for all workforce including management. Specs: **Security Reminders** (A) (a)(5)(ii)(A); **Protection from Malicious Software** (A) (a)(5)(ii)(B); **Log-in Monitoring** (A) (a)(5)(ii)(C) — monitor login attempts/report discrepancies; **Password Management** (A) (a)(5)(ii)(D) — create, change, safeguard passwords.
- **In code:** Documented training (even for a solo team, a recorded annual self-attestation); endpoint anti-malware; failed-login monitoring + alerting (Supabase Auth / SSO logs); password policy + secret manager (no shared/static creds).
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege (login monitoring, password mgmt); 6. Immutable audit logging
- **Cite:** §164.308(a)(5)

### §164.308(a)(6) — Security Incident Procedures
- **Requires:** Policies/procedures to address security incidents. Spec: **Response and Reporting** (R) (a)(6)(ii) — identify, respond to, mitigate, and document incidents and outcomes.
- **In code:** Written IR runbook (detect → log → triage → mitigate → document); incident log retained; ties into the breach-decision flow (§164.402 four-factor assessment).
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** §164.308(a)(6)

### §164.308(a)(7) — Contingency Plan
- **Requires:** Procedures for responding to emergencies that damage ePHI systems. Specs: **Data Backup Plan** (R) (a)(7)(ii)(A) — retrievable exact copies of ePHI; **Disaster Recovery Plan** (R) (a)(7)(ii)(B) — restore lost data; **Emergency Mode Operation Plan** (R) (a)(7)(ii)(C) — continue critical processes while protecting ePHI; **Testing and Revision Procedures** (A) (a)(7)(ii)(D); **Applications and Data Criticality Analysis** (A) (a)(7)(ii)(E).
- **In code:** Supabase/Postgres automated backups (PITR) + periodic restore tests; documented DR runbook with RTO/RPO; backups encrypted; criticality ranking of services/data.
- **Primitive:** 7. Retention + deletion jobs (backup lifecycle); 1. Encryption (backup encryption)
- **Cite:** §164.308(a)(7)

### §164.308(a)(8) — Evaluation
- **Requires:** Periodic technical and nontechnical evaluation of how well security measures meet the Security Rule, in response to environmental/operational change.
- **In code:** Scheduled (at least annual + on major change) security re-assessment; record results. Reuse the security-loop / `/secure` output as evidence.
- **Primitive:** 4. Data inventory + sensitive-field tagging (re-scoping); 8. Incident-response (program review)
- **Cite:** §164.308(a)(8)

### §164.308(b) — Business Associate Contracts and Other Arrangements
- **Requires:** Obtain satisfactory assurances (per §164.314(a)) before a BA/sub-processor handles ePHI; flows down to subcontractors. Spec: **Written Contract or Other Arrangement** (R) §164.308(b)(3).
- **In code:** Signed BAA with every sub-processor touching PHI before routing data; maintain the register (Supabase, Fly, Cloudflare, Vercel, email, SMS, LLM, error/analytics each need a BAA or must be kept PHI-free).
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** §164.308(b)

---

### §164.310(a) — Facility Access Controls
- **Requires:** Limit physical access to systems and the facilities housing them. Specs: **Contingency Operations** (A) (a)(2)(i); **Facility Security Plan** (A) (a)(2)(ii); **Access Control and Validation Procedures** (A) (a)(2)(iii); **Maintenance Records** (A) (a)(2)(iv).
- **In code:** On managed infra this is largely **inherited from the cloud provider** — capture it via the provider's BAA + their SOC 2 / data-center attestations in the vendor register; document the inheritance. For any local workstation, basic physical security.
- **Primitive:** 9. Vendor/sub-processor register (inherited physical controls)
- **Cite:** §164.310(a)

### §164.310(b) — Workstation Use
- **Requires:** Policies specifying proper functions, manner, and physical surroundings of workstations that access ePHI.
- **In code:** Workstation-use policy (full-disk encryption, screen lock, no PHI on personal/unmanaged devices, secure network).
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** §164.310(b)

### §164.310(c) — Workstation Security
- **Requires:** Physical safeguards for all workstations accessing ePHI, restricting access to authorized users.
- **In code:** Device inventory; disk encryption (FileVault/BitLocker); auto-lock; MDM where feasible.
- **Primitive:** 1. Encryption (at-rest on endpoints); 5. Access control
- **Cite:** §164.310(c)

### §164.310(d) — Device and Media Controls
- **Requires:** Govern receipt/removal of hardware and media containing ePHI. Specs: **Disposal** (R) (d)(2)(i) — secure final disposition; **Media Re-use** (R) (d)(2)(ii) — remove ePHI before reuse; **Accountability** (A) (d)(2)(iii) — track media movement and responsible person; **Data Backup and Storage** (A) (d)(2)(iv) — retrievable copy before moving equipment.
- **In code:** Provider handles drive disposal/sanitization (inherited via BAA + attestation); for any local media, cryptographic erase / certified wipe; record disposal events.
- **Primitive:** 7. Retention + deletion jobs (secure disposal); 9. Vendor register (inherited)
- **Cite:** §164.310(d)

---

### §164.312(a) — Access Control (technical)
- **Requires:** Technical policies limiting ePHI access to authorized persons/software. Specs: **Unique User Identification** (R) (a)(2)(i) — unique name/number per user; **Emergency Access Procedure** (R) (a)(2)(ii) — obtain ePHI during emergencies; **Automatic Logoff** (A) (a)(2)(iii) — terminate session after inactivity; **Encryption and Decryption** (A) (a)(2)(iv) — encrypt/decrypt ePHI at rest.
- **In code:** Unique accounts (no shared logins) via Supabase Auth/SSO; break-glass emergency-access role that is logged; idle session timeout; AES-256 at-rest encryption on Postgres/storage (also feeds the breach safe harbor).
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege; 1. Encryption (at rest)
- **Cite:** §164.312(a)

### §164.312(b) — Audit Controls
- **Requires:** Hardware/software/procedural mechanisms that record and examine activity in systems containing ePHI.
- **In code:** Immutable, append-only audit log of who-accessed/modified-which-PHI (DB triggers / Supabase audit + centralized log sink); tamper-resistant retention; reviewed under §164.308(a)(1)(ii)(D).
- **Primitive:** 6. Immutable audit logging
- **Cite:** §164.312(b)

### §164.312(c) — Integrity
- **Requires:** Protect ePHI from improper alteration/destruction. Spec: **Mechanism to Authenticate ePHI** (A) (c)(2) — verify ePHI hasn't been altered/destroyed without authorization.
- **In code:** Checksums/hashing or DB-level integrity constraints + version history; write-once audit trail; backups to detect/recover from tampering.
- **Primitive:** 6. Immutable audit logging; 1. Encryption (integrity/hashing)
- **Cite:** §164.312(c)

### §164.312(d) — Person or Entity Authentication
- **Requires:** Verify that a person/entity seeking ePHI access is who they claim to be.
- **In code:** Strong auth + **MFA** for all human access; service-to-service auth via scoped tokens/mTLS; no anonymous PHI access paths.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** §164.312(d)

### §164.312(e) — Transmission Security
- **Requires:** Guard ePHI against unauthorized access during electronic transmission. Specs: **Integrity Controls** (A) (e)(2)(i) — ensure transmitted ePHI isn't improperly modified; **Encryption** (A) (e)(2)(ii) — encrypt ePHI in transit when appropriate.
- **In code:** TLS 1.2+ everywhere (enforce HSTS, disable plaintext); encrypted DB connections; encrypted webhooks/queues; reject downgraded transport.
- **Primitive:** 1. Encryption (TLS in transit)
- **Cite:** §164.312(e)

---

### §164.314(a) — Organizational: Business Associate Contracts
- **Requires:** The BAA must require the BA to comply with the Security Rule, ensure subcontractors handling ePHI agree to the same protections, and **report security incidents and breaches of unsecured PHI (per §164.410)** to the covered entity. Subcontractor contracts carry the same terms (§164.314(a)(2)(iii)).
- **In code:** Use BAA language covering these clauses; flow-down BAAs to every sub-processor; wire an incident-reporting channel to the covered entity into the IR runbook.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA); 8. Incident-response (reporting obligation)
- **Cite:** §164.314(a)

### §164.314(b) — Organizational: Group Health Plan Requirements
- **Requires:** Group health plan documents must require the plan sponsor to implement admin/physical/technical safeguards, support adequate separation, bind agents, and report incidents. (Applies only if serving a group health plan / plan sponsor.)
- **In code:** Only relevant if your customer is a group health plan — reflect the safeguard + separation + incident-reporting obligations in plan-document language.
- **Primitive:** 9. Vendor/sub-processor register; 5. Access control (separation)
- **Cite:** §164.314(b)

### §164.316(a) — Policies and Procedures
- **Requires:** Implement reasonable and appropriate written policies/procedures to comply with the Security Rule; may change them as long as changes are documented.
- **In code:** Maintain a versioned security policy set (access control, IR, contingency, sanctions, training) in the repo/spine.
- **Primitive:** 4. Data inventory + sensitive-field tagging (program documentation)
- **Cite:** §164.316(a)

### §164.316(b) — Documentation
- **Requires:** Keep policies/procedures and required records in written (may be electronic) form. Specs: **Time Limit** (R) (b)(2)(i) — retain 6 years from creation or last-effective date, whichever is later; **Availability** (R) (b)(2)(ii) — make docs available to those implementing them; **Updates** (R) (b)(2)(iii) — review periodically and update on environmental/operational change.
- **In code:** 6-year retention policy on security docs, risk analyses, audit logs, BAAs, IR records, addressable-spec decisions; store in durable encrypted storage with the deletion job excluding compliance records until the 6-year clock expires.
- **Primitive:** 7. Retention + deletion jobs (6-year doc retention)
- **Cite:** §164.316(b)

---

### Privacy Rule — Minimum Necessary (§164.502(b), §164.514(d))
- **Requires:** Make reasonable efforts to limit PHI use/disclosure/request to the **minimum necessary** for the purpose (exceptions: treatment, to the individual, per authorization, required by law).
- **In code:** RLS/RBAC + column-level scoping so each role/query sees only the PHI fields it needs; minimal PHI in API responses, logs, analytics, and LLM prompts; sensitive-field tagging drives what is exposed.
- **Primitive:** 4. Data inventory + sensitive-field tagging; 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** §164.502(b)

### Privacy Rule — Disclosures to Business Associates (§164.502(e))
- **Requires:** A covered entity may disclose PHI to a BA only with satisfactory assurance (written contract per §164.504(e)) that the BA will safeguard it; the BA may use/disclose PHI only as the contract and Rule permit.
- **In code:** Mirror of §164.308(b)/§164.314(a) — BAA before any PHI flow, with use/disclosure limits enforced contractually and in access policy.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** §164.502(e)

### Privacy Rule — Individual Right of Access (§164.524)
- **Requires:** Individuals may inspect and obtain a copy of PHI in the designated record set (§164.524(a)). Provide in the **form and format requested if readily producible**, including an **electronic copy** of electronically held PHI (§164.524(c)(2)). Act within **30 days**, with one **30-day extension** on written notice (§164.524(b)(2)). Fees limited to **reasonable, cost-based** (labor for copying, supplies, postage, agreed summaries) (§164.524(c)(4)). (As a BA you support the covered entity's response per the BAA.)
- **In code:** DSAR/export engine that produces a complete, machine-readable copy of a patient's PHI across DB + backups + sub-processors within the 30/30-day clock; cost-based fee logic; route requests through the covered-entity workflow defined in the BAA.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** §164.524

---

### Breach Rule — Definition & Risk Assessment (§164.402)
- **Requires:** A breach is impermissible acquisition/access/use/disclosure of unsecured PHI. Three exclusions (good-faith unintentional workforce access; inadvertent disclosure between authorized persons; disclosure where recipient couldn't reasonably retain it). Otherwise **presumed a breach** unless a **four-factor risk assessment** shows low probability of compromise: (1) nature/extent of PHI incl. re-identification, (2) the unauthorized recipient, (3) whether PHI was actually acquired/viewed, (4) mitigation. **Unsecured PHI** = not encrypted/destroyed per HHS guidance → encryption is the safe harbor.
- **In code:** Documented four-factor assessment template in the IR pipeline; data inventory feeds factor (1); at-rest + in-transit encryption removes most events from "unsecured" → no notice required.
- **Primitive:** 8. Incident-response + breach pipeline; 1. Encryption (safe harbor); 4. Data inventory (scope/factor-1)
- **Cite:** §164.402

### Breach Rule — Notification to Individuals (§164.404)
- **Requires:** Notify each affected individual **without unreasonable delay, no later than 60 calendar days after discovery** (§164.404(a),(b)). Content (§164.404(c)): what happened + dates, types of PHI involved, steps individuals should take, what the entity is doing/mitigation, contact procedures — in plain language. Methods (§164.404(d)): written first-class mail or email (with consent); substitute notice if contact info insufficient (web/major-media + toll-free for 10+, alt written for <10); telephone for urgent/imminent-misuse cases.
- **In code:** Breach pipeline parameterized to the **60-day HIPAA clock**; templated notice content; mail/email dispatch + substitute-notice path; discovery-date timestamp captured at detection.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** §164.404

### Breach Rule — Notification to the Media (§164.406)
- **Requires:** If a breach affects **more than 500 residents of a State/jurisdiction**, notify prominent media outlets serving that area, within the same **60-day** window, with the §164.404(c) content.
- **In code:** Threshold check in the pipeline (count affected per state); 500+ triggers media-notification task with the standard content; covered entity typically issues, BA supports.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** §164.406

### Breach Rule — Notification to HHS Secretary (§164.408)
- **Requires:** Notify HHS via the OCR portal. **500+ individuals:** contemporaneously with individual notice and **no later than 60 days** (§164.408(b)). **Fewer than 500:** maintain a log and submit to HHS **annually, within 60 days after the end of the calendar year** (§164.408(c)).
- **In code:** Maintain a breach log/register; pipeline branches on the 500 threshold — immediate OCR submission vs. annual roll-up; generate the annual report from the log.
- **Primitive:** 8. Incident-response + breach pipeline; 6. Immutable audit logging (breach log)
- **Cite:** §164.408

### Breach Rule — Notification by a Business Associate (§164.410)
- **Requires:** A BA must notify the affected covered entity of a breach **without unreasonable delay, no later than 60 days after discovery** (§164.410(a),(b)); include identification of each affected individual and other §164.404(c) info available, then as it emerges (§164.410(c)).
- **In code:** As a BA, your primary obligation: automated notification to the covered entity (channel + SLA defined in the BAA) with affected-individual list; BAA may impose a tighter clock than 60 days — honor the contractual one.
- **Primitive:** 8. Incident-response + breach pipeline; 9. Vendor register (notification channel per BAA)
- **Cite:** §164.410

### Breach Rule — Burden of Proof & Administrative Requirements (§164.414)
- **Requires:** §164.530 administrative requirements apply (§164.414(a)). The covered entity / BA bears the **burden of demonstrating** that all required notifications were made, or that an impermissible use/disclosure was not a breach (§164.414(b)).
- **In code:** Retain evidence of every notification (timestamps, recipients, content) and every "not a breach" four-factor determination for **6 years** (§164.316(b)(2)(i)); make the breach log auditable.
- **Primitive:** 6. Immutable audit logging; 7. Retention + deletion jobs (6-year evidence)
- **Cite:** §164.414

## Evidence to retain
Auditors (HHS OCR) and customers' BAA audits expect, retained **6 years** (§164.316(b)(2)(i)):
- **Risk analysis** documentation + risk-management/remediation plan + the ePHI data inventory (§164.308(a)(1)).
- **Written policies/procedures**: security mgmt, sanctions, workforce security, access management, training, IR, contingency/DR, device & media (§164.316).
- **Documented addressable-spec decisions** (implemented / alternative / not-reasonable + rationale) (§164.306(d)(3)).
- **Access-control evidence**: unique-ID/no-shared-accounts proof, RLS/RBAC config, MFA enforcement, access-review records, onboarding/offboarding logs.
- **Audit-log samples** + proof of periodic information-system-activity review (§164.308(a)(1)(ii)(D), §164.312(b)).
- **Encryption evidence**: TLS config, at-rest encryption config, key management (establishes unsecured-PHI safe harbor).
- **Training records / workforce attestations**; sanction-policy enforcement records.
- **Contingency**: backup configuration + successful **restore-test** records, DR runbook, criticality analysis.
- **Periodic evaluation** reports (§164.308(a)(8)).
- **Signed BAAs** with the covered entity and every PHI-touching sub-processor; the vendor/sub-processor register (§164.308(b), §164.314(a)).
- **Incident & breach records**: IR log, four-factor breach risk assessments, individual/media/HHS notification copies with dates, the <500 breach log + annual HHS submissions, and proof supporting the §164.414(b) burden.
- **DSAR/access records**: individual access requests and fulfillment within the 30/30-day window (§164.524).

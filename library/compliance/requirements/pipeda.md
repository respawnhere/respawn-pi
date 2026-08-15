# PIPEDA — Personal Information Protection and Electronic Documents Act (Canada) — requirements checklist
> Source: https://laws-lois.justice.gc.ca/eng/acts/P-8.6/ · https://laws-lois.justice.gc.ca/eng/regulations/SOR-2018-64/ · https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/ · S.C. 2000, c. 5 / Breach of Security Safeguards Regulations SOR/2018-64 · retrieved 2026-06-22 · Canada (federal), Crown copyright — reproducible under the Reproduction of Federal Law Order. Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- You are an **organization** that collects, uses, or discloses **personal information** in the course of **commercial activity** in Canada. No size, revenue, or volume threshold — a solo SaaS handling any Canadian customer/user personal data is directly in scope.
- Applies to federal works/undertakings and to the private sector in provinces **without** substantially-similar legislation. Where a province has "substantially similar" provincial private-sector law, that law **displaces** PIPEDA for intra-provincial activity: **Alberta** (PIPA), **British Columbia** (PIPA), **Quebec** (Law 25 / the Private Sector Act). PIPEDA still governs **cross-border and inter-provincial** flows and federally-regulated businesses even in those provinces. Health-information statutes (e.g. Ontario PHIPA) may also be deemed substantially similar for that sector.
- As a SaaS you are usually the entity "in control" of the personal information; PIPEDA has no separate "processor" tier — an organization remains accountable for information transferred to a third party for processing (Principle 1, clause 4.1.3). Your managed-infra vendors (Supabase / Fly / Cloudflare / Vercel / Postgres host) are such third parties and must be bound by contract (see primitive 9).
- **Mandatory breach reporting, notification, and record-keeping** (Division 1.1, ss. 10.1–10.3 + SOR/2018-64) have been **in force since 1 November 2018**.
- **Status of reform:** Bill C-27 (which proposed the Consumer Privacy Protection Act / CPPA with administrative monetary penalties) **died on the Order Paper** and is **not in force**. PIPEDA as consolidated remains the governing federal statute. Re-introduced reform bills are not law until enacted — verify current status before relying on CPPA mechanics.
- Cross-border transfers, DPIAs/PIAs, and consent-model design for sensitive or automated-decision processing warrant **privacy counsel / a designated accountability officer** sign-off.

## Requirements

### Principle 1 — Accountability (Schedule 1, clause 4.1)
- **Requires:** Designate an individual accountable for compliance; remain responsible for personal information in your control, including information transferred to third parties for processing; implement policies and practices to give effect to the principles, and make the designated person's identity available on request.
- **In code:** Name a privacy/accountability owner in `SECURITY.md` / governance docs. Maintain the vendor / sub-processor register (primitive 9) with DPAs that contractually require comparable protection from Supabase, Fly, Cloudflare, Vercel, and your Postgres host. Maintain the data inventory (primitive 4) as the system of record for "what we hold and where."
- **Primitive:** 4 (Data inventory + sensitive-field tagging); 9 (Vendor / sub-processor register).
- **Cite:** Schedule 1, clause 4.1 (esp. 4.1.1, 4.1.3, 4.1.4).

### Principle 2 — Identifying Purposes (Schedule 1, clause 4.2)
- **Requires:** Identify the purposes for which personal information is collected at or before the time of collection; document those purposes; identify new purposes before use.
- **In code:** Tag each collected field in the data inventory with its declared purpose (primitive 4). Surface purposes at the point of collection through the consent/preference store (primitive 3); gate any new-purpose use behind a fresh consent record.
- **Primitive:** 4 (Data inventory + sensitive-field tagging); 3 (Consent + preference store).
- **Cite:** Schedule 1, clause 4.2 (esp. 4.2.1, 4.2.3, 4.2.5).

### Principle 3 — Consent (Schedule 1, clause 4.3; s. 6.1)
- **Requires:** Knowledge and consent of the individual for collection, use, or disclosure (with limited statutory exceptions). Consent form should reflect the sensitivity of the information; an individual may **withdraw consent** at any time, subject to legal/contractual restrictions, on reasonable notice. **Section 6.1:** consent is valid only if it is reasonable to expect that the individual would understand the **nature, purpose and consequences** of the collection, use, or disclosure they are consenting to ("meaningful consent").
- **In code:** Implement the granular, timestamped, withdrawable consent + preference store (primitive 3) — record what was consented to, when, the version of the notice shown, and the basis. Provide a self-serve withdrawal path that propagates to downstream processing. Honor browser signals (GPC) where applicable. Use sensitivity tags (primitive 4) to require express/opt-in consent for sensitive fields.
- **Primitive:** 3 (Consent + preference store).
- **Cite:** Schedule 1, clause 4.3 (esp. 4.3.2, 4.3.4, 4.3.5, 4.3.8); s. 6.1.

### Principle 4 — Limiting Collection (Schedule 1, clause 4.4)
- **Requires:** Limit collection to what is necessary for the identified purposes; collect by fair and lawful means; do not collect indiscriminately.
- **In code:** Enforce data minimization in schema and API contracts — collect only inventoried, purpose-tagged fields (primitive 4). Default forms and event capture to the minimum; gate optional fields behind explicit purpose + consent.
- **Primitive:** 4 (Data inventory + sensitive-field tagging).
- **Cite:** Schedule 1, clause 4.4 (esp. 4.4.1, 4.4.2).

### Principle 5 — Limiting Use, Disclosure, and Retention (Schedule 1, clause 4.5)
- **Requires:** Do not use or disclose personal information for purposes other than those for which it was collected, except with consent or as required by law; **retain only as long as necessary** to fulfil the purposes; develop guidelines and implement procedures with **minimum and maximum retention periods**; destroy, erase, or anonymize information no longer required.
- **In code:** Run scheduled retention + deletion jobs (primitive 7) keyed to per-field/per-purpose retention rules in the data inventory. Implement secure deletion/anonymization (truncate, crypto-shred, or anonymize) and log each run to the audit trail (primitive 6). Restrict use to declared purposes via RLS/RBAC (primitive 5).
- **Primitive:** 7 (Retention + deletion jobs); 5 (Access control); 6 (Immutable audit logging).
- **Cite:** Schedule 1, clause 4.5 (esp. 4.5.2, 4.5.3).

### Principle 6 — Accuracy (Schedule 1, clause 4.6)
- **Requires:** Keep personal information as accurate, complete, and up-to-date as necessary for the purposes for which it is to be used; minimize the possibility of using incorrect information when making a decision about the individual.
- **In code:** Expose correction/update endpoints feeding the DSAR engine (primitive 2). Propagate corrections to derived/cached copies and downstream sub-processors; log corrections to the audit trail (primitive 6).
- **Primitive:** 1 (covers integrity controls — see Safeguards); 2 (DSAR engine — correction); 6 (Immutable audit logging).
- **Cite:** Schedule 1, clause 4.6 (esp. 4.6.1, 4.6.2).

### Principle 7 — Safeguards (Schedule 1, clause 4.7)
- **Requires:** Protect personal information with security safeguards appropriate to its sensitivity, against loss/theft and unauthorized access, disclosure, copying, use, or modification — regardless of format. Methods include **physical, organizational, and technological** measures. Higher sensitivity demands higher protection. Care in disposal/destruction to prevent unauthorized access.
- **In code:** Encryption in transit (TLS 1.2+) and at rest (AES-256) with managed key handling (primitive 1) — the same control satisfies GDPR Art. 32 and HIPAA Security Rule encryption expectations. Postgres RLS, Supabase Auth + MFA, RBAC and least-privilege roles, Cloudflare/WAF at the edge (primitive 5). Immutable audit logging of access to sensitive data (primitive 6). Secure-disposal path shared with the retention jobs (primitive 7). Security CI — SBOM, gitleaks secret scanning, and dependency audit in `templates/ci/security.yml` (shared control with NIS2/CRA supply-chain expectations).
- **Primitive:** 1 (Encryption); 5 (Access control — RLS / RBAC / MFA / least-privilege); 6 (Immutable audit logging).
- **Cite:** Schedule 1, clause 4.7 (esp. 4.7.1, 4.7.2, 4.7.3, 4.7.5).

### Principle 8 — Openness (Schedule 1, clause 4.8)
- **Requires:** Make readily available, in an understandable form, specific information about your policies and practices for managing personal information — including the name/title and contact of the accountability person, the means of access, a description of the type of information held and its general use, and any third parties to which information may be made available.
- **In code:** Publish a public privacy notice covering the above; keep it version-tracked and link the version ID into consent records (primitive 3). Source the "type of information held and general use" and "third parties" sections from the data inventory and vendor register (primitives 4 and 9).
- **Primitive:** 4 (Data inventory + sensitive-field tagging); 9 (Vendor / sub-processor register).
- **Cite:** Schedule 1, clause 4.8 (esp. 4.8.1, 4.8.2).

### Principle 9 — Individual Access (Schedule 1, clause 4.9)
- **Requires:** On request, inform an individual of the existence, use, and disclosure of their personal information and give access to it; allow the individual to **challenge accuracy and completeness** and have it amended. Respond within a reasonable time and generally at minimal or no cost; provide an account of third parties to which information has been disclosed where practicable. Exceptions (e.g. solicitor-client privilege, others' information) must be applied per the Act.
- **In code:** Implement the DSAR engine (primitive 2) for access, export (machine-readable), and correction; resolve the requester's data across the inventory and sub-processors (primitives 4, 9). Track request receipt and response deadlines; log fulfilment to the audit trail (primitive 6). This control also satisfies GDPR Arts. 15/16/20 access/rectification/portability.
- **Primitive:** 2 (DSAR engine — access / correct / export).
- **Cite:** Schedule 1, clause 4.9 (esp. 4.9.1, 4.9.4, 4.9.5).

### Principle 10 — Challenging Compliance (Schedule 1, clause 4.10)
- **Requires:** Provide a way for an individual to address a challenge concerning compliance to the designated accountability person; maintain complaint-handling procedures that are simple and easily accessible; investigate all complaints received and take appropriate measures, including amending policies and practices, if a complaint is found justified.
- **In code:** Provide a documented complaints intake (email/form) routed to the accountability owner; record complaints, investigations, and outcomes in an auditable log (primitive 6). Feed remediation back into policies and the data inventory.
- **Primitive:** 6 (Immutable audit logging); 8 (Incident-response + breach pipeline — complaint-to-remediation workflow).
- **Cite:** Schedule 1, clause 4.10 (esp. 4.10.1, 4.10.2, 4.10.3, 4.10.4).

### s. 10.1 — Report and notification of a breach of security safeguards (RROSH)
- **Requires:** Where a breach of security safeguards involving personal information under your control creates a **real risk of significant harm** (RROSH) to an individual, **report to the Privacy Commissioner** (s. 10.1(1)) and **notify the affected individual** (s. 10.1(3)) — as soon as feasible after determining the breach occurred. "Significant harm" includes bodily harm, humiliation, reputational/relationship damage, loss of employment or business/professional opportunities, financial loss, identity theft, negative credit effects, and property loss/damage (s. 10.1(7)). RROSH is assessed on the **sensitivity** of the information and the **probability of misuse** (s. 10.1(8)). Report content and notification manner/content are prescribed in **SOR/2018-64 ss. 2–5** (direct notification in person/telephone/mail/email; indirect notification only where permitted).
- **In code:** Run the incident-response + breach pipeline (primitive 8): detect, triage, perform and document the RROSH assessment, and trigger OPC report + individual notification with the SOR-prescribed content. Pull affected-individual scope and field sensitivity from the data inventory (primitive 4) and contact data via the DSAR/identity layer. RROSH determination should have privacy-counsel sign-off.
- **Primitive:** 8 (Incident-response + breach pipeline).
- **Cite:** s. 10.1(1), (2), (3), (6), (7), (8); SOR/2018-64 ss. 2, 3, 4, 5.

### s. 10.2 — Notification to other organizations / government institutions
- **Requires:** An organization that notifies an individual under s. 10.1(3) must also notify any **other organization or government institution** that may be able to reduce the risk of harm or mitigate the harm (e.g. payment processors, law enforcement, affected sub-processors).
- **In code:** Maintain a notification routing list in the breach pipeline (primitive 8) cross-referenced to the vendor / sub-processor register (primitive 9) so downstream parties are notified; record each notification in the breach record (primitive 6).
- **Primitive:** 8 (Incident-response + breach pipeline); 9 (Vendor / sub-processor register).
- **Cite:** s. 10.2(1).

### s. 10.3 — Records of every breach (24-month retention)
- **Requires:** Keep and maintain a record of **every** breach of security safeguards involving personal information under your control — **not only** RROSH/reportable breaches. SOR/2018-64 s. 6(1) requires each record be kept for **24 months after the day the organization determines the breach occurred**; the record must contain information enabling the Commissioner to verify compliance with s. 10.1(1) and (3) — including the RROSH assessment and, for unreported breaches, why the threshold was not met (s. 6(2)).
- **In code:** Persist every breach (and near-miss meeting the definition) to an **immutable, append-only breach log** (primitive 6) capturing the RROSH analysis, decision, and any reporting/notification actions; set a 24-month minimum retention in the retention jobs (primitive 7) and protect these records from the deletion sweep until the period elapses.
- **Primitive:** 6 (Immutable audit logging); 8 (Incident-response + breach pipeline); 7 (Retention + deletion jobs).
- **Cite:** s. 10.3(1); SOR/2018-64 s. 6.

### s. 28 — Offence (knowing breach-reporting failures)
- **Requires:** It is an **offence** to knowingly contravene s. 10.1 (report/notify) or s. 10.3(1) (keep/maintain breach records), or to obstruct the Commissioner. Penalties: up to **$100,000** on indictment, up to **$10,000** on summary conviction. This makes the breach pipeline and 24-month breach log non-optional controls, not best practice.
- **In code:** Ensure the breach pipeline (primitive 8) and immutable breach log (primitive 6) are operational and tested before launch; treat a missing breach record as a compliance failure surfaced in `/comply` checks.
- **Primitive:** 8 (Incident-response + breach pipeline); 6 (Immutable audit logging).
- **Cite:** s. 28; s. 10.1; s. 10.3(1).

## Evidence to retain
- **Accountability:** name/title and contact of the designated privacy-accountability individual; internal privacy policies and procedures; staff awareness records (clause 4.1).
- **Purposes & notice:** documented collection purposes per field; version history of the public privacy notice; point-of-collection notices (clauses 4.2, 4.8).
- **Consent:** consent records — what, when, notice version, basis, and withdrawals — from the preference store; evidence of meaningful-consent design for sensitive fields (clause 4.3; s. 6.1).
- **Data inventory:** current inventory of personal information held, with sensitivity tags, locations, and sub-processors (clauses 4.1, 4.5, 4.8).
- **Safeguards:** encryption configuration (TLS/at-rest), access-control matrix (RLS/RBAC/MFA), audit-log samples, secure-disposal evidence; security-CI artifacts (SBOM, gitleaks, dependency-audit reports) (clause 4.7).
- **Retention:** retention schedule with minimum/maximum periods per purpose; deletion/anonymization job logs (clause 4.5).
- **Access/correction:** DSAR request log with timestamps, responses, and any exceptions applied; correction records (clause 4.9).
- **Complaints:** complaint intake log, investigation notes, and remediation outcomes (clause 4.10).
- **Breaches:** the **record of every breach kept for ≥ 24 months** (SOR/2018-64 s. 6); RROSH assessments; OPC reports filed; individual and third-party notifications sent with their SOR-prescribed content (ss. 10.1–10.3; SOR/2018-64 ss. 2–6).
- **Vendors:** signed DPAs / security addenda with all sub-processors; the sub-processor register (clauses 4.1.3, 4.7).

# Quebec Law 25 — Act respecting the protection of personal information in the private sector (P-39.1) — requirements checklist
> Source: https://www.legisquebec.gouv.qc.ca/en/document/cs/p-39.1 · https://www.cai.gouv.qc.ca/ · CQLR c. P-39.1, as amended by *An Act to modernize legislative provisions as regards the protection of personal information* (SQ 2021, c. 25 — "Law 25") · retrieved 2026-06-22 · Quebec (Canada) statute; LégisQuébec official consolidation is reproducible under Quebec's reproduction conditions — summarize and cite by section. Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- You **collect, hold, use or communicate personal information (PI) about a Quebec resident** in the course of carrying on an enterprise — regardless of where your company is incorporated or hosted. There is **no revenue or headcount threshold**; the Act binds every "person carrying on an enterprise" (s.1). A solo SaaS on managed infra with even one Quebec customer/user is **directly in scope** as the enterprise that determines the purposes of processing (the GDPR-"controller" analogue).
- When you process PI **on behalf of another enterprise** (you are a hosting/processing service provider), Law 25 reaches you through a **written mandate/contract** that must impose confidentiality and security measures (s.18.3). Your managed-infra vendors (Supabase, Fly, Cloudflare, Vercel, Postgres hosts) sit below you in the same chain and must be bound the same way.
- **Phased effective dates:** core obligations (privacy-officer designation under s.3.1, confidentiality-incident reporting + register, PI-agent rules) in force **22 Sept 2022**; the bulk of the reform (governance, consent, transparency, PIA, cross-border, privacy-by-default, automated decisions, de-indexing, AMPs) **22 Sept 2023**; **data portability 22 Sept 2024**.
- **Penalties:** administrative monetary penalties (AMPs) up to **CAD $10M or 2% of worldwide turnover** (whichever is greater) for an enterprise, and up to **CAD $50,000** for a natural person (s.90 ff); penal fines up to **CAD $25M or 4% of worldwide turnover** for an enterprise, with a **minimum fine of CAD $15,000** for a legal person (s.91) — all amounts **doubled for repeat/subsequent offences**. A **private right of action** with punitive damages of at least $1,000 also applies (s.93.1). This is the strictest Canadian regime and exceeds the federal PIPEDA baseline.
- **Lawyer / privacy-officer sign-off required** for: PIA conclusions and risk thresholds, the adequacy determination before any communication outside Quebec, BAA/DPA flow-down terms, automated-decision design, and de-indexing/serious-injury judgement calls.

## Requirements

### s.3.1 — Person in charge of the protection of personal information (Privacy Officer)
- **Requires:** Designate a person responsible for ensuring the Act is complied with. By default this is the **person exercising the highest authority** in the enterprise (for a solo founder, that is you); the role may be delegated in writing. The title and contact details must be published.
- **In code:** Operational, not code — but wire the officer into the system: they are the approver in the DSAR engine, the named escalation in the incident-response runbook, and the sign-off on PIAs. Publish their contact on the public privacy page (see s.8.2).
- **Primitive:** 5 (Access control — least-privilege role ownership); supports 2, 6, 8.
- **Cite:** P-39.1 s.3.1.

### s.3.2 — Governance policies and practices
- **Requires:** Establish and implement **governance policies and practices** proportionate to the nature and scope of activities that frame the keeping, use and destruction of PI, define personnel roles/responsibilities across the data life cycle, and provide a complaint-handling process. A description must be published.
- **In code:** Encode the policy as enforced controls, not prose: retention/destruction jobs (s.23), the data inventory, RBAC role definitions, and a documented complaint/DSAR intake. Shared control with HIPAA §164.316 policies & SOC 2 governance.
- **Primitive:** 4 (Data inventory + sensitive-field tagging); 7 (Retention + deletion jobs); 5 (Access control).
- **Cite:** P-39.1 s.3.2.

### s.3.3 — Assessment of privacy-related factors (PIA) for system/service projects
- **Requires:** Conduct an **assessment of privacy-related factors (a PIA)** for any project to **acquire, develop or overhaul an information system or electronic service delivery system** involving the collection, use, communication, keeping or destruction of PI. The privacy officer must be consulted at project outset.
- **In code:** Process gate in the SDLC — block ship of a new feature/system touching PI until the PIA is completed and the officer signs off. Capture the assessment as a versioned artifact in the repo alongside the data inventory. **Flag for DPO/legal review** of the risk conclusion.
- **Primitive:** 4 (Data inventory); 8 (process control feeding incident/risk posture). PIA gate is a process control requiring privacy-officer/legal sign-off.
- **Cite:** P-39.1 s.3.3.

### s.3.5 — Confidentiality incidents: mitigation + notification to the Commission and affected persons
- **Requires:** On reasonable belief that a **confidentiality incident** has occurred, take reasonable measures to reduce risk of injury and prevent recurrence. Where the incident presents a **risk of serious injury**, **promptly notify the Commission d'accès à l'information (CAI)** and **each person concerned** (with limited exception where notice would impede an investigation). Affected persons may be notified by public notice where direct notice is not feasible.
- **In code:** Breach pipeline: alerting from Supabase/Postgres audit logs + Cloudflare WAF/security events, an incident workflow that triggers the serious-injury assessment, and CAI + data-subject notification templates. The CAI provides an online incident-report form. Shares the control with GDPR Art. 33/34 and HIPAA Breach Notification — build one pipeline, map to all.
- **Primitive:** 8 (Incident-response + breach pipeline); 6 (Immutable audit logging as evidence).
- **Cite:** P-39.1 s.3.5.

### s.3.6 — Definition of confidentiality incident
- **Requires:** Treat as an incident any **unauthorized access to, use, or communication** of PI, **loss** of PI, or any other **breach in the protection** of PI — this scopes what the s.3.5/s.3.8 obligations attach to.
- **In code:** Encode these four trigger categories into detection rules and the incident classifier (access anomalies via audit logs, exfiltration/loss events, misconfiguration of RLS/buckets).
- **Primitive:** 8 (Incident-response); 6 (Immutable audit logging).
- **Cite:** P-39.1 s.3.6.

### s.3.7 — Risk-of-serious-injury assessment factors
- **Requires:** When assessing risk of injury, consider in particular the **sensitivity** of the information, the **anticipated consequences** of its use, and the **likelihood** it will be used for injurious purposes; consult the privacy officer.
- **In code:** Drive the severity field off your sensitive-field tags (s.4 / data inventory) so an incident touching tagged-sensitive columns auto-escalates. Record the assessment in the incident record. **Threshold judgement needs officer/legal sign-off.**
- **Primitive:** 8 (Incident-response); 4 (Data inventory + sensitive-field tagging).
- **Cite:** P-39.1 s.3.7.

### s.3.8 — Register of confidentiality incidents
- **Requires:** Keep a **register of confidentiality incidents** (all incidents, not only reportable ones). A copy must be sent to the CAI on request. The *Regulation respecting confidentiality incidents* prescribes the register's content; register entries must be **retained for a minimum of 5 years** after the date the enterprise became aware of the incident.
- **In code:** Append-only incidents table with immutable audit logging; fields per the Regulation (description, PI categories, dates, number of persons affected, measures taken, notifications made). Retention job enforces the 5-year floor.
- **Primitive:** 6 (Immutable audit logging); 8 (Incident-response); 7 (Retention).
- **Cite:** P-39.1 s.3.8; Regulation respecting confidentiality incidents.

### s.8 / s.8.1 — Information given at collection
- **Requires:** When collecting PI, inform the person of the **purposes**, the **means** of collection, the **rights of access and rectification**, the **right to withdraw consent**, and whether the PI may be **communicated outside Quebec**; where collected via technology with identification/location/profiling capability, inform of the means to activate those functions.
- **In code:** Just-in-time collection notices wired to the consent store; profiling/tracking technologies off by default (see s.9.1) with a documented activation control.
- **Primitive:** 3 (Consent + preference store); 4 (Data inventory).
- **Cite:** P-39.1 s.8, s.8.1.

### s.8.2 — Confidentiality (privacy) policy published in clear language
- **Requires:** Anyone who collects PI through a **technological product or service** must publish, in **clear and simple language**, a **confidentiality policy** and make it available by appropriate means, including on the **website**.
- **In code:** Maintain a versioned public privacy policy route; surface the privacy officer's contact (s.3.1), retention practices (s.23), incident-notification commitments, access/rectification/DSAR paths, and automated-decision disclosure (s.12.1).
- **Primitive:** 3 (Consent + preference store / transparency surface); 2 (DSAR engine entry point).
- **Cite:** P-39.1 s.8.2.

### s.9.1 — Privacy by default
- **Requires:** Anyone who collects PI by offering a **technological product or service with privacy settings** must ensure those settings provide the **highest level of confidentiality by default**, without any action by the person concerned (excludes cookies/browsing-config settings).
- **In code:** Ship new accounts/features with the most protective defaults: profiling/analytics opt-in not opt-out, minimal data sharing, public-visibility toggles off, default RLS scoped to owner-only. Encode defaults in migrations/seed config, not just UI. **Exceeds the PIPEDA/GDPR baseline** — privacy-by-*default* is a hard statutory rule here, not just a principle.
- **Primitive:** 5 (Access control — least-privilege / RLS defaults); 3 (Consent + preference store).
- **Cite:** P-39.1 s.9.1.

### s.12 — Use limited to consented purposes; secondary-use rules
- **Requires:** PI may be **used only for the purposes for which it was collected**; any new purpose requires fresh consent unless a statutory exception applies (e.g. compatible purpose, study/research with PIA). Consent for **sensitive PI** must be **express**.
- **In code:** Purpose tags on data-inventory fields; enforce purpose-bound access in queries/RLS; gate any new processing path on a recorded consent of the correct purpose. Sensitive-tagged fields require an express, separately-captured consent record.
- **Primitive:** 3 (Consent + preference store); 4 (Data inventory + sensitive-field tagging).
- **Cite:** P-39.1 s.12.

### s.12.1 — Automated decision-making transparency and review
- **Requires:** Where a decision is based **exclusively on automated processing** of PI, **inform the person** no later than when the decision is communicated, and on request give them the **PI used**, the **reasons / principal factors** leading to the decision, and the **right to have it corrected** and to **submit observations to a member of personnel** able to review the decision.
- **In code:** Tag decision endpoints that run without human review; persist the input PI and factor set per decision in the audit log; expose a "request review" intake routed to a human reviewer; surface the disclosure in the s.8.2 policy. **Exceeds GDPR Art. 22 in scope** (no "legal/significant effect" qualifier). **Automated-decision design needs legal review.**
- **Primitive:** 6 (Immutable audit logging of inputs/factors); 2 (DSAR engine — correction/observations channel).
- **Cite:** P-39.1 s.12.1.

### s.13–s.14 — Valid consent: manifest, free, enlightened, specific, separate, time-limited
- **Requires:** Consent must be **clear, free and informed and given for specific purposes**, requested **for each purpose in clear and simple language**, and presented **separately** from any other information. Consent is **valid only for the time needed** to achieve the purposes. A minor under 14 requires parental consent (unless clearly for the minor's benefit).
- **In code:** Granular, per-purpose, timestamped, withdrawable consent records; no bundled/pre-ticked consent; expiry tied to retention; age-gating logic for minors. One consent store satisfies this alongside GDPR Art. 7 and the consent-preference needs of US state laws.
- **Primitive:** 3 (Consent + preference store).
- **Cite:** P-39.1 s.13, s.14.

### s.17 — Communication of PI outside Quebec (PIA + adequacy)
- **Requires:** Before communicating PI **outside Quebec**, conduct a **privacy impact assessment** weighing the sensitivity of the PI, the purposes, the protection measures (including contractual), and the **legal framework of the receiving jurisdiction**; the communication may proceed only if the assessment shows **adequate protection**, and it must be the subject of a **written agreement**.
- **In code:** Map every sub-processor/region in the vendor register (managed infra: Supabase, Fly, Cloudflare, Vercel regions, Postgres host); pin data residency where feasible; attach the s.17 assessment and DPA to each cross-border flow. Same control family as GDPR Chapter V transfers — reuse the transfer-mapping work. **Adequacy determination requires legal sign-off.**
- **Primitive:** 9 (Vendor / sub-processor register); 4 (Data inventory); 1 (Encryption in transit/at rest as a transfer safeguard).
- **Cite:** P-39.1 s.17.

### s.10 / s.18.3 — Security safeguards; communication to service providers
- **Requires:** Take the **security measures** necessary to ensure the protection of the PI that are **reasonable given the sensitivity of the information, the purposes for which it is to be used, the quantity and distribution of the information, and the medium on which it is stored** (s.10). Separately, communicating PI to a **service provider** for processing requires a **written mandate/contract** imposing confidentiality, use-limitation, security-measures, return/destruction-on-completion and incident-notification obligations (s.18.3). Internally, PI may be communicated **within the enterprise** only to staff/mandataries who need it to perform their duties (s.20, need-to-know); communication of PI **to a person outside the enterprise** is governed by s.21.
- **In code:** Enforce TLS 1.2+ in transit and AES-256 at rest (managed defaults on Supabase/Fly/Cloudflare/Postgres) with documented key management; least-privilege service credentials and need-to-know RLS/RBAC (s.20). Sign DPAs/security addenda with every processor in the chain (s.18.3). The s.10 security-measures duty is the Quebec sibling of GDPR Art. 32 and HIPAA Security Rule.
- **Primitive:** 1 (Encryption); 5 (Access control — least-privilege / need-to-know); 9 (Vendor / sub-processor register — DPA/security addendum).
- **Cite:** P-39.1 s.10 (security measures); s.18.3 (service-provider contract); s.20 (internal need-to-know communication); s.21 (communication outside the enterprise).

### s.23 — Retention limitation; destruction or anonymization when purpose fulfilled
- **Requires:** When the **purposes** for which PI was collected or used **are achieved**, the enterprise must **destroy** the PI or **anonymize** it to use for serious and legitimate purposes (anonymization per generally accepted best practices and the prescribed criteria). PI must not be kept beyond the purpose absent a retention obligation in law.
- **In code:** Retention-and-deletion jobs keyed off the per-field purpose/retention metadata in the data inventory; hard-delete or run anonymization transforms on Postgres on schedule; verify cascade across backups and managed-storage buckets. Pairs with consent expiry (s.14).
- **Primitive:** 7 (Retention + deletion jobs); 4 (Data inventory).
- **Cite:** P-39.1 s.23.

### s.27 — Right of access and data portability
- **Requires:** On request, confirm holding and **give the person access** to their PI. As of **22 Sept 2024**, where the PI was **computerized**, release it (or communicate it to a designated third party) in a **structured, commonly used technological format** (data portability), except where this raises serious practical difficulties.
- **In code:** DSAR engine "access" + "export" handlers producing structured JSON/CSV from the tagged data inventory; authenticated self-serve export; the portability path is the same export plumbing GDPR Art. 20 needs.
- **Primitive:** 2 (DSAR engine — access / export).
- **Cite:** P-39.1 s.27 (portability effective 22 Sept 2024).

### s.28 / s.28.1 — Rectification; de-indexing / cessation of dissemination
- **Requires:** A person may have **inaccurate, incomplete or equivocal** PI **corrected**, and obsolete or unjustified PI **deleted** (s.28). Under **s.28.1**, a person may require an enterprise to **cease disseminating** their PI or to **de-index** any hyperlink giving access to it where the dissemination contravenes the law or a court order, or causes serious injury to reputation/privacy that outweighs the public interest and freedom of expression (a balancing test).
- **In code:** DSAR engine "correct" and "delete" handlers; for s.28.1 a cessation/de-indexing workflow that propagates removal to search indexes, caches/CDN (Cloudflare cache purge), and downstream copies, logged immutably. **The s.28.1 balancing test needs legal judgement.**
- **Primitive:** 2 (DSAR engine — correct / delete); 7 (Retention + deletion jobs); 6 (Immutable audit logging of the action).
- **Cite:** P-39.1 s.28, s.28.1.

### s.90 ff / s.91 / s.93.1 — Enforcement: AMPs, penal offences, civil liability
- **Requires:** The CAI may impose **administrative monetary penalties** up to **$10M or 2% of worldwide turnover** for an enterprise (and up to **$50,000** for a natural person) (s.90 ff) and pursue **penal offences** carrying fines up to **$25M or 4% of worldwide turnover** for an enterprise, with a **minimum fine of $15,000** for a legal person (s.91), including for failing to report an incident, processing in contravention of the Act, or non-compliance with a CAI order. All these amounts are **doubled for subsequent offences**. A **private right of action** allows damages, with minimum **$1,000 punitive damages** for unlawful/intentional infringement (s.93.1).
- **In code:** Not a build target — but the evidence primitives below are what defends against these. Maintain demonstrable compliance artifacts; treat the incident register (s.3.8) and audit logs as your primary defence record.
- **Primitive:** 6 (Immutable audit logging — evidence); 8 (Incident-response).
- **Cite:** P-39.1 s.90 ff, s.91, s.93.1.

## Evidence to retain
- **Designation and publication of the privacy officer** (s.3.1) — name, role, contact, and the public listing.
- **Governance policies and practices** document and its published description (s.3.2), with version history.
- **PIAs** for each in-scope system/service project (s.3.3) and each **cross-border communication adequacy assessment** + written agreement (s.17), with privacy-officer/legal sign-off.
- **Register of confidentiality incidents** (s.3.8) — all entries with the Regulation-prescribed content; **retain ≥ 5 years** from awareness. Plus CAI notifications and affected-person notices for serious-injury incidents (s.3.5).
- **Consent records** — per-purpose, timestamped, separately-presented, with express records for sensitive PI and minors' parental consent (s.13–s.14); withdrawal logs.
- **Data inventory** with purpose and sensitivity tags, residency/sub-processor mapping, and **retention/destruction-or-anonymization logs** (s.23) including backup-cascade evidence.
- **Published privacy policy** versions (s.8.2) and collection-notice copy (s.8/s.8.1), including the automated-decision disclosure (s.12.1).
- **DSAR records** — access, export (structured format, post-22 Sept 2024), correction, deletion, and s.28.1 de-indexing/cessation requests with response timing and the human-review/observations log for automated decisions (s.12.1).
- **Vendor register** — DPAs / mandates / security addenda for every processor and managed-infra provider (s.18.3), plus the cross-border agreements (s.17).
- **Security-measures evidence** — encryption (TLS 1.2+ / AES-256) config, key management, RLS/RBAC/MFA settings, and immutable audit logs (s.10 security measures; s.20 need-to-know; s.6 logging) demonstrating access control and breach-detection capability.

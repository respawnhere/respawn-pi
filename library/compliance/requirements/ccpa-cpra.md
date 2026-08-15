# CCPA / CPRA (California) — requirements checklist
> Source: https://oag.ca.gov/privacy/ccpa · Cal. Civ. Code §§ 1798.100–1798.199 (https://leginfo.legislature.ca.gov, Title 1.81.5) · CPPA regulations CCR Title 11, Div. 6, §§ 7000–7304 (https://cppa.ca.gov/regulations/) · retrieved 2026-06-20 · US state law + regulations, public domain — summarized freely. Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
For-profit business that collects CA residents' personal information, determines purposes/means of processing, does business in California, AND meets **any one** threshold (Civ. Code § 1798.140(d)):
- Gross annual revenue **> $25M** (prior calendar year); **or**
- Buys, sells, or shares the PI of **100,000+** CA consumers or households/year; **or**
- Derives **≥ 50%** of annual revenue from selling or sharing CA consumers' PI.
Also covers any entity controlled by / sharing branding with a covered business, and joint ventures. "Personal information" is broad (identifiers, commercial, biometric, internet activity, geolocation, inferences). Sale/share triggers = monetary/valuable consideration OR cross-context behavioral advertising. **Breach private right of action (§ 1798.150) applies regardless of the size thresholds.** Common exemptions: nonprofits, government, and data already covered by HIPAA/GLBA/FCRA/CalFIPA (entity- or data-level). B2B and employee-data exemptions **expired** Jan 1, 2023 — those individuals now have full rights.

## Requirements

### KNOW-110 — Right to know (categories + specific pieces)
- **Requires:** On verified request, disclose categories of PI collected, categories of sources, business/commercial purpose, categories of third parties to whom disclosed, and the **specific pieces** of PI. Cover the 12-month lookback (consumer may request beyond 12 months for data collected on/after 1/1/2022 unless impossible/disproportionate). Free, up to **twice per 12 months**.
- **In code:** DSAR endpoint that resolves a verified consumer to all rows across tables/buckets keyed by their identifiers; export assembles categories + raw values from the data inventory tags. Return machine-readable (portable) format for specific pieces.
- **Primitive:** 2. DSAR engine
- **Cite:** Civ. Code §§ 1798.100, 1798.110, 1798.115; CCR §§ 7020–7024

### DEL-105 — Right to delete
- **Requires:** Delete PI collected from the consumer on verified request, and **direct service providers/contractors and third parties** to delete (and third parties to whom you sold/shared, unless impossible/disproportionate). Honor statutory exceptions (complete transaction, security, debugging, legal obligation, internal uses aligned to expectations). Use a **two-step** confirmation for online deletion. May offer deletion, deidentification, or aggregation as alternatives.
- **In code:** Cascading deletion job that hard-deletes or anonymizes consumer rows, fans out delete signals to sub-processors via API/webhook, and records the disposition; gate behind verification; log the exception code when data is retained.
- **Primitive:** 7. Retention + deletion jobs
- **Cite:** Civ. Code § 1798.105; CCR §§ 7021–7023

### COR-106 — Right to correct
- **Requires:** On verified request, use **commercially reasonable efforts** to correct inaccurate PI, considering the nature of the PI and purpose of processing. Accept documentation from consumer; may deny if you have a good-faith belief the info is correct (must explain).
- **In code:** Authenticated self-service profile edit + a correction-request workflow that updates the record of truth and propagates the corrected value to downstream stores/sub-processors; audit the change.
- **Primitive:** 2. DSAR engine
- **Cite:** Civ. Code § 1798.106; CCR § 7023

### OPT-120 — Right to opt out of sale/sharing
- **Requires:** Let consumers direct you to stop **selling** (monetary/valuable consideration) and **sharing** (cross-context behavioral advertising) their PI. Provide a clear **"Do Not Sell or Share My Personal Information"** link (or the alternative opt-out preference link). Effect the opt-out **as soon as feasibly possible, ≤ 15 business days**, and notify third parties to whom you sold/shared in the prior 90 days. Cannot require an account. No re-solicitation for opt-in for **12 months**.
- **In code:** Consent/preference store flag `sale_share_opt_out=true`; ad/analytics pixels and data exports check the flag before firing; propagate opt-out downstream within 15 business days; suppress re-prompt for 12 months.
- **Primitive:** 3. Consent + preference store
- **Cite:** Civ. Code §§ 1798.120, 1798.135; CCR §§ 7013, 7026

### GPC-135 — Opt-out preference signals (Global Privacy Control)
- **Requires:** Businesses that sell/share **must treat a browser/device-level opt-out preference signal (GPC) as a valid opt-out** request for that browser/device (and linked consumer/profile if known), without requiring extra steps. Signal must be honored automatically; you may not require the consumer to confirm. May display whether the signal was processed.
- **In code:** Server/edge middleware reads the `Sec-GPC: 1` header (and DNT-equivalent); sets `sale_share_opt_out` for the session and, if authenticated, persists to the consumer's preference record; conditionally blocks tag manager / third-party tags. Apply at Cloudflare Worker or Next.js middleware layer.
- **Primitive:** 3. Consent + preference store
- **Cite:** Civ. Code § 1798.135(b); CCR § 7025

### LIM-121 — Right to limit use of sensitive personal information (SPI)
- **Requires:** If you use/disclose SPI beyond the purposes a consumer would reasonably expect (or beyond § 7027(m) permitted purposes), provide a **"Limit the Use of My Sensitive Personal Information"** link and honor the request **≤ 15 business days**, notifying relevant third parties. SPI = SSN/driver's license/state ID/passport; financial account + access code; precise geolocation; race/ethnicity, religious/philosophical beliefs, union membership; contents of mail/email/texts (not the recipient); genetic data; biometric data for unique ID; health information; sex life/sexual orientation; **neural data**.
- **In code:** Tag SPI fields in the data inventory; preference flag `limit_spi=true` that restricts SPI processing to permitted business purposes only; enforce at query/feature-flag layer.
- **Primitive:** 3. Consent + preference store
- **Cite:** Civ. Code §§ 1798.121, 1798.140(ae); CCR §§ 7014, 7027

### INV-140 — Sensitive-field tagging & data inventory
- **Requires:** Implicit prerequisite — you must know which PI categories you collect, sources, purposes, retention, and what counts as SPI, to populate notices (§ 7012), respond to right-to-know, and apply the SPI limit. CPRA forbids retaining PI beyond what's reasonably necessary/proportionate to disclosed purposes.
- **In code:** Maintain a data-map (table/column → PI category, SPI flag, source, purpose, retention, sold/shared y/n, sub-processors). Generate notice-at-collection and privacy-policy category lists from this map; drive deletion/retention jobs from it.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Civ. Code §§ 1798.100(a),(c), 1798.140(ae); CCR § 7012(e)

### NDS-125 — Non-discrimination & financial incentives
- **Requires:** Do **not** deny goods/services, charge different prices, or provide a different quality because a consumer exercised a right. Financial incentives / price-or-service differences permitted only if reasonably related to the value of the consumer's data, with notice and **opt-in** consent, revocable at any time.
- **In code:** Feature/billing logic must not branch on opt-out/delete/limit flags to degrade service; any incentive program records opt-in consent and value-justification; allow consent withdrawal.
- **Primitive:** 3. Consent + preference store
- **Cite:** Civ. Code § 1798.125; CCR §§ 7016, 7080

### NOT-COL — Notice at collection
- **Requires:** At or before collection, inform consumers of: categories of PI to be collected, purposes, whether sold/shared, SPI categories + purposes, and the **retention period** (or criteria) for each category. Include links to opt-out / limit notices and privacy policy. A business that does not collect directly may not sell/share without contacting the consumer to provide notice or obtaining attestation.
- **In code:** Render a "just-in-time" notice block at every collection surface (signup, forms, SDKs) generated from the data inventory; version it.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Civ. Code § 1798.100(a),(b); CCR § 7012

### POL-130 — Privacy policy contents
- **Requires:** Comprehensive online privacy policy, updated at least **every 12 months**, describing: all consumer rights and how to exercise them; categories of PI/SPI collected, sold/shared, disclosed (prior 12 months) and purposes; categories of sources and third parties; retention periods; whether you sell/share and respond to opt-out preference signals; metrics (for businesses handling 10M+ consumers); effective date.
- **In code:** Privacy policy generated/validated against the live data inventory; CI check warns when the policy is > 12 months old; surface the request-submission methods and links.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Civ. Code § 1798.130(a)(5); CCR § 7011

### REQ-130 — Request submission methods & response process
- **Requires:** Provide **two or more** designated methods to submit right-to-know/delete/correct (e.g., toll-free number + interactive web form; email/online form acceptable for online-only businesses). Confirm receipt **≤ 10 business days**; respond/complete **≤ 45 calendar days**, extendable once by **45 days** (90 total) with notice. Deliver right-to-know data **free** in a portable, readily usable format. No account-creation requirement; can't require excessive info.
- **In code:** DSAR intake form + ticketing with SLA timers (10-day ack, 45/90-day completion), automated status notices, and a portable export pipeline.
- **Primitive:** 2. DSAR engine
- **Cite:** Civ. Code § 1798.130(a),(b); CCR § 7021

### VER-060 — Verification of consumer requests
- **Requires:** Verify the requester's identity to a degree of certainty matched to the request's sensitivity (reasonable degree for categories; **reasonably high degree** for specific pieces / deletion of sensitive data). Match identifying info to data already held; avoid collecting new SPI for verification; delete verification data after use. If unverifiable, deny and treat right-to-know as a categories-only request where possible.
- **In code:** Verification step in the DSAR flow that matches 2–3 data points against the record (or re-auth for account holders), escalates assurance for specific-pieces/delete, logs the method, and purges verification artifacts.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** Civ. Code § 1798.130(a)(2); CCR §§ 7060–7063

### AGT-080 — Authorized agents
- **Requires:** Allow consumers to use an authorized agent (e.g., via signed permission or power of attorney) to submit requests. You may require the agent to provide proof of authorization and require the consumer to verify their own identity and/or directly confirm the authorization.
- **In code:** DSAR intake supports agent submissions with proof upload; route to a verification path that confirms both agent authority and consumer identity before fulfillment.
- **Primitive:** 2. DSAR engine
- **Cite:** Civ. Code § 1798.135(c); CCR §§ 7063, 7080–7081

### MIN-120 — Minors' opt-in consent
- **Requires:** Do not sell or share PI of consumers **under 16** without affirmative opt-in: **under 13** requires verifiable **parental** consent; **13–15** requires the minor's own opt-in. Provide notice of these rights.
- **In code:** Age-gate at collection; consent store records opt-in (parental for <13) and blocks sale/share until granted; default minors to opted-out.
- **Primitive:** 3. Consent + preference store
- **Cite:** Civ. Code § 1798.120(c); CCR §§ 7070–7071

### SP-051 — Service provider & contractor contracts
- **Requires:** Disclosing PI to a vendor as a "service provider"/"contractor" (not a sale/share) requires a **written contract** that: limits processing to specified business purposes; prohibits selling/sharing, retaining/using/disclosing PI outside the contract or combining with other data; obligates the same level of protection; grants you rights to monitor compliance; requires the vendor to assist with consumer requests; and flows obligations down to sub-processors.
- **In code:** Maintain a sub-processor register linking each vendor to its DPA/contract, processing purpose, data categories, and sub-processor list; gate new vendor integrations on signed contract.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Civ. Code §§ 1798.100(d), 1798.140(ag),(ah); CCR §§ 7051–7052

### TP-053 — Third-party obligations
- **Requires:** When you sell/share PI to a third party, a contract must inform them of restrictions and require CCPA compliance. A third party that receives PI is itself bound to provide the same protections and honor opt-outs.
- **In code:** Third-party data-sharing register with contract reference and opt-out propagation hooks; downstream notification on opt-out/delete.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Civ. Code § 1798.100(d); CCR § 7053

### SEC-100 — Reasonable security
- **Requires:** Implement and maintain **reasonable security procedures and practices** appropriate to the nature of the PI to protect it from unauthorized access, destruction, use, modification, or disclosure. Failure is the basis for the breach private right of action.
- **In code:** TLS in transit + AES at rest (managed by Supabase/Fly/Cloudflare/Vercel), key management, RLS/RBAC + MFA, least-privilege service roles, secrets management, dependency scanning. Encrypt or redact the breach-trigger data elements (see BREACH-150) so they fall outside § 1798.150.
- **Primitive:** 1. Encryption (TLS+AES, key mgmt)
- **Cite:** Civ. Code §§ 1798.100(e), 1798.150(a)

### ACC-AC — Access control & least privilege
- **Requires:** Operationalize "reasonable security" and verification through restricted access: only authorized personnel/services touch PI; SPI access further restricted; access matched to need.
- **In code:** Postgres RLS policies scoping rows to the owning consumer/tenant; RBAC roles for staff; MFA on admin/console access; scoped API keys; no broad service-role keys in client code.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** Civ. Code § 1798.100(e); CCR § 7060

### REC-100 — Recordkeeping & accountability
- **Requires:** Keep records of consumer requests and how you responded for **≥ 24 months**. Businesses handling the PI of **10M+** consumers/year must compile and disclose annual request **metrics** (requests received/complied/denied and mean response time) in the privacy policy. Records may not be used for unrelated purposes.
- **In code:** Immutable, append-only request log capturing request type, date received, verification result, action taken, completion date; scheduled metrics rollup for the 10M+ threshold; retain ≥ 24 months.
- **Primitive:** 6. Immutable audit logging
- **Cite:** Civ. Code § 1798.185; CCR §§ 7101–7102

### RET-100 — Retention & data minimization
- **Requires:** Collect/use/retain/share PI only as **reasonably necessary and proportionate** to the disclosed purpose; do not retain PI longer than reasonably necessary; disclose retention periods (or criteria) per category. Cannot process for new, incompatible purposes without notice.
- **In code:** Per-category retention config driven by the data inventory; scheduled deletion/anonymization jobs (cron) that expire data past its retention window; purpose checks at write time.
- **Primitive:** 7. Retention + deletion jobs
- **Cite:** Civ. Code § 1798.100(c); CCR § 7002

### BREACH-150 — Breach private right of action
- **Requires:** A consumer whose **nonencrypted and nonredacted** personal information (name + SSN, driver's license/state ID/passport, financial account + access code, medical/health-insurance info, biometric data, genetic data, or account email + credentials) is subject to unauthorized access/exfiltration/theft/disclosure due to failure to maintain reasonable security may sue for the greater of **actual damages or statutory damages of $100–$750 per consumer per incident**, plus injunctive relief. (Separate CA breach-notification statute Civ. Code § 1798.82 governs notice to affected residents.)
- **In code:** Incident-response runbook + breach pipeline: detect, contain, assess scope (which consumers/data elements), and notify affected CA residents per § 1798.82; demonstrably encrypt/redact the trigger data elements at rest to remove § 1798.150 exposure. Preserve audit logs as breach evidence.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** Civ. Code §§ 1798.150, 1798.82

### ENF-155 — Administrative enforcement & cure
- **Requires:** The CPPA and Attorney General enforce administratively (civil penalties up to **$2,500 per violation / $7,500 per intentional violation or violation involving a minor's PI**). The statutory 30-day cure period was **removed by CPRA** for agency enforcement (cure is now discretionary).
- **In code:** Maintain demonstrable compliance posture (the artifacts above) so enforcement inquiries can be answered with evidence; track and remediate gaps proactively.
- **Primitive:** 6. Immutable audit logging
- **Cite:** Civ. Code § 1798.155

### NEW-ADMT — Risk assessments, cybersecurity audits & ADMT (2026)
- **Requires:** Under the 2025 CPPA regulations (effective Jan 1, 2026, phased compliance dates): businesses whose processing presents **significant risk** must conduct and document **risk assessments**; certain businesses must complete an annual independent **cybersecurity audit**; and businesses using **automated decisionmaking technology (ADMT)** for significant decisions must provide a **pre-use notice**, an **opt-out**, and an **access/appeal** right. Applicability depends on revenue and processing-volume thresholds — confirm against the final regulation timelines.
- **In code:** Stand up a risk-assessment register for high-risk processing; schedule the annual cybersecurity audit with evidence collection; if you run ADMT, add pre-use notices, an ADMT opt-out flag in the preference store, and a human-review/appeal path.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** CCR §§ 7150–7157 (risk assessments), §§ 7120–7124 (cybersecurity audits), §§ 7200–7222 (ADMT)

## Evidence to retain
- **Data map / inventory** linking each PI/SPI category to source, purpose, retention, sale/share status, and sub-processors (basis for notices, DSARs, deletion).
- **Notice-at-collection and privacy-policy version history** with effective dates (proves ≤ 12-month refresh and disclosure completeness).
- **DSAR request log (≥ 24 months):** request type, date received, ack within 10 business days, verification method/result, action taken, completion within 45/90 days, exception codes for withheld data. Annual metrics report for 10M+ businesses.
- **Consent & preference records:** sale/share opt-outs, SPI limits, GPC-signal handling, minor opt-ins (parental for <13), financial-incentive opt-ins and value justification — timestamped and revocable.
- **GPC handling proof:** logs/config showing `Sec-GPC` signals honored automatically and propagated.
- **Vendor/sub-processor register** with executed service-provider/contractor/third-party contracts (DPAs), processing purposes, and downstream opt-out/delete propagation.
- **Security evidence:** encryption-at-rest/in-transit config, RLS/RBAC/MFA policies, least-privilege roles, dependency/vuln scans — supporting "reasonable security" and reducing § 1798.150 breach exposure.
- **Incident-response runbook + breach records:** detection, scope assessment (consumers/data elements), § 1798.82 notifications, remediation timeline, preserved audit logs.
- **2026 artifacts (if in scope):** documented risk assessments, independent cybersecurity audit report, ADMT pre-use notices and opt-out/appeal logs.

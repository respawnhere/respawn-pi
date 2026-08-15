# GDPR (Regulation (EU) 2016/679) — requirements checklist
> Source: https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng · retrieved 2026-06-20 · EUR-Lex content is reusable with attribution (© European Union, https://eur-lex.europa.eu, 1998–2026). Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- You process personal data of people **in the EU/EEA** — there is **no size or volume threshold**; one EU data subject triggers the whole Regulation (Art. 3 territorial scope).
- Applies extraterritorially to a non-EU controller/processor that (a) offers goods or services to people in the EU (paid or free), or (b) monitors the behaviour of people in the EU (analytics, tracking, profiling).
- You are a **controller** (you decide why/how data is processed) and/or a **processor** (you process on a controller's behalf, e.g. you are a SaaS handling your customer's end-user data). Most solo-founder SaaS are controllers for their own users and processors for their B2B customers' data — both roles apply.
- "Personal data" = any info relating to an identified/identifiable person (name, email, IP, device ID, user ID, location). "Special categories" (Art. 9) and children's data (Art. 8) get stricter rules.
- Managed-infra note: Supabase/Fly/Cloudflare/Vercel/email/SMS/LLM vendors are your **processors/sub-processors** — Arts. 28 and 44–49 govern routing EU personal data to them.

## Requirements

### Art. 5(1)(a) — Lawfulness, fairness, transparency
- **Requires:** Process personal data lawfully, fairly, and transparently in relation to the data subject.
- **In code:** Pair every processing activity with a documented Art. 6 lawful basis in your data inventory; surface plain-language privacy notices (Arts. 13/14) at collection; no hidden/covert collection.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 5(1)(a)

### Art. 5(1)(b) — Purpose limitation
- **Requires:** Collect for specified, explicit, legitimate purposes; do not further process in a way incompatible with those purposes.
- **In code:** Tag each field/table with its declared purpose(s) in the inventory; block/flag reuse of data for new purposes (e.g. feeding user data into an LLM or new analytics pipeline) without a compatibility check or fresh basis.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 5(1)(b)

### Art. 5(1)(c) — Data minimisation
- **Requires:** Data must be adequate, relevant, and limited to what is necessary for the purposes.
- **In code:** Don't collect fields you don't need; prefer pseudonymised/aggregated data; review forms and event schemas to strip excess PII; default analytics to minimal identifiers.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 5(1)(c)

### Art. 5(1)(d) — Accuracy
- **Requires:** Keep data accurate and, where necessary, up to date; erase or rectify inaccurate data without delay.
- **In code:** Self-serve profile edit; wire the Art. 16 rectification path into the DSAR engine; propagate corrections to downstream stores/caches/analytics.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** Art. 5(1)(d)

### Art. 5(1)(e) — Storage limitation
- **Requires:** Keep data in identifiable form no longer than necessary for the purposes.
- **In code:** Per-category retention periods in the inventory; scheduled deletion/anonymisation jobs (e.g. Supabase cron / edge function) covering DB, backups, logs, and analytics.
- **Primitive:** 7. Retention + deletion jobs
- **Cite:** Art. 5(1)(e)

### Art. 5(1)(f) — Integrity and confidentiality (security)
- **Requires:** Process with appropriate security, including protection against unauthorised/unlawful processing and accidental loss/destruction/damage.
- **In code:** TLS in transit + AES-256 at rest; RLS/RBAC; least-privilege keys; (links to Art. 32 below).
- **Primitive:** 1. Encryption (TLS+AES, key mgmt)
- **Cite:** Art. 5(1)(f)

### Art. 5(2) — Accountability
- **Requires:** The controller is responsible for, and must be able to **demonstrate** compliance with, all the Art. 5(1) principles.
- **In code:** Maintain evidence — the ROPA (Art. 30), retention schedule, DPIAs, consent logs, DPA register, breach log; keep a `compliance.config`/register in the spine so posture is recorded and doesn't drift.
- **Primitive:** 6. Immutable audit logging
- **Cite:** Art. 5(2)

### Art. 6(1) — Lawful basis required
- **Requires:** Processing is lawful only if at least one of six bases applies: (a) consent; (b) performance of a contract / pre-contractual steps; (c) compliance with a legal obligation; (d) vital interests; (e) public-interest task/official authority; (f) legitimate interests not overridden by the data subject's rights.
- **In code:** Map each processing activity to exactly one basis in the data inventory; for (f) legitimate interests, record a Legitimate Interests Assessment; never silently rely on consent where contract/legitimate-interest is the real basis.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 6(1)(a)–(f)

### Art. 7 — Conditions for consent
- **Requires:** Where processing relies on consent, you must be able to **demonstrate** consent was given; it must be freely given, specific, informed, unambiguous, by clear affirmative act; the request must be distinguishable, in clear plain language; withdrawal must be as easy as giving consent. Pre-ticked boxes/silence/inactivity are invalid.
- **In code:** Granular, timestamped, versioned consent records (purpose, copy version, timestamp, method); no pre-checked boxes; a persistent "withdraw/change preferences" control that revokes as easily as it was granted and propagates to gated tags/SDKs.
- **Primitive:** 3. Consent + preference store
- **Cite:** Art. 7(1)–(4)

### Art. 8 — Children's consent (information society services)
- **Requires:** Where an online service is offered directly to a child and consent is the basis, the child must be at least **16** (Member States may lower to **13**); below that, parental/holder-of-responsibility consent is required and you must make reasonable efforts to verify it.
- **In code:** Age gate; if under the applicable threshold, route to a verifiable-parental-consent flow and store the consent record; default-deny third-party tracking for child users; key the threshold to the user's Member State.
- **Primitive:** 3. Consent + preference store
- **Cite:** Art. 8(1)–(2)

### Art. 9 — Special categories of personal data
- **Requires:** Processing of data revealing racial/ethnic origin, political opinions, religious/philosophical beliefs, trade-union membership, and genetic, biometric (for ID), health, or sex-life/sexual-orientation data is **prohibited** unless an Art. 9(2) exception applies — most commonly (a) explicit consent, (b) employment/social-security law, (e) data manifestly made public, (f) legal claims, (h) healthcare, (j) research/archiving with safeguards.
- **In code:** Flag special-category fields in the inventory with a stricter default-deny tag; require explicit consent (not bundled) where (a) is the basis; encrypt/pseudonymise these fields; tighten RLS so only the minimum roles can read them.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 9(1), 9(2)(a)–(j)

### Art. 12 — Transparent communication & modalities for rights
- **Requires:** Provide information and facilitate rights requests in concise, transparent, intelligible, easily accessible form, in plain language. Respond **without undue delay and within one month** (extendable by two further months for complex/numerous requests, with notice). Free of charge unless manifestly unfounded/excessive. Verify requester identity. If you don't act, tell the data subject within one month and inform them of the right to complain/seek remedy.
- **In code:** DSAR intake (form/email/portal) with identity verification; ticket/SLA tracking that flags the one-month deadline and the extension path; templated responses; fee/refusal logic for excessive requests.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** Art. 12(1)–(6)

### Art. 13 — Information when data collected from the data subject
- **Requires:** At collection time, provide: controller (and rep/DPO) identity & contacts; purposes and the legal basis; legitimate interests if relied on; recipients/categories of recipients; intent to transfer to a third country + safeguards; retention period; the data-subject rights (access/rectify/erase/restrict/portability/object); right to withdraw consent; right to lodge a complaint; whether provision is statutory/contractual and consequences of non-provision; existence of automated decision-making/profiling with meaningful info on the logic.
- **In code:** A maintained privacy notice rendered at point of collection (signup, forms); keep notice content versioned and linked to consent records; auto-derive the recipients/retention/transfer sections from the data inventory + sub-processor register so the notice can't drift.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 13(1)–(3)

### Art. 14 — Information when data NOT obtained from the data subject
- **Requires:** Same disclosures as Art. 13, **plus the categories of data and the source** (and whether from public sources). Provide within a reasonable period (max **one month**), or at first communication/first disclosure to another recipient at the latest. Exceptions where the subject already has the info, provision is impossible/disproportionate effort, or obtaining/disclosure is required by law.
- **In code:** For enriched/purchased/third-party-sourced data, store provenance (source) in the inventory; trigger a notice within one month of ingestion; document any disproportionate-effort exemption you rely on.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 14(1)–(5)

### Art. 15 — Right of access
- **Requires:** On request, confirm whether you process the person's data and provide a copy plus: purposes, categories of data, recipients (incl. third-country recipients + safeguards), retention period, the existence of rectify/erase/restrict/object rights, the right to complain, the source if not collected from them, and automated-decision/profiling logic. First copy free; commonly used electronic format.
- **In code:** Self-serve "download my data" export assembling data across DB + backups context + caches + analytics + sub-processors, plus the metadata bundle (purposes/recipients/retention) generated from the inventory and sub-processor register.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** Art. 15(1)–(3)

### Art. 16 — Right to rectification
- **Requires:** Correct inaccurate data without undue delay; complete incomplete data, including via a supplementary statement.
- **In code:** Profile-edit UI + admin correction path wired into the DSAR engine; propagate corrections to downstream/derived stores; notify recipients per Art. 19.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** Art. 16

### Art. 17 — Right to erasure ("right to be forgotten")
- **Requires:** Erase without undue delay where: data no longer necessary; consent withdrawn (and no other basis); successful objection (Art. 21); unlawful processing; legal obligation to erase; data collected from a child for ISS. If you made the data public, take reasonable steps to inform other controllers. **Exceptions:** freedom of expression, legal obligation/public-interest task, public-health, archiving/research, or legal claims.
- **In code:** Deletion routine covering primary DB, backups (document the backup-rotation delete-on-restore approach), caches, search indexes, analytics, and sub-processors; log the request, the action, and any exception relied on; for consent-withdrawal-driven erasure, chain off the consent store.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** Art. 17(1)–(3)

### Art. 18 — Right to restriction of processing
- **Requires:** Restrict (store but don't otherwise process) where accuracy is contested, processing is unlawful but the subject opposes erasure, you no longer need the data but the subject needs it for legal claims, or an Art. 21 objection is pending verification. Inform the subject before lifting a restriction.
- **In code:** A "restricted/frozen" flag on the user record that suppresses processing jobs, exports, and downstream syncs while retaining storage; gate background workers to skip restricted records; notify recipients per Art. 19.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** Art. 18(1)–(2)

### Art. 19 — Notification of rectification/erasure/restriction to recipients
- **Requires:** Communicate any rectification, erasure, or restriction to each recipient the data was disclosed to, unless impossible or disproportionate effort; inform the data subject of those recipients if asked.
- **In code:** Maintain a recipient/sub-processor map per data category; on a DSAR action, fan-out notifications (API call/webhook/manual ticket) to downstream processors; log who was notified.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Art. 19

### Art. 20 — Right to data portability
- **Requires:** Where processing is based on **consent or contract** and is carried out by automated means, provide the person's data in a structured, commonly used, machine-readable format and allow transmission to another controller (direct controller-to-controller transfer where technically feasible). Does not apply to legal-obligation/public-task bases.
- **In code:** Machine-readable export (JSON/CSV) of user-provided + observed data scoped to consent/contract-based processing; ideally an export endpoint another controller can pull; distinct from the Art. 15 access copy.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** Art. 20(1)–(4)

### Art. 21 — Right to object
- **Requires:** The subject may object to processing based on **legitimate interests (6(1)(f))** or **public task (6(1)(e))**, incl. profiling; you must stop unless you show compelling legitimate grounds overriding the subject's rights, or legal claims. For **direct marketing**, the objection is **absolute** and must be honoured — stop immediately. Inform the subject of this right explicitly, at the latest at first communication.
- **In code:** A one-click marketing/profiling opt-out wired into the consent/preference store that immediately suppresses marketing sends and ad/profiling pipelines; for legitimate-interest objections, a workflow to record and assess override grounds; present the right at signup/first contact.
- **Primitive:** 3. Consent + preference store
- **Cite:** Art. 21(1)–(4)

### Art. 22 — Automated individual decision-making & profiling
- **Requires:** A person has the right not to be subject to a decision based **solely** on automated processing (incl. profiling) producing legal or similarly significant effects, unless it is (a) necessary for a contract, (b) authorised by law, or (c) based on explicit consent. Where (a)/(c) apply, implement safeguards: human intervention, right to express a view, and right to contest. Solely-automated decisions on special-category data are barred unless 9(2)(a) explicit consent or 9(2)(g) substantial public interest applies.
- **In code:** Flag any solely-automated decision flow (scoring, eligibility, auto-moderation with significant effect); add a human-review path + contest mechanism; record explicit consent or contract necessity; surface "meaningful information about the logic" in the notice; block special-category inputs unless permitted.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** Art. 22(1)–(4)

### Art. 24 — Responsibility of the controller
- **Requires:** Implement appropriate technical and organisational measures (and review/update them) to ensure and **demonstrate** processing complies, proportionate to risk; include data-protection policies where proportionate.
- **In code:** A written (even lightweight) data-protection policy + the evidence stack (ROPA, retention, DPIA, DPA register, breach log); adherence to an approved code/certification can help demonstrate compliance.
- **Primitive:** 6. Immutable audit logging
- **Cite:** Art. 24(1)–(3)

### Art. 25 — Data protection by design and by default
- **Requires:** Build in measures (e.g. pseudonymisation, minimisation) at design time and throughout; **by default**, process only the personal data necessary for each purpose (amount collected, extent of processing, storage period, accessibility) — defaults must not make data public to an indefinite number of people without action.
- **In code:** Default-private records (RLS deny-by-default); collect minimum fields; default-off optional analytics/sharing; pseudonymise identifiers; bake a privacy review into `/loadout`-style feature kickoff and `/review`.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** Art. 25(1)–(2)

### Art. 26 — Joint controllers
- **Requires:** Where two+ controllers jointly determine purposes and means, agree in a transparent arrangement who is responsible for which obligations (esp. rights and Arts. 13/14 info); make the essence available to data subjects.
- **In code:** Identify any joint-controller relationships (e.g. co-branded features, shared analytics) in the vendor register; hold a joint-controller agreement; expose the essence in the privacy notice.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Art. 26(1)–(3)

### Art. 27 — Representative of non-EU controllers/processors
- **Requires:** A controller/processor not established in the EU but caught by Art. 3(2) must designate, in writing, an EU representative in a Member State where data subjects are, unless processing is occasional, low-risk, excludes large-scale special-category/criminal data, or it is a public authority.
- **In code:** Not code — a procurement/legal task: appoint and publish an EU representative; record their details in the privacy notice and ROPA.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Art. 27(1)–(5)

### Art. 28 — Processor obligations & the DPA (data processing agreement)
- **Requires:** Use only processors giving sufficient guarantees; a binding **written contract** must bind each processor and set out subject-matter, duration, nature/purpose, data types, and subject categories, and require the processor to: (a) process only on documented controller instructions (incl. transfers); (b) ensure personnel confidentiality; (c) take Art. 32 security measures; (d) not engage sub-processors without authorisation and flow down equivalent terms; (e) assist with data-subject rights; (f) assist with Arts. 32–36; (g) delete/return data at end; (h) make available info to demonstrate compliance and allow audits.
- **In code:** Maintain a DPA register; confirm a signed DPA/sub-processor-terms with **every** processor (Supabase, Fly, Cloudflare, Vercel, email, SMS, LLM API) **before** routing EU personal data; track sub-processor authorisation and the audit/assist clauses.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Art. 28(1)–(4), 28(3)(a)–(h)

### Art. 30 — Records of processing activities (ROPA)
- **Requires:** Controllers keep written/electronic records: controller (+ rep/DPO) details, purposes, categories of subjects and data, categories of recipients (incl. third countries), third-country transfers + safeguards, retention periods, and a general description of security measures. Processors keep records of processing categories carried out for each controller. Make available to the supervisory authority on request. The **under-250-employees exemption** does **not** apply if processing is not occasional, is likely to risk rights/freedoms, or involves special-category/criminal data — so most data-handling SaaS must keep a ROPA.
- **In code:** Generate the ROPA from the data inventory + sub-processor register (purposes, categories, recipients, transfers, retention, security summary); keep it versioned and exportable for a regulator.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 30(1)–(5)

### Art. 32 — Security of processing
- **Requires:** Implement appropriate technical/organisational measures given state of the art and risk, including as appropriate: (a) pseudonymisation and **encryption**; (b) ongoing **confidentiality, integrity, availability, and resilience** of systems; (c) ability to **restore availability and access** in a timely manner after an incident; (d) a process for **regularly testing/assessing** the effectiveness of measures. Ensure anyone acting under your authority processes only on instruction.
- **In code:** TLS 1.2+ in transit + AES-256 at rest + managed key rotation (a); RLS/RBAC/MFA/least-privilege, pseudonymised IDs (b); tested, isolated backups + restore runbook with RTO/RPO (c); periodic restore drills, dependency/vuln scanning, pen/access reviews (d).
- **Primitive:** 1. Encryption (TLS+AES, key mgmt)
- **Cite:** Art. 32(1)(a)–(d), 32(2)–(4)

### Art. 33 — Breach notification to the supervisory authority
- **Requires:** Notify the competent supervisory authority **without undue delay and, where feasible, within 72 hours** of becoming aware of a personal data breach, unless it is unlikely to risk rights/freedoms. The notice must describe the nature of the breach, categories/approximate numbers of subjects and records, the DPO contact, likely consequences, and measures taken/proposed. A **processor must notify its controller without undue delay**. **Document all breaches** (facts, effects, remedial action) regardless of notifiability.
- **In code:** Detect→log→timeline→notify pipeline tuned to the 72h clock; an immutable breach log capturing awareness time and facts; processor-side alerting to controllers; a notification template with the required fields.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** Art. 33(1)–(5)

### Art. 34 — Breach communication to data subjects
- **Requires:** When a breach is likely to result in a **high risk** to rights/freedoms, communicate it to affected data subjects **without undue delay**, in clear plain language, with the DPO contact, likely consequences, and measures. **Not required** if (a) you had appropriate protection (e.g. encryption rendering data unintelligible) applied to the affected data, (b) you took subsequent measures ensuring the high risk no longer materialises, or (c) it would involve disproportionate effort (then use public communication).
- **In code:** A subject-notification path (email/in-app) gated on a high-risk assessment; encryption-at-rest as the documented basis for the Art. 34(3)(a) exemption; a public-notice fallback for mass breaches.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** Art. 34(1)–(4)

### Art. 35 — Data protection impact assessment (DPIA)
- **Requires:** Where processing (esp. using new tech) is **likely to result in a high risk**, run a DPIA before processing. Mandatory at least for: (a) systematic, extensive evaluation/profiling with legal/significant effects; (b) large-scale processing of special-category or criminal-conviction data; (c) systematic large-scale monitoring of a publicly accessible area. The DPIA must describe the processing, assess necessity/proportionality, assess risks, and set out mitigations; seek the DPO's advice; consult data subjects' views where appropriate.
- **In code:** A DPIA gate on high-risk features (new AI/profiling, biometric, large-scale tracking) in the feature-kickoff workflow; a stored DPIA template with the four required sections; trigger logic keyed to the inventory's sensitive-field/profiling tags.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 35(1)–(7)

### Art. 36 — Prior consultation
- **Requires:** Where a DPIA shows a high residual risk that you cannot mitigate, **consult the supervisory authority before** processing. The authority responds within 8 weeks (extendable). Provide the ROPA, purposes/means, mitigations, and DPO details on request.
- **In code:** A decision step after the DPIA: if residual risk stays high, halt launch and route to prior consultation; record the consultation and outcome before go-live.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** Art. 36(1)–(3)

### Arts. 37–39 — Data Protection Officer (DPO)
- **Requires:** Designate a DPO where (a) processing is by a public authority, (b) core activities require **regular and systematic large-scale monitoring**, or (c) core activities involve **large-scale special-category/criminal** data. The DPO must have expert knowledge, be given resources and independence, report to top management, not be penalised or conflicted, and be published + notified to the authority (Art. 37). The DPO's tasks include informing/advising, monitoring compliance, advising on DPIAs, cooperating with and being the contact point for the authority (Arts. 38–39).
- **In code:** Not code — assess whether the (b)/(c) triggers apply; most small SaaS won't meet "large scale," but if you do, appoint and publish a DPO and record them in the ROPA/notice; otherwise document the assessment that no DPO is required.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Arts. 37(1)–(7), 38(1)–(6), 39(1)–(2)

### Art. 44 — General principle for international transfers
- **Requires:** Any transfer of personal data to a third country or international organisation (incl. onward transfers) is allowed only if the controller/processor meets the Chapter V conditions, so the level of protection is not undermined.
- **In code:** Inventory where data physically lives and which sub-processors are outside the EEA; pin EU regions on Supabase/Fly/Cloudflare/Vercel where possible to avoid a transfer at all; flag every egress in the sub-processor register.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Art. 44

### Art. 45 — Transfers via an adequacy decision
- **Requires:** Transfer freely (no extra authorisation) to a third country/organisation the Commission has found to ensure an **adequate** level of protection.
- **In code:** Check the current Commission adequacy list (e.g. UK, Switzerland, and the EU–US Data Privacy Framework for certified US recipients) per destination; record the adequacy basis against each cross-border sub-processor; re-check on the periodic review cadence since adequacy can be revoked.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Art. 45(1)–(9)

### Art. 46 — Transfers subject to appropriate safeguards
- **Requires:** Absent adequacy, transfer only with appropriate safeguards and enforceable data-subject rights — most relevantly **Standard Contractual Clauses (SCCs)** adopted by the Commission, or **Binding Corporate Rules**; plus a transfer impact assessment (per CJEU *Schrems II*) where needed.
- **In code:** Execute Commission SCCs (or rely on a vendor's DPF certification) with every non-adequate-country sub-processor (common for US LLM/email/analytics vendors); store the signed SCCs + transfer impact assessment in the DPA register; apply supplementary measures (encryption, pseudonymisation) where the assessment requires.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Art. 46(1)–(5)

### Art. 47 — Binding Corporate Rules
- **Requires:** Intra-group transfers may rely on BCRs — legally binding, supervisory-authority-approved internal policies covering all group members, specifying structure, transfers, rights, and enforcement.
- **In code:** Generally not relevant to a solo founder/small team (no multinational group); note as N/A unless you operate group entities, in which case prefer SCCs over the heavier BCR approval.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Art. 47(1)–(3)

### Art. 49 — Derogations for specific situations
- **Requires:** Where neither adequacy nor safeguards exist, transfer only under a narrow derogation: (a) explicit informed consent to the risks; (b) necessary for a contract with the subject; (c) contract in the subject's interest; (d) important public interest / legal claims; (e) vital interests; (f) from a public register. Most are limited to **non-repetitive transfers of a limited number** of subjects, require documenting the compelling legitimate interest, and informing the data subject.
- **In code:** Treat derogations as exceptional, not an architecture — don't route routine product data on consent-derogation; if used, capture the explicit consent + risk disclosure and document the basis in the ROPA.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** Art. 49(1)–(6)

## Evidence to retain
- **Records of processing (ROPA)** — Art. 30 register: purposes, data/subject categories, recipients, transfers + safeguards, retention, security summary; exportable for the supervisory authority.
- **Lawful-basis & consent evidence** — basis per activity; timestamped/versioned consent and withdrawal logs; Legitimate Interests Assessments; verifiable parental consent for children (Art. 8).
- **Privacy notices** — versioned Art. 13/14 notices tied to the consent copy versions in force.
- **DSAR logs** — every access/rectify/erase/restrict/portability/object request with receipt date, identity verification, action taken, deadline met, and any exemption relied on (Arts. 12–22).
- **DPIAs and prior-consultation records** — for high-risk processing (Arts. 35–36), incl. residual-risk decisions.
- **Security evidence** — encryption config, RLS/RBAC/MFA setup, key rotation, backup/restore test results, vuln-scan and access-review records (Art. 32).
- **DPA / sub-processor register** — signed Art. 28 DPAs, sub-processor authorisations, SCCs + transfer impact assessments, adequacy/DPF bases per cross-border vendor (Arts. 28, 44–49).
- **Breach log** — all breaches with awareness time, facts, effects, risk assessment, remedial action, and copies of any Art. 33 authority notifications and Art. 34 subject communications.
- **Governance artefacts** — data-protection policy, DPO designation/assessment, and EU-representative appointment where applicable (Arts. 24, 27, 37).

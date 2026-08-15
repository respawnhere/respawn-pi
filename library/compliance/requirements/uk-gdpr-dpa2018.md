# UK GDPR + Data Protection Act 2018 — requirements checklist

> Source: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/ · https://www.legislation.gov.uk/eur/2016/679/contents (UK GDPR, retained Reg. 2016/679) · https://www.legislation.gov.uk/ukpga/2018/12/contents (DPA 2018) · https://www.legislation.gov.uk/ukpga/2025/18/contents (Data (Use and Access) Act 2025) · retrieved 2026-06-20 · Crown copyright, Open Government Licence v3.0 — legislation summarised freely with citation. Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

The obligation set is substantively the **same as EU GDPR** — if you have built for EU GDPR you are ~95% there. This file enumerates the full set but flags the **UK DELTAS** (⚑) you must handle separately: UK transfer instruments (IDTA / UK Addendum / new "data protection test"), the UK adequacy list, ICO breach reporting, UK representative, age-13 consent threshold, and DPA 2018 special-category/criminal-offence conditions + appropriate policy document. **2026 note:** the **Data (Use and Access) Act 2025 (DUAA)** is now amending the regime (most data-protection provisions commencing through 2025–2026; Art. 45 adequacy and Art. 46 transfers re-cast from 5 Feb 2026). Verify exact commencement of each DUAA section against the official source before relying on it.

## Applies when
- You process **personal data of individuals in the UK** as a controller or processor — **no size or revenue threshold** (one UK data subject triggers it). Applies to non-UK businesses that offer goods/services to, or monitor the behaviour of, people in the UK (extraterritorial, UK GDPR Art. 3).
- "Personal data" = any info relating to an identified/identifiable living individual; "special category data" (Art. 9) and "criminal offence data" (Art. 10 / DPA s.10) carry extra conditions.
- DPA 2018 supplies the UK-specific conditions, exemptions, age threshold, and ICO/enforcement machinery that sit underneath the UK GDPR.
- Separate but adjacent: **PECR** (cookies/e-marketing) sits on top — see the ePrivacy/PECR checklist. Fines up to **£17.5M or 4%** of global annual turnover (DPA 2018 ss.155–157).

## Requirements

### P1 — Data protection principles (Art. 5(1))
- **Requires:** Process personal data (a) lawfully, fairly, transparently; (b) for specified, explicit, legitimate purposes (purpose limitation); (c) adequate, relevant, limited to what is necessary (data minimisation); (d) accurate and kept up to date; (e) kept in identifiable form no longer than necessary (storage limitation); (f) processed securely (integrity & confidentiality).
- **In code:** Tag every field with a purpose + lawful basis in the data inventory; reject collection of fields with no declared purpose; accuracy/correction flows; retention clock per dataset; encryption + access control enforce (f).
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** UK GDPR Art. 5(1)(a)–(f)

### P2 — Accountability (Art. 5(2))
- **Requires:** The controller is **responsible for, and must be able to demonstrate, compliance** with all principles. This is the backbone obligation — every other control is evidence for it.
- **In code:** Maintain ROPA, DPIAs, consent records, audit logs, retention schedules, vendor register, and an appropriate policy document as durable, exportable artefacts; version your privacy policy.
- **Primitive:** 6. Immutable audit logging
- **Cite:** UK GDPR Art. 5(2)

### L1 — Lawful basis for processing (Art. 6)
- **Requires:** Each processing activity needs at least one of six bases: (a) consent; (b) contract; (c) legal obligation; (d) vital interests; (e) public task; (f) legitimate interests (with a balancing test / LIA). ⚑ DUAA adds a list of **"recognised legitimate interests"** (DUAA Sch. 4) that do not require the balancing test. Basis must be identified **before** processing and recorded.
- **In code:** Per-purpose `lawful_basis` enum in the inventory; legitimate-interest assessments stored; do not silently switch basis. Gate processing on a recorded basis.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** UK GDPR Art. 6(1)(a)–(f); DUAA Sch. 4 (recognised legitimate interests)

### L2 — Conditions for consent (Art. 7)
- **Requires:** Where consent is the basis: freely given, specific, informed, unambiguous; demonstrable (record it); as easy to withdraw as to give; not bundled into T&Cs.
- **In code:** Granular, timestamped, withdrawable consent records keyed to (user, purpose, version); one-click withdrawal that propagates to downstream processing/tags.
- **Primitive:** 3. Consent + preference store
- **Cite:** UK GDPR Art. 7

### L3 ⚑ — Child's consent, information society services — AGE 13 (Art. 8)
- **Requires:** For ISS offered directly to a child on a consent basis, consent is valid where the child is **at least 13** (the UK lowered the GDPR default of 16 to **13** via the EU Exit Regs 2019; DPA 2018 s.9 was omitted on EU-exit and the threshold now sits in Art. 8(1) as applied in the UK). Below 13, a holder of parental responsibility must consent/authorise; make reasonable efforts to verify, considering available technology. ⚑ DUAA gives the Secretary of State power to adjust the threshold within 13–16 by regulation, and adds **"children's higher protection matters"** in data-protection-by-design (DUAA s.81).
- **In code:** Age-self-declaration gate → if <13, parental-consent flow + stored authorisation record; default child accounts to high-privacy settings (no behavioural tracking); follow the ICO Children's Code (Age Appropriate Design Code).
- **Primitive:** 3. Consent + preference store
- **Cite:** UK GDPR Art. 8(1) (UK "13"); DPA 2018 s.9 (omitted 31.12.2020); DUAA s.81

### L4 ⚑ — Special category data conditions (Art. 9 + DPA Sch. 1)
- **Requires:** Processing of special-category data (race/ethnicity, political opinions, religion, trade-union membership, genetics, biometrics for ID, health, sex life/orientation) is **prohibited** unless an Art. 9(2) exception applies. ⚑ For the UK-relevant exceptions you must **also** meet a DPA 2018 condition: Art. 9(2)(b)/(h)/(i)/(j) → a condition in **Schedule 1 Part 1**; Art. 9(2)(g) substantial public interest → a condition in **Schedule 1 Part 2** (28 named conditions: e.g. statutory/government purposes, equality monitoring, preventing/detecting unlawful acts, fraud prevention, safeguarding, insurance, counselling). Several conditions require an **appropriate policy document** (see SC1).
- **In code:** Tag special-category fields explicitly; default-deny access; require an Art. 9 exception + recorded DPA Sch. 1 condition before such a field is collected/processed; encryption + tightest RLS on these columns.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** UK GDPR Art. 9; DPA 2018 s.10(1)–(3) & Sch. 1 Parts 1–2

### L5 ⚑ — Criminal offence data conditions (Art. 10 + DPA Sch. 1 Part 3)
- **Requires:** Processing of criminal-conviction/offence data may only be done under official authority **or** when authorised by UK law; the UK authorisation is a condition in **Schedule 1 Part 1, 2 or 3** (Part 3 conditions include explicit consent, vital interests, not-for-profit bodies, data made public by the data subject, legal claims, judicial acts, fraud/anti-money-laundering, safeguarding). Maintain a full register only if you have official authority.
- **In code:** Treat criminal-offence fields like special-category: explicit tag, default-deny, recorded DPA Sch. 1 Part 1–3 condition, appropriate policy document where required, strict access logging.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** UK GDPR Art. 10; DPA 2018 s.10(4)–(5) & Sch. 1 Part 3

### T1 — Transparency / privacy notices (Arts. 12–14)
- **Requires:** Provide concise, transparent, intelligible, free information about processing. **Art. 13** (data collected from the individual) and **Art. 14** (data obtained from elsewhere) prescribe what the privacy notice must contain: identity/contact of controller, DPO contact, purposes + lawful basis, recipients, retention periods, the data-subject rights, right to complain to the ICO, any international transfers + safeguards, existence of automated decision-making. Art. 12 sets the modalities (clear language, accessible, generally free).
- **In code:** Versioned privacy policy generated from the data inventory so it stays in sync with actual fields/purposes/sub-processors; surface "how we use your data" + rights + ICO complaint link in-product.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** UK GDPR Arts. 12, 13, 14

### R1 — Right of access / DSAR (Art. 15)
- **Requires:** On request, confirm whether you process the person's data and provide a copy plus the Art. 15 metadata (purposes, categories, recipients, retention, rights, source, automated-decision logic). ⚑ Respond **without undue delay and within one month** (extendable by two months for complex requests). ⚑ DUAA clarifies the clock can be **paused (stop-the-clock)** while you seek ID/clarification, and reframes the searches as "reasonable and proportionate" (DUAA ss.75–79). Generally free.
- **In code:** Self-serve "download my data" export covering DB + backups + caches + analytics + sub-processors, keyed by (user); identity-verification step; admin queue with a one-month SLA timer and stop-the-clock state.
- **Primitive:** 2. DSAR engine
- **Cite:** UK GDPR Art. 15; DUAA ss.75–79 (fees, time limits, reasonable searches, stop-the-clock)

### R2 — Right to rectification (Art. 16)
- **Requires:** Correct inaccurate personal data and complete incomplete data without undue delay; notify recipients where feasible (Art. 19).
- **In code:** User-facing edit/correction flow; admin correction tool; propagate corrections to sub-processors/analytics; log the change.
- **Primitive:** 2. DSAR engine
- **Cite:** UK GDPR Arts. 16, 19

### R3 — Right to erasure / "right to be forgotten" (Art. 17)
- **Requires:** Delete data on the listed grounds (no longer necessary, consent withdrawn, unlawful processing, legal obligation, etc.), subject to exemptions; notify recipients (Art. 19); if you made the data public, take reasonable steps to inform other controllers (Art. 17(2)).
- **In code:** Hard-delete pipeline across DB + backups + caches + logs + sub-processors; erasure propagation to processors; record what was erased and when; retain only what an exemption justifies.
- **Primitive:** 7. Retention + deletion jobs
- **Cite:** UK GDPR Arts. 17, 19

### R4 — Right to restriction of processing (Art. 18)
- **Requires:** On the listed grounds (accuracy contested, processing unlawful, etc.), restrict so data is stored but not otherwise processed; notify recipients (Art. 19).
- **In code:** A per-record `processing_restricted` flag that all processing paths honour (export/analytics/marketing pause), with audit of the restriction event.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** UK GDPR Arts. 18, 19

### R5 — Right to data portability (Art. 20)
- **Requires:** Where processing is by consent or contract **and** carried out by automated means, provide the data the person gave you in a **structured, commonly used, machine-readable** format, and transmit directly to another controller where technically feasible.
- **In code:** Export endpoint emitting JSON/CSV of user-provided data; documented schema; optional direct-transfer.
- **Primitive:** 2. DSAR engine
- **Cite:** UK GDPR Art. 20

### R6 — Right to object (Art. 21)
- **Requires:** Allow objection to processing based on legitimate interests/public task (you must stop unless compelling legitimate grounds), and an **absolute** right to object to **direct marketing** (must stop immediately).
- **In code:** A marketing/processing opt-out that hard-suppresses across email/SMS/ad audiences; honour at first request; persist as a preference.
- **Primitive:** 3. Consent + preference store
- **Cite:** UK GDPR Art. 21

### R7 ⚑ — Automated individual decision-making & profiling (Art. 22)
- **Requires:** Right not to be subject to a solely automated decision with legal/similarly significant effect, except where contract/consent/UK-law-authorised — with safeguards: human intervention, ability to express a view, contest the decision. ⚑ DUAA **reforms Art. 22**: solely-automated significant decisions are broadly permitted on any lawful basis **provided** safeguards (information, human review, contest) are in place, with tighter rules where special-category data is involved (DUAA s.80 & Sch. 6).
- **In code:** Flag any solely-automated significant decision; provide explanation + a human-review/appeal route; extra gate if special-category inputs; log decisions for contestability.
- **Primitive:** 6. Immutable audit logging
- **Cite:** UK GDPR Art. 22; DUAA s.80 & Sch. 6

### R8 ⚑ — Complaints to the controller (DUAA)
- **Requires:** ⚑ DUAA adds a duty to **facilitate complaints by data subjects** to the controller (accessible complaint route, acknowledge, respond within set period) before/alongside escalation to the ICO (DUAA s.103 & Sch. 10).
- **In code:** In-product "raise a data-protection complaint" form → ticket with acknowledgement + response SLA; route to your privacy contact; log.
- **Primitive:** 2. DSAR engine
- **Cite:** DUAA s.103 & Sch. 10; UK GDPR Art. 77 (right to complain to the Commissioner)

### G1 — Controller responsibility (Art. 24)
- **Requires:** Implement appropriate technical and organisational measures, proportionate to risk, to ensure and demonstrate compliance; review and update them; maintain data-protection policies where proportionate.
- **In code:** Documented security/privacy policies, the appropriate policy document, change-controlled config; this requirement is satisfied by the aggregate of the other primitives plus their evidence.
- **Primitive:** 6. Immutable audit logging
- **Cite:** UK GDPR Art. 24

### G2 — Data protection by design and by default (Art. 25)
- **Requires:** Build in data-protection measures (e.g. pseudonymisation, minimisation) at design time and **by default** process only data necessary for each purpose (default-private). ⚑ DUAA adds children's "higher protection matters" to the by-design duty (DUAA s.81).
- **In code:** Default-deny field collection; privacy-preserving defaults (no public profiles, no behavioural tracking by default); pseudonymise/encrypt sensitive fields; DPIA-gate risky features; high-privacy defaults for child users.
- **Primitive:** 1. Encryption (TLS + AES, key mgmt)
- **Cite:** UK GDPR Art. 25; DUAA s.81

### G3 — Processor contracts / Art. 28 DPA (Art. 28)
- **Requires:** Use only processors giving sufficient guarantees; a **written contract (Art. 28(3))** must bind every processor — documented instructions, confidentiality, security (Art. 32), sub-processor authorisation, assistance with rights/breaches, deletion/return at end, audit rights. ⚑ For UK sub-processors handling personal data you need a **UK-flavoured DPA**; confirm Supabase/Fly/Cloudflare/Vercel/email/SMS/LLM vendors each offer one before routing UK personal data to them.
- **In code:** A vendor/sub-processor register flagging contract type (DPA) and status per vendor; block routing regulated data to a vendor without a signed DPA; maintain a public sub-processor list.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** UK GDPR Art. 28

### G4 ⚑ — Records of processing activities / ROPA (Art. 30)
- **Requires:** Maintain written records of processing: purposes, categories of data subjects/data, recipients (incl. third countries), transfer safeguards, retention, security-measures description. (EU GDPR exempts <250-staff orgs unless risky/regular/special-category — ⚑ in practice most products process regularly, so keep a ROPA. DUAA simplifies the record-keeping duty but does not remove it for higher-risk processing.)
- **In code:** ROPA generated from the data inventory (one row per processing activity); regenerate on schema/vendor change; export on demand.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** UK GDPR Art. 30

### S1 — Security of processing (Art. 32)
- **Requires:** Appropriate technical/organisational security to the risk, including (as appropriate) **pseudonymisation and encryption**; confidentiality, integrity, availability, resilience; ability to restore availability after an incident; a process to regularly test/assess effectiveness.
- **In code:** TLS 1.2+ in transit, AES-256 at rest, managed key rotation; tested isolated backups + restore drills; vuln scanning + patch SLA; pseudonymise where feasible. Maps to the same control set as SOC 2 / ISO 27001 / NIS2.
- **Primitive:** 1. Encryption (TLS + AES, key mgmt)
- **Cite:** UK GDPR Art. 32

### S2 — Access control & least privilege (Art. 32(1)(b)/(4))
- **Requires:** Ensure ongoing confidentiality; staff/processors process only on instructions; restrict access to those who need it.
- **In code:** Postgres RLS + RBAC, MFA on all admin/console access, scoped service tokens, least-privilege IAM, quarterly access reviews, session timeout. Keep personal data out of logs/error-trackers/LLM prompts unless the vendor is under DPA.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** UK GDPR Art. 32(1)(b), 32(4)

### B1 ⚑ — Breach notification to the ICO — 72 HOURS (Art. 33)
- **Requires:** Notify the supervisory authority of a personal-data breach **without undue delay and, where feasible, within 72 hours** of becoming aware, unless unlikely to risk individuals' rights and freedoms. Notification must describe the breach (categories/approx. numbers of data subjects and records), DPO/contact point, likely consequences, and measures taken/proposed; may be phased. ⚑ In the UK the recipient is the **ICO** (report via the ICO online breach-reporting tool or the ICO breach helpline). **Document all breaches** (Art. 33(5)) whether or not reportable.
- **In code:** Detect→log→timeline→notify pipeline that can hit a 72h clock; a breach register (cause, scope, effect, remediation) retained as evidence; an ICO-report runbook with the required fields pre-mapped.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** UK GDPR Art. 33; DPA 2018 (Commissioner = ICO)

### B2 — Breach communication to data subjects (Art. 34)
- **Requires:** Where a breach is likely to result in a **high risk** to individuals, communicate to them without undue delay in clear language (nature of breach, DPO contact, likely consequences, measures), unless encryption rendered the data unintelligible, mitigation removed the high risk, or it would involve disproportionate effort (then a public communication).
- **In code:** A user-notification path (email/in-app) parameterised by breach scope from the data inventory; the encryption you already deploy is an explicit exemption lever (note it in the runbook).
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** UK GDPR Art. 34

### D1 — Data protection impact assessment (Art. 35)
- **Requires:** Conduct a DPIA before processing likely to result in **high risk** (e.g. large-scale special-category, systematic monitoring, new tech, profiling with significant effects). Must describe processing, assess necessity/proportionality and risks, and the mitigating measures. Consult the ICO beforehand if residual high risk remains (Art. 36).
- **In code:** A DPIA template gated into the feature workflow for risky processing; store completed DPIAs as accountability evidence; an ICO prior-consultation trigger for unmitigated high risk.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** UK GDPR Arts. 35, 36

### D2 — Prior consultation with the ICO (Art. 36)
- **Requires:** Where a DPIA shows processing would be high risk absent mitigation, consult the ICO before processing.
- **In code:** Decision gate: if DPIA residual risk = high, block launch pending ICO consultation; record the consultation.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** UK GDPR Art. 36

### O1 ⚑ — Data protection officer / senior responsible individual (Arts. 37–39)
- **Requires:** Designate a **DPO** where core activities involve large-scale regular/systematic monitoring or large-scale special-category/criminal-offence processing; the DPO must be resourced, independent, and reachable; publish and notify their contact to the ICO. ⚑ DUAA **replaces the DPO concept for many organisations with a "Senior Responsible Individual"** at management level with defined data-protection responsibilities (verify which regime applies to you post-commencement).
- **In code:** Name a privacy contact (DPO or SRI) in the privacy policy and ROPA; publish their email; even if no DPO is mandatory, designate an accountable owner.
- **Primitive:** 6. Immutable audit logging
- **Cite:** UK GDPR Arts. 37, 38, 39; DUAA (Senior Responsible Individual)

### O2 ⚑ — UK representative (Art. 27)
- **Requires:** ⚑ A controller/processor **not established in the UK** that is caught by Art. 3(2) (offering goods/services to, or monitoring, people in the UK) must designate **in writing a representative in the United Kingdom**, addressable by the ICO and data subjects. **Exempt** where processing is occasional, does not involve large-scale special-category/criminal data, and is unlikely to risk individuals — or where you are a public authority.
- **In code:** If the entity is outside the UK and not exempt, appoint and name a UK representative in the privacy notice + ROPA; otherwise document the exemption analysis.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** UK GDPR Art. 27

### IT1 ⚑ — Lawful international transfers (Arts. 44–46) — UK INSTRUMENTS
- **Requires:** Transfers of UK personal data to a third country are only lawful with a transfer mechanism. ⚑ UK specifics: (1) **adequacy** is decided by the **UK Secretary of State** ("adequacy regulations" / the UK "data bridges" list — check the **UK** adequacy list, not the EU one; EU/EEA + the EU's own adequacy partners are covered transitionally); ⚑ (2) absent adequacy, use the **UK International Data Transfer Agreement (IDTA)** or the **UK Addendum** to the EU SCCs (not bare EU SCCs) plus a transfer-risk assessment. ⚑ **DUAA recast (from 5 Feb 2026):** Art. 45 adequacy and Art. 46 safeguards are replaced by a new **"data protection test"** — a transfer is permitted where the standard of protection in the destination would **not be materially lower** than under UK law; safeguards include UK BCRs, Secretary-of-State-specified standard clauses (Art. 47A) and ICO-issued standard clauses (DPA s.119A).
- **In code:** Prefer a **UK/EU data region** on managed infra; for any onward transfer to a non-adequate country, attach an IDTA/Addendum (or Art. 47A clauses) + a recorded transfer-risk / "data protection test" assessment in the vendor register; flag each sub-processor's hosting region.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** UK GDPR Arts. 44, 45 (omitted 5.2.2026), 46 (recast 5.2.2026), 47A; DPA 2018 s.119A; DUAA s.85 & Schs. 7–9

### IT2 — Transfer derogations (Art. 49)
- **Requires:** In the absence of adequacy or safeguards, transfers may rely on limited derogations (explicit informed consent, contract necessity, important public-interest reasons, legal claims, vital interests) — narrowly construed and not for routine/bulk transfers.
- **In code:** Only use a derogation for genuinely occasional transfers; record which derogation, the basis, and the information given to the data subject.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA)
- **Cite:** UK GDPR Art. 49

### SC1 ⚑ — Appropriate policy document & extra safeguards (DPA Sch. 1 Part 4)
- **Requires:** ⚑ Where you rely on many DPA Sch. 1 conditions for special-category/criminal-offence processing, you must have an **appropriate policy document** explaining how you comply with the Art. 5 principles and your **retention/erasure** policy for that data; **retain it during processing and for 6 months after**, review it regularly, and **provide it to the ICO on request**. Your Art. 30 record must additionally identify the Sch. 1 condition relied on, the Art. 6 basis, and whether retention/erasure was complied with.
- **In code:** Maintain a versioned appropriate-policy-document artefact in the spine; link each special-category/criminal field's Sch. 1 condition to it; record retention/erasure compliance in the ROPA row.
- **Primitive:** 7. Retention + deletion jobs
- **Cite:** DPA 2018 Sch. 1 Part 4, paras 39–41

### SC2 ⚑ — Exemptions (DPA Sch. 2–4)
- **Requires:** ⚑ DPA 2018 provides UK exemptions that modify/restrict certain rights and obligations in defined situations — e.g. crime/taxation, regulatory functions, journalism/academic/artistic/literary, research/statistics/archiving, legal professional privilege, management forecasts, negotiations, references, exam scripts. Apply only the specific exemption that fits, and only to the extent necessary.
- **In code:** Allow a DSAR/erasure response to record an applied exemption (which one, why, scope) rather than silently dropping data; never use an exemption as a blanket.
- **Primitive:** 2. DSAR engine
- **Cite:** DPA 2018 ss.15–26 & Schs. 2, 3, 4

### EN1 — Cooperation, ICO powers & enforcement (DPA 2018 Part 6)
- **Requires:** Cooperate with the ICO; respond to **information notices**, **assessment notices**, and **enforcement notices**; the ICO may impose **penalty notices** up to **£17.5M or 4%** of global turnover. ⚑ DUAA renames/restructures the regulator as the **Information Commission** (Part 6 of DUAA) — functions transfer from the Information Commissioner.
- **In code:** Keep all accountability artefacts (ROPA, DPIAs, consent + audit logs, breach register, policy document, vendor register) readily exportable so an ICO request can be answered quickly; designate a responder.
- **Primitive:** 6. Immutable audit logging
- **Cite:** DPA 2018 ss.142–158 (Part 6); DUAA Part 6 (Information Commission)

## Evidence to retain
- **ROPA / data inventory** (Art. 30) — current, generated from the schema; per-activity purpose, lawful basis, recipients, transfers + safeguards, retention.
- **Lawful-basis register + LIAs** (Art. 6) and **recognised-legitimate-interest** mapping.
- **Consent records** (Art. 7) — granular, timestamped, withdrawable, versioned; child/parental-consent records (Art. 8).
- **Privacy notices** (Arts. 13–14) — version history showing they tracked actual processing.
- **DSAR / rights logs** (Arts. 15–22) — request, identity check, stop-the-clock periods, one-month-SLA evidence, exemptions applied, fulfilment proof; complaint-handling log (DUAA s.103).
- **DPIAs** (Art. 35) for high-risk processing + any ICO prior-consultation records (Art. 36).
- **Appropriate policy document** (DPA Sch. 1 Part 4) — retained during processing + 6 months after, with review dates.
- **Processor/sub-processor register + signed DPAs** (Art. 28); **UK representative** designation (Art. 27); **transfer instruments** — IDTA/UK Addendum/Art. 47A clauses + transfer-risk / "data protection test" assessments per vendor.
- **Breach register** (Art. 33(5)) — all breaches with cause/scope/effect/remediation; **ICO 72h report** copies and any Art. 34 individual notifications.
- **Security evidence** (Art. 32) — encryption config + key management, RLS/RBAC, MFA, access-review records, backup-restore test results, vuln-scan + patch records.
- **Retention & deletion logs** (Arts. 5(1)(e), 17) — schedules + proof of scheduled deletion and erasure propagation to sub-processors.
- **DPO/SRI designation** and published contact; governance/policy documents and management-review records (Arts. 24, 5(2)).

# EU AI Act — Regulation (EU) 2024/1689 — requirements checklist
> Source: https://eur-lex.europa.eu/eli/reg/2024/1689/oj · Regulation (EU) 2024/1689 (Artificial Intelligence Act) · retrieved 2026-06-22 · EUR-Lex content is reusable with attribution (© European Union, https://eur-lex.europa.eu, 1998–2026; Decision 2011/833/EU). Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- The Regulation is **risk-tiered, not size-based** — there is no SME exemption from the substantive obligations (only lighter administrative/documentation paths and regulatory-sandbox priority). Whether you are in scope and at which tier depends on *what the AI system does*, not your headcount or revenue.
- You are a **provider** (you develop an AI system or GPAI model, or have one developed, and place it on the market / put it into service in the EU under your own name or trademark) and/or a **deployer** (you use an AI system under your authority in a professional capacity). Most solo SaaS embedding an LLM are **providers of a limited-risk AI system** and **deployers** of an upstream foundation model.
- **Extraterritorial by output (Art. 2):** applies to providers placing systems on the EU market regardless of where established, and to providers/deployers established outside the EU **where the output of the system is used in the EU**. A non-EU founder shipping an AI feature to EU users is in scope.
- **GDPR runs in parallel.** Whenever the AI system processes personal data you remain a controller/processor under Regulation (EU) 2016/679 — Art. 5 prohibitions, Art. 10 data governance, and Art. 50 transparency sit *on top of* GDPR lawfulness, DPIA, and transparency duties, not instead of them.
- **Most LLM product features are limited-risk** and owe only **Art. 50 transparency** (AI-interaction disclosure + marking of synthetic content). Treat the high-risk regime (Art. 6 + Annex III, Arts. 8–15) as something to **design to stay OUT of** — keep AI in an assistive, non-determinative role for hiring, credit, education, biometrics, essential services, etc.
- **Phased application (Art. 113), against the published 2024/1689 baseline:**
  - **2 Feb 2025** — Chapter I (general provisions) + Chapter II **Art. 5 prohibited practices**, and AI-literacy duty (Art. 4).
  - **2 Aug 2025** — Chapter V **GPAI model obligations** (Arts. 53–55), governance bodies, penalties (Art. 99), confidentiality.
  - **2 Aug 2026** — general application, including **Art. 50 transparency** and Annex III high-risk classification under Art. 6(2).
  - **2 Aug 2027** — high-risk systems that are safety components under Art. 6(1) (Annex I product legislation).
- **VERIFY before relying on dates:** the **"Digital Omnibus" simplification package** (Commission proposal 19 Nov 2025; Council/Parliament provisional agreement reported 7 May 2026) would **defer two distinct high-risk deadlines**: **stand-alone Annex III high-risk systems to 2 December 2027**, and **AI embedded in Annex I regulated products to 2 August 2028** — and adjust documentation duties. The same package also introduces a **new Art. 5 prohibition** on **AI-generated non-consensual intimate imagery and CSAM** (covering image, video, and audio — "nudifiers"), with compliance envisaged by **2 December 2026**. All of these remain **provisional only until OJ publication**. Until the package is **formally adopted and published in the OJ**, Regulation (EU) 2024/1689 as cited here remains the legal baseline. Re-confirm the effective dates and any amended article text before a launch decision.

## Requirements

### Art. 5(1)(a) — Prohibited: subliminal / manipulative / deceptive techniques
- **Requires:** No AI system that deploys subliminal, purposefully manipulative, or deceptive techniques to materially distort behaviour in a way that causes (or is likely to cause) significant harm.
- **In code:** Do not build dark-pattern or covert-influence features (hidden nudges, manipulative chatbots steering vulnerable users). Document a design rationale for any persuasive UX; gate behind product/legal review.
- **Primitive:** 8. Incident-response + breach pipeline (capture and escalate suspected prohibited-use reports)
- **Cite:** Art. 5(1)(a)

### Art. 5(1)(b) — Prohibited: exploiting vulnerabilities
- **Requires:** No AI that exploits vulnerabilities of a person or group due to age, disability, or a specific social or economic situation, to materially distort behaviour causing significant harm.
- **In code:** Avoid targeting logic keyed to protected-vulnerability signals; tag any age/disability/socioeconomic fields in the data inventory as sensitive and block their use in behaviour-shaping models.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 5(1)(b)

### Art. 5(1)(c) — Prohibited: social scoring
- **Requires:** No general-purpose social scoring of natural persons over time from behaviour or inferred personality traits where it leads to detrimental treatment in unrelated contexts or that is unjustified/disproportionate.
- **In code:** Do not aggregate cross-context behavioural scores that feed adverse user treatment; keep any trust/reputation score scoped, justified, and contextual.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 5(1)(c)

### Art. 5(1)(d) — Prohibited: predictive policing by profiling
- **Requires:** No AI that assesses/predicts the risk of a person committing a criminal offence based solely on profiling or personality traits (narrow exception for systems supporting human assessment grounded in objective, verifiable facts).
- **In code:** Out of scope for typical SaaS — do not build individual crime-risk prediction. Flag as prohibited if a customer requests it.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** Art. 5(1)(d)

### Art. 5(1)(e) — Prohibited: untargeted facial-image scraping
- **Requires:** No creation or expansion of facial-recognition databases through untargeted scraping of facial images from the internet or CCTV.
- **In code:** Never scrape faces to build/enrich a recognition dataset. If you ingest images, exclude facial-template extraction; record provenance in the data inventory.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 5(1)(e)

### Art. 5(1)(f) — Prohibited: emotion recognition in workplace / education
- **Requires:** No AI to infer emotions of natural persons in workplace or educational settings (except for medical or safety reasons).
- **In code:** Do not ship emotion-inference on employees or students. If a feature analyses sentiment, scope it to product/customer-support content, not worker/learner monitoring.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 5(1)(f)

### Art. 5(1)(g) — Prohibited: sensitive biometric categorisation
- **Requires:** No biometric categorisation that deduces or infers race, political opinions, trade-union membership, religious/philosophical beliefs, sex life, or sexual orientation (narrow lawful-dataset-labelling / law-enforcement exceptions).
- **In code:** Never infer special-category attributes from biometric data. Tag biometric inputs as sensitive (primitive 4); enforce via access control.
- **Primitive:** 4. Data inventory + sensitive-field tagging; 5. Access control — RLS / RBAC / MFA / least-privilege
- **Cite:** Art. 5(1)(g)

### Art. 5(1)(h) — Prohibited: real-time remote biometric ID in public for law enforcement
- **Requires:** No real-time remote biometric identification in publicly accessible spaces for law-enforcement purposes, save narrowly defined, authorised exceptions (targeted victim search, imminent threat/terrorism, locating serious-crime suspects).
- **In code:** Out of scope for commercial SaaS — do not provide live public biometric ID to law-enforcement use cases.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** Art. 5(1)(h)

### Art. 4 — AI literacy
- **Requires:** Providers and deployers must take measures to ensure a sufficient level of AI literacy among staff and others operating/using AI systems on their behalf.
- **In code:** Lightweight internal training/runbook on the AI features you ship and consume; record completion alongside your security-awareness evidence.
- **Primitive:** 6. Immutable audit logging (retain literacy/training records)
- **Cite:** Art. 4 (applies from 2 Feb 2025)

### Art. 6 + Annex III — High-risk classification (design to stay OUT)
- **Requires:** A system is high-risk if it is a safety component under Annex I product law (Art. 6(1)) **or** falls in an Annex III area: (1) biometrics (remote ID, sensitive categorisation, emotion recognition); (2) critical infrastructure; (3) education/vocational training; (4) employment, worker management, access to self-employment; (5) access to essential private/public services and benefits (incl. **creditworthiness/credit scoring** and **life/health insurance risk & pricing**); (6) law enforcement; (7) migration/asylum/border control; (8) administration of justice and democratic processes. Art. 6(3) lets a system escape high-risk where it performs only a narrow procedural task, improves a prior human activity, detects decision patterns, or is preparatory — **and does not materially influence the decision outcome or profile natural persons**.
- **In code:** Classify each AI feature against Annex III in the data inventory. If you touch an Annex III area, keep the AI **assistive and non-determinative** (human makes the call), document the Art. 6(3) derogation rationale, and avoid profiling — this is the dividing line between Art. 50 (light) and Arts. 8–15 (heavy). **Lawyer/DPO sign-off required** for any Art. 6(3) "not high-risk" determination in an Annex III area.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 6; Annex III (high-risk classification under Art. 6(2) applies from 2 Aug 2026; Art. 6(1) from 2 Aug 2027 — **verify against Digital Omnibus**)

### Art. 8 — High-risk: compliance with requirements
- **Requires:** High-risk systems must comply with Arts. 9–15, accounting for intended purpose and state of the art; where other Union harmonisation law applies, ensure consistency.
- **In code:** If you land in high-risk, stand up the full Arts. 9–15 control set below; treat it as a programme, not a checkbox.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 8

### Art. 9 — High-risk: risk-management system
- **Requires:** Establish, implement, document, and maintain a continuous, iterative risk-management system across the lifecycle — identify/analyse known and foreseeable risks, evaluate residual risk, adopt mitigation, and test.
- **In code:** Versioned risk register tied to releases; mitigations tracked in CI/issue tracker; re-run on material model/data changes. Shares method with NIST AI RMF / ISO 42001 if you already run one.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** Art. 9

### Art. 10 — High-risk: data and data governance
- **Requires:** Training, validation, and testing datasets must meet quality criteria — relevant, sufficiently representative, and to the best extent possible free of errors and complete; documented governance covering design choices, collection, provenance, bias examination and mitigation, and data gaps.
- **In code:** Dataset datasheets/lineage in the data inventory; bias-testing artefacts; provenance and licensing recorded. **Special-category data** used for bias correction needs the Art. 10(5) safeguards — DPO sign-off.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 10

### Art. 11 + Annex IV — High-risk: technical documentation
- **Requires:** Draw up technical documentation per Annex IV before placing on the market and keep it up to date — system description, design specs, data, performance metrics, risk-management and oversight measures.
- **In code:** Maintain the Annex IV pack as living docs in-repo (architecture, data governance, eval results, oversight design); regenerate on release. SMEs may use a simplified form (Art. 11(1)).
- **Primitive:** 6. Immutable audit logging (versioned, retained documentation)
- **Cite:** Art. 11; Annex IV

### Art. 12 — High-risk: record-keeping / logging
- **Requires:** High-risk systems must technically allow automatic recording of events (logs) over their lifetime, appropriate to the intended purpose, to ensure traceability of functioning and post-market monitoring.
- **In code:** Append-only, tamper-evident event logs of inferences and key state; ship logging capability to deployers. Reuse the immutable audit-log primitive that also serves SOC 2 / GDPR Art. 30.
- **Primitive:** 6. Immutable audit logging
- **Cite:** Art. 12

### Art. 13 — High-risk: transparency & information to deployers
- **Requires:** Design for sufficient transparency so deployers can interpret and use output appropriately; supply instructions for use covering capabilities, limitations, accuracy/robustness metrics, foreseeable misuse, human-oversight measures, and expected lifetime/maintenance.
- **In code:** Ship structured "instructions for use" with the product; surface model limitations and confidence in the UI/API docs.
- **Primitive:** 3. Consent + preference store (transparency surfaces); 6. Immutable audit logging
- **Cite:** Art. 13

### Art. 14 — High-risk: human oversight
- **Requires:** Design and build so the system can be effectively overseen by natural persons during use — including the ability to understand output, monitor for anomalies, decide not to use it, and intervene or stop (human-in-the-loop / on-the-loop / "stop" button).
- **In code:** Human review/override before consequential actions; kill-switch; surface confidence and rationale so a reviewer can intervene.
- **Primitive:** 5. Access control — RLS / RBAC / MFA / least-privilege
- **Cite:** Art. 14

### Art. 15 — High-risk: accuracy, robustness, cybersecurity
- **Requires:** Achieve and document appropriate accuracy (with declared metrics), robustness (resilience to errors/faults, feedback-loop control), and cybersecurity (resilience to attacks including **data/model poisoning, adversarial examples, and model evasion**).
- **In code:** Declare accuracy metrics in the instructions; adversarial/red-team testing; input validation and rate limits. Cybersecurity here overlaps GDPR Art. 32 and NIS2/CRA — run it through the same security CI (SBOM, gitleaks, dep-audit in templates/ci/security.yml) and threat model.
- **Primitive:** 1. Encryption (TLS 1.2+ / AES-256 / key management); 5. Access control — RLS / RBAC / MFA / least-privilege
- **Cite:** Art. 15

### Art. 16 — Provider obligations (high-risk)
- **Requires:** Providers must ensure Arts. 8–15 compliance, indicate provider identity/contact, operate a quality-management system, keep documentation and auto-generated logs, run conformity assessment, draw up the EU declaration of conformity, affix CE marking, register, and take corrective action.
- **In code:** Treat as the umbrella checklist binding the controls below; assign an accountable owner.
- **Primitive:** 9. Vendor / sub-processor register (provider identity, responsibilities)
- **Cite:** Art. 16

### Art. 17 — Provider: quality-management system
- **Requires:** Put in place a documented QMS covering regulatory-compliance strategy, design/development/quality control, data management, the Art. 9 risk system, post-market monitoring, incident reporting (Art. 73), records, and accountability.
- **In code:** Map to an existing ISO 9001/42001 or SOC 2 management system where you have one; SMEs may meet it proportionately (Art. 17(2)).
- **Primitive:** 6. Immutable audit logging
- **Cite:** Art. 17

### Arts. 43, 47, 48 — Conformity assessment, EU declaration, CE marking (high-risk)
- **Requires:** Run the applicable conformity-assessment procedure (Art. 43 — generally internal control under Annex VI for most Annex III systems, third-party/notified-body under Annex VII for some); draw up and sign the written **EU declaration of conformity** (Art. 47); affix the **CE marking** visibly, legibly, indelibly (Art. 48).
- **In code:** Generate and retain the declaration and assessment evidence as release artefacts; track CE marking on the product/packaging/docs. **Conformity assessment / notified-body engagement needs specialist sign-off.**
- **Primitive:** 6. Immutable audit logging
- **Cite:** Arts. 43, 47, 48

### Art. 49 — Registration in the EU database (high-risk)
- **Requires:** Register the high-risk system (and, for certain Annex III systems, the deployer's use) in the EU database before placing on the market or putting into service.
- **In code:** Add a release gate that blocks go-live until the EU-database registration reference is recorded.
- **Primitive:** 9. Vendor / sub-processor register
- **Cite:** Art. 49

### Art. 26 — Deployer obligations (high-risk)
- **Requires:** Deployers must use the system per instructions, assign competent human oversight, ensure input data relevance/control where they control it, monitor operation and suspend + inform provider/authority on serious-incident or risk, **keep the auto-generated logs** for the period set (at least 6 months unless other law requires longer), inform affected workers/representatives, and — for some public-interest uses — run a **fundamental-rights impact assessment (Art. 27)**.
- **In code:** If you *deploy* a third-party high-risk system: retain its logs, wire its output into your human-oversight workflow, and route incidents into your breach pipeline.
- **Primitive:** 6. Immutable audit logging; 7. Retention + deletion jobs (log retention windows)
- **Cite:** Art. 26 (and Art. 27 FRIA where applicable)

### Art. 50(1) — Transparency: AI-interaction disclosure (default for most products)
- **Requires:** Providers must ensure that systems intended to interact directly with natural persons are designed so the person is **informed they are interacting with an AI system**, unless obvious to a reasonably well-informed user (law-enforcement exception aside).
- **In code:** Visible "You're chatting with an AI" disclosure in the chatbot/assistant UI **at first interaction — not buried in the ToS**. Clear, distinguishable, accessible (Art. 50(5)).
- **Primitive:** 3. Consent + preference store (transparency/notice surface)
- **Cite:** Art. 50(1) (applies from 2 Aug 2026)

### Art. 50(2) — Transparency: machine-readable marking of synthetic content
- **Requires:** Providers of systems generating synthetic audio, image, video, or **text** must ensure outputs are marked in a **machine-readable format and detectable as artificially generated or manipulated**, using effective, interoperable, robust, reliable technical solutions as far as technically feasible (limited assistive-editing exception).
- **In code:** Embed provenance/watermark metadata on AI-generated media — **C2PA / Content Credentials** for images/audio/video and a machine-readable marker for generated text; verify it survives your storage/CDN (Cloudflare/Supabase Storage) pipeline.
- **Primitive:** 6. Immutable audit logging (provenance metadata); 3. Consent + preference store
- **Cite:** Art. 50(2)

### Art. 50(3) — Transparency: emotion recognition / biometric categorisation notice
- **Requires:** Deployers of emotion-recognition or biometric-categorisation systems must inform exposed natural persons and process personal data in line with the GDPR/LED.
- **In code:** If you operate such a system (outside the Art. 5 prohibitions), surface an explicit notice and capture the GDPR lawful basis in the consent/preference store. **DPO sign-off.**
- **Primitive:** 3. Consent + preference store
- **Cite:** Art. 50(3)

### Art. 50(4) — Transparency: deepfake & AI-generated-text disclosure
- **Requires:** Deployers must disclose that image/audio/video content is a **deepfake** (artificially generated/manipulated), with proportionate handling for artistic/satirical/fictional works; AI-generated **text published to inform the public on matters of public interest** must be disclosed unless human-reviewed with editorial responsibility.
- **In code:** Label deepfake outputs in the UI; gate public-interest AI text behind a disclosure flag or a recorded human-review step.
- **Primitive:** 3. Consent + preference store
- **Cite:** Art. 50(4)

### Art. 53 — GPAI model provider: documentation, downstream info, copyright, training summary
- **Requires:** Providers of general-purpose AI models must keep up-to-date **technical documentation** (Annex XI), provide **information and documentation to downstream providers** that integrate the model (Annex XII), put in place a **policy to comply with EU copyright law** (incl. honouring Art. 4 DSM text-and-data-mining reservations), and publish a **sufficiently detailed public summary of training content** per the AI Office template. Open-source models get partial relief, but the copyright policy and training summary still apply.
- **In code:** If you *fine-tune or release* a GPAI model you become a provider — maintain model cards/datasheets, a copyright/TDM policy, and the published training-content summary. If you merely *consume* an upstream model, collect the provider's Annex XII pack into your vendor register.
- **Primitive:** 9. Vendor / sub-processor register; 4. Data inventory + sensitive-field tagging
- **Cite:** Art. 53 (applies from 2 Aug 2025)

### Art. 54 — GPAI: authorised representative for non-EU providers
- **Requires:** Providers of GPAI models established outside the EU must appoint, by written mandate, an EU **authorised representative** to hold documentation and cooperate with the AI Office.
- **In code:** Procurement/legal item — confirm any non-EU GPAI vendor you depend on has an authorised representative; record it in the vendor register.
- **Primitive:** 9. Vendor / sub-processor register
- **Cite:** Art. 54

### Art. 55 — GPAI with systemic risk: extra obligations
- **Requires:** Providers of GPAI models presenting **systemic risk** (per Art. 51 — high-impact capabilities, presumed at the ~10^25 FLOP training-compute threshold or by AI Office designation) must additionally perform model evaluation/adversarial testing, assess and mitigate systemic risks, track and report serious incidents to the AI Office, and ensure adequate cybersecurity.
- **In code:** Almost certainly not you as a solo founder — but if you depend on a systemic-risk model, confirm the upstream provider's compliance and incident channel; mirror their incident reporting into your own breach pipeline.
- **Primitive:** 8. Incident-response + breach pipeline; 9. Vendor / sub-processor register
- **Cite:** Arts. 55 (with 51, 52)

### Art. 72 / Art. 73 — Post-market monitoring & serious-incident reporting
- **Requires:** Providers of high-risk systems must run a documented post-market monitoring system (Art. 72) and **report serious incidents** to the relevant market-surveillance authority without undue delay: generally **no later than 15 days**; **within 10 days** where the incident involves a person's death; and **not later than 2 days** for a widespread infringement or a serious and irreversible disruption of critical infrastructure (Art. 73(3)–(4)).
- **In code:** Extend your existing incident-response pipeline with an AI serious-incident path: detection, severity triage, the Art. 73 clock, authority notification, and corrective action. Reuse the same workflow as GDPR Art. 33 breach reporting where the event overlaps.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** Arts. 72, 73

## Evidence to retain
- **Risk classification record** — per-feature Annex III mapping and, for any Annex III area you operate in, the documented **Art. 6(3) "not high-risk" rationale** with lawyer/DPO sign-off.
- **Art. 5 prohibited-use guardrails** — design-review records and acceptable-use terms showing manipulative, social-scoring, biometric-categorisation, emotion-recognition, and scraping practices are excluded.
- **Art. 50 transparency artefacts** — screenshots/specs of the AI-interaction disclosure, deepfake/synthetic-content labels, and proof that machine-readable marking (C2PA / provenance metadata) is applied and survives the storage/CDN pipeline.
- **AI-literacy records (Art. 4)** — training/onboarding evidence for staff operating AI systems.
- **For high-risk systems:** the Annex IV **technical documentation** (kept and available **10 years** after market placement — Art. 18), Art. 9 **risk-management** register, Art. 10 **dataset governance** datasheets/lineage and bias-testing results, Art. 12 **system logs** (providers retain per Art. 19; deployers retain the auto-generated logs **at least 6 months** under Art. 26 unless other law requires longer), Art. 14 **human-oversight** design, Art. 15 **accuracy/robustness/cybersecurity** test reports, the Art. 17 **QMS** documentation, the Art. 47 **EU declaration of conformity** + conformity-assessment evidence, the Art. 49 **EU-database registration** reference, and any Art. 27 **fundamental-rights impact assessment**.
- **GPAI evidence (where you are a model provider):** Annex XI technical documentation, the Annex XII downstream-information pack, the EU-copyright/TDM policy, and the published training-content summary; plus, for systemic-risk models, evaluation/red-team reports and the incident-reporting log.
- **Vendor pack** — for each upstream AI/GPAI model or AI sub-processor: the provider's instructions for use / Annex XII documentation, authorised-representative details (non-EU GPAI), and their serious-incident channel — held in the sub-processor register alongside DPAs.
- **Post-market monitoring & incident log (Arts. 72–73)** — monitoring records and the serious-incident report trail with authority-notification timestamps.
- **NOTE:** keep all dates provisional pending the **Digital Omnibus** outcome — record which baseline (published 2024/1689 vs. amended) your evidence assumes.

# US State Privacy Laws (Virginia model) — requirements checklist
> Source: VCDPA https://law.lis.virginia.gov/vacode/title59.1/chapter53/ (Va. Code §§ 59.1-575 to 59.1-585) · deltas: CO CPA (C.R.S. 6-1-1301 et seq.), CT CTDPA (Conn. Pub. Act 22-15 / Gen. Stat. ch. 743), UT UCPA (Utah Code Title 13 ch. 61), TX TDPSA (Tex. Bus. & Com. Code ch. 541), IA ICDPA (Iowa Code ch. 715D) · retrieved 2026-06-20 · US state statutes are public domain; summarize freely with citation. Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md (#24 "The unified primitives").

This is the **common "Virginia model"** shared by ~15+ states (VA, CO, CT, IN, MT, OR, TX, DE, NH, NJ, etc.) plus the **opt-out outliers** (UT, IA). Build the CCPA/CPRA DSAR + consent engine once and layer the per-state deltas in the matrix below; treat CCPA as the strict superset and this as the second layer.

## Applies when
A controller that **conducts business in the state** (or produces products/services targeted to its residents) and meets a data-volume threshold. Thresholds are *per state* — see the delta matrix. The canonical VA test (Va. Code § 59.1-576):
- Controls or processes personal data of **≥ 100,000 consumers** in a calendar year, **OR**
- Controls or processes personal data of **≥ 25,000 consumers** **and** derives **> 50% of gross revenue** from the **sale** of personal data.

"Consumer" = a **resident acting in an individual/household context** — B2B and employee data are excluded under the VA model (§ 59.1-575). Entity-level exemptions: government bodies, **GLBA-regulated financial institutions, HIPAA covered entities/business associates, nonprofits, higher-ed institutions** (VA exempts these entirely). Data-level exemptions: PHI, FERPA records, FCRA consumer-report data, DPPA data, Farm Credit Act data (§ 59.1-576). **Texas is the outlier — no numeric consumer threshold:** applies to anyone doing business in TX who processes/sells personal data and is **not** a small business as defined by the U.S. SBA (Tex. B&C § 541.002). **Utah/Iowa add a revenue floor** ($25M annual revenue for UT) before the volume tests apply.

## Requirements

### R1 — Right to confirm processing & access
- **Requires:** On a verified request, confirm whether the controller is processing the consumer's personal data and provide access to that data.
- **In code:** DSAR intake (verified to the authenticated account or identity-proofed); query every store keyed by (user_id) — primary DB, replicas, caches, analytics, sub-processors — and assemble a machine-readable access package.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** Va. Code § 59.1-577(A)(1); CO 6-1-1306(1)(b); CT § 4(a)(1); UT 13-61-201(1); TX § 541.051(b)(1); IA 715D.3

### R2 — Right to correct inaccuracies
- **Requires:** Correct inaccuracies in the consumer's personal data, taking into account its nature and processing purpose. **Not in UT or IA** (those states grant no correction right).
- **In code:** DSAR "correct" path that writes the fix across all canonical stores and re-syncs derived/analytics copies; record the correction in the audit log.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** Va. Code § 59.1-577(A)(2); CO 6-1-1306(1)(c); CT § 4(a)(2); TX § 541.051(b)(2) — **absent: UT 13-61-201, IA 715D.3**

### R3 — Right to delete
- **Requires:** Delete personal data provided by **or obtained about** the consumer (the VA model covers both, broader than CCPA's "provided by").
- **In code:** Deletion job that cascades across DB + backups (queue for next backup cycle or document the rolling-deletion window) + caches + analytics + sub-processors; emit deletion propagation events to processors; log completion.
- **Primitive:** 7. Retention + deletion jobs (with 2. DSAR engine)
- **Cite:** Va. Code § 59.1-577(A)(3); CO 6-1-1306(1)(d); CT § 4(a)(3); UT 13-61-201(2); TX § 541.051(b)(3); IA 715D.3

### R4 — Right to data portability
- **Requires:** Obtain a copy of personal data the consumer **previously provided**, in a portable and (to the extent technically feasible) readily usable format allowing transfer to another controller; limited to data processed by automated means.
- **In code:** Export endpoint producing structured JSON/CSV of user-provided fields; exclude derived/inferred data; rate-limit to the free-tier allowance.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** Va. Code § 59.1-577(A)(4); CO 6-1-1306(1)(e); CT § 4(a)(4); UT 13-61-201(4); TX § 541.051(b)(4); IA 715D.3

### R5 — Right to opt out of targeted advertising
- **Requires:** Let consumers opt out of processing of personal data for **targeted advertising** (ads selected based on data from the consumer's activity over time across **nonaffiliated** sites/apps).
- **In code:** Consent/preference flag `targeted_ads = off`; server-side enforcement that suppresses ad-pixel/SDK loading and cross-site identifier sharing for opted-out users; a clear, conspicuous opt-out link.
- **Primitive:** 3. Consent + preference store (granular, GPC, gating)
- **Cite:** Va. Code § 59.1-577(A)(5)(i); CO 6-1-1306(1)(a)(II); CT § 4(a)(5)(A); UT 13-61-201(4); TX § 541.051(b)(5)(A); IA 715D.3

### R6 — Right to opt out of the sale of personal data
- **Requires:** Let consumers opt out of the **sale** of personal data. **Sale** = exchange for **monetary consideration** under the VA/UT/IA model; **CO/CT/TX use the broader "monetary or other valuable consideration"** definition (closer to CCPA).
- **In code:** `sale = off` preference; server-side gate blocking data flows to third parties that meet the state's "sale" definition; "Do Not Sell" disclosure.
- **Primitive:** 3. Consent + preference store (granular, GPC, gating)
- **Cite:** Va. Code § 59.1-577(A)(5)(ii) & § 59.1-575 ("sale"); CO 6-1-1306(1)(a)(III) & 6-1-1303(23); CT § 4(a)(5)(B); UT 13-61-201(4)(a); TX § 541.051(b)(5)(B); IA 715D.3

### R7 — Right to opt out of profiling
- **Requires:** Let consumers opt out of **profiling** in furtherance of decisions that produce **legal or similarly significant effects**. **Not in UT or IA.**
- **In code:** `profiling_opt_out = on` flag consumed by any automated-decision pipeline that gates access to housing/credit/employment/services; fall back to a non-profiled path or human review.
- **Primitive:** 3. Consent + preference store (with 5. Access control for the decision pipeline)
- **Cite:** Va. Code § 59.1-577(A)(5)(iii); CO 6-1-1306(1)(a)(I); CT § 4(a)(5)(C); TX § 541.051(b)(5)(C) — **absent: UT, IA**

### R8 — Universal opt-out mechanism / Global Privacy Control (GPC)
- **Requires:** Honor a browser/device-level **universal opt-out signal** (e.g., GPC) as a valid opt-out of targeted advertising and sale. **Required in CO (since 7/1/2024), CT (since 1/1/2025), TX (since 1/1/2025), MT/OR/DE/NJ/NH/etc.** **VA, UT, IA do NOT require it** (VA recognizes per-request opt-out only). CO additionally requires honoring opt-out preference signals for some sensitive-data/profiling contexts.
- **In code:** Server-side GPC header / `navigator.globalPrivacyControl` detection that automatically sets `sale=off` and `targeted_ads=off` for that browser and persists it to the authenticated account; document the recognized-signal list.
- **Primitive:** 3. Consent + preference store (server-side GPC honoring)
- **Cite:** CO 6-1-1306(1)(a)(IV)(B); CT § 6(e)(1); TX § 541.055 — **not required: VA § 59.1-577, UT, IA**

### R9 — Response window for consumer requests
- **Requires:** Respond **without undue delay and within 45 days** of receipt; one **45-day extension** permitted when reasonably necessary (notify the consumer). Information provided **free of charge up to twice annually**; a reasonable fee may be charged for **manifestly unfounded, excessive, or repetitive** requests, or the controller may decline.
- **In code:** DSAR ticketing with SLA timers (45/90-day), per-consumer request counters for the free-tier limit, and templated extension/denial notices.
- **Primitive:** 2. DSAR engine (access/delete/correct/export)
- **Cite:** Va. Code § 59.1-577(B); CO 6-1-1306(2); CT § 4(b); UT 13-61-203 (UT allows **45 days**, no comparable extension cap structure); TX § 541.052; IA 715D.4

### R10 — Appeals process for denied requests
- **Requires:** Establish an **appeal process** for refusals to act on a request; respond to the appeal in writing within **60 days** (VA/most states); if the appeal is denied, provide a method for the consumer to **contact the state Attorney General** to submit a complaint. **Iowa: 60 days. Utah does NOT mandate an appeal mechanism.**
- **In code:** "Appeal this decision" link on every DSAR denial; appeal queue with a 60-day SLA, written-decision template, and an AG-complaint link.
- **Primitive:** 2. DSAR engine (with 6. Immutable audit logging of the appeal record)
- **Cite:** Va. Code § 59.1-577(C); CO 6-1-1306(3); CT § 4(c); TX § 541.053; IA 715D.4 — **absent: UT**

### R11 — Transparent privacy notice
- **Requires:** Provide a **reasonably accessible, clear, meaningful** privacy notice including: (i) **categories of personal data processed**; (ii) **purposes** of processing; (iii) how consumers may **exercise rights and appeal**; (iv) **categories of data shared with third parties**; (v) **categories of third parties** with whom data is shared.
- **In code:** Generate the notice from the data inventory (R14) so it stays in sync with the actual schema and vendor register; version and timestamp it.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Va. Code § 59.1-578(C); CO 6-1-1308(1)–(2); CT § 6(c); UT 13-61-302(1); TX § 541.102; IA 715D.4(1)

### R12 — Disclosure of sale / targeted advertising + opt-out method
- **Requires:** If the controller **sells** personal data or processes it for **targeted advertising**, **clearly and conspicuously disclose** this and the manner in which a consumer may opt out. **Texas requires a specific verbatim notice** ("We may sell your sensitive personal data." / "...biometric personal data.") when applicable (§ 541.102(b)–(c)).
- **In code:** Conspicuous "Do Not Sell or Share" / opt-out links in the footer and notice; conditional rendering of the TX-mandated disclosure strings driven by the sensitive-field tags.
- **Primitive:** 3. Consent + preference store (gating) and 4. Data inventory
- **Cite:** Va. Code § 59.1-578(C); CO 6-1-1308(4); CT § 6(c)(4); UT 13-61-302(3); TX § 541.102(b)–(c); IA 715D.4(2)

### R13 — Data minimization & purpose limitation
- **Requires:** Limit collection to what is **adequate, relevant, and reasonably necessary** for the disclosed purposes; do **not** process for purposes **neither reasonably necessary to nor compatible with** the disclosed purposes without the consumer's consent.
- **In code:** Schema review gate at feature time (don't collect fields without a documented purpose); tag each field with its purpose in the inventory; block secondary uses of tagged fields absent a consent flag.
- **Primitive:** 4. Data inventory + sensitive-field tagging (with 7. Retention)
- **Cite:** Va. Code § 59.1-578(A)(1)–(2); CO 6-1-1308(2)–(3); CT § 6(a)(1)–(2); UT 13-61-302 (notice-based, weaker); TX § 541.101(a)–(b); IA 715D.4

### R14 — Data inventory (implicit prerequisite)
- **Requires:** Knowing which categories of personal data and **sensitive data** are processed, their purposes, and which third parties receive them — required to produce the R11 notice, run R20 DPIAs, gate R15 sensitive data, and serve R1–R7 DSARs.
- **In code:** Maintain a data map / `data_inventory` table tagging each column as PII / sensitive (race/ethnicity, religion, health, sexual orientation, citizenship/immigration status, genetic/biometric, geolocation, child) and its purpose + retention; drive notices and DSARs from it.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** Va. Code § 59.1-575 ("sensitive data"), § 59.1-578(C), § 59.1-580; CO 6-1-1303(24); CT § 1(27); TX § 541.001(29)

### R15 — Sensitive data: opt-IN consent (VA/CO/CT/TX) vs. notice + opt-OUT (UT/IA)
- **Requires:** **Do not process sensitive data without the consumer's consent** (freely given, specific, informed, unambiguous affirmative act) — **VA, CO, CT, TX**. Sensitive data of a **known child** is processed per **COPPA**. **OUTLIERS: Utah and Iowa require only that the controller provide notice and the opportunity to opt out** before processing sensitive data — no opt-in consent.
- **In code:** Default-deny gate on every sensitive-tagged field; require a recorded, timestamped opt-in consent before write/process in VA/CO/CT/TX; for UT/IA, present a notice + opt-out toggle. For children, route to the COPPA verifiable-parental-consent flow.
- **Primitive:** 3. Consent + preference store (default-deny for sensitive fields)
- **Cite:** Va. Code § 59.1-578(A)(5); CO 6-1-1308(7); CT § 6(a)(4); TX § 541.101(b)(3) — **opt-out instead: UT 13-61-302(3)(a), IA 715D.4(3)**

### R16 — Consent for processing children's data / known minors
- **Requires:** Process the sensitive data of a **known child** in accordance with **COPPA**. Several newer states add minor-specific duties; **VA § 59.1-577.1 (eff. Jan 1, 2026)** adds social-media time limits and age verification for minors, and **CT** added heightened protections for consumers 13–17 (no targeted ads/sale/certain profiling without consent).
- **In code:** Age signal → COPPA VPC flow for under-13; for teen-targeted features in states with minor rules, disable targeted ads/sale by default for known minors and store the consent state.
- **Primitive:** 3. Consent + preference store (with 5. Access control gating minor features)
- **Cite:** Va. Code § 59.1-575 (child), § 59.1-578(A)(5), § 59.1-577.1; CT § 6(a)(4) & Pub. Act 23-56 (minors)

### R17 — Reasonable data security practices
- **Requires:** **Establish, implement, and maintain reasonable administrative, technical, and physical** data security practices appropriate to the **volume and nature** of the personal data.
- **In code:** TLS 1.2+ in transit, AES-256 at rest, Postgres RLS + RBAC + MFA, least-privilege service tokens, secrets management, encrypted backups — the same control set serving SOC 2 / HIPAA / GDPR Art. 32.
- **Primitive:** 1. Encryption (with 5. Access control)
- **Cite:** Va. Code § 59.1-578(A)(3); CO 6-1-1308(5); CT § 6(a)(3); UT 13-61-302(2); TX § 541.101(c); IA 715D.4

### R18 — Non-discrimination / anti-retaliation
- **Requires:** Do **not process personal data in violation of state/federal anti-discrimination laws**, and do **not discriminate** against a consumer for exercising a right (no denial of goods/services, no different price or quality) — **except** bona fide **loyalty/rewards** programs and functionality lost because a consumer opted out.
- **In code:** Ensure the opt-out flags (R5–R8) do not branch into degraded service except where the data is functionally required; keep loyalty-program data flows explicitly documented and consented.
- **Primitive:** 3. Consent + preference store (gating logic)
- **Cite:** Va. Code § 59.1-578(A)(4); CO 6-1-1308(1)(b) & 6-1-1306(1)(a); CT § 6(a)(5); UT 13-61-302(4); TX § 541.101(b)(4); IA 715D.4

### R19 — Controller–processor contract (DPA) required
- **Requires:** Processing by a **processor** must be governed by a **binding contract** that sets out: processing **instructions, nature/purpose, type of data, duration**; a **confidentiality** duty on personnel; **deletion or return** of data at end of provision; an obligation to **make available information** needed to demonstrate compliance and to **allow/cooperate with assessments**; and a requirement that **subcontractors** be bound by the same terms via written contract.
- **In code:** Sign a **DPA** with every sub-processor before routing personal data (Supabase, Fly, Cloudflare, Vercel, email/SMS, analytics, LLM APIs); record each in the vendor register with contract type + data categories; flow-down DPA terms to your own sub-processors.
- **Primitive:** 9. Vendor / sub-processor register (BAA/DPA)
- **Cite:** Va. Code § 59.1-579(B); CO 6-1-1305(2)–(5); CT § 7(b); UT 13-61-301(2); TX § 541.104(b); IA 715D.5

### R20 — Data protection assessments (DPIA) for high-risk processing
- **Requires:** Conduct and document a **data protection assessment** for each of these activities: (1) processing for **targeted advertising**; (2) **sale** of personal data; (3) **processing of sensitive data**; (4) **profiling** that presents a reasonably foreseeable risk of unfair/deceptive treatment, financial/physical/reputational injury, intrusion on private affairs, or other substantial injury; (5) any processing presenting a **heightened risk of harm**. The AG may require production of the assessment. **OUTLIERS: Utah and Iowa do NOT require DPIAs at all.**
- **In code:** A DPIA template gate in the feature workflow that fires when a new flow touches sensitive-tagged fields, ad/sale pipelines, or profiling; store completed assessments for AG production; (VA non-retroactive — applies to processing created after Jan 1, 2023).
- **Primitive:** 4. Data inventory + sensitive-field tagging (DPIAs feed off the inventory)
- **Cite:** Va. Code § 59.1-580; CO 6-1-1309; CT § 8; TX § 541.105 — **absent: UT 13-61, IA 715D**

### R21 — De-identified & pseudonymous data handling
- **Requires:** A controller using **de-identified data** must take reasonable measures to prevent re-association, **publicly commit** to maintaining/using it only in de-identified form, and **contractually obligate** recipients to comply. The consumer rights (access/correct/delete/portability) **do not apply to pseudonymous data** if the controller keeps the identifying information **separately** under technical/organizational controls. Controllers are **not required to re-identify** de-identified data to satisfy a request.
- **In code:** Keep keying material isolated from pseudonymous datasets; add the public de-identification commitment to the privacy notice; bind data recipients contractually; exclude truly de-identified stores from DSAR scope and document why.
- **Primitive:** 4. Data inventory + sensitive-field tagging (with 1. Encryption / key separation)
- **Cite:** Va. Code § 59.1-581; CO 6-1-1307; CT § 11; UT 13-61-303; TX § 541.106; IA 715D.6

### R22 — Permitted-purpose limitations (lawful processing exemptions)
- **Requires:** Obligations do not restrict the controller/processor from processing to comply with law/legal process, cooperate with law enforcement, defend legal claims, provide a requested product/service or perform a contract, protect life/safety, prevent/detect security incidents and fraud, conduct approved research, or perform internal operations reasonably aligned with consumer expectations. A controller is **not in violation** when a third-party recipient violates the act **absent actual knowledge** the recipient intended to violate it.
- **In code:** When designing DSAR deletion/opt-out flows, encode the legally-permitted retain/process exceptions (fraud prevention, legal hold, contract performance) rather than honoring blindly; document each invoked exception.
- **Primitive:** 7. Retention + deletion jobs (exception handling) and 4. Data inventory
- **Cite:** Va. Code § 59.1-582; CO 6-1-1304(2)–(3); CT § 10; UT 13-61-304; TX § 541.205; IA 715D.7

### R23 — Investigative authority (civil investigative demand)
- **Requires:** The Attorney General may issue a **civil investigative demand** when there is reasonable cause to believe a person has violated, is violating, or is about to violate the act.
- **In code:** Maintain the evidence artifacts (DPIAs, DPAs, consent records, DSAR logs, the data inventory) in a producible, retained form so a CID can be answered.
- **Primitive:** 6. Immutable audit logging (evidence retention)
- **Cite:** Va. Code § 59.1-583; CO 6-1-1310; CT § 11; TX § 541.152

### R24 — Enforcement, cure period, penalties; no private right of action
- **Requires:** **AG-exclusive enforcement** — **no private right of action** in any Virginia-model state. **VA: 30-day cure period** (does not sunset) + up to **$7,500 per violation**. Cure-period deltas vary widely (see matrix). The AG may recover expenses/attorney fees.
- **In code:** Operationally, ensure violations are **curable fast** — a kill-switch to honor an opt-out, push a deletion, or correct a notice within the shortest applicable cure window; keep timestamped remediation records.
- **Primitive:** 8. Incident-response + breach pipeline (remediation workflow) with 6. Immutable audit logging
- **Cite:** Va. Code § 59.1-584; CO 6-1-1311 (+ 6-1-1311(1)(d) sunset); CT § 11(b); UT 13-61-402; TX § 541.155; IA 715D.8

### R25 — (Some states) Breach notification — note the separate statute
- **Requires:** The comprehensive privacy acts themselves generally do **not** contain a standalone breach-notice clock; breach notification is governed by each state's **separate data-breach-notification statute** (e.g., Va. Code § 18.2-186.6, Tex. B&C ch. 521, Colo. Rev. Stat. 6-1-716). Reasonable security under R17 is the privacy-act hook; the breach clock lives in the breach statute.
- **In code:** Run the unified detect→log→timeline→notify pipeline parameterized by the applicable **state breach statute's** deadline and AG-notice threshold (most states: "without unreasonable delay"; several cap at 30–60 days; some require AG notice above a victim-count threshold).
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** Va. Code § 18.2-186.6 (separate); Tex. B&C § 521.053; Colo. Rev. Stat. § 6-1-716 — *(privacy-act security hook: § 59.1-578(A)(3))*

## Per-state delta matrix

| State (law, eff. date) | Volume threshold | Revenue gate | Sensitive data | Right to correct | Opt out of profiling | GPC / universal opt-out | DPIA required | Cure period (sunset?) | Penalty / enforcer |
|---|---|---|---|---|---|---|---|---|---|
| **VA — VCDPA** (Jan 1, 2023) | 100k, or 25k + >50% rev from sale | none (volume only) | **Opt-IN consent** | Yes | Yes | **No** (per-request only) | Yes | 30 days, **no sunset** | $7,500/viol · AG only |
| **CO — CPA** (Jul 1, 2023) | 100k, or 25k + **any** revenue from sale | none | **Opt-IN consent** | Yes | Yes | **Yes — since Jul 1, 2024** | Yes | 60 days, **sunset Jan 1, 2025** | per CO Consumer Protection Act · AG + DAs |
| **CT — CTDPA** (Jul 1, 2023) | 100k, or 25k + **>25%** rev from sale | none | **Opt-IN consent** | Yes | Yes | **Yes — since Jan 1, 2025** | Yes | 60 days, **sunset Dec 31, 2024** | per CUTPA · AG only |
| **UT — UCPA** (Dec 31, 2023) | 100k, or 25k + >50% rev from sale | **≥ $25M annual revenue** required | **Notice + opt-OUT** (no consent) | **No** | **No** | **No** | **No** | 30 days, **no sunset** | $7,500/viol · AG only |
| **TX — TDPSA** (Jul 1, 2024) | **None** — any non-small-business per SBA | n/a (small-business test) | **Opt-IN consent** | Yes | Yes | **Yes — since Jan 1, 2025** | Yes | 30 days, **no sunset** | $7,500/viol · AG only |
| **IA — ICDPA** (Jan 1, 2025) | 100k, or 25k + >50% rev from sale | none | **Notice + opt-OUT** (no consent) | **No** | **No** | **No** | **No** | **90 days**, **no sunset** | $7,500/viol · AG only |

**Reading the matrix:** The four "full Virginia-model" states (VA, CO, CT, TX) give all five+ rights, require opt-in sensitive consent and DPIAs; CO/CT/TX add GPC. **Utah and Iowa are the weak outliers** — no correction right, no profiling opt-out, sensitive data is notice+opt-out (not consent), and no DPIA. **Texas is the threshold outlier** — it reaches every business that isn't an SBA-defined small business, so the 100k/25k counting exercise doesn't gate it. **Cure periods sunset in CO and CT** (after the sunset, the AG can act without offering a cure), but remain permanent in VA/UT/TX/IA. **No state in this model has a private right of action** — enforcement is AG-only (CO adds district attorneys).

## Engineering takeaway (build once, layer deltas)
1. **One DSAR engine** (R1–R4, R9–R10) keyed by (user, state) — set the verification, 45-day SLA, twice-annual free cap, and 60-day appeal as defaults; suppress correct/profiling-opt-out for UT/IA users.
2. **One consent + preference store** (R5–R8, R12, R15–R16, R18) with server-side **GPC honoring** for CO/CT/TX/newer states and a **default-deny gate on sensitive-tagged fields** (opt-in for VA/CO/CT/TX, notice+opt-out for UT/IA).
3. **One data inventory** (R11, R13–R14, R20–R21) tagging PII and the VA-model sensitive categories; it generates the notice, scopes DSARs, and triggers DPIAs.
4. **One vendor register** (R19) with a DPA per sub-processor before routing personal data.
5. **One security control set** (R17) shared with SOC 2 / HIPAA / GDPR, and **one breach pipeline** (R24–R25) parameterized by the applicable **separate** state breach statute. Treat CCPA as the strict superset and these as the second layer.

## Evidence to retain
Auditors / state AGs (on a § 59.1-583-style CID) expect: the **privacy notice** (versioned, dated) and its match to the actual data inventory; the **data inventory / data map** with sensitive-field tags; **consent records** for sensitive-data processing and minors (timestamped, granular); **DSAR logs** (request, verification, 45/90-day timeline, response, free-tier counter); **appeal records** with written decisions; completed **data protection assessments** for each triggering activity (kept producible — VA/CO/CT/TX); signed **DPAs** with every processor + the sub-processor register with contract types and data categories; **GPC-signal recognition** documentation (CO/CT/TX); evidence of **reasonable security** (encryption, RLS/RBAC/MFA config, access reviews); **remediation records** demonstrating cures within the applicable window; and the **breach-response timeline** tied to the state breach-notification statute.

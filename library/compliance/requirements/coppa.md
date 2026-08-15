# COPPA — Children's Online Privacy Protection Rule — requirements checklist
> Source: https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312 · https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule · https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa · 16 CFR Part 312 (COPPA Rule) · retrieved 2026-06-22 · US federal regulation (15 U.S.C. 6501–6506), public domain. Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- You are an **operator** of a website or online service **directed to children under 13** (§312.2 multi-factor test), OR any operator with **actual knowledge** it collects personal information from a child under 13 (§312.3). "Operator" reaches both first-party sites and third parties that collect PI through another's child-directed service.
- A solo SaaS / app on managed infra is **directly in scope** if its content, audience, or marketing targets under-13s, or if it knowingly onboards under-13 users. General-audience B2B SaaS is typically out of scope — but COPPA flows down: if you act as a **vendor/processor** to a child-directed operator (analytics, ad SDK, auth, hosting) and you collect personal information **through** that child-directed service, you are yourself an **"operator"** under the §312.2 definition (the obligation arises from the definition, not from contract). Contract flow-down of the operator's consent and deletion obligations is **additive**, not the source of the duty. A **mixed-audience** service (§312.2) is in scope but may apply a neutral age screen and use §312.5(c) exceptions before collecting age.
- **"Personal information" is broad here** (§312.2): it expressly includes **persistent identifiers** (cookie customer number, IP address, device/processor serial, unique device identifier) and **biometric identifiers** (fingerprints, handprints, retina/iris patterns, genetic data/DNA, voiceprints, gait patterns, facial templates/faceprints), plus government-issued IDs, geolocation, and photos/video/audio of a child. Persistent identifiers alone trigger COPPA unless used solely for "support for internal operations."
- **Effective date of the 2025 amendments: June 23, 2025.** General **compliance date: April 22, 2026** (regulated entities had until then to conform), except certain safe-harbor program provisions in §312.11(d)(1), (d)(4), and (g), which carry earlier dates. The 2025 amendments added the separate third-party-disclosure consent (§312.5), a written information security program (§312.8), and data-retention limits with a written retention policy (§312.10).
- Get **counsel/privacy review** for: the §312.2 "directed to children" determination and age-screen design, structuring VPC, third-party-disclosure and targeted-advertising consent flows, and any use of children's data to train AI (per the FTC's Final Rule preamble, AI-training disclosures are never "integral," so they require separate consent).

## Requirements

### §312.2 — Definitions (personal information, directed to children, mixed audience)
- **Requires:** Classify what you collect against the §312.2 definition of personal information, including persistent identifiers and biometric identifiers, and determine whether your service is "directed to children" (subject matter, visual content, animated characters, child-oriented activities/incentives, music/audio, age of models, child celebrities, language, and whether advertising on the service is directed to children) or "mixed audience."
- **In code:** Maintain a field-level data inventory tagging every column that is COPPA "personal information"; flag persistent identifiers (IP, device IDs, cookie IDs) and any biometric/face/voice data as sensitive child-PI. Gate child-PI tables behind Postgres RLS. Where mixed-audience, implement a neutral age screen (no defaulting, no encouraging false ages) before any non-exempt collection.
- **Primitive:** 4 (Data inventory + sensitive-field tagging); 5 (Access control — RLS / RBAC / MFA / least-privilege)
- **Cite:** 16 CFR §312.2 (definitions of "personal information," "Web site or online service directed to children," "mixed audience website or online service")

### §312.3 — Regulation of unfair/deceptive acts (general requirements)
- **Requires:** Before collecting, using, or disclosing PI from a child, an operator must (a) post the online notice (§312.4(d)); (b) give direct notice and obtain **verifiable parental consent** (§312.4(b)–(c), §312.5); (c) honor parental review/deletion rights (§312.6); (d) not condition participation on excess collection (§312.7); (e) protect confidentiality, security, and integrity (§312.8); and (f) retain PI only as needed (§312.10).
- **In code:** Treat consent state as a hard precondition: child-PI write paths must check a verified-parental-consent record before persisting. No collection occurs until consent is recorded.
- **Primitive:** 3 (Consent + preference store); 5 (Access control); 6 (Immutable audit logging)
- **Cite:** 16 CFR §312.3

### §312.4 — Notice (online privacy notice + direct notice to parents)
- **Requires:** A clear online notice (§312.4(d)) describing operators collecting child PI, the categories of PI collected and how, the **identities and specific categories of third parties** to which PI is disclosed and the purposes, the new **data-retention policy** (per §312.10), and parental rights (review, delete, refuse further collection, revoke consent). A direct notice to the parent (§312.4(b), with required content under §312.4(c)) must accompany the consent request and state what triggered it and what action the parent must take.
- **In code:** Publish a child-specific privacy notice page that renders the live third-party/sub-processor register and the retention-policy text from the vendor and retention configs (single source of truth). Generate parent-facing direct-notice content from the same templates so disclosures stay in sync with code.
- **Primitive:** 9 (Vendor / sub-processor register); 7 (Retention + deletion jobs); 3 (Consent + preference store)
- **Cite:** 16 CFR §312.4(b)–(c) (direct notice to the parent and its required content), §312.4(d) (online notice content; includes retention disclosure)

### §312.5(a)–(b) — Verifiable parental consent before collection; approved VPC methods
- **Requires:** Obtain verifiable parental consent **before** any collection, use, or disclosure of child PI, using a method reasonably designed to ensure the consenting person is the parent. §312.5(b)(1) sets the general "reasonable efforts" standard; the operative list of approved methods is enumerated in **§312.5(b)(2)**: signed consent form (mail/fax/electronic scan); credit/debit card or online payment that notifies the account holder; toll-free telephone staffed by trained personnel; video-conference with trained personnel; government-ID verification against a database with **prompt deletion** after matching; **knowledge-based authentication** (dynamic questions hard for under-13s); **facial recognition** comparing a government-ID photo to a live image with prompt deletion; and email-plus and text-message-plus confirmation steps (the "email/text-plus" methods) for operators **not** disclosing PI to third parties.
- **In code:** Implement a consent engine that records, per child: parent identity proof method, timestamp, scope (collection/use vs. disclosure), and result; block collection until a valid consent row exists. For ID/face-match methods, delete the verification artifact immediately after the match (retention job with near-zero TTL) and log the deletion. Store consent as withdrawable, timestamped records.
- **Primitive:** 3 (Consent + preference store); 7 (Retention + deletion jobs); 6 (Immutable audit logging)
- **Cite:** 16 CFR §312.5(a)(1), §312.5(b)(1) (general standard), §312.5(b)(2) (enumerated methods)

### §312.5(a)(2) — Separate opt-in consent for third-party disclosure / targeted advertising (2025)
- **Requires:** Operators must give the parent the option to consent to collection and use **without** consenting to **disclosure to third parties**, unless that disclosure is integral to the service — this parental option to withhold consent to disclosure (absent integral-to-service) is the codified §312.5(a)(2) operative text. The further characterization that this functions as a **separate, distinct opt-in** for targeted/behavioral advertising, and that disclosures for monetary compensation, advertising, or **developing/training AI** are never "integral" (so they always require this separate consent), comes from the **FTC's Final Rule preamble (Statement of Basis and Purpose)** rather than the codified §312.5(a)(2) text.
- **In code:** Model two consent scopes in the preference store: `collection_use` and `third_party_disclosure` (with sub-flags for advertising / AI training). Default third-party disclosure to off; share with any ad SDK, analytics, or AI pipeline only when the disclosure scope is explicitly granted. Enforce at the data-egress boundary (RLS/policy check before any third-party export). This control aligns with GDPR Art. 6/7 granular-consent and CPRA opt-out-of-sale/sharing expectations — build the scope model once and map across.
- **Primitive:** 3 (Consent + preference store); 9 (Vendor / sub-processor register); 4 (Data inventory + sensitive-field tagging)
- **Cite:** 16 CFR §312.5(a)(2)

### §312.5(c) — Exceptions to prior parental consent (incl. support for internal operations)
- **Requires:** Limited exceptions permit collection before consent — e.g., obtaining a parent's online contact info to give notice/seek consent; responding once to a child's one-time request; and collecting a **persistent identifier solely to provide support for internal operations** with no contact and no use to direct ads or otherwise contact a specific individual. Operators relying on the internal-operations exception must disclose, in the §312.4(d) notice, the internal operations supported and the practices ensuring persistent identifiers are not used for unauthorized purposes such as behavioral advertising.
- **In code:** If you rely on the internal-operations exception, technically restrict persistent identifiers to the permitted purposes (no cross-context ad targeting, no profiling); enforce with field tagging and egress policy, and surface the required notice text from config.
- **Primitive:** 4 (Data inventory + sensitive-field tagging); 5 (Access control); 3 (Consent + preference store)
- **Cite:** 16 CFR §312.5(c)

### §312.6 — Parental right to review, delete, and revoke consent
- **Requires:** On request and after reasonable parent verification, the operator must (a) let the parent review the PI collected; (b) delete the child's PI and refuse further collection/use; and (c) revoke consent, after which the operator must stop collecting and **delete** the child's PI.
- **In code:** Route these through the DSAR engine, parameterized to accept parent-initiated requests with parent identity verification: access/export of the child's records, deletion across primary tables and backups/sub-processors, and a revocation handler that flips consent off and triggers deletion. Log each request and fulfillment immutably.
- **Primitive:** 2 (DSAR engine); 7 (Retention + deletion jobs); 6 (Immutable audit logging)
- **Cite:** 16 CFR §312.6

### §312.7 — No conditioning participation on excess collection
- **Requires:** An operator may not condition a child's participation in a game, prize offer, or other activity on the child disclosing more PI than is reasonably necessary to participate.
- **In code:** Enforce data minimization in collection forms and APIs — only fields tagged necessary-for-feature may be required; everything else is optional or omitted. Validate at the schema/API layer that gated activities do not demand non-essential child-PI.
- **Primitive:** 4 (Data inventory + sensitive-field tagging); 5 (Access control)
- **Cite:** 16 CFR §312.7

### §312.8 — Confidentiality, security, and integrity (written information security program, 2025)
- **Requires:** Establish, implement, and maintain reasonable procedures to protect the confidentiality, security, and integrity of children's PI, embodied in a **written children's personal information security program** with safeguards appropriate to the sensitivity of the data and the operator's size, complexity, and scope. The program must (per §312.8): designate one or more employees to coordinate it; perform a risk assessment identifying internal/external risks; design, implement, and maintain safeguards to control those risks and regularly test/monitor their effectiveness; and at least **annually** evaluate and adjust the program. Operators must also take reasonable steps to release child PI only to recipients capable of maintaining its confidentiality and security. A separate program is not required if an existing security program already covers children's PI.
- **In code:** Implement TLS 1.2+ in transit and AES-256 at rest with managed key management (this control mirrors HIPAA Security Rule and GDPR Art. 32 — build once, map to many). Use Supabase Auth with MFA, Postgres RLS / least-privilege roles, and Cloudflare/Fly network controls. Run the security CI in templates/ci/security.yml (SBOM generation, gitleaks secret scanning, dependency audit) and a documented annual review; record the designated owner, the risk assessment, and test results as program artifacts. Vendor due diligence on confidentiality flows through the sub-processor register.
- **Primitive:** 1 (Encryption); 5 (Access control — RLS / RBAC / MFA / least-privilege); 8 (Incident-response + breach pipeline); 9 (Vendor / sub-processor register)
- **Cite:** 16 CFR §312.8

### §312.10 — Data retention and deletion (2025)
- **Requires:** Retain children's PI only for as long as **reasonably necessary** to fulfill the specific purpose for which it was collected; **indefinite retention is prohibited**, and the PI must be **deleted** when no longer necessary. Operators must maintain a **written data retention policy** stating the purposes for retention and the business need for the retention period, and the policy must be included in the §312.4(d) online notice. A separate retention policy is not required if an existing policy already covers children's PI.
- **In code:** Define per-purpose retention TTLs in config, drive scheduled retention/deletion jobs that purge expired child-PI (including from backups and sub-processors), and publish the written retention policy from the same config into the privacy notice. Log deletions immutably to evidence enforcement. This pairs with §312.5 ID/face-match prompt-deletion and GDPR storage-limitation (Art. 5(1)(e)).
- **Primitive:** 7 (Retention + deletion jobs); 4 (Data inventory + sensitive-field tagging); 6 (Immutable audit logging)
- **Cite:** 16 CFR §312.10

### §312.9 / §312.3 — Breach and unfair-practice exposure
- **Requires:** While COPPA has no standalone numeric breach-notification deadline, §312.8's security duty together with §312.9 (Enforcement — a Rule violation is treated as an unfair/deceptive act under the FTC Act) and the §312.3 prohibition mean a security failure exposing child PI is an enforceable violation; FTC guidance and consent orders expect prompt response. State breach-notification laws apply in parallel.
- **In code:** Wire the incident-response + breach pipeline to detect, triage, and notify on any exposure of child-PI-tagged data; pull affected-record scope from the data inventory and audit logs. Keep counsel in the loop on notification timing and content.
- **Primitive:** 8 (Incident-response + breach pipeline); 6 (Immutable audit logging); 4 (Data inventory + sensitive-field tagging)
- **Cite:** 16 CFR §312.3, §312.9

### §312.11 — Safe harbor programs
- **Requires:** Operators may obtain a presumption of compliance by adhering to FTC-approved self-regulatory safe-harbor program guidelines. The 2025 amendments add program obligations — proposed-guideline modifications, comprehensive annual reporting to the Commission identifying subject operators and approved services, and other items in §312.11(d) and (g) — with certain provisions ((d)(1), (d)(4), (g)) carrying compliance dates earlier than the general April 22, 2026 date.
- **In code:** If you join a safe-harbor program, map its specific control checklist onto these same primitives; the program's audits will request the evidence enumerated below. (For a solo operator this is optional, not required.)
- **Primitive:** 9 (Vendor / sub-processor register); 6 (Immutable audit logging)
- **Cite:** 16 CFR §312.11 (incl. §312.11(d)(1), (d)(4), (g))

## Evidence to retain
- **Directed-to-children / mixed-audience determination memo** — the §312.2 factor analysis and age-screen design (counsel-reviewed); date-stamped and re-reviewed on material changes.
- **Online privacy notice + parent direct-notice templates** — versioned, showing third-party categories/purposes and the retention policy (§312.4).
- **Verifiable parental consent records** — per child: VPC method used, parent identity-proof result, timestamp, scope (collection/use vs. third-party disclosure / advertising / AI training), and any consent revocation; plus proof that ID/face-match verification artifacts were promptly deleted (§312.5).
- **Granular consent / preference-store exports** — evidencing the separate third-party-disclosure opt-in (§312.5(a)(2)).
- **Data inventory** — field-level map of child-PI, persistent identifiers, and biometric identifiers with sensitivity tags (§312.2, §312.7 minimization).
- **DSAR / parental-request log** — review, deletion, and consent-revocation requests with verification and fulfillment timestamps (§312.6).
- **Written children's-PI security program** — designated coordinator, dated risk assessment, safeguards inventory, security-CI runs (SBOM, gitleaks, dep-audit) and test/monitoring results, and the **annual** evaluation record (§312.8).
- **Written data-retention policy + deletion-job logs** — per-purpose retention periods with business justification, and immutable logs showing expired child-PI was deleted across primary stores, backups, and sub-processors (§312.10).
- **Vendor / sub-processor register** — contracts and security/confidentiality terms with any party receiving child PI, including ad/analytics SDKs and AI providers, with COPPA flow-down obligations (§312.4, §312.8).
- **Incident-response records** — breach playbook, drills, and any incident timelines affecting child PI (§312.8, §312.3/§312.9).
- **Safe-harbor program records** (if applicable) — approved guidelines, annual reports submitted to the Commission, and audit results (§312.11).

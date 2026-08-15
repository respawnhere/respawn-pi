# NIS2 Directive — network and information system security (EU) — requirements checklist
> Source: https://eur-lex.europa.eu/eli/dir/2022/2555/oj · Directive (EU) 2022/2555 (NIS2) · retrieved 2026-06-22 · EU law, © European Union — reuse permitted with attribution (Decision 2011/833/EU); enforced only through national transposing law, which may add stricter terms. Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- NIS2 binds **essential** and **important** entities (Art. 3) that operate in the **Annex I** (high-criticality) or **Annex II** (other critical) sectors AND meet at least the **medium-enterprise size cap** (Art. 2(1)) — generally **≥50 staff OR >€10M annual turnover/balance-sheet** (Commission Recommendation 2003/361/EC). Annex I includes **digital infrastructure** (DNS, TLD registries, cloud computing service providers, data-centre service providers, content delivery networks, trust service providers, electronic communications) and **ICT service management (B2B)** — managed service providers (MSPs) and managed security service providers (MSSPs).
- **Size-cap exceptions apply regardless of size** (Art. 2(2)) for certain providers — e.g. DNS service providers, TLD registries, providers of public electronic communications networks/services, trust service providers — so a small entity in those specific roles can be in direct scope.
- **Classification:** entities above the size cap in Annex I sectors are **essential**; those in Annex II (or medium-sized Annex I entities) are **important** (Art. 3(1)–(2)). The split sets the supervisory regime (ex ante vs. ex post) and penalty ceilings, not the substantive Art. 21 measures, which apply to both.
- **A typical small SaaS on managed infra is usually INDIRECT.** Your Supabase/Fly/Cloudflare/Vercel/Postgres providers are likely in-scope cloud/data-centre/MSP entities; their **Art. 21(d) supply-chain obligations flow down to you by contract**, and B2B customers who are themselves regulated will push the same controls into your DPA/security addendum. If you yourself are a cloud, data-centre, CDN, MSP, or MSSP at or above the size cap, you are **directly** in scope.
- **Effective dates:** entered into force **16 Jan 2023**; **transposition deadline 17 Oct 2024** (Art. 41(1)), with measures **applying from 18 Oct 2024** (Art. 41(1)). NIS2 is a directive — obligations bite through each Member State's national law, and several states transposed late, so verify the applicable national statute and its commencement/registration deadlines. Whether you cross the size cap or fall under an exception is a determination to confirm with counsel.
- **Sibling overlap:** Art. 21 measures feed **GDPR Art. 32** (security of processing), **DORA** (which is *lex specialis* and largely displaces NIS2 for in-scope financial entities), and the **Cyber Resilience Act (CRA)** for products with digital elements. Build the controls once; map to many.

## Requirements

### Art. 20(1) — Management-body approval, oversight, liability
- **Requires:** The entity's management body must **approve** the cybersecurity risk-management measures, **oversee** their implementation, and **can be held liable** for the entity's infringement of Art. 21.
- **In code:** Record dated management approval of the security policy set and a recurring oversight cadence (review of audit-log summaries, incident metrics, vendor register, retention-job status). Surface program state in a governance dashboard so sign-off is evidenced, not assumed.
- **Primitive:** 6 (Immutable audit logging) — for the evidence trail; supports 1–9 as the approved program.
- **Cite:** Directive (EU) 2022/2555, Art. 20(1).

### Art. 20(2) — Management-body and staff training
- **Requires:** Members of management bodies must **follow training**; entities are encouraged to offer regular similar training to employees, to gain sufficient knowledge to identify and assess cybersecurity risks.
- **In code:** Track completion of security training for owners/officers and staff; store records with the governance evidence. Pairs with Art. 21(2)(g) cyber-hygiene training.
- **Primitive:** 5 (Access control — least-privilege; role-aware training).
- **Cite:** Directive (EU) 2022/2555, Art. 20(2).

### Art. 21(2)(a) — Risk analysis & information-system security policies
- **Requires:** Policies on **risk analysis** and information-system security.
- **In code:** Maintain a written risk assessment tied to your **data inventory + sensitive-field tagging**; classify data stores (Postgres tables, Supabase buckets) and the threats to each. The inventory anchors every downstream control.
- **Primitive:** 4 (Data inventory + sensitive-field tagging).
- **Cite:** Directive (EU) 2022/2555, Art. 21(2)(a).

### Art. 21(2)(b) — Incident handling
- **Requires:** **Incident handling** policies and procedures.
- **In code:** Run the incident-response + breach pipeline: detection from audit logs/alerting, severity triage, containment runbooks, and the Art. 23 notification workflow (below). Same pipeline serves GDPR Art. 33/34 breach reporting.
- **Primitive:** 8 (Incident-response + breach pipeline).
- **Cite:** Directive (EU) 2022/2555, Art. 21(2)(b).

### Art. 21(2)(c) — Business continuity, backup, disaster recovery, crisis management
- **Requires:** **Business continuity, such as backup management and disaster recovery, and crisis management.**
- **In code:** Automated, tested backups (Postgres/Supabase point-in-time recovery), documented restore/DR procedure with RPO/RTO targets, and a crisis-management plan. Retention + deletion jobs govern backup lifecycle so recovery copies are neither lost early nor kept past their schedule.
- **Primitive:** 7 (Retention + deletion jobs); 8 (Incident-response — crisis management).
- **Cite:** Directive (EU) 2022/2555, Art. 21(2)(c).

### Art. 21(2)(d) — Supply-chain security
- **Requires:** **Supply-chain security**, including security aspects of the relationships between the entity and its **direct suppliers or service providers.**
- **In code:** Maintain the vendor / sub-processor register (Supabase, Fly, Cloudflare, Vercel, and any subprocessors) with DPA / security-addendum status, security posture, and contractual flow-down of these measures. This is where an upstream NIS2 entity's obligations land on you, and where you flow them to your own subprocessors.
- **Primitive:** 9 (Vendor / sub-processor register).
- **Cite:** Directive (EU) 2022/2555, Art. 21(2)(d).

### Art. 21(2)(e) — Security in acquisition, development & maintenance; vulnerability handling and disclosure
- **Requires:** Security in **network and information systems acquisition, development and maintenance, including vulnerability handling and disclosure.**
- **In code:** Enforce the security CI in **templates/ci/security.yml** — **SBOM** generation, **gitleaks** secret scanning, and **dependency audit** on every build; add a coordinated vulnerability-disclosure path (security.txt / intake) and a remediation SLA. The SBOM and vuln-handling controls are shared directly with the **CRA** and with NIS2 product expectations.
- **Primitive:** 8 (Incident-response + breach pipeline) for vulnerability intake/remediation; 9 (Vendor / sub-processor register) for dependency/SBOM provenance — delivered via the secure-SDLC security CI (SBOM / gitleaks / dep-audit), shared with CRA.
- **Cite:** Directive (EU) 2022/2555, Art. 21(2)(e).

### Art. 21(2)(f) — Assessing effectiveness of the measures
- **Requires:** Policies and procedures to **assess the effectiveness** of the cybersecurity risk-management measures.
- **In code:** Schedule periodic control testing/review (CI pass rates, restore-test results, access reviews, penetration-test or scan cadence) and log outcomes into the governance evidence consumed under Art. 20(1).
- **Primitive:** 6 (Immutable audit logging — effectiveness evidence).
- **Cite:** Directive (EU) 2022/2555, Art. 21(2)(f).

### Art. 21(2)(g) — Basic cyber hygiene and cybersecurity training
- **Requires:** **Basic cyber-hygiene practices and cybersecurity training.**
- **In code:** Enforce baseline hygiene — patching cadence, least-privilege defaults, secret rotation, MFA on all admin/console access (Supabase, Fly, Cloudflare, Vercel, GitHub) — and record staff training. Complements Art. 20(2).
- **Primitive:** 5 (Access control — MFA / least-privilege).
- **Cite:** Directive (EU) 2022/2555, Art. 21(2)(g).

### Art. 21(2)(h) — Cryptography and, where appropriate, encryption
- **Requires:** Policies and procedures regarding the **use of cryptography and, where appropriate, encryption.**
- **In code:** **TLS 1.2+ in transit** (Cloudflare/Fly edge), **AES-256 at rest** (Postgres/Supabase storage), and documented key management/rotation. Same control satisfies **GDPR Art. 32** and **HIPAA** encryption expectations.
- **Primitive:** 1 (Encryption — TLS 1.2+, AES-256, key management).
- **Cite:** Directive (EU) 2022/2555, Art. 21(2)(h).

### Art. 21(2)(i) — Human-resources security, access-control policies, asset management
- **Requires:** **Human-resources security, access-control policies and asset management.**
- **In code:** **Postgres RLS** + **RBAC** for least-privilege data access, **Supabase Auth** with role separation, onboarding/offboarding (immediate credential revocation), and an asset register tied to the Art. 21(2)(a) data inventory.
- **Primitive:** 5 (Access control — RLS / RBAC / least-privilege); 4 (Data inventory — asset register).
- **Cite:** Directive (EU) 2022/2555, Art. 21(2)(i).

### Art. 21(2)(j) — MFA / continuous authentication; secured comms; emergency comms
- **Requires:** **Use of multi-factor authentication or continuous authentication solutions, secured voice, video and text communications and secured emergency communication systems** within the entity, where appropriate.
- **In code:** Enforce **MFA** on all privileged accounts and end-user auth where appropriate (Supabase Auth MFA); use encrypted channels for internal/operational comms; designate an out-of-band emergency communication path for incident handling.
- **Primitive:** 5 (Access control — MFA).
- **Cite:** Directive (EU) 2022/2555, Art. 21(2)(j).

### Art. 23(1), (3) — Notify CSIRT/authority and inform affected recipients
- **Requires:** Notify the **CSIRT or competent authority** of any **significant incident** without undue delay; where appropriate, inform **recipients of services** of significant incidents and, for significant cyber threats, of measures or remedies they can take and of the threat itself.
- **In code:** The incident pipeline emits a notification artifact to the designated CSIRT/authority and triggers customer-/user-facing communications, with all timestamps captured in immutable logs. Reuse the GDPR breach-notification path where the incident is also a personal-data breach.
- **Primitive:** 8 (Incident-response + breach pipeline); 6 (audit logging of notifications).
- **Cite:** Directive (EU) 2022/2555, Art. 23(1), Art. 23(3).

### Art. 23(4) — Multi-stage reporting timeline
- **Requires:** For a significant incident: (a) **early warning** without undue delay and in any event **within 24 hours** of becoming aware (flagging suspected unlawful/malicious cause and possible cross-border impact); (b) **incident notification** without undue delay and in any event **within 72 hours** (updating the early warning, with an initial severity/impact assessment and indicators of compromise where available); (c) an **intermediate report** on relevant status updates upon a CSIRT/authority request; (d) a **final report not later than one month** after the incident notification (detailed description, severity, impact, threat type/root cause, mitigations applied, and any cross-border impact); and, where the incident is ongoing at that point, a **progress report** then and a final report **within one month of handling completion.** Trust service providers face a tightened 24-hour notification under the Art. 23(4) derogation (from point (b)). Separately, Art. 23(5) requires the CSIRT/competent authority to give the notifying entity initial feedback (and, on request, guidance on mitigation) without undue delay and where possible within 24 hours of the early warning.
- **In code:** Encode the 24h / 72h / 1-month clock as a tracked workflow with deadline timers, drafted report templates per stage, and immutable timestamps for each submission. Trigger automatically from the incident pipeline.
- **Primitive:** 8 (Incident-response + breach pipeline); 6 (Immutable audit logging — deadline evidence).
- **Cite:** Directive (EU) 2022/2555, Art. 23(4) (incl. the trust-service-provider derogation in the second subparagraph).

### Art. 27 — Registration of entities
- **Requires:** Certain entity types (e.g. DNS service providers, TLD name registries, entities providing domain-name registration services, cloud computing service providers, data-centre service providers, content-delivery-network providers, managed service providers, managed security service providers, and providers of online marketplaces/search engines/social networking platforms) (Art. 27(1)) must **submit registration information** — name, relevant sector/subsector, the address of the main establishment and any other Union establishments, up-to-date contact details (email, IP ranges, telephone numbers), and the Member States where services are provided — to the competent authority/ENISA, which maintains the registry (Art. 27(2)). A related but distinct mechanism, the Member-State **list of essential and important entities** (Art. 3(3)–(4); to be established by 17 April 2025 and reviewed at least every two years), separately requires entities to submit comparable contact/IP-range data.
- **In code:** Not a code control. Track registration status and the submitted data set in the compliance register; keep contact/IP-range details current. Confirm with counsel whether your role triggers Art. 27 registration under the applicable national law.
- **Primitive:** 9 (Vendor / sub-processor register — extended to own registration record).
- **Cite:** Directive (EU) 2022/2555, Art. 27(1) (entity types), Art. 27(2) (information set); related Member-State list at Art. 3(3)–(4).

## Evidence to retain
- **Governance:** dated management-body approval of the Art. 21 measures, oversight/review minutes, and management/staff training completion records (Art. 20).
- **Risk & inventory:** current risk assessment, data inventory with sensitive-field tags, and asset register (Art. 21(2)(a), (i)).
- **Policies:** the documented security, incident-handling, business-continuity/DR, supply-chain, cryptography, access-control, and acquisition/development policy set (Art. 21(2)(a)–(j)).
- **Continuity:** backup configuration, periodic **restore-test results**, and DR/crisis-management plan with RPO/RTO (Art. 21(2)(c)).
- **Supply chain:** vendor/sub-processor register with DPA/security-addendum status and flow-down clauses (Art. 21(2)(d), Art. 27 contact data).
- **Secure SDLC:** SBOMs, gitleaks/dependency-audit CI logs, vulnerability-disclosure intake and remediation records (Art. 21(2)(e)).
- **Effectiveness:** control-testing/audit outcomes, access-review logs, scan/pen-test reports (Art. 21(2)(f)).
- **Access & crypto:** MFA enrollment evidence, RLS/RBAC policy definitions, key-management/rotation records, TLS/at-rest encryption configuration (Art. 21(2)(g)–(j)).
- **Incidents:** immutable incident records with timestamps for the **24-hour early warning, 72-hour notification, any intermediate/progress report, and the one-month final report**, plus copies of submissions to the CSIRT/authority and any recipient notifications (Art. 23).
- **Registration:** proof of Art. 27 registration submission and the current registered data set, where applicable.
- Retention periods are set by the **national transposing law and the competent authority/CSIRT**, not the directive itself — align retention-job schedules to those national requirements and to your DORA/GDPR/CRA obligations where they overlap. Scope determinations, Art. 27 applicability, and cross-border reporting obligations warrant legal/DPO sign-off.

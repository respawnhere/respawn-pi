# Compliance requirements (North America + EU)

A reference for the regulatory and standards frameworks a product team on managed infrastructure is most likely to hit, mapped to what each means in code. This is a starting map, **not legal advice** — confirm current status against the official sources, since several 2026/2027 deadlines and the EU "Digital Omnibus" simplifications are still moving.

For the full per-article checklists, see `library/compliance/requirements/<framework>.md`.

The planned [`/comply` skill](#planned-the-comply-skill) reads this; humans cite it.

## Triage first — most obligations are conditional
Figure out which frameworks apply before doing anything:

| If you… | …then |
|---|---|
| handle personal data of people in the **EU/UK** | GDPR + UK GDPR + ePrivacy/cookie consent (one EU user triggers it — no size threshold) |
| handle personal data of **US state residents** | CCPA/CPRA (CA) + the ~20 state privacy laws (data-volume thresholds) |
| have **Canadian** users | PIPEDA (+ Quebec **Law 25** for Quebec residents) |
| handle **health data** for a provider/insurer | HIPAA (you are a Business Associate) |
| offer **financial products** / move money | GLBA |
| reach **children under 13** | COPPA |
| take **card payments** | PCI-DSS (stay in SAQ-A scope via Stripe/hosted fields) |
| sell to **enterprise / EU** | SOC 2 / ISO 27001 (market-driven, not law) |
| ship an **AI feature** | EU AI Act transparency (Art. 50) |
| ship an **installable artifact** (app/CLI/SDK/firmware) | EU Cyber Resilience Act (SBOM + vuln handling) |
| sell to **EU financial firms / regulated sectors / government** | DORA / NIS2 / FedRAMP / NIST 800-171 (conditional, sales-triggered) |

## The unified primitives — build once, map to many
The frameworks overlap heavily. Build these shared mechanisms once and map evidence to each regime, rather than per-law silos:

1. **Encryption** — TLS 1.2+ in transit, AES-256 at rest, key management (NIST SP 800-111/52). Required or safe-harbor-unlocking under HIPAA, CCPA, GLBA, GDPR Art. 32, NIS2, DORA, CRA, SOC 2, ISO 27001.
2. **Data-subject-rights (DSAR) engine** — access / delete / correct / export, keyed by (user, jurisdiction), across DB + backups + caches + analytics + sub-processors. Serves GDPR, UK GDPR, CCPA, every US-state law, PIPEDA, Law 25, the HIPAA access right.
3. **Consent + preference store** — granular, timestamped, withdrawable; default-deny for sensitive fields; server-side GPC honoring; gates third-party tags/SDKs. Serves CCPA opt-out, state laws, ePrivacy cookies, COPPA, GDPR consent, AI Act transparency.
4. **Data inventory + sensitive-field tagging** — know where regulated data (PII / PHI / PCI / NPI / child) lives. Feeds minimization, retention, DPIAs, and breach-scope analysis for every framework.
5. **Access control — least privilege / RLS + MFA** — Postgres RLS + RBAC + MFA + scoped tokens. HIPAA, GLBA, SOX ITGCs, "reasonable security," SOC 2, ISO, NIST.
6. **Immutable audit logging** — who-did-what-to-regulated-data, retained. HIPAA, GLBA, SOX, PCI (12 months), SOC 2.
7. **Retention + deletion jobs** — data minimization + scheduled deletion. CCPA, state laws, COPPA, GLBA, GDPR, PIPEDA, Law 25.
8. **Incident-response + breach pipeline** — one detect→log→timeline→notify workflow, parameterized by the tightest applicable clock + recipient: GLBA 30d/FTC · HIPAA 60d/HHS · GDPR 72h/DPA · NIS2 24h/CSIRT · DORA hours · CRA 24h/ENISA.
9. **Vendor / sub-processor register** — one inventory flagging the contract type per vendor (BAA for PHI, DPA for PII, security addendum for NPI). The highest-leverage managed-infra check: confirm the provider offers the needed contract **before** routing regulated data to it (Supabase / Fly / Cloudflare / Vercel / email / SMS / LLM APIs all vary).

Use **NIST CSF 2.0** as the umbrella scaffold for the security side and the **NIST Privacy Framework** for the privacy side — both are free, program-oriented, and publish official cross-walks to the certifiable standards.

---

## United States

**HIPAA** *(PHI; HHS)* — **Applies:** any vendor that creates/receives/stores/transmits PHI for a covered entity is a Business Associate, directly liable. No size threshold. **Requires:** Security Rule safeguards, minimum-necessary use, signed **BAA** before any PHI flows to a sub-processor, breach notice ≤60 days. **In code:** encryption at rest+in transit (unlocks the breach safe harbor), RLS + RBAC + unique IDs, immutable audit logging of PHI access, session timeout, 6-year doc retention; keep PHI out of logs/analytics/error-trackers/LLM prompts unless those vendors are under BAA. [hhs.gov/hipaa](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html)

**CCPA / CPRA** *(California; CPPA + AG)* — **Applies:** for-profits doing business with CA residents over a threshold ($25M revenue, or 100k consumers, or 50% revenue from selling data). **Requires:** access/delete/correct/opt-out-of-sale-or-sharing/limit-SPI rights, privacy policy, "Do Not Sell or Share" + Global Privacy Control honoring, retention limits, service-provider contracts. **In code:** DSAR pipeline (export/delete/correct across all stores), server-side GPC detection that suppresses sale/sharing + ad pixels, SPI field tagging, scheduled deletion; **encrypt/redact** name+SSN/financial/medical/biometric — there's a private right of action with $100–$750/consumer statutory damages for breaches of un-encrypted such data. [oag.ca.gov/privacy/ccpa](https://oag.ca.gov/privacy/ccpa) · [cppa.ca.gov](https://cppa.ca.gov)

**US state privacy laws** *(VCDPA, CO, CT, UT, TX + ~15 more — AG-enforced)* — **Applies:** ~100k residents, or ~25k + sale revenue (the "Virginia model"); mostly no revenue gate. **Requires:** access/correct/delete/portability + opt-out of targeted-ads/sale/profiling, opt-IN consent for sensitive data (most states), DPAs, DPIAs for risky processing, GPC honoring (CO/CT/TX/newer). **In code:** build the CCPA DSAR + consent engine once and layer per-state deltas (consent default, GPC scope); treat CCPA as the strict superset. [VCDPA](https://law.lis.virginia.gov/vacode/title59.1/chapter53/)

**COPPA** *(children under 13; FTC)* — **Applies:** services directed to under-13s, or with actual knowledge of collecting their data. **Requires:** verifiable parental consent before collection, separate consent for third-party ad disclosure (2025 Rule), parental review/delete, data minimization, written security program, retention limits. **In code:** age gate → VPC flow + stored consent record; disable third-party tracking SDKs/pixels/persistent-ID analytics for child users by default (persistent identifiers **are** PI here); parent dashboard. [ftc.gov COPPA](https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa)

**GLBA Safeguards Rule** *(financial NPI; FTC)* — **Applies:** any business "significantly engaged" in financial products/services (broadly: lending, payments, advising, money movement). **Requires:** written infosec program, designated Qualified Individual, risk assessment, **mandatory** encryption of NPI, MFA, access controls, vendor oversight, IR plan, FTC breach notice ≤30 days (500+ consumers). **In code:** encrypt NPI at rest+in transit, enforce MFA, RLS + least privilege, centralized logging, secure SDLC, the 30-day breach clock. [ftc.gov Safeguards](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know)

**SOX §302/§404** *(public companies; SEC/PCAOB)* — **Applies:** publicly traded companies; **mostly not relevant pre-IPO**. **Adopt early anyway (IPO/acquisition/enterprise-sale readiness):** access controls + periodic reviews + segregation of duties over financial/prod systems, change management (PRs, mandatory review, approvals, audit trail), immutable deploy/audit logs, no unlogged prod DB edits. If you sell to public companies, plan for a SOC 1 report. [sec.gov §404](https://www.sec.gov/rules-regulations/2003/06/managements-report-internal-control-over-financial-reporting-certification-disclosure)

## Canada

**PIPEDA** *(federal private sector; OPC)* — **Applies:** any org handling Canadians' personal data in commercial activity; no size threshold. **Requires:** the 10 Fair Information Principles (accountability, purpose, meaningful consent, minimization, safeguards, access/correction), mandatory breach report to OPC + individuals on Real Risk of Significant Harm, and a breach log for **all** incidents kept 24 months. **In code:** versioned withdrawable consent, minimization, retention/deletion, encryption + RLS + MFA + audit logging, DSAR tooling, a 24-month breach log + RROSH runbook. [priv.gc.ca PIPEDA](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/)

**Quebec Law 25** *(Quebec residents; CAI — the strictest CA regime; penal fines to CAD $25M or 4%, administrative penalties to $10M or 2%)* — **Requires:** named Privacy Officer, breach reporting + register, **PIAs** for IT projects and before cross-border transfers, granular unbundled consent (express for sensitive), **privacy-by-default**, automated-decision transparency + human review, data portability + right to deindexing. **In code:** the PIPEDA/GDPR consent+DSAR base **plus** privacy-by-default toggles, a PIA gate on new features/transfers (Supabase/Fly/Cloudflare/Vercel may store outside Quebec — document residency), automated-decision explainability, and portability/erasure export. [cai.gouv.qc.ca Law 25](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25)

## Cross-cutting security standards (market-driven, not law)

**SOC 2** *(AICPA; the US B2B trust signal)* — Five Trust Services Categories (Security/Common Criteria is mandatory; +Availability/Confidentiality/Processing-Integrity/Privacy optional). Type II (controls over 3–12 months) is what buyers want. **Evidence auditors expect:** SSO/MFA, RBAC + quarterly access reviews, TLS + at-rest encryption, centralized tamper-resistant logs, vuln scanning + patch management, PR/CI-tied change management, IR plan, vendor DPAs, backups + tested restore, data classification. For small teams, automate evidence (Vanta/Drata/Secureframe-class). [aicpa-cima.com SOC](https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services)

**PCI-DSS v4.0.1** *(card brands)* — **Applies:** anyone storing/processing/transmitting cardholder data. **The architecture decision that matters:** keep the PAN out of scope — use Stripe/Paddle/Braintree hosted fields/Checkout/redirect so the PAN never hits your servers (then you're usually **SAQ A**). Building your own card form drags the whole stack into scope. **Never store** CVV/track/PIN post-auth (scrub logs/error trackers/DB dumps). If in scope: render PAN unreadable, TLS 1.2+, MFA into the CDE, 12-month logs, quarterly ASV scans, payment-page script integrity (SRI/CSP, anti-Magecart). [pcisecuritystandards.org](https://www.pcisecuritystandards.org/document_library/)

**ISO/IEC 27001:2022** *(international ISMS cert; the EU-market analogue to SOC 2)* — Clauses 4–10 (the management system: risk assessment, Statement of Applicability, internal audit, management review) + Annex A's 93 controls. Technological controls map to the same RLS/RBAC/MFA, crypto + key management, secure SDLC, logging, backup, data masking/DLP, vuln management, and cloud-service security as SOC 2. Reuse one control set for both. [iso.org/standard/27001](https://www.iso.org/standard/27001)

**NIST CSF 2.0** *(free organizing scaffold)* — Six Functions: **Govern** (new — incl. supply-chain risk GV.SC), Identify, Protect, Detect, Respond, Recover. Not certifiable; the best free starting structure, with a Small Business Quick-Start Guide and official cross-walks to SOC 2 / ISO. Use it as the umbrella that maps onto everything else. [nist.gov/cyberframework](https://www.nist.gov/cyberframework)

**NIST SP 800-53 / 800-171 / Privacy Framework / FedRAMP** *(US gov-oriented)* — **800-53** is the ~1000-control catalog under FedRAMP/FISMA — for a private SaaS, a lookup reference, not a target. **800-171** protects CUI for the DoD supply chain (CMMC) — only if you pursue defense contracts; note its FIPS-validated-crypto + CUI-enclave-isolation nuance. **NIST Privacy Framework** (Identify-P/Govern-P/Control-P/Communicate-P/Protect-P) is the free scaffold that turns GDPR/CPRA/PIPEDA/Law 25 into engineering practice — use it for the privacy side. **FedRAMP** is gov-only; the practical takeaway is "prefer FedRAMP-authorized infra if you ever target government." [csrc.nist.gov](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) · [nist.gov/privacy-framework](https://www.nist.gov/privacy-framework)

## European Union + UK

**GDPR** *(EU/EEA; extraterritorial — Art. 3)* — **Applies:** any processing of EU people's personal data; no threshold (one EU user counts). **Requires:** a lawful basis per activity; data-subject rights within 1 month; data-protection-by-design (Art. 25); Records of Processing (Art. 30); DPIA for high-risk; **Art. 28 DPA** with every processor; **72-hour** breach notice (Art. 33); lawful international-transfer mechanism (adequacy / SCCs + transfer assessment); DPO if core activities are large-scale monitoring or special-category. Fines to €20M or 4%. **In code:** TLS + at-rest encryption + pseudonymisation (Art. 32), RLS, self-serve export/delete + consent records, a ROPA inventory + retention jobs, audit logging, an **EU region** on your infra + SCCs for any US transfer, breach alerting that can hit 72h. [eur-lex GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)

**UK GDPR + DPA 2018** *(ICO)* — Substantively identical to EU GDPR; if you build for EU you're ~95% there. **Deltas (process, not code):** use the **IDTA / UK Addendum** (not bare EU SCCs) for UK→non-adequate transfers, check the UK adequacy list separately, appoint a UK representative, breach reports go to the ICO. Treat EU+UK as one data-rights codebase with two transfer-paperwork tracks. [ico.org.uk](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/)

**ePrivacy Directive / UK PECR** *("cookie law")* — **Applies:** anything that stores/reads info on a device (cookies, localStorage, SDK IDs, pixels, fingerprinting) or sends electronic marketing; sits on top of GDPR. **Requires:** prior opt-in consent before any non-essential cookie/storage; "strictly necessary" exempt; refuse must be as easy as accept (no pre-ticked boxes, a first-layer "Reject all"); marketing opt-in + unsubscribe. **In code:** a real CMP that blocks non-essential scripts/tags/SDKs until consent, stores timestamped granular per-purpose consent, gates analytics/ad-pixels/session-replay/chat widgets, with a persistent "change preferences" entry. [eur-lex ePrivacy](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32002L0058)

**NIS2** *(EU network/info-system security)* — **Applies:** medium+ entities (50+ staff or >€10M) in essential/important sectors incl. digital infrastructure/providers; a typical small SaaS is **indirect** (your infra vendors are regulated; B2B customers push supply-chain requirements via contracts). **Requires:** risk management, incident handling, business continuity/backup, supply-chain security, secure dev + vuln handling, crypto, access control + MFA; tiered incident reporting (24h early warning / 72h / 1-month). **In code:** MFA + RBAC everywhere, encryption, tested isolated backups + recovery runbook, dependency scanning + SBOM + security.txt + patch SLA, supply-chain pinning, 24h-capable incident tooling. Feeds GDPR Art. 32, DORA, and CRA too. [eur-lex NIS2](https://eur-lex.europa.eu/eli/dir/2022/2555/oj)

**DORA** *(EU financial digital resilience; since Jan 2025)* — **Applies:** EU financial entities **and their ICT third-party providers** — flows down to you contractually if you sell to an EU fintech/bank/insurer/crypto firm. **Requires:** ICT risk management, incident classification + fast reporting, resilience testing (TLPT every 3y for significant entities), ICT third-party contractual terms (audit rights, SLAs, exit strategy, sub-processor disclosure) + a Register of Information, threat-intel sharing. **In code:** customer-facing incident notification, published SLAs/uptime, a tested exit/portability path, sub-processor disclosure, multi-region failover + RTO/RPO + DR testing. A "sales-unlock" track triggered by the first regulated customer. [eur-lex DORA](https://eur-lex.europa.eu/eli/reg/2022/2554/oj)

**EU AI Act** *(risk-tiered; extraterritorial by output)* — **Applies:** anyone placing/using an AI system affecting EU users, tiered by risk not size. **Most LLM features are limited-risk** and owe only **Art. 50 transparency** (from 2 Aug 2026): tell users they're interacting with AI (UI, not ToS); mark AI-generated text/image/audio/video in a machine-readable format; disclose deepfakes. **Avoid** the prohibited list (social scoring, manipulative AI, untargeted face-scraping). High-risk (hiring/credit/biometrics/etc.) is a major program (conformity assessment, human oversight, logging, CE marking) — design to stay out of it. Because AI processes personal data, GDPR applies in parallel. *(The Nov-2025 Digital Omnibus may defer the high-risk deadline — verify dates.)* [eur-lex AI Act](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)

**Cyber Resilience Act (CRA)** *(products with digital elements; reporting from 11 Sep 2026, full 11 Dec 2027)* — **Applies:** manufacturers of software/hardware placed on the EU market that connects to a device/network. **Pure SaaS is generally out** (covered by NIS2) **unless you also ship an installable artifact** (downloadable agent, desktop/mobile app, CLI, SDK, browser extension, self-hosted distribution, IoT firmware). **Requires:** security-by-design + secure-by-default, no known exploitable vulns at release, a secure update mechanism + support period, an **SBOM** + coordinated vulnerability disclosure, and 24h reporting of actively-exploited vulns to ENISA, plus CE marking. **In code:** generate/maintain an SBOM (CycloneDX/SPDX) in CI, continuous dependency-CVE scanning + patch gate, pinned/locked deps, security.txt + advisories, a signed secure-update channel, secure-default config. Overlaps RespawnPack's existing security CI. [eur-lex CRA](https://eur-lex.europa.eu/eli/reg/2024/2847/oj)

---

## The `/comply` skill & adherence layer

`/comply` mirrors the security loop:

- **`/comply` role** — (1) profile the product (what data, which residents, which sector triggers); (2) map the regulated-data flow; (3) run the applicable framework checks against the **9 unified primitives** above; (4) adversarially verify; (5) report gaps ranked by risk + remediation, and propose `DECISIONS.md` entries for accepted risks. Aliases `/compliance`, `/gdpr`, `/hipaa`.
- **Lifecycle hooks** — a compliance-by-design step in `/loadout`, a compliance lens in `/review`, a pre-ship gate in `/ship` (mirroring `/secure`).
- **Adherence (over time)** — installed artifacts under `docs/compliance/` keep posture true between audits: `compliance.config.md` (declared applicable regimes; repo root), `RoPA.md` (Records of Processing), `breach-runbook.md` (incident → notification clocks), `dpa-baa-checklist.md` (vendor contracts), and the canonical `REGISTER.md` (posture per framework + accepted risks). `/savepoint` flags new data flows that change the regime; re-audit as regulations change.
- **Triage-gated, not imposed** — GDPR + UK GDPR + ePrivacy + AI-Act transparency are the default scope; HIPAA/GLBA/COPPA/PCI/DORA/NIS2/CRA gate behind the applicability triage so they only fire when relevant.
- **No duplication** — distinct from the referenced `compliance-auditor` persona skill and the `legal:compliance-check` plugin; `/comply` is RespawnPack-owned, framework-grounded, and woven into the loop.

# GLBA Safeguards Rule (+ Privacy Rule) — requirements checklist
> Source: https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314 (Safeguards) · https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-313 (Privacy) · https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know · 16 CFR Part 314 / 16 CFR Part 313 / CFPB Regulation P 12 CFR Part 1016 · retrieved 2026-06-22 · US federal regulation (FTC), public domain. Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- You are a non-banking **"financial institution"** — an entity **significantly engaged in financial activities** (or activities incidental to them) as defined by reference to the Bank Holding Company Act and Reg Y. The Rule's examples and the FTC's expanded 2021 definition sweep in **fintech, lenders, "finders" (lead generators/marketplaces), payment/money-movement services, mortgage brokers and servicers, debt collectors, tax preparers, financial/investment advisers, account servicers, wire-transfer services, and check cashers** (§314.1(b); §314.2(h) by reference to 16 CFR 313.3(k)). A SaaS that itself moves money, lends, advises on finance, or brokers financial products is **directly in scope**; a generic B2B SaaS is usually **only indirectly** in scope as a **service provider** to a covered institution (flow-down via §314.4(f) and the customer's contract).
- **No size or revenue threshold** gates the security program. The program scales to your size and complexity (§314.4 chapeau), but you must have one.
- **Partial small-entity exemption (§314.6):** if you maintain customer information concerning **fewer than 5,000 consumers**, you are exempt **only** from §314.4(b)(1) (written risk-assessment documentation), §314.4(d)(2) (continuous-monitoring-or-pentest/vuln-assessment testing regime), §314.4(h) (written incident-response plan), and §314.4(i) (annual report to the board). **All other elements — including encryption, MFA, access controls, and the §314.4(j) breach notification — still apply.**
- **"Customer information"** = any record containing **nonpublic personal information (NPI)** about a *customer* (a consumer with a continuing relationship), handled or maintained by you or your affiliates (§314.2(d)). **NPI** is personally identifiable financial information plus lists/groupings derived from it (§314.2(l), incorporating 16 CFR 313.3(n)–(o)). As a service provider you handle the institution's customer information and inherit safeguards obligations by contract.
- **Key effective dates:** the substantive §314.4 program elements (Qualified Individual, encryption, MFA, etc.) reached their compliance deadline on **June 9, 2023** (the six-month extension of the original December 9, 2022 deadline, per the rulemaking history — this date is no longer codified in §314.5). The **§314.4(j) breach-notification requirement is effective May 13, 2024**, and is the only date still carried in the current text of §314.5 (as §314.5(j)).
- A **lawyer / the Qualified Individual** should sign off on: who counts as a "financial institution," QI-approved compensating controls where encryption is infeasible, MFA exceptions, breach-notification determinations (the 500-consumer count, unencrypted/"reasonably likely without authorization" judgment, and law-enforcement delay), and Privacy Rule notice/opt-out content.

## Requirements

### §314.3 — Standards (objectives of the program)
- **Requires:** Develop, implement, and maintain a **comprehensive, written information security program** with administrative, technical, and physical safeguards appropriate to your size, complexity, the nature/scope of activities, and the sensitivity of the customer information (§314.3(a)). Objectives (§314.3(b)): (1) ensure **security and confidentiality** of customer information; (2) protect against **anticipated threats/hazards**; (3) protect against **unauthorized access** that could result in substantial harm/inconvenience.
- **In code:** Treat the whole RespawnPack control set as the written program; anchor every safeguard below to these three objectives and record the program in the repo/spine. Same objective triad as GLBA's banking-agency Interagency Guidelines and FTC Privacy Rule §313.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** §314.3

---

### §314.4(a) — Designate a Qualified Individual
- **Requires:** Designate a **single Qualified Individual (QI)** responsible for overseeing, implementing, and enforcing the program. The QI may be an employee, an affiliate's employee, or a **service provider's** staff; if external, you retain responsibility, must designate a senior member of your own personnel to **direct and oversee** the QI, and the service provider must maintain a program protecting you.
- **In code:** Name the QI in the security policy (the founder, for a solo team); record in the spine. If you outsource security to a vendor, name your internal overseer and capture the vendor in the sub-processor register (§314.4(f)).
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege (ownership/accountability)
- **Cite:** §314.4(a)

### §314.4(b) — Written risk assessment
- **Requires:** Base the program on a **risk assessment** identifying reasonably foreseeable internal and external risks to the security, confidentiality, and integrity of customer information, and assessing the sufficiency of safeguards. **§314.4(b)(1):** the risk assessment must be **written** and include (i) criteria for evaluating and categorizing identified risks, (ii) criteria for assessing confidentiality/integrity/availability and adequacy of existing controls, and (iii) how identified risks will be mitigated or accepted and how the program addresses them. **§314.4(b)(2):** **periodically reassess** in light of changes to operations or new threats. *(§314.4(b)(1) is exempt under §314.6 below 5,000 consumers — but a documented assessment is still strongly advised.)*
- **In code:** Maintain a written risk register over the customer-information inventory with the (i)–(iii) criteria; tie a remediation backlog to it; re-run on each new data flow or infra change. Same risk-analysis spine as HIPAA §164.308(a)(1) and ISO 27001 / SOC 2 risk assessment.
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** §314.4(b)

### §314.4(c)(1) — Access controls
- **Requires:** Implement and periodically review **access controls**, including technical and (as appropriate) physical controls, to (i) **authenticate and permit access only to authorized users** and (ii) **limit authorized users' access to only the customer information they need** (least privilege).
- **In code:** Postgres **RLS** for per-tenant/per-user isolation; **RBAC** scoped to job function; no shared accounts; periodic access reviews; revoke on offboarding. Maps to PCI-DSS Req. 7/8 and HIPAA §164.312(a).
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** §314.4(c)(1)

### §314.4(c)(2) — Data inventory and mapping
- **Requires:** **Identify and manage the data, personnel, devices, systems, and facilities** that enable you to achieve business purposes, according to their relative importance to business objectives and risk strategy.
- **In code:** Maintain a customer-information **data inventory** with sensitive-field tagging — where NPI lives across Supabase/Postgres, storage buckets, logs, queues, backups, and each sub-processor; map flows in/out. Feeds the risk assessment (b) and disposal (c)(6).
- **Primitive:** 4. Data inventory + sensitive-field tagging
- **Cite:** §314.4(c)(2)

### §314.4(c)(3) — Encryption of customer information in transit and at rest
- **Requires:** **Protect by encryption all customer information held or transmitted by you, both in transit over external networks and at rest.** Where encryption is **infeasible**, you may secure the information using **effective alternative compensating controls reviewed and approved by your Qualified Individual**.
- **In code:** **TLS 1.2+** for all external transport (HSTS, no plaintext); **AES-256 at rest** on Postgres, storage buckets, and backups; documented key management (managed KMS / provider-managed keys). Any compensating control gets explicit written QI sign-off. Same control as HIPAA §164.312(a)/(e), GDPR Art. 32, and PCI-DSS Req. 3/4 — build once, map to all.
- **Primitive:** 1. Encryption (TLS 1.2+ in transit, AES-256 at rest, key management)
- **Cite:** §314.4(c)(3)

### §314.4(c)(4) — Secure development practices
- **Requires:** Adopt **secure development practices for in-house developed applications** used to transmit, access, or store customer information, **and** procedures for **evaluating, assessing, or testing the security of externally developed applications** you use.
- **In code:** SDLC controls in CI — `templates/ci/security.yml` (**SBOM**, **gitleaks** secret scanning, **dep-audit**/dependency scanning), code review, and SAST/dependency gates; vet third-party apps/libraries before adoption. SBOM/dependency provenance is the same artifact NIS2/CRA and SOC 2 change-management expect.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege (secure SDLC / supply chain)
- **Cite:** §314.4(c)(4)

### §314.4(c)(5) — Multi-factor authentication
- **Requires:** Implement **MFA for any individual accessing any information system**, unless the Qualified Individual has **approved in writing** the use of reasonably equivalent or more secure access controls. MFA requires at least **two** of: knowledge factor, possession factor, inherence factor.
- **In code:** Enforce **MFA via Supabase Auth / SSO** for every human accessing any system holding customer information (app admin, database, cloud consoles, repo, CI); document any QI-approved equivalent. Broader than PCI-DSS (which scoped MFA to the CDE) — here it is *any* information system.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** §314.4(c)(5)

### §314.4(c)(6) — Secure disposal and retention
- **Requires:** Develop procedures for the **secure disposal of customer information** no later than **two years after the last date the information is used** in connection with providing a product/service, **unless** retention is required by law/regulation, is necessary for legitimate business purposes, or targeted disposal is not reasonably feasible due to how it is maintained. **Periodically review** your data-retention policy to minimize unnecessary retention.
- **In code:** **Retention + deletion jobs** with a default ≤2-year clock keyed to last-use; documented exceptions where a longer legal/business basis applies; periodic retention-policy review. Same retention-minimization control as GDPR Art. 5(1)(e) / CCPA storage-limitation.
- **Primitive:** 7. Retention + deletion jobs
- **Cite:** §314.4(c)(6)

### §314.4(c)(7) — Change management
- **Requires:** Adopt procedures for **change management**.
- **In code:** Documented change-management process — version control, code review, migration review, IaC/config change approvals, and an audit trail of infra/schema changes (Supabase migrations, Fly/Cloudflare config). Same control as SOC 2 CC8.1 and HIPAA change procedures.
- **Primitive:** 6. Immutable audit logging (change record); 5. Access control (change approval)
- **Cite:** §314.4(c)(7)

### §314.4(c)(8) — Monitoring and logging of authorized user activity
- **Requires:** Implement policies, procedures, and controls designed to **monitor and log the activity of authorized users** and to **detect unauthorized access to, use of, or tampering with** customer information by those users.
- **In code:** **Immutable, append-only audit logs** of who accessed/modified which customer information (DB triggers / Supabase audit + centralized log sink across Cloudflare/Fly); anomaly/alerting on unexpected access; tamper-resistant retention. Same logging primitive as HIPAA §164.312(b), PCI-DSS Req. 10, SOC 2 CC7.
- **Primitive:** 6. Immutable audit logging
- **Cite:** §314.4(c)(8)

### §314.4(d) — Regular testing and monitoring
- **Requires:** **Regularly test or otherwise monitor** the effectiveness of the safeguards' key controls, systems, and procedures, including those to detect actual and attempted attacks (§314.4(d)(1)). **§314.4(d)(2):** absent **continuous monitoring or other systems** that detect changes likely to create vulnerabilities on an ongoing basis, you must conduct **annual penetration testing** of information systems **and vulnerability assessments (including systemic scans/reviews) at least every six months** — and whenever circumstances/material changes warrant. *(§314.4(d)(2) is exempt under §314.6 below 5,000 consumers.)*
- **In code:** Stand up **continuous monitoring** (the security loop: dependency/secret scans in CI, runtime alerting, IDS/WAF telemetry) to satisfy the (d)(2) alternative, **or** schedule annual pentests + biannual vuln assessments. Record results and feed program adjustment (g).
- **Primitive:** 8. Incident-response + breach pipeline (detection); 6. Immutable audit logging
- **Cite:** §314.4(d)

### §314.4(e) — Personnel, training, and qualified security staff
- **Requires:** (1) provide your personnel **security awareness training** updated to reflect risks identified by the risk assessment; (2) use **qualified information-security personnel** (your own, an affiliate's, or a service provider's) sufficient to manage your risks and oversee the program; (3) provide those personnel **updates and training** sufficient to address relevant security risks; (4) **verify** that staff take steps to maintain current knowledge of changing threats and countermeasures.
- **In code:** Documented security-awareness training (for a solo team, a recorded annual self-attestation); designate qualified security personnel (may be the QI / a vendor); track ongoing training and threat-currency. Same training control as HIPAA §164.308(a)(5) and SOC 2.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege (workforce competency/accountability)
- **Cite:** §314.4(e)

### §314.4(f) — Oversee service providers
- **Requires:** (1) **Take reasonable steps to select and retain** service providers capable of maintaining appropriate safeguards for the customer information at issue; (2) **require service providers by contract** to implement and maintain such safeguards; and (3) **periodically assess** your service providers based on the risk they present and the continued adequacy of their safeguards.
- **In code:** Maintain the **vendor / sub-processor register** (Supabase, Fly, Cloudflare, Vercel, Postgres host, email/SMS, error/analytics, LLM APIs) with a **DPA / security addendum** binding each to safeguards; vet via SOC 2 / security attestations before onboarding; re-assess on a risk-based cadence. This is the flow-down obligation that puts an upstream financial institution's requirements onto you as their service provider.
- **Primitive:** 9. Vendor / sub-processor register (BAA / DPA / security addendum)
- **Cite:** §314.4(f)

### §314.4(g) — Keep the program current
- **Requires:** **Evaluate and adjust** the information security program in light of testing/monitoring results, material changes to operations or business arrangements, results of risk assessments, or any other circumstances that may have a material impact on the program.
- **In code:** Scheduled (at least on testing results + any material change) program review; record adjustments. Reuse the security-loop / `/secure` output and the risk register as evidence.
- **Primitive:** 4. Data inventory + sensitive-field tagging (re-scoping); 8. Incident-response (program review)
- **Cite:** §314.4(g)

### §314.4(h) — Written incident-response plan
- **Requires:** Establish a **written incident response plan** designed to promptly respond to, and recover from, any **security event** materially affecting confidentiality, integrity, or availability of customer information. It must address: (1) **goals**; (2) internal **processes** for responding; (3) definition of **roles, responsibilities, and decision-making authority**; (4) **external and internal communications and information sharing**; (5) **remediation** of identified weaknesses in systems and controls; (6) **documentation and reporting** of security events and response activities; and (7) **post-event evaluation and revision** of the IR plan. *(Exempt under §314.6 below 5,000 consumers — but feeds the §314.4(j) breach pipeline that still applies.)*
- **In code:** Written IR runbook covering the seven elements (detect → triage → contain → remediate → document → post-mortem → revise); wired to the §314.4(j) FTC-notification path. Same pipeline as HIPAA §164.308(a)(6) / GDPR Art. 33–34.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** §314.4(h)

### §314.4(i) — Qualified Individual reports to the board/governing body
- **Requires:** The Qualified Individual must **report in writing, regularly and at least annually**, to your **board of directors or equivalent governing body** (or, if none, to a senior officer responsible for the program). The report must cover (1) the **overall status** of the program and compliance, and (2) **material matters** — risk assessment, risk-management/control decisions, service-provider arrangements, test results, security events and management's response, and recommendations for changes. *(Exempt under §314.6 below 5,000 consumers.)*
- **In code:** Generate an annual written QI report (the founder reports to themselves/advisors for a solo team) drawing on the risk register, test results, IR log, and vendor register; archive as evidence.
- **Primitive:** 6. Immutable audit logging (governance record); 4. Data inventory (program reporting)
- **Cite:** §314.4(i)

### §314.4(j) — Notification to the FTC of a breach (effective May 13, 2024)
- **Requires:** Notify the **FTC as soon as possible, and no later than 30 days after discovery** of a **notification event** — defined as the **acquisition of unencrypted customer information without the authorization of the individual** to which it pertains (information is "unencrypted" if the encryption key was also accessed) — involving the information of **at least 500 consumers**. Unauthorized acquisition is **presumed** unless you have reliable evidence showing none occurred. The event is **discovered** on the first day it is known to you (or would have been known with reasonable diligence). Notice is filed **electronically via the form on the FTC website (ftc.gov)** and must include: your name and contact information; the **types of information** involved; the **date or date range** of the event (if determinable); the **number of consumers affected**; a **general description** of the event; and, if applicable, whether **law-enforcement** has determined that public disclosure would impede a criminal investigation or cause damage to national security (and requested a delay). FTC-filed notification events are published in a public database (subject to the law-enforcement-delay exception).
- **In code:** Breach pipeline parameterized to the **30-day FTC clock** and the **500-consumer / unencrypted** trigger; discovery-date timestamp captured at detection; counts derived from the data inventory; templated submission matching the FTC form fields; law-enforcement-delay flag. Encryption (c)(3) is the practical safe harbor — properly encrypted information is not "unencrypted customer information" for the trigger. **QI/legal sign-off required** on the determination and count. Distinct from (and additional to) HIPAA §164.408 HHS reporting and state breach-notification laws, which may also apply.
- **Primitive:** 8. Incident-response + breach pipeline; 1. Encryption (trigger safe harbor); 4. Data inventory (affected-count scope)
- **Cite:** §314.4(j)

### §314.5 — Effective dates
- **Requires:** The current text of §314.5 contains a **single** effective-date provision — **§314.5(j): "Section 314.4(j) is effective as of May 13, 2024."** (the breach-notification requirement, 180 days after the November 13, 2023 Federal Register publication). As background/history: most other §314.4 program elements reached their compliance deadline on **June 9, 2023** (a six-month extension of the original December 9, 2022 date), but that transitional language is no longer codified in §314.5 — it derives from the rulemaking history, not the current section text.
- **In code:** No build action — date awareness for the compliance timeline and evidence dating.
- **Primitive:** — (effective-date reference)
- **Cite:** §314.5

### §314.6 — Exceptions (small-entity partial exemption)
- **Requires:** If you maintain customer information concerning **fewer than 5,000 consumers**, the following do **not** apply: **§314.4(b)(1)** (written risk assessment), **§314.4(d)(2)** (continuous-monitoring-or-annual-pentest/biannual-vuln-assessment regime), **§314.4(h)** (written IR plan), and **§314.4(i)** (annual report to the board). Everything else — encryption, MFA, access controls, disposal, monitoring/logging, service-provider oversight, **and the §314.4(j) breach notification** — still applies.
- **In code:** If under the threshold, you may scale back formal documentation of those four paragraphs — but implementing them anyway is the low-cost path and the threshold can be crossed silently as you grow, so prefer to build them.
- **Primitive:** — (scoping)
- **Cite:** §314.6

---

### Privacy Rule (16 CFR Part 313 / CFPB Reg P 12 CFR Part 1016) — Notices and opt-out
- **Requires:** The GLBA **Privacy Rule** governs how a financial institution shares NPI. Core obligations:
  - **Initial privacy notice (§313.4):** provide a clear and conspicuous notice of your privacy policies and practices to a **customer not later than when you establish the customer relationship**, and to a **consumer before** you disclose any NPI about them to a nonaffiliated third party.
  - **Annual privacy notice (§313.5):** provide the notice **at least once in any period of 12 consecutive months** during the continuation of the customer relationship. Under the **FAST Act exception (§313.5(e))**, an institution that (a) shares NPI only within exceptions that do not trigger opt-out and (b) has not changed its policies since the last delivered notice is **not required** to deliver the annual notice.
  - **Content of notices (§313.6):** the categories of NPI collected and disclosed, categories of affiliates/nonaffiliated third parties to whom disclosed, the opt-out right and means, and your confidentiality/security practices.
  - **Opt-out right and notice (§313.7, §313.10):** before disclosing NPI to a **nonaffiliated third party** (outside the §313.13–313.15 exceptions), give the consumer notice and a **reasonable opportunity and means to opt out**, and honor opt-outs.
  - **Limits on redisclosure/reuse (§313.11)** of NPI you receive; and a **prohibition on disclosing account numbers/access codes for marketing (§313.12)** to nonaffiliated third parties.
- **In code:** Treat the privacy notice as a maintained, versioned document delivered at relationship onset and annually (or qualify for the FAST Act exception); model the opt-out as a **consent + preference store** — granular, timestamped, withdrawable — that gates any NPI sharing with nonaffiliated third parties and blocks account-number sharing for marketing. **Note jurisdiction:** for most consumer financial products the **CFPB's Regulation P (12 CFR Part 1016)** is the operative privacy rule; the FTC's Part 313 retains rulemaking only for the limited entities still under FTC jurisdiction (e.g. motor-vehicle dealers). Confirm which applies with counsel.
- **Primitive:** 3. Consent + preference store (opt-out, withdrawable); 9. Vendor / sub-processor register (nonaffiliated-third-party sharing controls)
- **Cite:** 16 CFR §§313.4, 313.5, 313.6, 313.7, 313.10, 313.11, 313.12 / 12 CFR Part 1016

## Evidence to retain
FTC examiners and enterprise customers vetting you as a service provider expect:
- The **written information security program** and the named **Qualified Individual** designation (§314.3, §314.4(a)).
- The **written risk assessment** with the (b)(1)(i)–(iii) criteria, plus periodic reassessment records and the **customer-information data inventory** (§314.4(b), (c)(2)).
- **Encryption evidence:** TLS config, at-rest encryption config, key management; and any **QI-approved compensating-control** approvals where encryption was infeasible (§314.4(c)(3)).
- **Access-control evidence:** RLS/RBAC config, least-privilege grants, access-review records; **MFA enforcement** proof across all information systems and any written QI-approved MFA equivalents (§314.4(c)(1), (c)(5)).
- **Secure-development records:** SDLC procedures, CI security artifacts (SBOM, gitleaks/secret-scan, dependency-audit results), third-party-app assessments (§314.4(c)(4)).
- **Disposal & retention:** retention policy, last-use-keyed deletion-job logs honoring the ≤2-year default, and documented retention exceptions; retention-policy review records (§314.4(c)(6)).
- **Change-management records** and **audit/monitoring logs** of authorized-user activity with anomaly detection (§314.4(c)(7), (c)(8)).
- **Testing records:** continuous-monitoring configuration, or **annual penetration-test reports + biannual vulnerability assessments** (§314.4(d)).
- **Training records / workforce attestations** and evidence of qualified security personnel (§314.4(e)).
- **Service-provider oversight:** the vendor/sub-processor register, signed **DPAs/security addenda**, selection due-diligence, and periodic reassessments (§314.4(f)).
- **Program-adjustment** records (§314.4(g)); the **written incident-response plan** (§314.4(h)); and the **annual written QI report** to the board/governing body (§314.4(i)).
- **Breach records:** the IR/security-event log, notification-event determinations (the 500-consumer count and unencrypted/authorization analysis), copies of **FTC notifications with filing dates** (within the 30-day window), and any law-enforcement-delay documentation (§314.4(j)).
- **Privacy Rule artifacts:** versioned initial/annual privacy notices (or FAST Act exception qualification), opt-out notices, and the **consent/opt-out preference records** with timestamps and the account-number-sharing controls (16 CFR Part 313 / 12 CFR Part 1016).

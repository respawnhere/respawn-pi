# NIST Cybersecurity Framework 2.0 — requirements checklist
> Source: https://www.nist.gov/cyberframework · NIST CSF 2.0 Core, NIST.CSWP.29 (https://doi.org/10.6028/NIST.CSWP.29) · retrieved 2026-06-20 · US Government work, public domain (free to summarize with attribution). Reference only — not legal advice. CSF is a voluntary framework, not a law or certification. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- **Always available, never mandatory.** CSF 2.0 is a voluntary, outcome-based scaffold — not a regulation and not certifiable. Use it as the umbrella that organizes the security side of everything else (SOC 2, ISO 27001, NIS2, GLBA, HIPAA Security Rule, "reasonable security"). NIST publishes official cross-walks to those certifiable standards.
- **Best fit here:** a solo founder / small team on managed infra (Supabase / Fly / Cloudflare / Vercel) wanting one coherent program structure. Pair the **Small Business Quick-Start Guide** with this list.
- **Scoping reality on managed infra:** CSF assumes you own the stack. On PaaS you *inherit* large swaths of PROTECT/DETECT/RECOVER from the provider — your job shifts to **GOVERN** (own the risk decisions, the supply-chain register) and to configuring/verifying the controls the platform exposes (RLS, MFA, backups, audit logs). Document the shared-responsibility split as evidence.
- **Tiers & Profiles:** CSF has no pass/fail. You set a **Target Profile** (desired outcomes), assess a **Current Profile**, and close the gap; **Tiers** (Partial→Risk Informed→Repeatable→Adaptive) rate how rigorous your governance is. A small team typically targets Tier 2 governance with Tier 3 ambitions on the few controls that matter.

## Requirements
*Organized by the 6 Functions → 22 Categories. Each Category lists its key Subcategory outcomes, the concrete managed-infra action, and the mapped primitive. Citations are the CSF 2.0 Core identifiers.*

---
### GV — GOVERN (function)
*"The organization's cybersecurity risk management strategy, expectations, and policy are established, communicated, and monitored." The new 2.0 function — the one a small managed-infra team must actually own (vs. inherit from the platform).*

### GV.OC — Organizational Context
- **Requires:** Understand the mission, stakeholder expectations, dependencies, and legal/regulatory/contractual obligations that surround your risk decisions (GV.OC-01 mission understood; GV.OC-02 stakeholders identified; GV.OC-03 legal/regulatory/contractual requirements understood & managed; GV.OC-04 critical objectives/capabilities/services that stakeholders depend on are understood; GV.OC-05 outcomes/dependencies you depend on are understood).
- **In code:** Maintain a one-page context doc in the spine: what the product does, who relies on it, and which regimes bite (cross-link the compliance triage). Enumerate critical external dependencies (Supabase DB, Fly compute, Cloudflare edge, Vercel, email/SMS/LLM APIs) — feeds the vendor register.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA) · 4. Data inventory + sensitive-field tagging
- **Cite:** GV.OC (GV.OC-01..05)

### GV.RM — Risk Management Strategy
- **Requires:** Establish, communicate, and use priorities, constraints, risk-tolerance/appetite statements, and assumptions to drive operational risk decisions (GV.RM-01 objectives agreed; GV.RM-02 risk appetite/tolerance statements established; GV.RM-03 risk mgmt activities integrated into enterprise risk mgmt; GV.RM-04 strategic direction for risk response options; GV.RM-05 communication lines for risk across the org; GV.RM-06 standardized method to calculate/prioritize/communicate risk; GV.RM-07 strategic opportunities/positive risks included).
- **In code:** Write a short risk register (top 10 risks: data breach, account takeover, vendor outage, supply-chain CVE, lost backups…) with a tolerance note per item. Record accepted risks as `DECISIONS.md` entries so they're auditable, not implicit.
- **Primitive:** (program control — no single primitive; governs all 9)
- **Cite:** GV.RM (GV.RM-01..07)

### GV.RR — Roles, Responsibilities, and Authorities
- **Requires:** Establish/communicate cybersecurity roles, responsibilities, and authorities for accountability and continuous improvement (GV.RR-01 leadership accountable, fosters risk-aware culture; GV.RR-02 roles/responsibilities/authorities established & communicated; GV.RR-03 adequate resources allocated; GV.RR-04 cybersecurity included in HR practices).
- **In code:** Even solo, name the accountable owner. Document who can touch prod, who approves access grants, who holds the break-glass credentials. Tie offboarding to credential/key revocation (HR practice). On managed infra, define which human owns the Supabase/Fly/Cloudflare/Vercel org accounts.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** GV.RR (GV.RR-01..04)

### GV.PO — Policy
- **Requires:** Organizational cybersecurity policy is established, communicated, and enforced (GV.PO-01 policy established/communicated based on context/strategy/priorities; GV.PO-02 policy reviewed/updated/communicated to reflect changes).
- **In code:** Keep a lightweight security policy in-repo (acceptable use, secrets handling, access, incident steps) under version control so changes are diffable and dated. Enforce via CI gates and platform settings rather than prose alone.
- **Primitive:** (program control — underpins 1,5,6,8)
- **Cite:** GV.PO (GV.PO-01..02)

### GV.OV — Oversight
- **Requires:** Use results of risk-management activities/performance to inform, improve, and adjust the strategy (GV.OV-01 strategy outcomes reviewed to inform/adjust; GV.OV-02 strategy reviewed/adjusted for coverage of requirements/risks; GV.OV-03 performance measured & reviewed for adjustments).
- **In code:** Schedule a recurring (quarterly) review: read the risk register, the access-review output, open CVEs, incidents-since-last-time, and adjust. Capture it as a dated note — that note *is* the GV.OV evidence.
- **Primitive:** (program control)
- **Cite:** GV.OV (GV.OV-01..03)

### GV.SC — Cybersecurity Supply Chain Risk Management
- **Requires:** Identify, establish, manage, monitor, and improve C-SCRM processes with stakeholder buy-in (GV.SC-01 C-SCRM program/strategy/objectives/policies established; GV.SC-02 supplier roles/responsibilities established/communicated; GV.SC-03 C-SCRM integrated into cybersecurity & enterprise risk mgmt; GV.SC-04 suppliers known & prioritized by criticality; GV.SC-05 requirements addressed in contracts; GV.SC-06 due diligence before formalizing relationships; GV.SC-07 supplier risks understood/monitored over the relationship; GV.SC-08 suppliers included in incident planning/response/recovery; GV.SC-09 supply-chain security in the SDLC; GV.SC-10 C-SCRM in post-contract/termination wind-down).
- **In code:** This is the highest-leverage managed-infra control. Maintain the **vendor/sub-processor register**: for each (Supabase, Fly, Cloudflare, Vercel, email, SMS, LLM API, observability) record data class touched, contract type (DPA/BAA/security addendum), region, and criticality. Confirm the right contract exists *before* routing regulated data. Pin/lock dependencies, run SBOM + CVE scanning in CI (SDLC supply-chain), and include critical vendors in your incident runbook (who to call, their status page, their breach-notice clock).
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA) · 4. Data inventory + sensitive-field tagging
- **Cite:** GV.SC (GV.SC-01..10)

---
### ID — IDENTIFY (function)
*"The organization's current cybersecurity risks are understood." You can't protect what you haven't inventoried.*

### ID.AM — Asset Management
- **Requires:** Identify and manage assets (data, hardware, software, systems, facilities, services, people) consistent with their importance and your risk strategy (ID.AM-01 hardware inventory; ID.AM-02 software/services/systems inventory; ID.AM-03 network/data-flow maps maintained; ID.AM-04 inventory of services provided by suppliers; ID.AM-05 assets prioritized by classification/criticality/business value; ID.AM-07 data & metadata inventory; ID.AM-08 assets managed across their full lifecycle).
- **In code:** Build the **data inventory**: every table/bucket/store, what PII/PHI/PCI/NPI it holds, where it physically lives (region), and which sub-processor sees it. Tag sensitive fields at the schema level. Map data flows (client → Vercel/Fly → Supabase → analytics/LLM). Inventory software via the lockfile + SBOM. Cover the full lifecycle: creation → deletion.
- **Primitive:** 4. Data inventory + sensitive-field tagging · 9. Vendor/sub-processor register
- **Cite:** ID.AM (ID.AM-01..08)

### ID.RA — Risk Assessment
- **Requires:** Understand cybersecurity risk to the org, assets, and individuals (ID.RA-01 vulnerabilities identified/recorded; ID.RA-02 threat intel received from sharing forums; ID.RA-03 internal & external threats identified/recorded; ID.RA-04 potential impacts & likelihoods identified; ID.RA-05 threats/vulnerabilities/likelihoods/impacts used to prioritize risk; ID.RA-06 risk responses chosen/prioritized/planned/tracked; ID.RA-07 changes & exceptions managed/assessed for risk impact/recorded; ID.RA-08 vuln disclosure processes established; ID.RA-09 hardware/software authenticity/integrity assessed before acquisition/use; ID.RA-10 critical suppliers assessed pre-acquisition).
- **In code:** Continuous dependency-CVE scanning in CI as the always-on vuln assessment (ID.RA-01). Maintain a `security.txt` + a coordinated vuln-disclosure path (ID.RA-08). Track findings → remediation with owners/dates (ID.RA-06). Run a change-risk check on new data flows / new vendors (ID.RA-07, feeds GV.SC). Verify package integrity (lockfile hashes, signed releases) before adding deps (ID.RA-09).
- **Primitive:** 4. Data inventory (scope) · 9. Vendor register · supports 8. Incident response
- **Cite:** ID.RA (ID.RA-01..10)

### ID.IM — Improvement
- **Requires:** Identify improvements to risk-management processes across all Functions (ID.IM-01 improvements identified from evaluations; ID.IM-02 improvements from security tests/exercises incl. with suppliers/third parties; ID.IM-03 improvements from operational execution of processes/procedures/activities; ID.IM-04 incident response & other cybersecurity plans established, communicated, maintained, improved).
- **In code:** Feed lessons from every incident, failed restore drill, and pentest/scan back into the runbook and configs. Keep IR/BCP/DR plans as living, dated docs (ID.IM-04). The quarterly review (GV.OV) is the engine that produces ID.IM items.
- **Primitive:** 8. Incident-response + breach pipeline (plan upkeep)
- **Cite:** ID.IM (ID.IM-01..04)

---
### PR — PROTECT (function)
*"Safeguards to manage the organization's cybersecurity risks are used." The bulk of in-code controls — many partly inherited from the platform.*

### PR.AA — Identity Management, Authentication, and Access Control
- **Requires:** Limit access to physical/logical assets to authorized users/services/hardware, commensurate with risk (PR.AA-01 identities/credentials managed; PR.AA-02 identities proofed & bound to credentials; PR.AA-03 users/services/hardware authenticated; PR.AA-04 identity assertions protected/conveyed/verified; PR.AA-05 access permissions/entitlements/authorizations defined/managed/enforced incorporating least privilege & separation of duties; PR.AA-06 physical access managed/monitored).
- **In code:** Enforce **MFA** on every human account (Supabase, Fly, Cloudflare, Vercel, GitHub, email). **RBAC + Postgres RLS** for app-level authz with least privilege; scoped/short-lived tokens for services; rotate keys. Separation of duties on prod changes (PR review required). No shared logins. Physical access (PR.AA-06) is inherited from the cloud provider — cite their SOC 2/ISO report as evidence.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** PR.AA (PR.AA-01..06)

### PR.AT — Awareness and Training
- **Requires:** Provide personnel with cybersecurity awareness and role-based training so they can perform security tasks (PR.AT-01 personnel given awareness & training to have the knowledge/skills for general tasks with security in mind; PR.AT-02 individuals in specialized roles given role-based training).
- **In code:** Even for a tiny team, document a baseline: phishing awareness, secrets-never-in-git, how to handle a suspected incident. Anyone with prod access gets the role-based version (key handling, RLS model, deploy safety). A short README + onboarding checklist is sufficient evidence.
- **Primitive:** (people control — supports 5,8)
- **Cite:** PR.AT (PR.AT-01..02)

### PR.DS — Data Security
- **Requires:** Manage data consistent with the risk strategy to protect confidentiality, integrity, availability (PR.DS-01 confidentiality/integrity/availability of data-at-rest protected; PR.DS-02 …of data-in-transit protected; PR.DS-10 …of data-in-use protected; PR.DS-11 backups created/protected/maintained/tested).
- **In code:** **AES-256 at rest** (Supabase/Fly volumes/R2) + **TLS 1.2+ in transit** everywhere (enforce HTTPS at the edge, no plaintext internal hops). Pseudonymize/redact sensitive fields; keep PII/PHI out of logs, error trackers, analytics, and LLM prompts unless that vendor is contracted. **Backups** automated, encrypted, and restore-tested (PR.DS-11 pairs with RC.RP). Manage keys (rotation, restricted access) per NIST SP 800-111/52.
- **Primitive:** 1. Encryption (TLS+AES, key mgmt) · 7. Retention + deletion jobs (data lifecycle) · supports 6. Audit logging hygiene
- **Cite:** PR.DS (PR.DS-01, -02, -10, -11)

### PR.PS — Platform Security
- **Requires:** Manage hardware/software/services of platforms consistent with risk to protect C/I/A (PR.PS-01 configuration management practices established/applied — secure baselines; PR.PS-02 software maintained/replaced/removed commensurate with risk — patching; PR.PS-03 hardware maintained/replaced/removed…; PR.PS-04 log records generated & available for continuous monitoring; PR.PS-05 installation/execution of unauthorized software prevented; PR.PS-06 secure software development practices integrated & performance monitored across the SDLC).
- **In code:** Secure-by-default config as infrastructure-as-code (PR.PS-01); least-permissive platform settings reviewed in PRs. Patch via dependency updates with a CVE patch SLA (PR.PS-02). Emit structured logs from app + platform for monitoring (PR.PS-04 → feeds DE.CM and primitive 6). Lock down what runs (pinned images, signed deploys, no ad-hoc prod installs — PR.PS-05). Secure SDLC: code review, secrets scanning, SAST/dependency scanning in CI, no secrets in git (PR.PS-06).
- **Primitive:** 6. Immutable audit logging (PR.PS-04) · 1. Encryption/key mgmt config · supports 5, 8
- **Cite:** PR.PS (PR.PS-01..06)

### PR.IR — Technology Infrastructure Resilience
- **Requires:** Manage security architectures with the risk strategy to protect asset C/I/A and organizational resilience (PR.IR-01 networks/environments protected from unauthorized logical access & usage; PR.IR-02 tech infrastructure protected from environmental threats; PR.IR-03 mechanisms implemented to achieve resilience requirements in normal & adverse situations; PR.IR-04 adequate resource capacity to ensure availability maintained).
- **In code:** Network isolation — private DB networking, principle-of-least-exposure on Fly/Supabase, WAF/DDoS at Cloudflare edge (PR.IR-01). Environmental protection (PR.IR-02) is inherited from the cloud region/provider. Build resilience: multi-region or fast failover, health checks, autoscaling/capacity headroom (PR.IR-03/04). Pairs with RECOVER for RTO/RPO targets.
- **Primitive:** 5. Access control (network exposure) · supports 8. Incident response, RECOVER
- **Cite:** PR.IR (PR.IR-01..04)

---
### DE — DETECT (function)
*"Possible cybersecurity attacks and compromises are found and analyzed." Mostly built on the logging you already emit.*

### DE.CM — Continuous Monitoring
- **Requires:** Monitor assets to find anomalies, indicators of compromise, and other adverse events (DE.CM-01 networks/network services monitored; DE.CM-02 physical environment monitored; DE.CM-03 personnel activity & technology usage monitored to find adverse events; DE.CM-06 external service provider activities/services monitored; DE.CM-09 computing hardware/software/runtime environments & their activity monitored for adverse events).
- **In code:** Centralize logs (app + Supabase + Fly + Cloudflare) into observability with alerting. Monitor auth events (failed logins, new-device, privilege grants), unusual data-access patterns, and error spikes (DE.CM-03/09). Watch vendor status pages/security bulletins (DE.CM-06). Cloudflare WAF/bot analytics covers network monitoring (DE.CM-01). The **immutable audit log** of who-touched-regulated-data is the substrate this consumes.
- **Primitive:** 6. Immutable audit logging · supports 8. Incident response
- **Cite:** DE.CM (DE.CM-01, -02, -03, -06, -09)

### DE.AE — Adverse Event Analysis
- **Requires:** Analyze anomalies/IoCs/adverse events to characterize them and detect incidents (DE.AE-02 potentially adverse events analyzed to understand activity; DE.AE-03 information correlated from multiple sources; DE.AE-04 estimated impact & scope of adverse events understood; DE.AE-06 information on adverse events provided to authorized staff & tools; DE.AE-07 cyber threat intel & other contextual info integrated into the analysis; DE.AE-08 incidents declared when adverse events meet defined criteria).
- **In code:** Define alert thresholds and an explicit "what counts as an incident" rule (DE.AE-08) — this is the trigger for your breach pipeline. Correlate signals across log sources (DE.AE-03); use the data inventory to scope impact fast (DE.AE-04, "whose data was in this table?"). Route alerts to a real channel an on-call human sees (DE.AE-06).
- **Primitive:** 6. Immutable audit logging · 8. Incident-response + breach pipeline · 4. Data inventory (scope)
- **Cite:** DE.AE (DE.AE-02, -03, -04, -06, -07, -08)

---
### RS — RESPOND (function)
*"Actions regarding a detected cybersecurity incident are taken." This is the breach-notification pipeline the privacy laws also demand.*

### RS.MA — Incident Management
- **Requires:** Manage responses to detected incidents (RS.MA-01 incident response plan executed once an incident is declared in coordination with relevant third parties; RS.MA-02 incident reports triaged & validated; RS.MA-03 incidents categorized & prioritized; RS.MA-04 incidents escalated/elevated as needed; RS.MA-05 criteria for initiating incident recovery applied).
- **In code:** Maintain a runbook that fires on the DE.AE-08 declaration: triage → classify severity → assign owner → escalate. Parameterize the recipient/clock by the tightest applicable regime (GLBA 30d/FTC · HIPAA 60d/HHS · GDPR 72h/DPA · NIS2 24h · DORA hours · CRA 24h/ENISA) — one pipeline, many clocks. Include sub-processors per GV.SC-08.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** RS.MA (RS.MA-01..05)

### RS.AN — Incident Analysis
- **Requires:** Conduct investigations to ensure effective response and support forensics/recovery (RS.AN-03 analysis performed to establish what happened during an incident & the root cause; RS.AN-06 actions performed during an investigation recorded & their integrity/provenance preserved; RS.AN-07 incident data & metadata collected & their integrity/provenance preserved; RS.AN-08 incident's magnitude estimated & validated).
- **In code:** Your **immutable audit log** is the forensic record — append-only, tamper-evident, retained (HIPAA 6yr / PCI 12mo as applicable). During an incident, preserve logs/snapshots with provenance (RS.AN-06/07). Use the data inventory to validate true scope/magnitude (RS.AN-08) for breach-notification accuracy.
- **Primitive:** 6. Immutable audit logging · 4. Data inventory (scope) · 8. Incident response
- **Cite:** RS.AN (RS.AN-03, -06, -07, -08)

### RS.CO — Incident Response Reporting and Communication
- **Requires:** Coordinate response activities with internal/external stakeholders as required by laws/regulations/policies (RS.CO-02 internal & external stakeholders notified of incidents; RS.CO-03 information shared with designated internal & external stakeholders).
- **In code:** Pre-write breach-notification templates (regulator + affected users) and keep the recipient list current: which DPA/AG/HHS/FTC/ENISA/CSIRT, plus affected-individual notice. Wire the pipeline so it can hit the **72h / 24h** clocks. Publish customer-facing incident comms (status page) for B2B/DORA expectations.
- **Primitive:** 8. Incident-response + breach pipeline · supports 9. Vendor register (who notifies whom)
- **Cite:** RS.CO (RS.CO-02, -03)

### RS.MI — Incident Mitigation
- **Requires:** Perform activities to prevent expansion of an event and mitigate its effects (RS.MI-01 incidents contained; RS.MI-02 incidents eradicated).
- **In code:** Pre-stage containment levers: revoke/rotate compromised credentials & keys, kill sessions, disable a leaking endpoint, roll back a bad deploy, isolate a Fly machine, flip Cloudflare to under-attack/WAF rules. Document the eradication steps (patch the root cause, remove persistence) so recovery starts from a clean state.
- **Primitive:** 8. Incident-response + breach pipeline · 5. Access control (revoke/rotate) · 1. Encryption (key rotation)
- **Cite:** RS.MI (RS.MI-01, -02)

---
### RC — RECOVER (function)
*"Assets and operations affected by a cybersecurity incident are restored." Backups you've actually tested.*

### RC.RP — Incident Recovery Plan Execution
- **Requires:** Perform restoration activities to ensure operational availability of affected systems/services (RC.RP-01 recovery portion of the IR plan executed once initiated from the response process; RC.RP-02 recovery actions selected/scoped/prioritized/performed; RC.RP-03 integrity of backups & restoration assets verified before use; RC.RP-04 critical mission functions & cybersecurity risk mgmt considered to establish post-incident operational norms; RC.RP-05 integrity of restored assets verified, systems/services restored, normal operating status confirmed; RC.RP-06 end of incident recovery declared based on criteria & incident-related documentation completed).
- **In code:** Define **RTO/RPO** targets per service. Automate encrypted backups (Supabase PITR, volume snapshots, R2 versioning) and — critically — **test restores on a schedule** (RC.RP-03/05); an untested backup is not a control. Verify integrity before restoring. Declare recovery done with documentation (RC.RP-06), feeding ID.IM lessons.
- **Primitive:** 7. Retention + deletion jobs (backup lifecycle) · 1. Encryption (backup encryption/keys) · supports 8
- **Cite:** RC.RP (RC.RP-01..06)

### RC.CO — Incident Recovery Communication
- **Requires:** Coordinate restoration activities with internal and external parties (RC.CO-03 recovery activities & progress in restoring operational capabilities communicated to designated internal & external stakeholders; RC.CO-04 public updates on incident recovery shared using approved methods & messaging).
- **In code:** Keep stakeholders and (where required) the public updated through recovery via the status page / pre-approved comms templates. For B2B/DORA customers this overlaps contractual incident-notification SLAs — reuse the RS.CO recipient list.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** RC.CO (RC.CO-03, -04)

---
## Evidence to retain
CSF has no auditor, but to demonstrate a defensible program (and to feed SOC 2 / ISO / regulator inquiries that cross-walk to CSF), keep:
- **Profiles:** a documented Target Profile + Current Profile + gap list, dated; the Tier you're targeting (GOVERN/GV.OV).
- **Context & risk:** organizational-context doc, risk register with tolerance statements, and `DECISIONS.md` entries for accepted risks (GV.OC, GV.RM).
- **Inventories:** data inventory with sensitive-field tags + data-flow maps (ID.AM), software/SBOM inventory, and the vendor/sub-processor register with contract type + region per vendor (GV.SC, ID.AM).
- **Access evidence:** MFA-enforced screenshots, RBAC/RLS policy definitions in-repo, and periodic (quarterly) access-review records (PR.AA).
- **Protection evidence:** encryption-at-rest/in-transit config, key-rotation records, secure-baseline IaC, CI logs showing dependency/secret scanning + patch SLA adherence (PR.DS, PR.PS).
- **Monitoring & detection:** centralized log retention config, alert definitions, and the "what is an incident" criteria (DE.CM, DE.AE).
- **Incident records:** the IR/BCP/DR runbook (versioned), breach-notification templates + recipient list keyed to each clock, and per-incident timelines drawn from the immutable audit log with preserved provenance (RS.*, RC.*).
- **Recovery proof:** backup configuration plus dated **restore-test results** with RTO/RPO achieved — the single most-requested and most-often-missing artifact (RC.RP-03/05).
- **Improvement loop:** dated quarterly-review notes and post-incident lessons folded back into plans (GV.OV, ID.IM).

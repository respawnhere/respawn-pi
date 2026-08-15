# PCI-DSS v4.0.1 — requirements checklist
> Source: https://www.pcisecuritystandards.org/document_library/ (PCI DSS v4.0.1 standard + Summary of Changes; v4.0.1 published June 2024) · https://www.pcisecuritystandards.org/standards/pci-dss/ · https://blog.pcisecuritystandards.org/just-published-pci-dss-v4-0-1 · retrieved 2026-06-20 · **COPYRIGHTED standard** (© 2006–2026 PCI Security Standards Council, LLC — All rights reserved). The requirement *text* is protected and is **not reproduced** here; this is the requirement **structure** paraphrased from public summaries + official docs, **reference-by-link** to the source PDFs in the SSC Document Library. Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- You **store, process, or transmit cardholder data (CHD)** or sensitive authentication data (SAD), or can **affect the security** of the cardholder data environment (CDE). No revenue/size threshold — it's contractual (card brands + acquirer), not statutory.
- **CHD** = PAN (primary account number) + cardholder name, expiry, service code. **SAD** = full track data, CVV/CVC/CID, PIN/PIN block — **never stored after authorization** (Req 3.3.1).
- **Validation level** is set by annual transaction volume (Levels 1–4) and channel; small teams typically self-assess via a **Self-Assessment Questionnaire (SAQ)** + Attestation of Compliance (AoC), not a full QSA Report on Compliance.
- **The scope decision that matters:** route the PAN so it **never touches your servers** — Stripe/Paddle/Braintree/Checkout **hosted fields / redirect / iframe**, or tokenization. Then you typically qualify for **SAQ A** (e-commerce / MOTO merchants who fully outsource all CHD functions to PCI-validated third parties). Building your own card form (PAN posts to your origin) pulls the whole stack into the CDE and into SAQ A-EP / SAQ D scope.
- **v4.0.1 timing:** the v4.x **future-dated requirements were best-practice until 31 March 2025 and are now mandatory** (assessed in every PCI DSS assessment from that date). v4.0.1 added **no new/removed requirements** vs v4.0 — clarifications only.
- **SAQ A note (v4.0.1):** even fully-outsourced e-commerce merchants now have payment-page-integrity obligations — the script-management and tamper-detection controls (6.4.3, 11.6.1) reach the merchant page that loads/embeds the processor's form. Confirm against the current SAQ A eligibility text and your acquirer.

## Requirements

### Build and maintain a secure network and systems (Goal 1)

### Req 1 — Install and maintain network security controls (NSCs)
- **Requires:** Network security controls (firewalls / cloud security groups) between trusted and untrusted networks; documented config standards, rulesets reviewed ≥ every 6 months; restrict inbound/outbound to only what's needed; no direct public access to system components in the CDE.
- **In code:** On managed infra you mostly **shrink the CDE to near-zero** via hosted payment pages so there's no in-scope network. Where you do have an in-scope service: Fly private networking + restrictive `services`/firewall rules, Cloudflare WAF in front of origin, Supabase network restrictions / IP allow-lists, deny-by-default egress, no public DB ports. Document the (minimal) CDE network diagram + data-flow diagram.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** Req 1 (1.1–1.5)

### Req 2 — Apply secure configurations to all system components
- **Requires:** Remove/change **vendor defaults** (passwords, SNMP strings, keys) before deploy; hardening standards per system type aligned to industry guidance; only necessary services/ports enabled; manage wireless securely; inventory of system components.
- **In code:** No default creds anywhere; secrets in Fly secrets / Supabase vault / env, never in code or images; minimal base images, disable unused services; IaC-pinned config; rotate any provider default keys. Maintain a component inventory (feeds Primitive 4).
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** Req 2 (2.1–2.3)

### Protect cardholder data (Goal 2)

### Req 3 — Protect stored account data
- **Requires:** Minimize storage + retention of CHD (3.2.1 — keep only what's needed, defined retention/disposal, quarterly purge of data past retention); **never store SAD after authorization** (3.3.1 — full track, CVV, PIN); mask PAN on display to ≤ first6/last4 by need-to-know (3.3.2/3.3.3); **render stored PAN unreadable** via strong cryptography / truncation / tokenization / keyed hash (3.4/3.5); disk-level encryption alone no longer counts as at-rest protection except on removable media (3.5.1.2); **PAN copy/relocation to out-of-scope locations must be controlled** (3.4.2, future-dated → now mandatory); key management — generation, secure distribution, storage, rotation, split knowledge/dual control, retire/replace keys (3.6/3.7); keyed cryptographic hashing for PAN (3.5.1.1).
- **In code:** **Easiest win: don't store PAN — tokenize at the processor.** If you must: column-level AES/processor tokenization, never log/dump SAD (scrub error trackers, DB exports, request logs), mask in UI and API responses, KMS-backed keys with documented rotation + dual control, automated retention purge job for any token/PAN artifacts. Tag every CHD field in the inventory.
- **Primitive:** 1. Encryption (TLS+AES, key mgmt) — also 4 (inventory/tagging) and 7 (retention/purge)
- **Cite:** Req 3 (3.1–3.7); SAD-no-store 3.3.1; PAN-relocation 3.4.2

### Req 4 — Protect cardholder data with strong cryptography during transmission over open/public networks
- **Requires:** Strong crypto + secure protocols (TLS) for PAN in transit over public networks (4.2.1); **certificates valid, not expired/revoked, and inventoried** (4.2.1 / 4.2.1.1 — trusted keys & certificates inventory, future-dated → now mandatory); never send unprotected PAN by end-user messaging (email/SMS/chat).
- **In code:** TLS 1.2+ enforced everywhere (Cloudflare/Fly/Vercel default; disable weak ciphers/old TLS); HSTS; automated cert management + expiry monitoring; an inventory of TLS certs and trusted keys; block PAN in email/SMS/Slack/support tools.
- **Primitive:** 1. Encryption (TLS+AES, key mgmt)
- **Cite:** Req 4 (4.1–4.2); cert inventory 4.2.1.1

### Maintain a vulnerability management program (Goal 3)

### Req 5 — Protect all systems and networks from malicious software
- **Requires:** Anti-malware on systems commonly affected; kept current, active, generating logs (5.2); **periodic evaluation of systems not commonly affected for malware susceptibility** (5.2.3.1, future-dated → now mandatory); **removable media scanned / continuously analyzed** (5.3.3); anti-malware not disable-able by users without authorization; **anti-phishing — automated mechanisms to detect and protect users from phishing** (5.4.1, future-dated → now mandatory).
- **In code:** Largely N/A for serverless/managed app code, but document the control: endpoint protection on any dev/admin machines and on in-scope VMs/containers; email/anti-phishing protection (DMARC/SPF/DKIM + provider phishing filtering) on the domain; removable-media policy (or "not used"). Capture as targeted-risk-analysis-backed control statements.
- **Primitive:** 8. Incident-response + breach pipeline (malware/phishing defense feeds detection) — supporting 5 (access control)
- **Cite:** Req 5 (5.1–5.4); removable media 5.3.3; anti-phishing 5.4.1

### Req 6 — Develop and maintain secure systems and software
- **Requires:** Secure SDLC — security in design, secure coding, review of bespoke/custom code (6.2); **identify + risk-rank vulnerabilities** from reputable sources (6.3.1); **patch critical/high vulns within one month**, others on a risk basis (6.3.3); **inventory of bespoke/custom software incl. third-party + open-source components** with associated vuln monitoring (6.3.2, future-dated → now mandatory); change management with separation of dev/test/prod and live-PAN not used in test (6.5); **protect public-facing web apps via an automated technical solution / WAF** (6.4.2, manual review no longer sufficient — future-dated → now mandatory); **payment-page script integrity — manage all scripts loaded/executed in the consumer browser: authorize each, ensure integrity, maintain an inventory with justification** (6.4.3, future-dated → now mandatory).
- **In code:** RespawnPack security loop already covers most: PR review + secure-coding gates, dependency CVE scanning + SBOM (feeds 6.3.2), patch SLA (≤30d critical), no prod data in test/seed, env separation. Add **Cloudflare WAF / managed rules** in front of origin (6.4.2). For **6.4.3**: lock down payment-page scripts with **CSP + Subresource Integrity (SRI)**, an allow-list/inventory of every script on the payment page, and justification — anti-Magecart skimming control.
- **Primitive:** 5. Access control + secure SDLC (RLS/RBAC/least-privilege) — script integrity also 6 (audit) & 8 (Magecart detection)
- **Cite:** Req 6 (6.1–6.5); software inventory 6.3.2; WAF 6.4.2; **payment-page scripts 6.4.3**

### Implement strong access control measures (Goal 4)

### Req 7 — Restrict access to system components and cardholder data by business need to know
- **Requires:** Least-privilege / need-to-know; role-based access with default-deny; access assignment by job function approved by authorized parties (7.2); **review all user access ≥ every 6 months** (7.2.4, future-dated → now mandatory); **application/system (non-human) accounts managed and reviewed separately/periodically** (7.2.5, 7.2.5.1, future-dated → now mandatory).
- **In code:** Postgres **RLS** + RBAC, scoped service-role keys, default-deny policies; admin/CDE access by role only; document and run a **6-monthly access review** (export role grants, sign off); inventory and review machine/service accounts and API tokens separately.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** Req 7 (7.1–7.2); access review 7.2.4; system-account review 7.2.5/7.2.5.1

### Req 8 — Identify users and authenticate access to system components
- **Requires:** Unique ID per user — no shared accounts (8.2); strong authentication; **passwords/passphrases ≥ 12 characters** (or 8 if system can't support 12) with complexity (8.3.6, future-dated → now mandatory); secure storage of authentication factors; **MFA for all remote/admin access AND MFA for ALL access into the CDE** (8.4.2, future-dated → now mandatory); **MFA systems hardened against bypass/replay** (8.5.1); manage **application/system accounts**: interactive-login conditions (8.6.1), **no hard-coded/embedded passwords** (8.6.2), periodic rotation of system-account passwords (8.6.3) — all future-dated → now mandatory; lockout, session timeout/idle re-auth. v4.0.1 clarifies MFA exemptions apply where **phishing-resistant** factors are used.
- **In code:** SSO + **MFA enforced** on Supabase/Fly/Cloudflare/Vercel dashboards, Git host, and any admin/CDE login; unique named accounts (no shared logins); 12-char password policy; **no secrets in code** — Fly secrets / vault; rotate service-account credentials on a schedule; idle session timeout; prefer phishing-resistant MFA (WebAuthn/passkeys) on privileged accounts.
- **Primitive:** 5. Access control — RLS/RBAC/MFA/least-privilege
- **Cite:** Req 8 (8.1–8.6); 12-char 8.3.6; **MFA into CDE 8.4.2**; MFA hardening 8.5.1; no hard-coded creds 8.6.2

### Req 9 — Restrict physical access to cardholder data
- **Requires:** Physical access controls to the CDE / media; visitor management (badging, logs, escort); secure/destroy media containing CHD; protect POI/payment terminals from tampering/substitution and inspect periodically (9.5.1.2.1).
- **In code / posture:** **Largely inherited from the cloud provider** — no owned data center. Document reliance on Supabase/Fly/Cloudflare/Vercel SOC 2 / PCI AoC for physical security (responsibility-matrix entry, links to provider attestations). If any physical POI devices exist, run the tamper-inspection program; otherwise mark N/A with justification.
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA) — inherited-controls evidence from provider AoCs
- **Cite:** Req 9 (9.1–9.5)

### Regularly monitor and test networks (Goal 5)

### Req 10 — Log and monitor all access to system components and cardholder data
- **Requires:** Audit logs capturing who/what/when for all access to CHD and to audit trails, admin actions, auth attempts, account/privilege changes, init/stop of logging (10.2); **protect logs from tampering** (10.3); **retain audit history ≥ 12 months, with ≥ 3 months immediately available** (10.5); **time synchronization** (10.6); **daily review of logs — using automated mechanisms** (10.4.1.1, future-dated → now mandatory); **detect, alert, and promptly respond to failures of critical security control systems** (10.7.2/10.7.3, future-dated → now mandatory for all entities).
- **In code:** Centralized append-only logging (Supabase audit, Fly/Cloudflare logs → log sink/SIEM-lite) of CHD/admin/auth events; **immutable / WORM-style retention ≥ 12 months**; NTP/managed time sync; automated log review + alerting (not manual eyeballing); alerting on control failures (WAF down, logging stopped, scan failures).
- **Primitive:** 6. Immutable audit logging — control-failure alerting also 8 (incident pipeline)
- **Cite:** Req 10 (10.1–10.7); automated review 10.4.1.1; 12-month retention 10.5.1; control-failure detection 10.7.2/10.7.3

### Req 11 — Test security of systems and networks regularly
- **Requires:** Wireless access-point detection (11.2); **internal vulnerability scans ≥ quarterly + after significant change, authenticated scans** (11.3.1 / 11.3.1.2 authenticated, future-dated → now mandatory); **external ASV scans ≥ quarterly + after significant change**, passing, by an **Approved Scanning Vendor** (11.3.2); **penetration testing ≥ annually + after significant change** (internal + external, 11.4); segmentation pen-test (≥ annually for service providers / per scope); **intrusion-detection/prevention** on the perimeter/critical points (11.5); **change-/tamper-detection on payment pages — alert on unauthorized modification of HTTP headers and payment-page contents, evaluated ≥ weekly** (11.6.1, future-dated → now mandatory).
- **In code:** Schedule **quarterly ASV external scans** (engage an ASV) + quarterly **authenticated internal scans**; **annual pen test**; dependency/DAST scanning in CI (supports but doesn't replace ASV/pen test); **11.6.1**: deploy payment-page tamper detection (CSP report-uri / SRI monitoring / a client-side script-integrity monitor) that alerts on header/script changes — the anti-skimming twin of 6.4.3.
- **Primitive:** 8. Incident-response + breach pipeline (detection/testing) — tamper-detection also 6 (audit)
- **Cite:** Req 11 (11.1–11.6); authenticated internal scan 11.3.1.2; ASV external 11.3.2; pen test 11.4; **payment-page tamper detection 11.6.1**

### Maintain an information security policy (Goal 6)

### Req 12 — Support information security with organizational policies and programs
- **Requires:** A maintained, annually-reviewed **information security policy** + acceptable-use policy (12.1/12.2); **overall PCI scope confirmed annually** and at significant change (12.5.2 / 12.5.2.1 for service providers); **Targeted Risk Analyses (TRA)** governing the frequency of any "periodic" control (12.3.1) and any **customized-approach** control (12.3.2) — *the headline v4 addition*; **annual review of cryptographic suites/protocols with active monitoring** (12.3.3); **annual review that hardware/software is supported, not end-of-life** (12.3.4); **security awareness training** at hire + ≥ annually, covering **phishing, social engineering, acceptable use** (12.6.1/12.6.2/12.6.3); personnel screening (12.7); **manage third-party service providers (TPSPs)** — due diligence, written agreements, a **list of TPSPs with services provided**, monitor their PCI compliance status ≥ annually, and a clear **responsibility matrix** of which PCI requirements each party owns (12.8 / 12.9); **incident response plan** — tested ≥ annually, 24/7 alerting, roles, and **specifically handle PAN found outside expected/authorized locations** (12.10.1/12.10.5/12.10.7); service-provider IR/monitoring extras (12.10.4.1).
- **In code / posture:** Maintain the InfoSec + acceptable-use policy; run and **document TRAs** for every "periodic" control (sets your scan/review cadences); annual crypto + EOL technology review; annual security-awareness training incl. phishing; an **IR runbook** wired to alerting, tested annually, with a PAN-found-outside-CDE branch; a **TPSP / sub-processor register** flagging Stripe/processor, Supabase, Fly, Cloudflare, Vercel, email/SMS/LLM vendors with the service, PCI responsibility split, and AoC-on-file status (this is the cornerstone for SAQ A — your processor's PCI compliance is your evidence).
- **Primitive:** 9. Vendor/sub-processor register (BAA/DPA) + 8. Incident-response + breach pipeline — TRAs/policy also 4 (inventory) & 6 (audit)
- **Cite:** Req 12 (12.1–12.10); **TRA 12.3.1 / customized-approach TRA 12.3.2**; crypto review 12.3.3; EOL review 12.3.4; awareness/phishing 12.6.x; TPSP management 12.8; **IR plan + PAN-out-of-place 12.10.1/12.10.7**

### Appendices (conditional)
- **Appendix A1 — Multi-tenant service providers:** logical separation between customers, per-customer logging/scope (A1.1–A1.2; A1.2.3 future-dated → now mandatory). **Cite:** A1. **Primitive:** 5.
- **Appendix A2 — SSL/early-TLS POS POI:** legacy carve-out; N/A for modern stacks. **Cite:** A2.
- **Appendix A3 — Designated Entities Supplemental Validation (DESV):** only if your acquirer/brand designates you (high volume / prior breach); a BAU-enforcement overlay. **Cite:** A3.

## Evidence to retain
- **Attestation of Compliance (AoC)** + the completed **SAQ** (likely **SAQ A** if PAN is fully outsourced) — annual; plus the merchant's signed responsibility matrix.
- **Data-flow + network diagrams** and a **scope/CDE definition** showing the PAN never lands on your systems (tokenization/hosted-fields architecture) — refreshed annually (12.5.2).
- **Quarterly ASV scan reports** (passing) from an Approved Scanning Vendor + **authenticated internal scan** results; **annual penetration test** report.
- **Payment-page evidence:** the **script inventory + authorization/justification** (6.4.3) and **tamper-detection alert config + review logs** (11.6.1) — CSP/SRI configuration.
- **Audit logs** retained ≥ 12 months (≥ 3 months hot), tamper-evident, with proof of **automated daily review** (10.4.1.1) and control-failure alerting (10.7).
- **Access-control evidence:** RBAC/RLS policy export, MFA-enforced screenshots for all CDE/admin access (8.4.2), and the **6-monthly access-review** sign-offs (7.2.4) incl. system accounts (7.2.5).
- **Targeted Risk Analyses (TRAs)** documenting the chosen frequency/justification for each periodic control (12.3.1) and any customized-approach controls (12.3.2).
- **Patch/vuln-management records** (SLA adherence), **software/component inventory** (6.3.2), **certificate/key inventory** (4.2.1.1), and **crypto/EOL annual review** (12.3.3/12.3.4).
- **TPSP register** with each provider's current **PCI AoC on file** and the responsibility matrix (12.8/12.9) — your providers' attestations are your inherited-control evidence for Reqs 9 and infra-level controls.
- **Security-awareness training records** (incl. phishing/social engineering, 12.6.x) and **incident-response plan** with annual test results and the PAN-found-outside-CDE procedure (12.10.7).
- **Key-management records:** generation/rotation/dual-control procedures and logs (3.6/3.7); evidence SAD is never stored post-auth (log/DB scrub proof, 3.3.1).

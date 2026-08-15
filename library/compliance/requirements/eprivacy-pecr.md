# ePrivacy Directive 2002/58/EC + UK PECR 2003 — requirements checklist
> Source: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32002L0058 (ePrivacy Directive, as amended by 2009/136/EC) · https://www.legislation.gov.uk/uksi/2003/2426 (Privacy and Electronic Communications (EC Directive) Regulations 2003, as amended) · retrieved 2026-06-20 · EUR-Lex and legislation.gov.uk are public-sector / reusable sources — summarized freely with citation. Reference only — not legal advice. Maps to the unified primitives in docs/reference/compliance-requirements.md.

## Applies when
- You **store information on, or read/access information already stored on, a user's device** (terminal equipment) by any means: cookies, `localStorage`/`sessionStorage`, IndexedDB, SDK/app identifiers, tracking pixels/web beacons, browser fingerprinting, session-replay scripts, embedded third-party widgets/players that drop storage. Triggered by **any one EU/UK end user** — no revenue or volume threshold.
- You send **electronic direct marketing** (email, SMS/MMS, automated/recorded voice calls, fax) to individuals.
- ePrivacy/PECR sit **on top of GDPR/UK GDPR**: ePrivacy governs the act of storage/access and the marketing channel; GDPR governs any resulting personal-data processing. Where ePrivacy requires "consent," it borrows the **GDPR standard** of consent (ePrivacy Art 2(f) → Directive 95/46/EC, now GDPR Art 4(11) / 7): freely given, specific, informed, unambiguous, by clear affirmative action, as easy to withdraw as to give.
- EU: each Member State's national transposition applies (the Directive is not directly effective). UK: PECR applies, enforced by the **ICO**, alongside UK GDPR. Maximum PECR penalty is currently £500,000 (moving toward UK GDPR-level fines under reform).
- The proposed ePrivacy **Regulation** would replace the Directive but is not yet in force as of 2026-06-20 — this checklist reflects the Directive + PECR in force today.

## Requirements

### EP-Art4(1) / PECR-Reg5 — Security of service / processing
- **Requires:** Provider of a publicly available electronic communications service (and, by extension under GDPR Art 32, any data controller) must take appropriate technical and organisational measures to safeguard the security of its services; PECR Reg 5 adds ensuring access only by authorised persons, protecting stored/transmitted data against accidental/unlawful destruction, loss, alteration, unauthorised disclosure or access, and a security policy.
- **In code:** TLS 1.2+ on all endpoints (HSTS), AES-256 at rest, scoped/rotated keys, MFA + least-privilege on admin paths; this largely overlaps GDPR Art 32 — implement once. On Supabase/Fly/Cloudflare/Vercel rely on managed TLS + at-rest encryption and document it.
- **Primitive:** 1. Encryption (with 5. Access control)
- **Cite:** ePrivacy Art 4(1); PECR reg 5

### EP-Art4(2) — Notify subscribers of a particular security risk
- **Requires:** On a particular risk of a breach of network security, inform subscribers of the risk and, where the risk lies outside the provider's measures, of possible remedies and likely costs.
- **In code:** A user-facing security-advisory path (status page / email notice template) tied to the incident-response runbook so a known risk can be communicated to affected accounts.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** ePrivacy Art 4(2)

### EP-Art5(1) / PECR-Reg5 — Confidentiality of communications
- **Requires:** Prohibit listening, tapping, storage, interception or surveillance of communications and related traffic data by anyone other than the users, without the users' consent, except where legally authorised.
- **In code:** Do not silently capture message/comms content or traffic metadata for secondary use; gate any session-replay / keystroke / message-content logging behind consent and document legal basis; encrypt comms in transit.
- **Primitive:** 3. Consent + preference store (with 1. Encryption)
- **Cite:** ePrivacy Art 5(1); PECR reg 5

### EP-Art5(3) / PECR-Reg6 — Consent to store/access information on terminal equipment ("cookie consent") — CORE
- **Requires:** Storing information, or gaining access to information already stored, on a user's/subscriber's terminal equipment is permitted **only if** the user has given consent **having been provided with clear and comprehensive information** about the purposes of the processing. Consent must be obtained **before** the storage/access occurs (prior consent). Applies to cookies and any equivalent storage/access technology (localStorage, SDK IDs, pixels, fingerprinting).
- **In code:** A Consent Management Platform that (a) blocks all non-exempt cookies/scripts/tags/SDKs/pixels **until** consent, (b) shows a first-layer notice naming each purpose/category and the parties involved before any non-essential storage fires, (c) records the consent event (timestamp, purposes, version, signal) in the preference store, (d) re-prompts on material change. Wire tag-loading to the consent state — never load Google Analytics, ad pixels, session-replay, chat/embed widgets, or A/B SDKs ahead of consent.
- **Primitive:** 3. Consent + preference store (with 4. Data inventory for cookie/tag mapping)
- **Cite:** ePrivacy Art 5(3); PECR reg 6(1)–(2) and Schedule A1

### EP-Art5(3)-exempt / PECR-Reg6(4) — "Strictly necessary" / transmission exemption
- **Requires:** Consent is NOT required where storage/access is **(a)** for the **sole purpose of carrying out the transmission** of a communication over a network, or **(b)** **strictly necessary** for the provider to provide an information-society service **explicitly requested** by the user. Construed narrowly — necessary for the user's requested service, not merely for the operator's convenience.
- **In code:** Tag each cookie/storage key with a category in the data inventory; mark as exempt only: session/auth tokens, CSRF tokens, load-balancing/routing, shopping-cart/checkout state, security/fraud cookies, UI state the user set (language, accessibility), and consent-record cookies. Do **not** classify analytics, advertising, social-embed, personalization, or general performance cookies as strictly necessary — they require consent.
- **Primitive:** 4. Data inventory + sensitive-field tagging (cookie/tag register) with 3. Consent
- **Cite:** ePrivacy Art 5(3) (last sentence); PECR reg 6(4)

### EP-Consent-quality / PECR-Reg6(2) — Quality of cookie consent (clear affirmative, refuse as easy as accept)
- **Requires:** Consent must meet the GDPR standard (ePrivacy Art 2(f)): freely given, specific, informed, unambiguous, by a clear affirmative action. Consequently: **no pre-ticked boxes**, no consent by mere continued browsing/scrolling, granular per-purpose choices (not all-or-nothing), and refusing/withdrawing must be **as easy as giving** consent (a first-layer "Reject all" presented with equal prominence to "Accept all"), withdrawable at any time, with no detriment for refusal (no "consent walls" except where lawful).
- **In code:** Banner with equally weighted **Accept all** / **Reject all** on the first layer plus per-category toggles defaulting to OFF; persistent "Cookie/Privacy preferences" entry point (footer/settings) to change or withdraw; store granular timestamped consent + the exact text/version shown; re-collect, do not assume, when purposes change.
- **Primitive:** 3. Consent + preference store
- **Cite:** ePrivacy Art 2(f) → GDPR Art 4(11)/7; PECR reg 6(2) (consent has the GDPR meaning)

### EP-GPC/automated-signal — Browser-level refusal signals
- **Requires:** Where the user expresses a choice through automated means / browser settings, that choice should be respected (recital 66 ePrivacy; reinforced by GDPR consent rules and ICO guidance favouring browser-based consent signals). In practice honour Global Privacy Control / Do-Not-Track-style refusal where presented.
- **In code:** Server- and client-side detection of GPC / opt-out signals that suppresses non-essential storage and tag loading and is recorded as a refusal in the preference store; align with the CCPA GPC handling already built.
- **Primitive:** 3. Consent + preference store
- **Cite:** ePrivacy recital 66; PECR reg 6 (consent mechanism)

### EP-Art6(1) / PECR-Reg7(1) — Traffic data: erase or anonymise when no longer needed
- **Requires:** Traffic data relating to subscribers/users must be **erased or made anonymous when it is no longer needed** for the purpose of transmitting the communication.
- **In code:** Retention + deletion jobs that purge/anonymise connection/transport logs (IP, timestamps, routing metadata) on a defined schedule once transmission is complete; minimize what is retained.
- **Primitive:** 7. Retention + deletion jobs (with 4. Data inventory)
- **Cite:** ePrivacy Art 6(1); PECR reg 7(1)–(2)

### EP-Art6(2) / PECR-Reg7(3) — Traffic data: billing-purpose retention limit
- **Requires:** Traffic data needed for **billing / interconnection payments** may be processed only up to the end of the period during which the bill may lawfully be challenged or payment pursued.
- **In code:** A distinct, time-boxed retention tier for billing-relevant logs/metadata, deleted when the dispute/limitation window closes; document the period.
- **Primitive:** 7. Retention + deletion jobs
- **Cite:** ePrivacy Art 6(2); PECR reg 7(3)

### EP-Art6(3) / PECR-Reg7(4) — Traffic data for marketing / value-added services needs consent
- **Requires:** Processing traffic data to **market electronic communications services or provide value-added services** is allowed only with the subscriber's/user's **prior consent**, limited to what is necessary and for the stated duration; consent is withdrawable at any time.
- **In code:** Gate any use of connection/usage metadata for marketing or value-added features behind a recorded, withdrawable consent in the preference store; default off.
- **Primitive:** 3. Consent + preference store (with 7. Retention)
- **Cite:** ePrivacy Art 6(3); PECR reg 7(4)

### EP-Art6(4) — Inform before consent / restrict who processes traffic data
- **Requires:** The provider must inform the subscriber of the types of traffic data processed and the duration before obtaining 6(3) consent; processing of traffic data is restricted to persons handling billing, traffic management, customer enquiries, fraud detection, marketing of e-comms services, or providing a value-added service, and limited to what those tasks require (Art 6(5)).
- **In code:** Disclosure in the privacy/cookie notice of metadata types and retention; least-privilege/RBAC so only the relevant roles can query traffic/usage logs; access logged.
- **Primitive:** 5. Access control — RLS/RBAC/least-privilege (with 4. Data inventory)
- **Cite:** ePrivacy Art 6(4)–(5)

### EP-Art9 / PECR-Reg14 — Location data (other than traffic data): consent + per-transmission opt-out
- **Requires:** Location data may be processed only when **anonymised**, or with **consent** of users/subscribers, to the extent and duration needed for a value-added service. Before consent, inform of the data type, purposes, duration, and any third-party transmission. After consent, the user must retain a **simple, free means to temporarily refuse** processing for each connection or transmission, and may withdraw consent at any time.
- **In code:** If the product uses precise device/geo location for any feature, gate it behind explicit opt-in stored in the preference store; provide a per-session "turn off location" control; restrict access to location data to authorised roles/processors; document retention.
- **Primitive:** 3. Consent + preference store (with 5. Access control, 7. Retention)
- **Cite:** ePrivacy Art 9(1)–(3); PECR reg 14

### EP-Art13(1) / PECR-Reg22(2) — Direct marketing by email/SMS/automated channels requires prior opt-in
- **Requires:** Use of automated calling machines, fax, or **electronic mail** (incl. email and SMS/MMS) for direct marketing to individual subscribers is permitted only where the recipient has given **prior consent** ("previously notified the sender that he consents for the time being to such communications").
- **In code:** Opt-in capture (unbundled, not pre-ticked) recorded with timestamp, source, and scope; suppress sends to any address/number lacking a valid consent record; consent flags live in the preference store and gate the email/SMS sender.
- **Primitive:** 3. Consent + preference store
- **Cite:** ePrivacy Art 13(1); PECR reg 22(1)–(2)

### EP-Art13(2) / PECR-Reg22(3) — Soft opt-in for existing customers
- **Requires:** Prior consent is not required where ALL conditions are met: (a) the sender **obtained the contact details in the course of a sale (or negotiations for a sale)** of a product/service to that person; (b) marketing is for the sender's own **similar products or services** only; and (c) the person was given a simple, free **opportunity to refuse/opt out at the time the details were collected** and is given that opportunity **in every subsequent message**.
- **In code:** Tag each marketing contact with how it was obtained (sale vs. lead-magnet vs. purchased — soft opt-in applies only to the sale path), restrict soft-opt-in sends to similar-product campaigns, include an opt-out at collection and a working unsubscribe in every message; store the basis per contact.
- **Primitive:** 3. Consent + preference store (with 4. Data inventory — source/basis tagging)
- **Cite:** ePrivacy Art 13(2); PECR reg 22(3)

### EP-Art13(4) / PECR-Reg23 — No disguised identity; valid reply/opt-out address
- **Requires:** Prohibited to send marketing email that **disguises or conceals the identity of the sender** on whose behalf it is sent, or that lacks a **valid address** to which the recipient can send an opt-out request; the sender must not conceal identity and must provide a working unsubscribe/return path.
- **In code:** Set authenticated, identifiable From/sender headers (SPF/DKIM/DMARC aligned), include sender identity in the body, and a functioning unsubscribe link/address in every marketing message that updates the preference store immediately.
- **Primitive:** 3. Consent + preference store
- **Cite:** ePrivacy Art 13(4); PECR reg 23

### EP-Art13(unsubscribe) / PECR-Reg22 — Honour withdrawal / unsubscribe promptly
- **Requires:** Consent is withdrawable at any time and unsubscribe requests must be actioned; continuing to send after opt-out is a breach.
- **In code:** Unsubscribe writes to a suppression list in the preference store that the sender checks on every dispatch; one-click unsubscribe (List-Unsubscribe header) where supported; near-real-time effect.
- **Primitive:** 3. Consent + preference store (with 7. Retention/suppression)
- **Cite:** ePrivacy Art 13(1)–(2); PECR reg 22

### PECR-Reg19 / Reg20 / Reg21 — Automated calls, fax, live marketing calls
- **Requires:** (Reg 19) automated/recorded-message marketing calls require prior consent and must identify the caller / give a contact address; (Reg 20) unsolicited marketing faxes to individuals require prior consent, corporates may opt out; (Reg 21/21A) live marketing calls must not be made to anyone who has opted out or is registered on the TPS/CTPS, and CLI must be presented.
- **In code:** Only relevant if you run outbound voice/fax marketing; if so, screen against consent records + TPS/CTPS, present caller ID, and honour opt-outs. Most managed-infra SaaS will not trigger these — flag as out of scope unless telephony marketing is added.
- **Primitive:** 3. Consent + preference store
- **Cite:** PECR regs 19, 20, 21, 21A, 24 (identification of caller)

### PECR-Reg5A / breach context — Service-provider personal-data breach notification
- **Requires:** Providers of public electronic communications services must notify the ICO of personal-data breaches without undue delay (and affected subscribers where the breach is likely to adversely affect them). Most SaaS are not "public ECS providers," so the GDPR Art 33/34 breach regime governs instead — but the obligation exists where applicable.
- **In code:** Reuse the GDPR breach pipeline (detect → log → timeline → notify) parameterised to the correct authority/clock; only the public-ECS subset adds the PECR-specific ICO notification.
- **Primitive:** 8. Incident-response + breach pipeline
- **Cite:** PECR reg 5A (public ECS providers); otherwise GDPR Art 33/34

### EP/PECR-Vendor — Sub-processors that drop storage or send marketing
- **Requires:** Implicit across Art 5(3)/13 and PECR reg 6/22 — consent and the no-disguised-identity rules cover storage/marketing performed via third parties (analytics, ad networks, CDPs, embeds, ESPs/SMS gateways). The first party remains responsible for third-party tags firing and for marketing sent on its behalf.
- **In code:** Maintain a register of every vendor that sets device storage or sends comms on your behalf (Google/Meta pixels, Cloudflare analytics, session-replay, chat widgets, ESP, SMS provider), with the consent gating and DPA/contract status for each; do not enable a tag/sender until the vendor is in the register and gated by consent.
- **Primitive:** 9. Vendor/sub-processor register (with 3. Consent, 4. Data inventory)
- **Cite:** ePrivacy Art 5(3), Art 13(4); PECR regs 6, 22, 23

## Evidence to retain
- **Cookie/storage audit (data inventory):** every cookie, storage key, SDK identifier, pixel and fingerprinting technique, with category (strictly-necessary vs. consent-required), purpose, party, and retention — kept current and matching what actually fires.
- **CMP configuration + proof of gating:** evidence that non-essential tags/scripts/SDKs do not load before consent (network-trace or scanner output showing no pre-consent non-exempt cookies), and that "Reject all" is presented as prominently as "Accept all" with no pre-ticked boxes.
- **Consent records:** per-user timestamped logs of consent given/refused/withdrawn, the purposes/categories chosen, the banner text/version shown, and the signal (click, GPC, etc.) — demonstrating prior, informed, granular, freely given consent and as-easy withdrawal.
- **First-layer notice + privacy/cookie policy versions** showing the clear-and-comprehensive information provided before storage/access.
- **Marketing consent + soft-opt-in evidence:** per-contact basis (consent vs. soft opt-in), source of collection, opt-out-at-collection proof, and the unsubscribe/refusal opportunity in each message; suppression-list state and timestamps showing opt-outs were honoured promptly.
- **Sender authentication + identity:** SPF/DKIM/DMARC config and sample marketing messages showing identifiable sender and a valid unsubscribe address (Reg 23 / Art 13(4)).
- **Traffic/location data handling:** retention/erasure-job logs proving traffic data is erased or anonymised when no longer needed and billing data is purged at the limitation window; consent records for any marketing/value-added or location use; access logs showing least-privilege restriction.
- **Vendor/sub-processor register** flagging which vendors set device storage or send marketing, their DPA/contract status, and that each is consent-gated.
- **Security + breach evidence:** TLS/at-rest config (Reg 5), the security-risk-notification template (Art 4(2)), and the incident/breach runbook with the applicable notification clock.

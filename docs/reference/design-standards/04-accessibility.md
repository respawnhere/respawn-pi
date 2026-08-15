# §4 · Accessibility baseline (WCAG 2.2 A / AA)

Detail for §4 of [`design-standards.md`](../design-standards.md). This is the **floor, not the ceiling** — it applies at full rigor to *every* UI surface regardless of Rule 0 stakes, because "low-stakes" never means "excludes a class of users." Success-criterion numbers are load-bearing: cite them by number in a finding (a reviewer says "fails SC 1.4.3", not "looks low-contrast"). Two AAA criteria are folded in where they map to a browser API or spec every product should honor anyway — they're marked *adopt-as-default*, not required for AA conformance.

## Contrast & color

- **Body text ≥ 4.5:1, large text ≥ 3:1** against its background — large being ≥24px, or ≥18.66px bold. Incidental text (disabled controls, purely decorative text) and logotypes are exempt. *(SC 1.4.3, AA)*
- **Interactive boundaries and meaningful graphics ≥ 3:1** against adjacent colors — input borders, checkbox/radio/toggle outlines and states, meaningful icons, chart elements. Purely decorative graphics and browser-default-rendered controls are exempt. *(SC 1.4.11, AA)*
- **Color is never the only signal.** Error state, required field, an in-text link, a "selected" state — each needs a second cue (icon, text, underline, shape). *(SC 1.4.1, A)*
- **Text survives 200% zoom** with no loss of content or function, without needing assistive technology to get there; captions and images of text are exempt. *(SC 1.4.4, AA)*
- **Layout reflows to a single column at 320 CSS px** (≈400%-zoomed 1280px) with no two-dimensional scrolling; content that scrolls horizontally may instead fit 256 CSS px tall. Content that genuinely needs a fixed 2D layout — data tables, maps, diagrams, games — is exempt. *(SC 1.4.10, AA)*
- **Text spacing is overridable** — line height to 1.5×, paragraph spacing to 2×, letter to 0.12×, word to 0.16× — with no clipping or overlap. In practice: no fixed-height text containers. *(SC 1.4.12, AA)*

## Keyboard & focus

- **Every function is keyboard-operable**, with no timing-dependent keystrokes; the only carve-out is inherently path-dependent input like freehand drawing. *(SC 2.1.1, A)*
- **Focus never gets stuck** — the user can always move focus away with the keyboard; if the exit isn't plain Tab/Shift+Tab, the UI says what it is. The modal dialog pattern — containing focus while the modal is open, releasing it on dismiss — is how a modal satisfies this; returning focus to the trigger on close is the pack's bar, best practice beyond the SC's letter. *(SC 2.1.2, A)*
- **Tab order follows visual and reading order**, not raw DOM order where they diverge — a scrambled order breaks meaning even when every element is reachable. *(SC 2.4.3, A)*
- **A visible focus indicator exists** in at least one mode; don't strip `outline: none` without a replacement (→ §1 rule 3). *(SC 2.4.7, AA)*
- **Sticky headers, footers, cookie bars, and chat widgets don't fully hide the focused element** — add scroll-padding so a just-tabbed-to control isn't swallowed. Partial obscuring is allowed; total is not. *(SC 2.4.11, AA — new in 2.2)*
- **Focus indicator ≥ a 2px-thick outline's area, ≥ 3:1 between focused and unfocused states** — *adopt as the default focus-ring spec* even where full AAA isn't the goal (→ §1 rule 3). *(SC 2.4.13, AAA — adopt-as-default)*

## Targets & pointer input

- **Pointer targets ≥ 24×24 CSS px**, unless spaced so a 24px circle on each doesn't overlap a neighbor's, an equivalent control exists elsewhere, the target is inline in text, its size is user-agent-set, or a smaller presentation is essential. *Adopt as the mobile default:* the platform norms — 44×44pt (iOS) / 48×48dp (Android), with ~8dp between adjacent targets; the 24px SC is the floor, not the target. *(SC 2.5.8, AA — new in 2.2)*
- **Multipoint or path gestures have a single-pointer, no-path equivalent** — pinch, two-finger swipe, or drawing a shape each need a button/tap alternative unless the gesture is essential. *(SC 2.5.1, A)*
- **Nothing completes on pointer-down alone** — fire on the up-event with an abort/undo, or make up-event reverse it, so a finger slid off-target can cancel (→ §1 rule 4). *(SC 2.5.2, A)*
- **Drag interactions have a non-drag alternative** operable with a single pointer (tap-to-select then tap-to-place; click-anywhere-on-track sliders), unless dragging is essential or is native scrolling. *(SC 2.5.7, AA — new in 2.2)*
- **Authentication doesn't require a memory or puzzle test as the only path** — allow password managers and copy-paste (never block them), or offer a magic link, biometric, WebAuthn, or object/personal-content recognition. *(SC 3.3.8, AA — new in 2.2)*

## Semantics & names

- **Every custom component exposes name, role, and state** to assistive tech, with value changes announced. Native elements get this free; custom widgets need ARIA to fill the gap (→ §1 rule 1). *(SC 4.1.2, A)*
- **Structure conveyed visually is also in the markup** — headings, lists, tables, label/field associations, and required markers use real elements (`<h2>`, `<ul>`, `<label for>`, `aria-required`), not styling that merely looks structural. This is the same markup that serves machine readers (→ §1 rule 12). *(SC 1.3.1, A)*
- **Headings and labels describe their actual topic or purpose** — no "Section 1" heading, no "Click here" label. *(SC 2.4.6, AA)*
- **Link text makes sense on its own** or with its immediate programmatic context — a screen-reader user pulling a links list needs to know where each goes (→ §1 rule 10). *(SC 2.4.4, A)*
- **Every page/view has a unique, descriptive title** so tabs, history, and search results are tellable apart. *(SC 2.4.2, A)*
- **Repeated help mechanisms keep the same relative order** across every page of a process — a moving contact/chat/search link costs cognitively-disabled users most. *(SC 3.2.6, A — new in 2.2)*

## Forms & errors

- **Every input that needs data has a label or instructions** — including format hints and required markers — before the user has to guess (→ §1 rule 5). *(SC 3.3.2, A)*
- **Errors are identified in text, on the specific field** — not by color or icon alone; a bare red border tells a screen-reader or color-blind user nothing. *(SC 3.3.1, A)*
- **If the fix is known, state it** — unless surfacing it creates a security risk (never reveal which half of a login was wrong). *(SC 3.3.3, AA)*
- **Legal, financial, data-deleting, or test-submitting actions have a safety net** — reversible, or validated-with-a-chance-to-correct, or an explicit review-before-final step. This is the WCAG anchor under the §1/§3 destructive-action and deliberate-friction rules. *(SC 3.3.4, AA)*
- **Don't make users re-enter what they already gave you** in the same process — auto-populate or offer it selectable; carve-outs for security re-entry (a password), genuinely-invalid data, and where re-entering is essential. *(SC 3.3.7, A — new in 2.2)*
- **Status updates are announced without stealing focus** — result counts, "added to cart", save confirmations, progress use `role="status"` / `aria-live="polite"` (`role="alert"` for urgent), so they reach assistive tech without yanking the user (→ §1 rule 6). *(SC 4.1.3, AA)*

## Motion & timing

- **Interaction-triggered animation is disableable** unless essential — honor `prefers-reduced-motion` as the default implementation (→ §2 rule 8). *(SC 2.3.3, AAA — adopt-as-default)*
- **Nothing flashes more than three times per second** (or stays under the general/red-flash thresholds) — a hard seizure-safety line with no exceptions. *(SC 2.3.1, A)*
- **Time limits have an escape hatch** — turn off, extend to at least 10× the default, or a 20-second warning re-extendable at least 10 times; carve-outs for real-time events, limits essential to the activity, and limits longer than 20 hours. *(SC 2.2.1, A)*
- **Auto-moving, blinking, scrolling, or auto-updating content lasting > 5s has a pause/stop/hide** control, unless the movement is essential. *(SC 2.2.2, A)*

## Images & media

- **Every non-text element has a text alternative matched to its role** — descriptive `alt` for informative images, purpose-describing `alt` for functional ones (icon buttons), `alt=""` for decorative so screen readers skip them, a linked long description for complex charts, and for CAPTCHAs both a purpose description and a non-visual alternative. *(SC 1.1.1, A)*
- **Prerecorded video with audio has synchronized captions** covering dialogue and relevant sound — exempt only when the media is itself a labeled alternative to text. *(SC 1.2.2, A)*

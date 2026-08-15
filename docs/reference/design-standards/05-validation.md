# §5 · Validation probes

Detail for §5 of [`design-standards.md`](../design-standards.md). §1–§4 say what good looks like; **these are the passes that prove it, by driving the interface rather than reading the markup.** `/build` runs the relevant ones before handing off, the `design-reviewer` lens runs them as review probes, and `/ship` gates UI changes on them. Run the pass; state which you actually ran versus inferred from code. Scale which probes you run to Rule 0 — but the keyboard, contrast, and semantics probes are floor-level and apply to any interactive surface.

**1. Keyboard-only pass.** Put the mouse down and Tab through the new or changed interaction end to end. Every control is reachable and operable; the tab order matches the visual and reading order; focus is visible at every stop; focus never gets stuck; a modal contains focus while open (the dialog pattern) and returns it to the trigger on close — the return is the pack's bar beyond SC 2.1.2's letter; no action depends on keystroke timing. *(SC 2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11)*

**2. Narrow-viewport / reflow pass.** Shrink to 320 CSS px wide (or ~400% zoom on a 1280px frame). The layout reflows to a single column with no two-dimensional scrolling; nothing clips, overlaps, or gets truncated; text containers aren't fixed-height (so user text-spacing overrides survive). *(SC 1.4.4, 1.4.10, 1.4.12)*

**3. Reduced-motion pass.** Set `prefers-reduced-motion: reduce` and re-drive the surface. Non-essential animation is reduced or gone; nothing flashes more than three times a second; any auto-playing motion past 5s has a pause/stop/hide control; and the animations that remain run on `transform`/`opacity`, not layout properties. *(SC 2.3.1, 2.3.3, 2.2.2; → §2 rule 8)*

**4. Contrast computed, not eyeballed.** Take the *actual* token values for each text-on-background and UI-boundary pairing and compute the ratio — text ≥ 4.5:1 (large ≥ 3:1), interactive boundaries and meaningful graphics ≥ 3:1. A "looks fine" is not a pass and a marginal ratio is a practical fail. Compute it in dark mode too, against the dark tokens. *(SC 1.4.3, 1.4.11; → §2 rule 6)*

**5. Semantics / screen-reader pass.** Walk the accessibility tree (or a screen reader). Every icon-only control has an accessible name; every image has a role-matched alt (empty for decorative); custom widgets expose name, role, and state; dynamic status changes reach a live region. Confirm headings, lists, and label/field associations are real markup, not styling. *(SC 4.1.2, 1.1.1, 4.1.3, 1.3.1)*

**6. Destructive & high-stakes trace.** For each destructive or consequential action in the diff: is there an undo path — or, failing that, a confirmation that names the actual object and consequence (a generic "Are you sure?" counts as no protection); for a truly irreversible or high-stakes one, is there deliberate friction (a review step, typed confirmation) *and* a safety net; does the flow survive a mis-click by committing on pointer-up. Then hit refresh and Back mid-flow — the user's place and in-progress state should survive. *(SC 3.3.4, 2.5.2; → §1 rules 4, 7–8, §3 rule 7)*

**7. State-honesty pass.** Trigger each async action and watch: is there an acknowledgment inside the response window; is anything running past ~2s cancelable with no side effects; on failure, does the error identify itself in text, on the field, with the fix — and does a routine success stay modeless instead of interrupting. Fire the action twice quickly to confirm the missing-feedback double-submit trap isn't open. *(SC 3.3.1, 3.3.3; → §1 rules 6, 11, §3 rule 6)*

The standard's one-line test (see the [index](../design-standards.md)) is probes 1–4 run together: keyboard-only, 320px, motion off, contrast computed from the real tokens.

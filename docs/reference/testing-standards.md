# Testing standards

How RespawnPack writes and judges tests. The through-line: **a test is a claim about behavior that can't drift silently** — it extends [coding-standards](coding-standards.md) rule 8 ("tests are executable intent") into a discipline. Tests exist to catch the change that breaks a promise, not to decorate a diff with green checkmarks.

`/build` writes to this standard on new logic; `/review` checks coverage against it; `/playtest` proves bugs dead with it.

## 1. Test first where the logic earns it
For non-trivial new logic — branching, arithmetic, parsing, state transitions, anything with an edge you had to think about — write the failing test before the implementation. Watching it fail is the point: a test you never saw red proves nothing about its own ability to catch the bug. Trivial glue (a passthrough, a rename, wiring) is exempt — ceremony scales with blast radius, same as everywhere else in this pack. When in doubt, ask: *"if this breaks in six months, what tells me?"* If the answer is "a user," write the test now.

## 2. A bug isn't fixed until a test fails without the fix
The regression contract (`/playtest` runs on it): reproduce the bug as a test, watch it fail on the broken code, watch it pass on the fix. A fix landed without its failing-first test is a fix that can silently un-land. Name the test after the bug's *behavior*, not its ticket: `rejects expired tokens even when clock skewed` outlives `fixes #482`.

## 3. Test behavior, not implementation
A test coupled to internals (call order, private state, exact query text) breaks on every refactor and passes on real bugs — the worst of both. Assert on what a caller can observe: outputs, state transitions, emitted effects. The refactor test: **a pure refactor should never turn a test red.** If yours does, the test was pinning mechanics, not behavior.

## 4. Mock at boundaries you don't own; prefer real things you do
Mock the network, the clock, the third-party API — boundaries that are slow, flaky, or paid. Don't mock your own modules to each other: a test where every collaborator is fake verifies your mocks agree with themselves (a tautology), not that the code works. If wiring real collaborators is too painful to test, that's a design signal (see coding-standards on module shape), not a reason for deeper mocking.

## 5. Assert something that can fail
A test with no meaningful assertion — or one asserting the mock returned what the mock was told to return — is a tautology: green by construction. Each test states one claim sharp enough that a plausible bug would break it. If you can't say which bug a test would catch, delete it; it's maintenance cost with no coverage.

## 6. Size tests like a pyramid, not an hourglass
Many fast unit tests on the logic; some integration tests on the seams (the DB really queried, the route really wired); few end-to-end flows for the promises users feel (`/walkthrough` covers the rendered ones). Inverting this — everything through the browser, nothing on the logic — makes the suite slow, flaky, and vague about *what* broke. Slice coverage vertically by behavior ("checkout applies the discount"), not horizontally by layer ("test all getters").

## 7. Deterministic or deleted
A test that flakes trains everyone to re-run until green — at which point the suite catches nothing, because red stopped meaning broken. The usual culprits, with their fixes:
- **Time**: inject the clock; never assert "now."
- **Async**: poll for the actual condition with a deadline; never `sleep(n)` and hope. A fixed sleep is both too long (slow suite) and too short (flaky under load) — always, eventually, both.
- **Order**: each test builds and tears down its own state; a test that passes alone and fails in the suite has a pollution bug worth finding, not skipping.
- **Randomness**: seed it.

## 8. Readable over DRY
In test code, plain repetition beats clever indirection: a reader should see setup → action → assertion in one screen without chasing helpers. Extract a helper when duplication hides the *claim*; keep the duplication when the helper would. Test names are documentation — `describe`/name them so a failure message alone says what promise broke.

## The one-line test
Before keeping a test, ask: **"Which bug would make this fail?"** If you can't name one, it isn't a test — it's a rehearsal of the code agreeing with itself.

## 9. Audit-proof testing rules (non-negotiable)

The standard sections above describe what makes a test useful. This section describes what makes a test *admissible as evidence* — i.e. a fence a closure claim can lean on without the audit lying. `/build` writes to it on new logic; `/review` rejects claims that aren't backed by it; `/ship` blocks the push when any gate required by this section cannot be demonstrated to have run.

- **Failing-before reproduction.** Every fix lands with the failing test already on the record against the broken code: capture the exact command, the exact revision (plus a diff fingerprint when dirty), and the observed exit code / output **before** the patch. A test that never went red proves nothing about its own ability to catch the bug — it proves only that the new code agrees with itself. The regression contract (`/playtest`) is the canonical witness.
- **Real public surface, not a proxy.** Exercises hit the surface a caller observes: the exported function, the HTTP handler, the persisted row, the packaged extension loaded by Pi's resolver. A test whose subject is a private helper, a re-export, a stubbed collaborator, or a test-double of the system under test verifies the mocks agree with themselves, not that the code works. If a proxy is genuinely the only thing testable, that's a design signal — fix the design, don't lower the bar.
- **Hostile paths.** Inputs the design assumed away must be exercised: empty / null / undefined, oversized strings, malformed JSON, unicode boundary cases, concurrent writes, expired tokens, malformed paths (trailing slash, double slash, dot-segments), non-ASCII, and the same boundary the production guard accepts at the edge. If a code path accepts user input, it has hostile inputs by construction; the suite proves it survives them or the code does not ship.
- **Failure-triggered rollback.** Where the code ships with a rollback / uninstall / revert path, inject a forced failure after each mutating stage (permissions, missing target, interrupted write) so the rollback path actually runs, then verify the system lands in the pre-operation state byte-for-byte. "Has a rollback" is not "rollback restores after failure"; only a failure-triggered restoration proves it.
- **Strict evidence + schema.** Every fact the change asserts is paired with the evidence that proves it (the exact test name, the exact command, the exact log excerpt, the exact artifact path) and, where applicable, a schema that validates the evidence shape. "It works" / "the gate is green" / "passes locally" is not evidence. Where the gate emits JSON or a structured marker, the schema is enforced and a non-conformant run is a fail.
- **Claims require named fences.** A claim in a handoff is admissible only when it names (a) the exact script / canary / migration, (b) the exact revision plus a diff fingerprint when the tree was dirty, and (c) the exit status / artifact it produced. Generic "npm test" passes the ratchet on this section only when it names every `.test.mjs` it invokes. Anything else is opinion, not evidence.
- **CANNOT_DETERMINE for unavailable gates.** If a gate isn't wired in this environment, wasn't run this session, or its artifact was deleted, the closure for that gate is `CANNOT_DETERMINE` — recorded explicitly, not elided. "Green by absence" is a lie; surface what could not be checked so an independent reviewer can decide what to re-run.
- **Independent same-snapshot closure.** Before a closure claim, a second reading of the same immutable tree snapshot (commit hash, or HEAD plus diff fingerprint) by a different subagent, fresh lens, or different-vendor model confirms the first. Self-attestation is not closure; the cross-check is.
- **Clean reproducible build, not a local install.** Gate-level claims of "loads under Pi" run against a clean `git archive HEAD` artifact + `npm ci --ignore-scripts --omit=dev` + Pi resolver, not against the developer's working tree. A local install can mask missing files, stale symlinks, or hand-edited artifacts; the archive + `npm ci` path proves the shipped shape.

These are not "best practice" — they are the difference between a closure that an audit can trust and a closure that cannot. A test that fails any of them is a test that cannot be cited as evidence, no matter how green it renders in the developer's terminal.

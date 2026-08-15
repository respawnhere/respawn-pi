# Coding standards

How RespawnPack writes and reviews code. The through-line: **code shows *what*; comments and names carry *why*.** The "why" is the expensive knowledge: the thing the next reader (human or agent) cannot reconstruct from the code, and the first thing lost when direction changes. Capturing it is the docs-spine discipline, one altitude down.

`/build` writes to this standard; `/review` checks against it.

## 1. Comment intent, not mechanics
A comment that restates the code is noise. It rots, drifts from the code, and trains readers to ignore comments. Comment what the code **can't say itself**:

- **Why**: the decision, the tradeoff, the constraint. *"Batched at 500 because the API 413s past ~600 rows."*
- **Non-obvious**: the gotcha, the edge case, the deliberate workaround. *"Off-by-one is intentional: the cursor is exclusive."*
- **Danger**: an invariant that must hold, an ordering that matters. *"Must run before the auth middleware, which sets the request id the logger reads."*
- **Pointer**: tie the *why* to its source: a `DECISIONS.md` `D-id`, an issue, a spec. This keeps code connected to the [decision ledger](../DECISIONS.md), anti-drift at the code layer.

Don't comment the obvious. If a comment is needed to explain *what* a line does, first try to make the code say it (a better name, a named constant, a smaller function), and keep the comment only for the *why*.

```diff
- // loop over users and send email          ← restates the code; rots
- for (const u of users) sendEmail(u)
+ // sequential await here: the SMTP relay drops >5 concurrent (see D-042)
+ for (const u of users) await sendEmail(u)
```

## 2. Names are the cheapest documentation
A precise name removes the need for a *what*-comment. `retryWithBackoff` reads on its own; `doIt` needs a paragraph. Spend naming effort before comment effort.

## 3. Match the surrounding code
New code should read like the code around it: its conventions, naming, error handling, and **comment density**. A file that comments every function and one that comments nothing are each internally consistent; match the one you're in. Consistency is itself legibility.

## 4. Keep changes small and one-concern
A diff should do one thing, reviewably. Unrelated cleanup goes in its own change. The reviewer, and the next `git bisect`, will thank you.

## 5. Delete, don't comment out
Git is the history. Commented-out code and dead branches read as "maybe still needed", and that's drift. Remove them; the commit and its message hold the why.

## 6. Handle errors on purpose
Every `catch` does something intentional. If you deliberately swallow one, say why: an empty catch with no rationale is indistinguishable from a bug.

## 7. Encode invariants where the language can
Prefer a type, an assertion, or a guard over a comment that *asks* the reader to maintain an invariant. Comment the invariant only where the language can't enforce it.

## 8. Tests are executable intent
A test states what behavior is *supposed* to be, in a form that can't drift silently. A regression test (`/playtest`) encodes a bug's "this must not happen again." Treat test names as documentation.

## 9. Shape modules by depth, not length
A good module is deep: a simple interface hiding substantial implementation. A shallow one costs more than it saves, since its interface is paid by every caller and its implementation only once; when those two costs converge, the module isn't earning its keep. Split along change-reasons, the things that vary independently, never by line count: a long file that changes for one reason reads easier than several short files that all change together. Run the deletion test on anything that feels like ceremony: if inlining an abstraction and removing it would make the codebase simpler to follow, it was negative-value. A pass-through layer that adds no invariant, no translation, and no decision of its own is a smell, one caller away from being deleted.

## 10. The observable behavior is the contract
Consumers depend on what a function, endpoint, or type actually does, not on what its docs claim (Hyrum's Law: with enough callers, every observable behavior becomes something someone relies on). Decide the contract first for anything exported or served (types, status codes, error semantics) before writing the implementation behind it. Errors are part of that contract too: a consistent shape and stable codes, not whatever the current code path happens to throw. Ship a breaking change by expanding: add the new field or endpoint alongside the old one, migrate callers, retire the old path later. Never mutate what an existing field or endpoint means in place. Version only when the contract truly must break, and say so explicitly: a silent meaning-change is worse than a major-version bump.

## The one-line test
Before writing a comment, ask: **"Could the reader get this from the code itself?"** If yes, improve the code. If no, that's the comment worth writing.

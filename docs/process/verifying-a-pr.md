# Verifying a pull request

For whoever reviews a change here. `review.md` says what "done" means; this file
says which part of it a machine has already done for you, and which part it
cannot do at all.

## What CI already proves

Two checks run on every pull request. Between them they cover:

- **`web (typecheck + tests)`**: no database file and no scan images tracked in
  the tree, checked on the result rather than on the ignore rule; then
  `tsc --noEmit` over the whole project, and the unit and integration suite.
  Real SQLite in memory, real barcode decoding, real OCR against generated
  images.
- **`browser journeys`**: every Gherkin scenario in `e2e/`, in a real browser,
  against the app started through Aspire, asserting on what reached the
  database rather than only on what rendered.

`no production data committed` used to be a third check with a job of its own.
It took five seconds and GitHub bills a job rounded up to a whole minute, so it
is now the first step of `web (typecheck + tests)`, and it also runs after every
merge in the `Provenance` workflow. Same check, run in more places, for less.

### A green board on a documentation change

Both jobs always start on every pull request, but each one asks
`scripts/ci-scope.mjs` what the change touched and skips its expensive steps
when the answer is "markdown and `docs/` only". So a README change gets both
check names, both green, in about fifteen seconds each rather than five minutes.

The names must always appear, which is why the skipping happens **inside** the
jobs rather than through a `paths:` filter or a job-level `if:`. `merge-pr.mjs`
treats a required check that never ran as a refusal, and a job skipped by `if:`
reports SKIPPED, which it also refuses. Either would make documentation pull
requests unmergeable. If you see a check name missing from a board, that is the
bug, not a saving.

**Do not re-run any of these by hand.** They gate the merge already:
`scripts/merge-pr.mjs` refuses a pull request unless each one is green, and a
check that never ran counts as a refusal. A reviewer who runs the browser suite
locally has spent minutes proving something the run already proved. If you catch
yourself repeating a mechanical check on every review, that check belongs in CI,
not in your head.

Two things a green board still does not mean. A scenario that has never been
seen to fail is not a regression test, so the coverage a suite claims is worth
whatever its scenarios have actually caught. And no CI run at all is a different
problem from a failing one: a conflicting branch produces no run, which looks
exactly like Actions being broken. Check `gh pr view <n> --json mergeable`
before drawing any conclusion from an empty board.

## What CI cannot prove

Two things, and they are the whole of the review.

**That the change does what the issue asked.** CI checks that the code the
author wrote behaves as the author expected. It has no opinion on whether that
was the right thing to build. Read the issue, then read the diff, and say
whether one answers the other.

**That the change's central claim is true.** Nearly every pull request rests on
a claim: this is read only, this cannot be reached without a session, this
cannot run twice. The claim is usually in the description and the comments
rather than in an assertion, so nothing runs it. You verify a claim by following
the code, not by running the suite.

### The worked example

A change here added `POST /api/shelves/overflow/plan` and described it as read
only: asking what a full shelf would need, without moving anything. The suite
was green. That proved nothing about the claim, because a scenario that proposes
a move and then confirms it looks identical whether or not the proposal wrote.

The way to check it was to follow the call:

1. The route (`web/server/index.ts`) calls `shelves.proposeOverflow`.
2. `proposeOverflow` (`web/server/shelves.ts`) calls `planOverflow`, then
   `booksIn`, `layoutRange` and `stripWithGap` to draw the result.
3. `planOverflow` calls `layout`, `list` and `layoutWith`.
4. None of those writes. The sibling `overflow` shares the same `planOverflow`
   and then calls `applyBoundary`, which is the only thing on this path that
   touches the table.

That is the review. It took reading four functions, it is repeatable by the next
person, and re-running the browser suite would not have got near it. When a
claim is about what a change does **not** do, expect to spend your time this
way.

## Delegating a verification

A verification is a good thing to hand to an agent, on two conditions: you say
exactly what to drive, and you fix the shape of what comes back. Otherwise you
get a transcript, and reading a transcript is doing the work again.

The brief names the specific thing:

> Start the app with Aspire. Scan a book onto a full shelf and take the
> suggested move. Then call `POST /api/shelves/overflow/plan` for the same shelf
> and confirm the `area` rows are unchanged afterwards. Do not run the
> browser suite; CI has run it.

The reply is four lines and nothing else:

```
State:      done | partial | blocked
Drove:      what was actually run and clicked, in one or two lines
Observed:   what happened, including anything that did not
Not covered: what the brief asked for that was not reached, and why
```

A "partial" with an honest **Not covered** is more useful than a "done" that
quietly skipped a step. The point of the fixed shape is that you read four lines
and know whether to believe the change.

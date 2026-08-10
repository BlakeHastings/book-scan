# Definition of Done and the review process

An issue is done when it passes **three lenses**. Mechanical checks are not one
of the lenses: they are the price of admission, they run in CI, and no human or
agent should spend judgment on them.

## Gate 0: mechanical (automated, no judgment)

CI runs exactly these. If they are red, the work is not ready for review.

- `npm run typecheck`
- `npm test`, the unit and integration suites
- the browser journeys in `e2e/`, which gate pull requests
- no scan data committed (`scripts/check-no-scan-data.sh`)
- the merge guard and the CI scope rules behave (`scripts/guard-merge.test.mjs`,
  `scripts/ci-scope.test.mjs`)

Never ask a reviewer to run these by hand. If a mechanical check is missing,
adding it is cheaper than reviewing for it forever.

**Three things a reviewer might assume are covered and are not.** There is no
lint or format check: `eslint.config.mjs` exists but nothing runs it. The
production build is never run in CI, only `tsc --noEmit` via typecheck, so a
Vite build failure would reach master. And migrations are **not** reversible by
design, so "reverts cleanly" is not a property to check for.

**The schema stopped being append only at #228**, which dropped the ten
photograph columns on `books` once `capture` was what the app read, and #227,
which dropped `books.is_fiction` and `books.author_filing` once the genre tag and
the credited alias decided where a book files. That is the cut-over epic #220
doing what it exists to do, and it does not license dropping a column as a side
effect of something else. What a change that drops one owes: the drop is its own
commit and the last one, so a revert is one commit; the migration counts what it
is about to make unreachable, both ways, and **refuses rather than finishing
quietly**; any repair the old columns are the only source for runs in an earlier
migration, while they still say something; and **the comparison that says the new
answer is the old answer runs in the same pull request**, over a catalogue that
still has the column, because afterwards there is nothing to compare against.
`web/infrastructure/db/cutover.test.ts` is what that looks like.

## Lens 1: functionality, proven by interaction

**The reviewer drives the running app.** Not the tests, the app.

```bash
aspire start --non-interactive   # from the repo root, never `npm run dev` in a worktree
aspire wait api && aspire wait web
aspire ps                        # the dashboard URL, with its token

cd e2e && npm ci && npx playwright install chromium && npm test
```

Run the end-to-end suite first: what it covers, you do not have to re-check.

Then exercise **the change itself** as the actual user would, since no suite
covers what landed today. Confirm:

- the happy path works end to end
- one realistic failure path behaves sanely (bad input, expired link, network drop)
- no console errors, no unhandled promise rejections
- no new error-level logs or failed spans

"Tests pass" is not evidence of functionality. A green suite over an app that
does not load is a common and embarrassing outcome. Say what you actually did
and what you actually saw.

## Lens 2: code quality, proven by comprehension

**The reviewer must be able to explain what the code does without asking the
author.** If they cannot, that is the finding. Unclear code is a defect even
when it is correct.

Specifically reject:

- code whose shape mimics a pattern elsewhere without the reason that motivated it
- abstractions with exactly one caller and no second caller in sight
- names that restate the type (`dataObject`, `handleThing`, `utils`)
- comments explaining *what* a line does rather than *why* it is that way
- swallowed errors, `any`, and suppression directives without an adjacent reason
- defensive code for conditions that cannot occur

Prefer deleting code to adding a flag. The best review outcome is a smaller diff.

## Lens 3: architecture, proven by entropy accounting

Every change either uses an existing pattern or introduces a new one.
**Introducing a new pattern is a decision that must be named and justified**,
not something that happens quietly in a feature PR.

Ask on every change:

1. Does this duplicate something we already have? Search before adding.
2. Does it add a dependency? What did we get, and what does it cost to remove later?
3. Does it put logic in a new layer or a new place? Why is the existing place wrong?
4. Would a new engineer find this where they would look for it?
5. Is the project's single source of truth still single, or did a parallel one
   just get born?

If a change introduces a new pattern deliberately, record the decision where
somebody will meet it. This repository does not use ADRs. Decisions live in
three places instead:

- **`docs/shelving.md`** for anything about filing, placement or ordering. It
  is the authority, and code that disagrees with it is wrong unless the owner
  has said otherwise in an issue.
- **`AGENTS.md`** for invariants and for anything an agent could break by not
  knowing it.
- **The issue and the pull request** for everything else, including the
  approaches that were measured and rejected. Several changes here are worth
  more for what they ruled out than for what they added.

A comment next to the code is usually better than any of them for a decision
that only makes sense in one place.

## Recording the review

Post the outcome on the issue or PR with these headings. Be specific and honest:

```
## Functionality
What I ran, what I clicked, what I saw. Include failures found.

## Code
What this code does, in my own words. Concerns, if any.

## Architecture
New patterns introduced, dependencies added, duplication found.

## Verdict
Ship / Ship with follow-ups (linked) / Needs work (specific changes)
```

An empty section is a signal the lens was skipped. Say "not applicable, this is
a docs-only change" rather than leaving it blank.

## This process is itself reviewable

If a gate is producing ceremony instead of signal, **change it**. Open an issue
against this document, say which gate wasted effort and what it should be
instead, and edit it. A review process nobody believes in is worse than none,
because it launders unreviewed work as reviewed.

Bias: automate anything mechanical, keep human and agent judgment for the three
lenses, and delete any step that has never once caught a real problem.

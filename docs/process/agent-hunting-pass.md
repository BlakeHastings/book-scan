# Running an agent hunting pass

A repeatable way to point an agent at book-scan and have it use the app the
way a person would, rather than through a script. See issue #69 for why this
exists.

## What this is, and what it is not

`e2e/` drives whole journeys deterministically through Gherkin, and that
suite is what gates merges. This is the other half. An agent here follows a
journey the way somebody cataloguing books actually would: pick up a book,
scan it, decide where it goes, notice what feels wrong. It finds what a
script cannot, because a script only ever does what it was told to check.

Two passes run before this document existed found nine real defects between
them, none of which any scripted test would have caught. Among them: the API
process dying on any OCR pass, invisible to e2e because the stub resolves
every barcode so OCR never runs there; a metadata edit silently checking a
book back in and destroying an unrecoverable timestamp; and shelving never
recording where a book went, so misfile detection flagged the move the user
had just made.

**An agent pass is not repeatable, so it is not a gate.** Its value is
finding what deterministic tests do not. The output of a pass is not "we ran
it and it passed" — it is a short list of defects, each of which should
become a deterministic test (a Vitest unit test, or an e2e scenario if it
needs a whole journey) so the next pass does not have to find the same thing
twice.

**Finding nothing serious is a legitimate outcome.** Say so in the report. A
pass that turns up nothing worth fixing and reports that plainly has done
its job. Without this line, a pass tends to return a list of styling
opinions and taste calls that costs more to triage than it is worth, and
buries anything real underneath it.

Run a pass after a batch of merges has landed, not on every change. It is
scaffolding for an occasional check, not a framework and not a CI gate.

## Running a pass

All commands from the repo root unless noted.

### 1. Start the app under Aspire, then seed a throwaway world

The order changed at stage I. The catalogue used to be a file the seeder could
create before anything was running; it is a Postgres database the AppHost
provisions, so the AppHost starts first and hands out the connection.

```
aspire start --non-interactive     # from the repo root
aspire wait api
aspire describe api                # read ConnectionStrings__bookscan from this
cd web
npm run seed -- --reset --target '<the connection>'
```

The seeder takes its target on the command line and will not read
`ConnectionStrings__bookscan` out of the environment, for the same reason
`backup-catalogue.ts` will not: it writes, and a connection string that happens
to be in a shell should not be able to decide what gets written to. It also
refuses any target on port 5433 outright, which is the live catalogue.

This writes a synthetic catalogue and capture queue to this checkout's own
`web/data`: about 20 shelved books across two fiction bookcases and one
non-fiction bookcase, several areas each, a couple of books checked out, one
area left with only a single book in it, a few books with no publisher cover
and one with no spine photo; and around 18 captures in the queue at
different stages — some already resolved and ready to shelve in one tap,
some mid-scan with only a barcode shot so far, some with only a cover shot
(no barcode at all, forcing OCR), and a couple already failed. Titles and
authors are real books so the world reads like a library; every ISBN is
synthetic with a valid check digit and every photo is rendered by
`web/server/fixtures.ts`, the same generator the test suite uses. Nothing in
it depends on the network.

See `web/scripts/seed-world.ts` for exactly what it builds. `--reset` empties
the catalogue and clears `web/data` first; without it the script refuses a
target that already holds books, so a re-run cannot silently pile a second world
on top of the first. That is one condition rather than two since #183: a book
waiting in the queue is a book.

This never reads or writes `BOOKSCAN_DATA`: the photographs always go to this
checkout's own `web/data`. See AGENTS.md for why that variable matters.

### 2. Open the app

```
aspire wait web
aspire ps
```

Read the web resource's URL from `aspire ps` (or `aspire describe web`).

**`aspire ps` prints `http://` for the web resource and the server is HTTPS.**
Use `https://` or the page will not load, and do not conclude the resource is
unhealthy from a connection that was refused at the wrong scheme.

Once the app is up, the background worker starts draining the pending captures
for real: real barcode decoding, a real (network) catalogue lookup that the
synthetic ISBNs will not be found by, and real OCR on the captures that have no
barcode at all. That is deliberate. It is the same pass the app makes in
ordinary use and worth watching happen rather than short-circuited, since it is
exactly the kind of pass that has crashed the API before.

**But it will not have happened, if you followed the order above.** The drain
fires once at boot, and at boot the queue was empty because the seeder runs
afterwards. Following these steps verbatim gives an agent a queue full of
captures that no worker will ever touch, and the pass then reports the drain as
untested without knowing why. Restart the api once the seed is in:

```
aspire resource api restart
```

Then watch it in `aspire logs api` before going on. Found by the pass of
2026-08-07, which hit exactly this and worked it out.

### 3. Give the agent the brief

Open the app at phone dimensions, around 414x896. This is not a desktop app,
and a screen wide enough to show things the phone layout never actually
shows is not testing what a person sees.

Tell the agent to behave like somebody cataloguing books, not like somebody
testing software:

- Walk whole journeys, not isolated screens. Pick a queued capture through to
  shelving it. Look at a book's detail view and decide whether to check it
  out. Look at the "needs attention" list and follow one through to fixed.
  Two features that were each correct alone are exactly where the real
  defects have been found, and you only see the seam by walking through
  both.
- Try the awkward cases the seed deliberately included: the book alone in
  its area, the ones with no cover or no spine photo, the checked-out books,
  the captures with no barcode at all.
- Say when something feels wrong even if it is not obviously broken — a
  confusing instruction, a state that is hard to back out of, a screen that
  does not say what just happened. Confirmed defects come first in the
  report; things you were not sure about come after.
- **Do not modify source during the pass.** Findings only. An agent that
  "fixes" what it finds mid-pass means the report and the code drift apart,
  and nobody can tell afterward which claim in the report is still true.
- It is fine, and expected sometimes, to find nothing worth reporting. Say
  that plainly rather than inventing severity.

## Report shape

Whoever triages a pass reads this in order, so put the expensive-to-miss
things first:

1. **Defects**, each with reproduction steps a person could actually follow:
   what you did, what you expected, what happened instead. If you can say
   which two features intersect to cause it, say so — that is usually the
   more useful fact than the symptom itself.
2. **Disagreements between two changes** that are not clearly defects: two
   screens describing the same state differently, an instruction that
   assumes something a different screen just contradicted.
3. **What could not be tested**, and why — a path that needed something the
   seed does not provide, a feature gated behind a state the pass could not
   reach.

Leave out styling opinions and taste calls unless they actively mislead
somebody about what the app just did. That is what "finding nothing serious
is legitimate" is protecting: a report that is mostly opinion costs more to
read than the defects inside it are worth finding.

## After a pass

Every confirmed defect becomes a deterministic test before the pass is
considered finished — a Vitest unit test near the code it covers, or an e2e
scenario in `e2e/features/` if the defect only shows up across a whole
journey. Follow the same discipline AGENTS.md asks of any e2e scenario:
revert the fix, watch the new test fail, then restore the fix. A test that
has only ever passed alongside its fix has not proven it would catch the fix
being lost.

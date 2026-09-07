# End to end suite

Gherkin features, run in a real browser, against the real app started by
Aspire, with the assertions ending in the database.

The `.feature` files are the readable specification. Read
[`features/`](features/) to find out what the product does; everything else in
this directory exists to make those sentences executable.

## Running it

```bash
cd web && npm ci              # once: the camera fixtures use this toolchain
cd ../e2e
npm ci
npx playwright install chromium
npm test
```

`npm test` is `bddgen && playwright test`. `bddgen` turns the `.feature` files
into Playwright test files under `.features-gen/`, which is why it is not just
`playwright test`.

Useful variants:

| Command | What it does |
| --- | --- |
| `npm test` | The whole suite, headless |
| `npm run test:headed` | The same, with a visible browser |
| `npm run test:ui` | Playwright's watch mode UI |
| `npm run report` | Open the HTML report from the last run |

Nothing needs to be running first. The suite starts the AppHost, waits for both
resources to be healthy, discovers the ports Aspire assigned, and stops the
AppHost when it finishes. It stops only the AppHost it started; other Aspire
apps on the machine are left alone.

## How it is made deterministic

**The camera is a file.** The app's core input is a phone camera through
`getUserMedia`, which cannot be part of a repeatable test. Chromium is started
with

```
--use-fake-device-for-media-stream
--use-file-for-fake-video-capture=.fixtures/back-cover-<isbn>.y4m
```

so every frame the page receives is a known back cover carrying a known
barcode. The cover comes from `web/server/fixtures.ts`, the same generator the
unit tests decode barcodes out of, converted to Y4M by
`web/scripts/e2e-video-fixture.ts`. Uncompressed and generated rather than
committed: nothing sits between the drawn barcode and the frame the page sees,
and no binary goes into git.

The camera file is a browser launch argument, so it is fixed for a whole run.
One book is in front of the camera for every scenario, and it is named in
`support/books.ts`. A scenario needing a second book needs a second Playwright
project with its own flag.

**There are two such projects, split by tag.** `chromium` sees the back cover
and runs everything; `chromium-front-cover` sees the same book's front cover
and runs the scenarios tagged `@front-camera`. Each scenario runs in exactly
one of them, so the split costs a browser launch rather than a second pass
over the suite.

The split is not cosmetic. A back cover carries a barcode, and the scan route
reads it before it compares any covers, so a scenario about recognising a book
by its cover cannot be written against the back cover camera at all: it would
pass by reading the barcode and prove nothing about the comparison. Tag a
feature `@front-camera` when what it is about is the book being held up rather
than the barcode being presented.

It cuts the other way as well, and `queue-duplicate-barcode.feature` is the
case. Recognising a book already in the queue is answered by the ISBN where
there is one and by the cover comparison where there is not, so the two
questions need the two cameras: the untagged project is what proves the
identifier is used, because there the barcode is the evidence rather than a way
of stepping around it (#146).

**The catalogues are local.** Open Library and Google Books are consulted by
the API process, not the browser, so Playwright's request routing cannot reach
them. `support/catalogue-stub.ts` starts a small HTTP server that answers as
both, plus the cover endpoint, and the AppHost passes its address to the API
through `BOOKSCAN_OPENLIBRARY_URL`, `BOOKSCAN_GOOGLE_BOOKS_URL` and
`BOOKSCAN_COVERS_URL`. Those are unset in normal use and the real services are
the fallback. Without this a run goes red whenever Open Library is slow, and in
a way that looks exactly like the app being broken.

**No sleeps.** Every wait is a wait on a condition: a frame arriving, a title
appearing once the queue has read the photograph, a button becoming enabled.

**The ports are discovered.** Aspire assigns them, so nothing here mentions
5173 or 3001. `aspire describe --format Json` is read at startup. The one
correction is the scheme: the `web` endpoint is declared HTTP but Vite
terminates TLS itself, so the browser is sent to `https://`.

## The one thing that is not deterministic, and what is done about it

Everything above removes a source of variance the suite can own: the camera, the
catalogues, the ports, the database. **One is left, and it is the machine.**

Chromium abandons every request in flight, with `net::ERR_NETWORK_CHANGED`, when
the host's network configuration changes. Starting a container changes it: a
bridge and a veth pair come up, and removing it takes them away. `aspire start`
and `aspire stop` each do it, and where several checkouts are worked at once
somebody else's environment comes up while this one's browser is fetching the
two hundred modules a Vite dev server serves for a page. A page that loses
`/src/main.tsx` mounts nothing and draws white, and the only thing the scenario
can then say is that some element was not visible.

Measured (#448): opening the first screen sixty times against one
already-running app lost one of them this way, and repeating it while
deliberately creating and removing a Docker network every three seconds lost
five of forty. It is the whole of "a different scenario fails each run": which
scenario is loading at that moment is a coin toss.

`support/opening.ts` is the answer, and it is the only place this suite loads a
page. It waits for the screen the step is about to assert on **or** for the
browser to say a request was abandoned because the network moved, and it loads
the page again only for the second. That is not a retry of a failing scenario:
an app that is broken produces no such error, so the caller's own assertion
fails with its own words at its own speed. Every reload prints a line, so a
machine doing this constantly reads as a pile of lines rather than as silence.

`steps/fixtures.ts` is the other half. A scenario that goes red prints what the
browser reported while it ran — console errors, page errors, requests the
browser gave up on and responses that came back at 400 or worse — because
without that the account of a blank page is "a heading was not visible", and the
honest conclusions available from that are "the app is broken" and "the suite is
flaky". Both are wrong, and one of them ends in pressing re-run.

## State between scenarios

The AppHost puts this run's database in `web/data/e2e/<run id>`, a directory
of its own, so a suite that assumes an empty catalogue cannot wipe whatever you
have been scanning into this checkout. `BOOKSCAN_DATA` is never set by anything
here: the AppHost keeps sole authority over where data goes, and the run id it
is given is sanitised to a single path segment.

Within a run every scenario starts from `Given the catalogue is empty`, which
deletes the rows rather than the file, because the server holds the database
open for the whole run.

Scenarios therefore run one at a time (`workers: 1`). Parallelism would need a
database per worker, which means an AppHost per worker, which costs far more
than it saves at this size.

## The suite signs in, in both of the ways it talks to the app

Since #521 every route under `/api` is behind a gate: a request with no session
answers `401`. That covers the browser's requests for screens and photographs and
the direct `fetch(apiUrl, ...)` calls the step files use to set a scenario up
without photographing forty books through the camera.

`global-setup.ts` obtains one session through the real door — `apphost.mts` sets
`BOOKSCAN_DEV_SIGN_IN`, so this checkout's api carries a development provider and
`GET /api/auth/dev/start` walks the same three steps Google's callback walks —
and hands the cookie to the workers in `BOOKSCAN_E2E_SESSION`. `steps/fixtures.ts`
puts it on the browser context and attaches it to `fetch` calls made at the api's
own origin, and at no other origin, so the catalogue stub's control plane is
untouched.

**Nothing here writes a session row by hand.** A suite that could reach the API
through a door the app does not have would be proving an app that is not
deployed, and a change to how a session is made has to break this run rather than
leave it green.

## Asserting on the database

`support/database.ts` opens the same SQLite file the app is writing to, which
it finds by asking the server (`/api/health` reports the database it opened)
rather than by rebuilding the path and hoping. That is the point of the suite:
a book that renders correctly on screen but persisted with the wrong filing
name is exactly the bug a screen-only test waves through.

Reading alongside the running server is safe. The app opens SQLite in WAL mode
with a five second busy timeout.

## Layout

| Path | What lives there |
| --- | --- |
| `features/` | The Gherkin specification |
| `steps/app.steps.ts` | Everything that taps the screen |
| `steps/catalogue.steps.ts` | Setting up, and reading the database afterwards |
| `steps/fixtures.ts` | The world a step runs in |
| `support/aspire.ts` | Starting, waiting, discovering, stopping |
| `support/catalogue-stub.ts` | Open Library and Google Books, locally |
| `support/books.ts` | The books this suite knows about |
| `support/database.ts` | Reading and resetting the catalogue |
| `support/opening.ts` | The only place a page is loaded, and why that needed a file |
| `support/machine.ts` | What this machine has left to hand out, and which number that is |
| `loop/run.sh` | One feature, N times, so a flake is a rate rather than an anecdote |
| `global-setup.ts` | Wires all of the above together |

## Running beside another checkout

Two checkouts of this repository can run their AppHosts at the same time, so a
suite in one worktree does not have to wait for a suite in another. That was
not true until #28: `aspire.config.json` pinned the dashboard, the OTLP endpoint
and the resource service to fixed ports, `aspire start --isolated` did not
randomise those, and a second checkout died with "address already in use". The
profile is gone, and Aspire now picks free ports for all three.

Keep it that way. If a run ever fails to start with "address already in use",
the first thing to check is whether a `profiles` block has come back into
`aspire.config.json`; the second is `aspire ps`, for an AppHost this checkout
left behind.

# AGENTS.md

Instructions for coding agents working in this repository. Read this before
touching anything.

## What this is

A phone-first web app for cataloguing a physical book collection. You hold a
book up to a phone camera, it decodes the barcode or reads the printed ISBN,
confirms the record against Open Library, and tells you which two shelved books
the new one belongs between.

All the code lives under `web/`. It is a TypeScript project: React 18 and Vite
on the client, Express and better-sqlite3 on the server.

## The one rule that matters most

**There is real production data, and it is not in this repository.**

The catalogue is a live record of someone's actual book collection: 57 books
and 286 cover photographs at the time of writing. Re-scanning it means
physically handling every book again. Treat it as irreplaceable, because it is.

It lives outside this repo, at:

```
C:\Users\Blake\book-scan-production-data\live\
```

Agents must never read from, write to, point a dev server at, run a migration
against, or delete anything in that directory or any sibling under
`book-scan-production-data\`.

You do not need it. Everything you need to develop and test is generated
locally. If you believe a task requires production data, stop and ask the owner
instead of proceeding.

### Why you are unlikely to reach it by accident

The safety here is structural, not just a request:

- The server resolves its data directory as
  `process.env.BOOKSCAN_DATA ?? 'data'` (`web/server/index.ts:40`). With no env
  var set, it uses `web/data/` inside your checkout, never the live path.
- **Do not set `BOOKSCAN_DATA`.** It is the only thing standing between a dev
  server and the real catalogue. Under Aspire you do not need to: the AppHost
  sets it explicitly to this checkout's own directory, which overrides anything
  inherited from your shell.
- Every server test opens an in-memory database (`:memory:`) and generates its
  own barcode and cover fixtures, so **no test reads or writes the catalogue.**
- `web/.gitignore` excludes `data/`, so a database or cover photo cannot be
  committed. CI re-checks this on the result, because an ignore rule is silent
  when someone forces past it.
- The OCR tests download and cache language data, but that cache is resolved
  independently of `BOOKSCAN_DATA` (`web/server/identify.ts:392`, cached under
  the user's home directory, not the data directory), so it cannot land
  anywhere near the catalogue either.

If you add a test that needs a database, open `:memory:` like the existing ones
do (see `web/server/store.test.ts`). Never write a test that touches a path
outside the repository.

## Running things

All commands run from `web/`.

```
npm ci             # install
npm run dev        # server on :3001 and client on :5173, over HTTPS
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run build      # typecheck then vite build
```

`npm run dev` binds `0.0.0.0:5173` with a self-signed certificate. That is
deliberate: Safari refuses `getUserMedia` a camera stream over plain HTTP on a
LAN address, so the phone needs HTTPS.

### Running it under Aspire

Aspire is the local orchestrator. Use it when you need the app running rather
than just the tests, and **always** when working in a git worktree, because
fixed ports are what make two worktrees collide.

From the repo root:

```
aspire start --non-interactive   # never `npm run dev` in a worktree
aspire wait api                  # block until healthy, do not poll by hand
aspire wait web
aspire ps                        # resources, ports, dashboard URL
aspire logs api                  # console output
aspire otel traces               # spans from real requests
aspire stop
```

Aspire assigns the ports, so nothing is fixed at 3001 or 5173. It also injects
`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_PROTOCOL`, which
`web/instrumentation.ts` reads.

Traces work. Verified 2026-08-03 by starting the AppHost, serving three
requests, and running the command:

```
19:46:08.162  api: GET   1 span  6.98ms  OK
19:46:08.212  api: GET   1 span  1.22ms  OK
Showing 4 of 4 traces
```

**Check delivery before trusting an empty result.** `aspire logs api` prints
`[otel] <endpoint> over <protocol> accepted the first batch of spans` once
export succeeds, and a `REJECTED` line when it does not. That line exists
because this pipeline previously logged a cheerful `exporting to ...` while
every batch died and retried silently, so an empty trace list looked like "my
change did nothing" rather than "telemetry is broken". `OTEL_LOG_LEVEL=debug`
narrates the exporter if you need more.

Honour the protocol Aspire injects. Its OTLP listener negotiates h2 only, so an
HTTP/1.1 exporter is refused at the TLS layer. That was the original bug (#34).

`aspire otel logs` stays empty: nothing exports OTLP log records. Use
`aspire logs <resource>` for console output.

Prove your change works by driving the running app and reading what it says,
then turn what you did by hand into a test. A change nobody watched run is not
verified.

#### Several checkouts really can run at once

This is verified, not assumed: two checkouts of this repo have been started
side by side and both reported healthy `api` and `web` resources at the same
time. It holds for the AppHost's own ports as well as the app's.

It only holds because `aspire.config.json` has **no `profiles` block**. A launch
profile pins Aspire's own three ports, the dashboard frontend
(`applicationUrl`), `ASPIRE_DASHBOARD_OTLP_ENDPOINT_URL` and
`ASPIRE_RESOURCE_SERVICE_ENDPOINT_URL`, and a second checkout then dies with
`Failed to bind to address https://127.0.0.1:22186: address already in use`.
Neither `aspire start --isolated` nor exporting those variables in your shell
overrides a profile: the profile wins. With no profile, Aspire picks free ports
for all three. **Do not add a `profiles` block back to `aspire.config.json`**,
and check that `aspire update` or a template refresh has not reintroduced one.

The cost, and it is deliberate: **there is no fixed dashboard URL in any
checkout, including the main one.** It changes on every start. Read it from
`aspire ps`, which prints the URL with the login token already in it. Nothing
else about a checkout is affected.

`apphost.mts` is the only AppHost file to hand-edit. **Never edit
`.aspire/modules/`**: it is generated and regenerated on every start, so edits
are lost. To add an integration, run `aspire add <package>`.

### The end to end suite

`e2e/` holds a browser suite described in Gherkin. It starts the app through
Aspire itself, drives the real camera path, and asserts on what reaches the
database rather than only on what renders.

```
cd web && npm ci     # the camera fixtures use this package's toolchain
cd ../e2e && npm ci && npx playwright install chromium
npm test             # bddgen && playwright test
```

The camera is a generated video file handed to Chromium with
`--use-file-for-fake-video-capture`, and Open Library and Google Books are
answered by a local stub, so a run needs no hardware and no network. **Do not
add a scenario that depends on either.**

It writes to `web/data/e2e/<run id>`, derived by the AppHost from
`BOOKSCAN_E2E_RUN`. That is not a back door for setting the data directory: the
value is sanitised to a single path segment and joined under `web/data`, and
`BOOKSCAN_DATA` is still set in exactly one place, by the AppHost, and nowhere
else.

The suite runs `aspire stop` without `--all`, so it stops only this checkout's
AppHost. Unrelated Aspire apps are usually running on this machine.

It does not gate pull requests: it needs the Aspire CLI, a browser and two npm
trees, which do not belong on the fast path. It runs nightly and on demand with
`gh workflow run e2e.yml`.

**A scenario that has never been seen to fail is not a regression test.** When
you fix a defect an e2e scenario covers, revert your fix, watch the scenario
fail, then restore it. A test that only ever passed alongside a fix proves
nothing about whether it would catch the fix being lost.

Both checks must pass before a pull request is ready. Verified 2026-08-03:
`npm run typecheck` is clean and `npm test` reports **338 tests passing across
18 files** in about 26 seconds. If the count drops, you removed a test.

## Layout

| Path | What lives there |
| --- | --- |
| `web/src/` | React UI |
| `web/src/lib/api.ts` | Typed fetch wrapper, the only client to server path |
| `web/server/index.ts` | Express routes, data directory resolution |
| `web/server/identify.ts` | Barcode decoding then OCR of the printed ISBN |
| `web/server/paddle.ts` | PaddleOCR, the primary OCR engine |
| `web/server/lookup.ts` | Open Library primary, Google Books top-up |
| `web/server/store.ts` | All SQL |
| `web/server/shelves.ts` | Shelf capacity and derived locations |
| `web/shared/` | Domain rules shared by client and server |
| `web/instrumentation.ts` | OpenTelemetry setup, preloaded with `--import` |
| `e2e/` | Gherkin features and the browser suite that runs them |
| `docs/shelving.md` | The shelving specification |

## Conventions

- `docs/shelving.md` is the authority on filing and placement rules. If code
  and that document disagree, the document wins, unless the owner has said
  otherwise in an issue. Do not silently change behaviour that it specifies.
- Client and server never share a database connection. The client talks to the
  server only through `web/src/lib/api.ts`.
- Tests run against real dependencies where it is affordable: real SQLite in
  memory, real barcode decoding, real OCR against generated images. Prefer that
  over mocks.
- `web/server/lookup.ts` and `web/server/covers.ts` read their catalogue origins
  from `BOOKSCAN_OPENLIBRARY_URL`, `BOOKSCAN_GOOGLE_BOOKS_URL` and
  `BOOKSCAN_COVERS_URL`. These are unset in normal use, and exist so a test run
  can take the lookups off the network. **Do not set them in a shell**, for the
  same reason as `BOOKSCAN_DATA`: they redirect what the real app talks to.
- **Every capability claim in this file names the command that demonstrates it,
  and that command gets run before the sentence is written.** This file has
  four times asserted something the code did not do (tests could reach the
  catalogue, two checkouts could not both start, traces arrive, a feature was
  unimplemented when it had shipped). Each read plausibly and was false. A claim
  nobody has executed is a guess with formatting, and an invariant that is not
  true is worse than an absent one, because the next person builds on it.
- Do not use em dashes in code comments, commit messages, or documentation.

## History

This repository previously held a Python and Tkinter desktop implementation of
the same product. It was retired in `e8b6808` and is preserved in history at
`6f1ff08`. Do not reintroduce it, and do not try to keep it in sync.

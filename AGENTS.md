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

The catalogue is a live record of someone's actual book collection, and it is
added to most days. Re-scanning it means physically handling every book again,
one at a time, in front of a camera. Treat it as irreplaceable, because it is.

No count is given here on purpose. It grows, and a stale number invites the
thought that this is a small toy database rather than somebody's afternoons.

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
  `process.env.BOOKSCAN_DATA ?? 'data'` (`web/server/index.ts`). With no env
  var set, it uses `web/data/` inside your checkout, never the live path.
- **Do not set `BOOKSCAN_DATA`.** It is the only thing standing between a dev
  server and the real catalogue. Under Aspire you do not need to: the AppHost
  sets it explicitly to this checkout's own directory, which overrides anything
  inherited from your shell.
- **Since stage G there is a second variable of the same kind**, and it is the
  one that now points at the rows: `ConnectionStrings__bookscan`. The app
  defaults to Postgres and reads its connection from that name and no other,
  and the AppHost sets it explicitly to the container it just started, so an
  inherited value cannot win under `aspire start`. **Do not set it in a shell.**
  Everything AGENTS.md says about `BOOKSCAN_DATA` applies to it word for word,
  and it is worth more: it names a whole catalogue rather than a directory.
- **The covers are still files, so `BOOKSCAN_DATA` did not stop mattering.**
  The database holds bare filenames joined against the data directory at read
  time. Both variables are live at once until the cover storage work lands.
- No test reads or writes the catalogue, and since stage F of the Postgres
  migration that sentence needs two halves rather than one. Most server tests
  still open an in-memory SQLite database (`:memory:`), which cannot reach a
  file at all. The five that also run against Postgres create a scratch
  database per test file on a throwaway container and drop it afterwards, and
  the harness reads **only** `BOOKSCAN_TEST_DATABASE_URL` to find a server:
  never `DATABASE_URL`, never `ConnectionStrings__*`. That is the same rule as
  `BOOKSCAN_DATA` and it exists for the same reason, so **do not set
  `BOOKSCAN_TEST_DATABASE_URL` in a shell** either, except at a scratch server
  you are content to have databases created on and dropped from. Every test
  generates its own barcode and cover fixtures.
- The end to end suite opens a real database rather than an in-memory one, and
  has since it existed. It reaches it the same way it reaches the URLs: by
  reading the api resource's own environment out of `aspire describe`, so it
  can only ever open the database the AppHost just provisioned. It never reads
  `BOOKSCAN_DATA` or a connection string from a shell.
- **The stage H migration tool is the one thing here that can write to a
  catalogue, and it will not take its target from the environment either.**
  `web/server/migrate-sqlite-to-pg.ts` names the Postgres it writes on its own
  command line, with `--target`, or reads `BOOKSCAN_MIGRATE_TARGET`. It does not
  read `ConnectionStrings__bookscan`, so the connection the app is running on
  cannot become the thing a migration overwrites by being in scope. Its source
  is opened read-only, through `openReadOnlyDatabase`, and it refuses a source
  with a `-wal` file beside it. Verified by running it: `--apply` against a
  scratch Postgres moved 197 books and left the snapshot byte for byte as it
  was. See `docs/stage-h-runbook.md`.
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

## The second rule: `stable` is not yours to touch

**Ask the owner every single time, and wait for the answer.**

`stable` is not a release branch in the ordinary sense. It is the running
system somebody is holding a book up to right now. The branch, the checkout at
`C:\Users\Blake\source\repos\book-scan-stable`, and the server process serving
it are one thing, and all three are covered:

- do not merge, push, fast-forward or rebase `stable`
- do not stop, start or restart the server serving it
- do not run anything against the catalogue it has open

There is no standing permission. Permission given for one rollout covers that
rollout and nothing after it. "They said yes last time" is how somebody's
scanning session gets killed halfway through a shelf, and the person who
authorised the previous one is not expecting the next.

This rule exists because it was broken: master was verified, `stable` was
fast-forwarded and the server restarted, all without asking, on the strength of
a permission granted for an earlier update.

When an update is ready, say so and say what is in it, then stop. Landing it on
`master` is the finished job. Shipping it is the owner's call and the owner's
timing.

### What `stable` actually runs, and why the command changed

**The live catalogue is still a SQLite file.** Stage G flipped the project's
default to Postgres, and stage H, which moves the real data, has not happened.
Until it does, `stable` runs SQLite against
`C:\Users\Blake\book-scan-production-data\live\`.

So the launch needs **two** environment variables now, not one:

```
BOOKSCAN_DB=sqlite
BOOKSCAN_DATA=C:\Users\Blake\book-scan-production-data\live
```

Started with `BOOKSCAN_DATA` alone, the server **refuses to start** and names
the missing variable. That is deliberate and it is the good outcome: on this
revision the default is Postgres, so a deployment with no connection string
would otherwise come up on an empty database sitting beside a full `books.db`,
which reads exactly like a catalogue that has lost every book.

Launch it **detached**, not as a child of an agent session. It has died three
times because the process was owned by a session that later let go of it:

```
powershell -NoProfile -Command "$env:BOOKSCAN_DB='sqlite'; $env:BOOKSCAN_DATA='C:\Users\Blake\book-scan-production-data\live'; Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory 'C:\Users\Blake\source\repos\book-scan-stable\web' -WindowStyle Hidden"
```

Nothing watches it. If the phone stops loading, check
`curl http://127.0.0.1:3001/api/health`, which reports the database it opened.

### Backups are verified by opening them, not by checksum

Before anything touches the live catalogue, copy the whole `live\` directory,
including `books.db-wal` and `books.db-shm`, and then **open the copy** and
check `integrity_check` and the row counts. A checksum proves two files match;
it does not prove either one opens. `docs/postgres-migration.md` records a
`cp books.db` that silently lost five hours of work because the WAL was newer
than the `.db`.

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

**Postgres is the default database as of stage G.** `BOOKSCAN_DB` picks one and
defaults to `postgres`; `BOOKSCAN_DB=sqlite` opens `<BOOKSCAN_DATA>/books.db`
and behaves exactly as this app always has. SQLite is not deprecated and not
second class until stage I says so: **the owner's catalogue is still a SQLite
file**, and that variable is the whole of the way back.

Under `aspire start` there is nothing to set. The AppHost provisions Postgres
and hands the api its connection. Running the api on its own with neither
`BOOKSCAN_DB` nor a connection string is the one combination that refuses to
start, on purpose: coming up on an empty Postgres beside a `books.db` full of
scanned books would look exactly like a catalogue that lost every one of them.

**`npm test` empties `web/data/`.** `server/index.test.ts` ends with
`rmSync(dataRoot, { recursive: true, force: true })`, and `dataRoot` is the whole
directory rather than the temporary one it made inside it. So a scratch
catalogue, a downloaded cover, or anything else parked there does not survive a
test run. Found by losing 1.1 GB of copied cover files to one `npm test` during
the stage H rehearsal. Do not stage anything there you would mind re-copying.

**`npm test` needs Docker.** That is new as of stage F of the Postgres
migration and it is a real regression in what it takes to contribute, accepted
by the owner rather than stumbled into: a suite that does not exercise the
database being shipped is how a collation difference passes everything and
surfaces on somebody's shelf. `web/vitest.config.ts` runs two projects.

- `sqlite` is the suite as it always was: every test file, no services.
- `postgres` re-runs the files that open a database, against a real Postgres,
  plus `server/db.pg.test.ts`.

**If you add a test file that opens a database, add it to `BOTH_DRIVERS` in
`web/vitest.config.ts`.** One that is not on that list guards SQLite only, and
looks entirely green while doing it.

The container is started by `@testcontainers/postgresql`. If you already have a
Postgres you are willing to have scratch databases created on and dropped from,
`BOOKSCAN_TEST_DATABASE_URL` points the harness at it and no container starts;
that is how CI does it. Measured on this machine with `cd web && npm test`:
about 40 seconds before, about 47 after, with the image already pulled.
`npx vitest run --project sqlite` runs the half that needs nothing.

### The Postgres version is written in one file

**`postgres-version.json`, at the repository root.** It says `postgres` and
`18`, and everything that starts a Postgres reads it:

- `apphost.mts` passes the tag to `withImageTag`, so `aspire start` and the
  browser suite run it.
- `web/server/pgcontainer.ts` builds the test container's image from it, so
  `npm test` runs it.
- `scripts/check-postgres-version.mjs` fails CI when
  `.github/workflows/ci.yml` disagrees. That workflow has to keep a literal:
  `services.<id>.image` is evaluated before any step runs and the `env` context
  is not available to it, so it cannot read a file. The check also fails if
  either reader above stops reading the file.

This exists because the version was written twice and drifted two major
versions (#162): the suite pinned `postgres:17` while the AppHost pinned
nothing and took Aspire's default, `postgres:18.3`, so from stage G the browser
suite proved one major version and the unit suite proved another. Verified
after the change, on this machine: `docker ps` shows `postgres:18` for the
AppHost's container, its log says `starting PostgreSQL 18.4`, and the test
container reports the same.

**Changing it is a decision, not a refresh.** 18 is what the managed targets in
#140 actually offer today, checked rather than assumed: PostgreSQL 18 is GA on
Amazon RDS (since 14 Nov 2025), on Aurora PostgreSQL (since 11 Jun 2026,
starting at 18.3) and on Azure Database for PostgreSQL flexible server, and new
servers on RDS and Azure are created at 18.4, which is what `postgres:18`
resolves to. The tag is the major only, deliberately: a managed service applies
its own minor updates without asking, so pinning a minor would be proving a
version nobody runs.

**Going the other way would have been worse than doing nothing**, and this is
the part that is not obvious. The `postgres:18` image moved `PGDATA` from
`/var/lib/postgresql/data` to `/var/lib/postgresql/18/docker`. Aspire mounts the
data volume at the parent, `/var/lib/postgresql`, so both majors persist. But
every existing checkout's volume was initialised by 18.3, and a 17 server
pointed at one **starts cleanly and shows an empty catalogue**, because it
initdb's a second cluster beside the first. Confirmed by doing it: a table
written under 18 came back `relation "keep" does not exist` under 17, with the
rows still on the volume.

**`aspire update` or a template refresh can undo the pin.** Aspire's default
tag is what the AppHost silently ran before, so a lost `withImageTag` looks like
nothing at all until the suites disagree again. `docker ps` after
`aspire start` is what says which image is really running. `withImageTag` is
available on `addPostgres`, whatever an earlier comment in `apphost.mts` said:
`aspire docs api search withImageTag` finds it, and
`aspire docs api list typescript/aspire.hosting.postgresql/postgresserverresource`
does not, because that listing shows the Postgres-specific members and not the
container ones the resource also carries. Search, do not list, before
concluding a builder method does not exist.

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

The Postgres image tag it starts is pinned from `postgres-version.json`, not
left to Aspire's default. See "The Postgres version is written in one file"
above, and check after an `aspire update` that the pin is still there.

### Hunting passes

After a batch of merges, it is worth having an agent **use** the app rather
than test it: follow whole journeys, get things wrong, change its mind, and
report what breaks. `npm run seed -- --reset` builds a throwaway world to do it
in, and `docs/process/agent-hunting-pass.md` is the brief.

**This is not a gate**, because a pass is not repeatable. Its value is finding
what scripted tests cannot, and **its output should become scripted tests.**
Two passes have found nine real defects between them, including an API process
that died on any OCR pass. The end to end suite never saw that one, because its
stub resolves every barcode, so OCR never ran.

That is the general lesson and it applies to every suite here: **a passing test
proves only what it exercises.**

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

It writes to `web/data/e2e/<run id>` **and to a Postgres database called
`bookscan_<run id>`**, both derived by the AppHost from `BOOKSCAN_E2E_RUN`.
Neither is a back door: the value is sanitised to one path segment, the
directory is joined under `web/data`, and `BOOKSCAN_DATA` and the connection
are still set in exactly one place, by the AppHost, and nowhere else.

Two things, because a directory per run stopped being enough at stage G. The
Postgres container has a **persistent data volume**, named per checkout, so a
scratch catalogue survives a restart the way `web/data/books.db` used to. That
means a run that isolated only its directory would share the developer's rows,
so the rows get a database of their own too. Old run databases are dropped at
the start of the next run, the same way old run directories are.

**Two checkouts can still run the suite at the same time**, because the volume,
the container and therefore the databases are all per checkout. Two runs in
*one* checkout cannot, and never could: there is one AppHost per checkout.

For a clean slate, stop the AppHost and `docker volume rm` the volume whose
name it printed on start.

The suite runs `aspire stop` without `--all`, so it stops only this checkout's
AppHost. Unrelated Aspire apps are usually running on this machine.

It gates pull requests, as the `browser journeys` check in the `End to end`
workflow, and still runs nightly and on demand with `gh workflow run e2e.yml`.

It used to be nightly only, on the reasoning that the Aspire CLI, a browser and
two npm trees do not belong on the fast path. #99 then merged on a green fast
CI while breaking browser scenarios, and nobody found out until the next
morning. The alternative to gating turned out to be a human running the suite by
hand before shipping, which is worse than the minutes it costs.

**Do not add a `paths` filter to that workflow, and do not put an `if:` on the
job.** `scripts/merge-pr.mjs` treats a required check that never ran as a
refusal, and a job skipped by `if:` reports SKIPPED, which it also refuses.
Either would make every documentation-only pull request unmergeable rather than
faster.

The job instead always runs, always reports as `browser journeys`, and asks
`scripts/ci-scope.mjs` whether the steps **inside** it are worth doing. On a
change that touches only markdown and `docs/` it starts, finds nothing to
prove, and goes green in seconds. `ci.yml` does the same. That is the only
sanctioned shape here: skip work, never skip a check name.

**A scenario that has never been seen to fail is not a regression test.** When
you fix a defect an e2e scenario covers, revert your fix, watch the scenario
fail, then restore it. A test that only ever passed alongside a fix proves
nothing about whether it would catch the fix being lost.

Two checks must be green before a pull request is ready: `web (typecheck +
tests)` and `browser journeys`. They are the names `scripts/merge-pr.mjs`
requires. `npm run typecheck` and `npm test` take well under a minute between
them, so there is no excuse for not having run them before pushing.

The scan-data check that used to be a third name, `no production data
committed`, is now the first step of `web (typecheck + tests)` and also runs
after every merge in `provenance.yml`. It was a five second job, and GitHub
bills a job rounded up to a whole minute, so as its own job it cost as much as
the suite it sat beside. It is unconditional in both places: it never depends on
what a change touched, because any change at all can commit a database.

CI is billed by the job-minute on a private repository, so if you add a job,
know what whole minute you are spending. `ci.yml` no longer runs on a push to
master: the pull request run already proved that tree, and `provenance.yml`
still runs on every merge.

**No CI run at all is a different problem from a failing one.** GitHub runs
pull request checks against a merge commit it computes from your branch and the
base. When the branch conflicts, that commit cannot be built, so no run is ever
created and the pull request simply sits there with nothing to look at. It
looks exactly like Actions being broken.

Check `gh pr view <n> --json mergeable` before concluding anything about CI. If
it says `CONFLICTING`, rebase on `master` and the run appears. Several changes
are usually in flight here at once, so a branch that was clean when you opened
it may not be twenty minutes later.

**Note the test count before you change anything, and compare it at the end.**
If it went down you removed a test, and that has to be deliberate and said out
loud in the pull request. A number is deliberately not written here: it moves
on almost every merge, so it would be wrong within the hour and would only
teach people to skim past it.

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

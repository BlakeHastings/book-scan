# AGENTS.md

Instructions for coding agents working in this repository. Read this before
touching anything.

## What this is

A phone-first web app for cataloguing a physical book collection. You hold a
book up to a phone camera, it decodes the barcode or reads the printed ISBN,
confirms the record against Open Library, and tells you which two shelved books
the new one belongs between.

All the code lives under `web/`. It is a TypeScript project: React 18 and Vite
on the client, Express and Postgres (node-postgres) on the server.

## The one rule that matters most

**There is real production data, and it is not in this repository.**

The catalogue is a live record of someone's actual book collection, and it is
added to most days. Re-scanning it means physically handling every book again,
one at a time, in front of a camera. Treat it as irreplaceable, because it is.

No count is given here on purpose. It grows, and a stale number invites the
thought that this is a small toy database rather than somebody's afternoons.

**Since 2026-08-06 it is in two places, not one.** Stage H moved the catalogue
to Postgres. Every row below is irreplaceable and every row is out of bounds:

| What | Where |
| --- | --- |
| The catalogue | A Postgres database in the container `book-scan-live-pg`, on the named volume `book-scan-live-pgdata`, at `127.0.0.1:5433/bookscan` |
| The photographs | Files, still, at `C:\Users\Blake\book-scan-production-data\live\covers\` |
| The old SQLite file | `C:\Users\Blake\book-scan-production-data\live\books.db`, untouched, kept until at least 2026-09-06 |
| Backups | `E:\book-scan-backups`, nightly, on a different physical disk. The photographs are mirrored beside them at `E:\book-scan-covers` |

Agents must never read from, write to, point a dev server at, run a migration
against, or delete anything in that directory or any sibling under
`book-scan-production-data\`. **The same goes for the database.** Do not connect
to `127.0.0.1:5433`, do not `docker exec` into `book-scan-live-pg`, and do not
`docker stop`, `docker rm` or `docker volume rm` it. A read-only connection is
still a connection to somebody's whole collection, and "it was only a SELECT" is
not a thing to find out you were wrong about.

The backup job is the one thing that reads it on a schedule, it is registered by
the owner rather than by an agent, and it never connects to that database from
an agent session. See `docs/backup-runbook.md`.

**The SQLite file is not a spare copy you may practise on.** Stage I removed
the driver that could open it, so nothing in this repository reads it and
nothing here should learn how. It stays on that disk until at least 2026-09-06.
Treat it as read-only history: not yours to touch, to name in code, or to tidy
up.

You do not need any of it. Everything you need to develop and test is generated
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
- **There is a second variable of the same kind**, and it is the one that
  points at the rows: `ConnectionStrings__bookscan`. The app reads its
  connection from that name and no other, and the AppHost sets it explicitly to
  the container it just started, so an inherited value cannot win under
  `aspire start`. **Do not set it in a shell.** Everything AGENTS.md says about
  `BOOKSCAN_DATA` applies to it word for word, and it is worth more: it names a
  whole catalogue rather than a directory.
- **The covers are still files, so `BOOKSCAN_DATA` did not stop mattering.**
  The database holds bare filenames joined against the data directory at read
  time. Both variables are live at once until the cover storage work lands.
- No test reads or writes the catalogue. Every test file that opens a database
  creates a scratch one of its own on a throwaway container and drops it
  afterwards, and the harness reads **only** `BOOKSCAN_TEST_DATABASE_URL` to
  find a server: never `DATABASE_URL`, never `ConnectionStrings__*`. That is
  the same rule as `BOOKSCAN_DATA` and it exists for the same reason, so **do
  not set `BOOKSCAN_TEST_DATABASE_URL` in a shell** either, except at a scratch
  server you are content to have databases created on and dropped from. Every
  test generates its own barcode and cover fixtures.

  Until stage I most server tests opened an in-memory SQLite database, which
  could not reach a file at all. That was a real part of the safety story and
  it is gone: the protection now is the variable the harness refuses to read,
  not the driver's inability to open a path.
- The end to end suite opens a real database rather than an in-memory one, and
  has since it existed. It reaches it the same way it reaches the URLs: by
  reading the api resource's own environment out of `aspire describe`, so it
  can only ever open the database the AppHost just provisioned. It never reads
  `BOOKSCAN_DATA` or a connection string from a shell.
- **The tools that write to a catalogue will not take their target from the
  environment.** `web/scripts/seed-world.ts` names the Postgres it writes on
  its own command line, with `--target`, or reads `BOOKSCAN_SEED_TARGET`, and
  refuses a target on port 5433 outright. Neither it nor
  `server/backup-catalogue.ts` reads `ConnectionStrings__bookscan`, so the
  connection the app is running on cannot become the thing a script overwrites
  by being in scope.

  The stage H migration tool was the third of these and was deleted by stage I
  along with the driver it read. `docs/stage-h-runbook.md` records what it did
  and what its verification proved; the tool itself is in history, at the
  commit before stage I, together with the SQLite driver it needs.
- `web/.gitignore` excludes `data/`, so a database or cover photo cannot be
  committed. CI re-checks this on the result, because an ignore rule is silent
  when someone forces past it.
- The OCR tests download and cache language data, but that cache is resolved
  independently of `BOOKSCAN_DATA` (`web/server/identify.ts:392`, cached under
  the user's home directory, not the data directory), so it cannot land
  anywhere near the catalogue either.

If you add a test that needs a database, take one from `web/server/testdb.ts`
like the existing ones do (see `web/server/store.test.ts`). Never write a test
that touches a path outside the repository.

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

**The catalogue is Postgres.** It is the database in `book-scan-live-pg` on
`127.0.0.1:5433`. The SQLite file is still on disk at
`C:\Users\Blake\book-scan-production-data\live\`, untouched. Nothing in this
repository can open it any more: stage I deleted the driver.

**Two variables were needed to launch `stable` on SQLite, and one of them no
longer exists.** `BOOKSCAN_DB` is gone, so a launch line carrying it is a
launch line for a revision that is not this one. What the server needs now is
the connection, `ConnectionStrings__bookscan`, and `BOOKSCAN_DATA` for the
cover photographs, which are still files.

**No launch line is written here, because none has been run since the move.**
This file has four times asserted something the code did not do, and a command
nobody has executed is a guess with formatting. What settles it is one command
against the running server, which reports the database it opened:

```
curl http://127.0.0.1:3001/api/health
```

Started with no connection string, the server **refuses to start** and names
the variable. That is deliberate and it is the good outcome: a process that
exits saying which variable is empty is recoverable in one command, where one
that comes up on an empty database is not obviously anything.

Whatever launches it, launch it **detached**, not as a child of an agent
session. It has died three times because the process was owned by a session
that later let go of it. Nothing watches it either: if the phone stops loading,
check `curl http://127.0.0.1:3001/api/health`.

**The way back is no longer a variable.** Through stages G and H it was
`BOOKSCAN_DB=sqlite`, one flag against a file that had lost nothing. It is now
a `git checkout` of a commit before stage I, which brings back the driver, the
migration tool and the switch together. See `docs/stage-h-runbook.md`.

### Backups are verified by restoring them, not by checking they exist

**The catalogue is Postgres now.** It is a database in the container
`book-scan-live-pg`, on a named volume, bound to `127.0.0.1:5433`. Everything
this file used to say about backups was about a SQLite file, and those rules,
which were hard won, now protect the wrong thing.

`docs/backup-runbook.md` is the authority. The short version:

- A daily `pg_dump`, run by Windows Task Scheduler, with retention bounded twice
  over: at most 14 dumps and at most 512 MiB of them, whichever bites first. A
  run refuses to start with less than 1 GiB free.
- **Every run restores the dump into a scratch database and compares it**, then
  drops it. A dump nobody has restored is a hypothesis, and the tool exits
  non-zero and says so when no scratch server was given.
- The comparison is row counts, a content digest per table, **and the shelf
  order hash**, `md5(string_agg(id::text, ',' order by sort_key, id))`. The last
  one is the point: a count does not move when a collation does, and a collation
  difference does not lose a book, it reorders them.
- **Which tables it compares comes from the catalogue, not from a list**, so
  adding a table covers it and there is nothing here to keep in step. That is
  the fix for a hand-maintained six names that the schema outgrew by thirteen
  without anybody noticing. The views and `drizzle.__drizzle_migrations` are
  kept out; see `docs/backup-runbook.md`.
- **The cover photographs are not in the dump.** `pg_dump` moves rows, not
  files. They are over a gigabyte and half of what is irreplaceable, so the
  scheduled task mirrors them separately, and the tool says so on every run.
- **The dumps and the photographs are on a different physical disk from the
  volume.** `C:` is disk 2 and `E:` is disk 1, which is a fact about this
  machine rather than about the drive letters, and `Get-Partition` is what says
  so. A dropped table, a bad migration, a `docker volume rm` and losing the `C:`
  disk are therefore all covered. **Losing the machine is not**, because both
  disks are inside it. That is the one remaining gap and it is deliberate rather
  than unnoticed.

`server/backup-catalogue.ts` does not read `ConnectionStrings__bookscan`, and it
does not read anything else in the environment unless it was asked to by name.
Its source comes from `--source`, or from `BOOKSCAN_BACKUP_SOURCE` when
`--source-from-env` says so, and from nothing else. That is the same refusal
`scripts/seed-world.ts` makes about its target, and the same one the stage H
migration tool made before it was deleted.

**That is a rule with a scar on it.** The variable used to be read whenever
`--source` was absent, and `scripts/install-backup-task.ps1` used to set it at
a persisted scope so a scheduled task could carry a password out of its command
line. A persisted variable is not a task's environment, it is every process that
inherits it, so a connection string naming the live catalogue sat in every shell and
every agent session here, and `npx tsx server/backup-catalogue.ts` with no
arguments opened the live catalogue. The connections now live in a
DPAPI-encrypted file the task is given the path to. See #215 and
`docs/backup-runbook.md`. **If you find either variable set in your shell, do
not use it and do not treat it as configuration.** Nothing in this repository
reads it without being told to, and the answer is to remove it, not to lean on
it.

**The SQLite rules below still apply to the SQLite file**, which is still
exactly where stage H left it. Nothing in this repository opens it, and nothing
here should be taught to. If anything ever does touch it, copy the whole
`live\` directory first, including `books.db-wal` and `books.db-shm`, and then
**open the copy** and check `integrity_check` and the row counts. A checksum
proves two files match; it does not prove either one opens.
`docs/postgres-migration.md` records a `cp books.db` that silently lost five
hours of work because the WAL was newer than the `.db`.

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

**Postgres is the only database, as of stage I.** The connection is
`ConnectionStrings__bookscan` and there is no other name and no other database.
`BOOKSCAN_DB`, `SqliteDb` and `better-sqlite3` are all gone.

Under `aspire start` there is nothing to set. The AppHost provisions Postgres
and hands the api its connection. Running the api on its own with no connection
string refuses to start and names the variable, on purpose.

**`npm test` empties `web/data/`.** `server/index.test.ts` ends with
`rmSync(dataRoot, { recursive: true, force: true })`, and `dataRoot` is the whole
directory rather than the temporary one it made inside it. So a scratch
catalogue, a downloaded cover, or anything else parked there does not survive a
test run. Found by losing 1.1 GB of copied cover files to one `npm test` during
the stage H rehearsal. Do not stage anything there you would mind re-copying.

**`npm test` needs Docker, for the whole run.** That started at stage F and it
got worse at stage I. It is a real regression in what it takes to contribute,
accepted by the owner rather than stumbled into: a suite that does not exercise
the database being shipped is how a collation difference passes everything and
surfaces on somebody's shelf.

`web/vitest.config.ts` ran two projects through stages F to H, `sqlite` and
`postgres`, and the five files that opened a database ran under both. That was
the verification argument for the Postgres driver and it has been made. One
driver leaves one project, so **there is no `--project sqlite` half that needs
nothing any more**: a run that touches only `src/lib` still starts a container.

If you add a test file that opens a database, take it from
`web/server/testdb.ts`. There is no list to add it to.

The container is started by `@testcontainers/postgresql`. If you already have a
Postgres you are willing to have scratch databases created on and dropped from,
`BOOKSCAN_TEST_DATABASE_URL` points the harness at it and no container starts;
that is how CI does it. Measured on this machine with `cd web && npm test`:
about 42 seconds before stage I and about 44 after, with the image already
pulled.

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

### Hunting passes

After a batch of merges, it is worth having an agent **use** the app rather
than test it: follow whole journeys, get things wrong, change its mind, and
report what breaks. `npm run seed -- --reset --target '<connection>'` builds a
throwaway world to do it in, against the Postgres the AppHost started, and
`docs/process/agent-hunting-pass.md` is the brief.

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
scratch catalogue survives a restart the way `web/data/books.db` did before
stage G. That
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
| `web/domain/` | Plain TypeScript rules. Imports nothing but `web/shared/` |
| `web/application/` | Commands, handlers, and the repository interfaces (ports) |
| `web/infrastructure/` | Drizzle schema, migrations, repository implementations |
| `web/src/` | React UI |
| `web/src/lib/api.ts` | Typed fetch wrapper, the only client to server path |
| `web/server/index.ts` | Express routes, data directory and connection resolution |
| `web/server/db.pg.ts` | The Postgres driver, and where every column is explained |
| `web/server/driver.ts` | The `Db` seam the stores are written against |
| `web/server/identify.ts` | Barcode decoding then OCR of the printed ISBN |
| `web/server/paddle.ts` | PaddleOCR, the primary OCR engine |
| `web/server/lookup.ts` | Open Library primary, Google Books top-up |
| `web/server/store.ts` | All SQL |
| `web/server/backup.ts` | The backup digest and retention, and the shelf order hash |
| `web/server/backup-catalogue.ts` | The dump, the retention sweep and the verifying restore |
| `scripts/backup-catalogue.ps1` | What the scheduled task runs |
| `docs/backup-runbook.md` | How the catalogue is backed up, and what is not covered |
| `web/domain/tagging/genre.ts` | Which shelf range a book's genre tags file it into |
| `web/server/shelves.ts` | Shelf capacity and derived locations |
| `web/server/placement-ledger.ts` | Where a book is: the `book_placement` rows, and the two fields the wire derives from them |
| `web/infrastructure/shelving/areas.ts` | The areas a range is cut into, and the boundary list they are read back as |
| `web/shared/` | Domain rules shared by client and server |
| `web/instrumentation.ts` | OpenTelemetry setup, preloaded with `--import` |
| `e2e/` | Gherkin features and the browser suite that runs them |
| `docs/shelving.md` | The shelving specification |
| `docs/orchestrating.md` | For whoever is running the backlog: where things stand, what bites, and where to go next |

### The layering, and the tables that go through it

Epic #169 separates the domain from the data store. **Four slices have been
converted**: the shelf boundaries (#172), which is where the pattern was judged
and which were `separators` then and are `area` now, `tag` with `book_tag`
(#179), `author` with `author_alias` and `book_author` (#180), and `capture`
(#181), the last three of which were built that way from the start. Books, the
queue and the rest still go through `Store`, `Shelves` and `CaptureQueue` exactly
as they did. Do not convert another table as a side effect of doing something
else.

**`capture` is not `captures`.** The singular one is a photograph, added by
#181; the plural one was the scanning queue and was dissolved by #183. One
letter apart, and they were never related.

**Photographs have been cut over, and this is the first thing the remodel has
dropped (#228).** `books.front_image` and the nine columns beside it are gone:
`back_image`, `edge_image`, `cover_image`, `front_hash`, `cover_hash`,
`front_crop`, `back_crop`, `edge_crop` and `cropped`. `capture` is the record,
and there is no second answer to what a book has been photographed with.
`cover_checked_at` stayed, because it is a fact about a search rather than about
a photograph.

`web/server/photographs.ts` is the only place a filename becomes a row and the
only place a row becomes the flat one-per-slot shape the wire still speaks in.
Four functions write a photograph and there is no fifth: a shutter
(`photographTaken`), a downloaded cover (`coverDownloaded`), what the detector
made of one (`recordCrop`) and a hash (`recordHashes`). If you find yourself
adding a fifth writer, it goes in that file beside them, for the reason the four
statements that move a book go in `Store`.

**The wire has not moved and that is the follow-up, not an oversight.** A book in
the JSON still carries `front_image`, `front_crop` and `cropped`, derived from
the newest photograph of each kind, and the client, the browser suite and the two
crop backfills read those. That is the shape #223 left `books.is_fiction` in: cut
the decision over, take the field off the wire separately. #232 made the same call
about `location` and `checked_out_at`, which are derived by
`server/placement-ledger.ts` and carry the names the dropped columns had.

**The one field that did leave the wire is `books.shelved_at`**, because nothing
was reading it: three statements wrote it and no query, route, client or scenario
selected it back.

`current_photograph` is the one relation that answers "the newest photograph of
each kind", which is `Photographs.latest` said in SQL. Two statements read it and
both are about the photograph somebody would be shown. **Do not add a second
spelling of that tie-break.**

**#183 landed in two and is done.** The first half added `books.state`, the
`shelved_books` view and the partial index, and moved the ordering queries onto
the view. The second dissolved the queue: **there is no queue table.** A book
exists from its first photograph, so `CaptureQueue` reads and writes `books`,
the queue is `queued_books`, and `identified` has rows in it.

**The `captures` table is still in the schema and nothing reads it.** It sits
there with its rows, each one naming the book it became in `book_id`. Do not add
a reader. If you find yourself writing `FROM captures`, the answer is
`queued_books`.

**Two tables have been dropped, and they are the first two** (#232): `separators`
and `shelf_ranges`. That is not a licence to drop the one above. Dropping a table
takes its indexes, its identity sequence and every row anybody put in it, and
there is no ledger of boundaries to fall back on the way `book_placement` catches
`books.location`, so what made those two safe was that every one of their rows had
already become an `area` or a `placement_rule` and the two were compared row for
row while both were live. `captures` has had no such successor built for it,
because nothing was ever going to read it again.

**Tags and credits are written on every save, unconditionally.** The gate that
used to decide this from the driver in `createApp` is gone: it existed only
because the tag tables arrived in a Postgres migration while SQLite's schema was
hand-written, and stage I removed SQLite.

**Tags and authors are both cut over, and two columns are gone.** `book_tag` is
what decides which shelf range a book files into, since the first half of #223:
`settleGenre` in `server/index.ts` writes the genre **before** the row, and
`rangeOfGenre` in `web/domain/tagging/genre.ts` reads the book's tags back and
answers the range that `Store` then writes. `author_alias.filing_name` is what
the first component of every `sort_key` is built from, since #227:
`Store.filingFor` asks the authorship port what the first-listed name files
under, and falls back to `filingName` only for a name this collection has never
seen, which is the value the alias is about to be given anyway.

**`books.is_fiction` and `books.author_filing` no longer exist.** #227 dropped
them, each in its own migration and its own commit, beside the ten image columns
#228 dropped in the same fortnight. A book's genre is `book_tag`, a book's filing
name is its first credit's alias, and the wire carries a genre **slug** rather
than a boolean.

**`author_filing` is still a column, on the three views.** `shelved_books`,
`catalogued_books` and `queued_books` join the credit at position 1 back on, in
one place, `filed` in `infrastructure/db/schema.ts`, so every listing, shelf row
and neighbour reads what it always read. `books` itself does not have it, and the
types say which is which: `FiledBookRow` is a view row and `BookRow` is the
table's. `GET /api/books/:id` answers the book with its credits beside it.

Three things about that rule are settled and are in `docs/data-model.md` rather
than only here: a person's genre tag outranks a machine's, `genre/fiction` beats
`genre/non-fiction` otherwise (which is the order `0013` writes its rules in),
and a book carrying no genre tag keeps the range it has and does not move.
`applySchema` counts those books on every start and names them.

**`books.sort_key` is still the only thing that decides where a book sits**, and
a save still writes it by `Store`, from the filing name the alias answers. The
credits are written by `recordCredits` from the same draft, immediately after,
and that is also where a filing name somebody typed reaches the alias:
`Store.saveFilingOverride` is gone and its job is `FileAliasHandler`.

**Filing a name does not move a book, and that sentence changed meaning.**
`books.sort_key` is written by a save and by `server/refile-books.ts` and by
nothing else, so correcting an alias leaves every shelf exactly as it was; what
changes at once is what the catalogue *says* the book files under, because that
is read from the alias. The next save of that book puts it where the corrected
name says.

**A save that changes the ISBN is a different thing from a save that edits the
book**, and it is the only one that takes a person's tags off
(`web/application/tagging/reidentify-book.ts`, #194). Correcting the ISBN is
somebody saying the row is a different book, so what was on record about the old
one is withdrawn. That is not the precedence rule being relaxed, and the
precedence rule is not negotiable: automation may never retract a person's
judgement.

**That withdrawal runs before the genre is settled, and the order is now load
bearing rather than tidy.** The old book's genre tag has to be off the row before
the new one is read back, or a corrected book files under what it used to be.

Dependencies point inwards. `domain/` may import `domain/` and `shared/` and
nothing else, not even an npm package; `application/` adds `application/`;
`infrastructure/` and `server/` may import anything below the React client.
`shared/` is the pure domain code the client and the server already share, and
it must keep importing nothing from any layer.

**This is a check, not a convention.** `cd web && npm run lint:layers` runs
`dependency-cruiser` and is a step of the `web (typecheck + tests)` job, so a
domain file that imports from `infrastructure` fails the pull request. It was
made to fail on purpose before it was trusted.

The domain and the application layer compile with `infrastructure/` deleted,
which is the test of whether the separation is real rather than a naming
convention. Demonstrated by doing it, not by reading the imports: move
`web/infrastructure` out of the tree and `cd web && npx tsc --noEmit -p
tsconfig.domain.json` still reports nothing, while a full `npm run typecheck`
reports five errors and every one of them is in `server/`. That comment block at
the top of `web/tsconfig.domain.json` is the exact sequence.

### Three views over `books`, and a query reads one of them

`books` has a `state` since #183 and holds every book at every point in its
life, including the ones nobody has identified. There is one relation per
question anybody asks of it, each with its predicate written once, and the seven
states fall into them without overlapping.

| Relation | Holds | Read by |
| --- | --- | --- |
| `shelved_books` | `shelved` | anything that orders, seeks a neighbour, lays out a plank or decides a boundary |
| `catalogued_books` | `shelved`, `checked_out`, `withdrawn` | the catalogue: listings, counts, duplicate checks, the cover and hash backfills |
| `queued_books` | `scanned`, `unidentified`, `identified` | the whole of `CaptureQueue` |

`discarded` is in none of them, which is what makes it a state rather than a
deleted row.

**Any query that orders books, seeks a neighbour, lays out a plank or decides a
boundary reads `shelved_books`.** `idx_books_shelved` carries the same
predicate so the view is an index seek rather than a scan, and `idx_books_queued`
does the same for the queue. That is deliberate and it is not a style
preference: spelling `WHERE state = 'shelved'` in each query is an arrangement
that works until somebody writes the next one, and forgetting once puts a book
nobody has identified between two real ones on a shelf listing somebody is
standing in front of. A reviewer cannot check for a missing `WHERE` clause in a
query that does not exist yet.

Reading `books` directly is right for a lookup by id and for a write, and for
nothing else. If you are about to `ORDER BY sort_key` over `books`, you want a
view.

**`GET /api/books` does not list a book that has been scanned and not
identified.** It has no title, no author and no shelf range, and it is already
on screen in the queue, which is the one place anybody can act on it. That is
the question #204 left open at `Store.listRange` and #183 answered.

**`checked_out_at` is still what the client reads and it is not a column** (#232).
`books.state` says which books are out, `Store.setCheckedOut` compares and sets it
in one statement, and the moment a book left is the `created_at` of the
`checked_out` row written in the same transaction. `withPlacements` in
`server/placement-ledger.ts` puts the two back together for the wire. Nothing else
moves a book between those two states.

### There are four statements that change where a book is, and there is no fifth

`Store.addBook`'s insert, `Store.updateBook`'s update, `Store.setLocation` and
`Store.setCheckedOut`. Every one of them writes a row to `book_placement` and the
`books.current_area_id` projection, through `server/placement-ledger.ts`, **on its
own transaction handle** (#185).

**If you add a fifth, it goes in `Store` beside those four and it records a
placement.** A route that writes a location without one is the defect #200 found
in `capture`, where the recording lived where the request was handled and the
writing lived somewhere else, so a background write and two CLIs silently skipped
it. `applySchema` folds the ledger back out on every start and says whether
`current_area_id` still agrees, which is how a missing writer is found rather
than discovered a week later.

**`books.location`, `books.shelved_at` and `books.checked_out_at` are gone**
(#232). The ledger is where a book is, `current_area_id` is the projection a shelf
is drawn from, and `withPlacements` derives the two fields the wire still carries.
`shelved_at` is not one of them: three statements wrote it and nothing ever read
it back.

**Two labels the location route used to take are refused**, and both refusals are
the price of there being one record instead of two. A label naming a plank the
furniture does not have has nowhere in the ledger to go, and an empty label, which
used to mean never-placed, is not any of the six placement kinds. No screen sends
either.

### There are three statements that write a boundary, and there is no fourth

`DrizzleSeparatorRepository.add`, `.reanchor` and `.remove`. Each reads the
range's boundaries out of the areas, makes the one change it was asked for and
writes the areas back through `writeBoundaries`
(`web/infrastructure/shelving/areas.ts`), on its own transaction handle, which is
why `Shelves`, `RemoveSeparatorHandler` and the routes above them are covered
without knowing they are. **If you add a fourth, it goes in that class beside the
three that do.**

**`area` is what `separators` became, and `separators` is dropped** (#232), along
with `shelf_ranges`. `area.starts_at` is `separators.starts_at` under a name that
says what it anchors; a boundary's `kind` and `position` are derived from where
the area sits, so there was a `reposition` and there is not one now: a plank's
ordinal is its place in the run and cannot have a gap in it.

**An area a book has been placed in is retired rather than deleted.**
`book_placement.area_id` is `ON DELETE RESTRICT`, so the history pins the
furniture it names. A retired area's `position` goes negative, which takes it off
the fixture's face while leaving every placement that names it exactly where it
is, and every read of the furniture asks for `position >= 0`. That is what closes
the drift #213 could only report.

`areaDisagreements` (`web/infrastructure/shelving/area-drift.ts`) is what says
whether it worked, and it survived losing one of the two things it compared. It
still places every shelved book twice: once as the app draws it, taking the range
off `books.shelf_range` and walking a boundary list derived from the areas, and
once as the rules claim it, by the tags it carries. `applySchema` runs it on every
start. Like the projection check it **reports and does not repair**, because
rebuilding on sight erases the evidence of which writer is missing.

**What it no longer catches is an anchor being moved**, because both of its
readings walk the same areas. `Shelves.review` is what catches that: it compares
where every book is recorded against where the furniture puts it, which is still
two sides, and it is the misfile list somebody acts on.

### Postgres schema changes go through Drizzle

`web/infrastructure/db/schema.ts` describes the Postgres schema, and
`cd web && npm run db:generate` turns a change to it into a migration under
`web/infrastructure/db/migrations`. `applySchema` applies them at startup.

Three things about that are worth knowing before touching it.

- **A database that already has these tables is adopted, not rebuilt.** The
  Postgres container has a persistent volume per checkout, so a database created
  before migrations existed is the normal case rather than the exception. It has
  the baseline recorded as applied without being run. A database that has some
  of the tables, or the tables with different columns, is refused by name rather
  than stamped.
- **`SCHEMA` in `web/server/db.pg.ts` is not run by the app and must not be
  edited to describe a change.** It is still executed, by
  `web/infrastructure/db/migrate.test.ts`, which builds one database from it
  and one from the migrations and diffs the catalogue. That is the only thing
  making the baseline a proved transcription rather than a claim, so a schema
  change goes in the Drizzle schema and gets a migration. **Its comments are
  the other half of its job**: since stage I deleted `db.ts`, that constant is
  where each column is explained. Comments do not reach the catalogue, so
  adding one cannot move the fixed point.
- **SQLite is gone.** Stage I removed the driver, its hand-written schema and
  the two functions that brought the one legacy catalogue file forward.

There is no `dbCredentials` block in `drizzle.config.ts`, so `drizzle-kit push`,
`pull` and `studio` are not configured. `generate` needs no database at all, and
the others are three more ways to have a connection string in scope pointed at a
catalogue. Do not add one.

## Conventions

- `docs/shelving.md` is the authority on filing and placement rules. If code
  and that document disagree, the document wins, unless the owner has said
  otherwise in an issue. Do not silently change behaviour that it specifies.
- Client and server never share a database connection. The client talks to the
  server only through `web/src/lib/api.ts`.
- **Every promise the server starts and does not await goes through
  `inTheBackground`, and names what it is.** There is no
  `process.on('unhandledRejection')` under `web/` and none should be added: a
  net that logs and carries on turns every future ownerless rejection into a
  line nobody reads, including the ones that should be loud. `inTheBackground`
  is the one place background work is owned, so a rejection is reported against
  the work it belongs to instead of ending the process. Twice now this
  repository's crashes have come from work nobody was waiting for: an API
  process that died on any OCR pass, and #203, where a database blip in the
  seconds after a save killed the API in front of somebody holding a book. A
  bare `void somePromise()` in `server/` is that defect being reintroduced.
- Tests run against real dependencies where it is affordable: a real Postgres
  in a container, real barcode decoding, real OCR against generated images.
  Prefer that over mocks.
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

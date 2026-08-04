# SQLite to Postgres: a staged migration plan

Status: planned, not started. Decisions below were settled by the owner on
2026-08-03 and should not be relitigated without a reason.

- **Why**: the app needs to be hostable with multiple users, which SQLite does
  not serve. Postgres in a container locally via the Aspire AppHost, managed
  Postgres in production, most likely AWS or Azure. See issue #6.
- **Test story**: a Postgres container per test run. Accepted cost: `npm test`
  gains a Docker dependency it does not have today, and goes from about 26
  seconds to 35 to 45 cold. Chosen over keeping SQLite for unit tests, because
  tests that do not exercise the database being shipped would let a collation
  or dialect difference pass everything and surface in production.
- **Cover images**: out of scope here. The images stay on the filesystem and
  the storage abstraction for S3 or Azure Blob is separate work, done after.
  Keeping the change that touches irreplaceable data as small as possible.

Written 2026-08-03 against `master` at `ad85b63`. Read-only exploration; nothing
in the repository or in `book-scan-production-data\` was read, written or run.

Closes out the decision recorded in issue #6: Postgres in a container locally
via the Aspire AppHost, managed Postgres in production.

---

## 0. What this migration achieves, and what it does not

Say this out loud before anything else, because the motivation and the outcome
are not the same thing.

**It achieves:**

- A database that accepts concurrent connections from more than one process,
  and from a machine that is not the one holding the file. That is the
  precondition for hosting.
- A store a managed service can operate: backups, point-in-time recovery and
  failover become somebody else's product rather than a `cp books.db` that issue
  #6 already caught silently losing five hours of a session because the WAL was
  newer than the `.db`.
- One less footgun in the backup path.

**It does not achieve:**

- Users. This repository has no concept of a user, an account, a session, an
  owner column, or authentication. `web/server/index.ts` binds `127.0.0.1` and
  every route is anonymous and unauthorised.
- Multi-tenancy. After this migration one person's catalogue is still every
  person's catalogue, because there is exactly one catalogue and nothing says
  whose it is.
- Hosting. Nothing here deploys anything.

Multi-user is a later, larger piece of work whose first step is a `users` table,
an owner column on `books`, `captures`, `separators` and `author_filing`, an
authentication story, and a decision about whether shelves are per-user or
shared. **None of that is in this plan.** Postgres is necessary for it and
nowhere near sufficient, and the migration must not be written up as though the
feature landed.

---

## 1. The shape of the problem, measured

Numbers checked against the tree rather than recalled:

| Thing | Count | Where |
| --- | --- | --- |
| SQL call sites in `store.ts` | 28 | `web/server/store.ts` |
| SQL call sites in `queue.ts` | 16 | `web/server/queue.ts` |
| SQL call sites in `shelves.ts` | 11 | `web/server/shelves.ts` |
| SQL call sites in `index.ts` | 4 | `deleteOrphanedImages`, plus `openDatabase` |
| Schema and migrations | 17 | `web/server/db.ts` |
| Test files that open a database | **4 of 16** | store, shelves, queue, rehash |
| Tests that touch a database | **~71 of 302** | the same four files |
| Server modules with no database access at all | 6 of 9 | `identify`, `paddle`, `lookup`, `covers`, `imagehash`, `classify` |

The last two rows are the good news and they shape everything below. Two thirds
of the test suite and two thirds of the server never see a database. The blast
radius is `db.ts`, `store.ts`, `shelves.ts`, `queue.ts`, the route layer in
`index.ts`, four test files, `rehash-covers.ts`, and `e2e/support/database.ts`.

---

## 2. The seam: an async interface, SQLite behind it, driver swapped last

The mistake available here is to write a `pg` implementation of `Store` and swap
it in one commit. That commit changes the driver, the dialect, the concurrency
semantics, the call-site shapes and the test harness simultaneously, and when
the shelving order comes out wrong there is no way to tell which of the five did
it.

The plan instead does each of those separately, and does the ones with no
behaviour risk first:

1. Make every store method async, still on synchronous SQLite. Behaviour
   identical by construction.
2. Make the SQL dialect-neutral, still on SQLite. Each change verified by the
   existing tests before Postgres exists.
3. Put a driver interface behind the stores, still on SQLite.
4. Add a Postgres implementation and run the same tests against it. Both exist;
   SQLite is still the default.
5. Flip the default. SQLite still reachable behind a flag.
6. Migrate the real data. The owner runs this.
7. Delete SQLite.

Steps 1 to 3 cannot break anything a test does not immediately catch, and they
are where most of the diff lives. Step 4 is where the risk is, and by then it is
the only variable.

---

## 3. The stages

Each stage is one pull request, leaves `master` working, and is verified by
`npm run typecheck` plus `npm test` reporting **302 passing across 16 files**
unless the stage says otherwise.

### Stage A. Make async route handlers safe (tiny, no database change)

`web/server/index.ts:778` already carries the comment: *"Express 4 does not
catch a rejected async handler, and an uncaught one takes the process down."*
Today that hazard is contained, because only four handlers are async and each
one has its own try/catch. Stage C makes **every** handler async. Without a
wrapper first, one forgotten `await` becomes an unhandled rejection that kills
the API process, and that failure mode will not be found by a unit test.

- Add an `asyncRoute` wrapper (or `express-async-errors`, or upgrade to Express
  5, which handles this natively; the wrapper is the boring option) plus a
  four-line error middleware that returns `500 {error}`.
- Apply it to the four existing async handlers and delete their try/catch
  blocks, so the wrapper is exercised by tests that already exist.

Verify: existing tests green. Optionally add one route test that throws and
asserts a 500 rather than a crash. This also chips at issue #2.

**Diff: roughly 60 lines. Reviewable in five minutes.**

### Stage B. Move the last SQL out of `index.ts`

`deleteOrphanedImages` (`index.ts:191-212`) prepares two statements directly
against `db`, and it is the only SQL outside the three store classes. It also
uses `?1` repeated-parameter syntax, which `pg` does not have.

- Add `Store.imageInUse(name)` covering both the books and captures checks, and
  have `deleteOrphanedImages` call it.
- `index.ts` stops importing anything database-shaped except `openDatabase`.

Verify: existing tests, plus a new store test for the case the comment warns
about, a capture and a book naming the same file.

**Diff: roughly 50 lines.**

### Stage C. Sync to async, still on better-sqlite3

The big mechanical one. Every public method of `Store`, `Shelves` and
`CaptureQueue` becomes `async` and returns a `Promise`. The bodies do not
change: `better-sqlite3` stays synchronous underneath and an `async` function
wrapping a synchronous call returns an already-resolved promise. **No SQL is
edited in this stage. No behaviour changes.**

What moves:

- Roughly 55 method signatures across the three classes.
- Every caller: about 30 `await`s in `index.ts` route handlers and helpers
  (`inDerivedScheme`, `stripFor`, `settledRow`, `describeMoves`,
  `fetchCoverFor`, `hashBook`, `looksLike`, the two background loops), plus
  `rehash.ts` and `rehash-covers.ts`.
- The four database-touching test files gain `await`.
- `web/src/**` does not change. Not one line. If it does, something went wrong.

The compiler does almost all of the work: a missed `await` on a
`Promise<BookRow>` fails `tsc --noEmit` at the property access. That is what
makes a 600-line diff reviewable, and it is worth saying so in the PR body.

Two things need care:

- `Store.addBook` and `Store.updateBook` build a `db.transaction(() => ...)`
  closure and then call it. Keep exactly that shape for now; the closure body
  stays synchronous. It becomes an async `tx(async cb)` in Stage E.
- `queue.drain()` is already async and calls `nextPending()` in a loop. The
  `draining` guard still works, but the loop now yields between iterations,
  which it did not before. Nothing in the current design depends on it not
  yielding, but say so in the PR rather than leaving it to be noticed.

Verify: 302 green, `aspire start` and drive a scan by hand, run the e2e suite.
This stage is worth an e2e run even though it does not gate the PR, because it
is the last point where a regression is unambiguously the async conversion and
nothing else.

**Diff: roughly 600 lines, almost entirely `async` and `await` keywords.**

### Stage D. Make the SQL dialect-neutral, still on SQLite

Every change here is verifiable against the existing suite before Postgres
exists, which is the point.

| SQLite-ism | Change to | Note |
| --- | --- | --- |
| `INSERT OR IGNORE` (db.ts seed) | `ON CONFLICT DO NOTHING` | both accept |
| `result.lastInsertRowid`, 3 sites | `INSERT ... RETURNING id` | SQLite 3.35+, `better-sqlite3` 11 supports it via `.get()` |
| `?1` repeated placeholder | gone | removed in Stage B |
| `COUNT(*) AS n`, `SUM(CASE ...)` | `COUNT(*)::int`, `SUM(...)::int` | see risk 3 |
| `@name` / `:name` params | keep, translate in the driver layer | see below |
| `db.pragma(...)` | driver-layer concern | Stage E |

**On parameters.** `pg` supports only `$1`-style positional parameters.
Rewriting the 27-column insert in `addBook` and the 20-column update in
`updateBook` into `$1..$27` by hand is exactly the kind of change where a
transposed pair of columns writes an author into a publisher field and no test
notices. Do not do it. Write a 30-line translator in the driver layer that takes
`@name` placeholders plus an object and emits `$n` plus an array. The SQL
strings then survive the migration byte for byte, and the diff on the two
riskiest statements in the codebase is zero.

**On collation, which is the important one.** See risk 1. Nothing changes in
this stage, but this is where the fixture test gets written: a set of sort keys
containing punctuation, digits, mixed case, a leading article and an accented
character, asserted in the exact order the shelving model requires. It passes on
SQLite today. It must pass on Postgres in Stage F, and it will not unless the
columns are declared `COLLATE "C"`.

Verify: 302 green plus the new ordering test.

### Stage E. A driver interface, still on SQLite

Introduce the narrowest interface the three stores actually need:

```ts
interface Db {
  all<T>(sql: string, params?: unknown): Promise<T[]>
  get<T>(sql: string, params?: unknown): Promise<T | undefined>
  run(sql: string, params?: unknown): Promise<{ changes: number }>
  tx<T>(work: (db: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
}
```

- `SqliteDb` implements it over `better-sqlite3`, including the `@name`
  translation and the `pragma` setup.
- `Store`, `Shelves` and `CaptureQueue` take `Db` instead of
  `better-sqlite3.Database`.
- `tx` must nest: `addBook` opens a transaction and a test harness may already
  be inside one. Implement nesting with `SAVEPOINT` in both drivers.
- After this stage, `better-sqlite3` is imported in exactly **one** production
  file. `grep -rn better-sqlite3 web/server | wc -l` becomes the verification.

Verify: 302 green, unchanged.

### Stage F. Postgres exists but is not the default

Two halves, and they can be two PRs if the first is noisy.

**F1, the AppHost.** `aspire add postgresql`, then in `apphost.mts`:

```ts
const pg = await builder.addPostgres('postgres')   // Aspire assigns the host port
const catalogue = await pg.addDatabase('bookscan')
apiBuilder = apiBuilder.withReference(catalogue).waitFor(catalogue)
```

- **Do not call `withHostPort`.** A fixed port is precisely what issue #28 was
  about, and several checkouts must keep starting side by side.
- **Do not hand-edit `.aspire/modules/`.** `aspire add` regenerates it on every
  start; AGENTS.md already says so. `addPostgres` is not present in the
  generated module today, which is the confirmation that the package has to be
  added properly rather than declared by hand.
- Check afterwards that the tooling has not reintroduced a `profiles` block in
  `aspire.config.json`. Issue #28 again.
- Decide the data volume deliberately. A `withDataVolume()` with a fixed name is
  a shared database across every worktree, which is issue #28 wearing a
  different hat. Either give no volume (a developer's scratch catalogue becomes
  ephemeral, which is a change from today, where `web/data/books.db` persists)
  or derive the volume name from the checkout. The e2e run wants no volume at
  all, since it assumes an empty catalogue. **Owner decision.**
- Note the cost: one Postgres container per running checkout. Five worktrees is
  five containers.
- The connection arrives as `ConnectionStrings__bookscan` in the api resource's
  environment. Read it in `index.ts` the way `PORT` is read.
- `openDatabase` is called at module scope in `index.ts`, synchronously, before
  `app.listen`. Connecting asynchronously means a small `bootstrap()` or a
  top-level `await`. Straightforward, but it is a real edit to the startup path
  and belongs in the review.

Verify: `aspire start --non-interactive`, `aspire ps` shows a healthy postgres,
`aspire wait api`, `aspire logs api`. The app is still on SQLite at this point,
so the container is provisioned and idle. That is deliberate: the AppHost change
is proven separately from the code change.

**F2, the driver and the schema.** `web/server/db.pg.ts` with the Postgres DDL
and a `PgDb implements Db` over `pg`. Selection by environment:
`BOOKSCAN_DB=sqlite|postgres`, defaulting to `sqlite`.

Schema translation, deliberately literal. **Every column keeps the type that
produces the same JavaScript value it produces today**, because the API contract
and the React client depend on it:

| SQLite | Postgres | Why not the "better" type |
| --- | --- | --- |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `integer GENERATED BY DEFAULT AS IDENTITY` | `BY DEFAULT` so the data migration can insert explicit ids |
| `is_fiction INTEGER` | `integer` | not `boolean`. `BookRow.is_fiction` is `number` and the client reads it |
| every `_at` timestamp, TEXT | **`text`** | not `timestamptz`. `pg` returns `timestamptz` as a `Date`, which changes every JSON payload the client and the e2e suite read, and ISO-8601 text sorts correctly anyway |
| `sort_key`, `author_filing`, `title_filing`, `starts_at` TEXT | `text COLLATE "C"` | **load-bearing, see risk 1** |
| `series_index REAL` | `double precision` | |
| `TEXT DEFAULT ''` | `text NOT NULL DEFAULT ''` | tightening is optional; skip it if it complicates the data migration |

`db.ts`'s `addMissingColumns` and `migrateSeparators` are **not** ported. They
exist to bring an old SQLite file forward, and there is exactly one such file in
the world. It gets brought forward by the SQLite code path, once, immediately
before the data migration reads it. The Postgres schema is created complete.
Say that in the PR so nobody hunts for the missing migration later.

Then: run the four database-touching test files against **both** drivers,
parameterised. `store.test.ts`, `shelves.test.ts`, `queue.test.ts` and
`rehash.test.ts` get a shared harness that yields a `Db`, and the same 71 tests
run twice. This is the stage's whole verification argument: the Postgres
implementation is correct exactly to the extent that the tests already guarding
SQLite pass unchanged against it.

Verify: 302 SQLite tests green, plus roughly 71 Postgres tests. Test count rises
to about 373 across 16 files, and AGENTS.md's number is updated in the same PR.

### Stage G. Flip the default; e2e on Postgres

- Default `BOOKSCAN_DB` to `postgres`. SQLite stays reachable for one more
  stage.
- `e2e/support/database.ts` swaps `better-sqlite3` for `pg`. Its `reset()`
  becomes `TRUNCATE captures, book_authors, books, separators, author_filing
  RESTART IDENTITY CASCADE`, which is simpler than the current five deletes.
- `e2e/global-setup.ts` discovers the database today by asking `/api/health` for
  a file path. Change it to read `ConnectionStrings__bookscan` out of the api
  resource's environment, which `describeResources()` already returns
  (`e2e/support/aspire.ts:64-71` types `environment` on the resource). That is
  less new machinery than teaching `/api/health` to hand out a password.
- `/api/health` reports a redacted description (host, port, database, no
  credentials) instead of `DB_PATH`.
- The two Gherkin features and both step files do not change. If they do, the
  migration changed behaviour.

Verify: `cd e2e && npm test` green, both journeys, on Postgres. **This is the
gate.** It is the thing the suite was built for, and nothing proceeds past it
until it is green twice in a row.

Also rehearse `store.addBook` under two concurrent requests here, because of
risk 3.

### Stage H. The real data

The owner runs this. Detailed in section 5. Nothing is committed to the
repository except a migration script and its runbook.

### Stage I. Remove SQLite

Not before the owner confirms the live catalogue has been on Postgres for at
least a week and a Postgres backup has been restored successfully at least once.

- Delete `SqliteDb`, the SQLite branch of `db.ts`, `addMissingColumns`,
  `migrateSeparators`, `SCHEMA_VERSION`, the `BOOKSCAN_DB` switch and the
  dual-driver test parameterisation.
- Drop `better-sqlite3` and `@types/better-sqlite3` from `web/package.json` and
  `e2e/package.json`.
- Rewrite the `:memory:` paragraph in AGENTS.md and the `Tests` step comment in
  `.github/workflows/ci.yml`, both of which currently assert the old safety
  story.
- Keep the `no-production-data` CI job. It greps `git ls-files` for `.db` and
  `.sqlite` files and for `covers/` and `captures/` directories. The covers half
  is still live, and the database half costs nothing to keep.

**Ordering note.** Stages A, B and D are independently useful and carry no
Postgres risk. If the owner wants to stop at any point, stopping after D leaves
the codebase strictly better and still entirely on SQLite.

---

## 4. The test story

The part most likely to make the migration unpleasant, so here is the
measurement first.

Today `npm test` reports 302 tests across 16 files in about 24 seconds, and
needs no network, no Docker and no services. **Only 4 files and roughly 71 tests
open a database**, each via `openDatabase(':memory:')` in a `beforeEach`, which
costs about a millisecond. The other 231 tests are pure functions, image
hashing, OCR against generated fixtures and HTTP stubs. None of them are
affected by any of this.

### The options

**(a) Keep SQLite alive for unit tests; test Postgres only end to end.**
Cheapest, and permanently wrong. It means maintaining two schemas and two
drivers forever, with the fast path guarding only the one that is not in
production. Divergence is invisible until the nightly e2e run, or until a user
finds it. The collation problem in risk 1 is the canonical example: it produces
correct results under SQLite forever and wrong ones under Postgres, and a
SQLite-only unit suite passes happily on both sides of the bug.

**(b) Transaction per test, rolled back.** The fastest Postgres option, and it
distorts the code under test. `addBook`, `updateBook` and `Shelves.remove` open
transactions of their own, so each would run as a savepoint inside the harness
transaction and never actually commit. It also serialises tests onto one
connection, fighting per-file parallelism in vitest. Workable, and more
machinery than 71 tests justify.

**(c) One container for the run, one database per test file, truncate between
tests.** Boring. A `globalSetup` starts one Postgres container, applies the
schema to a template database, and each test file creates its own database from
that template, which is what lets files keep running in parallel. `beforeEach`
does `TRUNCATE ... RESTART IDENTITY CASCADE` across the five tables, which on
empty tables is about a millisecond.

### Recommendation

**(c), with the container started by `@testcontainers/postgresql` from the
vitest `globalSetup`, and an escape hatch.**

- The escape hatch is `BOOKSCAN_TEST_DATABASE_URL`. When set, the harness uses
  that server and starts no container. That is how CI uses a `services: postgres`
  block, and how a developer who already has one running skips the startup cost.
- Use container reuse for the inner loop, so a second `npm test` in the same
  session pays nothing.
- Pin the image to the same major version as the eventual managed target.

### The cost, stated plainly

1. **`npm test` grows a Docker dependency.** Today it needs nothing. That is a
   real regression in the contributor experience and it is the honest price of
   testing the database that is actually in production. Mitigated by the escape
   hatch and by the fact that 231 of 302 tests still need nothing. Not
   eliminated.
2. **Wall clock.** Expect a cold container start of 5 to 15 seconds locally and
   10 to 20 seconds in CI, then roughly 2 to 5 milliseconds per database test
   where there was 1. Call it 24 seconds becoming 35 to 45 seconds cold, roughly
   30 seconds warm. During stages F and G it is worse, because the 71 database
   tests run against both drivers.
3. **A new safety surface, and this one matters.** The current safety story is
   structural: `:memory:` cannot reach a file, so no test can reach the
   catalogue. Replacing it with a connection string reintroduces exactly the
   `BOOKSCAN_DATA` hazard under a new name. A `DATABASE_URL` or a
   `ConnectionStrings__bookscan` sitting in a developer shell, pointed at
   production, would be picked up by a dev server or a test run. So:
   - The test harness reads **only** `BOOKSCAN_TEST_DATABASE_URL`, never
     `DATABASE_URL` or `ConnectionStrings__*`. Ambient connection variables are
     ignored, deliberately, with a comment saying why.
   - The AppHost sets the api connection explicitly, exactly as it already does
     for `BOOKSCAN_DATA`, so an inherited value cannot win.
   - The AGENTS.md section "Why you are unlikely to reach it by accident" is
     rewritten **in the PR that flips the default**, not afterwards. Per the
     convention in that file, every claim in the rewrite names the command that
     demonstrates it, and that command gets run before the sentence is written.

---

## 5. Migrating the real data

The owner runs every step. No agent touches
`C:\Users\Blake\book-scan-production-data\`.

Inputs: one SQLite database, 57 books, 66 author rows, 61 captures, plus
`separators`, `author_filing` and `shelf_ranges`. 338 cover images on the
filesystem, which **do not move**.

### Before anything

1. **Stop the app.** No process holding the database open.
2. **Snapshot with `VACUUM INTO`, not `cp`.** This is the whole lesson of the
   near miss in issue #6: the WAL was 4.1 MB and five hours newer than the
   `.db`, so copying the `.db` alone would silently have lost the most recent
   session. `VACUUM INTO` produces one consistent file with the WAL folded in.
   Copying `books.db`, `books.db-wal` and `books.db-shm` together also works;
   `VACUUM INTO` is harder to get wrong.
3. **Copy the cover directory too**, even though nothing will write to it. It is
   282 MB and it is the irreplaceable half.
4. **Verify the snapshot**: open it read-only, `PRAGMA integrity_check`, record
   the row counts of all six tables and a checksum over the books table ordered
   by id. Write those numbers down. They are the acceptance criteria.

### Rehearse, twice

Against the **snapshot**, never the live file:

1. Run the SQLite code path against the snapshot once, so `addMissingColumns`
   and `migrateSeparators` bring it fully forward. This is the only time those
   functions matter, and it is why they are not being ported.
2. Run the migration script into a scratch Postgres. The Aspire container is
   fine.
3. Compare: row counts per table, the books checksum, and
   `SELECT id, sort_key FROM books ORDER BY sort_key` compared **as an ordered
   list** between the two databases. That last comparison is the collation check
   on real data and it is the single most valuable step in the rehearsal.
4. Point a dev server at the migrated scratch database and look at the shelves.
   57 books is few enough to read with your eyes. Check fiction and non-fiction,
   check the checked-out list, check that separators put the boundaries where
   they were.
5. Do it a second time from a fresh snapshot, to prove the script is repeatable
   and not something that worked once because of the order things happened to
   run in.

### The migration script

Boring, single-purpose, lives at `web/server/migrate-sqlite-to-pg.ts` beside
`rehash-covers.ts`, and follows the conventions of that file: it prints exactly
what it is about to do, refuses to run against a non-existent source, has a dry
run, and waits before writing.

- Reads with `better-sqlite3`, writes with `pg`, in one transaction.
- Preserves ids explicitly, which is why the identity columns are
  `GENERATED BY DEFAULT`. `book_authors.book_id`, `captures.book_id` and the
  filenames in `front_image` and its siblings all depend on them.
- Afterwards, `ALTER TABLE ... ALTER COLUMN id RESTART WITH <max+1>` on `books`,
  `captures` and `separators`. Forgetting this is the classic failure:
  everything looks perfect until the next insert collides on a primary key.
- Refuses a non-empty target unless `--force`.
- Prints the comparison numbers itself, so the acceptance check is not a
  separate manual step somebody skips at 11pm.

### Cutover

1. Stop the app. Take a fresh `VACUUM INTO` snapshot.
2. Run the script against the target Postgres.
3. Run the comparison. If any number differs, stop.
4. Start the app against Postgres. Open the library. Look at it.
5. **Leave the SQLite file exactly where it is, untouched, for at least a
   month.**

### The way back

This is why SQLite is not deleted until Stage I. Until then the way back is:
stop the app, set `BOOKSCAN_DB=sqlite`, start the app. The SQLite file has not
been written to since the cutover, so it is the catalogue as of that moment.
Anything scanned into Postgres since is lost by rolling back, which is why the
rollback window is measured in hours and the decision to keep going is made the
same day.

There is no path from Postgres back to SQLite and there should not be one.
Writing one is a day of work to support a scenario the owner should resolve by
fixing forward.

---

## 6. Cover images and the storage abstraction

**Not part of this migration.** Its own issue, sequenced after Stage G.

The reasons to keep it out:

- It shares the single most disruptive property of the Postgres work, turning
  synchronous calls asynchronous, because S3 and Azure Blob are network calls.
  Two independent sync-to-async sweeps in one diff is the unreviewable PR the
  owner is trying to avoid.
- It touches a different set of files. Postgres touches `db.ts`, `store.ts`,
  `shelves.ts`, `queue.ts`. Covers touch `index.ts`, `covers.ts`,
  `rehash-covers.ts` and the `/api/covers` static mount. Almost no overlap, so
  almost no reason to combine them.
- Doing it after means it is written against a codebase that is already async
  throughout, which makes it a much smaller change than it would be today.

### Where the seam belongs

Filesystem access is currently in these places:

| Where | What |
| --- | --- |
| `index.ts:33` `saveImage` | write a captured photo |
| `index.ts:170-177` | read, injected into `CaptureQueue` |
| `index.ts:205` `rmSync` | delete an orphaned photo |
| `index.ts:220-227` | `express.static(COVER_DIR)` serves `/api/covers` |
| `covers.ts:88` | write a downloaded publisher cover |
| `index.ts:792`, `rehash-covers.ts:97` | read for hashing |

The interface is small, and half of it is already discovered: `CaptureQueue`
takes its reader by injection (`queue.ts:55`), which is exactly the right shape.
Generalise that:

```ts
interface CoverStore {
  put(name: string, bytes: Buffer): Promise<void>
  get(name: string): Promise<Buffer | null>
  delete(name: string): Promise<void>
  /** How a browser fetches it. A path today, a presigned URL later. */
  url(name: string): Promise<string>
}
```

The `url` method is what earns the abstraction. Everything else is trivially
swappable; the serving path is not, because the static mount, with its immutable
and 30-day max-age and fallthrough disabled, has to become a handler that either
streams from the store or redirects to a presigned URL. That decision is the
actual content of the issue and deserves its own discussion, rather than being
made in passing during a database migration.

One thing that does belong in the Postgres work: the database stores cover
**filenames**, not paths. `front_image`, `back_image`, `edge_image` and
`cover_image` are bare names joined against `COVER_DIR` at read time. That is
already the right design for object storage and needs no change. Worth
confirming in the PR that it stays that way.

---

## 7. What does not change

Explicitly, because everything on this list is risk not taken.

- **All of `web/src/`.** The React client, all twelve components, the API
  wrapper. The JSON contract is preserved exactly: `is_fiction` stays 0 or 1,
  every timestamp stays an ISO-8601 string, ids stay numbers, counts stay
  numbers (see risk 3). A non-empty diff under `web/src/` is a signal that
  something drifted.
- **All of `web/shared/`.** `shelving.ts`, `layout.ts` and `isbn.ts` are pure
  and have no idea a database exists. 98 tests, untouched.
- **`docs/shelving.md`.** The specification is about filing rules, not storage.
  Per the convention in this repo, if code and that document disagree the
  document wins, and this migration must not create a disagreement.
- **Six of the nine server modules**: `identify.ts` at 1040 lines, `lookup.ts`,
  `paddle.ts`, `covers.ts`, `imagehash.ts`, `classify.ts`. No database access.
- **The Gherkin features and both step files.** Only `e2e/support/database.ts`
  and a few lines of `global-setup.ts` change.
- **231 of 302 tests.** Barcode decoding, OCR, image hashing, HTTP stubs, pure
  domain rules.
- **Table and column names**, including the deliberate `shelf_range` deviation
  documented at the top of `db.ts`. Renaming during a data migration is how you
  end up unable to tell a translation bug from a rename bug.
- **`BookRow`.** Same fields, same TypeScript types.
- **The `BOOKSCAN_DATA` rule.** Covers still live there, so the variable, the
  explicit setting of it by the AppHost, and the prohibition on setting it in a
  shell all remain exactly as they are.
- **`aspire.config.json` having no `profiles` block.** Issue #28.
- **The `no-production-data` CI job.**
- **Anything to do with users, accounts, ownership or authentication.** There is
  nothing to change, because there is nothing there.

---

## 8. Risks

### Risk 1: collation. The biggest.

The ordering of `sort_key` is the spine of the entire product.
`Store.neighbours` does `sort_key < ?` and `sort_key > ?`; `Shelves.booksIn`
does `ORDER BY sort_key`; `separators.starts_at` is compared against sort keys
to find shelf boundaries; `layoutRange` depends on receiving books in exactly
that order.

SQLite compares text byte by byte, BINARY collation, with no exceptions.
Postgres compares using the collation of the database, which on a default
`en_US.utf8` or `en_GB.utf8` cluster ignores punctuation at the first pass,
folds case, and orders accented characters next to their unaccented forms. Two
sort keys that SQLite orders one way can come back the other way from Postgres.

This does not throw. It does not fail a smoke test. It reorders a shelf, or
moves one book past a separator boundary, and the app confidently tells somebody
to put a book in the wrong place. On 57 books it might affect two of them and go
unnoticed for months.

**Mitigation, all of it:**

- Declare `sort_key`, `author_filing`, `title_filing` and `separators.starts_at`
  as `text COLLATE "C"`, and declare `idx_books_shelf` over the collated column.
  `"C"` is byte order, which is what SQLite does.
- Write the ordering fixture test in Stage D, before Postgres exists, so it is
  known to pass on SQLite. Include punctuation, digits, mixed case, a leading
  article and an accented character. Confirm during Stage F that removing
  `COLLATE "C"` makes it fail. **A test that has only ever passed proves
  nothing**, which is the rule this repository already states about regression
  tests.
- In the Stage H rehearsal, compare `SELECT id FROM books ORDER BY sort_key` as
  an ordered list between the SQLite snapshot and the migrated Postgres, on the
  real 57 books with the real author names.

### Risk 2: moving 57 irreplaceable books.

The catalogue cannot be reconstructed except by physically handling every book
again. Issue #6 records a near miss where a naive copy would have lost five
hours of work because the WAL was newer than the `.db` file.

**Mitigation:** `VACUUM INTO` rather than a file copy; two full rehearsals
against a snapshot before touching the live data; row counts and an ordered-id
comparison as machine-checked acceptance criteria rather than a glance; the
SQLite file left untouched and readable for a month; the flag that flips the app
back kept alive until Stage I; and the owner, not an agent, running every step.
The cover images do not move at all, which removes the 282 MB half of the
problem entirely.

### Risk 3: the two silent behaviour changes

Not the biggest, but the ones most likely to ship unnoticed, so they belong
here.

**Aggregates come back as strings.** `pg` returns `bigint` and `numeric` as
JavaScript strings, because they do not fit in a `number`. `Store.counts()` uses
`COUNT(*)` and three `SUM(CASE ...)` expressions; `CaptureQueue.counts()` uses
`COUNT(*)`. Without an explicit `::int` cast, `/api/health` and every save
response start returning a total of "57", a string, instead of 57. The client
renders it identically; arithmetic on it does not. Fix in Stage D with casts,
and assert `typeof` in the store test so the fix cannot be lost.

**Read-then-write sequences stop being atomic.** Today the server is one Node
process with a blocking driver, so `Store.addBook` computes a placement and
inserts with no opportunity for another request to interleave. `index.ts:541`
already anticipates the problem in a comment: with two people scanning, a
neighbour can appear between preview and save. With `pg` there is a real await
point inside `addBook` between reading the neighbours and writing the row, so
two concurrent scans genuinely can interleave and both be told to go in the same
gap. The e2e suite is single-user and will not catch it.

Fix in Stage F: widen the existing `addBook` transaction to cover
`placementFor` as well as the insert, and rewrite `setCheckedOut` from
read-then-write into a single conditional `UPDATE ... RETURNING`, which is both
correct under concurrency and shorter than what is there now. Add one test that
runs two `addBook` calls concurrently and asserts both books end up correctly
ordered.

---

## 9. Decisions for the owner, before anyone starts

1. **Is `npm test` requiring Docker acceptable?** The load-bearing one. A no
   changes the recommendation in section 4 from (c) to (a) and commits the
   project to maintaining two database drivers indefinitely.
2. **Dev data volume.** Should `aspire start` preserve a scanned scratch
   catalogue across restarts, the way `web/data/books.db` does today? If yes,
   the volume name must be derived per checkout or worktrees will share one
   database. If no, dev catalogues become ephemeral, which is simpler and is a
   change from today.
3. **Postgres major version.** Pin the container to whatever the eventual
   managed target will run. If undecided, 17. Cheap now, annoying later.
4. **When does the live catalogue actually move?** Recommended: flip the local
   default at Stage G, live on scratch data for a week, then do Stage H.
   Migrating live data as soon as Postgres works buys nothing.
5. **Is the cover storage abstraction in or out?** Recommended out, as its own
   issue after Stage G, for the reasons in section 6.
6. **Does SQLite get deleted at Stage I, or kept as a supported path?**
   Recommended deleted. Keeping it is a permanent tax on every future schema
   change, and it guards a configuration nobody runs.
7. **`/api/health` reports the database path and the e2e suite reads it.**
   Confirm that redacting it to host, port and database name, with the suite
   reading the connection from `aspire describe` instead, is acceptable.
8. **Confirm the precondition from issue #6 is met.** It said not to start while
   #1 was open, because cover hashes were suspect. #1 and #11 are both closed and
   the hashes have been rebuilt, so this reads as satisfied. Worth the owner
   saying so explicitly rather than an agent inferring it.

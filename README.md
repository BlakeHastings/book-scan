# book-scan

Catalogue a physical book collection with a phone camera.

Hold a book up to the camera and photograph its cover, back and spine. The app
decodes the barcode, falls back to reading the printed ISBN when the barcode is
damaged or predates ISBN-13, confirms the record against Open Library, and then
does the part that makes it useful: it tells you which two already-shelved books
the new one belongs between, and shows you their spines so you can find the gap.

Shelf capacity is something you tell it, not something it guesses. When a shelf
is full you say so, and every location after that is derived and cascades.

## Getting started

The application lives in [`web/`](web/).

```bash
cd web
npm ci
npm run dev
```

Then open the **Network** HTTPS address Vite prints on your phone, with both
devices on the same wifi. See [`web/README.md`](web/README.md) for the full
setup, including why the certificate warning appears and how to get rid of it.

## Documentation

| Document | What it covers |
| --- | --- |
| [`web/README.md`](web/README.md) | Setup, architecture, how the pieces fit |
| [`docs/shelving.md`](docs/shelving.md) | The shelving specification, and the authority on filing rules |
| [`e2e/README.md`](e2e/README.md) | The browser end to end suite, and how the camera is faked |
| [`docs/postgres-migration.md`](docs/postgres-migration.md) | The staged plan for moving off SQLite, and the decisions behind it |
| [`docs/deployment-survey.md`](docs/deployment-survey.md) | What this app requires in order to run somewhere that is not one desktop |
| [`AGENTS.md`](AGENTS.md) | Instructions for coding agents, including data safety |

## Your catalogue is not in this repository

The live catalogue and its cover photographs are deliberately stored outside
this checkout, and `web/.gitignore` prevents them from ever being committed.
Re-scanning a collection means physically handling every book again, so the data
is treated as irreplaceable.

By default the server reads and writes `web/data/` relative to where you run it.
Point it somewhere permanent with `BOOKSCAN_DATA`:

```bash
BOOKSCAN_DATA="C:\path\to\your\data" npm run dev
```

Anyone working on the code, human or agent, should leave `BOOKSCAN_DATA` unset
so they get a scratch database instead. See [`AGENTS.md`](AGENTS.md).

### The database

Postgres, and only Postgres, as of stage I of the migration. The connection is
read from `ConnectionStrings__bookscan`, which the Aspire AppHost sets, so
under `aspire start` there is nothing to configure.

Started with no connection string, the server refuses to start and names the
variable. A process that exits saying which variable is empty is recoverable in
one command; one that comes up on an empty database is not obviously anything.

SQLite was the only database until stage G, the default until stage H and a
supported configuration until stage I. It is gone, along with `BOOKSCAN_DB` and
`better-sqlite3`. There is no path back in this tree: an older commit is one.

The cover photographs stay on the filesystem under `BOOKSCAN_DATA`. Only the
rows moved. Object storage for the photographs is separate work, deliberately.

## Checks

```bash
cd web
npm run typecheck   # tsc --noEmit
npm test            # vitest
```

Both run in CI on every pull request, alongside a check that no scan data has
been committed.

**`npm test` needs Docker.** It starts one Postgres container for the run, and
every test file that opens a database opens one on it, because that is the
database being shipped. Set `BOOKSCAN_TEST_DATABASE_URL` to a server you
already have and no container starts; that is how CI does it. Stages F to H
also ran a `sqlite` project that needed nothing, and stage I removed the driver
it was for.

### End to end

A separate suite in [`e2e/`](e2e/) describes the product's journeys in Gherkin
and runs them in a real browser against the app started by Aspire, then checks
what landed in the database.

```bash
cd web && npm ci     # once: the camera fixtures use this package's toolchain
cd ../e2e
npm ci
npx playwright install chromium
npm test
```

It starts and stops the AppHost itself, so nothing needs to be running first.
The camera is a generated video file rather than hardware, and the Open Library
and Google Books lookups are answered by a local stub, so a run does not depend
on the network or on what a webcam can see. See
[`e2e/README.md`](e2e/README.md).

This suite gates pull requests too, and also runs nightly. Bear in mind that a
scenario which has never been seen to fail is not a regression test: when you
fix a defect a scenario covers, revert the fix, watch the scenario go red, then
restore it.

What CI proves and what a reviewer still has to check by hand is set out in
[`docs/process/verifying-a-pr.md`](docs/process/verifying-a-pr.md).

## History

This started as a Python and Tkinter desktop application. That version was
retired once the phone-first version replaced it; it is preserved in git history
at `6f1ff08` and described in the commit that removed it, `e8b6808`.

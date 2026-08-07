# Stage H runbook: moving the catalogue to Postgres

The owner runs every step of this. It is the one step of the Postgres migration
that touches irreplaceable data, and `docs/postgres-migration.md` is the
authority on why it is shaped the way it is. This file is the sequence.

Nothing here is automated end to end on purpose. Each step prints what it is
about to do and stops, so a wrong path or a wrong target is something you read
rather than something you find out about afterwards.

## What this moves, and what it does not

- **Moves**: `books`, `book_authors`, `captures`, `separators`, `author_filing`
  and `shelf_ranges`, ids included.
- **Does not move**: the cover images. They stay on the filesystem exactly where
  they are. The database holds bare filenames joined against `BOOKSCAN_DATA` at
  read time, which is already the right design and does not change here. The
  migration only checks that every filename still resolves.
- **Does not touch the SQLite file at all.** The source is opened read-only,
  with `query_only` set on top of that. It is still the catalogue afterwards,
  byte for byte, and it stays that way for at least a month.

**The tool this file describes was deleted by stage I** (#178), because it
reads SQLite through a driver that stage I removed. This runbook is kept as the
record of what it did and what its verification proved. To run it again, check
out a commit before stage I; the tool and the driver come back together.

## Before anything

1. **Stop the app.** No process holding the database open. The tool refuses to
   read a source with a `books.db-wal` beside it for this reason.

2. **Snapshot with `VACUUM INTO`, not `cp`.** This is the whole lesson of the
   near miss in issue #6: the WAL was 4.1 MB and five hours newer than the
   `.db`, so copying the `.db` alone would silently have lost the most recent
   session.

   ```
   sqlite3 books.db "VACUUM INTO 'C:\...\snapshot\books.db'"
   ```

3. **Copy the cover directory as well**, even though nothing writes to it. It is
   the irreplaceable half and it is over a gigabyte.

4. **Verify the snapshot by opening it**, not by checksum. A checksum proves two
   files match; it does not prove either one opens.

   ```
   sqlite3 snapshot/books.db "PRAGMA integrity_check; SELECT COUNT(*) FROM books;"
   ```

5. **Do not stage anything under `web/data/`.** `web/server/index.test.ts`
   deletes that whole directory in an `afterAll`, so one `npm test` removes
   whatever is in it. That is fine for a scratch catalogue and would be
   expensive for a snapshot. It cost this rehearsal a re-copy of 1.1 GB.

## The target

The tool writes to the Postgres named on its command line and to nothing else.

**It deliberately does not read `ConnectionStrings__bookscan`**, the variable the
running app reads, for the same reason the test harness reads only
`BOOKSCAN_TEST_DATABASE_URL`: a connection string sitting in a shell should not
be able to decide what gets written to. `BOOKSCAN_MIGRATE_TARGET` is accepted
instead of `--target` if you would rather not put a password in shell history.

Before running for real, the target has to be:

- **empty of a catalogue.** The tool refuses a target that already holds books,
  captures, separators or author filings unless `--force` is given. A freshly
  created database has two seeded `shelf_ranges` rows and that is expected.
- **not a `C` locale database**, or the ordering proof is vacuous. The
  verification says so in as many words when the database it got is byte order,
  because on one of those every column orders correctly whatever the column was
  declared as, and `COLLATE "C"` could have been dropped from the schema with
  nothing noticing. Postgres 17 and 18 images default to `en_US.utf8`, which is
  what the rehearsal ran against.
- **on the same schema as the source.** The tool compares every column of every
  table in both directions before it writes anything, and refuses if either side
  has one the other does not. A column the target lacks would be dropped
  silently; a column the source lacks means the source was never brought forward
  by the SQLite code path and its rows would arrive carrying defaults nobody
  chose.

## The run

From `web/`. Three commands, in this order.

```
# 1. Dry run. Writes nothing, checks the schemas, reports what is there now.
npx tsx server/migrate-sqlite-to-pg.ts \
  --source <snapshot>/books.db --covers <snapshot>/covers \
  --target '<connection>'

# 2. The move. Prints the target, waits five seconds, then writes in one
#    transaction, then verifies.
npx tsx server/migrate-sqlite-to-pg.ts --apply \
  --source <snapshot>/books.db --covers <snapshot>/covers \
  --target '<connection>'

# 3. Verify again, any time afterwards. Writes nothing.
npx tsx server/migrate-sqlite-to-pg.ts --verify \
  --source <snapshot>/books.db --covers <snapshot>/covers \
  --target '<connection>'
```

`--force` empties the target first, inside the same transaction as the copy. It
is how a re-run is done, not how a first run is done.

## What the verification proves, and what to read

It exits non-zero if anything differs, and prints `VERIFIED. Nothing differs.`
if not. The report is worth reading rather than trusting the exit code, because
each section is a different claim:

| Section | The claim |
| --- | --- |
| Rows, and the content behind them | Every row of every table, compared cell by cell, plus one digest per table to write down. The digest is sensitive to type as well as value, so a number that arrived as a string changes it. |
| positions differ | `SELECT id FROM books ORDER BY sort_key` read out of both databases and compared position by position. **This is the collation check.** |
| negative control | The same rows ordered under the database's own collation. It has to come back **different**, or the line above proved nothing. |
| declared collations | The four columns read back out of `pg_attribute`, so the check is on what the database did rather than on what the DDL asked for. |
| shelf boundaries | Each separator's `starts_at` resolved against `books.sort_key` on both sides. An ordering difference too small to change the list but large enough to move one book past a divider shows up here and nowhere else. |
| Nulls and empty strings | Per column, both sides. `''` and `NULL` are a documented distinction in the crop columns: a slot named in `cropped` whose crop column is `''` was examined and declined, which is not the same fact as never having been looked at. |
| Covers | Every filename the migrated rows point at, checked against the cover directory. |
| Identity sequences | The next id against the highest id. Forgetting this is the classic failure: everything is perfect until the next scan collides on a primary key. |

## Cutover

1. Stop the app. Take a fresh `VACUUM INTO` snapshot.
2. Run the tool with `--apply` against the target.
3. Read the verification. **If any number differs, stop.**
4. Start the app against Postgres and open the library. Look at it: the shelf
   order, the queue, and one book's photographs.
5. **Leave the SQLite file exactly where it is, untouched, for at least a
   month.** Stage I did not happen until the owner confirmed a successful
   restore of a Postgres backup; the week on Postgres was waived, on the
   evidence that no book had been written to Postgres since the cutover, so the
   retained file was current rather than merely intact. See stage I in
   `docs/postgres-migration.md`.

## If it fails halfway

It cannot leave a half-migrated catalogue. The copy, the sequence restarts and
the `--force` truncate are all inside one transaction, so a failure at any point
rolls the whole thing back and the target is either the catalogue or exactly
what it was before. The recovery is to fix what failed and run it again, with
`--force` if the previous attempt committed.

## The way back

**This changed at stage I, which removed the SQLite driver.** What is written
below was true while that driver was in the tree, and the sequence is still the
sequence; it now needs one step in front of it.

- **Before stage I:** stop the app, set `BOOKSCAN_DB=sqlite`, start the app.
  One variable, and a live exercised path rather than a hope.
- **Now:** stop the app, `git checkout` a commit before stage I (#178), which
  restores the driver, the `BOOKSCAN_DB` switch and the migration tool
  together, then set `BOOKSCAN_DB=sqlite` and start the app.

The SQLite file itself is unchanged by any of this and stays on the disk until
at least 2026-09-06. It has not been written to since the cutover, so it is the
catalogue as of that moment.

The cost is real and it is measured in hours, not days: **anything scanned into
Postgres after the cutover is lost by rolling back**, because there is no path
from Postgres back to SQLite and there should not be one. So the decision to
keep going is made the same day.

The other cost, added by stage I: the SQLite half of the suite went with the
driver, so a rollback runs a revision CI last proved on the day stage I landed
rather than one proved this morning.

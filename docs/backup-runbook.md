# Backing up the Postgres catalogue

The catalogue is a Postgres database now. It used to be a SQLite file, and
everything this project knew about backing it up was about that file: copy the
directory, bring the `-wal`, open the copy rather than checksum it. Those rules
were hard won and they now protect the wrong thing.

This is the sequence for the thing that exists.

The owner runs the wiring step. Nothing in this repository holds the live
connection string, and nothing in it may.

## What a backup is here, and what it is not

A dump is a file. **A backup is a file somebody has restored.** Everything below
is arranged around that difference, because the failure this is protecting
against is not "there was no dump", it is "there was a dump every day for five
months and none of them restored".

So a run produces two things: the dump, and a manifest holding the digest of the
catalogue *as of the instant the dump was taken*. The verification restores the
dump into a scratch database and compares it against that manifest, then drops
the scratch database.

Comparing against the manifest rather than against the live catalogue is
deliberate. The catalogue is added to most days. A verification that compared a
restore against a source that has moved on since would fail every time somebody
scanned a book during the backup window, and an alarm that cries wolf is an
alarm nobody reads. `pg_export_snapshot` pins `pg_dump` and the digest to one
instant, so any difference the comparison finds is a real one.

## What is covered

| | |
| --- | --- |
| **Covered** | `books`, `book_authors`, `captures`, `separators`, `author_filing`, `shelf_ranges`. Every row, its content, and the order the shelf comes back in. |
| **Not covered** | The cover photographs. See below; this is not an oversight and it is not small. |

### The photographs are not in the dump

`pg_dump` moves rows. The photographs are files, they are over a gigabyte, and
they are half of what is irreplaceable: the database holds bare filenames joined
against `BOOKSCAN_DATA` at read time, so a catalogue restored without them is a
list of books with no pictures of them.

The tool says so on every run rather than leaving it to be inferred.

**They need their own copy, and it has to be on another disk.** A second copy on
the same volume survives a `docker volume rm` and an accidental delete, and does
not survive the disk or the machine, which is what a gigabyte of photographs
needs protecting from. `scripts/backup-catalogue.ps1` will copy them with
`-CoversSource` and `-CoversDestination`, and **refuses** a destination on the
same volume as the source rather than warning about it, because a job that
reports success is a job somebody stops checking.

It copies with `robocopy /E /XO` and deliberately not `/MIR`. Mirroring would
propagate a delete, which turns one accidental deletion into two.

If the photographs are covered by something else, a file-level backup service or
an external drive somebody rotates, that is a fine answer and it should be
written down here. What is not fine is nobody having decided.

## The schedule

Windows has no cron. The scheduler is Windows Task Scheduler, registered by
`scripts/install-backup-task.ps1`, running `scripts/backup-catalogue.ps1` daily
at 03:30 local.

Daily, because the catalogue is added to most days and a day is the most anybody
should lose. 03:30, because a scanning session is over by then and a failure is
visible the next morning.

Task Scheduler rather than the alternatives:

- **Not a long-running Node scheduler.** It would be a process somebody has to
  keep alive. AGENTS.md records the `stable` server dying three times because it
  was owned by a session that later let go of it. A backup that stops when a
  terminal closes stops on the day nobody notices.
- **Not GitHub Actions.** It cannot reach `127.0.0.1:5433`. A schedule that
  cannot see the database is not a schedule.
- **Task Scheduler** is part of the operating system, survives a reboot, runs
  with no session logged in, and has the property a daily job on a desktop
  actually needs: `-StartWhenAvailable` runs a missed occurrence once the
  machine is back rather than skipping the day. A desktop is off or asleep at
  03:30 often enough that a scheduler without that would silently miss most of
  its runs.

The task is registered with `-MultipleInstances IgnoreNew` and a two hour limit,
so a run that hangs cannot pile up behind itself.

## Retention, and what it costs

Two bounds, and both are hard. Whichever bites first wins.

- **At most 14 dumps.** Two weeks: long enough to notice something has been
  quietly wrong for a while, short enough to bound.
- **At most 512 MiB of them.** This is the bound that matters on this machine,
  where free disk has twice dropped under 2 GB in a day. A backup scheme that
  fills a disk turns one problem into two.

Measured, on a scratch catalogue built to the size of the live one (236 books,
281 captures, 263 author filings, 11 separators):

```
size                28 KiB
retained            1 dumps, 28 KiB
```

So fourteen daily dumps is about **400 KiB**. The 512 MiB cap is not a limit the
catalogue is anywhere near; it is there so that a catalogue that grows by a
factor of a thousand still cannot fill the disk without somebody being told.

The newest dump is never deleted to satisfy the size cap, however large it gets.
Deleting the only copy of the catalogue to satisfy a disk budget is worse than
every outcome the disk budget exists to prevent. It is reported instead:

```
WARNING: the only dump is 900 MiB, over the 512 MiB cap. It was kept: deleting
the last copy of the catalogue to satisfy a disk budget is the worse outcome.
Raise --max-mb.
```

A run also **refuses to start** when the volume has less than 1 GiB free
(`--min-free-mb`), because a half-written dump beside a full disk is worse than
no new dump at all.

## The verification

```
npx tsx server/backup-catalogue.ts --verify-only --scratch <connection> --dir <path>
```

It creates a scratch database on the scratch server, restores the dump into it
with `pg_restore --single-transaction --exit-on-error`, compares, and drops it.
The database is named `bookscan_verify_<random>` so that one found after a crash
is obviously safe to drop.

**The scratch server must not be the live server.** The verification creates and
drops databases, and none of that belongs beside the catalogue.
`install-backup-task.ps1` refuses to register a task where the two connections
are the same string.

### What it compares, and why counts are not enough

| Line | The claim |
| --- | --- |
| `<table> rows` | Row counts, per table. Catches a restore that lost rows. |
| `<table> content` | A digest of the *set* of rows, each row cast to text and hashed. Sensitive to type as well as value, so a number that arrived as a string changes it. Independent of physical row order and of collation, so it does not fire spuriously on a restore that inserted in a different sequence. |
| `shelf order` | `md5(string_agg(id::text, ',' order by sort_key, id))` on both sides. **This is the collation check.** |
| `divider order` | The same for `separators.starts_at`, the other `COLLATE "C"` column. An ordering difference too small to change the book list can still move one book past a divider. |
| `collation` | `datcollate` on both sides. A database restored under a different collation is not the same database. |

The shelf order line is the reason this is not just a row count. **A count does
not move when a collation does.** A collation difference does not lose a book,
it reorders them, and the app then tells somebody to put a book in the wrong
place. `books.sort_key` is declared `COLLATE "C"` for exactly this reason (see
`SORT_KEY_COLUMNS` in `web/server/db.pg.ts`) and this is how the declaration is
proved to have survived a round trip rather than assumed to have.

### It has been seen to fail

Both of these were produced against a scratch Postgres, not against the
catalogue.

**A dump truncated on disk after it was written:**

```
  pg_restore exited 1
    pg_restore: error: could not read from input file: end of file

  VERIFICATION FAILED for bookscan-20260806T222911Z.dump. This dump is not a backup.
```

**A restore that lost `COLLATE "C"` from `books.sort_key`.** Every count
matches. Every content digest matches. Nothing but the shelf order moved:

```
  table               dumped  restored  digest(dumped)  digest(restored)
  ------------------------------------------------------------------------
  books                236       236  7316ecc4d6d6    7316ecc4d6d6
  book_authors         266       266  707a91383e8b    707a91383e8b
  captures             281       281  234a1cf4fb06    234a1cf4fb06
  separators            11        11  2af10a19f522    2af10a19f522
  author_filing        263       263  30d5eeaaf663    30d5eeaaf663
  shelf_ranges           2         2  2fe19a188933    2fe19a188933

  shelf order         9ede898a64fcd70cacdfc1f0927d9323  719a2f4c3fad76d03eeeb2878fe459df

  DIFFERENCES
  ------------------------------------------------------------------------
  shelf order         dumped 9ede898a64fcd70cacdfc1f0927d9323
                      restored 719a2f4c3fad76d03eeeb2878fe459df

  VERIFICATION FAILED for bookscan-20260806T222802Z.dump. This dump is not a backup.
```

A check that compared only counts would have called that restore good. That
comparison is guarded by `server/backup.pg.test.ts`, which reproduces it against
a real Postgres on every run of the suite.

The exit code is non-zero on both, and the wrapper logs `FAILED` and stops. A
run that dumped but did not verify also exits non-zero, on purpose:

```
  NOT VERIFIED: no --scratch server given, so nothing was restored.
  An unrestored dump is a hypothesis. Pass --scratch to prove it.
```

## Nothing here writes to the source

- The dump opens one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`
  transaction. `READ ONLY` is on top of a tool that only reads, so the server
  refuses a write on that connection rather than the code being trusted not to
  send one.
- The digest is six counts, two aggregates and one catalogue lookup.
- The verification never connects to the source at all. It restores into a
  scratch database on a different server and drops it.
- The live container is never used as the runner. `docker exec` into it would
  work and is refused on purpose: it puts a scheduled job inside the process
  namespace of the thing it is meant to be protecting.
- **`ConnectionStrings__bookscan` is not read.** The source is named on the
  command line or in `BOOKSCAN_BACKUP_SOURCE`, and in nothing else. This is the
  same rule the migration tool and the test harness follow, for the same reason:
  a connection string sitting in a shell must not be able to decide which
  catalogue a scheduled job touches.

## The client tools run in a container

There is no `pg_dump` on this machine. Postgres only ever arrived here as an
image, so the tool runs `pg_dump` and `pg_restore` out of `postgres:18.3` with
`docker run --rm -i`, streaming rather than bind-mounting a Windows path.

Two consequences:

- A container cannot reach `127.0.0.1` on the host, so a loopback host is
  rewritten to `host.docker.internal`.
- The password is passed by name (`docker run -e PGPASSWORD`) rather than by
  value, so it is never in an argument vector anything with a process listing
  can read.

**The image major version must be at least the server's.** `pg_dump` refuses a
server newer than itself. The tool checks before it starts rather than
discovering it a week into a schedule, and names the fix:

```
The client image postgres:17 is Postgres 17 and the server is 18. pg_dump
refuses a newer server. Pass --image with a tag at least as new.
```

`--runner local` uses `pg_dump` from `PATH` instead, if it is ever installed.

## The container is not the backup

The live catalogue is in a named Docker volume. A named volume survives a
container restart, and it does not survive `docker volume rm`, a disk failure,
or losing the machine.

**A dump written to the same disk as the volume shares the fate of the volume.**
It protects against a dropped table, a bad migration and a `docker volume rm`.
It does not protect against the disk or the machine, which are the two failures
that would cost the whole collection.

**One of those two is now covered.** The dumps and the photographs go to `E:`,
which is a different physical disk from the one the volume is on, not another
partition of it:

```
Get-Partition | Where-Object DriveLetter -in 'C','E' |
  Select-Object DriveLetter, DiskNumber

DriveLetter DiskNumber
----------- ----------
          C          2      WDS500G3X0C, NVMe, 466 GB
          E          1      Samsung SSD 870 EVO 1TB, SATA, 932 GB
```

**The other is not, and that is the honest state of this.** Both disks are in
one machine, on one power supply, in one room. A theft, a fire or a flood takes
the catalogue and every copy of it together. Getting the directory off the
machine, on whatever cadence the owner already trusts, is the remaining step and
it is step 6 below.

## Wiring it to production

**This is installed and running.** The steps are kept because they are how it
would be rebuilt, not because anything below is outstanding except step 6.

What is registered, read back from Task Scheduler on 2026-08-07:

| | |
| --- | --- |
| Task | `book-scan catalogue backup`, daily 03:30 |
| Backups | `E:\book-scan-backups`, keep 14 dumps or 512 MiB, refuse under 1 GiB free |
| Photographs | `C:\Users\Blake\book-scan-production-data\live\covers` mirrored to `E:\book-scan-covers` |
| Last run | 2026-08-07 03:30, result 0, ending `RESTORED AND VERIFIED` |

The connections are on the task, not in the command line, so neither the source
nor the scratch server appears above. Read the current state with
`Get-ScheduledTask -TaskName 'book-scan catalogue backup'` and
`Get-ScheduledTaskInfo` rather than trusting this table, which is a snapshot.

**There is an abandoned directory at
`C:\Users\Blake\book-scan-production-data\pg-backups\`** holding one dump from
2026-08-06, taken by hand during stage H before the schedule existed. It is not
maintained, nothing sweeps it, and it is not a backup of anything current. It
is also under the production data path, so it is not an agent's to tidy.

The owner runs this. It needs the live connection string.

1. **Start a scratch Postgres for the verification.** It must not be the live
   server, and it should be built the same way, or the restore is proving
   something about a different kind of database. The live server is
   `postgres:18.3` with `en_US.utf8`:

   ```
   docker run -d --name book-scan-verify-pg -e POSTGRES_PASSWORD=<pick one> \
     -p 127.0.0.1:55432:5432 postgres:18.3
   ```

2. **Run it once by hand and read what it prints.** Do not register a schedule
   for something nobody has watched run.

   ```
   cd web
   npx tsx server/backup-catalogue.ts \
     --source 'postgres://postgres:<live password>@127.0.0.1:5433/bookscan' \
     --scratch 'postgres://postgres:<scratch password>@127.0.0.1:55432/postgres' \
     --dir 'D:\book-scan-backups'
   ```

   It should end `RESTORED AND VERIFIED`. If it does not, stop.

3. **Register the schedule.**

   ```
   pwsh -File scripts/install-backup-task.ps1 `
     -Source  'postgres://postgres:<live password>@127.0.0.1:5433/bookscan' `
     -Scratch 'postgres://postgres:<scratch password>@127.0.0.1:55432/postgres' `
     -BackupDir 'D:\book-scan-backups'
   ```

   The two connections go into machine environment variables named
   `BOOKSCAN_BACKUP_SOURCE` and `BOOKSCAN_BACKUP_SCRATCH`, so they are not in
   the task's command line. Nothing else on the machine reads either name.

4. **Force one scheduled run**, so the schedule itself is exercised rather than
   only the script:

   ```
   Start-ScheduledTask -TaskName 'book-scan catalogue backup'
   Get-Content D:\book-scan-backups\logs\backup-*.log -Tail 40
   ```

5. ~~**Decide about the photographs**~~ **Done.** The task carries
   `-CoversSource` and `-CoversDestination`, and mirrors the covers to `E:` on
   every run with `robocopy`. The log says `covers: copied (robocopy 0)` when it
   worked and names the exit code when it did not.

6. **Get the backup directory off the machine**, and record here how. **Still
   open.** `E:` is a different disk but the same machine, so this covers a disk
   failure and not a fire. Nothing about the current setup is wrong; it is
   simply not finished, and the gap is worth naming rather than rounding off,
   because "there are verified nightly backups" reads like the whole answer.

## When it fails

The log is `<BackupDir>\logs\backup-<yyyymmdd>.log`. The last line of a good run
is `done`.

- **`pg_restore: error: ...`** The dump is damaged. The previous day's dump is
  still there and has its own manifest; verify that one:
  `--verify-only --file <name>`.
- **A `shelf order` difference with matching counts.** A collation problem.
  Check that `COLLATE "C"` is still on the four columns in
  `SORT_KEY_COLUMNS`, and that the scratch server is built like the live one.
- **`Refusing to dump: ... below the ... floor`** The disk is full. Free space.
  Do not lower `--min-free-mb` to get past it.
- **A `.part` file in the directory.** An interrupted run. It is not counted as
  a dump and nothing will restore from it. Delete it.

## Restoring for real

The verification is a rehearsal of exactly this, every day, so the steps are
already known to work.

1. Stop the app.
2. Create the target database with the collation and encoding in the manifest:
   `CREATE DATABASE bookscan TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.utf8' LC_CTYPE 'en_US.utf8'`.
3. `pg_restore --no-owner --no-privileges --single-transaction --exit-on-error`
   the chosen dump into it.
4. Compare against the manifest before believing it. The digest is in the
   `.json` beside the dump, in the form the verification prints.
5. Put the photographs back from wherever they are covered.
6. Start the app and look at the library: the shelf order, the queue, and one
   book's photographs.

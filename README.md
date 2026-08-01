# book-scan

Catalogue a physical book collection from a live camera feed. Hold a book up
to the camera, turn it over, check the details, press the right arrow. Repeat
until the shelves are empty.

## Running it

The project is managed with [uv](https://docs.astral.sh/uv/). From the
project directory:

```
uv run book-scan
```

That is the whole thing. uv creates the virtual environment, installs
everything from the lockfile, and launches the app. The first run takes a
few seconds; after that it starts immediately.

Equivalent, if you prefer to see the entry point:

```
uv run run.py
```

Other useful commands:

| Command | What it does |
| --- | --- |
| `uv sync` | Install or repair the environment without running anything |
| `uv sync --upgrade` | Re-resolve dependencies to their newest allowed versions |
| `uv run tests/test_core.py` | ISBN maths, detection, shutter, database |
| `uv run tests/test_recognition.py` | OCR, barcode decoding, online lookups |
| `uv run tests/test_app_flow.py` | The whole capture to save flow, headless |
| `uv run tests/test_layout.py` | Window sizing, guards against the preview growing |
| `uv run tests/test_migrations.py` | Schema upgrades, backups, rollback, data retention |
| `uv add <package>` | Add a dependency and update the lockfile |
| `uv export -o requirements.txt` | Produce a pip-style requirements file if you ever need one |

Dependencies live in `pyproject.toml` and are pinned in `uv.lock`. Commit
both. There is deliberately no `requirements.txt`, so there is only one
source of truth.

Tesseract is the one thing uv cannot install for you, because it is a
program rather than a Python package. On Windows:

```
winget install UB-Mannheim.TesseractOCR
```

The app finds it on PATH or in the standard `C:\Program Files\Tesseract-OCR`
location automatically. If Tesseract is missing the app still runs, and
barcode scanning still works, but titles will not be read from covers.

## How a scan goes

1. Pick your camera from the dropdown at the top.
2. Hold the **front** cover up. When the outline turns green and holds for
   about a second, it captures and beeps.
3. Turn the book over. It re-arms as soon as the picture changes, then
   captures the **back**.
4. It decodes the barcode, falls back to OCR if there is no barcode, and
   confirms against Open Library.
5. Check the fields, correct anything wrong, press the **right arrow**.

## Keys

| Key | Action |
| --- | --- |
| Right arrow | Save and move to the next book |
| Ctrl + Right | Save, even while the caret is in a text field |
| R | Retake both covers |
| F | Retake the front only |
| B | Retake the back only |
| D | Discard this book |
| Space | Capture now, without waiting for auto-detect |
| E | Export the catalogue to CSV |
| Ctrl + Q | Quit |

Click a field to edit it, then press Enter or Escape to leave it. The letter
shortcuts are ignored while you are typing, so they will not fire mid-edit.

## What gets saved

- `books.db` is the catalogue, a SQLite database. This is the real record.
- `captures/` holds the front and back JPEGs, named by timestamp and ISBN.
- `backups/` holds automatic pre-migration copies of the database.
- `books.csv` is written on demand with the Export CSV button or the E key.

Images are only written when you accept a book, so discarded scans leave
nothing behind. Re-scanning an ISBN you already have raises a warning and
asks before saving a second copy, so you can stop and skip it or record it
deliberately as a duplicate.

## Data safety

The catalogue is entered by hand once and retyping it is not an option, so
the storage layer is built around never losing a row.

**Nothing is ever deleted.** `Store.delete` sets a `deleted_at` timestamp and
leaves the row and its cover images exactly where they were. Deleted books
drop out of the count and out of duplicate matching, and `Store.restore`
brings them straight back. There is no code path anywhere in the app that
issues a `DELETE`.

**Durability.** The database runs in WAL mode with `synchronous = FULL`, so
an accepted book is on disk before you scan the next one. A crash or power
cut costs you nothing already saved. Closing the app checkpoints the WAL back
into `books.db`, so a copied file is always complete.

**Automatic backups.** Before any migration runs, the whole database is
copied into `backups/` using SQLite's online backup API, named
`books-<timestamp>-v<from>-to-v<to>.db`. Backups are never pruned. You can
also take one at any time with `Store.backup_now()`.

**Startup checks.** Opening the catalogue runs an integrity check, verifies
that no already-applied migration has been edited, and refuses to open a
database written by a newer version of the app. Any of these failing stops
the app with a plain-language message instead of touching your data.

## Migrations

Schema changes go through `bookscan/migrations.py`. The database tracks its
version in SQLite's `user_version`, and every applied migration is recorded
in a `schema_migrations` table with a checksum and a timestamp.

To add functionality later, append a new `Migration` with the next version
number:

```python
Migration(
    version=3,
    name="add_shelf_location",
    statements=(
        "ALTER TABLE books ADD COLUMN shelf TEXT",
        "CREATE INDEX IF NOT EXISTS idx_books_shelf ON books (shelf)",
    ),
),
```

Then add the column to `INSERT_COLUMNS` in `store.py` if the app should write
to it. The next launch upgrades the database automatically and prints what it
applied.

The rules the system enforces for you:

- **Append only.** Never renumber or edit a migration that has already run.
  Migrations are checksummed, and an edited one is detected and refused
  rather than silently producing a database that does not match its version.
- **Additive only.** `DROP TABLE`, `DELETE FROM`, `DROP COLUMN` and
  `ALTER TABLE ... RENAME` are rejected by a guard before anything executes.
  A migration that genuinely needs one must set `allow_destructive=True`,
  which is a deliberate decision rather than an accident.
- **All or nothing.** Each migration runs in its own transaction. If it fails
  halfway, it rolls back completely, the version stays where it was, and the
  app tells you which backup to look at. Partial upgrades cannot happen.
- **Version gated.** Migrations run once and only once, in order.

A database created before this system existed is adopted automatically: it
reports version 0, gets backed up, and is brought up to the current version
with its rows untouched. This path is covered by the test suite.

## Where the data comes from

Open Library is the primary source for both ISBN lookups and title searches.
Google Books is used only to fill in a missing publisher or page count, and
as a last-resort fallback, because its anonymous quota is per-IP and starts
returning HTTP 429 well before a full shelf is done. Nothing depends on it.

If you want the Google top-up to work reliably, put a key in `settings.json`:

```json
{ "google_api_key": "..." }
```

## Tuning

Every threshold lives in `bookscan/config.py`. Override any of them without
touching code by creating `settings.json` next to `run.py`. The ones worth
reaching for first:

| Setting | Effect |
| --- | --- |
| `stable_frames` | How long the book must hold still. Lower is snappier, higher is steadier. |
| `min_area_ratio` | How much of the frame the book must fill. Lower it if you hold books further back. |
| `min_sharpness` | Blur rejection. Raise it if you get soft captures, lower it in dim rooms. |
| `rearm_diff` | How much the picture must change before the next capture arms. Raise it if flipping a book triggers a double capture. |
| `lookup_enabled` | Set false to work entirely offline. |

Example `settings.json`:

```json
{
  "stable_frames": 10,
  "min_area_ratio": 0.08,
  "beep_on_capture": false
}
```

## Layout

```
pyproject.toml         dependencies and the book-scan entry point
uv.lock                pinned versions, commit this
run.py                 entry point
tests/                 three runnable suites, no camera needed
bookscan/config.py     all tunable settings
bookscan/camera.py     device enumeration, background frame grabber
bookscan/detect.py     book detection and the auto-capture shutter
bookscan/recognize.py  barcode decoding, OCR, ISBN validation
bookscan/lookup.py     Open Library and Google Books
bookscan/migrations.py schema versions, backups, the additive-only guard
bookscan/store.py      SQLite catalogue and CSV export
bookscan/app.py        the Tk interface
```

## Notes

Lighting matters more than resolution. A book against a plain, contrasting
background detects far more reliably than one against a bookshelf, because
detection works on edges. If auto-detect struggles on a particular book, just
press space.

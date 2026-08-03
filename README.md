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
| `uv run tests/test_core.py` | ISBN maths, OCR text parsing, database, live lookups |
| `uv run tests/test_recognition.py` | OCR, barcode decoding, online lookups |
| `uv run tests/test_app_flow.py` | The whole capture to save flow, headless |
| `uv run tests/test_shelving.py` | Filing surnames, fiction guess, ordering, placement |
| `uv run tests/test_layout.py` | Window sizing, guards against panes growing |
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
2. Hold the **front** cover up and press **space**.
3. Turn the book over and press **space** again for the **back**.
4. Show the **spine** and press **space** once more. Press **S** to skip it
   if the spine is unreadable.
5. It decodes the barcode, falls back to OCR if there is no barcode, and
   confirms the result against Open Library.
6. The right hand panel says which two books it goes between and shows
   their spines. Put the book there.
7. Type the **area** you put it in, then press the **right arrow**.

Capture is manual on purpose. Automatic detection was tried and thrown out:
it fired on the wrong thing often enough to be slower than just pressing a
key.

The preview warns when the shot is too soft to read fine print. Focus is the
single biggest factor in whether the ISBN comes out, so it is worth waiting
for that warning to clear before pressing space.

### When no ISBN is found

Press **I** to jump to the ISBN box, type the number, and press **Enter**.
The lookup runs again and fills in the rest.

This is also where your **USB barcode scanner** earns its keep. A scanner is
just a keyboard: it types the digits and presses Enter for you. Press I,
scan the back of the book, and the record fills itself in. That path is far
more reliable than reading a barcode through a webcam, so if the camera is
struggling on a particular book, reach for the scanner rather than fighting
it.

If OCR saw something that looked like an ISBN but could not confirm it, it
is offered as a suggestion in the warning line rather than filled in. Check
it against the book before typing it.

## Keys

| Key | Action |
| --- | --- |
| Space | Capture the front, then the back, then the spine |
| S | Skip the spine while capturing, retake it while reviewing |
| Right arrow | Save and move to the next book |
| Ctrl + Right | Save, even while the caret is in a text field |
| I | Jump to the ISBN box, ready to type or to scan into |
| A | Jump to the area box, after you have shelved the book |
| Ctrl + L | Look up whatever is in the ISBN or title box |
| U | Recompute where the book goes |
| R | Retake all three photographs |
| F | Retake the front only |
| B | Retake the back only |
| D | Discard this book |
| E | Export the catalogue to CSV |
| Ctrl + Q | Quit |

Click a field to edit it, then press Enter or Escape to leave it. The letter
shortcuts are ignored while you are typing, so they will not fire mid-edit.

## What gets saved

- `books.db` is the catalogue, a SQLite database. This is the real record.
- `captures/` holds the front, back and spine JPEGs, named by timestamp,
  ISBN and which face they show.
- `backups/` holds automatic pre-migration copies of the database.
- `books.csv` is written on demand with the Export CSV button or the E key.

Images are only written when you accept a book, so discarded scans leave
nothing behind. Re-scanning an ISBN you already have raises a warning and
asks before saving a second copy, so you can stop and skip it or record it
deliberately as a duplicate.

## Shelving

Four shelves. **S1, S2 and S3 hold fiction**, filling in that order.
**S4 holds non-fiction.** Each shelf is divided into lettered areas, which
you label however suits the furniture.

Books are filed by **author surname**, then by **series**, then by
**position within the series**, then by title. An author's standalone books
come before their series, so a run of standalones is followed by each series
in order.

The app never guesses the area, because it cannot see how wide the books
are. What it does instead is tell you the **two books yours belongs
between**, show you **their spines**, and tell you **where they currently
are**. You walk to that spot, slide the book in, and type the area you used.
That area is stored on the book and is what makes it findable later.

### What the panel tells you

- **Which two books it goes between**, with title, author, and their current
  shelf and area.
- **Their spine photographs**, so you can spot them on the shelf without
  pulling books out to read covers. If a book has no spine photo, its front
  cover is shown instead.
- **The suggested shelf**, inherited from its neighbours. When the two
  neighbours sit on different shelves, that is called out explicitly so you
  can decide whether to start the next shelf.
- **Its position**, as in "book 34 of 51 in this section".

### Things worth knowing

**Only shelved books are used as landmarks.** A book saved without a shelf
and area has been catalogued but not placed, so it cannot be a signpost. If
you save without an area the app asks first, since it quietly weakens the
guidance for every later book.

**Surnames are worked out for you, and you can correct them.** "Ursula K.
Le Guin" files under LE GUIN, "Ludwig van Beethoven" under VAN BEETHOVEN,
"Martin Luther King Jr." under KING, and a credit already written as
"Tolkien, J.R.R." is understood as such. Multiple authors file under the
first. When it gets one wrong, edit the **Sort as** field and press Enter.

**Fiction is guessed from the catalogue's subject terms** and shown as a
checkbox. Ticking or clearing it immediately re-plans the placement, which
is how a book moves between S1-S3 and S4. When there is nothing to go on it
assumes fiction, since that is the larger part of most collections.

**Series data is filled in when the catalogues have it**, which is often
enough to be worth having and rarely enough that you should expect to type
it. Both the series name and the number are editable, and changing either
re-files the book.

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
    version=4,
    name="add_condition",
    statements=(
        "ALTER TABLE books ADD COLUMN condition TEXT",
        "CREATE INDEX IF NOT EXISTS idx_books_condition "
        "ON books (condition)",
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
| `frame_width` / `frame_height` | Capture resolution, 1920x1080 by default. The single most important setting for whether OCR can read an ISBN. Do not lower it. |
| `min_sharpness` | When the preview warns about soft focus. Raise it to be fussier, lower it in a dim room. It never blocks a capture. |
| `lookup_enabled` | Set false to work entirely offline. |
| `beep_on_capture` | Turn the shutter beep off. |

Example `settings.json`:

```json
{
  "min_sharpness": 60,
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
bookscan/recognize.py  barcode decoding, OCR, ISBN validation
bookscan/shelving.py   filing surnames, fiction guess, placement
bookscan/lookup.py     Open Library and Google Books
bookscan/migrations.py schema versions, backups, the additive-only guard
bookscan/store.py      SQLite catalogue and CSV export
bookscan/app.py        the Tk interface
```

## Why the ISBN sometimes will not read

ISBN print is small. In a 1080p frame, at a comfortable arm's length, the
digits land around ten to fourteen pixels tall, which is right at the edge of
what Tesseract can do. So:

- **Fill the frame with the book.** Closer is better than further. This
  matters more than lighting.
- **Wait for the soft-focus warning to clear.** Most webcams hunt for focus
  for a moment after you move.
- **Avoid glare.** A glossy cover under a ceiling light washes out the exact
  strip the digits sit in.

Recognition only trusts a number printed next to the word ISBN. An
unlabelled run of digits is reported as a suggestion but never saved. This is
deliberate and was set by measurement: on degraded frames, accepting
unlabelled numbers produced ISBNs that were plainly wrong yet still passed
their check digit, and a silently wrong ISBN is worse than a blank field you
can fill in yourself. Books with no printed ISBN label almost always carry a
barcode, which is decoded before OCR is ever reached.

If you press **Diagnostics** in the top bar you get the whole story for the
last book: whether Tesseract and the barcode library loaded, the camera
resolution actually in use, every OCR pass that was attempted and how much
text it read, and the raw text off both covers. That is the fastest way to
tell whether OCR is failing or simply finding nothing.

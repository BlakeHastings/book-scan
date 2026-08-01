# Shelving algorithm

How a freshly scanned book turns into "put this one between X and Y".

Status: design only. Nothing here is implemented yet.

## Scope

The existing app captures a book and writes a row to `books`. This document
covers what happens next: deciding where the book belongs on the physical
shelves, and telling the user in one line.

Deliberately **not** in scope, per decisions below:

- Shelf capacity, spine widths, fill ratios.
- Computing shift cascades ("move these 6 books right").
- Bulk layout planning for an already-owned collection.

## Decisions

1. **Start from empty, sort as we go.** No books are catalogued yet. Each scan
   is placed relative to the books already recorded. The collection grows one
   book at a time and there is no initial bulk pass.
2. **Capacity is not modelled.** The system never claims a book *must* go in a
   given section. It names the two neighbours; the user places the book and
   records where it actually landed. If a shelf fills up, the user puts the
   book on the next one and records that.
3. **Within an author:** series first in series order, then standalone titles
   alphabetically.
4. **Fiction and non-fiction are separate ranges.** Shelf 4 (`S4`) is
   dedicated to non-fiction. The two ranges are independent ordered lists and
   never interact.

Consequence of 1 and 2 together: location is *descriptive*, not
*prescriptive*. Sort order is the source of truth for sequence; the recorded
location is the source of truth for where the book physically is. The two are
kept honest by a consistency check (see [Misfile detection](#misfile-detection)).

## The core algorithm

Given a new book `B`:

```
1. range   = fiction | nonfiction                     (see Classification)
2. key     = sort_key(B)                              (see Sort key)
3. pred    = last book in `range` with key < B.key
   succ    = first book in `range` with key > B.key
4. render the placement instruction from (pred, succ)
5. suggest a location, user confirms or overrides
6. save the book with its recorded location
7. run the consistency check on `range`
```

Steps 3 is two indexed queries, not a scan, because the sort key is stored
flattened as a single comparable `TEXT` column:

```sql
-- predecessor
SELECT * FROM books
 WHERE range = :range AND sort_key < :key
 ORDER BY sort_key DESC LIMIT 1;

-- successor
SELECT * FROM books
 WHERE range = :range AND sort_key > :key
 ORDER BY sort_key ASC LIMIT 1;
```

With `CREATE INDEX idx_books_shelf ON books (range, sort_key)` both are instant
at any collection size this will ever reach.

### Rendering the instruction

Five cases. `Lp` and `Ls` are the predecessor's and successor's locations.

| Case | Message |
| --- | --- |
| pred and succ share a location | **1A** &mdash; between *Wizard of Earthsea* (Le Guin) and *Lathe of Heaven* (Le Guin) |
| pred and succ differ | After *Snow Crash* (Stephenson, **2C**), before *Player of Games* (Banks, **2D**). Boundary of 2C/2D. |
| no pred | First in fiction. Before *Adams, Douglas* at **1A**. Start of shelf 1. |
| no succ | Last in fiction. After *Zusak, Markus* at **3B**. End of shelf 3. |
| neither | First book in this range. Start at **1A** (fiction) or **S4** (non-fiction). |

Always name author and title for both neighbours, not just the title. On a
real shelf the user is scanning spines for an author block first.

### Suggested location

`pred.location`, falling back to `succ.location`, falling back to the range's
configured start. The user can always override. When `pred.location !=
succ.location` the suggestion is a coin flip, so present both and let the user
pick which side of the boundary the book actually went.

## Sort key

Within a range, the ordering tuple is:

```
(author_filing, has_series, series_name, series_index, title_filing)
```

`has_series` is `0` for series books and `1` for standalones, which puts an
author's series blocks ahead of their standalone titles, as decided.

> If you later prefer series interleaved at their alphabetical position rather
> than grouped up front, drop `has_series` from the tuple and set
> `series_name` to the title for standalones. That is the only change needed.

### Flattening

The tuple is joined into one string with `\x1f` (unit separator), which sorts
below every character that survives normalisation, so string comparison on the
whole key reproduces tuple comparison exactly.

```
LE GUIN URSULA K␟0␟EARTHSEA␟000001.000␟WIZARD OF EARTHSEA
```

All components are normalised to `[A-Z0-9 ]` first, so SQLite's default
`BINARY` collation is correct and deterministic. Do not use `NOCASE` (ASCII
only, and redundant here) and do not require the ICU extension.

### Normalisation

Applied to every text component:

1. Unicode NFKD, then drop combining marks. `Böll` becomes `Boll`.
2. Uppercase.
3. Drop everything outside `A-Z`, `0-9`, and space.
4. Collapse runs of whitespace, trim.
5. Zero-pad digit runs to 6 characters, so `Book 2` sorts before `Book 10`.

Space (`0x20`) sorting below every letter is load-bearing: it makes `SMITH ANN`
come before `SMITHSON A`, which is what you want.

### Author filing name

The filing author is the **first-listed** author. This is the one place the
current schema actively fights us: `books.authors` is a comma-joined display
string, and comma is both the separator between authors and the separator
inside a `Last, First` form. See [Schema changes](#schema-changes).

```python
PARTICLES = {"van","von","de","del","della","der","den","di","da","du","das",
             "dos","la","le","las","los","lo","ter","ten","af","av","bin",
             "ibn","al","el","st","saint","mac","mc"}
SUFFIXES  = {"jr","sr","ii","iii","iv","phd","md","dds","esq"}
HONORIFICS= {"dr","prof","sir","dame","lady","lord","rev","fr"}

def filing_name(display: str) -> str:
    if override_exists(display):
        return override
    tokens = clean(display).split()          # strips (), [], collapses space
    while tokens and bare(tokens[0]) in HONORIFICS:
        tokens.pop(0)
    suffix = []
    while tokens and bare(tokens[-1]) in SUFFIXES:
        suffix.insert(0, tokens.pop())
    if not tokens:
        return ""
    if len(tokens) == 1:
        return tokens[0]                     # mononym: Homer, Voltaire
    i = len(tokens) - 1
    while i > 0 and bare(tokens[i - 1]) in PARTICLES:
        i -= 1                               # absorb particles into surname
    last, first = " ".join(tokens[i:]), " ".join(tokens[:i])
    out = f"{last}, {first}" if first else last
    return f"{out} {' '.join(suffix)}" if suffix else out
```

Worked examples:

| Input | Filing name | Correct? |
| --- | --- | --- |
| `Ursula K. Le Guin` | `Le Guin, Ursula K.` | yes |
| `J. R. R. Tolkien` | `Tolkien, J. R. R.` | yes |
| `Tim O'Brien` | `O'Brien, Tim` | yes |
| `Homer` | `Homer` | yes |
| `Martin Luther King Jr.` | `King, Martin Luther Jr.` | yes |
| `Gabriel García Márquez` | `Márquez, Gabriel García` | **no**, should be `García Márquez` |
| `Ludwig van Beethoven` | `van Beethoven, Ludwig` | debatable, convention files under `B` |

The last two are the known limits. Spanish compound surnames are not
separable from middle names by any heuristic, and the Dutch/German particle
convention contradicts the Anglo-American one that `Le Guin` needs. Both are
handled the same way: a manual override.

**Therefore an author override table is mandatory, not optional.** Any design
that tries to get this fully right in code is wrong. Store the corrected
filing name once per author and reuse it forever.

Also needing overrides:

- **Corporate authors** (`National Geographic Society`) file as printed, no
  comma inversion.
- **Pseudonyms.** `Robert Galbraith` and `J. K. Rowling` are one person;
  `Richard Bachman` and `Stephen King` likewise. Default is to file as
  printed. If she wants them shelved together, the override table is the
  mechanism: point both at one canonical filing name.
- **Anthologies and edited volumes**, where `authors` is blank or `Various`.
  Fall back to the editor, then to the title.

### Title filing name

Strip a leading article before normalising: `The`, `A`, `An`. Add
`Le/La/Les/L'`, `El/Los/Las`, `Der/Die/Das` only if there are foreign-language
books on the shelves.

Note that `lookup.py` currently concatenates title and subtitle into one
`title` field (`lookup.py:96` and `lookup.py:126`). Sorting on the combined
string is mostly harmless but does mean a long subtitle can affect ordering
between two similarly titled books. Splitting them is cheap and worth doing at
the same time as the other schema work.

### Series

`series_index` is stored as `REAL` and formatted `%010.3f`, so novellas at
`5.5` sort between books 5 and 6.

Series metadata is the weakest link. Neither lookup path currently requests
it:

- Open Library's `jscmd=data` response (what `lookup.py` uses) does **not**
  reliably include series. The edition record at
  `https://openlibrary.org/isbn/{isbn}.json` has a `series` array, but it is
  free text: `"Discworld ; 5"`, `"The Wheel of Time #3"`, `"Discworld"`. It
  costs one extra request per book.
- Google Books' `volumes` API does not expose series in a usable form.

Realistically expect series to resolve automatically for well under half the
collection. Parse with a regex for a trailing number after `#`, `;`, `no.`, or
`bk.`, and surface **series name and number as editable fields in the review
pane**. Manual entry is the primary path here, not the fallback.

## Classification: fiction or non-fiction

Because `S4` is the only non-fiction shelf, a wrong guess sends the book to an
entirely different bookcase. This must never be silent.

The good news: two of the three useful signals are **already present in
responses the current code discards**.

| Signal | Where | Currently |
| --- | --- | --- |
| `volumeInfo.categories` | Google Books, already fetched | ignored |
| `subjects` | Open Library `jscmd=data`, already fetched | ignored |
| `dewey_decimal_class`, `lc_classifications` | OL edition/work record | not fetched |

Precedence ladder, first match wins:

1. Google `categories[0]` begins `Fiction` or `Juvenile Fiction` → fiction,
   **high**. Begins anything else (`History`, `Biography & Autobiography`,
   `Science`, `Self-Help`, `Juvenile Nonfiction`) → non-fiction, **high**.
   This is BISAC-derived and is by far the most precise signal.
2. OL `subjects` contains `Fiction`, `Novel`, or `Novels` → fiction,
   **medium**.
3. OL `subjects` contains `Biography`, `History`, `Cookbooks`, `Handbooks,
   manuals`, `Self-help` → non-fiction, **medium**.
4. Dewey: `813`, `823`, `833` and the other `8x3` literature-fiction classes →
   fiction, **medium**. `92`, `920`, `B` (biography) and everything outside
   the 800s → non-fiction, **medium**.
5. LC: `PZ` → fiction, **weak**. `PR`/`PS` with no subclass → fiction, very
   weak, treat as unknown.
6. No signal → **unknown**.

Two rules on top:

- If two high-confidence signals disagree, downgrade to unknown and make the
  user decide.
- Regardless of confidence, show the classification in the review pane as a
  two-state toggle with the guess pre-selected. One keystroke to flip it.
  Record `classification_source` as `auto` or `manual` so it is possible to
  audit later which books were never actually looked at.

## Misfile detection

Because locations are user-recorded, they can drift out of agreement with sort
order. The invariant:

> Within a range, when books are ordered by `sort_key`, their location rank
> must be non-decreasing.

Location rank is `(shelf_number, section_letter)` parsed from the label. Any
inversion means either a book is physically in the wrong place or a location
was mistyped. Surface these as a "needs attention" list rather than blocking a
scan.

This is worth building. It is the only thing standing between this system and
slow silent drift, and it costs one query.

### Location label format

Accept `1A`, `S1A`, and `S4`, all parsing to `(shelf:int, section:str)` with
section possibly empty. Sort by shelf number then section string. A bare `S4`
sorts ahead of `S4A`.

### Re-shelving

If a book's author, series, or fiction flag is edited after it was placed, its
position changes and the physical book has to move. Recompute the key on edit,
and if the neighbours changed, add it to the same "needs attention" list with
the new instruction.

## Schema changes

Additions to `books`:

| Column | Type | Notes |
| --- | --- | --- |
| `range` | TEXT | `fiction` / `nonfiction`. Indexed with `sort_key`. |
| `is_fiction` | INTEGER | Redundant with `range` but convenient. |
| `classification_source` | TEXT | `auto` / `manual`. |
| `classification_confidence` | TEXT | `high` / `medium` / `weak` / `unknown`. |
| `author_filing` | TEXT | Derived, overridable. |
| `series_name` | TEXT | |
| `series_index` | REAL | |
| `subtitle` | TEXT | Split out of `title`. |
| `title_filing` | TEXT | Derived. |
| `sort_key` | TEXT | Flattened tuple. Recompute on any edit to its inputs. |
| `location` | TEXT | As recorded by the user, e.g. `1A`. |
| `shelved_at` | TEXT | Null until physically placed. |

New tables:

```sql
-- Ordered authors, so "first-listed author" is unambiguous.
CREATE TABLE book_authors (
    book_id   INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,       -- 1 = filing author
    name      TEXT    NOT NULL,       -- as printed
    PRIMARY KEY (book_id, position)
);

-- The override table. Load-bearing, see Author filing name.
CREATE TABLE author_filing (
    display_name TEXT PRIMARY KEY,    -- normalised form of the printed name
    filing_name  TEXT NOT NULL,       -- what to actually file under
    is_corporate INTEGER NOT NULL DEFAULT 0,
    note         TEXT
);

-- Physical ranges, so shelf assignment is configuration not code.
CREATE TABLE shelf_range (
    range      TEXT PRIMARY KEY,      -- 'fiction' | 'nonfiction'
    start_label TEXT NOT NULL,        -- '1A' | 'S4'
    note       TEXT
);
```

`book_authors` replaces parsing `books.authors` back apart. Keep the joined
`authors` string as the display value, but derive the filing author from
`book_authors` where `position = 1`.

## Integration points

- `bookscan/store.py:10` &mdash; `SCHEMA`. Needs the columns above plus a
  migration, since there is already a `books.db` in use. `PRAGMA user_version`
  is the simplest versioning here.
- `bookscan/lookup.py:94` and `:122` &mdash; `BookRecord` gains `subjects`,
  `categories`, `series`, and `subtitle`. The first two are free; they are
  already in the responses being parsed.
- `bookscan/lookup.py` &mdash; new optional call to
  `openlibrary.org/isbn/{isbn}.json` for series and Dewey. One extra request,
  so make it a setting.
- `bookscan/app.py:467` &mdash; `_populate_review`. Add the fiction toggle,
  series name/number fields, and the filing-name field with its override.
- `bookscan/app.py:513` &mdash; `accept`. Compute the key, find the
  neighbours, and show the placement instruction. This is the "live show the
  user" moment. The instruction should stay on screen until the next capture,
  since the user is walking to a shelf with a book in hand.
- New `bookscan/shelving.py` &mdash; normalisation, filing names,
  classification, key building, neighbour lookup, consistency check. All pure
  functions over data, no UI and no network, so it is directly unit-testable.

## Open questions

1. **Is a "shelf" a bookcase or a single plank?** `1A` reads as shelf 1
   section A, but `S4` dedicated to all of non-fiction suggests `S` is a whole
   unit. This does not change the algorithm, since capacity is not modelled,
   but it does change what the label format should validate.
2. **Foreign-language articles** in title filing: needed or not?
3. **Pseudonyms:** file as printed, or collapse to one canonical author?

# Shelving algorithm

How a freshly scanned book turns into "put this one between X and Y".

Status: implemented. The placement algorithm, the sort key, author filing and
the fiction guess are live in `web/shared/shelving.ts`, and so, since #5, are
**misfile detection** and **re-shelving**, described near the end of this
document. Since #72 an area boundary can also be adjusted by hand, by moving
the first or last book of an area to the plank beside it; see
[Moving a book across an area boundary](#moving-a-book-across-an-area-boundary).

Where this document and the code disagree, this document is the authority and
the code is the bug, unless the owner has decided otherwise in an issue.

Note that the implementation stores `shelf`, `area` and a derived location
rather than the column set sketched under "Schema changes" below, and sorts in
application code rather than through a flattened indexed key. That divergence
was a deliberate simplification, not an oversight.

## Scope

The existing app captures a book and writes a row to `books`. This document
covers what happens next: deciding where the book belongs on the physical
shelves, and telling the user in one line.

Deliberately **not** in scope, per decisions below:

- Shelf capacity, spine widths, fill ratios.
- Computing shift cascades ("move these 6 books right"). This one has since
  been overtaken: a person saying a shelf is full moves one book along and is
  asked again, one answer at a time, and `POST /api/shelves/overflow` is that
  step. Nothing is still *computed*, which is what the decision was about. See
  [Placing a book on a plank that is full](#placing-a-book-on-a-plank-that-is-full)
  for when a book has to move at all.
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
| no pred | First in fiction. Before *Adams, Douglas* at **1A**. Start of bookcase 1. |
| no succ | Last in fiction. After *Zusak, Markus* at **3B**. End of bookcase 3. |
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

### How it is actually checked

`reviewShelving` in `web/shared/shelving.ts` does not compare each book with
the one before it. It compares each book's **recorded** location, which is
whatever a person last confirmed, against its **derived** location, which is
recomputed from sort order and the shelf boundaries every time it is asked.

That is a strictly stronger form of the same invariant, and a kinder one:

- It cannot miss anything the rank check catches. Derived locations are
  non-decreasing by construction, so an inversion among recorded locations is
  impossible unless one of them already disagrees with its derived one.
- It blames the right book. A pairwise rank check flags the second book of an
  inverted pair, so one book on the wrong bookcase gets its innocent successor
  reported instead of itself.
- It names the destination, which is what a list of books to go and move
  needs.

Three cases are excluded rather than reported, and returned separately so the
exclusion is visible instead of silent. A **checked-out** book is off the shelf
and holds no position to disagree with. A book with **no recorded location**
was never confirmed onto a shelf, so there is nothing to compare. A label that
**does not parse** as a location leaves the ranks incomparable.

The check is read only. It never rewrites a location to make a disagreement go
away: the recorded location is the record of where the book physically is, and
a guess written into it is worse than nothing there at all. A location changes
only when a person says the book moved.

### Location label format

Accept `1A`, `S1A`, and `S4`, all parsing to `(shelf:int, section:str)` with
section possibly empty. Sort by shelf number then section string. A bare `S4`
sorts ahead of `S4A`. Comparison is on the parsed rank, not the string, so
`s4 b` and `S4B` are the same plank and not a book to go and move.

### Re-shelving

If a book's author, series, or fiction flag is edited after it was placed, its
position changes and the physical book has to move. Recompute the key on edit,
and if the neighbours changed, add it to the same "needs attention" list with
the new instruction.

This falls out of the check above rather than needing its own path. An edit
recomputes the sort key, which changes the derived location, which no longer
matches the recorded one. The same is true of the other way a book moves
without being touched: marking a shelf full pushes a run of books along, and
every one of them appears on the list until somebody says they were moved.

## A boundary belongs to the area it opens

This document already fixes what a boundary is anchored to: the sort key of the
first book on the new plank (see
[What actually changes](#what-actually-changes)). Which area it *belongs* to
follows from that and had never been written down, so it is written down here:
a boundary belongs to the area it **opens**, not to the one it closes.

Everything that shows a boundary to a person follows the same rule. Its line is
drawn above that area's heading, it is worded as the area it starts ("New
bookcase starts here", "New area starts here"), and Remove on it removes that
area's boundary.

Recorded because the code once disagreed with itself about it (#145). The
layout attached each boundary to the area it opened and the library drew it at
that area's foot, so every line named the heading above it while removing the
boundary of the heading below it. Tapping Remove on the line between 2A and 2B
deleted the bookcase break above 2A, and four books were then reported as
needing to be carried to planks they did not belong on.

The other coherent reading, a boundary belonging to the area it closes, was not
taken because it contradicts the anchor: the boundary is the sort key of a book
on the *new* plank, so the area it closes may hold no book that names it, and an
emptied area would leave the line describing a plank with nothing on it.

## Placing a book on a plank that is full

Capacity is not modelled and never will be (decision 2), so the only signal
that a plank will not take another book is a person standing in front of it
saying so. When they do, there are two answers, and which one is right depends
on where in the plank the book belongs.

**At the end of the plank, the book in your hand is the one that moves.** It
goes to the start of the next plank and nothing already shelved is touched. The
book is already at the boundary, so sliding it across passes no other book and
the sequence is unchanged.

**Anywhere else, a book has to come off the end.** The gap is in the middle, so
something genuinely has to move to open it, and the last book on the plank goes
to the start of the next one. That is the cascade: whether the next plank can
cope is not computable, so the person is asked and the chain walks on one
answer at a time.

The end case used to fall through to the cascade, which produced the same
ordering by handling two books instead of one and putting the displaced one
somewhere it did not need to go. That was #77. It is a special case tried
before the cascade, not a change to the cascade, which is correct where it
applies.

### At the start of a plank

The mirror does not arise. A boundary is anchored to the sort key of the first
book on its plank, so any book landing on that plank sorts at or after the
anchor, which puts it at or after the book the anchor names. A book cannot land
first on a plank whose anchor is a book still on it.

It can land first when the anchor names a book that has since been deleted or
taken off the bookcase, and after a carry, where the anchor is the book still
in somebody's hand. Going back to the previous plank is not the answer in
either case: it is a plank the person was not asked about, and in the second it
would undo the hop just made and ask the same question forever. So the cascade
runs, which is correct: what is needed is a gap on the plank the book belongs
on, and the cascade opens one.

### The end of the last plank

There is no next plank, so one is made, anchored to the book being placed. Its
first and only book is that book, and nothing is displaced to get it there.
This is the same answer `overflow` gives at the end of the run, and it is why
the last area of the last bookcase needs no special handling of its own.

## Moving a book across an area boundary

Where an area ends is the one arbitrary thing in this model. A plank stops
where somebody ran out of room, not where the books say it should, so the
boundary has to be adjustable by hand after the fact. That is what this is.

Only the **first** and **last** book of an area can be moved, and only to the
area immediately beside it:

- the last book of an area becomes the first book of the next one;
- the first book of an area becomes the last book of the previous one.

"The area beside it" means the next area in the range, which is not always on
the same bookcase. Within a range the areas are one continuous sequence and a
bookcase boundary is only where that sequence breaks across furniture, so the
first book of `2A` moves back to `1E` exactly as the first book of `1B` moves
back to `1A`. What differs is which boundary gets re-anchored, and that falls
out of the model rather than needing a case: the boundary between two books is
whichever one sits between them, so crossing a bookcase break re-anchors the
`shelf` separator and crossing a plank break re-anchors an `area` one. The
books past the break keep the bookcase and area they were on.

This is not a limited version of a general move. It is the complete set of
moves that preserve the ordering this document makes the source of truth: in
both cases the book keeps exactly the neighbours it had, and every other book
stays on the plank it was already on. Any other book cannot move without being
filed out of order, which is the state [misfile detection](#misfile-detection)
exists to report, so it is not offered and is refused if asked for.

The rule is enforced where the move is applied (`boundaryMove` in
`web/shared/layout.ts`, called by `Shelves.moveAcrossBoundary`), not in the
screen that offers it. A restriction that lives in a component is one caller
away from being lost.

### What actually changes

The book's sort key does not change, because its position in the sequence has
not changed. What changes is the **boundary**, which is anchored to the sort
key of the first book on the new plank. Carrying a book across a boundary is
exactly re-anchoring that boundary to the book on the other side of it.

This is the same edit the overflow cascade makes when somebody says a shelf is
full, and deliberately so: a manual move and an automatic shuffle answer the
same physical question, and if they wrote different things down one would
quietly undo the other. The two differ only at the ends of the run, where the
cascade creates a new area and this refuses (see below).

Nothing here writes a location. Location is descriptive: it records where a
book physically is because a person put it there, so it is written by whoever
moved the book, through `PATCH /api/books/:id/location`. The boundary move and
the location write are two statements, and both are needed. Making only the
first leaves the book recorded on the plank it came off.

### A move is a placement, so it goes through the shelving step

Picking a boundary book in the library does not finish the move. It moves the
boundary and hands over to the shelving step, which names the plank and waits:
the person walks to the shelves, puts the book down, and says it fits. That is
the same screen, and the same `PATCH .../location` at the end of it, that a
book coming back off the table goes through. There is one way to say where a
book is, not two.

The order is deliberate and matches the cascade. The furniture changes first,
because the destination is a plank the layout does not put the book on until
the boundary has moved; then a person confirms. Between the two the book is
genuinely not where the catalogue has it, and
[misfile detection](#misfile-detection) says so. Backing out of the shelving
step therefore leaves the move outstanding rather than silently undone, which
is the truth, and the same list offers the move back.

### The edge cases

**The only book in an area.** Allowed, in both directions. The plank it leaves
is then empty, which is exactly what happened in the room. An area exists only
as the space between two boundaries, so an empty one has no books to name and
disappears from the layout until something lands on it again. Nothing else
moves: the boundary that started the emptied area comes to rest on the same
anchor as the next one, and the run past it is unaffected. Marking a
neighbouring shelf full later pushes a book onto the bare plank and it
reappears.

**The first book of the first area, and the last book of the last area.**
Refused, because there is no area on that side to move into. Making one is a
different act: the person is not adjusting a boundary between two planks, they
are saying a plank is full, which is what the overflow cascade is for and what
creates the new area. So the refusal is not a dead end, and the message says
where areas come from.

This is the start and end of the **range**, not of each bookcase. A bookcase
break inside the range has areas on both sides of it and is crossed like any
other boundary; only the two outer edges have nowhere to go.

**Moving into an area that is already full.** Allowed, because capacity is not
modelled (decision 2) and never will be: how many books a plank holds is a
fact about the particular mix of spines on it, not about the furniture. The
target area simply grows by one. If the book will not physically fit, the
person says so at that plank and the cascade takes its last book along, which
does not undo the move: the cascade shifts the boundary at the *end* of the
target area, and the move shifted the one at its *start*.

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

## Decisions on the questions this document used to leave open

Settled by the owner on 2026-08-03. Recorded here so they are not relitigated.

### A "shelf" is a bookcase

Not a single plank. `S1` to `S3` are bookcases holding fiction, `S4` is the
bookcase holding non-fiction. The plank within a bookcase is the **area**, which
is what you type after physically placing the book.

The vocabulary is acknowledged to be confusing, since "shelf" in ordinary speech
is the plank rather than the whole unit. Settled in #8: the user-facing word
for this unit is **"Bookcase"**, not "shelf". This document, the code and the
schema keep saying `shelf`, and that is deliberate, not a leftover: renaming
the code and the database is a bigger job for less benefit than the UI wording
change alone, and would touch real stored data. The area stays "Area" on both
sides.

That leaves exactly one place where the word a user reads differs from the
word the code uses, in one direction: `shelf` in the code and the database
means what "Bookcase" means on screen. See the comment at the top of
`web/src/lib/api.ts`, the only client-to-server path, for where that is
recorded next to the wire types. Nowhere in the UI does the word "shelf"
appear meaning anything at all; if you find one, it is a bug.

### Foreign-language articles are not dropped

Only the English articles `THE`, `A` and `AN` are stripped for title filing
(`LEADING_ARTICLES` in `web/shared/shelving.ts`). *Les Misérables* files under
L, *Der Steppenwolf* under D.

This is deliberate, not an oversight. Extending the list is not free: `Los`,
`La`, `El` and `Die` are also ordinary words, so dropping them would misfile
*Los Alamos* under "Alamos" and mangle any English title beginning "Die". In a
collection that is close to entirely English, that trades a rare correct filing
for a class of silent wrong ones.

Revisit if foreign-language titles ever become common enough to be worth the
false positives.

### Pseudonyms file as printed on the book

No collapsing to a canonical author. What is printed on the spine is what it
files under, because that is what you are holding when you go looking for it.

The accepted cost: an author who changes name between genres sits in two places.
*Iain Banks* and *Iain M. Banks* will not be adjacent. This was seen and
accepted rather than overlooked.

This matches the current implementation, which takes the first listed author and
inverts it without any canonicalisation.

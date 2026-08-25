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

## Vocabulary, and one word this document gets wrong

Three different things, and the difference matters because two of them are
currently treated as one:

| Word | What it means |
| --- | --- |
| **Bookcase** | A piece of furniture standing in a room. |
| **Shelf**, or **plank** | One horizontal board inside a bookcase. A physical thing you could unscrew. |
| **Area** | A run of books the owner treats as one place. **Chosen by a person, not by the carpentry.** |

**An area is not the same thing as a plank, and this document says otherwise in
several places.** One plank can hold two areas, or more: a divider, a bookend,
or a pot plant halfway along is enough for somebody to treat the two halves as
separate places, and to want them labelled and filled separately. Nothing stops
a plank holding one area either, which is why the two got conflated in the first
place.

The current implementation does not model this. `SeparatorKind` is
`'shelf' | 'area'` where `'shelf'` means *a new bookcase starts here* and
`'area'` means *a new plank starts here*, so the plank and the area are the same
row and neither the bookcase nor the plank exists as a record of its own. That is
a known modelling gap, not a decision, and it is tracked with the rest of the
remodel.

Until that lands, read every "plank" in this document as "area", and know that
the two coming apart is expected rather than a bug to be tidied away.

**Do not rename anything in the code on the strength of this section alone.**
`shelf` and `area` are in the schema, the API and the client, and renaming them
piecemeal would leave the codebase half in each vocabulary, which is worse than
being consistently wrong. The rename belongs with the remodel that introduces
the missing rows.

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

All components are normalised to letters, digits and single spaces first, so a
byte order collation is correct and deterministic. Do not use a linguistic one
and do not require the ICU extension.

### Normalisation

Applied to every text component:

1. Unicode NFKD, then drop combining marks. `Böll` becomes `Boll`.
2. Uppercase.
3. Drop everything that is not a letter, a digit or a space.
4. Collapse runs of whitespace, trim.
5. Zero-pad digit runs to 6 characters, so `Book 2` sorts before `Book 10`.

Space (`0x20`) sorting below every letter is load-bearing: it makes `SMITH ANN`
come before `SMITHSON A`, which is what you want.

**Letter means any letter, not `A-Z`.** Rule 3 said `A-Z`, `0-9` and space until
#195, and for a name written in a script that has no `A-Z` in it that is not a
fold, it is a deletion: `Фёдор Достоевский` normalised to nothing, so the book
was stored filing under nobody and sorted ahead of every book in its range, and
no override could be saved for the author either, because the override table is
keyed on this. Translated classics carry the native-script name routinely, so
this is reached by looking a book up rather than by trying to break it.

Accents are still folded by rule 1 and nothing that was already filed moves:
`García` is `GARCIA` on both sides of the change. Rule 1 does not know which
alphabet it is looking at, so Cyrillic `ё` and `й` lose their marks exactly as
`é` does. That is the same trade already accepted for `Böll` and `Boll`, applied
to an alphabet where the two are further apart. A name that mixes scripts,
`Иван Smith`, keeps both halves and files under `SMITH ИВАН`, which sorts after
every `SMITH ` and before `SMITHSON` because of the space rule above.

Every letter outside `A-Z` sorts after `Z`, so a name in another script files in
a block at the end of its range, Greek before Cyrillic before CJK. That falls out
of the collation rather than being chosen, and it is a defensible place for such
a shelf to be. What is not defensible, and is what #195 was, is all of them
first, ahead of `A`, sharing one position with each other.

The cost, and it is accepted rather than unnoticed: the code compares these keys
in JavaScript and Postgres compares the stored ones with `COLLATE "C"`, and the
two agree for every character in the basic multilingual plane but not for one
outside it. That was vacuously true when the fold left only ASCII behind.

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
        return display              # never empty: see below
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

That table was `author_filing` and it is `author_alias.filing_name` now (#227):
the same fact, kept on the name itself rather than in a side table consulted on
the way past, and reached by `PATCH /api/authors/aliases/:id` or by typing a
filing name beside the author when saving a book. Correcting one does not move
any book that is already shelved, because a sort key is written by a save; it
changes what the catalogue says the book files under, and the next save of that
book puts it there.

**A filing name is never empty, and there is one function that derives it.**
The empty string sorts ahead of every real filing name, so a book given one is
shelved as though nobody wrote it, which is what #195 was. Whatever the
heuristic cannot invert files as printed. And the client renders the filing name
as somebody types the author, while the server stores it, so the two deriving it
differently is not a cosmetic difference: opening a book whose stored name is
not what the client would derive makes the client treat the stored one as a
hand-typed override and write it back on the next save. `filingName` in
`web/shared/shelving.ts` is the one derivation, which is what `web/shared/` is
for.

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
the one before it. It compares the **area a person last put the book in**
against the **area sort order and the furniture put it in now**, recomputed
every time it is asked.

**Areas, not labels, and that distinction was learned the hard way (#356).** A
label is a rendering of an area and this app has two renderers: the ledger
renders `Hall shelf · A` for a piece somebody has named, and the ordinal walk
renders `2A` for the same plank. While nothing was named the two agreed, and a
comparison of the strings looked correct. The day a bookcase was given a name,
the check could read one side and not the other, set 181 of 238 books aside, and
answered an empty list, which reads as "everything is fine". A label is what
somebody standing at the shelf reads; the id is what says two places are one
place.

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
and holds no position to disagree with. A book **never placed** was never
confirmed onto a shelf, so there is nothing to compare. A book the run has
**nowhere to put** cannot be judged at all, which is a fact about the furniture
rather than about the book: it means the range's rule points at a piece with no
area on its face.

**Visible means drawn, not merely returned.** The last of those three is counted
and said on the library screen whenever it is not zero, above the list rather
than under it, because the list being empty is exactly what a silent exclusion
makes it. That is the correction #356 asked for, and `unreadable-location`, the
reason it replaces, no longer exists: nothing here reads a label.

The check is read only. It never rewrites a location to make a disagreement go
away: the recorded location is the record of where the book physically is, and
a guess written into it is worse than nothing there at all. A location changes
only when a person says the book moved.

### A location names a plank the collection has, or it is refused

Settled by #232, and it is a change in what the app accepts rather than a
restatement.

Until then a recorded location was a string in a column, so it would hold any
label `parseLocation` accepts: `9Z` was recordable on a collection with three
bookcases, and the app kept it while quietly disagreeing with itself about that
book, because the ledger beside the column had nowhere to put it. There is one
record now, `book_placement`, and it names an area. So a label naming a plank the
furniture does not have is refused at `PATCH /api/books/:id/location`, and the
message says so.

The same goes for an empty label, which used to mean "take this book back to
never-placed". None of the six placement kinds says that: `withdrawn` means given
away and `checked_out` means it is out of the house in somebody's bag, and the
ledger is append only, so there is nothing to unsay. A book that has left the
shelves is checked out or withdrawn rather than nowhere.

Neither refusal is reachable from the app. Every label the client sends comes from
a layout the server drew, and no screen clears one. What they protect against is a
record that says where a book is and cannot be acted on.

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

### Removing a boundary is asked about first, and the asking is not the screen's

Removing a boundary takes that area off the furniture and hands its books to the
area in front, which is the act #281 settled: a person is told what becomes of
their books and decides, because it is not something they can find out
afterwards.

**The refusal is on the act, not on any route or screen that reaches it.**
`RemoveSeparatorHandler` will not remove a boundary unless it was told the area
goes, and there are two callers that reach it: `Shelves.moveAcrossBoundary`,
which carries a person's answer down, and `DELETE /api/shelves/:id`, which takes
one on the request. Neither decides for itself.

That is written here because it was got wrong once in exactly the way this
document exists to prevent (#456). The rule was put on `moveAcrossBoundary`
(#433), which is one of the two callers, so the other one removed an area and
relocated its books on a single tap with nothing said. A caller cannot forget
what it never had to remember, which is the same reason a placement is recorded
by the statement that writes a location rather than by the route above it.

**The two costs are two sentences and one act.** A boundary move empties the
area before it takes it, so nothing is standing on it; pressing Remove on the
line itself takes an area with its books still on it, and they join the one
above. What somebody is asked says which of those is happening, with the count
and the area that takes them in.

**The carry list drawn afterwards is not the asking.** "Nothing has moved.
Dismiss this once they have" is a list of what has already happened.

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

## Moving a run to another bookcase

A run is the stretch of areas one placement rule claims books into: fiction
begins on bookcase 1 and flows on until non-fiction's own entry point. Moving
one is saying "non-fiction lives over there now", and then carrying fifty
books.

**It is a rule retarget, not a fixture renumber**, and the two are different
things that both read as "move non-fiction to bookcase 3":

- Setting `fixture.position` from 4 to 3 renumbers the bookcase. Every area
  keeps its id, so every book keeps the area it was placed in, and because a
  label is [derived at read time](data-model.md) the recorded location of every
  book on it changes from `4A` to `3A` along with the furniture. Nothing needs
  carrying, because nothing moved: that is renaming a bookcase.
- Pointing the rule at another bookcase, and giving that bookcase the run's own
  cuts, makes the destination planks **different rows**. The books stay on the
  planks they are physically on, the rules want them elsewhere, and the
  difference between the two is the list of books to carry.

Only the second produces a book in somebody's hands, so it is what
`POST /api/placement/run` does. `domain/placement/relocate.ts` is the
arithmetic and `relocateRunTo` in `infrastructure/shelving/areas.ts` is the
write.

### A run stops where the next run begins, and a move stops a piece earlier

A run runs from its rule's entry area until the next area any rule points at.
That is `runFrom` and it has always been the model. **A move is bounded one step
further in: it stops at the first piece of furniture somebody else's rule stands
on, and does not touch that piece at all.**

The two bounds are different because they answer different questions. A run
flowing onto the top three shelves of a bookcase whose bottom shelf has its own
rule is a true statement about where books go. Taking those three shelves off
that bookcase and screwing them onto another one is not a thing anybody asked
for, it is not a thing the plan could honestly draw, and
[#420](https://github.com/BlakeHastings/book-scan/issues/420) is what it cost:
the plan cut the run at the rule and the write cut it at the next *genre range*,
of which there is none past non-fiction, so the plan moved six planks and the
write moved seven. The hall bookcase somebody had put up that afternoon was left
standing with all four of its shelves at negative positions, drawn by no screen,
its own page reading "0 areas, 0 books", with the rule they had written still
filing comics onto one of them, and a `4D` nobody had added standing on the
bookcase the books had come off.

**A bookcase somebody's rule stands on is that rule's furniture.** Half of one is
nobody's to take. `nextRunStartAfter` in `domain/placement/rules.ts` is the one
definition of where the next run begins, `bandsOf` and `relocateRun` both ask it,
and `relocateRunTo` refuses inside its own transaction if a move would ever leave
a piece half stripped again.

### The run takes its own cuts with it

Non-fiction is 8 books, then 20, then 22. The destination gets the same number
of areas, anchored at the same sort keys, so the same books land together and
**capacity does not arise**: the question "will 50 books fit on a bookcase with
a different number of planks" is not asked, because the shape of the run is not
changed by moving it.

That is deliberately narrower than the general question. Pouring a run onto a
bookcase already holding another one is where the [overflow
cascade](#placing-a-book-on-a-plank-that-is-full) and area capacity would come
in, and it is refused here rather than guessed at: **a bookcase holds one run**,
which is the arrangement `0013` already refuses. The open question is on #242.

The planks the run leaves behind are **retired rather than deleted**, on the
same rule every other boundary change follows, so a book recorded on `4C` still
reads as `4C` until somebody carries it. Moving a run back restores those rows
rather than making new ones, which is what returns each book to the plank the
ledger already names.

### Applying a move deletes nothing, and says what it empties

This paragraph said the sentence above it before #391 and the code did not do
it. `relocateRunTo` retired a plank only when a book had stood on it and
**deleted** every other one, and then deleted any bookcase left with nothing on
it. So the run flowed on past bookcase 4 onto a bookcase somebody had put up
that afternoon, and a move about two other bookcases took its four empty planks,
the name written on one of them, and finally the piece, in silence.

Two rules, and neither is a warning:

- **A move retires every plank it takes, including one no book has stood on.**
  The row carries somebody's name for it and the run coming back puts it back.
- **Nothing outside `dropFixture` deletes a piece of furniture.** A bookcase is
  a thing standing in a room. It goes when somebody says so, through
  `DELETE /api/fixtures/:id`, which refuses while books or rules are on it and
  says what becomes of them first.

A piece the move takes every plank off is left standing bare, which is still a
consequence somebody should read before rather than find after. The plan names
it: `RunMovePlan.emptied`, computed in `domain/placement/relocate.ts` beside the
plank moves that were already there, and drawn on the plan screen. That is
[#307](https://github.com/BlakeHastings/book-scan/issues/307)'s shape applied to
furniture rather than to books.

### A bare piece is not an empty one, and it says how many books are on it

The bookcase a move leaves bare still has every one of its books standing on it,
because a move records where books belong and a person carries them. So the room,
the piece's own page and the plan all have to account for those books while none
of the planks holding them is on a face any more.

They did not, and
[#401](https://github.com/BlakeHastings/book-scan/issues/401) is what that read
like: `GET /api/fixtures` answered "Bookshelf 4, 0 areas, 0 books" in the second
`GET /api/carry` was answering "46 books, Bookshelf 4 · A to Bookshelf 2 · E".
The carrying list was right.

Three rules follow, and none of them weakens retiring:

- **A piece of furniture accounts for every book standing on it**, whatever
  became of the plank holding it. Its count is over every area it has ever had.
- **A retired plank with books on it is named as one that was taken out**,
  separately from the face, so a person can reach those books. One with nothing
  standing on it is not drawn: the row exists because the ledger names it, not
  because it is furniture.
- **A piece with books standing on it is not a free destination**, even with
  nothing on its face. It is the fullest bookcase in the room.

### There is no third state, and #420 is what one cost

A negative `area.position` means one thing: **this plank was taken out, and the
row stayed because the ledger names it.** Somebody can still reach it, through
the books standing on it, on the piece's own page and in the carry list. That is
what the three rules above are for.

#391 borrowed the same encoding for a second job nobody named: parking the planks
of a run part way through a move, on the understanding that they would all be
hung straight back. When they were not, what was left read as a retirement in
every query and was nothing like one to a person. Four planks holding no books,
so drawn by nothing, on a bookcase in another room.

**A guard that measures the wrong thing is worse than no guard, because it is
believed**, and the same goes for a state. So the answer is not a fourth read
that tolerates it:

- a move takes planks off pieces the run is **leaving**, which the plan names as
  `RunMovePlan.emptied` before anybody presses anything, and never off a piece it
  cannot take whole;
- **a rule never survives its plank leaving the face.** `area_id` becomes null
  and `fixture_id` the piece it was on, so the rule goes on claiming the same
  books and opens its run at the top of that bookcase. A rule pointing at
  something no screen draws files every book it claims nowhere and says nothing,
  which is its own defect and not a consequence of anything;
- a move that would leave a piece half stripped anyway fails inside its own
  transaction rather than committing it.

### Planning it writes nothing, and applying it moves no books

Two steps and they are one idea, so neither is useful alone.

**Plan** runs the rules over the prospective furniture and answers what would
have to happen: which books come off which plank and go onto which. It writes
nothing at all, which is what makes it safe to draw while somebody changes
their mind about the number.

**Apply** writes the furniture and then an `assigned` row per book, **only
where the rules' answer differs from where the book already is**. That is
#185's rule and it is what makes applying twice safe: the second run finds every
book already assigned where the rules want it and writes nothing.

**Applying still moves no books.** An assignment is an intention. The books
move when a person carries them and says so, through
`PATCH /api/books/:id/location`, and what is outstanding is the same
[needs attention](#misfile-detection) list this document already describes:
where a book was last seen against where it now belongs. There is no second
queue and there must not be one.

A plan says what it will **not** touch, too, because a plan that reports 50
moves having quietly dropped three pinned books is believed and is wrong. Every
book left alone is counted with its reason: pinned, which beats every rule
forever; checked out or withdrawn, neither of which is on a bookcase; never
confirmed onto one; and claimed by no rule at all.

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

### Which plank, and what the plank is called

Two different jobs, and one string used to do both. **A plank is named for a
person and identified by its area**, and every route that decides where a book
goes takes the area: `POST /api/shelves/overflow` and its `/plan`, and the
plank a boundary move offers, which comes back as a row rather than as a label.

`docs/data-model.md` says labels are derived at read time, and this is why. A
label is built from where a piece stands and what its owner called it, so the
same plank reads `1B` off the ordinal walk and `Hall shelf · B` off a named
bookcase. While nothing was named the two agreed and using either as a key
looked correct. #356 is what happened to the reading side the day a bookcase was
first named, and #359 is the same thing on the side that writes: the button said
`Move it on to 1B` on the screen whose recorded location said `Hall shelf · B`,
and the string it said was the key it sent.

Inside `web/shared/layout.ts` a plank is still a pair of ordinals, because pure
arithmetic over a run cannot know anything else, and `PlankAt` is that pair.
`Shelves.addressOf` is the one door between an area id and it. Everything a
person reads is built by `labelFor`, the same function the ledger renders a
recorded location with, so what a button says and what the catalogue says are
one sentence.

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

### Taking the move back is not the opposite move

The sentence above is what #196 implemented, and this records what it turned
out to mean, because the obvious reading of it is wrong.

Taking a move back **writes no location**. A location is descriptive and says
where somebody last saw the book; nobody carried this one anywhere, so there is
nothing about the room to write down. The whole reason the way back exists is
that the only exit used to be "Moved it", which asserts a walk that did not
happen, and a flow whose only exit is to lie to the catalogue is worse than a
missing feature.

And "back" means the boundaries **as they were**, not where the rules would put
the book now. Asking for the opposite boundary move answers the second
question, and after a move that emptied an area the two answers differ: the
emptied area's boundary comes to rest on the same anchor as the next one, both
lie between the book and the one after it, and the opposite move re-anchors
both, carrying the book two planks instead of one. At the end of the run the
opposite move does not exist at all, because the move that removed a boundary
left no area on that side to go to. So a move records what it changed, and
taking it back replays that. If the shelves have moved since, putting them back
would not put the book back: the retraction is refused rather than approximated,
and the way out is the one that was always there, which is to say where the book
actually is.

Only a move the app made can be taken back. A book pushed onto the next plank
by a newcomer is a misfile too, and it is not one anybody can withdraw: there
is no assignment behind it, and moving the boundary to close it would be a new
decision about the furniture, made on the person's behalf, wearing the word
undo.

### Taking back a boundary move and leaving a carry list undone are not the same act

Asked and answered when the second one was built (#402), because the first one
looks like it at a different scale and building the second on top of it would
have been wrong.

**What they share is the instinct**, and it is the one worth keeping: neither
writes a location, because nobody carried anything, and a flow whose only exit
is to assert a walk that did not happen is worse than a missing feature.

**What they do not share is what "back" means, and it decides everything else.**
`retractMove` puts the *furniture* back: a boundary move changed where a
boundary sits, so taking it back is replaying a receipt of exactly what it
changed, checked afterwards and refused rather than approximated when the
shelves have moved on. There is state to restore, one book at a time, and
`outstanding_move` exists to hold it.

Leaving a carry list undone restores nothing. **The rules' answer was never
acted on, so there is nothing to put back**: what is withdrawn is the wanted
answer itself, one `released` row per book, at whatever scale the person decided
at, which is usually the whole list. Nothing can have moved on underneath it and
there is nothing for it to refuse.

The consequences are opposite too. A retracted boundary move cannot come back,
because the boundary is where it was and the rules will not ask again. A
withdrawn assignment **would** come straight back, because the rule that wrote it
is still on the place, and that is the problem `Standing.declined` exists to
solve. See `docs/data-model.md` on `released`.

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
| `range` | TEXT | `fiction` / `nonfiction`. Indexed with `sort_key`. Derived from the book's genre tag since #223, and there is no `is_fiction` beside it: #227 dropped that column. |
| `classification_source` | TEXT | `auto` / `manual`. |
| `classification_confidence` | TEXT | `high` / `medium` / `weak` / `unknown`. |
| `author_filing` | TEXT | **Not a column on `books` since #227.** What a book files under is a fact about its first credit's alias, `author_alias.filing_name`, and the three views over `books` join it back on so a listing still reads it. Derived by `filingName`, overridable by filing the name. |
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

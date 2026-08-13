# The target data model

Fourteen tables. Settled with the owner on 2026-08-06 across eight revisions,
and recorded here because the reasoning matters more than the column lists.

**All of this is built, and all four slices are now read.** The live schema is
the six-table one in `web/server/db.pg.ts`, plus `tag` and `book_tag` from #179,
`author`, `author_alias` and `book_author` from #180, `capture` from #181,
`books.state` with its three views from #183, `collection`, `sort_strategy`,
`fixture`, `area`, `placement_rule` and `rule_condition` from #184, and
`book_placement` with `books.current_area_id` from #185. Every one of those was
added beside the columns it replaced rather than instead of them, and every one
of them has since taken over from what it shadowed. They are described under
"What is built" at the end.

**The cut-over is where something is finally deleted, and it has deleted fifteen
columns and two tables.** #223 and #227 made the genre tag decide a shelf range
and the credited alias decide what a book files under, and #227 dropped
`books.is_fiction` and `books.author_filing`; #228 made `capture` the record of a
photograph and dropped the ten image columns; #232 made the areas and the ledger
the record of where a book is, dropped `books.location`, `books.shelved_at` and
`books.checked_out_at`, and then dropped `separators` and `shelf_ranges`, **which
are the first two tables this repository has ever dropped**. #220 is finished.
`docs/domain-model.md` is the layering this sits under; #170 is the epic that
built the rest.

The point is not that fourteen is better than six. It is that the current schema
describes what the code needed and this one describes the collection.

## What the current schema gets wrong

| Today | Problem |
| --- | --- |
| `books.authors` is a joined string | Author information lives in three places and none is authoritative. "Everything by this author" is a string match, wrong in both directions. |
| ~~`shelf_ranges`~~ | Configuration wearing a table's clothes. Its columns exist only to bootstrap counting. **Dropped by #232:** two rows saying which bookcase each run began on is a `placement_rule` pointing at a fixture, and a rule names the books it claims as well. |
| ~~No bookcase anywhere~~ | Bookcases and areas are implied by walking a separator list. Nothing can be said about one. **Answered by #184 and read since #232:** `fixture` and `area` are the furniture, and the boundary list is derived from them rather than the other way round. |
| ~~Eight image columns~~ | Exactly one photograph of each kind, forever. A blurred spine cannot be re-shot. **Ten of them, and dropped by #228:** `capture` is the record. |
| `is_fiction`, `category` | Two fixed ways to classify, when people want many. |
| ~~`location`, `shelved_at`, `checked_out_at`~~ | Only the present tense. Where a book has been is not recorded. **Dropped by #232:** `book_placement` is where a book is and where it has been. |
| ~~Separate `captures` queue~~ | The queue is a state a book is in, not a different kind of thing. **Dissolved by #183.** |

## Vocabulary

Three words this repository has used interchangeably and should not:

- **Fixture** — the thing that groups areas. A bookshelf, a crate, a windowsill.
  Its `kind` is the owner's word and nothing branches on it.
- **Shelf**, or plank — one board. **Not modelled**, deliberately: an area is
  the unit that matters, and a plank can hold two of them.
- **Area** — a run of books treated as one place. Chosen by a person, not by the
  carpentry. A divider or a pot plant halfway along a plank is enough to make
  two.

`docs/shelving.md` has the fuller note, including that the current code calls a
bookcase boundary a "shelf".

## Tables

### Collection

One row. `default_sort_strategy`, and the owner when this becomes multi-user.

A default expressed as a rule on every fixture would have to be changed on every
fixture, and could then disagree with itself. It lives in one place.

### Fixture, Area

`fixture(id, collection_id, kind, name, position, sort_strategy, note)`
`area(id, fixture_id, position, name, starts_at, sort_strategy, note)`

`area.starts_at` is the sort key of the first book in the run, byte-ordered,
compared against a book's sort key. **An area is what `separators` became: a
separator grown a parent.** `area.starts_at` is `separators.starts_at` under a
name that says what it anchors, carrying the same `COLLATE "C"` for the same
reason, and `separators` is dropped (#232).

**What the row did not take is `kind` and `position`**, because neither was ever
a fact of its own. A `shelf` boundary is one whose area hangs on a different
fixture from the area before it, and a boundary's ordinal is its place in the
run, so both are derived from where the area sits. That is what makes the
boundary list the inverse of the areas rather than a second opinion about the
same shelves, and it is why a boundary's numbering cannot have a gap in it.

**An area a book has been placed in is retired, not deleted.**
`book_placement.area_id` is `ON DELETE RESTRICT` on purpose, so the history pins
the furniture it names: a plank a book once sat on cannot go just because
somebody took away the boundary that opened it. Such an area's `position` goes
negative, which takes it off the fixture's face while leaving the row and every
placement that names it exactly where they are, and **every read of the furniture
asks for `position >= 0`**. An area nothing names is deleted outright.

That belongs here rather than beside one migration, because it is what makes the
areas usable as the record at all. While `separators` was authoritative a stale
area decided nothing; now an area still sitting in a run comes back out of the
boundary list as a boundary nobody asked for, and the removal would not have
happened.

**A retired area still names the plank it was**, and that is why the position is
stored as `-(plank + 1)` rather than as any spare negative number: the encoding
is its own inverse, and `faceOf` reads it back. A book placed on `1C` before
somebody removed the divider above it is still recorded on `1C`, which is what a
person wrote down, and the misfile list is what says the shelves no longer have
one. Reading the stored number straight would have the catalogue answering `1@`
about a book somebody can go and find.

Nothing reaches a retired area by typing its label, because a parsed label's
plank is never below zero, and putting the boundary back brings the same row back
onto the face rather than making a second one beside it. That is what returns a
book to the plank it was recorded on rather than to a plank with the same name and
a different id.

Setting `sort_strategy` on an area to anything but `inherit` makes it
self-contained: nothing overflows into it from the area before, because a
continuous run only works if every area in it orders the same way.

**Labels are derived at read time**, from positions and the two names. A stored
label goes stale the moment a fixture is renamed.

| fixture name | area name | label |
| --- | --- | --- |
| `''` | `''` | `1A` |
| `Hall shelf` | `''` | `Hall shelf · A` |
| `Hall shelf` | `Cookery` | `Hall shelf · Cookery` |
| `''` | `Cookery` | `1 · Cookery` |

**Both are described through the API since #302**, under `/api/fixtures` and
`/api/areas`, which is what lets somebody model furniture no migration knew
about. Three things about those routes belong here rather than beside them,
because they are properties of these two rows:

- **No route accepts or returns a stored label**, for the reason above. Every
  write answers with `becomes` instead, which is every label that reads
  differently once the change lands, old to new. A rename strands nothing,
  because a recorded location is an area row rather than a string, and `becomes`
  is how somebody sees that rather than being told it.
- **Reordering the areas of a fixture writes every ordinal twice.**
  `area_fixture_position_key` is checked per row rather than at commit, so a
  single pass puts an area on an ordinal another one still holds. The first pass
  parks them all above every ordinal on the fixture and the second brings them
  down; the parking band is positive, so it can neither collide with a retired
  area nor bring one back onto the face. `resequenceFace` in
  `web/infrastructure/shelving/furniture.ts`. **The index is not the thing to
  relax**, and `fixture.position` still carries none, for the reason above it.
- **Removing an area is a merge and writes `assigned` rows**, naming the area
  that absorbed the books, and only where that differs from where each book
  already is. Nothing is deleted, the removed area is retired whenever the ledger
  names it, and pinned, checked out and withdrawn books are left alone and
  counted. `PATCH /api/books/:id/location` remains the only route that changes
  where the catalogue thinks a book is.

### SortStrategy

`sort_strategy(code, label, is_inherit, available, note)`

A lookup table, seeded by the app, not by people. Rows: `inherit`, `author`,
`title`, `published`, `tag`.

**`inherit` is a row, not a null.** No absence in this schema means anything.

**`available` lets a strategy exist and be unofferable**, which is where colour
sorting waits until there is a colour to sort by.

**Every strategy carries its own tiebreak chain, fixed in code.** `tag` means
tag slug, then author filing, then title. It does *not* mean "then whatever the
global default is": if it did, changing the global setting would silently
reorder every run that had explicitly chosen `tag`. A run is only reordered by
somebody changing that run.

### PlacementRule, RuleCondition

`placement_rule(id, area_id, fixture_id, priority, name, enabled)`
`rule_condition(id, rule_id, field, operator, value)`

Exactly one of `area_id` / `fixture_id`. Area beats fixture beats the global
default; `priority` settles ties within a level.

**All conditions must hold.** No nesting, no `OR`. Two ways to say a thing are
two rules, which a UI can build and a person can read when a book lands
somewhere surprising.

Operators include `is` and `under`, because `tag is genre/fantasy` and
`tag under genre` are different questions.

### Tag, BookTag

`tag(id, slug, label, note)`
`book_tag(book_id, tag_id, source, confidence, added_at)`

Replaces `is_fiction`, `category`, `classification_source` and
`classification_confidence`. Those last two only ever described the fiction
guess; as columns on `book_tag` they describe every tag.

**Hierarchy lives in the slug, Obsidian style**: `genre/fantasy`,
`mine/lent-out`. No parent column and no tree to keep consistent, and with
`COLLATE "C"` a prefix match is an index range.

**`slug` is the identity, `label` is what a person reads.** Catalogues return
"Fiction", "fiction" and "FICTION" for one idea, and without a normalised slug a
rule silently matches a fraction of what it should.

**A lookup may take back its own tags and no others.** Re-running it deletes and
rewrites rows where `source = 'catalogue'`, so a tag the catalogue stopped
claiming goes away. It must never touch `source = 'person'`.

**Re-identifying a book is not a lookup, and it takes off more.** Correcting a
book's ISBN is the same person saying this row is a different book, so every tag
about the *work* goes, whoever said it: what a person answered was about the book
the row used to be, and is not about anything now. Tags about the *copy* stay,
because the object in the house did not change. The boundary is a list of
namespaces, `genre` and `subject` today, in
`web/application/tagging/reidentify-book.ts`, and a new tag kind joins it if a
tag under it would be wrong about a different book. Settled in #194, which was
the defect of leaving both `genre/fiction` and `genre/non-fiction` on a corrected
book.

### Author, AuthorAlias, BookAuthor

`author(id, is_corporate, note)`
`author_alias(id, author_id, display_name, filing_name, is_primary)`
`book_author(book_id, position, author_alias_id)`

**An author holds no name.** One person publishes under several: Iain Banks and
Iain M. Banks, Stephen King and Richard Bachman. Those are one author and
several aliases.

**A book credits the alias, not the person**, which is what the existing filing
rule already requires: `docs/shelving.md` settles that a pseudonym files as
printed. Filing follows the alias; "everything by this person" follows the
author behind it.

A corporate author is an author with `is_corporate` and one alias. No special
case.

**The migration has to decide identity 263 times, and should be conservative.**
When two spellings are not obviously one person, make two authors. Merging two
rows later is easy; splitting one that swallowed two people is not.

**Settled by #180: it merges no pseudonyms at all.** Every distinct printed name
gets an author of its own, and the only thing collapsed is spelling: two strings
that differ by case, punctuation or whitespace are the same name, on the key
`author_filing.display_key` has always used. Nothing in the catalogue says that
Iain Banks and Iain M. Banks are one person, and the only evidence available is
two strings that differ by one initial, which is also how two different people
differ. `POST /api/authors/merge` is what a person uses to say so, and it moves
no book, because the books still credit the same aliases.

**A filing name came from `books.author_filing`**, which was the value the app
had already computed for that name with any override applied, and which was the
first component of the `sort_key` the shelf is ordered by. A name that has never
been first-listed has never had one computed, and #180 invents none: the printed
name stands until somebody files it, because the alternative is a second copy of
`filingName()` written in SQL. Which authors those are is on `author.note`.

**Since #227 it is the other way round.** `author_alias.filing_name` is what a
sort key's first component is built from, the column it was copied from is gone,
and `0020` is the repair that made the two agree before it went.

### Book

Loses most of what it was: `location`, `shelved_at`,
`checked_out_at` (ledger), `authors` and `author_filing` (aliases),
`shelf_range` (rules), `is_fiction` and `category` (tags), the image
columns (captures), `ocr_text` (never used).

**The three placement columns have gone**, by #232, in a migration apiece:
`0024` for `location`, `0025` for `shelved_at` and `0026` for `checked_out_at`.
Each refuses rather than finishing quietly when the ledger cannot reproduce what
the column says, because a book whose location nothing can reproduce is a book
nobody can find afterwards. What the wire still carries is derived; see
"BookPlacement" below.

**The image columns were the first of those to actually go**, by #228.
`front_image`, `back_image`, `edge_image`, `cover_image`, `front_hash`,
`cover_hash`, `front_crop`, `back_crop`, `edge_crop` and `cropped` were dropped:
ten, not eight, because the two hashes were always part of the same set and the
list in this document had undercounted them. `cover_checked_at` stayed, and that
is the one judgement in it: it records that a cover was looked for, including for
a book that has none, which is a fact about a search rather than about a
photograph, and it is what stops the backfill asking about the same book forever.

Keeps `state`, the bibliographic fields, `title_filing`, and two projection
columns.

`current_area_id` is the one null that survives, because a book on no shelf is a
genuine absence rather than a state with a name.

### BookPlacement

`book_placement(id, book_id, kind, area_id, sort_key, rule_id, actor, reason, created_at)`

Append only. One row per move. The latest row is where the book is; the rows
behind it are where it has been.

`kind` is `assigned`, `placed`, `pinned`, `checked_out`, `checked_in` or
`withdrawn`.

**`assigned` is what the rules want; `placed` is what somebody did.** They
disagree exactly when a book needs attention, so the misfile list stops being a
computation beside the model and becomes a property of it.

**`pinned` beats every rule, forever.** The rule engine skips any book whose
latest placement is pinned. Unpinning is another row, so even the decision to
stop pinning is in the history.

`assigned` rows are written only where the answer differs from where the book
already is.

**A book coming back is placed where it came off, not where the rules want it.**
Going out is one row and it names no area; coming back is two, `checked_in` and
then `placed`, at the plank read out of the book's own history. This document
used to say a returning book is placed again by the rules, and that would move a
book somebody had put back exactly where they found it. The rules get their say
the next time they run. A book nobody had placed before it went out comes back
nowhere, which is where it was.

**Keep a projection, not only the ledger.** Drawing a shelf needs every book's
current position at once, and scanning the ledger for that is wasteful.
`book.current_area_id` is written in the same transaction, is rebuildable from
the ledger, and a check can prove they agree.

**This is the only record of where a book is, since #232.** There is no column
beside it to fall back on and no second answer to compare against, which is why
the drop was made in the same change as a book-by-book comparison rather than
after one. What the wire still asks for is derived in
`web/server/placement-ledger.ts`: `location` is the label of the area
`books.current_area_id` names, built by `labelFor` rather than a second time in
SQL, and `checked_out_at` is the `created_at` of the latest `checked_out` row,
answered only while the book is in that state. Both carry the names the dropped
columns had, which is deliberate and temporary, and is the call #223 made about
`books.is_fiction` and #228 made about the photographs.

**`shelved_at` did not become a derived field, because nothing ever read it.**
Three statements wrote it and no query, route, client or scenario selected it
back; its one reader was `0015`, which turned it into the `created_at` of a
`placed` row. The rows say more than the column did: it could name the last time
a book was put somewhere, and they name every time it was put anywhere.

### Capture

`capture(id, book_id, kind, file, crop_file, examined, hash, taken_at)`

One photograph. Many per book, and as many of each kind as somebody takes.
`kind` is front, back, spine or catalogue.

**`book_id` is not null**, because a book exists from its first photograph.
There is no orphan state and no second parent, which is why the queue table
disappears rather than being renamed.

**One `book_id` column is the enforcement** that a capture belongs to at most
one book: there is nowhere to put a second. A join table would permit exactly
the thing that must not happen.

`cropped` stops being a comma-separated string and becomes `examined` per
photograph. Its distinction survives: `examined` true with an empty `crop_file`
means the detector looked and declined, which is different from never having
looked.

**This is what the app reads, since #228.** Nothing anywhere reads a photograph
from `books`, because there is no photograph on `books`. Every write of one goes
through a function in `server/photographs.ts`: a shutter, a downloaded cover, a
crop and a hash, four ways in and no fifth.

`current_photograph` is `Photographs.latest` said in SQL: one row per book per
kind, the newest, tie-broken by id exactly as the domain breaks it. Two
statements read it, and both are about the photograph somebody would actually be
shown: the books whose current front or artwork has not been hashed, and the
queued books that can be compared against a book held up to the camera.

**The wire still speaks in slots**, and that is deliberate and temporary. A book
in the JSON carries `front_image`, `front_crop` and `cropped`, derived from the
newest photograph of each kind, and the client, the browser suite and the two
crop backfills read those. Changing the shape of every book on the wire in the
same change that drops ten columns and moves every writer is not a change
anybody can review as one thing; #223 made the same call about `books.is_fiction`
and it is the same call. A book with four spine photographs has one `edge_image`
there and four rows here, and `GET /api/books/:id/captures` is what answers for
the other three.

## Book states

```
scanned → identified → shelved ⇄ checked_out
   ↓          ↓            ↓
unidentified  ↓        withdrawn
   ↓          ↓
   └──→ discarded ←─────┘
```

| State | Meaning |
| --- | --- |
| `scanned` | Photographs taken, nothing read yet |
| `unidentified` | Read, and no catalogue has it |
| `identified` | Confirmed, waiting to be put somewhere |
| `shelved` | Somebody put it there and said so |
| `checked_out` | Off the shelf, still owned. Holds no area, because a book in a bag has no position. |
| `withdrawn` | Given away, sold, lost. Terminal and archival. |
| `discarded` | The scan was a mistake |

**Identified and shelved are two steps.** Knowing what a book is and knowing
where it went are separate facts, established separately.

**The queue is a query**, not a table: books in an early state.

**This is the risk in the whole remodel.** `books` drives shelf ordering and
misfile detection, and half-identified rows must never reach either. The current
schema keeps them apart by having two tables. Collapsing means every ordering
query needs `WHERE state = 'shelved'`, and forgetting once puts an unidentified
book between two real ones.

Fix it in one place: a `shelved_books` view and a partial index on
`(shelf_range, sort_key) WHERE state = 'shelved'`. The ordering code reads the
view and cannot forget.

**Both are built, by #183, and so is the rest of it.** `books.state` carries the
seven names, `shelved_books` is what `Store.neighbours` and `Shelves.booksIn`
read, and `idx_books_shelved` is what it is an index seek over. The queue table
is dissolved: `queued_books` is the three early states and is the whole of what
`CaptureQueue` reads. See "What is built".

## One repair the cut-over owed, and `0016` is it

**The work that makes tags authoritative must also clean up #194's rows**, and
that is the owner's decision of 2026-08-07 rather than an implementer's option.

Before #201, correcting a book's ISBN left the old book's `person` genre row in
place beside the new book's `guess`, so a book carries two `genre/*` tags and the
higher-authority one is the wrong one. New occurrences cannot happen. Rows
written before it are still there, invisible because nothing reads tags, and they
become visible the moment something does.

They are not being repaired by hand and no agent is to touch the catalogue for
them. The rule goes in the cut-over, written down and reviewed like any other
migration, and it must:

- find books with more than one distinct slug under `genre`
- keep the row that agrees with `books.is_fiction`, which is what the shelf was
  actually built from, rather than the one with the higher source
- **count what it changed and say so**, because a repair that silently rewrites
  a person's answer is the same class of thing as the defect

**Done by #223, as `0016_one_genre_tag_per_book.sql`, and it runs while
`is_fiction` is still authoritative**, which is the whole reason it is the first
half of that change rather than the second. Afterwards there is nothing left to
be right.

Two things about it are narrower than the sentence above and both are deliberate.
It repairs only the `genre/fiction` and `genre/non-fiction` pair, because those
are the two slugs a shelf range is built from and the two #194 left together, and
`books.is_fiction` can neither agree nor disagree with `genre/fantasy`. A book
left carrying a third genre beside the pair is **counted and left alone**, on the
same terms `0013` counted these before there was a repair to hand them to. And
the counts are three: the books repaired, the rows removed, and how many of those
rows were a person's, which is the accounting for the part that rewrites somebody
else's answer.

## The repair the authors' half owed, and `0020` is it

The authors' half owed one for the same reason the genre half did: something
drifted behind the column it shadows, and nothing read it, so nothing noticed.

`author_alias.filing_name` was filled by #180 from `books.author_filing`, which
is the first component of every `sort_key` the shelf is ordered by. Two things
have been able to move the column since without moving the alias.
`Store.saveFilingOverride` writes the `author_filing` **table**, which
`Store.filingFor` then consults on the next save, so an override reaches the
column and never the alias. And `AuthorRepository.introduce` deliberately never
rewrites an existing alias's filing name, because re-saving a book must not undo
somebody's correction, so the save carrying that override left the alias alone.

`0020` is the repair, and it is `0016`'s rule with the nouns changed: **the alias
files under what `books.author_filing` says**, because that is what the book is
physically shelved by. It runs while the column is still authoritative, for the
reason `0016` ran while `is_fiction` was, and it counts what it changed.

**It invents no filing name**, which is the part worth knowing. An alias whose
books all carry an empty `books.author_filing` keeps the printed name #180 gave
it. Those are #195: `Store.filingFor` returned '' rather than running the
heuristic for a name written in a script with no `A-Z` in it, #222 fixed the
function and rewrote no rows, and a second copy of `filingName()` written in SQL
is exactly what #180 refused to write. So those aliases are counted and named,
and the books they file are the books the cut-over's comparison reports as
placed differently by the two models.

**What `author_alias.filing_name` holds for such a name is the printed name, and
that is not what the current fold produces.** `filingName('Νίκος Καζαντζάκης')`
answers `Καζαντζάκης, Νίκος` since #222. The alias answers `Νίκος Καζαντζάκης`,
because #180 treated an empty stored filing name as no answer and fell back to
what was printed. Both are better than the empty string those books are actually
shelved under, and neither is applied to a stored key by this change: a sort key
is written by a save and by `server/refile-books.ts`, and the way to correct one
name is to file it, through `PATCH /api/authors/aliases/:id`.

## Still open

1. ~~Is a tag's slug immutable once created?~~ **Settled by the owner in #179:
   it is.** A slug is never shown to a person, `label` is what anybody reads, and
   renaming changes only the label. There is deliberately no method anywhere that
   takes a slug to a different slug.
2. ~~Can a book carry `genre/fantasy` without `genre`, and does `under genre`
   find it?~~ **Yes to both, since #179.** The question is asked of the path, not
   of a parent row, so no ancestor has to exist for `under` to find its
   descendants.
3. ~~Does the ledger record tag changes, or only placement?~~ **Settled by the
   owner on 2026-08-07: placement only.**

   `book_placement` stays a record of where books physically went. Tags keep
   what #179 gives them, `added_at` and the source that wrote each row, which
   says when a tag arrived and who said so.

   **What that gives up, on purpose:** a removed tag leaves no trace. The model
   can say what is true about a book now and not that somebody changed their
   mind. So "did I take this off, or did the app never add it?" has no answer,
   and a lookup cannot be stopped from re-adding a tag a person removed by
   consulting history, because there is none to consult.

   The reason to accept that is what it protects: a ledger that recorded both
   would be one table doing two jobs, and `assigned` against `placed` is a
   distinction that only means anything while every row in the table is about
   placement. **If retraction ever needs remembering, it belongs in the tagging
   model as a tombstone, not in the ledger.** Do not reopen this by widening
   `book_placement`.

## What is built

`tag` and `book_tag` are, by #179: the two tables, the domain rules in
`web/domain/tagging/`, the port and handlers in `web/application/tagging/`, the
Drizzle repository in `web/infrastructure/tagging/`, and the routes under
`/api/tags` and `/api/books/:id/tags`.

**The genre tag is what decides a shelf range, since #223.** `0002` copied
`books.is_fiction` into tags carrying its provenance and left the column
authoritative; the first half of #223 turns that round. A save settles the genre
first, through `settleGenre` in `server/index.ts`, and the range it writes is
`rangeOfGenre`'s answer over what `book_tag` holds afterwards.
`domain/tagging/genre.ts` is the whole of the rule.

**The column is gone, and so is the boolean** (#227). `books.is_fiction` was
written from the settled range so that it shadowed the tag rather than competing
with it, which is what made it droppable; the client now sends and reads a genre
**slug**, `GenreSlug` in `domain/tagging/catalogue-claims.ts`, from the
classifier's ladder through to the field beside the title. `books.shelf_range`
is the run the genre settled on and is what every shelf query reads.

Three parts of the rule are worth knowing before touching it:

- **A person's genre tag outranks a machine's.** A catalogue refresh may put
  `genre/non-fiction` on a book somebody filed as fiction, because a lookup may
  not retract a person's row, and settling that pair on tag order rather than on
  who said so would let the lookup move the book. That is the one-directional
  rule read rather than written. It differs from `0013`'s rules, which settle
  every tie on `priority`; the placement cut-over inherits the question and the
  answer it wants is a `source` condition on a rule.
- **Otherwise `genre/fiction` before `genre/non-fiction`**, which is the order
  `0013` writes its two rules in, so a book carrying both files the same way
  under either model.
- **A book no genre tag claims keeps the range it has and does not move.**
  `books.shelf_range` is written by a save and by nothing else, and a save always
  states a genre, so the only way in is somebody taking a tag off by hand.
  `applySchema` counts those on every start and names them; nothing repairs them,
  for the reason nothing repairs the placement projection.

`author`, `author_alias` and `book_author` are, by #180, in the same shape: the
three tables, `web/domain/authorship/`, `web/application/authorship/`,
`web/infrastructure/authorship/`, and routes under `/api/authors` and
`/api/books/:id/authors`.

**Cut over by #227, and `books.author_filing` is gone.** `Store.filingFor` asks
the authorship port what the first-listed name files under, and the sort key is
built from that answer; the heuristic is the fallback for a name this collection
has never seen, which is the value `AuthorRepository.introduce` is about to store
against it anyway, so there is still one derivation. `Store.saveFilingOverride`
is gone and its job is `FileAliasHandler`, called from the save routes on every
save that carries a filing name, where the flag it used to need was on
`POST /api/books` alone.

**The value did not leave the wire.** `shelved_books`, `catalogued_books` and
`queued_books` join the credit at position 1 back on and answer `author_filing`
from the alias, in one place (`filed` in `infrastructure/db/schema.ts`), so every
listing and shelf row reads what it always read. `books` itself does not have it:
`FiledBookRow` is a view row and `BookRow` is the table's, and
`GET /api/books/:id` answers a book with its credits beside it.

**Four sources of author information are three.** `books.authors` is still the
joined display string and `book_authors` is still written beside `book_author`;
both go with the work that remodels `books`.

`capture` is, by #181: the table, the domain rules in `web/domain/capture/`, the
port and handler in `web/application/capture/`, the Drizzle repository in
`web/infrastructure/capture/`, and `GET /api/books/:id/captures`. The migration
turns each of the image columns on `books` into rows, counts the
photographs the columns name against the rows it wrote, and refuses to finish
when they disagree.

It was the same shape as #179 for two steps: nothing dropped and nothing cut
over, with `books.front_image` and the nine columns beside it still what `Store`,
the crop backfill, the gallery, the queue panel and the shelf row read.

**#228 is where that ends.** The ten columns are dropped, `capture` is what the
app reads, and `server/photographs.ts` is no longer a bridge between two records:
it is the only place a filename becomes a photograph and the only place a
photograph becomes the flat one-per-slot shape the wire still speaks in. Four
functions write one and there is no fifth: a shutter, a downloaded cover, what
the detector made of one, and a hash.

**The two stayed in step only across a save, until #200.** `recordPhotographs`
ran from the two book save routes and from the background chain behind one of
them, and nothing else. The cover backfill (`store.setCoverImage`, from
`hashInBackground`, `backfillCoversInBackground` and `POST /api/backfill/covers`),
the hash backfill (`store.setHashes`) and the `cropCatalogue` and `rehashCovers`
CLIs all wrote those columns without it, so a cover the startup backfill
downloaded landed in `books.cover_image` and did not become a capture row until
that book was next saved.

**#200 answers it with a write-through rather than a reconciliation**, and the
cut-over asked for that answer before it could start. The recording moved off
the five callers and onto the three statements that write those columns:
`Store.setCoverImage`, `Store.setHashes` and `recordCrop` each hand back the row
they wrote and record it, in `server/photographs.ts`, beside the derivation that
turns a column into a photograph. A caller cannot forget what it never had to
remember, and the two command line tools, which go through none of the server's
wiring, are covered because they go through the same three statements.

A reconciliation was the alternative and was rejected for one reason: it leaves
the drift real between its runs, so the answer to "does `capture` describe this
book" would have stayed "as of the last sweep". What the write-through costs is
a `RETURNING *` on three statements and up to four upserts per column write,
which the hash backfill pays over the whole catalogue at startup.

**That repair was owed and `0017` is it.** Rows written between #192 and #214
drifted, so a book whose cover was backfilled in that window had the column and
no photograph. The sweep is the derivation `0006` already performs, run again
over the books whose columns name a photograph with no row, counting what it
wrote and what it amended: a crop or a hash written onto a book whose photographs
already had rows left the row there and missing what the column knew, which a
count of rows alone would not have found.

It ran before any column was dropped, which is the whole reason it is a migration
of its own and not part of `0019`: after the columns go there is nothing left to
repair from. `0019` then counts both ways again, against the columns, and
**refuses rather than dropping a photograph nothing else records.**

**The queue table's three image columns were not migrated by #192, and that was
a decision.** `captures.book_id` was nullable, because a capture waiting to be
confirmed was not a book yet, and `capture.book_id` is not null on purpose. A
queue row with no book had photographs and nowhere to hang them; a queue row that
*had* become a book handed its filenames straight to that book, so its
photographs were already recorded as the book's. Both halves wanted the state
model. **`0011` is where they resolve**, by making every queue row a book and
then giving its photographs rows against it.

`books.state`, `shelved_books` and `idx_books_shelved` are, by the first half of
#183: the column with its check constraint over the seven names, the vocabulary
in `web/domain/books/state.ts`, the migrations `0007` and `0008`, and the two
statements in `Store.neighbours` and the one in `Shelves.booksIn` reading the
view instead of the table.

**The state was taken from the data, not assumed.** A row in `books` with
`checked_out_at` set is `checked_out` and every other row is `shelved`, which is
exactly the predicate the shelf has always been drawn with. `0008` counts the
result, refuses to finish if a row is left undecided, and takes the shelf order
hash either side of itself and refuses if it moved.

`checked_out_at` is still what the client reads and what `Store.setCheckedOut`
compares; the state is written in that same statement so the two cannot drift.

**The queue table is dissolved by the second half of #183**: `0010` gives `books`
the eleven columns that were the queue's and adds `queued_books`,
`catalogued_books` and `idx_books_queued`; `0011` turns every `captures` row into
a book in the state its status said it was in, links the two with `book_id`,
turns its three photographs into `capture` rows, counts the result and takes the
shelf order hash either side of itself. Nothing is dropped: the `captures` table
and its rows are still there, and nothing reads them.

`identified` has rows now. `POST /api/books` is the second of two steps rather
than one: the book was created by its first photograph, and saving it at a shelf
is an update that moves it to `shelved`, in the statement that writes the sort
key.

**A discarded scan is a state, not a deleted row.** Discarding used to remove the
row, and with it the record that anybody had photographed the thing. The
photographs are still deleted, because that is what somebody discarding a scan is
asking for, and the row keeps their names as the record of what was thrown away.

**`GET /api/books` does not list a queued book**, which is the question the first
half deferred. `Store.listRange` and the counts, the duplicate checks and the
cover and hash backfills all read `catalogued_books`, and on the day this landed
that view held exactly the rows `books` held. A book with no title, no author and
no shelf range is not a catalogue entry, and it is already on screen in the
queue, which is the one place anybody can act on it.

`collection`, `sort_strategy`, `fixture`, `area`, `placement_rule` and
`rule_condition` are, by #184: the six tables, the rules in
`web/domain/placement/`, the migrations `0012` and `0013`.

**`area` is `separators` grown a parent, and `area.starts_at` is
`separators.starts_at` under a name that says what it anchors.** It carries
`COLLATE "C"` for the reason that column does. A fixture is a bookcase, an area
is a plank-run, and there is no plank row. See "Fixture, Area" for what the row
did not take, and for the retirement rule that came with reading it.

**Fiction and non-fiction are two rows in `placement_rule`**, written against
the `genre/fiction` and `genre/non-fiction` slugs `0002` derived from
`books.is_fiction`. Each is a *fixture* rule, which is how a run that spans
bookcases is said: it names where the run begins and the run flows on through
the areas after it until the next rule's entry point.

**Cut over by #232, and both tables are gone.** `shelf_ranges` was two rows
saying which bookcase each run began on, which is a `placement_rule` pointing at
a fixture: `bandsOf` in `web/infrastructure/shelving/areas.ts` asks the rules
through `GENRE_RANGES`, the one place a genre slug and a shelf range are the same
fact, and `Shelves.startOf` reads that. `separators` was the boundaries, and the
boundaries are the areas: `boundariesFrom` beside it derives the list
`layoutRange` walks from the areas of a run, so a boundary's `kind` and
`position` come from where its area sits. `applySchema` no longer seeds anything
on start, because the two rows it used to upsert every time are `0013`'s job.

**Leaving both models live for four steps is what made the drop checkable rather
than promised.** Both were live over one catalogue, so every book could be placed
twice and the two answers compared book by book.
`web/infrastructure/db/placement-backfill.test.ts` does that over a 236 book,
eleven separator catalogue, and `web/infrastructure/db/placement-cutover.test.ts`
does it again over a catalogue the size and shape of the live one, from both
ends: the shelf, `layoutRange` over `separators` against the rules over the areas;
and the record, `books.location` against the label the ledger's projection
answers. Several of their tests break a derivation on purpose so the comparison
is watched naming the books it should.

`0023` is the repair that half owed, and it is `0016`'s and `0020`'s rule with
the nouns changed: it walks every range's separators into areas, and re-derives a
`placed` row for every book whose recorded location names an area the projection
does not agree with, while the tables still say something. It **refuses** a
recorded location naming a plank the furniture does not have, rather than
dropping it, and names the books. `0027` and `0028` then ask the same question of
the rows this database actually has, immediately before each table goes: every
boundary is an anchored area and every anchored area is a boundary, both
directions, and every run begins on the bookcase its rule points at.

**A book carrying two `genre` tags files as fiction**, because fiction is rule 1
and `priority` settles a tie. Those are the rows this document already hands to
the cut-over to repair; `0013` counts them and says so on every run rather than
touching them.

`book_placement` and `books.current_area_id` are, by #185: the table, the fold in
`web/domain/placement/ledger.ts`, the port and the rule engine's writer in
`web/application/placement/`, the repository and the projection check in
`web/infrastructure/placement/`, the migrations `0014` and `0015`, and the one
translation module in `web/server/placement-ledger.ts`.

**Cut over by #232, and the three columns are gone.** The ledger is where a book
is, `books.current_area_id` is the projection a shelf is drawn from, and
`withPlacements` in `web/server/placement-ledger.ts` derives `location` and
`checked_out_at` for the wire. No statement anywhere reads a location from
`books`, because there is no location on `books`. `reviewShelving` still computes
the misfile list from a recorded location against a derived label, and what
changed underneath it is that the recorded side is now read out of the rows like
the derived side.

**This one is written on every move, the way #200 taught.** There are exactly
four statements in this repository that change where a book is, and all four are
in `Store`: the insert in `addBook`, the update in `updateBook`, `setLocation`
and `setCheckedOut`. Each calls `server/placement-ledger.ts` on the transaction
handle that is writing the book, so a placement cannot be written without a row,
and since #232 there is nowhere else for one to be written. That is the same
write-through #200 moved `capture` onto after finding five
callers that wrote the image columns without recording anything, arrived at from
the other end: a caller cannot forget what it never had to remember.

**`area` was the table that drifted here, and #213 closes it.** It was built
once, by `0013`, from `separators`, and nothing kept the two in step afterwards:
the overflow cascade and a boundary move both write separators, so a plank that
came into existence since the migration had no area row and no location on it
could be recorded as a placement. That was the ceiling on how much of
`books.location` the ledger could follow, and it is gone.

**#213 answered it the way #200 answered `capture`: a write-through, at the
statements, not a reconciliation**, and #232 turned the arrow round. Four
statements wrote `separators` and there are now **three that write a boundary**,
all three in `DrizzleSeparatorRepository`: `add`, `reanchor` and `remove`. Each
reads the range's boundaries out of the areas, makes the one change it was asked
for, and writes the areas back through `writeBoundaries` in
`web/infrastructure/shelving/areas.ts`, on its own transaction handle, so
`Shelves.applyBoundary`, `moveAcrossBoundary`, `retractMove`,
`RemoveSeparatorHandler` and the routes above them are covered without one of
them being touched. `SeparatorRepository` is still the port everything above
infrastructure asks, so nothing there learned a new word. A reconciliation was
rejected for the reason #200 rejected it: a sweep leaves the drift real between
its runs.

**`reposition` is the one that went.** A separator carried a `position` column,
so removing one meant renumbering the rest or the range stopped describing the
shelves. A boundary's ordinal is where its area sits in the run, which is
contiguous by construction and cannot have a gap in it, so the port lost the
method rather than keeping one that could only ever be a no-op.

**The unit is the range, not the boundary**, which is the one way this is not
shaped like `capture`. A photograph is a fact about one book; an area's
`position` counts boundaries from the start of a run, so moving the first
boundary re-anchors every area after it. So the areas of a range are re-derived
from the boundary list the change produced and **reconciled** against the rows
rather than rebuilt: `book_placement.area_id` and `books.current_area_id` name
area rows, and an area that survives a boundary change has to keep its id.

**Removing a boundary makes the run one area shorter, and the surplus area is
deleted only when nothing names it.** `book_placement.area_id` is
`ON DELETE RESTRICT` on purpose, so an area a book was ever placed in cannot go,
and the delete is conditional rather than attempted: letting the foreign key
refuse would roll back a boundary change somebody had already made at a shelf.

While `separators` was authoritative, keeping the row where it was cost nothing:
a stale area decided nothing, the two models then disagreed about the books on
it, and the check below named them. That stopped being survivable when the areas
became the record, because an area still sitting in a run comes back out of the
boundary list as a boundary nobody asked for. So an area a book has been placed
in is **retired** instead, on the rule under "Fixture, Area": its position goes
negative and every read of the furniture asks for `position >= 0`. That is what
closes the drift #213 could only report.

**A range's run stops where the next range's begins.** Non-fiction starts on
bookcase 4, so a fiction range grown to a fourth bookcase is two runs sharing a
number, which is the arrangement `0013` refuses outright. The bound is still real
and the write still does not refuse it: the areas past it are not written and the
disagreement is reported, because a shelf somebody has already filled is not an
arrangement the app gets to veto. That is a pre-existing ambiguity becoming
visible: such a catalogue is already drawing two planks with the label `4A`.
Where a range begins is a `placement_rule` pointing at a fixture now rather than
a column, so that is the thing that moves.

**The check is worth more than the write-through, and it survived losing one of
the two things it compared.** `areaDisagreements` in
`web/infrastructure/shelving/area-drift.ts` places every shelved book twice, by
`layoutRange` and by `placementOf`, and names the ones the two answers differ
about. There were never two models in it, only two ways of asking one set of rows
where a book goes, and both survive the drop: one takes the range off
`books.shelf_range` and walks a boundary list derived from the areas, which is
the sequence `Shelves.layout` performs; the other takes no notice of that column
and asks which rule claims the book by the tags it carries. They agree only when
a book's range and its genre say the same thing, when no run has grown past where
the next one begins, and when the boundary list really is the inverse of the
areas it came from. Every one of those can be wrong silently, and about a shelf
in somebody's house. `applySchema` still runs it on every start, and like the
projection check it **reports and does not repair**, because rebuilding on sight
erases the evidence of which writer is missing.

**What it no longer catches is an anchor being moved**, because both of its
readings walk the same areas. A boundary written with no area beside it was the
failure it was built for, and there is no `separators` to write one into.
`Shelves.review` is what catches that: it compares where every book is recorded
against where the furniture puts it, which is still two sides, and it is the
misfile list somebody actually acts on.

**Two things the ledger could not say became two things the app refuses**, and
both refusals are the price of there being one record instead of two. A location
naming a plank the furniture does not have used to get no `placed` row, because
`books.location` was a string and would hold anything `parseLocation` accepted,
and `0015` spent a migration counting those on the way in. There is nowhere
behind the ledger for `9Z` to go, so `PATCH /api/books/:id/location` now
**refuses** it. And an empty label, which that route described as taking a book
back to never-placed, is not any of the six kinds: `withdrawn` means given away
and `checked_out` means it is in somebody's bag, and the ledger is append only,
so there is nothing to unsay. It is refused too, saying which of the two was
probably meant.

Both refusals are new at #232, and neither is reachable from the app: every label
the client sends comes from a layout the server drew, and there is no screen that
clears one. A location naming furniture nobody owns was never a fact about the
room, and what the app used to do with one was keep it while quietly disagreeing
with itself about the same book.

**No `assigned` row is written by the migration.** `assigned` is what the rules
want, the rules are TypeScript, and `0013` already settled that a migration does
not reimplement them in SQL. `AssignPlacementsHandler` writes them when the
engine runs, and only where its answer differs from where the book already is.

**The projection is watched from the day it lands.** `books.current_area_id` is a
denormalisation, and two tables here already drift behind what they shadow before
anybody noticed. `countProjectionDisagreements` folds the ledger back out in one
indexed pass and `applySchema` runs it on every start, saying either that every
book agrees or which ones do not; `0015` asks the same question once, at the
moment it writes the projection. Neither repairs: `rebuildProjection` is the
repair and running it is a decision somebody makes having read the line, because
a projection rebuilt on sight destroys the evidence of which writer is missing.

**The wire vocabulary did not move.** `GET /api/captures` still answers with
`pending`, `ready`, `failed` and `done`, so the client, the queue badge and the
browser suite are unchanged. `domain/books/state.ts` holds the pairing and
`server/queue.ts` translates at the edge. Collapsing the two vocabularies belongs
with the work that makes the queue routes book routes.

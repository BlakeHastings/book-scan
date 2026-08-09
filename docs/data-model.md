# The target data model

Fourteen tables. Settled with the owner on 2026-08-06 across eight revisions,
and recorded here because the reasoning matters more than the column lists.

**All of this is built and none of it is read.** The live schema is the
six-table one in `web/server/db.pg.ts`, plus `tag` and `book_tag` from #179,
`author`, `author_alias` and `book_author` from #180, `capture` from #181,
`books.state` with its three views from #183, `collection`, `sort_strategy`,
`fixture`, `area`, `placement_rule` and `rule_condition` from #184, and
`book_placement` with `books.current_area_id` from #185. Every one of those was
added beside the columns it replaces rather than instead of them, and they are
described under "What is built" at the end. **What is left is the cut-over**,
which is where something is finally deleted. `docs/domain-model.md` is the
layering this sits under; #170 is the epic that built the rest.

The point is not that fourteen is better than six. It is that the current schema
describes what the code needed and this one describes the collection.

## What the current schema gets wrong

| Today | Problem |
| --- | --- |
| `books.authors` is a joined string | Author information lives in three places and none is authoritative. "Everything by this author" is a string match, wrong in both directions. |
| `shelf_ranges` | Configuration wearing a table's clothes. Its columns exist only to bootstrap counting. |
| No bookcase anywhere | Bookcases and areas are implied by walking a separator list. Nothing can be said about one. |
| Eight image columns | Exactly one photograph of each kind, forever. A blurred spine cannot be re-shot. |
| `is_fiction`, `category` | Two fixed ways to classify, when people want many. |
| `location`, `shelved_at`, `checked_out_at` | Only the present tense. Where a book has been is not recorded. |
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
compared against a book's sort key. **An area is `separators`, grown a parent.**

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

**A filing name comes from `books.author_filing`**, which is the value the app
already computed for that name with any override applied, and which is the first
component of the `sort_key` the shelf is ordered by. A name that has never been
first-listed has never had one computed, and #180 invents none: the printed name
stands until somebody files it, because the alternative is a second copy of
`filingName()` written in SQL. Which authors those are is on `author.note`.

### Book

Loses most of what it currently is: `location`, `shelved_at`,
`checked_out_at` (ledger), `authors` and `author_filing` (aliases),
`shelf_range` (rules), `is_fiction` and `category` (tags), the eight image
columns (captures), `ocr_text` (never used).

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

**Keep a projection, not only the ledger.** Drawing a shelf needs every book's
current position at once, and scanning the ledger for that is wasteful.
`book.current_area_id` is written in the same transaction, is rebuildable from
the ledger, and a check can prove they agree.

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
| `checked_out` | Off the shelf, still owned. Remembers no area: on return it is placed again by the rules. |
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

## One repair the cut-over owes

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

**`books.is_fiction` was not dropped and nothing was cut over to reading tags.**
It still decides which shelf range a book files into, and it is still in the JSON
the client reads. The migration copies it into tags, carrying its provenance, and
every save afterwards writes both. Removing the column belongs with the work that
remodels `books`, which touches most of the client.

`author`, `author_alias` and `book_author` are, by #180, in the same shape: the
three tables, `web/domain/authorship/`, `web/application/authorship/`,
`web/infrastructure/authorship/`, and routes under `/api/authors` and
`/api/books/:id/authors`.

**Nothing was cut over here either, and this one matters more.**
`books.authors`, `books.author_filing`, `books.sort_key`, `book_authors` and the
`author_filing` table are all exactly as they were, and `books.author_filing` is
still the only thing that decides where a book sits. The new tables are written
beside them on every save. That is deliberate: `author_filing` is the first
component of every sort key in the catalogue, and moving the shelving code onto
a column filled in by a migration is a change worth making on its own rather
than underneath a schema change.

**Three sources of author information are now four**, and that is the honest
cost of an append-only migration path. It ends when `books` is remodelled.

`capture` is, by #181: the table, the domain rules in `web/domain/capture/`, the
port and handler in `web/application/capture/`, the Drizzle repository in
`web/infrastructure/capture/`, and `GET /api/books/:id/captures`. The migration
turns each of the eight image columns on `books` into rows, counts the
photographs the columns name against the rows it wrote, and refuses to finish
when they disagree.

**The same shape as #179, for the same reason: nothing is dropped and nothing is
cut over.** `books.front_image` and the seven columns beside it are still what
`Store`, the crop backfill, the gallery, the queue panel and the shelf row read,
and every save writes both from here on. `server/photographs.ts` is the one place
that says how a column translates, and deleting that file is the last step of the
cut-over rather than the first.

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

**One repair is still owed**, and it belongs with the cut-over for the reason the
tag repair below does. Rows written between #192 and #200 drifted, so a book
whose cover was backfilled in that window has the column and no photograph. The
sweep is the derivation `0006` already performs, run again over the books whose
columns name a photograph with no row, counting what it wrote.

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
is a plank-run, and there is no plank row.

**Fiction and non-fiction are two rows in `placement_rule`**, written against
the `genre/fiction` and `genre/non-fiction` slugs `0002` derived from
`books.is_fiction`. Each is a *fixture* rule, which is how a run that spans
bookcases is said: it names where the run begins and the run flows on through
the areas after it until the next rule's entry point.

**Nothing is cut over, for the fifth time and for the same reason.**
`shelf_ranges` and `separators` keep every row and are still what
`Shelves.layout`, `Store.resolveKey` and the misfile review read.
`books.is_fiction` still decides the shelf range. Nothing in the app reads a
fixture, an area or a rule.

That is what makes the claim checkable rather than promised: both models are
live over one catalogue, so every book can be placed twice and the two answers
compared. `web/infrastructure/db/placement-backfill.test.ts` does that book by
book over a 236 book, eleven separator catalogue, and three of its tests break
the model on purpose so the comparison is watched failing.

**A book carrying two `genre` tags files as fiction**, because fiction is rule 1
and `priority` settles a tie. Those are the rows this document already hands to
the cut-over to repair; `0013` counts them and says so on every run rather than
touching them.

`book_placement` and `books.current_area_id` are, by #185: the table, the fold in
`web/domain/placement/ledger.ts`, the port and the rule engine's writer in
`web/application/placement/`, the repository and the projection check in
`web/infrastructure/placement/`, the migrations `0014` and `0015`, and the one
translation module in `web/server/placement-ledger.ts`.

**Nothing is cut over, for the sixth step and the last one before the cut-over
itself.** `books.location`, `books.shelved_at` and `books.checked_out_at` keep
every value and stay authoritative: the client reads them, `reviewShelving` still
computes the misfile list from `location` against a derived label, and nothing
anywhere reads a placement row or `current_area_id`.

**This one is written on every move, the way #200 taught.** There are exactly
four statements in this repository that change where a book is, and all four are
in `Store`: the insert in `addBook`, the update in `updateBook`, `setLocation`
and `setCheckedOut`. Each calls `server/placement-ledger.ts` on the transaction
handle that is writing the column, so a placement cannot be written without a
row. That is the same write-through #200 moved `capture` onto after finding five
callers that wrote the image columns without recording anything, arrived at from
the other end: a caller cannot forget what it never had to remember.

**`area` is the table that drifts here, and it is #184's rather than #185's.**
It is built once, by `0013`, from `separators`, and nothing keeps the two in step
afterwards: the overflow cascade and a boundary move both write separators, so a
plank that came into existence since the migration has no area row. A location on
such a plank cannot be recorded as a placement, which is the ceiling on how much
of `books.location` the ledger can follow. Closing it means writing an area
wherever a separator is written, and that belongs with whatever cuts `Shelves`
over to the furniture.

**Two things the ledger cannot say, and they are written down rather than
discovered.** A location naming a plank the furniture does not have gets no
`placed` row, because `PATCH /api/books/:id/location` accepts any label
`parseLocation` accepts and inventing an area to hold one would invent furniture
nobody has; `0015` counts those on the way in. And clearing a recorded location,
which the route describes as taking a book back to never-placed, is not any of
the six kinds: `withdrawn` means given away and `checked_out` means it is in
somebody's bag. Both leave the ledger behind `books.location`, which is the
column that is still authoritative.

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

# The target data model

Fourteen tables. Settled with the owner on 2026-08-06 across eight revisions,
and recorded here because the reasoning matters more than the column lists.

**Almost nothing here is built.** The live schema is the six-table one in
`web/server/db.pg.ts`, plus `tag` and `book_tag` from #179, `author`,
`author_alias` and `book_author` from #180, and `capture` from #181, which are
the first three steps of the epic and are described under "What is built" at the
end.
`docs/domain-model.md` is the layering this sits under; #170 is the epic that
builds the rest.

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
| Separate `captures` queue | The queue is a state a book is in, not a different kind of thing. |

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

## Still open

1. ~~Is a tag's slug immutable once created?~~ **Settled by the owner in #179:
   it is.** A slug is never shown to a person, `label` is what anybody reads, and
   renaming changes only the label. There is deliberately no method anywhere that
   takes a slug to a different slug.
2. ~~Can a book carry `genre/fantasy` without `genre`, and does `under genre`
   find it?~~ **Yes to both, since #179.** The question is asked of the path, not
   of a parent row, so no ancestor has to exist for `under` to find its
   descendants.
3. Does the ledger record tag changes, or only placement? A rule change is
   explained by both. Still open: #179 keeps `book_tag.added_at` and the source
   that wrote each row, which says when a tag arrived and who said so, but not
   that a person once took one off.

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

**The two do not stay in step, and "every save" is the exact limit of the
claim.** `recordPhotographs` runs from the two book save routes and from the
background chain behind one of them, and nothing else. The cover backfill
(`store.setCoverImage`, from `hashInBackground`, `backfillCoversInBackground` and
`POST /api/backfill/covers`), the hash backfill (`store.setHashes`) and the
`cropCatalogue` and `rehashCovers` CLIs all write those columns without it. So a
cover the startup backfill downloads next week lands in `books.cover_image` and
does not become a capture row until that book is next saved. `capture` tracks
saves, and it drifts behind the columns between them.

**The queue table's three image columns are not migrated, and that is a
decision.** `captures.book_id` is nullable, because a capture waiting to be
confirmed is not a book yet, and `capture.book_id` is not null on purpose. A
queue row with no book has photographs and nowhere to hang them until #183 gives
a scanned-but-unidentified book a state of its own; a queue row that *has* become
a book handed its filenames straight to that book, so its photographs are already
recorded as the book's and a second row would be a second capture of one
photograph. Both halves want the state model, so both wait for it.

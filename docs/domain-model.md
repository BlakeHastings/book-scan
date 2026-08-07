# The domain

The shape the code is moving towards, and the reasoning behind it. Settled with
the owner over a design conversation on 2026-08-06 and recorded here because a
decision that lives only in a chat log is a decision the next person has to make
again.

**Nothing here is built yet.** `docs/data-model.md` is the schema this implies.
Epic #169 builds the layering, #170 the schema, #171 the multi-user part.

## Layers

```
domain/          plain TypeScript. Imports nothing below it.
application/     command handlers, and the ports they depend on
infrastructure/  drizzle repositories, image store, catalogue clients
web/             express routes, react client, background worker
```

Dependencies point inward. Infrastructure implements interfaces the application
owns, so nothing above infrastructure names Drizzle, Express or the filesystem.

**The test is mechanical, not aspirational: `domain/` must compile with
`infrastructure/` deleted.** A boundary nobody has seen enforced is not
enforced, so a wrong import fails CI rather than review.

## Why an ORM at all, and why this one

The owner's requirement: migrations through an ORM, and application logic that
does not depend on the data store.

**Drizzle, with hand-written repositories.** It is a typed query builder, so
there is nothing to leak: mapping is explicit and a domain class imports nothing
from it. Migrations are first class through `drizzle-kit`.

**MikroORM was the alternative and is the more orthodox DDD choice** — the only
mainstream TypeScript ORM with Data Mapper, Unit of Work and Identity Map
together. Unit of Work genuinely helps when saving an aggregate that spans
tables. It was not chosen because its entities carry ORM decorators, so the
domain layer would import the persistence library, which is the specific thing
the requirement rules out.

**The cost, stated so nobody discovers it later.** No Unit of Work, so an
aggregate spanning tables is saved inside an explicit `Db.tx`. Row-to-object
mapping is written by hand. Both are more code, and both are reviewable.

`Db.tx` already exists and is not being replaced. Stage F proved it pins a
transaction to one connection, checked with `pg_backend_pid()`, and stage G added
advisory locks for read-then-write sequences that would otherwise interleave.
Drizzle runs inside it.

## Actors

| Actor | Does | Never does |
| --- | --- | --- |
| Scanner | Photographs books | Waits for anything |
| Corrector | Fixes what the identifier could not work out | Decides where a book goes |
| Shelver | Puts books in places and says where they went | Edits metadata as a side effect |
| Owner | Defines fixtures, areas, rules, strategies | Any of this often |
| Identifier | Barcode, OCR, catalogue lookup | Confirms anything |
| Cropper | Finds the book in a photograph | Refuses to decline |
| Rule engine | Says where books *should* be | Moves one |

**Three people, rarely the same person.** That is why a book in the queue is
claimed rather than owned, and why a correction has to survive somebody else
re-running a lookup.

## Aggregates

Each is a transaction boundary. Everything else is referenced by id.

### Book

Root. Holds its tags, its author credits and its placement history.

**Invariant:** the current position equals the area of the latest `placed` or
`pinned` entry. Appending to the history and moving the book are one act.

**Placement history lives inside Book deliberately**, against the usual advice to
keep aggregates small. As its own aggregate, "where the book is" and "the latest
entry in its history" sit in different consistency boundaries and keeping them
agreed needs a transaction across both. The invariant is worth more than the
smaller boundary.

### Capture

Root. One photograph, its crop and its perceptual hash.

**Invariant:** belongs to exactly one book, forever. Separate from Book because
the cropper works on a photograph long after the scanner walked away; a shared
transaction boundary would be a lie about their lifecycles.

### Fixture

Root. Holds its areas, ordered.

**Invariant:** area positions are contiguous. Removing one renumbers the rest,
which is why the fixture is the boundary rather than the area.

### PlacementRule

Root. Holds its conditions.

**Invariant:** every condition holds, or the rule does not match. A rule with no
conditions matches nothing rather than everything, because the other way round
is a footgun that files the whole collection into one area.

### Author

Root. Holds its aliases.

**Invariant:** every alias belongs to one author. Merging two authors moves
aliases and never rewrites a book.

### Collection

Root. Default sort strategy and the tag vocabulary.

**Invariant:** a tag slug is unique. This is where an owner attaches when the
app becomes multi-user (#171).

## Commands

| Actor | Command | Aggregate | Emits |
| --- | --- | --- | --- |
| Scanner | `PhotographBook` | Book, Capture | `BookScanned` |
| Scanner | `DiscardScan` | Book | `ScanDiscarded` |
| Identifier | `ProposeIdentity` | Book | `BookIdentified`, `BookUnidentifiable` |
| Cropper | `RecordCrop` | Capture | `CropFound`, `CropDeclined` |
| Corrector | `CorrectDetails` | Book | `DetailsCorrected` |
| Corrector | `ApplyTag`, `RemoveTag` | Book | `TagsChanged` |
| Corrector | `ConfirmIdentity` | Book | `BookConfirmed` |
| Corrector | `ClaimBook`, `ReleaseBook` | Book | |
| Shelver | `ShelveBook` | Book | `BookShelved` |
| Shelver | `PinBook`, `UnpinBook` | Book | `BookPinned`, `BookUnpinned` |
| Shelver | `CheckOutBook`, `CheckInBook` | Book | `BookCheckedOut`, `BookCheckedIn` |
| Shelver | `WithdrawBook` | Book | `BookWithdrawn` |
| Owner | `AddFixture`, `RenameFixture` | Fixture | `FixtureChanged` |
| Owner | `AddArea`, `RemoveArea` | Fixture | `AreasChanged` |
| Owner | `MoveAreaBoundary` | Fixture | `BoundaryMoved` |
| Owner | `DefineRule`, `EnableRule` | PlacementRule | `RulesChanged` |
| Owner | `SetSortStrategy` | Fixture, Collection | `StrategyChanged` |
| Owner | `MergeAuthors` | Author | `AuthorsMerged` |
| Rule engine | `AssignPlacements` | Book | `BooksAssigned` |

**No machine actor has a command that moves a book.** `ProposeIdentity`
proposes, `AssignPlacements` assigns. A book moves when a person issues
`ShelveBook`. That is the descriptive-not-prescriptive rule from
`docs/shelving.md`, expressed as a vocabulary rather than as a convention people
have to remember.

## Policies

| When | Then | Confirmed first |
| --- | --- | --- |
| `BookScanned` | Identifier reads the photographs | no |
| `BookScanned` | Cropper looks for the book in each capture | no |
| `BookConfirmed` | Rule engine assigns a place | no |
| `RulesChanged` | Re-assign every affected book | **yes** |
| `StrategyChanged` | Rebuild sort keys for that run | **yes** |
| `BoundaryMoved` | Re-assign books either side | **yes** |
| `BooksAssigned` | Where assignment differs from placement, the book needs attention | n/a |

The three confirmed ones can each tell somebody to carry forty books across a
room. The confirmation is not politeness; it is the difference between a
suggestion and a chore nobody agreed to.

## Ports

Owned by `application/`, implemented in `infrastructure/`.

| Port | Notes |
| --- | --- |
| `BookRepository`, and one per aggregate | |
| `CatalogueLookup` | Open Library, then Google Books. The domain never learns which answered. |
| `ImageStore` | Files on disk today, object storage later. Nothing above it knows a path. |
| `BarcodeReader`, `TextReader` | Each returns evidence, not conclusions. |
| `CropDetector` | May decline. Declining is a result, not a failure. |
| `Clock` | So a timestamp in a test is not whatever the machine felt like. |

**The data store is not the only dependency worth inverting.** Photographs,
catalogues and time are all things this domain should be describable without.

## Value objects

| Type | Notes |
| --- | --- |
| `SortKey` | Byte-ordered, built by a strategy. Comparable, never parsed back apart. |
| `Isbn` | 13 or 10, check digit valid. Cannot exist invalid. |
| `FilingName` | How a name files. Belongs to an alias, not to a person. |
| `TagSlug` | Hierarchical path. Knows whether it sits under another. |
| `AreaLabel` | Derived from names and positions. Never stored. |
| `PerceptualHash` | Carries its format tag and refuses to compare across formats. |

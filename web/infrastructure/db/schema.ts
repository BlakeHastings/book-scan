/**
 * The Postgres schema, said in Drizzle. The `SCHEMA` constant in
 * `web/server/db.pg.ts` stays the authority on what every column is for, and
 * SQLite keeps its own hand-written schema in `web/server/db.ts`.
 */

import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import type { QueryBuilder } from 'drizzle-orm/pg-core'
import {
  boolean, check, customType, doublePrecision, foreignKey, index, integer, pgTable, pgView,
  primaryKey, text, uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  BOOK_STATES, CATALOGUED_STATES, QUEUED_STATES, SHELVED, type BookState,
} from '../../domain/books/state'
import {
  INHERIT, SORT_STRATEGIES, type SortStrategy,
} from '../../domain/placement/strategies'
import {
  RULE_FIELDS, RULE_OPERATORS, type RuleField, type RuleOperator,
} from '../../domain/placement/rules'
import {
  KINDS_AT_A_PLACE, PLACEMENT_ACTORS, PLACEMENT_KINDS,
  type PlacementActor, type PlacementKind,
} from '../../domain/placement/ledger'

/**
 * `text COLLATE "C"`, which Drizzle has no column builder for: no pg builder has
 * `.collate()`, so a custom type is the supported way to say it, and
 * `drizzle-kit generate` emits whatever `dataType` returns.
 *
 * Byte ordering is load-bearing. Sort keys are sought either side of, ordered by
 * and compared against, and a linguistic collation ignores punctuation on the
 * first pass, folds case and files accented characters beside their unaccented
 * forms. That does not throw: it reorders a shelf, and the app then names the
 * wrong place. See `SORT_KEY_COLUMNS` in db.pg.ts.
 *
 * `drizzle-kit push` and `pull` cannot compare this type against an introspected
 * `text`, and see a change every time. Neither is used here.
 */
const collatedText = customType<{ data: string; driverData: string }>({
  dataType: () => 'text COLLATE "C"',
})

export const books = pgTable('books', {
  // `generatedByDefaultAsIdentity`, never `generatedAlwaysAsIdentity`: the
  // migration has to insert the ids the existing rows already have, and
  // book_authors.book_id, captures.book_id and every cover filename on disk
  // depend on those ids surviving.
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  isbn13: text('isbn13').default(''),
  isbn10: text('isbn10').default(''),
  title: text('title').notNull(),
  subtitle: text('subtitle').default(''),
  authors: text('authors').default(''),
  publisher: text('publisher').default(''),
  published: text('published').default(''),
  pages: text('pages').default(''),
  notes: text('notes').default(''),

  // Derived from the book's genre tag by `rangeOfGenre`, and written by the save
  // that settled it. Every shelf query reads this.
  shelfRange: text('shelf_range').notNull(),
  classificationSource: text('classification_source').default('auto'),
  classificationConfidence: text('classification_confidence').default('unknown'),

  seriesName: text('series_name').default(''),
  seriesIndex: doublePrecision('series_index'),
  titleFiling: collatedText('title_filing').default(''),
  sortKey: collatedText('sort_key').notNull(),

  lookupSource: text('lookup_source').default(''),

  // Records that a cover was looked for, including for a book that has none
  // anywhere, which is what stops the backfill asking about it forever.
  //
  // text, not timestamp, and the same goes for every _at column here.
  // node-postgres hands a timestamptz back as a Date, which would change every
  // JSON payload the client and the end to end suite read.
  coverCheckedAt: text('cover_checked_at'),
  isbnSource: text('isbn_source').default(''),
  // Vestigial; always ''. See the comment on this column in db.ts.
  ocrText: text('ocr_text').default(''),

  scannedAt: text('scanned_at').notNull(),

  /**
   * Where this book is in its life. See `domain/books/state.ts`.
   *
   * `DEFAULT 'scanned'` fails safe: a write that forgot to say anything lands on
   * a state that keeps the row out of `shelved_books`, rather than putting it
   * between two real books on somebody's shelf.
   *
   * text, not a pg enum, so the seven names stay written down once in the
   * domain. The check constraint below is what keeps a typo out.
   */
  state: text('state').$type<BookState>().notNull().default('scanned'),

  /**
   * The first line OCR read off the front cover. Deliberately not `title`: this
   * is what a camera saw, and `title` is what somebody stated. Good enough to
   * name a row in the queue, not good enough to fill in a field somebody saves.
   */
  titleGuess: text('title_guess').default(''),
  /** Every line OCR read off the front cover, newline separated. */
  coverText: text('cover_text').default(''),
  /** Which of the three photographs the worker has read, comma separated. */
  analysed: text('analysed').default(''),
  /** The catalogue's answer, as JSON. Written by the worker, never by a person. */
  draftJson: text('draft_json').default(''),
  /**
   * What a person stated while the book was still in the queue, as JSON. The
   * worker never writes this column, so a re-read cannot lose a correction.
   */
  editJson: text('edit_json').default(''),
  editedBy: text('edited_by').default(''),
  editedAt: text('edited_at'),
  /**
   * What the worker has to say about reading this book's photographs, as opposed
   * to `books.notes`, which is a person's note about the book itself.
   */
  scanNote: text('scan_note').default(''),
  /**
   * Who is working on this book, and since when. A lease rather than a lock:
   * `CaptureQueue.claim` takes a stale claim on exactly the terms it takes a
   * free one, so somebody who walks away does not block the book forever.
   */
  claimedBy: text('claimed_by').default(''),
  claimedAt: text('claimed_at'),
  processedAt: text('processed_at'),

  /**
   * Where this book is, as an area: a projection of `book_placement` and not a
   * second source of truth. It is written in the same transaction as the row it
   * summarises and has to equal `currentAreaOf` in
   * `domain/placement/ledger.ts`. Being a denormalisation it will rot if nothing
   * watches it, so `projectionDisagreements` in
   * `infrastructure/placement/projection.ts` does, on every start.
   *
   * Null means a book on no shelf, which is a genuine absence rather than a
   * state with a name: unplaced, checked out and withdrawn are all nowhere, and
   * each says which it is through `books.state` and its own ledger rows.
   *
   * `ON DELETE SET NULL` rather than cascade or restrict, because this is
   * derived: deleting an area cannot be allowed to delete a book, and it cannot
   * be refused on this column's account when the ledger already refuses it. See
   * `book_placement.area_id`.
   */
  currentAreaId: integer('current_area_id'),
}, (table) => [
  index('idx_books_shelf').on(table.shelfRange, table.sortKey),
  foreignKey({
    name: 'books_current_area_id_fkey',
    columns: [table.currentAreaId],
    // `area` is declared at the bottom of this file, which is legal here and
    // nowhere else in it: the extra-config callback is evaluated when the table
    // is read rather than when the module is, so the reference is resolved long
    // after `const area` exists.
    foreignColumns: [area.id],
  }).onDelete('set null'),
  index('idx_books_isbn13').on(table.isbn13),
  /**
   * The index the `shelved_books` view seeks over rather than filtering the
   * whole catalogue. Its predicate is written from the same constant the view's
   * is, because a partial index whose predicate does not match the query's is
   * not a slower index: it is one the planner silently cannot use at all.
   *
   * `idx_books_shelf` is deliberately left alone. The misfile review and the
   * catalogue listing walk it, and those look at books off a shelf on purpose.
   */
  index('idx_books_shelved')
    .on(table.shelfRange, table.sortKey)
    .where(sql.raw(`"state" = '${SHELVED}'`)),
  /**
   * The same for the queue, which is a handful of rows in front of a catalogue
   * that only grows: without a predicate matching the `queued_books` view's,
   * the queue listing degrades into a scan of every book ever catalogued.
   * Written from `QUEUED_STATES` for the reason above.
   */
  index('idx_books_queued')
    .on(table.state, table.id)
    .where(sql.raw(`"state" IN (${QUEUED_STATES.map((state) => `'${state}'`).join(', ')})`)),
  check('books_state_check', sql.raw(
    `"state" IN (${BOOK_STATES.map((state) => `'${state}'`).join(', ')})`,
  )),
  /**
   * "Everything on this plank, in order", which is the query the projection
   * exists for: without it, drawing one area scans the catalogue.
   */
  index('idx_books_current_area').on(table.currentAreaId, table.sortKey),
])


export const bookAuthors = pgTable('book_authors', {
  bookId: integer('book_id').notNull(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
}, (table) => [
  // Named rather than left to Drizzle, which picks its own names. Every
  // database this app has already created carries the Postgres names,
  // `<table>_pkey` and `<table>_<column>_fkey`, and adopting one of those means
  // the baseline has to describe the constraint it actually has rather than a
  // structurally identical one under a different name.
  primaryKey({ name: 'book_authors_pkey', columns: [table.bookId, table.position] }),
  foreignKey({
    name: 'book_authors_book_id_fkey',
    columns: [table.bookId],
    foreignColumns: [books.id],
  }).onDelete('cascade'),
])

// Load-bearing. No heuristic gets Garcia Marquez and Le Guin both right.
export const authorFiling = pgTable('author_filing', {
  displayKey: text('display_key').primaryKey(),
  filingName: text('filing_name').notNull(),
  isCorporate: integer('is_corporate').notNull().default(0),
  note: text('note').default(''),
})

export const captures = pgTable('captures', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  status: text('status').notNull().default('pending'),
  frontImage: text('front_image').default(''),
  backImage: text('back_image').default(''),
  edgeImage: text('edge_image').default(''),
  isbn13: text('isbn13').default(''),
  isbn10: text('isbn10').default(''),
  isbnSource: text('isbn_source').default(''),
  titleGuess: text('title_guess').default(''),
  coverText: text('cover_text').default(''),
  analysed: text('analysed').default(''),
  draftJson: text('draft_json').default(''),
  editJson: text('edit_json').default(''),
  editedBy: text('edited_by').default(''),
  editedAt: text('edited_at'),
  note: text('note').default(''),
  claimedBy: text('claimed_by').default(''),
  claimedAt: text('claimed_at'),
  frontCrop: text('front_crop').default(''),
  backCrop: text('back_crop').default(''),
  edgeCrop: text('edge_crop').default(''),
  cropped: text('cropped').default(''),
  frontHash: text('front_hash').default(''),
  bookId: integer('book_id'),
  createdAt: text('created_at').notNull(),
  processedAt: text('processed_at'),
}, (table) => [
  index('idx_captures_status').on(table.status, table.id),
  foreignKey({
    name: 'captures_book_id_fkey',
    columns: [table.bookId],
    foreignColumns: [books.id],
  }).onDelete('set null'),
])

/**
 * The vocabulary. One row per idea somebody can put a book under.
 *
 * The slug is the identity and the label is what a person reads. Catalogues
 * answer "Fiction", "fiction" and "FICTION" for one idea, so the slug is
 * normalised on the way in (`domain/tagging/tags.ts`) and a rule matching
 * `genre/fiction` matches all three. A slug is never rewritten: rules reference
 * slugs, so renaming one would make every rule mentioning it stop matching, and
 * books would move with nothing on screen saying why. Renaming is a label
 * change.
 *
 * Hierarchy lives in the slug, Obsidian style (`genre/fantasy`), so there is no
 * parent column and no tree to keep consistent. `COLLATE "C"` is what makes that
 * cheap: on a byte-ordered column the default btree opclass supports a prefix
 * `LIKE`, so `slug LIKE 'genre/%'` is an index range rather than a scan. On a
 * linguistic collation it is neither, and the test databases are created with
 * one on purpose (see `server/testdb.ts`).
 */
export const tag = pgTable('tag', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  slug: collatedText('slug').notNull(),
  label: text('label').notNull(),
  note: text('note').notNull().default(''),
}, (table) => [
  // Unique, because the slug is the identity. It is also the index the prefix
  // range uses, so there is no second index to keep.
  uniqueIndex('tag_slug_key').on(table.slug),
])

/**
 * A book carrying a tag, and who said so.
 *
 * `source` is part of the key, and that is the safety property: a lookup may
 * take back its own tags and no others, so re-running one deletes and rewrites
 * the rows where `source = 'catalogue'` while a person's tag sits in a different
 * row the delete cannot reach. Were the key `(book_id, tag_id)`, a catalogue and
 * a person agreeing about one tag would collapse into one row and the
 * catalogue's retraction would throw away somebody's decision.
 *
 * `source` is `person`, `catalogue` or `guess`. The last is this app's own
 * inference over what a catalogue said, rather than something a catalogue
 * claimed.
 */
export const bookTag = pgTable('book_tag', {
  bookId: integer('book_id').notNull(),
  tagId: integer('tag_id').notNull(),
  source: text('source').notNull(),
  confidence: text('confidence').notNull().default('unknown'),
  addedAt: text('added_at').notNull(),
}, (table) => [
  // Named the way Postgres names them, as book_authors already is.
  primaryKey({ name: 'book_tag_pkey', columns: [table.bookId, table.tagId, table.source] }),
  foreignKey({
    name: 'book_tag_book_id_fkey',
    columns: [table.bookId],
    foreignColumns: [books.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'book_tag_tag_id_fkey',
    columns: [table.tagId],
    foreignColumns: [tag.id],
  }).onDelete('cascade'),
  // "Everything under genre/fantasy" starts from the tag and walks to the
  // books, which the primary key cannot serve: it is prefixed by book_id.
  index('idx_book_tag_tag').on(table.tagId),
])

/**
 * A person, or an organisation, that writes books. It holds no name: the name is
 * on the alias, because one person publishes under several (Iain Banks and Iain
 * M. Banks) and `docs/shelving.md` says those must file apart. So there is
 * nothing to select on but the aliases, deliberately, and "everything by this
 * person" is a join through `author_alias`.
 *
 * `is_corporate` is an integer because this schema carries 0 and 1 for every
 * flag it has. A corporate author is one with a single alias and no comma
 * inversion; nothing branches on the flag today.
 */
export const author = pgTable('author', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  isCorporate: integer('is_corporate').notNull().default(0),
  note: text('note').notNull().default(''),
})

/**
 * One name an author publishes under, and what it files as.
 *
 * `display_name` is the identity and is unique, with the consequence spelled out
 * rather than discovered: two different people who print the same name are one
 * alias here. No data this app holds separates them, so a model that pretended
 * otherwise would be inventing the distinction rather than recording it.
 *
 * `filing_name` is `COLLATE "C"`, because a filing name is compared to order a
 * shelf: it is the first component of `books.sort_key`, and a linguistic
 * collation reorders a shelf without throwing. See `collatedText` above.
 *
 * Nothing reads `filing_name` yet; `books.author_filing` still decides where
 * every book files. The collation is declared now because adding it later means
 * rewriting a column somebody's shelves are already ordered by.
 */
export const authorAlias = pgTable('author_alias', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  authorId: integer('author_id').notNull(),
  displayName: text('display_name').notNull(),
  filingName: collatedText('filing_name').notNull(),
  // Which of an author's names to show when the author is named rather than one
  // of their books.
  isPrimary: integer('is_primary').notNull().default(0),
}, (table) => [
  foreignKey({
    name: 'author_alias_author_id_fkey',
    columns: [table.authorId],
    foreignColumns: [author.id],
  }).onDelete('cascade'),
  uniqueIndex('author_alias_display_name_key').on(table.displayName),
  // "Every name this person publishes under" walks from the author, which the
  // primary key cannot serve.
  index('idx_author_alias_author').on(table.authorId),
])

/**
 * A book crediting an alias, in the order the credits are printed.
 *
 * The alias, not the author, which is what `docs/shelving.md` requires: a
 * pseudonym files as printed, so Banks and Banks M sit apart on the shelf while
 * "everything by this person" still finds both by joining one more table.
 *
 * `(book_id, position)` is the key, so a book cannot credit two people in the
 * same place, and `position` is what "first-listed author" means.
 *
 * The alias reference is deliberately not `ON DELETE cascade`: deleting a name
 * somebody's books are credited to should be refused, not silently take the
 * credits with it. Books cascade, because deleting a book does mean deleting its
 * credits.
 */
export const bookAuthor = pgTable('book_author', {
  bookId: integer('book_id').notNull(),
  position: integer('position').notNull(),
  authorAliasId: integer('author_alias_id').notNull(),
}, (table) => [
  primaryKey({ name: 'book_author_pkey', columns: [table.bookId, table.position] }),
  foreignKey({
    name: 'book_author_book_id_fkey',
    columns: [table.bookId],
    foreignColumns: [books.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'book_author_author_alias_id_fkey',
    columns: [table.authorAliasId],
    foreignColumns: [authorAlias.id],
  }),
  // "Everything credited to this name" starts from the alias, which the primary
  // key cannot serve: it is prefixed by book_id.
  index('idx_book_author_alias').on(table.authorAliasId),
])

/**
 * A book with the name it files under, which is its first credit's alias.
 *
 * `position = 1` rather than the lowest position: every writer of a credit
 * numbers from 1, in `Store` and in `AuthorRepository.credit`, so a book with
 * any credit has that one, and a book with none files under ''.
 *
 * The collation comes through the `coalesce`. `author_alias.filing_name` is
 * `COLLATE "C"` and a string literal has no collation of its own, so the result
 * keeps the column's; `migrate.test.ts` reads these view columns' collation back
 * out of the catalogue rather than leaving that to reading.
 */
const filed = (qb: QueryBuilder) => qb
  .select({
    ...getTableColumns(books),
    authorFiling: sql<string>`coalesce(${authorAlias.filingName}, '')`.as('author_filing'),
  })
  .from(books)
  .leftJoin(bookAuthor, and(eq(bookAuthor.bookId, books.id), eq(bookAuthor.position, 1)))
  .leftJoin(authorAlias, eq(authorAlias.id, bookAuthor.authorAliasId))

/**
 * The books that are on a shelf. Every ordering query reads this and no other:
 * the `state = 'shelved'` condition is stated once, here, so no query can forget
 * it and put an unidentified book between two real ones on a shelf listing.
 *
 * `checked_out` is out of it too: a book in a box on the floor holds no
 * position, so it is absent from the layout and is not something to put another
 * book beside.
 *
 * The collation comes through. A view column has the type, and therefore the
 * collation, of the expression behind it, so `sort_key` here is still
 * `COLLATE "C"` and `ORDER BY sort_key` still orders byte by byte.
 */
export const shelvedBooks = pgView('shelved_books').as((qb) =>
  filed(qb).where(eq(books.state, SHELVED)))

/**
 * The books nobody has put anywhere yet. `CaptureQueue` lists, counts, searches
 * and drains through this relation, and the predicate is written here rather
 * than in that class, so the queue means the same states in every statement.
 *
 * `discarded` is not in it. A scan somebody threw away stays a book, in a state
 * the queue does not show and no shelf can reach, so it is still there to be
 * counted and looked at.
 */
export const queuedBooks = pgView('queued_books').as((qb) =>
  filed(qb).where(inArray(books.state, [...QUEUED_STATES])))

/**
 * The books somebody owns. The catalogue, as opposed to a shelf or a queue.
 *
 * `listRange`, `counts`, `findByIsbn`, `hashIndex`, `imageHashes`,
 * `photographed`, `missingCovers` and `missingHashes` all mean this, and read it
 * rather than each carrying the condition. See `CATALOGUED_STATES` for what each
 * state is doing here.
 */
export const cataloguedBooks = pgView('catalogued_books').as((qb) =>
  filed(qb).where(inArray(books.state, [...CATALOGUED_STATES])))

/**
 * One photograph of one book.
 *
 * `capture` is not `captures`. The plural table above is the scanning queue, a
 * work item waiting for somebody to confirm what a book is; this one is a
 * photograph. The names are one letter apart, and that is what
 * `docs/data-model.md` settles on.
 *
 * `book_id` being one not-null column is the whole of the guarantee that a
 * photograph belongs to at most one book: there is nowhere to put a second. A
 * join table would permit exactly the thing that must not happen.
 *
 * `examined` is a column because two empty crops are two different facts.
 * Examined with an empty `crop_file` means the detector looked and could not
 * find the book in the photograph; not examined means no detector has ever
 * opened it, and a caption may say the first and must not say the second. The
 * wire still speaks in `books.cropped`, a comma separated list of slot names,
 * and `server/photographs.ts` rebuilds it from these flags.
 */
export const capture = pgTable('capture', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  bookId: integer('book_id').notNull(),
  // 'front', 'back', 'spine' or 'catalogue'. What the migration calls `edge` is
  // `spine` here; see domain/capture/photographs.ts.
  kind: text('kind').notNull(),
  // The photograph as taken, and the record. Never overwritten and never
  // replaced by its crop: a bad crop can be redone and the original cannot.
  file: text('file').notNull(),
  // The book cut out of the photograph, when the detector found one. Empty when
  // it declined and when it has not looked, which `examined` tells apart.
  cropFile: text('crop_file').notNull().default(''),
  examined: boolean('examined').notNull().default(false),
  // A difference hash, in the format imagehash.ts writes, for shortlisting a
  // book held up to the camera.
  hash: text('hash').notNull().default(''),
  // text, not timestamp, for the reason written out on books.cover_checked_at.
  takenAt: text('taken_at').notNull(),
}, (table) => [
  foreignKey({
    name: 'capture_book_id_fkey',
    columns: [table.bookId],
    foreignColumns: [books.id],
  }).onDelete('cascade'),
  // A photograph is identified by the book and the file, so the same file
  // offered twice is the same photograph rather than a second one, which is what
  // makes recording idempotent. Deliberately not unique on `file` alone: that
  // would be a claim about the whole cover directory, which this table is in no
  // position to make.
  uniqueIndex('capture_book_file_key').on(table.bookId, table.file),
  // "This book's photographs, newest first", which is every read there is.
  index('idx_capture_book').on(table.bookId, table.takenAt),
])

/**
 * The current photograph of each kind, which is `Photographs.latest` said in
 * SQL, for the two statements that cannot load the rows first:
 * `Store.missingHashes` and `CaptureQueue.waiting` want the books whose current
 * photograph is missing something.
 *
 * The tie-break has to be the one the domain uses. Two photographs of one book
 * can share a timestamp, and `Photographs.of` resolves a tie to the lower id,
 * which is `taken_at desc, id asc` here. Breaking it the other way would answer
 * a different photograph from the one drawn on screen.
 *
 * Nothing writes through this.
 */
export const currentPhotograph = pgView('current_photograph', {
  bookId: integer('book_id').notNull(),
  kind: text('kind').notNull(),
  file: text('file').notNull(),
  cropFile: text('crop_file').notNull(),
  examined: boolean('examined').notNull(),
  hash: text('hash').notNull(),
  takenAt: text('taken_at').notNull(),
}).as(sql`select distinct on ("book_id", "kind") "book_id", "kind", "file", "crop_file", "examined", "hash", "taken_at" from "capture" order by "book_id", "kind", "taken_at" desc, "id" asc`)

/**
 * A boundary move that has been made and that nobody has acted on yet.
 *
 * Moving a book across a boundary is two statements and the app makes only the
 * first: the furniture changes here, and a person says where the book physically
 * ended up through `PATCH /api/books/:id/location`. A row here is that gap, and
 * it exists so the gap can also be closed by taking the move back, for a book
 * nobody ever picked up.
 *
 * This is a receipt, not a second source of truth. `restore` carries what this
 * one move changed, so undoing it puts those boundaries back where they were
 * rather than where the rules would now put them, and those are different
 * answers: a move that empties an area leaves two boundaries on the same anchor,
 * and the apparent opposite move would carry the book two planks instead of one.
 * See `Shelves.retractMove`.
 *
 * One row per book, because a book has one place it came off. A second move
 * before anybody has carried it merges into the same row, keeping the older
 * anchor for any boundary named twice, so the receipt describes the arrangement
 * as it stood the last time this book and its shelf agreed.
 *
 * Neither the separator ids inside `restore` nor `from_area_id` and `to_area_id`
 * are foreign keys, deliberately. Half the separator ids name boundaries the
 * move deleted, and `removeAreaIfUnused` deletes an area outright once no
 * placement, no projection and no rule names it, so a key here would either
 * block a boundary removal somebody is making at a shelf or cascade the receipt
 * away. A dangling id answers nothing, which is the honest failure; a dangling
 * label would answer whichever plank has taken that number over, because a label
 * is derived from position and `resequenceFace` and `editFixture` both move it.
 *
 * A null area id means the receipt was migrated from its label alone and that
 * label named no plank this collection has, retired or not. Every row written
 * since carries both ids.
 */
export const outstandingMove = pgTable('outstanding_move', {
  bookId: integer('book_id').primaryKey(),
  shelfRange: text('shelf_range').notNull(),
  /** The plank the book came off, and where the catalogue still records it. */
  fromLabel: text('from_label').notNull(),
  /** The plank the move assigned it to, and where the layout now draws it. */
  toLabel: text('to_label').notNull(),
  /** Which plank `from_label` was a rendering of. See above. */
  fromAreaId: integer('from_area_id'),
  /** Which plank `to_label` was a rendering of. See above. */
  toAreaId: integer('to_area_id'),
  /** The boundaries this move touched, as JSON. See `OutstandingMove`. */
  restore: text('restore').notNull(),
  // text, not timestamp, for the reason written out on books.cover_checked_at.
  madeAt: text('made_at').notNull(),
}, (table) => [
  foreignKey({
    name: 'outstanding_move_book_id_fkey',
    columns: [table.bookId],
    foreignColumns: [books.id],
  }).onDelete('cascade'),
])

/**
 * The ways a run of books can be ordered. A lookup table, seeded by the app.
 *
 * `inherit` is a row here rather than a null: a fixture or an area that has not
 * chosen says so by carrying `inherit`, and `strategyFor` in
 * `domain/placement/strategies.ts` folds the three levels with the nearest
 * non-inherit answer winning.
 *
 * `available` lets a strategy exist and be unofferable, so a row can be written,
 * and referenced, before anything can compute it.
 *
 * The tiebreak chain is deliberately not in this table. `tag` means tag slug,
 * then author filing, then title filing, and it is fixed in code because it must
 * never be "then whatever the collection's default is": changing a setting on the
 * collection would otherwise reorder every run that had chosen `tag`.
 */
export const sortStrategy = pgTable('sort_strategy', {
  code: text('code').$type<SortStrategy>().primaryKey(),
  /** What a person reads. `code` is what everything else references. */
  label: text('label').notNull(),
  /** True of exactly one row. Carried so a reader does not have to know which. */
  isInherit: boolean('is_inherit').notNull().default(false),
  available: boolean('available').notNull().default(true),
  note: text('note').notNull().default(''),
}, () => [
  check('sort_strategy_code_check', sql.raw(
    `"code" IN (${SORT_STRATEGIES.map((code) => `'${code}'`).join(', ')})`,
  )),
])

/**
 * The collection. One row, holding what is true of the whole thing.
 *
 * `default_sort_strategy` lives here rather than as a rule on every fixture,
 * because a default expressed on every fixture would have to be changed on every
 * fixture and could then disagree with itself. It may not be `inherit`: there is
 * nothing above a collection to ask.
 */
export const collection = pgTable('collection', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  name: text('name').notNull().default(''),
  defaultSortStrategy: text('default_sort_strategy').$type<SortStrategy>()
    .notNull().default('author'),
  note: text('note').notNull().default(''),
}, (table) => [
  foreignKey({
    name: 'collection_default_sort_strategy_fkey',
    columns: [table.defaultSortStrategy],
    foreignColumns: [sortStrategy.code],
  }),
  check('collection_default_sort_strategy_check', sql.raw(
    `"default_sort_strategy" <> '${INHERIT}'`,
  )),
])

/**
 * The thing that groups areas: a bookshelf, a crate, a windowsill.
 *
 * `kind` is the owner's word and nothing branches on it.
 *
 * `position` is the fixture's ordinal in the collection and is the `1` in `1A`.
 * It is deliberately not unique: an arrangement somebody actually has can put
 * two fixtures on one number, and so draw two planks with one label.
 *
 * There is no plank row and there will not be one. A plank can hold two areas,
 * so the plank is not the unit anybody files by. See docs/shelving.md.
 */
export const fixture = pgTable('fixture', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  collectionId: integer('collection_id').notNull(),
  kind: text('kind').notNull().default('bookshelf'),
  /** Empty when nobody has named it, which is when the position is the label. */
  name: text('name').notNull().default(''),
  position: integer('position').notNull(),
  sortStrategy: text('sort_strategy').$type<SortStrategy>().notNull().default(INHERIT),
  note: text('note').notNull().default(''),
}, (table) => [
  foreignKey({
    name: 'fixture_collection_id_fkey',
    columns: [table.collectionId],
    foreignColumns: [collection.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'fixture_sort_strategy_fkey',
    columns: [table.sortStrategy],
    foreignColumns: [sortStrategy.code],
  }),
  index('idx_fixture_collection').on(table.collectionId, table.position),
])

/**
 * A run of books treated as one place.
 *
 * An area is chosen by a person rather than by the carpentry: a divider, a
 * bookend or a pot plant halfway along a plank is enough to make two areas out
 * of one board, and one area can equally be a whole plank. That is why the plank
 * is not a row and this is.
 *
 * `starts_at` holds the sort key of the first book in the run and is compared
 * against `books.sort_key`, so it is `COLLATE "C"`: under a linguistic collation
 * the comparison still returns a row, a nearly right one, and a boundary lands
 * between the wrong two books with nothing thrown. See `collatedText` at the top
 * of this file. Empty on the first area of a run, which is how "from the
 * beginning" is said without a null.
 *
 * Anything but `inherit` in `sort_strategy` makes the area self-contained:
 * nothing overflows into it from the area before it, because a continuous run
 * only works if every area in it orders the same way. `runFrom` in
 * `domain/placement/geography.ts` enforces that, and it is one of the two places
 * the sequence of areas is cut into runs; the other is where a rule points.
 *
 * No label column. A label is derived from the two positions and the two names
 * at read time (`labelFor`), and a stored one goes stale the moment somebody
 * renames a fixture, which is somebody walking to the wrong plank.
 */
export const area = pgTable('area', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  fixtureId: integer('fixture_id').notNull(),
  /** Ordinal within the fixture, 0-based, which is the `A` in `1A`. */
  position: integer('position').notNull(),
  name: text('name').notNull().default(''),
  startsAt: collatedText('starts_at').notNull().default(''),
  sortStrategy: text('sort_strategy').$type<SortStrategy>().notNull().default(INHERIT),
  note: text('note').notNull().default(''),
}, (table) => [
  foreignKey({
    name: 'area_fixture_id_fkey',
    columns: [table.fixtureId],
    foreignColumns: [fixture.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'area_sort_strategy_fkey',
    columns: [table.sortStrategy],
    foreignColumns: [sortStrategy.code],
  }),
  // Two areas in one fixture cannot share an ordinal, unlike `fixture.position`:
  // a duplicate here would give one fixture two areas called B.
  uniqueIndex('area_fixture_position_key').on(table.fixtureId, table.position),
  // The anchor lookup: the last area of a run whose `starts_at` a key has
  // reached. Byte-ordered, so this is a range scan rather than a filter.
  index('idx_area_anchor').on(table.fixtureId, table.startsAt),
])

/**
 * A rule that claims books and points them at a place.
 *
 * Exactly one of `area_id` and `fixture_id`, which the check constraint makes
 * true rather than a convention. They are different kinds of answer: an area
 * rule names one place, and a fixture rule names the first area of that fixture
 * and lets the run flow on through the areas after it, so a range that spans
 * three bookcases is a fixture rule.
 *
 * Area beats fixture, being the more specific statement, and `priority` settles
 * ties within a level, lower first. A book can carry two `genre` tags, so two
 * rules really do claim some books. See `docs/data-model.md`.
 */
export const placementRule = pgTable('placement_rule', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  areaId: integer('area_id'),
  fixtureId: integer('fixture_id'),
  priority: integer('priority').notNull().default(0),
  name: text('name').notNull().default(''),
  enabled: boolean('enabled').notNull().default(true),
}, (table) => [
  foreignKey({
    name: 'placement_rule_area_id_fkey',
    columns: [table.areaId],
    foreignColumns: [area.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'placement_rule_fixture_id_fkey',
    columns: [table.fixtureId],
    foreignColumns: [fixture.id],
  }).onDelete('cascade'),
  check('placement_rule_target_check', sql.raw('num_nonnulls("area_id", "fixture_id") = 1')),
  index('idx_placement_rule_order').on(table.priority, table.id),
])

/**
 * One thing a rule asks about a book. All of a rule's conditions must hold.
 *
 * No nesting and no `OR`. Two ways of saying a thing are two rules, which a
 * person can read down when a book lands somewhere surprising.
 *
 * `value` is a tag slug, never a label, so a rule against `genre/non-fiction`
 * matches the book a catalogue called "Non-fiction" and the one it called
 * "NONFICTION".
 *
 * `operator` is `is` or `under`, because `tag is genre/fantasy` and `tag under
 * genre` are different questions. `under` is strictly beneath and is asked of
 * the slug's path rather than of a parent row, so no ancestor row has to exist.
 */
export const ruleCondition = pgTable('rule_condition', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  ruleId: integer('rule_id').notNull(),
  field: text('field').$type<RuleField>().notNull(),
  operator: text('operator').$type<RuleOperator>().notNull(),
  value: text('value').notNull(),
}, (table) => [
  foreignKey({
    name: 'rule_condition_rule_id_fkey',
    columns: [table.ruleId],
    foreignColumns: [placementRule.id],
  }).onDelete('cascade'),
  check('rule_condition_field_check', sql.raw(
    `"field" IN (${RULE_FIELDS.map((field) => `'${field}'`).join(', ')})`,
  )),
  check('rule_condition_operator_check', sql.raw(
    `"operator" IN (${RULE_OPERATORS.map((operator) => `'${operator}'`).join(', ')})`,
  )),
  index('idx_rule_condition_rule').on(table.ruleId),
])

/**
 * Where a book has been. Append only: one row per move, and nothing is ever
 * updated or deleted. The latest row is where the book is, and the rows behind
 * it are where it has been and who said so.
 *
 * `assigned` is what the rules want; `placed` is what somebody did. They
 * disagree exactly when a book needs attention, so the misfile list reads two
 * facts already written down rather than recomputing a comparison.
 * `domain/placement/ledger.ts` is the fold.
 *
 * That only holds while every row here is about placement. This ledger records
 * placement and not tag changes: do not widen it. `docs/data-model.md` records
 * what that gives up and where retraction would belong.
 *
 * `area_id` is set on exactly `assigned`, `placed` and `pinned`, by a check
 * constraint. Three of the other kinds take a book out of every area there is,
 * and the fourth is `released`, a person declining an assignment: refusing that
 * one an area is what makes "withdrawing an intention cannot rewrite where a
 * book is" a fact about the table rather than a promise about the code.
 *
 * `rule_id` is set on `assigned` rows and no others: it is which rule wanted
 * this, so a person can read the rule's name and its conditions.
 *
 * `sort_key` is the book's key when the row was written, not a foreign key to
 * anything. An area is anchored to a sort key, so a row that did not carry one
 * could not be read back as a position once an edit has re-keyed the book.
 *
 * `actor` distinguishes a person from the engine from a backfill, because a
 * column read by a migration is a weaker claim than somebody standing at a
 * shelf.
 *
 * `ON DELETE RESTRICT`, alone among the foreign keys onto `area`. Everything
 * else about an area is the present arrangement of the furniture and may be torn
 * up; this is the record of where books have been, and a cascade would erase the
 * history of every book that sat on a plank somebody later removed. `fixture`
 * cascades to `area`, so this refuses that too: the history pins the furniture
 * it names.
 */
export const bookPlacement = pgTable('book_placement', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  bookId: integer('book_id').notNull(),
  kind: text('kind').$type<PlacementKind>().notNull(),
  areaId: integer('area_id'),
  sortKey: collatedText('sort_key').notNull().default(''),
  ruleId: integer('rule_id'),
  actor: text('actor').$type<PlacementActor>().notNull(),
  reason: text('reason').notNull().default(''),
  // text, not timestamp, for the reason written out on books.cover_checked_at.
  createdAt: text('created_at').notNull(),
}, (table) => [
  foreignKey({
    name: 'book_placement_book_id_fkey',
    columns: [table.bookId],
    foreignColumns: [books.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'book_placement_area_id_fkey',
    columns: [table.areaId],
    foreignColumns: [area.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'book_placement_rule_id_fkey',
    columns: [table.ruleId],
    foreignColumns: [placementRule.id],
  }).onDelete('restrict'),
  check('book_placement_kind_check', sql.raw(
    `"kind" IN (${PLACEMENT_KINDS.map((kind) => `'${kind}'`).join(', ')})`,
  )),
  check('book_placement_actor_check', sql.raw(
    `"actor" IN (${PLACEMENT_ACTORS.map((actor) => `'${actor}'`).join(', ')})`,
  )),
  /**
   * Written from the same constant `standingOf` folds. Without it the table can
   * hold a row the fold has no answer for: a `checked_out` row naming a plank,
   * which would say a book in a box is on a shelf.
   */
  check('book_placement_area_check', sql.raw(
    `("kind" IN (${KINDS_AT_A_PLACE.map((kind) => `'${kind}'`).join(', ')})) ` +
    '= ("area_id" IS NOT NULL)',
  )),
  check('book_placement_rule_check', sql.raw(
    `"rule_id" IS NULL OR "kind" = 'assigned'`,
  )),
  /**
   * "This book's rows, newest last", which is every read there is, and what
   * `DISTINCT ON (book_id) ... ORDER BY book_id, id DESC` takes the latest row
   * of every book with in one pass.
   */
  index('idx_book_placement_book').on(table.bookId, table.id),
])

/**
 * A person this app owns, and the only thing anything else here references when
 * it means a person.
 *
 * The id is generated here and means nothing to any provider. This app holds no
 * password: identity is asserted by Google or by whoever follows, and a reading
 * status or a borrower keyed on a Google subject would be lost the day the same
 * human signs in with Apple instead, since no provider will tell you the two
 * subjects are one person. `user_identity` is the only table that learns what a
 * provider calls somebody.
 *
 * `enabled` defaults to false, and that column is the whole gate: every person
 * on earth already holds a valid Google credential, so a first sign-in creates
 * the row disabled and hands out the waiting-list screen, and only
 * `web/scripts/enable-user.ts` turns it true.
 *
 * This is not a role and must not become one. There is no `is_admin`, no
 * permissions column and no group, deliberately: an unused column that looks
 * like authorization is worse than none, because the next person builds against
 * it. This answers one question, "is this person one of ours".
 *
 * The table is named `user`, which is a reserved word in Postgres. Drizzle
 * quotes every identifier it emits, so only hand-written SQL has to think about
 * it.
 */
export const user = pgTable('user', {
  /** A `randomUUID()` written at first sign-in, never a provider's subject. */
  id: text('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  // text, not timestamp, for the reason written out on books.cover_checked_at.
  createdAt: text('created_at').notNull(),
  /** When somebody was let in, or null while they are still waiting. */
  enabledAt: text('enabled_at'),
})

/**
 * The link from a person this app owns to an identity it does not.
 *
 * `subject` is what an OpenID Connect provider calls somebody and is only unique
 * within that provider, so `(issuer, subject)` is the key. Email is not an
 * identity: it changes, it is sometimes unverified, and two providers can assert
 * the same address about different people. It is carried here so a human reading
 * the enable script's list can recognise who is knocking, and nothing looks a
 * person up by it.
 *
 * Do not auto-link. A second provider asserting an address an existing user
 * already has is not proof of the same person, and treating it as such is an
 * account takeover, so a sign-in that finds no row here creates a new user,
 * always. Linking a second provider is a deliberate act by somebody already
 * signed in.
 */
export const userIdentity = pgTable('user_identity', {
  /** The provider's issuer, e.g. `https://accounts.google.com`. */
  issuer: text('issuer').notNull(),
  /** What that provider calls this person. Stored nowhere else. */
  subject: text('subject').notNull(),
  userId: text('user_id').notNull(),
  /** For a human reading a list. Not a key and not looked up; see above. */
  email: text('email').notNull().default(''),
  /** Likewise. A provider may not send one, so it may be empty forever. */
  name: text('name').notNull().default(''),
  // text, not timestamp, for the reason written out on books.cover_checked_at.
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
}, (table) => [
  primaryKey({ name: 'user_identity_pkey', columns: [table.issuer, table.subject] }),
  foreignKey({
    name: 'user_identity_user_id_fkey',
    columns: [table.userId],
    foreignColumns: [user.id],
  }).onDelete('cascade'),
  /** "Which identities does this person have", which is what the script lists. */
  index('idx_user_identity_user').on(table.userId),
])

/**
 * A session, ours, addressed by an opaque cookie. A provider says who somebody
 * is once, at the moment they sign in; everything afterwards is this row, so
 * signing somebody out is a write here rather than a conversation with Google.
 *
 * `token_hash` is the SHA-256 of the value in the cookie, hex. The cookie itself
 * is 32 random bytes and exists only in the browser that was handed it, so a
 * copy of this table is not a set of live credentials.
 *
 * `expires_at` is thirty days out, and any use that finds the row more than an
 * hour stale pushes it forward. The hour is there so an ordinary screen, which
 * makes half a dozen requests, does not make half a dozen writes.
 *
 * `revoked_at` ends a session without deleting the evidence that it existed.
 * `enabled` is deliberately not cached here: the gate joins `user` on every
 * request, so disabling somebody takes effect on their next request rather than
 * whenever their session happens to expire.
 */
export const session = pgTable('session', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  // text, not timestamp, for the reason written out on books.cover_checked_at.
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
}, (table) => [
  foreignKey({
    name: 'session_user_id_fkey',
    columns: [table.userId],
    foreignColumns: [user.id],
  }).onDelete('cascade'),
  /** "Every session this person holds", which is what a revocation sweeps. */
  index('idx_session_user').on(table.userId),
])

/**
 * One sign-in part-way through: the state between the redirect out and the
 * redirect back. Three things have to survive between the two requests of the
 * PKCE authorization code flow: the `state` that ties the callback to the start,
 * the `code_verifier` whose challenge went out with the authorization request,
 * and the `nonce` the provider must echo in the ID token.
 *
 * A row rather than a cookie, and the difference is single use. A cookie
 * carrying the verifier can be replayed as often as somebody has copies of it; a
 * row is deleted the moment a callback consumes it, so an authorization code
 * that arrives twice fails the second time.
 *
 * The browser that started the flow is handed the same state in a short-lived
 * cookie, and the callback requires the two to agree. That is what stops a login
 * CSRF: an attacker who feeds their own callback URL to somebody else's browser
 * has a state that browser was never given.
 *
 * Nothing about a person is here, and the row lives for at most ten minutes.
 */
export const signInFlow = pgTable('sign_in_flow', {
  /** 32 random bytes, base64url. Also handed to the browser as a cookie. */
  state: text('state').primaryKey(),
  /** Which provider was asked. `google` today. */
  provider: text('provider').notNull(),
  /** PKCE, RFC 7636. What went out was the SHA-256 of this. */
  codeVerifier: text('code_verifier').notNull(),
  /** Echoed by the provider in the ID token, and checked there. */
  nonce: text('nonce').notNull(),
  /**
   * Where to send the browser afterwards. Refused unless it is a path on this
   * origin beginning with a single `/`, because a redirect target taken out of a
   * query string is an open redirect otherwise.
   */
  next: text('next').notNull().default('/'),
  // text, not timestamp, for the reason written out on books.cover_checked_at.
  startedAt: text('started_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})

/**
 * Every table this schema declares, which is not the same list as every table
 * the baseline creates: several arrive in later migrations instead, so that a
 * database predating them can still be adopted. `migrate.ts` decides that by
 * comparing the baseline's own snapshot against the live catalogue.
 */
export const ALL_TABLES = [
  books, bookAuthors, authorFiling, captures, tag, bookTag,
  author, authorAlias, bookAuthor, capture, outstandingMove,
  sortStrategy, collection, fixture, area, placementRule, ruleCondition,
  bookPlacement,
  // The only tables here that are not about books.
  user, userIdentity, session, signInFlow,
] as const

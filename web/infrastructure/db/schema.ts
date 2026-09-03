/**
 * The Postgres schema, said in Drizzle.
 *
 * This is a deliberately literal transcription of the `SCHEMA` constant in
 * `web/server/db.pg.ts`, which stays the authority on what every column is for
 * and why it exists. Repeating two hundred lines of that prose here would only
 * give it somewhere to drift, so what is written here is the part that is about
 * Drizzle: every place the declaration had to be chosen rather than copied.
 *
 * **Postgres only.** SQLite keeps the hand-written schema in `web/server/db.ts`,
 * including the two functions that bring an old catalogue file forward. There is
 * exactly one such file in the world and stage I removes that driver; describing
 * it twice would be work whose only product is a second thing to keep in step.
 *
 * `web/infrastructure/db/migrate.test.ts` proves that the baseline migration
 * generated from this file produces the same schema `SCHEMA` produces, column
 * for column, index for index and constraint for constraint, on the same
 * database. That test is what makes this file a transcription rather than a
 * claim.
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
 * `text COLLATE "C"`, which Drizzle has no column builder for.
 *
 * This is the first thing Drizzle could not say, and it is not a nicety.
 * `sort_key` is the spine of the product: `Store.neighbours` seeks either side
 * of one, `Shelves.booksIn` orders by it, and `separators.starts_at` is
 * compared against it to find where a shelf begins. A linguistic collation
 * ignores punctuation on the first pass, folds case and files accented
 * characters beside their unaccented forms, so two keys SQLite orders one way
 * come back the other way. That does not throw. It reorders a shelf, and the
 * app then tells somebody to put a book in the wrong place. See the note on
 * `SORT_KEY_COLUMNS` in db.pg.ts, and risk 1 in docs/postgres-migration.md.
 *
 * `drizzle-orm`'s `text()` builder has no `.collate()`, and neither has any
 * other pg column builder: checked against the installed package, where
 * `grep -rn collate node_modules/drizzle-orm/pg-core/columns` finds nothing.
 * A custom type is the supported way to write a column type Drizzle does not
 * model, and `drizzle-kit generate` emits whatever `dataType` returns.
 *
 * The cost, worth knowing before fourteen tables follow: this type is opaque to
 * `drizzle-kit push` and `drizzle-kit pull`, which would compare it against an
 * introspected `text` and see a change every time. Neither is used here.
 * `generate` diffs against the snapshot it wrote last time, which records this
 * same string, so it is stable.
 */
const collatedText = customType<{ data: string; driverData: string }>({
  dataType: () => 'text COLLATE "C"',
})

export const books = pgTable('books', {
  // `generatedByDefaultAsIdentity`, never `generatedAlwaysAsIdentity`, so the
  // stage H migration can insert the ids the SQLite rows already have.
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

  // Derived from the book's genre tag since #223, by `rangeOfGenre`, and
  // written by the save that settled it. Every shelf query reads this.
  //
  // **There is no `is_fiction` beside it any more** (#227). That column decided
  // this one until #223 and shadowed it afterwards, and the second half of the
  // cut-over dropped it: a book's genre is `book_tag`, this is the run the genre
  // settled on, and a second question about the same books is a second tag
  // rather than a second column.
  shelfRange: text('shelf_range').notNull(),
  classificationSource: text('classification_source').default('auto'),
  classificationConfidence: text('classification_confidence').default('unknown'),

  seriesName: text('series_name').default(''),
  seriesIndex: doublePrecision('series_index'),
  titleFiling: collatedText('title_filing').default(''),
  sortKey: collatedText('sort_key').notNull(),

  /*
   * `location`, `shelved_at` and `checked_out_at` are gone (#232).
   *
   * Between them they were the present tense and only the present tense: where
   * a book is, when it got there, and whether it is out of the house. They could
   * not say that it came back from somewhere, that a person put it where the
   * rules did not want it, or that somebody pinned it. `book_placement` says all
   * of that by keeping every move instead of the last one, and
   * `books.current_area_id` below is the projection over it that a shelf is
   * drawn from.
   *
   * `location` was also the only place a plank could be named that no furniture
   * had, which is what `0015` counted on the way in and what the route refuses
   * now. `checked_out_at` is `books.state` plus the `created_at` of the
   * `checked_out` row that put it there, and `shelved_at` was written by three
   * statements and read by none.
   */
  lookupSource: text('lookup_source').default(''),

  /*
   * The ten photograph columns are gone (#228). `front_image`, `back_image`,
   * `edge_image`, `cover_image`, `front_hash`, `cover_hash`, `front_crop`,
   * `back_crop`, `edge_crop` and `cropped` were what the app read; `capture` is
   * what it reads now, and every one of them was a row in that table before any
   * of them was dropped.
   *
   * Between them they allowed exactly one photograph of each kind, forever, so a
   * blurred spine could only be re-shot by overwriting the original. The
   * photographs are half of what is irreplaceable about this catalogue and the
   * app that owns them should not be the thing that deletes one.
   *
   * `cover_checked_at` stays, and that is the one judgement in the set. It
   * records that a cover was looked for, including for a book that turned out to
   * have none anywhere, which is a fact about a search rather than about a
   * photograph. It is also what stops the backfill asking about the same book
   * forever.
   */
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
   * **`DEFAULT 'scanned'` is a decision and it is the one that fails safe.** A
   * book exists from its first photograph, so `scanned` is genuinely where one
   * begins; it is also the value a write that forgot to say anything lands on,
   * and a forgotten state that reads `scanned` keeps the row out of
   * `shelved_books` rather than putting it between two real books on somebody's
   * shelf. `shelved` as the default would have been the opposite: silent, and
   * wrong in the direction nobody notices.
   *
   * The same choice is what makes `0008` provable. The column arrives with
   * every existing row reading `scanned`, which is true of none of them, so the
   * backfill has to state a value for every row and the guard can refuse when
   * one is left behind.
   *
   * text, not a pg enum: an enum is a type whose values are altered by DDL, and
   * the seven names are already written down once in the domain. The check
   * constraint below is what keeps a typo out.
   */
  state: text('state').$type<BookState>().notNull().default('scanned'),

  // ---------------------------------------------------------------------
  // What is known about a book before anybody has said what it is
  //
  // Eleven columns that were the `captures` queue table, which #183 dissolves:
  // a book exists from its first photograph, so the thing in the queue and the
  // thing on the shelf are one row at two points in its life. Everything the
  // queue held that `books` already had a column for (both ISBNs and
  // `isbn_source`, and at the time the three photographs, their crops,
  // `cropped` and `front_hash`) uses that column; these are what was left, and
  // every one of them is about reading a photograph or about somebody holding
  // the book. The photographs have since become rows in `capture` (#228) and
  // the columns on both sides of that sentence are gone.
  //
  // They are empty for every book that came in before this landed, and they
  // stay filled in afterwards rather than being cleared when a book is shelved.
  // A cleared column is a fact destroyed: what OCR read off the cover is the
  // evidence behind the title somebody typed, `BookDetail` quotes it beside the
  // fields (#147), and it is the only record of how a book came to be
  // catalogued the way it is.
  // ---------------------------------------------------------------------

  /**
   * The first line OCR read off the front cover, and never anything else.
   *
   * Deliberately not `title`. A machine's reading of a photograph and a title a
   * person typed are different kinds of fact, and #156 is the defect of a
   * column that could not tell them apart. `title` is what somebody stated;
   * this is what a camera saw. Good enough to name a row in the queue, not good
   * enough to fill in a field somebody will save.
   */
  titleGuess: text('title_guess').default(''),
  /** Every line OCR read off the front cover, newline separated. */
  coverText: text('cover_text').default(''),
  /** Which of the three photographs the worker has read, comma separated. */
  analysed: text('analysed').default(''),
  /**
   * The catalogue's answer, as JSON. The worker's channel, which no person
   * writes.
   */
  draftJson: text('draft_json').default(''),
  /**
   * What a person stated while the book was still in the queue, as JSON. The
   * person's channel, which the worker never writes.
   *
   * The two never share a cell, and that is the whole of the precedence rule
   * from #65: a re-read cannot lose a correction even in principle. This column
   * is the one thing here that is temporary. Now that a queue row is a book
   * row, a stated title has somewhere to go that is not an overlay, and the
   * overlay ends when the routes stop speaking the queue's vocabulary.
   */
  editJson: text('edit_json').default(''),
  editedBy: text('edited_by').default(''),
  editedAt: text('edited_at'),
  /**
   * What the worker has to say about reading this book's photographs.
   *
   * `scan_note`, not `note`, because `books.notes` is already a person's note
   * about the book. One is "no ISBN could be read from these photos" and the
   * other is "signed copy", and two columns one letter apart would be read
   * wrongly by somebody eventually.
   */
  scanNote: text('scan_note').default(''),
  /**
   * Who is working on this book, and since when. A lease rather than a lock:
   * somebody who walks away with a book claimed must not block it forever, so
   * `CaptureQueue.claim` takes a stale claim on exactly the terms it takes a
   * free one.
   */
  claimedBy: text('claimed_by').default(''),
  claimedAt: text('claimed_at'),
  /** When the worker last finished reading this book's photographs. */
  processedAt: text('processed_at'),

  /**
   * Where this book is, as an area. **A projection of `book_placement`, and not
   * a second source of truth.**
   *
   * Drawing a shelf needs every book's position at once, and asking the ledger
   * for that means the latest row of each of hundreds of books on every render.
   * So the answer is kept here, written in the same transaction as the row it
   * summarises, and `currentAreaOf` in `domain/placement/ledger.ts` is what it
   * has to equal. **It is a denormalisation, so it will rot if nothing watches
   * it**: `projectionDisagreements` in `infrastructure/placement/projection.ts`
   * is what watches, and `applySchema` runs it on every start.
   *
   * **The one null in this schema that means something.** A book on no shelf is
   * a genuine absence rather than a state with a name: a book nobody has placed,
   * one that is checked out, and one that has been withdrawn are all nowhere,
   * and each says which it is through `books.state` and through its own rows.
   *
   * `ON DELETE SET NULL` rather than cascade or restrict, because this is
   * derived. Deleting an area cannot be allowed to delete a book, and it cannot
   * be refused on this column's account when the ledger already refuses it: see
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
    // after `const area` exists. The alternative is declaring the furniture
    // above `books`, which would put the six tables nothing reads yet in front
    // of the one everything does.
    foreignColumns: [area.id],
  }).onDelete('set null'),
  index('idx_books_isbn13').on(table.isbn13),
  /**
   * The index the `shelved_books` view is an index seek over rather than a
   * filter across the whole catalogue.
   *
   * Its predicate is written from the same constant the view's is, because a
   * partial index whose predicate does not match the query's is not a slower
   * index: it is an index the planner cannot use at all, silently, and the only
   * symptom is a sequential scan nobody looks at. `state-backfill.test.ts`
   * plans the real query against it rather than trusting that.
   *
   * `idx_books_shelf` is deliberately left alone. It is what the misfile review
   * and the catalogue listing walk, and those look at books that are not on a
   * shelf on purpose.
   */
  index('idx_books_shelved')
    .on(table.shelfRange, table.sortKey)
    .where(sql.raw(`"state" = '${SHELVED}'`)),
  /**
   * The other end of the same argument, and the index `idx_captures_status`
   * used to be.
   *
   * The queue is read on every shutter, on every poll of the camera and on
   * every page of the queue pane, and it is a handful of rows in front of a
   * catalogue that only grows. Without a predicate that matches the view's, the
   * queue listing degrades into a scan of every book ever catalogued, and the
   * only symptom is that scanning gets slower every month. Written from
   * `QUEUED_STATES` for the reason `idx_books_shelved` is written from
   * `SHELVED`: a partial index whose predicate does not match the query's is
   * not a slower index, it is one the planner silently cannot use.
   */
  index('idx_books_queued')
    .on(table.state, table.id)
    .where(sql.raw(`"state" IN (${QUEUED_STATES.map((state) => `'${state}'`).join(', ')})`)),
  check('books_state_check', sql.raw(
    `"state" IN (${BOOK_STATES.map((state) => `'${state}'`).join(', ')})`,
  )),
  /**
   * "Everything on this plank, in order", which is the query the projection
   * exists for. Without it, drawing one area is a scan of the catalogue.
   */
  index('idx_books_current_area').on(table.currentAreaId, table.sortKey),
])


export const bookAuthors = pgTable('book_authors', {
  bookId: integer('book_id').notNull(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
}, (table) => [
  // Named rather than left to Drizzle, which would call this
  // `book_authors_book_id_position_pk` and the key below
  // `book_authors_book_id_books_id_fk`. Postgres names an inline PRIMARY KEY
  // and REFERENCES `<table>_pkey` and `<table>_<column>_fkey`, which is what
  // every database this app has already created carries. Adopting one of those
  // means the baseline has to describe the constraint it actually has, not a
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

/*
 * `shelf_ranges` is gone (#232). It was configuration wearing a table's clothes:
 * two rows saying which bookcase each of the two runs begins on. That is a
 * `placement_rule` pointing at a fixture, which is how a run that spans
 * bookcases has been said since `0013` derived one from the other, and
 * `bandsOf` in `infrastructure/shelving/areas.ts` is the read.
 */

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

/*
 * `separators` is gone (#232), and `area` below is what it became.
 *
 * A boundary says WHERE a shelf starts and nothing about how much it holds, and
 * that has not changed: `area.starts_at` is `separators.starts_at` under a name
 * that says what it anchors, carrying the same `COLLATE "C"` for the same
 * reason. What the row gained is a parent, so a bookcase and a plank-run exist
 * as records rather than as numbers counted while walking a list, and what it
 * lost is `kind` and `position`, both of which are derived from where the area
 * sits: a `shelf` boundary is one whose area hangs on a different fixture from
 * the area before it.
 */

/**
 * The vocabulary. One row per idea somebody can put a book under.
 *
 * **The slug is the identity and the label is what a person reads.** Catalogues
 * answer "Fiction", "fiction" and "FICTION" for one idea, so the slug is
 * normalised on the way in (`domain/tagging/tags.ts`) and a rule that matches
 * `genre/fiction` then matches all three. Without that a rule silently claims a
 * fraction of what it should, which is a book quietly filed in the wrong place
 * rather than an error anybody sees.
 *
 * **The slug never changes.** Renaming is a label change. Rules reference slugs
 * (`rule_condition.value` in docs/data-model.md), and rewriting one would make
 * every rule mentioning it stop matching, which moves books with nothing to show
 * for it. The owner settled this: a slug is never shown to a person, so there is
 * nothing about it worth rewriting.
 *
 * **Hierarchy lives in the slug**, Obsidian style: `genre/fantasy`,
 * `mine/lent-out`. No parent column, so there is no tree to keep consistent and
 * no way for a parent to disagree with a path. `COLLATE "C"` is what makes that
 * cheap rather than expensive: on a byte-ordered column the default btree
 * opclass supports a prefix `LIKE`, so `slug LIKE 'genre/%'` is an index range
 * rather than a scan of the whole vocabulary. On a linguistic collation it is
 * neither, and the test databases are created with one on purpose (see
 * `server/testdb.ts`), so this is checked rather than assumed.
 */
export const tag = pgTable('tag', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  slug: collatedText('slug').notNull(),
  label: text('label').notNull(),
  note: text('note').notNull().default(''),
}, (table) => [
  // Unique, because the slug is the identity: `Collection`'s one invariant in
  // docs/domain-model.md. It is also the index the prefix range uses, so there
  // is no second index to keep.
  uniqueIndex('tag_slug_key').on(table.slug),
])

/**
 * A book carrying a tag, and who said so.
 *
 * **`source` is part of the key, and that is the whole safety property.** A
 * lookup may take back its own tags and no others: re-running one deletes and
 * rewrites the rows where `source = 'catalogue'`, so a tag the catalogue has
 * stopped claiming goes away, and a person's tag is in a different row that the
 * delete cannot reach. Were the key `(book_id, tag_id)`, a catalogue and a
 * person agreeing about one tag would collapse into one row and the catalogue's
 * retraction would silently throw away somebody's decision.
 *
 * `source` is `person`, `catalogue` or `guess`. The last one is what the fiction
 * classifier produces, and it is separate from `catalogue` because it is this
 * app's inference over what a catalogue said rather than something a catalogue
 * claimed.
 *
 * `confidence` and `added_at` are `classification_confidence` and its timestamp,
 * grown up: they used to describe only the fiction guess and now describe every
 * tag. `added_at` is text for the reason every `_at` column here is text, which
 * is written out on `books.cover_checked_at`.
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
 * A person, or an organisation, that writes books. It holds no name.
 *
 * **The name is on the alias, and that is the whole design.** One person
 * publishes under several: Iain Banks and Iain M. Banks, Stephen King and
 * Richard Bachman. Those are one author and several aliases, and putting a name
 * here would force a choice between the two spellings that `docs/shelving.md`
 * says must file apart.
 *
 * So there is nothing to select on except the aliases, and that is deliberate
 * rather than an oversight: "everything by this person" is a join through
 * `author_alias`, which is the query the old comma-joined string could not
 * answer in either direction.
 *
 * `is_corporate` is an integer for the reason `books.is_fiction` is one: this
 * schema carries 0 and 1 for every flag it has, and `author_filing.is_corporate`,
 * which this column absorbs, is already an integer. A corporate author is an
 * author with one alias and no comma inversion; nothing branches on the flag
 * today, and it is here because the column it replaces held it.
 */
export const author = pgTable('author', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  isCorporate: integer('is_corporate').notNull().default(0),
  note: text('note').notNull().default(''),
})

/**
 * One name an author publishes under, and what it files as.
 *
 * **`display_name` is the identity.** A book credits a printed name, and a
 * printed name is all the catalogue has ever recorded, so two aliases with the
 * same display name would be two rows nothing could tell apart: every lookup
 * from a book's credit would have to pick one. It is unique for the same reason
 * `tag.slug` is, and with the same consequence spelled out rather than
 * discovered: **two different people who print the same name are one alias
 * here.** No data this app holds separates them, and a model that pretended
 * otherwise would be inventing the distinction rather than recording it.
 *
 * **`filing_name` is `author_filing.filing_name`, grown up.** That table was the
 * override map, keyed on a normalised spelling of the printed name and holding
 * the corrected filing name for the two cases no heuristic gets right (Spanish
 * compound surnames, the Dutch particle convention). An alias is that row with
 * the printed name kept rather than normalised away, so the override stops being
 * a side table consulted on the way past and becomes the fact itself.
 *
 * `COLLATE "C"`, because a filing name is compared to order a shelf. It is the
 * first component of `books.sort_key` today, and `docs/data-model.md` makes it
 * the second tiebreak of every sort strategy that is not `author`. A linguistic
 * collation folds case and files accented characters beside their unaccented
 * forms, which does not throw: it reorders a shelf. See `collatedText` above and
 * `SORT_KEY_COLUMNS` in db.pg.ts.
 *
 * **Nothing reads this column yet.** `books.author_filing` still decides where
 * every book files and is untouched by #180, exactly as `books.is_fiction`
 * survived #179. The collation is declared now because adding it later means
 * rewriting a column somebody's shelves are already ordered by.
 */
export const authorAlias = pgTable('author_alias', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  authorId: integer('author_id').notNull(),
  displayName: text('display_name').notNull(),
  filingName: collatedText('filing_name').notNull(),
  // Which of an author's names is the one to show when the author is named
  // rather than one of their books. Integer, as every flag here is.
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
 * **The alias, not the author**, which is what `docs/shelving.md` already
 * requires: a pseudonym files as printed, so Banks and Banks M sit apart on the
 * shelf while "everything by this person" still finds both by joining one more
 * table. Crediting the author instead would make that join impossible to undo.
 *
 * `(book_id, position)` is the key, so a book cannot credit two people in the
 * same place, and `position` is what "first-listed author" means. It replaces
 * `book_authors`, which held the printed name inline and which nothing has ever
 * read back.
 *
 * The alias reference is not `ON DELETE cascade`: deleting a name somebody's
 * books are credited to should be refused, not silently take the credits with
 * it. Books cascade, because deleting a book does mean deleting its credits.
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
 * **The one place that join is written**, and it is why the three views below
 * live down here rather than beside `books` where they used to. `sort_key`'s
 * first component is what the first-listed name files under, `books.author_filing`
 * was a copy of that answer, and #227 dropped the copy: the fact is
 * `author_alias.filing_name` now, reached through the credit at position 1.
 *
 * `position = 1` rather than the lowest position, which `0004` was careful about
 * over the same join. Every writer of a credit numbers from 1, in `Store` and in
 * `AuthorRepository.credit`, so a book with any credit has that one; a book with
 * none, which is every book still in the queue, files under ''.
 *
 * **The collation comes through the `coalesce`.** `author_alias.filing_name` is
 * `COLLATE "C"` and a string literal has no collation of its own, so the result
 * keeps the column's. That is not obvious enough to leave to reading:
 * `migrate.test.ts` reads the collation of these view columns back out of the
 * catalogue.
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
 * The books that are on a shelf. Every ordering query reads this and no other.
 *
 * **This view is the whole answer to the risk in #183.** `books` drives shelf
 * ordering and misfile detection, and until now the rows with no business in
 * either were kept out by being in a different table. Collapsing the two means
 * every ordering query needs `WHERE state = 'shelved'`, and forgetting once puts
 * an unidentified book between two real ones on somebody's shelf listing. A
 * reviewer cannot check for a `WHERE` clause that will be written next month, so
 * the condition is stated once, here, and `Store.neighbours` and
 * `Shelves.booksIn` read a relation that cannot contain the wrong rows.
 *
 * `checked_out` is out of it too, and always was: a book in a box on the floor
 * holds no position, so it is absent from the layout and is not something to put
 * another book beside. That was `checked_out_at IS NULL` and is now one state
 * among seven, which is the same set of rows on the day this lands.
 *
 * **The collation comes through.** A view column has the type, and therefore the
 * collation, of the expression behind it, so `sort_key` here is still
 * `COLLATE "C"` and `ORDER BY sort_key` still orders byte by byte. That is not
 * obvious enough to leave to reading: `migrate.test.ts` reads the collation back
 * out of the catalogue for this view's columns as well as for the table's.
 */
export const shelvedBooks = pgView('shelved_books').as((qb) =>
  filed(qb).where(eq(books.state, SHELVED)))

/**
 * The books nobody has put anywhere yet. The queue, which is a query now.
 *
 * The same argument as `shelved_books`, made from the other side. That view
 * exists so a book that is not on a shelf cannot reach one; this one exists so
 * the queue keeps meaning the same three states in every statement that reads
 * it. `CaptureQueue` lists, counts, searches and drains through this relation,
 * and the predicate is written here and nowhere in that class.
 *
 * **`discarded` is not in it, and that is the whole reason it is a state.** A
 * scan somebody threw away used to be a row somebody deleted, so the record of
 * having scanned the wrong thing went with it. It is a book now, in a state the
 * queue does not show and no shelf can reach, and it is still there to be
 * counted and looked at.
 */
export const queuedBooks = pgView('queued_books').as((qb) =>
  filed(qb).where(inArray(books.state, [...QUEUED_STATES])))

/**
 * The books somebody owns. The catalogue, as opposed to a shelf or a queue.
 *
 * Three views and no more, one per question anybody asks of this table, and the
 * seven states fall into them without overlapping: `shelved` is in this and in
 * `shelved_books`, `checked_out` and `withdrawn` are in this alone, the three
 * early states are in `queued_books` alone, and `discarded` is in none of them.
 *
 * Why this is a view rather than a condition in the eight statements that want
 * it: exactly the argument `shelved_books` was built on. `listRange`, `counts`,
 * `findByIsbn`, `hashIndex`, `imageHashes`, `photographed`, `missingCovers` and
 * `missingHashes` all mean "the catalogue" and all of them silently started
 * meaning something else the moment a queue row became a book. Eight places to
 * remember is eight places to forget, and the failure is quiet in every one:
 * a cover downloaded for a book nobody has identified, a duplicate check that
 * matches a photograph in the queue, a library listing with a row that has no
 * title in it.
 *
 * See `CATALOGUED_STATES` for what each state is doing here, and for the
 * question `Store.listRange` deferred to this change.
 */
export const cataloguedBooks = pgView('catalogued_books').as((qb) =>
  filed(qb).where(inArray(books.state, [...CATALOGUED_STATES])))

/**
 * One photograph of one book.
 *
 * **`capture` is not `captures`.** The plural table above is the scanning queue
 * and is a different thing entirely: a work item waiting for somebody to confirm
 * what a book is. This one is a photograph. The names are one letter apart and
 * that is unfortunate, but it is what `docs/data-model.md` settles on and the
 * queue table is dissolved by #183 rather than renamed, so the collision is
 * temporary and inventing a third word for a photograph would outlive it.
 *
 * ## What this replaces
 *
 * Ten columns on `books`: `front_image`, `back_image`, `edge_image`,
 * `cover_image`, `front_hash`, `cover_hash`, `front_crop`, `back_crop`,
 * `edge_crop` and `cropped`. Between them they allowed exactly one photograph of
 * each kind, forever, so a blurred spine could only be re-shot by overwriting
 * the original. The photographs are half of what is irreplaceable about this
 * catalogue and the app that owns them should not be the thing that deletes one.
 * A row per photograph lifts that.
 *
 * **They are gone, by #228.** This table is what the app reads, every write of a
 * photograph goes through `server/photographs.ts`, and `0017` repaired the rows
 * the write-through missed before any of the columns was dropped. #181 added the
 * table beside them and #214 made the two stay in step; this is the step where
 * there stops being a second answer.
 *
 * `current_photograph` below is the one relation that asks "the newest of each
 * kind", which is the question every screen asks and the one the columns used to
 * answer by having nowhere to put a second.
 *
 * ## `book_id` is not null, and one column is the enforcement
 *
 * A book exists from its first photograph, so there is no orphan state. One
 * column is also the whole of the guarantee that a photograph belongs to at most
 * one book: there is nowhere to put a second. A join table would permit exactly
 * the thing that must not happen, which is why the queue table disappears in
 * #183 rather than growing a link.
 *
 * ## `examined` is a column because two empty crops are two different facts
 *
 * `examined` true with an empty `crop_file` means the detector looked at this
 * photograph and could not find the book in it. `examined` false with an empty
 * `crop_file` means no detector has ever opened it. A caption may say "the book
 * could not be picked out of this photo" about the first and must not say it
 * about the second. That used to live in `books.cropped`, a comma separated list
 * of slot names, which was one string per row describing three photographs and
 * therefore could not survive a second photograph of a kind at all. The wire
 * still speaks in that string and `server/photographs.ts` rebuilds it from these
 * flags, which is the one place the two spellings of the distinction meet.
 *
 * `boolean`, unlike `books.is_fiction`, which is an integer because the JSON
 * contract carries 0 and 1 and the client reads them. Nothing reads this column
 * over the wire yet, so there is no such constraint to inherit and no reason to
 * carry a second spelling of true.
 */
export const capture = pgTable('capture', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  bookId: integer('book_id').notNull(),
  // 'front', 'back', 'spine' or 'catalogue'. `spine` is what the old columns
  // call `edge`; see domain/capture/photographs.ts for why it is renamed here
  // and nowhere above the migration.
  kind: text('kind').notNull(),
  // The photograph as taken, and the record. Never overwritten and never
  // replaced by its crop: a bad crop costs nothing and can be redone, and the
  // original cannot.
  file: text('file').notNull(),
  // The book cut out of the photograph, when the detector found one. Empty when
  // it declined and when it has not looked, which `examined` tells apart.
  cropFile: text('crop_file').notNull().default(''),
  examined: boolean('examined').notNull().default(false),
  // A difference hash, in the format imagehash.ts writes, for shortlisting a
  // book held up to the camera. Carries books.front_hash for a front photograph
  // and books.cover_hash for the catalogue artwork, which are the same
  // algorithm and the same format tag.
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
  // offered twice is the same photograph rather than a second one. That is what
  // makes recording idempotent, which the migration and every save both rely on.
  // Deliberately not unique on `file` alone: that would be a claim about the
  // whole cover directory, which this table is in no position to make.
  uniqueIndex('capture_book_file_key').on(table.bookId, table.file),
  // "This book's photographs, newest first", which is every read there is.
  index('idx_capture_book').on(table.bookId, table.takenAt),
])

/**
 * The current photograph of each kind, which is `Photographs.latest` said in
 * SQL.
 *
 * A book has as many photographs of a kind as somebody has taken, and every
 * question a shelf asks is about the newest one: "the spine" is what you look
 * for a book by, and a spine re-shot today is somebody deciding yesterday's was
 * not good enough. The domain answers that with `Photographs.latest`, over rows
 * already loaded. Two statements cannot load the rows first, because what they
 * want is the books whose current photograph is missing something, and this is
 * the relation they read: `Store.missingHashes` and `CaptureQueue.waiting`.
 *
 * **The tie-break is the same one the domain uses, and it has to be.** Two
 * photographs of one book can share a timestamp: every row `0006` wrote carries
 * `books.scanned_at`, which was one value for all three slots. `Photographs.of`
 * sorts newest first with a stable sort over rows read by id, so a tie resolves
 * to the lower id, which is `taken_at desc, id asc` here. A view that broke the
 * tie the other way would answer a different photograph from the one drawn on
 * screen for exactly the books the migration touched.
 *
 * Nothing writes through this. It is one row per (book, kind) and the table
 * behind it keeps every photograph there has ever been, which is the whole
 * reason the columns it replaces had to go.
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
 * Moving a book across a boundary is two statements, and the app only makes the
 * first one: the furniture changes here, and a person says where the book
 * physically ended up through `PATCH /api/books/:id/location`. Between the two
 * the book is genuinely not where the catalogue has it, which is what
 * docs/shelving.md means by leaving the move outstanding. A row here is exactly
 * that gap, and it exists so the gap can be closed the other way as well: by
 * taking the move back, for a book nobody ever picked up.
 *
 * **This is a receipt, not a second source of truth.** `separators` still says
 * where every boundary is. What `restore` carries is what this one move changed,
 * so undoing it can put those boundaries back where they *were*, rather than
 * where the rules would now put them. Those are different answers: a move that
 * empties an area leaves two boundaries on the same anchor, and the boundary
 * move that looks like the opposite of the one just made would carry the book
 * two planks instead of one. See `Shelves.retractMove`.
 *
 * One row per book, because a book has one place it came off. A second move
 * before anybody has carried it merges into the same row, keeping the older
 * anchor for any boundary named twice, so the receipt always describes the
 * arrangement as it stood the last time this book and its shelf agreed.
 *
 * The separator ids inside `restore` are deliberately **not** a foreign key.
 * Half of them name boundaries the move deleted, whose ids are gone, and a
 * receipt that could not mention them would be a receipt for the wrong subset.
 * Nothing reads this except the retraction, which checks the shelves afterwards
 * and refuses rather than trusting what it found here.
 *
 * ## The two planks are said twice, and only one of the two is an identity
 *
 * `from_area_id` and `to_area_id` are which planks (#481). `from_label` and
 * `to_label` are what they were called when the move was made, kept because the
 * retraction compares its own arithmetic against them and because a receipt
 * saying what somebody read that day is worth keeping.
 *
 * **An address is a statement about position, and position is what a boundary
 * move changes**, which is why the labels alone were not enough. A plank's label
 * is derived from where its piece stands and where it stands on that piece, and
 * both of those move: `resequenceFace` renumbers a face when an area comes off
 * it, so the row that read `1C` reads `1B` afterwards, and `editFixture` renumbers
 * a piece, so two pieces can stand on one number, which is what `AreaStanding`
 * exists to say. A reader parsing `4B` back gets whichever row answers to that
 * address **today**, and the receipt is about the room somebody was standing in
 * then.
 *
 * ## Why these are not a foreign key to `area`, and neither is nullable-for-fun
 *
 * The receipt has to be readable **after the plank it names is gone**, because
 * the move that wrote it is what retired the plank. Retirement leaves the row
 * (`retiredPosition`), so a foreign key would survive that much. What it would
 * not survive is `removeAreaIfUnused`, which **deletes** an area outright when
 * no placement, no projection and no rule names it. A foreign key here would
 * make an outstanding receipt a fourth such reference: either it blocks a
 * boundary removal somebody is making at a shelf, or it cascades and destroys
 * the receipt, or it nulls the ids and calls that a record. All three are worse
 * than a plain integer that names a row which may since have gone.
 *
 * That is the same argument `restore` already makes about separator ids one
 * paragraph up. **A receipt is a record of what happened, not a reference to
 * what exists**, and a dangling id is the honest failure: it answers nothing,
 * where a dangling address answers whichever plank has taken that number over.
 *
 * Null means one thing, and only rows written before #481 can carry it: the
 * receipt was migrated from its address alone and that address named no plank
 * this collection has, retired or not. `0030` is where that is decided, once,
 * and every row written since carries both ids.
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
 * **`inherit` is a row here, not a null**, and that is the owner's decision
 * rather than a style: no absence in this schema means anything. A fixture or an
 * area that has not chosen says so by carrying `inherit`, and `strategyFor` in
 * `domain/placement/strategies.ts` folds the three levels with the nearest
 * non-inherit answer winning.
 *
 * **`available` lets a strategy exist and be unofferable.** That is where colour
 * sorting waits until there is a colour to sort by: the row can be written, and
 * referenced, before anything can compute it.
 *
 * **The tiebreak chain is not in this table.** `tag` means tag slug, then author
 * filing, then title filing, and it is fixed in code because it must never be
 * "then whatever the collection's default is": changing a setting on the
 * collection would otherwise reorder every run that had explicitly chosen `tag`.
 * A row here that carried its own tiebreaks would be a second place for that to
 * be said, and a place a person could edit.
 *
 * `code` is the primary key and is what every other table references, so a
 * strategy is spelled once. The check constraint is written from the same
 * constant the domain is, for the reason `books_state_check` is.
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
 * fixture and could then disagree with itself.
 *
 * It may not be `inherit`: there is nothing above a collection to ask, and a
 * collection inheriting from nowhere would be exactly the absent value this
 * schema does not have. The check constraint says so rather than the comment.
 *
 * `owner` is not here yet. #171 is the multi-user epic and it is `shaping`;
 * adding a column for a question nobody has answered would be inventing the
 * answer.
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
 * **`kind` is the owner's word and nothing branches on it.** It is here so
 * somebody can say what a thing is, not so code can behave differently about a
 * crate.
 *
 * `position` is the fixture's ordinal in the collection and is the `1` in `1A`.
 * It is deliberately **not** unique: `shelf_ranges.start_shelf` puts non-fiction
 * on bookcase 4 today, so a fiction range that grew to four bookcases would
 * already have two fixtures called 4, and it would already be drawing two planks
 * with one label. That is a property of the arrangement this migration copies
 * rather than one it introduces, and refusing to record it would refuse a
 * catalogue somebody actually has.
 *
 * **There is no plank row and there will not be one.** A plank can hold two
 * areas, so the plank is not the unit anybody files by. See docs/shelving.md.
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
 * A run of books treated as one place. **`separators`, grown a parent.**
 *
 * An area is chosen by a person rather than by the carpentry: a divider, a
 * bookend or a pot plant halfway along a plank is enough to make two areas out
 * of one board, and one area can equally be a whole plank. That is why the plank
 * is not a row and this is.
 *
 * ## `starts_at` is `COLLATE "C"`, and that is the load-bearing part
 *
 * It holds the sort key of the first book in the run and is compared against
 * `books.sort_key`, exactly as `separators.starts_at` is. A linguistic collation
 * ignores punctuation on the first pass, folds case and files accented
 * characters beside their unaccented forms, so the comparison would still return
 * a row: a nearly right one. Nothing throws, a boundary lands between the wrong
 * two books, and somebody is told to put a book where it does not go. See
 * `collatedText` at the top of this file and the assertion list in
 * `migrate.test.ts`.
 *
 * Empty on the first area of a run, which is how "from the beginning" is said
 * without a null.
 *
 * ## Setting `sort_strategy` makes an area self-contained
 *
 * Anything but `inherit` here means nothing overflows into this area from the
 * area before it, because a continuous run only works if every area in it orders
 * the same way. `runFrom` in `domain/placement/geography.ts` is where that is
 * enforced, and it is the second of the two places the sequence of areas is cut
 * into runs; the other is where a placement rule points.
 *
 * ## No label column
 *
 * A label is derived from the two positions and the two names at read time
 * (`labelFor`). A stored one goes stale the moment somebody renames a fixture,
 * and a stale label on a shelf listing is somebody walking to the wrong plank.
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
  // Two areas in one fixture cannot share an ordinal: unlike `fixture.position`
  // there is no arrangement in the current schema that produces one, and a
  // duplicate here would give one fixture two areas called B.
  uniqueIndex('area_fixture_position_key').on(table.fixtureId, table.position),
  // The anchor lookup: the last area of a run whose `starts_at` a key has
  // reached. Byte-ordered, so this is a range scan rather than a filter.
  index('idx_area_anchor').on(table.fixtureId, table.startsAt),
])

/**
 * A rule that claims books and points them at a place.
 *
 * **This is the inversion in one table.** Today `books.is_fiction` decides which
 * of two ranges a book joins, and the two ranges are written into the code. Here
 * fiction and non-fiction are two rows in this table, and a third question about
 * the same books is a third row rather than a third column.
 *
 * **Exactly one of `area_id` and `fixture_id`**, and the check constraint is
 * what makes that true rather than a convention. They are different kinds of
 * answer: an area rule names one place, and a fixture rule names the first area
 * of that fixture and lets the run flow on through the areas after it. A range
 * that spans three bookcases is a fixture rule.
 *
 * **Area beats fixture**, being the more specific statement, and `priority`
 * settles ties within a level, lower first. That is not decoration: a book
 * corrected before #201 can still carry two `genre` tags, so two rules really do
 * claim some books, and the priority is what says which one wins. See
 * `docs/data-model.md`, "One repair the cut-over owes".
 */
export const placementRule = pgTable('placement_rule', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  areaId: integer('area_id'),
  fixtureId: integer('fixture_id'),
  /** Lower is tried first, the way a numbered list is read. */
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
 * One thing a rule asks about a book. **All of a rule's conditions must hold.**
 *
 * No nesting and no `OR`. Two ways of saying a thing are two rules, which a
 * screen can build and a person can read down when a book lands somewhere
 * surprising; a boolean tree is unreadable at exactly the moment somebody needs
 * to read it.
 *
 * `value` is a tag **slug**, never a label. The slug is the identity and is
 * normalised, so a rule against `genre/non-fiction` matches the book a catalogue
 * called "Non-fiction" and the one it called "NONFICTION". It is also why a slug
 * is never rewritten: renaming one would make every rule mentioning it stop
 * matching, and books would move with nothing on screen saying why.
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
 * Where a book has been. **Append only: one row per move, and nothing is ever
 * updated or deleted.**
 *
 * `books.location`, `books.shelved_at` and `books.checked_out_at` are the
 * present tense and only the present tense. This is the rest of the sentence:
 * the latest row is where the book is, and the rows behind it are where it has
 * been and who said so.
 *
 * ## `assigned` against `placed` is the whole design
 *
 * **`assigned` is what the rules want; `placed` is what somebody did.** They
 * disagree exactly when a book needs attention, so the misfile list stops being
 * `reviewShelving` recomputing a comparison every time anybody asks and becomes
 * two facts already written down, with a rule that has a name behind one of
 * them. `domain/placement/ledger.ts` is the fold.
 *
 * **That only holds while every row here is about placement.** The owner settled
 * on 2026-08-07 that this ledger records placement and not tag changes, and
 * `docs/data-model.md` records what that gives up on purpose and where
 * retraction belongs if it is ever wanted. Do not widen this table.
 *
 * ## What each column is doing
 *
 * `area_id` is set on exactly `assigned`, `placed` and `pinned`, which is said
 * by a check constraint rather than by this paragraph. Three of the other four
 * kinds take a book out of every area there is, so an area on one of them would
 * be a claim about where a book that is nowhere is. The fourth is `released`,
 * a person declining an assignment, and the constraint refusing it an area is
 * what makes "withdrawing an intention cannot rewrite where a book is" a fact
 * about the table rather than a promise about the code.
 *
 * `rule_id` is set on `assigned` rows and on no others: it is which rule wanted
 * this, which is the answer to "why is the app telling me to move this book",
 * and a person can read the rule's name and its conditions. A `placed` row has
 * no rule behind it by definition.
 *
 * `sort_key` is the book's key when the row was written, not a foreign key to
 * anything. An area is anchored to a sort key, so a row that did not carry one
 * could not be read back as a position once an edit has re-keyed the book.
 *
 * `actor` distinguishes a person from the engine from a backfill. The third is
 * the honest one: every row `0015` wrote says `migration`, because a column read
 * by a migration is a weaker claim than somebody standing at a shelf.
 *
 * ## Deleting an area is refused rather than cascaded
 *
 * `ON DELETE RESTRICT`, alone among the foreign keys onto `area`. Everything
 * else about an area is the present arrangement of the furniture and may be
 * torn up; this is the record of where books have been, and a cascade here would
 * quietly erase the history of every book that ever sat on a plank somebody
 * later removed. `fixture` cascades to `area`, so this refuses that too, which
 * is the correct answer for an append-only table: the history pins the
 * furniture it names.
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
   * An area on exactly the kinds that put a book somewhere, written from the
   * same constant `standingOf` folds. Without it the table can hold a row the
   * fold has no answer for: a `checked_out` row naming a plank, which would say
   * a book in a box is on a shelf.
   */
  check('book_placement_area_check', sql.raw(
    `("kind" IN (${KINDS_AT_A_PLACE.map((kind) => `'${kind}'`).join(', ')})) ` +
    '= ("area_id" IS NOT NULL)',
  )),
  check('book_placement_rule_check', sql.raw(
    `"rule_id" IS NULL OR "kind" = 'assigned'`,
  )),
  /**
   * "This book's rows, newest last", which is every read there is: the fold, the
   * projection check and the misfile list all want one book's history in id
   * order, and `DISTINCT ON (book_id) ... ORDER BY book_id, id DESC` is how the
   * latest row of every book is taken in one pass.
   */
  index('idx_book_placement_book').on(table.bookId, table.id),
])

/**
 * A person this app owns, and the only thing anything else here will ever
 * reference when it means a person (#521).
 *
 * ## Why the id is ours and not the provider's
 *
 * This app holds no password and never will: #510 settled that, and identity is
 * asserted by Google or by whoever follows. What it does hold is the person, and
 * the reason is the owner's own sentence about "relationships between things
 * like books". A reading status, a borrower or a claim keyed on a Google subject
 * is lost the day the same human signs in with Apple instead, because that is a
 * different subject from a different issuer and no provider will tell you the
 * two are one person. So the id is generated here, it means nothing anywhere
 * else, and `user_identity` is the only table that ever learns what a provider
 * calls somebody.
 *
 * ## Why `enabled` defaults to false, which is the whole gate
 *
 * "Sign in with Google" proves who somebody is. It does not say they may come
 * in, and **every person on earth already holds a valid Google credential**, so
 * a login with no list behind it is a formality that admits the internet. The
 * list is this column. A first sign-in creates the row disabled, the person gets
 * a session and the waiting-list screen, and only `web/scripts/enable-user.ts` —
 * run by whoever can already reach the database, which is the owner — turns it
 * true.
 *
 * **This is not a role and must not become one.** There is no `is_admin`, no
 * permissions column and no group, deliberately: #171 has not decided roles and
 * #510 says an unused column that looks like authorization is worse than none,
 * because the next person builds against it. What is here answers exactly one
 * question, "is this person one of ours", and that is the door rather than a
 * permission on the far side of it.
 *
 * The table is named `user`, which is a reserved word in Postgres. Drizzle
 * quotes every identifier it emits so nothing here has to think about it; the
 * one place it mattered was `server/testdb.ts`, whose hand-written reset now
 * asks Postgres to quote for it.
 */
export const user = pgTable('user', {
  /**
   * Opaque, ours, and never a provider's subject. A `randomUUID()` written at
   * first sign-in.
   */
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
 * ## Keyed on (issuer, subject), and deliberately not on email
 *
 * `subject` is what an OpenID Connect provider calls somebody, and it is only
 * unique within that provider, so the pair is the key. **Email is not an
 * identity** and #510 gives the three reasons in one line: it changes, it is
 * sometimes unverified, and two providers can assert the same address about
 * different people. It is carried here so a human reading the enable script's
 * list can recognise who is knocking, and nothing looks a person up by it.
 *
 * ## Do not auto-link
 *
 * A second provider asserting an address an existing user already has is **not**
 * proof of the same person, and treating it as such is an account takeover:
 * anybody who can get a provider to assert an address inherits the account it
 * matches. So a sign-in that finds no row here creates a **new** user, always.
 * Linking a second provider to an existing person is a deliberate act by
 * somebody already signed in, and it is not in #521.
 *
 * `ON DELETE CASCADE` from the user, because an identity with no person is a row
 * that can only be a way in to nothing.
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
 * A session, ours, addressed by an opaque cookie.
 *
 * **The credential is not ours and the session still is.** A provider says who
 * somebody is once, at the moment they sign in; everything afterwards is this
 * row, so signing somebody out, or throwing every session away, is a write here
 * rather than a conversation with Google.
 *
 * ## What is stored is the hash, not the cookie
 *
 * `token_hash` is the SHA-256 of the value in the cookie, hex. The cookie itself
 * is 32 random bytes and exists only in the browser that was handed it and in
 * the `Set-Cookie` that handed it over. So a copy of this table — a backup, a
 * dump, a screen somebody is sharing — is not a set of live credentials, and it
 * costs one hash per request to have it that way.
 *
 * ## Long-lived and renewed on use
 *
 * A phone held up at a bookshelf that asks for a sign-in every visit gets
 * abandoned, so `expires_at` is thirty days out and any use that finds the row
 * more than an hour stale pushes it forward. The hour is there so an ordinary
 * screen, which makes half a dozen requests, does not make half a dozen writes.
 *
 * ## Revocable, and `enabled` is deliberately not cached here
 *
 * `revoked_at` ends a session without deleting the evidence that it existed. And
 * the gate joins `user` on every request rather than copying `enabled` onto this
 * row: disabling somebody has to take effect on their **next request**, not
 * whenever their session happens to expire, which is why the enable script does
 * not need a way to hunt sessions down.
 */
export const session = pgTable('session', {
  /** The SHA-256 of the cookie value, hex. Never the cookie value. */
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  // text, not timestamp, for the reason written out on books.cover_checked_at.
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  /** Set by a sign-out, or by anybody who can reach the database. */
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
 * redirect back.
 *
 * The authorization code flow with PKCE has two halves that happen in two
 * separate requests, and three things have to survive between them: the `state`
 * that ties the callback to the start, the PKCE `code_verifier` whose challenge
 * went out with the authorization request, and the `nonce` the provider must
 * echo in the ID token.
 *
 * **A row rather than a cookie**, and the difference is single use. A cookie
 * carrying the verifier can be replayed as often as somebody has copies of it; a
 * row is deleted the moment a callback consumes it, so an authorization code
 * that arrives twice fails the second time with nothing left to check it
 * against. It also means a flow can simply be thrown away, which is what an
 * expiry does.
 *
 * The browser that started the flow is handed the same state in a short-lived
 * cookie, and the callback requires the two to agree. That is what stops a login
 * CSRF: an attacker who completes their own authorization and then feeds the
 * resulting callback URL to somebody else's browser has a state that browser was
 * never given.
 *
 * Nothing about a person is here. The row lives for at most ten minutes and
 * knows only which provider is being asked.
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
 * Every table this schema declares.
 *
 * No longer the same list as "every table the baseline creates": `tag` and
 * `book_tag` arrive in a later migration, because a database that predates them
 * has to be adoptable, and `migrate.ts` decides that by comparing the baseline's
 * own snapshot against the live catalogue. Adding these two to the baseline
 * would make the owner's catalogue refuse adoption by name. `author`,
 * `author_alias` and `book_author` arrive the same way, and `capture` later
 * still, for the same reason, and `outstanding_move` after that.
 */
export const ALL_TABLES = [
  books, bookAuthors, authorFiling, captures, tag, bookTag,
  author, authorAlias, bookAuthor, capture, outstandingMove,
  sortStrategy, collection, fixture, area, placementRule, ruleCondition,
  bookPlacement,
  // The four #521 adds, and the only tables here that are not about books.
  user, userIdentity, session, signInFlow,
] as const

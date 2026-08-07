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

import {
  customType, doublePrecision, foreignKey, index, integer, pgTable, primaryKey, text,
} from 'drizzle-orm/pg-core'

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

  shelfRange: text('shelf_range').notNull(),
  // integer, not boolean. BookRow.is_fiction is a number, the JSON contract
  // carries 0 and 1, and the client reads them.
  isFiction: integer('is_fiction').notNull(),
  classificationSource: text('classification_source').default('auto'),
  classificationConfidence: text('classification_confidence').default('unknown'),

  authorFiling: collatedText('author_filing').default(''),
  seriesName: text('series_name').default(''),
  seriesIndex: doublePrecision('series_index'),
  titleFiling: collatedText('title_filing').default(''),
  sortKey: collatedText('sort_key').notNull(),

  location: text('location').default(''),
  lookupSource: text('lookup_source').default(''),

  frontImage: text('front_image').default(''),
  backImage: text('back_image').default(''),
  edgeImage: text('edge_image').default(''),
  coverImage: text('cover_image').default(''),
  // text, not timestamp, and the same goes for every _at column here.
  // node-postgres hands a timestamptz back as a Date, which would change every
  // JSON payload the client and the end to end suite read.
  coverCheckedAt: text('cover_checked_at'),
  frontHash: text('front_hash').default(''),
  coverHash: text('cover_hash').default(''),
  frontCrop: text('front_crop').default(''),
  backCrop: text('back_crop').default(''),
  edgeCrop: text('edge_crop').default(''),
  cropped: text('cropped').default(''),
  isbnSource: text('isbn_source').default(''),
  // Vestigial; always ''. See the comment on this column in db.ts.
  ocrText: text('ocr_text').default(''),

  scannedAt: text('scanned_at').notNull(),
  shelvedAt: text('shelved_at'),
  checkedOutAt: text('checked_out_at'),
}, (table) => [
  index('idx_books_shelf').on(table.shelfRange, table.sortKey),
  index('idx_books_isbn13').on(table.isbn13),
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

export const shelfRanges = pgTable('shelf_ranges', {
  shelfRange: text('shelf_range').primaryKey(),
  startLabel: text('start_label').notNull(),
  startShelf: integer('start_shelf').notNull().default(1),
  startArea: integer('start_area').notNull().default(0),
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
 * Where each shelf begins.
 *
 * A boundary says WHERE a shelf starts and nothing about how much it holds. An
 * earlier version stored a capacity, which is not a fact about the furniture:
 * swap a paperback for a hardback and the same shelf holds one fewer.
 *
 * The one table #172 converts. It is not renamed here and nothing about it is
 * remodelled: #170 turns it into `area` with a parent, and doing half of that
 * now would leave the migration chain describing a shape nobody decided on.
 */
export const separators = pgTable('separators', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  shelfRange: text('shelf_range').notNull(),
  // 'shelf' ends a shelf; 'area' ends the whole bookcase and resets to shelf 1
  // of the next one.
  kind: text('kind').notNull().default('shelf'),
  // Compared against books.sort_key to find shelf boundaries, so it has to
  // order the same way sort_key does or a boundary lands between the wrong two
  // books. Hence the collation, and hence it is not plain `text`.
  startsAt: collatedText('starts_at').notNull(),
  // Ordinal within its range: the first separator closes the first shelf.
  position: integer('position').notNull(),
  note: text('note').default(''),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_separators').on(table.shelfRange, table.position),
])

/** Every table the baseline creates, for the checks that have to name them all. */
export const ALL_TABLES = [
  books, bookAuthors, authorFiling, shelfRanges, captures, separators,
] as const

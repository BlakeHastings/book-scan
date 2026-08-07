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
  uniqueIndex,
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
 * Every table this schema declares.
 *
 * No longer the same list as "every table the baseline creates": `tag` and
 * `book_tag` arrive in a later migration, because a database that predates them
 * has to be adoptable, and `migrate.ts` decides that by comparing the baseline's
 * own snapshot against the live catalogue. Adding these two to the baseline
 * would make the owner's catalogue refuse adoption by name. `author`,
 * `author_alias` and `book_author` arrive the same way, for the same reason.
 */
export const ALL_TABLES = [
  books, bookAuthors, authorFiling, shelfRanges, captures, separators, tag, bookTag,
  author, authorAlias, bookAuthor,
] as const

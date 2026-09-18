/**
 * Everything that touches the database. Keeps SQL out of the route handlers
 * and out of shared/shelving.ts, which stays pure.
 */

import type { BookRow, FiledBookRow } from './db.pg'
import type { Db } from './driver'
/*
 * Photographs are rows in `capture`, not columns on `books`. The flat
 * one-per-slot shape the wire speaks in is derived from those rows by
 * `withPhotographs`, and `server/photographs.ts` is the one place the two
 * vocabularies meet, in both directions.
 */
import {
  coverDownloaded, photographsTaken, recordCrop, recordHashes,
  withPhotographs, withPhotographsOf,
  type FiledPhotographedBook, type PhotographedBook, type PhotographFields,
} from './photographs'
import {
  buildPlacement,
  buildSortKey,
  filingName,
  titleFiling,
  type Neighbour,
  type Placement,
  type ShelfRange,
} from '../shared/shelving'
// What a name files under is a fact about the alias, and this is the port that
// answers it. See `filingFor`.
import type { AuthorRepository } from '../application/authorship/ports'
import { PrintedName } from '../domain/authorship/authors'
import { resolveIsbnPair } from '../shared/isbn'
import { locationLabel } from '../shared/layout'
// Where a range begins is a rule pointing at a fixture, not a row in
// `shelf_ranges`. See `bandsOf`.
import { bandOf } from '../infrastructure/shelving/areas'
import { CHECKED_OUT, DISCARDED, QUEUED_STATES, SHELVED } from '../domain/books/state'
// Which range a book joins is decided by its genre tags, and this is the rule
// that decides it. See docs/data-model.md.
import { genreStatedBy, type GenreSlug } from '../domain/tagging/genre'

const QUEUED_SQL = QUEUED_STATES.map((state) => `'${state}'`).join(', ')
// A book being filed into a range and a boundary moving inside it are the two
// halves of one contention, so both serialise on this name.
import { rangeLock } from './shelves'
/*
 * The placement ledger, which is where a book is: there is no `location`,
 * `shelved_at` or `checked_out_at` column left to give a second answer. Each
 * call is made on the transaction handle the rest of the save is on, so a book
 * and where it went commit together.
 */
import {
  recordCheckedOut, recordPlaced, recordPlacedIn, withPlacements, withPlacementsOf,
  type PlacementFields,
} from './placement-ledger'
/*
 * The repository takes the same `Db` this class was handed, so a read made
 * through it is on the same connection, the same transaction and the same
 * advisory lock as the write beside it. See `infrastructure/db/query.ts`.
 */
import {
  DrizzleBookRepository, PAGE_LIMIT, wordsOf,
  type FiledPlacedBook, type Listing,
} from '../infrastructure/books/book-repository'

export type { FiledPhotographedBook, PhotographedBook }
export type PlacedPhotographedBook = PhotographedBook & PlacementFields
export type { FiledPlacedBook }

export { PAGE_LIMIT, wordsOf, type Listing }

export interface DraftBook {
  isbn13?: string
  isbn10?: string
  title: string
  subtitle?: string
  authors: string[]
  publisher?: string
  published?: string
  pages?: string
  notes?: string
  /** Null when this save states no genre. The range arrives separately. */
  genre: GenreSlug | null
  classificationSource?: string
  classificationConfidence?: string
  seriesName?: string | null
  seriesIndex?: number | null
  location?: string
  lookupSource?: string
  frontImage?: string
  backImage?: string
  edgeImage?: string
  isbnSource?: string
  authorFilingOverride?: string | null
}

export type FilingDraft = Pick<
  DraftBook, 'title' | 'authors' | 'seriesName' | 'seriesIndex' | 'authorFilingOverride'
>

export interface ResolvedKey {
  authorFiling: string
  titleFilingValue: string
  sortKey: string
}

export interface FilingInput {
  id: number
  title: string
  authors: string
  title_filing: string
  sort_key: string
  series_name: string | null
  series_index: number | null
  printed_author: string
}

/**
 * Every statement in this file is dialect-neutral, spelled the same way in
 * SQLite and in Postgres, and the placeholder styles are translated by the
 * driver rather than rewritten here. Where a difference could not be spelled
 * away it is called out at the statement itself.
 */

export class Store {
  private readonly reads: DrizzleBookRepository

  /**
   * The authorship port is here for one question and writes nothing. Nothing in
   * this class changes a filing name: that is `FileAliasHandler`, called from
   * the save routes.
   */
  constructor(
    private readonly db: Db,
    private readonly authors: AuthorRepository,
  ) {
    this.reads = new DrizzleBookRepository(db)
  }

  /**
   * What this name files under: the alias's answer, or the heuristic's. The
   * fallback is the same answer arriving early, because `addBook` files a book
   * before its credits are written, so a name with no alias yet gets exactly
   * what `AuthorRepository.introduce` is about to store against it.
   */
  async filingFor(displayName: string): Promise<string> {
    const printed = PrintedName.parse(displayName)
    if (!printed) return filingName(displayName)
    return (await this.authors.aliasFor(printed))?.filing ?? printed.derivedFiling
  }

  async resolveKey(draft: FilingDraft): Promise<ResolvedKey> {
    const primary = draft.authors.find((n) => n.trim())?.trim() ?? ''
    const authorFiling =
      draft.authorFilingOverride?.trim() || (await this.filingFor(primary))

    return {
      authorFiling,
      titleFilingValue: titleFiling(draft.title),
      sortKey: buildSortKey({
        authorFiling,
        title: draft.title,
        seriesName: draft.seriesName,
        seriesIndex: draft.seriesIndex,
      }),
    }
  }

  /**
   * The printed name comes from `book_authors` rather than from `authors`, which
   * is a comma-joined display string where comma separates two authors and also
   * separates `Last, First`. `authors` is the fallback for a row saved before
   * that table existed, taking everything up to the first comma.
   */
  async filingInputs(): Promise<FilingInput[]> {
    return this.db.all<FilingInput>(
      `SELECT b.id, b.title, b.authors, b.title_filing,
              b.sort_key, b.series_name, b.series_index,
              COALESCE((SELECT name FROM book_authors
                         WHERE book_id = b.id ORDER BY position LIMIT 1), '') AS printed_author
         FROM catalogued_books b
        ORDER BY b.id`,
    )
  }

  /**
   * Writes the derived filing columns and nothing else. Deliberately not a
   * writer of where a book is: recomputing a key moves no book, so it records no
   * placement and the book stays on the needs-attention list until somebody
   * moves it and says so.
   */
  async refile(id: number, resolved: ResolvedKey): Promise<void> {
    await this.db.run(
      'UPDATE books SET title_filing = ?, sort_key = ? WHERE id = ?',
      [resolved.titleFilingValue, resolved.sortKey, id],
    )
  }

  /**
   * The label a range's first book is offered when nothing is shelved in it yet.
   * Null when no rule says where the range begins, which is `bandOf`'s answer
   * passed on: a range no rule serves has no start, and nothing here invents a
   * plank on the strength of which genre it is.
   */
  private async rangeStart(range: ShelfRange): Promise<string | null> {
    const band = await bandOf(this.db, range)
    return band ? locationLabel(band.start.shelf, band.start.area) : null
  }

  neighbours(
    range: ShelfRange,
    sortKey: string,
    excludeId?: number,
  ): Promise<{ predecessor: Neighbour | null; successor: Neighbour | null }> {
    return this.reads.neighbours(range, sortKey, excludeId)
  }

  /** Where does this book go? Saves nothing. */
  async placementFor(
    draft: FilingDraft,
    range: ShelfRange,
    excludeId?: number,
  ): Promise<Placement & ResolvedKey> {
    const resolved = await this.resolveKey(draft)
    const { predecessor, successor } = await this.neighbours(
      range,
      resolved.sortKey,
      excludeId,
    )
    const placement = buildPlacement(
      range,
      predecessor,
      successor,
      await this.rangeStart(range),
    )
    return { ...placement, ...resolved }
  }

  /**
   * File a book, and say where it goes. Reading the shelf and writing to it are
   * one unit: the filing key is resolved once inside the transaction, and both
   * the placement and the insert use that value. `serialiseOn` is the part a
   * transaction does not give; see `TxOptions`.
   */
  async addBook(draft: DraftBook): Promise<{ id: number; placement: Placement | null }> {
    const now = new Date().toISOString()
    const location = draft.location?.trim() ?? ''

    // Both columns are populated from whichever form we have, because duplicate
    // detection searches both: a book scanned from its barcode still matches one
    // entered by ISBN-10.
    const isbn = resolveIsbnPair(draft.isbn13 || draft.isbn10 || '')

    /*
     * The range this book's genre tags put it in, taken from the save rather
     * than from `book_tag`: a book this method is inserting carries no tags yet,
     * and knowing the range before anything is read is what lets the lock be
     * taken first. Null when the save states no genre, and a book in neither run
     * has no placement and serialises on nothing.
     */
    const { range } = genreStatedBy(draft)

    // Nests: `Db.tx` opens a savepoint when the caller is already inside one.
    const { id, placement } = await this.db.tx(async (tx) => {
      const resolved = await this.resolveKey(draft)
      let placed: (Placement & ResolvedKey) | null = null
      if (range !== null) {
        const { predecessor, successor } = await this.neighbours(range, resolved.sortKey)
        placed = {
          ...buildPlacement(
            range,
            predecessor,
            successor,
            await this.rangeStart(range),
          ),
          ...resolved,
        }
      }
      const id = await this.insertBook(tx, draft, resolved, range, isbn, now, location)
      return { id, placement: placed }
    }, range === null ? {} : { serialiseOn: rangeLock(range) })

    return { id, placement }
  }

  /**
   * Every statement here runs on the handle it is given, which is the open
   * transaction's.
   */
  private async insertBook(
    tx: Db,
    draft: DraftBook,
    resolved: ResolvedKey,
    /** Null when no genre tag files this book, which is written as `''`. */
    range: ShelfRange | null,
    isbn: { isbn13: string; isbn10: string },
    now: string,
    location: string,
  ): Promise<number> {
    // RETURNING id rather than lastInsertRowid: the id comes back from the
    // statement that produced it, which every dialect can do.
    const inserted = await tx.get<{ id: number }>(
      `INSERT INTO books (
         isbn13, isbn10, title, subtitle, authors, publisher, published,
         pages, notes, shelf_range, classification_source,
         classification_confidence, series_name,
         series_index, title_filing, sort_key, lookup_source,
         isbn_source, scanned_at, state
       ) VALUES (
         @isbn13, @isbn10, @title, @subtitle, @authors, @publisher,
         @published, @pages, @notes, @shelf_range,
         @classification_source, @classification_confidence,
         @series_name, @series_index, @title_filing,
         @sort_key, @lookup_source,
         @isbn_source, @scanned_at, @state
       )
       RETURNING id`,
      {
        isbn13: isbn.isbn13 || draft.isbn13 || '',
        isbn10: isbn.isbn10 || draft.isbn10 || '',
        title: draft.title,
        subtitle: draft.subtitle ?? '',
        authors: draft.authors.filter(Boolean).join(', '),
        publisher: draft.publisher ?? '',
        published: draft.published ?? '',
        pages: draft.pages ?? '',
        notes: draft.notes ?? '',
        // The empty range keeps the row out of every `shelf_range = ?` there is,
        // rather than putting it in one of them.
        shelf_range: range ?? '',
        classification_source: draft.classificationSource ?? 'auto',
        classification_confidence: draft.classificationConfidence ?? 'unknown',
        series_name: draft.seriesName ?? '',
        series_index: draft.seriesIndex ?? null,
        title_filing: resolved.titleFilingValue,
        sort_key: resolved.sortKey,
        lookup_source: draft.lookupSource ?? '',
        isbn_source: draft.isbnSource ?? '',
        scanned_at: now,
        /*
         * `shelved`, stated rather than left to the column's default. This route
         * is reached by somebody being told where a book goes, so writing
         * anything else here would take books off a shelf they are on.
         */
        state: SHELVED,
      },
    )

    // An INSERT ... RETURNING that inserted a row always has one to return, so
    // the absence of one is a broken statement rather than a case to handle.
    if (!inserted) throw new Error('the insert returned no id')

    const bookId = Number(inserted.id)

    /*
     * On the same handle as the insert, so a book and its photographs commit
     * together or neither does. Dated from the save because that is all this
     * path knows: a book that came through the queue already has its rows and
     * takes this branch not at all.
     */
    await photographsTaken(tx, bookId, {
      front: draft.frontImage,
      back: draft.backImage,
      edge: draft.edgeImage,
    }, now)

    const authors = draft.authors.map((name) => name.trim()).filter(Boolean)
    for (const [index, name] of authors.entries()) {
      await tx.run(
        'INSERT INTO book_authors (book_id, position, name) VALUES (?, ?, ?)',
        [bookId, index + 1, name],
      )
    }

    // A save with no location writes no row: nobody has said where the book is.
    await recordPlaced(tx, { id: bookId, sortKey: resolved.sortKey, location }, now)

    return bookId
  }

  async getBook(id: number): Promise<PlacedPhotographedBook | undefined> {
    return withPlacementsOf(this.db, await withPhotographsOf(
      this.db,
      await this.db.get<BookRow>('SELECT * FROM books WHERE id = ?', [id]),
    ))
  }

  /**
   * Update an existing book, recomputing everything derived from it. The key,
   * the write and the placement are one unit serialised on the range. This is
   * also how a book leaves the queue: a book exists from its first photograph,
   * so shelving one is an update, and the state moves in the statement below
   * beside the sort key.
   */
  async updateBook(
    id: number,
    draft: DraftBook,
    /**
     * The range the book's genre tags put it in, settled by the caller: the
     * answer is in `book_tag`, which is written through the tagging layer and
     * not through this class. Null when no genre tag claims the book, and then
     * the column takes the empty range and there is no placement to hand back.
     */
    range: ShelfRange | null,
  ): Promise<(Placement & ResolvedKey) | null> {
    const isbn = resolveIsbnPair(draft.isbn13 || draft.isbn10 || '')
    const location = draft.location?.trim() ?? ''

    return this.db.tx(async (tx) => {
      const resolved = await this.resolveKey(draft)
      await tx.run(
        `UPDATE books SET
           isbn13 = @isbn13, isbn10 = @isbn10, title = @title,
           subtitle = @subtitle, authors = @authors, publisher = @publisher,
           published = @published, pages = @pages, notes = @notes,
           shelf_range = @shelf_range,
           classification_source = @classification_source,
           classification_confidence = @classification_confidence,
           series_name = @series_name,
           series_index = @series_index, title_filing = @title_filing,
           sort_key = @sort_key,
           lookup_source = @lookup_source, isbn_source = @isbn_source,
           /*
            * Saving a book at the shelf is what takes it out of the queue.
            *
            * Identified and shelved are two steps, and this is the second
            * one: knowing what a book is and knowing where it went are separate
            * facts, and this statement is the moment somebody standing at a
            * shelf says the second. The state is written in the statement that
            * writes the sort key, so a book cannot be in the shelf order under
            * one and out of it under the other.
            *
            * The CASE rather than a bare assignment, because this method is
            * also how a book already on a shelf is edited, and a checked-out
            * book edited from the library must not be quietly put back. Every
            * state that is not queued keeps itself.
            */
           "state" = CASE WHEN "state" IN (${QUEUED_SQL}) THEN '${SHELVED}' ELSE "state" END
         WHERE id = @id`,
        {
          id,
          isbn13: isbn.isbn13 || draft.isbn13 || '',
          isbn10: isbn.isbn10 || draft.isbn10 || '',
          title: draft.title,
          subtitle: draft.subtitle ?? '',
          authors: draft.authors.filter(Boolean).join(', '),
          publisher: draft.publisher ?? '',
          published: draft.published ?? '',
          pages: draft.pages ?? '',
          notes: draft.notes ?? '',
          // See `insertBook`: the empty range is a book in no run, not a book
          // in the other one.
          shelf_range: range ?? '',
          classification_source: draft.classificationSource ?? 'manual',
          classification_confidence: draft.classificationConfidence ?? 'unknown',
          series_name: draft.seriesName ?? '',
          series_index: draft.seriesIndex ?? null,
          title_filing: resolved.titleFilingValue,
          sort_key: resolved.sortKey,
          lookup_source: draft.lookupSource ?? '',
          isbn_source: draft.isbnSource ?? '',
        },
      )

      /*
       * An edit that carries no photographs says nothing about them and writes
       * nothing. A file this book has no row for is a new photograph and gets
       * its own row rather than replacing what it was shot to improve on.
       */
      await photographsTaken(tx, id, {
        front: draft.frontImage,
        back: draft.backImage,
        edge: draft.edgeImage,
      }, new Date().toISOString())

      await tx.run('DELETE FROM book_authors WHERE book_id = ?', [id])
      const authors = draft.authors.map((name) => name.trim()).filter(Boolean)
      for (const [index, name] of authors.entries()) {
        await tx.run(
          'INSERT INTO book_authors (book_id, position, name) VALUES (?, ?, ?)',
          [id, index + 1, name],
        )
      }

      // An edit that carries no location moved no book, so it records no
      // placement and the book stays where the ledger already has it.
      await recordPlaced(
        tx, { id, sortKey: resolved.sortKey, location }, new Date().toISOString(),
      )

      // No run to be in, so no gap in one to point at. The book is saved either
      // way; what it is not is filed.
      if (range === null) return null

      // Exclude the book from its own neighbour search, or it would be told to
      // sit next to itself. Read inside the transaction, and after the update,
      // so it describes the shelf this edit produced.
      const { predecessor, successor } = await this.neighbours(range, resolved.sortKey, id)
      return {
        ...buildPlacement(
          range,
          predecessor,
          successor,
          await this.rangeStart(range),
        ),
        ...resolved,
      }
    }, range === null ? {} : { serialiseOn: rangeLock(range) })
  }

  async findByIsbn(value: string): Promise<FiledPlacedBook | undefined> {
    const { isbn13, isbn10 } = resolveIsbnPair(value)
    if (!isbn13 && !isbn10) return undefined

    return withPlacementsOf(this.db, await withPhotographsOf(this.db,
      await this.db.get<FiledBookRow>(
        `SELECT * FROM catalogued_books
          WHERE (isbn13 != '' AND isbn13 = :isbn13)
             OR (isbn10 != '' AND isbn10 = :isbn10)
          ORDER BY id LIMIT 1`,
        { isbn13, isbn10 },
      )))
  }

  /**
   * A person says where this book physically is now. Refuses a label naming a
   * plank the collection does not have, by throwing: see `UnknownPlank`. A row
   * that has since been deleted has no sort key and nothing to record.
   */
  async setLocation(id: number, location: string): Promise<void> {
    const at = new Date().toISOString()
    await this.db.tx(async (tx) => {
      const moved = await tx.get<{ sort_key: string }>(
        'SELECT sort_key FROM books WHERE id = ?',
        [id],
      )
      if (!moved) return
      await recordPlaced(tx, { id, sortKey: moved.sort_key, location }, at)
    })
  }

  /**
   * `setLocation` with the label already resolved, so a caller acting on a list
   * the server drew does not hand a rendering back to be parsed again. Refuses
   * an area the collection does not have, by throwing.
   */
  async setLocationIn(id: number, areaId: number): Promise<void> {
    const at = new Date().toISOString()
    await this.db.tx(async (tx) => {
      const moved = await tx.get<{ sort_key: string }>(
        'SELECT sort_key FROM books WHERE id = ?',
        [id],
      )
      if (!moved) return
      await recordPlacedIn(tx, { id, sortKey: moved.sort_key, location: '' }, areaId, at)
    })
  }

  async deleteBook(id: number): Promise<void> {
    await this.db.run('DELETE FROM books WHERE id = ?', [id])
  }

  /**
   * Whether any book still names this file as a photograph or a crop of one. A
   * discarded book does not count: its filenames record what was thrown away
   * rather than a claim on a file, and discarding a scan is meant to free the
   * photographs it was taken with. Crops count.
   */
  async imageInUse(name: string): Promise<boolean> {
    const usedByBook = await this.db.get(
      `SELECT 1 FROM capture c
         JOIN books b ON b.id = c.book_id
        WHERE b."state" != ?
          AND (c.file = ? OR c.crop_file = ?)
        LIMIT 1`,
      [DISCARDED, name, name],
    )
    return Boolean(usedByBook)
  }

  listRange(range: ShelfRange): Promise<FiledPlacedBook[]> {
    return this.reads.listRange(range)
  }

  listing(query: Listing): Promise<{ books: FiledPlacedBook[]; total: number }> {
    return this.reads.listing(query)
  }

  tagCounts(): Promise<{ slug: string; books: number }[]> {
    return this.reads.tagCounts()
  }

  /**
   * Take a book off the shelf, or put it back. The `WHERE` carries the decision
   * rather than a read before the write: two checkouts arriving together would
   * both pass a no-op guard, and the second would overwrite the moment the book
   * actually left, which nothing else records. A statement that changes no rows
   * either did not match the id or found the book already in the state asked
   * for, and `changed` tells the caller which.
   */
  async setCheckedOut(
    id: number,
    out: boolean,
  ): Promise<{ changed: boolean; checkedOutAt: string | null }> {
    const now = new Date().toISOString()
    /*
     * The transaction is what makes the ledger row commit with the state, not a
     * second chance to decide anything: a second checkout arriving at once
     * changes no rows here, so it writes no row there either.
     */
    const changed = await this.db.tx(async (tx) => {
      const moved = await tx.get<{ sort_key: string }>(
        `UPDATE books SET state = ?
          WHERE id = ? AND state ${out ? '<>' : '='} ?
          RETURNING sort_key`,
        [out ? CHECKED_OUT : SHELVED, id, CHECKED_OUT],
      )
      if (!moved) return false

      await recordCheckedOut(tx, { id, sortKey: moved.sort_key, location: '' }, out, now)
      return true
    })

    // Whether or not anything happened, the answer is the row's real value, so
    // a no-op cannot be mistaken for a fresh checkout.
    const [row] = await withPlacements(this.db, [{ id }])
    return { changed, checkedOutAt: row?.checked_out_at ?? null }
  }

  /**
   * Record the outcome of looking for a cover. The timestamp is set either way:
   * a book with no cover anywhere gets the stamp and no photograph row, and
   * without the stamp every backfill would spend its whole batch re-asking about
   * the same books and never reach the rest.
   */
  async setCoverImage(id: number, name: string): Promise<void> {
    const at = new Date().toISOString()
    const row = await this.db.get<{ id: number }>(
      'UPDATE books SET cover_checked_at = ? WHERE id = ? RETURNING id',
      [at, id],
    )
    if (row) await coverDownloaded(this.db, id, name, at)
  }

  async missingCovers(
    limit: number,
    retry = false,
  ): Promise<{ id: number; isbn13: string; isbn10: string }[]> {
    // CAST because `:retry` is compared against a bare literal with no column
    // anywhere near it, so a database that wants a parameter's type before it
    // will plan the statement has nothing to work it out from.
    return this.db.all<{ id: number; isbn13: string; isbn10: string }>(
      `SELECT id, isbn13, isbn10 FROM catalogued_books b
        WHERE NOT EXISTS (
                SELECT 1 FROM capture c
                 WHERE c.book_id = b.id AND c.kind = 'catalogue')
          AND (isbn13 != '' OR isbn10 != '')
          AND (CAST(:retry AS INTEGER) = 1 OR cover_checked_at IS NULL)
        ORDER BY id LIMIT :limit`,
      { limit, retry: retry ? 1 : 0 },
    )
  }

  /** A hash is a fact about one photograph and lands on its row. */
  async setHashes(id: number, front: string, cover: string): Promise<void> {
    await recordHashes(this.db, id, front, cover)
  }

  async hashIndex(): Promise<({
    id: number; title: string; author_filing: string
    checked_out: boolean
  } & PhotographFields)[]> {
    /*
     * A book nothing has hashed has nothing to compare and belongs out of the
     * index rather than in it scoring 64 against everything.
     */
    const rows = await this.db.all<{
      id: number; title: string; author_filing: string; checked_out: boolean
    }>(
      `SELECT id, title, author_filing, state = '${CHECKED_OUT}' AS checked_out
         FROM catalogued_books b
        WHERE EXISTS (
                SELECT 1 FROM capture c WHERE c.book_id = b.id AND c.hash != '')`,
    )
    // The hashes that matter are the ones on the current front photograph and
    // the current artwork; a hash on a spine is compared against nothing.
    return (await withPhotographs(this.db, rows))
      .filter((row) => row.front_hash !== '' || row.cover_hash !== '')
  }

  /**
   * Every row that carries an image or a hash, oldest first. Makes no judgement
   * about the hashes: one written by a superseded algorithm looks hashed to
   * `missingHashes` and usable to `hashIndex`, so the caller decides what is
   * stale.
   */
  async imageHashes(): Promise<({ id: number; title: string } & PhotographFields)[]> {
    return withPhotographs(this.db, await this.db.all<{ id: number; title: string }>(
      `SELECT id, title FROM catalogued_books b
        WHERE EXISTS (
                SELECT 1 FROM capture c
                 WHERE c.book_id = b.id AND c.kind IN ('front', 'catalogue'))
        ORDER BY id`,
    ))
  }

  async setCrop(id: number, slot: 'front' | 'back' | 'edge', name: string): Promise<void> {
    await recordCrop(this.db, id, slot, name)
  }

  /**
   * Every row that has a photograph, oldest first. Deliberately unfiltered:
   * whether a slot still needs cropping depends on `cropped`, on whether the
   * caller is forcing a redo and on whether the derived file is still on disk,
   * none of which SQL can see.
   */
  async photographed(): Promise<({ id: number; title: string } & PhotographFields)[]> {
    return withPhotographs(this.db, await this.db.all<{ id: number; title: string }>(
      `SELECT id, title FROM catalogued_books b
        WHERE EXISTS (
                SELECT 1 FROM capture c
                 WHERE c.book_id = b.id AND c.kind IN ('front', 'back', 'spine'))
        ORDER BY id`,
    ))
  }

  /**
   * Books whose current photographs have not been hashed yet. Must read
   * `current_photograph`: the hasher reaches for the newest front and artwork, so
   * asking about any photograph with no hash would keep answering with a spine
   * nobody hashes, and `hashInBackground` loops until this comes back empty.
   */
  async missingHashes(
    limit: number,
  ): Promise<{ id: number; front_image: string; cover_image: string }[]> {
    return this.db.all(
      `SELECT b.id,
              COALESCE(f.file, '') AS front_image,
              COALESCE(a.file, '') AS cover_image
         FROM catalogued_books b
         LEFT JOIN current_photograph f ON f.book_id = b.id AND f.kind = 'front'
         LEFT JOIN current_photograph a ON a.book_id = b.id AND a.kind = 'catalogue'
        WHERE (f.file IS NOT NULL AND f.hash = '')
           OR (a.file IS NOT NULL AND a.hash = '')
        ORDER BY b.id LIMIT ?`,
      [limit],
    ) as never
  }

  checkedOut(): Promise<FiledPlacedBook[]> {
    return this.reads.checkedOut()
  }

  counts(): Promise<{
    total: number; fiction: number; nonfiction: number; checkedOut: number
  }> {
    return this.reads.counts()
  }
}

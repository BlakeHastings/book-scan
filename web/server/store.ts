/**
 * Everything that touches the database. Keeps SQL out of the route handlers
 * and out of shared/shelving.ts, which stays pure.
 */

import type { Database } from 'better-sqlite3'
import type { BookRow } from './db'
import {
  buildPlacement,
  buildSortKey,
  filingName,
  normalise,
  titleFiling,
  type Neighbour,
  type Placement,
  type ShelfRange,
} from '../shared/shelving'
import { resolveIsbnPair } from '../shared/isbn'

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
  isFiction: boolean
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
  /** Overrides the derived filing name when the user edited it by hand. */
  authorFilingOverride?: string | null
}

export interface ResolvedKey {
  range: ShelfRange
  authorFiling: string
  titleFilingValue: string
  sortKey: string
}

/**
 * Every public method here returns a promise, and the bodies underneath are
 * still synchronous better-sqlite3 calls.
 *
 * That is deliberate and temporary. `pg` is asynchronous, so the shape of this
 * class has to change whether or not the driver has; doing the shape change
 * first, against a driver that cannot fail in any new way, means a caller that
 * forgets an `await` is a type error rather than something that only shows up
 * as a promise where a row was expected at runtime. The SQL is untouched.
 */
export class Store {
  constructor(private readonly db: Database) {}

  // -----------------------------------------------------------------------
  // Filing names and keys
  // -----------------------------------------------------------------------

  /** Look up a saved override before falling back to the heuristic. */
  async filingFor(displayName: string): Promise<string> {
    const key = normalise(displayName)
    if (!key) return ''

    const row = this.db
      .prepare('SELECT filing_name FROM author_filing WHERE display_key = ?')
      .get(key) as { filing_name: string } | undefined

    return row?.filing_name ?? filingName(displayName)
  }

  async saveFilingOverride(
    displayName: string,
    filing: string,
    isCorporate = false,
    note = '',
  ): Promise<void> {
    const key = normalise(displayName)
    if (!key) return
    this.db
      .prepare(
        `INSERT INTO author_filing (display_key, filing_name, is_corporate, note)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(display_key) DO UPDATE SET
           filing_name  = excluded.filing_name,
           is_corporate = excluded.is_corporate,
           note         = excluded.note`,
      )
      .run(key, filing, isCorporate ? 1 : 0, note)
  }

  async resolveKey(draft: DraftBook): Promise<ResolvedKey> {
    const primary = draft.authors.find((n) => n.trim())?.trim() ?? ''
    const authorFiling =
      draft.authorFilingOverride?.trim() || (await this.filingFor(primary))

    return {
      range: draft.isFiction ? 'fiction' : 'nonfiction',
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

  // -----------------------------------------------------------------------
  // Placement
  // -----------------------------------------------------------------------

  private async rangeStart(range: ShelfRange): Promise<string> {
    const row = this.db
      .prepare('SELECT start_label FROM shelf_ranges WHERE shelf_range = ?')
      .get(range) as { start_label: string } | undefined
    return row?.start_label ?? (range === 'nonfiction' ? 'S4' : '1A')
  }

  private toNeighbour(row: BookRow | undefined): Neighbour | null {
    if (!row) return null
    return {
      id: row.id,
      title: row.title,
      authorFiling: row.author_filing,
      location: row.location,
      sortKey: row.sort_key,
      images: {
        front: row.front_image ?? '',
        back: row.back_image ?? '',
        edge: row.edge_image ?? '',
      },
    }
  }

  /**
   * The core query pair. Both are covered by idx_books_shelf, so this stays
   * two index seeks no matter how large the collection gets.
   *
   * `excludeId` matters when previewing an edit to an already-saved book, so
   * it does not end up as its own neighbour.
   */
  async neighbours(
    range: ShelfRange,
    sortKey: string,
    excludeId?: number,
  ): Promise<{ predecessor: Neighbour | null; successor: Neighbour | null }> {
    const exclude = excludeId ?? -1

    // checked_out_at IS NULL is the whole point of the column here: a book in
    // a box on the floor is not something to put another book beside.
    const predecessor = this.db
      .prepare(
        `SELECT * FROM books
          WHERE shelf_range = ? AND sort_key < ? AND id != ?
            AND checked_out_at IS NULL
          ORDER BY sort_key DESC LIMIT 1`,
      )
      .get(range, sortKey, exclude) as BookRow | undefined

    const successor = this.db
      .prepare(
        `SELECT * FROM books
          WHERE shelf_range = ? AND sort_key > ? AND id != ?
            AND checked_out_at IS NULL
          ORDER BY sort_key ASC LIMIT 1`,
      )
      .get(range, sortKey, exclude) as BookRow | undefined

    return {
      predecessor: this.toNeighbour(predecessor),
      successor: this.toNeighbour(successor),
    }
  }

  /** Where does this book go? Does not save anything. */
  async placementFor(
    draft: DraftBook,
    excludeId?: number,
  ): Promise<Placement & ResolvedKey> {
    const resolved = await this.resolveKey(draft)
    const { predecessor, successor } = await this.neighbours(
      resolved.range,
      resolved.sortKey,
      excludeId,
    )
    const placement = buildPlacement(
      resolved.range,
      predecessor,
      successor,
      await this.rangeStart(resolved.range),
    )
    return { ...placement, ...resolved }
  }

  // -----------------------------------------------------------------------
  // Writes
  // -----------------------------------------------------------------------

  async addBook(draft: DraftBook): Promise<{ id: number; placement: Placement }> {
    const placement = await this.placementFor(draft)
    const resolved = await this.resolveKey(draft)
    const now = new Date().toISOString()
    const location = draft.location?.trim() ?? ''

    // Both forms are stored as separate data points, derived from whichever
    // one we actually have. Duplicate detection searches both columns, so a
    // book scanned from its barcode still matches one entered by ISBN-10.
    const isbn = resolveIsbnPair(draft.isbn13 || draft.isbn10 || '')

    // The closure stays synchronous, and so does better-sqlite3's transaction.
    // Nothing inside it awaits, so the whole insert still commits or rolls back
    // in one uninterrupted go. It becomes an async `tx` in a later stage.
    const insert = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO books (
             isbn13, isbn10, title, subtitle, authors, publisher, published,
             pages, notes, shelf_range, is_fiction, classification_source,
             classification_confidence, author_filing, series_name,
             series_index, title_filing, sort_key, location, lookup_source,
             front_image, back_image, edge_image, isbn_source,
             scanned_at, shelved_at
           ) VALUES (
             @isbn13, @isbn10, @title, @subtitle, @authors, @publisher,
             @published, @pages, @notes, @shelf_range, @is_fiction,
             @classification_source, @classification_confidence,
             @author_filing, @series_name, @series_index, @title_filing,
             @sort_key, @location, @lookup_source, @front_image, @back_image,
             @edge_image, @isbn_source, @scanned_at, @shelved_at
           )`,
        )
        .run({
          isbn13: isbn.isbn13 || draft.isbn13 || '',
          isbn10: isbn.isbn10 || draft.isbn10 || '',
          title: draft.title,
          subtitle: draft.subtitle ?? '',
          authors: draft.authors.filter(Boolean).join(', '),
          publisher: draft.publisher ?? '',
          published: draft.published ?? '',
          pages: draft.pages ?? '',
          notes: draft.notes ?? '',
          shelf_range: resolved.range,
          is_fiction: draft.isFiction ? 1 : 0,
          classification_source: draft.classificationSource ?? 'auto',
          classification_confidence: draft.classificationConfidence ?? 'unknown',
          author_filing: resolved.authorFiling,
          series_name: draft.seriesName ?? '',
          series_index: draft.seriesIndex ?? null,
          title_filing: resolved.titleFilingValue,
          sort_key: resolved.sortKey,
          location,
          lookup_source: draft.lookupSource ?? '',
          front_image: draft.frontImage ?? '',
          back_image: draft.backImage ?? '',
          edge_image: draft.edgeImage ?? '',
          isbn_source: draft.isbnSource ?? '',
          scanned_at: now,
          shelved_at: location ? now : null,
        })

      const bookId = Number(result.lastInsertRowid)
      const authorInsert = this.db.prepare(
        'INSERT INTO book_authors (book_id, position, name) VALUES (?, ?, ?)',
      )
      draft.authors
        .map((name) => name.trim())
        .filter(Boolean)
        .forEach((name, index) => authorInsert.run(bookId, index + 1, name))

      return bookId
    })

    return { id: insert(), placement }
  }

  /**
   * Find an existing copy by either ISBN form.
   *
   * Matching on the 13-digit form alone misses the case that matters: the
   * same book scanned once from its barcode (13) and once from a printed
   * ISBN-10, or an edition the catalogue reports under only one of the two.
   * Both columns are populated on save, so both are worth searching.
   */
  async getBook(id: number): Promise<BookRow | undefined> {
    return this.db.prepare('SELECT * FROM books WHERE id = ?').get(id) as
      BookRow | undefined
  }

  /**
   * Update an existing book, recomputing everything derived from it.
   *
   * Editing a title, author or the fiction flag moves the book on the shelf,
   * so the sort key and range have to be rebuilt or the row would keep its
   * old position and quietly break the ordering.
   */
  async updateBook(id: number, draft: DraftBook): Promise<Placement & ResolvedKey> {
    const resolved = await this.resolveKey(draft)
    const isbn = resolveIsbnPair(draft.isbn13 || draft.isbn10 || '')
    const location = draft.location?.trim() ?? ''

    const apply = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE books SET
             isbn13 = @isbn13, isbn10 = @isbn10, title = @title,
             subtitle = @subtitle, authors = @authors, publisher = @publisher,
             published = @published, pages = @pages, notes = @notes,
             shelf_range = @shelf_range, is_fiction = @is_fiction,
             classification_source = @classification_source,
             classification_confidence = @classification_confidence,
             author_filing = @author_filing, series_name = @series_name,
             series_index = @series_index, title_filing = @title_filing,
             sort_key = @sort_key,
             -- An edit that carries no location leaves the recorded one alone
             -- rather than blanking it. Where the book physically is was
             -- observed by a person and is not something a metadata edit knows
             -- anything about; clearing it is what PATCH .../location is for.
             location = COALESCE(NULLIF(@location, ''), location),
             lookup_source = @lookup_source, isbn_source = @isbn_source,
             shelved_at = COALESCE(shelved_at, @shelved_at)
           WHERE id = @id`,
        )
        .run({
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
          shelf_range: resolved.range,
          is_fiction: draft.isFiction ? 1 : 0,
          classification_source: draft.classificationSource ?? 'manual',
          classification_confidence: draft.classificationConfidence ?? 'unknown',
          author_filing: resolved.authorFiling,
          series_name: draft.seriesName ?? '',
          series_index: draft.seriesIndex ?? null,
          title_filing: resolved.titleFilingValue,
          sort_key: resolved.sortKey,
          location,
          lookup_source: draft.lookupSource ?? '',
          isbn_source: draft.isbnSource ?? '',
          shelved_at: location ? new Date().toISOString() : null,
        })

      this.db.prepare('DELETE FROM book_authors WHERE book_id = ?').run(id)
      const insertAuthor = this.db.prepare(
        'INSERT INTO book_authors (book_id, position, name) VALUES (?, ?, ?)',
      )
      draft.authors
        .map((name) => name.trim())
        .filter(Boolean)
        .forEach((name, index) => insertAuthor.run(id, index + 1, name))
    })

    apply()

    // Exclude the book from its own neighbour search, or it would be told to
    // sit next to itself.
    return this.placementFor(draft, id)
  }

  async findByIsbn(value: string): Promise<BookRow | undefined> {
    const { isbn13, isbn10 } = resolveIsbnPair(value)
    if (!isbn13 && !isbn10) return undefined

    return this.db
      .prepare(
        `SELECT * FROM books
          WHERE (isbn13 != '' AND isbn13 = :isbn13)
             OR (isbn10 != '' AND isbn10 = :isbn10)
          ORDER BY id LIMIT 1`,
      )
      .get({ isbn13, isbn10 }) as BookRow | undefined
  }

  async setLocation(id: number, location: string): Promise<void> {
    this.db
      .prepare('UPDATE books SET location = ?, shelved_at = ? WHERE id = ?')
      .run(location, location ? new Date().toISOString() : null, id)
  }

  async deleteBook(id: number): Promise<void> {
    this.db.prepare('DELETE FROM books WHERE id = ?').run(id)
  }

  /**
   * Whether any book or capture still names this file in one of its image
   * columns.
   *
   * A capture hands its filenames to the book it becomes, so a capture and a
   * shelved book routinely name the same file on disk. Callers deleting an
   * orphaned photo must check both tables, or removing a capture's copy of a
   * filename a book still uses would take the book's photo with it, and
   * there is no getting that back.
   *
   * Crops count on both sides. They are derived from a photograph's name, so
   * a capture and the book it became produce the same crop filename, and the
   * same argument applies to it as to the photograph it came from.
   */
  async imageInUse(name: string): Promise<boolean> {
    const usedByBook = this.db
      .prepare(
        `SELECT 1 FROM books
          WHERE front_image = ? OR back_image = ? OR edge_image = ? OR cover_image = ?
             OR front_crop = ?  OR back_crop = ?  OR edge_crop = ?
          LIMIT 1`,
      )
      .get(name, name, name, name, name, name, name)
    if (usedByBook) return true

    const usedByCapture = this.db
      .prepare(
        `SELECT 1 FROM captures
          WHERE front_image = ? OR back_image = ? OR edge_image = ?
             OR front_crop = ?  OR back_crop = ?  OR edge_crop = ?
          LIMIT 1`,
      )
      .get(name, name, name, name, name, name)
    return Boolean(usedByCapture)
  }

  // -----------------------------------------------------------------------
  // Reads
  // -----------------------------------------------------------------------

  async listRange(range: ShelfRange): Promise<BookRow[]> {
    return this.db
      .prepare(
        'SELECT * FROM books WHERE shelf_range = ? ORDER BY sort_key ASC',
      )
      .all(range) as BookRow[]
  }

  /**
   * There is no unshelved count any more, because there is no such state.
   *
   * A shelf is derived from the separators, so every catalogued book has a
   * position by construction; the layout places all of them or none. The old
   * count read the `location` column, which stopped being written when
   * locations became derived, so it reported almost the whole library as
   * unshelved while the library was busy showing exactly where each book sat.
   * A book that is genuinely not filed yet is still a capture in the queue,
   * and the queue counts those.
   */
  /**
   * Take a book off the shelf, or put it back.
   *
   * Off the shelf it keeps its catalogue entry and its photos and loses only
   * its position, which is what makes it useful for fixing a shelf by hand: a
   * book that will not physically fit can be removed from the model, and the
   * layout closes up behind it exactly as the shelf does.
   *
   * Asking for a state the book is already in is a no-op, not a write. A book
   * already off the shelf that gets checked out again must keep the moment it
   * actually left, not the moment someone tapped it a second time, and there
   * is no history table to recover that moment from once it is overwritten.
   * The caller still learns the truth either way: `changed` says whether
   * anything happened, and `checkedOutAt` is always the row's real value
   * afterward, so a no-op cannot be mistaken for a fresh checkout.
   */
  async setCheckedOut(
    id: number,
    out: boolean,
  ): Promise<{ changed: boolean; checkedOutAt: string | null }> {
    const row = this.db
      .prepare('SELECT checked_out_at FROM books WHERE id = ?')
      .get(id) as { checked_out_at: string | null } | undefined

    if (!row) return { changed: false, checkedOutAt: null }

    const alreadyOut = row.checked_out_at !== null
    if (alreadyOut === out) return { changed: false, checkedOutAt: row.checked_out_at }

    const checkedOutAt = out ? new Date().toISOString() : null
    this.db
      .prepare('UPDATE books SET checked_out_at = ? WHERE id = ?')
      .run(checkedOutAt, id)
    return { changed: true, checkedOutAt }
  }

  /**
   * Record the outcome of looking for a cover.
   *
   * The timestamp is set either way. Plenty of books have no cover anywhere,
   * and without a record of having asked, every backfill would spend its whole
   * batch re-asking about the same ones and never reach the rest.
   */
  async setCoverImage(id: number, name: string): Promise<void> {
    this.db
      .prepare('UPDATE books SET cover_image = ?, cover_checked_at = ? WHERE id = ?')
      .run(name, new Date().toISOString(), id)
  }

  /** Books with an ISBN whose cover has never been looked for. */
  async missingCovers(
    limit: number,
    retry = false,
  ): Promise<{ id: number; isbn13: string; isbn10: string }[]> {
    return this.db
      .prepare(
        `SELECT id, isbn13, isbn10 FROM books
          WHERE (cover_image IS NULL OR cover_image = '')
            AND (isbn13 != '' OR isbn10 != '')
            AND (:retry = 1 OR cover_checked_at IS NULL)
          ORDER BY id LIMIT :limit`,
      )
      .all({ limit, retry: retry ? 1 : 0 }) as
        { id: number; isbn13: string; isbn10: string }[]
  }

  async setHashes(id: number, front: string, cover: string): Promise<void> {
    this.db
      .prepare('UPDATE books SET front_hash = ?, cover_hash = ? WHERE id = ?')
      .run(front, cover, id)
  }

  /**
   * Everything a held-up book can be matched against.
   *
   * Small enough to scan in full: sixty-four bits per image and a few thousand
   * books is nothing, and an index that let us skip comparisons would have to
   * approximate the very thing being measured.
   */
  async hashIndex(): Promise<{
    id: number; title: string; author_filing: string
    cover_image: string; front_image: string
    edge_image: string; back_image: string
    checked_out_at: string | null
    front_hash: string; cover_hash: string
  }[]> {
    return this.db
      .prepare(
        `SELECT id, title, author_filing, cover_image, front_image, edge_image,
                back_image, checked_out_at, front_hash, cover_hash
           FROM books
          WHERE front_hash != '' OR cover_hash != ''`,
      )
      .all() as never
  }

  /**
   * Every row that carries an image or a hash, oldest first.
   *
   * Neither of the two queries either side of this one can answer the
   * question a rehash asks. missingHashes finds rows with no hash and
   * hashIndex finds rows with one, and a hash written by a superseded
   * algorithm looks hashed to the first and usable to the second while being
   * neither. This makes no judgement about the hashes at all and lets the
   * caller decide what is stale.
   */
  async imageHashes(): Promise<{
    id: number; title: string
    front_image: string; cover_image: string
    front_hash: string; cover_hash: string
  }[]> {
    return this.db
      .prepare(
        `SELECT id, title, front_image, cover_image, front_hash, cover_hash
           FROM books
          WHERE front_image != '' OR cover_image != ''
             OR front_hash != ''  OR cover_hash != ''
          ORDER BY id`,
      )
      .all() as never
  }

  /**
   * Record what the crop detector made of one photo.
   *
   * `name` is the derived file, or '' when the book could not be found in the
   * frame. Either way the slot joins `cropped`, because "looked at and found
   * nothing" and "never looked at" are different states and only the first one
   * is worth telling a reader about.
   *
   * The photo's own column is not touched here, and no statement in this class
   * ever writes a crop filename into one. The original is the record.
   */
  async setCrop(id: number, slot: 'front' | 'back' | 'edge', name: string): Promise<void> {
    const row = this.db.prepare('SELECT cropped FROM books WHERE id = ?').get(id) as
      { cropped: string | null } | undefined
    if (!row) return

    const done = new Set((row.cropped ?? '').split(',').filter(Boolean))
    done.add(slot)

    this.db
      .prepare(`UPDATE books SET ${slot}_crop = ?, cropped = ? WHERE id = ?`)
      .run(name, [...done].join(','), id)
  }

  /**
   * Every row that has a photograph, oldest first.
   *
   * Deliberately unfiltered. Whether a slot still needs cropping depends on
   * `cropped`, on whether the caller is forcing a redo, and on whether the
   * derived file is still on disk, and none of that belongs in SQL where a
   * later change to the rule would have to be made twice.
   */
  async photographed(): Promise<{
    id: number; title: string
    front_image: string; back_image: string; edge_image: string
    front_crop: string; back_crop: string; edge_crop: string
    cropped: string
  }[]> {
    return this.db
      .prepare(
        `SELECT id, title, front_image, back_image, edge_image,
                front_crop, back_crop, edge_crop, cropped
           FROM books
          WHERE front_image != '' OR back_image != '' OR edge_image != ''
          ORDER BY id`,
      )
      .all() as never
  }

  /** Books whose images have not been hashed yet. */
  async missingHashes(
    limit: number,
  ): Promise<{ id: number; front_image: string; cover_image: string }[]> {
    return this.db
      .prepare(
        `SELECT id, front_image, cover_image FROM books
          WHERE (front_image != '' AND front_hash = '')
             OR (cover_image != '' AND cover_hash = '')
          ORDER BY id LIMIT ?`,
      )
      .all(limit) as never
  }

  /** Books off the shelf, oldest first, so nothing is quietly forgotten. */
  async checkedOut(): Promise<BookRow[]> {
    return this.db
      .prepare(
        `SELECT * FROM books WHERE checked_out_at IS NOT NULL
          ORDER BY checked_out_at ASC`,
      )
      .all() as BookRow[]
  }

  async counts(): Promise<{
    total: number; fiction: number; nonfiction: number; checkedOut: number
  }> {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*)                                                   AS total,
           SUM(CASE WHEN shelf_range = 'fiction'    THEN 1 ELSE 0 END) AS fiction,
           SUM(CASE WHEN shelf_range = 'nonfiction' THEN 1 ELSE 0 END) AS nonfiction,
           SUM(CASE WHEN checked_out_at IS NOT NULL THEN 1 ELSE 0 END) AS checkedOut
         FROM books`,
      )
      .get() as {
        total: number; fiction: number | null
        nonfiction: number | null; checkedOut: number | null
      }

    return {
      total: row.total ?? 0,
      fiction: row.fiction ?? 0,
      nonfiction: row.nonfiction ?? 0,
      checkedOut: row.checkedOut ?? 0,
    }
  }
}

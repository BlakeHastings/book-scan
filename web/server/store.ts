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
  findMisfiles,
  normalise,
  titleFiling,
  type Misfile,
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
  ocrText?: string
  /** Overrides the derived filing name when the user edited it by hand. */
  authorFilingOverride?: string | null
}

export interface ResolvedKey {
  range: ShelfRange
  authorFiling: string
  titleFilingValue: string
  sortKey: string
}

export class Store {
  constructor(private readonly db: Database) {}

  // -----------------------------------------------------------------------
  // Filing names and keys
  // -----------------------------------------------------------------------

  /** Look up a saved override before falling back to the heuristic. */
  filingFor(displayName: string): string {
    const key = normalise(displayName)
    if (!key) return ''

    const row = this.db
      .prepare('SELECT filing_name FROM author_filing WHERE display_key = ?')
      .get(key) as { filing_name: string } | undefined

    return row?.filing_name ?? filingName(displayName)
  }

  saveFilingOverride(
    displayName: string,
    filing: string,
    isCorporate = false,
    note = '',
  ): void {
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

  resolveKey(draft: DraftBook): ResolvedKey {
    const primary = draft.authors.find((n) => n.trim())?.trim() ?? ''
    const authorFiling =
      draft.authorFilingOverride?.trim() || this.filingFor(primary)

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

  private rangeStart(range: ShelfRange): string {
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
  neighbours(
    range: ShelfRange,
    sortKey: string,
    excludeId?: number,
  ): { predecessor: Neighbour | null; successor: Neighbour | null } {
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
  placementFor(draft: DraftBook, excludeId?: number): Placement & ResolvedKey {
    const resolved = this.resolveKey(draft)
    const { predecessor, successor } = this.neighbours(
      resolved.range,
      resolved.sortKey,
      excludeId,
    )
    const placement = buildPlacement(
      resolved.range,
      predecessor,
      successor,
      this.rangeStart(resolved.range),
    )
    return { ...placement, ...resolved }
  }

  // -----------------------------------------------------------------------
  // Writes
  // -----------------------------------------------------------------------

  addBook(draft: DraftBook): { id: number; placement: Placement } {
    const placement = this.placementFor(draft)
    const resolved = this.resolveKey(draft)
    const now = new Date().toISOString()
    const location = draft.location?.trim() ?? ''

    // Both forms are stored as separate data points, derived from whichever
    // one we actually have. Duplicate detection searches both columns, so a
    // book scanned from its barcode still matches one entered by ISBN-10.
    const isbn = resolveIsbnPair(draft.isbn13 || draft.isbn10 || '')

    const insert = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO books (
             isbn13, isbn10, title, subtitle, authors, publisher, published,
             pages, notes, shelf_range, is_fiction, classification_source,
             classification_confidence, author_filing, series_name,
             series_index, title_filing, sort_key, location, lookup_source,
             front_image, back_image, edge_image, isbn_source, ocr_text,
             scanned_at, shelved_at
           ) VALUES (
             @isbn13, @isbn10, @title, @subtitle, @authors, @publisher,
             @published, @pages, @notes, @shelf_range, @is_fiction,
             @classification_source, @classification_confidence,
             @author_filing, @series_name, @series_index, @title_filing,
             @sort_key, @location, @lookup_source, @front_image, @back_image,
             @edge_image, @isbn_source, @ocr_text, @scanned_at, @shelved_at
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
          ocr_text: (draft.ocrText ?? '').slice(0, 4000),
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
  getBook(id: number): BookRow | undefined {
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
  updateBook(id: number, draft: DraftBook): Placement & ResolvedKey {
    const resolved = this.resolveKey(draft)
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
             sort_key = @sort_key, location = @location,
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

  findByIsbn(value: string): BookRow | undefined {
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

  setLocation(id: number, location: string): void {
    this.db
      .prepare('UPDATE books SET location = ?, shelved_at = ? WHERE id = ?')
      .run(location, location ? new Date().toISOString() : null, id)
  }

  deleteBook(id: number): void {
    this.db.prepare('DELETE FROM books WHERE id = ?').run(id)
  }

  // -----------------------------------------------------------------------
  // Reads
  // -----------------------------------------------------------------------

  listRange(range: ShelfRange): BookRow[] {
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
   */
  setCheckedOut(id: number, out: boolean): void {
    this.db
      .prepare('UPDATE books SET checked_out_at = ? WHERE id = ?')
      .run(out ? new Date().toISOString() : null, id)
  }

  /**
   * Record the outcome of looking for a cover.
   *
   * The timestamp is set either way. Plenty of books have no cover anywhere,
   * and without a record of having asked, every backfill would spend its whole
   * batch re-asking about the same ones and never reach the rest.
   */
  setCoverImage(id: number, name: string): void {
    this.db
      .prepare('UPDATE books SET cover_image = ?, cover_checked_at = ? WHERE id = ?')
      .run(name, new Date().toISOString(), id)
  }

  /** Books with an ISBN whose cover has never been looked for. */
  missingCovers(limit: number, retry = false): { id: number; isbn13: string; isbn10: string }[] {
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

  setHashes(id: number, front: string, cover: string): void {
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
  hashIndex(): {
    id: number; title: string; author_filing: string
    cover_image: string; front_image: string
    checked_out_at: string | null
    front_hash: string; cover_hash: string
  }[] {
    return this.db
      .prepare(
        `SELECT id, title, author_filing, cover_image, front_image, checked_out_at,
                front_hash, cover_hash
           FROM books
          WHERE front_hash != '' OR cover_hash != ''`,
      )
      .all() as never
  }

  /** Books whose images have not been hashed yet. */
  missingHashes(limit: number): { id: number; front_image: string; cover_image: string }[] {
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
  checkedOut(): BookRow[] {
    return this.db
      .prepare(
        `SELECT * FROM books WHERE checked_out_at IS NOT NULL
          ORDER BY checked_out_at ASC`,
      )
      .all() as BookRow[]
  }

  counts(): { total: number; fiction: number; nonfiction: number; checkedOut: number } {
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

  /** Books whose recorded location disagrees with their sort order. */
  misfiles(): Misfile[] {
    const ranges: ShelfRange[] = ['fiction', 'nonfiction']
    return ranges.flatMap((range) =>
      findMisfiles(
        this.listRange(range).map((row) => ({
          id: row.id,
          title: row.title,
          authorFiling: row.author_filing,
          location: row.location,
          sortKey: row.sort_key,
        })),
      ),
    )
  }
}

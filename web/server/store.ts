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

    const predecessor = this.db
      .prepare(
        `SELECT * FROM books
          WHERE shelf_range = ? AND sort_key < ? AND id != ?
          ORDER BY sort_key DESC LIMIT 1`,
      )
      .get(range, sortKey, exclude) as BookRow | undefined

    const successor = this.db
      .prepare(
        `SELECT * FROM books
          WHERE shelf_range = ? AND sort_key > ? AND id != ?
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
          isbn13: draft.isbn13 ?? '',
          isbn10: draft.isbn10 ?? '',
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

  findByIsbn13(isbn13: string): BookRow | undefined {
    if (!isbn13) return undefined
    return this.db
      .prepare('SELECT * FROM books WHERE isbn13 = ? ORDER BY id LIMIT 1')
      .get(isbn13) as BookRow | undefined
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

  counts(): { total: number; fiction: number; nonfiction: number; unshelved: number } {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*)                                                   AS total,
           SUM(CASE WHEN shelf_range = 'fiction'    THEN 1 ELSE 0 END) AS fiction,
           SUM(CASE WHEN shelf_range = 'nonfiction' THEN 1 ELSE 0 END) AS nonfiction,
           SUM(CASE WHEN location = '' OR location IS NULL THEN 1 ELSE 0 END)
                                                                       AS unshelved
         FROM books`,
      )
      .get() as { total: number; fiction: number | null; nonfiction: number | null; unshelved: number | null }

    return {
      total: row.total ?? 0,
      fiction: row.fiction ?? 0,
      nonfiction: row.nonfiction ?? 0,
      unshelved: row.unshelved ?? 0,
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

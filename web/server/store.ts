/**
 * Everything that touches the database. Keeps SQL out of the route handlers
 * and out of shared/shelving.ts, which stays pure.
 */

import type { BookRow } from './db.pg'
import type { Db } from './driver'
import { recordCrop, recordPhotographsOf } from './photographs'
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
import { CHECKED_OUT, DISCARDED, QUEUED_STATES, SHELVED } from '../domain/books/state'

/**
 * The three early states as a SQL literal list, for the one statement here that
 * needs them: `updateBook`, which is where a book leaves the queue for a shelf.
 * Built from the domain rather than typed out, for the reason the view is.
 */
const QUEUED_SQL = QUEUED_STATES.map((state) => `'${state}'`).join(', ')
// The lock namespace, not the class. `Shelves` owns shelf geography, and a
// book being filed into a range and a boundary moving inside it are the two
// halves of the same contention.
import { rangeLock } from './shelves'
/*
 * The placement ledger, written beside the three columns below and never
 * instead of them (#185).
 *
 * **The four statements in this file that change where a book is are the four
 * that call these**, and that is the whole reason the calls are here rather than
 * in the routes. It is the same write-through #200 moved `capture` onto, after
 * five callers turned out to write the image columns without recording anything:
 * a caller cannot forget what it never had to remember. Each call is made on the
 * transaction handle that is writing the column, so the row and the column
 * commit together.
 */
import { recordCheckedOut, recordPlaced } from './placement-ledger'

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

/** One catalogued book, and everything its sort key is derived from. */
export interface FilingInput {
  id: number
  title: string
  authors: string
  author_filing: string
  title_filing: string
  sort_key: string
  series_name: string | null
  series_index: number | null
  is_fiction: number
  printed_author: string
}

/**
 * Every public method here returns a promise, and the bodies underneath are
 * still synchronous better-sqlite3 calls.
 *
 * That is deliberate and temporary. `pg` is asynchronous, so the shape of this
 * class has to change whether or not the driver has; doing the shape change
 * first, against a driver that cannot fail in any new way, means a caller that
 * forgets an `await` is a type error rather than something that only shows up
 * as a promise where a row was expected at runtime.
 *
 * The SQL underneath has since been made dialect-neutral: every statement in
 * this file is spelled the same way in SQLite and in Postgres, so the only
 * thing left to change when the driver does is the driver. Where a difference
 * could not be spelled away it is called out at the statement itself.
 *
 * And the driver itself is now behind `Db` (driver.ts), so nothing in this file
 * knows which database it is talking to or that the one underneath is
 * synchronous. The statements are unchanged: the placeholder styles they are
 * written in are translated by the driver rather than rewritten here.
 */
export class Store {
  constructor(private readonly db: Db) {}

  // -----------------------------------------------------------------------
  // Filing names and keys
  // -----------------------------------------------------------------------

  /**
   * Look up a saved override before falling back to the heuristic.
   *
   * **The heuristic runs whether or not there is a key to look an override up
   * by.** It used to return '' when the key was empty, which read as a guard
   * against querying for nothing and was in fact a guard against filing the
   * book at all: `normalise()` folded a name written in a non-Latin script away
   * entirely, so the one case that reached the early return was the one case
   * that most needed an answer (#195). `normalise()` no longer folds those away,
   * so an empty key now means a name with no letter or digit in it, and even
   * that gets the heuristic rather than nothing: `filingName` answers what was
   * printed, and what the client shows is what gets stored.
   */
  async filingFor(displayName: string): Promise<string> {
    const key = normalise(displayName)
    const override = key
      ? await this.db.get<{ filing_name: string }>(
          'SELECT filing_name FROM author_filing WHERE display_key = ?',
          [key],
        )
      : undefined

    return override?.filing_name ?? filingName(displayName)
  }

  async saveFilingOverride(
    displayName: string,
    filing: string,
    isCorporate = false,
    note = '',
  ): Promise<void> {
    const key = normalise(displayName)
    if (!key) return
    await this.db.run(
      `INSERT INTO author_filing (display_key, filing_name, is_corporate, note)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(display_key) DO UPDATE SET
         filing_name  = excluded.filing_name,
         is_corporate = excluded.is_corporate,
         note         = excluded.note`,
      [key, filing, isCorporate ? 1 : 0, note],
    )
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

  /**
   * Every catalogued book with what its filing name is derived from.
   *
   * For `server/refile-books.ts`, which recomputes the three derived columns
   * and reports the rows where the answer has changed. A row is only ever as
   * right as the code that was running the day it was last saved, and #195 is
   * the case in point: a book saved before it filed under nobody and stays that
   * way, because nothing recomputes a sort key on its own.
   *
   * The printed name comes from `book_authors` rather than from `authors`, which
   * is a comma-joined display string where comma is both the separator between
   * two authors and the separator inside `Last, First`. `authors` is the
   * fallback for a row saved before that table existed, taking everything up to
   * the first comma, which is what the client does with the same string.
   */
  async filingInputs(): Promise<FilingInput[]> {
    return this.db.all<FilingInput>(
      `SELECT b.id, b.title, b.authors, b.author_filing, b.title_filing,
              b.sort_key, b.series_name, b.series_index, b.is_fiction,
              COALESCE((SELECT name FROM book_authors
                         WHERE book_id = b.id ORDER BY position LIMIT 1), '') AS printed_author
         FROM catalogued_books b
        ORDER BY b.id`,
    )
  }

  /**
   * Write the three derived columns, and nothing else.
   *
   * Deliberately not `updateBook`: that one is a person saying what a book is,
   * and it rewrites the credits, moves a queued book onto a shelf and stamps
   * `shelved_at`. Recomputing a key states nothing new about the book.
   *
   * **Not a fifth writer of where a book is** (#185), which is the thing
   * `placement-ledger.ts` says would have to be added to this class beside the
   * four. Nothing here writes `location`, `shelved_at`, `checked_out_at` or
   * `current_area_id`, and no placement row belongs to it: nobody carried the
   * book anywhere, and saying they had is the lie `docs/shelving.md` refuses.
   * What changes is where the rules say it belongs, so the book comes out on the
   * needs-attention list until somebody moves it and says so.
   */
  async refile(id: number, resolved: ResolvedKey): Promise<void> {
    await this.db.run(
      `UPDATE books SET author_filing = ?, title_filing = ?, sort_key = ?
        WHERE id = ?`,
      [resolved.authorFiling, resolved.titleFilingValue, resolved.sortKey, id],
    )
  }

  // -----------------------------------------------------------------------
  // Placement
  // -----------------------------------------------------------------------

  private async rangeStart(range: ShelfRange): Promise<string> {
    const row = await this.db.get<{ start_label: string }>(
      'SELECT start_label FROM shelf_ranges WHERE shelf_range = ?',
      [range],
    )
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
   * The core query pair. Both are covered by idx_books_shelved, so this stays
   * two index seeks no matter how large the collection gets.
   *
   * `excludeId` matters when previewing an edit to an already-saved book, so
   * it does not end up as its own neighbour.
   *
   * **`shelved_books`, not `books`, and that is not a rename.** These two
   * statements are what decides which physical books somebody is told to put a
   * book between, so a row that is not on a shelf reaching them is somebody
   * standing at a bookcase looking for a book that is not there. The condition
   * used to be `checked_out_at IS NULL`, written out here and in three other
   * statements, and #183 gave books six more states that must not reach a shelf.
   * Saying which states in every query is the arrangement that lasts until the
   * next query is written, so the view says it once and this cannot forget. See
   * `shelvedBooks` in infrastructure/db/schema.ts.
   */
  async neighbours(
    range: ShelfRange,
    sortKey: string,
    excludeId?: number,
  ): Promise<{ predecessor: Neighbour | null; successor: Neighbour | null }> {
    const exclude = excludeId ?? -1

    const predecessor = await this.db.get<BookRow>(
      `SELECT * FROM shelved_books
        WHERE shelf_range = ? AND sort_key < ? AND id != ?
        ORDER BY sort_key DESC LIMIT 1`,
      [range, sortKey, exclude],
    )

    const successor = await this.db.get<BookRow>(
      `SELECT * FROM shelved_books
        WHERE shelf_range = ? AND sort_key > ? AND id != ?
        ORDER BY sort_key ASC LIMIT 1`,
      [range, sortKey, exclude],
    )

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

  /**
   * File a book, and say where it goes.
   *
   * **Reading the shelf and writing to it are one unit, which they had stopped
   * being.** Until stage G this method read the neighbours, resolved the filing
   * key twice, and only then opened a transaction around the insert. Three
   * things came of that, and two of them are silent:
   *
   * - Two people scanning at once both read the same gap and were each told to
   *   put their book between the same two neighbours. The rows land in the
   *   right order either way, because the sort keys decide that; the advice on
   *   the screen is what was wrong, and it is the advice somebody acts on while
   *   standing at the shelf.
   * - `placementFor` and the second `resolveKey` each read `author_filing`
   *   independently. A filing override saved in between (the route above this
   *   one saves one, at index.ts) made them disagree, so the row was stored
   *   under one sort key while the person was shown the position computed from
   *   the other. That one is now impossible rather than unlikely: the key is
   *   resolved once and both the placement and the insert use that value.
   * - The range's start label was a third independent read.
   *
   * `serialiseOn` is the part a transaction does not give. See `TxOptions`.
   */
  async addBook(draft: DraftBook): Promise<{ id: number; placement: Placement }> {
    const now = new Date().toISOString()
    const location = draft.location?.trim() ?? ''

    // Both forms are stored as separate data points, derived from whichever
    // one we actually have. Duplicate detection searches both columns, so a
    // book scanned from its barcode still matches one entered by ISBN-10.
    const isbn = resolveIsbnPair(draft.isbn13 || draft.isbn10 || '')

    // Known before anything is read, because it is a property of the draft and
    // not of the database, which is what lets the lock be taken first.
    const range: ShelfRange = draft.isFiction ? 'fiction' : 'nonfiction'

    // The row and its authors are still one transaction, and it still nests:
    // `Db.tx` opens a savepoint when the caller is already inside one, which is
    // what better-sqlite3's own nested transactions did.
    const { id, placement } = await this.db.tx(async (tx) => {
      const resolved = await this.resolveKey(draft)
      const { predecessor, successor } = await this.neighbours(
        resolved.range,
        resolved.sortKey,
      )
      const placed = {
        ...buildPlacement(
          resolved.range,
          predecessor,
          successor,
          await this.rangeStart(resolved.range),
        ),
        ...resolved,
      }
      const id = await this.insertBook(tx, draft, resolved, isbn, now, location)
      return { id, placement: placed }
    }, { serialiseOn: rangeLock(range) })

    return { id, placement }
  }

  /**
   * The insert itself, split out only so `addBook` reads as the sequence it is.
   * Every statement here runs on the handle it is given, which is the open
   * transaction's.
   */
  private async insertBook(
    tx: Db,
    draft: DraftBook,
    resolved: ResolvedKey,
    isbn: { isbn13: string; isbn10: string },
    now: string,
    location: string,
  ): Promise<number> {
    // RETURNING id rather than lastInsertRowid: the id comes back from the
    // statement that produced it, which every dialect can do, instead of from
    // a driver-specific property of the result object.
    const inserted = await tx.get<{ id: number }>(
      `INSERT INTO books (
         isbn13, isbn10, title, subtitle, authors, publisher, published,
         pages, notes, shelf_range, is_fiction, classification_source,
         classification_confidence, author_filing, series_name,
         series_index, title_filing, sort_key, location, lookup_source,
         front_image, back_image, edge_image, isbn_source,
         scanned_at, shelved_at, state
       ) VALUES (
         @isbn13, @isbn10, @title, @subtitle, @authors, @publisher,
         @published, @pages, @notes, @shelf_range, @is_fiction,
         @classification_source, @classification_confidence,
         @author_filing, @series_name, @series_index, @title_filing,
         @sort_key, @location, @lookup_source, @front_image, @back_image,
         @edge_image, @isbn_source, @scanned_at, @shelved_at, @state
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
        /*
         * `shelved`, stated rather than left to the column's default.
         *
         * This route is reached by somebody confirming what a book is and being
         * told where it goes, and every row this statement has ever written has
         * been in the shelf order from the moment it landed. Writing anything
         * else here would take books off a shelf they are on.
         *
         * The two-step docs/data-model.md describes, `identified` and then
         * `shelved`, needs somewhere to put a book that is confirmed and not yet
         * placed, and today that somewhere is the queue table. It arrives with
         * the work that dissolves it; inventing half of it here would mean a
         * state nothing can leave.
         */
        state: SHELVED,
      },
    )

    // An INSERT ... RETURNING that inserted a row always has one to return,
    // so the absence of one is a broken statement rather than a case to
    // handle: reporting it as a book with no id would be worse.
    if (!inserted) throw new Error('the insert returned no id')

    const bookId = Number(inserted.id)
    const authors = draft.authors.map((name) => name.trim()).filter(Boolean)
    for (const [index, name] of authors.entries()) {
      await tx.run(
        'INSERT INTO book_authors (book_id, position, name) VALUES (?, ?, ?)',
        [bookId, index + 1, name],
      )
    }

    // The first placement, on the same handle as the insert. A save with no
    // location writes no row, which is right: nobody has said where it is.
    await recordPlaced(tx, { id: bookId, sortKey: resolved.sortKey, location }, now)

    return bookId
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
    return this.db.get<BookRow>('SELECT * FROM books WHERE id = ?', [id])
  }

  /**
   * Update an existing book, recomputing everything derived from it.
   *
   * Editing a title, author or the fiction flag moves the book on the shelf,
   * so the sort key and range have to be rebuilt or the row would keep its
   * old position and quietly break the ordering.
   *
   * Same shape as `addBook` since stage G, and for the same reasons. The filing
   * key was resolved outside the transaction and the placement was read after
   * it committed, so the position the caller was handed back described a shelf
   * that anything landing in between had already changed. All three are one
   * unit now, serialised on the range.
   *
   * **This is also how a book leaves the queue (#183).** A book exists from its
   * first photograph, so shelving one is an update rather than an insert: the
   * row is already there, in an early state, with its photographs on it. The
   * state moves in the statement below, beside the sort key.
   */
  async updateBook(id: number, draft: DraftBook): Promise<Placement & ResolvedKey> {
    const isbn = resolveIsbnPair(draft.isbn13 || draft.isbn10 || '')
    const location = draft.location?.trim() ?? ''
    const range: ShelfRange = draft.isFiction ? 'fiction' : 'nonfiction'

    return this.db.tx(async (tx) => {
      const resolved = await this.resolveKey(draft)
      await tx.run(
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
           --
           -- The CAST is the one thing here that is not about locations. A
           -- parameter inside a bare NULLIF has nothing to take a type from:
           -- SQLite infers one from the value it was handed, and a database
           -- that types its parameters at parse time instead has no column and
           -- no literal to look at, so it refuses the statement outright. The
           -- cast says what the value is. It is identity on SQLite, which is
           -- where this stage can prove it changes nothing.
           location = COALESCE(NULLIF(CAST(@location AS TEXT), ''), location),
           lookup_source = @lookup_source, isbn_source = @isbn_source,
           shelved_at = COALESCE(shelved_at, @shelved_at),
           -- The photographs, on the same terms as the location above and for
           -- the same reason: an edit that carries none leaves the row's alone.
           -- A book saved out of the queue already has its three on the row and
           -- the client does not re-upload them; a book saved with new ones
           -- means them.
           front_image = COALESCE(NULLIF(CAST(@front_image AS TEXT), ''), front_image),
           back_image  = COALESCE(NULLIF(CAST(@back_image  AS TEXT), ''), back_image),
           edge_image  = COALESCE(NULLIF(CAST(@edge_image  AS TEXT), ''), edge_image),
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
          front_image: draft.frontImage ?? '',
          back_image: draft.backImage ?? '',
          edge_image: draft.edgeImage ?? '',
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
        },
      )

      await tx.run('DELETE FROM book_authors WHERE book_id = ?', [id])
      const authors = draft.authors.map((name) => name.trim()).filter(Boolean)
      for (const [index, name] of authors.entries()) {
        await tx.run(
          'INSERT INTO book_authors (book_id, position, name) VALUES (?, ?, ?)',
          [id, index + 1, name],
        )
      }

      // On the same terms as the `location` assignment above: an edit that
      // carries no location moved no book, so it records no placement. An edit
      // that carries one is somebody saying where the book is now, which is the
      // same statement a book leaving the queue is saved by.
      await recordPlaced(
        tx, { id, sortKey: resolved.sortKey, location }, new Date().toISOString(),
      )

      // Exclude the book from its own neighbour search, or it would be told to
      // sit next to itself. Read inside the transaction, and after the update,
      // so it describes the shelf this edit produced.
      const { predecessor, successor } = await this.neighbours(
        resolved.range,
        resolved.sortKey,
        id,
      )
      return {
        ...buildPlacement(
          resolved.range,
          predecessor,
          successor,
          await this.rangeStart(resolved.range),
        ),
        ...resolved,
      }
    }, { serialiseOn: rangeLock(range) })
  }

  async findByIsbn(value: string): Promise<BookRow | undefined> {
    const { isbn13, isbn10 } = resolveIsbnPair(value)
    if (!isbn13 && !isbn10) return undefined

    return this.db.get<BookRow>(
      `SELECT * FROM catalogued_books
        WHERE (isbn13 != '' AND isbn13 = :isbn13)
           OR (isbn10 != '' AND isbn10 = :isbn10)
        ORDER BY id LIMIT 1`,
      { isbn13, isbn10 },
    )
  }

  /**
   * A person says where this book physically is now.
   *
   * A transaction since #185, and only for that: the column and the ledger row
   * are one fact and have to land together. The `RETURNING` is what saves a
   * second read for the sort key, which the row needs so it can be read back as
   * a position once an edit has re-keyed the book.
   */
  async setLocation(id: number, location: string): Promise<void> {
    const at = new Date().toISOString()
    await this.db.tx(async (tx) => {
      const moved = await tx.get<{ sort_key: string }>(
        `UPDATE books SET location = ?, shelved_at = ? WHERE id = ?
         RETURNING sort_key`,
        [location, location ? at : null, id],
      )
      if (!moved) return
      await recordPlaced(tx, { id, sortKey: moved.sort_key, location }, at)
    })
  }

  async deleteBook(id: number): Promise<void> {
    await this.db.run('DELETE FROM books WHERE id = ?', [id])
  }

  /**
   * Whether any book still names this file in one of its image columns.
   *
   * **One table now, where this used to read two.** A capture handed its
   * filenames to the book it became, so a capture and a shelved book named the
   * same file on disk and deleting the capture's copy would have taken the
   * book's photograph with it. There is nothing to get wrong there any more:
   * the capture and the book are one row, and one row cannot half-name a file.
   *
   * **A discarded book does not count, and that is the one judgement here.** Its
   * filenames are the record of what was thrown away rather than a claim on a
   * file, and treating them as a claim would mean discarding a scan stopped
   * freeing the photographs it was taken with, which is most of what discarding
   * one is for.
   *
   * Crops count. They are derived from a photograph's name, so the same argument
   * applies to a crop as to the photograph it came from.
   */
  async imageInUse(name: string): Promise<boolean> {
    const usedByBook = await this.db.get(
      `SELECT 1 FROM books
        WHERE "state" != ?
          AND (front_image = ? OR back_image = ? OR edge_image = ? OR cover_image = ?
            OR front_crop = ?  OR back_crop = ?  OR edge_crop = ?)
        LIMIT 1`,
      [DISCARDED, name, name, name, name, name, name, name],
    )
    return Boolean(usedByBook)
  }

  // -----------------------------------------------------------------------
  // Reads
  // -----------------------------------------------------------------------

  /**
   * Every book in a range, in order. `catalogued_books`, which is neither
   * `books` nor `shelved_books`.
   *
   * This is the catalogue rather than a shelf. It has always included the books
   * somebody has taken out, and a view that dropped them would take them off a
   * listing that is the only place some of them appear. Nothing here tells
   * anybody where to put a book, which is what makes it a different question
   * from the two statements in `neighbours`.
   *
   * **#204 left the other half of that question open here, and this is the
   * answer.** What should `GET /api/books` say about a book that has been
   * scanned and not identified? Nothing, and now that such a row exists the
   * reason can be stated rather than guessed at: it has no title, no author and
   * no shelf range, so there is nothing to list and nothing to file it under,
   * and it is already on screen in the queue, which is the place built to show
   * it and the only place anybody can act on it. Listing it here would put a
   * nameless row in the middle of somebody's library and would offer no way to
   * do anything about it.
   *
   * **The rows are unchanged on the day this lands**, because `shelved` and
   * `checked_out` were the only two states anything could write until now, and
   * `catalogued_books` holds those two and `withdrawn`. So this listing, the
   * counts beside it and every duplicate check answer exactly what they answered
   * yesterday, which is checkable rather than asserted.
   *
   * The predicate is the view's and is not repeated here, for the reason
   * `shelved_books` exists: eight statements in this file mean "the catalogue",
   * and eight places to remember which states that is are eight places to
   * forget one.
   */
  async listRange(range: ShelfRange): Promise<BookRow[]> {
    return this.db.all<BookRow>(
      'SELECT * FROM catalogued_books WHERE shelf_range = ? ORDER BY sort_key ASC',
      [range],
    )
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
   *
   * **One conditional statement, not a read and then a write.** This used to
   * SELECT the column, decide from it, and then UPDATE unconditionally, which
   * had a window in it that destroyed the very thing the paragraph above says
   * the method exists to protect: two checkouts arriving together both read
   * NULL, both passed the no-op guard, and the second overwrote the first
   * person's timestamp with a later one. The moment the book actually left is
   * not recoverable from anywhere else.
   *
   * The `WHERE` carries the decision instead, and `RETURNING` reports what the
   * row ended up with. A statement that changes no rows either did not match
   * the id or found the book already in the state asked for, and the follow-up
   * read tells those two apart without being able to change the answer.
   *
   * `CaptureQueue.claim` has had exactly this shape all along, and it is the
   * pattern to copy rather than a transaction: a compare-and-set inside one
   * statement is atomic on both drivers under any isolation level.
   *
   * **The state moves in this statement and in no other.** `checked_out_at` and
   * `state` describe the same fact from #183 onwards, one of them to the client
   * and the other to every shelf query, and a second statement to keep them in
   * step is a window in which a book is off the shelf according to one and on it
   * according to the other. There is nothing to interleave with here.
   *
   * Returning is `shelved`, not the area the book came off. A checked-out book
   * remembers no area on purpose: it is placed again by the rules, from its sort
   * key, exactly as it was before this column existed.
   */
  async setCheckedOut(
    id: number,
    out: boolean,
  ): Promise<{ changed: boolean; checkedOutAt: string | null }> {
    const now = new Date().toISOString()
    const checkedOutAt = out ? now : null
    /*
     * The compare-and-set is still one statement, and the transaction around it
     * is not a second chance to decide anything: it is what makes the ledger row
     * commit with the column. A second checkout arriving at once changes no rows
     * here, so it writes no row there either.
     */
    const changed = await this.db.tx(async (tx) => {
      const moved = await tx.get<{ checked_out_at: string | null; sort_key: string; location: string }>(
        `UPDATE books SET checked_out_at = ?, state = ?
          WHERE id = ?
            AND checked_out_at IS ${out ? '' : 'NOT '}NULL
          RETURNING checked_out_at, sort_key, location`,
        [checkedOutAt, out ? CHECKED_OUT : SHELVED, id],
      )
      if (!moved) return undefined

      await recordCheckedOut(
        tx, { id, sortKey: moved.sort_key, location: moved.location ?? '' }, out, now,
      )
      return moved
    })
    if (changed) return { changed: true, checkedOutAt: changed.checked_out_at }

    // Nothing changed. Either there is no such book, or it was already in the
    // state asked for and keeps the moment it actually reached it.
    const row = await this.db.get<{ checked_out_at: string | null }>(
      'SELECT checked_out_at FROM books WHERE id = ?',
      [id],
    )
    return { changed: false, checkedOutAt: row?.checked_out_at ?? null }
  }

  /**
   * Record the outcome of looking for a cover.
   *
   * The timestamp is set either way. Plenty of books have no cover anywhere,
   * and without a record of having asked, every backfill would spend its whole
   * batch re-asking about the same ones and never reach the rest.
   *
   * The artwork becomes a photograph here rather than at the three callers that
   * download one. See `recordPhotographsOf` for why that is where it lives.
   */
  async setCoverImage(id: number, name: string): Promise<void> {
    const row = await this.db.get<BookRow>(
      'UPDATE books SET cover_image = ?, cover_checked_at = ? WHERE id = ? RETURNING *',
      [name, new Date().toISOString(), id],
    )
    if (row) await recordPhotographsOf(this.db, row)
  }

  /** Books with an ISBN whose cover has never been looked for. */
  async missingCovers(
    limit: number,
    retry = false,
  ): Promise<{ id: number; isbn13: string; isbn10: string }[]> {
    // CAST for the same reason as the one in updateBook: `:retry` is compared
    // against a bare literal with no column anywhere near it, so a database
    // that wants a parameter's type before it will plan the statement has
    // nothing to work it out from. Identity on SQLite, which is the only
    // database this stage can demonstrate it on.
    return this.db.all<{ id: number; isbn13: string; isbn10: string }>(
      `SELECT id, isbn13, isbn10 FROM catalogued_books
        WHERE (cover_image IS NULL OR cover_image = '')
          AND (isbn13 != '' OR isbn10 != '')
          AND (CAST(:retry AS INTEGER) = 1 OR cover_checked_at IS NULL)
        ORDER BY id LIMIT :limit`,
      { limit, retry: retry ? 1 : 0 },
    )
  }

  /**
   * Store the hashes of a book's front photograph and its catalogue artwork.
   *
   * A hash is a fact about one photograph, so it lands on that photograph's row
   * as well as in the column, from the hash backfill and from `rehash-covers`
   * as much as from a save. See `recordPhotographsOf`.
   */
  async setHashes(id: number, front: string, cover: string): Promise<void> {
    const row = await this.db.get<BookRow>(
      'UPDATE books SET front_hash = ?, cover_hash = ? WHERE id = ? RETURNING *',
      [front, cover, id],
    )
    if (row) await recordPhotographsOf(this.db, row)
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
    return this.db.all(
      `SELECT id, title, author_filing, cover_image, front_image, edge_image,
              back_image, checked_out_at, front_hash, cover_hash
         FROM catalogued_books
        WHERE front_hash != '' OR cover_hash != ''`,
    ) as never
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
    return this.db.all(
      `SELECT id, title, front_image, cover_image, front_hash, cover_hash
         FROM catalogued_books
        WHERE front_image != '' OR cover_image != ''
           OR front_hash != ''  OR cover_hash != ''
        ORDER BY id`,
    ) as never
  }

  /**
   * Record what the crop detector made of one photo.
   *
   * The statement, and the photograph's row beside it, are in
   * `photographs.ts`. This method and `CaptureQueue.setCrop` are two passes
   * over one table, and were two copies of one statement until #200 left one.
   */
  async setCrop(id: number, slot: 'front' | 'back' | 'edge', name: string): Promise<void> {
    await recordCrop(this.db, id, slot, name)
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
    return this.db.all(
      `SELECT id, title, front_image, back_image, edge_image,
              front_crop, back_crop, edge_crop, cropped
         FROM catalogued_books
        WHERE front_image != '' OR back_image != '' OR edge_image != ''
        ORDER BY id`,
    ) as never
  }

  /** Books whose images have not been hashed yet. */
  async missingHashes(
    limit: number,
  ): Promise<{ id: number; front_image: string; cover_image: string }[]> {
    return this.db.all(
      `SELECT id, front_image, cover_image FROM catalogued_books
        WHERE (front_image != '' AND front_hash = '')
           OR (cover_image != '' AND cover_hash = '')
        ORDER BY id LIMIT ?`,
      [limit],
    ) as never
  }

  /**
   * Books off the shelf, oldest first, so nothing is quietly forgotten.
   *
   * The complement of `shelved_books` is not one relation and there is no view
   * for it: `checked_out` is one of six states that are not `shelved`, and the
   * other five are not books somebody has taken out. So this names the state it
   * means rather than reading "everything the shelf does not show".
   */
  async checkedOut(): Promise<BookRow[]> {
    return this.db.all<BookRow>(
      `SELECT * FROM books WHERE state = ?
        ORDER BY checked_out_at ASC`,
      [CHECKED_OUT],
    )
  }

  /**
   * Two dialect-neutrality details here, both of which are silent when wrong.
   *
   * The CASTs: COUNT and SUM are wider than an int in every real database, and
   * a driver that refuses to narrow them hands back a string rather than lose
   * precision. `/api/health` and every save response carry these numbers, so a
   * total of "57" would render identically and fail every piece of arithmetic
   * downstream. Casting says what the caller actually wants.
   *
   * The quoted "checkedOut": an unquoted alias is folded to a single case by
   * some dialects and preserved verbatim by others, so the one camelCase name
   * in this file has to say it means that. Quoting is understood everywhere.
   */
  async counts(): Promise<{
    total: number; fiction: number; nonfiction: number; checkedOut: number
  }> {
    const row = await this.db.get<{
      total: number; fiction: number | null
      nonfiction: number | null; checkedOut: number | null
    }>(
      `SELECT
         CAST(COUNT(*) AS INTEGER)                                   AS total,
         CAST(SUM(CASE WHEN shelf_range = 'fiction'    THEN 1 ELSE 0 END)
              AS INTEGER)                                            AS fiction,
         CAST(SUM(CASE WHEN shelf_range = 'nonfiction' THEN 1 ELSE 0 END)
              AS INTEGER)                                            AS nonfiction,
         CAST(SUM(CASE WHEN checked_out_at IS NOT NULL THEN 1 ELSE 0 END)
              AS INTEGER)                                            AS "checkedOut"
       FROM catalogued_books`,
    )

    return {
      total: row?.total ?? 0,
      fiction: row?.fiction ?? 0,
      nonfiction: row?.nonfiction ?? 0,
      checkedOut: row?.checkedOut ?? 0,
    }
  }
}

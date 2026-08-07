/**
 * Everything that touches the database. Keeps SQL out of the route handlers
 * and out of shared/shelving.ts, which stays pure.
 */

import type { BookRow } from './db.pg'
import type { Db } from './driver'
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
// The lock namespace, not the class. `Shelves` owns shelf geography, and a
// book being filed into a range and a boundary moving inside it are the two
// halves of the same contention.
import { rangeLock } from './shelves'

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

  /** Look up a saved override before falling back to the heuristic. */
  async filingFor(displayName: string): Promise<string> {
    const key = normalise(displayName)
    if (!key) return ''

    const row = await this.db.get<{ filing_name: string }>(
      'SELECT filing_name FROM author_filing WHERE display_key = ?',
      [key],
    )

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
    const predecessor = await this.db.get<BookRow>(
      `SELECT * FROM books
        WHERE shelf_range = ? AND sort_key < ? AND id != ?
          AND checked_out_at IS NULL
        ORDER BY sort_key DESC LIMIT 1`,
      [range, sortKey, exclude],
    )

    const successor = await this.db.get<BookRow>(
      `SELECT * FROM books
        WHERE shelf_range = ? AND sort_key > ? AND id != ?
          AND checked_out_at IS NULL
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
         scanned_at, shelved_at
       ) VALUES (
         @isbn13, @isbn10, @title, @subtitle, @authors, @publisher,
         @published, @pages, @notes, @shelf_range, @is_fiction,
         @classification_source, @classification_confidence,
         @author_filing, @series_name, @series_index, @title_filing,
         @sort_key, @location, @lookup_source, @front_image, @back_image,
         @edge_image, @isbn_source, @scanned_at, @shelved_at
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
           shelved_at = COALESCE(shelved_at, @shelved_at)
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
      `SELECT * FROM books
        WHERE (isbn13 != '' AND isbn13 = :isbn13)
           OR (isbn10 != '' AND isbn10 = :isbn10)
        ORDER BY id LIMIT 1`,
      { isbn13, isbn10 },
    )
  }

  async setLocation(id: number, location: string): Promise<void> {
    await this.db.run(
      'UPDATE books SET location = ?, shelved_at = ? WHERE id = ?',
      [location, location ? new Date().toISOString() : null, id],
    )
  }

  async deleteBook(id: number): Promise<void> {
    await this.db.run('DELETE FROM books WHERE id = ?', [id])
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
    const usedByBook = await this.db.get(
      `SELECT 1 FROM books
        WHERE front_image = ? OR back_image = ? OR edge_image = ? OR cover_image = ?
           OR front_crop = ?  OR back_crop = ?  OR edge_crop = ?
        LIMIT 1`,
      [name, name, name, name, name, name, name],
    )
    if (usedByBook) return true

    const usedByCapture = await this.db.get(
      `SELECT 1 FROM captures
        WHERE front_image = ? OR back_image = ? OR edge_image = ?
           OR front_crop = ?  OR back_crop = ?  OR edge_crop = ?
        LIMIT 1`,
      [name, name, name, name, name, name],
    )
    return Boolean(usedByCapture)
  }

  // -----------------------------------------------------------------------
  // Reads
  // -----------------------------------------------------------------------

  async listRange(range: ShelfRange): Promise<BookRow[]> {
    return this.db.all<BookRow>(
      'SELECT * FROM books WHERE shelf_range = ? ORDER BY sort_key ASC',
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
   */
  async setCheckedOut(
    id: number,
    out: boolean,
  ): Promise<{ changed: boolean; checkedOutAt: string | null }> {
    const checkedOutAt = out ? new Date().toISOString() : null
    const changed = await this.db.get<{ checked_out_at: string | null }>(
      `UPDATE books SET checked_out_at = ?
        WHERE id = ?
          AND checked_out_at IS ${out ? '' : 'NOT '}NULL
        RETURNING checked_out_at`,
      [checkedOutAt, id],
    )
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
   */
  async setCoverImage(id: number, name: string): Promise<void> {
    await this.db.run(
      'UPDATE books SET cover_image = ?, cover_checked_at = ? WHERE id = ?',
      [name, new Date().toISOString(), id],
    )
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
      `SELECT id, isbn13, isbn10 FROM books
        WHERE (cover_image IS NULL OR cover_image = '')
          AND (isbn13 != '' OR isbn10 != '')
          AND (CAST(:retry AS INTEGER) = 1 OR cover_checked_at IS NULL)
        ORDER BY id LIMIT :limit`,
      { limit, retry: retry ? 1 : 0 },
    )
  }

  async setHashes(id: number, front: string, cover: string): Promise<void> {
    await this.db.run(
      'UPDATE books SET front_hash = ?, cover_hash = ? WHERE id = ?',
      [front, cover, id],
    )
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
         FROM books
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
         FROM books
        WHERE front_image != '' OR cover_image != ''
           OR front_hash != ''  OR cover_hash != ''
        ORDER BY id`,
    ) as never
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
   *
   * **`cropped` is added to in SQL rather than read out, edited and written
   * back**, which is the fix for a lost update that stage G found. Two crop
   * passes on the same book overlap routinely: one is fired after a save and
   * the other is the backfill loop. Both read `cropped = ''`, one wrote
   * `'front'` and the other then wrote `'edge'` over it, so the front slot's
   * crop column stayed populated while nothing said the front had been looked
   * at. Every later reader concluded it never had, and re-cropped it forever;
   * worse, the "looked at and declined" state, which is the whole reason this
   * column exists, was erased.
   *
   * The whole thing is one statement, so there is nothing to interleave with.
   */
  async setCrop(id: number, slot: 'front' | 'back' | 'edge', name: string): Promise<void> {
    // The slot is a union of three literals, not user input, so the two places
    // it is interpolated cannot carry anything but a column name and a value
    // this file wrote. Everything else is a parameter.
    await this.db.run(
      `UPDATE books SET
         ${slot}_crop = ?,
         cropped = CASE
           WHEN ',' || COALESCE(cropped, '') || ',' LIKE ? THEN cropped
           WHEN COALESCE(cropped, '') = ''                 THEN ?
           ELSE cropped || ',' || ?
         END
       WHERE id = ?`,
      [name, `%,${slot},%`, slot, slot, id],
    )
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
         FROM books
        WHERE front_image != '' OR back_image != '' OR edge_image != ''
        ORDER BY id`,
    ) as never
  }

  /** Books whose images have not been hashed yet. */
  async missingHashes(
    limit: number,
  ): Promise<{ id: number; front_image: string; cover_image: string }[]> {
    return this.db.all(
      `SELECT id, front_image, cover_image FROM books
        WHERE (front_image != '' AND front_hash = '')
           OR (cover_image != '' AND cover_hash = '')
        ORDER BY id LIMIT ?`,
      [limit],
    ) as never
  }

  /** Books off the shelf, oldest first, so nothing is quietly forgotten. */
  async checkedOut(): Promise<BookRow[]> {
    return this.db.all<BookRow>(
      `SELECT * FROM books WHERE checked_out_at IS NOT NULL
        ORDER BY checked_out_at ASC`,
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
       FROM books`,
    )

    return {
      total: row?.total ?? 0,
      fiction: row?.fiction ?? 0,
      nonfiction: row?.nonfiction ?? 0,
      checkedOut: row?.checkedOut ?? 0,
    }
  }
}

/**
 * Everything that touches the database. Keeps SQL out of the route handlers
 * and out of shared/shelving.ts, which stays pure.
 *
 * **Shrinking, one aggregate at a time.** #424 took the six read-only methods —
 * `listing`, `listRange`, `neighbours`, `checkedOut`, `counts` and `tagCounts` —
 * to `infrastructure/books/book-repository.ts`, where the SQL is generated from
 * the schema rather than written out. They are still methods here, delegating,
 * so nothing above this class had to move with them; what changed is which layer
 * the statements live in. The write paths follow in later slices of #169, and
 * until they do this file is both a facade and a store.
 */

import type { BookRow, FiledBookRow } from './db.pg'
import type { Db } from './driver'
/*
 * Photographs are rows in `capture` and are not columns on `books` (#228).
 *
 * Nothing in this file names a photograph column, because there are none. What
 * a caller still gets is the flat one-per-slot shape the wire and the two crop
 * backfills speak in, derived from the rows by `withPhotographs`, and what a
 * caller writes goes through the four functions there. `server/photographs.ts`
 * is the one place the two vocabularies meet, in both directions.
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
// What a name files under is a fact about the alias now, and this is the port
// that answers it. See `filingFor`, and #227.
import type { AuthorRepository } from '../application/authorship/ports'
import { PrintedName } from '../domain/authorship/authors'
import { resolveIsbnPair } from '../shared/isbn'
import { locationLabel } from '../shared/layout'
// Where a range begins is a rule pointing at a fixture now, not a row in
// `shelf_ranges`. See `bandsOf`, and #232.
import { bandOf } from '../infrastructure/shelving/areas'
import { CHECKED_OUT, DISCARDED, QUEUED_STATES, SHELVED } from '../domain/books/state'
// Which range a book joins is decided by its genre tags now, and this is the
// rule that decides it. See docs/data-model.md and #223.
import { genreStatedBy, type GenreSlug } from '../domain/tagging/genre'

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
 * The placement ledger, which is where a book is (#232).
 *
 * It was written beside `books.location`, `shelved_at` and `checked_out_at` from
 * #185 and instead of them from here: the three columns are dropped, so there is
 * no second answer and nothing left to keep in step.
 *
 * **The four statements in this file that change where a book is are the four
 * that call these**, and that is the whole reason the calls are here rather than
 * in the routes. It is the same write-through #200 moved `capture` onto, after
 * five callers turned out to write the image columns without recording anything:
 * a caller cannot forget what it never had to remember. Each call is made on the
 * transaction handle the rest of the save is on, so a book and where it went
 * commit together.
 */
import {
  recordCheckedOut, recordPlaced, recordPlacedIn, withPlacements, withPlacementsOf,
  type PlacementFields,
} from './placement-ledger'
/*
 * The book's reads, which are a repository now (#424).
 *
 * The six methods below that delegate to this are the whole of what moved. It
 * takes the same `Db` this class was handed, so a read made through it is on the
 * same connection, the same transaction and the same advisory lock as the write
 * beside it; see `infrastructure/db/query.ts`.
 */
import {
  DrizzleBookRepository, PAGE_LIMIT, wordsOf,
  type FiledPlacedBook, type Listing,
} from '../infrastructure/books/book-repository'

/**
 * A book as everything above this class reads one. Declared beside the
 * derivations, in `server/photographs.ts` and `server/placement-ledger.ts`, and
 * named here because this is where callers meet them.
 *
 * Two shapes rather than one, for the reason #228 named two: a lookup by id
 * needs no filing name and everything that draws a shelf needs one.
 */
export type { FiledPhotographedBook, PhotographedBook }
export type PlacedPhotographedBook = PhotographedBook & PlacementFields
export type { FiledPlacedBook }

/*
 * `PAGE_LIMIT`, `Listing`, `wordsOf` and the accent fold moved to
 * `infrastructure/books/book-repository.ts` with the six reads that used them
 * (#424), and are re-exported here so that a caller of this class does not have
 * to know which slice of it has moved yet. `index.ts` and
 * `listing.routes.test.ts` import `PAGE_LIMIT` from here.
 */
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
  /**
   * The genre this save states, as the tag it means (#227), or null when
   * nothing states one (#304).
   *
   * A slug rather than a boolean, because the tag is what decides the shelf
   * range and a boolean had room for exactly one question. Nothing in this class
   * reads it: `settleGenre` in `server/index.ts` writes it and hands back the
   * range, which arrives separately.
   */
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
  /** Overrides the derived filing name when the user edited it by hand. */
  authorFilingOverride?: string | null
}

/**
 * What a sort key is derived from, and nothing else.
 *
 * The genre is not in here, and that is the point of the type existing (#223).
 * `resolveKey` used to answer the shelf range as well, computed from
 * `draft.isFiction`, which made every caller that wanted a filing name also a
 * caller that decided which bookcase a book went to. The range is now decided by
 * the genre tag, so it arrives at `addBook` and `updateBook` as its own argument
 * and `server/refile.ts` does not have to state a genre to recompute a key.
 */
export type FilingDraft = Pick<
  DraftBook, 'title' | 'authors' | 'seriesName' | 'seriesIndex' | 'authorFilingOverride'
>

export interface ResolvedKey {
  authorFiling: string
  titleFilingValue: string
  sortKey: string
}

/** One catalogued book, and everything its sort key is derived from. */
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
/*
 * `tagCounts` as a free function moved with the class's method of the same name
 * (#424). `server/furniture.ts` imports it from its new home directly, because a
 * re-export through here would be a second name for one query.
 */

export class Store {
  /**
   * The reads, built from the same `Db` rather than taken as an argument.
   *
   * Not a constructor parameter, and that is deliberate for as long as this
   * class is a facade over its own move (#424): forty callers build a `Store`
   * and none of them has an opinion about which half of it answers a listing.
   * When the write paths follow, the routes take the repository directly and
   * this field goes with the six delegations below.
   */
  private readonly reads: DrizzleBookRepository

  /**
   * The authorship port is here for one question and writes nothing.
   *
   * A sort key's first component is what the first-listed name files under, and
   * since #227 that fact lives on `author_alias` rather than in the
   * `author_filing` override table this class used to keep. So the class that
   * writes `books` asks the slice that owns names, through the port rather than
   * with SQL of its own, and **nothing here changes a filing name**: that is
   * `FileAliasHandler`, called from the save routes, and two writers of one
   * column is the defect #200 and #213 each spent a change closing.
   */
  constructor(
    private readonly db: Db,
    private readonly authors: AuthorRepository,
  ) {
    this.reads = new DrizzleBookRepository(db)
  }

  // -----------------------------------------------------------------------
  // Filing names and keys
  // -----------------------------------------------------------------------

  /**
   * What this name files under: the alias's answer, or the heuristic's.
   *
   * **The alias is the answer, and the heuristic is what a name nobody has met
   * yet gets** (#227). `author_alias.filing_name` is `author_filing.filing_name`
   * grown up: it holds the correction somebody made once, for the two cases no
   * heuristic gets right, and it holds the derived answer for everybody else.
   * The fallback is not a second opinion, it is the same one arriving a moment
   * early: `addBook` files a book before its credits are written, so a name this
   * collection has never seen has no alias to ask, and the value here is exactly
   * what `AuthorRepository.introduce` is about to store against it.
   *
   * **There is still one derivation.** `PrintedName.derivedFiling` is
   * `filingName` in `shared/shelving.ts`, which is the rule #195 left as the one
   * place a filing name comes from, and the client renders the same function as
   * somebody types.
   *
   * A string with no letter or digit in it is not a name and gets no alias, so
   * it falls through to `filingName`, which answers what was printed. That is
   * the case #195 turned into an empty answer and it is deliberately not one
   * now: the empty string sorts ahead of every real filing name.
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
      `SELECT b.id, b.title, b.authors, b.title_filing,
              b.sort_key, b.series_name, b.series_index,
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
      'UPDATE books SET title_filing = ?, sort_key = ? WHERE id = ?',
      [resolved.titleFilingValue, resolved.sortKey, id],
    )
  }

  // -----------------------------------------------------------------------
  // Placement
  // -----------------------------------------------------------------------

  /**
   * The label a range's first book is offered when nothing is shelved in it yet.
   *
   * `shelf_ranges.start_label` until #232, and the first plank of the run the
   * range's rule points at from here. The two agree: `0013` derived the fixture
   * from `start_shelf` and the label was `start_shelf` and `start_area` written
   * out, so this is the same string built by the one function that builds one.
   */
  private async rangeStart(range: ShelfRange): Promise<string> {
    const band = await bandOf(this.db, range)
    const start = band?.start ?? { shelf: range === 'nonfiction' ? 4 : 1, area: 0 }
    return locationLabel(start.shelf, start.area)
  }

  /**
   * The two index seeks either side of a sort key: who this book goes between.
   *
   * The statement and the reasoning are in
   * `infrastructure/books/book-repository.ts` since #424. Kept as a method here
   * because every caller that places a book holds a `Store`.
   */
  neighbours(
    range: ShelfRange,
    sortKey: string,
    excludeId?: number,
  ): Promise<{ predecessor: Neighbour | null; successor: Neighbour | null }> {
    return this.reads.neighbours(range, sortKey, excludeId)
  }

  /**
   * Where does this book go? Does not save anything.
   *
   * The range arrives rather than being worked out from the draft, because
   * which range a book joins is decided by its genre tags and this method is a
   * preview that writes none. See `genreStatedBy` and the preview route.
   */
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
  async addBook(draft: DraftBook): Promise<{ id: number; placement: Placement | null }> {
    const now = new Date().toISOString()
    const location = draft.location?.trim() ?? ''

    // Both forms are stored as separate data points, derived from whichever
    // one we actually have. Duplicate detection searches both columns, so a
    // book scanned from its barcode still matches one entered by ISBN-10.
    const isbn = resolveIsbnPair(draft.isbn13 || draft.isbn10 || '')

    /*
     * The range this book's genre tags put it in.
     *
     * **A book this method is inserting carries no tags at all**, so the genre
     * tags it will have are exactly the one this save states, and reading them
     * back out of `book_tag` would be reading what the caller is about to write.
     * Every other way into a shelf range goes through a book that exists, and
     * those read the rows: see `settleGenre` in `server/index.ts`.
     *
     * Known before anything is read, which is what lets the lock be taken first.
     *
     * **Null when this save states no genre** (#304). The book then joins
     * neither run: there are no neighbours to read, no start label to offer and
     * no gap to point at, so there is no placement either, and the row carries
     * the empty range a book in no run has always carried. Nothing is
     * serialised on, because a book that is in neither ordered list cannot
     * disturb either one.
     */
    const { range } = genreStatedBy(draft)

    // The row and its authors are still one transaction, and it still nests:
    // `Db.tx` opens a savepoint when the caller is already inside one, which is
    // what better-sqlite3's own nested transactions did.
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
   * The insert itself, split out only so `addBook` reads as the sequence it is.
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
    // statement that produced it, which every dialect can do, instead of from
    // a driver-specific property of the result object.
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
        // The empty range a book in no run carries, which is what `CaptureQueue`
        // writes for a book nobody has shelved yet: it keeps the row out of
        // every `shelf_range = ?` there is rather than putting it in one of them.
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

    /*
     * The photographs this save carries, on the same handle as the insert, so a
     * book and its photographs commit together or neither does.
     *
     * Dated from the save because that is all this path knows: a book reached
     * here without going through the queue was photographed by the request that
     * is creating it. A book that came through the queue already has its rows,
     * written as each shutter went, and takes this branch not at all.
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
  async getBook(id: number): Promise<PlacedPhotographedBook | undefined> {
    return withPlacementsOf(this.db, await withPhotographsOf(
      this.db,
      await this.db.get<BookRow>('SELECT * FROM books WHERE id = ?', [id]),
    ))
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
  async updateBook(
    id: number,
    draft: DraftBook,
    /**
     * The range the book's genre tags put it in, settled by the caller before
     * this runs (#223). It arrives rather than being derived here because the
     * answer is in `book_tag`, which is written through the tagging layer and
     * not through this class.
     *
     * **Null when no genre tag claims the book** (#304). The row is still
     * written, and everything else about it is still recomputed; what it has no
     * answer to is which run it joins, so the column takes the empty range and
     * there is no placement to hand back.
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
       * The photographs, on the same terms as the placement below and for the
       * same reason: an edit that carries none says nothing about them and
       * writes nothing. A book saved out of the queue already has a row per
       * shutter and the client does not re-upload the files; a book saved with
       * new ones means them, and a file this book has no row for is a new
       * photograph and gets one rather than replacing what it was shot to
       * improve on.
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
      // placement and the book stays where the ledger already has it. An edit
      // that carries one is somebody saying where the book is now, which is the
      // same statement a book leaving the queue is saved by.
      await recordPlaced(
        tx, { id, sortKey: resolved.sortKey, location }, new Date().toISOString(),
      )

      // No run to be in, so no gap in one to point at. Everything above has
      // happened: the row is written, the credits are next, and the book is
      // saved. What it is not is filed.
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
   * A person says where this book physically is now.
   *
   * **The whole of it is a ledger row since #232.** There is no column left to
   * write, so what used to be an update with a placement beside it is the
   * placement, and the sort key it carries is read rather than returned by the
   * update that is no longer there. A row that has since been deleted has no key
   * and nothing to record.
   *
   * Refuses a label naming a plank the collection does not have, by throwing:
   * see `UnknownPlank`. That is the one thing this cannot do quietly, because
   * the ledger is now the only record of where the book is.
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
   * The same, said as the plank rather than as its name.
   *
   * **Not a fifth statement**: it is this one with the label already resolved,
   * and it writes the same `placed` row through the same file on the same
   * transaction handle. It exists because a label is a rendering and a caller
   * acting on a list the server drew should not have to hand that rendering back
   * to be read again, which is how a named bookcase came to refuse the very
   * labels the app itself had just written (#356).
   *
   * Refuses an area the collection does not have, by throwing, exactly as the
   * label form refuses a plank nobody owns.
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
   * Whether any book still names this file as a photograph or a crop of one.
   *
   * **`capture` is what says so now (#228).** It used to be seven columns on
   * `books`, which could name at most one photograph of a kind, so a spine
   * re-shot yesterday and the blurred one it replaced could not both be a claim
   * on a file. Every photograph there has ever been is a row, so the question is
   * asked of the rows and the answer covers all of them.
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
      `SELECT 1 FROM capture c
         JOIN books b ON b.id = c.book_id
        WHERE b."state" != ?
          AND (c.file = ? OR c.crop_file = ?)
        LIMIT 1`,
      [DISCARDED, name, name],
    )
    return Boolean(usedByBook)
  }

  // -----------------------------------------------------------------------
  // Reads
  // -----------------------------------------------------------------------

  /**
   * Every book in a range, in order. `catalogued_books`, not `books`.
   *
   * The statement and the reasoning are in
   * `infrastructure/books/book-repository.ts` since #424. Kept as a method here
   * because the shelving screens ask a `Store` for a whole run.
   */
  listRange(range: ShelfRange): Promise<FiledPlacedBook[]> {
    return this.reads.listRange(range)
  }

  /**
   * The same listing, asked a narrower question and a page at a time.
   *
   * The statement and the reasoning are in
   * `infrastructure/books/book-repository.ts` since #424. Kept as a method here
   * because `GET /api/books` is answered from a `Store` the routes already hold.
   */
  listing(query: Listing): Promise<{ books: FiledPlacedBook[]; total: number }> {
    return this.reads.listing(query)
  }

  /**
   * How many books each tag has, counting the ones under it.
   *
   * The statement and the reasoning are in
   * `infrastructure/books/book-repository.ts` since #424. Kept as a method here
   * because the tag routes hold a `Store` and not a repository.
   * `server/furniture.ts` has no `Store` and imports
   * `infrastructure/books/tag-counts.ts` directly.
   */
  tagCounts(): Promise<{ slug: string; books: number }[]> {
    return this.reads.tagCounts()
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
   * **`books.state` is the compare-and-set since #232.** It used to be
   * `checked_out_at IS NULL`, with the state written in the same statement so
   * the two could not disagree; the column is gone and the state is what is
   * left, which is the condition every shelf query already read. The moment the
   * book left is the `created_at` of its `checked_out` row, which is why a no-op
   * still keeps it: a statement that changed no rows writes no row either.
   *
   * Returning is `shelved`, and the plank it came off. `docs/data-model.md` has
   * a returning book placed again by the rules, and that would move a book
   * somebody put back where they found it; see `recordCheckedOut`.
   */
  async setCheckedOut(
    id: number,
    out: boolean,
  ): Promise<{ changed: boolean; checkedOutAt: string | null }> {
    const now = new Date().toISOString()
    /*
     * The compare-and-set is still one statement, and the transaction around it
     * is not a second chance to decide anything: it is what makes the ledger
     * rows commit with the state. A second checkout arriving at once changes no
     * rows here, so it writes no row there either.
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
   * Record the outcome of looking for a cover.
   *
   * The timestamp is set either way. Plenty of books have no cover anywhere,
   * and without a record of having asked, every backfill would spend its whole
   * batch re-asking about the same ones and never reach the rest.
   *
   * The artwork becomes a photograph here rather than at the three callers that
   * download one. See `coverDownloaded` for why that is where it lives.
   *
   * **`cover_checked_at` is still a column and the artwork is not.** They are
   * two different facts: one is about a search, which happened whether or not it
   * found anything, and the other is about a photograph, which exists or does
   * not. A book with no cover anywhere gets the stamp and no row, which is
   * exactly what stops the backfill asking about it forever.
   */
  async setCoverImage(id: number, name: string): Promise<void> {
    const at = new Date().toISOString()
    const row = await this.db.get<{ id: number }>(
      'UPDATE books SET cover_checked_at = ? WHERE id = ? RETURNING id',
      [at, id],
    )
    if (row) await coverDownloaded(this.db, id, name, at)
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

  /**
   * Store the hashes of a book's front photograph and its catalogue artwork.
   *
   * A hash is a fact about one photograph, so it lands on that photograph's row
   * and there is nowhere else for it to land: from the hash backfill and from
   * `rehash-covers` as much as from a save. See `recordHashes`.
   */
  async setHashes(id: number, front: string, cover: string): Promise<void> {
    await recordHashes(this.db, id, front, cover)
  }

  /**
   * Everything a held-up book can be matched against.
   *
   * Small enough to scan in full: sixty-four bits per image and a few thousand
   * books is nothing, and an index that let us skip comparisons would have to
   * approximate the very thing being measured.
   */
  async hashIndex(): Promise<({
    id: number; title: string; author_filing: string
    checked_out: boolean
  } & PhotographFields)[]> {
    /*
     * The rows are narrowed in SQL and the photographs are joined on afterwards,
     * which is one statement each rather than a statement per book. The `EXISTS`
     * is the same filter the two hash columns used to be: a book nothing has
     * hashed has nothing to compare and belongs out of the index rather than in
     * it scoring 64 against everything.
     */
    const rows = await this.db.all<{
      id: number; title: string; author_filing: string; checked_out: boolean
    }>(
      // The state, not `checked_out_at`, which is gone (#232). What the caller
      // wants to say is "that one is already off the bookcase", which is a state
      // rather than a moment, and it is the state the moment was derived from.
      `SELECT id, title, author_filing, state = '${CHECKED_OUT}' AS checked_out
         FROM catalogued_books b
        WHERE EXISTS (
                SELECT 1 FROM capture c WHERE c.book_id = b.id AND c.hash != '')`,
    )
    // Narrowed again on the way out, because the hashes that matter are the ones
    // on the current front photograph and the current artwork: a hash on a spine
    // is not something anything compares against.
    return (await withPhotographs(this.db, rows))
      .filter((row) => row.front_hash !== '' || row.cover_hash !== '')
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
  async imageHashes(): Promise<({ id: number; title: string } & PhotographFields)[]> {
    return withPhotographs(this.db, await this.db.all<{ id: number; title: string }>(
      `SELECT id, title FROM catalogued_books b
        WHERE EXISTS (
                SELECT 1 FROM capture c
                 WHERE c.book_id = b.id AND c.kind IN ('front', 'catalogue'))
        ORDER BY id`,
    ))
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
   * Books whose current photographs have not been hashed yet.
   *
   * **`current_photograph`, and it has to be.** The detector hashes the front
   * photograph and the artwork, which means the newest of each, so a question
   * about "a photograph with no hash" would keep answering with a spine nobody
   * hashes or with a superseded front, and `hashInBackground` loops until this
   * comes back empty. Asking about the same photograph the hasher will reach for
   * is what makes the loop terminate.
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

  /**
   * Books off the shelf, oldest first, so nothing is quietly forgotten.
   *
   * The statement and the reasoning are in
   * `infrastructure/books/book-repository.ts` since #424. Kept as a method here
   * because the checked-out route is answered from a `Store`.
   */
  checkedOut(): Promise<FiledPlacedBook[]> {
    return this.reads.checkedOut()
  }

  /**
   * The four numbers every save response and `/api/health` carry.
   *
   * The statement and the reasoning are in
   * `infrastructure/books/book-repository.ts` since #424. Kept as a method here
   * because every route that saves a book already holds a `Store`.
   */
  counts(): Promise<{
    total: number; fiction: number; nonfiction: number; checkedOut: number
  }> {
    return this.reads.counts()
  }
}

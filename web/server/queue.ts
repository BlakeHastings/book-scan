/**
 * The capture queue, which is a query over `books`.
 *
 * A capture is accepted the moment the photographs exist and read afterwards, by
 * a worker that is deliberately serial: `identify` serialises every caller in
 * the process anyway, for the reasons written down on `identifyChain` in
 * `server/identify.ts`.
 *
 * There is no `captures` table. Every statement in this class is against
 * `books`, and every statement that asks for the queue reads `queued_books`,
 * which is where the three early states are spelled out; nothing in this file
 * spells that list itself.
 *
 * The wire vocabulary is not the state model. `CaptureRow` has a `status` of
 * `pending`, `ready`, `failed` or `done`, `domain/books/state.ts` holds the
 * pairing, and this file translates at the edge.
 */

import type { Db } from './driver'
import { ReadingTimedOut } from './deadline'
import { identify } from './identify'
import { lookupIsbn, type LookupOptions, type LookupResult } from './lookup'
import {
  deriveCapture, hashFront, hashQueuedFronts,
  type DerivableCapture, type HashOutcome, type HashSweep,
} from './capturecrop'
import { type CropIo, type CropSlot } from './crop'
import {
  PHOTO_SLOTS, photographTaken, recordCrop, recordFrontHash,
  withPhotographs, withPhotographsOf, type PhotographFields,
} from './photographs'
import { resolveIsbnPair } from '../shared/isbn'
import type { GenreSlug } from '../domain/tagging/genre'
import {
  countFailures, PROCESSING_ERROR_NOTE, READING_TIMEOUT_NOTE,
  type FailureCounts,
} from '../shared/captureFailure'
import {
  DISCARDED, QUEUED_STATES, QUEUE_STATUS_OF_STATE, STATE_OF_QUEUE_STATUS,
} from '../domain/books/state'

/**
 * The three early states as a SQL literal list. Only ever used where the
 * relation cannot be `queued_books`: in the `WHERE` of a write, since a view is
 * read and a book is written.
 */
const QUEUED_SQL = QUEUED_STATES.map((state) => `'${state}'`).join(', ')

/**
 * How long a sweep waits before it looks at the queue again. A reading takes
 * about six or seven seconds when it goes well, so a sweep that fired sooner
 * would spend its passes finding a drain already in flight. It is the delay
 * before the first look and not an interval: see `wake`, which is armed by a
 * reader rather than by a clock.
 */
const SWEEP_MS = 5_000

/**
 * The row a caller of this class gets, assembled from the book underneath. Four
 * columns are renamed on the way out: `status` is derived from the state, `note`
 * is `scan_note` (because `books.notes` is already a person's note about a
 * book), `created_at` is `scanned_at`, and `book_id` is the row's own id once it
 * stops being queued.
 */
const QUEUE_ROW = `
  id,
  CASE "state"
    ${Object.entries(QUEUE_STATUS_OF_STATE)
      .map(([state, status]) => `WHEN '${state}' THEN '${status}'`).join(`
    `)}
    ELSE 'done'
  END AS status,
  isbn13, isbn10, isbn_source, title_guess, cover_text, analysed,
  draft_json, edit_json, edited_by, edited_at,
  scan_note AS note, claimed_by, claimed_at,
  CASE WHEN "state" IN (${QUEUED_SQL}) THEN NULL ELSE id END AS book_id,
  scanned_at AS created_at, processed_at`

/**
 * The photographs, which are not in the projection above because they are not
 * columns: `capture` holds every photograph there has ever been of a book, so
 * the fields the queue hands out are derived from the newest of each kind. Every
 * read in this class goes through here, so a caller cannot get half a row.
 */
async function queueRows(db: Db, rows: QueueProjection[]): Promise<CaptureRow[]> {
  return withPhotographs(db, rows)
}

export type Slot = 'front' | 'back' | 'edge'

/** Read in this order: the back carries the identifier. */
const SLOT_ORDER: Slot[] = ['back', 'front', 'edge']

export type CaptureStatus = 'pending' | 'ready' | 'failed' | 'done'

export interface QueueCounts extends Record<CaptureStatus, number> {
  failures: FailureCounts
}

/**
 * A book in the queue, in the shape the queue has always handed one out. There
 * is no row of this shape in the database: it is `books`, projected by
 * `QUEUE_ROW` above.
 */
export interface QueueProjection {
  /** The book's own id. There is no second identity for a queued book. */
  id: number
  /**
   * Where this book is, in the queue's four names rather than the seven states
   * underneath. `done` means it has left the queue, whether it was shelved or
   * discarded.
   */
  status: CaptureStatus
  isbn13: string
  isbn10: string
  isbn_source: string
  /**
   * The first line OCR read off the front cover. A machine's reading of a
   * photograph and never anything else: nobody's stated title is written here,
   * so a caller holding this row can always tell the two apart.
   */
  title_guess: string
  cover_text: string
  analysed: string
  draft_json: string
  /** What a person stated, as JSON. Never written by the worker. */
  edit_json: string
  edited_by: string
  edited_at: string | null
  /** What the worker has to say about reading these photographs, not a person's note. */
  note: string
  claimed_by: string
  claimed_at: string | null
  /**
   * The book this scan became, or null while it is still in the queue. Its own
   * id, since a scan and the book it becomes are one row.
   */
  book_id: number | null
  /** When the first photograph arrived. */
  created_at: string
  processed_at: string | null
}

/**
 * A queued book as this class hands one out: the projection above, with the
 * current photograph of each kind joined onto it. See `PhotographFields` in
 * `server/photographs.ts`, which is the one place the flat names and the rows
 * meet.
 */
export type CaptureRow = QueueProjection & PhotographFields

/**
 * The fields a person may state about a capture while it is still in the queue.
 * Photographs, status and claims are not in here, because those are not
 * statements about the book.
 */
export interface CaptureEdit {
  isbn13?: string
  isbn10?: string
  isbnSource?: string
  title?: string
  subtitle?: string
  authors?: string[]
  publisher?: string
  published?: string
  pages?: string
  notes?: string
  /**
   * Absent and null are different here, the way they are for every key on this
   * interface. Absent is nobody having said, so the worker still owns the field;
   * null is a lookup having come back with no genre in it, which is what stops
   * the review pane pre-selecting an answer nothing gave.
   */
  genre?: GenreSlug | null
  classificationSource?: string
  classificationConfidence?: string
  seriesName?: string
  seriesIndex?: number | null
  location?: string
  lookupSource?: string
  authorFilingOverride?: string | null
}

/**
 * How a person's ISBN got there. `barcode` and `ocr` are readings the worker
 * made of a photograph; this third value is a person typing the digits off the
 * book in their hands, which is a different kind of fact.
 */
export const MANUAL_ISBN_SOURCE = 'manual'

export interface DuplicateBook {
  id: number
  title: string
  location: string
}

/**
 * A catalogue lookup, with the answer to a second question `lookupIsbn` on its
 * own cannot give: whether this catalogue already has a book under this ISBN.
 * The same pairing `GET /api/lookup/isbn/:isbn` makes, so every door that
 * reaches a lookup answers both.
 */
export type LookupWithDuplicate = LookupResult & { duplicateOf: DuplicateBook | null }

export type EditOutcome =
  | { ok: true; row: CaptureRow; lookup: LookupWithDuplicate | null }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'done' }
  | { ok: false; reason: 'claimed'; heldBy: string }

/** How long a claim holds before someone else may take the capture. */
const CLAIM_LEASE_MS = 5 * 60 * 1000

/**
 * Where a capture's derived pictures are read and written. `orphaned` is for a
 * crop written after its capture went: a discard is deferred by ten seconds in
 * the client, so the delete can land in the second this pass spends cropping,
 * sweeping the crops the row named at the time while the file lands afterwards
 * with nothing pointing at it.
 */
export interface CaptureImages extends CropIo {
  orphaned?: (names: string[]) => Promise<unknown> | unknown
}

function fromLookup(lookup: LookupResult): CaptureEdit {
  return {
    title: lookup.title,
    subtitle: lookup.subtitle,
    authors: lookup.authors,
    publisher: lookup.publisher,
    published: lookup.published,
    pages: lookup.pages,
    genre: lookup.classification.genre,
    classificationSource: 'auto',
    classificationConfidence: lookup.classification.confidence,
    seriesName: lookup.seriesName,
    seriesIndex: lookup.seriesIndex,
    lookupSource: lookup.source,
  }
}

/** What a person stated, or nothing when nobody has stated anything. */
export function editsOn(capture: Pick<CaptureRow, 'edit_json'>): CaptureEdit {
  if (!capture.edit_json) return {}
  try {
    return JSON.parse(capture.edit_json) as CaptureEdit
  } catch {
    // A corrupt overlay must not take the whole capture down with it.
    return {}
  }
}

export class CaptureQueue {
  private draining = false
  /**
   * A drain that was asked for while one was running, so the running one looks
   * again before it stops. `hashAgain` below keeps the same arrangement: a guard
   * that refuses work has to remember it did.
   */
  private drainAgain = false
  /** The capture the worker has in its hands right now. See `reading`. */
  private readingNow: number | null = null
  /** The sweep that is armed, where one is. See `wake`. */
  private sweep: ReturnType<typeof setTimeout> | null = null
  private hashing = false
  private hashAgain = false

  constructor(
    private readonly db: Db,
    private readonly readImage: (name: string) => Buffer | null,
    private readonly lookupOptions: LookupOptions = {},
    /**
     * Where a capture's derivatives are read and written. Optional: without it
     * the worker still reads photographs and identifies books, which is what a
     * test of the reading itself wants.
     */
    private readonly images?: CaptureImages,
    /**
     * Whether an ISBN is already on a shelved, checked-out or withdrawn book.
     * `Store.findByIsbn` bound in by `server/index.ts`, so this class asks the
     * one question of the catalogue it needs rather than depending on the whole
     * of `Store`. Optional, and with no catalogue behind it a duplicate is never
     * named.
     */
    private readonly findCatalogued?: (isbn: string) => Promise<DuplicateBook | undefined>,
  ) {}

  /**
   * The book already on record for this ISBN, or null when there is not one. A
   * question about an ISBN and not about a lookup, so it is asked whatever a
   * lookup did or did not return. `exceptId` is the row asking, which must not
   * be its own answer: a capture becomes a book rather than being copied into
   * one, so from the moment it is shelved its ISBN really is in
   * `catalogued_books`.
   */
  async cataloguedAs(isbn: string, exceptId: number | null = null): Promise<DuplicateBook | null> {
    if (!isbn || !this.findCatalogued) return null
    const existing = await this.findCatalogued(isbn)
    if (!existing || existing.id === exceptId) return null
    // Narrowed to the three fields a warning names, which is the only shape
    // `LookupWithDuplicate.duplicateOf` promises a caller.
    return { id: existing.id, title: existing.title, location: existing.location }
  }

  /**
   * The book a photograph has just brought into existence. The empty `title`,
   * `shelf_range` and `sort_key` are the point rather than placeholders:
   * `scanned` keeps the row out of `shelved_books` and an empty shelf range
   * keeps it out of every range there is. The transaction is the whole of what
   * stops the worker reading a book with no photographs on it, because the row
   * and its photographs are two statements and `drain` runs on another
   * connection.
   */
  async add(images: { front?: string; back?: string; edge?: string }): Promise<CaptureRow> {
    const now = new Date().toISOString()
    const id = await this.db.tx(async (tx) => {
      // RETURNING id rather than lastInsertRowid: the id comes back from the
      // statement that made it.
      const created = await tx.get<{ id: number }>(
        `INSERT INTO books
           (title, shelf_range, sort_key, state, scanned_at)
         VALUES ('', '', '', ?, ?)
         RETURNING id`,
        [STATE_OF_QUEUE_STATUS.pending, now],
      )
      const id = Number(created!.id)
      /*
       * Dated from the shutter rather than from a save, which is the whole of
       * what `taken_at` carries: a photograph was taken when it was taken.
       */
      for (const slot of PHOTO_SLOTS) {
        await photographTaken(tx, id, slot, images[slot] ?? '', now)
      }
      return id
    })
    return (await this.get(id))!
  }

  /**
   * Attach one photo to a capture, creating the capture on the first shot. Each
   * photograph is queued for reading the moment it exists. Re-taking a slot
   * overwrites nothing: it is a second, newer row, and the one it improves on is
   * still there behind it.
   */
  async attach(captureId: number | null, slot: Slot, filename: string): Promise<CaptureRow> {
    const now = new Date().toISOString()

    if (captureId && (await this.get(captureId))) {
      await this.db.tx(async (tx) => {
        await photographTaken(tx, captureId, slot, filename, now)
        await tx.run(
          `UPDATE books
              SET
                  -- A book that has left the queue keeps the state it left for:
                  -- a second photograph of something on a shelf does not put it
                  -- back in the queue, and one of something discarded does not
                  -- undo the discard.
                  state = CASE WHEN "state" IN (${QUEUED_SQL}) THEN '${STATE_OF_QUEUE_STATUS.pending}'
                               ELSE "state" END,
                  -- Re-taking a slot means it needs reading again. The slot is
                  -- taken out by surrounding the list with the separator it is
                  -- joined by, which is what makes the match exact; the two
                  -- commas that put there are then taken back off, or the list
                  -- comes back as ",back,front," with an empty entry at each
                  -- end (#431). Every reader drops those, so nothing depended
                  -- on them, and a column read by a person while they work out
                  -- what a photograph did should say what it means.
                  analysed = TRIM(BOTH ',' FROM
                    REPLACE(REPLACE(',' || analysed || ',', ',' || @slot || ',', ','), ',,', ','))
            WHERE id = @id`,
          { id: captureId, slot },
        )
      })
      return (await this.get(captureId))!
    }

    const id = await this.db.tx(async (tx) => {
      const created = await tx.get<{ id: number }>(
        `INSERT INTO books
           (title, shelf_range, sort_key, state, scanned_at)
         VALUES ('', '', '', ?, ?)
         RETURNING id`,
        [STATE_OF_QUEUE_STATUS.pending, now],
      )
      const id = Number(created!.id)
      await photographTaken(tx, id, slot, filename, now)
      return id
    })
    return (await this.get(id))!
  }

  /**
   * One row, whatever state it is in. `books` rather than `queued_books`,
   * because this is a lookup by id and its callers ask it about books that have
   * left the queue on purpose: `edit` refuses a shelved one by name rather than
   * by not finding it.
   */
  async get(id: number): Promise<CaptureRow | undefined> {
    return withPhotographsOf(this.db, await this.db.get<QueueProjection>(
      `SELECT ${QUEUE_ROW} FROM books WHERE id = ?`, [id],
    ))
  }

  /**
   * The state itself, for the one caller that cannot use `status`: that folds
   * every state which is not queued into `done`, and `derive` has to tell a book
   * discarded mid-crop from one shelved mid-crop, which are opposite answers to
   * a sweep about to delete files.
   */
  private async stateOf(id: number): Promise<string | undefined> {
    const row = await this.db.get<{ state: string }>(
      'SELECT "state" FROM books WHERE id = ?', [id],
    )
    return row?.state
  }

  async list(): Promise<CaptureRow[]> {
    return queueRows(this.db, await this.db.all<QueueProjection>(
      `SELECT ${QUEUE_ROW} FROM queued_books ORDER BY id ASC`,
    ))
  }

  /**
   * The CAST is there because an uncast COUNT is wider than an int and a driver
   * that will not narrow it hands back a string. `failures` is counted in
   * TypeScript over the failed rows rather than in SQL, so that `failureOf`
   * stays the only copy of the rule. `done` counts every book that has left the
   * queue, which is every catalogued book, and nothing reads it.
   */
  async counts(): Promise<QueueCounts> {
    const rows = await this.db.all<{ status: CaptureStatus; n: number }>(
      `SELECT status, CAST(COUNT(*) AS INTEGER) AS n
         FROM (SELECT ${QUEUE_ROW} FROM queued_books) queued
        GROUP BY status`,
    )

    const shelved = await this.db.get<{ n: number }>(
      'SELECT CAST(COUNT(*) AS INTEGER) AS n FROM catalogued_books',
    )

    const counts: QueueCounts = {
      pending: 0,
      ready: 0,
      failed: 0,
      done: shelved?.n ?? 0,
      failures: countFailures(
        await this.db.all<{ isbn13: string; note: string }>(
          `SELECT isbn13, scan_note AS note FROM books WHERE "state" = ?`,
          [STATE_OF_QUEUE_STATUS.failed],
        ),
      ),
    }
    for (const row of rows) counts[row.status] = row.n
    return counts
  }

  /**
   * Take ownership of a capture, so two people working the same queue do not
   * both fill in the same book. The claim is a lease rather than a lock, and it
   * is a single conditional UPDATE so two simultaneous claims cannot both
   * succeed.
   */
  async claim(
    id: number,
    who: string,
  ): Promise<{ ok: boolean; row?: CaptureRow; heldBy?: string }> {
    const cutoff = new Date(Date.now() - CLAIM_LEASE_MS).toISOString()

    const result = await this.db.run(
      // A scan somebody discarded is not claimable either, which is what
      // `state IN (queued)` covers beyond `status != 'done'`.
      `UPDATE books
          SET claimed_by = @who, claimed_at = @now
        WHERE id = @id
          AND "state" IN (${QUEUED_SQL})
          AND (claimed_by = '' OR claimed_by = @who OR claimed_at IS NULL
               OR claimed_at < @cutoff)`,
      { id, who, now: new Date().toISOString(), cutoff },
    )

    if (result.changes === 0) {
      const row = await this.get(id)
      return { ok: false, heldBy: row?.claimed_by || 'someone else' }
    }
    return { ok: true, row: await this.get(id) }
  }

  /**
   * Record what a person worked out about a capture that is still in the queue,
   * so the next person to open it sees the work already done. Editing goes
   * through `claim` rather than a second mechanism, so an edit both requires the
   * claim and renews the lease, which is what a long resolving session needs. A
   * stated ISBN re-runs the lookup, because the ISBN is the key every other
   * field hangs off and a corrected one that did not refetch would leave a book
   * carrying the right number and the wrong title.
   */
  async edit(id: number, who: string, patch: CaptureEdit): Promise<EditOutcome> {
    const before = await this.get(id)
    if (!before) return { ok: false, reason: 'missing' }
    // A book that has left the queue is not edited here. `PUT /api/books/:id`
    // edits a filed book, and it recomputes the sort key, which this does not
    // and must not.
    if (before.status === 'done') return { ok: false, reason: 'done' }

    const held = await this.claim(id, who)
    if (!held.ok) return { ok: false, reason: 'claimed', heldBy: held.heldBy ?? 'someone else' }

    // Merged, not replaced, so successive edits accumulate rather than each one
    // wiping the fields the last stated.
    const already = editsOn(before)
    let merged: CaptureEdit = { ...already, ...patch }
    let lookup: LookupResult | null = null

    const typed = patch.isbn13 ? resolveIsbnPair(patch.isbn13) : null
    if (typed && (typed.isbn13 || typed.isbn10) && typed.isbn13 !== before.isbn13) {
      lookup = await lookupIsbn(patch.isbn13!, this.lookupOptions)
      merged = {
        ...already,
        // The catalogue's answer beats what was on screen a moment ago, because
        // those fields describe the book the wrong ISBN named. Notes, location
        // and the filing override are kept: the person is the authority on those.
        ...(lookup.found ? fromLookup(lookup) : {}),
        notes: already.notes,
        location: already.location,
        authorFilingOverride: already.authorFilingOverride,
        // And anything stated in this same request beats the catalogue in turn:
        // correcting the ISBN and the title together means both.
        ...patch,
        // Whatever the catalogue said, the digits the person typed are the ones
        // recorded, and they are recorded even when nothing has them.
        isbn13: lookup.isbn13 || typed.isbn13 || patch.isbn13!,
        isbn10: lookup.isbn10 || typed.isbn10 || '',
        isbnSource: MANUAL_ISBN_SOURCE,
      }
    }

    const now = new Date().toISOString()

    await this.db.run(
      `UPDATE books SET
         edit_json = @edit, edited_by = @who, edited_at = @now,
         -- Mirrored onto the row's own columns as well as into the overlay:
         -- the queue listing and the worker both read these directly, and a
         -- correction nobody can see in the list is half a correction.
         isbn13 = COALESCE(@isbn13, isbn13),
         isbn10 = COALESCE(@isbn10, isbn10),
         isbn_source = COALESCE(@isbnSource, isbn_source),
         -- title_guess is deliberately not mirrored, and the ISBN columns
         -- deliberately still are (#156). An ISBN a person typed and one a
         -- barcode gave are both identifiers, and isbn_source already says
         -- which; a title somebody stated and a line OCR read off a cover are
         -- not the same kind of fact at all, and this column has no second one
         -- to say so. Stated titles live in edit_json and are read back
         -- through it, so the two stay tellable apart on the row itself.
         --
         -- A person who has stated a title or an ISBN has resolved this
         -- book, whatever the photographs did or did not read. 'scanned'
         -- is left alone: the worker is mid-pass and settles it itself,
         -- with this overlay applied.
         --
         -- The CAST is the point made at Store.updateBook: this parameter is
         -- compared against a bare literal, with no column to take a type
         -- from, so a database that types parameters before it plans refuses
         -- the statement rather than guessing. Identity on SQLite.
         state = CASE
           WHEN "state" IN ('${STATE_OF_QUEUE_STATUS.ready}', '${STATE_OF_QUEUE_STATUS.failed}')
                AND CAST(@resolved AS INTEGER) = 1
             THEN '${STATE_OF_QUEUE_STATUS.ready}'
           ELSE "state"
         END
       WHERE id = @id`,
      {
        id,
        who,
        now,
        edit: JSON.stringify(merged),
        isbn13: merged.isbn13 ?? null,
        isbn10: merged.isbn10 ?? null,
        isbnSource: merged.isbnSource ?? null,
        resolved: (merged.title ?? '') || (merged.isbn13 ?? '') ? 1 : 0,
      },
    )

    // The same isbn a fresh lookup would have been asked about: what the
    // catalogue answered, falling back to the digits typed when nothing
    // answered at all.
    const withDuplicate: LookupWithDuplicate | null = lookup
      ? { ...lookup, duplicateOf: await this.cataloguedAs(lookup.isbn13 || typed?.isbn13 || '', id) }
      : null

    return { ok: true, row: (await this.get(id))!, lookup: withDuplicate }
  }

  async release(id: number, who: string): Promise<void> {
    await this.db.run(
      `UPDATE books SET claimed_by = '', claimed_at = NULL
        WHERE id = ? AND claimed_by = ?`,
      [id, who],
    )
  }

  /**
   * The scan was a mistake. Nothing is deleted: the row stays, out of the queue
   * and out of every relation a shelf is drawn from, and only a queued book can
   * be discarded. The photographs are deleted from disk by the route that calls
   * this, and the filenames stay on the row as the record of what was thrown
   * away; see `Store.imageInUse`.
   */
  async discard(id: number): Promise<void> {
    await this.db.run(
      `UPDATE books SET "state" = ?, claimed_by = '', claimed_at = NULL
        WHERE id = ? AND "state" IN (${QUEUED_SQL})`,
      [DISCARDED, id],
    )
  }

  /**
   * Read this capture's photographs again, from the beginning. `analysed` is
   * cleared rather than left alone, so every photograph on the capture is
   * offered to the reader again, and the note goes with it, since "read it
   * again" stops being true the moment somebody has. Only a queued capture: a
   * shelved book is not read by this worker and a discarded one is not coming
   * back.
   */
  async readAgain(id: number): Promise<CaptureRow | undefined> {
    const result = await this.db.run(
      `UPDATE books
          SET "state" = '${STATE_OF_QUEUE_STATUS.pending}',
              analysed = '', scan_note = '', processed_at = NULL
        WHERE id = @id AND "state" IN (${QUEUED_SQL})`,
      { id },
    )
    if (result.changes === 0) return undefined
    return this.get(id)
  }

  async setCrop(id: number, slot: CropSlot, name: string): Promise<void> {
    await recordCrop(this.db, id, slot, name)
  }

  /** Only ever the hash of the current front photograph. */
  async setFrontHash(id: number, hash: string): Promise<void> {
    await recordFrontHash(this.db, id, hash)
  }

  /**
   * Captures that are still waiting to be shelved and can be compared, so a book
   * held up to the camera can be recognised as one somebody has already scanned.
   * `queued_books` because a book that has left the queue is not waiting for
   * anybody, an empty hash because that is the absence of a hash rather than a
   * weak match, and an empty photograph because a match nobody can look at is a
   * match nobody can check. A failed capture is included on purpose: the read
   * failed, the photographs did not.
   */
  async waiting(): Promise<CaptureRow[]> {
    /*
     * `current_photograph`: both filters are about the photograph somebody would
     * be shown and compared against, which is the newest front one.
     */
    return queueRows(this.db, await this.db.all<QueueProjection>(
      `SELECT ${QUEUE_ROW} FROM queued_books b
        WHERE EXISTS (
                SELECT 1 FROM current_photograph c
                 WHERE c.book_id = b.id AND c.kind = 'front'
                   AND c.hash != '' AND c.file != '')
        ORDER BY id`,
    ))
  }

  /**
   * Other captures still waiting that carry this exact ISBN. The identifier
   * rather than a likeness, so where both this and `waiting` answer the caller
   * takes this one. Deliberately not filtered on `front_hash` or `front_image`
   * the way `waiting` is: a capture whose back cover read and whose front has
   * not been taken yet is exactly the row somebody is about to duplicate.
   * `exceptId` is the capture being asked about, so a capture never reports
   * itself; pass null when the caller is not a capture at all.
   */
  async sharingIsbn(isbn13: string, exceptId: number | null = null): Promise<CaptureRow[]> {
    // An empty ISBN is the absence of an identifier, not an identifier every
    // unread capture happens to share.
    if (!isbn13) return []

    return queueRows(this.db, await this.db.all<QueueProjection>(
      `SELECT ${QUEUE_ROW} FROM queued_books
        WHERE isbn13 = @isbn13 AND id != @except
        ORDER BY id`,
      { isbn13, except: exceptId ?? -1 },
    ))
  }

  /**
   * Every capture that has a photograph, oldest first. Unfiltered within the
   * queue, for the reason `Store.photographed` is. `queued_books`, so that the
   * two crop passes divide the table between them: `Store.photographed` reads
   * `catalogued_books`, and between them every book is offered to a detector
   * exactly once.
   */
  async photographed(): Promise<DerivableCapture[]> {
    return withPhotographs(this.db, await this.db.all<{ id: number }>(
      `SELECT id FROM queued_books b
        WHERE EXISTS (
                SELECT 1 FROM capture c
                 WHERE c.book_id = b.id AND c.kind IN ('front', 'back', 'spine'))
        ORDER BY id`,
    ))
  }

  /**
   * Captures still in the queue whose front photograph carries no hash, which is
   * the complement of the hash filter in `waiting` above. `current_photograph`,
   * because a re-shot front is a new photograph with no hash of its own, so
   * re-taking a slot puts the capture back in here.
   */
  async unhashed(): Promise<CaptureRow[]> {
    return queueRows(this.db, await this.db.all<QueueProjection>(
      `SELECT ${QUEUE_ROW} FROM queued_books b
        WHERE EXISTS (
                SELECT 1 FROM current_photograph c
                 WHERE c.book_id = b.id AND c.kind = 'front'
                   AND c.file != '' AND c.hash = '')
        ORDER BY id`,
    ))
  }

  /**
   * Hash one capture's front photograph, and nothing else. Deliberately not part
   * of the drain: `POST /api/captures` fires this beside it, so it shares
   * nothing with a worker that is serial behind OCR and catalogue lookups, and a
   * wedged queue cannot stop a capture being recognisable. Idempotent: a capture
   * already hashed answers `kept` without reading anything.
   */
  async hashFrontOf(id: number): Promise<HashOutcome> {
    const images = this.images
    if (!images) return 'absent'
    const capture = await this.get(id)
    if (!capture) return 'absent'
    return hashFront(this, capture, images, { apply: true, force: false })
  }

  /**
   * Hash every queued capture that has a front photograph and no hash on it, so
   * a server stopped mid-flight repairs what it finds rather than carrying it.
   * Guarded like `drain`, and with the same care about the guard: a call that
   * arrives while a sweep is running is not dropped, it asks for another lap.
   */
  async hashQueued(): Promise<HashSweep> {
    const images = this.images
    const nothing: HashSweep = { looked: 0, written: 0, refused: 0, unreadable: 0 }
    if (!images) return nothing

    if (this.hashing) {
      this.hashAgain = true
      return nothing
    }

    this.hashing = true
    const total = { ...nothing }
    try {
      do {
        this.hashAgain = false
        const lap = await hashQueuedFronts(this, images)
        total.looked += lap.looked
        total.written += lap.written
        total.refused += lap.refused
        total.unreadable += lap.unreadable
      } while (this.hashAgain)
    } finally {
      this.hashing = false
    }
    return total
  }

  /**
   * Cut this capture's photographs to the book and hash its front. Called from
   * the drain loop, so nobody waits for it, and failure is silent on purpose:
   * the crops are derived and disposable, and a capture with none is a capture
   * shown whole.
   */
  private async derive(id: number): Promise<void> {
    const images = this.images
    if (!images) return
    try {
      const capture = await this.get(id)
      if (!capture) return

      const outcome = await deriveCapture(this, capture, images, { apply: true })

      // Discarded while this was cropping, so the crops it produced are already
      // orphans. See CaptureImages above for why the delete arrives here. The
      // raw state answers this and `status` cannot: that reports `done` for a
      // book shelved in the same second, whose crops are its own.
      const written = outcome.crops.map((slot) => slot.crop).filter(Boolean)
      if (written.length && (await this.stateOf(id)) === DISCARDED) {
        await images.orphaned?.(written)
      }
    } catch {
      // Left uncropped and unhashed, which is a state every reader draws.
    }
  }

  private async nextPending(): Promise<CaptureRow | undefined> {
    return withPhotographsOf(this.db, await this.db.get<QueueProjection>(
      `SELECT ${QUEUE_ROW} FROM queued_books
        WHERE "state" = '${STATE_OF_QUEUE_STATUS.pending}'
        ORDER BY id ASC LIMIT 1`,
    ))
  }

  /**
   * Process every pending capture, one at a time. Safe to call on every enqueue:
   * a second call while draining returns immediately and the running loop picks
   * up whatever was added. Only one pass may be in flight, and the guard below
   * is the whole of it: there is no `await` between reading `this.draining` and
   * setting it, so a second caller entering while the first is suspended still
   * sees `true` and returns. Two overlapping passes would take the same row off
   * the top of the queue and identify the same photographs twice.
   */
  async drain(): Promise<void> {
    if (this.draining) {
      // The pass that refuses this call may already have taken its last look for
      // work: `nextPending` is a query on another connection, so a capture
      // inserted while that query was in flight lands behind the only eye that
      // was going to see it. The refusal is recorded instead.
      this.drainAgain = true
      return
    }
    this.draining = true
    try {
      for (;;) {
        const next = await this.nextPending()
        if (!next) {
          // Nothing found, but somebody asked while this pass was running, so
          // the empty answer above may be older than what they were telling it
          // about. Cleared before the second look rather than after, so a call
          // arriving during that look is recorded too.
          if (!this.drainAgain) break
          this.drainAgain = false
          continue
        }
        // Which capture the worker is actually holding. Only ever set here, so
        // it answers whether anything is reading at all.
        this.readingNow = next.id
        try {
          await this.process(next)
          // After the reading, not before it: identifying the book is what the
          // next person is waiting on. Idempotent, so a capture that comes back
          // round for a newly arrived photograph crops only the slot that is new.
          await this.derive(next.id)
        } finally {
          this.readingNow = null
        }
      }
    } finally {
      this.draining = false
      this.drainAgain = false
    }
  }

  /**
   * Which capture the worker has in its hands, or null when it has none. Not a
   * column and never written down: it is a fact about this process, true for the
   * seconds one reading takes.
   */
  get reading(): number | null {
    return this.readingNow
  }

  private async pendingCount(): Promise<number> {
    const row = await this.db.get<{ n: number }>(
      `SELECT CAST(COUNT(*) AS INTEGER) AS n FROM books WHERE "state" = ?`,
      [STATE_OF_QUEUE_STATUS.pending],
    )
    return Number(row?.n ?? 0)
  }

  /**
   * Look at the queue again in a moment, because somebody found work in it that
   * nothing in this process was going to pick up. This is not a poll and it must
   * never become one: the queue is drained by the shutter, by a retake and at
   * boot, all events inside this process, so a capture written by anything else
   * needs something to look, and `sweepPass` below is where the stopping is
   * decided. Arming is idempotent, and nothing awaits this.
   */
  wake(): void {
    if (this.sweep) return
    const timer = setTimeout(() => {
      this.sweep = null
      void this.sweepPass()
    }, SWEEP_MS)
    // A sweep that is merely waiting must not be what keeps a process alive.
    timer.unref?.()
    this.sweep = timer
  }

  /**
   * One look at the queue, and the decision about whether there is another. The
   * stopping condition is the point: it arms a second sweep only where the pass
   * it just made left strictly fewer captures pending than it found, so the
   * number of sweeps is bounded and a queue nothing can move is swept once and
   * then left alone. Public, and it answers whether it armed another, for the
   * test.
   */
  async sweepPass(): Promise<boolean> {
    const before = await this.pendingCount()
    // Nothing waiting: whatever armed this was looking at an older answer than
    // this one, and there is nothing to come back for.
    if (before === 0) return false

    try {
      // Returns at once if a pass is already running, in which case the
      // measurement below will say so.
      await this.drain()
    } catch (error) {
      // Said out loud and then left alone: a sweep that fails silently is a
      // queue that has stopped quietly.
      console.warn('[queue] the sweep could not read the queue:', (error as Error).message)
      return false
    }

    const after = await this.pendingCount()
    if (after === 0 || after >= before) return false
    this.wake()
    return true
  }

  private async process(capture: CaptureRow): Promise<void> {
    const analysed = new Set(capture.analysed.split(',').filter(Boolean))
    /**
     * Which photograph the reader is holding, for the catch below. Only ever set
     * while `identify` is in flight, so it is null unless the thing that threw
     * was the reading itself.
     */
    let reading: Slot | null = null

    try {
      // Only slots that have arrived and have not been read yet, back first
      // because that is where the identifier lives. A photo taken while an
      // earlier one was being read gets picked up on the next pass.
      const todo = SLOT_ORDER.filter((slot) => {
        const filename = capture[`${slot}_image` as const] as string
        return filename && !analysed.has(slot)
      })

      if (!todo.length) {
        // Nothing new. Settle the status so it stops looking pending. A title
        // somebody typed counts as much as an ISBN here: the book is resolved
        // either way, and calling it 'failed' would send the next person to a
        // book that no longer needs them.
        // The CAST is there because `@statedTitle` is compared against a bare
        // literal with no column in reach, which leaves a parameter with no type
        // for a database that wants one before it will plan.
        await this.db.run(
          `UPDATE books
              SET "state" = CASE
                WHEN isbn13 != '' OR CAST(@statedTitle AS TEXT) != ''
                  THEN '${STATE_OF_QUEUE_STATUS.ready}'
                ELSE '${STATE_OF_QUEUE_STATUS.failed}'
              END
            WHERE id = @id AND "state" = '${STATE_OF_QUEUE_STATUS.pending}'`,
          { id: capture.id, statedTitle: editsOn(capture).title ?? '' },
        )
        return
      }

      let isbn13 = capture.isbn13
      let lookup = capture.draft_json
        ? (JSON.parse(capture.draft_json) as Awaited<ReturnType<typeof lookupIsbn>>)
        : null
      let coverLines = capture.cover_text.split(String.fromCharCode(10)).filter(Boolean)
      let isbnSource = capture.isbn_source
      let titleGuess = capture.title_guess
      const notes: string[] = []

      for (const slot of todo) {
        const image = this.readImage(capture[`${slot}_image` as const] as string)
        analysed.add(slot)
        if (!image) continue

        // The front is the only one worth a title pass, and only while the
        // book is still unidentified.
        const wantTitle = slot === 'front' && !lookup?.found
        reading = slot
        const read = await identify(image, { wantTitle })
        reading = null

        if (wantTitle && read.coverLines.length) {
          coverLines = read.coverLines
          titleGuess = read.titleGuess
        }
        if (lookup?.found) continue

        // A barcode is self-validating. An OCR reading is not: a garbled digit
        // can still satisfy the check digit, so the catalogue decides which
        // reading is real and an unconfirmed one is discarded.
        const candidates = read.source === 'barcode'
          ? [read.isbn13]
          : read.isbnCandidates

        for (const candidate of candidates.filter(Boolean)) {
          const found = await lookupIsbn(candidate, this.lookupOptions)
          if (found.found) {
            isbn13 = candidate
            lookup = found
            isbnSource = read.source
            break
          }
        }

        if (!lookup?.found) {
          if (read.source === 'barcode' && read.isbn13) {
            // Kept: the barcode is trustworthy even if no catalogue has it.
            isbn13 = read.isbn13
            isbnSource = 'barcode'
            notes.push(`Barcode on the ${slot} reads ${read.isbn13}, but no catalogue has it.`)
          } else if (candidates.length) {
            notes.push(
              `Could not confirm an ISBN from the ${slot}. OCR read ` +
              `${candidates.join(' or ')}, which no catalogue has. Use Change ISBN.`,
            )
          }
        }
        notes.push(...read.notes.filter((n) => !notes.includes(n)))
      }

      if (!isbn13 && !lookup?.found) {
        notes.push(
          coverLines.length
            ? `No ISBN confirmed. Cover reads: ${coverLines.join(' / ')}.`
            : 'No ISBN could be read from these photos.',
        )
      }

      // A person beats this worker, decided per field rather than per capture:
      // `edit_json` holds exactly the fields somebody stated, so a key being
      // present is the whole test, and an edit that only fixed the title must
      // not stop the worker filling in an ISBN nobody has stated. The two never
      // share a cell: `draft_json` is the worker's channel and `edit_json` is
      // the person's, which this worker never writes.
      //
      // Read fresh rather than from `capture`, because this pass has been away
      // doing OCR and lookups for seconds. The read is as late as it can be and
      // nothing is awaited between it and the write below, so the row this
      // decides from is the row it writes.
      const stated = editsOn((await this.get(capture.id)) ?? capture)
      const statedIsbn = stated.isbn13 !== undefined
      const resolved = Boolean(lookup?.found) || Boolean(stated.title) || statedIsbn

      // `lookup` is only ever set here on a confirmed match, so whenever it is
      // truthy there is a real ISBN worth asking the catalogue about. Computed
      // fresh on every pass rather than carried over from a stale `draft_json`.
      // The warning a person sees does not come from here: `GET /api/captures/:id`
      // asks it of the capture's own ISBN, whatever the lookup returned.
      const draftWithDuplicate: LookupWithDuplicate | null = lookup
        ? { ...lookup, duplicateOf: await this.cataloguedAs(lookup.isbn13 || isbn13, capture.id) }
        : null

      await this.db.run(
        // `AND state IN (queued)` is the discard window. The pass above spent
        // seconds on OCR and lookups, which is ample time for somebody to have
        // swiped this scan away; without the guard this write would take a
        // discarded book back out of the bin and put it in the queue.
        `UPDATE books SET
           "state" = @status, isbn13 = @isbn13, isbn10 = @isbn10,
           isbn_source = @source, title_guess = @titleGuess,
           cover_text = @coverText, analysed = @analysed,
           draft_json = @draft, scan_note = @note, processed_at = @now
         WHERE id = @id AND "state" IN (${QUEUED_SQL})`,
        {
          id: capture.id,
          status: resolved ? STATE_OF_QUEUE_STATUS.ready : STATE_OF_QUEUE_STATUS.failed,
          isbn13: statedIsbn ? stated.isbn13! : isbn13,
          isbn10: statedIsbn ? (stated.isbn10 ?? '') : (lookup?.isbn10 ?? ''),
          source: statedIsbn ? (stated.isbnSource ?? MANUAL_ISBN_SOURCE) : isbnSource,
          // No precedence rule to apply: this column is the worker's reading of
          // the cover and only ever that. A title somebody stated is a different
          // kind of value and is already durable in `edit_json`.
          titleGuess,
          coverText: coverLines.join(String.fromCharCode(10)),
          analysed: [...analysed].join(','),
          // The worker's own channel. Written whatever a person has said,
          // because it is not the thing shown to them: the capture is read as
          // this with the overlay on top.
          draft: draftWithDuplicate ? JSON.stringify(draftWithDuplicate) : '',
          // "Could not confirm an ISBN, use Change ISBN" stops being true the
          // moment somebody has.
          note: statedIsbn ? '' : notes.join(' '),
          now: new Date().toISOString(),
        },
      )

      // A photo taken while this pass was running set the row back to pending,
      // and the write above has just overwritten that. Without this the newly
      // arrived slot is never read.
      const fresh = await this.get(capture.id)
      if (fresh && fresh.status !== 'done') {
        const read = new Set(fresh.analysed.split(',').filter(Boolean))
        const outstanding = SLOT_ORDER.some((slot) => {
          const filename = fresh[`${slot}_image` as const] as string
          return filename && !read.has(slot)
        })
        if (outstanding) {
          await this.db.run(
            `UPDATE books SET "state" = '${STATE_OF_QUEUE_STATUS.pending}'
              WHERE id = ? AND "state" IN (${QUEUED_SQL})`,
            [capture.id],
          )
        }
      }
    } catch (error) {
      /*
       * A reading that was abandoned rather than one that broke. The slot goes
       * back to being unread, because it was marked read before the reading
       * started so that a photograph whose file has gone missing is not offered
       * to the worker forever, and a reading nobody finished has read nothing.
       * The note carries its own prefix so `failureOf` can say to read it again.
       */
      const abandoned = error instanceof ReadingTimedOut
      if (abandoned && reading) analysed.delete(reading)

      // Said out loud, always: a reader that stopped looks from the outside
      // exactly like a busy queue.
      console.warn(
        `[queue] capture ${capture.id}: ${abandoned ? 'the reading was given up on' : 'the reading failed'}`
        + `${reading ? ` on the ${reading}` : ''}:`,
        (error as Error).message,
      )

      await this.db.run(
        // Guarded for the same reason the write above is: a pass that threw
        // must not resurrect a scan somebody discarded while it was running.
        `UPDATE books
            SET "state" = '${STATE_OF_QUEUE_STATUS.failed}',
                analysed = ?, scan_note = ?, processed_at = ?
          WHERE id = ? AND "state" IN (${QUEUED_SQL})`,
        [
          [...analysed].join(','),
          // The prefix is the only record of which of these two happened, and it
          // is what tells a broken read, an abandoned one and a book no
          // catalogue has apart. See `failureOf`.
          abandoned
            ? `${READING_TIMEOUT_NOTE} the ${reading ?? 'photograph'} was given up on after `
              + `${Math.round((error as ReadingTimedOut).ms / 1000)} seconds. `
              + 'Nothing is known to be wrong with it: the reader stopped before it '
              + 'reached a verdict. Read it again.'
            : `${PROCESSING_ERROR_NOTE} ${(error as Error).message}`,
          new Date().toISOString(),
          capture.id,
        ],
      )
    }
  }

  /**
   * Anything left 'pending' when the server stopped will never be picked up
   * otherwise, since the worker only runs in memory. The hash sweep goes first
   * because it is bounded by how many queued captures have no hash, where the
   * drain behind it is OCR and lookups and can take as long as the queue is
   * deep.
   */
  async resumeOnStartup(): Promise<void> {
    // Deliberately not awaited by the caller: the server must finish starting
    // whatever the queue is doing. Both halves guard themselves against a
    // second pass, so neither can overlap one a shutter starts.
    await this.hashQueued()
    await this.drain()
    // And one look afterwards, for whatever landed while the boot pass was
    // running: a seeded world is written by another process against the same
    // database. The sweep stops itself; see `wake`.
    this.wake()
  }
}

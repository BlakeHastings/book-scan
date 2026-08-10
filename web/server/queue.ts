/**
 * The capture queue, which is a query now.
 *
 * Scanning a shelf is a two-handed physical job, and OCR takes seconds. Making
 * the person holding the book wait for it is the wrong trade, so a capture is
 * accepted the moment the photos exist and read afterwards.
 *
 * The worker is deliberately serial. That is not just simplicity: tesseract.js
 * workers process one job at a time and zbar-wasm keeps a module-level scanner,
 * so two overlapping identifications on the same process can interleave badly.
 * Draining one at a time removes that whole class of problem, which matters as
 * soon as two people are scanning into the same server.
 *
 * ## There is no `captures` table any more (#183)
 *
 * A book exists from its first photograph. The queue held the same thing at an
 * earlier point in its life, in a table of its own, and the only reason for the
 * separation was that `books` drives shelf ordering and misfile detection and a
 * half-identified row must never reach either. #204 replaced that separation
 * with `shelved_books` and the partial index under it, which says the condition
 * once instead of relying on two tables, so the second table can go.
 *
 * Every statement in this class is against `books`, and every statement that
 * asks for the queue reads `queued_books`: the three early states, said once, in
 * SQL, for the same reason `shelved_books` says the one late one. Nothing in
 * this file spells the list of states it means.
 *
 * **The wire vocabulary is unchanged on purpose.** `CaptureRow` still has a
 * `status` of `pending`, `ready`, `failed` or `done`, and `GET /api/captures`
 * still answers with it, because a change that moves a table and renames every
 * field the client, the browser suite and the queue badge read is not a change
 * anybody can review as one thing. `domain/books/state.ts` holds the pairing and
 * this file translates at the edge.
 */

import type { Db } from './driver'
import { identify } from './identify'
import { lookupIsbn, type LookupOptions, type LookupResult } from './lookup'
import { deriveCapture, type DerivableCapture } from './capturecrop'
import { type CropIo, type CropSlot } from './crop'
import {
  PHOTO_SLOTS, photographTaken, recordCrop, recordFrontHash,
  withPhotographs, withPhotographsOf, type PhotographFields,
} from './photographs'
import { resolveIsbnPair } from '../shared/isbn'
import {
  countFailures, PROCESSING_ERROR_NOTE, type FailureCounts,
} from '../shared/captureFailure'
import {
  DISCARDED, QUEUED_STATES, QUEUE_STATUS_OF_STATE, STATE_OF_QUEUE_STATUS,
} from '../domain/books/state'

/**
 * The three early states as a SQL literal list, built from the domain rather
 * than typed out.
 *
 * Only ever used where the relation cannot be `queued_books`: in the `WHERE` of
 * a write, since a view is read and a book is written. A `CASE` that decided the
 * same thing with the names spelled out beside it would be a fourth copy of the
 * predicate `queued_books` and `idx_books_queued` already share.
 */
const QUEUED_SQL = QUEUED_STATES.map((state) => `'${state}'`).join(', ')

/**
 * The row a caller of this class gets, in the shape the queue has always
 * returned it, assembled from the book underneath.
 *
 * Four columns are renamed on the way out and each rename is a real difference
 * rather than a spelling. `status` is derived from the state, so the four names
 * the client knows survive the seven states arriving. `note` is `scan_note`,
 * because `books.notes` is already a person's note about a book and one letter
 * is not enough distance between "signed copy" and "no ISBN could be read from
 * these photos". `created_at` is `scanned_at`, which is the same moment under
 * the name `books` has always used for it. And `book_id` is the row's own id
 * once it stops being queued, which is what "this capture became that book"
 * means when the capture and the book are one row.
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
 * columns (#228).
 *
 * `capture` holds every photograph there has ever been of a book, so the ten
 * fields the queue still hands out are derived from the newest of each kind by
 * `withPhotographs`. Every read in this class goes through this, so a caller
 * cannot get half a row.
 */
async function queueRows(db: Db, rows: QueueProjection[]): Promise<CaptureRow[]> {
  return withPhotographs(db, rows)
}

export type Slot = 'front' | 'back' | 'edge'

/** Read in this order: the back carries the identifier. */
const SLOT_ORDER: Slot[] = ['back', 'front', 'edge']

export type CaptureStatus = 'pending' | 'ready' | 'failed' | 'done'

/**
 * How much is waiting, and what kind of wrong the failed ones are.
 *
 * The status totals are what the queue badge counts. `failures` is there
 * because `failed` on its own does not say what to do about a book, and Home
 * used to guess (#148).
 */
export interface QueueCounts extends Record<CaptureStatus, number> {
  failures: FailureCounts
}

/**
 * A book in the queue, in the shape the queue has always handed one out.
 *
 * There is no row of this shape in the database since #183. It is `books`,
 * projected by `QUEUE_ROW` below, and the four renames it makes are written out
 * there. Everything a caller of this class reads is on this interface, so a
 * caller cannot see the state model underneath and does not have to.
 */
export interface QueueProjection {
  /** The book's own id. There is no second identity for a queued book. */
  id: number
  /**
   * Where this book is, in the queue's four names rather than the seven states
   * underneath. `done` means it has left the queue, whether it was shelved or
   * discarded, which is what the absence of a row used to mean.
   */
  status: CaptureStatus
  isbn13: string
  isbn10: string
  isbn_source: string
  /**
   * The first line OCR read off the front cover. A machine's reading of a
   * photograph and never anything else: nobody's stated title is written here,
   * so a caller holding this row can always tell the two apart (#156). Good
   * enough to name a row in the queue, not good enough to fill in a field
   * somebody will save.
   */
  title_guess: string
  cover_text: string
  analysed: string
  draft_json: string
  /** What a person stated, as JSON. Never written by the worker. */
  edit_json: string
  edited_by: string
  edited_at: string | null
  /**
   * What the worker has to say about reading these photographs. `scan_note` on
   * the row, because `books.notes` is already a person's note about the book.
   */
  note: string
  claimed_by: string
  claimed_at: string | null
  /**
   * The book this scan became, or null while it is still in the queue.
   *
   * Its own id, since a scan and the book it becomes are one row. Kept because
   * the client tells the two apart by whether this is set, and because "this
   * scan is now that book" is still the fact it reports.
   */
  book_id: number | null
  /** When the first photograph arrived, which is `books.scanned_at`. */
  created_at: string
  processed_at: string | null
}

/**
 * A queued book as this class hands one out: the projection above, with the
 * current photograph of each kind joined onto it.
 *
 * The ten photograph fields are derived from `capture` and are not columns.
 * `front_image` is the newest front photograph of this book, `front_crop` is
 * what the detector cut from that one, `cropped` names the slots it has been
 * shown, and `front_hash` is the hash of that photograph. See
 * `PhotographFields` in `server/photographs.ts`, which is the one place the
 * flat names and the rows meet.
 */
export type CaptureRow = QueueProjection & PhotographFields

/**
 * The fields a person may state about a capture while it is still in the
 * queue. A subset of the review pane's draft: only what somebody resolving
 * details actually decides. Photographs, status and claims are not in here,
 * because those are not statements about the book.
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
  isFiction?: boolean
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
 * book in their hands, which is a different kind of fact and is recorded as
 * one rather than borrowing the credibility of either (#29).
 */
export const MANUAL_ISBN_SOURCE = 'manual'

export type EditOutcome =
  | { ok: true; row: CaptureRow; lookup: LookupResult | null }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'done' }
  | { ok: false; reason: 'claimed'; heldBy: string }

/** How long a claim holds before someone else may take the capture. */
const CLAIM_LEASE_MS = 5 * 60 * 1000

/**
 * Where a capture's derived pictures are read and written, and what to do with
 * one whose capture went while it was being written.
 *
 * That last case is not hypothetical. A discard is deferred by ten seconds in
 * the client (`src/lib/discardWindow.ts`), so the delete arrives well after the
 * swipe and can land in the second this pass spends cropping. The delete
 * sweeps the crops the row named at the time, which is nothing yet, and the
 * file lands afterwards with nothing pointing at it. `orphaned` hands those
 * names to the same sweep the discard used, rather than to a second mechanism
 * with its own idea of what is safe to delete.
 */
export interface CaptureImages extends CropIo {
  orphaned?: (names: string[]) => Promise<unknown> | unknown
}

/** The catalogue's answer, in the shape the overlay stores. */
function fromLookup(lookup: LookupResult): CaptureEdit {
  return {
    title: lookup.title,
    subtitle: lookup.subtitle,
    authors: lookup.authors,
    publisher: lookup.publisher,
    published: lookup.published,
    pages: lookup.pages,
    isFiction: lookup.classification.isFiction,
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
    // A corrupt overlay must not take the whole capture down with it. Losing
    // the overlay is bad; refusing to show the book at all is worse.
    return {}
  }
}

export class CaptureQueue {
  private draining = false

  constructor(
    private readonly db: Db,
    private readonly readImage: (name: string) => Buffer | null,
    private readonly lookupOptions: LookupOptions = {},
    /**
     * Where a capture's derivatives are read and written.
     *
     * Optional because the derivatives are not what the queue is for: without
     * it the worker reads photographs and identifies books exactly as it
     * always did, which is what a test of the reading itself wants. The server
     * passes the cover directory, so every capture taken on a real run gets
     * cropped and hashed.
     */
    private readonly images?: CaptureImages,
  ) {}

  // -----------------------------------------------------------------------
  // Writes
  // -----------------------------------------------------------------------

  /**
   * The book a photograph has just brought into existence.
   *
   * Empty `title`, `shelf_range` and `sort_key`, and that is the point rather
   * than a placeholder. Nobody has read this book yet, so it has no title and
   * belongs nowhere. `scanned` keeps it out of `shelved_books` and an empty
   * shelf range keeps it out of every range there is, which is two independent
   * protections where the second one is free.
   *
   * **The transaction is the whole of what stops the worker reading a book with
   * no photographs on it**, and it is new with #228. The filename used to be a
   * column, so the row and the photograph it exists for were one statement and
   * nothing could see one without the other. They are two statements now, and
   * `drain` is running on another connection: a pass that picked this book up in
   * between would find `pending` and nothing to read, settle it as failed and
   * move on, and the photograph would land behind it with nobody coming back.
   * `attach` below is the same argument and the same fix.
   */
  async add(images: { front?: string; back?: string; edge?: string }): Promise<CaptureRow> {
    const now = new Date().toISOString()
    const id = await this.db.tx(async (tx) => {
      // RETURNING id rather than lastInsertRowid, for the reason given on
      // Store.addBook: the id comes back from the statement that made it.
      const created = await tx.get<{ id: number }>(
        `INSERT INTO books
           (title, shelf_range, is_fiction, sort_key, state, scanned_at)
         VALUES ('', '', 0, '', ?, ?)
         RETURNING id`,
        [STATE_OF_QUEUE_STATUS.pending, now],
      )
      const id = Number(created!.id)
      /*
       * The photographs are the reason the row exists, and they are rows of
       * their own (#228). Dated from the shutter rather than from a save, which
       * is the whole of what `taken_at` carries: a photograph was taken when it
       * was taken.
       */
      for (const slot of PHOTO_SLOTS) {
        await photographTaken(tx, id, slot, images[slot] ?? '', now)
      }
      return id
    })
    return (await this.get(id))!
  }

  /**
   * Attach one photo to a capture, creating the capture on the first shot.
   *
   * Photos arrive one at a time as they are taken, and each one is queued for
   * reading the moment it exists. That is what removes the duplicated work:
   * previously the camera identified a photo synchronously for feedback and
   * the queue then identified the very same image all over again.
   *
   * **Re-taking a slot no longer overwrites anything.** The photograph used to
   * be a column, so a second shot of a slot destroyed the first, and the first
   * is the record: the photographs are half of what is irreplaceable about this
   * catalogue. It is a second row now, newer, and the one it improves on is
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
                  -- Re-taking a slot means it needs reading again.
                  analysed = REPLACE(REPLACE(',' || analysed || ',', ',' || @slot || ',', ','), ',,', ',')
            WHERE id = @id`,
          { id: captureId, slot },
        )
      })
      return (await this.get(captureId))!
    }

    const id = await this.db.tx(async (tx) => {
      const created = await tx.get<{ id: number }>(
        `INSERT INTO books
           (title, shelf_range, is_fiction, sort_key, state, scanned_at)
         VALUES ('', '', 0, '', ?, ?)
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
   * One row, whatever state it is in.
   *
   * `books` rather than `queued_books`, because this is a lookup by id and the
   * callers ask it about books that have left the queue on purpose: `edit`
   * refuses one that has been shelved by name rather than by not finding it, and
   * `POST /api/books` reads the photographs off the row it is about to place.
   */
  async get(id: number): Promise<CaptureRow | undefined> {
    return withPhotographsOf(this.db, await this.db.get<QueueProjection>(
      `SELECT ${QUEUE_ROW} FROM books WHERE id = ?`, [id],
    ))
  }

  /**
   * The state itself, for the one caller that cannot use `status`.
   *
   * `status` folds every state that is not queued into `done`, which is what the
   * client has always been told and is right for it. `derive` needs to tell a
   * book that was discarded mid-crop from one that was shelved mid-crop, and
   * those two are one word to a client and opposite answers to a sweep that is
   * about to delete files.
   */
  private async stateOf(id: number): Promise<string | undefined> {
    const row = await this.db.get<{ state: string }>(
      'SELECT "state" FROM books WHERE id = ?', [id],
    )
    return row?.state
  }

  /**
   * Everything waiting.
   *
   * This used to take the statuses it wanted, defaulting to the three that are
   * not `done`, and every caller in the repository took the default. The
   * argument is gone rather than kept for a caller that never arrived: the
   * relation is what says which rows are queued now, and a parameter that could
   * ask for `done` would be asking this method for the whole catalogue.
   */
  async list(): Promise<CaptureRow[]> {
    return queueRows(this.db, await this.db.all<QueueProjection>(
      `SELECT ${QUEUE_ROW} FROM queued_books ORDER BY id ASC`,
    ))
  }

  /**
   * The CAST is the same point Store.counts makes: an uncast COUNT is wider
   * than an int, and a driver that will not narrow it hands back a string. This
   * one reaches /api/health and the queue badge.
   *
   * `failures` breaks the `failed` total into the three things it can mean
   * (#148). Counted in TypeScript over the failed rows rather than in SQL,
   * because the rule is `failureOf` and there must not be a second copy of it
   * written in SQL for Home while the queue row uses the first. Only
   * unidentified rows are read, which is the short end of the queue.
   *
   * **`done` means something slightly wider than it did.** It counted captures
   * that had become books, and it counts books that have left the queue, which
   * is every catalogued book rather than only the ones that came through a
   * camera. Nothing reads it: the badge and Home both add up the other three,
   * which is what the queue is. Reporting the catalogue's own total under a
   * fourth name here would be a second copy of `Store.counts`, so the number
   * that is served is the one this relation can answer honestly.
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
   * both fill in the same book.
   *
   * The claim is a lease rather than a lock: someone who walks away with a
   * capture claimed must not block it forever. Done as a single conditional
   * UPDATE so two simultaneous claims cannot both succeed.
   */
  async claim(
    id: number,
    who: string,
  ): Promise<{ ok: boolean; row?: CaptureRow; heldBy?: string }> {
    const cutoff = new Date(Date.now() - CLAIM_LEASE_MS).toISOString()

    const result = await this.db.run(
      // `state IN (queued)` where this used to say `status != 'done'`, and it
      // covers one case more: a scan somebody discarded is not claimable
      // either. It could not be before because a discard deleted the row.
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
   * Record what a person worked out about a capture that is still in the
   * queue, so the next person to open it sees the work already done.
   *
   * This is what makes three people on one pile possible: one photographs, one
   * resolves details, one shelves. Without a durable write here the middle
   * person's work lives in their browser and reaches the database only when
   * the book is finally saved, so resolving and shelving collapse into one
   * sitting by one person.
   *
   * Editing goes through the existing claim rather than a second mechanism.
   * Passing through `claim` means an edit both requires the claim and renews
   * the lease, which is what a long resolving session needs: the person is
   * demonstrably still working, so their five minutes should not run out under
   * them. A claim that has gone stale falls to whoever is actually here, on
   * exactly the same terms as opening the capture in the first place.
   *
   * A stated ISBN re-runs the lookup, because that is the whole value of the
   * correction: the ISBN is the key every other field hangs off, so a corrected
   * one that did not refetch would leave a book carrying the right number and
   * the wrong title. Done here rather than left to the client so that the
   * correction and its consequences land in one write, and survive a browser
   * that is closed a second later.
   */
  async edit(id: number, who: string, patch: CaptureEdit): Promise<EditOutcome> {
    const before = await this.get(id)
    if (!before) return { ok: false, reason: 'missing' }
    // A book that has left the queue is not edited here. `PUT /api/books/:id`
    // is what edits a book somebody has filed, and it recomputes the sort key,
    // which this does not and must not.
    if (before.status === 'done') return { ok: false, reason: 'done' }

    const held = await this.claim(id, who)
    if (!held.ok) return { ok: false, reason: 'claimed', heldBy: held.heldBy ?? 'someone else' }

    // Merged, not replaced, so successive edits accumulate rather than each
    // one wiping the fields the last stated.
    const already = editsOn(before)
    let merged: CaptureEdit = { ...already, ...patch }
    let lookup: LookupResult | null = null

    const typed = patch.isbn13 ? resolveIsbnPair(patch.isbn13) : null
    if (typed && (typed.isbn13 || typed.isbn10) && typed.isbn13 !== before.isbn13) {
      lookup = await lookupIsbn(patch.isbn13!, this.lookupOptions)
      merged = {
        ...already,
        // The catalogue's answer beats what was on screen a moment ago,
        // because those fields describe the book the wrong ISBN named. Notes,
        // location and the filing override are the exceptions and are kept:
        // they are what the person, not the catalogue, is the authority on.
        ...(lookup.found ? fromLookup(lookup) : {}),
        notes: already.notes,
        location: already.location,
        authorFilingOverride: already.authorFilingOverride,
        // And anything stated in this same request beats the catalogue in
        // turn. Somebody correcting the ISBN and the title together means
        // both, not one of them silently discarded.
        ...patch,
        // Whatever the catalogue said, the digits the person typed are the
        // ones recorded, and they are recorded even when nothing has them. A
        // book left carrying an ISBN we know to be wrong helps nobody.
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

    return { ok: true, row: (await this.get(id))!, lookup }
  }

  async release(id: number, who: string): Promise<void> {
    await this.db.run(
      `UPDATE books SET claimed_by = '', claimed_at = NULL
        WHERE id = ? AND claimed_by = ?`,
      [id, who],
    )
  }

  /**
   * The scan was a mistake.
   *
   * **Nothing is deleted, and that is the change.** This used to be
   * `DELETE FROM captures`, so the record of having photographed the wrong
   * thing, of having photographed the same book twice, or of a shelf somebody
   * gave up halfway through went with the row. `discarded` is one of the seven
   * states in `docs/data-model.md` for that reason: the row stays, out of the
   * queue and out of every relation a shelf is drawn from, and it can still be
   * counted and looked at.
   *
   * Only a queued book can be discarded. A book on a shelf is removed by the
   * route that removes books, which is a different decision made by a different
   * person about a different thing.
   *
   * The photographs are still deleted from disk by the route that calls this,
   * which is what somebody discarding a scan is asking for. The filenames stay
   * on the row as the record of what was thrown away, and `Store.imageInUse`
   * knows not to treat a discarded book's filenames as a claim on a file.
   */
  async discard(id: number): Promise<void> {
    await this.db.run(
      `UPDATE books SET "state" = ?, claimed_by = '', claimed_at = NULL
        WHERE id = ? AND "state" IN (${QUEUED_SQL})`,
      [DISCARDED, id],
    )
  }

  /** Record what the crop detector made of one of this book's photographs. */
  async setCrop(id: number, slot: CropSlot, name: string): Promise<void> {
    await recordCrop(this.db, id, slot, name)
  }

  /** Store the front photograph's hash. Only ever a hash of that photograph. */
  async setFrontHash(id: number, hash: string): Promise<void> {
    await recordFrontHash(this.db, id, hash)
  }

  /**
   * Captures that are still waiting to be shelved and can be compared, so a
   * book held up to the camera can be recognised as one somebody has already
   * scanned (#122).
   *
   * Three filters, and each one is the difference between an answer and a
   * wrong answer:
   *
   *   `queued_books` because a book that has left the queue is not waiting for
   *   anybody. Telling somebody to go and finish a scan that is already on a
   *   shelf sends them to a dead end, and the books path answers for that book
   *   already. That used to be `status != 'done'` and is now the relation, which
   *   also takes out the discarded ones: a scan somebody threw away is the last
   *   thing to offer them when they pick the book up again.
   *
   *   `front_hash != ''` because an empty hash is not a weak match, it is the
   *   absence of one. `distance` already scores it 64, but leaving the row out
   *   says why rather than relying on a number.
   *
   *   `front_image != ''` because the panel this feeds shows the photograph
   *   somebody took, and a match nobody can look at is a match nobody can
   *   check.
   *
   * A failed capture is included on purpose. The read failed; the photographs
   * and the book behind them did not, and it is exactly the capture most
   * likely to still be sitting in the queue when somebody picks the book up
   * again.
   */
  async waiting(): Promise<CaptureRow[]> {
    /*
     * `current_photograph`, which is `Photographs.latest` said in SQL. Both
     * filters are about the photograph somebody would be shown and compared
     * against, which is the newest front one: a hash on a spine is not something
     * this compares and a superseded front is not what the panel draws.
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
   * Other captures still waiting that carry this exact ISBN (#146).
   *
   * The identifier, not a likeness. `waiting` above answers "what looks like
   * this photograph", which is a measurement with a band and an error rate;
   * this answers "what is the same book", which is a fact. An ISBN-13 carries
   * a check digit, so a barcode reading either validates or is discarded, and
   * two captures holding the same one are two captures of the same title.
   * Where both answers exist the caller takes this one.
   *
   * Deliberately not filtered on `front_hash` or `front_image` the way
   * `waiting` is. Those filters are there because a hash comparison needs
   * something to compare and a panel needs a photograph to show; neither is
   * true here. A capture whose back cover read and whose front has not been
   * taken yet is exactly the row somebody is about to duplicate, and leaving
   * it out would lose the case this exists for.
   *
   * `queued_books` is kept, for the reason it is kept there: a book that has
   * left the queue is not waiting for anybody, and the catalogue answers for it
   * already.
   *
   * `exceptId` is the capture being asked about, so a capture never reports
   * itself as its own duplicate. Pass null when asking on behalf of a
   * photograph that is not a capture at all, which is what the scan route
   * does.
   */
  async sharingIsbn(isbn13: string, exceptId: number | null = null): Promise<CaptureRow[]> {
    // An empty ISBN is the absence of an identifier, not an identifier every
    // unread capture happens to share. Without this guard a photograph nobody
    // could read would match every other photograph nobody could read.
    if (!isbn13) return []

    return queueRows(this.db, await this.db.all<QueueProjection>(
      `SELECT ${QUEUE_ROW} FROM queued_books
        WHERE isbn13 = @isbn13 AND id != @except
        ORDER BY id`,
      { isbn13, except: exceptId ?? -1 },
    ))
  }

  /**
   * Every capture that has a photograph, oldest first.
   *
   * Unfiltered within the queue, for the same reason `Store.photographed` is:
   * whether a slot still wants cropping depends on `cropped`, on whether the
   * caller is forcing a redo, and on whether the derived file is still on disk,
   * none of which belongs in SQL where a later change to the rule would have to
   * be made twice.
   *
   * **`queued_books`, so the two crop passes divide the table between them.**
   * This used to include captures that had become books, because they were rows
   * in a second table nothing else swept. They are rows in this one now, and
   * `Store.photographed` reads `catalogued_books`, so between the two every book
   * is offered to a detector exactly once instead of to both passes.
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
   * Cut this capture's photographs to the book and hash its front.
   *
   * Called from the drain loop, so it happens on the same background pass that
   * reads the photographs and nobody waits for it. Failure is silent on
   * purpose: these are derived and disposable, a capture with none is a
   * capture shown whole and unmatched, and nothing about the identification it
   * followed should be disturbed by a detector having a bad day.
   */
  private async derive(id: number): Promise<void> {
    const images = this.images
    if (!images) return
    try {
      const capture = await this.get(id)
      if (!capture) return

      const outcome = await deriveCapture(this, capture, images, { apply: true })

      // Discarded while this was cropping, so the crops it produced are already
      // orphans. See CaptureImages above for why the delete arrives here.
      //
      // The test used to be "the row has gone", because a discard deleted it.
      // A discard is a state now, so the row is still there and the question is
      // whether it was discarded, which the raw state answers and `status`
      // cannot: it reports `done` for a book that was shelved in the same second
      // and that book's crops are its own, not orphans. `setCrop` did write, to
      // a discarded book, which is harmless and is the record of what had been
      // cropped when somebody said the scan was a mistake.
      const written = outcome.crops.map((slot) => slot.crop).filter(Boolean)
      if (written.length && (await this.stateOf(id)) === DISCARDED) {
        await images.orphaned?.(written)
      }
    } catch {
      // Left uncropped and unhashed, which is a state every reader draws.
    }
  }

  // -----------------------------------------------------------------------
  // Worker
  // -----------------------------------------------------------------------

  private async nextPending(): Promise<CaptureRow | undefined> {
    return withPhotographsOf(this.db, await this.db.get<QueueProjection>(
      `SELECT ${QUEUE_ROW} FROM queued_books
        WHERE "state" = '${STATE_OF_QUEUE_STATUS.pending}'
        ORDER BY id ASC LIMIT 1`,
    ))
  }

  /**
   * Process every pending capture, one at a time. Safe to call on every
   * enqueue: a second call while draining returns immediately and the running
   * loop picks up whatever was added.
   *
   * **Only one pass may be in flight, and the guard below is the whole of it.**
   * Two overlapping passes would each take the same row off the top of the
   * pending queue and identify the same photographs twice, which with two
   * people scanning into one server is not a rare case. Every path into the
   * worker goes through here: `POST /api/captures` fires `void drain()` on
   * every shutter, and `resumeOnStartup` fires one more at boot.
   *
   * The guard survives this class becoming asynchronous, and that is worth
   * being explicit about rather than assuming. An async function body runs
   * synchronously until its first `await`, and there is no `await` between
   * reading `this.draining` and setting it, so a second caller entering while
   * the first is suspended still sees `true` and returns. Nothing between the
   * two lines can yield, so nothing can interleave there.
   *
   * What is new is that the loop yields between iterations: `nextPending` is
   * awaited now, where before it was a synchronous read. Nothing depends on it
   * not yielding. The loop already awaited `process`, which does OCR and
   * network lookups, so anything that could land mid-drain could land there
   * already, and each iteration re-reads the top of the queue rather than
   * working from a list taken at the start.
   */
  async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      for (;;) {
        const next = await this.nextPending()
        if (!next) break
        await this.process(next)
        // After the reading, not before it: identifying the book is what the
        // queue is for and what the next person is waiting on, and a crop is
        // worth a second of a background pass but not a second of that.
        // Idempotent, so a capture that comes back round for a newly arrived
        // photograph crops only the slot that is new.
        await this.derive(next.id)
      }
    } finally {
      this.draining = false
    }
  }

  private async process(capture: CaptureRow): Promise<void> {
    const analysed = new Set(capture.analysed.split(',').filter(Boolean))

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
        // The CAST is the same one made at Store.updateBook and at `edit`
        // above: `@statedTitle` is compared against a bare literal with no
        // column in reach, which is the shape that leaves a parameter with no
        // type for a database that wants one before it will plan. Identity on
        // SQLite. Stage D listed three of these; this is the fourth.
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
        const read = await identify(image, { wantTitle })

        if (wantTitle && read.coverLines.length) {
          coverLines = read.coverLines
          titleGuess = read.titleGuess
        }
        if (lookup?.found) continue

        // A barcode is self-validating. An OCR reading is not: a garbled digit
        // can still satisfy the check digit, so the catalogue decides which of
        // the readings is real, and an unconfirmed one is discarded rather
        // than stored as fact.
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

      // ---------------------------------------------------------------------
      // PRECEDENCE: a person beats this worker, always.
      //
      // This is the sharp edge of the whole queue-editing feature (#65) and it
      // is written down here because here is where the machine's reading gets
      // written. Somebody corrects an ISBN, a photograph arrives or the server
      // restarts, this pass re-reads the book and the correction disappears.
      // That is precisely the scenario the feature exists to support, so
      // losing it would make the feature worse than not having it.
      //
      // The rule:
      //
      //   1. The worker reads photographs. A person reads the book in their
      //      hands. Where they disagree the person wins and the worker's
      //      reading is discarded, not merged and not averaged.
      //   2. It is decided per field, not per capture. `edit_json` holds
      //      exactly the fields somebody stated, so a key being present is the
      //      whole test. An edit that only fixed the title must not stop the
      //      worker filling in an ISBN nobody has stated.
      //   3. The two never share a cell. `draft_json` is the worker's channel
      //      and no person writes it; `edit_json` is the person's and this
      //      worker never writes it. So a re-analysis cannot lose a correction
      //      even in principle, and a better photograph is still free to
      //      improve what the machine knows underneath.
      //
      // Read fresh rather than from `capture`: this pass has been away doing
      // OCR and lookups for seconds, which is ample time for somebody to have
      // typed something. The read is as late as it can be and nothing is
      // awaited between it resuming and the write below, so no other request
      // can run in between; the row this decides from is the row it writes.
      const stated = editsOn((await this.get(capture.id)) ?? capture)
      const statedIsbn = stated.isbn13 !== undefined
      const resolved = Boolean(lookup?.found) || Boolean(stated.title) || statedIsbn

      await this.db.run(
        // `AND state IN (queued)` is new, and it is the discard window. The
        // pass above spent seconds on OCR and lookups, which is ample time for
        // somebody to have swiped this scan away; without the guard this write
        // would take a discarded book back out of the bin and put it in the
        // queue as a reading nobody asked for. It could not happen before
        // because a discard deleted the row and the UPDATE matched nothing,
        // which is the same protection by accident.
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
          // No precedence rule to apply: this column is the worker's reading
          // of the cover and only ever that (#156). A title somebody stated is
          // not a better value for it, it is a different kind of value, and it
          // is already durable in `edit_json`, which is read over the top of
          // this row everywhere a capture is shown.
          titleGuess,
          coverText: coverLines.join(String.fromCharCode(10)),
          analysed: [...analysed].join(','),
          // The worker's own channel. Written whatever a person has said,
          // because it is not the thing shown to them: the capture is read as
          // this with the overlay on top, so a fresher lookup underneath is
          // an improvement rather than a conflict.
          draft: lookup ? JSON.stringify(lookup) : '',
          // "Could not confirm an ISBN, use Change ISBN" stops being true the
          // moment somebody has. Leaving it would send the next person to a
          // book that has already been dealt with.
          note: statedIsbn ? '' : notes.join(' '),
          now: new Date().toISOString(),
        },
      )

      // A photo taken while this pass was running set the row back to pending,
      // and the write above has just overwritten that. Without this the newly
      // arrived slot is never read: harmless when the book is already
      // identified, but it loses the front cover exactly when the back failed
      // and the cover is all there is.
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
      await this.db.run(
        // Guarded for the same reason the write above is: a pass that threw
        // must not resurrect a scan somebody discarded while it was running.
        `UPDATE books
            SET "state" = '${STATE_OF_QUEUE_STATUS.failed}',
                analysed = ?, scan_note = ?, processed_at = ?
          WHERE id = ? AND "state" IN (${QUEUED_SQL})`,
        [
          [...analysed].join(','),
          // The prefix is the only record that this pass threw rather than
          // finished, which is what tells a broken read apart from a book no
          // catalogue has. See `failureOf`.
          `${PROCESSING_ERROR_NOTE} ${(error as Error).message}`,
          new Date().toISOString(),
          capture.id,
        ],
      )
    }
  }

  /**
   * Anything left 'pending' when the server stopped will never be picked up
   * otherwise, since the worker only runs in memory.
   */
  resumeOnStartup(): Promise<void> {
    // Deliberately not awaited and deliberately not async: the server must
    // finish starting whatever the queue is doing. `drain` guards itself
    // against a second pass, so this cannot overlap a drain a shutter starts.
    //
    // Returned rather than voided (#203). Handing the promise back does not
    // make the caller wait for it, and it is what lets the caller own how it
    // fails: `void` here meant a database that hiccupped during the resume
    // ended the process, the same defect as the chain after a save.
    return this.drain()
  }
}

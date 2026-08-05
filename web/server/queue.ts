/**
 * The capture queue.
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
 */

import type { Db } from './driver'
import { identify } from './identify'
import { lookupIsbn, type LookupOptions, type LookupResult } from './lookup'
import { deriveCapture, type DerivableCapture } from './capturecrop'
import type { CropIo, CropSlot } from './crop'
import { resolveIsbnPair } from '../shared/isbn'
import {
  countFailures, PROCESSING_ERROR_NOTE, type FailureCounts,
} from '../shared/captureFailure'

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

export interface CaptureRow {
  id: number
  status: CaptureStatus
  front_image: string
  back_image: string
  edge_image: string
  isbn13: string
  isbn10: string
  isbn_source: string
  title_guess: string
  cover_text: string
  analysed: string
  draft_json: string
  /** What a person stated, as JSON. Never written by the worker. */
  edit_json: string
  edited_by: string
  edited_at: string | null
  note: string
  claimed_by: string
  claimed_at: string | null
  book_id: number | null
  created_at: string
  processed_at: string | null
  /**
   * The three photos cut to the book, as filenames beside the originals.
   * Empty where the detector was never run or could not find the book.
   */
  front_crop: string
  back_crop: string
  edge_crop: string
  /** Slots the detector has looked at, comma separated. See db.ts. */
  cropped: string
  /**
   * Hash of the front photograph, in the format imagehash.ts writes. Empty
   * where it has not been hashed, or where the frame carried no detail to
   * hash: a refusal is left as one rather than stored as a hash.
   */
  front_hash: string
}

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

  async add(images: { front?: string; back?: string; edge?: string }): Promise<CaptureRow> {
    // RETURNING id rather than lastInsertRowid, for the reason given on
    // Store.addBook: the id comes back from the statement that made it.
    const created = await this.db.get<{ id: number }>(
      `INSERT INTO captures (status, front_image, back_image, edge_image, created_at)
       VALUES ('pending', ?, ?, ?, ?)
       RETURNING id`,
      [images.front ?? '', images.back ?? '', images.edge ?? '',
       new Date().toISOString()],
    )

    return (await this.get(Number(created!.id)))!
  }

  /**
   * Attach one photo to a capture, creating the capture on the first shot.
   *
   * Photos arrive one at a time as they are taken, and each one is queued for
   * reading the moment it exists. That is what removes the duplicated work:
   * previously the camera identified a photo synchronously for feedback and
   * the queue then identified the very same image all over again.
   */
  async attach(captureId: number | null, slot: Slot, filename: string): Promise<CaptureRow> {
    const column = `${slot}_image`
    const now = new Date().toISOString()

    if (captureId && (await this.get(captureId))) {
      await this.db.run(
        `UPDATE captures
            SET ${column} = @filename,
                status = CASE WHEN status = 'done' THEN status ELSE 'pending' END,
                -- Re-taking a slot means it needs reading again.
                analysed = REPLACE(REPLACE(',' || analysed || ',', ',' || @slot || ',', ','), ',,', ',')
          WHERE id = @id`,
        { id: captureId, filename, slot },
      )
      return (await this.get(captureId))!
    }

    const created = await this.db.get<{ id: number }>(
      `INSERT INTO captures (status, ${column}, created_at)
       VALUES ('pending', ?, ?)
       RETURNING id`,
      [filename, now],
    )
    return (await this.get(Number(created!.id)))!
  }

  async get(id: number): Promise<CaptureRow | undefined> {
    return this.db.get<CaptureRow>('SELECT * FROM captures WHERE id = ?', [id])
  }

  /**
   * The one statement here whose shape is not known until it is called: the
   * `IN` list is as long as the caller asked for. The driver walks placeholders
   * in the order it meets them, so a varying count needs nothing said about it.
   */
  async list(
    statuses: CaptureStatus[] = ['pending', 'ready', 'failed'],
  ): Promise<CaptureRow[]> {
    const placeholders = statuses.map(() => '?').join(', ')
    return this.db.all<CaptureRow>(
      `SELECT * FROM captures WHERE status IN (${placeholders}) ORDER BY id ASC`,
      statuses,
    )
  }

  /**
   * The CAST is the same point Store.counts makes: an uncast COUNT is wider
   * than an int, and a driver that will not narrow it hands back a string. This
   * one reaches /api/health and the queue badge.
   *
   * `failures` breaks the `failed` total into the three things it can mean
   * (#148). Counted in TypeScript over the failed rows rather than in SQL,
   * because the rule is `failureOf` and there must not be a second copy of it
   * written in SQL for Home while the queue row uses the first. Only failed
   * rows are read, which is the short end of the table: `done` never joins it.
   */
  async counts(): Promise<QueueCounts> {
    const rows = await this.db.all<{ status: CaptureStatus; n: number }>(
      `SELECT status, CAST(COUNT(*) AS INTEGER) AS n
         FROM captures GROUP BY status`,
    )

    const counts: QueueCounts = {
      pending: 0,
      ready: 0,
      failed: 0,
      done: 0,
      failures: countFailures(
        await this.db.all<{ isbn13: string; note: string }>(
          "SELECT isbn13, note FROM captures WHERE status = 'failed'",
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
      `UPDATE captures
          SET claimed_by = @who, claimed_at = @now
        WHERE id = @id
          AND status != 'done'
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
    // A shelved capture is history. Its book is the thing to edit now.
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
      `UPDATE captures SET
         edit_json = @edit, edited_by = @who, edited_at = @now,
         -- Mirrored onto the row's own columns as well as into the overlay:
         -- the queue listing and the worker both read these directly, and a
         -- correction nobody can see in the list is half a correction.
         isbn13 = COALESCE(@isbn13, isbn13),
         isbn10 = COALESCE(@isbn10, isbn10),
         isbn_source = COALESCE(@isbnSource, isbn_source),
         title_guess = COALESCE(@title, title_guess),
         -- A person who has stated a title or an ISBN has resolved this
         -- book, whatever the photographs did or did not read. 'pending'
         -- is left alone: the worker is mid-pass and settles it itself,
         -- with this overlay applied.
         --
         -- The CAST is the point made at Store.updateBook: this parameter is
         -- compared against a bare literal, with no column to take a type
         -- from, so a database that types parameters before it plans refuses
         -- the statement rather than guessing. Identity on SQLite.
         status = CASE
           WHEN status IN ('ready', 'failed') AND CAST(@resolved AS INTEGER) = 1
             THEN 'ready'
           ELSE status
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
        title: merged.title ?? null,
        resolved: (merged.title ?? '') || (merged.isbn13 ?? '') ? 1 : 0,
      },
    )

    return { ok: true, row: (await this.get(id))!, lookup }
  }

  async release(id: number, who: string): Promise<void> {
    await this.db.run(
      `UPDATE captures SET claimed_by = '', claimed_at = NULL
        WHERE id = ? AND claimed_by = ?`,
      [id, who],
    )
  }

  async markDone(id: number, bookId: number): Promise<void> {
    await this.db.run(
      "UPDATE captures SET status = 'done', book_id = ? WHERE id = ?",
      [bookId, id],
    )
  }

  async remove(id: number): Promise<void> {
    await this.db.run('DELETE FROM captures WHERE id = ?', [id])
  }

  /**
   * Record what the crop detector made of one of a capture's photos.
   *
   * `name` is the derived file, or '' when the book could not be found in the
   * frame. Either way the slot joins `cropped`, because "looked at and found
   * nothing" and "never looked at" are different states and only the first is
   * worth telling a reader about.
   *
   * The photo's own column is not touched here, and no statement in this class
   * ever writes a crop filename into one. The original is the record.
   */
  async setCrop(id: number, slot: CropSlot, name: string): Promise<void> {
    const row = await this.db.get<{ cropped: string | null }>(
      'SELECT cropped FROM captures WHERE id = ?',
      [id],
    )
    if (!row) return

    const done = new Set((row.cropped ?? '').split(',').filter(Boolean))
    done.add(slot)

    await this.db.run(
      `UPDATE captures SET ${slot}_crop = ?, cropped = ? WHERE id = ?`,
      [name, [...done].join(','), id],
    )
  }

  /** Store the front photograph's hash. Only ever a hash of that photograph. */
  async setFrontHash(id: number, hash: string): Promise<void> {
    await this.db.run('UPDATE captures SET front_hash = ? WHERE id = ?', [hash, id])
  }

  /**
   * Captures that are still waiting to be shelved and can be compared, so a
   * book held up to the camera can be recognised as one somebody has already
   * scanned (#122).
   *
   * Three filters, and each one is the difference between an answer and a
   * wrong answer:
   *
   *   `status != 'done'` because a capture that became a book is not waiting
   *   for anybody. Telling somebody to go and finish a capture that is already
   *   on a shelf sends them to a dead end, and the books path answers for that
   *   book already.
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
    return this.db.all<CaptureRow>(
      `SELECT * FROM captures
        WHERE status != 'done' AND front_hash != '' AND front_image != ''
        ORDER BY id`,
    )
  }

  /**
   * Every capture that has a photograph, oldest first.
   *
   * Deliberately unfiltered, for the same reason `Store.photographed` is:
   * whether a slot still wants cropping depends on `cropped`, on whether the
   * caller is forcing a redo, and on whether the derived file is still on
   * disk, none of which belongs in SQL where a later change to the rule would
   * have to be made twice. Captures that became books are included: they are
   * still in the queue's table, still name photographs, and a queue view that
   * looks back over them wants the same crops.
   */
  async photographed(): Promise<DerivableCapture[]> {
    return this.db.all<DerivableCapture>(
      `SELECT id, front_image, back_image, edge_image,
              front_crop, back_crop, edge_crop, cropped, front_hash
         FROM captures
        WHERE front_image != '' OR back_image != '' OR edge_image != ''
        ORDER BY id`,
    )
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

      // Discarded while this was cropping. `setCrop` wrote nothing, because
      // there is no row to write to, so the files it produced are already
      // orphans. See CaptureImages above for why the delete arrives here.
      const written = outcome.crops.map((slot) => slot.crop).filter(Boolean)
      if (written.length && !(await this.get(id))) {
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
    return this.db.get<CaptureRow>(
      "SELECT * FROM captures WHERE status = 'pending' ORDER BY id ASC LIMIT 1",
    )
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
          `UPDATE captures
              SET status = CASE
                WHEN isbn13 != '' OR CAST(@statedTitle AS TEXT) != '' THEN 'ready'
                ELSE 'failed'
              END
            WHERE id = @id AND status = 'pending'`,
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
        `UPDATE captures SET
           status = @status, isbn13 = @isbn13, isbn10 = @isbn10,
           isbn_source = @source, title_guess = @titleGuess,
           cover_text = @coverText, analysed = @analysed,
           draft_json = @draft, note = @note, processed_at = @now
         WHERE id = @id`,
        {
          id: capture.id,
          status: resolved ? 'ready' : 'failed',
          isbn13: statedIsbn ? stated.isbn13! : isbn13,
          isbn10: statedIsbn ? (stated.isbn10 ?? '') : (lookup?.isbn10 ?? ''),
          source: statedIsbn ? (stated.isbnSource ?? MANUAL_ISBN_SOURCE) : isbnSource,
          titleGuess: stated.title ?? titleGuess,
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
            "UPDATE captures SET status = 'pending' WHERE id = ?",
            [capture.id],
          )
        }
      }
    } catch (error) {
      await this.db.run(
        `UPDATE captures SET status = 'failed', analysed = ?, note = ?, processed_at = ?
          WHERE id = ?`,
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
  resumeOnStartup(): void {
    // Deliberately not awaited and deliberately not async: the server must
    // finish starting whatever the queue is doing. `drain` guards itself
    // against a second pass, so this cannot overlap a drain a shutter starts.
    void this.drain()
  }
}

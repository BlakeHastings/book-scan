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

import type { Database } from 'better-sqlite3'
import { identify } from './identify'
import { lookupIsbn, type LookupOptions } from './lookup'

export type Slot = 'front' | 'back' | 'edge'

/** Read in this order: the back carries the identifier. */
const SLOT_ORDER: Slot[] = ['back', 'front', 'edge']

export type CaptureStatus = 'pending' | 'ready' | 'failed' | 'done'

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
  note: string
  claimed_by: string
  claimed_at: string | null
  book_id: number | null
  created_at: string
  processed_at: string | null
}

/** How long a claim holds before someone else may take the capture. */
const CLAIM_LEASE_MS = 5 * 60 * 1000

export class CaptureQueue {
  private draining = false

  constructor(
    private readonly db: Database,
    private readonly readImage: (name: string) => Buffer | null,
    private readonly lookupOptions: LookupOptions = {},
  ) {}

  // -----------------------------------------------------------------------
  // Writes
  // -----------------------------------------------------------------------

  add(images: { front?: string; back?: string; edge?: string }): CaptureRow {
    const result = this.db
      .prepare(
        `INSERT INTO captures (status, front_image, back_image, edge_image, created_at)
         VALUES ('pending', ?, ?, ?, ?)`,
      )
      .run(images.front ?? '', images.back ?? '', images.edge ?? '', new Date().toISOString())

    return this.get(Number(result.lastInsertRowid))!
  }

  /**
   * Attach one photo to a capture, creating the capture on the first shot.
   *
   * Photos arrive one at a time as they are taken, and each one is queued for
   * reading the moment it exists. That is what removes the duplicated work:
   * previously the camera identified a photo synchronously for feedback and
   * the queue then identified the very same image all over again.
   */
  attach(captureId: number | null, slot: Slot, filename: string): CaptureRow {
    const column = `${slot}_image`
    const now = new Date().toISOString()

    if (captureId && this.get(captureId)) {
      this.db
        .prepare(
          `UPDATE captures
              SET ${column} = @filename,
                  status = CASE WHEN status = 'done' THEN status ELSE 'pending' END,
                  -- Re-taking a slot means it needs reading again.
                  analysed = REPLACE(REPLACE(',' || analysed || ',', ',' || @slot || ',', ','), ',,', ',')
            WHERE id = @id`,
        )
        .run({ id: captureId, filename, slot })
      return this.get(captureId)!
    }

    const created = this.db
      .prepare(
        `INSERT INTO captures (status, ${column}, created_at)
         VALUES ('pending', ?, ?)`,
      )
      .run(filename, now)
    return this.get(Number(created.lastInsertRowid))!
  }

  get(id: number): CaptureRow | undefined {
    return this.db.prepare('SELECT * FROM captures WHERE id = ?').get(id) as
      CaptureRow | undefined
  }

  list(statuses: CaptureStatus[] = ['pending', 'ready', 'failed']): CaptureRow[] {
    const placeholders = statuses.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT * FROM captures WHERE status IN (${placeholders}) ORDER BY id ASC`)
      .all(...statuses) as CaptureRow[]
  }

  counts(): Record<CaptureStatus, number> {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS n FROM captures GROUP BY status')
      .all() as { status: CaptureStatus; n: number }[]

    const counts: Record<CaptureStatus, number> = {
      pending: 0, ready: 0, failed: 0, done: 0,
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
  claim(id: number, who: string): { ok: boolean; row?: CaptureRow; heldBy?: string } {
    const cutoff = new Date(Date.now() - CLAIM_LEASE_MS).toISOString()

    const result = this.db
      .prepare(
        `UPDATE captures
            SET claimed_by = @who, claimed_at = @now
          WHERE id = @id
            AND status != 'done'
            AND (claimed_by = '' OR claimed_by = @who OR claimed_at IS NULL
                 OR claimed_at < @cutoff)`,
      )
      .run({ id, who, now: new Date().toISOString(), cutoff })

    if (result.changes === 0) {
      const row = this.get(id)
      return { ok: false, heldBy: row?.claimed_by || 'someone else' }
    }
    return { ok: true, row: this.get(id) }
  }

  release(id: number, who: string): void {
    this.db
      .prepare(
        `UPDATE captures SET claimed_by = '', claimed_at = NULL
          WHERE id = ? AND claimed_by = ?`,
      )
      .run(id, who)
  }

  markDone(id: number, bookId: number): void {
    this.db
      .prepare("UPDATE captures SET status = 'done', book_id = ? WHERE id = ?")
      .run(bookId, id)
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM captures WHERE id = ?').run(id)
  }

  // -----------------------------------------------------------------------
  // Worker
  // -----------------------------------------------------------------------

  private nextPending(): CaptureRow | undefined {
    return this.db
      .prepare("SELECT * FROM captures WHERE status = 'pending' ORDER BY id ASC LIMIT 1")
      .get() as CaptureRow | undefined
  }

  /**
   * Process every pending capture, one at a time. Safe to call on every
   * enqueue: a second call while draining returns immediately and the running
   * loop picks up whatever was added.
   */
  async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      for (;;) {
        const next = this.nextPending()
        if (!next) break
        await this.process(next)
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
        // Nothing new. Settle the status so it stops looking pending.
        this.db
          .prepare("UPDATE captures SET status = CASE WHEN isbn13 != '' THEN 'ready' ELSE 'failed' END WHERE id = ? AND status = 'pending'")
          .run(capture.id)
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

      this.db
        .prepare(
          `UPDATE captures SET
             status = @status, isbn13 = @isbn13, isbn10 = @isbn10,
             isbn_source = @source, title_guess = @titleGuess,
             cover_text = @coverText, analysed = @analysed,
             draft_json = @draft, note = @note, processed_at = @now
           WHERE id = @id`,
        )
        .run({
          id: capture.id,
          status: lookup?.found ? 'ready' : 'failed',
          isbn13,
          isbn10: lookup?.isbn10 ?? '',
          source: isbnSource,
          titleGuess,
          coverText: coverLines.join(String.fromCharCode(10)),
          analysed: [...analysed].join(','),
          draft: lookup ? JSON.stringify(lookup) : '',
          note: notes.join(' '),
          now: new Date().toISOString(),
        })

      // A photo taken while this pass was running set the row back to pending,
      // and the write above has just overwritten that. Without this the newly
      // arrived slot is never read: harmless when the book is already
      // identified, but it loses the front cover exactly when the back failed
      // and the cover is all there is.
      const fresh = this.get(capture.id)
      if (fresh && fresh.status !== 'done') {
        const read = new Set(fresh.analysed.split(',').filter(Boolean))
        const outstanding = SLOT_ORDER.some((slot) => {
          const filename = fresh[`${slot}_image` as const] as string
          return filename && !read.has(slot)
        })
        if (outstanding) {
          this.db
            .prepare("UPDATE captures SET status = 'pending' WHERE id = ?")
            .run(capture.id)
        }
      }
    } catch (error) {
      this.db
        .prepare(
          `UPDATE captures SET status = 'failed', analysed = ?, note = ?, processed_at = ?
            WHERE id = ?`,
        )
        .run(
          [...analysed].join(','),
          `Could not process these photos: ${(error as Error).message}`,
          new Date().toISOString(),
          capture.id,
        )
    }
  }

  /**
   * Anything left 'pending' when the server stopped will never be picked up
   * otherwise, since the worker only runs in memory.
   */
  resumeOnStartup(): void {
    void this.drain()
  }
}

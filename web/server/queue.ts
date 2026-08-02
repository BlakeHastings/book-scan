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
    try {
      // The back cover carries the barcode, so it is read first. The front is
      // only opened if the back gave us nothing, and only then for a title.
      const back = this.readImage(capture.back_image)
      let result = back
        ? await identify(back, { wantTitle: false })
        : null

      // Let the catalogue settle which OCR reading is real.
      //
      // A garbled digit inside a labelled ISBN can still satisfy the check
      // digit, so a reading that validates is not necessarily the book. Trying
      // each candidate and keeping the one that actually exists costs a couple
      // of lookups and removes a whole class of confident wrong answer. A
      // barcode reading needs none of this: it is self-validating.
      const candidates = result?.source === 'barcode'
        ? [result.isbn13]
        : (result?.isbnCandidates ?? [])

      let isbn13 = result?.isbn13 ?? ''
      let coverLines: string[] = result?.coverLines ?? []
      let lookup = null as Awaited<ReturnType<typeof lookupIsbn>> | null

      for (const candidate of candidates.filter(Boolean)) {
        const found = await lookupIsbn(candidate, this.lookupOptions)
        if (found.found) {
          isbn13 = candidate
          lookup = found
          break
        }
        lookup ??= found
      }

      const notes: string[] = [...(result?.notes ?? [])]

      // An OCR reading that no catalogue recognises is not evidence of
      // anything. A garbled digit can still satisfy the check digit, so
      // storing it would attach a confident wrong ISBN to the book and, worse,
      // look identified. Report what was read and leave the field empty for
      // Change ISBN to fill. A barcode reading is kept regardless: it is
      // self-validating and a catalogue simply may not carry the book.
      if (result?.source === 'ocr' && !lookup?.found) {
        notes.push(
          candidates.length
            ? `Could not confirm an ISBN. OCR read ${candidates.join(' or ')}, ` +
              'but no catalogue has either. Use Change ISBN with the number ' +
              'printed on the book.'
            : 'No ISBN could be read from these photos.',
        )
        isbn13 = ''
        lookup = null
      }

      // Nothing confirmed, so read the front cover for whatever text it can
      // offer. Done here rather than earlier because an unconfirmed reading
      // off the back is no reason to skip it, which is what the old order did.
      if (!lookup?.found) {
        const front = this.readImage(capture.front_image)
        if (front) {
          const fromFront = await identify(front, { wantTitle: true })
          coverLines = fromFront.coverLines

          for (const candidate of fromFront.isbnCandidates) {
            const found = await lookupIsbn(candidate, this.lookupOptions)
            if (found.found) {
              isbn13 = candidate
              lookup = found
              notes.push('ISBN found on the front cover.')
              break
            }
          }
        }
      }

      if (candidates.length > 1 && lookup?.found) {
        notes.push(`Read ${candidates.length} possible ISBNs; used the one the catalogue has.`)
      }
      if (isbn13 && !lookup?.found) {
        notes.push('ISBN read, but no catalogue has it. Fill the details in by hand.')
      }
      if (!isbn13) {
        const lines = coverLines
        notes.push(
          lines.length
            ? `No ISBN found. Read from the cover: ${lines.join(' / ')}.`
            : 'No ISBN found in these photos, and the cover was not readable.',
        )
      }

      this.db
        .prepare(
          `UPDATE captures SET
             status = @status, isbn13 = @isbn13, isbn10 = @isbn10,
             isbn_source = @source, title_guess = @titleGuess,
             cover_text = @coverText,
             draft_json = @draft, note = @note, processed_at = @now
           WHERE id = @id`,
        )
        .run({
          id: capture.id,
          status: lookup?.found ? 'ready' : 'failed',
          isbn13,
          isbn10: result?.isbn10 ?? '',
          source: result?.source ?? '',
          titleGuess: result?.titleGuess ?? '',
          coverText: coverLines.join('\n'),
          draft: lookup ? JSON.stringify(lookup) : '',
          note: notes.join(' '),
          now: new Date().toISOString(),
        })
    } catch (error) {
      this.db
        .prepare(
          `UPDATE captures SET status = 'failed', note = ?, processed_at = ?
            WHERE id = ?`,
        )
        .run(
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

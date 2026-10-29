/**
 * What reading the scanning queue needs: the books in it and how many there
 * are of each kind. A read model in the sense the queries rule means, which is
 * why it lives here rather than in `ports.ts`. The one implementation is
 * `CaptureQueue` in `server/queue.ts`.
 */

import type { FailureCounts } from '../../shared/captureFailure'

/**
 * Where a book is, in the queue's four names rather than the seven states
 * underneath (`domain/books/state.ts` holds the pairing). `done` means it has
 * left the queue, whether it was shelved or discarded.
 */
export type CaptureStatus = 'pending' | 'ready' | 'failed' | 'done'

/**
 * `ready` is what the first screen calls "ready to shelve" and `failed` is
 * "stuck". `done` counts every catalogued book, and nothing reads it.
 */
export interface QueueCounts extends Record<CaptureStatus, number> {
  failures: FailureCounts
}

/**
 * A book in the queue, in the shape the queue has always handed one out. There
 * is no row of this shape in the database: it is `books`, projected by
 * `QUEUE_ROW` in `server/queue.ts`.
 */
export interface QueueProjection {
  /** The book's own id. There is no second identity for a queued book. */
  id: number
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
  /** The worker's catalogue lookup, as JSON, or empty when nothing was found. */
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
 * A queued book with the newest photograph of each kind on it, which is what
 * `GET /api/captures` answers. The photograph fields are `PhotographFields` in
 * `server/photographs.ts`, spelled out here because the application layer may
 * not import the server; `server/queue.ts` checks the two agree.
 */
export interface QueuedBookView extends QueueProjection {
  front_image: string
  back_image: string
  edge_image: string
  cover_image: string
  front_crop: string
  back_crop: string
  edge_crop: string
  cropped: string
  front_hash: string
  cover_hash: string
}

export interface QueueReadModel {
  /** Every book in the queue, oldest scan first. Deliberately not paged: see AGENTS.md. */
  list(): Promise<QueuedBookView[]>
  counts(): Promise<QueueCounts>
}

/**
 * An image model: photograph bytes in, a unit-length vector out. Here rather
 * than in `ports.ts` because a query asks it, and a query may import nothing
 * but read models.
 */
export interface CoverEncoder {
  /** What `cover_embedding.model` records, naming the weights and the preparation. */
  readonly model: string
  readonly dimensions: number
  /** False until the weights are loaded, and for the life of the process when they could not be. */
  ready(): boolean
  embed(image: Uint8Array): Promise<number[]>
}

/** A catalogued book, by whichever of its photographs is most like the one asked about. */
export interface NearCover {
  bookId: number
  title: string
  authors: string
  /** Cosine similarity: 1 is the same direction. */
  similarity: number
  /** Which of the book's photographs it was. */
  kind: 'front' | 'catalogue'
}

export interface CoverSimilarityReadModel {
  /** Catalogued books, most alike first, one entry per book. */
  nearest(model: string, dimensions: number, vector: readonly number[], limit: number): Promise<NearCover[]>
}

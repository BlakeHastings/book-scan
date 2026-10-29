/**
 * The photographs that identify a book, embedded by the image model, so the
 * book can be found from a photograph of its cover.
 *
 * Run after a save, in the background, and as a backfill at start. Never on a
 * request: one embedding is about a quarter of a second of CPU.
 *
 * A photograph that cannot be read or embedded is reported and passed over
 * with no row written, so the next start's backfill tries it again.
 */

import type { CoverEmbeddingRepository, PhotographBytes, UnembeddedPhotograph } from './ports'
import type { CoverEncoder } from './read-models'

export interface EmbedPhotographs {
  /** One book's photographs, or, absent, every catalogued book's. */
  bookId?: number
  now: () => string
}

export interface Embedded {
  embedded: number
  failed: { photograph: UnembeddedPhotograph; reason: string }[]
  /** The model was not loaded, so nothing was looked at. */
  skipped: boolean
}

/** A backfill holds this many file names at a time rather than the catalogue's. */
const BATCH = 25

export class EmbedPhotographsHandler {
  constructor(
    private readonly encoder: CoverEncoder,
    private readonly embeddings: CoverEmbeddingRepository,
    private readonly bytes: PhotographBytes,
  ) {}

  async handle(command: EmbedPhotographs): Promise<Embedded> {
    const done: Embedded = { embedded: 0, failed: [], skipped: false }
    if (!this.encoder.ready()) return { ...done, skipped: true }

    let after: number | undefined
    for (;;) {
      const todo = await this.embeddings.unembedded(this.encoder.model, {
        bookId: command.bookId, after, limit: BATCH,
      })
      if (!todo.length) return done

      for (const photograph of todo) {
        after = photograph.captureId
        try {
          const vector = await this.encoder.embed(await this.bytes.read(photograph.file))
          await this.embeddings.record(photograph.captureId, this.encoder.model, vector, command.now())
          done.embedded += 1
        } catch (reason) {
          done.failed.push({ photograph, reason: reason instanceof Error ? reason.message : String(reason) })
        }
      }
    }
  }
}

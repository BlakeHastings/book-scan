import type { CoverEncoder, CoverSimilarityReadModel, NearCover } from '../read-models'

export interface NearestCovers {
  photo: Uint8Array
  /** How many books. Absent is four, the scanner's shortlist. */
  limit?: number
}

/** `available: false` is the model not loaded, which is a state rather than a failure: nothing was compared. */
export type NearestCoversAnswer =
  | { available: false }
  | { available: true; model: string; books: NearCover[] }

/**
 * The catalogued books whose photographs look most like this one, by the
 * cosine of their embeddings, compared in Postgres. The photograph is embedded
 * here, which is about a quarter of a second of CPU; a save never waits for
 * that, and whoever asks this is asking for exactly that.
 */
export class NearestCoversHandler {
  constructor(
    private readonly encoder: CoverEncoder,
    private readonly covers: CoverSimilarityReadModel,
  ) {}

  async handle(query: NearestCovers): Promise<NearestCoversAnswer> {
    if (!this.encoder.ready()) return { available: false }
    const vector = await this.encoder.embed(query.photo)
    const limit = Math.max(1, Math.min(50, query.limit ?? 4))
    const books = await this.covers.nearest(this.encoder.model, this.encoder.dimensions, vector, limit)
    return { available: true, model: this.encoder.model, books }
  }
}

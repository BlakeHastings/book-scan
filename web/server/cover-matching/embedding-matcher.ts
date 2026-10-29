/**
 * Recognising a cover by an image embedding: one vector per image from a
 * pretrained vision encoder, compared by cosine similarity against every
 * catalogued cover in memory.
 *
 * The harness's row for an encoder. The catalogue here is a list in memory;
 * the app keeps the same vectors in pgvector (`infrastructure/capture/
 * cover-embeddings.ts`). Both embed through `openEncoder`, so the floor this
 * row is held to measures the preparation the app saves and searches with.
 */

import { openEncoder } from './encode'
import type { Candidate, CoverMatcher } from './matcher'
import { type Encoder, ensureModel } from './models'

export interface Bar {
  /** Cosine similarity the best candidate has to reach. */
  floor: number
  /** How far ahead of the second it has to be. */
  margin: number
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!
  return sum
}

export function embeddingMatcher(encoder: Encoder, bar: Bar): CoverMatcher {
  return {
    name: `embedding (${encoder.name})`,
    bar: `best cosine >= ${bar.floor} and >= ${bar.margin} ahead of the second`,

    async prepare(catalogue) {
      const embed = await openEncoder(encoder, await ensureModel(encoder))

      const index: { id: string, vector: Float32Array }[] = []
      for (const book of catalogue) index.push({ id: book.id, vector: await embed(book.cover) })

      return async (photo) => {
        const query = await embed(photo)
        const ranked: Candidate[] = index
          .map((entry) => ({ id: entry.id, score: dot(query, entry.vector) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 4)

        const [first, second] = ranked
        const clear = first !== undefined
          && first.score >= bar.floor
          && first.score - (second?.score ?? -1) >= bar.margin
        return { candidates: ranked, confident: clear ? first.id : null }
      }
    },
  }
}

/**
 * `cover_embedding`, written and searched.
 *
 * Written out as SQL rather than built by Drizzle, because what matters most
 * here is a spelling Drizzle has no word for: the search has to say
 * `embedding::vector(N) <=> …::vector(N)` and `dimensions = N` exactly as the
 * partial HNSW index for size N is defined (`schema.ts`), or the planner cannot
 * use it and every search becomes a scan.
 */

import type {
  CoverEmbeddingRepository, UnembeddedPhotograph,
} from '../../application/capture/ports'
import type { CoverSimilarityReadModel, NearCover } from '../../application/capture/read-models'
import type { Db } from '../../server/driver'
import { COVER_EMBEDDING_INDEXED_DIMENSIONS } from '../db/schema'

/** pgvector's text form, which it reads for a `vector` parameter. */
function asVector(values: readonly number[]): string {
  return `[${values.join(',')}]`
}

export class PgvectorCoverEmbeddings implements CoverEmbeddingRepository {
  constructor(private readonly db: Db) {}

  async unembedded(
    model: string,
    which: { bookId?: number; after?: number; limit: number },
  ): Promise<UnembeddedPhotograph[]> {
    const rows = await this.db.all<{ capture_id: number; book_id: number; file: string }>(
      `SELECT c.id AS capture_id, c.book_id, c.file
         FROM capture c
         JOIN catalogued_books b ON b.id = c.book_id
        WHERE c.kind IN ('front', 'catalogue')
          AND c.id > :after
          ${which.bookId === undefined ? '' : 'AND c.book_id = :bookId'}
          AND NOT EXISTS (
                SELECT 1 FROM cover_embedding e WHERE e.capture_id = c.id AND e.model = :model)
        ORDER BY c.id
        LIMIT :limit`,
      {
        model,
        after: which.after ?? 0,
        limit: which.limit,
        ...(which.bookId === undefined ? {} : { bookId: which.bookId }),
      },
    )
    return rows.map((row) => ({ captureId: row.capture_id, bookId: row.book_id, file: row.file }))
  }

  async record(captureId: number, model: string, vector: readonly number[], at: string): Promise<void> {
    await this.db.run(
      `INSERT INTO cover_embedding (capture_id, model, dimensions, embedding, computed_at)
       VALUES (:captureId, :model, :dimensions, CAST(:vector AS vector), :at)
       ON CONFLICT (capture_id, model) DO UPDATE
          SET dimensions = EXCLUDED.dimensions,
              embedding = EXCLUDED.embedding,
              computed_at = EXCLUDED.computed_at`,
      { captureId, model, dimensions: vector.length, vector: asVector(vector), at },
    )
  }
}

/**
 * How many photographs the index is asked for per book wanted. A book has a
 * front and a catalogue cover, and sometimes a front taken again, so asking for
 * a few times as many photographs as books still leaves enough books once each
 * is counted once.
 */
const PHOTOGRAPHS_PER_BOOK = 4

/** pgvector's own `hnsw.ef_search` default, below which this never asks. */
const EF_SEARCH = 40

export class PgvectorCoverSimilarity implements CoverSimilarityReadModel {
  constructor(private readonly db: Db) {}

  async nearest(model: string, dimensions: number, vector: readonly number[], limit: number): Promise<NearCover[]> {
    // Interpolated, because a cast's size cannot be a parameter, and refused
    // unless an index exists for it, because without one this is a scan.
    if (!(COVER_EMBEDDING_INDEXED_DIMENSIONS as readonly number[]).includes(dimensions)) {
      throw new Error(`no index is built for ${dimensions}-dimension embeddings; add one beside ${COVER_EMBEDDING_INDEXED_DIMENSIONS.join(' and ')}`)
    }
    const d = dimensions
    const photographs = Math.max(EF_SEARCH, limit * PHOTOGRAPHS_PER_BOOK)

    // An HNSW scan answers at most `ef_search` rows, whatever the LIMIT says.
    return this.db.tx(async (tx) => {
      await tx.run(`SET LOCAL hnsw.ef_search = ${photographs}`)
      const rows = await tx.all<{
        book_id: number; title: string; authors: string; kind: 'front' | 'catalogue'; similarity: number
      }>(
        `WITH near AS (
           SELECT c.book_id, c.kind,
                  e.embedding::vector(${d}) <=> CAST(:vector AS vector(${d})) AS distance
             FROM cover_embedding e
             JOIN capture c ON c.id = e.capture_id
            WHERE e.dimensions = ${d} AND e.model = :model
            ORDER BY e.embedding::vector(${d}) <=> CAST(:vector AS vector(${d}))
            LIMIT :photographs
         ), best AS (
           SELECT DISTINCT ON (book_id) book_id, kind, distance
             FROM near ORDER BY book_id, distance
         )
         SELECT b.id AS book_id, b.title, b.authors, best.kind, 1 - best.distance AS similarity
           FROM best
           JOIN catalogued_books b ON b.id = best.book_id
          ORDER BY best.distance, b.id
          LIMIT :limit`,
        { vector: asVector(vector), model, photographs, limit },
      )
      return rows.map((row) => ({
        bookId: row.book_id,
        title: row.title,
        authors: row.authors,
        kind: row.kind,
        similarity: Number(row.similarity),
      }))
    })
  }
}

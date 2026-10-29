/**
 * `cover_embedding` and the `vector` extension migration 0033 creates, on the
 * container the run started. Nothing here computes an embedding: the vectors are
 * written by hand, so the test is about what the schema can hold and find.
 */

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compareDigests, readDigest } from '../../server/backup'
import { COVER_EMBEDDING_INDEXED_DIMENSIONS, coverEmbedding } from './schema'

/** CLIP's size, which 0033 indexed first. 0034's 384 is read through the app's own query in `infrastructure/capture`. */
const D = 512
import { closeScratchDatabases, migratedDatabase } from './testdb'

let pool: pg.Pool
let book: number

beforeAll(async () => {
  pool = await migratedDatabase()
  const made = await pool.query<{ id: number }>(
    `INSERT INTO books (title, shelf_range, sort_key, title_filing, scanned_at)
     VALUES ('A book', 'fiction', 'a book', 'a book', '2026-10-28T00:00:00Z') RETURNING id`,
  )
  book = made.rows[0]!.id
})

afterAll(closeScratchDatabases)

/** A photograph of the one book, which an embedding has to belong to. */
async function photograph(kind: 'front' | 'catalogue', file: string): Promise<number> {
  const made = await pool.query<{ id: number }>(
    `INSERT INTO capture (book_id, kind, file, taken_at)
     VALUES ($1, $2, $3, '2026-10-28T00:00:00Z') RETURNING id`,
    [book, kind, file],
  )
  return made.rows[0]!.id
}

/** A vector of `D` zeros with the given positions set, in pgvector's text form. */
function vector(set: Record<number, number>, size = D): string {
  const values = new Array<number>(size).fill(0)
  for (const [at, value] of Object.entries(set)) values[Number(at)] = value
  return `[${values.join(',')}]`
}

async function embed(captureId: number, model: string, embedding: string, dimensions = D) {
  await pool.query(
    `INSERT INTO cover_embedding (capture_id, model, dimensions, embedding, computed_at)
     VALUES ($1, $2, $3, $4, '2026-10-28T00:00:00Z')`,
    [captureId, model, dimensions, embedding],
  )
}

/**
 * The query a matcher will run, spelled the way the partial expression index
 * is defined, since a query that says it any other way cannot use it.
 */
const NEAREST =
  `SELECT capture_id, model, embedding::vector(${D}) <=> $1::vector(${D}) AS distance
     FROM cover_embedding
    WHERE dimensions = ${D} AND model = $2
    ORDER BY embedding::vector(${D}) <=> $1::vector(${D})
    LIMIT $3`

describe('migration 0033', () => {
  it('creates the vector extension in the catalogue database', async () => {
    const found = await pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    )
    expect(found.rows).toEqual([{ extname: 'vector' }])
  })

  it('builds the cosine HNSW index over the column cast to its fixed dimension', async () => {
    const found = await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = $1",
      [`idx_cover_embedding_hnsw_${D}`],
    )
    expect(found.rows[0]?.indexdef).toContain('USING hnsw')
    expect(found.rows[0]?.indexdef).toContain(`vector(${D})) vector_cosine_ops`)
    expect(found.rows[0]?.indexdef).toContain(`WHERE (dimensions = ${D})`)
  })
})

describe('migration 0034', () => {
  it('keeps the 512 index and adds one for every other indexed size', async () => {
    const found = await pool.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'cover_embedding' AND indexdef LIKE '%hnsw%' ORDER BY indexname",
    )
    expect(found.rows.map((row) => row.indexname))
      .toEqual(COVER_EMBEDDING_INDEXED_DIMENSIONS.map((size) => `idx_cover_embedding_hnsw_${size}`).sort())
    const of384 = found.rows.find((row) => row.indexname === 'idx_cover_embedding_hnsw_384')
    expect(of384?.indexdef).toContain('vector(384)) vector_cosine_ops')
    expect(of384?.indexdef).toContain('WHERE (dimensions = 384)')
  })
})

describe('finding the nearer of two embeddings', () => {
  it('answers the photograph whose embedding points the same way as the query', async () => {
    const near = await photograph('front', 'near_front.jpg')
    const far = await photograph('catalogue', 'far_cover.jpg')
    await embed(near, 'nearer-model', vector({ 0: 1, 1: 0.1 }))
    await embed(far, 'nearer-model', vector({ 1: 1 }))

    const found = await pool.query<{ capture_id: number; distance: number }>(
      NEAREST, [vector({ 0: 1 }), 'nearer-model', 2],
    )

    expect(found.rows.map((row) => row.capture_id)).toEqual([near, far])
    expect(found.rows[0]!.distance).toBeLessThan(0.01)
    expect(found.rows[1]!.distance).toBeCloseTo(1, 5)
  })

  /**
   * On a few rows the planner rightly prefers a sort to an index, so this
   * table is filled until it does not: a thousand embeddings, analysed, and
   * the plan read rather than forced. Nothing here sets `enable_seqscan`.
   */
  it('goes through the HNSW index once there are enough rows for it to be worth it', async () => {
    await pool.query(
      `INSERT INTO capture (book_id, kind, file, taken_at)
       SELECT $1, 'front', 'many_' || n || '.jpg', '2026-10-28T00:00:00Z'
         FROM generate_series(1, 1000) AS n`,
      [book],
    )
    // The subquery names `c.id` so it is correlated and random() runs per row;
    // uncorrelated, Postgres evaluates it once and every row is the same vector.
    await pool.query(
      `INSERT INTO cover_embedding (capture_id, model, dimensions, embedding, computed_at)
       SELECT c.id, 'planner-model', ${D},
              (SELECT array_agg(random()) FROM generate_series(1, ${D}) WHERE c.id IS NOT NULL)::vector,
              '2026-10-28T00:00:00Z'
         FROM capture c WHERE c.file LIKE 'many\\_%'`,
    )
    const target = await photograph('front', 'the_one.jpg')
    await embed(target, 'planner-model', vector({ 7: 1 }))
    await pool.query('ANALYZE cover_embedding')

    const query = [vector({ 7: 1, 8: 0.01 }), 'planner-model', 1]
    const plan = await pool.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${NEAREST}`, query)
    const said = plan.rows.map((row) => row['QUERY PLAN']).join('\n')
    expect(said).toContain(`Index Scan using idx_cover_embedding_hnsw_${D} on cover_embedding`)

    const found = await pool.query<{ capture_id: number }>(NEAREST, query)
    expect(found.rows.map((row) => row.capture_id)).toEqual([target])
  })
})

describe('what the table will and will not hold', () => {
  it('keeps a second model of another size beside the first, outside the index', async () => {
    const front = await photograph('front', 'two_models.jpg')
    await embed(front, 'small-model', vector({ 0: 1 }, 3), 3)
    await embed(front, 'wide-model', vector({ 0: 1 }))

    const held = await pool.query<{ model: string; dimensions: number }>(
      'SELECT model, dimensions FROM cover_embedding WHERE capture_id = $1 ORDER BY model',
      [front],
    )
    expect(held.rows).toEqual([
      { model: 'small-model', dimensions: 3 },
      { model: 'wide-model', dimensions: D },
    ])
  })

  it('refuses a vector whose length is not the dimension its row claims', async () => {
    const front = await photograph('front', 'wrong_size.jpg')
    await expect(embed(front, 'liar-model', vector({ 0: 1 }, 3), D))
      .rejects.toThrow(/cover_embedding_dimensions_check/)
  })

  it('refuses a second embedding of one photograph by one model', async () => {
    const front = await photograph('front', 'twice.jpg')
    await embed(front, 'once-model', vector({ 0: 1 }))
    await expect(embed(front, 'once-model', vector({ 1: 1 })))
      .rejects.toThrow(/cover_embedding_pkey/)
  })

  it('goes with the photograph it was made from', async () => {
    const front = await photograph('front', 'deleted.jpg')
    await embed(front, 'gone-model', vector({ 0: 1 }))
    await pool.query('DELETE FROM capture WHERE id = $1', [front])

    const left = await pool.query('SELECT 1 FROM cover_embedding WHERE capture_id = $1', [front])
    expect(left.rows).toEqual([])
  })

  it('round-trips a vector through the Drizzle column as numbers', async () => {
    const front = await photograph('front', 'drizzle.jpg')
    const db = drizzle(pool)
    const written = [0.5, -0.25, 1]
    await db.insert(coverEmbedding).values({
      captureId: front, model: 'drizzle-model', dimensions: 3,
      embedding: written, computedAt: '2026-10-28T00:00:00Z',
    })

    const [read] = await db.select({ embedding: coverEmbedding.embedding })
      .from(coverEmbedding).where(eq(coverEmbedding.captureId, front))
    expect(read?.embedding).toEqual(written)
  })

  /**
   * The backup digest hashes every row through its text form, so a vector has
   * to be part of what it reads: an embedding that came back different from a
   * restore is a difference, not a match.
   */
  it('is read by the backup digest, values and all', async () => {
    const front = await photograph('front', 'digested.jpg')
    await embed(front, 'digest-model', vector({ 0: 1 }))
    const ask = { query: (sql: string) => pool.query(sql) }
    const before = await readDigest(ask)
    expect(before.tables).toContain('cover_embedding')

    await pool.query(
      'UPDATE cover_embedding SET embedding = $1 WHERE capture_id = $2',
      [vector({ 0: 0.5 }), front],
    )
    const after = await readDigest(ask)

    expect(after.counts.cover_embedding).toBe(before.counts.cover_embedding)
    expect(compareDigests(before, after).map((one) => one.what)).toEqual(['cover_embedding content'])
  })
})

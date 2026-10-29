/**
 * Embedding a book's photographs and asking for the nearest books, against a
 * real Postgres with pgvector, through the handlers the app calls.
 *
 * The encoder here is a stand-in that reads a direction out of the file's
 * bytes, so these tests are about which photographs are embedded, what is
 * written and how the search ranks, not about any model. The real model is
 * `onnx-cover-encoder.test.ts`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EmbedPhotographsHandler } from '../../application/capture/embed-photographs'
import { NearestCoversHandler } from '../../application/capture/queries/nearest-covers'
import type { CoverEncoder } from '../../application/capture/read-models'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { DrizzleAuthorRepository } from '../authorship/author-repository'
import type { Db } from '../../server/driver'
import { removeScratchRoot, scratchRoot } from '../../server/scratchdir'
import { Store } from '../../server/store'
import { testBooks } from '../../server/testbooks'
import { closeTestDatabase, openTestDatabase } from '../../server/testdb'
import { PgvectorCoverEmbeddings, PgvectorCoverSimilarity, nearestStatement, nearestValues } from './cover-embeddings'

const MODEL = 'stand-in@0000000/squash224'
const D = 384

/** A unit vector along `axis`, leaning a little towards `lean` when given. */
function along(axis: number, lean?: number): number[] {
  const values = new Array<number>(D).fill(0)
  values[axis] = 1
  if (lean !== undefined) values[lean] = 0.2
  const norm = Math.hypot(...values)
  return values.map((value) => value / norm)
}

/** Reads a file written by `picture`: the axis its "photograph" points along. */
class StandInEncoder implements CoverEncoder {
  readonly model = MODEL
  readonly dimensions = D
  loaded = true
  calls = 0
  ready() { return this.loaded }
  async embed(image: Uint8Array): Promise<number[]> {
    this.calls += 1
    const [axis, lean] = Buffer.from(image).toString('utf8').split(',').map(Number)
    if (!Number.isInteger(axis)) throw new Error('not a picture')
    return along(axis!, Number.isInteger(lean) ? lean : undefined)
  }
}

let db: Db
let root: string
let encoder: StandInEncoder

const files = { read: (file: string) => readFile(join(root, file)) }

async function picture(name: string, axis: number, lean?: number): Promise<string> {
  await writeFile(join(root, name), lean === undefined ? `${axis}` : `${axis},${lean}`)
  return name
}

async function shelve(title: string, front?: string): Promise<number> {
  return (await testBooks(db).catalogue({ title, authors: ['A. Writer'], genre: FICTION_SLUG, frontImage: front })).id
}

function embedder() {
  return new EmbedPhotographsHandler(encoder, new PgvectorCoverEmbeddings(db), files)
}

function nearest() {
  return new NearestCoversHandler(encoder, new PgvectorCoverSimilarity(db))
}

const now = () => '2026-10-29T09:00:00.000Z'

async function embeddingsOf(bookId: number) {
  return db.all<{ kind: string; model: string; dimensions: number }>(
    `SELECT c.kind, e.model, e.dimensions
       FROM cover_embedding e JOIN capture c ON c.id = e.capture_id
      WHERE c.book_id = ? ORDER BY c.kind`,
    [bookId],
  )
}

beforeAll(() => {
  root = scratchRoot('cover-embeddings')
})

beforeEach(async () => {
  db = await openTestDatabase()
  encoder = new StandInEncoder()
})

afterAll(async () => {
  removeScratchRoot(root)
  await closeTestDatabase()
})

describe('embedding a book after its save', () => {
  it('embeds the front and the catalogue cover, and not the back or the spine', async () => {
    const id = (await testBooks(db).catalogue({
      title: 'Three Photographs', authors: ['A. Writer'], genre: FICTION_SLUG,
      frontImage: await picture('front.jpg', 1),
      backImage: await picture('back.jpg', 2),
      edgeImage: await picture('edge.jpg', 3),
    })).id
    await new Store(db, new DrizzleAuthorRepository(db)).setCoverImage(id, await picture('artwork.jpg', 4))

    const done = await embedder().handle({ bookId: id, now })

    expect(done).toEqual({ embedded: 2, failed: [], skipped: false })
    expect(await embeddingsOf(id)).toEqual([
      { kind: 'catalogue', model: MODEL, dimensions: D },
      { kind: 'front', model: MODEL, dimensions: D },
    ])
  })

  it('does nothing a second time, because both already have one', async () => {
    const id = await shelve('Once', await picture('once.jpg', 1))
    await embedder().handle({ bookId: id, now })
    encoder.calls = 0

    expect(await embedder().handle({ bookId: id, now })).toEqual({ embedded: 0, failed: [], skipped: false })
    expect(encoder.calls).toBe(0)
  })

  it('touches only the book it was asked about', async () => {
    const asked = await shelve('Asked', await picture('asked.jpg', 1))
    const other = await shelve('Other', await picture('other.jpg', 2))

    await embedder().handle({ bookId: asked, now })

    expect(await embeddingsOf(asked)).toHaveLength(1)
    expect(await embeddingsOf(other)).toEqual([])
  })

  it('looks at nothing while the model is not loaded, and writes nothing', async () => {
    const id = await shelve('Early', await picture('early.jpg', 1))
    encoder.loaded = false

    expect(await embedder().handle({ bookId: id, now })).toEqual({ embedded: 0, failed: [], skipped: true })
    expect(await embeddingsOf(id)).toEqual([])
  })
})

describe('the backfill', () => {
  it('embeds every catalogued book with a photograph missing one, and reports the photograph it could not read', async () => {
    const first = await shelve('First', await picture('first.jpg', 1))
    const gone = await shelve('Gone', 'never-written.jpg')
    const last = await shelve('Last', await picture('last.jpg', 2))

    const done = await embedder().handle({ now })

    expect(done.embedded).toBe(2)
    expect(done.failed.map((one) => [one.photograph.bookId, one.photograph.file])).toEqual([[gone, 'never-written.jpg']])
    expect(done.failed[0]!.reason).toMatch(/ENOENT/)
    expect(await embeddingsOf(first)).toHaveLength(1)
    expect(await embeddingsOf(gone)).toEqual([])
    expect(await embeddingsOf(last)).toHaveLength(1)
  })

  it('leaves a book still in the queue alone: it is not something a photograph should find', async () => {
    // Written by hand: a queued book is made by the camera's capture route,
    // which needs the whole queue; these two rows are what it leaves.
    const queued = await db.get<{ id: number }>(
      `INSERT INTO books (title, shelf_range, sort_key, title_filing, scanned_at, state)
       VALUES ('', '', '', '', ?, 'scanned') RETURNING id`, [now()],
    )
    await db.run(
      `INSERT INTO capture (book_id, kind, file, taken_at) VALUES (?, 'front', ?, ?)`,
      [queued!.id, await picture('queued.jpg', 1), now()],
    )

    expect(await embedder().handle({ now })).toEqual({ embedded: 0, failed: [], skipped: false })
  })
})

describe('asking for the nearest books', () => {
  it('answers the book whose photograph points the same way first, each book once', async () => {
    const near = await shelve('Near', await picture('near-front.jpg', 10))
    await new Store(db, new DrizzleAuthorRepository(db)).setCoverImage(near, await picture('near-art.jpg', 10, 11))
    const middling = await shelve('Middling', await picture('middling.jpg', 11, 10))
    const far = await shelve('Far', await picture('far.jpg', 20))
    await embedder().handle({ now })

    const answer = await nearest().handle({ photo: Buffer.from('10') })

    if (!answer.available) throw new Error('the stand-in is loaded')
    expect(answer.model).toBe(MODEL)
    expect(answer.books.map((book) => book.bookId)).toEqual([near, middling, far])
    expect(answer.books[0]).toMatchObject({ title: 'Near', kind: 'front' })
    expect(answer.books[0]!.similarity).toBeCloseTo(1, 5)
    expect(answer.books[2]!.similarity).toBeCloseTo(0, 5)
  })

  it('stops at the number asked for', async () => {
    for (const axis of [1, 2, 3, 4, 5]) await shelve(`Book ${axis}`, await picture(`b${axis}.jpg`, axis))
    await embedder().handle({ now })

    const answer = await nearest().handle({ photo: Buffer.from('3'), limit: 2 })

    expect(answer.available && answer.books.map((book) => book.title)).toEqual(['Book 3', expect.any(String)])
  })

  it('says it is not available, rather than answering nothing, while the model is not loaded', async () => {
    await shelve('Anything', await picture('anything.jpg', 1))
    await embedder().handle({ now })
    encoder.loaded = false

    expect(await nearest().handle({ photo: Buffer.from('1') })).toEqual({ available: false })
  })

  it('refuses a size no index is built for, rather than scanning the table', () => {
    expect(() => nearestStatement(100)).toThrow(/no index is built for 100-dimension/)
  })

  /**
   * On a few rows the planner rightly prefers a sort, so the table is filled
   * until it does not, the same way `cover-embedding.test.ts` proves the 512
   * index. This search asks the index for forty rows rather than one, so it
   * takes more: at a thousand the plan was still a sequential scan. The plan is
   * read, never forced.
   */
  it('goes through the 384 index migration 0034 built', async () => {
    const book = await shelve('Many Photographs')
    await db.run(
      `INSERT INTO capture (book_id, kind, file, taken_at)
       SELECT ?, 'front', 'many_' || n || '.jpg', ? FROM generate_series(1, 2000) AS n`,
      [book, now()],
    )
    await db.run(
      `INSERT INTO cover_embedding (capture_id, model, dimensions, embedding, computed_at)
       SELECT c.id, ?, ${D},
              (SELECT array_agg(random()) FROM generate_series(1, ${D}) WHERE c.id IS NOT NULL)::vector, ?
         FROM capture c WHERE c.file LIKE 'many\\_%'`,
      [MODEL, now()],
    )
    await db.run('ANALYZE cover_embedding')

    const plan = await db.all<{ 'QUERY PLAN': string }>(
      `EXPLAIN ${nearestStatement(D)}`, nearestValues(MODEL, along(7), 4),
    )

    expect(plan.map((row) => row['QUERY PLAN']).join('\n'))
      .toContain('Index Scan using idx_cover_embedding_hnsw_384 on cover_embedding')
  })
})

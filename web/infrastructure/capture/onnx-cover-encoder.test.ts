/**
 * The app's real image model, end to end: covers saved through the save path,
 * embedded by the handler the background work calls, and found again from a
 * photograph through the query handler and pgvector.
 *
 * Needs the DINOv2 weights cached, and never downloads them here. On CI they are
 * restored by the workflow's cache step, so a miss there is a failure rather
 * than a skip: a check that quietly stops running is the gap #666 closes.
 */

import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EmbedPhotographsHandler } from '../../application/capture/embed-photographs'
import { NearestCoversHandler } from '../../application/capture/queries/nearest-covers'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { DINOV2_SMALL, isCached } from '../../server/cover-matching/models'
import { inventBooks, photograph, renderCover, seeded } from '../../server/cover-matching/synthetic'
import type { Db } from '../../server/driver'
import { removeScratchRoot, scratchRoot } from '../../server/scratchdir'
import { Store } from '../../server/store'
import { testBooks } from '../../server/testbooks'
import { closeTestDatabase, openTestDatabase } from '../../server/testdb'
import { DrizzleAuthorRepository } from '../authorship/author-repository'
import { PgvectorCoverEmbeddings, PgvectorCoverSimilarity } from './cover-embeddings'
import { OnnxCoverEncoder } from './onnx-cover-encoder'

const required = process.env.CI === 'true'
const missing = !isCached(DINOV2_SMALL)

let db: Db
let root: string
const encoder = new OnnxCoverEncoder()

beforeAll(async () => {
  if (missing) return
  root = scratchRoot('onnx-cover-encoder')
  db = await openTestDatabase()
  await encoder.load()
}, 120_000)

afterAll(async () => {
  removeScratchRoot(root)
  if (db) await closeTestDatabase()
})

describe('the cover model', () => {
  it.runIf(missing && required)('is cached on CI, where the workflow restores it', () => {
    expect.fail(`no ${DINOV2_SMALL.repo} weights at the pinned revision; the "Cover models" steps in ci.yml should have restored or fetched them`)
  })

  describe.skipIf(missing)(missing ? 'skipped: weights not cached (npm run eval:covers fetches them)' : 'loaded', () => {
    it('names its weights and its preparation, and answers a unit vector of 384', async () => {
      expect(encoder.model).toBe('onnx-community/dinov2-small@8b1f705/squash224')
      const vector = await encoder.embed(await renderCover(inventBooks(seeded(1), 1)[0]!))
      expect(vector).toHaveLength(384)
      expect(Math.hypot(...vector)).toBeCloseTo(1, 5)
    })

    it('finds a saved cover again from a photograph of it, through the save path and Postgres', async () => {
      // Books outside a series: the image model cannot read the titles that are
      // all that tells a series apart, which is what the cover text matcher is for.
      const books = inventBooks(seeded(5), 40).filter((book) => !book.title.includes(':')).slice(0, 8)
      const store = new Store(db, new DrizzleAuthorRepository(db))
      const ids: number[] = []
      for (const [n, book] of books.entries()) {
        const id = (await testBooks(db).catalogue({ title: book.title, authors: [book.author], genre: FICTION_SLUG })).id
        const file = `artwork-${n}.jpg`
        await writeFile(join(root, file), await renderCover(book))
        await store.setCoverImage(id, file)
        ids.push(id)
      }

      const embedded = await new EmbedPhotographsHandler(
        encoder, new PgvectorCoverEmbeddings(db), { read: (file) => readFile(join(root, file)) },
      ).handle({ now: () => new Date().toISOString() })
      expect(embedded).toEqual({ embedded: 8, failed: [], skipped: false })

      const nearest = new NearestCoversHandler(encoder, new PgvectorCoverSimilarity(db))
      const firsts: boolean[] = []
      for (const [n, book] of books.entries()) {
        // Square-on and well lit: severity 0.1 found all eight on Linux x64.
        const photo = await photograph(await renderCover(book), seeded(100 + n), 0.1)
        const answer = await nearest.handle({ photo })
        if (!answer.available) throw new Error('the model was loaded above')
        expect(answer.books.map((one) => one.bookId), book.title).toContain(ids[n])
        firsts.push(answer.books[0]!.bookId === ids[n])
      }
      // Two of eight allowed to come second, for the grey levels glyph edges
      // differ by between machines.
      expect(firsts.filter(Boolean).length).toBeGreaterThanOrEqual(6)
    }, 120_000)
  })
})

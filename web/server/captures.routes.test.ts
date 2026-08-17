/**
 * Saving a book writes its photographs down as rows, driven over real HTTP
 * against a real Postgres.
 *
 * Postgres, because `capture` is created by a migration and there are migrations
 * only for Postgres. The database is built by running them, which is also what
 * an ordinary start does: `applySchema` calls `migrateToLatest`.
 *
 * The app is built with `createApp()` and started on an ephemeral port, the same
 * way `index.test.ts` and `tags.routes.test.ts` do it, and for the same reason:
 * there is no supertest in this project and this suite must not add one. Open
 * Library and Google Books are stubbed, so nothing here touches the network.
 *
 * **`capture` is the record since #228**, so there are no columns behind these
 * rows to compare them against and nothing here writes one. What the tests
 * drive is the four ways a photograph is written down: a save that carries
 * files, a cover the backfill downloads, what the detector made of a photograph,
 * and a hash. The two things that could still go wrong quietly are the same two:
 * a photograph that never became a row, and a row that says the detector looked
 * at a photograph it has never opened.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { downloadCover } from './covers'
import { PgDb } from './db.pg'
import { createApp } from './index'
import { lookupIsbn } from './lookup'
import { photographTaken } from './photographs'
import { Store } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'

const empty = {
  found: false, title: '', subtitle: '', authors: [] as string[], publisher: '',
  published: '', pages: '', isbn13: '', isbn10: '', seriesName: '', seriesIndex: null,
  coverUrl: '', source: '',
  classification: { genre: FICTION_SLUG, confidence: 'unknown' as const, reason: 'stub' },
  notes: [] as string[], subjects: [] as string[], categories: [] as string[],
}

vi.mock('./lookup', () => ({
  lookupIsbn: vi.fn(),
  searchTitle: vi.fn(),
}))

vi.mock('./covers', () => ({
  downloadCover: vi.fn(async () => ''),
  openLibraryCover: (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
  upgradeGoogleCover: (url: string) => url,
}))

const answers = vi.mocked(lookupIsbn)
const covers = vi.mocked(downloadCover)

let pool: pg.Pool
// One `Db` for the file, not one per test. Each `PgDb` registers an `error`
// listener on the pool, and a dozen of them trips node's max-listeners warning.
let db: PgDb
/** This file's own scratch root, which no other test file can name. */
let scratch: string
let coverDir: string
let server: Server
let baseUrl: string
/** Kept so a test can wait for the chain a save fires and not race it. */
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
  scratch = scratchRoot('captures')
})

beforeEach(async () => {
  await pool.query('TRUNCATE books, book_authors, captures, capture, book_tag, tag RESTART IDENTITY CASCADE')
  answers.mockReset()
  answers.mockResolvedValue({ ...empty })
  covers.mockReset()
  covers.mockResolvedValue('')

  coverDir = mkdtempSync(join(scratch, 'captures-test-'))
  app = createApp({ db, coverDir, startBackgroundWork: false })
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  rmSync(coverDir, { recursive: true, force: true })
})

afterAll(async () => {
  await closeScratchDatabases()
  // The per-test cover directories go in `afterEach`; this is the root they
  // were made in, and it belongs to this file alone. Nothing above it is
  // touched, because there is nothing above it that anything else shares. That
  // used to be `web/data`, which index.test.ts removed while this file was
  // still working in it (#297).
  removeScratchRoot(scratch)
})

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

const post = (path: string, body: unknown) =>
  call(path, { method: 'POST', body: JSON.stringify(body) })

/** Bytes that are not a photograph, which is all the save path needs. */
const notAPhotograph = (name: string) =>
  `data:image/jpeg;base64,${Buffer.from(`pretend this is ${name}`).toString('base64')}`

interface Capture {
  kind: string
  file: string
  cropFile: string
  examined: boolean
  verdict: string
  shown: string
  hash: string
  takenAt: string
}

async function capturesOf(bookId: number): Promise<Capture[]> {
  const { body } = await call(`/api/books/${bookId}/captures`)
  return body.captures as Capture[]
}

/** A saved book, and its id. */
async function aBook(fields: Record<string, unknown> = {}) {
  const { body } = await post('/api/books', {
    title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, ...fields,
  })
  return Number(body.id)
}

/**
 * Save the book again, unchanged.
 *
 * Here to prove that a save which states nothing about the photographs cannot
 * disturb them, which is what the two monotone tests below are about.
 */
async function saveAgain(id: number) {
  return call(`/api/books/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG }),
  })
}

/**
 * What the crop pass writes, called directly.
 *
 * The pass itself needs a detector and a real JPEG, and what is under test here
 * is the record it leaves rather than whether a detector can find a book in a
 * photograph. `Store.setCrop` is the statement it calls and `bookcrop.test.ts`
 * is where the detector is judged.
 */
function cropped(id: number, slot: 'front' | 'back' | 'edge', name: string) {
  return new Store(db, new DrizzleAuthorRepository(db)).setCrop(id, slot, name)
}

describe('saving a photographed book', () => {
  it('gives every photograph a row, with the spine called a spine', async () => {
    const id = await aBook({
      images: {
        front: notAPhotograph('front'),
        back: notAPhotograph('back'),
        edge: notAPhotograph('edge'),
      },
    })

    const captures = await capturesOf(id)
    expect(captures.map((one) => one.kind).sort()).toEqual(['back', 'front', 'spine'])
    // The files are the ones the book row names, so nothing here has invented a
    // filename or lost one.
    const book = (await call(`/api/books/${id}`)).body.book
    expect(captures.find((one) => one.kind === 'front')?.file).toBe(book.front_image)
    expect(captures.find((one) => one.kind === 'spine')?.file).toBe(book.edge_image)
  })

  it('dates a photograph from the scan rather than from the save that mentioned it', async () => {
    const id = await aBook({ images: { front: notAPhotograph('front') } })
    const book = (await call(`/api/books/${id}`)).body.book
    expect((await capturesOf(id))[0]?.takenAt).toBe(book.scanned_at)
  })

  it('says nothing about a detector that has not run', async () => {
    const id = await aBook({ images: { front: notAPhotograph('front') } })
    expect((await capturesOf(id))[0]).toMatchObject({
      cropFile: '', examined: false, verdict: 'unexamined',
    })
  })

  it('records nothing for a book nobody photographed', async () => {
    expect(await capturesOf(await aBook())).toEqual([])
  })

  it('is 404 for a book that is not there', async () => {
    expect((await call('/api/books/9999/captures')).status).toBe(404)
  })
})

describe('what the detector decided, carried onto the row', () => {
  it('separates looking and declining from never having looked', async () => {
    /*
     * The distinction that decides what a caption may honestly say, asserted
     * end to end. Two photographs on one book, neither with a crop: the front
     * has been through the detector and the back has not, and the row says so
     * per photograph rather than per book. `books.cropped` is one string
     * describing three photographs, which is exactly what makes this easy to
     * smear on the way across.
     */
    const id = await aBook({
      images: { front: notAPhotograph('front'), back: notAPhotograph('back') },
    })
    // The detector was shown the front and could not find the book. It has never
    // been shown the back.
    await cropped(id, 'front', '')

    const byKind = new Map((await capturesOf(id)).map((one) => [one.kind, one]))
    expect(byKind.get('front')).toMatchObject({ examined: true, verdict: 'declined' })
    expect(byKind.get('back')).toMatchObject({ examined: false, verdict: 'unexamined' })

    // And back out again, in the vocabulary the wire still speaks: the slot the
    // detector declined is named, the one it has never opened is not.
    const book = (await call(`/api/books/${id}`)).body.book
    expect(book.cropped).toBe('front')
    expect(book.front_crop).toBe('')
  })

  it('shows the crop where there is one and the whole photograph where there is not', async () => {
    const id = await aBook({
      images: { front: notAPhotograph('front'), back: notAPhotograph('back') },
    })
    await cropped(id, 'front', 'front_crop.jpg')
    await cropped(id, 'back', '')

    const byKind = new Map((await capturesOf(id)).map((one) => [one.kind, one]))
    expect(byKind.get('front')).toMatchObject({
      verdict: 'cropped', shown: 'front_crop.jpg',
    })
    expect(byKind.get('back')?.shown).toBe(byKind.get('back')?.file)
  })

  it('carries the publisher artwork as a photograph nothing has examined', async () => {
    const id = await aBook()
    const store = new Store(db, new DrizzleAuthorRepository(db))
    await store.setCoverImage(id, 'cover.jpg')
    await store.setHashes(id, '', 'd:cover')

    // Dated from when the artwork was fetched, which is the same moment
    // `cover_checked_at` records: that column stays, because it is about the
    // search rather than about a photograph.
    const book = (await call(`/api/books/${id}`)).body.book
    expect((await capturesOf(id))[0]).toMatchObject({
      kind: 'catalogue', file: 'cover.jpg', hash: 'd:cover',
      // The detector finds a book in a room, and a publisher's artwork has no
      // room in it. It has never been offered one and must not read as declined.
      examined: false, verdict: 'unexamined',
      takenAt: book.cover_checked_at,
    })
  })

  it('does not let a later pass take a crop back off', async () => {
    // The lost update stage G found, on the column this replaces. A crop pass
    // that finds nothing, and a save that knows nothing about the crop, must
    // neither of them be able to erase it.
    const id = await aBook({ images: { front: notAPhotograph('front') } })
    await cropped(id, 'front', 'front_crop.jpg')

    await cropped(id, 'front', '')
    await saveAgain(id)

    expect((await capturesOf(id))[0]).toMatchObject({
      cropFile: 'front_crop.jpg', examined: true, verdict: 'cropped',
    })
  })
})

describe('a book photographed twice', () => {
  it('keeps the first spine when a second one is taken', async () => {
    /*
     * The feature the table exists for, and the reason `books.edge_image` had to
     * go: it held one filename, so a re-shoot overwrote it and the blurred
     * original was gone. Both are rows, and the wire still answers with one
     * spine because that is the question it asks: the newest.
     */
    const id = await aBook({ images: { edge: notAPhotograph('blurred spine') } })
    const blurred = (await capturesOf(id))[0]!.file

    await photographTaken(db, id, 'edge', 'sharp-spine.jpg', new Date().toISOString())

    const spines = (await capturesOf(id)).filter((one) => one.kind === 'spine')
    expect(spines.map((one) => one.file)).toContain(blurred)
    expect(spines.map((one) => one.file)).toContain('sharp-spine.jpg')
    expect(spines).toHaveLength(2)

    const book = (await call(`/api/books/${id}`)).body.book
    expect(book.edge_image).toBe('sharp-spine.jpg')
  })
})

describe('a column written long after the save that made the row', () => {
  /*
   * The drift #200 is about. `capture` used to track saves rather than
   * photographs: the cover backfill wrote `books.cover_image` and nothing wrote
   * a row, so the artwork existed as a column and not as a photograph until
   * somebody happened to save that book again. Nothing reads `capture` yet, so
   * the only place this could be seen is here.
   */
  it('records the cover the backfill downloads, without waiting for a save', async () => {
    const id = await aBook({ isbn13: '9780441013593' })
    // The save fires its own cover fetch, which finds nothing and stamps the
    // row as asked. Waiting for it is what makes the backfill below the only
    // thing that could have written the cover.
    await app.settled()
    expect(await capturesOf(id)).toEqual([])

    covers.mockResolvedValue('9780441013593_cover.jpg')
    // `retry`, because the save above already recorded that this book was asked
    // about, and a plain backfill deliberately does not ask twice.
    const { body } = await post('/api/backfill/covers', { retry: true })
    expect(body.fetched).toBe(1)

    expect((await capturesOf(id))[0]).toMatchObject({
      kind: 'catalogue',
      file: '9780441013593_cover.jpg',
      // A publisher's artwork has no room in it, so nothing has examined it.
      // The backfill must not be the thing that says otherwise.
      examined: false,
      verdict: 'unexamined',
    })
  })
})

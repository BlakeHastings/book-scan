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
 * The photographs are the columns' still, and this is the dual write that keeps
 * the rows level with them until the client is cut over. The tests below are
 * about the two things that could go wrong quietly: a photograph that never
 * became a row, and a row that says the detector looked at a photograph it has
 * never opened.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dropScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { PgDb } from './db.pg'
import { createApp } from './index'
import { lookupIsbn } from './lookup'

const empty = {
  found: false, title: '', subtitle: '', authors: [] as string[], publisher: '',
  published: '', pages: '', isbn13: '', isbn10: '', seriesName: '', seriesIndex: null,
  coverUrl: '', source: '',
  classification: { isFiction: true, confidence: 'unknown' as const, reason: 'stub' },
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

let pool: pg.Pool
// One `Db` for the file, not one per test. Each `PgDb` registers an `error`
// listener on the pool, and a dozen of them trips node's max-listeners warning.
let db: PgDb
let dataRoot: string
let coverDir: string
let server: Server
let baseUrl: string

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
  dataRoot = fileURLToPath(new URL('../data/', import.meta.url))
  mkdirSync(dataRoot, { recursive: true })
})

beforeEach(async () => {
  await pool.query('TRUNCATE books, book_authors, captures, capture, book_tag, tag RESTART IDENTITY CASCADE')
  answers.mockReset()
  answers.mockResolvedValue({ ...empty })

  coverDir = mkdtempSync(join(dataRoot, 'captures-test-'))
  const app = createApp({ db, coverDir, startBackgroundWork: false })
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
  await dropScratchDatabases()
  // This file's own scratch directory goes in `afterEach`, and `web/data`
  // itself is deliberately left alone: index.test.ts removes the whole of it,
  // and two files racing to delete one directory is how a run fails in the file
  // that was not at fault. See the note about that rmSync in AGENTS.md.
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
    title: 'Dune', authors: ['Frank Herbert'], isFiction: true, ...fields,
  })
  return Number(body.id)
}

/**
 * Save the book again, unchanged, which is what makes the server re-read the
 * row and record whatever a column has grown since.
 *
 * The crop pass and the cover fetch are the things that ordinarily do this, a
 * second after the save. Doing it by hand keeps this file off the image
 * libraries: what is under test here is the bridge from the columns to the
 * rows, not whether a detector can find a book in a JPEG.
 */
async function saveAgain(id: number) {
  return call(`/api/books/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Dune', authors: ['Frank Herbert'], isFiction: true }),
  })
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
    await db.run("UPDATE books SET cropped = 'front' WHERE id = ?", [id])
    await saveAgain(id)

    const byKind = new Map((await capturesOf(id)).map((one) => [one.kind, one]))
    expect(byKind.get('front')).toMatchObject({ examined: true, verdict: 'declined' })
    expect(byKind.get('back')).toMatchObject({ examined: false, verdict: 'unexamined' })
  })

  it('shows the crop where there is one and the whole photograph where there is not', async () => {
    const id = await aBook({
      images: { front: notAPhotograph('front'), back: notAPhotograph('back') },
    })
    await db.run(
      "UPDATE books SET cropped = 'front,back', front_crop = 'front_crop.jpg' WHERE id = ?",
      [id],
    )
    await saveAgain(id)

    const byKind = new Map((await capturesOf(id)).map((one) => [one.kind, one]))
    expect(byKind.get('front')).toMatchObject({
      verdict: 'cropped', shown: 'front_crop.jpg',
    })
    expect(byKind.get('back')?.shown).toBe(byKind.get('back')?.file)
  })

  it('carries the publisher artwork as a photograph nothing has examined', async () => {
    const id = await aBook()
    await db.run(
      `UPDATE books SET cover_image = 'cover.jpg', cover_hash = 'd:cover',
                        cover_checked_at = '2026-03-04T00:00:00.000Z' WHERE id = ?`,
      [id],
    )
    await saveAgain(id)

    expect((await capturesOf(id))[0]).toMatchObject({
      kind: 'catalogue', file: 'cover.jpg', hash: 'd:cover',
      // The detector finds a book in a room, and a publisher's artwork has no
      // room in it. It has never been offered one and must not read as declined.
      examined: false, verdict: 'unexamined',
      takenAt: '2026-03-04T00:00:00.000Z',
    })
  })

  it('does not let a later save take a crop back off', async () => {
    // The lost update stage G found, on the column this replaces. A save that
    // knows nothing about the crop must not be able to erase it.
    const id = await aBook({ images: { front: notAPhotograph('front') } })
    await db.run(
      "UPDATE books SET cropped = 'front', front_crop = 'front_crop.jpg' WHERE id = ?", [id],
    )
    await saveAgain(id)

    await db.run("UPDATE books SET cropped = '', front_crop = '' WHERE id = ?", [id])
    await saveAgain(id)

    expect((await capturesOf(id))[0]).toMatchObject({
      cropFile: 'front_crop.jpg', examined: true, verdict: 'cropped',
    })
  })
})

describe('a book photographed twice', () => {
  it('keeps the first spine when a second one is taken', async () => {
    /*
     * The feature the table exists for, over HTTP. `books.edge_image` holds one
     * filename, so the re-shoot overwrites it there and the blurred original is
     * gone from the column. It is still a row.
     */
    const id = await aBook({ images: { edge: notAPhotograph('blurred spine') } })
    const blurred = (await capturesOf(id))[0]!.file

    await db.run("UPDATE books SET edge_image = 'sharp-spine.jpg' WHERE id = ?", [id])
    await saveAgain(id)

    const spines = (await capturesOf(id)).filter((one) => one.kind === 'spine')
    expect(spines.map((one) => one.file)).toContain(blurred)
    expect(spines.map((one) => one.file)).toContain('sharp-spine.jpg')
    expect(spines).toHaveLength(2)

    // And the column has only the new one, which is the whole problem.
    const book = (await call(`/api/books/${id}`)).body.book
    expect(book.edge_image).toBe('sharp-spine.jpg')
  })
})

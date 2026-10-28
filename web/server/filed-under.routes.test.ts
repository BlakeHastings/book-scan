/**
 * What a screen shows beside a book is what the screen is ordered by.
 *
 * Correcting a filing name re-keys only the book it was saved with. Every other
 * book crediting that name keeps the key its last save wrote, so it still sorts
 * under the old name, and the label beside it has to say the old name too or the
 * list reads as out of order. Over real HTTP, because the label and the order
 * come from two different places: the alias joined on by the view, and the key.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { createApp, type BookScanApp } from './index'
import { signedIn } from './testauth'
import { SEP, normalise, padNumbers } from '../shared/shelving'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'

vi.mock('./lookup', () => ({ lookupIsbn: vi.fn(), searchTitle: vi.fn() }))

vi.mock('./covers', () => ({
  downloadCover: vi.fn(async () => ''),
  openLibraryCover: (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
  upgradeGoogleCover: (url: string) => url,
}))

let db: Db
let scratch: string
let coverDir: string
let app: BookScanApp
let server: Server
let baseUrl: string
let cookie: string

beforeAll(() => {
  scratch = scratchRoot('filed-under')
})

beforeEach(async () => {
  db = await openTestDatabase()
  coverDir = mkdtempSync(join(scratch, 'filed-under-test-'))
  cookie = (await signedIn(db)).cookie
  app = createApp({ db, coverDir, startBackgroundWork: false })
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await app.settled()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  rmSync(coverDir, { recursive: true, force: true })
})

afterAll(async () => {
  await closeTestDatabase()
  removeScratchRoot(scratch)
})

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { cookie, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

const FYODOR = 'Фёдор Достоевский'

async function save(title: string, author: string, extra: Record<string, unknown> = {}, id?: number) {
  const body = JSON.stringify({ title, authors: [author], genre: FICTION_SLUG, classificationSource: 'manual', ...extra })
  const { status, body: answer } = id === undefined
    ? await call('/api/books', { method: 'POST', body })
    : await call(`/api/books/${id}`, { method: 'PUT', body })
  expect(status).toBeLessThan(300)
  return Number(answer.id ?? id)
}

interface Listed { id: number; title: string; author_filing: string; sort_key: string }

async function listed(): Promise<Listed[]> {
  return (await call('/api/books?range=fiction')).body.books
}

/** The author component of the key, which is what the list is ordered by first. */
const keyedUnder = (book: Listed) => book.sort_key.split(SEP)[0]

async function aCorrectedName() {
  const crime = await save('Crime and Punishment', FYODOR)
  const brothers = await save('The Brothers Karamazov', FYODOR)
  await save('Snow Crash', 'Neal Stephenson')
  // The app's own Edit, with the filing name typed beside the author.
  await save('Crime and Punishment', FYODOR, { authorFilingOverride: 'Dostoevsky, Fyodor' }, crime)
  return { crime, brothers }
}

describe('a filing name corrected through one of the books', () => {
  it('lists every other book under the name it is still ordered by', async () => {
    const { crime, brothers } = await aCorrectedName()

    const books = await listed()
    expect(books.map((book) => [book.title, book.author_filing])).toEqual([
      ['Crime and Punishment', 'Dostoevsky, Fyodor'],
      ['Snow Crash', 'Stephenson, Neal'],
      ['The Brothers Karamazov', 'Достоевский, Фёдор'],
    ])
    expect(books.find((book) => book.id === crime)).toBeDefined()
    expect(books.find((book) => book.id === brothers)).toBeDefined()
  })

  it('never shows a label that folds to anything but what the row is ordered by', async () => {
    await aCorrectedName()

    for (const book of await listed()) {
      expect(padNumbers(normalise(book.author_filing)), book.title).toBe(keyedUnder(book))
    }
  })

  it('says the same on the book\'s own page, beside what the name now files under', async () => {
    const { brothers } = await aCorrectedName()

    const { body } = await call(`/api/books/${brothers}`)
    expect(body.filedUnder).toBe('Достоевский, Фёдор')
    expect(body.authors[0].filingName).toBe('Dostoevsky, Fyodor')
  })

  it('moves the label and the book together when that book is saved again', async () => {
    const { brothers } = await aCorrectedName()

    await save('The Brothers Karamazov', FYODOR, { authorFilingOverride: 'Dostoevsky, Fyodor' }, brothers)

    expect((await listed()).map((book) => [book.title, book.author_filing])).toEqual([
      ['The Brothers Karamazov', 'Dostoevsky, Fyodor'],
      ['Crime and Punishment', 'Dostoevsky, Fyodor'],
      ['Snow Crash', 'Stephenson, Neal'],
    ])
    expect((await call(`/api/books/${brothers}`)).body.filedUnder).toBe('Dostoevsky, Fyodor')
  })

  it('is the answer a search gives too', async () => {
    await aCorrectedName()

    const { body } = await call('/api/books?range=all&q=karamazov')
    expect(body.books.map((book: Listed) => book.author_filing)).toEqual(['Достоевский, Фёдор'])
  })
})

/**
 * The author routes, driven over real HTTP against a real Postgres.
 *
 * Postgres, because `author`, `author_alias` and `book_author` are created by a
 * migration and there are migrations only for Postgres. The database is built by
 * running them, which is also what an ordinary start does: `applySchema` calls
 * `migrateToLatest`.
 *
 * The app is built with `createApp()` and started on an ephemeral port, the same
 * way `tags.routes.test.ts` does it, and for the same reason: there is no
 * supertest in this project and this suite must not add one. Open Library and
 * Google Books are stubbed, so nothing here touches the network.
 *
 * Two tests matter more than the rest. One is that saving a book credits an
 * alias without moving where the book files, which is the promise #180 makes to
 * every shelf. The other is that merging two authors moves no book, which is why
 * the backfill was allowed to be conservative.
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

vi.mock('./lookup', () => ({ lookupIsbn: vi.fn(), searchTitle: vi.fn() }))
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
  await pool.query(
    'TRUNCATE books, book_authors, captures, book_tag, tag, author, author_alias ' +
    'RESTART IDENTITY CASCADE',
  )
  answers.mockReset()
  answers.mockResolvedValue({ ...empty })

  coverDir = mkdtempSync(join(dataRoot, 'authors-test-'))
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
}, 60_000)

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

const send = (method: string) => (path: string, body: unknown) =>
  call(path, { method, body: JSON.stringify(body) })
const post = send('POST')
const put = send('PUT')
const patch = send('PATCH')

/** A saved book, and its id. */
async function aBook(fields: Record<string, unknown> = {}) {
  const { body } = await post('/api/books', {
    title: 'Dune', authors: ['Frank Herbert'], isFiction: true, ...fields,
  })
  return Number(body.id)
}

interface Credit { position: number; aliasId: number; displayName: string; filingName: string }
interface Alias { id: number; displayName: string; filingName: string; isPrimary: boolean }
interface AuthorView { id: number; primary: string; isCorporate: boolean; aliases: Alias[] }

async function creditsOf(bookId: number): Promise<Credit[]> {
  const { body } = await call(`/api/books/${bookId}/authors`)
  return body.authors as Credit[]
}

async function everyone(): Promise<AuthorView[]> {
  const { body } = await call('/api/authors')
  return body.authors as AuthorView[]
}

/** What the shelf actually orders by, straight from the row. */
async function shelving(bookId: number) {
  const row = await pool.query<{ author_filing: string; sort_key: string; authors: string }>(
    'SELECT author_filing, sort_key, authors FROM books WHERE id = $1', [bookId],
  )
  return row.rows[0]!
}

describe('saving a book', () => {
  it('credits an alias, in the order the names are printed', async () => {
    const id = await aBook({ title: 'The Talisman', authors: ['Stephen King', 'Peter Straub'] })

    expect((await creditsOf(id)).map((one) => [one.position, one.displayName, one.filingName]))
      .toEqual([
        [1, 'Stephen King', 'King, Stephen'],
        [2, 'Peter Straub', 'Straub, Peter'],
      ])
  })

  it('does not touch what the shelf orders by', async () => {
    // The promise #180 makes to every shelf. `books.author_filing` and
    // `books.sort_key` are still what the shelving code reads, and the new
    // tables are written beside them rather than instead of them.
    const id = await aBook({ authors: ['Frank Herbert'] })
    const before = await shelving(id)

    await put(`/api/books/${id}/authors`, { authors: ['Frank Herbert', 'Brian Herbert'] })
    expect(await shelving(id)).toEqual(before)
    expect(before.author_filing).toBe('Herbert, Frank')
    expect(before.authors).toBe('Frank Herbert')
  })

  it('files the first-listed name under the override somebody typed', async () => {
    const id = await aBook({
      title: 'One Hundred Years of Solitude',
      authors: ['Gabriel García Márquez'],
      authorFilingOverride: 'García Márquez, Gabriel',
    })
    expect((await creditsOf(id))[0]!.filingName).toBe('García Márquez, Gabriel')
  })

  it('gives a name nobody has seen an author of its own', async () => {
    await aBook({ title: 'The Wasp Factory', authors: ['Iain Banks'] })
    await aBook({ title: 'Consider Phlebas', authors: ['Iain M. Banks'] })

    // Two authors, because nothing here can know they are one person, and that
    // guess is the one nothing can undo.
    const authors = await everyone()
    expect(authors.map((one) => one.primary)).toEqual(['Iain Banks', 'Iain M. Banks'])
  })

  it('files a name written in a non-Latin script, which the book row does not', async () => {
    // Issue #195, seen from both sides at once. `Store.filingFor` guards its
    // override lookup with `normalise()`, which folds a non-Latin name away
    // entirely, so the heuristic is skipped and the book is stored with an empty
    // `author_filing` and sorts ahead of everything in its range. The alias gets
    // a real filing name, because `nameKey` folds on Unicode letters instead.
    //
    // The book row is deliberately unchanged: #180 does not fix #195, and this
    // asserts the defect is still exactly where it was rather than half moved.
    const id = await aBook({ title: 'Norwegian Wood', authors: ['村上春樹'] })

    expect((await shelving(id)).author_filing).toBe('')
    expect((await creditsOf(id))[0]!.filingName).toBe('村上春樹')
  })

  it('reuses a name it has seen, however the catalogue spells it', async () => {
    await aBook({ title: 'The Hobbit', authors: ['J. R. R. Tolkien'] })
    await aBook({ title: 'The Silmarillion', authors: ['J.R.R. Tolkien'] })

    const authors = await everyone()
    expect(authors).toHaveLength(1)
    expect(authors[0]!.aliases.map((one) => one.displayName)).toEqual(['J. R. R. Tolkien'])
  })
})

describe('restating who wrote a book', () => {
  it('drops a credit the new list leaves out', async () => {
    const id = await aBook({ title: 'The Talisman', authors: ['Stephen King', 'Peter Straub'] })
    await put(`/api/books/${id}/authors`, { authors: ['Peter Straub'] })

    expect((await creditsOf(id)).map((one) => one.displayName)).toEqual(['Peter Straub'])
  })

  it('refuses something that could not be a name', async () => {
    const id = await aBook()
    const { status, body } = await put(`/api/books/${id}/authors`, { authors: ['---'] })
    expect(status).toBe(400)
    expect(body.error).toContain('is not a name')
  })

  it('answers 404 for a book that is not there', async () => {
    expect((await call('/api/books/9999/authors')).status).toBe(404)
    expect((await put('/api/books/9999/authors', { authors: [] })).status).toBe(404)
  })
})

describe('filing a name differently', () => {
  it('changes what it files under and leaves what is printed alone', async () => {
    const id = await aBook({
      title: 'One Hundred Years of Solitude', authors: ['Gabriel García Márquez'],
    })
    const alias = (await everyone())[0]!.aliases[0]!

    const { status } = await patch(`/api/authors/aliases/${alias.id}`, {
      filingName: 'García Márquez, Gabriel',
    })
    expect(status).toBe(200)

    const after = (await everyone())[0]!.aliases[0]!
    expect([after.displayName, after.filingName])
      .toEqual(['Gabriel García Márquez', 'García Márquez, Gabriel'])
    // And it did not move the book, because the book files by its own column.
    expect((await shelving(id)).author_filing).toBe('Márquez, Gabriel García')
  })

  it('refuses an empty filing name and a name that is not there', async () => {
    await aBook()
    const alias = (await everyone())[0]!.aliases[0]!
    expect((await patch(`/api/authors/aliases/${alias.id}`, { filingName: '  ' })).status).toBe(400)
    expect((await patch('/api/authors/aliases/9999', { filingName: 'X' })).status).toBe(404)
  })
})

describe('two authors turning out to be one person', () => {
  it('answers everything by the person, and moves no book', async () => {
    const wasp = await aBook({ title: 'The Wasp Factory', authors: ['Iain Banks'] })
    const phlebas = await aBook({ title: 'Consider Phlebas', authors: ['Iain M. Banks'] })
    const before = [await shelving(wasp), await shelving(phlebas)]

    const [banks, banksM] = await everyone()
    const { status, body } = await post('/api/authors/merge', {
      intoId: banks!.id, fromId: banksM!.id,
    })
    expect(status).toBe(200)
    expect((body.author as AuthorView).aliases.map((one) => one.displayName))
      .toEqual(['Iain Banks', 'Iain M. Banks'])

    // "Everything by this person" is now one question with two answers in it,
    // which is what the comma-joined string could never do.
    const { body: byPerson } = await call(`/api/authors/${banks!.id}/books`)
    expect((byPerson.books as { title: string }[]).map((one) => one.title))
      .toEqual(['The Wasp Factory', 'Consider Phlebas'])

    // And the shelf is exactly where it was: the books credit the same aliases,
    // and the aliases file under the same names.
    expect([await shelving(wasp), await shelving(phlebas)]).toEqual(before)
  })

  it('refuses an author who is already themselves, or who is not there', async () => {
    await aBook()
    const [only] = await everyone()
    expect((await post('/api/authors/merge', { intoId: only!.id, fromId: only!.id })).status)
      .toBe(400)
    expect((await post('/api/authors/merge', { intoId: only!.id, fromId: 9999 })).status).toBe(404)
    expect((await post('/api/authors/merge', { intoId: 'x', fromId: 1 })).status).toBe(400)
  })

  it('answers 404 for an author who is not there', async () => {
    expect((await call('/api/authors/9999/books')).status).toBe(404)
  })
})

/**
 * The listing, asked the questions a screen showing books actually asks.
 *
 * `GET /api/books` answered one of them until #315: a whole run, in order. The
 * library and the find screen ask four more, and every one of them is here over
 * real HTTP against a real Postgres, because every one is SQL rather than
 * arithmetic and a fold that works in TypeScript and not in the database is a
 * search that silently answers nothing.
 *
 * The same harness as `tags.routes.test.ts`: `createApp()` on an ephemeral port,
 * the catalogues stubbed, no network.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { dropScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { PgDb } from './db.pg'
import { createApp, type BookScanApp } from './index'
import { Store, PAGE_LIMIT } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { lookupIsbn } from './lookup'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'

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

let pool: pg.Pool
let db: PgDb
let scratch: string
let coverDir: string
let app: BookScanApp
let server: Server
let baseUrl: string

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
  scratch = scratchRoot('listing')
})

beforeEach(async () => {
  await pool.query(
    'TRUNCATE books, book_authors, captures, book_tag, tag, author, author_alias, '
    + 'book_placement RESTART IDENTITY CASCADE',
  )
  answers.mockReset()
  answers.mockResolvedValue({ ...empty })

  coverDir = mkdtempSync(join(scratch, 'listing-test-'))
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
  await dropScratchDatabases()
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

async function aBook(fields: Record<string, unknown>) {
  const { body } = await post('/api/books', {
    title: 'Untitled', authors: ['Nobody'], genre: FICTION_SLUG, ...fields,
  })
  return Number(body.id)
}

/** The titles a listing answered, in the order it answered them. */
async function titles(query: string): Promise<string[]> {
  const { body } = await call(`/api/books${query}`)
  return (body.books as { title: string }[]).map((book) => book.title)
}

describe('what the listing answered before, which has not changed', () => {
  it('still means fiction when nobody says which run, and still says everything', async () => {
    await aBook({ title: 'Dune', isbn13: '9780441013593' })
    await aBook({ title: 'Cosmos', genre: NON_FICTION_SLUG, isbn13: '9780345331359' })

    const { body } = await call('/api/books')
    expect((body.books as unknown[]).length).toBe(1)
    expect(body.books[0].title).toBe('Dune')
    // The whole catalogue, not this query. Two screens read it for the number
    // under the title, and it is the denominator in "1 of 2".
    expect(body.counts.total).toBe(2)
    expect(body.total).toBe(1)
  })

  it('answers the other run when asked for it', async () => {
    await aBook({ title: 'Dune', isbn13: '9780441013593' })
    await aBook({ title: 'Cosmos', genre: NON_FICTION_SLUG, isbn13: '9780345331359' })

    expect(await titles('?range=nonfiction')).toEqual(['Cosmos'])
  })
})

describe('the whole collection, which is what the library draws', () => {
  it('runs fiction and then non-fiction, which is the order the bookcases stand in', async () => {
    await aBook({ title: 'Cosmos', authors: ['Carl Sagan'], genre: NON_FICTION_SLUG })
    await aBook({ title: 'Dune', authors: ['Frank Herbert'] })

    expect(await titles('?range=all')).toEqual(['Dune', 'Cosmos'])
  })
})

describe('finding a book by what somebody typed', () => {
  /*
   * The case the folding is actually for. "mieville" has no accent in it and the
   * author does, which is what a phone keyboard produces, and an exact match
   * would answer nothing and be wrong.
   */
  it('finds an accented name typed without its accents', async () => {
    await aBook({ title: 'The City and the City', authors: ['China Miéville'] })
    await aBook({ title: 'Dune', authors: ['Frank Herbert'] })

    expect(await titles('?range=all&q=mieville')).toEqual(['The City and the City'])
  })

  it('searches the title as well as the names on the cover', async () => {
    await aBook({ title: 'Wolf Hall', authors: ['Hilary Mantel'] })
    expect(await titles('?range=all&q=wolf')).toEqual(['Wolf Hall'])
  })

  it('makes every word narrow it further', async () => {
    await aBook({ title: 'The Left Hand of Darkness', authors: ['Ursula K. Le Guin'] })
    await aBook({ title: 'The Dispossessed', authors: ['Ursula K. Le Guin'] })

    expect(await titles('?range=all&q=guin')).toHaveLength(2)
    expect(await titles('?range=all&q=guin+dispossessed')).toEqual(['The Dispossessed'])
  })

  /*
   * A percent sign is a pattern to `LIKE` and a character to a person. Left
   * unescaped this answers the whole catalogue, which is the shape of failure
   * where a search looks like it works.
   */
  it('treats a pattern character as a character', async () => {
    await aBook({ title: 'Dune', authors: ['Frank Herbert'] })
    expect(await titles('?range=all&q=%25')).toEqual([])
  })

  it('answers nothing when nothing matches, rather than everything', async () => {
    await aBook({ title: 'Dune', authors: ['Frank Herbert'] })
    expect(await titles('?range=all&q=ovid')).toEqual([])
  })
})

describe('finding a book by its number', () => {
  it('answers the one book with that ISBN, in either form', async () => {
    await aBook({ title: 'Dune', isbn13: '9780441013593', isbn10: '0441013597' })
    await aBook({ title: 'Cosmos', isbn13: '9780345331359' })

    expect(await titles('?range=all&isbn=9780441013593')).toEqual(['Dune'])
    expect(await titles('?range=all&isbn=0441013597')).toEqual(['Dune'])
  })

  it('answers nothing for thirteen digits no book carries', async () => {
    await aBook({ title: 'Dune', isbn13: '9780441013593' })
    expect(await titles('?range=all&isbn=9781857231380')).toEqual([])
  })
})

describe('narrowing the library to a tag', () => {
  it('answers the books carrying it', async () => {
    const dune = await aBook({ title: 'Dune', isbn13: '9780441013593' })
    await aBook({ title: 'Cosmos', genre: NON_FICTION_SLUG, isbn13: '9780345331359' })
    await post(`/api/books/${dune}/tags`, { label: 'Lent out' })

    expect(await titles('?range=all&tag=lent-out')).toEqual(['Dune'])
  })

  /*
   * The rule the count on the tags screen has to agree with. The hierarchy is in
   * the slug, so choosing Fantasy is asking for everything under it, and a book
   * somebody tagged Urban fantasy is a fantasy book.
   */
  it('answers the books under it as well as the books carrying it', async () => {
    const one = await aBook({ title: 'Piranesi', isbn13: '9781635575637' })
    const two = await aBook({ title: 'Rivers of London', isbn13: '9780575097568' })
    await post(`/api/books/${one}/tags`, { slug: 'genre/fantasy' })
    await post(`/api/books/${two}/tags`, { slug: 'genre/fantasy/urban' })

    expect((await titles('?range=all&tag=genre/fantasy')).sort())
      .toEqual(['Piranesi', 'Rivers of London'])
  })

  it('makes two tags mean both of them', async () => {
    const one = await aBook({ title: 'Piranesi', isbn13: '9781635575637' })
    const two = await aBook({ title: 'Dune', isbn13: '9780441013593' })
    await post(`/api/books/${one}/tags`, { slug: 'genre/fantasy' })
    await post(`/api/books/${one}/tags`, { label: 'Lent out' })
    await post(`/api/books/${two}/tags`, { slug: 'genre/fantasy' })

    expect(await titles('?range=all&tag=genre/fantasy&tag=lent-out')).toEqual(['Piranesi'])
  })

  it('refuses something that is not a tag rather than ignoring it', async () => {
    const { status } = await call('/api/books?range=all&tag=%20')
    expect(status).toBe(400)
  })
})

describe('a page of a listing, which is what makes this screen survive growing', () => {
  it('answers a page and says how many there are', async () => {
    for (const title of ['Aaa', 'Bbb', 'Ccc', 'Ddd', 'Eee']) {
      await aBook({ title, authors: [title] })
    }

    const first = await call('/api/books?range=all&limit=2')
    expect((first.body.books as unknown[]).length).toBe(2)
    expect(first.body.total).toBe(5)

    const second = await call('/api/books?range=all&limit=2&offset=2')
    expect((second.body.books as unknown[]).length).toBe(2)
    // The same query, further along it: no book appears in both pages.
    expect(second.body.books[0].id).not.toBe(first.body.books[0].id)
    expect(second.body.total).toBe(5)
  })

  /**
   * #332's finding 4. An absent `limit` used to mean no `LIMIT` clause at all,
   * so `GET /api/books?range=all` was 1204 KB at 1200 books, and an unbounded
   * response was what you got for forgetting a parameter.
   *
   * Seeded through `Store` rather than through the route, because five hundred
   * and one saves over HTTP is a minute this suite should not spend to prove one
   * `LIMIT`. It is still the whole route being asked, over real HTTP, against
   * rows a real save wrote.
   */
  it('answers one page at most when nobody asked for a page', async () => {
    const store = new Store(db, new DrizzleAuthorRepository(db))
    for (let n = 0; n <= PAGE_LIMIT; n += 1) {
      await store.addBook({
        title: `Book ${n}`,
        authors: [`Author ${String(n).padStart(4, '0')}`],
        genre: FICTION_SLUG,
      })
    }

    const { body } = await call('/api/books?range=all')
    expect((body.books as unknown[]).length).toBe(PAGE_LIMIT)
    // And it still says how many there really are, which is what the screen
    // needs to know there is another page to ask for.
    expect(body.total).toBe(PAGE_LIMIT + 1)
    expect(body.counts.total).toBe(PAGE_LIMIT + 1)

    // The rest is reachable, so nothing has become unreadable by being past the
    // page: it has become something a caller has to ask for.
    const rest = await call(`/api/books?range=all&offset=${PAGE_LIMIT}`)
    expect((rest.body.books as unknown[]).length).toBe(1)
  }, 300_000)

  it('counts what the query matches rather than what the page holds', async () => {
    for (const title of ['Aaa', 'Bbb', 'Ccc']) await aBook({ title, authors: ['Le Guin'] })
    await aBook({ title: 'Dune', authors: ['Frank Herbert'] })

    const { body } = await call('/api/books?range=all&q=guin&limit=1')
    expect((body.books as unknown[]).length).toBe(1)
    expect(body.total).toBe(3)
    expect(body.counts.total).toBe(4)
  })
})

describe('how many books a tag has', () => {
  it('is said beside every tag, and counts the ones under it', async () => {
    const one = await aBook({ title: 'Piranesi', isbn13: '9781635575637' })
    const two = await aBook({ title: 'Rivers of London', isbn13: '9780575097568' })
    await post(`/api/books/${one}/tags`, { slug: 'genre/fantasy' })
    await post(`/api/books/${two}/tags`, { slug: 'genre/fantasy/urban' })

    const { body } = await call('/api/tags')
    const counted = new Map(
      (body.tags as { slug: string; books: number }[]).map((tag) => [tag.slug, tag.books]),
    )

    expect(counted.get('genre/fantasy')).toBe(2)
    expect(counted.get('genre/fantasy/urban')).toBe(1)
  })

  it('counts a book once however many tags under one it carries', async () => {
    const one = await aBook({ title: 'Piranesi', isbn13: '9781635575637' })
    await post(`/api/books/${one}/tags`, { slug: 'genre/fantasy' })
    await post(`/api/books/${one}/tags`, { slug: 'genre/fantasy/urban' })

    const { body } = await call('/api/tags')
    const counted = new Map(
      (body.tags as { slug: string; books: number }[]).map((tag) => [tag.slug, tag.books]),
    )
    expect(counted.get('genre/fantasy')).toBe(1)
  })
})

describe('where a book has been', () => {
  it('reads back the rows the ledger already wrote', async () => {
    const id = await aBook({ title: 'Dune', isbn13: '9780441013593' })
    await post(`/api/books/${id}/checkout`, { out: true })

    const { body } = await call(`/api/books/${id}/placements`)
    expect(body.total).toBeGreaterThan(0)
    expect((body.been as { kind: string }[])[0]?.kind).toBe('checked_out')
  })

  it('says so about a book that is not there', async () => {
    const { status } = await call('/api/books/9999/placements')
    expect(status).toBe(404)
  })
})

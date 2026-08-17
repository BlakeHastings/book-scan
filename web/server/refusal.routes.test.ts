/**
 * The two ways this API used to answer a request nobody meant to make (#332).
 *
 * Both were measured in `docs/api-review.md` rather than guessed at, and both
 * are about the same thing: what the API says when the request is wrong.
 *
 * 1. **A malformed id was a 500 on nineteen routes and a clean 404 on six.**
 *    `Number('notanumber')` is `NaN`, which reached Postgres and came back as
 *    `invalid input syntax for type integer: "NaN"`, so a client typo was
 *    written to the log as `[api] unhandled route error:` with a stack trace on
 *    it. The furniture routes answered properly because they had a `Refused`
 *    union to go through; nobody else did.
 * 2. **An unknown path under /api answered HTML.** There was no catch-all before
 *    the error handler, so Express's own finaliser answered with a page, and
 *    `src/lib/api.ts` parses every body as JSON to find the `error` field. A
 *    renamed route therefore surfaced in the app as a parse failure.
 *
 * Every case here is driven over real HTTP against a real Postgres, because
 * both defects were about what reaches the database and what leaves the server,
 * and neither is visible from a handler called directly.
 *
 * The harness is `listing.routes.test.ts`'s: `createApp()` on an ephemeral port
 * with the catalogues stubbed, so no network.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { PgDb } from './db.pg'
import { createApp, type BookScanApp } from './index'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'

const empty = {
  found: false, title: '', subtitle: '', authors: [] as string[], publisher: '',
  published: '', pages: '', isbn13: '', isbn10: '', seriesName: '', seriesIndex: null,
  coverUrl: '', source: '',
  classification: { genre: FICTION_SLUG, confidence: 'unknown' as const, reason: 'stub' },
  notes: [] as string[], subjects: [] as string[], categories: [] as string[],
}

vi.mock('./lookup', () => ({
  lookupIsbn: vi.fn(async () => ({ ...empty })),
  searchTitle: vi.fn(async () => ({ ...empty })),
}))

vi.mock('./covers', () => ({
  downloadCover: vi.fn(async () => ''),
  openLibraryCover: (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
  upgradeGoogleCover: (url: string) => url,
}))

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
  scratch = scratchRoot('refusal')
})

beforeEach(async () => {
  await pool.query(
    'TRUNCATE books, book_authors, captures, book_tag, tag, author, author_alias, '
    + 'book_placement RESTART IDENTITY CASCADE',
  )
  coverDir = mkdtempSync(join(scratch, 'refusal-test-'))
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
  await closeScratchDatabases()
  removeScratchRoot(scratch)
})

/** A request, answered the way the client reads one: status, type and body. */
async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
  })
  const text = await response.text()
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    text,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  }
}

const send = (method: string) => (path: string, body: unknown = {}) =>
  call(path, { method, body: JSON.stringify(body) })

const post = send('POST')
const put = send('PUT')
const patch = send('PATCH')
const del = (path: string) => call(path, { method: 'DELETE' })

async function aBook(): Promise<number> {
  const { body } = await post('/api/books', {
    title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, isbn13: '9780441013593',
  })
  return Number(body!.id)
}

// ---------------------------------------------------------------------------
// 1. A malformed id
// ---------------------------------------------------------------------------

/**
 * Every route that takes an id, and what it calls the thing it could not find.
 *
 * Written as a table rather than as thirty tests, because the point of the fix
 * is that there is one answer and the routes stopped disagreeing about it. A
 * route added here without a guard fails as soon as it is added to the table,
 * which is the only kind of coverage that keeps a convention alive.
 */
interface Guarded {
  method: string
  /** The path, with the id put where the route takes it. */
  at: (id: string) => string
  /** What the route calls the thing it could not find. */
  missing: string
  body?: unknown
  /**
   * Whether an id that is merely unused answers the same thing.
   *
   * True for every route that looks the row up and refuses. It is false for the
   * four whose "nothing has that id" answer was already something else and is
   * not this issue's to change: claiming and editing a capture answer through
   * the queue's own outcomes, and removing a boundary answers with the shelves.
   */
  unusedIdToo?: boolean
}

const ROUTES: Guarded[] = [
  { method: 'GET', at: (id) => `/api/captures/${id}`, missing: 'No such capture.', unusedIdToo: true },
  { method: 'POST', at: (id) => `/api/captures/${id}/claim`, missing: 'No such capture.' },
  { method: 'PATCH', at: (id) => `/api/captures/${id}`, missing: 'No such capture.' },
  { method: 'DELETE', at: (id) => `/api/captures/${id}`, missing: 'No such capture.', unusedIdToo: true },
  { method: 'DELETE', at: (id) => `/api/shelves/${id}`, missing: 'No such boundary.' },
  { method: 'GET', at: (id) => `/api/books/${id}`, missing: 'No such book.', unusedIdToo: true },
  { method: 'GET', at: (id) => `/api/books/${id}/placements`, missing: 'No such book.', unusedIdToo: true },
  { method: 'PUT', at: (id) => `/api/books/${id}`, missing: 'No such book.', unusedIdToo: true },
  { method: 'GET', at: (id) => `/api/books/${id}/claim`, missing: 'No such book.', unusedIdToo: true },
  { method: 'GET', at: (id) => `/api/books/${id}/tags`, missing: 'No such book.', unusedIdToo: true },
  { method: 'POST', at: (id) => `/api/books/${id}/tags`, missing: 'No such book.', unusedIdToo: true },
  { method: 'DELETE', at: (id) => `/api/books/${id}/tags`, missing: 'No such book.', unusedIdToo: true },
  { method: 'POST', at: (id) => `/api/books/${id}/tags/refresh`, missing: 'No such book.', unusedIdToo: true },
  { method: 'GET', at: (id) => `/api/books/${id}/authors`, missing: 'No such book.', unusedIdToo: true },
  { method: 'PUT', at: (id) => `/api/books/${id}/authors`, missing: 'No such book.', unusedIdToo: true },
  { method: 'GET', at: (id) => `/api/books/${id}/captures`, missing: 'No such book.', unusedIdToo: true },
  { method: 'PATCH', at: (id) => `/api/books/${id}/location`, missing: 'No such book.', unusedIdToo: true },
  { method: 'DELETE', at: (id) => `/api/books/${id}`, missing: 'No such book.', unusedIdToo: true },
  { method: 'POST', at: (id) => `/api/books/${id}/checkout`, missing: 'No such book.', unusedIdToo: true },
  { method: 'GET', at: (id) => `/api/authors/${id}/books`, missing: 'No such author.', unusedIdToo: true },
  {
    method: 'PATCH',
    at: (id) => `/api/authors/aliases/${id}`,
    missing: 'No such name.',
    body: { filingName: 'Herbert, Frank' },
    unusedIdToo: true,
  },
  { method: 'GET', at: (id) => `/api/fixtures/${id}`, missing: 'No such piece of furniture.', unusedIdToo: true },
  { method: 'PATCH', at: (id) => `/api/fixtures/${id}`, missing: 'No such piece of furniture.', unusedIdToo: true },
  { method: 'GET', at: (id) => `/api/fixtures/${id}/removal`, missing: 'No such piece of furniture.', unusedIdToo: true },
  { method: 'DELETE', at: (id) => `/api/fixtures/${id}`, missing: 'No such piece of furniture.', unusedIdToo: true },
  { method: 'POST', at: (id) => `/api/fixtures/${id}/areas`, missing: 'No such piece of furniture.', unusedIdToo: true },
  { method: 'PATCH', at: (id) => `/api/areas/${id}`, missing: 'No such area.', unusedIdToo: true },
  { method: 'GET', at: (id) => `/api/areas/${id}/books`, missing: 'No such area.', unusedIdToo: true },
  { method: 'GET', at: (id) => `/api/areas/${id}/removal`, missing: 'No such area.', unusedIdToo: true },
  { method: 'DELETE', at: (id) => `/api/areas/${id}`, missing: 'No such area.', unusedIdToo: true },
]

const ask = (route: Guarded, id: string) =>
  (route.method === 'GET' ? call(route.at(id))
    : route.method === 'DELETE' ? del(route.at(id))
      : send(route.method)(route.at(id), route.body ?? {}))

const named = (route: Guarded) => `${route.method} ${route.at(':id')}`

describe('an id that is not a number', () => {
  it.each(ROUTES.map((route) => [named(route), route] as const))(
    '%s answers 404 and not 500',
    async (_name, route) => {
      const answered = await ask(route, 'notanumber')
      expect(answered.status, answered.text).toBe(404)
      expect(answered.body).toEqual({ error: route.missing })
    },
  )

  it.each(ROUTES.filter((r) => r.unusedIdToo).map((route) => [named(route), route] as const))(
    '%s says the same for an id nothing has',
    async (_name, route) => {
      // The two are one answer on purpose. A client cannot act differently on
      // "that is not an id" and "nothing has that id", and splitting them would
      // be a second thing for every route to get right for nobody's benefit.
      const answered = await ask(route, '987654')
      expect(answered.status, answered.text).toBe(404)
      expect(answered.body).toEqual({ error: route.missing })
    },
  )

  it('refuses a fraction, a negative and a zero, which name no row either', async () => {
    // A row id is a `serial`. Every one of these is a number and none of them
    // can ever be an id, so the guard is "a positive integer" rather than
    // "not NaN": `Number('1.5')` reaches Postgres perfectly happily.
    for (const id of ['1.5', '-3', '0']) {
      const answered = await call(`/api/books/${id}`)
      expect(answered.status, `id ${JSON.stringify(id)}: ${answered.text}`).toBe(404)
      expect(answered.body).toEqual({ error: 'No such book.' })
    }
  })

  it('still answers a real id exactly as it did', async () => {
    const id = await aBook()
    const answered = await call(`/api/books/${id}`)

    expect(answered.status).toBe(200)
    expect((answered.body!.book as { title: string }).title).toBe('Dune')
    expect(Array.isArray(answered.body!.authors)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. A path no route answers
// ---------------------------------------------------------------------------

describe('a path under /api that no route matches', () => {
  it('answers JSON rather than Express\'s own HTML page', async () => {
    const answered = await call('/api/does-not-exist')

    expect(answered.status).toBe(404)
    expect(answered.type).toContain('application/json')
    expect(answered.body).toEqual({ error: 'Not found.' })
    // The specific failure this closes: the client parses every body to find
    // `error`, so an HTML page surfaced as the parser's message, not the API's.
    expect(answered.text).not.toContain('<!DOCTYPE')
  })

  it('answers the same for every method, not only GET', async () => {
    for (const answered of [
      await post('/api/nope'),
      await put('/api/nope'),
      await patch('/api/nope'),
      await del('/api/nope'),
    ]) {
      expect(answered.status).toBe(404)
      expect(answered.body).toEqual({ error: 'Not found.' })
    }
  })

  it('answers a route that exists under a method it does not take', async () => {
    // `/api/health` is a GET. A POST to it matched no route before this and got
    // the HTML page; it is the same miss as a mistyped path.
    const answered = await post('/api/health')
    expect(answered.status).toBe(404)
    expect(answered.body).toEqual({ error: 'Not found.' })
  })

  it('leaves a missing cover answering as it always did', async () => {
    // The static mount runs with `fallthrough: false` and is registered before
    // the catch-all, so its miss still arrives at the error handler rather than
    // here. Same status, and the catch-all must not have taken it over.
    const answered = await call('/api/covers/nothing-here.jpg')
    expect(answered.status).toBe(404)
    expect(answered.body).toEqual({ error: 'Not found.' })
  })
})

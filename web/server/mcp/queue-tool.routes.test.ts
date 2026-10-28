/**
 * `list_queue` and the queue's counts in `collection_summary`, called by the
 * SDK's own client after the whole OAuth flow, against a scratch catalogue with
 * a queue in every status. The numbers are checked against the two reads the
 * first screen is drawn from, `GET /api/health` and `GET /api/captures`, on
 * the same database, because a model and the person must not be told two
 * different things about one collection.
 *
 * The queued rows are written by hand: the worker that would write them reads
 * photographs, and background work is off.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { removeScratchRoot, scratchRoot } from '../scratchdir'
import { closeTestDatabase, openTestDatabase } from '../testdb'
import { testBooks } from '../testbooks'
import type { Db } from '../driver'
import { createApp, type BookScanApp } from '../index'
import { devProvider } from '../auth/providers'
import { signedIn } from '../testauth'
import { Store } from '../store'
import { photographTaken } from '../photographs'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { DrizzleAuthorRepository } from '../../infrastructure/authorship/author-repository'
import { connect } from './testclient'

vi.mock('../lookup', () => ({
  lookupIsbn: vi.fn(),
  searchTitle: vi.fn(),
}))

vi.mock('../covers', () => ({
  downloadCover: vi.fn(async () => ''),
  openLibraryCover: (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
  upgradeGoogleCover: (url: string) => url,
}))

const NOW = '2026-10-28T09:00:00.000Z'
const DEVICE = 'Blake\'s phone'

let db: Db
let scratch: string
let app: BookScanApp
let server: Server
let client: Client
let origin = ''
let cookie = ''

const seeded = { found: 0, corrected: 0, noIsbn: 0, uncatalogued: 0, unread: 0, discarded: 0 }

async function queued(row: {
  state: string
  isbn13?: string
  titleGuess?: string
  draft?: unknown
  edit?: unknown
  claimedBy?: string
}): Promise<number> {
  const made = await db.get<{ id: number }>(
    `INSERT INTO books (title, title_guess, isbn13, draft_json, edit_json, claimed_by, claimed_at,
                        edited_by, shelf_range, sort_key, scanned_at, state)
     VALUES ('', ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?) RETURNING id`,
    [
      row.titleGuess ?? '', row.isbn13 ?? '',
      row.draft === undefined ? '' : JSON.stringify(row.draft),
      row.edit === undefined ? '' : JSON.stringify(row.edit),
      row.claimedBy ?? '', row.claimedBy ? NOW : null, row.claimedBy ?? '',
      NOW, row.state,
    ],
  )
  return Number(made?.id)
}

async function seed(): Promise<void> {
  const books = testBooks(db)
  const store = new Store(db, new DrizzleAuthorRepository(db))
  await books.catalogue({ genre: FICTION_SLUG, title: 'Persuasion', authors: ['Jane Austen'] })
  const lent = await books.catalogue({ genre: FICTION_SLUG, title: 'Emma', authors: ['Jane Austen'] })
  await store.setCheckedOut(lent.id, true)

  seeded.found = await queued({
    state: 'identified',
    isbn13: '9780441013593',
    titleGuess: 'DUNE',
    draft: { found: true, title: 'Dune', authors: ['Frank Herbert'], isbn13: '9780441013593' },
    claimedBy: DEVICE,
  })
  await photographTaken(db, seeded.found, 'back', 'found-back.jpg', NOW)
  await photographTaken(db, seeded.found, 'front', 'found-front.jpg', NOW)

  seeded.corrected = await queued({
    state: 'identified',
    isbn13: '9780000000019',
    draft: { found: true, title: 'A Wrong Title', authors: ['Somebody Else'] },
    edit: { title: 'The Right Title', authors: ['A Person', 'Another'] },
  })
  seeded.noIsbn = await queued({ state: 'unidentified', titleGuess: 'blurry words' })
  seeded.uncatalogued = await queued({ state: 'unidentified', isbn13: '9780000000026' })
  seeded.unread = await queued({ state: 'scanned' })
  seeded.discarded = await queued({ state: 'discarded', titleGuess: 'a mistake' })
}

beforeAll(async () => {
  scratch = scratchRoot('mcp-queue-tool')
  db = await openTestDatabase()
  await seed()

  server = createServer()
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  app = createApp({
    db,
    coverDir: mkdtempSync(join(scratch, 'covers-')),
    startBackgroundWork: false,
    signIn: { providers: [devProvider('mcp-tester')], publicOrigin: origin },
  })
  server.on('request', app)

  const person = await signedIn(db)
  cookie = person.cookie
  client = (await connect(origin, person.cookie)).client
})

afterAll(async () => {
  await client?.close()
  await app?.settled()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeTestDatabase()
  removeScratchRoot(scratch)
})

async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError ?? false, JSON.stringify(result.content)).toBe(false)
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? ''
  expect(JSON.parse(text)).toEqual(result.structuredContent)
  return result.structuredContent as T
}

/** One of the reads the first screen is drawn from, as the app's own session makes it. */
async function today<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, origin), { headers: { Cookie: cookie } })
  expect(response.status, path).toBe(200)
  return await response.json() as T
}

type Queued = {
  book_id: number
  status: string
  title: string
  title_guess: string
  authors: string
  isbn13: string
  stuck_because: string | null
  scanned_at: string
  photographs: string[]
}
type QueuePage = { total: number; offset: number; limit: number; next_offset: number | null; books: Queued[] }

describe('list_queue', () => {
  it('lists every queued book oldest first, in the first screen\'s words, and nothing that has left the queue', async () => {
    const page = await call<QueuePage>('list_queue')
    expect(page).toMatchObject({ total: 5, offset: 0, limit: 25, next_offset: null })
    expect(page.books).toEqual([
      {
        book_id: seeded.found, status: 'ready_to_shelve', title: 'Dune', title_guess: 'DUNE',
        authors: 'Frank Herbert', isbn13: '9780441013593', stuck_because: null, scanned_at: NOW,
        photographs: ['front', 'back'],
      },
      {
        book_id: seeded.corrected, status: 'ready_to_shelve', title: 'The Right Title', title_guess: '',
        authors: 'A Person, Another', isbn13: '9780000000019', stuck_because: null, scanned_at: NOW,
        photographs: [],
      },
      {
        book_id: seeded.noIsbn, status: 'stuck', title: '', title_guess: 'blurry words', authors: '',
        isbn13: '', stuck_because: 'needs an ISBN', scanned_at: NOW, photographs: [],
      },
      {
        book_id: seeded.uncatalogued, status: 'stuck', title: '', title_guess: '', authors: '',
        isbn13: '9780000000026', stuck_because: 'no catalogue has its ISBN', scanned_at: NOW, photographs: [],
      },
      {
        book_id: seeded.unread, status: 'being_read', title: '', title_guess: '', authors: '',
        isbn13: '', stuck_because: null, scanned_at: NOW, photographs: [],
      },
    ])
  })

  it('narrows by status and pages', async () => {
    const stuck = await call<QueuePage>('list_queue', { status: 'stuck' })
    expect(stuck.books.map((book) => book.book_id)).toEqual([seeded.noIsbn, seeded.uncatalogued])

    const first = await call<QueuePage>('list_queue', { limit: 2 })
    expect(first).toMatchObject({ total: 5, next_offset: 2 })
    const last = await call<QueuePage>('list_queue', { limit: 2, offset: 4 })
    expect(last.books.map((book) => book.book_id)).toEqual([seeded.unread])
    expect(last.next_offset).toBeNull()
  })

  it('says nothing about who holds a book or who edited it', async () => {
    const result = await client.callTool({ name: 'list_queue', arguments: {} })
    const text = JSON.stringify(result)
    expect(text).not.toContain(DEVICE)
    expect(text).not.toMatch(/claim|edited_by|edit_json|draft_json/)
  })

  it('refuses a status the first screen does not use', async () => {
    const result = await client.callTool({ name: 'list_queue', arguments: { status: 'pending' } })
    expect(result.isError).toBe(true)
  })
})

describe('the descriptions', () => {
  it('send the person to the app to finish a queued book, and warn off add_book', async () => {
    const tools = (await client.listTools()).tools
    for (const name of ['list_queue', 'collection_summary']) {
      const description = tools.find((tool) => tool.name === name)?.description ?? ''
      expect(description, name).toMatch(/only in the book-scan app, by a person with the book in hand/)
      expect(description, name).toMatch(/Do not call add_book with a queued book's ISBN/)
    }
    expect(tools.find((tool) => tool.name === 'search_books')?.description).toMatch(/list_queue lists them/)
    expect(tools.find((tool) => tool.name === 'list_queue')?.annotations)
      .toEqual({ readOnlyHint: true, openWorldHint: false })
  })
})

describe('the numbers a model is told and the numbers the first screen draws', () => {
  it('are the same numbers, from the same database', async () => {
    const summary = await call<Record<string, number>>('collection_summary')
    const { counts } = await today<{ counts: { total: number; checkedOut: number } }>('/api/health')
    const queue = await today<{ captures: { id: number; status: string }[]; counts: Record<string, number> }>(
      '/api/captures',
    )

    // "catalogued" and "checked out" on the first screen.
    expect(summary.total).toBe(counts.total)
    expect(summary.checked_out).toBe(counts.checkedOut)
    // "ready to shelve" and "stuck", and the books still being read beside them.
    expect(summary.ready_to_shelve).toBe(queue.counts.ready)
    expect(summary.stuck).toBe(queue.counts.failed)
    expect(summary.being_read).toBe(queue.counts.pending)
    expect([summary.ready_to_shelve, summary.stuck, summary.being_read]).toEqual([2, 2, 1])

    for (const [status, count] of [
      ['ready_to_shelve', queue.counts.ready],
      ['stuck', queue.counts.failed],
      ['being_read', queue.counts.pending],
    ] as const) {
      expect((await call<QueuePage>('list_queue', { status })).total, status).toBe(count)
    }

    // One list, so the rows behind the counts are the same rows too.
    const listed = await call<QueuePage>('list_queue', { limit: 100 })
    expect(listed.books.map((book) => book.book_id)).toEqual(queue.captures.map((capture) => capture.id))
  })

  it('leave the catalogue\'s own keys as they were', async () => {
    expect(await call('collection_summary')).toEqual({
      total: 2, fiction: 2, nonfiction: 0, checked_out: 1, unplaced: 0,
      ready_to_shelve: 2, stuck: 2, being_read: 1,
    })
  })
})

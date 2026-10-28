/**
 * The read tools, called by the SDK's own client after the whole OAuth flow,
 * against one seeded scratch catalogue. Every tool here only reads, so the
 * catalogue is built once for the file rather than per test.
 *
 * The catalogues outside are taken off the network the way the route tests
 * take them off it: `./lookup` is mocked, and `lookup_isbn` reaches the mock
 * through the same handler the `/api/lookup/isbn` route calls.
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
import { Store, type DraftBook } from '../store'
import { lookupIsbn } from '../lookup'
import { PrintedName } from '../../domain/authorship/authors'
import { TagSlug } from '../../domain/tagging/tags'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { DrizzleAuthorRepository } from '../../infrastructure/authorship/author-repository'
import { DrizzleTagRepository } from '../../infrastructure/tagging/tag-repository'
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

const DUNE_ISBN = '9780441013593'
const NOW = '2026-10-28T09:00:00.000Z'

let db: Db
let scratch: string
let app: BookScanApp
let server: Server
let client: Client

const seeded = {
  dune: 0, children: 0, sapiens: 0, city: 0, kraken: 0, queued: 0,
  herbert: 0, mieville: 0,
}

async function seed(): Promise<void> {
  const authors = new DrizzleAuthorRepository(db)
  const tags = new DrizzleTagRepository(db)
  const store = new Store(db, authors)
  const books = testBooks(db)
  const authorIds = new Map<string, number>()

  /** Saved as a scan is saved, which credits the names beside the row. */
  async function shelve(over: Partial<DraftBook> & { title: string; authors: string[] }): Promise<number> {
    const { id } = await books.catalogue({ genre: FICTION_SLUG, ...over })
    for (const name of over.authors) {
      authorIds.set(name, (await authors.aliasFor(PrintedName.of(name)))!.authorId)
    }
    return id
  }

  async function tag(bookId: number, slug: string, label: string): Promise<void> {
    await tags.define(TagSlug.of(slug), label)
    await tags.apply(bookId, [{ slug: TagSlug.of(slug), source: 'person', confidence: 'high', addedAt: NOW }])
  }

  seeded.dune = await shelve({
    title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE_ISBN, location: '1A',
    seriesName: 'Dune', seriesIndex: 1,
  })
  seeded.children = await shelve({ title: 'Children of Dune', authors: ['Frank Herbert'] })
  seeded.sapiens = await shelve({ title: 'Sapiens', authors: ['Yuval Noah Harari'], genre: NON_FICTION_SLUG })
  seeded.city = await shelve({ title: 'The City & the City', authors: ['China Miéville'] })
  seeded.kraken = await shelve({ title: 'Kraken', authors: ['China Miéville'] })
  await store.setCheckedOut(seeded.kraken, true)
  // A save records where a book lands, so the reset in Settings is how the
  // others come to be on no plank: everything off, then Dune back on 1A.
  await store.unplaceEveryBook()
  await store.setLocation(seeded.dune, '1A')

  await tag(seeded.dune, 'genre/fiction/space-opera', 'Space opera')
  await tag(seeded.city, 'genre/fiction/weird', 'Weird fiction')

  const queued = await db.get<{ id: number }>(
    `INSERT INTO books (title, title_guess, shelf_range, sort_key, scanned_at, state)
     VALUES ('', 'Half a cover', 'fiction', 'half', ?, 'scanned') RETURNING id`,
    [NOW],
  )
  seeded.queued = Number(queued?.id)

  seeded.herbert = authorIds.get('Frank Herbert')!
  seeded.mieville = authorIds.get('China Miéville')!
}

beforeAll(async () => {
  scratch = scratchRoot('mcp-read-tools')
  db = await openTestDatabase()
  await seed()

  server = createServer()
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  app = createApp({
    db,
    coverDir: mkdtempSync(join(scratch, 'covers-')),
    startBackgroundWork: false,
    signIn: { providers: [devProvider('mcp-tester')], publicOrigin: origin },
  })
  server.on('request', app)

  const person = await signedIn(db)
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

/** A tool's answer, checked to carry the same thing as structure and as text. */
async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError ?? false, JSON.stringify(result.content)).toBe(false)
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? ''
  expect(JSON.parse(text)).toEqual(result.structuredContent)
  return result.structuredContent as T
}

async function refusal(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError).toBe(true)
  return (result.content as { text: string }[])[0]?.text ?? ''
}

type Books = { total: number; next_offset: number | null; books: { book_id: number; title: string }[] }
const titles = (answer: Books) => answer.books.map((book) => book.title)

describe('the tool list', () => {
  it('lists every read tool, each annotated read-only with an input and an output schema', async () => {
    const listed = (await client.listTools()).tools
    expect(listed.map((tool) => tool.name).sort()).toEqual([
      'add_book', 'collection_summary', 'get_author_books', 'get_book', 'list_authors', 'list_tags',
      'lookup_isbn', 'search_books', 'tag_book', 'untag_book', 'update_book', 'whoami',
    ])
    // The write tools are write-tools.routes.test.ts's.
    const tools = listed.filter((tool) => tool.annotations?.readOnlyHint)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true)
      expect(tool.inputSchema.type, tool.name).toBe('object')
      expect(tool.outputSchema?.type, tool.name).toBe('object')
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(40)
    }
    // Only the lookup leaves this server.
    expect(tools.filter((tool) => tool.annotations?.openWorldHint).map((tool) => tool.name)).toEqual(['lookup_isbn'])
  })
})

describe('search_books', () => {
  it('pages through the catalogue in shelf order, never listing a queued book', async () => {
    // Herbert's series files Dune first; Miéville's titles file without their article.
    const all = await call<Books>('search_books')
    expect(all.total).toBe(5)
    expect(titles(all)).toEqual(['Dune', 'Children of Dune', 'The City & the City', 'Kraken', 'Sapiens'])
    expect(all.next_offset).toBeNull()

    const first = await call<Books>('search_books', { limit: 2 })
    expect(titles(first)).toEqual(['Dune', 'Children of Dune'])
    expect(first).toMatchObject({ total: 5, offset: 0, limit: 2, next_offset: 2 })
    const next = await call<Books>('search_books', { limit: 2, offset: first.next_offset })
    expect(titles(next)).toEqual(['The City & the City', 'Kraken'])
    const last = await call<Books>('search_books', { limit: 2, offset: 4 })
    expect(titles(last)).toEqual(['Sapiens'])
    expect(last.next_offset).toBeNull()
  })

  it('finds words in titles and names, accents optional', async () => {
    expect(titles(await call<Books>('search_books', { words: 'dune' }))).toEqual(['Dune', 'Children of Dune'])
    expect(titles(await call<Books>('search_books', { words: 'mieville city' }))).toEqual(['The City & the City'])
  })

  it('narrows by tag at or under a slug, range, state, placement, isbn and author', async () => {
    // Every fiction book carries `genre/fiction`, since a save writes the tag.
    expect(titles(await call<Books>('search_books', { tags: ['genre/fiction'] })))
      .toEqual(['Dune', 'Children of Dune', 'The City & the City', 'Kraken'])
    expect(titles(await call<Books>('search_books', { tags: ['genre/fiction/weird'] })))
      .toEqual(['The City & the City'])
    expect(titles(await call<Books>('search_books', { range: 'nonfiction' }))).toEqual(['Sapiens'])
    expect(titles(await call<Books>('search_books', { state: 'checked_out' }))).toEqual(['Kraken'])
    expect(titles(await call<Books>('search_books', { placed: true }))).toEqual(['Dune'])
    expect(titles(await call<Books>('search_books', { isbn: '0441013597' }))).toEqual(['Dune'])
    expect(titles(await call<Books>('search_books', { author_id: seeded.mieville })))
      .toEqual(['The City & the City', 'Kraken'])
    expect(titles(await call<Books>('search_books', { author_id: seeded.mieville, state: 'shelved' })))
      .toEqual(['The City & the City'])
  })

  it('answers a short record, with no photograph and no internal field', async () => {
    const [dune] = (await call<{ books: Record<string, unknown>[] }>('search_books', { words: 'dune', placed: true })).books
    expect(dune).toEqual({
      book_id: seeded.dune, title: 'Dune', subtitle: '', authors: 'Frank Herbert', isbn13: DUNE_ISBN,
      published: '', range: 'fiction', state: 'shelved', location: '1A', series_name: 'Dune', series_index: 1,
    })
  })

  it('refuses something that is not a tag, saying where the tags are', async () => {
    expect(await refusal('search_books', { tags: ['///'] })).toContain('list_tags')
  })

  it('refuses a page larger than the largest, before running anything', async () => {
    const result = await client.callTool({ name: 'search_books', arguments: { limit: 1000 } })
    expect(result.isError).toBe(true)
  })
})

describe('get_book', () => {
  it('answers a shelved book with its tags, credits and place', async () => {
    const dune = await call('get_book', { book_id: seeded.dune })
    expect(dune).toMatchObject({
      book_id: seeded.dune, title: 'Dune', state: 'shelved', location: '1A', isbn10: '0441013597',
      checked_out_at: null, photographs: [],
      credits: [{ position: 1, author_id: seeded.herbert, name: 'Frank Herbert', files_under: 'Herbert, Frank' }],
    })
    expect((dune as { tags: unknown[] }).tags).toContainEqual(
      { slug: 'genre/fiction/space-opera', label: 'Space opera', source: 'person', confidence: 'high' },
    )
    expect(JSON.stringify(dune)).not.toContain('/api/')
  })

  it('answers a book still in the queue, which no search lists', async () => {
    expect(await call('get_book', { book_id: seeded.queued })).toMatchObject({
      book_id: seeded.queued, title: '', title_guess: 'Half a cover', state: 'scanned',
      location: '', credits: [], tags: [],
    })
  })

  it('says when out, for a checked-out book', async () => {
    const kraken = await call<{ state: string; checked_out_at: string | null }>('get_book', { book_id: seeded.kraken })
    expect(kraken.state).toBe('checked_out')
    expect(kraken.checked_out_at).toBeTruthy()
  })

  it('refuses an id nothing has, pointing at search_books', async () => {
    expect(await refusal('get_book', { book_id: 999_999 })).toContain('search_books')
  })
})

describe('collection_summary', () => {
  it('counts the catalogue and not the queue', async () => {
    expect(await call('collection_summary')).toEqual({
      total: 5, fiction: 4, nonfiction: 1, checked_out: 1, unplaced: 3,
    })
  })
})

describe('list_tags', () => {
  it('answers the vocabulary, or the part under one slug, with rolled-up counts', async () => {
    const { tags } = await call<{ tags: { slug: string; books: number }[] }>('list_tags')
    expect(tags.map((one) => one.slug)).toEqual(expect.arrayContaining(['genre/fiction/space-opera', 'genre/fiction/weird']))

    const under = await call<{ tags: { slug: string; books: number }[] }>('list_tags', { under: 'genre/fiction' })
    expect(under.tags.every((one) => one.slug.startsWith('genre/fiction'))).toBe(true)
    expect(under.tags.find((one) => one.slug === 'genre/fiction/weird')?.books).toBe(1)
  })
})

describe('list_authors and get_author_books', () => {
  it('pages the authors, and finds one by part of a name without its accent', async () => {
    const all = await call<{ total: number; authors: { name: string }[] }>('list_authors')
    expect(all.total).toBe(3)
    const page = await call<{ total: number; next_offset: number | null; authors: unknown[] }>('list_authors', { limit: 2 })
    expect(page).toMatchObject({ total: 3, next_offset: 2 })
    expect(page.authors).toHaveLength(2)

    const found = await call<{ authors: unknown[] }>('list_authors', { name: 'mieville' })
    expect(found.authors).toEqual([{
      author_id: seeded.mieville, name: 'China Miéville', is_corporate: false,
      names: [{ name: 'China Miéville', files_under: 'Miéville, China', primary: true }],
    }])
  })

  it('answers an author and their books in any state, paged', async () => {
    const answer = await call<Books & { author: { author_id: number } }>('get_author_books', { author_id: seeded.mieville })
    expect(answer.author.author_id).toBe(seeded.mieville)
    expect(answer.books.map((book) => book.book_id)).toEqual([seeded.city, seeded.kraken])

    const page = await call<Books>('get_author_books', { author_id: seeded.mieville, limit: 1, offset: 1 })
    expect(page).toMatchObject({ total: 2, next_offset: null })
    expect(page.books.map((book) => book.book_id)).toEqual([seeded.kraken])
  })

  it('refuses an author nothing has, pointing at list_authors', async () => {
    expect(await refusal('get_author_books', { author_id: 999_999 })).toContain('list_authors')
  })
})

describe('lookup_isbn', () => {
  it('says what the catalogues hold, and that this collection already has it', async () => {
    vi.mocked(lookupIsbn).mockResolvedValueOnce({
      found: true, title: 'Dune', subtitle: '', authors: ['Frank Herbert'], publisher: 'Ace',
      published: '1990', pages: '535', isbn13: DUNE_ISBN, isbn10: '0441013597',
      seriesName: 'Dune', seriesIndex: 1, coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg',
      source: 'Open Library', notes: [], subjects: ['Science fiction'], categories: [],
      classification: { genre: FICTION_SLUG, confidence: 'high', reason: 'Subject: Science fiction' },
    })
    const found = await call('lookup_isbn', { isbn: '978-0-441-01359-3' })
    expect(vi.mocked(lookupIsbn)).toHaveBeenLastCalledWith('978-0-441-01359-3', expect.any(Object))
    expect(found).toMatchObject({
      found: true, title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, subjects: ['Science fiction'],
      already_catalogued: { book_id: seeded.dune, title: 'Dune', location: '1A' },
    })
  })

  it('answers found false for a number no catalogue holds, and writes nothing', async () => {
    const before = await call<{ total: number }>('collection_summary')
    vi.mocked(lookupIsbn).mockResolvedValueOnce({
      found: false, title: '', subtitle: '', authors: [], publisher: '', published: '', pages: '',
      isbn13: '', isbn10: '', seriesName: '', seriesIndex: null, coverUrl: '', source: '',
      classification: { genre: null, confidence: 'unknown', reason: 'No lookup performed.' },
      notes: ['ISBN 9780000000002 not found in either catalogue.'],
    })
    const missing = await call('lookup_isbn', { isbn: '9780000000002' })
    expect(missing).toMatchObject({ found: false, already_catalogued: null, notes: [expect.stringContaining('not found')] })
    expect((await call<{ total: number }>('collection_summary')).total).toBe(before.total)
  })

  it('refuses digits that are not an ISBN without asking anybody', async () => {
    vi.mocked(lookupIsbn).mockClear()
    expect(await refusal('lookup_isbn', { isbn: '12345' })).toContain('not a valid ISBN')
    expect(vi.mocked(lookupIsbn)).not.toHaveBeenCalled()
  })
})

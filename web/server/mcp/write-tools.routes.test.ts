/**
 * The write tools, called by the SDK's own client after the whole OAuth flow,
 * against a scratch catalogue put back to the same connected state before each
 * test. The catalogues outside are `./lookup`, mocked the way the read tools'
 * test mocks it, so `add_book` reaches the mock through the same lookup handler
 * the `/api/lookup/isbn` route calls.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { removeScratchRoot, scratchRoot } from '../scratchdir'
import { closeTestDatabase, keepThisCatalogue, openTestDatabase } from '../testdb'
import type { Db } from '../driver'
import { createApp, type BookScanApp } from '../index'
import { devProvider } from '../auth/providers'
import { signedIn } from '../testauth'
import { lookupIsbn, type LookupResult } from '../lookup'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { connect } from './testclient'
import { DrizzleCatalogueReadModel } from '../../infrastructure/books/catalogue-read-model'
import { isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { TagNaming } from '../../src/components/TagNaming'
import { Make } from '../../src/design/Naming'
import type { TagRow } from '../../src/lib/api'

// Only so the app's tag box can be asked what it makes of a word: it keeps what
// was typed in `useState`, and with no DOM here the test hands it the word.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: vi.fn(),
}))

vi.mock('../lookup', () => ({
  lookupIsbn: vi.fn(),
  searchTitle: vi.fn(),
}))

vi.mock('../covers', () => ({
  downloadCover: vi.fn(async () => ''),
  openLibraryCover: (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
  upgradeGoogleCover: (url: string) => url,
}))

const DUNE = { isbn13: '9780441013593', isbn10: '0441013597' }
const SAPIENS = { isbn13: '9780062316097', isbn10: '0062316095' }
const UNKNOWN = '9780306406157'

let db: Db
let scratch: string
let app: BookScanApp
let server: Server
let client: Client
let origin: string
let cookie: string

function found(over: Partial<LookupResult> & { isbn13: string; isbn10: string; title: string }): LookupResult {
  return {
    found: true,
    subtitle: '', authors: [], publisher: 'A Publisher', published: '1965', pages: '412',
    seriesName: '', seriesIndex: null, coverUrl: '', source: 'Open Library',
    classification: { genre: FICTION_SLUG, confidence: 'medium', reason: 'subject headings' },
    notes: [],
    ...over,
  }
}

const NOT_FOUND: LookupResult = {
  found: false,
  title: '', subtitle: '', authors: [], publisher: '', published: '', pages: '',
  isbn13: '', isbn10: '', seriesName: '', seriesIndex: null, coverUrl: '', source: '',
  // What `lookup.ts` answers for nothing found: a default nobody stated.
  classification: { genre: FICTION_SLUG, confidence: 'unknown', reason: 'No lookup performed.' },
  notes: ['Neither catalogue has this ISBN.'],
}

/** The catalogues answer each ISBN from this table, and nothing else. */
function catalogues(...records: LookupResult[]): void {
  vi.mocked(lookupIsbn).mockImplementation(async (raw: string) => {
    const digits = raw.replace(/[^0-9X]/gi, '')
    return records.find((one) => one.isbn13 === digits || one.isbn10 === digits) ?? NOT_FOUND
  })
}

const DUNE_RECORD = found({ ...DUNE, title: 'Dune', authors: ['Frank Herbert'], seriesName: 'Dune', seriesIndex: 1 })
const SAPIENS_RECORD = found({
  ...SAPIENS, title: 'Sapiens', authors: ['Yuval Noah Harari'],
  classification: { genre: NON_FICTION_SLUG, confidence: 'medium', reason: 'subject headings' },
})

beforeAll(async () => {
  scratch = scratchRoot('mcp-write-tools')
  db = await openTestDatabase()

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
  // The connection is rows too, so it is kept with the empty catalogue and put back with it.
  await keepThisCatalogue('connected')
})

beforeEach(async () => {
  await app.settled()
  await openTestDatabase('connected')
  vi.mocked(lookupIsbn).mockReset()
  catalogues(DUNE_RECORD, SAPIENS_RECORD)
})

afterAll(async () => {
  await client?.close()
  await app?.settled()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeTestDatabase()
  removeScratchRoot(scratch)
})

type Tag = { slug: string; source: string }
type Book = {
  book_id: number; title: string; authors: string; isbn13: string; isbn10: string; range: string
  state: string; location: string; notes: string; publisher: string; series_name: string
  tags: Tag[]; credits: { name: string; files_under: string }[]
}
type Added = { added: boolean; record_from: string; book: Book; goes_between: unknown; notes: string[] }
type Updated = { reidentified: boolean; withdrawn_tags: Tag[]; book: Book; goes_between: unknown }

async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError ?? false, JSON.stringify(result.content)).toBe(false)
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? ''
  expect(JSON.parse(text)).toEqual(result.structuredContent)
  return result.structuredContent as T
}

async function refusal(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError, JSON.stringify(result.content)).toBe(true)
  return (result.content as { text: string }[])[0]?.text ?? ''
}

const tagsOf = (book: { tags: Tag[] }) => book.tags.map((tag) => `${tag.slug}:${tag.source}`).sort()

/** A save from the app's review pane, as `POST /api/books` takes it. */
async function saveFromTheApp(fields: Record<string, unknown>): Promise<number> {
  const response = await fetch(`${origin}/api/books`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  })
  expect(response.status).toBe(201)
  return Number(((await response.json()) as { id: number }).id)
}

async function bookCount(): Promise<number> {
  return Number((await db.get<{ n: number }>('SELECT count(*)::int AS n FROM books'))?.n)
}

/** Makes a tag the way the app's tags screen does, with no book in hand. */
async function defineInTheApp(slug: string, label: string): Promise<void> {
  const response = await fetch(`${origin}/api/tags`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug, label }),
  })
  expect(response.ok).toBe(true)
}

async function fromTheApp<T>(path: string): Promise<T> {
  const response = await fetch(`${origin}${path}`, { headers: { cookie } })
  expect(response.status).toBe(200)
  return await response.json() as T
}

function elementsOf(node: ReactNode, type: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((one) => elementsOf(one, type))
  if (!isValidElement(node)) return []
  const props = node.props as { children?: ReactNode }
  return [...(node.type === type ? [node] : []), ...elementsOf(props.children, type)]
}

/**
 * What the app's tag box, open on this book, offers to make of a typed word:
 * the slug and label its "make a new one" press hands to `api.applyTag`, or
 * null when it offers no new tag. It is given what the app gives it: the
 * vocabulary from `GET /api/tags` and every slug the book carries.
 */
async function theTagBoxMakes(bookId: number, typed: string): Promise<{ slug: string; label: string } | null> {
  const { tags: vocabulary } = await fromTheApp<{ tags: TagRow[] }>('/api/tags')
  const { tags: carried } = await fromTheApp<{ tags: { slug: string }[] }>(`/api/books/${bookId}/tags`)
  vi.mocked(useState).mockReturnValueOnce([typed, () => {}])
  let picked: { slug: string; label: string } | null = null
  const box = TagNaming({
    vocabulary, carried: carried.map((tag) => tag.slug), busy: false, error: '',
    onPick: (tag) => { picked = tag }, onClose: () => {},
  })
  const [make] = elementsOf(box, Make)
  ;(make?.props as { onPress?: () => void } | undefined)?.onPress?.()
  return picked
}

describe('the tool list', () => {
  it('lists the four write tools with honest annotations, and no delete', async () => {
    const { tools } = await client.listTools()
    const byName = new Map(tools.map((tool) => [tool.name, tool]))
    expect(tools.some((tool) => /delete|remove_book/.test(tool.name))).toBe(false)

    expect(byName.get('add_book')?.annotations).toEqual({
      readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true,
    })
    expect(byName.get('update_book')?.annotations).toEqual({
      readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
    })
    expect(byName.get('tag_book')?.annotations).toEqual({
      readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false,
    })
    expect(byName.get('untag_book')?.annotations).toEqual({
      readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
    })
    for (const name of ['add_book', 'update_book', 'tag_book', 'untag_book']) {
      expect(byName.get(name)?.outputSchema?.type, name).toBe('object')
    }
    expect(byName.get('update_book')?.description).toMatch(/withdrawn.*reidentified/s)
  })
})

describe('add_book', () => {
  it('saves the catalogues\' record through the save path, filed, credited and placed where it lands', async () => {
    const added = await call<Added>('add_book', { isbn: '978-0-441-01359-3' })
    expect(added).toMatchObject({ added: true, record_from: 'catalogue' })
    expect(added.book).toMatchObject({
      title: 'Dune', authors: 'Frank Herbert', isbn13: DUNE.isbn13, isbn10: DUNE.isbn10,
      range: 'fiction', state: 'shelved', series_name: 'Dune', publisher: 'A Publisher',
    })
    expect(added.book.location).not.toBe('')
    expect(added.book.credits).toEqual([expect.objectContaining({ name: 'Frank Herbert', files_under: 'Herbert, Frank' })])
    // Nobody said which run: the catalogues' heading is the classifier's guess, as a scan saves it.
    expect(tagsOf(added.book)).toEqual(['genre/fiction:guess'])
    expect(added.goes_between).toEqual({ after: null, before: null })

    const ledger = await db.all<{ kind: string; actor: string; area_id: number | null }>(
      'SELECT kind, actor, area_id FROM book_placement WHERE book_id = ?', [added.book.book_id],
    )
    expect(ledger).toEqual([{ kind: 'placed', actor: 'person', area_id: expect.any(Number) }])
    const row = await db.get<{ isbn_source: string; lookup_source: string; classification_source: string }>(
      'SELECT isbn_source, lookup_source, classification_source FROM books WHERE id = ?', [added.book.book_id],
    )
    expect(row).toEqual({ isbn_source: 'manual', lookup_source: 'Open Library', classification_source: 'auto' })

    const listed = await call<{ books: { book_id: number }[] }>('search_books', { words: 'dune' })
    expect(listed.books.map((book) => book.book_id)).toEqual([added.book.book_id])
  })

  it('records the genre, the filing and the note the person gave, and their genre outranks the guess', async () => {
    const added = await call<Added>('add_book', {
      isbn: SAPIENS.isbn10, genre: 'fiction', files_under: 'Harari, Y. N.', notes: 'Signed',
    })
    expect(added.book).toMatchObject({ range: 'fiction', notes: 'Signed' })
    expect(tagsOf(added.book)).toEqual(['genre/fiction:person'])
    expect(added.book.credits[0]?.files_under).toBe('Harari, Y. N.')

    // Herbert files after Harari, in the run the person's answer put Sapiens in.
    const second = await call<Added>('add_book', { isbn: DUNE.isbn13 })
    expect(second.goes_between).toEqual({
      after: { book_id: added.book.book_id, title: 'Sapiens', files_under: 'Harari, Y. N.' }, before: null,
    })
  })

  it('answers the book already catalogued under either form of the ISBN and adds nothing', async () => {
    const first = await call<Added>('add_book', { isbn: DUNE.isbn13, notes: 'first copy' })
    const count = await bookCount()

    const again = await call<Added>('add_book', { isbn: DUNE.isbn10, notes: 'second copy', genre: 'nonfiction' })
    expect(again).toMatchObject({ added: false, record_from: 'existing', goes_between: null })
    expect(again.book).toMatchObject({ book_id: first.book.book_id, notes: 'first copy', range: 'fiction' })
    expect(await bookCount()).toBe(count)
  })

  it('refuses a number neither catalogue knows unless the person gave a title, and then adds only that', async () => {
    const said = await refusal('add_book', { isbn: UNKNOWN })
    expect(said).toMatch(/Nothing was added.*title and authors/s)
    expect(await bookCount()).toBe(0)

    const added = await call<Added>('add_book', {
      isbn: UNKNOWN, title: 'A Pamphlet', authors: ['Ann Author'],
    })
    expect(added).toMatchObject({ added: true, record_from: 'person', goes_between: null })
    expect(added.book).toMatchObject({
      title: 'A Pamphlet', authors: 'Ann Author', isbn13: UNKNOWN, isbn10: '0306406152',
      publisher: '', range: '', state: 'shelved',
    })
    // The not-found answer's default genre is not something anybody stated.
    expect(added.book.tags).toEqual([])
  })

  it('refuses something that is not an ISBN without asking the catalogues', async () => {
    expect(await refusal('add_book', { isbn: '12345' })).toMatch(/not a valid ISBN/)
    expect(lookupIsbn).not.toHaveBeenCalled()
  })

  it('is serialised: two adds of one ISBN racing past the lookup add it once (#637)', async () => {
    // Both lookups are held until both calls have reached them, so both
    // lookups' duplicate checks run before either save commits. The save asks
    // again under the number's lock, so the second asks after the first has
    // committed and answers its book.
    let release!: () => void
    const both = new Promise<void>((resolve) => { release = resolve })
    let arrived = 0
    vi.mocked(lookupIsbn).mockImplementation(async () => {
      if (++arrived === 2) release()
      await both
      return DUNE_RECORD
    })

    const [one, two] = await Promise.all([
      call<Added>('add_book', { isbn: DUNE.isbn13 }),
      call<Added>('add_book', { isbn: DUNE.isbn13 }),
    ])
    expect([one.added, two.added].sort()).toEqual([false, true])
    expect(one.book.book_id).toBe(two.book.book_id)
    expect([one, two].find((call) => !call.added)?.record_from).toBe('existing')
    expect(await bookCount()).toBe(1)
  })

  it('answers the book the app saved after its lookup and before its save', async () => {
    // The app's save lands just after the lookup's duplicate check has found
    // nothing, so only the check the save makes under the number's lock can
    // see it.
    const lookupsCheck = DrizzleCatalogueReadModel.prototype.findByIsbn
    let theAppSaved: Promise<number> | undefined
    const spy = vi.spyOn(DrizzleCatalogueReadModel.prototype, 'findByIsbn')
      .mockImplementation(async function (this: DrizzleCatalogueReadModel, isbn: string) {
        const found = await lookupsCheck.call(this, isbn)
        theAppSaved ??= saveFromTheApp({ title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE.isbn13, genre: FICTION_SLUG })
        await theAppSaved
        return found
      })

    try {
      const added = await call<Added>('add_book', { isbn: DUNE.isbn13 })
      expect(added).toMatchObject({ added: false, record_from: 'existing' })
      expect(added.book.book_id).toBe(await theAppSaved)
      expect(await bookCount()).toBe(1)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('POST /api/books, beside add_book (#637)', () => {
  it('still adds a second copy of an ISBN already catalogued, at once or one after the other', async () => {
    const dune = { title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE.isbn13, genre: FICTION_SLUG }
    const [one, two] = await Promise.all([saveFromTheApp(dune), saveFromTheApp(dune)])
    const three = await saveFromTheApp({ ...dune, isbn13: DUNE.isbn10 })
    expect(new Set([one, two, three]).size).toBe(3)
    expect(await bookCount()).toBe(3)
  })
})

describe('update_book', () => {
  it('changes only the fields passed, keeping the printed names exactly', async () => {
    catalogues(found({
      ...DUNE, title: 'The Anthology', authors: ['Smith, Elder & Co.', 'Ted Chiang'], seriesName: 'Annual',
    }))
    const added = await call<Added>('add_book', { isbn: DUNE.isbn13, genre: 'fiction', notes: 'old' })

    const updated = await call<Updated>('update_book', { book_id: added.book.book_id, notes: 'Signed on the title page' })
    expect(updated).toMatchObject({ reidentified: false, withdrawn_tags: [] })
    expect(updated.book).toMatchObject({
      title: 'The Anthology', authors: 'Smith, Elder & Co., Ted Chiang', series_name: 'Annual',
      isbn13: DUNE.isbn13, range: 'fiction', notes: 'Signed on the title page',
    })
    expect(updated.book.credits.map((credit) => credit.name)).toEqual(['Smith, Elder & Co.', 'Ted Chiang'])
    expect(tagsOf(updated.book)).toEqual(['genre/fiction:person'])

    const retitled = await call<Updated>('update_book', {
      book_id: added.book.book_id, title: 'The Anthology, Revised', series_index: 2, genre: 'nonfiction',
    })
    expect(retitled.book).toMatchObject({ title: 'The Anthology, Revised', notes: 'Signed on the title page', range: 'nonfiction' })
    expect(tagsOf(retitled.book)).toEqual(['genre/non-fiction:person'])
    expect(retitled.withdrawn_tags).toEqual([expect.objectContaining({ slug: 'genre/fiction', source: 'person' })])
  })

  it('re-identifies on a new ISBN: every genre and subject tag goes, a person\'s included, and the rest stay', async () => {
    const added = await call<Added>('add_book', { isbn: DUNE.isbn13, genre: 'fiction' })
    const id = added.book.book_id
    await call('tag_book', { book_id: id, tag: 'sand' })
    // A heading the app's tag box never makes, defined by hand to show what survives.
    await defineInTheApp('mine/signed', 'Signed')
    await call('tag_book', { book_id: id, tag: 'mine/signed' })

    const corrected = await call<Updated>('update_book', { book_id: id, isbn: SAPIENS.isbn13, title: 'Sapiens' })
    expect(corrected.reidentified).toBe(true)
    expect(corrected.withdrawn_tags.map((tag) => `${tag.slug}:${tag.source}`).sort())
      .toEqual(['genre/fiction:person', 'subject/sand:person'])
    expect(tagsOf(corrected.book)).toEqual(['mine/signed:person'])
    // Nothing now says which run the corrected book is in.
    expect(corrected.book).toMatchObject({ isbn13: SAPIENS.isbn13, isbn10: SAPIENS.isbn10, range: '' })
    expect(corrected.goes_between).toBeNull()

    // The same ISBN again is not a different book: nothing more is withdrawn.
    const filed = await call<Updated>('update_book', { book_id: id, isbn: SAPIENS.isbn10, genre: 'nonfiction' })
    expect(filed).toMatchObject({ reidentified: false, withdrawn_tags: [] })
    expect(tagsOf(filed.book)).toEqual(['genre/non-fiction:person', 'mine/signed:person'])
    expect(filed.book.range).toBe('nonfiction')
  })

  it('keeps a person\'s genre tag over the catalogues\' guess through a later save', async () => {
    const added = await call<Added>('add_book', { isbn: SAPIENS.isbn13 })
    expect(tagsOf(added.book)).toEqual(['genre/non-fiction:guess'])
    expect(added.book.range).toBe('nonfiction')

    // tag_book writes no genre, so the person's tag goes on through the app's route.
    const response = await fetch(`${origin}/api/books/${added.book.book_id}/tags`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ slug: FICTION_SLUG, label: 'Fiction' }),
    })
    expect(response.status).toBe(201)
    const saved = await call<Updated>('update_book', { book_id: added.book.book_id, notes: 'a novel, really' })
    expect(saved.book.range).toBe('fiction')
    expect(tagsOf(saved.book)).toEqual(['genre/fiction:person', 'genre/non-fiction:guess'])
    expect(saved.withdrawn_tags).toEqual([])
  })

  it('refuses no fields, an empty title, a bad ISBN, an unknown book and a queued one, writing nothing', async () => {
    const added = await call<Added>('add_book', { isbn: DUNE.isbn13 })
    const id = added.book.book_id
    expect(await refusal('update_book', { book_id: id })).toMatch(/at least one field/)
    expect(await refusal('update_book', { book_id: id, title: '  ' })).toMatch(/title/)
    expect(await refusal('update_book', { book_id: id, isbn: '978044101359' })).toMatch(/not a valid ISBN/)
    expect(await refusal('update_book', { book_id: 999_999, notes: 'x' })).toMatch(/no book 999999.*search_books/)

    const queued = await db.get<{ id: number }>(
      `INSERT INTO books (title, title_guess, shelf_range, sort_key, scanned_at, state)
       VALUES ('', 'Half a cover', 'fiction', 'half', '2026-10-28', 'scanned') RETURNING id`,
    )
    expect(await refusal('update_book', { book_id: Number(queued?.id), title: 'Now a book' }))
      .toMatch(/scanned, not catalogued/)
    expect((await db.get<{ state: string }>('SELECT state FROM books WHERE id = ?', [queued?.id]))?.state)
      .toBe('scanned')
    expect((await call<Book>('get_book', { book_id: id })).title).toBe('Dune')
  })
})

describe('tag_book and untag_book', () => {
  it('tags as the person, normalising words, and tagging twice changes nothing', async () => {
    const added = await call<Added>('add_book', { isbn: DUNE.isbn13 })
    const id = added.book.book_id

    const tagged = await call<{ tag: string; tags: (Tag & { label: string })[] }>('tag_book', { book_id: id, tag: 'Lent Out' })
    expect(tagged.tag).toBe('subject/lent-out')
    expect(tagged.tags).toContainEqual(expect.objectContaining({ slug: 'subject/lent-out', source: 'person', label: 'Lent Out' }))

    expect(tagsOf(await call<{ tags: Tag[] }>('tag_book', { book_id: id, tag: 'lent out' }))).toEqual(tagsOf(tagged))
    expect(tagsOf(await call<{ tags: Tag[] }>('tag_book', { book_id: id, tag: 'subject/lent-out' }))).toEqual(tagsOf(tagged))

    expect(await refusal('tag_book', { book_id: 999_999, tag: 'signed' })).toMatch(/no book/)
    expect(await refusal('tag_book', { book_id: id, tag: '///' })).toMatch(/not a tag/)
    expect(await refusal('tag_book', { book_id: id, tag: '???' })).toMatch(/not a word/)
  })

  it('untags whoever applied it, and says when there was nothing to take off', async () => {
    const added = await call<Added>('add_book', { isbn: DUNE.isbn13 })
    const id = added.book.book_id
    await call('tag_book', { book_id: id, tag: 'signed' })

    const guessGone = await call<{ removed: boolean; tags: Tag[] }>('untag_book', { book_id: id, tag: 'genre/fiction' })
    expect(guessGone.removed).toBe(true)
    expect(tagsOf(guessGone)).toEqual(['subject/signed:person'])

    const gone = await call<{ removed: boolean; tags: Tag[] }>('untag_book', { book_id: id, tag: 'subject/signed' })
    expect(gone).toMatchObject({ removed: true, tags: [] })
    expect(await call('untag_book', { book_id: id, tag: 'subject/signed' })).toMatchObject({ removed: false, tags: [] })
    expect(await refusal('untag_book', { book_id: 999_999, tag: 'subject/signed' })).toMatch(/no book/)
  })
})

describe('the tools do what the app would have done (#644)', () => {
  type Tagged = { tag: string; label: string; made: boolean; tags: (Tag & { label: string })[] }
  type Revised = Updated & { looked_up: boolean; same_isbn_as: { book_id: number; title: string }[] }

  it('tag_book names a new word exactly as the app\'s tag box would, under subject with the word as its label', async () => {
    const id = (await call<Added>('add_book', { isbn: DUNE.isbn13 })).book.book_id

    for (const typed of ['signed', 'First  edition', 'Lent Out', 'MTG', 'café au lait']) {
      const box = await theTagBoxMakes(id, typed)
      expect(box, typed).not.toBeNull()
      const tagged = await call<Tagged>('tag_book', { book_id: id, tag: typed })
      expect({ slug: tagged.tag, label: tagged.label }, typed).toEqual(box)
      expect(tagged.tags, typed).toContainEqual(expect.objectContaining({ ...box, source: 'person' }))
    }
    expect(tagsOf(await call<Book>('get_book', { book_id: id }))).toEqual([
      'genre/fiction:guess', 'subject/cafe-au-lait:person', 'subject/first-edition:person',
      'subject/lent-out:person', 'subject/mtg:person', 'subject/signed:person',
    ])
  })

  it('tag_book reuses a word the collection keeps, and refuses a second spelling of it, as the box does', async () => {
    const dune = (await call<Added>('add_book', { isbn: DUNE.isbn13 })).book.book_id
    const sapiens = (await call<Added>('add_book', { isbn: SAPIENS.isbn13 })).book.book_id
    expect(await call<Tagged>('tag_book', { book_id: dune, tag: 'Comic book' }))
      .toMatchObject({ tag: 'subject/comic-book', label: 'Comic book', made: true })

    // Spelled the way the collection spells it: the tag it already has.
    expect(await call<Tagged>('tag_book', { book_id: sapiens, tag: 'comic book' }))
      .toMatchObject({ tag: 'subject/comic-book', label: 'Comic book', made: false })

    // A plural is the same word to this app: the box offers no new tag, and the tool makes none.
    const other = (await call<Added>('add_book', { isbn: UNKNOWN, title: 'A Pamphlet' })).book.book_id
    expect(await theTagBoxMakes(other, 'Comic Books')).toBeNull()
    const said = await refusal('tag_book', { book_id: other, tag: 'Comic Books' })
    expect(said).toMatch(/subject\/comic-book/)
    expect(said).toMatch(/same word/)
    expect(tagsOf(await call<Book>('get_book', { book_id: other }))).toEqual([])

    // An existing slug is reused as it always was; a slug nobody has made is not made.
    expect(await call<Tagged>('tag_book', { book_id: other, tag: 'subject/comic-book' }))
      .toMatchObject({ tag: 'subject/comic-book', made: false })
    expect(await refusal('tag_book', { book_id: other, tag: 'mine/signed' }))
      .toMatch(/no tag mine\/signed.*"signed"/s)
    const vocabulary = await call<{ tags: { slug: string }[] }>('list_tags')
    expect(vocabulary.tags.map((tag) => tag.slug)).not.toContain('mine/signed')
  })

  it('tag_book refuses a genre, as the box does, and points at update_book', async () => {
    const id = (await call<Added>('add_book', { isbn: DUNE.isbn13 })).book.book_id
    for (const typed of ['fiction', 'Non fiction']) {
      expect(await theTagBoxMakes(id, typed), typed).toBeNull()
      expect(await refusal('tag_book', { book_id: id, tag: typed }), typed).toMatch(/update_book.*genre/s)
    }
    for (const slug of ['genre/cyberpunk', 'genre/fiction', 'genre/fiction/science-fiction']) {
      expect(await refusal('tag_book', { book_id: id, tag: slug }), slug).toMatch(/update_book.*genre/s)
    }
    expect(tagsOf(await call<Book>('get_book', { book_id: id }))).toEqual(['genre/fiction:guess'])
    const genres = await call<{ tags: { slug: string }[] }>('list_tags', { under: 'genre' })
    expect(genres.tags.map((tag) => tag.slug)).not.toContain('genre/cyberpunk')
  })

  it('describes the tools so that a model following the examples does what the app does', async () => {
    const { tools } = await client.listTools()
    const byName = new Map(tools.map((tool) => [tool.name, tool]))
    const tagBook = JSON.stringify(byName.get('tag_book'))
    expect(tagBook).not.toMatch(/mine\//)
    expect(tagBook).toMatch(/subject/)
    expect(byName.get('tag_book')?.inputSchema.properties).not.toHaveProperty('label')

    const updateBook = byName.get('update_book')?.description ?? ''
    expect(updateBook).not.toMatch(/mine\//)
    expect(updateBook).toMatch(/genre replaces every genre tag a person/)
    expect(updateBook).toMatch(/not looked up.*lookup_isbn/s)
    expect(byName.get('add_book')?.description).toMatch(/second_copy/)
    expect(byName.get('add_book')?.description).toMatch(/list_queue.*only in the book-scan app/s)
  })

  it('update_book says a new ISBN was not looked up, and names the books already carrying it', async () => {
    const dune = (await call<Added>('add_book', { isbn: DUNE.isbn13 })).book.book_id
    const sapiens = (await call<Added>('add_book', { isbn: SAPIENS.isbn13 })).book.book_id
    const lookups = vi.mocked(lookupIsbn).mock.calls.length

    const corrected = await call<Revised>('update_book', { book_id: sapiens, isbn: DUNE.isbn10 })
    expect(corrected).toMatchObject({ reidentified: true, looked_up: false })
    // The old record, untouched: nothing was fetched for the new number.
    expect(corrected.book).toMatchObject({ title: 'Sapiens', isbn13: DUNE.isbn13 })
    expect(vi.mocked(lookupIsbn).mock.calls.length).toBe(lookups)
    expect(corrected.same_isbn_as).toEqual([{ book_id: dune, title: 'Dune' }])

    expect(await call<Revised>('update_book', { book_id: dune, notes: 'mine' }))
      .toMatchObject({ looked_up: false, same_isbn_as: [] })
  })

  it('add_book adds a genuine second copy when asked, as the review pane does, and only then', async () => {
    const first = await call<Added>('add_book', { isbn: DUNE.isbn13 })
    expect(await call<Added>('add_book', { isbn: DUNE.isbn13 }))
      .toMatchObject({ added: false, record_from: 'existing', book: { book_id: first.book.book_id } })

    const copy = await call<Added>('add_book', { isbn: DUNE.isbn10, second_copy: true, notes: 'the paperback' })
    expect(copy).toMatchObject({ added: true, record_from: 'catalogue' })
    expect(copy.book).toMatchObject({ title: 'Dune', isbn13: DUNE.isbn13, notes: 'the paperback' })
    expect(copy.book.book_id).not.toBe(first.book.book_id)
    expect(await bookCount()).toBe(2)
  })
})

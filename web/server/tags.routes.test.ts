/**
 * Driven over real HTTP against a real Postgres: `tag` and `book_tag` are
 * created by a migration, and there are migrations only for Postgres.
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
import { lookupIsbn } from './lookup'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'

/**
 * What the catalogues answer. Replaced per test, so "the lookup has changed its
 * mind" is a line in a test rather than a fixture nobody can vary.
 */
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

const DUNE = '9780441013593'
/** The same book, as printed inside it. Both forms are one identity. */
const DUNE_10 = '0441013597'
/** A different book, for the saves that correct which book a row is. */
const MOCKINGBIRD = '9780061120084'

// One `Db` for the file, not one per test: each `PgDb` registers an `error`
// listener on the pool, and a dozen of them trips node's max-listeners
// warning. `openTestDatabase` hands back the same one every call.
let db: Db
/** This file's own scratch root, which no other test file can name. */
let scratch: string
let coverDir: string
let app: BookScanApp
let server: Server
let baseUrl: string
/** The session every request in this file carries. See server/testauth.ts. */
let cookie: string

beforeAll(() => {
  scratch = scratchRoot('tags')
})

beforeEach(async () => {
  db = await openTestDatabase()
  answers.mockReset()
  answers.mockResolvedValue({ ...empty })

  coverDir = mkdtempSync(join(scratch, 'tags-test-'))
  cookie = (await signedIn(db)).cookie
  app = createApp({ db, coverDir, startBackgroundWork: false })
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  /*
   * First, and before anything is taken away: a save answers while it is
   * still fetching a cover, hashing it and cropping, so the app is still
   * querying the database and writing into `coverDir` after the last
   * assertion has passed. Pulling either out from under it is an unhandled
   * rejection that only shows up under a parallel run, where another worker
   * is still alive when the late query lands.
   */
  await app.settled()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  rmSync(coverDir, { recursive: true, force: true })
})

afterAll(async () => {
  await closeTestDatabase()
  // This is the root the per-test cover directories were made in, and it
  // belongs to this file alone; nothing above it is touched.
  removeScratchRoot(scratch)
})

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    // Every route under /api is behind the gate, so a request without a
    // session cookie is refused 401.
    headers: {
      cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

const post = (path: string, body: unknown) =>
  call(path, { method: 'POST', body: JSON.stringify(body) })

const put = (path: string, body: unknown) =>
  call(path, { method: 'PUT', body: JSON.stringify(body) })

/** A saved book, and its id. */
async function aBook(fields: Record<string, unknown> = {}) {
  const { body } = await post('/api/books', {
    title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE, genre: FICTION_SLUG, ...fields,
  })
  return Number(body.id)
}

/** A book's tags as `slug:source`, which is the pair every rule here is about. */
async function tagsOf(bookId: number): Promise<string[]> {
  const { body } = await call(`/api/books/${bookId}/tags`)
  return (body.tags as { slug: string; source: string }[])
    .map((tag) => `${tag.slug}:${tag.source}`)
}

describe('saving a book', () => {
  it("records the classifier's verdict as a guess", async () => {
    const id = await aBook({ classificationSource: 'auto', classificationConfidence: 'medium' })
    expect(await tagsOf(id)).toEqual(['genre/fiction:guess'])
  })

  it("records a person's answer as a person's, and retires the guess", async () => {
    const id = await aBook({ classificationSource: 'auto' })
    await put(`/api/books/${id}`, {
      title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE,
      genre: NON_FICTION_SLUG, classificationSource: 'manual',
    })

    // Not both. A book showing as fiction and non-fiction at once is a book
    // nobody can tell the current answer for.
    expect(await tagsOf(id)).toEqual(['genre/non-fiction:person'])
  })
})

/**
 * `infrastructure/db/genre-cutover.test.ts` compares the two derivations
 * book by book over a whole catalogue; this is the other half of the same
 * claim, asked of the running app: what a save writes into
 * `books.shelf_range`, which is what every shelf query reads.
 */
describe('the genre tag deciding which range a book files into', () => {
  /**
   * The column the shelf is drawn from, as the row holds it: a book's genre
   * lives in `book_tag`, and `shelf_range` is the run the genre settled on.
   */
  async function filedAs(bookId: number): Promise<string> {
    const { body } = await call(`/api/books/${bookId}`)
    return body.book.shelf_range as string
  }

  it('files a book into the range its genre tag names', async () => {
    const fiction = await aBook({ classificationSource: 'auto' })
    expect(await tagsOf(fiction)).toEqual(['genre/fiction:guess'])
    expect(await filedAs(fiction)).toBe('fiction')

    const other = await aBook({ isbn13: '', genre: NON_FICTION_SLUG, classificationSource: 'auto' })
    expect(await tagsOf(other)).toEqual(['genre/non-fiction:guess'])
    expect(await filedAs(other)).toBe('nonfiction')
  })

  it('moves the book when a person changes the genre', async () => {
    const id = await aBook({ classificationSource: 'auto' })
    await put(`/api/books/${id}`, {
      title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE,
      genre: NON_FICTION_SLUG, classificationSource: 'manual',
    })

    expect(await tagsOf(id)).toEqual(['genre/non-fiction:person'])
    expect(await filedAs(id)).toBe('nonfiction')
  })

  it('leaves a book where a person filed it when a lookup says otherwise', async () => {
    /*
     * A catalogue may claim a genre a person disagrees with, and it is
     * entitled to; the shelf follows the person's tag rather than the
     * catalogue's, so the book stays where they put it.
     */
    const id = await aBook({ genre: FICTION_SLUG, classificationSource: 'manual' })
    expect(await tagsOf(id)).toEqual(['genre/fiction:person'])

    answers.mockResolvedValue({
      ...empty, found: true,
      classification: { genre: NON_FICTION_SLUG, confidence: 'high', reason: '' },
    })
    await post(`/api/books/${id}/tags/refresh`, {})
    expect(await tagsOf(id)).toEqual(['genre/fiction:person', 'genre/non-fiction:catalogue'])

    await put(`/api/books/${id}`, {
      title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE,
      genre: NON_FICTION_SLUG, classificationSource: 'auto', classificationConfidence: 'high',
    })

    // The guess is on record but is not what files it: the column follows the
    // tags rather than the request, so the two things the client reads cannot
    // disagree with the shelf.
    expect(await tagsOf(id)).toEqual([
      'genre/fiction:person', 'genre/non-fiction:catalogue', 'genre/non-fiction:guess',
    ])
    expect(await filedAs(id)).toBe('fiction')
  })

  it("files a corrected book under the new book's genre and not the old one's", async () => {
    /*
     * Load bearing, not tidy: the old book's genre has to be off the row
     * before the new one is read back, or a corrected book files under what
     * it used to be.
     */
    const id = await aBook({ genre: FICTION_SLUG, classificationSource: 'manual' })
    expect(await filedAs(id)).toBe('fiction')

    await put(`/api/books/${id}`, {
      title: 'To Kill a Mockingbird', authors: ['Harper Lee'], isbn13: MOCKINGBIRD,
      genre: NON_FICTION_SLUG, classificationSource: 'auto', classificationConfidence: 'medium',
    })

    expect(await tagsOf(id)).toEqual(['genre/non-fiction:guess'])
    expect(await filedAs(id)).toBe('nonfiction')
  })
})

describe('correcting which book a row is', () => {
  /** The person's answer, on the book saved as a fiction guess. */
  async function answeredByHand() {
    const id = await aBook({ classificationSource: 'auto' })
    await put(`/api/books/${id}`, {
      title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE,
      genre: NON_FICTION_SLUG, classificationSource: 'manual',
    })
    expect(await tagsOf(id)).toEqual(['genre/non-fiction:person'])
    return id
  }

  it('leaves the book under one genre and not two', async () => {
    /*
     * A relookup arrives as `auto`, so the save restates the guess but
     * nothing restates the person's row; left behind, that is a book
     * carrying two genres with nothing to say which is current.
     */
    const id = await answeredByHand()

    await put(`/api/books/${id}`, {
      title: 'To Kill a Mockingbird', authors: ['Harper Lee'], isbn13: MOCKINGBIRD,
      genre: FICTION_SLUG, classificationSource: 'auto', classificationConfidence: 'medium',
    })

    expect(await tagsOf(id)).toEqual(['genre/fiction:guess'])
  })

  it('takes the old book\'s catalogue headings with it', async () => {
    // Subjects are about the work as much as the genre is. "Desert life" on a
    // row that has since turned out to be a different book describes nothing.
    const id = await aBook()
    answers.mockResolvedValue({
      ...empty, found: true,
      classification: { genre: FICTION_SLUG, confidence: 'high', reason: '' },
      subjects: ['Desert life'],
    })
    await post(`/api/books/${id}/tags/refresh`, {})
    expect(await tagsOf(id)).toContain('subject/desert-life:catalogue')

    await put(`/api/books/${id}`, {
      title: 'To Kill a Mockingbird', authors: ['Harper Lee'], isbn13: MOCKINGBIRD,
      genre: FICTION_SLUG, classificationSource: 'auto', classificationConfidence: 'medium',
    })

    expect(await tagsOf(id)).toEqual(['genre/fiction:guess'])
  })

  it('keeps what somebody said about the copy rather than about the book', async () => {
    // A corrected ISBN says nothing about where the physical book is. Lending
    // it out is a fact about the object in the house, and it survives.
    const id = await answeredByHand()
    await post(`/api/books/${id}/tags`, { slug: 'mine/lent-out', label: 'Lent out' })

    await put(`/api/books/${id}`, {
      title: 'To Kill a Mockingbird', authors: ['Harper Lee'], isbn13: MOCKINGBIRD,
      genre: FICTION_SLUG, classificationSource: 'auto', classificationConfidence: 'medium',
    })

    expect(await tagsOf(id)).toEqual(['genre/fiction:guess', 'mine/lent-out:person'])
  })

  it("leaves a person's answer alone when the book is still the same book", async () => {
    // The one-directional rule, unweakened: an edit that is not a correction of
    // identity is still a guess that may not touch what somebody decided.
    const id = await answeredByHand()

    await put(`/api/books/${id}`, {
      title: 'Dune Messiah', authors: ['Frank Herbert'], isbn13: DUNE,
      genre: FICTION_SLUG, classificationSource: 'auto', classificationConfidence: 'medium',
    })

    expect(await tagsOf(id)).toContain('genre/non-fiction:person')
  })

  it('reads the two ISBN forms of one book as one book', async () => {
    // The printed ISBN-10 of the book already on file is not a different book,
    // and typing it in must not throw away the answer somebody gave.
    const id = await answeredByHand()

    await put(`/api/books/${id}`, {
      title: 'Dune', authors: ['Frank Herbert'], isbn13: '', isbn10: DUNE_10,
      genre: NON_FICTION_SLUG, classificationSource: 'manual',
    })

    expect(await tagsOf(id)).toEqual(['genre/non-fiction:person'])
  })
})

describe('a person tagging a book', () => {
  it('normalises what they typed and keeps what they wrote as the label', async () => {
    const id = await aBook()
    const { status, body } = await post(`/api/books/${id}/tags`, {
      slug: 'Mine / Lent Out', label: 'Lent out',
    })

    expect(status).toBe(201)
    expect(body.tags).toContainEqual({
      slug: 'mine/lent-out', label: 'Lent out', source: 'person', confidence: 'high',
    })
  })

  it('refuses something that is not a tag', async () => {
    const id = await aBook()
    expect((await post(`/api/books/${id}/tags`, { slug: '///' })).status).toBe(400)
  })

  it('takes it back off again', async () => {
    const id = await aBook()
    await post(`/api/books/${id}/tags`, { slug: 'mine/lent-out', label: 'Lent out' })
    const { body } = await call(
      `/api/books/${id}/tags?slug=${encodeURIComponent('mine/lent-out')}`, { method: 'DELETE' },
    )

    expect((body.tags as { slug: string }[]).map((tag) => tag.slug)).not.toContain('mine/lent-out')
  })

  it('is 404 on a book that is not there', async () => {
    expect((await post('/api/books/9999/tags', { slug: 'mine/lent-out' })).status).toBe(404)
  })

  /**
   * A source may only ever retract its own rows, so a genre stated by a
   * catalogue or a guess could never take back a tag a person added by hand.
   * `domain/tagging/tags.test.ts` pins the arithmetic for restating a source;
   * this asserts the same rule through a save that also touches the genre.
   */
  it('keeps what somebody said about a book when a genre is settled afterwards', async () => {
    const id = await aBook({ classificationSource: 'auto' })
    await post(`/api/books/${id}/tags`, { slug: 'subject/comic-book', label: 'Comic book' })

    await put(`/api/books/${id}`, {
      title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE,
      genre: NON_FICTION_SLUG, classificationSource: 'manual',
    })

    const carried = await tagsOf(id)
    expect(carried, 'a save that never mentioned it deleted a tag somebody added by hand')
      .toContain('subject/comic-book:person')
    expect(carried).toContain('genre/non-fiction:person')
    expect(carried).not.toContain('genre/fiction:guess')
  })
})

describe('the vocabulary', () => {
  /**
   * `0002` seeds `genre/fiction` and `genre/non-fiction` as vocabulary rows,
   * so a real catalogue holds both from its first migration; this test's
   * assertion depends on that seed, not just on what it writes itself.
   */
  it('answers under with the tags beneath one slug', async () => {
    const id = await aBook()
    await post(`/api/books/${id}/tags`, { slug: 'genre/fantasy', label: 'Fantasy' })
    await post(`/api/books/${id}/tags`, { slug: 'mine/lent-out', label: 'Lent out' })

    const { body } = await call('/api/tags?under=genre')
    expect((body.tags as { slug: string }[]).map((tag) => tag.slug))
      .toEqual(['genre/fantasy', 'genre/fiction', 'genre/non-fiction'])
  })

  it('renames a tag without moving its slug', async () => {
    // Every rule references the slug. A rename that rewrote it would make each
    // of them stop matching, silently.
    const id = await aBook()
    await post(`/api/books/${id}/tags`, { slug: 'mine/lent-out', label: 'Lent out' })

    const { body } = await call('/api/tags', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'mine/lent-out', label: 'Out on loan' }),
    })

    expect(body.tags).toEqual([{ slug: 'mine/lent-out', label: 'Out on loan', note: '' }])
    expect(await tagsOf(id)).toContain('mine/lent-out:person')
  })
})

/**
 * Rules here are reached the way `place-rule.routes.test.ts` reaches them,
 * not hand-built, since a rule naming a tag is half of what this door has to
 * answer.
 */
describe('making a tag with no book in your hand', () => {
  /** Every row in `tag` with this slug, so "one and not two" is countable. */
  const rowsFor = (slug: string) =>
    db.all<{ id: number }>('SELECT id FROM tag WHERE slug = ?', [slug])

  /** One area of the room the migration furnished, to hang a rule on. */
  async function anArea(): Promise<number> {
    const { body } = await call('/api/fixtures')
    const piece = (body.fixtures as { areas: { id: number }[] }[])
      .find((one) => one.areas.length > 0)
    return piece!.areas[0]!.id
  }

  /** A rule that asks for one tag, written the way the rules screen writes one. */
  async function aRuleAsking(slug: string): Promise<void> {
    await post('/api/placement/rule', {
      about: 'area',
      placeId: await anArea(),
      rules: [{ id: null, conditions: [{ operator: 'is', tag: slug }] }],
    })
  }

  it('makes it, and the vocabulary answers it with nothing under it', async () => {
    const { status, body } = await post('/api/tags', {
      slug: 'subject/japanese-literature', label: 'Japanese literature',
    })

    expect(status).toBe(201)
    expect(body.tag).toEqual({
      slug: 'subject/japanese-literature',
      label: 'Japanese literature',
      note: '',
      books: 0,
      ruled: false,
    })

    const { body: listed } = await call('/api/tags')
    expect((listed.tags as { slug: string; books: number }[])
      .find((tag) => tag.slug === 'subject/japanese-literature'))
      .toEqual(expect.objectContaining({ books: 0 }))
  })

  /**
   * A rule may already carry the slug as a string; making that tag for real
   * has to produce the row that string already meant, or a second row would
   * be a rule beginning to match something new without anybody asking for it.
   */
  it('answers the row that is already there rather than making a second', async () => {
    const id = await aBook()
    await post(`/api/books/${id}/tags`, { slug: 'subject/comic-book', label: 'Comic book' })

    const { status, body } = await post('/api/tags', {
      slug: 'subject/comic-book', label: 'Comics',
    })

    expect(status).toBe(201)
    // The label already on it wins, which is `define`'s rule and not this
    // route's: a label is changed by somebody deciding to, through PATCH.
    expect(body.tag.label).toBe('Comic book')
    expect(await rowsFor('subject/comic-book')).toHaveLength(1)
    expect(await tagsOf(id)).toContain('subject/comic-book:person')
  })

  it('refuses something that is not a tag', async () => {
    const { status } = await post('/api/tags', { slug: '???', label: '???' })
    expect(status).toBe(400)
  })

  it('says which tags a rule asks for, whether or not anything carries them', async () => {
    await post('/api/tags', { slug: 'subject/hydrology', label: 'Hydrology' })
    await aRuleAsking('subject/hydrology')

    const { body } = await call('/api/tags')
    const tags = body.tags as { slug: string; books: number; ruled: boolean }[]

    // The two empty words that look identical in the table, told apart.
    expect(tags.find((tag) => tag.slug === 'subject/hydrology'))
      .toEqual(expect.objectContaining({ books: 0, ruled: true }))
  })
})

describe('sweeping a tag away', () => {
  const rowsFor = (slug: string) =>
    db.all<{ id: number }>('SELECT id FROM tag WHERE slug = ?', [slug])

  async function anArea(): Promise<number> {
    const { body } = await call('/api/fixtures')
    const piece = (body.fixtures as { areas: { id: number }[] }[])
      .find((one) => one.areas.length > 0)
    return piece!.areas[0]!.id
  }

  it('takes a word nothing carries and no rule asks for', async () => {
    /*
     * The slug is kept distinct from the one used elsewhere in this file, not
     * because `openTestDatabase()` leaves anything behind (it resets every
     * table), but because nothing is gained by two tests sharing a slug and
     * this file must not be made to share state between tests.
     */
    await post('/api/tags', { slug: 'subject/thatching', label: 'Thatching' })

    const { status } = await call('/api/tags?slug=subject/thatching', { method: 'DELETE' })

    expect(status).toBe(200)
    expect(await rowsFor('subject/thatching')).toEqual([])
  })

  /**
   * `book_tag.tag_id` is `ON DELETE CASCADE`, so a delete that is merely
   * checked before it runs would not fail against a tag in use: it would
   * take the tag off every book carrying it and answer as though it worked.
   * The check has to be inside the statement, which is why the refusal and
   * the book still wearing the word are asserted together.
   */
  it('refuses a word books are under, and leaves every one of them wearing it', async () => {
    const id = await aBook()
    await post(`/api/books/${id}/tags`, { slug: 'subject/comic-book', label: 'Comic book' })

    const { status, body } = await call('/api/tags?slug=subject/comic-book', {
      method: 'DELETE',
    })

    expect(status).toBe(409)
    expect(body.error).toContain('Books are under this tag')
    expect(await rowsFor('subject/comic-book')).toHaveLength(1)
    expect(await tagsOf(id)).toContain('subject/comic-book:person')
  })

  it('refuses a word a rule asks for, and says that is why', async () => {
    await post('/api/tags', { slug: 'subject/geodesy', label: 'Geodesy' })
    await post('/api/placement/rule', {
      about: 'area',
      placeId: await anArea(),
      rules: [{ id: null, conditions: [{ operator: 'is', tag: 'subject/geodesy' }] }],
    })

    const { status, body } = await call('/api/tags?slug=subject/geodesy', {
      method: 'DELETE',
    })

    expect(status).toBe(409)
    expect(body.error).toContain('A rule asks for this tag')
    expect(await rowsFor('subject/geodesy')).toHaveLength(1)
  })

  it('is 404 on a word nobody has made', async () => {
    const { status } = await call('/api/tags?slug=subject/nothing-like-this', {
      method: 'DELETE',
    })
    expect(status).toBe(404)
  })
})

describe('re-running the catalogue lookup', () => {
  it('turns the headings the catalogues sent into tags', async () => {
    const id = await aBook()
    answers.mockResolvedValue({
      ...empty,
      found: true,
      source: 'Open Library + Google Books',
      classification: { genre: FICTION_SLUG, confidence: 'high', reason: 'stub' },
      categories: ['Fiction / Fantasy / Epic'],
      // Three spellings of one heading, which is what catalogues really send.
      subjects: ['Science Fiction', 'science fiction', 'SCIENCE FICTION'],
    })

    const { body } = await post(`/api/books/${id}/tags/refresh`, {})
    expect(body.found).toBe(true)
    expect(await tagsOf(id)).toEqual([
      'genre/fiction:catalogue',
      'genre/fiction:guess',
      'subject/fiction/fantasy/epic:catalogue',
      'subject/science-fiction:catalogue',
    ])
  })

  it('writes nothing when the lookup found nothing', async () => {
    // A catalogue being down says nothing about the book, and reading it as a
    // retraction would strip a book's tags because somebody's API had a bad
    // minute.
    const id = await aBook()
    answers.mockResolvedValue({
      ...empty, found: true, classification: { genre: FICTION_SLUG, confidence: 'high', reason: '' },
      subjects: ['Dune'],
    })
    await post(`/api/books/${id}/tags/refresh`, {})

    answers.mockResolvedValue({ ...empty, found: false })
    const { body } = await post(`/api/books/${id}/tags/refresh`, {})

    expect(body.found).toBe(false)
    expect(await tagsOf(id)).toContain('subject/dune:catalogue')
  })

  it("takes back its own tags and leaves a person's exactly where they are", async () => {
    /*
     * If this ever fails, somebody's decision is being thrown away by a
     * background lookup, which is the kind of loss nobody reports because
     * nobody sees it happen.
     */
    const id = await aBook()
    await post(`/api/books/${id}/tags`, { slug: 'mine/lent-out', label: 'Lent out' })

    answers.mockResolvedValue({
      ...empty, found: true,
      classification: { genre: FICTION_SLUG, confidence: 'high', reason: '' },
      subjects: ['Desert life', 'Spice'],
    })
    await post(`/api/books/${id}/tags/refresh`, {})
    expect(await tagsOf(id)).toContain('subject/desert-life:catalogue')

    answers.mockResolvedValue({
      ...empty, found: true,
      classification: { genre: FICTION_SLUG, confidence: 'high', reason: '' },
      subjects: ['Ecology'],
    })
    await post(`/api/books/${id}/tags/refresh`, {})

    expect(await tagsOf(id)).toEqual([
      'genre/fiction:catalogue',
      'genre/fiction:guess',
      'mine/lent-out:person',
      'subject/ecology:catalogue',
    ])
  })

  it('says so when there is no ISBN to look up', async () => {
    const id = await aBook({ isbn13: '', isbn10: '' })
    expect((await post(`/api/books/${id}/tags/refresh`, {})).status).toBe(400)
  })
})

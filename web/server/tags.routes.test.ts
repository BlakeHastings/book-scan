/**
 * The tag routes, driven over real HTTP against a real Postgres.
 *
 * Postgres, because `tag` and `book_tag` are created by a migration and there
 * are migrations only for Postgres. The database is built by running them, which
 * is also what an ordinary start does: `applySchema` calls `migrateToLatest`.
 *
 * The app is built with `createApp()` and started on an ephemeral port, the same
 * way `index.test.ts` does it, and for the same reason: there is no supertest in
 * this project and this suite must not add one. Open Library and Google Books are
 * stubbed, so nothing here touches the network.
 *
 * The test that matters most is the last one. Everything else here is wiring;
 * that one is the rule the epic settled and told nobody to relitigate.
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

/**
 * What the catalogues answer. Replaced per test, so "the lookup has changed its
 * mind" is a line in a test rather than a fixture nobody can vary.
 */
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

const DUNE = '9780441013593'

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
  await pool.query('TRUNCATE books, book_authors, captures, book_tag, tag RESTART IDENTITY CASCADE')
  answers.mockReset()
  answers.mockResolvedValue({ ...empty })

  coverDir = mkdtempSync(join(dataRoot, 'tags-test-'))
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

/** A saved book, and its id. */
async function aBook(fields: Record<string, unknown> = {}) {
  const { body } = await post('/api/books', {
    title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE, isFiction: true, ...fields,
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
    await call(`/api/books/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE,
        isFiction: false, classificationSource: 'manual',
      }),
    })

    // Not both. A book showing as fiction and non-fiction at once is a book
    // nobody can tell the current answer for.
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
})

describe('the vocabulary', () => {
  it('answers under with the tags beneath one slug', async () => {
    const id = await aBook()
    await post(`/api/books/${id}/tags`, { slug: 'genre/fantasy', label: 'Fantasy' })
    await post(`/api/books/${id}/tags`, { slug: 'mine/lent-out', label: 'Lent out' })

    const { body } = await call('/api/tags?under=genre')
    expect((body.tags as { slug: string }[]).map((tag) => tag.slug))
      .toEqual(['genre/fantasy', 'genre/fiction'])
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

describe('re-running the catalogue lookup', () => {
  it('turns the headings the catalogues sent into tags', async () => {
    const id = await aBook()
    answers.mockResolvedValue({
      ...empty,
      found: true,
      source: 'Open Library + Google Books',
      classification: { isFiction: true, confidence: 'high', reason: 'stub' },
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
      ...empty, found: true, classification: { isFiction: true, confidence: 'high', reason: '' },
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
     * The one this whole issue exists for.
     *
     * A person says the book is lent out. A catalogue claims two subjects. The
     * catalogue is asked again and has changed its mind about both of them, and
     * says nothing at all about the person's tag.
     *
     * What must happen: the two it stopped claiming go, the new one arrives, and
     * the person's is untouched. If this ever fails, somebody's decision is being
     * thrown away by a background lookup, which is the kind of loss nobody
     * reports because nobody sees it happen.
     */
    const id = await aBook()
    await post(`/api/books/${id}/tags`, { slug: 'mine/lent-out', label: 'Lent out' })

    answers.mockResolvedValue({
      ...empty, found: true,
      classification: { isFiction: true, confidence: 'high', reason: '' },
      subjects: ['Desert life', 'Spice'],
    })
    await post(`/api/books/${id}/tags/refresh`, {})
    expect(await tagsOf(id)).toContain('subject/desert-life:catalogue')

    answers.mockResolvedValue({
      ...empty, found: true,
      classification: { isFiction: true, confidence: 'high', reason: '' },
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

/**
 * Every catalogue query handler, over its Drizzle read models, against a real
 * Postgres. The handlers are what an MCP tool calls with no Express in sight,
 * so each is asked here the way such a caller would ask it: a plain object in,
 * a plain object out.
 *
 * Books are saved through `Store.addBook`, which is the save path a scan takes,
 * and one book is left in the queue on purpose: the catalogue's listing must
 * not see it and a lookup by id must.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/driver'
import { closeTestDatabase, openTestDatabase } from '../../server/testdb'
import { Store, type DraftBook } from '../../server/store'
import { filingName } from '../../shared/shelving'
import { PrintedName } from '../../domain/authorship/authors'
import { TagSlug } from '../../domain/tagging/tags'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { PAGE_LIMIT } from '../../application/books/read-models'
import { ListBooksHandler } from '../../application/books/queries/list-books'
import { CountBooksHandler } from '../../application/books/queries/count-books'
import { GetBookHandler } from '../../application/books/queries/get-book'
import { VocabularyHandler } from '../../application/tagging/queries/vocabulary'
import { TagsOfBookHandler } from '../../application/tagging/queries/tags-of-book'
import { ListAuthorsHandler } from '../../application/authorship/queries/list-authors'
import { BooksByAuthorHandler } from '../../application/authorship/queries/books-by-author'
import { CreditsOfBookHandler } from '../../application/authorship/queries/credits-of-book'
import { DrizzleAuthorRepository } from '../authorship/author-repository'
import { DrizzleAuthorReadModel } from '../authorship/author-read-model'
import { DrizzleTagRepository } from '../tagging/tag-repository'
import { DrizzleTagReadModel } from '../tagging/tag-read-model'
import { DrizzleCatalogueReadModel } from './catalogue-read-model'

const NOW = '2026-10-28T09:00:00.000Z'

let db: Db
let store: Store
let authors: DrizzleAuthorRepository
let tags: DrizzleTagRepository
let catalogue: DrizzleCatalogueReadModel
let tagReads: DrizzleTagReadModel
let authorReads: DrizzleAuthorReadModel

/** A book saved the way a scan saves one, with its credits written beside it. */
async function shelve(
  over: Partial<DraftBook> & { title: string; authors: string[] },
): Promise<number> {
  const { id } = await store.addBook({ genre: FICTION_SLUG, ...over })
  const aliases = []
  for (const name of over.authors) {
    aliases.push(await authors.introduce(PrintedName.of(name), filingName(name)))
  }
  await authors.credit(id, aliases.map((alias) => alias.id))
  return id
}

/** A book photographed and not identified: in `books`, not in `catalogued_books`. */
async function queued(title: string): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO books (title, shelf_range, sort_key, scanned_at, state)
     VALUES (?, 'fiction', ?, ?, 'scanned') RETURNING id`,
    [title, title, NOW],
  )
  return Number(row?.id)
}

async function tag(bookId: number, slug: string, label: string): Promise<void> {
  await tags.define(TagSlug.of(slug), label)
  await tags.apply(bookId, [{
    slug: TagSlug.of(slug), source: 'person', confidence: 'high', addedAt: NOW,
  }])
}

beforeEach(async () => {
  db = await openTestDatabase()
  authors = new DrizzleAuthorRepository(db)
  tags = new DrizzleTagRepository(db)
  store = new Store(db, authors)
  catalogue = new DrizzleCatalogueReadModel(db)
  tagReads = new DrizzleTagReadModel(db)
  authorReads = new DrizzleAuthorReadModel(db)
})

afterAll(closeTestDatabase)

describe('ListBooksHandler', () => {
  it('narrows, pages and clamps, and never lists a queued book', async () => {
    const dune = await shelve({ title: 'Dune', authors: ['Frank Herbert'], location: '1A' })
    await shelve({ title: 'Children of Dune', authors: ['Frank Herbert'] })
    await shelve({ title: 'Sapiens', authors: ['Yuval Noah Harari'], genre: NON_FICTION_SLUG })
    await queued('Dune Messiah')
    await tag(dune, 'genre/fiction/space-opera', 'Space opera')

    const list = new ListBooksHandler(catalogue)

    const all = await list.handle({ range: null })
    expect(all.total).toBe(3)
    // Fiction then non-fiction, each in shelf order.
    expect(all.books.map((book) => book.title)).toEqual(['Children of Dune', 'Dune', 'Sapiens'])
    expect(all.books[0]).toHaveProperty('author_filing')

    const words = await list.handle({ range: null, words: 'dune' })
    expect(words.books.map((book) => book.title)).toEqual(['Children of Dune', 'Dune'])

    const tagged = await list.handle({ range: null, tags: [TagSlug.of('genre/fiction')] })
    expect(tagged.books.map((book) => book.id)).toContain(dune)

    const unplaced = await list.handle({ range: null, placed: false })
    expect(unplaced.books.map((book) => book.title)).toEqual(['Children of Dune', 'Sapiens'])

    const page = await list.handle({ range: null, limit: 1, offset: 1 })
    expect(page.books.map((book) => book.title)).toEqual(['Dune'])
    expect(page.total).toBe(3)

    // Asking for more than the largest page is asking for the largest page.
    const clamped = await list.handle({ range: null, limit: PAGE_LIMIT * 10 })
    expect(clamped.books).toHaveLength(3)
  })
})

describe('CountBooksHandler', () => {
  it('counts the catalogue, not the queue', async () => {
    await shelve({ title: 'Dune', authors: ['Frank Herbert'], location: '1A' })
    await shelve({ title: 'Sapiens', authors: ['Yuval Noah Harari'], genre: NON_FICTION_SLUG })
    await queued('Unknown')

    expect(await new CountBooksHandler(catalogue).handle()).toEqual({
      total: 2, fiction: 1, nonfiction: 1, checkedOut: 0, unplaced: 1,
    })
  })
})

describe('GetBookHandler', () => {
  it('answers a book in any state with its credits, and null for no such book', async () => {
    const dune = await shelve({ title: 'Dune', authors: ['Frank Herbert'] })
    const scanned = await queued('Half a cover')
    const get = new GetBookHandler(catalogue, authorReads)

    const found = await get.handle({ id: dune })
    expect(found?.book.title).toBe('Dune')
    expect(found?.authors).toEqual([expect.objectContaining({
      position: 1, displayName: 'Frank Herbert', filingName: 'Herbert, Frank',
    })])
    expect(found?.printed).toEqual(['Frank Herbert'])

    // A lookup by id is not the catalogue: the queue's book answers too.
    expect((await get.handle({ id: scanned }))?.book.state).toBe('scanned')
    expect(await get.handle({ id: 999_999 })).toBeNull()
  })
})

describe('VocabularyHandler', () => {
  it('rolls the counts up and says which words a rule asks for', async () => {
    const dune = await shelve({ title: 'Dune', authors: ['Frank Herbert'] })
    await tag(dune, 'genre/fiction/space-opera', 'Space opera')
    await tags.define(TagSlug.of('mood/bleak'), 'Bleak')

    const vocabulary = new VocabularyHandler(tagReads)

    const under = await vocabulary.handle({ under: TagSlug.of('genre') })
    expect(under.map((one) => one.slug)).not.toContain('mood/bleak')
    const fiction = under.find((one) => one.slug === 'genre/fiction')
    // Dune carries `genre/fiction` itself and Space opera under it: one book.
    expect(fiction).toMatchObject({ books: 1, ruled: true })
    expect(under.find((one) => one.slug === 'genre/fiction/space-opera'))
      .toMatchObject({ label: 'Space opera', books: 1, ruled: false })

    const everything = await vocabulary.handle({})
    expect(everything.find((one) => one.slug === 'mood/bleak'))
      .toEqual({ slug: 'mood/bleak', label: 'Bleak', note: '', books: 0, ruled: false })
  })
})

describe('TagsOfBookHandler', () => {
  it('answers a book\'s tags with their labels, and null for no such book', async () => {
    const dune = await shelve({ title: 'Dune', authors: ['Frank Herbert'] })
    await tag(dune, 'genre/fiction/space-opera', 'Space opera')
    const tagsOf = new TagsOfBookHandler(catalogue, tagReads)

    expect(await tagsOf.handle({ bookId: dune })).toContainEqual({
      slug: 'genre/fiction/space-opera', label: 'Space opera', source: 'person', confidence: 'high',
    })
    // A book that exists and carries nothing is an empty list, not a missing book.
    expect(await tagsOf.handle({ bookId: await queued('Bare') })).toEqual([])
    expect(await tagsOf.handle({ bookId: 999_999 })).toBeNull()
  })
})

describe('ListAuthorsHandler', () => {
  it('answers everybody with every name they publish under', async () => {
    await shelve({ title: 'Dune', authors: ['Frank Herbert'] })
    await shelve({ title: 'Good Omens', authors: ['Terry Pratchett', 'Neil Gaiman'] })

    const everyone = await new ListAuthorsHandler(authorReads).handle()
    expect(everyone.map((one) => one.primary)).toEqual(['Frank Herbert', 'Terry Pratchett', 'Neil Gaiman'])
    expect(everyone[0]).toEqual({
      id: expect.any(Number),
      isCorporate: false,
      note: '',
      primary: 'Frank Herbert',
      aliases: [{
        id: expect.any(Number), displayName: 'Frank Herbert', filingName: 'Herbert, Frank', isPrimary: true,
      }],
    })
  })
})

describe('BooksByAuthorHandler', () => {
  it('answers every book crediting the person, in any state, and null for nobody', async () => {
    const dune = await shelve({ title: 'Dune', authors: ['Frank Herbert'] })
    await shelve({ title: 'Sapiens', authors: ['Yuval Noah Harari'], genre: NON_FICTION_SLUG })
    const draft = await queued('Dune Messiah')
    const herbert = (await authors.aliasFor(PrintedName.of('Frank Herbert')))!
    await authors.credit(draft, [herbert.id])

    const byAuthor = new BooksByAuthorHandler(authorReads, catalogue)

    const found = await byAuthor.handle({ authorId: herbert.authorId })
    expect(found?.author.primary).toBe('Frank Herbert')
    // Wider than the listing: the queued book is still his.
    expect(found?.books.map((book) => book.id)).toEqual([dune, draft])
    expect(await byAuthor.handle({ authorId: 999_999 })).toBeNull()
  })
})

describe('CreditsOfBookHandler', () => {
  it('answers who a book credits in printed order, and null for no such book', async () => {
    const omens = await shelve({ title: 'Good Omens', authors: ['Terry Pratchett', 'Neil Gaiman'] })
    const creditsOf = new CreditsOfBookHandler(catalogue, authorReads)

    expect((await creditsOf.handle({ bookId: omens }))?.map((one) => [one.position, one.displayName]))
      .toEqual([[1, 'Terry Pratchett'], [2, 'Neil Gaiman']])
    expect(await creditsOf.handle({ bookId: 999_999 })).toBeNull()
  })
})

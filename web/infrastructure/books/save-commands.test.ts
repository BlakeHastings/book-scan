/**
 * The book save commands against a real Postgres: every invariant the issue
 * names, read back out of the rows rather than out of the aggregate.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/driver'
import { closeTestDatabase, openTestDatabase } from '../../server/testdb'
import { ReviseBookHandler, type ReviseBook } from '../../application/books/commands/revise-book'
import { rangeLock } from '../../application/locks'
import { TagSlug, type TagSource } from '../../domain/tagging/tags'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { DbUnitOfWork } from '../db/unit-of-work'
import { DrizzleTagRepository } from '../tagging/tag-repository'
import { DrizzleAuthorRepository } from '../authorship/author-repository'
import { DrizzleBookRepository } from './book-repository'
import { DrizzlePlacementOnSave } from './placement-on-save'
import { Shelves } from '../../server/shelves'

const NOW = '2026-10-28T09:00:00.000Z'
const DUNE = '9780441013593'
const EMMA = '9780141439587'

let db: Db
let tags: DrizzleTagRepository
let authors: DrizzleAuthorRepository
let revise: ReviseBookHandler

async function aBook(state = 'shelved', isbn13 = DUNE): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO books (title, isbn13, shelf_range, sort_key, scanned_at, "state")
     VALUES ('Dune', ?, 'fiction', 'k', '2026-08-06', ?) RETURNING id`,
    [isbn13, state],
  )
  return Number(row?.id)
}

async function carrying(id: number, slug: string, source: TagSource): Promise<void> {
  await tags.define(TagSlug.of(slug), slug)
  await tags.apply(id, [{ slug: TagSlug.of(slug), source, confidence: 'high', addedAt: NOW }])
}

const slugsOf = async (id: number) =>
  (await tags.of(id)).map((one) => `${one.slug.value}:${one.source}`).sort()

const row = (id: number) => db.get<{
  state: string; shelf_range: string; sort_key: string; title_filing: string; isbn13: string; isbn10: string
}>('SELECT "state", shelf_range, sort_key, title_filing, isbn13, isbn10 FROM books WHERE id = ?', [id])

const ledger = (id: number) => db.all<{ kind: string; area_id: number }>(
  'SELECT kind, area_id FROM book_placement WHERE book_id = ? ORDER BY id', [id])

const edit = (id: number, over: Partial<ReviseBook> = {}): ReviseBook => ({
  bookId: id,
  description: { title: 'Dune', authors: ['Frank Herbert'], isbn13: DUNE, classificationSource: 'manual' },
  genre: FICTION_SLUG,
  now: NOW,
  ...over,
})

beforeEach(async () => {
  db = await openTestDatabase()
  tags = new DrizzleTagRepository(db)
  authors = new DrizzleAuthorRepository(db)
  const shelves = new Shelves(db)
  revise = new ReviseBookHandler(
    new DrizzleBookRepository(db), authors, tags,
    new DrizzlePlacementOnSave(db, (range, id) => shelves.areaOf(range, id)),
    new DbUnitOfWork(db),
  )
})

afterAll(async () => {
  await closeTestDatabase()
})

describe('revising a book', () => {
  it('answers null and writes nothing for a book that is not there', async () => {
    expect(await revise.handle(edit(999))).toBeNull()
  })

  it("withdraws the old book's tags before the new genre is read, so it files under the new one", async () => {
    const id = await aBook()
    await carrying(id, 'genre/fiction', 'person')
    await carrying(id, 'subject/sand', 'catalogue')
    await carrying(id, 'mine/signed', 'person')

    const revised = await revise.handle(edit(id, {
      description: { title: 'Emma', authors: ['Jane Austen'], isbn13: EMMA, classificationSource: 'auto' },
      genre: NON_FICTION_SLUG,
    }))

    expect(revised?.placement?.range).toBe('nonfiction')
    expect((await row(id))?.shelf_range).toBe('nonfiction')
    expect(await slugsOf(id)).toEqual(['genre/non-fiction:guess', 'mine/signed:person'])
  })

  it("leaves a person's genre alone when a guess is saved over it", async () => {
    const id = await aBook()
    await carrying(id, 'genre/fiction', 'person')

    await revise.handle(edit(id, {
      description: { title: 'Dune', authors: [], isbn13: DUNE, classificationSource: 'auto' },
      genre: NON_FICTION_SLUG,
    }))
    expect((await row(id))?.shelf_range).toBe('fiction')
    expect(await slugsOf(id)).toEqual(['genre/fiction:person', 'genre/non-fiction:guess'])
  })

  it('withdraws the guess when a person answers', async () => {
    const id = await aBook()
    await carrying(id, 'genre/non-fiction', 'guess')
    await revise.handle(edit(id))
    expect(await slugsOf(id)).toEqual(['genre/fiction:person'])
  })

  it('resolves the ISBN pair and keeps what was typed when it is not one', async () => {
    const id = await aBook()
    await revise.handle(edit(id, { description: { title: 'Dune', authors: [], isbn10: '0441013597' } }))
    expect(await row(id)).toMatchObject({ isbn13: DUNE, isbn10: '0441013597' })

    await revise.handle(edit(id, { description: { title: 'Dune', authors: [], isbn13: '12345' } }))
    expect(await row(id)).toMatchObject({ isbn13: '12345', isbn10: '' })
  })

  it.each([
    ['identified', 'shelved'],
    ['checked_out', 'checked_out'],
    ['withdrawn', 'withdrawn'],
  ])('moves a %s book to %s', async (before, after) => {
    const id = await aBook(before)
    await revise.handle(edit(id))
    expect((await row(id))?.state).toBe(after)
  })

  it('credits each name once, numbered from 1, and files the first under an override', async () => {
    const id = await aBook()
    const revised = await revise.handle(edit(id, {
      description: { title: 'Good Omens', authors: ['Terry Pratchett', 'Neil Gaiman', 'terry pratchett'], isbn13: DUNE },
      authorFilingOverride: 'PRATCHETT, T',
    }))

    const credits = await authors.creditsOf(id)
    expect(credits.map((one) => one.name.value)).toEqual(['Terry Pratchett', 'Neil Gaiman'])
    expect(credits[0]?.filing).toBe('PRATCHETT, T')
    const positions = await db.all<{ position: number }>(
      'SELECT position FROM book_author WHERE book_id = ? ORDER BY position', [id])
    expect(positions.map((one) => one.position)).toEqual([1, 2])
    expect(revised?.filing.authorFiling).toBe('PRATCHETT, T')
    expect((await row(id))?.sort_key).toBe(revised?.filing.sortKey)
  })

  it('records a placement only for a plank somebody named, never where the book lands', async () => {
    const id = await aBook()
    await revise.handle(edit(id))
    expect(await ledger(id)).toEqual([])

    await revise.handle(edit(id, { location: '1A' }))
    expect((await ledger(id)).map((one) => one.kind)).toEqual(['placed'])
  })

  it('writes nothing at all when the plank it names does not exist', async () => {
    const id = await aBook()
    await carrying(id, 'genre/non-fiction', 'guess')
    const before = await row(id)

    await expect(revise.handle(edit(id, {
      description: { title: 'Changed', authors: ['Somebody New'], isbn13: DUNE, classificationSource: 'manual' },
      location: '9Z',
    }))).rejects.toThrow()

    expect(await row(id)).toEqual(before)
    expect(await slugsOf(id)).toEqual(['genre/non-fiction:guess'])
    expect(await authors.creditsOf(id)).toEqual([])
  })

  it('waits for whoever holds its range, having taken the book first', async () => {
    const id = await aBook()
    const order: string[] = []
    const holding = new DbUnitOfWork(db).run(async () => {
      order.push('range held')
      await new Promise((resolve) => setTimeout(resolve, 150))
      order.push('range let go')
    }, { serialiseOn: [rangeLock('fiction')] })
    await new Promise((resolve) => setTimeout(resolve, 30))

    await revise.handle(edit(id))
    order.push('revised')
    await holding
    expect(order).toEqual(['range held', 'range let go', 'revised'])
  })
})

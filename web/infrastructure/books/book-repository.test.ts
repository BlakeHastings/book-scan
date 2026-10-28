/**
 * The book repository, and the tag commands that load and save through it,
 * against a real Postgres.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/driver'
import { closeTestDatabase, openTestDatabase } from '../../server/testdb'
import { ApplyTagHandler } from '../../application/tagging/commands/apply-tag'
import { RemoveTagHandler } from '../../application/tagging/commands/remove-tag'
import { TagSlug } from '../../domain/tagging/tags'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { DbUnitOfWork } from '../db/unit-of-work'
import { DrizzleTagRepository } from '../tagging/tag-repository'
import { DrizzleAuthorRepository } from '../authorship/author-repository'
import { PrintedName } from '../../domain/authorship/authors'
import { DrizzleBookRepository } from './book-repository'

const NOW = '2026-10-28T09:00:00.000Z'

let db: Db
let books: DrizzleBookRepository
let tags: DrizzleTagRepository

async function aBook(state = 'shelved'): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO books (title, isbn13, shelf_range, sort_key, scanned_at, "state",
                        title_guess, claimed_by, claimed_at, draft_json)
     VALUES ('Dune', '9780441013593', 'fiction', 'k', '2026-08-06', ?,
             'DUNE?', 'somebody', '2026-10-28', '{"a":1}') RETURNING id`,
    [state],
  )
  return Number(row?.id)
}

const slugsOf = async (id: number) =>
  (await tags.of(id)).map((one) => `${one.slug.value}:${one.source}`)

beforeEach(async () => {
  db = await openTestDatabase()
  books = new DrizzleBookRepository(db)
  tags = new DrizzleTagRepository(db)
})

afterAll(async () => {
  await closeTestDatabase()
})

describe('loading a book', () => {
  it('answers null for a book that is not there', async () => {
    expect(await books.load(999)).toBeNull()
  })

  it('loads a book in any state, with its tags and credits', async () => {
    const id = await aBook('scanned')
    await tags.define(TagSlug.of('mine/signed'), 'Signed')
    await tags.apply(id, [{ slug: TagSlug.of('mine/signed'), source: 'person', confidence: 'high', addedAt: NOW }])

    const book = await books.load(id)
    expect(book?.state).toBe('scanned')
    expect(book?.tags.map((one) => one.slug.value)).toEqual(['mine/signed'])
  })
})

describe('saving a book', () => {
  it('writes what the book says, and reads back the same', async () => {
    const id = await aBook('identified')
    const authors = new DrizzleAuthorRepository(db)
    const herbert = await authors.introduce(PrintedName.parse('Frank Herbert')!, 'HERBERT, FRANK')

    const book = (await books.load(id))!
    book.confirm({ title: 'Dune Messiah', authors: ['Frank Herbert'], isbn10: '0441172695' })
    await tags.define(TagSlug.of(FICTION_SLUG), 'Fiction')
    book.stateGenre({ genre: FICTION_SLUG, classificationSource: 'manual' }, NOW)
    book.file('HERBERT, FRANK')
    book.credit([herbert.id, herbert.id])
    await new DbUnitOfWork(db).run(() => books.save(book))

    const back = (await books.load(id))!
    expect(back.state).toBe('shelved')
    expect(back.record.title).toBe('Dune Messiah')
    expect([back.record.isbn13, back.record.isbn10]).toEqual(['9780441172696', '0441172695'])
    expect(back.record.authors).toEqual(['Frank Herbert'])
    expect(back.shelfRange).toBe('fiction')
    expect(back.filing).toEqual(book.filing)
    expect(back.credits).toEqual([herbert.id])
    expect(await slugsOf(id)).toEqual(['genre/fiction:person'])
  })

  it("never writes the queue's columns or where the book stands", async () => {
    const id = await aBook('identified')
    const untouched = `SELECT title_guess, claimed_by, claimed_at, draft_json, current_area_id,
                              scanned_at FROM books WHERE id = ?`
    const before = await db.get(untouched, [id])

    const book = (await books.load(id))!
    book.confirm({ title: 'Dune', authors: [] })
    book.stateGenre({ genre: null }, NOW)
    book.file('')
    await books.save(book)

    expect(await db.get(untouched, [id])).toEqual(before)
  })

  it('leaves a book checked out while it was being edited checked out', async () => {
    const id = await aBook('shelved')
    const book = (await books.load(id))!
    await db.run(`UPDATE books SET "state" = 'checked_out' WHERE id = ?`, [id])

    book.revise({ title: 'Dune', authors: [] })
    await books.save(book)
    expect((await books.load(id))?.state).toBe('checked_out')
  })
})

describe('a person tagging a book', () => {
  const unitOfWork = () => new DbUnitOfWork(db)

  it('makes the word, then puts the book under it as a person', async () => {
    const id = await aBook()
    const done = await new ApplyTagHandler(books, tags, unitOfWork()).handle({
      bookId: id, slug: TagSlug.of('mine/lent-out'), label: 'Lent Out', now: NOW,
    })

    expect(done).toBe(true)
    expect(await slugsOf(id)).toEqual(['mine/lent-out:person'])
    expect((await tags.vocabulary(TagSlug.of('mine/lent-out')))[0]?.label).toBe('Lent Out')
  })

  it('takes every source off when a person removes a tag', async () => {
    const id = await aBook()
    await tags.define(TagSlug.of('genre/fiction'), 'Fiction')
    await tags.apply(id, [
      { slug: TagSlug.of('genre/fiction'), source: 'catalogue', confidence: 'high', addedAt: NOW },
      { slug: TagSlug.of('genre/fiction'), source: 'person', confidence: 'high', addedAt: NOW },
    ])

    expect(await new RemoveTagHandler(books, unitOfWork()).handle({
      bookId: id, slug: TagSlug.of('genre/fiction'),
    })).toBe(true)
    expect(await tags.of(id)).toEqual([])
  })

  it('writes nothing and says so for a book that is not there', async () => {
    expect(await new ApplyTagHandler(books, tags, unitOfWork()).handle({
      bookId: 999, slug: TagSlug.of('mine/lent-out'), label: 'Lent out', now: NOW,
    })).toBe(false)
    expect(await tags.vocabulary(TagSlug.of('mine/lent-out'))).toEqual([])
    expect(await new RemoveTagHandler(books, unitOfWork()).handle({
      bookId: 999, slug: TagSlug.of('mine/lent-out'),
    })).toBe(false)
  })

  it("leaves the book's row alone", async () => {
    const id = await aBook()
    const before = await db.get('SELECT * FROM books WHERE id = ?', [id])
    await new ApplyTagHandler(books, tags, unitOfWork()).handle({
      bookId: id, slug: TagSlug.of('mine/signed'), label: 'Signed', now: NOW,
    })
    expect(await db.get('SELECT * FROM books WHERE id = ?', [id])).toEqual(before)
  })
})

/**
 * The repair pass for rows that were derived by older code, against a real
 * database. The row it exists for is the one #195 wrote: a book whose author is
 * in a script with no `A-Z` in it, saved with an empty filing name and a sort
 * key that puts it ahead of everything in its range.
 *
 * A row like that cannot be produced by saving a book any more, so the fixture
 * below writes one the way an adopted catalogue holds it: with the columns as
 * the old derivation left them.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { SEP } from '../shared/shelving'
import { Store, type DraftBook } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { PrintedName } from '../domain/authorship/authors'
import { refileBooks } from './refile'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'

function draft(over: Partial<DraftBook> & { title: string; authors: string[] }): DraftBook {
  return { genre: FICTION_SLUG, ...over }
}

let store: Store
let db: Db

beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
})

afterAll(closeTestDatabase)

/** Put the columns back the way the pre-#195 derivation left them. */
async function asOldCodeSavedIt(id: number, authorFiling: string): Promise<void> {
  const row = await store.getBook(id)
  await db.run('UPDATE books SET author_filing = ?, sort_key = ? WHERE id = ?', [
    authorFiling,
    [authorFiling, ...row!.sort_key.split(SEP).slice(1)].join(SEP),
    id,
  ])
}

describe('recomputing the keys of books saved by older code', () => {
  it('leaves a catalogue nothing has changed under it completely alone', async () => {
    await store.addBook(draft({ title: 'Dune', authors: ['Frank Herbert'], location: '1A' }))
    await store.addBook(draft({ title: 'Persuasion', authors: ['Jane Austen'], location: '1A' }))

    const report = await refileBooks(store, { apply: true })

    expect(report.examined).toBe(2)
    expect(report.moved).toEqual([])
    expect(report.written).toBe(0)
  })

  it('finds the book that was filed under nobody, and says where it belongs', async () => {
    const { id } = await store.addBook(
      draft({ title: 'Crime and Punishment', authors: ['Фёдор Достоевский'], location: '2C' }),
    )
    await asOldCodeSavedIt(id, '')

    const report = await refileBooks(store, { apply: false })

    expect(report.moved).toHaveLength(1)
    expect(report.moved[0]!.authorFiling).toEqual(['', 'Достоевский, Фёдор'])
    // A dry run is the answer to "which books are wrong", so it must not have
    // answered it by fixing them.
    expect(report.written).toBe(0)
    expect((await store.getBook(id))!.author_filing).toBe('')
  })

  it('writes the recomputed key only when told to, and counts what it wrote', async () => {
    const { id } = await store.addBook(
      draft({ title: 'Crime and Punishment', authors: ['Фёдор Достоевский'], location: '2C' }),
    )
    await asOldCodeSavedIt(id, '')

    const report = await refileBooks(store, { apply: true })

    expect(report.written).toBe(1)
    const row = await store.getBook(id)
    expect(row!.author_filing).toBe('Достоевский, Фёдор')
    expect(row!.sort_key.startsWith(SEP)).toBe(false)

    // Idempotent: the second pass has nothing left to find.
    expect((await refileBooks(store, { apply: true })).moved).toEqual([])
  })

  it('moves the book out of first place in the range', async () => {
    await store.addBook(draft({ title: 'Persuasion', authors: ['Jane Austen'], location: '1A' }))
    const { id } = await store.addBook(
      draft({ title: 'Crime and Punishment', authors: ['Фёдор Достоевский'], location: '1A' }),
    )
    await asOldCodeSavedIt(id, '')

    const before = (await store.listRange('fiction')).map((book) => book.title)
    expect(before[0]).toBe('Crime and Punishment')

    await refileBooks(store, { apply: true })

    const after = (await store.listRange('fiction')).map((book) => book.title)
    expect(after).toEqual(['Persuasion', 'Crime and Punishment'])
  })

  it('honours a name somebody has filed, the same way a save would', async () => {
    const { id } = await store.addBook(
      draft({ title: 'Norwegian Wood', authors: ['村上春樹'], location: '3A' }),
    )
    await asOldCodeSavedIt(id, '')
    // What the override table used to hold, on the alias it moved to (#227).
    const authors = new DrizzleAuthorRepository(db)
    const alias = await authors.introduce(PrintedName.of('村上春樹'), 'Murakami, Haruki')
    await authors.file(alias.id, 'Murakami, Haruki')

    await refileBooks(store, { apply: true })

    expect((await store.getBook(id))!.author_filing).toBe('Murakami, Haruki')
  })
})

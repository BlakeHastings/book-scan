/**
 * Every act that can change where a shelved book files, asked the one question
 * the needs-attention list and the carry list must answer alike: which books
 * does this send somebody to the shelf for?
 *
 * The needs-attention list derives the answer from sort keys; the carry list
 * reads `assigned` against `placed`. An act that re-keys a book and writes no
 * assignment is seen by the first and not the second.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import { testBooks, type TestBooks } from './testbooks'
import type { Db } from './driver'
import { outstandingWork } from './carry'
import { Shelves } from './shelves'
import { Store, type DraftBook } from './store'
import { refileBooks } from './refile'
import { plankAt } from '../shared/layout'
import { SEP } from '../shared/shelving'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { FileAliasHandler, MergeAuthorsHandler } from '../application/authorship/curate-authors'
import { standingOf } from '../domain/placement/ledger'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'

let db: Db
let store: Store
let shelves: Shelves
let books: TestBooks

beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)
  books = testBooks(db)
})

afterAll(closeTestDatabase)

const fiction = (title: string, author: string, over: Partial<DraftBook> = {}): DraftBook =>
  ({ title, authors: [author], genre: FICTION_SLUG, classificationSource: 'manual', ...over })

/** Which books each list sends somebody to the shelf for, across both runs. */
const bothLists = async () => ({
  review: [
    ...(await shelves.review('fiction')).misfiles,
    ...(await shelves.review('nonfiction')).misfiles,
  ].map((m) => m.book.id).sort(),
  carry: (await outstandingWork(db)).trips.flatMap((trip) => trip.books.map((b) => b.id)).sort(),
})

async function locations(...ids: number[]): Promise<string[]> {
  return Promise.all(ids.map(async (id) => (await store.getBook(id))!.location))
}

describe('an edit that re-keys a shelved book', () => {
  it('puts it on the carry list when a filing name moves it to another plank', async () => {
    const austen = (await books.catalogue(fiction('Persuasion', 'Jane Austen'))).id
    const zola = (await books.catalogue(fiction('Germinal', 'Émile Zola'))).id
    await shelves.overflow('fiction', plankAt('1A')!, 'area')
    await store.setLocation(zola, '1B')
    expect(await bothLists()).toEqual({ review: [], carry: [] })

    await books.revise(austen, fiction('Persuasion', 'Jane Austen', { authorFilingOverride: 'Zz, Jane' }))

    expect(await bothLists()).toEqual({ review: [austen], carry: [austen] })
    const trip = (await outstandingWork(db)).trips[0]
    expect([trip?.from, trip?.to]).toEqual(['1A', '1B'])
    // An assignment, never a placement: the book is still where it was put.
    expect(await locations(austen)).toEqual(['1A'])
  })

  it('names the plank by id, the one the review sends it to', async () => {
    const austen = (await books.catalogue(fiction('Persuasion', 'Jane Austen'))).id
    const zola = (await books.catalogue(fiction('Germinal', 'Émile Zola'))).id
    await shelves.overflow('fiction', plankAt('1A')!, 'area')
    await store.setLocation(zola, '1B')

    await books.revise(austen, fiction('Persuasion', 'Jane Austen', { authorFilingOverride: 'Zz, Jane' }))

    const standing = standingOf(await new DrizzlePlacementLedger(db).forBooks([austen]))
    const [misfile] = (await shelves.review('fiction')).misfiles
    expect(standing.assigned).toBe(misfile?.toAreaId)
    expect(standing.assigned).toBe(await shelves.areaOf('fiction', zola))
  })

  it('puts it on the carry list when the author is corrected to one filing past the boundary', async () => {
    const austen = (await books.catalogue(fiction('Persuasion', 'Jane Austen'))).id
    const zola = (await books.catalogue(fiction('Germinal', 'Émile Zola'))).id
    await shelves.overflow('fiction', plankAt('1A')!, 'area')
    await store.setLocation(zola, '1B')

    await books.revise(austen, fiction('Persuasion', 'Yann Zz'))

    expect(await bothLists()).toEqual({ review: [austen], carry: [austen] })
  })

  it('puts it on the carry list when a genre change moves it to the other run', async () => {
    const austen = (await books.catalogue(fiction('Persuasion', 'Jane Austen'))).id
    expect(await bothLists()).toEqual({ review: [], carry: [] })

    await books.revise(austen, fiction('Persuasion', 'Jane Austen', { genre: NON_FICTION_SLUG }))

    expect(await bothLists()).toEqual({ review: [austen], carry: [austen] })
  })

  it('writes nothing when the new key stays on the same plank', async () => {
    const austen = (await books.catalogue(fiction('Persuasion', 'Jane Austen'))).id
    const zola = (await books.catalogue(fiction('Germinal', 'Émile Zola'))).id
    await shelves.overflow('fiction', plankAt('1A')!, 'area')
    await store.setLocation(zola, '1B')

    await books.revise(austen, fiction('Persuasion', 'Jane Austen', { authorFilingOverride: 'Brontë, Jane' }))

    expect(await bothLists()).toEqual({ review: [], carry: [] })
    expect((await new DrizzlePlacementLedger(db).forBooks([austen])).map((row) => row.kind))
      .toEqual(['placed'])
  })

  it('writes nothing for a book that is out of the house', async () => {
    const austen = (await books.catalogue(fiction('Persuasion', 'Jane Austen'))).id
    const zola = (await books.catalogue(fiction('Germinal', 'Émile Zola'))).id
    await shelves.overflow('fiction', plankAt('1A')!, 'area')
    await store.setLocation(zola, '1B')
    await store.setCheckedOut(austen, true)

    await books.revise(austen, fiction('Persuasion', 'Jane Austen', { authorFilingOverride: 'Zz, Jane' }))

    expect(standingOf(await new DrizzlePlacementLedger(db).forBooks([austen])).assigned).toBeNull()
  })

  it('leaves the book where it was put, and carrying it closes the trip', async () => {
    const austen = (await books.catalogue(fiction('Persuasion', 'Jane Austen'))).id
    const zola = (await books.catalogue(fiction('Germinal', 'Émile Zola'))).id
    await shelves.overflow('fiction', plankAt('1A')!, 'area')
    await store.setLocation(zola, '1B')
    await books.revise(austen, fiction('Persuasion', 'Jane Austen', { authorFilingOverride: 'Zz, Jane' }))

    await store.setLocation(austen, '1B')

    expect(await bothLists()).toEqual({ review: [], carry: [] })
  })
})

describe('recomputing every key from the command line', () => {
  it('puts a book the new key moves on the carry list', async () => {
    const austen = (await books.catalogue(fiction('Persuasion', 'Jane Austen'))).id
    const zola = (await books.catalogue(fiction('Germinal', 'Émile Zola'))).id
    await shelves.overflow('fiction', plankAt('1A')!, 'area')
    await store.setLocation(zola, '1B')
    // A key older code wrote, past the boundary, under a name that files at A.
    const row = await store.getBook(austen)
    await db.run('UPDATE books SET sort_key = ? WHERE id = ?',
      [['ZZ', ...row!.sort_key.split(SEP).slice(1)].join(SEP), austen])
    await store.setLocation(austen, '1B')
    expect(await bothLists()).toEqual({ review: [], carry: [] })

    const report = await refileBooks(store, { apply: true })

    expect(report.written).toBe(1)
    expect(await bothLists()).toEqual({ review: [austen], carry: [austen] })
  })

  it('writes no assignment on a dry run', async () => {
    const austen = (await books.catalogue(fiction('Persuasion', 'Jane Austen'))).id
    const zola = (await books.catalogue(fiction('Germinal', 'Émile Zola'))).id
    await shelves.overflow('fiction', plankAt('1A')!, 'area')
    await store.setLocation(zola, '1B')
    const row = await store.getBook(austen)
    await db.run('UPDATE books SET sort_key = ? WHERE id = ?',
      [['ZZ', ...row!.sort_key.split(SEP).slice(1)].join(SEP), austen])
    await store.setLocation(austen, '1B')

    await refileBooks(store, { apply: false })

    expect(await bothLists()).toEqual({ review: [], carry: [] })
  })
})

/**
 * Neither of these writes a sort key (docs/shelving.md, "Author filing name":
 * correcting a name "does not move any book that is already shelved, because a
 * sort key is written by a save"), so neither has anything to tell the carry
 * list, and the review must agree that nothing moved.
 */
describe('acts on names that move no book', () => {
  it('filing an alias differently leaves both lists empty', async () => {
    const austen = (await books.catalogue(fiction('Persuasion', 'Jane Austen'))).id
    const zola = (await books.catalogue(fiction('Germinal', 'Émile Zola'))).id
    await shelves.overflow('fiction', plankAt('1A')!, 'area')
    await store.setLocation(zola, '1B')
    const authors = new DrizzleAuthorRepository(db)
    const [alias] = await authors.creditsOf(austen)

    await new FileAliasHandler(authors).handle({ aliasId: alias!.id, filing: 'Zz, Jane' })

    expect(await bothLists()).toEqual({ review: [], carry: [] })
  })

  it('merging two authors leaves both lists empty', async () => {
    const austen = (await books.catalogue(fiction('Persuasion', 'Jane Austen'))).id
    const zola = (await books.catalogue(fiction('Germinal', 'Émile Zola'))).id
    await shelves.overflow('fiction', plankAt('1A')!, 'area')
    await store.setLocation(zola, '1B')
    const authors = new DrizzleAuthorRepository(db)
    const [into] = await authors.creditsOf(zola)
    const [from] = await authors.creditsOf(austen)

    await new MergeAuthorsHandler(authors).handle({ intoId: into!.authorId, fromId: from!.authorId })

    expect(await bothLists()).toEqual({ review: [], carry: [] })
  })
})

/**
 * Separators against a real database, including the case the feature exists
 * for: a shelf that is physically full and a book that belongs in the middle
 * of it.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { CaptureQueue } from './queue'
import { outstandingWork } from './carry'
import { addAreaTo, editFixture } from './furniture'
import { UnknownPlank } from './placement-ledger'
import { Shelves } from './shelves'
import { Store, type DraftBook } from './store'
import { areaLabel, layoutRange, NEWCOMER_ID, plankAt, type PlankAt } from '../shared/layout'
import type { ShelfRange } from '../shared/shelving'
import { areaFaces } from '../infrastructure/shelving/areas'
import { areaDisagreements, describeAreaDisagreement } from '../infrastructure/shelving/area-drift'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { genreStatedBy } from '../domain/tagging/genre'
import { needsAttention, standingOf } from '../domain/placement/ledger'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'

let store: Store
let shelves: Shelves
let db: Db

// Both databases, since stage F. Nothing below knows which. See testdb.ts.
beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)
})

afterAll(closeTestDatabase)

/**
 * The plank an address names, which is what a route works out from the area id a
 * screen sends before it asks for anything (#359). Written out here so a test
 * can go on saying `1A` while the code it drives takes the plank.
 */
const plank = (label: string): PlankAt => plankAt(label)!

/** Authors chosen so alphabetical order matches the argument order. */
const add = async (author: string, title = 'Book') =>
  (await store.addBook({ title, authors: [author], genre: FICTION_SLUG })).id

/**
 * Where a draft would go, and saving an edit, filed under the genre the draft
 * states. The range arrives beside the draft since #223; see `store.test.ts`.
 */
/** The range the draft's own genre files it into. A draft here always states one. */
const rangeOf = (of: DraftBook): ShelfRange => {
  const { range } = genreStatedBy(of)
  if (range === null) throw new Error('That draft states no genre, so nothing files it.')
  return range
}

const placementFor = (of: DraftBook, excludeId?: number) =>
  store.placementFor(of, rangeOf(of), excludeId)

const updateBook = (id: number, of: DraftBook) =>
  store.updateBook(id, of, rangeOf(of))

const labels = async () => (await shelves.layout('fiction')).map((p) => p.label)

/**
 * Which way a book can be carried, as the two planks read.
 *
 * `boundaryOptions` answers a plank each way rather than a label each way
 * (#359), and most of these tests are about whether a direction is open at all.
 * The tests that are about identity, which is the ones with a named bookcase in
 * them, read `areaId` off the row instead.
 */
const offered = async (bookId: number, range: ShelfRange = 'fiction') => {
  const options = await shelves.boundaryOptions(range, bookId)
  return {
    next: options.next?.label ?? null,
    previous: options.previous?.label ?? null,
  }
}

describe('before anything is marked full', () => {
  it('puts every book on the first shelf', async () => {
    await add('Ann Author')
    await add('Bob Baker')
    expect(await labels()).toEqual(['1A', '1A'])
  })
})

describe('saying a shelf is full', () => {
  it('moves its last book to a new shelf and reports the step', async () => {
    await add('Ann Author')
    const bob = await add('Bob Baker')
    expect(await labels()).toEqual(['1A', '1A'])

    const result = await shelves.overflow('fiction', plank('1A'), 'area')
    expect(result.ok).toBe(true)
    expect(result.step?.moved.id).toBe(bob)
    expect(result.step?.from).toBe('1A')
    expect(result.step?.to).toBe('1B')
    expect(await labels()).toEqual(['1A', '1B'])
    expect(result.moves).toEqual([{
      id: bob, from: '1A', to: '1B',
      fromAt: { shelf: 1, area: 0 }, toAt: { shelf: 1, area: 1 },
    }])
    // The plank beside the name for it, and it is the plank the layout now puts
    // the displaced book on. That is what the person records when they say they
    // have carried it, and a name could not have said it (#359).
    expect(result.planks?.to.label).toBe('1B')
    expect(result.planks?.to.areaId).toBe(await shelves.areaOf('fiction', bob))
  })

  it('can start a whole new bookcase instead', async () => {
    await add('Ann Author')
    await add('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'shelf')
    expect(await labels()).toEqual(['1A', '2A'])
  })

  /*
   * It used to refuse this, saying the plank held only one book and that moving
   * it along would empty the shelf (#432). Emptying it is the point: the person
   * needs a gap on the plank the book in their hand belongs on, and on a plank
   * holding one book the gap is the whole plank. `docs/shelving.md` allows the
   * only book in an area to leave it, and says the cascade and a boundary moved
   * by hand write the same thing.
   */
  it('takes the only book off a shelf, leaving that shelf bare', async () => {
    const ann = await add('Ann Author')
    const result = await shelves.overflow('fiction', plank('1A'), 'area')
    expect(result.ok).toBe(true)
    expect(result.step?.moved.id).toBe(ann)
    expect(result.step?.from).toBe('1A')
    expect(result.step?.to).toBe('1B')
    // 1A is bare, so it has no books to name it and drops out of the layout
    // until something lands on it. Which is what the person is about to do.
    expect(await labels()).toEqual(['1B'])
  })

  it('walks the cascade one answer at a time', async () => {
    await add('Ann Author')
    const bob = await add('Bob Baker')
    const cal = await add('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')      // Cal to A2
    expect(await labels()).toEqual(['1A', '1A', '1B'])

    // A1 still will not do; say so again.
    const second = await shelves.overflow('fiction', plank('1A'), 'area')
    expect(second.step?.moved.id).toBe(bob)
    expect(await labels()).toEqual(['1A', '1B', '1B'])
    expect(cal).toBeGreaterThan(0)
  })
})

/**
 * The move offered before anybody has made it.
 *
 * The boundary used to shift the moment a step was proposed, so the book left
 * the plank the person was still standing at, and stayed gone if they walked
 * away (#111). A proposal is not an observation about the room.
 */
describe('proposing the move without making it', () => {
  it('names the same book the answer would move, and moves nothing', async () => {
    await add('Ann Author')
    const bob = await add('Bob Baker')

    const plan = await shelves.proposeOverflow('fiction', plank('1A'), 'area')
    expect(plan.ok).toBe(true)
    expect(plan.step?.moved.id).toBe(bob)
    expect(plan.step?.to).toBe('1B')

    // The shelf is exactly as it was, and so is the furniture.
    expect(await labels()).toEqual(['1A', '1A'])
    expect(await shelves.list('fiction')).toHaveLength(0)
  })

  it('draws the plank the book is going on, with the gap where it goes', async () => {
    await add('Ann Author')
    await add('Bob Baker')
    const cal = await add('Cal Church')
    // Cal is already on 1B, so the gap Bob would take is in front of him.
    await shelves.overflow('fiction', plank('1A'), 'area')

    const plan = await shelves.proposeOverflow('fiction', plank('1A'), 'area')
    expect(plan.strip?.label).toBe('1B')
    expect(plan.strip?.gapIndex).toBe(0)
    expect(plan.strip?.books.map((p) => p.book.id)).toEqual([cal])
  })

  it('offers the carry without making that either', async () => {
    const ann = await add('Ann Author')
    await store.setLocation(ann, '1A')
    const key = (await placementFor(
      { title: 'Book', authors: ['Bob Baker'], genre: FICTION_SLUG } as never,
    )).sortKey

    const plan = await shelves.proposeOverflow('fiction', plank('1A'), 'area', key)
    expect(plan.carry?.from).toBe('1A')
    expect(plan.carry?.to).toBe('1B')
    expect(await shelves.list('fiction')).toHaveLength(0)
  })

  it('reports the one refusal rather than pretending a move is available', async () => {
    await add('Ann Author')
    // A plank this run does not have is the only thing left to refuse (#432),
    // and the sentence says which planks it does have.
    const refused = await shelves.proposeOverflow('fiction', plank('9Z'), 'area')
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('There is no shelf 9Z')
    expect(refused.error).toContain('1A')
  })
})

/**
 * A cascade confirms its outermost move last (#110), so a proposal can be
 * several answers old by the time somebody says they carried it out. Applying
 * it to whatever book happens to be on the end by then is the stale answer
 * #106 fixed, one level in.
 */
describe('confirming a move that was proposed a while ago', () => {
  it('refuses when the plank no longer ends with the book named', async () => {
    await add('Ann Author')
    await add('Bob Baker')
    const cal = await add('Cal Church')

    // What the person was told to move, before anything else happened.
    const plan = await shelves.proposeOverflow('fiction', plank('1A'), 'area')
    expect(plan.step?.moved.id).toBe(cal)

    // Somebody else takes Cal off 1A in the meantime.
    await shelves.overflow('fiction', plank('1A'), 'area')

    const applied = await shelves.overflow('fiction', plank('1A'), 'area', '', cal)
    expect(applied.ok).toBe(false)
    expect(applied.error).toContain('changed')
    // And it changed nothing on the way to saying so.
    expect(await labels()).toEqual(['1A', '1A', '1B'])
  })

  it('applies it when the plank still ends with that book', async () => {
    await add('Ann Author')
    const bob = await add('Bob Baker')

    const applied = await shelves.overflow('fiction', plank('1A'), 'area', '', bob)
    expect(applied.ok).toBe(true)
    expect(await labels()).toEqual(['1A', '1B'])
  })
})

describe('placing a book on a shelf that is full', () => {
  /** Add a book and record where it landed, as saving does. */
  const shelve = async (author: string, title = 'Book') => {
    const id = await add(author, title)
    await store.setLocation(id, await shelves.labelFor('fiction', id))
    return id
  }

  /** The sort key of a book that is not saved yet. */
  const keyFor = async (author: string, title = 'Book') =>
    (await placementFor({ title, authors: [author], genre: FICTION_SLUG } as never)).sortKey

  it('sends the book in hand on when nothing on the shelf follows it', async () => {
    // The bug in #77. Ann and Bob fill 1A, Cal is on 1B, and the book being
    // placed is Baxter, who sorts after Bob and before Cal. Saying 1A is full
    // used to take Bob off the shelf and carry him to 1B for no reason.
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')
    expect(await labels()).toEqual(['1A', '1A', '1B'])

    const result = await shelves.overflow('fiction', plank('1A'), 'area', await keyFor('Bob Baxter'))
    expect(result.ok).toBe(true)
    expect(result.carry).toMatchObject({ from: '1A', to: '1B' })
    // Nobody was displaced, and no book already on a shelf changed shelf.
    expect(result.step).toBeUndefined()
    expect(result.moves).toEqual([])
    expect(await labels()).toEqual(['1A', '1A', '1B'])
    expect((await store.getBook(ann))?.location).toBe('1A')
    expect((await store.getBook(bob))?.location).toBe('1A')
  })

  it('lands the book where it was told once it is saved', async () => {
    await shelve('Ann Author')
    await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')

    const carried = await shelves.overflow('fiction', plank('1A'), 'area', await keyFor('Bob Baxter'))
    const baxter = await add('Bob Baxter')
    expect(await shelves.labelFor('fiction', baxter)).toBe(carried.carry?.to)
    expect(await labels()).toEqual(['1A', '1A', '1B', '1B'])
  })

  it('still displaces a book when the gap is in the middle', async () => {
    // The cascade is not weakened. Something genuinely has to move to open a
    // gap here, and it is the last book on the shelf that moves.
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')

    // Bailey sorts between Author and Baker, so Baker is still to his right.
    const result = await shelves.overflow('fiction', plank('1A'), 'area', await keyFor('Ann Bailey'))
    expect(result.carry).toBeUndefined()
    expect(result.step?.moved.id).toBe(bob)
    expect(result.step?.from).toBe('1A')
    expect(result.step?.to).toBe('1B')
  })

  it('makes a shelf at the end of the run rather than displacing anything', async () => {
    // The last area of the last bookcase. Nothing follows the book anywhere,
    // so there is nothing to displace and the plank it goes on gets made.
    await shelve('Ann Author')
    await shelve('Bob Baker')

    const result = await shelves.overflow('fiction', plank('1A'), 'area', await keyFor('Cal Church'))
    expect(result.ok).toBe(true)
    expect(result.carry).toMatchObject({ from: '1A', to: '1B' })
    expect(result.moves).toEqual([])
    expect(await labels()).toEqual(['1A', '1A'])

    const cal = await add('Cal Church')
    expect(await shelves.labelFor('fiction', cal)).toBe('1B')
  })

  it('starts a new bookcase for the book in hand when asked', async () => {
    await shelve('Ann Author')
    await shelve('Bob Baker')

    const result = await shelves.overflow('fiction', plank('1A'), 'shelf', await keyFor('Cal Church'))
    expect(result.carry?.to).toBe('2A')
    const cal = await add('Cal Church')
    expect(await shelves.labelFor('fiction', cal)).toBe('2A')
    expect(await labels()).toEqual(['1A', '1A', '2A'])
  })

  it('is preferred to the cascade on a shelf with one book on it', async () => {
    // Both answers exist here since #432: the cascade would take Author off 1A
    // and 1A would be bare. It is still the wrong one when the book in hand
    // goes at the end of the plank, because then it moves and nothing shelved
    // does, which is #77.
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(bob, '1B')
    expect(await labels()).toEqual(['1A', '1B'])

    // Offered rather than made, so the shelf is still there for the line below.
    expect((await shelves.proposeOverflow('fiction', plank('1A'), 'area')).step)
      .toMatchObject({ from: '1A', to: '1B' })

    // Bailey goes after Author and before Baker, so 1A is where he belongs and
    // there is nothing on it to his right.
    expect((await shelves.overflow('fiction', plank('1A'), 'area', await keyFor('Ann Bailey'))).carry)
      .toMatchObject({ from: '1A', to: '1B' })
  })

  it('ignores the book in hand while the chain walks other shelves', async () => {
    // The key is passed on every rung, and the special case only fires for the
    // shelf the book is actually going on. A rung about some other shelf still
    // gets the cascade.
    const ids: number[] = []
    for (const a of ['Ann Author', 'Bob Baker', 'Cal Church', 'Dot Downs']) ids.push(await shelve(a))
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(ids[3]!, '1B')
    expect(await labels()).toEqual(['1A', '1A', '1A', '1B'])

    const result = await shelves.overflow('fiction', plank('1B'), 'area', await keyFor('Ann Baxter'))
    expect(result.carry).toBeUndefined()
    // 1B holds one book, and it gives that one up like any other plank (#432):
    // Downs goes on to 1C and 1B is left bare for the book coming off 1A.
    expect(result.ok).toBe(true)
    expect(result.step?.moved.id).toBe(ids[3])
    expect(result.step?.from).toBe('1B')
    expect(result.step?.to).toBe('1C')
  })

  it('walks the whole chain through a plank that holds one book', async () => {
    /*
     * The case #432 reported. A person is handed a book off the end of 1A, they
     * carry it to 1B, and 1B holds one book and will not take it. The app used
     * to answer "1B holds only one book, so moving it along would just empty the
     * shelf. Put the new book on the next shelf instead", which is a sentence
     * with no button behind it and the wrong instruction besides.
     *
     * Walked here the way the screen walks it: propose, descend on a no, and
     * confirm the outer move last, recording where each book physically went.
     */
    const ids: number[] = []
    for (const a of ['Ann Author', 'Bob Baker', 'Cal Church', 'Dot Downs']) ids.push(await shelve(a))
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(ids[3]!, '1B')
    expect(await labels()).toEqual(['1A', '1A', '1A', '1B'])

    // Baxter files between Baker and Church, so the gap is in the middle of 1A.
    const placing = await keyFor('Ann Baxter')

    // Down one: 1A is full, so Church comes off its end and is offered to 1B.
    const first = await shelves.proposeOverflow('fiction', plank('1A'), 'area', placing)
    expect(first.step?.moved.id).toBe(ids[2])
    expect(first.step).toMatchObject({ from: '1A', to: '1B' })

    // Down two: 1B will not take Church, so Downs goes on to a 1C that is made
    // for him. Nothing about 1A has been decided yet.
    const second = await shelves.overflow('fiction', plank('1B'), 'area', placing, ids[3])
    expect(second.ok).toBe(true)
    expect(second.step).toMatchObject({ from: '1B', to: '1C' })
    await store.setLocationIn(ids[3]!, second.planks!.to.areaId!)

    // Up one: Church goes on the plank Downs has just left.
    const back = await shelves.overflow('fiction', plank('1A'), 'area', placing, ids[2])
    expect(back.ok).toBe(true)
    expect(back.step).toMatchObject({ from: '1A', to: '1B' })
    await store.setLocationIn(ids[2]!, back.planks!.to.areaId!)

    // And the book in hand goes in the gap the shuffle opened.
    const baxter = await add('Ann Baxter')
    expect(await shelves.labelFor('fiction', baxter)).toBe('1A')
    await store.setLocation(baxter, '1A')

    expect(await labels()).toEqual(['1A', '1A', '1A', '1B', '1C'])
    // Every book went where the app said, so the record and the room agree.
    expect((await shelves.review('fiction')).misfiles).toEqual([])
  })

  it('leaves nothing needing attention once the book is saved', async () => {
    // It went where the app said, so the record and the room agree.
    await shelve('Ann Author')
    await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')
    expect((await shelves.review('fiction')).misfiles).toEqual([])

    const carried = await shelves.overflow('fiction', plank('1A'), 'area', await keyFor('Bob Baxter'))
    const baxter = await add('Bob Baxter')
    await store.setLocation(baxter, carried.carry!.to)

    expect((await shelves.review('fiction')).misfiles).toEqual([])
    expect((await store.getBook(baxter))?.location).toBe('1B')
  })
})

describe('a book inserted into a shelf', () => {
  it('is allowed to simply fit, without displacing anyone', async () => {
    // A thin book may well fit, and only a person can say otherwise, so
    // nothing moves on its own.
    await add('Bob Baker')
    await add('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    const before = await shelves.layout('fiction')

    await add('Ann Author')
    expect(await labels()).toEqual(['1A', '1A', '1B'])
    expect(await shelves.movesSince('fiction', before)).toEqual([])
  })
})

describe('removing a boundary', () => {
  it('merges the shelves back and reports the books coming home', async () => {
    await add('Ann Author')
    const bob = await add('Bob Baker')
    const created = await shelves.overflow('fiction', plank('1A'), 'area')
    expect(await labels()).toEqual(['1A', '1B'])

    const before = await shelves.layout('fiction')
    await shelves.remove((await shelves.list('fiction'))[0]!.id, { theAreaGoes: true })

    expect(await labels()).toEqual(['1A', '1A'])
    expect(await shelves.movesSince('fiction', before)).toEqual([
      {
        id: bob, from: '1B', to: '1A',
        fromAt: { shelf: 1, area: 1 }, toAt: { shelf: 1, area: 0 },
      },
    ])
    expect(created.ok).toBe(true)
  })
})

describe('ranges are independent', () => {
  it('does not let a fiction boundary move non-fiction books', async () => {
    await add('Ann Author')
    await add('Bob Baker')
    await store.addBook({ title: 'Sapiens', authors: ['Yuval Harari'], genre: NON_FICTION_SLUG })

    await shelves.overflow('fiction', plank('1A'), 'shelf')
    expect((await shelves.layout('nonfiction')).map((p) => p.label)).toEqual(['4A'])
  })
})

describe('every catalogued book has a shelf', () => {
  /**
   * The property behind dropping the "unshelved" count. A shelf is derived,
   * so being in the catalogue and being on a shelf are the same fact. If this
   * ever fails, an unshelved state exists again and needs reporting somewhere.
   */
  it('places every book exactly once, whatever the boundaries', async () => {
    const ids: number[] = []
    for (const a of [
      'Austen, Jane', 'Brontë, Emily', 'Carter, Angela', 'Dickens, Charles',
      'Eliot, George', 'Forster, E M',
    ]) ids.push(await add(a))

    for (const label of ['1A', '1A', '1B']) {
      await shelves.overflow('fiction', plank(label), 'area')
    }

    const placed = await shelves.layout('fiction')
    expect(placed).toHaveLength(ids.length)
    expect(new Set(placed.map((p) => p.book.id))).toEqual(new Set(ids))
    // And every one of them names a real shelf.
    expect(placed.every((p) => /^\d+[A-Z]+$/.test(p.label))).toBe(true)
  })

  it('places a book saved without ever touching the location column', async () => {
    // Which is every book saved since locations became derived.
    const id = await add('Zola, Émile')
    const placed = await shelves.layout('fiction')
    expect(placed.find((p) => p.book.id === id)?.label).toBe('1A')
    expect((await store.getBook(id))?.location).toBe('')
  })
})

/**
 * #332's finding 1, which is a performance fix and therefore has to be a
 * behaviour test: the fast answer must be the slow answer.
 *
 * `GET /api/shelves` asked `shelfForSortKey` once per checked-out book, and each
 * call laid the whole run out. `shelvesForSortKeys` lays it out once for all of
 * them, on the reasoning that where a key lands is decided by the boundaries it
 * has passed and by nothing about the other books. This compares the two
 * directly: `theSlowWay` is the old method written out, laying the whole run out
 * with one newcomer merged in and picking it back out again.
 */
describe('the shelf a sort key lands on', () => {
  /** The old `layoutWith`, in full, so the comparison is against the algorithm. */
  async function theSlowWay(sortKey: string): Promise<string> {
    const books = (await shelves.layout('fiction'))
      .map((p) => ({ id: p.book.id, sortKey: p.book.sortKey }))
    const merged = [...books, { id: NEWCOMER_ID, sortKey }]
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    // Fiction begins at 1A in a database standing as the migrations leave it,
    // which is what every other expectation in this file assumes too.
    return layoutRange(merged, await shelves.list('fiction'))
      .find((p) => p.book.id === NEWCOMER_ID)!.label
  }

  it('answers a batch of keys exactly as one at a time answered them', async () => {
    for (const author of [
      'Austen, Jane', 'Brontë, Emily', 'Carter, Angela', 'Dickens, Charles',
      'Eliot, George', 'Forster, E M', 'Gaskell, Elizabeth', 'Hardy, Thomas',
    ]) await add(author)

    // Boundaries of both kinds, so the walk has planks and bookcases to step.
    for (const [label, kind] of [
      ['1A', 'area'], ['1B', 'shelf'], ['2A', 'area'],
    ] as const) await shelves.overflow('fiction', plank(label), kind)

    const shelved = await shelves.layout('fiction')
    expect(new Set(shelved.map((p) => p.label)).size).toBeGreaterThan(1)

    /*
     * Every book's own key, every gap between two of them, and a key below and
     * above the whole run. The gaps are the interesting ones: a checked-out book
     * is absent from the layout, so its key is being asked about a run that does
     * not contain it, which is exactly this case.
     */
    const keys = shelved.map((p) => p.book.sortKey)
    const asked = [
      ' ',
      ...keys.flatMap((key, at) => (at === 0 ? [key] : [`${keys[at - 1]!}M`, key])),
      '~~',
    ]

    const batch = await shelves.shelvesForSortKeys('fiction', asked)
    expect(batch).toHaveLength(asked.length)

    for (const [at, key] of asked.entries()) {
      expect(batch[at], `the shelf for ${JSON.stringify(key)}`).toBe(await theSlowWay(key))
    }
  })

  it('answers nothing for no keys, rather than reading the run to find out', async () => {
    await add('Austen, Jane')
    expect(await shelves.shelvesForSortKeys('fiction', [])).toEqual([])
    expect(await shelves.areasForSortKeys('fiction', [])).toEqual([])
  })

  /**
   * The proof that the area a key lands in is the plank the layout draws it on.
   *
   * `areasForSortKeys` walks the run as rows and `shelvesForSortKeys` walks the
   * boundaries derived from those rows, and the misfile check believes they are
   * two readings of one sequence. So it is checked rather than argued: every
   * key, every gap, both ends, plank for plank.
   */
  it('lands a key in the very area the layout draws it on', async () => {
    for (const author of [
      'Austen, Jane', 'Brontë, Emily', 'Carter, Angela', 'Dickens, Charles',
      'Eliot, George', 'Forster, E M',
    ]) await add(author)
    for (const [label, kind] of [
      ['1A', 'area'], ['1B', 'shelf'], ['2A', 'area'],
    ] as const) await shelves.overflow('fiction', plank(label), kind)

    const keys = (await shelves.layout('fiction')).map((p) => p.book.sortKey)
    const asked = [' ', ...keys.flatMap((key, at) =>
      (at === 0 ? [key] : [`${keys[at - 1]!}M`, key])), '~~']

    const faces = await areaFaces(db)
    const labels = await shelves.shelvesForSortKeys('fiction', asked)
    const areas = await shelves.areasForSortKeys('fiction', asked)

    for (const [at, key] of asked.entries()) {
      const face = faces.get(areas[at]!)
      expect(face, `an area for ${JSON.stringify(key)}`).toBeDefined()
      expect(`${face!.fixturePosition}${areaLabel(face!.areaPosition)}`).toBe(labels[at])
    }
  })

  /**
   * And it goes on landing there once the piece has a name, which is the whole
   * of #356 said about one function.
   */
  it('lands a key in the same area after the bookcase is named', async () => {
    await add('Austen, Jane')
    await add('Zola, Émile')
    await shelves.overflow('fiction', plank('1A'), 'area')

    const keys = (await shelves.layout('fiction')).map((p) => p.book.sortKey)
    const before = await shelves.areasForSortKeys('fiction', keys)
    expect(new Set(before).size).toBe(2)

    const fixture = await db.get<{ id: number }>(
      'SELECT id FROM fixture WHERE position = 1 ORDER BY id LIMIT 1',
    )
    await editFixture(db, fixture!.id, { name: 'Hall shelf' })

    expect(await shelves.areasForSortKeys('fiction', keys)).toEqual(before)
  })

  it('still answers one key through the method the placing card calls', async () => {
    await add('Austen, Jane')
    await add('Zola, Émile')
    await shelves.overflow('fiction', plank('1A'), 'area')

    const [zola] = (await shelves.layout('fiction')).slice(-1)
    expect(await shelves.shelfForSortKey('fiction', zola!.book.sortKey)).toBe(zola!.label)
  })
})

describe('a book taken off the shelf', () => {
  it('stops taking up room, so the shelf closes up behind it', async () => {
    const ids: number[] = []
    for (const a of ['Jane Austen', 'Emily Bronte', 'Angela Carter']) ids.push(await add(a))
    expect(await labels()).toEqual(['1A', '1A', '1A'])

    await store.setCheckedOut(ids[1]!, true)
    expect((await shelves.layout('fiction')).map((p) => p.book.id)).toEqual([ids[0], ids[2]])
  })

  it('is never offered as a neighbour to file against', async () => {
    // The reason the column exists. A book in a pile on the table is not
    // something to put another book beside.
    await add('Jane Austen')
    const middle = await add('Emily Bronte')
    await add('Angela Carter')

    const before = await placementFor({
      title: 'X', authors: ['Ann Baxter'], genre: FICTION_SLUG,
    } as never)
    expect(before.successor?.id).toBe(middle)

    await store.setCheckedOut(middle, true)
    const after = await placementFor({
      title: 'X', authors: ['Ann Baxter'], genre: FICTION_SLUG,
    } as never)
    expect(after.successor?.id).not.toBe(middle)
  })

  it('comes back to the position its filing gives it, not the one it left', async () => {
    const ids: number[] = []
    for (const a of ['Jane Austen', 'Emily Bronte', 'Angela Carter']) ids.push(await add(a))
    await store.setCheckedOut(ids[1]!, true)
    await store.setCheckedOut(ids[1]!, false)
    expect((await shelves.layout('fiction')).map((p) => p.book.id)).toEqual(ids)
  })

  it('leaves the catalogue entry and its photos alone', async () => {
    const id = await add('Jane Austen', 'Persuasion')
    await store.setCheckedOut(id, true)
    const book = await store.getBook(id)
    expect(book?.title).toBe('Persuasion')
    expect(book?.checked_out_at).toBeTruthy()
    expect((await store.checkedOut()).map((b) => b.id)).toEqual([id])
  })

  it('counts as off the shelf without leaving its range tally', async () => {
    await add('Jane Austen')
    const id = await add('Emily Bronte')
    await store.setCheckedOut(id, true)
    expect(await store.counts()).toEqual({
      total: 2, fiction: 2, nonfiction: 0, checkedOut: 1,
    })
  })
})

/**
 * The risk #183 is designed against, asserted rather than argued about.
 *
 * `books` drives shelf ordering and misfile detection, and the two tables were
 * kept apart so that half-identified rows could never reach either. They are one
 * table now, so a row that is in the catalogue and not on a shelf has to be kept
 * out of the layout by something. That something is `shelved_books`, and these
 * are the questions somebody standing at a bookcase actually asks.
 *
 * Written straight into `books` on purpose, and this is the harder version of
 * the row rather than the one the app produces. A book the queue makes has no
 * shelf range and no sort key, so it is kept off a shelf twice over and a test
 * of it would prove the weaker protection. This one is given a range and a key
 * that file it exactly between two real books, so the state is the only thing
 * standing between it and somebody's bookcase, which is the property worth
 * asserting.
 *
 * Before #204 these rows could not exist at all. `queue.add` makes one now, and
 * the last test here is that one, made the way the app makes it.
 */
describe('a book in the catalogue that is not on a shelf', () => {
  /**
   * A row filed exactly where a real book would be filed, and not on a shelf.
   *
   * The key comes from `resolveKey`, which is what a save uses, so this lands
   * between two real books by the ordering the app itself computes rather than
   * by a string chosen to look plausible.
   */
  const unidentified = async (author: string, location = '') => {
    const key = await store.resolveKey({
      title: 'Something nobody has confirmed', authors: [author],
    })
    const row = await db.get<{ id: number }>(
      `INSERT INTO books (title, shelf_range, sort_key, scanned_at, state)
       VALUES ('Something nobody has confirmed', 'fiction', ?,
               '2026-08-07T00:00:00.000Z', 'scanned')
       RETURNING id`,
      [key.sortKey],
    )
    // The row is written in, and where it sits is not: there is no
    // `books.location` to write since #232, so the placement goes through the
    // one route that records one. That is the app's own route, which makes the
    // fixture no gentler: what is being kept off a shelf is a row that is
    // filed, placed, and only kept out by its state.
    if (location) await store.setLocation(row!.id, location)
  }

  // Author, Baker, Clark: the unidentified row is always the middle one, which
  // is the position that does damage.
  it('is not laid out on a plank', async () => {
    const ann = await add('Ann Author')
    const cathy = await add('Cathy Clark')
    await unidentified('Bob Baker')

    expect((await shelves.layout('fiction')).map((p) => p.book.id)).toEqual([ann, cathy])
  })

  it('is not offered as the book to put a new one beside', async () => {
    await add('Ann Author', 'Persuasion')
    await add('Cathy Clark', 'Nights at the Circus')
    await unidentified('Bob Baker')

    // Baxter files after Baker and before Clark, so a leak here is somebody
    // sent to a bookcase to find a book that is not on it.
    const placement = await placementFor({
      title: 'Middle', authors: ['Bob Baxter'], genre: FICTION_SLUG,
    })
    expect(placement.predecessor?.title).toBe('Persuasion')
    expect(placement.successor?.title).toBe('Nights at the Circus')
  })

  it('is not judged by the misfile check, nor set aside by it', async () => {
    const ann = await add('Ann Author', 'On a shelf')
    await store.setLocation(ann, '1A')
    // A location on the row, so a leak cannot hide as "never placed". `4A`
    // rather than the `3C` this used to write, because a recorded location has
    // to name a plank the collection actually has now (`UnknownPlank`), and
    // non-fiction's own is the one real plank this row would not be derived
    // onto: a leak would read as a book at 4A that belongs at 1A.
    await unidentified('Bob Baker', '4A')

    const review = await shelves.review('fiction')
    expect(review.misfiles).toEqual([])
    expect(review.excluded).toEqual([])
  })

  it('is not in the strip a person is shown at the shelf', async () => {
    const ann = await add('Ann Author')
    const cathy = await add('Cathy Clark')
    await unidentified('Bob Baker')

    // The run drawn around a newcomer filing exactly where the scanned row
    // sits. This is the screen somebody holds up next to a plank, so a row
    // leaking here is a book they will stand and look for.
    const key = await store.resolveKey({
      title: 'Middle', authors: ['Bob Baxter'],
    })
    const strip = await shelves.strip('fiction', key.sortKey)
    expect(strip?.books.map((p) => p.book.id)).toEqual([ann, cathy])
  })

  it('is not counted when a shelf is asked whether a book can cross a boundary', async () => {
    const ann = await add('Ann Author')
    await add('Cathy Clark')
    await unidentified('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')

    // Two books either side of one boundary, so Ann has somewhere to go. A
    // third row in the layout would change which plank holds what and could
    // make the offer describe a move nobody can carry out.
    expect(await offered(ann)).toEqual({
      next: '1B', previous: null,
    })
  })

  /**
   * **The answer to the question #204 left open at `Store.listRange`.**
   *
   * It asked what `GET /api/books` should say about a book that has been
   * scanned and not identified, and said the question only has an answer once
   * such a row can exist. It exists now, and the answer is nothing: the row has
   * no title, no author and nothing anybody can do to it from a library
   * listing. It is not missing from the app, it is in the queue, which is the
   * one screen built to show it and act on it, and the test below is that it is
   * there.
   *
   * This assertion is the reverse of the one #204 left here, deliberately.
   */
  it('is not listed as part of the catalogue', async () => {
    await add('Ann Author')
    await unidentified('Bob Baker')

    expect((await store.listRange('fiction')).map((row) => row.state)).toEqual(['shelved'])
    expect((await store.counts()).total).toBe(1)
  })

  it('is in the queue, which is the one place it belongs', async () => {
    // Made the way the app makes one, rather than written in. A photograph
    // arrives and a book exists, in `scanned`, with nothing read yet.
    const queue = new CaptureQueue(db, () => null)
    await add('Ann Author')
    const scanned = await queue.add({ front: 'f.jpg' })

    expect((await queue.list()).map((row) => row.id)).toEqual([scanned.id])
    expect(await shelves.layout('fiction')).toHaveLength(1)
    expect(await store.listRange('fiction')).toHaveLength(1)
  })
})

describe('moving a book across an area boundary', () => {
  /** Add a book and record the plank it landed on, as saving does. */
  const shelve = async (author: string, title = 'Book') => {
    const id = await add(author, title)
    await store.setLocation(id, await shelves.labelFor('fiction', id))
    return id
  }

  /**
   * The move, followed by the person saying the book is on the new plank.
   *
   * `theAreaGoes` is what somebody being asked looks like from here (#433): a
   * move that leaves an area with no books on it takes the area off the piece,
   * and the write path refuses to do that for a caller that has not said it
   * knows. Passed by the tests whose subject is the move rather than the
   * question, and pinned on its own below.
   */
  const carry = async (
    id: number,
    direction: 'next' | 'previous',
    theAreaGoes = false,
  ) => {
    const result = await shelves.moveAcrossBoundary('fiction', id, direction, { theAreaGoes })
    if (result.ok && result.move) await store.setLocation(id, result.move.to)
    return result
  }

  it('sends the last book of an area to the front of the next one', async () => {
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal alone on 1B
    await store.setLocation(cal, '1B')
    expect(await labels()).toEqual(['1A', '1A', '1B'])

    const result = await carry(bob, 'next')
    expect(result.ok).toBe(true)
    expect(result.move?.from).toBe('1A')
    expect(result.move?.to).toBe('1B')
    expect(await labels()).toEqual(['1A', '1B', '1B'])
    expect((await store.getBook(ann))?.location).toBe('1A')
  })

  it('sends the first book of an area back to the end of the previous one', async () => {
    await shelve('Ann Author')
    await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')

    expect((await carry(cal, 'previous', true)).ok).toBe(true)
    expect(await labels()).toEqual(['1A', '1A', '1A'])
    // Nothing was left for that boundary to start at, so it went.
    expect(await shelves.list('fiction')).toEqual([])
  })

  it('refuses a book in the middle of its area', async () => {
    const ann = await shelve('Ann Author')
    await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')

    const result = await shelves.moveAcrossBoundary('fiction', ann, 'next')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('first or last book of 1A')
    expect(await labels()).toEqual(['1A', '1A', '1B'])
  })

  it('refuses the first book of the first area', async () => {
    const ann = await shelve('Ann Author')
    await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')

    const result = await shelves.moveAcrossBoundary('fiction', ann, 'previous')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no area before 1A')
  })

  it('refuses the last book of the last area, and says where areas come from', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')

    const result = await shelves.moveAcrossBoundary('fiction', bob, 'next')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no area after 1B')
    expect(result.error).toContain('full')
  })

  /**
   * The one boundary move that removes furniture, and the stop in front of it.
   *
   * A book alone in an area is both the first and the last book of it, so
   * `boundaryOptions` answers both directions open, which docs/shelving.md
   * allows on purpose under "The only book in an area". What it never said was
   * that either direction leaves the area with no books to name, and an area
   * with no books on it comes off the piece: one press retired a recorded area
   * with nothing asked and nothing said (#433).
   *
   * #281 settled that removing an area says what it will do and asks first.
   * This is the second path that removes one, so the rule lives on the write
   * path rather than in the screen, for exactly the reason the edge rule does:
   * a control that only appears after a dialog is one caller away from being
   * lost, and the caller after that deletes furniture in silence.
   */
  it('refuses to empty an area for a caller that has not been told', async () => {
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Bob alone on 1B
    await store.setLocation(bob, '1B')
    expect(await labels()).toEqual(['1A', '1B'])

    const result = await shelves.moveAcrossBoundary('fiction', bob, 'previous')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('1B would have no books left on it')
    expect(result.error).toContain('off the furniture')
    expect(result.error).toContain('Nothing has been changed')

    // And the room is exactly as it was, which is the half of this the old path
    // could not offer: by the time it could have said anything the area was
    // already gone.
    expect(await labels()).toEqual(['1A', '1B'])
    expect(await shelves.list('fiction')).toHaveLength(1)
    expect((await store.getBook(ann))?.location).toBe('1A')
    expect((await store.getBook(bob))?.location).toBe('1B')
  })

  it('makes the move once it has been told, and takes the area with it', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(bob, '1B')

    const result = await shelves
      .moveAcrossBoundary('fiction', bob, 'previous', { theAreaGoes: true })

    expect(result.ok).toBe(true)
    expect(await labels()).toEqual(['1A', '1A'])
    expect(await shelves.list('fiction')).toEqual([])
  })

  /**
   * The offer carries what it costs, because a screen cannot ask about
   * something the offer does not mention.
   *
   * Read off the same outcome the write path enforces rather than worked out a
   * second time: two readings of one room is the disagreement
   * `areaDisagreements` exists to catch, at the scale of a button.
   */
  it('says which area a move would empty, and nothing for one that empties none', async () => {
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal alone on 1B
    await store.setLocation(cal, '1B')

    // Bob is the last book of 1A and Cal is still on 1B, so nothing empties.
    const on = (await shelves.boundaryOptions('fiction', bob)).next
    expect(on?.label).toBe('1B')
    expect(on?.empties).toBeNull()

    // Cal is the only book on 1B, so going back takes 1B with him.
    const back = (await shelves.boundaryOptions('fiction', cal)).previous
    expect(back?.label).toBe('1A')
    expect(back?.empties?.areas).toEqual(['1B'])

    // A book in the middle of its area is offered neither way, so there is
    // nothing for either direction to cost.
    expect(await shelves.boundaryOptions('fiction', ann))
      .toEqual({ next: null, previous: null })
  })

  /**
   * And every label that reads differently afterwards, which is #281's argument
   * rather than a new one: removing an area renumbers the areas after it, and a
   * sentence claiming that is worth less than the rows showing it.
   *
   * The area after the emptied one is reached exactly as the owner reaches it,
   * which is the press that adds one to a piece (#381). Its anchor sits above
   * every book standing in the run, so it is not one of the boundaries the move
   * removes: it survives the move and comes forward a place.
   */
  it('names the labels that read differently once the area is gone', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Bob alone on 1B
    await store.setLocation(bob, '1B')

    expect((await addAreaTo(db, 1, {})).ok).toBe(true)           // a bare 1C

    const back = (await shelves.boundaryOptions('fiction', bob)).previous
    expect(back?.empties?.areas).toEqual(['1B'])
    expect(back?.empties?.becomes).toEqual([{ from: '1C', to: '1B' }])
  })

  it('lets the only book in an area leave it, and empties the area', async () => {
    // Capacity is not modelled, so nothing here says an area must hold a
    // book. The plank is simply bare, and a bare plank has no books to name.
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal to 1B
    await store.setLocation(cal, '1B')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Bob to 1B as well
    await store.setLocation(bob, '1B')
    await shelves.overflow('fiction', plank('1B'), 'area')       // Cal on to 1C
    await store.setLocation(cal, '1C')
    expect(await labels()).toEqual(['1A', '1B', '1C'])

    expect((await carry(bob, 'next')).ok).toBe(true)
    expect(await labels()).toEqual(['1A', '1C', '1C'])
    expect((await shelves.groups('fiction')).map((g) => g.label)).toEqual(['1A', '1C'])
  })

  it('moves nothing but the book in your hand', async () => {
    const ids: number[] = []
    for (const a of ['Ann Author', 'Bob Baker', 'Cal Church', 'Dot Downs']) ids.push(await shelve(a))
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(ids[3]!, '1B')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(ids[2]!, '1B')

    const result = await shelves.moveAcrossBoundary('fiction', ids[1]!, 'next')
    expect(result.moves).toEqual([])
  })

  it('does not undo an overflow, and is not undone by one', async () => {
    // The manual bounce and the automatic shuffle solve the same physical
    // problem two ways, so they must compose rather than fight.
    const ids: number[] = []
    for (const a of ['Ann Author', 'Bob Baker', 'Cal Church', 'Dot Downs']) ids.push(await shelve(a))
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(ids[3]!, '1B')
    expect(await labels()).toEqual(['1A', '1A', '1A', '1B'])

    await carry(ids[2]!, 'next')                          // Cal joins Dot on 1B
    expect(await labels()).toEqual(['1A', '1A', '1B', '1B'])

    // 1B will not take the pair after all: its last book goes on to 1C.
    const step = await shelves.overflow('fiction', plank('1B'), 'area')
    expect(step.step?.moved.id).toBe(ids[3])
    expect(await labels()).toEqual(['1A', '1A', '1B', '1C'])
  })

  it('leaves the misfile list empty once the person has said the book moved', async () => {
    // The failure this is most likely to have: a legitimate move reported
    // straight back as a book to go and move.
    const ids: number[] = []
    for (const a of ['Ann Author', 'Bob Baker', 'Cal Church']) ids.push(await shelve(a))
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(ids[2]!, '1B')
    expect((await shelves.review('fiction')).misfiles).toEqual([])

    await carry(ids[1]!, 'next')
    expect((await shelves.review('fiction')).misfiles).toEqual([])

    await carry(ids[1]!, 'previous')
    expect((await shelves.review('fiction')).misfiles).toEqual([])
  })

  it('does not write a location itself', async () => {
    // The boundary is furniture; where a book physically is was observed by a
    // person and is written through the one route that takes an observation.
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')

    await shelves.moveAcrossBoundary('fiction', bob, 'next')
    expect((await store.getBook(bob))?.location).toBe('1A')
    // And so it now reads as a book to move, which is correct until somebody
    // says otherwise.
    expect((await shelves.review('fiction')).misfiles.map((m) => [m.from, m.to]))
      .toEqual([['1A', '1B']])
  })

  it('sends the first book of a bookcase back to the last area of the one before', async () => {
    /*
     * #79. Within a range the areas are one continuous sequence and a bookcase
     * break is only where it crosses furniture, so this is the same move. It
     * is the bookcase break that gets re-anchored, which is why the books past
     * it stay on the bookcase they were on.
     */
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'shelf')       // Cal on to bookcase 2
    await store.setLocation(cal, '2A')
    await shelves.overflow('fiction', plank('1A'), 'shelf')       // Bob joins him there
    await store.setLocation(bob, '2A')
    expect(await labels()).toEqual(['1A', '2A', '2A'])
    expect((await shelves.review('fiction')).misfiles).toEqual([])

    const result = await carry(bob, 'previous')
    expect(result.ok).toBe(true)
    expect(result.move?.from).toBe('2A')
    expect(result.move?.to).toBe('1A')
    expect(await labels()).toEqual(['1A', '1A', '2A'])
    // Cal did not follow him back, and Ann never moved.
    expect((await store.getBook(cal))?.location).toBe('2A')
    expect((await store.getBook(ann))?.location).toBe('1A')
    expect(result.moves).toEqual([])
    expect((await shelves.review('fiction')).misfiles).toEqual([])
  })

  it('sends the last book of a bookcase on to the next one', async () => {
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'shelf')
    await store.setLocation(cal, '2A')
    expect(await labels()).toEqual(['1A', '1A', '2A'])

    expect((await carry(bob, 'next')).ok).toBe(true)
    expect(await labels()).toEqual(['1A', '2A', '2A'])
    expect((await store.getBook(ann))?.location).toBe('1A')
    expect((await shelves.review('fiction')).misfiles).toEqual([])
  })

  it('keeps refusing at the ends of the range, bookcases or not', async () => {
    // Making new furniture is what declaring a plank full is for. That holds
    // at the two ends of the run and nowhere else.
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'shelf')
    await store.setLocation(bob, '2A')

    expect((await shelves.moveAcrossBoundary('fiction', ann, 'previous')).error)
      .toContain('no area before 1A')
    expect((await shelves.moveAcrossBoundary('fiction', bob, 'next')).error)
      .toContain('no area after 2A')
  })

  it('never lets a fiction move touch non-fiction', async () => {
    await shelve('Ann Author')
    const harari = (await store.addBook({
      title: 'Sapiens', authors: ['Yuval Harari'], genre: NON_FICTION_SLUG,
    })).id

    const result = await shelves.moveAcrossBoundary('fiction', harari, 'next')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not on a bookcase in this range')
  })

  /**
   * `boundaryOptions` is the read-only half of this rule, read by the detail
   * view to decide whether to offer the button at all (#96). It has to agree
   * with `moveAcrossBoundary` exactly, or a book the preview says can move
   * would hit a refusal on the tap, or one it says cannot would silently offer
   * nothing where a move was actually possible.
   */
  it('previews exactly what the move itself would allow, book by book', async () => {
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal alone on 1B
    await store.setLocation(cal, '1B')
    expect(await labels()).toEqual(['1A', '1A', '1B'])

    // Ann: first on 1A, but nothing before it to carry it to; Bob follows her
    // on the same plank, so she is not last either.
    expect(await offered(ann)).toEqual({ next: null, previous: null })

    // Bob: last on 1A with 1B to go to; Ann sits before him on the same
    // plank, so the other direction is refused.
    expect(await offered(bob)).toEqual({ next: '1B', previous: null })

    // Cal: the only book on 1B, so both ends are his own, and 1A is there to
    // go back to; there is nothing after 1B yet.
    expect(await offered(cal)).toEqual({ next: null, previous: '1A' })
  })

  /**
   * #359, reproduced before anything was changed.
   *
   * The button on a book's own page said `Move it on to 1B` while the same
   * page's recorded location said `Hall shelf · B`: two names for one plank, on
   * one screen. The move is offered and the location is written from the same
   * plank, so they are named by the same `labelFor` now, and the id travels
   * beside the name because only the id says whether two places are one place.
   */
  it('offers a move to the plank by the name the book\'s own page uses', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal alone on 1B
    await store.setLocation(cal, '1B')

    const fixture = await db.get<{ id: number }>(
      'SELECT id FROM fixture WHERE position = 1 ORDER BY id LIMIT 1',
    )
    expect((await editFixture(db, fixture!.id, { name: 'Hall shelf' })).ok).toBe(true)

    const onto = (await shelves.boundaryOptions('fiction', bob)).next
    expect(onto?.label).toBe('Hall shelf · B')
    // The same plank the catalogue records Cal on, and said so by id.
    expect(onto?.areaId).toBe((await store.getBook(cal))?.area_id)

    const back = (await shelves.boundaryOptions('fiction', cal)).previous
    expect(back?.label).toBe('Hall shelf · A')
    expect(back?.areaId).toBe((await store.getBook(bob))?.area_id)
  })

  /**
   * The refusals name the plank the same way, which is the half a rename could
   * quietly change without anything failing.
   *
   * A refusal is read by whoever just tapped the button, standing at the piece
   * they named. `Only the first or last book of 1A` sends them to look for a
   * plank the app has stopped calling that anywhere else, and there is nothing
   * to check it against: the move did not happen either way.
   */
  it('names the plank in a refusal the way the shelves name it', async () => {
    const ann = await shelve('Ann Author')
    await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')

    const fixture = await db.get<{ id: number }>(
      'SELECT id FROM fixture WHERE position = 1 ORDER BY id LIMIT 1',
    )
    await editFixture(db, fixture!.id, { name: 'Hall shelf' })

    // Ann is first on the first plank of the run, so there is nothing before it.
    const back = await shelves.moveAcrossBoundary('fiction', ann, 'previous')
    expect(back.ok).toBe(false)
    expect(back.error).toContain('no area before Hall shelf · A')

    // And with a book after her on the same plank, she is not last either.
    await shelve('Ann Aztec')
    const on = await shelves.moveAcrossBoundary('fiction', ann, 'next')
    expect(on.ok).toBe(false)
    expect(on.error).toContain('first or last book of Hall shelf · A')

    // Nothing moved for either refusal, which is what a refusal is.
    expect(await labels()).toEqual(['1A', '1A', '1B'])
  })
})

/**
 * The other way out of the shelving step (#196).
 *
 * docs/shelving.md has always said backing out of it leaves the move
 * outstanding "and the same list offers the move back". Until this existed only
 * the first half did, and the only route back was to tap "Moved it", asserting a
 * walk that never happened, and then move the book again.
 *
 * What these are really checking is that taking a move back is not the opposite
 * move. Two of them are cases where the opposite move exists, is allowed, and
 * lands the book somewhere else.
 */
describe('taking a boundary move back', () => {
  const shelve = async (author: string, title = 'Book') => {
    const id = await add(author, title)
    await store.setLocation(id, await shelves.labelFor('fiction', id))
    return id
  }

  const locations = async (...ids: number[]) =>
    Promise.all(ids.map(async (id) => (await store.getBook(id))?.location))

  /** One book's ledger, so a claim can be made about what is standing. */
  const placementsOf = async (id: number) => new DrizzlePlacementLedger(db).forBooks([id])

  it('puts the boundary back, and says which way the book came', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal alone on 1B
    await store.setLocation(cal, '1B')

    await shelves.moveAcrossBoundary('fiction', bob, 'next')
    expect(await labels()).toEqual(['1A', '1B', '1B'])

    const back = await shelves.retractMove('fiction', bob)
    expect(back.ok).toBe(true)
    expect(back.move).toEqual({ from: '1B', to: '1A' })
    expect(await labels()).toEqual(['1A', '1A', '1B'])
    // Nobody else ended up anywhere new, which is the whole claim.
    expect(back.moves).toEqual([])
  })

  it('writes no location, because nobody carried anything', async () => {
    /*
     * The reason this exists at all. Undoing by recording a placement and then
     * moving again puts two statements about the room into the catalogue that
     * nobody made, and the catalogue's whole value is that it records what a
     * person actually did.
     */
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')

    await shelves.moveAcrossBoundary('fiction', bob, 'next')
    await shelves.retractMove('fiction', bob)

    expect(await locations(bob, cal)).toEqual(['1A', '1B'])
    expect((await shelves.review('fiction')).misfiles).toEqual([])
  })

  /**
   * The case that decides how this is implemented.
   *
   * Moving the only book of an area back leaves that area empty, which leaves
   * its boundary sitting on the same anchor as the next one. Asking for the
   * opposite move then re-anchors **both**, because both lie between the book
   * and the one after it, and the book lands two planks along instead of back
   * where it was. So "back" has to mean the arrangement as it was, and the only
   * thing that knows that is what the move wrote down when it made it.
   */
  it('puts a book back on the plank it came off, not the one the rules would pick', async () => {
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal on to 1B
    await store.setLocation(cal, '1B')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Bob joins him
    await store.setLocation(bob, '1B')
    await shelves.overflow('fiction', plank('1B'), 'area')       // Cal on to 1C
    await store.setLocation(cal, '1C')
    expect(await labels()).toEqual(['1A', '1B', '1C'])

    // Bob is alone on 1B, so sending him back empties it.
    await shelves.moveAcrossBoundary('fiction', bob, 'previous')
    expect(await labels()).toEqual(['1A', '1A', '1C'])

    // The opposite move is available and would answer 1C: the empty area's
    // boundary and 1C's are on the same anchor, and it moves both.
    expect(await offered(bob)).toEqual({ next: '1C', previous: null })

    expect((await shelves.retractMove('fiction', bob)).ok).toBe(true)
    expect(await labels()).toEqual(['1A', '1B', '1C'])
    expect(await locations(ann, bob, cal)).toEqual(['1A', '1B', '1C'])
  })

  /**
   * The other end of the same problem. A move that leaves nothing for a
   * boundary to start at removes it, and there is then no opposite move at all:
   * `boundaryMove` refuses, because there is no area past the end of the run.
   */
  it('makes again a boundary the move took out', async () => {
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Bob alone on 1B
    await store.setLocation(bob, '1B')
    expect(await shelves.list('fiction')).toHaveLength(1)

    await shelves.moveAcrossBoundary('fiction', bob, 'previous', { theAreaGoes: true })
    expect(await labels()).toEqual(['1A', '1A'])
    expect(await shelves.list('fiction')).toEqual([])
    expect((await shelves.boundaryOptions('fiction', bob)).next).toBeNull()

    expect((await shelves.retractMove('fiction', bob)).ok).toBe(true)
    expect(await labels()).toEqual(['1A', '1B'])
    expect(await locations(ann, bob)).toEqual(['1A', '1B'])
    // Contiguous positions, or `list`'s ORDER BY position stops describing the
    // shelves. See RangeSeparators.
    expect((await shelves.list('fiction')).map((one) => one.position)).toEqual([0])
  })

  /**
   * The half of the undo that #465 made necessary.
   *
   * A move that empties an area takes it off the furniture, which is the act
   * `dropArea` performs, and that act writes an `assigned` row per book naming
   * the plank that took them in — because those books really do have to be
   * carried. Putting the plank back means they do not, so the retraction has to
   * take the assignment back as well as the boundary. Left standing it is a trip
   * on the carry list for a move that was taken back, which is the same defect
   * #465 is about seen from the other end.
   *
   * Before #465 the removal wrote nothing, so this was symmetric by accident.
   */
  it('takes the assignment back too, so nothing is left on the carry list', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Bob alone on 1B
    await store.setLocation(bob, '1B')

    await shelves.moveAcrossBoundary('fiction', bob, 'previous', { theAreaGoes: true })
    // The act recorded where Bob now belongs, which is the fix in #465.
    expect(needsAttention(standingOf(await placementsOf(bob)))).toBe(true)

    expect((await shelves.retractMove('fiction', bob)).ok).toBe(true)

    // And the retraction took it back: Bob is on the plank the catalogue
    // records him on, and no rule is asking for him anywhere else.
    expect(await labels()).toEqual(['1A', '1B'])
    expect(needsAttention(standingOf(await placementsOf(bob)))).toBe(false)
    expect((await shelves.review('fiction')).misfiles).toEqual([])
  })

  /**
   * #468 predicted this was broken and it is not, so here is the proof rather
   * than a fix.
   *
   * The check above `outstanding.clear` compares `landed.label` with
   * `receipt.from`, which reads like the family's signature: a label compared
   * against a label. It is not. Both strings are `locationLabel(shelf, area)`,
   * rendered by the pure arithmetic in shared/layout.ts, which knows ordinals
   * and has never heard of a piece's name — `receipt.from` is `move.from`, and
   * `move.from` is `placed.label`. So naming a bookcase moves neither side, and
   * the comparison is "is the arrangement back as it was", asked in the one
   * vocabulary the arrangement is expressed in.
   *
   * That is different from `GET /api/misfiles`, whose *other* side is an area
   * id: it used to read the receipt's labels back through
   * `areaOfRecordedLocation` and now reads the ids the receipt records (#481).
   * Converting here would convert through the same position arithmetic and close
   * nothing, which is why #481 left this line alone: the receipt's ids exist
   * beside it and this check does not read them.
   *
   * This test is what says so. It was written expecting a failure, passed
   * against the unchanged code, and is kept so that the next reader of that
   * line does not have to work it out twice.
   */
  it('takes a move back on a piece somebody has named since the move', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal alone on 1B
    await store.setLocation(cal, '1B')

    await shelves.moveAcrossBoundary('fiction', bob, 'next')
    expect((await shelves.outstandingMoves('fiction')).map((m) => [m.from, m.to]))
      .toEqual([['1A', '1B']])

    const fixture = await db.get<{ id: number }>(
      'SELECT id FROM fixture WHERE position = 1 ORDER BY id LIMIT 1',
    )
    expect((await editFixture(db, fixture!.id, { name: 'Hall shelf' })).ok).toBe(true)

    const back = await shelves.retractMove('fiction', bob)
    expect(back.ok, back.error).toBe(true)
    expect(back.planks?.to.label).toBe('Hall shelf · A')
    // The arrangement is back where it was. `labels` is the ordinal form the
    // layout arithmetic works in, which a name does not touch; what the name
    // changes is `planks.to.label` above, and that is what the check compared.
    expect(await labels()).toEqual(['1A', '1A', '1B'])
    // The receipt's own labels are left as they were written, which is what
    // `/api/misfiles` also refuses to rewrite. This is the pair the check
    // compares, and neither half moved when the piece got its name.
    expect(back.move).toEqual({ from: '1B', to: '1A' })
  })

  it('refuses a book with nothing outstanding on it', async () => {
    const ann = await shelve('Ann Author')

    const result = await shelves.retractMove('fiction', ann)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no move outstanding')
  })

  it('has nothing left to take back once a person says where the book is', async () => {
    // Whatever they say. The move was outstanding on an observation, and this
    // is the observation, so the receipt has been answered.
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')

    await shelves.moveAcrossBoundary('fiction', bob, 'next')
    await store.setLocation(bob, '1B')
    await shelves.clearOutstandingMove(bob)

    expect((await shelves.retractMove('fiction', bob)).ok).toBe(false)
    expect(await labels()).toEqual(['1A', '1B', '1B'])
  })

  it('reports the outstanding moves of one range and not the other', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')
    await shelves.moveAcrossBoundary('fiction', bob, 'next')

    expect((await shelves.outstandingMoves('fiction')).map((m) => [m.bookId, m.from, m.to]))
      .toEqual([[bob, '1A', '1B']])
    expect(await shelves.outstandingMoves('nonfiction')).toEqual([])
  })

  it('takes a second move back to where the book actually is, in one go', async () => {
    /*
     * The screens do not offer a second move while one is outstanding, but the
     * route does not know that, and a receipt that recorded only the last one
     * would undo half a journey and call it an undo. Merging keeps the older
     * anchor, so what is stored stays "where things were when this book and its
     * shelf last agreed".
     */
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal on to 1B
    await store.setLocation(cal, '1B')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Bob joins him
    await store.setLocation(bob, '1B')
    await shelves.overflow('fiction', plank('1B'), 'area')       // Cal on to 1C
    await store.setLocation(cal, '1C')
    expect(await labels()).toEqual(['1A', '1B', '1C'])

    // On to 1C, which empties 1B, and then back, which lands him on 1A rather
    // than the 1B he came off: the emptied area is not drawn any more, so the
    // area before him is Ann's.
    await shelves.moveAcrossBoundary('fiction', bob, 'next')
    expect(await labels()).toEqual(['1A', '1C', '1C'])
    await shelves.moveAcrossBoundary('fiction', bob, 'previous')
    expect(await labels()).toEqual(['1A', '1A', '1C'])

    expect((await shelves.retractMove('fiction', bob)).ok).toBe(true)
    expect(await labels()).toEqual(['1A', '1B', '1C'])
    expect(await locations(ann, bob, cal)).toEqual(['1A', '1B', '1C'])
  })
})

/**
 * Which planks a receipt is about, as against what they were called (#481).
 *
 * `outstanding_move` said where a move went as an ordinal address, `4B`, so
 * every reader parsed it back into a plank. That was the residue #447 left
 * behind, and it is a smaller claim than #356's: no name can reach these
 * strings, because the layout arithmetic that writes them has never heard of a
 * piece's name, and `parseLocation` answers null on the named form anyway.
 *
 * **The claim that is true is about position, not about names.** An address is a
 * statement about where a plank stands, and where a plank stands is exactly what
 * a boundary write changes. Two rows can read as one address — the code that
 * used to do the reading said so itself, ordering a plank on the face above one
 * retired from the same position — and a reader parsing the address gets
 * whichever row answers to it today.
 *
 * So the receipt records which planks, beside what they were called. These are
 * the tests for the "which", and the pair either side of them is the point: the
 * ids go on naming the same two rows through a retirement and a renumbering that
 * both move the addresses.
 */
describe('what a move receipt says about where the move went', () => {
  const shelve = async (author: string, title = 'Book') => {
    const id = await add(author, title)
    await store.setLocation(id, await shelves.labelFor('fiction', id))
    return id
  }

  const receiptFor = async (bookId: number) =>
    (await shelves.outstandingMoves('fiction')).find((move) => move.bookId === bookId)

  /** Every row that reads as this address, on the face or off it, newest last. */
  const rowsReading = async (label: string) => {
    const at = plank(label)
    return (await db.all<{ id: number }>(
      `SELECT a.id FROM area a JOIN fixture f ON f.id = a.fixture_id
        WHERE (f.position = ? OR f.position = ?) AND (a.position = ? OR a.position = ?)
        ORDER BY a.id`,
      [at.shelf, -(at.shelf + 1), at.area, -(at.area + 1)],
    )).map((row) => Number(row.id))
  }

  it('names the two planks the book crossed between, and not just their labels', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal alone on 1B
    await store.setLocation(cal, '1B')

    const planks = await shelves.planks('fiction')
    const wasOn = planks.at(plank('1A')).areaId
    const wentTo = planks.at(plank('1B')).areaId

    await shelves.moveAcrossBoundary('fiction', bob, 'next')

    const receipt = await receiptFor(bob)
    expect([receipt?.from, receipt?.to]).toEqual(['1A', '1B'])
    expect([receipt?.fromArea, receipt?.toArea]).toEqual([wasOn, wentTo])
  })

  /**
   * The case `areaForRecordedLabel` was written for, asked the other way round.
   *
   * A move that takes the only book off the last plank of a run takes that
   * plank off the furniture with it, and the plank is retired rather than
   * deleted because the catalogue still records Cal on it. That much was already
   * handled: the reading that used to happen here reached a retired plank on
   * purpose, "because the move that wrote the receipt is the thing that retired
   * it".
   *
   * What it could not handle is somebody adding a plank back. There are then two
   * rows on that piece reading `1B`, the retired one the receipt is about and a
   * live one that has never held anything, and the reading preferred the live
   * one — a plank on the face won over one retired from the same position, which
   * it had to, since that is the ordinary way a label is read. So the receipt
   * said `1B` and `1B` meant somewhere else.
   *
   * The id does not move. It is the same row before and after, retired or not.
   */
  it('goes on naming the retired plank after another one takes its address', async () => {
    await shelve('Ann Author')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal alone on 1B
    await store.setLocation(cal, '1B')

    const wasOn = (await shelves.planks('fiction')).at(plank('1B')).areaId
    expect(await rowsReading('1B')).toEqual([wasOn])

    await shelves.moveAcrossBoundary('fiction', cal, 'previous', { theAreaGoes: true })
    expect(await labels()).toEqual(['1A', '1A'])
    expect((await receiptFor(cal))?.fromArea).toBe(wasOn)

    // The person puts a plank back on the piece from the furniture screen. It is
    // a new row, and it is the one on the face, so it is the one the address
    // answers to now.
    const fixture = await db.get<{ id: number }>(
      'SELECT id FROM fixture WHERE position = 1 ORDER BY id LIMIT 1',
    )
    expect((await addAreaTo(db, fixture!.id, {})).ok).toBe(true)

    const reading = await rowsReading('1B')
    expect(reading).toHaveLength(2)
    expect(reading).toContain(wasOn)

    // Two rows, one address, and the receipt is unambiguous about which of them
    // the move was about. That is the whole of #481.
    const receipt = await receiptFor(cal)
    expect(receipt?.from).toBe('1B')
    expect(receipt?.fromArea).toBe(wasOn)
  })

  /**
   * A second move keeps the older `from`, and the id has to travel with it.
   *
   * `merged` says why the older one wins: the receipt describes the arrangement
   * as it stood the last time this book and its shelf agreed. A receipt whose
   * address came from one moment and whose id came from another would name two
   * places, which is a worse answer than the one field it replaced.
   */
  it('keeps the older plank and the older address together when a move is merged', async () => {
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Cal on to 1B
    await store.setLocation(cal, '1B')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Bob joins him
    await store.setLocation(bob, '1B')
    await shelves.overflow('fiction', plank('1B'), 'area')       // Cal on to 1C
    await store.setLocation(cal, '1C')
    expect(await labels()).toEqual(['1A', '1B', '1C'])

    const planks = await shelves.planks('fiction')
    const cameOff = planks.at(plank('1B')).areaId
    const endedOn = planks.at(plank('1A')).areaId
    expect(ann).toBeGreaterThan(0)

    await shelves.moveAcrossBoundary('fiction', bob, 'next')
    await shelves.moveAcrossBoundary('fiction', bob, 'previous')

    const receipt = await receiptFor(bob)
    expect([receipt?.from, receipt?.to]).toEqual(['1B', '1A'])
    expect([receipt?.fromArea, receipt?.toArea]).toEqual([cameOff, endedOn])
  })
})

/**
 * What a boundary write owes the ledger (#487, the other half of #458).
 *
 * Three acts move a boundary and they wrote three different things down.
 * Removing one wrote an `assigned` row (#465); moving one wrote only its own
 * receipt, which names no area and which nothing that counts work reads;
 * overflow wrote nothing at all. So a book could be on the needs-attention list
 * and absent from the carry list at the same time, which is the sentence #458 is
 * made of, and `docs/shelving.md` had already forbidden it: the manual move and
 * the automatic shuffle "answer the same physical question, and if they wrote
 * different things down one would quietly undo the other".
 *
 * These read the carry list itself rather than the ledger, because the claim is
 * about the two screens and an assertion about rows is one step short of it.
 * And they compare the **delta** the act adds to each list, the way #465's do:
 * the two lists answer different questions and only what an act adds has to
 * match.
 */
describe('what a boundary write records', () => {
  const shelve = async (author: string, title = 'Book') => {
    const id = await add(author, title)
    await store.setLocation(id, await shelves.labelFor('fiction', id))
    return id
  }

  /** Which books the shelving review names, and which the carry list does. */
  const bothLists = async () => ({
    review: (await shelves.review('fiction')).misfiles.map((m) => m.book.id).sort(),
    carry: (await outstandingWork(db)).trips
      .flatMap((trip) => trip.books.map((book) => book.id)).sort(),
  })

  it('reaches the carry list when a full plank pushes a book along', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    expect(await bothLists()).toEqual({ review: [], carry: [] })

    await shelves.overflow('fiction', plank('1A'), 'area')

    // The review named Bob and the carry list said there was nothing to do.
    expect(await bothLists()).toEqual({ review: [bob], carry: [bob] })
    const trip = (await outstandingWork(db)).trips[0]
    expect([trip?.from, trip?.to]).toEqual(['1A', '1B'])
  })

  /**
   * And the assignment names the plank rather than the letter over it.
   *
   * The row has to point at the area the run now puts the book on, because that
   * is what a person is sent to and what `PATCH .../location` is checked
   * against. Read off `planks` rather than off the label for the reason #356
   * exists.
   */
  it('names the plank the run now puts the book on', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')

    const applied = await shelves.overflow('fiction', plank('1A'), 'area')
    expect(applied.planks?.to.areaId).not.toBeNull()

    const standing = standingOf(await new DrizzlePlacementLedger(db).forBooks([bob]))
    expect(standing.assigned).toBe(applied.planks?.to.areaId)
    expect(needsAttention(standing)).toBe(true)
  })

  it('writes nothing for a book the overflow did not move', async () => {
    const ann = await shelve('Ann Author')
    await shelve('Bob Baker')

    await shelves.overflow('fiction', plank('1A'), 'area')

    // Ann never left 1A, so there is nothing about her to write down and
    // nothing for anybody to carry.
    expect(needsAttention(standingOf(await new DrizzlePlacementLedger(db).forBooks([ann]))))
      .toBe(false)
  })

  /**
   * The answer where nothing already shelved moves is still nothing written.
   *
   * `carryOn` sends the book in the person's hand on to the next plank instead
   * of displacing one, so no shelved book crosses a boundary and no assignment
   * is due. The recording is on the write rather than on the caller precisely so
   * this case cannot be got wrong by remembering it separately.
   */
  it('records nothing when the book in hand is the one that moves', async () => {
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')
    const before = await bothLists()

    const carried = await shelves.overflow(
      'fiction', plank('1A'), 'area', await keyFor('Bob Baxter'),
    )
    expect(carried.carry).toMatchObject({ from: '1A', to: '1B' })
    expect(await bothLists()).toEqual(before)
    expect(await locations(ann, bob, cal)).toEqual(['1A', '1A', '1B'])
  })

  /**
   * The sibling act, made to write the same thing down.
   *
   * It wrote only the receipt, so a boundary move produced exactly the
   * disagreement #458 reports: one on the review, nought to carry. The receipt
   * stays, because it answers a different question, and both are now true of a
   * move.
   */
  it('reaches the carry list when a book is carried across a boundary', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    // Cal is the one the full plank pushed along and somebody carried him, so
    // the only thing outstanding when the move below is made is the move.
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')

    await shelves.moveAcrossBoundary('fiction', bob, 'next')

    expect(await bothLists()).toEqual({ review: [bob], carry: [bob] })
    // The receipt is still written, because taking the move back still needs it.
    expect((await shelves.outstandingMoves('fiction')).map((m) => m.bookId)).toEqual([bob])
  })

  /**
   * And the undo takes both back.
   *
   * `takeTheAssignmentsBack` was scoped to the planks a retraction brought back,
   * which was complete while a move wrote nothing of its own. A plain re-anchor
   * brings no plank back, so that reading would leave the assignment standing
   * and the carry list holding a trip for a move somebody had taken back, which
   * is #465's defect arriving from the other end a second time.
   */
  it('takes the assignment back when a plain re-anchor is retracted', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    // Cal is the one the full plank pushed along and somebody carried him, so
    // the only thing outstanding when the move below is made is the move.
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')

    await shelves.moveAcrossBoundary('fiction', bob, 'next')
    expect((await bothLists()).carry).toEqual([bob])

    expect((await shelves.retractMove('fiction', bob)).ok).toBe(true)
    expect(await bothLists()).toEqual({ review: [], carry: [] })
  })

  /** The helper the cases above share, kept beside them. */
  const keyFor = async (author: string, title = 'Book') =>
    (await placementFor({ title, authors: [author], genre: FICTION_SLUG } as never)).sortKey

  const locations = async (...ids: number[]) =>
    Promise.all(ids.map(async (id) => (await store.getBook(id))?.location))
})

describe('misfile detection', () => {
  /** Add a book and record the shelf it actually landed on, as saving does. */
  const shelve = async (author: string, title = 'Book') => {
    const id = await add(author, title)
    await store.setLocation(id, await shelves.labelFor('fiction', id))
    return id
  }

  const flagged = async (range: 'fiction' | 'nonfiction' = 'fiction') =>
    (await shelves.review(range)).misfiles.map((m) => [m.book.id, m.from, m.to])

  it('says nothing while the shelves and the catalogue agree', async () => {
    await shelve('Ann Author')
    await shelve('Bob Baker')
    expect(await flagged()).toEqual([])
  })

  it('reports the book a full shelf pushed along, and where it goes', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')

    // The person says 1A will not take another. Bob physically moves to 1B,
    // but nobody has said so yet, so the catalogue still has him at 1A.
    await shelves.overflow('fiction', plank('1A'), 'area')

    expect(await flagged()).toEqual([[bob, '1A', '1B']])
  })

  it('drops a book off the list once a person says they moved it', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')
    expect(await flagged()).toHaveLength(1)

    await store.setLocation(bob, '1B')
    expect(await flagged()).toEqual([])
  })

  it('never rewrites a location to make the disagreement go away', async () => {
    // The whole constraint in one assertion. Running the check twice must
    // leave the row exactly as it was, or the record of where the book really
    // is has been destroyed by the thing that only meant to notice.
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')

    const before = await store.getBook(bob)
    await shelves.review('fiction')
    await shelves.review('fiction')
    expect(await store.getBook(bob)).toEqual(before)
    expect((await store.getBook(bob))?.location).toBe('1A')
  })

  it('reports the book an edit moved, which is the re-shelving case', async () => {
    // Zola sits last. Renaming the author to Adams moves the book to the front
    // of the range, and the physical book has to follow it.
    await shelve('Ann Author')
    await shelve('Mary Mills')
    const id = await shelve('Zoe Zola')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Zola alone on 1B
    await store.setLocation(id, '1B')
    expect(await flagged()).toEqual([])

    await updateBook(id, { title: 'Book', authors: ['Al Adams'], genre: FICTION_SLUG })
    expect(await flagged()).toEqual([[id, '1B', '1A']])
  })

  it('leaves a book nobody ever placed out of it', async () => {
    await add('Ann Author')                                // saved, never confirmed
    await shelve('Bob Baker')

    expect(await flagged()).toEqual([])
    expect((await shelves.review('fiction')).excluded.map((e) => e.reason))
      .toEqual(['never-placed'])
  })

  it('leaves a checked-out book out of it, and says that it did', async () => {
    const ann = await shelve('Ann Author')
    await shelve('Bob Baker')
    await store.setCheckedOut(ann, true)

    const review = await shelves.review('fiction')
    expect(review.misfiles).toEqual([])
    // Absent from the layout, so it has to be pulled in deliberately or the
    // caller cannot tell "fine" from "not looked at".
    expect(review.excluded.map((e) => [e.book.id, e.reason])).toEqual([
      [ann, 'checked-out'],
    ])
  })

  it('never compares fiction against non-fiction', async () => {
    // Bookcase 4 is non-fiction's own. A non-fiction book at 4A is not ahead
    // of or behind a fiction book at 1A; the two runs never interact.
    await shelve('Ann Author')
    const harari = (await store.addBook({
      title: 'Sapiens', authors: ['Yuval Harari'], genre: NON_FICTION_SLUG,
    })).id
    await store.setLocation(harari, await shelves.labelFor('nonfiction', harari))

    expect((await shelves.review('fiction')).misfiles).toEqual([])
    expect((await shelves.review('nonfiction')).misfiles).toEqual([])
    // And each range only ever reports its own books.
    expect((await shelves.review('nonfiction')).excluded.map((e) => e.book.id)).toEqual([])
  })

  /**
   * Genuinely a different behaviour since #232, and the assertion says the new
   * one.
   *
   * A recorded location used to be a string in a column, so `in the loft` went
   * in and the review had to set the book aside rather than guess where that
   * was. A recorded location is a plank now, so there is nothing to hold a
   * label naming no plank: the write refuses it (`UnknownPlank`) and the
   * `unreadable-location` exclusion is not reachable from here any more.
   *
   * So the claim moved from the review to the write, and it is the stronger
   * half of the same one: the state the review existed to notice cannot be
   * arrived at, and what the person last said is still standing afterwards.
   */
  it('refuses a label it cannot read rather than recording one to set aside', async () => {
    const id = await shelve('Ann Author')

    await expect(store.setLocation(id, 'in the loft')).rejects.toThrow(UnknownPlank)

    expect((await store.getBook(id))?.location).toBe('1A')
    const review = await shelves.review('fiction')
    expect(review.misfiles).toEqual([])
    expect(review.excluded).toEqual([])
  })

  /**
   * #356, and the reason the check compares ids rather than labels.
   *
   * Naming a bookcase is what the furniture screens are for, and it changes
   * nothing about where any book is: every area keeps its id, every placement
   * keeps the area it names, and the only thing that reads differently is the
   * label, which is derived. So a review taken either side of a rename has to
   * say exactly the same thing about exactly the same books.
   */
  it('says the same thing about the same books once a bookcase is named', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')
    expect(await flagged()).toHaveLength(1)

    const fixture = await db.get<{ id: number }>(
      'SELECT id FROM fixture WHERE position = 1 ORDER BY id LIMIT 1',
    )
    const named = await editFixture(db, fixture!.id, { name: 'Hall shelf' })
    expect(named.ok).toBe(true)

    const review = await shelves.review('fiction')
    expect(review.excluded).toEqual([])
    expect(review.misfiles.map((m) => m.book.id)).toEqual([bob])
  })

  /**
   * The write side of the same defect, and the one that loses work rather than
   * hiding it.
   *
   * A save records where the book landed by handing the label the layout drew
   * straight back to the ledger, and the layout draws `1A` whatever the piece is
   * called. `areaForLabel` used to match only unnamed furniture, so naming a
   * bookcase made every one of those labels name no plank: the save refused, and
   * the book had no recorded position at all.
   */
  it('records a book put on a bookcase that has a name', async () => {
    const fixture = await db.get<{ id: number }>(
      'SELECT id FROM fixture WHERE position = 1 ORDER BY id LIMIT 1',
    )
    await editFixture(db, fixture!.id, { name: 'Hall shelf' })

    const id = await shelve('Ann Author')

    expect((await store.getBook(id))?.location).toBe('Hall shelf · A')
    const review = await shelves.review('fiction')
    expect(review.misfiles).toEqual([])
    expect(review.excluded).toEqual([])
  })

  /**
   * The other half of the same claim: a settled collection stays settled.
   *
   * Comparing labels reported nothing here too, which is what made the defect
   * invisible. What said it was wrong was the count of books the check had set
   * aside, so that is what this asserts.
   */
  it('does not set a single book aside because its bookcase has a name', async () => {
    await shelve('Ann Author')
    await shelve('Bob Baker')

    const fixture = await db.get<{ id: number }>(
      'SELECT id FROM fixture WHERE position = 1 ORDER BY id LIMIT 1',
    )
    await editFixture(db, fixture!.id, { name: 'Hall shelf' })

    const review = await shelves.review('fiction')
    expect(review.excluded).toEqual([])
    expect(review.misfiles).toEqual([])
  })
})

/**
 * The other comparison of two readings, and it had the same defect (#356).
 *
 * `areaDisagreements` places every shelved book twice, once as the app draws it
 * and once as the rules claim it, and `applySchema` runs it on every start. Its
 * two readings render a label with different functions, so naming a bookcase
 * would have had it report every correctly shelved book on that piece: the
 * opposite symptom of the misfile list's, out of one cause.
 */
describe('the drift check the app makes about itself on every start', () => {
  /**
   * A book with the tag its range comes from, which is what a rule reads.
   *
   * `store.addBook` writes the range; the tag is written beside it by
   * `settleGenre` in the save route, and this check asks the rules rather than
   * the column, so a book with no tag is claimed by nothing.
   */
  const tagged = async (author: string) => {
    const id = await add(author)
    await db.run(
      `INSERT INTO book_tag (book_id, tag_id, source, confidence, added_at)
       SELECT ?, id, 'person', 'stated', '2026-08-16' FROM tag WHERE slug = ?`,
      [id, FICTION_SLUG],
    )
    return id
  }

  it('says nothing about the books on a bookcase that has a name', async () => {
    await tagged('Ann Author')
    await tagged('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')
    expect(await areaDisagreements(db)).toEqual([])

    const fixture = await db.get<{ id: number }>(
      'SELECT id FROM fixture WHERE position = 1 ORDER BY id LIMIT 1',
    )
    await editFixture(db, fixture!.id, { name: 'Hall shelf' })

    expect((await areaDisagreements(db)).map(describeAreaDisagreement)).toEqual([])
  })
})

/**
 * Renumbering a piece of furniture, which is the fourth door onto #458 (#491).
 *
 * The file this drives said, above the function, "renumbering a piece is
 * renaming it, and it moves nothing". Every clause of that is true of
 * `book_placement` and false of the derivation: `runAreasOf` walks the run in
 * `fixture.position` order, so a piece standing at a different number puts its
 * planks somewhere else in the walk, and where a second piece already stands
 * there it takes one of them out of the run altogether. Six books derived
 * elsewhere and the ledger said nothing.
 *
 * `bothLists` is the instrument, because the two lists disagreeing is the whole
 * defect: the review derives its answer and the carry list reads the ledger.
 */
describe('what renumbering a piece of furniture records', () => {
  const shelve = async (author: string, title = 'Book') => {
    const id = await add(author, title)
    await store.setLocation(id, await shelves.labelFor('fiction', id))
    return id
  }

  const bothLists = async () => ({
    review: (await shelves.review('fiction')).misfiles.map((m) => m.book.id).sort(),
    carry: (await outstandingWork(db)).trips
      .flatMap((trip) => trip.books.map((book) => book.id)).sort(),
  })

  const pieceAt = async (position: number) => (await db.get<{ id: number }>(
    'SELECT id FROM fixture WHERE position = ? ORDER BY id LIMIT 1', [position],
  ))!.id

  /** A run over two pieces, with a book standing on the second one. */
  const twoPieces = async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'shelf')
    await store.setLocation(bob, '2A')
    return bob
  }

  /**
   * The issue's own shape: a run over two pieces, and the second one stood on
   * the first one's number.
   *
   * Bookcase 2 stops being part of the walk, because the run keeps one fixture
   * per position and bookcase 1 was there first, so the book on it derives back
   * onto bookcase 1.
   */
  it("reaches the carry list when a piece is stood on another piece's number", async () => {
    const bob = await twoPieces()
    expect(await bothLists()).toEqual({ review: [], carry: [] })

    const renumbered = await editFixture(db, await pieceAt(2), { position: 1 })
    expect(renumbered.ok).toBe(true)

    // Before this, the review named Bob and the carry list said there was
    // nothing to do, which is #458's sentence.
    expect(await bothLists()).toEqual({ review: [bob], carry: [bob] })
  })

  /**
   * And the row names the plank rather than the letter over it.
   *
   * This is the case #356 was always going to bite last: two pieces standing at
   * one number draw two planks reading `1A`, so an answer taken in labels would
   * have said the book had not moved.
   */
  it('names the plank the run now puts the book on, not the letter', async () => {
    const bob = await twoPieces()
    const wasOn = await shelves.areaOf('fiction', bob)

    await editFixture(db, await pieceAt(2), { position: 1 })

    const standing = standingOf(await new DrizzlePlacementLedger(db).forBooks([bob]))
    expect(standing.assigned).toBe(await shelves.areaOf('fiction', bob))
    expect(standing.assigned).not.toBe(wasOn)
    expect(needsAttention(standing)).toBe(true)
  })

  /** A renumber that changes no order changes nothing, so it writes nothing. */
  it('writes nothing when the walk comes out the same', async () => {
    await twoPieces()

    // Onto a number nothing stands at, and still after bookcase 1, so the run
    // meets exactly the planks it met before.
    const renumbered = await editFixture(db, await pieceAt(2), { position: 3 })
    expect(renumbered.ok).toBe(true)
    expect(await bothLists()).toEqual({ review: [], carry: [] })
  })

  /**
   * The whole room reordered one call at a time, which is what the two screens
   * that offer this actually send.
   *
   * `FurnitureScreen.saveOrder` and `FixtureScreen` both loop
   * `api.editFixture(one.id, { position })`, so the intermediate states are
   * rooms with two pieces on one number. Each step records what it moved and the
   * last step records the answer that stands, because `assignmentFor` compares
   * against the standing assignment rather than against the placement: a book
   * that ends where it began has its assignment written back and stops needing
   * attention.
   */
  it('leaves both lists empty when a reorder puts every piece back', async () => {
    await twoPieces()

    const one = await pieceAt(1)
    const two = await pieceAt(2)
    for (const [id, position] of [[two, 1], [one, 2], [two, 2], [one, 1]] as const) {
      expect((await editFixture(db, id, { position })).ok).toBe(true)
    }

    expect(await bothLists()).toEqual({ review: [], carry: [] })
  })
})

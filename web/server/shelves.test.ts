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

// openTestDatabase may return either backing database; nothing below knows which.
beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)
})

afterAll(closeTestDatabase)

/** Lets a test say `1A` while the code it drives takes the plank the label resolves to. */
const plank = (label: string): PlankAt => plankAt(label)!

/** Authors chosen so alphabetical order matches the argument order. */
const add = async (author: string, title = 'Book') =>
  (await store.addBook({ title, authors: [author], genre: FICTION_SLUG })).id

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
 * Reduces `boundaryOptions`' plank answers to labels, for tests that only care
 * whether a direction is open; tests about identity read `areaId` off the row instead.
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
    // What the person records as carried is the plank id, not just the label;
    // a label alone could not identify it.
    expect(result.planks?.to.label).toBe('1B')
    expect(result.planks?.to.areaId).toBe(await shelves.areaOf('fiction', bob))
  })

  it('can start a whole new bookcase instead', async () => {
    await add('Ann Author')
    await add('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'shelf')
    expect(await labels()).toEqual(['1A', '2A'])
  })

  /* Emptying a plank is the point: leaving one bare is allowed, not a bug. */
  it('takes the only book off a shelf, leaving that shelf bare', async () => {
    const ann = await add('Ann Author')
    const result = await shelves.overflow('fiction', plank('1A'), 'area')
    expect(result.ok).toBe(true)
    expect(result.step?.moved.id).toBe(ann)
    expect(result.step?.from).toBe('1A')
    expect(result.step?.to).toBe('1B')
    // 1A is bare, so it has no books to name it and drops out of the layout
    // until something lands on it.
    expect(await labels()).toEqual(['1B'])
  })

  it('walks the cascade one answer at a time', async () => {
    await add('Ann Author')
    const bob = await add('Bob Baker')
    const cal = await add('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')      // Cal to A2
    expect(await labels()).toEqual(['1A', '1A', '1B'])

    const second = await shelves.overflow('fiction', plank('1A'), 'area')
    expect(second.step?.moved.id).toBe(bob)
    expect(await labels()).toEqual(['1A', '1B', '1B'])
    expect(cal).toBeGreaterThan(0)
  })
})

/** A proposal is not an observation about the room: it must move nothing. */
describe('proposing the move without making it', () => {
  it('names the same book the answer would move, and moves nothing', async () => {
    await add('Ann Author')
    const bob = await add('Bob Baker')

    const plan = await shelves.proposeOverflow('fiction', plank('1A'), 'area')
    expect(plan.ok).toBe(true)
    expect(plan.step?.moved.id).toBe(bob)
    expect(plan.step?.to).toBe('1B')

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
    const refused = await shelves.proposeOverflow('fiction', plank('9Z'), 'area')
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('There is no shelf 9Z')
    expect(refused.error).toContain('1A')
  })
})

describe('confirming a move that was proposed a while ago', () => {
  it('refuses when the plank no longer ends with the book named', async () => {
    await add('Ann Author')
    await add('Bob Baker')
    const cal = await add('Cal Church')

    const plan = await shelves.proposeOverflow('fiction', plank('1A'), 'area')
    expect(plan.step?.moved.id).toBe(cal)

    await shelves.overflow('fiction', plank('1A'), 'area')

    const applied = await shelves.overflow('fiction', plank('1A'), 'area', '', cal)
    expect(applied.ok).toBe(false)
    expect(applied.error).toContain('changed')
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
    // Ann and Bob fill 1A, Cal is on 1B, and Baxter, the book being placed,
    // sorts after Bob and before Cal.
    const ann = await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')
    expect(await labels()).toEqual(['1A', '1A', '1B'])

    const result = await shelves.overflow('fiction', plank('1A'), 'area', await keyFor('Bob Baxter'))
    expect(result.ok).toBe(true)
    expect(result.carry).toMatchObject({ from: '1A', to: '1B' })
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
    // The cascade would take Author off 1A, leaving it bare; carrying the book
    // in hand instead is preferred because then nothing already shelved moves.
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
    // The special case only fires for the shelf the book is actually going on;
    // a rung about some other shelf still gets the cascade.
    const ids: number[] = []
    for (const a of ['Ann Author', 'Bob Baker', 'Cal Church', 'Dot Downs']) ids.push(await shelve(a))
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(ids[3]!, '1B')
    expect(await labels()).toEqual(['1A', '1A', '1A', '1B'])

    const result = await shelves.overflow('fiction', plank('1B'), 'area', await keyFor('Ann Baxter'))
    expect(result.carry).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.step?.moved.id).toBe(ids[3])
    expect(result.step?.from).toBe('1B')
    expect(result.step?.to).toBe('1C')
  })

  it('walks the whole chain through a plank that holds one book', async () => {
    /*
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

    // 1A is full, so Church comes off its end and is offered to 1B.
    const first = await shelves.proposeOverflow('fiction', plank('1A'), 'area', placing)
    expect(first.step?.moved.id).toBe(ids[2])
    expect(first.step).toMatchObject({ from: '1A', to: '1B' })

    // 1B will not take Church, so Downs goes on to a 1C made for him; nothing
    // about 1A is decided yet.
    const second = await shelves.overflow('fiction', plank('1B'), 'area', placing, ids[3])
    expect(second.ok).toBe(true)
    expect(second.step).toMatchObject({ from: '1B', to: '1C' })
    await store.setLocationIn(ids[3]!, second.planks!.to.areaId!)

    // Church goes on the plank Downs just left.
    const back = await shelves.overflow('fiction', plank('1A'), 'area', placing, ids[2])
    expect(back.ok).toBe(true)
    expect(back.step).toMatchObject({ from: '1A', to: '1B' })
    await store.setLocationIn(ids[2]!, back.planks!.to.areaId!)

    // And the book in hand goes in the gap the shuffle opened.
    const baxter = await add('Ann Baxter')
    expect(await shelves.labelFor('fiction', baxter)).toBe('1A')
    await store.setLocation(baxter, '1A')

    expect(await labels()).toEqual(['1A', '1A', '1A', '1B', '1C'])
    expect((await shelves.review('fiction')).misfiles).toEqual([])
  })

  it('leaves nothing needing attention once the book is saved', async () => {
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
   * A shelf is derived, so being catalogued and being shelved are the same
   * fact: this is the property that let the "unshelved" count be dropped.
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
    expect(placed.every((p) => /^\d+[A-Z]+$/.test(p.label))).toBe(true)
  })

  it('places a book saved without ever touching the location column', async () => {
    // Locations are derived; the location column stays empty for every book saved this way.
    const id = await add('Zola, Émile')
    const placed = await shelves.layout('fiction')
    expect(placed.find((p) => p.book.id === id)?.label).toBe('1A')
    expect((await store.getBook(id))?.location).toBe('')
  })
})

/**
 * A performance fix, verified behaviourally: the fast batch answer must match
 * the slow one-at-a-time answer, since where a key lands depends only on the
 * boundaries it has passed, not on the other books. `theSlowWay` is the old
 * method, written out for comparison.
 */
describe('the shelf a sort key lands on', () => {
  /** The old `layoutWith`, in full, so the comparison is against the algorithm. */
  async function theSlowWay(sortKey: string): Promise<string> {
    const books = (await shelves.layout('fiction'))
      .map((p) => ({ id: p.book.id, sortKey: p.book.sortKey }))
    const merged = [...books, { id: NEWCOMER_ID, sortKey }]
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    // Fiction begins at 1A in a freshly migrated database, which every
    // expectation in this file assumes.
    return layoutRange(merged, await shelves.list('fiction'), { shelf: 1, area: 0 })
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
     * above the whole run. The gaps matter: a checked-out book is absent from
     * the layout, so its key is asked about a run that does not contain it.
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
   * `areasForSortKeys` walks the run as rows and `shelvesForSortKeys` walks the
   * boundaries derived from those rows; the misfile check assumes they are two
   * readings of one sequence, so this checks that directly.
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
    // A book in a pile on the table is not something to put another book beside.
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
 * `shelved_books` is what keeps a catalogued row that is not on a shelf out of
 * the layout, now that `books` drives both shelf ordering and misfile
 * detection in one table.
 *
 * Written straight into `books` on purpose: a book the queue makes lacks a
 * shelf range and sort key too, so testing that would prove weaker protection.
 * This row is given a range and key that file it exactly between two real
 * books, so its state is the only thing keeping it off a shelf, which is the
 * harder property worth asserting.
 */
describe('a book in the catalogue that is not on a shelf', () => {
  /**
   * The key comes from `resolveKey`, the same one a save uses, so this lands
   * between two real books by the app's own ordering rather than a
   * plausible-looking string.
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
    // Location, unlike the row itself, goes through the app's own route:
    // there is no `books.location` column to write directly.
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

    // Baxter files after Baker and before Clark, between the unidentified row and Clark.
    const placement = await placementFor({
      title: 'Middle', authors: ['Bob Baxter'], genre: FICTION_SLUG,
    })
    expect(placement.predecessor?.title).toBe('Persuasion')
    expect(placement.successor?.title).toBe('Nights at the Circus')
  })

  it('is not judged by the misfile check, nor set aside by it', async () => {
    const ann = await add('Ann Author', 'On a shelf')
    await store.setLocation(ann, '1A')
    // The location must name a real plank (`UnknownPlank`), and 4A is
    // non-fiction's own, so a leak here would read as a book wrongly placed at
    // 4A rather than simply missing from 1A.
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

    // A third row in the layout would change which plank holds what and could
    // make the offer describe a move nobody can carry out.
    expect(await offered(ann)).toEqual({
      next: '1B', previous: null,
    })
  })

  it('is not listed as part of the catalogue', async () => {
    await add('Ann Author')
    await unidentified('Bob Baker')

    expect((await store.listRange('fiction')).map((row) => row.state)).toEqual(['shelved'])
    expect((await store.counts()).total).toBe(1)
  })

  it('is in the queue, which is the one place it belongs', async () => {
    // Made the way the app makes one, rather than written in directly.
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
   * `theAreaGoes` is the caller's assent that emptying an area is fine; the
   * write path refuses without it. Tests about the move itself pass it; the
   * assent question is pinned on its own below.
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
   * This is one of two paths that can remove an area, so the rule lives on the
   * write path rather than in a screen's confirmation dialog: a caller reached
   * another way would otherwise delete furniture in silence.
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
   * The offer carries what it costs so a screen need not compute it
   * separately; drift between the offer and what the write path enforces is
   * exactly the disagreement `areaDisagreements` exists to catch.
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

    expect(await shelves.boundaryOptions('fiction', ann))
      .toEqual({ next: null, previous: null })
  })

  /**
   * The bare 1C is added the same way an owner would add one. Its anchor sits
   * above every book in the run, so the move does not remove it: it survives
   * and comes forward a place.
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

  /**
   * `labels()` is the layout, where an empty area disappears until something
   * lands on it again. `groups` is not: it is what the area-management screen
   * draws, and a plank the room still has, with a boundary somebody can still
   * press Remove on, must be on it.
   */
  it('lets the only book in an area leave it, and empties the area', async () => {
    // Capacity is not modelled: a bare plank simply has no books to name.
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
    expect((await shelves.groups('fiction')).map((g) => [g.label, g.books.length]))
      .toEqual([['1A', 1], ['1B', 0], ['1C', 2]])
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
    const ids: number[] = []
    for (const a of ['Ann Author', 'Bob Baker', 'Cal Church', 'Dot Downs']) ids.push(await shelve(a))
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(ids[3]!, '1B')
    expect(await labels()).toEqual(['1A', '1A', '1A', '1B'])

    await carry(ids[2]!, 'next')                          // Cal joins Dot on 1B
    expect(await labels()).toEqual(['1A', '1A', '1B', '1B'])

    const step = await shelves.overflow('fiction', plank('1B'), 'area')
    expect(step.step?.moved.id).toBe(ids[3])
    expect(await labels()).toEqual(['1A', '1A', '1B', '1C'])
  })

  it('leaves the misfile list empty once the person has said the book moved', async () => {
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
    // The boundary move is furniture; where a book physically is has to come
    // from a person's observation, written through `store.setLocation`.
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    const cal = await shelve('Cal Church')
    await shelves.overflow('fiction', plank('1A'), 'area')
    await store.setLocation(cal, '1B')

    await shelves.moveAcrossBoundary('fiction', bob, 'next')
    expect((await store.getBook(bob))?.location).toBe('1A')
    expect((await shelves.review('fiction')).misfiles.map((m) => [m.from, m.to]))
      .toEqual([['1A', '1B']])
  })

  it('sends the first book of a bookcase back to the last area of the one before', async () => {
    /*
     * Within a range the areas are one continuous sequence; a bookcase break is
     * only where it crosses furniture, so this is the same move as any other
     * boundary crossing. The bookcase break gets re-anchored, which is why the
     * books past it stay on the bookcase they were on.
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
    // Making new furniture is what declaring a plank full (`overflow`) is for;
    // moving across a boundary never does, at either end of the run.
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
   * `boundaryOptions` is the read-only half of this rule; it has to agree with
   * `moveAcrossBoundary` exactly, or a preview could offer a move that then
   * refuses, or hide one that would have worked.
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
   * The move offered and the location written must be named by the same
   * `labelFor`, or the same plank could read as two different names on one
   * screen; the id travels beside the name because only the id says whether
   * two places are one place.
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
    expect(onto?.areaId).toBe((await store.getBook(cal))?.area_id)

    const back = (await shelves.boundaryOptions('fiction', cal)).previous
    expect(back?.label).toBe('Hall shelf · A')
    expect(back?.areaId).toBe((await store.getBook(bob))?.area_id)
  })

  /**
   * A rename could quietly desync a refusal's wording from the plank's real
   * name, with nothing to catch it since the move never happens either way.
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

    expect(await labels()).toEqual(['1A', '1A', '1B'])
  })
})

/**
 * What these check is that taking a move back is not the same as making the
 * opposite move; some cases land the book where the opposite move would too,
 * but that is not what is being asserted.
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
    expect(back.moves).toEqual([])
  })

  it('writes no location, because nobody carried anything', async () => {
    /*
     * Recording a placement and then moving again would put two statements
     * about the room into the catalogue that nobody actually made.
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

  /** Here there is no opposite move at all: nothing offers past the end of the run. */
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
   * A move that empties an area takes it off the furniture (`dropArea`), which
   * writes an `assigned` row per book naming where they now belong. Retracting
   * the move has to take that assignment back too, or the carry list would keep
   * a trip nobody needs to make.
   */
  it('takes the assignment back too, so nothing is left on the carry list', async () => {
    await shelve('Ann Author')
    const bob = await shelve('Bob Baker')
    await shelves.overflow('fiction', plank('1A'), 'area')       // Bob alone on 1B
    await store.setLocation(bob, '1B')

    await shelves.moveAcrossBoundary('fiction', bob, 'previous', { theAreaGoes: true })
    expect(needsAttention(standingOf(await placementsOf(bob)))).toBe(true)

    expect((await shelves.retractMove('fiction', bob)).ok).toBe(true)

    expect(await labels()).toEqual(['1A', '1B'])
    expect(needsAttention(standingOf(await placementsOf(bob)))).toBe(false)
    expect((await shelves.review('fiction')).misfiles).toEqual([])
  })

  /**
   * `landed.label` and `receipt.from` are both `locationLabel(shelf, area)`,
   * pure ordinal arithmetic that has never heard of a piece's name; naming a
   * bookcase moves neither side, so the comparison still holds after a rename.
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
    expect(await labels()).toEqual(['1A', '1A', '1B'])
    expect(back.move).toEqual({ from: '1B', to: '1A' })
  })

  it('refuses a book with nothing outstanding on it', async () => {
    const ann = await shelve('Ann Author')

    const result = await shelves.retractMove('fiction', ann)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no move outstanding')
  })

  it('has nothing left to take back once a person says where the book is', async () => {
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
     * The route does not prevent a second move while one is outstanding, even
     * though the screens do; merging keeps the older anchor, so the receipt
     * still reflects where things were when the book and its shelf last agreed.
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
 * An address like `4B` is a statement about where a plank stands, not which
 * row it is: a retirement and a renumbering can leave a different row
 * answering to the same address later. So the receipt records which planks by
 * id, beside what they were called; these tests are for that "which".
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
   * A plank taken empty off the end of a run is retired, not deleted, since the
   * catalogue still records a book on it. Adding a new plank back can then make
   * two rows answer to the same label, one retired and one live: the reading
   * prefers the live one, so the receipt's own label can point elsewhere.
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

    const receipt = await receiptFor(cal)
    expect(receipt?.from).toBe('1B')
    expect(receipt?.fromArea).toBe(wasOn)
  })

  /**
   * The address and its id must come from the same moment: a receipt whose
   * address came from one merge and whose id came from another would name two
   * different places.
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
 * All three acts that move a boundary (remove, move, overflow) must write the
 * same thing to the ledger, or a book could show as needing attention without
 * appearing on the carry list. These compare the delta each act adds to both
 * lists, since the lists answer different questions and only the delta has to match.
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

    expect(await bothLists()).toEqual({ review: [bob], carry: [bob] })
    const trip = (await outstandingWork(db)).trips[0]
    expect([trip?.from, trip?.to]).toEqual(['1A', '1B'])
  })

  /** The assignment names the plank by id, not by label: that is what `PATCH .../location` is checked against. */
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

    expect(needsAttention(standingOf(await new DrizzlePlacementLedger(db).forBooks([ann]))))
      .toBe(false)
  })

  /**
   * No shelved book crosses a boundary here, since the book in hand goes on
   * instead of displacing one, so no assignment is due. Recording happens on
   * the write path rather than the caller, so this case cannot be forgotten separately.
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
   * The receipt stays alongside the new ledger write: it answers a different
   * question, letting the move be taken back, and both are true of a move now.
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
    expect((await shelves.outstandingMoves('fiction')).map((m) => m.bookId)).toEqual([bob])
  })

  /**
   * A plain re-anchor brings no plank back, so scoping the ledger cleanup to
   * planks a retraction brings back would miss this case and leave a stale
   * assignment on the carry list.
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
    // Running the check twice must leave the row exactly as it was.
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
    expect((await shelves.review('nonfiction')).excluded.map((e) => e.book.id)).toEqual([])
  })

  /**
   * A location that cannot be read is refused at the write (`UnknownPlank`)
   * rather than recorded and set aside by the review, so the
   * `unreadable-location` exclusion is not reachable from here any more.
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
   * Naming a bookcase changes nothing about where any book is; only the label,
   * which is derived, reads differently. So a review taken either side of a
   * rename must say exactly the same thing about exactly the same books.
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
 * `areaDisagreements` places every shelved book twice, once as the app draws it
 * and once as the rules claim it; `applySchema` runs it on every start.
 */
describe('the drift check the app makes about itself on every start', () => {
  /**
   * `areaDisagreements` asks the rules (the book's tag) rather than the
   * `shelf_range` column, and `store.addBook` alone does not write a tag, so
   * this inserts one directly.
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
 * `runAreasOf` walks the run in `fixture.position` order, so renumbering a
 * piece puts its planks somewhere else in the walk, even though renumbering is
 * documented elsewhere as a rename that moves nothing.
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
   * The run keeps one fixture per position; bookcase 1 was there first, so
   * bookcase 2 (now sharing its number) drops out of the walk and its book
   * derives back onto bookcase 1.
   */
  it("reaches the carry list when a piece is stood on another piece's number", async () => {
    const bob = await twoPieces()
    expect(await bothLists()).toEqual({ review: [], carry: [] })

    const renumbered = await editFixture(db, await pieceAt(2), { position: 1 })
    expect(renumbered.ok).toBe(true)

    expect(await bothLists()).toEqual({ review: [bob], carry: [bob] })
  })

  /**
   * Two pieces standing at one number draw two planks that both read `1A`, so
   * comparing by label rather than id would say the book had not moved.
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
   * The intermediate states have two pieces on one number, matching how
   * `FurnitureScreen.saveOrder` and `FixtureScreen` actually reorder: one
   * `editFixture` call at a time. `assignmentFor` compares against the standing
   * assignment rather than the placement, so a book that ends where it began
   * stops needing attention.
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

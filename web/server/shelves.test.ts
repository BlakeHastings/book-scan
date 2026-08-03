/**
 * Separators against a real database, including the case the feature exists
 * for: a shelf that is physically full and a book that belongs in the middle
 * of it.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './db'
import { Shelves } from './shelves'
import { Store } from './store'

let store: Store
let shelves: Shelves

beforeEach(() => {
  const db = openDatabase(':memory:')
  store = new Store(db)
  shelves = new Shelves(db)
})

/** Authors chosen so alphabetical order matches the argument order. */
const add = (author: string, title = 'Book') =>
  store.addBook({ title, authors: [author], isFiction: true }).id

const labels = () => shelves.layout('fiction').map((p) => p.label)

describe('before anything is marked full', () => {
  it('puts every book on the first shelf', () => {
    add('Ann Author')
    add('Bob Baker')
    expect(labels()).toEqual(['1A', '1A'])
  })
})

describe('saying a shelf is full', () => {
  it('moves its last book to a new shelf and reports the step', () => {
    add('Ann Author')
    const bob = add('Bob Baker')
    expect(labels()).toEqual(['1A', '1A'])

    const result = shelves.overflow('fiction', '1A', 'area')
    expect(result.ok).toBe(true)
    expect(result.step?.moved.id).toBe(bob)
    expect(result.step?.from).toBe('1A')
    expect(result.step?.to).toBe('1B')
    expect(labels()).toEqual(['1A', '1B'])
    expect(result.moves).toEqual([{ id: bob, from: '1A', to: '1B' }])
  })

  it('can start a whole new bookcase instead', () => {
    add('Ann Author')
    add('Bob Baker')
    shelves.overflow('fiction', '1A', 'shelf')
    expect(labels()).toEqual(['1A', '2A'])
  })

  it('refuses a shelf with only one book on it', () => {
    add('Ann Author')
    const result = shelves.overflow('fiction', '1A', 'area')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('holds only one book')
  })

  it('walks the cascade one answer at a time', () => {
    add('Ann Author')
    const bob = add('Bob Baker')
    const cal = add('Cal Church')
    shelves.overflow('fiction', '1A', 'area')      // Cal to A2
    expect(labels()).toEqual(['1A', '1A', '1B'])

    // A1 still will not do; say so again.
    const second = shelves.overflow('fiction', '1A', 'area')
    expect(second.step?.moved.id).toBe(bob)
    expect(labels()).toEqual(['1A', '1B', '1B'])
    expect(cal).toBeGreaterThan(0)
  })
})

describe('a book inserted into a shelf', () => {
  it('is allowed to simply fit, without displacing anyone', () => {
    // A thin book may well fit, and only a person can say otherwise, so
    // nothing moves on its own.
    add('Bob Baker')
    add('Cal Church')
    shelves.overflow('fiction', '1A', 'area')
    const before = shelves.layout('fiction')

    add('Ann Author')
    expect(labels()).toEqual(['1A', '1A', '1B'])
    expect(shelves.movesSince('fiction', before)).toEqual([])
  })
})

describe('removing a boundary', () => {
  it('merges the shelves back and reports the books coming home', () => {
    add('Ann Author')
    const bob = add('Bob Baker')
    const created = shelves.overflow('fiction', '1A', 'area')
    expect(labels()).toEqual(['1A', '1B'])

    const before = shelves.layout('fiction')
    shelves.remove(shelves.list('fiction')[0]!.id)

    expect(labels()).toEqual(['1A', '1A'])
    expect(shelves.movesSince('fiction', before)).toEqual([
      { id: bob, from: '1B', to: '1A' },
    ])
    expect(created.ok).toBe(true)
  })
})

describe('ranges are independent', () => {
  it('does not let a fiction boundary move non-fiction books', () => {
    add('Ann Author')
    add('Bob Baker')
    store.addBook({ title: 'Sapiens', authors: ['Yuval Harari'], isFiction: false })

    shelves.overflow('fiction', '1A', 'shelf')
    expect(shelves.layout('nonfiction').map((p) => p.label)).toEqual(['4A'])
  })
})

describe('every catalogued book has a shelf', () => {
  /**
   * The property behind dropping the "unshelved" count. A shelf is derived,
   * so being in the catalogue and being on a shelf are the same fact. If this
   * ever fails, an unshelved state exists again and needs reporting somewhere.
   */
  it('places every book exactly once, whatever the boundaries', () => {
    const ids = ['Austen, Jane', 'Brontë, Emily', 'Carter, Angela', 'Dickens, Charles',
      'Eliot, George', 'Forster, E M'].map((a) => add(a))

    for (const label of ['1A', '1A', '1B']) {
      shelves.overflow('fiction', label, 'area')
    }

    const placed = shelves.layout('fiction')
    expect(placed).toHaveLength(ids.length)
    expect(new Set(placed.map((p) => p.book.id))).toEqual(new Set(ids))
    // And every one of them names a real shelf.
    expect(placed.every((p) => /^\d+[A-Z]+$/.test(p.label))).toBe(true)
  })

  it('places a book saved without ever touching the location column', () => {
    // Which is every book saved since locations became derived.
    const id = add('Zola, Émile')
    const placed = shelves.layout('fiction')
    expect(placed.find((p) => p.book.id === id)?.label).toBe('1A')
    expect(store.getBook(id)?.location).toBe('')
  })
})

describe('a book taken off the shelf', () => {
  it('stops taking up room, so the shelf closes up behind it', () => {
    const ids = ['Jane Austen', 'Emily Bronte', 'Angela Carter'].map((a) => add(a))
    expect(labels()).toEqual(['1A', '1A', '1A'])

    store.setCheckedOut(ids[1]!, true)
    expect(shelves.layout('fiction').map((p) => p.book.id)).toEqual([ids[0], ids[2]])
  })

  it('is never offered as a neighbour to file against', () => {
    // The reason the column exists. A book in a pile on the table is not
    // something to put another book beside.
    add('Jane Austen')
    const middle = add('Emily Bronte')
    add('Angela Carter')

    const before = store.placementFor({
      title: 'X', authors: ['Ann Baxter'], isFiction: true,
    } as never)
    expect(before.successor?.id).toBe(middle)

    store.setCheckedOut(middle, true)
    const after = store.placementFor({
      title: 'X', authors: ['Ann Baxter'], isFiction: true,
    } as never)
    expect(after.successor?.id).not.toBe(middle)
  })

  it('comes back to the position its filing gives it, not the one it left', () => {
    const ids = ['Jane Austen', 'Emily Bronte', 'Angela Carter'].map((a) => add(a))
    store.setCheckedOut(ids[1]!, true)
    store.setCheckedOut(ids[1]!, false)
    expect(shelves.layout('fiction').map((p) => p.book.id)).toEqual(ids)
  })

  it('leaves the catalogue entry and its photos alone', () => {
    const id = add('Jane Austen', 'Persuasion')
    store.setCheckedOut(id, true)
    const book = store.getBook(id)
    expect(book?.title).toBe('Persuasion')
    expect(book?.checked_out_at).toBeTruthy()
    expect(store.checkedOut().map((b) => b.id)).toEqual([id])
  })

  it('counts as off the shelf without leaving its range tally', () => {
    add('Jane Austen')
    const id = add('Emily Bronte')
    store.setCheckedOut(id, true)
    expect(store.counts()).toEqual({
      total: 2, fiction: 2, nonfiction: 0, checkedOut: 1,
    })
  })
})

describe('misfile detection', () => {
  /** Add a book and record the shelf it actually landed on, as saving does. */
  const shelve = (author: string, title = 'Book') => {
    const id = add(author, title)
    store.setLocation(id, shelves.labelFor('fiction', id))
    return id
  }

  const flagged = (range: 'fiction' | 'nonfiction' = 'fiction') =>
    shelves.review(range).misfiles.map((m) => [m.book.id, m.from, m.to])

  it('says nothing while the shelves and the catalogue agree', () => {
    shelve('Ann Author')
    shelve('Bob Baker')
    expect(flagged()).toEqual([])
  })

  it('reports the book a full shelf pushed along, and where it goes', () => {
    shelve('Ann Author')
    const bob = shelve('Bob Baker')

    // The person says 1A will not take another. Bob physically moves to 1B,
    // but nobody has said so yet, so the catalogue still has him at 1A.
    shelves.overflow('fiction', '1A', 'area')

    expect(flagged()).toEqual([[bob, '1A', '1B']])
  })

  it('drops a book off the list once a person says they moved it', () => {
    shelve('Ann Author')
    const bob = shelve('Bob Baker')
    shelves.overflow('fiction', '1A', 'area')
    expect(flagged()).toHaveLength(1)

    store.setLocation(bob, '1B')
    expect(flagged()).toEqual([])
  })

  it('never rewrites a location to make the disagreement go away', () => {
    // The whole constraint in one assertion. Running the check twice must
    // leave the row exactly as it was, or the record of where the book really
    // is has been destroyed by the thing that only meant to notice.
    shelve('Ann Author')
    const bob = shelve('Bob Baker')
    shelves.overflow('fiction', '1A', 'area')

    const before = store.getBook(bob)
    shelves.review('fiction')
    shelves.review('fiction')
    expect(store.getBook(bob)).toEqual(before)
    expect(store.getBook(bob)?.location).toBe('1A')
  })

  it('reports the book an edit moved, which is the re-shelving case', () => {
    // Zola sits last. Renaming the author to Adams moves the book to the front
    // of the range, and the physical book has to follow it.
    shelve('Ann Author')
    shelve('Mary Mills')
    const id = shelve('Zoe Zola')
    shelves.overflow('fiction', '1A', 'area')       // Zola alone on 1B
    store.setLocation(id, '1B')
    expect(flagged()).toEqual([])

    store.updateBook(id, { title: 'Book', authors: ['Al Adams'], isFiction: true })
    expect(flagged()).toEqual([[id, '1B', '1A']])
  })

  it('leaves a book nobody ever placed out of it', () => {
    add('Ann Author')                                // saved, never confirmed
    shelve('Bob Baker')

    expect(flagged()).toEqual([])
    expect(shelves.review('fiction').excluded.map((e) => e.reason))
      .toEqual(['never-placed'])
  })

  it('leaves a checked-out book out of it, and says that it did', () => {
    const ann = shelve('Ann Author')
    shelve('Bob Baker')
    store.setCheckedOut(ann, true)

    const review = shelves.review('fiction')
    expect(review.misfiles).toEqual([])
    // Absent from the layout, so it has to be pulled in deliberately or the
    // caller cannot tell "fine" from "not looked at".
    expect(review.excluded.map((e) => [e.book.id, e.reason])).toEqual([
      [ann, 'checked-out'],
    ])
  })

  it('never compares fiction against non-fiction', () => {
    // Bookcase 4 is non-fiction's own. A non-fiction book at 4A is not ahead
    // of or behind a fiction book at 1A; the two runs never interact.
    shelve('Ann Author')
    const harari = store.addBook({
      title: 'Sapiens', authors: ['Yuval Harari'], isFiction: false,
    }).id
    store.setLocation(harari, shelves.labelFor('nonfiction', harari))

    expect(shelves.review('fiction').misfiles).toEqual([])
    expect(shelves.review('nonfiction').misfiles).toEqual([])
    // And each range only ever reports its own books.
    expect(shelves.review('nonfiction').excluded.map((e) => e.book.id)).toEqual([])
  })

  it('sets a label it cannot read aside rather than guessing', () => {
    const id = shelve('Ann Author')
    store.setLocation(id, 'in the loft')

    const review = shelves.review('fiction')
    expect(review.misfiles).toEqual([])
    expect(review.excluded.map((e) => e.reason)).toEqual(['unreadable-location'])
  })
})

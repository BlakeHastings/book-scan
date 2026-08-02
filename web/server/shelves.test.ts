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
    expect(labels()).toEqual(['A1', 'A1'])
  })
})

describe('marking a shelf full', () => {
  it('records the capacity, not the book it was clicked after', () => {
    add('Ann Author')
    const bob = add('Bob Baker')
    add('Cal Church')

    const result = shelves.markFullAfter('fiction', bob, 'shelf')
    expect(result.ok).toBe(true)
    // Two books sat on that shelf up to and including Bob.
    expect(result.separator?.capacity).toBe(2)
    expect(labels()).toEqual(['A1', 'A1', 'A2'])
  })

  it('starts a new area when the bookcase runs out', () => {
    add('Ann Author')
    const bob = add('Bob Baker')
    add('Cal Church')

    shelves.markFullAfter('fiction', bob, 'area')
    expect(labels()).toEqual(['A1', 'A1', 'B1'])
  })

  it('refuses to close a shelf that is already closed', () => {
    const ann = add('Ann Author')
    add('Bob Baker')
    shelves.markFullAfter('fiction', ann, 'shelf')

    const again = shelves.markFullAfter('fiction', ann, 'shelf')
    expect(again.ok).toBe(false)
    expect(again.error).toContain('already marked full')
  })

  it('refuses a book that is not on these shelves', () => {
    expect(shelves.markFullAfter('fiction', 999, 'shelf').ok).toBe(false)
  })
})

describe('a book arriving on a shelf that is already full', () => {
  it('pushes the last book onto the next shelf and says so', () => {
    add('Bob Baker')
    const cal = add('Cal Church')
    shelves.markFullAfter('fiction', cal, 'shelf') // A1 holds two, and is full
    expect(labels()).toEqual(['A1', 'A1'])

    const before = shelves.layout('fiction')

    // Ann sorts ahead of both, so Cal no longer fits and has to move.
    add('Ann Author')

    expect(labels()).toEqual(['A1', 'A1', 'A2'])
    expect(shelves.movesSince('fiction', before)).toEqual([
      { id: cal, from: 'A1', to: 'A2' },
    ])
  })

  it('cascades the displacement across every full shelf', () => {
    add('Bob Baker')
    const cal = add('Cal Church')
    shelves.markFullAfter('fiction', cal, 'shelf')
    add('Dan Dover')
    const eve = add('Eve Ellis')
    shelves.markFullAfter('fiction', eve, 'area')
    add('Fay Foster')

    expect(labels()).toEqual(['A1', 'A1', 'A2', 'A2', 'B1'])
    const before = shelves.layout('fiction')

    add('Ann Author')

    // One insert shunts a book off each full shelf in turn.
    expect(labels()).toEqual(['A1', 'A1', 'A2', 'A2', 'B1', 'B1'])
    const moves = shelves.movesSince('fiction', before)
    expect(moves).toEqual([
      { id: expect.any(Number), from: 'A1', to: 'A2' },
      { id: expect.any(Number), from: 'A2', to: 'B1' },
    ])
  })

  it('reports no moves when the new book lands at the end', () => {
    const ann = add('Ann Author')
    shelves.markFullAfter('fiction', ann, 'shelf')
    const before = shelves.layout('fiction')

    add('Zed Zulu')
    expect(shelves.movesSince('fiction', before)).toEqual([])
  })
})

describe('removing a separator', () => {
  it('merges the shelves back and reports the books coming home', () => {
    const ann = add('Ann Author')
    add('Bob Baker')
    const created = shelves.markFullAfter('fiction', ann, 'shelf')
    expect(labels()).toEqual(['A1', 'A2'])

    const before = shelves.layout('fiction')
    shelves.remove(created.separator!.id)

    expect(labels()).toEqual(['A1', 'A1'])
    expect(shelves.movesSince('fiction', before)).toEqual([
      { id: expect.any(Number), from: 'A2', to: 'A1' },
    ])
  })

  it('keeps the remaining positions contiguous', () => {
    const ann = add('Ann Author')
    add('Bob Baker')
    add('Cal Church')
    const first = shelves.markFullAfter('fiction', ann, 'shelf')
    const second = shelves.markFullAfter(
      'fiction', shelves.layout('fiction')[1]!.book.id, 'shelf',
    )

    shelves.remove(first.separator!.id)
    const left = shelves.list('fiction')
    expect(left).toHaveLength(1)
    expect(left[0]!.id).toBe(second.separator!.id)
    // Position renumbered, so it now closes the first shelf.
    expect(left[0]!.position).toBe(0)
  })
})

describe('ranges are independent', () => {
  it('does not let a fiction boundary move non-fiction books', () => {
    const ann = add('Ann Author')
    store.addBook({ title: 'Sapiens', authors: ['Yuval Harari'], isFiction: false })

    shelves.markFullAfter('fiction', ann, 'area')
    expect(shelves.layout('nonfiction').map((p) => p.label)).toEqual(['A1'])
  })
})

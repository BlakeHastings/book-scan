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

describe('saying a shelf is full', () => {
  it('moves its last book to a new shelf and reports the step', () => {
    add('Ann Author')
    const bob = add('Bob Baker')
    expect(labels()).toEqual(['A1', 'A1'])

    const result = shelves.overflow('fiction', 'A1', 'shelf')
    expect(result.ok).toBe(true)
    expect(result.step?.moved.id).toBe(bob)
    expect(result.step?.from).toBe('A1')
    expect(result.step?.to).toBe('A2')
    expect(labels()).toEqual(['A1', 'A2'])
    expect(result.moves).toEqual([{ id: bob, from: 'A1', to: 'A2' }])
  })

  it('can push into a new area instead', () => {
    add('Ann Author')
    add('Bob Baker')
    shelves.overflow('fiction', 'A1', 'area')
    expect(labels()).toEqual(['A1', 'B1'])
  })

  it('refuses a shelf with only one book on it', () => {
    add('Ann Author')
    const result = shelves.overflow('fiction', 'A1', 'shelf')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('nothing to give up')
  })

  it('walks the cascade one answer at a time', () => {
    add('Ann Author')
    const bob = add('Bob Baker')
    const cal = add('Cal Church')
    shelves.overflow('fiction', 'A1', 'shelf')      // Cal to A2
    expect(labels()).toEqual(['A1', 'A1', 'A2'])

    // A1 still will not do; say so again.
    const second = shelves.overflow('fiction', 'A1', 'shelf')
    expect(second.step?.moved.id).toBe(bob)
    expect(labels()).toEqual(['A1', 'A2', 'A2'])
    expect(cal).toBeGreaterThan(0)
  })
})

describe('a book inserted into a shelf', () => {
  it('is allowed to simply fit, without displacing anyone', () => {
    // A thin book may well fit, and only a person can say otherwise, so
    // nothing moves on its own.
    add('Bob Baker')
    add('Cal Church')
    shelves.overflow('fiction', 'A1', 'shelf')
    const before = shelves.layout('fiction')

    add('Ann Author')
    expect(labels()).toEqual(['A1', 'A1', 'A2'])
    expect(shelves.movesSince('fiction', before)).toEqual([])
  })
})

describe('removing a boundary', () => {
  it('merges the shelves back and reports the books coming home', () => {
    add('Ann Author')
    const bob = add('Bob Baker')
    const created = shelves.overflow('fiction', 'A1', 'shelf')
    expect(labels()).toEqual(['A1', 'A2'])

    const before = shelves.layout('fiction')
    shelves.remove(shelves.list('fiction')[0]!.id)

    expect(labels()).toEqual(['A1', 'A1'])
    expect(shelves.movesSince('fiction', before)).toEqual([
      { id: bob, from: 'A2', to: 'A1' },
    ])
    expect(created.ok).toBe(true)
  })
})

describe('ranges are independent', () => {
  it('does not let a fiction boundary move non-fiction books', () => {
    add('Ann Author')
    add('Bob Baker')
    store.addBook({ title: 'Sapiens', authors: ['Yuval Harari'], isFiction: false })

    shelves.overflow('fiction', 'A1', 'area')
    expect(shelves.layout('nonfiction').map((p) => p.label)).toEqual(['A1'])
  })
})

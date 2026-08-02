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

import { describe, expect, it } from 'vitest'
import { bookLock, FURNITURE_LOCK, inLockOrder, isbnLock, outOfOrder, rangeLock } from './locks'

describe('the order several locks are taken in', () => {
  it('is any book, then the ranges, then the furniture, whatever order they were named in', () => {
    expect(inLockOrder([FURNITURE_LOCK, 'book:3', rangeLock('nonfiction'), rangeLock('fiction'), bookLock(3)]))
      .toEqual(['book:3', 'shelf:fiction', 'shelf:nonfiction', 'furniture'])
  })

  it('refuses to guess where a name it has never heard of goes beside another', () => {
    expect(() => inLockOrder(['shelf:fiction', 'shelves'])).toThrow(/no place in LOCK_ORDER/)
  })

  it('takes one name as it is, since there is nothing for it to be ordered against', () => {
    expect(inLockOrder('anything at all')).toEqual(['anything at all'])
    expect(inLockOrder(['shelf:fiction', 'shelf:fiction'])).toEqual(['shelf:fiction'])
  })
})

describe('a lock taken while others are held', () => {
  it('may come later in the order, or be one already held', () => {
    expect(outOfOrder([bookLock(3)], rangeLock('fiction'))).toBeUndefined()
    expect(outOfOrder([bookLock(3), rangeLock('fiction')], FURNITURE_LOCK)).toBeUndefined()
    expect(outOfOrder([rangeLock('fiction'), FURNITURE_LOCK], rangeLock('fiction'))).toBeUndefined()
  })

  it('may not come before one already held', () => {
    expect(outOfOrder([rangeLock('fiction')], bookLock(3)))
      .toMatch(/book:3 cannot be taken while holding shelf:fiction/)
    expect(outOfOrder([FURNITURE_LOCK], rangeLock('nonfiction'))).toMatch(/while holding furniture/)
    expect(outOfOrder([rangeLock('nonfiction')], rangeLock('fiction')))
      .toMatch(/while holding shelf:nonfiction/)
  })
})

describe('the lock on an ISBN', () => {
  it('is one lock for both forms of a number, and none for what is not a number', () => {
    expect(isbnLock('0441013597')).toBe('isbn:9780441013593')
    expect(isbnLock('978-0-441-01359-3')).toBe('isbn:9780441013593')
    expect(isbnLock('')).toBeNull()
    expect(isbnLock('not a number')).toBeNull()
  })

  it('comes before any book, since a new book has no id to lock until its row is written', () => {
    const isbn = isbnLock('9780441013593')!
    expect(inLockOrder([FURNITURE_LOCK, rangeLock('fiction'), bookLock(3), isbn]))
      .toEqual(['isbn:9780441013593', 'book:3', 'shelf:fiction', 'furniture'])
    expect(outOfOrder([isbn], bookLock(3))).toBeUndefined()
    expect(outOfOrder([isbn, bookLock(3)], rangeLock('fiction'))).toBeUndefined()
  })

  it('may not be taken while a book, a range or the furniture is held', () => {
    const isbn = isbnLock('9780441013593')!
    expect(outOfOrder([bookLock(3)], isbn))
      .toMatch(/isbn:9780441013593 cannot be taken while holding book:3: the order is isbn, book, shelf, furniture/)
    expect(outOfOrder([rangeLock('fiction')], isbn)).toMatch(/while holding shelf:fiction/)
    expect(outOfOrder([FURNITURE_LOCK], isbn)).toMatch(/while holding furniture/)
  })
})

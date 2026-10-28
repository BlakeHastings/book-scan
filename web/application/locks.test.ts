import { describe, expect, it } from 'vitest'
import { bookLock, FURNITURE_LOCK, inLockOrder, outOfOrder, rangeLock } from './locks'

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

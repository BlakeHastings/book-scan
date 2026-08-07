/**
 * The contiguity invariant, stated without a database.
 *
 * Every case here is about `position`, because that column is what `list`
 * orders by and therefore what decides which run of books each shelf label
 * names. `web/server/dividers.test.ts` asserts the same rule from the other
 * end, on real rows and both drivers; these run in microseconds and say what
 * the rule *is*.
 */

import { describe, expect, it } from 'vitest'
import { RangeSeparators } from './separators'
import type { Separator } from '../../shared/layout'

const at = (id: number, position: number, startsAt = `key${id}`): Separator => ({
  id,
  range: 'fiction',
  kind: 'area',
  startsAt,
  position,
})

const positionsAfterRemoving = (separators: Separator[], id: number) => {
  const boundaries = RangeSeparators.of('fiction', separators)
  const removal = boundaries.without(id)!
  const applied = new Map(removal.renumbered.map((one) => [one.id, one.position]))
  return boundaries.all
    .filter((separator) => separator.id !== id)
    .map((separator) => applied.get(separator.id) ?? separator.position)
}

describe('reading a range', () => {
  it('puts the boundaries in position order however they arrived', () => {
    const boundaries = RangeSeparators.of('fiction', [at(7, 2), at(3, 0), at(5, 1)])
    expect(boundaries.all.map((separator) => separator.id)).toEqual([3, 5, 7])
  })

  it('breaks a shared position on id, so the order is at least stable', () => {
    const boundaries = RangeSeparators.of('fiction', [at(9, 1), at(4, 1), at(2, 0)])
    expect(boundaries.all.map((separator) => separator.id)).toEqual([2, 4, 9])
    expect(boundaries.contiguous).toBe(false)
  })

  it('puts a new boundary after the ones already there', () => {
    expect(RangeSeparators.of('fiction', []).nextPosition).toBe(0)
    expect(RangeSeparators.of('fiction', [at(1, 0), at(2, 1)]).nextPosition).toBe(2)
  })

  it('counts rather than reading the highest position, so a gap closes', () => {
    expect(RangeSeparators.of('fiction', [at(1, 0), at(2, 4)]).nextPosition).toBe(2)
  })
})

describe('removing a boundary', () => {
  it('leaves the positions contiguous', () => {
    expect(positionsAfterRemoving([at(1, 0), at(2, 1), at(3, 2)], 2)).toEqual([0, 1])
  })

  it('renumbers only what actually moved', () => {
    const removal = RangeSeparators.of('fiction', [at(1, 0), at(2, 1), at(3, 2)]).without(2)!
    expect(removal.removed.id).toBe(2)
    expect(removal.renumbered).toEqual([{ id: 3, position: 1 }])
  })

  it('touches nothing when the last boundary goes', () => {
    const removal = RangeSeparators.of('fiction', [at(1, 0), at(2, 1)]).without(2)!
    expect(removal.renumbered).toEqual([])
  })

  it('repairs a range whose positions had already collided', () => {
    // Two removals racing each other used to decrement the same tail twice.
    // A range in that state is renumbered back into shape rather than having
    // the damage carried forward one more removal.
    expect(positionsAfterRemoving([at(1, 0), at(2, 1), at(3, 1), at(4, 2)], 3))
      .toEqual([0, 1, 2])
  })

  it('says nothing happened when no boundary has that id', () => {
    expect(RangeSeparators.of('fiction', [at(1, 0)]).without(99)).toBeNull()
  })
})

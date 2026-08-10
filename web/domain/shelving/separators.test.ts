/**
 * Reading a range's boundaries, stated without a database.
 *
 * Every case here is about `position`, because that is the order a reader meets
 * the boundaries in and therefore what decides which run of books each shelf
 * label names. `web/infrastructure/shelving/separator-repository.test.ts`
 * asserts the same rule from the other end, on real rows; these run in
 * microseconds and say what the rule *is*.
 *
 * **The renumbering cases are gone (#232), deliberately.** A boundary is the
 * `area` it opens and its position is where that area sits in the run, so the
 * ordinals are contiguous by construction and `without` no longer computes a
 * renumbering to keep them that way. What is left is the part that was ever a
 * decision: which boundary goes, and whether this range has one at all.
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
  it('answers the boundary that goes, and nothing about the ones that stay', () => {
    const removed = RangeSeparators.of('fiction', [at(1, 0), at(2, 1), at(3, 2)]).without(2)
    expect(removed).toEqual(at(2, 1))
  })

  it('finds it by id, so a range whose positions had collided still answers', () => {
    // Two removals racing each other used to leave two boundaries sharing a
    // position. Identity is the id rather than the ordinal, so which boundary
    // is going does not depend on the numbering being in good order.
    const boundaries = RangeSeparators.of('fiction', [at(1, 0), at(2, 1), at(3, 1), at(4, 2)])
    expect(boundaries.without(3)).toEqual(at(3, 1))
  })

  it('says nothing happened when no boundary has that id', () => {
    expect(RangeSeparators.of('fiction', [at(1, 0)]).without(99)).toBeNull()
  })
})

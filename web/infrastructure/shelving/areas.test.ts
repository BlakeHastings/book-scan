/**
 * The walk from boundaries to areas, and the walk back, on their own.
 *
 * `placement-cutover.test.ts` proves the whole thing against a database, book
 * by book, which is the claim that matters. This is the arithmetic underneath
 * it, asserted where a failure says which step was wrong rather than which book
 * ended up in the wrong place, and it needs no database to say so.
 *
 * Every case in the first half is one `0013` had to get right, because that is
 * the same walk said in TypeScript and the two have to agree. The second half is
 * `boundariesFrom`, which is the same walk read backwards: since #232 the areas
 * are what is stored and the boundary list is derived from them, so the two
 * being inverses is what makes a boundary come back out as the boundary that
 * was put in.
 */

import { describe, expect, it } from 'vitest'
import { areasOf, boundariesFrom, type RunArea } from './areas'
import type { RangeStart, Separator, SeparatorKind } from '../../shared/layout'

const FICTION: RangeStart = { shelf: 1, area: 0 }

/** Boundaries as `DrizzleSeparatorRepository.inRange` hands them over. */
const boundaries = (...given: [SeparatorKind, string][]): Separator[] =>
  given.map(([kind, startsAt], at) => ({
    id: at + 1, range: 'fiction' as const, kind, startsAt, position: at,
  }))

const said = (start: RangeStart, separators: Separator[]) =>
  areasOf(start, separators).map((one) => `${one.fixturePosition}:${one.position}@${one.startsAt}`)

/**
 * The boundaries a run reads back as, once its areas are rows with ids.
 *
 * The id of an area is its place in the run, which is what `writeBoundaries`
 * produces on a range nothing has been written to yet: the run's first area
 * takes 0 and each boundary's area takes the next number along. So a boundary
 * list already in anchor order comes back with its own ids, and one that is not
 * comes back with the ids the furniture has.
 */
const readBack = (start: RangeStart, separators: Separator[]): Separator[] =>
  boundariesFrom(
    'fiction',
    areasOf(start, separators).map((area, at): RunArea => ({ ...area, id: at })),
  )

describe('the areas a run is cut into', () => {
  it('is one area anchored at the beginning when there are no boundaries', () => {
    // The empty string sorts below every sort key, which is how "from the
    // beginning" is said without a null.
    expect(said(FICTION, [])).toEqual(['1:0@'])
  })

  it('gives a plank boundary the next area of the same bookcase', () => {
    expect(said(FICTION, boundaries(['area', 'b'], ['area', 'd'])))
      .toEqual(['1:0@', '1:1@b', '1:2@d'])
  })

  it('gives a bookcase boundary a new bookcase, back at its top plank', () => {
    expect(said(FICTION, boundaries(['area', 'b'], ['shelf', 'd'], ['area', 'f'])))
      .toEqual(['1:0@', '1:1@b', '2:0@d', '2:1@f'])
  })

  it('starts a range where the range starts, which is not always bookcase one', () => {
    expect(said({ shelf: 4, area: 0 }, boundaries(['area', 'b'])))
      .toEqual(['4:0@', '4:1@b'])
  })

  it('walks boundaries in anchor order, whatever order they were recorded in', () => {
    // `layoutRange` sorts by anchor before walking, so a boundary added later
    // and lower in the alphabet cuts the run where its anchor is.
    expect(said(FICTION, boundaries(['area', 'm'], ['area', 'd'])))
      .toEqual(['1:0@', '1:1@d', '1:2@m'])
  })

  it('steps over both of two boundaries sharing one anchor, in recorded order', () => {
    /*
     * What a boundary move that empties an area leaves behind, and the case a
     * walk gets wrong by stepping once: the area between them holds no books and
     * still has to exist, or a whole plank's worth of books draws one place to
     * the left. `2C` being present and empty is the same thing
     * `placement-backfill.test.ts` asserts by `2B` being absent from the labels.
     */
    expect(said(FICTION, boundaries(['area', 'b'], ['shelf', 'k'], ['area', 'k'])))
      .toEqual(['1:0@', '1:1@b', '2:0@k', '2:1@k'])
  })
})

describe('the boundaries a run of areas is cut by', () => {
  it('is nothing at all for a run of one area', () => {
    // The first area of a run opens at the beginning rather than at a boundary,
    // which is why it carries the empty anchor and why it is not one.
    expect(readBack(FICTION, [])).toEqual([])
  })

  it('gives back every boundary the areas were walked from', () => {
    const given = boundaries(['area', 'b'], ['shelf', 'd'], ['area', 'f'])
    expect(readBack(FICTION, given)).toEqual(given)
  })

  it('derives the kind from where the area hangs, wherever the run starts', () => {
    // A bookcase break is an area whose fixture is not the previous area's, so
    // the two boundaries below are told apart by the furniture rather than by
    // anything stored. Non-fiction starts on bookcase 4, and the derivation is
    // about the step from one area to the next rather than about bookcase 1.
    const given = boundaries(['area', 'b'], ['shelf', 'd'])
    expect(readBack({ shelf: 4, area: 0 }, given)).toEqual(given)
  })

  it('is an inverse across two boundaries sharing one anchor', () => {
    // The arrangement a boundary move that empties an area leaves behind. The
    // empty area between them has to survive the round trip, or the second
    // boundary comes back as the first and a plank's worth of books moves.
    const given = boundaries(['area', 'b'], ['shelf', 'k'], ['area', 'k'])
    expect(readBack(FICTION, given)).toEqual(given)
  })

  it('gives them back in the order a reader meets them, renumbered and re-identified', () => {
    // Recorded out of anchor order, so the round trip is not the identity on the
    // input. It cannot be: a boundary is the area it opens and an area's
    // identity is its place in the run, so the anchor that sorts first takes the
    // first area and the ordinals follow the shelves rather than the recording.
    expect(readBack(FICTION, boundaries(['area', 'm'], ['area', 'd']))).toEqual([
      { id: 1, range: 'fiction', kind: 'area', startsAt: 'd', position: 0 },
      { id: 2, range: 'fiction', kind: 'area', startsAt: 'm', position: 1 },
    ])
  })
})

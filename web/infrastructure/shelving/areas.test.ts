/**
 * The walk from boundaries to areas, on its own.
 *
 * `placement-backfill.test.ts` proves the whole thing against a database, book
 * by book, which is the claim that matters. This is the arithmetic underneath
 * it, asserted where a failure says which step was wrong rather than which book
 * ended up in the wrong place, and it needs no database to say so.
 *
 * Every case here is one `0013` had to get right, because this is the same walk
 * said in TypeScript and the two have to agree.
 */

import { describe, expect, it } from 'vitest'
import { areasOf } from './areas'
import type { Separator, SeparatorKind } from '../../shared/layout'

const FICTION = { shelf: 1, area: 0 }

/** Boundaries as `DrizzleSeparatorRepository.inRange` hands them over. */
const boundaries = (...given: [SeparatorKind, string][]): Separator[] =>
  given.map(([kind, startsAt], at) => ({
    id: at + 1, range: 'fiction' as const, kind, startsAt, position: at,
  }))

const said = (start: { shelf: number; area: number }, separators: Separator[]) =>
  areasOf(start, separators).map((one) => `${one.fixturePosition}:${one.position}@${one.startsAt}`)

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

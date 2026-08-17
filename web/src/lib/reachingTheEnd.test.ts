/**
 * The bottom of a paged listing asks once per arrival, and #364 is why.
 *
 * Both sequences below were recorded off the running app at 414x896 against a
 * seeded catalogue of 267 books, one per drawing of the library, before
 * anything was changed:
 *
 * - **the boards**, where the whole catalogue arrived in five requests over
 *   half a second with nobody scrolling, because each page lengthened a row of
 *   spines instead of lowering the mark;
 * - **the covers**, where one page arrived and the listing then waited, because
 *   sixty covers are about four thousand pixels and the mark went with them.
 *
 * The first is the loop. It is replayed here as what the watcher reports rather
 * than as a count of requests, because the count is the symptom and the reports
 * are what the rule is written about.
 */

import { describe, expect, it } from 'vitest'
import { reported, UNREACHED, type Reach } from './reachingTheEnd'

/** Replay a run of reports and answer how many pages it asked for. */
function fetches(reports: readonly (readonly [onScreen: boolean, loading: boolean])[]): number {
  let reach: Reach = UNREACHED
  let asked = 0
  for (const [onScreen, loading] of reports) {
    const answer = reported(reach, onScreen, loading)
    reach = answer.reach
    if (answer.fetch) asked += 1
  }
  return asked
}

describe('the end of a listing arriving on screen', () => {
  it('asks for a page', () => {
    expect(fetches([[true, false]])).toBe(1)
  })

  it('asks for nothing when the mark is nowhere near', () => {
    expect(fetches([[false, false], [false, false]])).toBe(0)
  })

  it('asks for nothing while a page is already on its way', () => {
    expect(fetches([[true, true]])).toBe(0)
  })
})

describe('the boards, where a page of books does not lower the mark', () => {
  /*
   * The loop, exactly as the browser reported it: the mark is on screen when
   * the first page lands and it is still on screen after every page after it,
   * because sixty more spines make an existing row longer rather than making
   * the page taller. Under the old rule each of those reports was a fetch, and
   * the five that ran are the flicker.
   */
  it('asks once however many times the watcher says the mark is still there', () => {
    expect(fetches([
      [true, false], // page one has landed and the mark is under it
      [true, false], // page two landed; the boards are the same height
      [true, false], // page three
      [true, false], // page four
      [true, false], // page five
    ])).toBe(1)
  })

  it('is not merely slowed by a page being in flight in between', () => {
    // The gap between two pages is where `loading` goes false for a render, and
    // a rule that only skipped the busy reports would ask on every one of the
    // idle ones instead. This is the "stopped rather than slowed" case.
    expect(fetches([
      [true, false],
      [true, true],
      [true, false],
      [true, true],
      [true, false],
    ])).toBe(1)
  })
})

describe('the covers and the list, where the page really does grow', () => {
  it('asks again once the mark has been away and come back', () => {
    expect(fetches([
      [true, false],  // scrolled to the end of the first page
      [false, false], // the page arrived and took the mark down with it
      [true, false],  // scrolled on, and here is the end again
      [false, false],
      [true, false],
    ])).toBe(3)
  })

  it('does not treat a page arriving while the mark is away as an arrival', () => {
    expect(fetches([[false, false], [false, true], [false, false]])).toBe(0)
  })
})

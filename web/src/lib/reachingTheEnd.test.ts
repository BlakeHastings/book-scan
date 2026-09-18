/** Replayed here as what the watcher reports rather than as a count of requests, since the count is the symptom and the reports are what the rule is written about. */

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
  it('asks once however many times the watcher says the mark is still there', () => {
    expect(fetches([
      [true, false],
      [true, false],
      [true, false],
      [true, false],
      [true, false],
    ])).toBe(1)
  })

  it('is not merely slowed by a page being in flight in between', () => {
    // The gap between two pages is where `loading` goes false for a render; a rule that only
    // skipped the busy reports would ask on every idle one instead.
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
      [true, false],
      [false, false],
      [true, false],
      [false, false],
      [true, false],
    ])).toBe(3)
  })

  it('does not treat a page arriving while the mark is away as an arrival', () => {
    expect(fetches([[false, false], [false, true], [false, false]])).toBe(0)
  })
})

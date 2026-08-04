/**
 * The banding is the whole safety argument, so it is pinned here. If a
 * marginal match ever starts reading as a confident one, this is where it
 * shows up, not on a phone in front of a shelf.
 */

import { describe, expect, it } from 'vitest'
import {
  CLOSE_LIMIT, MATCH_CUTOFF, SIMILAR_LIMIT,
  confidentPick, hasCloseMatch, matchConfidence, shortlistPrompt,
} from './confidence'

describe('matchConfidence', () => {
  it('calls a near-identical image close', () => {
    expect(matchConfidence(0).strength).toBe('close')
    expect(matchConfidence(2).strength).toBe('close')
  })

  it('calls a match at the cutoff loose', () => {
    // The pair the issue names: a 2 and a 24 must not read alike.
    expect(matchConfidence(MATCH_CUTOFF).strength).toBe('loose')
    expect(matchConfidence(2).label).not.toBe(matchConfidence(MATCH_CUTOFF).label)
  })

  it('puts each boundary in the stronger band and the next bit in the weaker', () => {
    expect(matchConfidence(CLOSE_LIMIT).strength).toBe('close')
    expect(matchConfidence(CLOSE_LIMIT + 1).strength).toBe('similar')
    expect(matchConfidence(SIMILAR_LIMIT).strength).toBe('similar')
    expect(matchConfidence(SIMILAR_LIMIT + 1).strength).toBe('loose')
  })

  it('never gets stronger as the images get further apart', () => {
    const rank = { close: 2, similar: 1, loose: 0 }
    for (let d = 1; d <= MATCH_CUTOFF; d += 1) {
      expect(rank[matchConfidence(d).strength])
        .toBeLessThanOrEqual(rank[matchConfidence(d - 1).strength])
    }
  })

  it('treats a distance past the cutoff, or no distance at all, as the weakest', () => {
    // Nothing should arrive like this. If it does, doubt is the cheap error.
    expect(matchConfidence(32).strength).toBe('loose')
    expect(matchConfidence(64).strength).toBe('loose')
    expect(matchConfidence(Number.NaN).strength).toBe('loose')
    expect(matchConfidence(undefined as unknown as number).strength).toBe('loose')
  })

  it('says nothing about how many bits differ', () => {
    for (let d = 0; d <= MATCH_CUTOFF; d += 1) {
      expect(matchConfidence(d).label).not.toMatch(/\d/)
    }
  })
})

describe('hasCloseMatch', () => {
  it('is false for an empty shortlist', () => {
    expect(hasCloseMatch([])).toBe(false)
  })

  it('is false when the best on offer is merely similar', () => {
    expect(hasCloseMatch([{ distance: 9 }, { distance: 15 }, { distance: 24 }])).toBe(false)
  })

  it('is true as soon as one candidate is close', () => {
    expect(hasCloseMatch([{ distance: 20 }, { distance: 3 }])).toBe(true)
  })

  it('does not grade a candidate against the others on the list', () => {
    // Best of a bad set is still a bad set. A relative scale would flatter
    // the 17 here into the top band, which is exactly the wrong tap.
    expect(hasCloseMatch([{ distance: 17 }, { distance: 23 }, { distance: 24 }])).toBe(false)
    expect(matchConfidence(17).strength).toBe(matchConfidence(23).strength)
  })
})

describe('shortlistPrompt', () => {
  it('warns when nothing on the list is close', () => {
    const prompt = shortlistPrompt([{ distance: 18 }, { distance: 22 }])
    expect(prompt).toMatch(/nothing looks close/i)
  })

  it('asks the ordinary question when something is close', () => {
    expect(shortlistPrompt([{ distance: 4 }])).toMatch(/is it one of these/i)
  })

  it('never offers to pick one for the user', () => {
    for (const list of [[{ distance: 0 }], [{ distance: 24 }], []]) {
      expect(shortlistPrompt(list)).not.toMatch(/select|chosen|picked for you/i)
    }
  })
})

describe('confidentPick', () => {
  it('picks nothing out of an empty shortlist', () => {
    expect(confidentPick([])).toBeNull()
  })

  it('picks the single close candidate, even beside weaker ones', () => {
    const close = { id: 1, distance: 3 }
    expect(confidentPick([close, { id: 2, distance: 17 }, { id: 3, distance: 24 }]))
      .toBe(close)
  })

  it('picks nothing when the best on offer is merely similar', () => {
    // 9 is one bit past the close band. That is the whole gate: the band, not
    // the ordering, decides whether anything opens by itself.
    expect(confidentPick([{ distance: 9 }, { distance: 12 }])).toBeNull()
    expect(confidentPick([{ distance: SIMILAR_LIMIT }])).toBeNull()
    expect(confidentPick([{ distance: MATCH_CUTOFF }])).toBeNull()
  })

  it('picks nothing when two candidates are both close', () => {
    // They cannot both be the book being held up, and preferring the nearer
    // one is the relative grading the bands exist to refuse.
    expect(confidentPick([{ distance: 1 }, { distance: 4 }])).toBeNull()
    expect(confidentPick([{ distance: 0 }, { distance: CLOSE_LIMIT }])).toBeNull()
  })

  it('agrees with the band function on every distance it could be handed', () => {
    for (let d = 0; d <= MATCH_CUTOFF; d += 1) {
      const picked = confidentPick([{ distance: d }]) !== null
      expect(picked).toBe(matchConfidence(d).strength === 'close')
    }
  })

  it('picks nothing for a distance it cannot make sense of', () => {
    expect(confidentPick([{ distance: Number.NaN }])).toBeNull()
    expect(confidentPick([{ distance: undefined as unknown as number }])).toBeNull()
  })
})

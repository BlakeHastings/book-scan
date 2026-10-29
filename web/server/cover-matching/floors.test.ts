/**
 * Every registered cover matcher, scored on the synthetic set, held to the
 * floor recorded for it in `registry.ts`. A matcher that gets worse is a red
 * check rather than a number somebody has to remember to look at.
 *
 * The set is generated here from a seed, as every fixture in this suite is.
 * A matcher that needs an encoder's weights runs only where they are already
 * cached (`npm run eval:covers` fetches them); this file never downloads, so
 * it behaves the same offline and on CI, where those rows are skipped and say so.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { evaluate } from './evaluate'
import { hashMatcher } from './hash-matcher'
import { isCached } from './models'
import { CI_SET, REGISTERED } from './registry'
import { coverSet, type CoverSet } from './synthetic'

let set: CoverSet

beforeAll(async () => {
  set = await coverSet(CI_SET)
}, 120_000)

describe('the harness itself', () => {
  it('labels every photograph, and holds some books back from the catalogue', () => {
    const ids = new Set(set.catalogue.map((book) => book.id))
    expect(set.catalogue).toHaveLength(CI_SET.books)
    expect(set.queries).toHaveLength(CI_SET.books * CI_SET.photosPerBook + CI_SET.absent)
    for (const query of set.queries) {
      if (query.truth !== null) expect(ids.has(query.truth)).toBe(true)
    }
    expect(set.queries.filter((query) => query.truth === null)).toHaveLength(CI_SET.absent)
  })

  it('finds a book from its own catalogue cover, and never opens the wrong one', async () => {
    // The plumbing check: if the very image the catalogue holds is not on the
    // hash's shortlist, the harness is scoring something other than the
    // matcher. Not top-1: two volumes of one series can hash identically, and
    // a tie at distance 0 goes to whichever sorts first. `confidentPick`
    // refuses that tie, which is what the second assertion holds it to.
    const flat = { catalogue: set.catalogue, queries: set.catalogue.map((book) => ({ photo: book.cover, truth: book.id, book: book.title })) }
    const score = await evaluate(hashMatcher, flat)
    expect(score.top4).toBe(1)
    expect(score.confidentWrong).toBe(0)
  }, 60_000)

  it('is the same set every time for one seed', async () => {
    const small = { ...CI_SET, books: 3, absent: 1, photosPerBook: 1 }
    const first = await coverSet(small)
    const second = await coverSet(small)
    expect(second.queries.map((query, n) => query.photo.equals(first.queries[n]!.photo)))
      .toEqual([true, true, true, true])
  }, 60_000)
})

describe('each registered matcher holds its floor', () => {
  for (const entry of REGISTERED) {
    const missing = entry.encoder && !isCached(entry.encoder)
    it.skipIf(missing)(`${entry.matcher.name}${missing ? ' (weights not cached; npm run eval:covers fetches them)' : ''}`, async () => {
      const score = await evaluate(entry.matcher, set)
      expect.soft(score.top1, 'top-1').toBeGreaterThanOrEqual(entry.floor.top1)
      expect.soft(score.top4, 'top-4').toBeGreaterThanOrEqual(entry.floor.top4)
      expect.soft(score.confidentWrong, 'confident wrong').toBeLessThanOrEqual(entry.floor.confidentWrong)
      // DINOv2 in fp32 took 102 s of this beside the rest of the suite.
    }, 300_000)
  }
})

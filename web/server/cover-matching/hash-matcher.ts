/**
 * The scanner's matcher until #669, restated behind `CoverMatcher` so it is
 * the baseline row: every catalogued cover within `MATCH_CUTOFF` bits, and
 * `confidentPick`'s one candidate within 8 as the bar. The cutoff and the bar
 * come from `shared/confidence.ts` rather than being copied. The scan route now
 * asks the fused matcher, which reads the hash only inside its similar band.
 */

import { coverHash, distance } from '../imagehash'
import { MATCH_CUTOFF, confidentPick } from '../../shared/confidence'
import type { CoverMatcher } from './matcher'

/** The shortlist the scanner shows. */
const SHORTLIST = 4

async function hashOrNull(image: Buffer): Promise<string | null> {
  try {
    return await coverHash(image)
  } catch {
    return null
  }
}

export const hashMatcher: CoverMatcher = {
  name: 'hash (today)',
  bar: 'exactly one candidate within 8 of 64 bits (confidentPick)',

  async prepare(catalogue) {
    const index: { id: string, hash: string }[] = []
    for (const book of catalogue) {
      const hash = await hashOrNull(book.cover)
      if (hash) index.push({ id: book.id, hash })
    }

    return async (photo) => {
      const query = await hashOrNull(photo)
      if (!query) return { candidates: [], confident: null }

      const shortlist = index
        .map((entry) => ({ id: entry.id, distance: distance(query, entry.hash) }))
        .filter((entry) => entry.distance <= MATCH_CUTOFF)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, SHORTLIST)

      return {
        candidates: shortlist.map((entry) => ({ id: entry.id, score: -entry.distance })),
        confident: confidentPick(shortlist)?.id ?? null,
      }
    }
  },
}

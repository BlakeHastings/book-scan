/**
 * Today's matcher, restated behind `CoverMatcher` so it is the baseline row.
 *
 * It has to answer exactly as `looksLike` and `confidentPick` do for
 * `POST /api/books/scan`, or the baseline measures something nobody ships. The
 * cutoff and the bar come from `shared/confidence.ts` rather than being copied.
 */

import { coverHash, distance } from '../imagehash'
import { MATCH_CUTOFF, confidentPick } from '../../shared/confidence'
import type { CoverMatcher } from './matcher'

/** What `looksLike` returns by default. */
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

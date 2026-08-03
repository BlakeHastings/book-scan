/**
 * How alike a cover match actually is, said in words rather than in bits.
 *
 * The server returns a Hamming distance over a 64 bit perceptual hash. It is
 * a real measurement and it is the only signal there is about whether a
 * candidate is the book in your hands, but "16" tells a person nothing. Two
 * unrelated images sit around 32 differing bits by chance, so 16 is halfway
 * to noise, and nobody holding a book is going to work that out.
 *
 * So the number is never printed. It picks one of three bands instead, and
 * the band drives both the wording and how strongly the candidate is drawn.
 *
 * The bands are absolute, not relative to the rest of the shortlist. A
 * relative scale would call the best of four bad guesses "close", which is
 * the exact moment a wrong match gets tapped. Being the least bad of a bad
 * set is not evidence.
 */

/**
 * The widest distance the server will offer. Past this it stops returning a
 * candidate at all, so nothing here should ever exceed it. Kept in step with
 * the filter in `looksLike` (`web/server/index.ts`).
 */
export const MATCH_CUTOFF = 24

/** Below this the two images are near enough identical to trust on sight. */
export const CLOSE_LIMIT = 8

/** Above this a candidate is nearer to noise than to a likeness. */
export const SIMILAR_LIMIT = 16

export type MatchStrength = 'close' | 'similar' | 'loose'

export interface MatchConfidence {
  strength: MatchStrength
  /**
   * Printed under the title. Phrased as a claim about the likeness, never as
   * a claim about the book, because only the person can settle that.
   */
  label: string
}

const BANDS: Record<MatchStrength, MatchConfidence> = {
  close: { strength: 'close', label: 'looks the same' },
  similar: { strength: 'similar', label: 'looks similar' },
  loose: { strength: 'loose', label: 'only a little alike, look closely' },
}

/**
 * Which band a distance falls in.
 *
 * Anything unmeasurable, missing or past the cutoff lands in the weakest
 * band. Erring towards doubt costs a second look; erring towards confidence
 * costs a wrong write to the catalogue.
 */
export function matchConfidence(distance: number): MatchConfidence {
  if (!Number.isFinite(distance)) return BANDS.loose
  if (distance <= CLOSE_LIMIT) return BANDS.close
  if (distance <= SIMILAR_LIMIT) return BANDS.similar
  return BANDS.loose
}

/**
 * Whether anything on the shortlist is worth trusting at a glance.
 *
 * False means every candidate needs comparing properly, and the panel says
 * so out loud rather than leaving the list looking as usual.
 */
export function hasCloseMatch(candidates: readonly { distance: number }[]): boolean {
  return candidates.some((candidate) => matchConfidence(candidate.distance).strength === 'close')
}

/**
 * What to say above the shortlist.
 *
 * The wording changes when nothing is close, because a list of four weak
 * guesses presented in the usual words reads as four ordinary options.
 */
export function shortlistPrompt(candidates: readonly { distance: number }[]): string {
  return hasCloseMatch(candidates)
    ? 'No barcode. Is it one of these?'
    : 'No barcode, and nothing looks close. Compare carefully, or shoot again.'
}

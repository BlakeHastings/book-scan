/**
 * How alike a cover match actually is, said in words and in an honest
 * percentage rather than in bits.
 *
 * The server returns a Hamming distance over a 64 bit perceptual hash. Two
 * unrelated images sit around 32 differing bits by chance, so the percentage is
 * rescaled against 32 rather than 64 and chance reads as 0%:
 *
 *   similarity = (32 - distance) / 32
 *
 * The bands are absolute, not relative to the rest of the shortlist. A relative
 * scale would call the best of four bad guesses "close".
 *
 * Shared rather than client-only because the server weighs a cover match too:
 * one definition of confident, in one file, for both sides of the wire.
 */

/**
 * The widest distance the hash offered when it was the scanner's only
 * strategy, and still the harness's baseline row (`hash-matcher.ts`). Since
 * #669 the scan route's fused matcher asks the hash only inside
 * `SIMILAR_LIMIT`, because past it the hash is close to chance on real covers.
 */
export const MATCH_CUTOFF = 24

/** Below this the two images are near enough identical to trust on sight. */
export const CLOSE_LIMIT = 8

/**
 * The bar a capture still in the queue has to clear, which is `CLOSE_LIMIT` and
 * nothing weaker. `MATCH_CUTOFF` does not carry over here: a queue match is a
 * photograph against another photograph taken in the same room, and a shared
 * background pulls two different books together, so at 24 nearly one pair of
 * different books in five reads as a match (measured by
 * `scripts/queue-match-accuracy.ts`). A wrong queue answer says two different
 * books are the same book.
 */
export const QUEUE_LIMIT = CLOSE_LIMIT

/** Above this a candidate is nearer to noise than to a likeness. */
export const SIMILAR_LIMIT = 16

/** Where two unrelated cover hashes land by chance. The percentage is scaled
 *  against this rather than against the full 64 bits. */
export const CHANCE_DISTANCE = 32

export type MatchStrength = 'close' | 'similar' | 'loose'

export interface MatchConfidence {
  strength: MatchStrength
  /**
   * How sure this reads, 0 to 100, scaled so chance is 0%. Null when there
   * is nothing to measure, which is the weakest case there is.
   */
  percent: number | null
  /**
   * A short word for the band. Phrased as a claim about the likeness, never as
   * a claim about the book. Pair with `percent`; see `confidenceLine`.
   */
  label: string
}

const BAND_WORDS: Record<MatchStrength, string> = {
  close: 'looks the same',
  similar: 'looks similar',
  loose: 'barely alike',
}

/**
 * Which band a distance falls in, plus how sure that reads as a percentage.
 * Anything unmeasurable, missing or past the cutoff lands in the weakest band.
 */
export function matchConfidence(distance: number): MatchConfidence {
  if (!Number.isFinite(distance)) {
    return { strength: 'loose', percent: null, label: BAND_WORDS.loose }
  }
  const percent = Math.max(
    0,
    Math.min(100, Math.round(((CHANCE_DISTANCE - distance) / CHANCE_DISTANCE) * 100)),
  )
  const strength: MatchStrength = distance <= CLOSE_LIMIT
    ? 'close'
    : distance <= SIMILAR_LIMIT ? 'similar' : 'loose'
  return { strength, percent, label: BAND_WORDS[strength] }
}

/**
 * The line actually printed under a title: the word plus how sure it reads,
 * e.g. "looks the same, 97%".
 */
export function confidenceLine(confidence: MatchConfidence): string {
  return confidence.percent === null
    ? confidence.label
    : `${confidence.label}, ${confidence.percent}%`
}

/**
 * Everything on a list that is near enough identical to trust on sight. The one
 * place the `close` band is applied, so the shortlist, the scanner and the queue
 * match cannot drift apart.
 */
export function closeMatches<T extends { distance: number | null }>(
  candidates: readonly T[],
): T[] {
  return candidates.filter(
    (candidate) => candidate.distance !== null && matchConfidence(candidate.distance).strength === 'close',
  )
}

/** Whether any candidate's hash is in the `close` band. A candidate the hash did not find has a null distance. */
export function hasCloseMatch(candidates: readonly { distance: number | null }[]): boolean {
  return closeMatches(candidates).length > 0
}

/**
 * How much of its title a cover photograph has to show for the scanner to say
 * the title is on it: the printed-title half of the fused matcher's bar
 * (`BAR.printedTitle` in `application/books/queries/match-cover.ts`).
 */
export const TITLE_ON_COVER = 0.8

/**
 * What one book on a cover shortlist is there because of, in words. The
 * strongest evidence first: its title read off the photograph, then a hash
 * near enough identical, then the picture, then words that found it without
 * its title (usually the author's name). Never a percentage for the picture
 * or the words: neither has a scale where chance reads as 0%, which is what
 * the hash's percentage means.
 */
export function coverMatchLine(match: {
  distance: number | null
  similarity: number | null
  titlePrinted: number | null
}): string {
  if (match.titlePrinted !== null && match.titlePrinted >= TITLE_ON_COVER) return 'title on the cover'
  if (match.distance !== null && matchConfidence(match.distance).strength === 'close') {
    return confidenceLine(matchConfidence(match.distance))
  }
  if (match.similarity !== null) return 'cover looks alike'
  if (match.titlePrinted !== null) return 'words on the cover'
  return match.distance !== null ? confidenceLine(matchConfidence(match.distance)) : BAND_WORDS.loose
}

export function shortlistPrompt(
  candidates: readonly { distance: number | null, titlePrinted?: number | null }[],
): string {
  const titleRead = candidates.some((candidate) => (candidate.titlePrinted ?? 0) >= TITLE_ON_COVER)
  return hasCloseMatch(candidates) || titleRead
    ? 'No barcode. Is it one of these?'
    : 'No barcode, and nothing looks close. Compare carefully, or shoot again.'
}

/**
 * The one candidate the scanner may open a book for without being asked.
 *
 * Two close candidates return nothing. They cannot both be the book in your
 * hands, and picking the nearer one would be exactly the relative grading the
 * bands exist to refuse, so ambiguity goes back to the person as a shortlist.
 *
 * The hash's own bar, and since #669 only the harness's baseline row asks it:
 * the scan route's shortlist is fused, and the server says which book, if
 * any, it is confident of.
 */
export function confidentPick<T extends { distance: number }>(
  candidates: readonly T[],
): T | null {
  const close = closeMatches(candidates)
  return close.length === 1 ? close[0]! : null
}

/**
 * The captures worth telling somebody about before they scan a book twice.
 *
 * Unlike `confidentPick` this does not refuse when two clear the bar, because
 * it only draws a panel and waits rather than opening a page unasked: two
 * captures that both look like the book in your hands is a thing to show a
 * person rather than resolve for them.
 *
 * Nearest first, and never more than a handful.
 */
export function queueMatches<T extends { distance: number }>(
  candidates: readonly T[],
  limit = 3,
): T[] {
  return closeMatches(candidates)
    .slice()
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
}

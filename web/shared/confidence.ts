/**
 * How alike a cover match actually is, said in words and in an honest
 * percentage rather than in bits.
 *
 * The server returns a Hamming distance over a 64 bit perceptual hash. It is
 * a real measurement and it is the only signal there is about whether a
 * candidate is the book in your hands, but "16" tells a person nothing on
 * its own, and a naive `(64 - distance) / 64` is worse than nothing: two
 * unrelated images sit around 32 differing bits by chance, so that formula
 * reads a coin flip as 50% and the acceptance cutoff of 24 as 62.5%, a
 * number that looks like a decent match.
 *
 * The percentage here is rescaled so chance reads as 0%:
 *
 *   similarity = (32 - distance) / 32
 *
 * which puts the cutoff at a plainly weak 25% instead. It is still just a
 * restatement of the same measurement, so it is printed beside a short word
 * rather than instead of one, and the word still comes from one of three
 * absolute bands, which drive both the wording and how strongly the
 * candidate is drawn.
 *
 * The bands are absolute, not relative to the rest of the shortlist. A
 * relative scale would call the best of four bad guesses "close", which is
 * the exact moment a wrong match gets tapped. Being the least bad of a bad
 * set is not evidence.
 *
 * Shared rather than client-only because the server now weighs a cover match
 * too: `/api/books/scan` asks whether the shortlist is confident enough to
 * answer without reading the barcode thoroughly first (#66). One definition
 * of confident, in one file, for both sides of the wire.
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

/**
 * Where two unrelated cover hashes land by chance. The percentage is scaled
 * against this, not against the full 64 bits, so chance itself reads as 0%
 * instead of a misleadingly respectable 50%.
 */
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
   * A short word for the band. Phrased as a claim about the likeness, never
   * as a claim about the book, because only the person can settle that.
   * Pair with `percent` for the line actually printed; see `confidenceLine`.
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
 *
 * Anything unmeasurable, missing or past the cutoff lands in the weakest
 * band. Erring towards doubt costs a second look; erring towards confidence
 * costs a wrong write to the catalogue.
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
 * e.g. "looks the same, 97%". A bare percentage was tried and rejected: 62%
 * for a candidate at the acceptance cutoff reads as a decent match rather
 * than the weak one it is, and a bare word loses the precision the owner
 * asked for. The two together let a glance catch the band from the word and
 * colour, while the number is there for anyone who wants it.
 */
export function confidenceLine(confidence: MatchConfidence): string {
  return confidence.percent === null
    ? confidence.label
    : `${confidence.label}, ${confidence.percent}%`
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

/**
 * The one candidate the scanner may open a book for without being asked.
 *
 * Scanning lands on the book's detail view, which is a page to read, not an
 * action. Nothing is written by getting there, so the cost of opening the
 * wrong book is a glance at a cover and a tap back, and the detail view puts
 * the title, the author and the cover in front of the person immediately. That
 * is a different bargain from the one `looksLike` refuses to make, which is
 * writing to the catalogue off the same signal.
 *
 * It is still the `close` band and nothing weaker, because that band already
 * carries the meaning wanted here: near enough identical to trust on sight.
 * Reusing it means there is one definition of confident in the app rather than
 * two that can drift apart.
 *
 * Two close candidates return nothing. They cannot both be the book in your
 * hands, and picking the nearer one would be exactly the relative grading the
 * bands exist to refuse. Ambiguity goes back to the person as a shortlist.
 *
 * The server asks the same question for a different reason. A barcode is
 * self-validating and a cover hash is a guess, so a shortlist may only
 * pre-empt the thorough barcode read when it is this confident. Anything
 * weaker waits, because a guess that beats an unread barcode is a guess
 * standing in for evidence nobody looked for (#66).
 */
export function confidentPick<T extends { distance: number }>(
  candidates: readonly T[],
): T | null {
  const close = candidates.filter(
    (candidate) => matchConfidence(candidate.distance).strength === 'close',
  )
  return close.length === 1 ? close[0]! : null
}

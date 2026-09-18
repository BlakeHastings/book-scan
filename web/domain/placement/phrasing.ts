/**
 * What a place holds, said in one sentence: "Anything tagged Comic books, or
 * anything tagged Poetry". Lives in the domain so the client can preview a
 * rule's phrase, using the same wording the server would produce.
 *
 * The two joining words are fixed: "and" within a rule's lines (all must
 * hold), "or" between rules (either files a book there). No nesting: `rules.ts`
 * refuses a boolean tree because it stops being readable at exactly the
 * moment somebody needs to read it.
 */

import type { RuleOperator } from './rules'

/** One line of a rule, with the tag as a person reads it rather than as a slug. */
export interface SaidLine {
  operator: RuleOperator
  /** A tag label. Never a slug: a slug is an identity and never reaches a screen. */
  tag: string
}

/**
 * A real state, not an error: a rule with no conditions claims nothing rather
 * than everything, so a rule somebody is halfway through writing is safe.
 */
export const CLAIMS_NOTHING = 'Nothing files here yet'

/**
 * One rule as a phrase, or the fallback (the rule's own name) when a line's
 * tag has no label in the vocabulary.
 */
export function ruleSaid(lines: readonly SaidLine[], fallback: string): string {
  if (!lines.length) return CLAIMS_NOTHING

  const parts = lines.map((line) => (line.tag
    // "tagged under Fiction", not "tagged anything under Fiction": "anything" already appears once in the phrase this is dropped into.
    ? (line.operator === 'under' ? `tagged under ${line.tag}` : `tagged ${line.tag}`)
    : null))

  return parts.every((part) => part !== null)
    ? `Anything ${parts.join(' and ')}`
    : `Anything ${fallback} claims`
}

/**
 * Every rule on one place as one sentence, joined the way somebody reads
 * them: "Anything tagged Comic books, or anything tagged Poetry".
 */
export function holdsSaid(
  rules: readonly { lines: readonly SaidLine[]; name: string }[],
): string {
  const said = rules.map((rule) => ruleSaid(rule.lines, rule.name))
  if (!said.length) return CLAIMS_NOTHING

  const [first, ...rest] = said
  if (!rest.length) return first!
  return [first!, ...rest.map((one) => one.charAt(0).toLowerCase() + one.slice(1))]
    .join(', or ')
}

/**
 * What a place holds, said in one sentence, in one place.
 *
 * The phrase at the top of every screen about a place: "Anything tagged Comic
 * books, or anything tagged Poetry". It lives in the domain rather than in the
 * server, and that is deliberate in a module that is otherwise about where books
 * go rather than about words.
 *
 * **A rule is now editable on the page of the place it is about** (#384), which
 * means the screen has to be able to draw the sentence for a rule that does not
 * exist yet, before it asks the server anything. Spelling it a second time in
 * the client is exactly how a screen ends up previewing one phrase and the
 * answer coming back as another, which is the fault `lib/furniture.ts` names
 * about labels and takes the same medicine for.
 *
 * ## The two joining words are fixed, and that is the model showing through
 *
 * All of a rule's lines must hold, so the word between them is always "and".
 * Two rules on one place both file books there, so the word between them is
 * always "or". There is no third word and no way to nest one inside the other,
 * because `rules.ts` refuses the boolean tree: it is unreadable at exactly the
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
 * What a place with no rule claiming anything holds, which is nothing.
 *
 * A real state and not an error: a rule with no conditions claims nothing rather
 * than everything, precisely so a rule somebody is halfway through writing is
 * safe. Every screen that draws a rule has to be able to say this.
 */
export const CLAIMS_NOTHING = 'Nothing files here yet'

/**
 * One rule as a phrase, or the fallback where a line cannot be named.
 *
 * `fallback` is the rule's own name, used when a line quotes a tag the
 * vocabulary has no label for. That is a gap rather than a normal case, and the
 * point of the fallback is that there is no path by which a slug reaches a
 * screen instead.
 */
export function ruleSaid(lines: readonly SaidLine[], fallback: string): string {
  if (!lines.length) return CLAIMS_NOTHING

  const parts = lines.map((line) => (line.tag
    /*
     * "tagged under Fiction" rather than "tagged anything under Fiction", which
     * put the word twice into the phrase this is dropped into: "Anything tagged
     * anything under Fiction". Found by drawing a piece whose rule was one
     * `under` line and reading the heading.
     */
    ? (line.operator === 'under' ? `tagged under ${line.tag}` : `tagged ${line.tag}`)
    : null))

  return parts.every((part) => part !== null)
    ? `Anything ${parts.join(' and ')}`
    : `Anything ${fallback} claims`
}

/**
 * Every rule on one place as one sentence, joined the way somebody reads them.
 *
 * "Anything tagged Comic books, or anything tagged Poetry" is one sentence about
 * one place. A list headed "rule 1 of 2" is a schema on a screen, and a person
 * adding a second tag should not have to know which of the two mechanisms they
 * just used.
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

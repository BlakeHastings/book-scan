/**
 * The arithmetic and the wording behind writing a rule on a place.
 *
 * Pure functions, no fetching and no React, for the reason `lib/furniture.ts`
 * is: the awkward cases are checked here rather than driven through two screens.
 * A vocabulary of four hundred narrowed by two letters, a plan whose moves run
 * to thirty pairs of places, a change that leaves a stretch of books with
 * nothing anchoring it, and the difference between a count of books to carry and
 * a count of rows written.
 *
 * ## What a line is, on the way out and on the way back
 *
 * A rule's line is a **slug** and an operator. The label is what somebody reads
 * and never what travels: `docs/data-model.md` says the slug is the identity, and
 * a rule that stored a label would stop matching the day the tag was renamed.
 * So the screen holds slugs and looks the labels up, in that direction only.
 */

import { holdsSaid } from '../../domain/placement/phrasing'
import type { RuleOffer, RuleSaid, WouldLeave, WouldMove } from '../design/Rules'
import type { DraftRule, RuleDraftLine, RuleChangePlan, RuleDto, SkippedBooks, TagRow } from './api'
import { SKIP_SAID, plural } from './furniture'

/** How many tags the picker offers before somebody has to say more. */
export const OFFERED = 8

/** How many pairs of places a plan draws before it says "and more like those". */
export const MOVES = 6

/**
 * The tags worth offering for what has been typed.
 *
 * **Matched anywhere in the label rather than at the front.** Somebody who has
 * to remember how a tag begins is somebody scrolling a vocabulary instead, and
 * "Second World War" is exactly the tag a person looks for by its middle.
 *
 * **A tag already on the rule is not offered.** Two identical lines are one
 * line, and the server collapses them, so offering the second is offering a
 * press that does nothing.
 *
 * The count travels with it, because it is what makes the choice a decision: a
 * tag forty books carry and a tag nothing carries are different answers, and the
 * word alone does not say which is which.
 */
export function offering(
  vocabulary: readonly TagRow[],
  query: string,
  already: readonly string[],
  limit = OFFERED,
): RuleOffer[] {
  const typed = query.trim().toLowerCase()
  const on = new Set(already)

  return vocabulary
    .filter((tag) => !on.has(tag.slug))
    .filter((tag) => typed === '' || tag.label.toLowerCase().includes(typed))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((tag) => ({ tag: tag.label, books: tag.books }))
}

/** The slug a label belongs to, which is how a pick becomes a line. */
export const slugFor = (vocabulary: readonly TagRow[], label: string): string | null =>
  vocabulary.find((tag) => tag.label === label)?.slug ?? null

/** A rule's lines as a person reads them: the label, never the identity. */
export const linesSaid = (
  vocabulary: readonly TagRow[],
  lines: readonly RuleDraftLine[],
): { operator: 'is' | 'under'; tag: string }[] =>
  lines.map((line) => ({
    operator: line.operator,
    /*
     * The slug is the fallback and it is a bad one, so it is deliberately the
     * only one: a vocabulary that has not arrived yet is a moment, and a rule
     * drawn against a tag this app has never heard of is a bug worth seeing.
     */
    tag: vocabulary.find((tag) => tag.slug === line.tag)?.label ?? line.tag,
  }))

/** Rules as the widget draws them: the lines named, and whether they are on. */
export const saidRules = (rules: readonly RuleDto[]): RuleSaid[] =>
  rules.map((rule) => ({ name: rule.name, lines: rule.conditions, enabled: rule.enabled }))

/**
 * What a draft would make this place hold, worked out before the server is asked.
 *
 * **One spelling of the sentence, in the domain**, imported by the server and by
 * this. The card somebody is writing a rule inside of has this at the top of it,
 * and it has to be right for a rule that is not a row yet; a second spelling here
 * is exactly how a screen ends up promising a phrase the answer disagrees with,
 * which is the fault `lib/furniture.ts` names about labels.
 */
export const draftHolds = (
  vocabulary: readonly TagRow[],
  rules: readonly DraftRule[],
): string => holdsSaid(rules.map((rule) => ({
  lines: linesSaid(vocabulary, rule.conditions),
  /*
   * The name is only ever reached for when a line quotes a tag with no label,
   * and a draft's rule has no name yet: it is worked out from the lines, on the
   * server, at the moment it is written. So the fallback is the honest one.
   */
  name: 'this rule',
})))

/**
 * The moves a plan comes to, as pairs of places with counts.
 *
 * A hundred and one lines is not something anybody reads standing in a room, so
 * the biggest are drawn and the rest are counted. The books themselves are named
 * a screen later, on the trip they belong to, which is where somebody is holding
 * them.
 */
export function movesOf(
  plan: Pick<RuleChangePlan, 'groups'>,
  limit = MOVES,
): { moving: WouldMove[]; more: number } {
  const sorted = [...plan.groups].sort((a, b) => b.books.length - a.books.length)
  return {
    moving: sorted.slice(0, limit).map((group) => ({
      from: group.from,
      to: group.to,
      books: group.books.length,
    })),
    more: Math.max(0, sorted.length - limit),
  }
}

/**
 * Every book the rules will not touch, with the reason beside it.
 *
 * **Never silently empty and never quietly folded into the headline.** A change
 * that said "84 books move" having left three pinned ones out of the eighty-four
 * would be believed, and the person would come back from the furniture three
 * books short with nothing anywhere saying why. `pinned` is the one that is
 * always right to see: a pin is a person overruling the rules, and it beats them
 * forever.
 */
export const leaving = (skipped: readonly SkippedBooks[]): WouldLeave[] =>
  skipped
    .filter((one) => one.books.length > 0)
    .map((one) => ({
      said: SKIP_SAID[one.reason] ?? 'left alone',
      books: one.books.length,
    }))

/**
 * What is true of this change beyond its counts, said in one line or not at all.
 *
 * Two facts qualify and both are consequences somebody would otherwise meet
 * afterwards. **An area gaining its first rule stops taking overflow**, because
 * an area a rule points at is where a stretch of books begins; and **a stretch
 * can be left with nothing anchoring it**, which is what taking the genre line
 * off the rule that serves fiction does. Neither is a refusal. They are his
 * rules and his room, and the app's job is to say so before rather than after.
 */
export function noteOf(plan: RuleChangePlan): string {
  const said: string[] = []

  /*
   * The second half of this sentence was found by running it against a real
   * room rather than by reasoning about it. An area a rule points at does not
   * only stop taking overflow: it **begins** a stretch, and every area after it
   * on the same piece carries on under it until something else begins one. A
   * note that said only the first half would have been true and would have left
   * somebody surprised by the area next door.
   */
  if (plan.opens) {
    said.push('Nothing has filed here by rule before, so this area stops taking what '
      + 'overflows from the area before it and begins a stretch of its own. The areas '
      + 'after it on the same piece come with it, until one of them begins a stretch '
      + 'of its own.')
  }

  if (plan.losing.length > 0) {
    const named = plan.losing.map((one) => (one === 'nonfiction' ? 'non-fiction' : one))
    said.push(`Nothing would file ${named.join(' or ')} any more, so the library `
      + `would have no rule saying where ${named.length === 1 ? 'it begins' : 'they begin'}.`)
  }

  if (plan.claiming === 0 && said.length === 0) {
    said.push('No book in the collection carries all of these, so nothing would file here.')
  }

  return said.join(' ')
}

/**
 * What applying wrote, said as the two numbers that are not the same number.
 *
 * `wrote` is rows of "the rules want this book here"; `carrying` is books
 * somebody has to pick up. A second apply of the same change writes nothing and
 * still leaves the same books to carry, and a screen that conflated the two
 * would report that as a change that did nothing.
 */
export const wroteSaid = (wrote: number): string =>
  (wrote === 0
    ? 'Nothing changed about where the books belong.'
    : `${plural(wrote, 'book')} now ${wrote === 1 ? 'belongs' : 'belong'} somewhere else.`)

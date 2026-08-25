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
import { NAMED_UNDER, nameIn, nameTag, sameThing } from '../../domain/tagging/naming'
import type { RuleLine, RuleMake, RuleOffer, RuleSaid, WouldLeave, WouldMove } from '../design/Rules'
import type { DraftRule, RuleDraftLine, RuleChangePlan, RuleDto, SkippedBooks, TagRow } from './api'
import { SKIP_SAID, plural } from './furniture'
import { labelOf } from './tagTree'

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
  const key = sameThing(query)

  /*
   * A tag the collection already means comes first and is found however it is
   * spelled. Matching the label alone missed exactly the case that matters:
   * "comic books" typed against a tag labelled "Comic Book" is not a substring
   * of anything, so the one tag they meant was not offered and the offer to
   * make a second one was. That is the two-spellings defect #377 exists to stop,
   * arriving through a rule instead of through a book, so the same fold answers
   * it here.
   */
  const means = (tag: TagRow) => key !== '' && sameThing(nameIn(tag.slug)) === key

  return vocabulary
    .filter((tag) => !on.has(tag.slug))
    .filter((tag) => typed === '' || tag.label.toLowerCase().includes(typed) || means(tag))
    .sort((a, b) => Number(means(b)) - Number(means(a)) || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((tag) => ({ tag: tag.label, books: tag.books }))
}

/**
 * The offer to make the word up, and the line under the box, for what has been
 * typed where a rule is written.
 *
 * **The decision is not made here.** `nameTag` decides what a collection makes
 * of a word, it is the same call the panel on a book makes, and it is where the
 * rule that two spellings are one tag lives with its tests. This turns its four
 * answers into a drawing.
 *
 * Only `new` earns an offer. `already` and `genre` both mean the tag to pick is
 * in the list above, because both of those words are in the vocabulary and
 * `offering` finds them; what is said instead is why nothing may be made, in the
 * words #377 already refuses in, because being refused without being told why
 * reads as the box being broken.
 *
 * The draft's own new words are part of the vocabulary it asks against, so a
 * word already named on this rule is not offered a second time.
 */
export function making(
  vocabulary: readonly TagRow[],
  query: string,
  drafted: readonly { tag: string; label?: string }[],
): { make: RuleMake | null; said: string; slug: string | null } {
  const known = [
    ...vocabulary.map((tag) => ({ slug: tag.slug, label: labelOf(tag) })),
    ...drafted
      .filter((line): line is { tag: string; label: string } => Boolean(line.label))
      .map((line) => ({ slug: line.tag, label: line.label })),
  ]
  const answer = nameTag(query, known)
  const under = labelOf(
    vocabulary.find((one) => one.slug === NAMED_UNDER.value)
    ?? { slug: NAMED_UNDER.value, label: '', note: '', books: 0 },
  )

  if (answer.kind === 'new') {
    return {
      make: { name: answer.label, where: under },
      /*
       * The slug travels beside the drawing rather than in it. A slug is an
       * identity and the design system draws none, which is a pinned rule;
       * what goes back to the server is this, and what a person reads is the
       * label above it.
       */
      slug: answer.slug,
      /*
       * Nothing, because the offer under the box says it in three words and
       * says where the word would go besides. Both were on screen together
       * until it was looked at, which is the fault #377 already names about
       * this exact sentence: a line contradicting or repeating the list under
       * it is worse than no line.
       */
      said: '',
    }
  }
  if (answer.kind === 'genre') {
    return {
      make: null,
      slug: null,
      said: 'Fiction and non-fiction are tags you already have. Ask for one of those.',
    }
  }
  if (answer.kind === 'already' && answer.nearly) {
    return {
      make: null,
      slug: null,
      said: 'That is the same word to this app as one you already keep, so there is '
        + 'one tag rather than two.',
    }
  }
  return { make: null, slug: null, said: '' }
}

/** The slug a label belongs to, which is how a pick becomes a line. */
export const slugFor = (vocabulary: readonly TagRow[], label: string): string | null =>
  vocabulary.find((tag) => tag.label === label)?.slug ?? null

/**
 * A rule's lines as a person reads them: the label, never the identity, and
 * whether anything carries the tag yet.
 *
 * The draft's own word comes first, because a word being named on this rule has
 * no row and so no label in the vocabulary until the write. Nothing carries it,
 * which is not a gap: a shelf prepared before the books arrive is waiting, and
 * the widget says so off this number.
 */
export const linesSaid = (
  vocabulary: readonly TagRow[],
  lines: readonly RuleDraftLine[],
): RuleLine[] =>
  lines.map((line) => {
    const known = vocabulary.find((tag) => tag.slug === line.tag)
    return {
      operator: line.operator,
      /*
       * The slug is the fallback and it is a bad one, so it is deliberately the
       * only one: a vocabulary that has not arrived yet is a moment, and a rule
       * drawn against a tag this app has never heard of and nobody named is a
       * bug worth seeing.
       */
      tag: line.label ?? known?.label ?? line.tag,
      carried: known?.books ?? 0,
    }
  })

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
 * Three facts qualify and all three are consequences somebody would otherwise
 * meet afterwards. **An area gaining its first rule stops taking overflow**,
 * because an area a rule points at is where a stretch of books begins; **a
 * stretch can be left with nothing anchoring it**, which is what taking the
 * genre line off the rule that serves fiction does; and **another place can
 * already be asking for these books**, which decides how many of them actually
 * come here. None is a refusal. They are his rules and his room, and the app's
 * job is to say so before rather than after.
 *
 * The third one is #430 item 1. Somebody wrote "anything tagged Non-fiction" on
 * a second piece of furniture, read "no book would have to be carried, 25 stay
 * exactly where they are", wrote it down, and was told "Nothing changed about
 * where the books belong". Every one of those sentences was true. What none of
 * them said was that seven non-fiction books were sitting on another bookcase
 * whose rule is tried first, which is the whole reason nothing moved.
 */
export function noteOf(plan: RuleChangePlan): string {
  const said: string[] = []

  /*
   * No rule at all, which is not the same answer as a rule nothing carries and
   * used to be given the same sentence. #391: somebody opened the editor on a
   * plank that files by overflow, added nothing, asked what would move and read
   * "No book in the collection carries all of these" about lines that did not
   * exist. Writing it down then answered "Nothing changed about where the books
   * belong", which was true, and read as the app losing their work.
   *
   * Said first and on its own, because everything below it is about a rule.
   */
  if (plan.names.length === 0 && plan.already === 0) {
    return 'There is no rule here to write. Nothing files here by rule now, nothing '
      + 'would afterwards, and writing it down would change nothing. Allow something '
      + 'here first.'
  }

  /*
   * The other empty draft, which is the opposite thing: taking the last rule off
   * a place. That is a real change and one worth a sentence, because what the
   * place then does is take overflow from the area before it.
   */
  if (plan.names.length === 0) {
    said.push('Nothing would file here by rule any more, so this area goes back to '
      + 'taking what overflows from the area before it.')
  }

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

  /*
   * Said last, because it is about a rule that is otherwise fine and the reader
   * has to have the rule in mind first. Never a refusal and never phrased as one:
   * two places asking for one tag is a thing the owner is allowed to want, and
   * what he cannot get anywhere else is which of them the books actually go to.
   */
  for (const other of plan.alsoClaims) {
    const both = plural(other.books, 'book')
    const it = other.books === 1 ? 'it' : 'they'

    if (other.keeps === other.books) {
      said.push(`${other.place} asks for the same ${both} and is tried first, `
        + `so ${it} ${other.books === 1 ? 'stays' : 'stay'} there.`)
    } else if (other.keeps === 0) {
      said.push(`${other.place} asks for the same ${both}, and this is tried first, `
        + `so ${it} ${other.books === 1 ? 'comes' : 'come'} here.`)
    } else {
      said.push(`${other.place} asks for the same ${both}, and ${other.keeps} of them `
        + 'stay there because its rule is tried first.')
    }
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

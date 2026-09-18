/**
 * The arithmetic and the wording behind writing a rule on a place. Pure
 * functions, no fetching and no React, for the reason `lib/furniture.ts` is.
 *
 * A rule's line is a slug and an operator. The label is what somebody reads and
 * never what travels, because a rule that stored a label would stop matching the
 * day the tag was renamed, so the screen holds slugs and looks the labels up, in
 * that direction only. See `docs/data-model.md`.
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
 * The tags worth offering for what has been typed. Matched anywhere in the label
 * rather than at the front, because "Second World War" is exactly the tag a
 * person looks for by its middle. A tag already on the rule is not offered,
 * because two identical lines are one line and the server collapses them.
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
   * spelled. Matching the label alone misses the case that matters: "comic books"
   * typed against a tag labelled "Comic Book" is not a substring of anything, so
   * the same fold that decides two spellings are one tag answers it here.
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
 * The decision is not made here: `nameTag` decides what a collection makes of a
 * word, and this turns its four answers into a drawing. Only `new` earns an
 * offer, because `already` and `genre` both mean the tag to pick is in the list
 * above; what is said instead is why nothing may be made. The draft's own new
 * words are part of the vocabulary it asks against, so a word already named on
 * this rule is not offered a second time.
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
    ?? { slug: NAMED_UNDER.value, label: '' },
  )

  if (answer.kind === 'new') {
    return {
      make: { name: answer.label, where: under },
      /*
       * The slug travels beside the drawing rather than in it: a slug is an
       * identity and the design system draws none. What goes back to the server
       * is this, and what a person reads is the label above it.
       */
      slug: answer.slug,
      /*
       * Nothing, because the offer under the box says it in three words and says
       * where the word would go besides. A line contradicting or repeating the
       * list under it is worse than no line.
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
 * A rule's lines as a person reads them: the label, never the identity. The
 * draft's own word comes first, because a word being named on this rule has no
 * row and so no label in the vocabulary until the write, and nothing carries it,
 * which is not a gap but a shelf prepared before the books arrive.
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
       * The slug is the fallback and it is a bad one, deliberately the only one:
       * a rule drawn against a tag this app has never heard of and nobody named
       * is a bug worth seeing.
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
 * One spelling of the sentence, in the domain, imported by the server and by
 * this, because a second spelling here is how a screen ends up promising a phrase
 * the answer disagrees with.
 */
export const draftHolds = (
  vocabulary: readonly TagRow[],
  rules: readonly DraftRule[],
): string => holdsSaid(rules.map((rule) => ({
  lines: linesSaid(vocabulary, rule.conditions),
  /*
   * The name is only ever reached for when a line quotes a tag with no label, and
   * a draft's rule has no name yet: it is worked out from the lines, on the
   * server, at the moment it is written.
   */
  name: 'this rule',
})))

/**
 * The moves a plan comes to, as pairs of places with counts. The biggest are
 * drawn and the rest are counted; the books themselves are named a screen later,
 * on the trip they belong to.
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
 * Every book the rules will not touch, with the reason beside it. Never silently
 * empty and never quietly folded into the headline: a change saying "84 books
 * move" having left three pinned ones out of the eighty-four would be believed.
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
 * Three facts qualify, and each is a consequence somebody would otherwise meet
 * afterwards: an area gaining its first rule stops taking overflow, because an
 * area a rule points at is where a stretch of books begins; a stretch can be left
 * with nothing anchoring it; and another place can already be asking for these
 * books, which decides how many of them actually come here. None is a refusal.
 */
export function noteOf(plan: RuleChangePlan): string {
  const said: string[] = []

  /*
   * No rule at all, which is not the same answer as a rule nothing carries. Said
   * first and on its own, because everything below it is about a rule.
   */
  if (plan.names.length === 0 && plan.already === 0) {
    return 'There is no rule here to write. Nothing files here by rule now, nothing '
      + 'would afterwards, and writing it down would change nothing. Allow something '
      + 'here first.'
  }

  /*
   * The other empty draft, which is the opposite thing: taking the last rule off
   * a place. A real change, because what the place then does is take overflow
   * from the area before it.
   */
  if (plan.names.length === 0) {
    said.push('Nothing would file here by rule any more, so this area goes back to '
      + 'taking what overflows from the area before it.')
  }

  /*
   * An area a rule points at does not only stop taking overflow: it begins a
   * stretch, and every area after it on the same piece carries on under it until
   * something else begins one. A note saying only the first half would be true
   * and would leave somebody surprised by the area next door.
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
   * two places asking for one tag is allowed, and what cannot be had anywhere
   * else is which of them the books actually go to.
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
 * What applying wrote, said as the two numbers that are not the same number:
 * `wrote` is rows of "the rules want this book here", while carrying is books
 * somebody has to pick up. A second apply of the same change writes nothing and
 * still leaves the same books to carry.
 */
export const wroteSaid = (wrote: number): string =>
  (wrote === 0
    ? 'Nothing changed about where the books belong.'
    : `${plural(wrote, 'book')} now ${wrote === 1 ? 'belongs' : 'belong'} somewhere else.`)

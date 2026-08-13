/**
 * Why a book is where it is: which rule claimed it, which ones lost, and what
 * would happen if the winner changed.
 *
 * ## The losers are the point
 *
 * A book that lands somewhere surprising is the moment the whole idea either
 * explains itself or turns into magic, and the explanation is always the same
 * two sentences: which rules asked for this book, and why that one beat this
 * one. So every rule whose conditions the book meets is here, in the order
 * `claim` tries them, each carrying the reason it won or did not.
 *
 * That order is `claim`'s and not a second opinion about it: area beats fixture,
 * then lower priority, then lower id. A screen sorting them itself would be a
 * second precedence rule, drawn beside the real one, agreeing until somebody
 * changed one of them.
 *
 * ## A book no rule claims is a real answer
 *
 * Since #304 a book can carry no genre tag at all: nothing states one, no tag is
 * written, and no rule matches it. `claim` answers null for such a book and this
 * answers an empty list, which is what lets a screen say so out loud. Guessing a
 * place for it would file it somewhere nobody asked for and report nothing,
 * which is the failure the null exists to prevent.
 *
 * ## Nothing here writes anything
 *
 * It reads the rules, the ledger and the vocabulary and folds them. Where the
 * rules want the book and where somebody last put it are two separate fields on
 * purpose: they disagree exactly when the book needs carrying, and that
 * disagreement is the carry list rather than something to reconcile here.
 *
 * **`pinned` beats every rule, forever**, so a pinned book says which rule would
 * otherwise have claimed it and that the pin wins anyway. Hiding the rule would
 * leave somebody unable to see what the pin is overruling.
 */

import { labelFor, type Slot } from '../domain/placement/geography'
import { standingOf } from '../domain/placement/ledger'
import { claim, matches, placementOf, type PlacementRule } from '../domain/placement/rules'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { furnitureIn, plankLabels } from '../infrastructure/shelving/areas'
import { describeRules, tagLabels, type DescribedRule, type Refused } from './furniture'
import type { Db } from './driver'

/** A rule that wanted this book, and whether it got it. */
export interface RuleClaim {
  rule: DescribedRule
  won: boolean
  /** Why it won, or why it did not. One sentence, in a person's words. */
  why: string
}

/** A place, as a screen names one: the row, and the label it reads under today. */
export interface AtAPlace {
  areaId: number
  label: string
}

export interface BookClaim {
  book: { id: number; title: string; authorFiling: string }
  /** Where somebody last said it is. Null when nobody ever has. */
  standing: AtAPlace | null
  /** Where the rules want it. Null when no rule claims it. */
  wanted: AtAPlace | null
  /** Every rule whose conditions this book meets, the winner first. */
  claims: RuleClaim[]
  /** The tags it carries, by the label a person reads and never by the slug. */
  tags: string[]
  /** A person put it here for good, which beats every rule below. */
  pinned: boolean
  checkedOut: boolean
  withdrawn: boolean
}

export type Claimed = { ok: true; claim: BookClaim } | Refused

interface BookRow {
  id: number
  title: string
  author_filing: string
  sort_key: string
}

/**
 * Whether a rule's conditions hold, **ignoring whether it is switched on**.
 *
 * A rule somebody has turned off still asks for a tag this book has, and a
 * screen that left it out would be answering "no rule wants this book" when the
 * truth is "one does and you turned it off". `matches` refuses a disabled rule,
 * which is right for placing a book and wrong for explaining one, so the
 * question is put to it with the switch flipped rather than reimplemented here.
 */
const wants = (rule: PlacementRule, tagSlugs: readonly string[]): boolean =>
  matches({ ...rule, enabled: true }, { tagSlugs })

/** `claim`'s order, so the list reads down the way the decision was made. */
const byPrecedence = (a: PlacementRule, b: PlacementRule): number =>
  Number(b.areaId !== null) - Number(a.areaId !== null)
  || a.priority - b.priority
  || a.id - b.id

const SMALLER_PLACE =
  'It fits too, but a rule about one area beats a rule about a whole piece of furniture.'

function whyItWent(rule: PlacementRule, won: PlacementRule | null): string {
  if (!rule.enabled) return 'It asks for a tag this book has, but it is turned off.'
  if (won && rule.id === won.id) {
    return rule.areaId !== null
      ? 'It asks for a tag this book has, and it is about one area.'
      : 'It asks for a tag this book has, and nothing about a smaller place does.'
  }
  if (won && won.areaId !== null && rule.areaId === null) return SMALLER_PLACE
  return 'It fits too, but the other one is tried first.'
}

const placeOf = (
  areaId: number | null,
  labels: ReadonlyMap<number, string>,
): AtAPlace | null =>
  (areaId === null ? null : { areaId, label: labels.get(areaId) ?? '' })

/**
 * Why this book is here. Writes nothing.
 *
 * Reached from the furniture screens and from the book page, which is why it is
 * one read rather than two: both want the same four facts, and a second one
 * written for the second screen is how the two start disagreeing about
 * precedence.
 */
export async function claimOfBook(db: Db, id: number): Promise<Claimed> {
  /*
   * `catalogued_books` rather than `books`, and it is the view that carries the
   * filing name: `books.author_filing` was dropped by #227 and the three views
   * join the first credit's alias back on. It is also the right set: a book
   * nobody has catalogued has no place for the rules to have an opinion about.
   */
  const book = await db.get<BookRow>(
    'SELECT id, title, author_filing, sort_key FROM catalogued_books WHERE id = ?',
    [id],
  )
  if (!book) return { ok: false, status: 404, error: 'No such book.' }

  const carried = await db.all<{ slug: string; label: string }>(
    `SELECT t.slug, t.label
       FROM book_tag bt
       JOIN tag t ON t.id = bt.tag_id
      WHERE bt.book_id = ?
      ORDER BY t.slug`,
    [id],
  )

  const tagSlugs = carried.map((row) => row.slug)
  const { order, rules } = await furnitureIn(db)
  const labels = await plankLabels(db)
  const described = describeRules(order, rules, await tagLabels(db))

  const rows = await new DrizzlePlacementLedger(db).forBooks([Number(book.id)])
  const standing = standingOf(rows)

  const won = claim(rules, { tagSlugs })
  const found = placementOf({ tagSlugs, sortKey: book.sort_key ?? '' }, rules, order as Slot[])

  const claims: RuleClaim[] = rules
    .filter((rule) => wants(rule, tagSlugs))
    .sort(byPrecedence)
    .flatMap((rule) => {
      const one = described.get(rule.id)
      return one ? [{ rule: one, won: won !== null && rule.id === won.id, why: whyItWent(rule, won) }] : []
    })

  return {
    ok: true,
    claim: {
      book: {
        id: Number(book.id),
        title: book.title,
        authorFiling: book.author_filing ?? '',
      },
      standing: placeOf(standing.area, labels),
      wanted: found ? { areaId: found.slot.area.id, label: labelFor(found.slot) } : null,
      claims,
      tags: carried.map((row) => row.label),
      pinned: standing.pinned,
      checkedOut: standing.checkedOut,
      withdrawn: standing.withdrawn,
    },
  }
}

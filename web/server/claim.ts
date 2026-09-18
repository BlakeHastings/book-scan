/**
 * Why a book is where it is: which rule claimed it, which ones lost, and what
 * would happen if the winner changed.
 *
 * Every rule whose conditions the book meets is listed, in the order `claim`
 * tries them, each carrying the reason it won or did not.
 *
 * Where the rules want the book and where somebody last put it are separate
 * fields on purpose: they disagree exactly when the book needs carrying, and
 * that disagreement is the carry list rather than something reconciled here.
 */

import { WITHDRAWN } from '../domain/books/state'
import { labelFor, type Slot } from '../domain/placement/geography'
import { standingOf } from '../domain/placement/ledger'
import {
  byPrecedence, claim, matches, placementOf, type PlacementRule,
} from '../domain/placement/rules'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { furnitureIn, plankLabels } from '../infrastructure/shelving/areas'
import {
  describeRules, tagCarried, tagLabels, type DescribedRule, type Refused,
} from './furniture'
import type { Db } from './driver'

/** A rule that wanted this book, and whether it got it. */
export interface RuleClaim {
  rule: DescribedRule
  won: boolean
  /** Why it won, or why it did not. One sentence, in a person's words. */
  why: string
}

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
  /** A person put it here for good; pinning beats every rule. */
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
 * Whether a rule's conditions hold, ignoring whether it is switched on. A
 * disabled rule that still matches this book needs to say so, so the switch is
 * forced on rather than reimplementing `matches` here.
 */
const wants = (rule: PlacementRule, tagSlugs: readonly string[]): boolean =>
  matches({ ...rule, enabled: true }, { tagSlugs })

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

/** Why this book is here. Writes nothing. */
export async function claimOfBook(db: Db, id: number): Promise<Claimed> {
  /*
   * Reads `catalogued_books`, the view with the filing name joined on, not
   * `books`. A book that has not been catalogued has no place for the rules to
   * have an opinion about.
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
  const described = describeRules(order, rules, await tagLabels(db), await tagCarried(db))

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

/**
 * Why no rule claims this book: two different states.
 *
 * `untagged`: it carries no tag at all, so every rule fails at its first
 * condition. `unmatched`: it carries tags and no rule asks for them.
 *
 * A rule that is switched off does not put a book here by itself: unlike
 * `claimOfBook`, which deliberately ignores the switch when explaining one
 * book, this asks which books nothing files today, and an off rule files
 * nothing today.
 */
export type Unclaimed = 'untagged' | 'unmatched'

export interface UnclaimedBook {
  id: number
  title: string
  authorFiling: string
  /** Where somebody last said it stands. Null when nobody ever has. */
  standing: AtAPlace | null
  /** What it carries, by the label a person reads. Empty when `untagged`. */
  tags: string[]
  why: Unclaimed
}

interface UnclaimedRow {
  id: number
  title: string
  author_filing: string
  current_area_id: number | null
  slugs: string[] | null
  labels: string[] | null
}

/**
 * Every book in the collection that no rule claims, in the order they stand.
 *
 * There is no SQL negation for "no rule claims it", so the tags come back
 * beside each book in one pass and the fold is put to `claim`, the same
 * function the placement itself uses, rather than a second precedence rule
 * drifting in SQL.
 *
 * Reads `catalogued_books`, so a book still in the queue (no name or place yet)
 * is excluded, along with withdrawn books, which no rule places by design.
 *
 * Unbounded, like `areaDisagreements`: the caller decides how many to show.
 */
export async function booksNoRuleClaims(db: Db): Promise<UnclaimedBook[]> {
  const rows = await db.all<UnclaimedRow>(
    `SELECT b.id, b.title, b.author_filing, b.current_area_id,
            array_remove(array_agg(t.slug), NULL) AS slugs,
            array_remove(array_agg(t.label), NULL) AS labels
       FROM catalogued_books b
       LEFT JOIN book_tag bt ON bt.book_id = b.id
       LEFT JOIN tag t ON t.id = bt.tag_id
      WHERE b."state" != ?
      GROUP BY b.id, b.title, b.author_filing, b.current_area_id, b.sort_key
      ORDER BY b.sort_key`,
    [WITHDRAWN],
  )

  const { rules } = await furnitureIn(db)
  const labels = await plankLabels(db)

  return rows
    .filter((row) => claim(rules, { tagSlugs: row.slugs ?? [] }) === null)
    .map((row) => ({
      id: Number(row.id),
      title: row.title,
      authorFiling: row.author_filing ?? '',
      standing: placeOf(row.current_area_id === null ? null : Number(row.current_area_id), labels),
      tags: row.labels ?? [],
      why: (row.slugs ?? []).length === 0 ? 'untagged' : 'unmatched',
    }))
}

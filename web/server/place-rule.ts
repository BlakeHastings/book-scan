/**
 * Changing what a place allows: plan it, then apply it.
 *
 * Plan computes and writes nothing. Apply writes the rule and then the `assigned`
 * rows the rules want, only where the answer differs from where the book already
 * is. The rule being changed is a draft on the screen until the apply, which is
 * what makes a half-built rule safe, and it is why creating a rule and editing
 * one are the same call.
 *
 * The plan is over the whole catalogue rather than one stretch, because narrowing
 * an area pushes books out of it to wherever else claims them and widening one
 * pulls books in from anywhere in the room.
 *
 * Nothing here moves a book. Applying records an intention, and the books move
 * when a person carries them and says so through
 * `PATCH /api/books/:id/location`.
 */

import {
  furnitureIn, plankLabels, ruleForRange,
} from '../infrastructure/shelving/areas'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import type { Slot } from '../domain/placement/geography'
import { planPlacements, type PlacementPlan, type PlannableBook } from '../domain/placement/plan'
import {
  claim, entryAreaOf, matches, RULE_OPERATORS,
  type PlacementRule, type RuleCondition, type RuleOperator,
} from '../domain/placement/rules'
import { GENRE_RANGES } from '../domain/tagging/genre'
import { NAMED_UNDER, nameTag, type KnownTag } from '../domain/tagging/naming'
import { TagSlug } from '../domain/tagging/tags'
import {
  AssignPlacementsHandler, type AssignableBook, type AssignmentReport,
} from '../application/placement/assign-placements'
import type { Db } from './driver'
import { FURNITURE_LOCK, holdsSaid, placeSaid, ruleName, tagLabels } from './furniture'
import { refuse, type Refused } from './refusal'

export interface DraftRule {
  /** The row this already is, or null for one nobody has written yet. */
  id: number | null
  conditions: DraftLine[]
}

/**
 * One line of a draft: what it asks, of which tag, and the tag's own name where
 * the collection has not got it yet.
 *
 * `label` is only ever set for a word nobody has used. A line quoting a tag the
 * collection already keeps carries no label at all, because the label is on the
 * row and reading it off the request would let a rename arrive by the back door.
 * The word becomes a tag at the same press the rule becomes a row, so a draft
 * nobody applies leaves nothing behind.
 */
export interface DraftLine {
  operator: RuleOperator
  /**
   * A tag slug, which is the identity a rule references. A rule stored against a
   * label would stop matching the day somebody renamed the tag.
   */
  tag: string
  /** What to call it, for a slug the vocabulary has not got. */
  label?: string
}

/**
 * Every rule written on one place, which is the unit that is planned and
 * written.
 *
 * A list, because a list is how this app says "or". "And" is another line on one
 * rule, and all of a rule's lines must hold; "or" is another rule on the same
 * place, both pointing at the same area. `claim` picks one winner among the rules
 * that match a book, and when the candidates all name the same place it does not
 * matter which it picks: the book lands in the same slot and all that changes is
 * which rule's name is written as the reason.
 *
 * The whole set travels together because it is one answer to one question. A
 * request that added a rule without saying what the others were could not tell
 * a rule somebody deleted from one this request has not heard of.
 */
export interface RuleDraft {
  about: 'area' | 'fixture'
  placeId: number
  rules: DraftRule[]
}

/**
 * What changing a place's rule would do. `PlacementPlan` is the same shape the
 * run move answers with, so the screens that already read one need nothing new.
 */
export interface RuleChangePlan extends PlacementPlan {
  /** The phrase the place would hold, every rule on it joined by "or". */
  holds: string
  /** What each rule would be called, worked out from its own lines. */
  names: string[]
  /**
   * How many rules are written on this place today, beside `names`, which is how
   * many there would be. The two together tell an empty draft on a place with a
   * rule (taking the last one off, a real change) from an empty draft on a place
   * with none (not a change at all).
   */
  already: number
  /** How many books in the whole catalogue any of these rules claim. */
  claiming: number
  /**
   * True where the place has no rule today and would gain one. An area a rule
   * points at is where a stretch of books begins, so giving one a rule stops it
   * taking what overflows from the area before it.
   */
  opens: boolean
  /**
   * The two stretches of books that would be left with no rule anchoring them.
   * Taking the genre line off the rule that serves fiction is allowed, and it
   * leaves the library with nothing saying where fiction begins.
   */
  losing: string[]
  /**
   * The other places whose rules ask for books these rules also ask for. Two
   * places wanting the same books is allowed and this does not make it an error.
   *
   * `keeps` is which way the tie went. `claim` settles it by area rules before
   * piece rules, then priority, then id, and neither answer is a warning: keeping
   * means this draft changes nothing for those books, and losing means the other
   * place is about to hand them over.
   */
  alsoClaims: AlsoClaims[]
}

export interface AlsoClaims {
  /** What that place reads as: a plank for an area rule, a piece for a fixture. */
  place: string
  /** How many books both places ask for. */
  books: number
  /**
   * How many of those that place keeps, because its rule is the one `claim` tries
   * first. A count rather than a flag: a third rule can win some of them, so "all
   * of them" and "none of them" are not the only honest answers.
   */
  keeps: number
}

export type PlannedRuleChange = { ok: true; plan: RuleChangePlan } | Refused

export type AppliedRuleChange =
  | { ok: true; plan: RuleChangePlan; wrote: AssignmentReport }
  | Refused

/**
 * The rules on one place, in the shape they go back in, and the one read in this
 * app that speaks slugs. Every other read answers a rule in labels and nothing
 * but labels, which `furniture.routes.test.ts` holds to by refusing `genre/` in
 * the whole of `/api/fixtures` and of `/api/books/:id/claim`.
 */
export async function rulesOnPlace(
  db: Db,
  about: 'area' | 'fixture',
  placeId: number,
): Promise<DraftRule[]> {
  const { rules } = await furnitureIn(db)
  return rulesOn(rules, { about, placeId, rules: [] }).map((rule) => ({
    id: rule.id,
    conditions: rule.conditions.map((line) => ({ operator: line.operator, tag: line.value })),
  }))
}

/**
 * What the collection makes of a word a rule wants to name, or the refusal.
 *
 * The whole of the decision is `nameTag`. The slug is checked against its answer
 * rather than taken from the request, so a client cannot ask for a word under one
 * heading and have it written under another, and cannot slip a second spelling
 * past the fold by spelling the slug itself.
 */
function naming(
  typed: string,
  slug: TagSlug,
  vocabulary: readonly KnownTag[],
): { ok: true; label: string } | Refused {
  const label = typed.trim()
  if (!label) {
    return refuse(400, 'A rule asks for a tag you have, or for a word you name here.')
  }

  const answer = nameTag(label, vocabulary)
  if (answer.kind === 'nothing') {
    return refuse(400, `"${label}" is not a word this app can make a tag of.`)
  }
  if (answer.kind === 'genre') {
    return refuse(400, 'Fiction and non-fiction are tags you already have, so a rule '
      + 'asks for one of those rather than making a second pair.')
  }
  if (answer.kind === 'already') {
    return refuse(400, 'That is the same word to this app as one you already keep, so '
      + 'there is one tag rather than two. Ask for that one instead.')
  }
  if (answer.slug !== slug.value) {
    return refuse(400, `A tag named here is written under ${NAMED_UNDER.value}, `
      + 'and that is not where this one was asked for.')
  }

  return { ok: true, label: answer.label }
}

/**
 * The draft a request describes, or the refusal a malformed one earns.
 *
 * Every line is checked against the vocabulary rather than only against the
 * shape of a slug, because a rule quoting a slug nothing defines is a rule no
 * screen can read back: the label lives on the tag row, and a line with no row
 * behind it draws as the rule's own name instead of as the word somebody chose.
 *
 * A line may name a word nobody has used and carry the label to call it by. The
 * label is not taken on trust: it goes back through `nameTag` against the
 * vocabulary as it stands, and the only answer accepted is the one that says this
 * is genuinely a new word and agrees with the slug asked for. Nothing is written
 * here, and the tag becomes a row at the same moment the rule does, in
 * `applyRuleChange`.
 *
 * Two identical lines collapse into one.
 */
export async function draftFrom(
  db: Db,
  body: Record<string, unknown>,
): Promise<{ ok: true; draft: RuleDraft } | Refused> {
  const about = body.about
  if (about !== 'area' && about !== 'fixture') {
    return refuse(400, 'A rule is about one area or one piece of furniture.')
  }

  const placeId = Number(body.placeId)
  if (!Number.isInteger(placeId) || placeId <= 0) {
    return refuse(404, 'No such place.')
  }

  const raw = body.rules
  if (!Array.isArray(raw)) {
    return refuse(400, 'A place holds a list of rules, and it may be empty.')
  }

  const vocabulary: KnownTag[] = (await new DrizzleTagRepository(db).vocabulary())
    .map((tag) => ({ slug: tag.slug.value, label: tag.label }))
  const known = new Set(vocabulary.map((tag) => tag.slug))

  const rules: DraftRule[] = []
  for (const asked of raw as Record<string, unknown>[]) {
    const id = asked?.id === null || asked?.id === undefined ? null : Number(asked.id)
    if (id !== null && (!Number.isInteger(id) || id <= 0)) {
      return refuse(404, 'No such rule.')
    }

    const lines = asked?.conditions
    if (!Array.isArray(lines)) {
      return refuse(400, 'A rule is a list of lines, and it may be empty.')
    }

    const conditions: DraftLine[] = []
    for (const one of lines as Record<string, unknown>[]) {
      const operator = String(one?.operator ?? '') as RuleOperator
      if (!RULE_OPERATORS.includes(operator)) {
        return refuse(400, 'A line asks for a tag exactly, or for anything under it.')
      }

      const slug = TagSlug.parse(String(one?.tag ?? ''))
      if (!slug) return refuse(400, 'A rule asks for a tag, and that is not one.')

      let label: string | undefined
      if (!known.has(slug.value)) {
        const named = naming(String(one?.label ?? ''), slug, vocabulary)
        if (!named.ok) return named
        label = named.label
      }

      const already = conditions.some((line) =>
        line.operator === operator && line.tag === slug.value)
      if (!already) conditions.push({ operator, tag: slug.value, ...(label ? { label } : {}) })
    }

    rules.push({ id, conditions })
  }

  return { ok: true, draft: { about, placeId, rules } }
}

/** The rules already written on this place, the smaller-place order first. */
const rulesOn = (rules: readonly PlacementRule[], draft: RuleDraft): PlacementRule[] =>
  rules.filter((rule) => (draft.about === 'area'
    ? rule.areaId === draft.placeId
    : rule.fixtureId === draft.placeId))

const asConditions = (rule: DraftRule): RuleCondition[] =>
  rule.conditions.map((line) => ({ field: 'tag', operator: line.operator, value: line.tag }))

/**
 * A whole list of rules with this place's set replaced by the draft's.
 *
 * The id of a rule that does not exist yet is one past the highest, and does not
 * have to match what Postgres will hand out: within one planning run an id only
 * settles ties between rules that both claim a book, and two rules on one place
 * resolve to the same area whichever wins. The apply reads the real ids back
 * after it writes.
 *
 * A draft naming an id that is not on this place is ignored rather than obeyed,
 * because obeying it would let a request written about one area rewrite the rule
 * of another.
 */
function prospective(
  rules: readonly PlacementRule[],
  draft: RuleDraft,
  names: readonly string[],
): PlacementRule[] {
  const existing = new Map(rulesOn(rules, draft).map((rule) => [rule.id, rule]))
  let next = rules.reduce((most, rule) => Math.max(most, rule.id), 0)
  const priority = rules.reduce((most, rule) => Math.max(most, rule.priority), 0)

  const written = draft.rules.map((one, at): PlacementRule => {
    const was = one.id === null ? undefined : existing.get(one.id)
    if (was) return { ...was, name: names[at]!, conditions: asConditions(one) }

    next += 1
    return {
      id: next,
      areaId: draft.about === 'area' ? draft.placeId : null,
      fixtureId: draft.about === 'fixture' ? draft.placeId : null,
      /*
       * Last of the level it is on. Priority settles a tie between two rules
       * about places of the same size, and a new rule has no claim to be tried
       * before one somebody already relies on.
       */
      priority: priority + at + 1,
      name: names[at]!,
      enabled: true,
      conditions: asConditions(one),
    }
  })

  return [...rules.filter((rule) => !existing.has(rule.id)), ...written]
}

/** Every catalogued book with the tags a rule claims it by. */
async function everyBook(db: Db): Promise<PlannableBook[]> {
  const rows = await db.all<{
    id: number
    title: string
    author_filing: string
    sort_key: string
    slugs: string[] | null
  }>(
    `SELECT b.id, b.title, b.author_filing, b.sort_key,
            array_remove(array_agg(t.slug), NULL) AS slugs
       FROM catalogued_books b
       LEFT JOIN book_tag bt ON bt.book_id = b.id
       LEFT JOIN tag t ON t.id = bt.tag_id
      GROUP BY b.id, b.title, b.author_filing, b.sort_key
      ORDER BY b.sort_key`,
  )

  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    authorFiling: row.author_filing,
    sortKey: row.sort_key,
    tagSlugs: row.slugs ?? [],
  }))
}

/**
 * What changing this place's rule would mean. Writes nothing at all, and it is
 * what the apply calls before it writes, so what somebody approves and what gets
 * recorded are one function rather than two that have to be kept agreeing.
 */
export async function planRuleChange(db: Db, draft: RuleDraft): Promise<PlannedRuleChange> {
  const { order, rules } = await furnitureIn(db)

  const stands = draft.about === 'area'
    ? order.some((slot) => slot.area.id === draft.placeId)
    : order.some((slot) => slot.fixture.id === draft.placeId)
  if (!stands) return refuse(404, 'No such place.')

  const labels = await tagLabels(db)
  /*
   * A word this draft is naming has no row yet, so the vocabulary has no label
   * for it and every sentence about the rule would fall back to the rule's own
   * name. The phrase is built from the draft's own word instead, and reads the
   * same before the write as after it. Nothing is written here.
   */
  for (const rule of draft.rules) {
    for (const line of rule.conditions) {
      if (line.label && !labels.has(line.tag)) labels.set(line.tag, line.label)
    }
  }

  const names = draft.rules.map((one) => ruleName(one.conditions.map((line) => ({
    operator: line.operator,
    tag: labels.get(line.tag) ?? '',
  }))))
  const wanted = prospective(rules, draft, names)
  const written = rulesOn(wanted, draft)

  const books = await everyBook(db)
  const ledger = await new DrizzlePlacementLedger(db).forBooks(books.map((book) => book.id))

  /*
   * An area with no rule today takes what overflows from the one before it, and
   * one a rule points at does not. So this is asked of the arrangement as it
   * stands rather than of the one being proposed: it is true exactly when the
   * place is gaining its first rule.
   */
  const opens = draft.about === 'area'
    && rulesOn(rules, draft).length === 0
    && written.some((rule) => entryAreaOf(rule, order) !== null)

  return {
    ok: true,
    plan: {
      ...planPlacements(books, ledger, wanted, order, await plankLabels(db)),
      alsoClaims: alsoClaiming(books, wanted, written, order),
      holds: holdsSaid(written, labels),
      names,
      already: rulesOn(rules, draft).length,
      claiming: books.filter((book) => written.some((rule) => matches(rule, book))).length,
      opens,
      losing: GENRE_RANGES
        .filter(({ range }) =>
          ruleForRange(rules as PlacementRule[], range) !== null
          && ruleForRange(wanted, range) === null)
        .map(({ range }) => range),
    },
  }
}

/**
 * The other places that ask for books this draft asks for, and how the tie went.
 *
 * `claim` is asked rather than reimplemented, over the same prospective list the
 * plan is built from, so who wins here is who wins in the carry list. Keyed on
 * which place it is rather than on what it reads as, because two places really
 * can read alike.
 */
function alsoClaiming(
  books: readonly PlannableBook[],
  wanted: readonly PlacementRule[],
  written: readonly PlacementRule[],
  order: Slot[],
): AlsoClaims[] {
  const mine = new Set(written.map((rule) => rule.id))
  const others = wanted.filter((rule) => !mine.has(rule.id))
  const found = new Map<string, AlsoClaims>()

  for (const book of books) {
    if (!written.some((rule) => matches(rule, book))) continue
    const won = claim(wanted as PlacementRule[], book)

    for (const other of others) {
      if (!matches(other, book)) continue
      const where = `${other.areaId === null ? 'fixture' : 'area'}:${other.areaId ?? other.fixtureId}`
      const row = found.get(where)
        ?? { place: placeSaid(other, order), books: 0, keeps: 0 }
      row.books += 1
      if (won?.id === other.id) row.keeps += 1
      found.set(where, row)
    }
  }

  // A rule whose furniture is not standing has no name to print.
  return [...found.values()].filter((one) => one.place !== '')
}

/**
 * Write the rule, and record where the rules now want every book.
 *
 * One transaction, serialised on the furniture, because between writing the
 * lines and running the assignments the collection is describable by half a
 * change, and a save landing in that window would file a book by a rule nobody
 * finished writing.
 *
 * Safe to call twice: the second call writes the same lines and finds every book
 * already assigned where the rules want it, so `assignmentFor` writes nothing.
 */
export async function applyRuleChange(
  db: Db,
  draft: RuleDraft,
  now: string,
): Promise<AppliedRuleChange> {
  return db.tx(async (tx) => {
    /*
     * The words this draft names, written before anything reads the vocabulary
     * again, so the plan below and every read afterwards sees one tag rather
     * than a slug with nothing behind it. `define` is `ON CONFLICT DO NOTHING`
     * and then a read, so applying the same change twice writes one row and
     * never rewrites somebody's label. It runs inside the transaction that
     * writes the rule, so a rule that fails to write leaves no word behind.
     */
    const tags = new DrizzleTagRepository(tx)
    for (const rule of draft.rules) {
      for (const line of rule.conditions) {
        if (!line.label) continue
        const slug = TagSlug.parse(line.tag)
        if (slug) await tags.define(slug, line.label)
      }
    }

    const planned = await planRuleChange(tx, draft)
    if (!planned.ok) return planned

    const { rules } = await furnitureIn(tx)
    const existing = new Map(rulesOn(rules, draft).map((rule) => [rule.id, rule]))
    const priority = rules.reduce((most, rule) => Math.max(most, rule.priority), 0)
    const kept = new Set<number>()

    for (const [at, one] of draft.rules.entries()) {
      const was = one.id === null ? undefined : existing.get(one.id)
      let ruleId: number

      if (was) {
        await tx.run('UPDATE placement_rule SET name = ? WHERE id = ?', [planned.plan.names[at]!, was.id])
        ruleId = was.id
      } else {
        const [row] = await tx.all<{ id: number }>(
          `INSERT INTO placement_rule (area_id, fixture_id, priority, name, enabled)
           VALUES (?, ?, ?, ?, TRUE) RETURNING id`,
          [
            draft.about === 'area' ? draft.placeId : null,
            draft.about === 'fixture' ? draft.placeId : null,
            priority + at + 1,
            planned.plan.names[at]!,
          ],
        )
        ruleId = Number(row!.id)
      }
      kept.add(ruleId)

      /*
       * Replaced rather than reconciled. A rule's lines are a set and the order
       * they were written in means nothing: the whole list arrives together and
       * the whole list is what the rule now asks.
       */
      await tx.run('DELETE FROM rule_condition WHERE rule_id = ?', [ruleId])
      for (const line of one.conditions) {
        await tx.run(
          'INSERT INTO rule_condition (rule_id, field, operator, value) VALUES (?, ?, ?, ?)',
          [ruleId, 'tag', line.operator, line.tag],
        )
      }
    }

    /*
     * A rule taken off the place goes, rather than being left switched off where
     * nobody can see it.
     *
     * `book_placement.rule_id` is `ON DELETE RESTRICT`, so the reference is let
     * go first. That loses a join and not an answer: `reason` on the same row
     * already carries the rule's name as it stood when the assignment was made,
     * and the live answer to "why is this book here" is recomputed from the rules
     * as they are now (`server/claim.ts`) rather than read out of the ledger.
     * What the constraint is really protecting is `area_id`, and that is
     * untouched.
     */
    for (const rule of existing.values()) {
      if (kept.has(rule.id)) continue
      await tx.run('UPDATE book_placement SET rule_id = NULL WHERE rule_id = ?', [rule.id])
      await tx.run('DELETE FROM placement_rule WHERE id = ?', [rule.id])
    }

    const { order, rules: after } = await furnitureIn(tx)
    const books = await everyBook(tx)
    const assignable: AssignableBook[] = books.map((book) => ({
      id: book.id,
      sortKey: book.sortKey,
      tagSlugs: book.tagSlugs,
    }))

    const wrote = await new AssignPlacementsHandler(new DrizzlePlacementLedger(tx)).handle({
      books: assignable,
      rules: after,
      order,
      actor: 'rules',
      now,
    })

    return { ok: true, plan: planned.plan, wrote }
  }, { serialiseOn: FURNITURE_LOCK })
}

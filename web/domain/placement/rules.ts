/**
 * Rules claim books, and a claim is what decides where a book goes.
 *
 * This is the inversion. Today there is one global order carved into areas by
 * boundaries, and which of the two orders a book joins is decided by a column,
 * `books.is_fiction`, that only ever had room for one question. Here a rule
 * claims a book and points it at a place, and fiction and non-fiction stop being
 * built in: they are two rules like any other, and a third question about the
 * same books is a third rule rather than a third column.
 *
 * ## All conditions must hold, and there is no `OR`
 *
 * No nesting and no alternation. Two ways of saying a thing are two rules, which
 * a screen can build and a person can read down when a book lands somewhere
 * surprising. A boolean tree is unreadable at exactly the moment somebody needs
 * to read it.
 *
 * A rule with no conditions claims nothing, rather than claiming everything.
 * "All of no conditions hold" is true, and a rule somebody half built would
 * otherwise take the whole catalogue on the strength of an empty list.
 *
 * ## `is` and `under` are different questions
 *
 * `tag is genre/fantasy` and `tag under genre` ask different things, so both are
 * operators. `under` is strictly beneath, and it is answered of the slug's path
 * rather than of a parent row: a book may carry `genre/fantasy` in a vocabulary
 * that has never heard of `genre` and `under genre` still finds it. That is
 * `TagSlug.isUnder`, and it is not reimplemented here.
 *
 * ## What a rule points at
 *
 * Exactly one of an area or a fixture, and the two are not the same kind of
 * answer. An **area** rule names one place. A **fixture** rule names the first
 * area of that fixture and lets the run flow on through the areas after it,
 * which is what a range does today: fiction begins on bookcase 1 and continues
 * across bookcases 2 and 3 until non-fiction's own entry point on bookcase 4.
 * So a fixture rule is how a run that spans furniture is said.
 *
 * Area beats fixture, because it is the more specific statement, and `priority`
 * settles ties within a level. **Lower priority is tried first**, the way a
 * numbered list is read: rule 1, then rule 2. Which matters exactly when two
 * rules both claim a book, and that is a real case rather than a hypothetical
 * one, because a book corrected before #201 can still carry two `genre` tags.
 * See `docs/data-model.md`, "One repair the cut-over owes".
 */

import { TagSlug } from '../tagging/tags'
import { areaFor, runFrom, startsARun, type Slot } from './geography'

/** What a condition can ask about. One today, and the column it replaces held one. */
export const RULE_FIELDS = ['tag'] as const
export type RuleField = typeof RULE_FIELDS[number]

export const RULE_OPERATORS = ['is', 'under'] as const
export type RuleOperator = typeof RULE_OPERATORS[number]

export interface RuleCondition {
  field: RuleField
  operator: RuleOperator
  /** A tag slug, which is the identity a rule references and never a label. */
  value: string
}

export interface PlacementRule {
  id: number
  /** Exactly one of these two is set. The database check constraint is the guard. */
  areaId: number | null
  fixtureId: number | null
  /** Lower is tried first. */
  priority: number
  name: string
  enabled: boolean
  conditions: RuleCondition[]
}

/** What a rule needs to know about a book in order to claim it. */
export interface Claimable {
  tagSlugs: readonly string[]
}

function holds(condition: RuleCondition, book: Claimable): boolean {
  const wanted = TagSlug.parse(condition.value)
  if (!wanted) return false

  return book.tagSlugs.some((raw) => {
    const carried = TagSlug.parse(raw)
    if (!carried) return false
    return condition.operator === 'is'
      ? carried.equals(wanted)
      : carried.isUnder(wanted)
  })
}

export function matches(rule: PlacementRule, book: Claimable): boolean {
  if (!rule.enabled || !rule.conditions.length) return false
  return rule.conditions.every((condition) => holds(condition, book))
}

/**
 * Which of two rules is tried first: area before fixture, then priority, then
 * id. **The one precedence in this app**, and every place that has to pick one
 * rule out of several sorts by this.
 *
 * It was written out four times before #463: here inside `claim`, again in
 * `server/claim.ts` to list the losers in the order the winner was chosen, again
 * in `server/furniture.ts` to say which rule a plank reads under, and not at all
 * in `bandsOf` and `ruleForRange`, which took whichever rule the database handed
 * back first. Three copies of one ladder agreed by inspection and the fourth
 * site did not agree at all, which is #463: with two rules naming one genre,
 * `claim` filed a book by the area rule and `bandsOf` drew the run from the
 * fixture rule, and the app answered "where does fiction begin" twice.
 *
 * A comparator rather than a sorted list, because the callers are sorting
 * different sets: every rule that claims a book, every rule written on one
 * plank, every rule naming one genre.
 */
export const byPrecedence = (a: PlacementRule, b: PlacementRule): number =>
  Number(b.areaId !== null) - Number(a.areaId !== null)
  || a.priority - b.priority
  || a.id - b.id

/**
 * The rule that claims this book, or null when none does.
 *
 * Null is a real answer and not a gap to be papered over: a book no rule claims
 * has nowhere the rules can put it, and saying so is how the person who wrote
 * the rules finds out. Guessing a place would file a book somewhere nobody asked
 * for and report nothing.
 */
export function claim(rules: PlacementRule[], book: Claimable): PlacementRule | null {
  const claimants = rules.filter((rule) => matches(rule, book))
  if (!claimants.length) return null

  return claimants.sort(byPrecedence)[0]!
}

/**
 * The area a rule points at, whether it named the area or the fixture holding
 * it.
 *
 * A fixture rule resolves to that fixture's first area, which is the one the
 * run begins in.
 */
export function entryAreaOf(rule: PlacementRule, order: Slot[]): number | null {
  if (rule.areaId !== null) {
    return order.some((slot) => slot.area.id === rule.areaId) ? rule.areaId : null
  }
  return order.find((slot) => slot.fixture.id === rule.fixtureId)?.area.id ?? null
}

/**
 * Every area a rule points at, which is where the sequence of areas is cut into
 * runs.
 *
 * Disabled rules are in here on purpose. Turning a rule off stops it claiming
 * books; it does not merge the run it opened into the one before it, which would
 * silently reorder and re-cut every area after it. A run that nothing claims is
 * an empty run, which is a shelf with nothing on it.
 */
export function entryAreas(rules: PlacementRule[], order: Slot[]): Set<number> {
  const entries = new Set<number>()
  for (const rule of rules) {
    const areaId = entryAreaOf(rule, order)
    if (areaId !== null) entries.add(areaId)
  }
  return entries
}

/**
 * Where a book goes: the rule that claims it, the run that rule opens, and the
 * area in that run its sort key reaches.
 *
 * The whole of the new model in three steps, and the thing
 * `infrastructure/db/placement-backfill.test.ts` runs against every book in a
 * seeded catalogue to check it lands exactly where the separators put it.
 */
export function placementOf(
  book: Claimable & { sortKey: string },
  rules: PlacementRule[],
  order: Slot[],
): { rule: PlacementRule; slot: Slot } | null {
  const rule = claim(rules, book)
  if (!rule) return null

  const entry = entryAreaOf(rule, order)
  if (entry === null) return null

  const slot = areaFor(runFrom(order, entry, entryAreas(rules, order)), book.sortKey)
  return slot ? { rule, slot } : null
}

/**
 * The first piece of furniture past `from` that another run begins on.
 *
 * **A run stops where the next run begins, and "the next run" is any rule's, not
 * only the other genre's.** `runFrom` says exactly that already, area by area,
 * through `entryAreas`. This is the same sentence read a piece at a time, for
 * the two callers that have to decide which *furniture* a run owns rather than
 * which planks it flows through: the band a range is reconciled over
 * (`bandsOf`) and the stretch a move is allowed to pick up (`relocateRun`).
 *
 * **It asks `startsARun` rather than `entries` alone, and #499 is the
 * difference.** A rule is not the only thing that opens a run: an area given an
 * ordering of its own is self-contained, takes no overflow, and heads its own
 * run, which is what the dialog on "Change how this shelf is ordered" says out
 * loud before anybody agrees to it. `runFrom` has always cut there. This read
 * did not, so a bookcase whose middle plank somebody had set to order by title
 * was a piece two runs stood on that a move would take whole — the #420 state
 * exactly, reached by a different button.
 *
 * **Piece granularity is the point**, and #420 is what its absence cost. A rule
 * somebody wrote on the bottom shelf of a bookcase they had just put up cut the
 * run three planks in. The band arithmetic could not see that rule at all, so a
 * move about two other bookcases took the three planks above it, left them on no
 * face, and stood a plank nobody had asked for on the bookcase it had emptied.
 * A piece somebody's rule stands on is that rule's furniture, and half a piece
 * is nobody's to take.
 *
 * `undefined` when nothing stands past `from`, which is the last run in the room
 * and genuinely has no bound: it flows on across whatever gets put up next.
 */
export function nextRunStartAfter(
  order: Slot[],
  rules: PlacementRule[],
  from: number,
): number | undefined {
  const entries = entryAreas(rules, order)

  let limit: number | undefined
  for (const slot of order) {
    if (!startsARun(slot, entries)) continue
    if (slot.fixture.position <= from) continue
    if (limit === undefined || slot.fixture.position < limit) limit = slot.fixture.position
  }
  return limit
}

/**
 * Another run beginning on the piece `from`, other than the one opening at
 * `entry`, or null when that piece is this run's alone.
 *
 * **The half of #420 `nextRunStartAfter` cannot see.** That one answers about
 * pieces *past* the one a run opens on, because until #499 nothing could begin
 * a second run on the piece a run already opened on and still be reached: the
 * band arithmetic erased the earlier range instead. It can now, and the rule is
 * unchanged — a bookcase somebody else's run begins on is that run's furniture,
 * and half a piece is nobody's to take — so the piece a move starts from has to
 * be asked the same question as the pieces it stops at.
 */
export function otherRunOn(
  order: Slot[],
  rules: PlacementRule[],
  from: number,
  entry: number,
): Slot | null {
  const entries = entryAreas(rules, order)
  return order.find((slot) =>
    slot.fixture.position === from
    && slot.area.id !== entry
    && startsARun(slot, entries)) ?? null
}

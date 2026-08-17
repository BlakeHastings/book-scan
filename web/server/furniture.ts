/**
 * Describing the furniture: adding a piece, naming it, cutting it into areas,
 * reordering them, and taking one away.
 *
 * The tables have been here since #184 and nothing could touch them. This is the
 * API the owner asked for first, in his words: getting the fixture system
 * working so he can model the furniture he actually owns and then move the
 * non-fiction out of the living room. **There is no screen here on purpose**;
 * the screens are drawn in the gallery and are somebody else's issue.
 *
 * ## Every answer carries the labels it changes
 *
 * A label is derived at read time from a fixture's number and name and an area's
 * ordinal and name, and is stored nowhere. So renaming a bookcase relabels every
 * plank on it and reordering its areas relabels the ones that shuffled, and
 * neither moves a book. Each write here answers with `becomes`, every label that
 * reads differently afterwards, old to new. That is what a rename owes: the
 * recorded location of a book is an area row rather than a string, so nothing is
 * stranded, and `becomes` is how somebody sees that for themselves rather than
 * being told.
 *
 * ## Removing an area is a merge, and it writes assignments
 *
 * `domain/placement/arrangement.ts` works out which area takes the books in.
 * What happens to those books is #185's rule and nothing else: an `assigned` row
 * naming the area that absorbed them, written only where that differs from where
 * the book already is. **No placement is deleted and no book is.** The removed
 * area is retired rather than dropped whenever anything names it, so a book
 * recorded on `2C` is still recorded on `2C`, and the difference between what
 * the rules now want and where somebody last saw it is exactly the
 * needs-attention list this app already keeps.
 *
 * **`pinned` beats every rule, forever.** A pinned book is left alone by all of
 * this, and every answer says how many it left alone rather than quietly
 * counting them among the ones that moved.
 *
 * ### Why an assignment and not a placement
 *
 * The tempting alternative is to write `placed` rows, on the reasoning that the
 * books physically did not move and the area they are standing in is now the one
 * next door, so the count on that area ought to go up straight away. It is not
 * this API's to write. **`PATCH /api/books/:id/location` is the only route that
 * changes where the catalogue thinks a book is**, which is the same rule
 * `Shelves.moveAcrossBoundary` keeps when it moves a boundary under a book, and
 * it is what stops the app claiming somebody said something they did not. So the
 * removal records where the books belong and a person confirms where they are,
 * exactly as a boundary move already does.
 *
 * ## `pinned` is why a placement would be wrong as well as unearned
 *
 * A `placed` row clears the pin, because a person putting a book somewhere is a
 * later decision than pinning it there. Writing one per book on a merge would
 * therefore silently unpin every pinned book in the area, which is the one thing
 * this model promises cannot happen.
 */

import {
  fixtureLabel, labelFor, slotsInOrder, type Area, type Fixture, type Slot,
} from '../domain/placement/geography'
import {
  addArea as landingFor, anchorsAscend, moveArea, removeArea, strategyChange,
  type LabelChange, type StrategyChange,
} from '../domain/placement/arrangement'
import { assignmentFor, standingOf, type Placement } from '../domain/placement/ledger'
import {
  claim, entryAreaOf, entryAreas, type PlacementRule, type RuleOperator,
} from '../domain/placement/rules'
import { GENRE_RANGES } from '../domain/tagging/genre'
import type { ShelfRange } from '../shared/shelving'
import {
  COLLECTION_STRATEGIES, INHERIT, SORT_STRATEGIES, strategyFor,
  type OrderingStrategy, type SortStrategy,
} from '../domain/placement/strategies'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { furnitureIn, retireOrRemove, ruleForRange } from '../infrastructure/shelving/areas'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import {
  areaOnAFace, areasOnFaces, booksNaming, collectionId, collectionStrategy,
  fixtureOnTheFloor, fixturesOnTheFloor, insertArea, insertFixture, nextFixturePosition,
  offerableStrategies, removeFixtureIfUnused, resequenceFace, updateArea,
  updateCollectionStrategy, updateFixture,
  whatHoldsFixture, type AreaRow, type FixtureRow,
} from '../infrastructure/shelving/furniture'
import type { Db } from './driver'

/*
 * The refusal, and how one is said, moved out to `server/refusal.ts` (#332).
 *
 * It was written here and it was the better of the API's two ways of refusing:
 * six routes went through it and answered a malformed id with a clean 404 while
 * nineteen elsewhere hand-rolled the answer and 500'd. Nothing about it was
 * about bookcases, and its living in a module about bookcases is most of why
 * nobody else copied it. Re-exported so every existing importer is unchanged.
 */
import { refuse, type Refused } from './refusal'

export { refuse, type Refused }

/** The lock every write here takes, so two people rearranging one room queue. */
export const FURNITURE_LOCK = 'furniture'

// ---------------------------------------------------------------------------
// Reading the room
// ---------------------------------------------------------------------------

const asFixture = (row: FixtureRow): Fixture => ({
  id: row.id,
  position: row.position,
  kind: row.kind,
  name: row.name,
  sortStrategy: row.sortStrategy,
})

const asArea = (row: AreaRow): Area => ({
  id: row.id,
  fixtureId: row.fixtureId,
  position: row.position,
  name: row.name,
  startsAt: row.startsAt,
  sortStrategy: row.sortStrategy,
})

/**
 * What a rule asks for, in the words a person reads rather than the slugs it
 * stores.
 *
 * Added for the screens (#313), which draw "what belongs here" on every area and
 * on every piece. Without it the furniture screen can say how many books stand
 * somewhere and not one word about why they are there, which is the question
 * that whole screen exists to answer.
 *
 * **A tag is named by its label and never by its slug.** `genre/non-fiction` is
 * an identity, and putting one on a screen is the same mistake as showing
 * somebody a row id. Where the vocabulary has no label for a slug the phrase
 * falls back to the rule's own name rather than to the string, so there is no
 * path by which a slug reaches a screen.
 */
export interface DescribedRule {
  id: number
  name: string
  /** One area, or a whole piece and every area the run flows onto after it. */
  about: 'area' | 'fixture'
  /** What the place it points at reads as today. Derived, like every label. */
  place: string
  /**
   * Which area or piece that is.
   *
   * A screen naming a piece says "Bookcase 4" where this says "4", because the
   * label of a piece is its number and a number is not something anybody says
   * out loud about furniture. Rather than spell that sentence a second time
   * here, the id says which piece it is and the screen already knows how it
   * says a piece.
   */
  placeId: number | null
  enabled: boolean
  conditions: { operator: RuleOperator; tag: string }[]
  /** The whole of it as one phrase: "Anything tagged Cookery". */
  said: string
  /**
   * Which of the two stretches of books this rule is the one for, or null.
   *
   * **This is what makes the rule changeable from a screen** (#323).
   * `POST /api/placement/run` retargets a rule by naming the books it claims,
   * and `ruleForRange` is how it decides which row that is. A screen that had to
   * work the pairing out for itself would be a second answer to which rule is
   * which, so the answer travels with the rule instead.
   *
   * Null on any other rule, and a null is not a gap: it says this app has no way
   * to point that rule somewhere else yet, which is the honest thing for a
   * screen to say rather than offering a button that would refuse.
   */
  range: ShelfRange | null
}

/** Area rules beat fixture rules, then priority, then id: `claim`'s order. */
const byPrecedence = (a: PlacementRule, b: PlacementRule): number =>
  Number(b.areaId !== null) - Number(a.areaId !== null)
  || a.priority - b.priority
  || a.id - b.id

/** What a rule asks of a book, as one phrase, or null when a slug has no label. */
function conditionsSaid(rule: PlacementRule, labels: Map<string, string>): string | null {
  if (!rule.conditions.length) return null
  const parts = rule.conditions.map((condition) => {
    const label = labels.get(condition.value)
    if (label === undefined) return null
    return condition.operator === 'under'
      ? `tagged anything under ${label}`
      : `tagged ${label}`
  })
  return parts.every((part) => part !== null) ? `Anything ${parts.join(' and ')}` : null
}

const ruleSaid = (rule: PlacementRule, labels: Map<string, string>): string =>
  conditionsSaid(rule, labels) ?? `Anything ${rule.name} claims`

function describeRule(
  rule: PlacementRule,
  order: readonly Slot[],
  labels: Map<string, string>,
  range: ShelfRange | null,
): DescribedRule {
  const entry = entryAreaOf(rule, order as Slot[])
  const slot = order.find((one) => one.area.id === entry)
  return {
    id: rule.id,
    name: rule.name,
    about: rule.areaId !== null ? 'area' : 'fixture',
    place: slot ? (rule.areaId !== null ? labelFor(slot) : fixtureLabel(slot.fixture)) : '',
    placeId: rule.areaId ?? rule.fixtureId,
    enabled: rule.enabled,
    conditions: rule.conditions.map((condition) => ({
      operator: condition.operator,
      tag: labels.get(condition.value) ?? '',
    })),
    said: ruleSaid(rule, labels),
    range,
  }
}

/**
 * Every rule, described, keyed on its id.
 *
 * One place rather than a call per rule, because `range` is a fact about the
 * whole list: it is answered by `ruleForRange`, which picks **one** row per
 * stretch of books, and a rule that asked the question about itself could not
 * tell whether it was the one that got picked.
 *
 * Shared with `server/claim.ts`, which describes the rules that wanted one book.
 */
export function describeRules(
  order: readonly Slot[],
  rules: readonly PlacementRule[],
  labels: Map<string, string>,
): Map<number, DescribedRule> {
  const serves = new Map<number, ShelfRange>()
  for (const { range } of GENRE_RANGES) {
    const rule = ruleForRange(rules as PlacementRule[], range)
    if (rule && !serves.has(rule.id)) serves.set(rule.id, range)
  }

  return new Map(rules.map((rule) =>
    [rule.id, describeRule(rule, order, labels, serves.get(rule.id) ?? null)]))
}

/** The vocabulary as the rules quote it: slug to the label a person reads. */
export async function tagLabels(db: Db): Promise<Map<string, string>> {
  const vocabulary = await new DrizzleTagRepository(db).vocabulary()
  return new Map(vocabulary.map((tag) => [tag.slug.value, tag.label]))
}

/** Which rule's run an area lies in, and whether the area opens that run. */
interface RunOwner {
  rule: PlacementRule | null
  entry: boolean
}

/**
 * The rule whose books reach each area, walking the collection in order.
 *
 * The same two breaks `runFrom` makes and for the same reasons: an area a rule
 * points at opens a run, and an area that orders itself opens one too, because a
 * continuous run only works while every area in it orders the same way. An area
 * that opens a run nothing points at carries no rule, and neither does anything
 * after it, which is the honest answer rather than the previous rule leaking
 * across a cut.
 */
function runOwners(order: readonly Slot[], rules: readonly PlacementRule[]): Map<number, RunOwner> {
  const entries = entryAreas(rules as PlacementRule[], order as Slot[])
  const opens = new Map<number, PlacementRule>()
  for (const rule of [...rules].sort(byPrecedence)) {
    const at = entryAreaOf(rule, order as Slot[])
    if (at !== null && !opens.has(at)) opens.set(at, rule)
  }

  const owners = new Map<number, RunOwner>()
  let carrying: PlacementRule | null = null
  for (const slot of order) {
    if (entries.has(slot.area.id) || slot.area.sortStrategy !== INHERIT) {
      carrying = opens.get(slot.area.id) ?? null
      owners.set(slot.area.id, { rule: carrying, entry: true })
    } else {
      owners.set(slot.area.id, { rule: carrying, entry: false })
    }
  }
  return owners
}

/**
 * What an area holds, said the way somebody standing in front of it would say
 * it.
 *
 * Four answers and no fifth: the rule that opens the run here, the run carrying
 * on from the area before, a rule that is turned off, and nothing at all. The
 * last one is not a gap: a piece nothing files onto is a piece somebody fills by
 * hand, which is exactly what a crate by the door is.
 */
function areaHolds(owner: RunOwner | undefined, labels: Map<string, string>): string {
  if (!owner?.rule) return 'Put here by hand'
  if (!owner.rule.enabled) return `${owner.rule.name} is turned off, so nothing files here`
  if (!owner.entry) return `${owner.rule.name}, carrying on`
  return owner.rule.areaId !== null ? ruleSaid(owner.rule, labels) : `${owner.rule.name} starts here`
}

/** One area as the wire says it. `label` is worked out, never stored. */
export interface DescribedArea {
  id: number
  position: number
  label: string
  name: string
  startsAt: string
  sortStrategy: SortStrategy
  /** What it is actually ordered by, folded through the fixture and collection. */
  ordering: OrderingStrategy
  /** Anything but `inherit` means it takes no overflow from the area before. */
  selfContained: boolean
  note: string
  books: number
  /** What files here, in words. Never empty: "Put here by hand" is an answer. */
  holds: string
  /** Whether a run begins here rather than flowing in from the area before. */
  entry: boolean
  /** The rule whose books reach here, or null where none does. */
  rule: DescribedRule | null
}

export interface DescribedFixture {
  id: number
  position: number
  label: string
  kind: string
  name: string
  sortStrategy: SortStrategy
  note: string
  books: number
  areas: DescribedArea[]
  /** The other pieces standing on this piece's number, if any. See below. */
  sharing: number[]
  /** What a rule about the whole piece sends here, in words. */
  holds: string
  /** That rule, or null when nothing points at the piece itself. */
  rule: DescribedRule | null
}

export interface DescribedFurniture {
  fixtures: DescribedFixture[]
  defaultSortStrategy: SortStrategy
  strategies: { code: SortStrategy; label: string; isInherit: boolean }[]
}

/**
 * The whole room, in the order a book meets it.
 *
 * `sharing` is the honest half of `fixture.position` not being unique. Two
 * pieces on one number is an arrangement this catalogue already has and must
 * keep being able to record, and it is also two pieces drawing planks with the
 * same label, so a screen that did not know would show one twice with no
 * explanation.
 */
export async function describeFurniture(db: Db): Promise<DescribedFurniture> {
  const [fixtures, areas, fallback, strategies, arrangement, vocabulary] = await Promise.all([
    fixturesOnTheFloor(db), areasOnFaces(db), collectionStrategy(db), offerableStrategies(db),
    furnitureIn(db), new DrizzleTagRepository(db).vocabulary(),
  ])

  const collection = (fallback === INHERIT ? 'author' : fallback) as OrderingStrategy
  const labels = new Map(vocabulary.map((tag) => [tag.slug.value, tag.label]))
  const owners = runOwners(arrangement.order, arrangement.rules)
  const described = describeRules(arrangement.order, arrangement.rules, labels)
  const aboutFixture = (id: number): PlacementRule | null =>
    [...arrangement.rules].sort(byPrecedence).find((rule) => rule.fixtureId === id) ?? null

  return {
    fixtures: fixtures.map((fixture) => {
      const own = areas.filter((one) => one.fixtureId === fixture.id)
      const about = aboutFixture(fixture.id)
      return {
        id: fixture.id,
        position: fixture.position,
        label: fixtureLabel(asFixture(fixture)),
        kind: fixture.kind,
        name: fixture.name,
        sortStrategy: fixture.sortStrategy,
        note: fixture.note,
        books: own.reduce((total, one) => total + one.books, 0),
        areas: own.map((area) => ({
          id: area.id,
          position: area.position,
          label: labelFor({ fixture: asFixture(fixture), area: asArea(area) }),
          name: area.name,
          startsAt: area.startsAt,
          sortStrategy: area.sortStrategy,
          ordering: strategyFor(collection, fixture.sortStrategy, area.sortStrategy),
          selfContained: area.sortStrategy !== INHERIT,
          note: area.note,
          books: area.books,
          holds: areaHolds(owners.get(area.id), labels),
          entry: owners.get(area.id)?.entry ?? false,
          rule: (() => {
            const owner = owners.get(area.id)
            return owner?.rule ? described.get(owner.rule.id) ?? null : null
          })(),
        })),
        sharing: fixtures
          .filter((one) => one.id !== fixture.id && one.position === fixture.position)
          .map((one) => one.id),
        holds: about ? ruleSaid(about, labels) : 'No rule sends books here',
        rule: about ? described.get(about.id) ?? null : null,
      }
    }),
    defaultSortStrategy: fallback,
    strategies,
  }
}

/** One piece, or nothing. */
export async function describeFixture(
  db: Db,
  id: number,
): Promise<DescribedFixture | null> {
  return (await describeFurniture(db)).fixtures.find((one) => one.id === id) ?? null
}

// ---------------------------------------------------------------------------
// What is standing in an area
// ---------------------------------------------------------------------------

/**
 * One book standing somewhere, as the screens about that place need it.
 *
 * The four ordering components travel with it on purpose. A screen that names a
 * sort rule and stops has not said why the books read in the order they do, and
 * the owner said that is the part that is hard to see; the answer is the books
 * themselves, in that order, which needs whatever `orderBy` orders by.
 */
export interface AreaBook {
  id: number
  title: string
  authorFiling: string
  /** How it files by title, which is what the title ordering reads. */
  titleFiling: string
  /** As printed, usually a bare year, which is what the year ordering reads. */
  published: string
  /** Where it sits in the order, which is what a boundary is anchored to. */
  sortKey: string
  /** Every slug it carries, in slug order, which is what a rule matches on. */
  tagSlugs: string[]
  /**
   * The same tags as a person reads them, in the same order.
   *
   * A slug is an identity and never reaches a screen, so a screen showing what
   * the tag ordering files a book under has to be given the label. Ordering and
   * drawing then agree by construction rather than by two reads happening to
   * come back the same way.
   */
  tags: string[]
  /** The rule that claims it, by name, or null when nothing claims it. */
  claimedBy: string | null
}

export interface AreaBooks {
  area: { id: number; label: string; books: number }
  books: AreaBook[]
}

export type ReadArea = { ok: true; area: AreaBooks['area']; books: AreaBook[] } | Refused

/** The same read, about a whole piece: every book standing on its face. */
export type ReadFixtureBooks =
  | { ok: true; fixture: { id: number; label: string; books: number }; books: AreaBook[] }
  | Refused

interface StandingRow {
  id: number
  title: string
  author_filing: string
  title_filing: string
  published: string
  sort_key: string
  slugs: string[] | null
  labels: string[] | null
}

/**
 * The columns every "what is standing here" read takes, and the one place they
 * are written.
 *
 * They are not only the columns a list needs. **Every one of them is a
 * component of some ordering** (`domain/placement/strategies.ts`), because the
 * screens now show what an ordering does to these books rather than only naming
 * it: a person picking "by the title" watches the books in front of them
 * reorder, which is the whole of the answer to "why do they sort like that".
 * Ordering them on the client from four columns keeps that one function, the
 * one the shelf itself is built by, rather than growing a second one that
 * agrees until somebody adds a strategy.
 */
const STANDING_COLUMNS =
  `b.id, b.title, b.author_filing, b.title_filing, b.published, b.sort_key,
          array_remove(array_agg(t.slug ORDER BY t.slug), NULL) AS slugs,
          array_remove(array_agg(t.label ORDER BY t.slug), NULL) AS labels`

const STANDING_GROUP =
  'b.id, b.title, b.author_filing, b.title_filing, b.published, b.sort_key'

const asStandingBook = (row: StandingRow, rules: PlacementRule[]): AreaBook => ({
  id: Number(row.id),
  title: row.title,
  authorFiling: row.author_filing ?? '',
  titleFiling: row.title_filing ?? '',
  published: row.published ?? '',
  sortKey: row.sort_key,
  tagSlugs: row.slugs ?? [],
  tags: row.labels ?? [],
  claimedBy: claim(rules, { tagSlugs: row.slugs ?? [] })?.name ?? null,
})

/**
 * The books standing in one area, in the order they stand, **by identity**.
 *
 * This is the route #318 said was missing and #313 worked around. Splitting an
 * area needs to know which books are in it, because the boundary is a book: the
 * first one of the new area. Nothing answered that, so the screen asked for both
 * stretches of shelving and **matched an area up by its label**, which is a
 * string derived at read time from a piece's number and name and an area's
 * ordinal and name. A rename, a reorder, or the owner's two pieces both standing
 * at 4 would each have picked the wrong books, silently.
 *
 * `current_area_id` is the answer, and it is the same number the count on the
 * area is taken from (`areasOnFaces`), so the list and the count are one fact
 * rather than two readings that agree today. An assignment nobody has acted on
 * does not move a book and does not appear here: what is being cut is the row of
 * books somebody is standing in front of.
 *
 * `claimedBy` comes along because the same read answers it: it is what lets a
 * screen say how many books here no rule claims at all, which is a real state
 * since #304 and is invisible from the counts.
 */
export async function booksInArea(db: Db, id: number): Promise<ReadArea> {
  const area = await areaOnAFace(db, id)
  if (!area) return refuse(404, 'No such area.')

  const fixture = await fixtureOnTheFloor(db, area.fixtureId)
  if (!fixture) return refuse(404, 'No such piece of furniture.')

  const rows = await standingIn(db, [id])
  const { rules } = await furnitureIn(db)

  return {
    ok: true,
    area: {
      id,
      label: labelFor({ fixture: asFixture(fixture), area: asArea(area) }),
      books: area.books,
    },
    books: rows.map((row) => asStandingBook(row, rules)),
  }
}

/**
 * The books standing on one piece of furniture, in the order they stand.
 *
 * The same read one area up, and it exists for the same reason that one does:
 * a piece's own page now shows how it is ordered and what that ordering does to
 * these books, and asking area by area would be one request per plank and a
 * screen stitching them back into an order.
 *
 * A piece nothing has been filed onto answers an empty list, which is correct
 * and is not a 404: the piece is there and holds nothing.
 */
export async function booksOnFixture(db: Db, id: number): Promise<ReadFixtureBooks> {
  const fixture = await fixtureOnTheFloor(db, id)
  if (!fixture) return refuse(404, 'No such piece of furniture.')

  const face = await faceOf(db, fixture)
  const rows = face.length ? await standingIn(db, face.map((slot) => slot.area.id)) : []
  const { rules } = await furnitureIn(db)

  return {
    ok: true,
    fixture: {
      id,
      label: fixtureLabel(asFixture(fixture)),
      books: rows.length,
    },
    books: rows.map((row) => asStandingBook(row, rules)),
  }
}

/** Every book recorded in any of these areas, in the order they stand. */
async function standingIn(db: Db, areaIds: readonly number[]): Promise<StandingRow[]> {
  if (areaIds.length === 0) return []
  const holes = areaIds.map(() => '?').join(', ')
  return db.all<StandingRow>(
    `SELECT ${STANDING_COLUMNS}
       FROM catalogued_books b
       LEFT JOIN book_tag bt ON bt.book_id = b.id
       LEFT JOIN tag t ON t.id = bt.tag_id
      WHERE b.current_area_id IN (${holes})
      GROUP BY ${STANDING_GROUP}
      ORDER BY b.sort_key`,
    [...areaIds],
  )
}

/** The areas of one fixture as slots, in the order they sit on its face. */
async function faceOf(db: Db, fixture: FixtureRow): Promise<Slot[]> {
  const areas = await areasOnFaces(db)
  return areas
    .filter((area) => area.fixtureId === fixture.id)
    .sort((a, b) => a.position - b.position)
    .map((area) => ({ fixture: asFixture(fixture), area: asArea(area) }))
}

/**
 * Every label that reads differently once the face is `after` and the areas sit
 * in `order`.
 *
 * One function for all four ways a label can change, because to a person they
 * are one thing: renaming the piece, renumbering it, renaming an area and moving
 * an area along the piece all end in somebody looking for a book under a
 * different name. An area that is being added has no old label and is left out.
 */
function relabelling(
  before: readonly Slot[],
  after: readonly Slot[],
  order: readonly number[],
): LabelChange[] {
  const was = new Map(before.map((slot) => [slot.area.id, labelFor(slot)]))
  const changes: LabelChange[] = []
  order.forEach((id, position) => {
    const slot = after.find((one) => one.area.id === id)
    const from = was.get(id)
    if (!slot || from === undefined) return
    const to = labelFor({ fixture: slot.fixture, area: { ...slot.area, position } })
    if (from !== to) changes.push({ from, to })
  })
  return changes
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** What a caller may say about a piece of furniture. */
export interface FixtureInput {
  kind?: unknown
  name?: unknown
  position?: unknown
  sortStrategy?: unknown
  note?: unknown
}

const asText = (value: unknown): string | undefined =>
  (value === undefined ? undefined : String(value ?? '').trim())

const asStrategy = (value: unknown): SortStrategy | undefined | null => {
  if (value === undefined) return undefined
  const code = String(value ?? '')
  return (SORT_STRATEGIES as readonly string[]).includes(code) ? code as SortStrategy : null
}

const asPosition = (value: unknown): number | undefined | null => {
  if (value === undefined) return undefined
  const position = Number(value)
  return Number.isInteger(position) ? position : null
}

export type EditedCollection =
  | { ok: true; defaultSortStrategy: OrderingStrategy }
  | Refused

/**
 * Change what the whole collection falls back on.
 *
 * The one settable thing about the collection, and the reason it now has a
 * route: `default_sort_strategy` has been a real column since #184 and two
 * screens already read it out loud, an area saying it is ordered "the way
 * bookcase 2 does" and the ordering screen saying that is "by the author's
 * surname, which is what the whole library uses". Nothing anywhere could
 * change it. #350's settings screen is where it is asked for.
 *
 * ## Two answers are refused and neither is a validation formality
 *
 * `inherit` has nothing above it to ask, which is a check constraint on the
 * column rather than an opinion here. `tag` is refused because the seed row for
 * it says "Never the collection default": ordering a whole house by the first
 * tag slug on each book files a library by an accident of the vocabulary. Both
 * come off `COLLECTION_STRATEGIES` in the domain, so the list is stated once
 * and the screen offering the choice reads the same one.
 *
 * ## It writes one column and moves nothing
 *
 * Exactly the bargain `editFixture` strikes with a piece's own strategy. Where
 * a book belongs is worked out from these values whenever anybody asks; where a
 * book *is* only changes when a person carries it. So the effect of this is
 * that the furniture screens start saying something different about the order,
 * and the carry list is what the difference becomes.
 */
export async function editCollection(
  db: Db,
  input: { defaultSortStrategy?: unknown },
): Promise<EditedCollection> {
  const strategy = asStrategy(input.defaultSortStrategy)
  if (strategy === null) return refuse(400, 'That is not a way of ordering books.')
  if (strategy === undefined) return refuse(400, 'Nothing was said to change.')
  if (strategy === INHERIT) {
    return refuse(400, 'A collection has nothing above it to take its order from.')
  }
  if (!COLLECTION_STRATEGIES.includes(strategy)) {
    return refuse(400, 'A whole collection cannot be ordered by tag.')
  }

  return db.tx(async (tx) => {
    const written = await updateCollectionStrategy(tx, strategy)
    if (!written) return refuse(404, 'There is no collection to change.')
    return { ok: true as const, defaultSortStrategy: strategy }
  }, { serialiseOn: FURNITURE_LOCK })
}

export type AddedFixture = { ok: true; fixture: DescribedFixture } | Refused

/**
 * Put a piece of furniture in the room.
 *
 * It arrives with no areas, because an area is a decision about where one run of
 * books stops and the next begins, and a piece somebody has only just named has
 * no books on it to cut. `POST /api/fixtures/:id/areas` is the next thing they
 * do, as many times as the piece has planks.
 *
 * The number defaults to one past the last piece, which is where somebody
 * describing their furniture in the order they walk past it wants it.
 */
export async function addFixture(db: Db, input: FixtureInput): Promise<AddedFixture> {
  const strategy = asStrategy(input.sortStrategy)
  if (strategy === null) return refuse(400, 'That is not a way of ordering a shelf.')

  const position = asPosition(input.position)
  if (position === null || (position !== undefined && position < 1)) {
    return refuse(400, 'Pieces of furniture are numbered from 1.')
  }

  return db.tx(async (tx) => {
    const collection = await collectionId(tx)
    if (!collection) return refuse(500, 'This catalogue has no collection to hang furniture on.')

    const id = await insertFixture(tx, {
      collectionId: collection,
      kind: asText(input.kind) || 'bookshelf',
      name: asText(input.name) ?? '',
      position: position ?? await nextFixturePosition(tx),
      sortStrategy: strategy ?? INHERIT,
      note: asText(input.note) ?? '',
    })

    const fixture = await describeFixture(tx, id)
    return fixture ? { ok: true as const, fixture } : refuse(500, 'The piece was not written.')
  }, { serialiseOn: FURNITURE_LOCK })
}

export type EditedFixture =
  | { ok: true; fixture: DescribedFixture; becomes: LabelChange[] }
  | Refused

/**
 * Rename a piece, renumber it, say what kind of thing it is, or change how it
 * orders what it holds.
 *
 * **Renumbering a piece is renaming it, and it moves nothing.** Every area keeps
 * its id, so every book keeps the area it was placed in and its recorded
 * location follows the furniture: what changes is the label, which is derived
 * from the number. Pointing a run at a different piece is the other thing, it is
 * the one that produces books in somebody's hands, and it lives in
 * `relocate-run.ts`. See `domain/placement/relocate.ts` for why the two are not
 * the same request.
 *
 * `becomes` is therefore the whole answer: every label on the piece that reads
 * differently now.
 */
export async function editFixture(
  db: Db,
  id: number,
  input: FixtureInput,
): Promise<EditedFixture> {
  const strategy = asStrategy(input.sortStrategy)
  if (strategy === null) return refuse(400, 'That is not a way of ordering a shelf.')

  const position = asPosition(input.position)
  if (position === null || (position !== undefined && position < 1)) {
    return refuse(400, 'Pieces of furniture are numbered from 1.')
  }

  return db.tx(async (tx) => {
    const before = await fixtureOnTheFloor(tx, id)
    if (!before) return refuse(404, 'No such piece of furniture.')

    const name = asText(input.name)
    const after: Fixture = {
      ...asFixture(before),
      name: name ?? before.name,
      position: position ?? before.position,
    }

    const face = await faceOf(tx, before)
    const becomes = relabelling(
      face,
      face.map((slot) => ({ fixture: after, area: slot.area })),
      face.map((slot) => slot.area.id),
    )

    await updateFixture(tx, id, {
      kind: asText(input.kind),
      name,
      position,
      sortStrategy: strategy,
      note: asText(input.note),
    })

    const fixture = await describeFixture(tx, id)
    return fixture
      ? { ok: true as const, fixture, becomes }
      : refuse(500, 'The piece was not written.')
  }, { serialiseOn: FURNITURE_LOCK })
}

export interface FixtureRemoval {
  /** How many books are standing on it, which is what has to leave first. */
  books: number
  areas: number
  /** How many placement rules point at it or at one of its areas. */
  rules: number
  /**
   * Whether the row will stay behind with nothing on its face.
   *
   * A piece whose areas a book was ever placed in cannot be deleted:
   * `book_placement.area_id` is ON DELETE RESTRICT so the history pins the
   * furniture it names, and a plank a book once sat on stays nameable. Such a
   * piece is taken off the floor rather than out of the catalogue, which is the
   * same answer an area gets, and saying so beats a delete that quietly did
   * something else.
   */
  retires: boolean
}

export type RemovedFixture = { ok: true; removed: FixtureRemoval } | Refused

/** What taking this piece away would mean, without taking it away. */
export async function planFixtureRemoval(
  db: Db,
  id: number,
): Promise<{ ok: true; removal: FixtureRemoval } | Refused> {
  const fixture = await fixtureOnTheFloor(db, id)
  if (!fixture) return refuse(404, 'No such piece of furniture.')
  return { ok: true, removal: await whatHoldsFixture(db, id) }
}

/**
 * Take a piece of furniture away, once nothing is standing on it.
 *
 * **It refuses while it still holds books**, and says how many, which is the
 * sentence the furniture screen already says: its books move to other furniture
 * first, and that is a real carry with a plan in front of it. Emptying a piece
 * by deleting it would either lose the books or leave them recorded on planks
 * nobody can walk to, and neither is something to do behind a person's back.
 *
 * A piece a placement rule points at is refused for the same reason: the rule
 * files books there, and deleting the furniture out from under it would leave
 * the rule pointing nowhere and its books unplaceable.
 */
export async function dropFixture(db: Db, id: number): Promise<RemovedFixture> {
  return db.tx(async (tx) => {
    const fixture = await fixtureOnTheFloor(tx, id)
    if (!fixture) return refuse(404, 'No such piece of furniture.')

    const holds = await whatHoldsFixture(tx, id)
    if (holds.books) {
      return refuse(
        409,
        `Its ${holds.books} book${holds.books === 1 ? '' : 's'} move to other furniture first.`,
        holds,
      )
    }
    if (holds.rules) {
      return refuse(
        409,
        `${holds.rules} rule${holds.rules === 1 ? '' : 's'} still file books here. `
          + 'Point them somewhere else first.',
        holds,
      )
    }

    // The areas go before the piece can, and one a book was ever placed in
    // cannot go at all. Such a piece keeps standing with nothing on its face,
    // which is `retires` and is reported rather than treated as a failure: the
    // piece is off the floor either way, and the history it carries is the
    // reason the row survives.
    for (const slot of await faceOf(tx, fixture)) {
      await retireOrRemove(tx, slot.area.id, slot.area.position)
    }

    const gone = await removeFixtureIfUnused(tx, id)
    return { ok: true as const, removed: { ...holds, retires: !gone } }
  }, { serialiseOn: FURNITURE_LOCK })
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

export interface AreaInput {
  name?: unknown
  startsAt?: unknown
  sortStrategy?: unknown
  note?: unknown
  position?: unknown
  /** Set once somebody has been shown what a strategy change does to the runs. */
  acknowledge?: unknown
}

export type AddedArea =
  | { ok: true; area: DescribedArea; becomes: LabelChange[] }
  | Refused

const ANCHORS_OUT_OF_ORDER =
  'The areas on a piece are read in the order the books run along it, so an area '
  + 'cannot start before the one in front of it. Move the boundary instead of the area.'

/**
 * The character that sorts above anything a sort key can hold.
 *
 * Used to make an anchor that is past a known book and past nothing else. It is
 * only ever appended to the greatest key in a run, where nothing follows it, so
 * the only thing the choice decides is which of two areas a book added *later*
 * falls into: too low and the new area would quietly claim one, too high and it
 * stays empty until a boundary moves, which is the model this app already has
 * and what "an empty area at the end" means.
 */
const PAST_EVERYTHING = '￿'

/**
 * Where an area opens when nobody said, which is now every time one is added.
 *
 * **Adding an area stopped being a screen** (#381): the owner asked for the
 * button on the fixtures screen to just add one, at the end, continuing the
 * lettering, with no question in between. The question it used to ask was which
 * book the new area starts at, and that is this function: without an answer the
 * area used to open at the empty string, which the anchor check refuses on any
 * piece that already holds books.
 *
 * There are two answers and the difference between them is whether anything
 * follows the new area **in its own run**:
 *
 * - **Something does.** The new area takes the stretch just before that
 *   boundary, so it opens exactly where the next area opens. Equal anchors are
 *   allowed and are already real in this catalogue. No book moves: a key below
 *   that anchor still lands before the new area and a key at or above it still
 *   lands in the area that already claimed it.
 * - **Nothing does**, because the next area starts a run of its own or there is
 *   no next area. Then the new area is the end of the run and opens past every
 *   book in it, which is the plank the boundary moves onto when the one before
 *   fills up. A run with nothing standing in it has no such book, so the area
 *   opens where the one it follows opens, which is #367's empty case.
 *
 * **It is never lower than the area it follows**, because the areas of a piece
 * are read in the order the books run along it and the write is refused when
 * they do not ascend. An empty area anchored past the end followed by another
 * empty one is exactly where the two answers meet.
 */
async function anchorForNewArea(
  tx: Db,
  piece: Fixture,
  landing: number,
): Promise<string> {
  const { order, rules } = await furnitureIn(tx)
  const entries = entryAreas(rules, order)

  /*
   * The whole collection with the new area standing in it, worked out the way
   * the collection is always worked out. Everything at or after the landing on
   * this face shuffles down, which is what the write itself then does.
   *
   * The piece is put into the list itself rather than read off the areas,
   * because a piece with no areas yet appears in none of them and its first
   * area would otherwise be dropped on the floor and answered about somebody
   * else's.
   */
  const fixtureId = piece.id
  const fixtures = [
    piece,
    ...[...new Map(order.map((slot) => [slot.fixture.id, slot.fixture])).values()]
      .filter((one) => one.id !== fixtureId),
  ]
  const wanted: Area = {
    id: 0, fixtureId, position: landing, name: '', startsAt: '', sortStrategy: INHERIT,
  }
  const shifted = order.map((slot) => (slot.fixture.id === fixtureId
    && slot.area.position >= landing
    ? { ...slot.area, position: slot.area.position + 1 }
    : slot.area))
  const grown = slotsInOrder(fixtures, [...shifted, wanted])

  const at = grown.findIndex((slot) => slot.area.id === 0)
  const before = at > 0 ? grown[at - 1] ?? null : null
  const after = grown[at + 1] ?? null

  // Still inside a run: open where the next area opens, and claim nothing.
  const opensARun = (slot: Slot): boolean =>
    entries.has(slot.area.id) || slot.area.sortStrategy !== INHERIT
  if (after && !opensARun(after)) return after.area.startsAt

  // The end of the run: past every book standing in it.
  const run: number[] = []
  for (let back = at - 1; back >= 0; back -= 1) {
    const slot = grown[back]!
    run.push(slot.area.id)
    if (opensARun(slot)) break
  }

  const top = run.length
    ? (await tx.all<{ top: string | null }>(
        `SELECT max(sort_key) AS top FROM catalogued_books
          WHERE current_area_id IN (${run.map(() => '?').join(', ')})`,
        run,
      ))[0]?.top ?? null
    : null

  const past = top === null ? '' : `${top}${PAST_EVERYTHING}`
  const follows = before?.area.startsAt ?? ''
  return past > follows ? past : follows
}

/**
 * Cut another area into a piece of furniture.
 *
 * `startsAt` is the sort key the run of books in it begins at, which is what a
 * boundary is: everything from there to the next boundary is one area. **Left
 * out, the server works out where it opens**, which is `anchorForNewArea` and
 * is what makes adding an area a button rather than a screen (#381). Passing an
 * empty string is still saying "from the beginning" out loud, and is still
 * refused on a piece whose areas are already anchored.
 *
 * `position` puts it between two areas that already exist; left out it goes on
 * the end. Everything after it shuffles down, which relabels those areas and
 * moves no book, and `becomes` says which.
 */
export async function addAreaTo(
  db: Db,
  fixtureId: number,
  input: AreaInput,
): Promise<AddedArea> {
  const strategy = asStrategy(input.sortStrategy)
  if (strategy === null) return refuse(400, 'That is not a way of ordering a shelf.')

  const at = asPosition(input.position)
  if (at === null || (at !== undefined && at < 0)) {
    return refuse(400, 'Areas are numbered from 0, which is the one at the top.')
  }

  return db.tx(async (tx) => {
    const fixture = await fixtureOnTheFloor(tx, fixtureId)
    if (!fixture) return refuse(404, 'No such piece of furniture.')

    const face = await faceOf(tx, fixture)
    const landing = landingFor(face, at ?? face.length)

    const said = asText(input.startsAt)
    const wanted: Area = {
      // A stand-in, checked against the anchors before anything is written. Zero
      // cannot collide with a row: the identity column starts at 1.
      id: 0,
      fixtureId,
      position: landing,
      name: asText(input.name) ?? '',
      startsAt: said ?? await anchorForNewArea(tx, asFixture(fixture), landing),
      sortStrategy: strategy ?? INHERIT,
    }
    const grown: Slot[] = [...face, { fixture: asFixture(fixture), area: wanted }]
    const order: number[] = face.map((slot) => slot.area.id)
    order.splice(landing, 0, 0)

    // Refused before the insert, so a refusal writes nothing. Returning one out
    // of a transaction commits it, which is right for a read-only refusal and
    // would be a half-made area if the row already existed.
    if (!anchorsAscend(grown, order)) return refuse(409, ANCHORS_OUT_OF_ORDER)

    /*
     * Written on the end and then renumbered, rather than inserted at the
     * ordinal it wants. The unique index would refuse the insert while the area
     * already sitting there still holds the number, and the renumbering is
     * needed anyway for everything after it. See `resequenceFace`.
     */
    const id = await insertArea(tx, {
      fixtureId,
      position: face.length,
      name: wanted.name,
      startsAt: wanted.startsAt,
      sortStrategy: wanted.sortStrategy,
      note: asText(input.note) ?? '',
    })

    const becomes = relabelling(face, face, order.map((one) => (one === 0 ? id : one)))
    await resequenceFace(tx, fixtureId, order.map((one) => (one === 0 ? id : one)))

    const area = (await describeFixture(tx, fixtureId))?.areas.find((one) => one.id === id)
    return area
      ? { ok: true as const, area, becomes }
      : refuse(500, 'The area was not written.')
  }, { serialiseOn: FURNITURE_LOCK })
}

export type EditedArea =
  | { ok: true; area: DescribedArea; becomes: LabelChange[]; effect: StrategyChange | null }
  | Refused

/**
 * Rename an area, move it along its piece, re-anchor it, or give it an order of
 * its own.
 *
 * ## The strategy is the one that is not just a label change
 *
 * **An area with a sort strategy of its own takes no overflow**, because a
 * continuous run only works if every area in it orders the same way. Setting one
 * therefore cuts the run the area is in, and the areas from there on stop being
 * fed by the ones before them. That is not something to do quietly, so it is
 * refused with the effect attached until the caller says `acknowledge`, and the
 * effect is what a dialog shows somebody before they agree.
 *
 * ## Reordering
 *
 * Moving an area along its piece renumbers everything between where it was and
 * where it is going, which is `resequenceFace`'s two passes and the reason they
 * exist. It is refused when it would leave the anchors on the face out of order,
 * because the areas of a piece are read in the order the books run along it and
 * an area cannot begin before the one in front of it.
 */
export async function editArea(db: Db, id: number, input: AreaInput): Promise<EditedArea> {
  const strategy = asStrategy(input.sortStrategy)
  if (strategy === null) return refuse(400, 'That is not a way of ordering a shelf.')

  const at = asPosition(input.position)
  if (at === null || (at !== undefined && at < 0)) {
    return refuse(400, 'Areas are numbered from 0, which is the one at the top.')
  }

  return db.tx(async (tx) => {
    const area = await areaOnAFace(tx, id)
    if (!area) return refuse(404, 'No such area.')

    const fixture = await fixtureOnTheFloor(tx, area.fixtureId)
    if (!fixture) return refuse(404, 'No such piece of furniture.')

    let effect: StrategyChange | null = null
    if (strategy !== undefined && strategy !== area.sortStrategy) {
      const { order, rules } = await furnitureIn(tx)
      effect = strategyChange(order, entryAreas(rules, order), id, strategy)
      if (effect?.cuts && input.acknowledge !== true) {
        return refuse(
          409,
          /*
           * This sentence is shown to somebody, so it says none of the words
           * the code says to itself. It used to end "leave the run they are
           * in", and "run" is on the list `src/design/design.test.tsx` pins:
           * the owner named the rule himself, about this exact word, and it
           * reached a screen the moment the ordering became something changed
           * on the area's own page rather than on a screen of its own (#381).
           */
          effect.selfContained
            ? `${effect.affected[0]} would order itself, so nothing overflows into it from `
              + `the area before, and ${effect.affected.length} area`
              + `${effect.affected.length === 1 ? '' : 's'} stop being fed by the one `
              + 'in front of them.'
            : `${effect.affected[0]} would go back to taking what overflows from the area `
              + `before it, and ${effect.affected.length} area`
              + `${effect.affected.length === 1 ? '' : 's'} are fed by the one in front of `
              + 'them again.',
          effect,
        )
      }
    }

    const face = await faceOf(tx, fixture)
    const name = asText(input.name)
    const startsAt = asText(input.startsAt)

    // The face as it will read, so `becomes` and the anchor check both answer
    // about the arrangement being asked for rather than the one standing.
    const restated: Slot[] = face.map((slot) => (slot.area.id === id
      ? {
          fixture: slot.fixture,
          area: {
            ...slot.area,
            name: name ?? slot.area.name,
            startsAt: startsAt ?? slot.area.startsAt,
          },
        }
      : slot))

    const change = at === undefined ? null : moveArea(restated, id, at)
    const order = change?.order ?? restated.map((slot) => slot.area.id)
    if (!anchorsAscend(restated, order)) return refuse(409, ANCHORS_OUT_OF_ORDER)

    const becomes = relabelling(face, restated, order)

    await updateArea(tx, id, {
      name,
      startsAt,
      sortStrategy: strategy,
      note: asText(input.note),
    })
    if (change?.moves.length) await resequenceFace(tx, area.fixtureId, order)

    const described = (await describeFixture(tx, area.fixtureId))
      ?.areas.find((one) => one.id === id)
    return described
      ? { ok: true as const, area: described, becomes, effect }
      : refuse(500, 'The area was not written.')
  }, { serialiseOn: FURNITURE_LOCK })
}

/** What happens to the books of an area somebody is about to remove. */
export interface AreaRemovalPlan {
  area: { id: number; label: string; books: number }
  /** The area they join, with the label it reads under today. */
  into: { id: number; label: string }
  joins: 'previous' | 'next'
  /** How many books join it, which is the number the dialog leads on. */
  joining: number
  /** Everything left exactly where it is, and why. Never silently empty. */
  skipped: { reason: 'pinned' | 'checked-out' | 'withdrawn'; books: number }[]
  /** Every label that reads differently afterwards, old to new. */
  becomes: LabelChange[]
}

export type PlannedAreaRemoval = { ok: true; plan: AreaRemovalPlan } | Refused

const SKIP_ORDER = ['pinned', 'checked-out', 'withdrawn'] as const

type SkipReason = (typeof SKIP_ORDER)[number]

/** Which books move, which stay, and why: the same fold the write path makes. */
function foldForRemoval(
  books: readonly number[],
  rows: readonly Placement[],
  from: number,
  into: number,
): { moving: { id: number; to: number }[]; skipped: Map<SkipReason, number> } {
  const history = new Map<number, Placement[]>()
  for (const row of rows) {
    const existing = history.get(row.bookId)
    if (existing) existing.push(row)
    else history.set(row.bookId, [row])
  }

  const moving: { id: number; to: number }[] = []
  const skipped = new Map<SkipReason, number>()
  const skip = (reason: SkipReason) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1)

  for (const id of books) {
    const standing = standingOf(history.get(id) ?? [])
    // Only a book this area is still about. The rest merely have it in their
    // history, which is a plank they were on once and is not a reason to move
    // anything.
    if (standing.area !== from && standing.assigned !== from) continue

    if (standing.pinned) { skip('pinned'); continue }
    if (standing.checkedOut) { skip('checked-out'); continue }
    if (standing.withdrawn) { skip('withdrawn'); continue }

    const wanted = assignmentFor(standing, into)
    if (wanted !== null) moving.push({ id, to: wanted })
  }

  return { moving, skipped }
}

const skippedList = (skipped: Map<SkipReason, number>) =>
  SKIP_ORDER
    .filter((reason) => skipped.has(reason))
    .map((reason) => ({ reason, books: skipped.get(reason)! }))

/**
 * What removing this area would do, before anybody agrees to it. Writes nothing.
 *
 * This is what the dialog #281 settled is drawn from, and the same functions the
 * write path uses answer it, so what somebody approves is what happens.
 */
export async function planAreaRemoval(db: Db, id: number): Promise<PlannedAreaRemoval> {
  const area = await areaOnAFace(db, id)
  if (!area) return refuse(404, 'No such area.')

  const fixture = await fixtureOnTheFloor(db, area.fixtureId)
  if (!fixture) return refuse(404, 'No such piece of furniture.')

  const face = await faceOf(db, fixture)
  const removal = removeArea(face, id)
  if (!removal.ok) return refuse(409, removal.error)

  const books = await booksNaming(db, id)
  const rows = await new DrizzlePlacementLedger(db).forBooks(books)
  const { moving, skipped } = foldForRemoval(books, rows, id, removal.removal.into.id)

  return {
    ok: true,
    plan: {
      area: {
        id,
        label: labelFor(face.find((slot) => slot.area.id === id)!),
        books: area.books,
      },
      into: removal.removal.into,
      joins: removal.removal.joins,
      joining: moving.length,
      skipped: skippedList(skipped),
      becomes: removal.removal.becomes,
    },
  }
}

export type RemovedArea = { ok: true; plan: AreaRemovalPlan } | Refused

/**
 * Take an area off a piece of furniture and let its books fall into the next
 * one along.
 *
 * Four things happen, in this order, in one transaction:
 *
 * 1. When the area going is the first on its piece, the one coming forward takes
 *    over its anchor, because it is taking over its place in the sequence.
 * 2. The area is **retired** rather than deleted whenever anything names it, so
 *    every placement that points at it still points at it and a book recorded on
 *    that plank is still recorded on that plank. Nothing names it, it goes.
 * 3. The face is renumbered, which relabels the areas after it.
 * 4. An `assigned` row is written for every book the area was about, naming the
 *    area that took them in, and **only where that differs from where the book
 *    already is**. Pinned, checked out and withdrawn books get none, and the
 *    answer says how many there were.
 *
 * The books have not moved and nobody has carried anything. What has changed is
 * which area the rules say they are in, and the difference between that and
 * where somebody last saw them is the needs-attention list that already exists.
 */
export async function dropArea(db: Db, id: number, now: string): Promise<RemovedArea> {
  return db.tx(async (tx) => {
    const planned = await planAreaRemoval(tx, id)
    if (!planned.ok) return planned

    const area = await areaOnAFace(tx, id)
    if (!area) return refuse(404, 'No such area.')

    const fixture = await fixtureOnTheFloor(tx, area.fixtureId)
    if (!fixture) return refuse(404, 'No such piece of furniture.')

    const face = await faceOf(tx, fixture)
    const removal = removeArea(face, id)
    if (!removal.ok) return refuse(409, removal.error)

    if (removal.removal.anchor !== null) {
      await updateArea(tx, removal.removal.into.id, { startsAt: removal.removal.anchor })
    }

    await retireOrRemove(tx, id, area.position)
    await resequenceFace(tx, area.fixtureId, removal.removal.order)

    const books = await booksNaming(tx, id)
    const ledger = new DrizzlePlacementLedger(tx)
    const { moving } = foldForRemoval(
      books, await ledger.forBooks(books), id, removal.removal.into.id,
    )

    const keys = new Map((await tx.all<{ id: number; sort_key: string }>(
      `SELECT id, sort_key FROM books WHERE id IN (${books.map(() => '?').join(', ') || 'NULL'})`,
      books,
    )).map((row) => [Number(row.id), row.sort_key]))

    for (const book of moving) {
      await ledger.record({
        bookId: book.id,
        kind: 'assigned',
        areaId: book.to,
        sortKey: keys.get(book.id) ?? '',
        actor: 'rules',
        reason: `${planned.plan.area.label} was removed`,
        createdAt: now,
      })
    }

    return { ok: true as const, plan: planned.plan }
  }, { serialiseOn: FURNITURE_LOCK })
}

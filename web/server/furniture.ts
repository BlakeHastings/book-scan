/**
 * Describing the furniture: adding a piece, naming it, cutting it into areas,
 * reordering them, and taking one away.
 *
 * A label is derived at read time from a fixture's number and name and an area's
 * ordinal and name, and is stored nowhere, so renaming a bookcase relabels every
 * plank on it and moves no book. Each write here answers with `becomes`, every
 * label that reads differently afterwards, old to new.
 *
 * Removing an area is a merge, and it writes an `assigned` row naming the area
 * that absorbed the books rather than a placement:
 * `PATCH /api/books/:id/location` is the only route that changes where the
 * catalogue thinks a book is. A `placed` row also clears the pin, so writing one
 * per book on a merge would unpin every pinned book in the area. `pinned` beats
 * every rule, and every answer says how many books it left alone.
 */

import {
  fixtureLabel, labelFor, slotsInOrder, startsARun, type Area, type Fixture, type Slot,
} from '../domain/placement/geography'
import {
  addArea as landingFor, anchorsAscend, moveArea, removeArea, strategyChange,
  type LabelChange, type StrategyChange,
} from '../domain/placement/arrangement'
import { assignmentFor, standingOf, type Placement } from '../domain/placement/ledger'
import {
  byPrecedence, claim, entryAreaOf, entryAreas,
  type PlacementRule, type RuleOperator,
} from '../domain/placement/rules'
import { GENRE_RANGES } from '../domain/tagging/genre'
import { shelfImage, type ShelfRange, type ShelfSlot } from '../shared/shelving'
import {
  COLLECTION_STRATEGIES, INHERIT, SORT_STRATEGIES, strategyFor,
  type OrderingStrategy, type SortStrategy,
} from '../domain/placement/strategies'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { furnitureIn, retireOrRemove, ruleForRange } from '../infrastructure/shelving/areas'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import {
  anyArea, areaOnAFace, areasOnFaces, booksNaming, collectionId, collectionStrategy,
  everyArea, fixtureOnTheFloor, fixturesOnTheFloor, insertArea, insertFixture,
  nextFixturePosition, offerableStrategies, removeFixtureIfUnused, resequenceFace, retireFixture,
  updateArea, updateCollectionStrategy, updateFixture,
  whatHoldsFixture, type AreaRow, type FixtureHolds, type FixtureRow,
} from '../infrastructure/shelving/furniture'
import type { Db } from './driver'
import { withPhotographs, type PhotographFields } from './photographs'
import { tagCounts } from '../infrastructure/books/tag-counts'
import { recordWhatMoved, whereTheRunPutsThem } from './what-moved'

import { refuse, type Refused } from './refusal'
import {
  CLAIMS_NOTHING, holdsSaid as phraseFor, ruleSaid, type SaidLine,
} from '../domain/placement/phrasing'

export { refuse, type Refused }

/** The lock every write here takes, so two people rearranging one room queue. */
export const FURNITURE_LOCK = 'furniture'

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
 * One line of a rule on its way to a screen: what it asks, and whether anything
 * answers it yet. Zero carried is the state a prepared shelf is in, which is a
 * rule waiting rather than a rule broken.
 */
export interface RuleLineOut {
  operator: RuleOperator
  /** A tag as a person reads it. Never a slug: no read route hands one out. */
  tag: string
  /** Books carrying it, counting the ones under it. */
  carried: number
}

export interface DescribedRule {
  id: number
  name: string
  /** One area, or a whole piece and every area the run flows onto after it. */
  about: 'area' | 'fixture'
  /** What the place it points at reads as today. Derived, like every label. */
  place: string
  /**
   * Which area or piece that is. The label of a piece is its number, and how a
   * screen says a piece out loud is the screen's business, so this is only the
   * id.
   */
  placeId: number | null
  enabled: boolean
  /**
   * What it asks of a book, in the words a person reads. Labels and no slugs: no
   * slug leaves this route. Writing has a read of its own,
   * `GET /api/placement/rule`, which speaks identities.
   */
  conditions: RuleLineOut[]
  /** The whole of it as one phrase: "Anything tagged Cookery". */
  said: string
  /**
   * Which of the two stretches of books this rule is the one for, decided by
   * `ruleForRange` so that a screen does not work the pairing out for itself.
   * Null on any other rule, which says this app has no way to point that rule
   * somewhere else yet.
   */
  range: ShelfRange | null
}

/**
 * A rule's lines with the tags named, which is the one direction that is safe:
 * the label is what a person reads and the slug is the identity, which never
 * reaches a screen. An empty string is what a slug the vocabulary has no label
 * for answers, and `ruleSaid` falls back to the rule's own name rather than
 * printing it.
 */
const linesOf = (rule: PlacementRule, labels: Map<string, string>): SaidLine[] =>
  rule.conditions.map((condition) => ({
    operator: condition.operator,
    tag: labels.get(condition.value) ?? '',
  }))

const ruleHolds = (rule: PlacementRule, labels: Map<string, string>): string =>
  ruleSaid(linesOf(rule, labels), rule.name)

/**
 * The same lines with the count beside each one, which is what a screen draws.
 * Separate from `linesOf` so that `SaidLine`, which a phrase is built from,
 * stays the shape of a sentence.
 */
const conditionsOf = (
  rule: PlacementRule,
  labels: Map<string, string>,
  carried: Map<string, number>,
): RuleLineOut[] => rule.conditions.map((condition) => ({
  operator: condition.operator,
  tag: labels.get(condition.value) ?? '',
  carried: carried.get(condition.value) ?? 0,
}))

/**
 * What a place holds, given every rule written on it. Two rules on one place is
 * how this app says "or": `and` adds a line to a rule and `or` adds a rule to
 * the place, and neither is a nested group. The wording itself lives in
 * `domain/placement/phrasing.ts`, because a screen writing a rule has to draw
 * this sentence for a rule that is not a row yet.
 */
export const holdsSaid = (
  rules: readonly PlacementRule[],
  labels: Map<string, string>,
): string => phraseFor(rules.map((rule) => ({ lines: linesOf(rule, labels), name: rule.name })))

/**
 * What a rule is called, worked out from its own lines: a rule is named by what
 * it asks for, so one still called Fiction while asking for comic books is not
 * possible. A rule that asks for nothing is called nothing, which is the
 * schema's own default.
 */
export const ruleName = (lines: readonly { operator: RuleOperator; tag: string }[]): string =>
  lines.map((line) => line.tag).filter(Boolean).join(' and ')

/**
 * What the place a rule points at reads as: the plank for an area rule, the
 * piece for a fixture rule. Empty for a rule pointing at furniture that is not
 * standing, which is its own defect and does not get a name invented to paper
 * over it.
 */
export function placeSaid(rule: PlacementRule, order: readonly Slot[]): string {
  const slot = order.find((one) => one.area.id === entryAreaOf(rule, order as Slot[]))
  if (!slot) return ''
  return rule.areaId !== null ? labelFor(slot) : fixtureLabel(slot.fixture)
}

function describeRule(
  rule: PlacementRule,
  order: readonly Slot[],
  labels: Map<string, string>,
  carried: Map<string, number>,
  range: ShelfRange | null,
): DescribedRule {
  return {
    id: rule.id,
    name: rule.name,
    about: rule.areaId !== null ? 'area' : 'fixture',
    place: placeSaid(rule, order),
    placeId: rule.areaId ?? rule.fixtureId,
    enabled: rule.enabled,
    conditions: conditionsOf(rule, labels, carried),
    said: ruleHolds(rule, labels),
    range,
  }
}

/**
 * Every rule, described, keyed on its id. One place rather than a call per rule,
 * because `range` is a fact about the whole list: `ruleForRange` picks one row
 * per stretch of books, and a rule that asked the question about itself could
 * not tell whether it was the one that got picked.
 */
export function describeRules(
  order: readonly Slot[],
  rules: readonly PlacementRule[],
  labels: Map<string, string>,
  carried: Map<string, number>,
): Map<number, DescribedRule> {
  const serves = new Map<number, ShelfRange>()
  for (const { range } of GENRE_RANGES) {
    const rule = ruleForRange(rules as PlacementRule[], range)
    if (rule && !serves.has(rule.id)) serves.set(rule.id, range)
  }

  return new Map(rules.map((rule) =>
    [rule.id, describeRule(rule, order, labels, carried, serves.get(rule.id) ?? null)]))
}

/** The vocabulary as the rules quote it: slug to the label a person reads. */
export async function tagLabels(db: Db): Promise<Map<string, string>> {
  const vocabulary = await new DrizzleTagRepository(db).vocabulary()
  return new Map(vocabulary.map((tag) => [tag.slug.value, tag.label]))
}

/**
 * The vocabulary as the rules are judged by it: slug to how many books carry it.
 * The same rollup `/api/tags` answers with, from the same query.
 */
export async function tagCarried(db: Db): Promise<Map<string, number>> {
  return new Map((await tagCounts(db)).map((one) => [one.slug, one.books]))
}

/**
 * Which rules' books reach an area, and whether the area opens that stretch.
 * Plural because two rules can be written on one place, which is how this app
 * says "or": they open the same stretch and point at the same area, so what
 * changes is that the sentence about what belongs there has to name both.
 */
interface RunOwner {
  /** Every rule reaching here, the one about the smaller place first. */
  rules: PlacementRule[]
  entry: boolean
}

/**
 * The rule whose books reach each area, walking the collection in order. The
 * same two breaks `runFrom` makes: an area a rule points at opens a run, and so
 * does an area that orders itself, because a continuous run only works while
 * every area in it orders the same way. An area that opens a run nothing points
 * at carries no rule, and neither does anything after it.
 */
function runOwners(order: readonly Slot[], rules: readonly PlacementRule[]): Map<number, RunOwner> {
  const entries = entryAreas(rules as PlacementRule[], order as Slot[])
  const opens = new Map<number, PlacementRule[]>()
  for (const rule of [...rules].sort(byPrecedence)) {
    const at = entryAreaOf(rule, order as Slot[])
    if (at === null) continue
    opens.set(at, [...(opens.get(at) ?? []), rule])
  }

  const owners = new Map<number, RunOwner>()
  let carrying: PlacementRule[] = []
  for (const slot of order) {
    if (startsARun(slot, entries)) {
      carrying = opens.get(slot.area.id) ?? []
      owners.set(slot.area.id, { rules: carrying, entry: true })
    } else {
      owners.set(slot.area.id, { rules: carrying, entry: false })
    }
  }
  return owners
}

/**
 * What an area holds, said the way somebody standing in front of it would say
 * it. Four answers and no fifth: the rule that opens the run here, the run
 * carrying on from the area before, a rule that is turned off, and nothing at
 * all. The last is not a gap: a piece nothing files onto is a piece somebody
 * fills by hand.
 */
function areaHolds(owner: RunOwner | undefined, labels: Map<string, string>): string {
  const reaching = owner?.rules ?? []
  if (!reaching.length) return 'Put here by hand'

  /*
   * A rule asking for nothing claims nothing, whether it is the rule of this
   * area or of the piece the area stands on, and whether it is on or off. First
   * of the answers rather than last, because "carrying on" said of a rule that
   * claims no book is what somebody halfway through writing one would read on
   * every area after the one they are looking at.
   */
  const claiming = reaching.filter((rule) => rule.enabled && rule.conditions.length > 0)
  if (!claiming.length) {
    return reaching.some((rule) => rule.conditions.length === 0)
      ? CLAIMS_NOTHING
      : `${named(reaching)} is turned off, so nothing files here`
  }

  if (!owner!.entry) return `${named(claiming)}, carrying on`

  /*
   * The rules written on this area beat the piece's, so they are what the area
   * says it holds. Where there are none it is the piece's stretch beginning
   * here, which is a different sentence: the books carry on past this area.
   */
  const own = claiming.filter((rule) => rule.areaId !== null)
  return own.length ? holdsSaid(own, labels) : `${named(claiming)} starts here`
}

/** Rules said by name, joined the way a person reads two of them: "A or B". */
const named = (rules: readonly PlacementRule[]): string =>
  rules.map((rule) => rule.name || 'A rule with no name').join(' or ')

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
  /**
   * True when the plank has been taken out and its row kept. It is not on the
   * piece any more and not in `DescribedFixture.areas`; what it still has is
   * books standing on it. See `DescribedFixture.gone`.
   */
  gone: boolean
  /** What files here, in words. Never empty: "Put here by hand" is an answer. */
  holds: string
  /** Whether a run begins here rather than flowing in from the area before. */
  entry: boolean
  /** The rule whose books reach here, or null where none does. */
  rule: DescribedRule | null
  /**
   * Every rule written on this area, which is a different question from `rule`:
   * that is about the stretch of books and may be the piece's rule carrying on
   * through here. Empty is a real answer: an area nothing is written on takes
   * what the piece sends it.
   */
  own: DescribedRule[]
}

export interface DescribedFixture {
  id: number
  position: number
  label: string
  kind: string
  name: string
  sortStrategy: SortStrategy
  note: string
  /**
   * Every book standing on this piece, including the ones on planks that have
   * been taken out: `areas` is what the piece has, and this is what is on the
   * piece.
   */
  books: number
  /** The areas the piece has, in the order they sit on its face. */
  areas: DescribedArea[]
  /**
   * The planks that have been taken out and still have books standing on them.
   * Kept apart from `areas` because merging them would put a plank that is not
   * there into every count of the face, every reorder and every derived
   * boundary. A retired plank with nothing standing on it is not in here.
   */
  gone: DescribedArea[]
  /** The other pieces standing on this piece's number, if any. See below. */
  sharing: number[]
  /** What a rule about the whole piece sends here, in words. */
  holds: string
  /** The first of those rules, or null when nothing points at the piece. */
  rule: DescribedRule | null
  /** Every rule written on the piece itself. Two of them is "or". */
  own: DescribedRule[]
}

export interface DescribedFurniture {
  fixtures: DescribedFixture[]
  defaultSortStrategy: SortStrategy
  strategies: { code: SortStrategy; label: string; isInherit: boolean }[]
}

/**
 * The whole room, in the order a book meets it. `sharing` is the honest half of
 * `fixture.position` not being unique: two pieces on one number draw planks with
 * the same label, so a screen that did not know would show one twice with no
 * explanation.
 */
export async function describeFurniture(db: Db): Promise<DescribedFurniture> {
  const [fixtures, areas, fallback, strategies, arrangement, vocabulary] = await Promise.all([
    fixturesOnTheFloor(db), everyArea(db), collectionStrategy(db), offerableStrategies(db),
    furnitureIn(db), new DrizzleTagRepository(db).vocabulary(),
  ])
  const carried = await tagCarried(db)

  const collection = (fallback === INHERIT ? 'author' : fallback) as OrderingStrategy
  const labels = new Map(vocabulary.map((tag) => [tag.slug.value, tag.label]))
  const owners = runOwners(arrangement.order, arrangement.rules)
  const described = describeRules(arrangement.order, arrangement.rules, labels, carried)
  /*
   * Every rule written on one place, in the order a tie is settled. Two rules on
   * a place is how "this tag or that tag" is said, and both point at the same
   * area, so which one `claim` picks makes no difference to where a book lands.
   */
  const writtenOn = (about: 'area' | 'fixture', id: number): PlacementRule[] =>
    [...arrangement.rules]
      .sort(byPrecedence)
      .filter((rule) => (about === 'area' ? rule.areaId === id : rule.fixtureId === id))

  const describeArea = (fixture: FixtureRow, area: AreaRow): DescribedArea => ({
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
    gone: area.gone,
    holds: areaHolds(owners.get(area.id), labels),
    entry: owners.get(area.id)?.entry ?? false,
    rule: (() => {
      const [won] = owners.get(area.id)?.rules ?? []
      return won ? described.get(won.id) ?? null : null
    })(),
    own: writtenOn('area', area.id)
      .map((rule) => described.get(rule.id))
      .filter((rule): rule is DescribedRule => rule !== undefined),
  })

  return {
    fixtures: fixtures.map((fixture) => {
      const here = areas.filter((one) => one.fixtureId === fixture.id)
      const own = here.filter((one) => !one.gone)
      const gone = here.filter((one) => one.gone && one.books > 0)
      const about = writtenOn('fixture', fixture.id)
      return {
        id: fixture.id,
        position: fixture.position,
        label: fixtureLabel(asFixture(fixture)),
        kind: fixture.kind,
        name: fixture.name,
        sortStrategy: fixture.sortStrategy,
        note: fixture.note,
        books: here.reduce((total, one) => total + one.books, 0),
        areas: own.map((area) => describeArea(fixture, area)),
        gone: gone.map((area) => describeArea(fixture, area)),
        sharing: fixtures
          .filter((one) => one.id !== fixture.id && one.position === fixture.position)
          .map((one) => one.id),
        holds: about.length ? holdsSaid(about, labels) : 'No rule sends books here',
        rule: about[0] ? described.get(about[0].id) ?? null : null,
        own: about
          .map((rule) => described.get(rule.id))
          .filter((rule): rule is DescribedRule => rule !== undefined),
      }
    }),
    defaultSortStrategy: fallback,
    strategies,
  }
}

export async function describeFixture(
  db: Db,
  id: number,
): Promise<DescribedFixture | null> {
  return (await describeFurniture(db)).fixtures.find((one) => one.id === id) ?? null
}

/**
 * One book standing somewhere, as the screens about that place need it. The four
 * ordering components travel with it so a screen can show what an ordering does
 * to these books rather than only naming it. Which photograph stands in for a
 * spine is `shelfImage`'s answer and not this file's, so the board here and the
 * board in the library cannot disagree about a book.
 */
export interface AreaBook {
  id: number
  title: string
  authorFiling: string
  /**
   * The photograph standing in for this book's spine, or '' where there is
   * none and the cloth underneath is the whole drawing.
   */
  spine: string
  /** Which face `spine` really is, so a cover cannot pass for a spine. */
  spineSlot: ShelfSlot
  /**
   * How thick it is, as the catalogue holds it, which is text. Empty for about
   * one book in four, which `spineWidth` draws at the median rather than as a
   * gap.
   */
  pages: string
  /** How it files by title, which is what the title ordering reads. */
  titleFiling: string
  /** As printed, usually a bare year, which is what the year ordering reads. */
  published: string
  /** Where it sits in the order, which is what a boundary is anchored to. */
  sortKey: string
  /** Every slug it carries, in slug order, which is what a rule matches on. */
  tagSlugs: string[]
  /**
   * The same tags as a person reads them, in the same order. A slug is an
   * identity and never reaches a screen, so ordering and drawing agree by
   * construction rather than by two reads happening to come back the same way.
   */
  tags: string[]
  /** The rule that claims it, by name, or null when nothing claims it. */
  claimedBy: string | null
}

export interface AreaBooks {
  /** `gone` is a plank taken out with books still standing on it. */
  area: { id: number; label: string; books: number; gone: boolean }
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
  pages: string | null
  slugs: string[] | null
  labels: string[] | null
}

/**
 * The same row with its photographs joined on, which is what a board needs. They
 * come off `capture` rather than off a column, and `withPhotographs` is the one
 * place a row gets them back, in one read for the whole area rather than one per
 * book.
 */
type StandingPhotographedRow = StandingRow & PhotographFields

/**
 * The columns every "what is standing here" read takes, and the one place they
 * are written. Every one of them is a component of some ordering
 * (`domain/placement/strategies.ts`), because the screens show what an ordering
 * does to these books rather than only naming it, and `pages` is there because
 * how thick a book is decides how wide its spine is drawn.
 */
const STANDING_COLUMNS =
  `b.id, b.title, b.author_filing, b.title_filing, b.published, b.sort_key, b.pages,
          array_remove(array_agg(t.slug ORDER BY t.slug), NULL) AS slugs,
          array_remove(array_agg(t.label ORDER BY t.slug), NULL) AS labels`

const STANDING_GROUP =
  'b.id, b.title, b.author_filing, b.title_filing, b.published, b.sort_key, b.pages'

const asStandingBook = (row: StandingPhotographedRow, rules: PlacementRule[]): AreaBook => {
  const photo = shelfImage({
    front: row.front_image ?? '',
    back: row.back_image ?? '',
    edge: row.edge_image ?? '',
    /* The crop of whichever face was picked, so a spine two centimetres wide
       is not drawn with the room it was photographed in around it. */
    crops: {
      front: row.front_crop ?? '',
      back: row.back_crop ?? '',
      edge: row.edge_crop ?? '',
    },
  })

  return {
    id: Number(row.id),
    title: row.title,
    authorFiling: row.author_filing ?? '',
    spine: photo.name,
    spineSlot: photo.slot,
    pages: row.pages ?? '',
    titleFiling: row.title_filing ?? '',
    published: row.published ?? '',
    sortKey: row.sort_key,
    tagSlugs: row.slugs ?? [],
    tags: row.labels ?? [],
    claimedBy: claim(rules, { tagSlugs: row.slugs ?? [] })?.name ?? null,
  }
}

/**
 * The books standing in one area, in the order they stand, by identity.
 * `current_area_id` is the answer, and it is the same number the count on the
 * area is taken from (`areasOnFaces`), so the list and the count are one fact
 * rather than two readings that agree today. An assignment nobody has acted on
 * does not move a book and does not appear here. A plank that has been taken out
 * still answers here and says so, because the books standing on it are recorded
 * on it until somebody carries them; `planAreaRemoval` still reads the face,
 * because an area that is not on the piece cannot be taken off it.
 */
export async function booksInArea(db: Db, id: number): Promise<ReadArea> {
  const area = await anyArea(db, id)
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
      gone: area.gone,
    },
    books: rows.map((row) => asStandingBook(row, rules)),
  }
}

/**
 * The books standing on one piece of furniture, in the order they stand. A piece
 * nothing has been filed onto answers an empty list, which is not a 404: the
 * piece is there and holds nothing. Every area of the piece and not only its
 * face, for the reason `DescribedFixture.books` counts them all.
 */
export async function booksOnFixture(db: Db, id: number): Promise<ReadFixtureBooks> {
  const fixture = await fixtureOnTheFloor(db, id)
  if (!fixture) return refuse(404, 'No such piece of furniture.')

  const here = (await everyArea(db)).filter((area) => area.fixtureId === id)
  const rows = here.length ? await standingIn(db, here.map((area) => area.id)) : []
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
async function standingIn(
  db: Db,
  areaIds: readonly number[],
): Promise<StandingPhotographedRow[]> {
  if (areaIds.length === 0) return []
  const holes = areaIds.map(() => '?').join(', ')
  const rows = await db.all<StandingRow>(
    `SELECT ${STANDING_COLUMNS}
       FROM catalogued_books b
       LEFT JOIN book_tag bt ON bt.book_id = b.id
       LEFT JOIN tag t ON t.id = bt.tag_id
      WHERE b.current_area_id IN (${holes})
      GROUP BY ${STANDING_GROUP}
      ORDER BY b.sort_key`,
    [...areaIds],
  )

  // One read for the whole area rather than one per book, which is why
  // `withPhotographs` takes the rows.
  return withPhotographs(db, rows)
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
 * in `order`. One function for all four ways a label can change, because to a
 * person they are one thing. An area that is being added has no old label and is
 * left out.
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

/**
 * Every label that reads differently once these areas come off their pieces. The
 * half of an area removal that is about names rather than about books, which a
 * boundary move whose book was the only one on its plank also needs. Removing
 * one area renumbers every area after it, so the rows are read from the same
 * face the writer renumbers.
 */
export async function relabellingWithout(
  db: Db,
  areaIds: readonly number[],
): Promise<LabelChange[]> {
  const going = new Set(areaIds)
  const pieces = new Set<number>()
  for (const id of areaIds) {
    const area = await areaOnAFace(db, id)
    if (area) pieces.add(area.fixtureId)
  }

  const changes: LabelChange[] = []
  for (const id of pieces) {
    const fixture = await fixtureOnTheFloor(db, id)
    if (!fixture) continue
    const face = await faceOf(db, fixture)
    const order = face.map((slot) => slot.area.id).filter((one) => !going.has(one))
    changes.push(...relabelling(face, face, order))
  }
  return changes
}

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
 * Change what the whole collection falls back on. `inherit` has nothing above it
 * to ask, which is a check constraint on the column, and `tag` is refused
 * because ordering a whole house by the first tag slug on each book files a
 * library by an accident of the vocabulary; both come off
 * `COLLECTION_STRATEGIES` in the domain, so the list is stated once. It writes
 * one column and moves nothing: where a book belongs is worked out whenever
 * anybody asks, and where a book is only changes when a person carries it.
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
 * Put a piece of furniture in the room. It arrives with no areas, because an
 * area is a decision about where one run of books stops and the next begins, and
 * a piece somebody has only just named has no books on it to cut. The number
 * defaults to one past the last piece.
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
 * Renaming a piece moves nothing. Renumbering it moves books, and this writes
 * down which: `runAreasOf` orders the run by `f.position, f.id, a.position`, so
 * the number is the order the run walks the room in, and where a second piece
 * already stands at the number the loser's planks leave the run altogether,
 * since the run keeps one fixture per position and `fixture.position` is
 * deliberately not unique. Only a renumber records, because only a renumber
 * moves the run: a name, a kind and a note are read by no derivation, and a
 * `sortStrategy` orders books inside a run without changing which plank a sort
 * key lands on.
 *
 * Pointing a run at a different piece is the other request and lives in
 * `relocate-run.ts`.
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

    /*
     * Every range, not the one this piece is on. A piece has no range of its
     * own: which run owns its planks is decided by where the rules' entries
     * stand and where the next run begins, both read off the very numbers this
     * write changes, so asking which range it was in before the write answers
     * about a room that is about to stop existing. The comparison writes nothing
     * for a range whose run did not move.
     */
    const renumbering = position !== undefined && position !== before.position
    const was = new Map<ShelfRange, Awaited<ReturnType<typeof whereTheRunPutsThem>>>()
    if (renumbering) {
      for (const { range } of GENRE_RANGES) {
        was.set(range, await whereTheRunPutsThem(tx, range))
      }
    }

    await updateFixture(tx, id, {
      kind: asText(input.kind),
      name,
      position,
      sortStrategy: strategy,
      note: asText(input.note),
    })

    /*
     * After the write and inside the same transaction, so a renumber that fails
     * to write leaves no assignment behind either. The lock is `FURNITURE_LOCK`
     * rather than the range's, which is what every write in this file takes: a
     * renumber is a statement about the room.
     */
    const now = new Date().toISOString()
    for (const [range, snapshot] of was) {
      await recordWhatMoved(
        tx,
        range,
        snapshot,
        `${fixtureLabel(asFixture(before))} was renumbered`,
        now,
      )
    }

    const fixture = await describeFixture(tx, id)
    return fixture
      ? { ok: true as const, fixture, becomes }
      : refuse(500, 'The piece was not written.')
  }, { serialiseOn: FURNITURE_LOCK })
}

export interface FixtureRemoval {
  /**
   * How many books the piece is still about, which is what has to leave first:
   * standing on one of its planks, or assigned to one and not carried yet. See
   * `whatHoldsFixture`.
   */
  books: number
  /** How many of `books` are on their way to it rather than standing on it. */
  assigned: number
  areas: number
  /** How many placement rules point at it or at one of its areas. */
  rules: number
  /**
   * Whether the row will stay behind, off the floor, rather than being deleted.
   * A piece whose areas a book was ever placed in cannot be deleted:
   * `book_placement.area_id` is ON DELETE RESTRICT, so the history pins the
   * furniture it names and a plank a book once sat on stays nameable. Such a
   * piece is taken off the floor rather than out of the catalogue.
   */
  retires: boolean
}

/**
 * Why a piece cannot go yet, said as the two different jobs it would take:
 * books standing on it have to be carried off it, and books the carry list is
 * still sending to it have to be carried or left where they are. One number
 * covering both would tell somebody looking at an empty bookcase that it has a
 * book on it.
 */
function stillHolds(holds: FixtureHolds): string {
  const standing = holds.books - holds.assigned
  const said = [
    standing
      ? `its ${standing} book${standing === 1 ? '' : 's'} move to other furniture first`
      : '',
    holds.assigned
      ? `the carry list is still sending ${holds.assigned} `
        + `book${holds.assigned === 1 ? '' : 's'} to it`
      : '',
  ].filter(Boolean).join(', and ')

  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`
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
 * Take a piece of furniture away, once nothing is standing on it. It refuses
 * while it still holds books, and says how many, because emptying a piece by
 * deleting it would either lose the books or leave them recorded on planks
 * nobody can walk to. A piece a placement rule points at is refused too:
 * deleting the furniture out from under the rule would leave its books
 * unplaceable.
 */
export async function dropFixture(db: Db, id: number): Promise<RemovedFixture> {
  return db.tx(async (tx) => {
    const fixture = await fixtureOnTheFloor(tx, id)
    if (!fixture) return refuse(404, 'No such piece of furniture.')

    const holds = await whatHoldsFixture(tx, id)
    if (holds.books) return refuse(409, stillHolds(holds), holds)
    if (holds.rules) {
      return refuse(
        409,
        `${holds.rules} rule${holds.rules === 1 ? '' : 's'} still file books here. `
          + 'Point them somewhere else first.',
        holds,
      )
    }

    // The areas go before the piece can, and one a book was ever placed in
    // cannot go at all. Such a piece is retired instead, which is `retires`: it
    // comes off the floor either way.
    for (const slot of await faceOf(tx, fixture)) {
      await retireOrRemove(tx, slot.area.id, slot.area.position)
    }

    const gone = await removeFixtureIfUnused(tx, id)
    if (!gone) await retireFixture(tx, id, fixture.position)
    return { ok: true as const, removed: { ...holds, retires: !gone } }
  }, { serialiseOn: FURNITURE_LOCK })
}

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
 * The character that sorts above anything a sort key can hold, used to make an
 * anchor that is past a known book and past nothing else. Only ever appended to
 * the greatest key in a run, where the only thing it decides is which of two
 * areas a book added later falls into.
 */
const PAST_EVERYTHING = '￿'

/**
 * Where an area opens when nobody said, which is every time one is added. Two
 * answers, and the difference is whether anything follows the new area in its
 * own run: if something does, the new area opens exactly where the next one
 * does, so no book moves; if nothing does, it is the end of the run and opens
 * past every book in it. It is never lower than the area it follows, because the
 * areas of a piece are read in the order the books run along it and the write is
 * refused when they do not ascend.
 */
async function anchorForNewArea(
  tx: Db,
  piece: Fixture,
  landing: number,
): Promise<string> {
  const { order, rules } = await furnitureIn(tx)
  const entries = entryAreas(rules, order)

  /*
   * The whole collection with the new area standing in it. Everything at or
   * after the landing on this face shuffles down, which is what the write itself
   * then does. The piece is put into the list rather than read off the areas,
   * because a piece with no areas yet appears in none of them and its first area
   * would be answered about somebody else's.
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
  if (after && !startsARun(after, entries)) return after.area.startsAt

  /*
   * The end of the run: past every book standing in it. The one walk over a run
   * this app makes backwards, which is why it is spelled out here rather than
   * asked of `runFrom`: that walks forward from a known entry, and this walks
   * back from a plank somebody has just added, whose entry is what it is looking
   * for. The cut is `startsARun` either way, asked rather than restated, because
   * a second answer to where a run begins would anchor this plank past books
   * standing in somebody else's run.
   */
  const run: number[] = []
  for (let back = at - 1; back >= 0; back -= 1) {
    const slot = grown[back]!
    run.push(slot.area.id)
    if (startsARun(slot, entries)) break
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
 * Cut another area into a piece of furniture. `startsAt` is the sort key the run
 * of books in it begins at: everything from there to the next boundary is one
 * area. Left out, `anchorForNewArea` works out where it opens; passing an empty
 * string is still saying "from the beginning" out loud, and is still refused on
 * a piece whose areas are already anchored. `position` puts it between two areas
 * that already exist and left out it goes on the end, and everything after it
 * shuffles down, which relabels those areas, moves no book and comes back in
 * `becomes`.
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
     * ordinal it wants: the unique index would refuse the insert while the area
     * already sitting there still holds the number. See `resequenceFace`.
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
 * An area with a sort strategy of its own takes no overflow, because a
 * continuous run only works if every area in it orders the same way. Setting one
 * therefore cuts the run the area is in, which is refused with the effect
 * attached until the caller says `acknowledge`.
 *
 * Moving an area along its piece renumbers everything between where it was and
 * where it is going, and is refused when it would leave the anchors on the face
 * out of order, because an area cannot begin before the one in front of it.
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
           * This sentence is shown to somebody, so it says none of the words the
           * code says to itself: "run" is on the list
           * `src/design/design.test.tsx` pins.
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

export interface AreaRemovalPlan {
  area: { id: number; label: string; books: number }
  /** The area they join, with the label it reads under today. */
  into: { id: number; label: string }
  joins: 'previous' | 'next'
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
 * What removing this area would do, before anybody agrees to it. Writes nothing,
 * and the same functions the write path uses answer it, so what somebody
 * approves is what happens.
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
 * Take an area off a piece of furniture and let its books fall into the next one
 * along, in one transaction and in this order: the area coming forward takes
 * over the anchor when the one going was first on its piece, the area is retired
 * rather than deleted whenever anything names it, the face is renumbered, and an
 * `assigned` row is written for every book the area was about, only where that
 * differs from where the book already is. Pinned, checked out and withdrawn
 * books get none, and nobody has carried anything: what has changed is which
 * area the rules say the books are in.
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

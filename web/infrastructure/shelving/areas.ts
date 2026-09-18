/**
 * The areas a range is cut into, and the boundaries they are read back as.
 *
 * The rows are the furniture and the boundary list is derived from them.
 * `areasOf` is the walk `layoutRange` makes and `boundariesFrom` is that walk
 * read backwards, so the two are inverses: a boundary written here comes back as
 * the boundary that was written.
 *
 * Where a range begins comes from a rule, a `placement_rule` pointing at a
 * fixture. `bandsOf` is the read, and it asks the rules through `GENRE_RANGES`,
 * the one table that pairs a genre slug with a range. A range's run stops where
 * the next range's begins, and a disagreement there is reported rather than
 * repaired.
 *
 * An area that has held a book is retired rather than deleted, because
 * `book_placement.area_id` is `ON DELETE RESTRICT`: the history pins the
 * furniture it names, and an area left sitting in the run would come back out of
 * `boundariesFrom` as a boundary nobody asked for. Retiring puts its `position`
 * negative, which takes it off the fixture's face while leaving the row and
 * every placement that names it where they are, and every read of the furniture
 * asks for `position >= 0`.
 *
 * The negative still names the plank, as `-(plank + 1)`, so a book placed on
 * `1C` before somebody removed the divider above it is still recorded on `1C`,
 * and the misfile list is what says the shelves no longer have one. See
 * `faceOf`, which is the encoding read back, and `writeBoundaries`, which brings
 * a retired plank back onto the face rather than making a second one beside it.
 */

import type { AreaFace } from '../../domain/placement/carry'
import {
  byPrecedence, entryAreaOf, entryAreas, nextRunStartAfter,
  type PlacementRule, type RuleOperator,
} from '../../domain/placement/rules'
import {
  labelFor, slotsInOrder, startsARun, type Area, type Fixture, type Slot,
} from '../../domain/placement/geography'
import type { SortStrategy } from '../../domain/placement/strategies'
import { GENRE_RANGES } from '../../domain/tagging/genre'
import type { Db } from '../../server/driver'
import type { PlankAt, RangeStart, Separator } from '../../shared/layout'
import type { AreaStanding, ShelfRange } from '../../shared/shelving'

export interface DerivedArea {
  /** The fixture's ordinal, 1-based, which is the `1` in `1A`. */
  fixturePosition: number
  /** The area's ordinal within it, 0-based, which is the `A` in `1A`. */
  position: number
  /**
   * The sort key of the first book on it. Empty on the first area of a run.
   *
   * The empty one is the walk's, not the row's: it says "from the beginning"
   * about the plank a book lands on before it has passed a boundary, and the
   * first area of a run has no boundary above it to anchor. Where the run begins
   * is the rule's answer, asked through `bandsOf`, and `writeBoundaries`
   * deliberately does not copy it into `area.starts_at`: a row that held it
   * would go on holding it after the rule moved the entry elsewhere, and a
   * boundary anchored below every book takes the whole ordinal walk with it.
   */
  startsAt: string
}

/**
 * The areas a run is cut into, walked exactly as `layoutRange` walks it.
 *
 * Sorted by anchor, which is the sort `layoutRange` makes. Two boundaries on one
 * anchor is what a boundary move that empties an area leaves behind, and the two
 * have to be stepped over in the order they were recorded or a plank's worth of
 * books draws on the plank before.
 *
 * The run's first area is anchored at the empty string, which sorts below every
 * sort key this catalogue can hold. That is how "from the beginning" is said
 * without a null.
 */
export function areasOf(start: RangeStart, separators: readonly Separator[]): DerivedArea[] {
  const ordered = [...separators]
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0)
      || (a.position - b.position))

  let fixturePosition = start.shelf
  let position = start.area
  const areas: DerivedArea[] = [{ fixturePosition, position, startsAt: '' }]

  for (const separator of ordered) {
    if (separator.kind === 'shelf') {
      // A whole bookcase ended, so the next area is the top of the next one.
      fixturePosition += 1
      position = 0
    } else {
      position += 1
    }
    areas.push({ fixturePosition, position, startsAt: separator.startsAt })
  }

  return areas
}

export interface RunArea extends DerivedArea {
  id: number
}

/**
 * `areasOf` read backwards: the boundaries a run of areas is cut by.
 *
 * The first area of a run opens at nothing and is therefore not a boundary; each
 * one after it is, anchored where the area starts. A boundary's kind is not
 * stored: `shelf` means an area whose fixture is not the previous area's, and
 * deriving it is what makes this the inverse of `areasOf` rather than a second
 * opinion about the same shelves.
 *
 * The id is the area's, so a boundary is identified by the area it opens, and an
 * area's identity is its place in the run. Everything that acts on a boundary id
 * reads the list and acts on it inside one transaction, and the retraction,
 * which is the only thing that carries an id across requests, checks where the
 * book landed afterwards and refuses rather than trusting what it found.
 */
export function boundariesFrom(range: ShelfRange, areas: readonly RunArea[]): Separator[] {
  return areas.slice(1).map((area, at): Separator => ({
    id: area.id,
    range,
    kind: area.fixturePosition > areas[at]!.fixturePosition ? 'shelf' : 'area',
    startsAt: area.startsAt,
    position: at,
  }))
}

/**
 * A range's run, and the furniture that run is reconciled and moved over.
 *
 * Two ends answering two questions, and each caller says which it is asking.
 * `end` is where the run stops, which is a plank, because a run runs from its
 * rule's entry area until the next area any rule points at. `limit` is where a
 * move stops, which is a bookcase, because a move rehangs whole pieces and a
 * piece somebody else's run begins on is that run's furniture. See
 * `docs/shelving.md`.
 *
 * `end` is undefined exactly when `limit` is: nothing stands past this run.
 */
export interface RangeBand {
  start: RangeStart
  /**
   * The first plank past this run, or undefined when no run begins after it.
   *
   * Exclusive, and a plank rather than a bookcase: `2C` here means the run has
   * `2A` and `2B` and stops.
   */
  end?: PlankAt
  /**
   * One past the last bookcase a move of this range may pick up, or undefined
   * for the last run in the room.
   *
   * `nextRunStartAfter` read as furniture. Never below `end.shelf`, and above
   * it exactly when another run opens on the piece this one opens on.
   */
  limit?: number
}

interface RuleRow {
  id: number
  area_id: number | null
  fixture_id: number | null
  priority: number
  name: string
  enabled: boolean
}

interface ConditionRow {
  rule_id: number
  field: 'tag'
  operator: RuleOperator
  value: string
}

interface FixtureRow {
  id: number
  position: number
  kind: string
  name: string
  sort_strategy: SortStrategy
}

interface AreaRow {
  id: number
  fixture_id: number
  position: number
  name: string
  starts_at: string
  sort_strategy: SortStrategy
}

/**
 * Every tag slug a placement rule asks for, whether or not anything carries it.
 * A rule's condition is a string rather than a reference, so a slug in here need
 * not be a row in `tag`.
 *
 * `seed-world.ts` writes the same predicate in SQL of its own, deliberately: it
 * runs in its own process against a target named on its command line, and
 * importing this would give it a route to a connection it is written not to
 * have.
 */
export async function tagsRulesName(db: Db): Promise<Set<string>> {
  const rows = await db.all<{ value: string }>(
    "SELECT DISTINCT value FROM rule_condition WHERE field = 'tag'",
  )
  return new Set(rows.map((row) => row.value))
}

/**
 * The furniture and the rules, read back out of the rows.
 *
 * `position >= 0` is the whole of what keeps a retired area out. It is written
 * here rather than in `slotsInOrder`, because the domain has no notion of
 * furniture that has been taken out: what it is handed is the collection as it
 * stands.
 */
export async function furnitureIn(
  db: Db,
): Promise<{ order: Slot[]; rules: PlacementRule[] }> {
  const fixtures = await db.all<FixtureRow>(
    'SELECT id, position, kind, name, sort_strategy FROM fixture WHERE position >= 0',
  )
  const areas = await db.all<AreaRow>(
    `SELECT id, fixture_id, position, name, starts_at, sort_strategy
       FROM area WHERE position >= 0`,
  )
  const rules = await db.all<RuleRow>(
    'SELECT id, area_id, fixture_id, priority, name, enabled FROM placement_rule',
  )
  const conditions = await db.all<ConditionRow>(
    'SELECT rule_id, field, operator, value FROM rule_condition ORDER BY id',
  )

  const order = slotsInOrder(
    fixtures.map((row): Fixture => ({
      id: row.id, position: row.position, kind: row.kind, name: row.name,
      sortStrategy: row.sort_strategy,
    })),
    areas.map((row): Area => ({
      id: row.id, fixtureId: row.fixture_id, position: row.position, name: row.name,
      startsAt: row.starts_at, sortStrategy: row.sort_strategy,
    })),
  )

  return {
    order,
    rules: rules.map((row): PlacementRule => ({
      id: row.id,
      areaId: row.area_id,
      fixtureId: row.fixture_id,
      priority: row.priority,
      name: row.name,
      enabled: row.enabled,
      conditions: conditions
        .filter((condition) => condition.rule_id === row.id)
        .map(({ field, operator, value }) => ({ field, operator, value })),
    })),
  }
}

/**
 * Where each range begins, and where it has to stop.
 *
 * The rule that serves a range is the one asking for that range's genre slug,
 * and `GENRE_RANGES` is the single place a slug and a range are the same fact.
 * Which of them serves the range, when two rules name one genre, is
 * `ruleForRange`'s answer and not a second one made here.
 *
 * A disabled rule still says where its run begins, for the reason `entryAreas`
 * counts one: turning a rule off stops it claiming books and does not merge its
 * run into the one before it.
 */
export async function bandsOf(db: Db): Promise<Map<ShelfRange, RangeBand>> {
  const { order, rules } = await furnitureIn(db)
  const entries = entryAreas(rules, order)

  const bands = new Map<ShelfRange, RangeBand>()
  for (const { range } of GENRE_RANGES) {
    const rule = ruleForRange(rules, range)
    if (!rule) continue

    const areaId = entryAreaOf(rule, order)
    const at = order.findIndex((one) => one.area.id === areaId)
    if (at === -1) continue

    const slot = order[at]!
    const start: RangeStart = { shelf: slot.fixture.position, area: slot.area.position }

    /*
     * Where the next run begins, said twice because two questions are being
     * asked, and neither of them is "where does the next range begin". A bound
     * of the next range's bookcase is this range's own bookcase when two runs
     * open on one piece, which bounds the earlier range at its own start and
     * gives it no run at all.
     *
     * Both come from `startsARun`, which is `runFrom`'s own cut: one read a
     * plank at a time for the run, one read a piece at a time for the move.
     */
    const past = order.slice(at + 1).find((one) => startsARun(one, entries))
    const end = past
      ? { shelf: past.fixture.position, area: past.area.position }
      : undefined

    bands.set(range, { start, end, limit: nextRunStartAfter(order, rules, start.shelf) })
  }
  return bands
}

/** Where one range begins, or null when no rule points anywhere for it. */
export async function bandOf(db: Db, range: ShelfRange): Promise<RangeBand | null> {
  return (await bandsOf(db)).get(range) ?? null
}

/**
 * The rule that serves a range, and the one answer to which rule that is:
 * `bandsOf` asks this rather than choosing again. `GENRE_RANGES` is the one
 * place a genre slug and a shelf range are the same fact.
 *
 * Two rules may name one genre, which is legal. When they do, this picks the one
 * `claim` would hand a book carrying that genre: `byPrecedence` is the ladder
 * `claim` sorts by, imported rather than copied. It is the ordering that is
 * shared and not the question, so putting a synthetic book through `claim`
 * instead would answer a third one: `matches` needs every condition to hold, and
 * `under` would make a rule about the whole `genre` tree into both ranges' rule
 * at once.
 *
 * A switched-off rule is tried last rather than left out, deliberately, which is
 * the one place this answers where `claim` answers nothing. Turning a rule off
 * stops it claiming books and does not merge its run into the one before it, so
 * a range whose only rule is off still has a run, still empty, standing where it
 * stood. Ordering enabled first is what keeps the two together when a range has
 * one rule on and one off.
 */
export function ruleForRange(rules: PlacementRule[], range: ShelfRange): PlacementRule | null {
  const slug = GENRE_RANGES.find((pair) => pair.range === range)?.slug
  if (!slug) return null

  return rules
    .filter((rule) => rule.conditions.some((condition) =>
      condition.field === 'tag' && condition.value === slug.value))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || byPrecedence(a, b))[0] ?? null
}

/** The same, for a caller that has not already read the furniture. */
export async function runRuleOf(db: Db, range: ShelfRange): Promise<PlacementRule | null> {
  return ruleForRange((await furnitureIn(db)).rules, range)
}

interface PlankRow {
  id: number
  fixture_id: number
  fixture_position: number
  fixture_name: string
  fixture_kind: string
  position: number
  name: string
  starts_at: string
  sort_strategy: SortStrategy
  note: string
  books: number
}

export interface StandingArea extends AreaFace {
  id: number
  fixtureName: string
  fixtureKind: string
  /** The plank it is, decoded, so a retired `4A` is still an `A`. */
  position: number
  name: string
  startsAt: string
  sortStrategy: SortStrategy
  note: string
  /** True when it has been taken off the face and the row kept. */
  gone: boolean
  /** Books standing on it, which is where somebody last said they were. */
  books: number
}

/**
 * Every area there has ever been, with what it reads as, where it stands, and
 * how many books are standing on it.
 *
 * This is the one answer to "where are the books". The face reads filter
 * `position >= 0`, which is right for drawing a piece of furniture and wrong for
 * counting what is on it, so there is exactly one statement in this app that
 * counts the books standing on an area, it is below, and it does not know what a
 * retired area is. `areasOnFaces` narrows it to the face for everything that
 * draws furniture, and `everyArea` hands it over whole to the reads that have to
 * account for books.
 *
 * `furnitureIn` answers the collection as it stands and so cannot answer this: a
 * book can be recorded on a plank somebody has since taken out, and what a
 * person wrote down is still `4A`. Same reading as `withPlacements` makes for
 * the wire, through the same `labelFor` and the same `faceOf`, so a plan names
 * the plank the catalogue names.
 *
 * Keyed on the id, because a label is a rendering of an area and changes the
 * moment somebody names a piece. Anything deciding whether two places are the
 * same place reads the key, and anything showing a person where to walk reads
 * the label.
 */
export async function areasStanding(db: Db): Promise<StandingArea[]> {
  const rows = await db.all<PlankRow>(
    `SELECT a.id, a.position, a.name, a.starts_at, a.sort_strategy, a.note,
            f.id AS fixture_id, f.position AS fixture_position,
            f.name AS fixture_name, f.kind AS fixture_kind,
            (SELECT count(*) FROM books b WHERE b.current_area_id = a.id) AS books
       FROM area a JOIN fixture f ON f.id = a.fixture_id`,
  )

  return rows.map((row) => {
    const position = faceOf(Number(row.position))
    const fixture: Fixture = {
      id: Number(row.fixture_id),
      /*
       * `faceOf` on this side too: a piece can be off the floor with books still
       * recorded on its planks, and a retired piece's position is
       * `-(bookcase + 1)` (`retireFixture`). What somebody wrote down is still
       * "4A", so the number has to decode before it reaches a label.
       */
      position: faceOf(Number(row.fixture_position)),
      kind: row.fixture_kind,
      name: row.fixture_name,
      sortStrategy: 'inherit',
    }
    const area: Area = {
      id: Number(row.id),
      fixtureId: Number(row.fixture_id),
      position,
      name: row.name,
      startsAt: row.starts_at,
      sortStrategy: row.sort_strategy,
    }

    return {
      id: area.id,
      label: labelFor({ fixture, area }),
      fixtureId: fixture.id,
      fixturePosition: fixture.position,
      fixtureName: fixture.name,
      fixtureKind: fixture.kind,
      areaPosition: position,
      position,
      name: area.name,
      startsAt: area.startsAt,
      sortStrategy: area.sortStrategy,
      note: row.note,
      gone: Number(row.position) < 0,
      books: Number(row.books),
    }
  }).sort((a, b) =>
    (a.fixtureId - b.fixtureId)
    /*
     * The face first and then the areas taken out, each in the order they read
     * along the piece. Sorted here rather than in the statement because the
     * stored ordinal of a retired area is `-(plank + 1)`, so ordering rows by it
     * hands back `C`, `B`, `A`: the decoded plank is the one anybody reads in.
     */
    || (Number(a.gone) - Number(b.gone))
    || (a.position - b.position))
}

export async function areaFaces(db: Db): Promise<Map<number, AreaFace>> {
  return new Map((await areasStanding(db)).map((area) => [area.id, {
    label: area.label,
    fixtureId: area.fixtureId,
    fixturePosition: area.fixturePosition,
    areaPosition: area.areaPosition,
  }]))
}

export async function plankLabels(db: Db): Promise<Map<number, string>> {
  return new Map(
    [...await areaFaces(db)].map(([id, face]) => [id, face.label]),
  )
}

/**
 * Which area of a run a sort key lands in, or null when the run has no areas.
 *
 * `layoutRange`'s walk, said as the row it lands on rather than as the label it
 * draws. Every area after the first is a boundary (`boundariesFrom`), so this
 * steps the ones the key has reached and answers the last of them, and the run's
 * first area for a key below every anchor.
 *
 * Anchor order, not position order, and that is load bearing. `layoutRange`
 * sorts the boundary list by anchor, so a run whose anchors do not ascend with
 * its positions draws a plank's worth of books somewhere other than where the
 * rules walking the areas in order would put them. Walking positions here would
 * make this agree with the rules by construction and stop
 * `areaDisagreements` catching that.
 */
export function areaOfKey(run: readonly RunArea[], sortKey: string): RunArea | null {
  if (!run.length) return null

  let landed = run[0]!
  const ordered = [...run.slice(1)]
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))
  for (const area of ordered) {
    if (area.startsAt > sortKey) break
    landed = area
  }
  return landed
}

interface ExistingRow {
  fixture_id: number
  fixture_position: number
  area_id: number | null
  area_position: number | null
}

interface ExistingFixture {
  id: number
  /** Plank position to area id, for the planks the run still has. */
  areas: Map<number, number>
  /** The same, keyed on the plank each retired area was, before it was taken out. */
  retired: Map<number, number>
}

/**
 * The fixtures in a band, lowest id first at each position, with their areas.
 *
 * This reads the band by bookcase, unlike `runAreasOf`, because the question is
 * different: what is already standing where the run's planks are about to be
 * written, which has to include the planks the run does not own on the pieces it
 * opens and ends on. `writeBoundaries` looks a plank up by
 * `fixture.areas.get(position)` and creates one when it is missing, so an
 * `existing` that stopped at the entry would insert a second `2A` beside the one
 * already hanging there. That is why the bound below is `<= end.shelf` and not
 * the move's `limit`.
 *
 * Nothing here reaches a plank the run does not own. Every loop in
 * `writeBoundaries` that can take one off a face is bounded, so the extra rows
 * are read and never written.
 */
async function fixturesIn(
  db: Db,
  band: RangeBand,
): Promise<Map<number, ExistingFixture>> {
  // The upper bound is spelled into the text rather than passed as a null
  // parameter: Postgres cannot infer the type of a parameter that only ever
  // appears beside `IS NULL`, and the last range genuinely has no bound.
  const rows = await db.all<ExistingRow>(
    `SELECT f.id AS fixture_id, f.position AS fixture_position,
            a.id AS area_id, a.position AS area_position
       FROM fixture f
       LEFT JOIN area a ON a.fixture_id = f.id
      WHERE f.position >= ?${band.end === undefined ? '' : ' AND f.position <= ?'}
      ORDER BY f.position, f.id, a.position`,
    band.end === undefined ? [band.start.shelf] : [band.start.shelf, band.end.shelf],
  )

  const byPosition = new Map<number, ExistingFixture>()
  for (const row of rows) {
    // The first id wins, which is the run this range's own fixtures are in: a
    // second fixture at one position was created later.
    let fixture = byPosition.get(row.fixture_position)
    if (!fixture) {
      fixture = { id: row.fixture_id, areas: new Map(), retired: new Map() }
      byPosition.set(row.fixture_position, fixture)
    }
    if (fixture.id !== row.fixture_id) continue
    if (row.area_id === null || row.area_position === null) continue

    // Retired planks are kept apart rather than dropped, so a boundary being put
    // back finds the row it took out instead of making a second one. A book
    // placed on that plank keeps pointing at the row it was placed on.
    if (row.area_position < 0) {
      fixture.retired.set(faceOf(row.area_position), row.area_id)
    } else {
      fixture.areas.set(row.area_position, row.area_id)
    }
  }

  return byPosition
}

interface RunRow {
  id: number
  fixture_id: number
  fixture_position: number
  position: number
  starts_at: string
}

/**
 * The areas of one range, in the order a book meets them.
 *
 * Fixture position, then the fixture that was there first, then area position.
 * That is `slotsInOrder` restricted to a band, and it has to be, because the
 * boundary list and the run the rules walk are two readings of one sequence.
 *
 * The run opens at the band's plank, not at the band's bookcase: `bandOf`
 * answers where a run begins with a `RangeStart`, so a rule written on `2C` says
 * the run begins at `2C`, which is what `docs/shelving.md` and `runFrom` both
 * say. It closes at a plank too. `band.limit` is a fixture position, because a
 * move stops one piece earlier than a run does, so this statement is not the one
 * it is about: the move, and only the move, asks `band.limit` by name.
 */
export async function runAreasOf(db: Db, range: ShelfRange): Promise<RunArea[]> {
  const band = await bandOf(db, range)
  if (!band) return []

  const rows = await db.all<RunRow>(
    `SELECT a.id, a.fixture_id, f.position AS fixture_position, a.position, a.starts_at
       FROM area a JOIN fixture f ON f.id = a.fixture_id
      WHERE a.position >= 0
        AND (f.position > ? OR (f.position = ? AND a.position >= ?))
        ${band.end === undefined ? '' : 'AND (f.position < ? OR (f.position = ? AND a.position < ?))'}
      ORDER BY f.position, f.id, a.position`,
    band.end === undefined
      ? [band.start.shelf, band.start.shelf, band.start.area]
      : [
        band.start.shelf, band.start.shelf, band.start.area,
        band.end.shelf, band.end.shelf, band.end.area,
      ],
  )

  // One fixture per position, the one that was there first, which is the run
  // this range's own furniture is in. See `fixturesIn`.
  const held = new Map<number, number>()
  const run: RunArea[] = []
  for (const row of rows) {
    if (!held.has(row.fixture_position)) held.set(row.fixture_position, row.fixture_id)
    if (held.get(row.fixture_position) !== row.fixture_id) continue
    run.push({
      id: row.id,
      fixturePosition: row.fixture_position,
      position: row.position,
      startsAt: row.starts_at,
    })
  }

  return run
}

/** Every boundary in a range, in the order a book meets them. */
export async function boundariesOf(db: Db, range: ShelfRange): Promise<Separator[]> {
  return boundariesFrom(range, await runAreasOf(db, range))
}

/** The plank of a run standing at this address, or null when none does. */
export function areaAt(run: readonly RunArea[], where: PlankAt): RunArea | null {
  return run.find((area) =>
    area.fixturePosition === where.shelf && area.position === where.area) ?? null
}

/**
 * One plank, said both ways. The id decides and the label is read: anything
 * working out where a book goes reads `areaId`, and anything putting a sentence
 * in front of a person reads `label`.
 *
 * `areaId` is null for exactly one plank: the one a plan proposes to make and
 * has not made yet. There is no row to name, and the caller's job at that point
 * is to make it rather than to write a book onto it.
 */
export interface Plank {
  areaId: number | null
  label: string
}

/**
 * A run's planks, ready to be named or identified without going back to the
 * database for each one.
 *
 * The layout addresses a plank as a pair of ordinals (`PlankAt`), because that
 * is all the arithmetic in shared/layout.ts can know, and the furniture
 * addresses it as a row. This is the join between the two, read once.
 */
export interface RunPlanks {
  /** Where in this run a plank stands, or null when the run has no such plank. */
  addressOf(areaId: number): PlankAt | null
  at(where: PlankAt): Plank
  /**
   * The piece the plank at an address hangs on, and where it hangs on it.
   *
   * The structural half of `at`, taken off the same row and the same decode, so
   * what a screen groups by and what it prints cannot come from two readings.
   *
   * Null only where there is no piece standing at that number at all, which is a
   * run whose rule points at furniture that has been taken out. A plank the
   * furniture has no row for still answers, because the piece is real and only
   * the plank is proposed: that is the same case `at` names.
   */
  standingAt(where: PlankAt): AreaStanding | null
  /** What one plank is called, or '' when this collection has no such area. */
  labelOf(areaId: number): string
  /** What every plank of the run is called, in the order a book meets them. */
  labels(): string[]
  /**
   * Every plank of the run addressed, in the order a book meets them.
   *
   * The furniture's own answer to "which planks are there", which is a
   * different question from "where do books stand" and has a different answer
   * the moment a plank is bare. A screen that draws the room reads this and asks
   * the layout what stands on each; a screen that draws the books reads the
   * layout and never needs it.
   *
   * Empty exactly when the run is: a range whose rule points at furniture that
   * has been taken out has no planks to name, and the caller falls back on the
   * addresses the layout invented.
   */
  every(): PlankAt[]
}

export async function planksOf(db: Db, range: ShelfRange): Promise<RunPlanks> {
  const run = await runAreasOf(db, range)
  const areas = new Map((await areasStanding(db)).map((area) => [area.id, area]))
  /*
   * The pieces, for the one plank that has no row: a cascade that fills a
   * bookcase proposes a plank below the last one, and until somebody says they
   * carried a book there it does not exist. The piece is asked for its name and
   * only the letter is invented, so a plank on a piece called "Hall shelf" is
   * not named `2C`.
   *
   * One piece per position, the one that was there first, which is the reading
   * `runAreasOf` makes of the same shelves.
   */
  const pieces = new Map<number, { id: number; name: string; kind: string }>()
  for (const row of await db.all<{
    id: number; position: number; name: string; kind: string
  }>(
    'SELECT id, position, name, kind FROM fixture WHERE position >= 0 ORDER BY position, id',
  )) {
    if (!pieces.has(row.position)) pieces.set(row.position, row)
  }

  return {
    addressOf(areaId) {
      const area = run.find((one) => one.id === areaId)
      return area ? { shelf: area.fixturePosition, area: area.position } : null
    },
    at(where) {
      const area = areaAt(run, where)
      if (area) return { areaId: area.id, label: areas.get(area.id)?.label ?? '' }

      const piece = pieces.get(where.shelf)
      return {
        areaId: null,
        label: labelFor({
          fixture: {
            id: piece?.id ?? 0,
            position: where.shelf,
            kind: piece?.kind ?? '',
            name: piece?.name ?? '',
            sortStrategy: 'inherit',
          },
          area: {
            id: 0,
            fixtureId: piece?.id ?? 0,
            position: where.area,
            name: '',
            startsAt: '',
            sortStrategy: 'inherit',
          },
        }),
      }
    },
    standingAt(where) {
      const area = areaAt(run, where)
      const standing = area && areas.get(area.id)
      if (standing) {
        return {
          fixtureId: standing.fixtureId,
          fixture: standing.fixturePosition,
          plank: standing.areaPosition,
          name: standing.fixtureName,
          kind: standing.fixtureKind,
        }
      }

      const piece = pieces.get(where.shelf)
      return piece
        ? {
            fixtureId: piece.id,
            fixture: where.shelf,
            plank: where.area,
            name: piece.name,
            kind: piece.kind,
          }
        : null
    },
    labelOf(areaId) {
      return areas.get(areaId)?.label ?? ''
    },
    labels() {
      return run.map((area) => areas.get(area.id)?.label ?? '')
    },
    every() {
      return run.map((area) => ({ shelf: area.fixturePosition, area: area.position }))
    },
  }
}

/**
 * Take an area out, and answer whether it went.
 *
 * Conditional rather than attempted, because the alternative is a foreign key
 * violation that rolls back the boundary change somebody just made at a shelf.
 * The three references are the three things that can mean "a book was here":
 * the ledger, the projection over it, and a rule pointing at the area.
 */
async function removeAreaIfUnused(db: Db, id: number): Promise<boolean> {
  const { changes } = await db.run(
    `DELETE FROM area WHERE id = ?
       AND NOT EXISTS (SELECT 1 FROM book_placement p WHERE p.area_id = area.id)
       AND NOT EXISTS (SELECT 1 FROM books b WHERE b.current_area_id = area.id)
       AND NOT EXISTS (SELECT 1 FROM placement_rule r WHERE r.area_id = area.id)`,
    [id],
  )
  return changes > 0
}

/**
 * The stored position of a plank that has been taken out, and back again.
 *
 * `-(position + 1)`, so plank A retires to -1 and plank B to -2, and the
 * encoding is its own inverse. A retired area still names the plank it was,
 * which is the property that matters: a book placed on `1C` before somebody
 * removed the divider above it is still recorded on `1C`, and the misfile list
 * is what says the shelves no longer have one.
 *
 * Negative rather than a column, because there is nothing else about a retired
 * plank to record and every read of the furniture already had to say which
 * planks are on a fixture's face.
 */
export const retiredPosition = (position: number): number => -(position + 1)

/** What a stored position means as a plank, retired or not. */
export const faceOf = (position: number): number =>
  (position < 0 ? -position - 1 : position)

/**
 * A rule whose plank is going comes to rest on the piece it was on.
 *
 * A rule pointing at an area off a face is a quiet defect: `furnitureIn` reads
 * `position >= 0`, so `entryAreaOf` answers null, the rule stops opening a run,
 * and every book it claims is filed nowhere while the rule goes on reading as
 * enabled on its own screen.
 *
 * So a rule names a place, and when the plank goes the place is the bookcase.
 * `area_id` becomes null and `fixture_id` the piece the plank was on, which is
 * the same shape a range's own rule has and resolves, through `entryAreaOf`, to
 * the first area of that piece. The rule keeps claiming the same books and keeps
 * opening a run, one plank up.
 *
 * `removeAreaIfUnused` still refuses to delete an area a rule points at: it runs
 * first, finds the rule, and hands the area here.
 */
async function repointRulesOffTheFace(db: Db, id: number): Promise<void> {
  await db.run(
    `UPDATE placement_rule
        SET area_id = NULL, fixture_id = (SELECT fixture_id FROM area WHERE id = ?)
      WHERE area_id = ?`,
    [id, id],
  )
}

/**
 * Take an area off the fixture's face without deleting it.
 *
 * For the area a removed boundary leaves behind when a book has been placed in
 * it: the row has to stay, because the ledger names it and the ledger is the
 * record of where books have been, and it has to stop being part of the run, or
 * the boundary would come straight back out of `boundariesOf`.
 *
 * A fixture can have retired the same plank before. The second one cannot have
 * the position the first has, so it goes below every position on that fixture
 * and loses the number, which is the worse answer and the rare one.
 */
async function retireArea(db: Db, id: number, position: number): Promise<void> {
  await repointRulesOffTheFace(db, id)

  const taken = await db.get<{ id: number }>(
    `SELECT other.id FROM area other
      WHERE other.fixture_id = (SELECT fixture_id FROM area WHERE id = ?)
        AND other.position = ?`,
    [id, retiredPosition(position)],
  )
  if (!taken) {
    await db.run('UPDATE area SET position = ? WHERE id = ?', [retiredPosition(position), id])
    return
  }

  await db.run(
    `UPDATE area SET position =
       (SELECT min(other.position) - 1 FROM area other
         WHERE other.fixture_id = area.fixture_id)
      WHERE id = ?`,
    [id],
  )
}

/**
 * Take an area out of the run, whichever way it can go.
 *
 * Exported for `furniture.ts`, which takes an area out because somebody asked
 * for it rather than because a boundary moved. There is one answer to "what
 * happens to the row when its plank goes" and this is it.
 */
export async function retireOrRemove(db: Db, id: number, position: number): Promise<void> {
  if (!(await removeAreaIfUnused(db, id))) await retireArea(db, id, position)
}

/**
 * Take a plank off a face without deleting it, whatever has stood on it.
 *
 * Somebody asking for an area to go means the row goes if nothing pins it, which
 * is `retireOrRemove`. A move is not that request: it is about a run of books,
 * and the planks it steps over belong to whoever built them, so a plank nobody
 * has filled yet is exactly the one `removeAreaIfUnused` would delete.
 * `docs/shelving.md`: "The planks the run leaves behind are retired rather than
 * deleted."
 */
async function takeOffTheFace(db: Db, id: number, position: number): Promise<void> {
  await retireArea(db, id, position)
}

/**
 * Write down the areas a range's boundaries name.
 *
 * Called by every statement that changes a boundary, on that statement's
 * transaction handle, so the change and the areas commit together or neither
 * does.
 *
 * Reconciled rather than rebuilt, and that is not an optimisation.
 * `book_placement.area_id` and `books.current_area_id` name area rows, so an
 * area that survives a boundary change has to keep its id or the ledger would be
 * pointed at a different plank by furniture being renumbered.
 *
 * Idempotent. `note` and `name` are left alone on an area that already exists:
 * they are somebody's words about a plank, and a boundary carries neither.
 */
export async function writeBoundaries(
  db: Db,
  range: ShelfRange,
  separators: readonly Separator[],
): Promise<void> {
  const band = await bandOf(db, range)
  if (!band) return

  // The collection everything hangs off. Absent only on a database that has no
  // fixtures to reconcile against either.
  const collection = await db.get<{ id: number }>(
    'SELECT id FROM collection ORDER BY id LIMIT 1',
  )
  if (!collection) return

  const derived = areasOf(band.start, separators).filter((area) =>
    band.end === undefined
    || area.fixturePosition < band.end.shelf
    || (area.fixturePosition === band.end.shelf && area.position < band.end.area))

  /*
   * The plank the tail loop below may not reach, on the piece it stands on.
   *
   * The run's last piece carries planks the run does not own, exactly as its
   * first piece does: a run ending at `2C` derives `2A` and `2B`, so the tail
   * would otherwise see `2C` sitting past the last derived position and take the
   * next run's entry plank off its face.
   *
   * Undefined on every other piece, which is every piece the run owns whole.
   */
  const beyond = (fixturePosition: number): number | undefined =>
    band.end !== undefined && fixturePosition === band.end.shelf ? band.end.area : undefined

  /*
   * The plank the run opens at, and the one row here does not write an anchor
   * onto.
   *
   * `areasOf` anchors this one at the empty string, which sorts below every sort
   * key, because the walk needs to say "from the beginning" about the plank a
   * book falls onto before it has passed any boundary. That is a fact about the
   * walk and not about the plank: writing it onto the row would record where the
   * run begins in a column that says where an area is cut off from the one
   * before it.
   *
   * Where a run begins is decided in one place, the rule that serves the range,
   * through `ruleForRange` and `entryAreaOf`. An area keeps the anchor it
   * earned, so when the entry moves elsewhere no row is left anchored below
   * every book, which `areaOfKey` and `layoutRange` would both sort to the front
   * of the run.
   */
  const opensTheRun = derived[0]

  const existing = await fixturesIn(db, band)
  const wanted = new Map<number, DerivedArea[]>()
  for (const area of derived) {
    const areas = wanted.get(area.fixturePosition) ?? []
    areas.push(area)
    wanted.set(area.fixturePosition, areas)
  }

  for (const [fixturePosition, areas] of wanted) {
    let fixture = existing.get(fixturePosition)
    if (!fixture) {
      const row = await db.get<{ id: number }>(
        `INSERT INTO fixture (collection_id, kind, name, position, sort_strategy, note)
         VALUES (?, 'bookshelf', '', ?, 'inherit', '') RETURNING id`,
        [collection.id, fixturePosition],
      )
      if (!row) continue
      fixture = { id: row.id, areas: new Map(), retired: new Map() }
    }

    for (const area of areas) {
      // A plank this fixture retired comes back rather than being made again.
      // The row a book was placed on is the row the ledger names, so a
      // retraction returns the book to where it was recorded rather than to a
      // plank with the same label and a different id.
      const restored = fixture.retired.get(area.position)
      if (restored !== undefined && !fixture.areas.has(area.position)) {
        await db.run(
          area === opensTheRun
            ? 'UPDATE area SET position = ? WHERE id = ?'
            : 'UPDATE area SET position = ?, starts_at = ? WHERE id = ?',
          area === opensTheRun
            ? [area.position, restored]
            : [area.position, area.startsAt, restored],
        )
        fixture.retired.delete(area.position)
        fixture.areas.set(area.position, restored)
        continue
      }

      const id = fixture.areas.get(area.position)
      if (id === undefined) {
        await db.run(
          `INSERT INTO area (fixture_id, position, name, starts_at, sort_strategy, note)
           VALUES (?, ?, '', ?, 'inherit', '')`,
          [fixture.id, area.position, area.startsAt],
        )
        continue
      }
      // The run's own plank keeps the anchor it has. See `opensTheRun`.
      if (area === opensTheRun) continue
      await db.run(
        'UPDATE area SET starts_at = ? WHERE id = ? AND starts_at IS DISTINCT FROM ?',
        [area.startsAt, id, area.startsAt],
      )
    }

    // The tail of a fixture that has lost boundaries, stopping short of a plank
    // the next run opens at. See `beyond`.
    const last = areas[areas.length - 1]!.position
    const stop = beyond(fixturePosition)
    for (const [position, id] of fixture.areas) {
      if (position <= last) continue
      if (stop !== undefined && position >= stop) continue
      await retireOrRemove(db, id, position)
    }
  }

  /*
   * Whole bookcases the range no longer reaches. Their planks come off the face
   * and the piece keeps standing: a piece of furniture goes when somebody says
   * so, through `dropFixture`, which refuses while books or rules are on it and
   * says what becomes of them. Nothing else in this file may delete one.
   */
  for (const [fixturePosition, fixture] of existing) {
    if (wanted.has(fixturePosition)) continue
    /*
     * It stops at `limit` and not at `end`. Emptying a bookcase is a statement
     * about a whole piece, so the piece bound is the one it may go up to: a
     * piece another run begins on is that run's furniture, whether the plank it
     * begins at is the top one or the last. `fixturesIn` reads the piece the run
     * ends on so the planks there can be found rather than made twice, and this
     * loop is the reason that has to be the only thing done with them.
     */
    if (band.limit !== undefined && fixturePosition >= band.limit) continue
    for (const [position, id] of fixture.areas) await retireOrRemove(db, id, position)
  }
}

/**
 * Hang a whole run on a different bookcase.
 *
 * Not a fourth statement that writes a boundary: the cuts are read before
 * anything moves and written back afterwards through `writeBoundaries`, so the
 * run arrives on the new bookcase with the same number of planks holding the
 * same books. What changes is `placement_rule.fixture_id`.
 *
 * Called on the caller's transaction handle, and there is a reason it has to be:
 * between the retirement and the write there is a moment when the range's rule
 * points at a bookcase with nothing on its face, and no other reader may see it.
 *
 * The order is load bearing. The run's own planks are taken out first, before
 * the rule is retargeted, because planks left on a face while the run moved
 * elsewhere would belong to no run and the range before this one would flow onto
 * them. Retiring them first also means a destination overlapping the source
 * needs no special case. A retired plank comes back rather than being made
 * again, exactly as `writeBoundaries` restores one, so moving a run away and
 * back returns every book to the row the ledger already names.
 *
 * Nothing here deletes anything. Every plank of the run is retired, including
 * one no book has ever stood on, and no fixture is removed at all. What a move
 * does to the furniture is said in front of somebody first, as
 * `RunMovePlan.emptied`.
 *
 * The planks the plan names are the planks this takes, because `bandsOf` stops
 * where any rule's run begins, through `nextRunStartAfter`, which is the cut
 * `runFrom` already made in the domain read a piece at a time.
 * `refuseAHalfStrippedPiece` is the backstop for the day the two drift again.
 *
 * Idempotent: relocating a run to the bookcase it is already on reads the same
 * boundaries, retires nothing that is not immediately restored, and writes the
 * rule the value it holds.
 */
export async function relocateRunTo(
  db: Db,
  range: ShelfRange,
  to: number,
): Promise<void> {
  const rule = await runRuleOf(db, range)
  if (!rule) return

  /*
   * The stretch that moves. `runAreasOf` answers which planks the run is, which
   * is a plank bound and can therefore run onto a piece another rule stands part
   * way down, and a move may not take that piece. So this reads `band.limit`,
   * the bookcase bound, by name: the same bound `relocateRun` filters the plan
   * by, out of the same `nextRunStartAfter`, so the planks the plan names are
   * the planks this takes.
   *
   * The boundaries are derived from that stretch rather than read again, so the
   * cuts written onto the destination are the cuts of the planks that moved.
   */
  const band = await bandOf(db, range)
  const flowing = await runAreasOf(db, range)
  const run = band?.limit === undefined
    ? flowing
    : flowing.filter((area) => area.fixturePosition < band.limit!)
  const boundaries = boundariesFrom(range, run)

  for (const area of run) await takeOffTheFace(db, area.id, area.position)

  const collection = await db.get<{ id: number }>(
    'SELECT id FROM collection ORDER BY id LIMIT 1',
  )
  if (!collection) return

  // The bookcase the run is moving onto, made if the room has one and the
  // catalogue does not. `writeBoundaries` makes the rest of them.
  const destination = await db.get<{ id: number }>(
    'SELECT id FROM fixture WHERE position = ? ORDER BY id LIMIT 1',
    [to],
  ) ?? await db.get<{ id: number }>(
    `INSERT INTO fixture (collection_id, kind, name, position, sort_strategy, note)
     VALUES (?, 'bookshelf', '', ?, 'inherit', '') RETURNING id`,
    [collection.id, to],
  )
  if (!destination) return

  /*
   * One plank on its face, because a rule pointing at a bookcase resolves to
   * that bookcase's first area and `bandOf` answers nothing without one. The
   * rest of the run's cuts are `writeBoundaries`' job below.
   */
  const first = await db.get<{ id: number }>(
    'SELECT id FROM area WHERE fixture_id = ? AND position = 0',
    [destination.id],
  )
  if (!first) {
    const retired = await db.get<{ id: number }>(
      'SELECT id FROM area WHERE fixture_id = ? AND position = ?',
      [destination.id, retiredPosition(0)],
    )
    if (retired) {
      // Position only. A plank coming back onto a face keeps its anchor, for
      // the reason `opensTheRun` gives in `writeBoundaries`: this plank opens
      // the run today and may not tomorrow.
      await db.run('UPDATE area SET position = 0 WHERE id = ?', [retired.id])
    } else {
      await db.run(
        `INSERT INTO area (fixture_id, position, name, starts_at, sort_strategy, note)
         VALUES (?, 0, '', '', 'inherit', '')`,
        [destination.id],
      )
    }
  }

  await db.run(
    'UPDATE placement_rule SET fixture_id = ?, area_id = NULL WHERE id = ?',
    [destination.id, rule.id],
  )

  await writeBoundaries(db, range, boundaries)

  await refuseAHalfStrippedPiece(db, run)
}

/**
 * The one thing a move may not have done, checked rather than argued.
 *
 * A move empties pieces; it does not half strip one. A plank a move takes off a
 * face is a plank of a piece the run is leaving, the plan says so as
 * `RunMovePlan.emptied` before anybody presses anything, and the books still
 * standing on it reach a person through the piece's own page. A plank taken off
 * a piece that goes on standing with other planks on its face reaches nobody: no
 * screen draws it, the piece does not name it, and the row is there to be found
 * only by somebody reading the table.
 *
 * It cannot fire while `bandsOf` and `relocateRun` stop at the same piece. It is
 * here because they are two functions and they can drift, and a move that would
 * half strip a piece fails loudly inside its own transaction instead.
 */
async function refuseAHalfStrippedPiece(db: Db, taken: readonly RunArea[]): Promise<void> {
  const ids = taken.map((area) => area.id)
  if (!ids.length) return

  /*
   * Resolved through the rows rather than through `fixturePosition`, because
   * `fixture.position` carries no unique index and two pieces can stand at one
   * number. Asking by number would judge one piece by another's planks.
   */
  const half = await db.get<{ position: number; name: string }>(
    `SELECT f.position, f.name
       FROM fixture f
      WHERE f.id IN (SELECT fixture_id FROM area WHERE id IN (${ids.map(() => '?').join(', ')}))
        AND EXISTS (SELECT 1 FROM area a WHERE a.fixture_id = f.id AND a.position < 0)
        AND EXISTS (SELECT 1 FROM area a WHERE a.fixture_id = f.id AND a.position >= 0)
      LIMIT 1`,
    ids,
  )
  if (!half) return

  throw new Error(
    `Moving this run would take some of the planks off ${half.name || `bookcase ${half.position}`} `
    + 'and leave the rest, which puts a shelf on no screen in the app. '
    + 'Nothing was moved.',
  )
}

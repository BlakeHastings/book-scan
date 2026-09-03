/**
 * The areas a range is cut into, and the boundaries they are read back as.
 *
 * **This file used to point the other way.** Through #213 `separators` was
 * authoritative and this wrote `area` beside it, so the arrow ran from the
 * boundary to the row. #232 turns it round: the rows are the furniture, the
 * boundary list is derived from them, and `separators` and `shelf_ranges` are
 * gone. What has not changed is the arithmetic. `areasOf` is still the walk
 * `layoutRange` makes, and `boundariesFrom` is that walk read backwards, so the
 * two are inverses and a boundary written here comes back as the boundary that
 * was written.
 *
 * ## Where a range begins comes from a rule now
 *
 * `shelf_ranges.start_shelf` said which bookcase a range started on. That is a
 * `placement_rule` pointing at a fixture, and the fixture's position is the
 * number the column held: `0013` derived one from the other, so the two agree
 * row for row on the day this lands. `bandsOf` is the read, and it asks the
 * rules through `GENRE_RANGES`, which is the one table that pairs a genre slug
 * with a range.
 *
 * A range's run stops where the next range's begins, exactly as it did: the
 * ranges stand on the floor in one order and their fixtures are numbered in it.
 * That bound is still real and still refuses the same arrangement, a fiction run
 * grown onto non-fiction's bookcase, and the disagreement is still reported
 * rather than repaired.
 *
 * ## An area that has held a book is retired, not deleted
 *
 * Removing a boundary makes the run one area shorter, so the last area of the
 * range has nothing left to describe. `book_placement.area_id` is
 * `ON DELETE RESTRICT` on purpose, so an area a book was ever placed in cannot
 * be deleted: the history pins the furniture it names.
 *
 * While `separators` was authoritative that was survivable, because a stale row
 * decided nothing and `areaDisagreements` named the books. It is not survivable
 * now: an area still sitting in the run would come back out of `boundariesFrom`
 * as a boundary nobody asked for, and the removal would not have happened.
 *
 * So such an area is **retired**: its `position` goes negative, which takes it
 * off the fixture's face while leaving the row and every placement that names
 * it exactly where they are. Every read of the furniture asks for
 * `position >= 0`, and a recorded label never matches one, because a parsed
 * label's plank is always at or above zero. That is what closes the drift #213
 * had to report and could not fix.
 *
 * **The negative still names the plank**, as `-(plank + 1)`, so a book placed on
 * `1C` before somebody removed the divider above it is still recorded on `1C`,
 * and the misfile list is what says the shelves no longer have one. See
 * `faceOf`, which is the encoding read back, and `writeBoundaries`, which brings
 * a retired plank back onto the face rather than making a second one beside it
 * when a boundary is put back.
 *
 * ### There is no third state, and #420 is what one cost
 *
 * A negative position means one thing: **this plank was taken out, and the row
 * stayed because the ledger names it.** Somebody can still reach it, through the
 * books standing on it, on the piece's own page and in the carry list (#403).
 *
 * #391 borrowed the same encoding for a second job nobody named: parking the
 * planks of a run mid-move, in `takeOffTheFace`, on the understanding that
 * `writeBoundaries` would hang every one of them straight back. When it did not,
 * what was left was indistinguishable from a retirement in every read and was
 * nothing like one to a person: four planks on a bookcase somebody had put up
 * that afternoon, holding no books, so drawn by no screen, with a rule still
 * filing comics onto one of them.
 *
 * That state is not tolerated by a fourth read here. It is made unreachable: a
 * move only ever takes planks off pieces the run is leaving, `bandsOf` and
 * `relocateRun` agree on which those are because they ask the same function
 * (`nextRunStartAfter`), a rule never survives its plank leaving the face
 * (`repointRulesOffTheFace`), and a move that would half strip a piece anyway
 * refuses inside its own transaction (`refuseAHalfStrippedPiece`).
 *
 * ## Statements, not the query builder
 *
 * The reconcile is conditional deletes and find-or-create, which read as SQL and
 * read as machinery through a builder. `areaForLabel` beside it is written the
 * same way and for the same reason.
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

/** One area as the boundaries describe it: where it hangs and what it opens at. */
export interface DerivedArea {
  /** The fixture's ordinal, 1-based, which is the `1` in `1A`. */
  fixturePosition: number
  /** The area's ordinal within it, 0-based, which is the `A` in `1A`. */
  position: number
  /**
   * The sort key of the first book on it. Empty on the first area of a run.
   *
   * **The empty one is the walk's, not the row's** (#485). It says "from the
   * beginning" about the plank a book lands on before it has passed a boundary,
   * and the first area of a run has no boundary above it to anchor. Where the
   * run begins is the rule's answer, asked through `bandsOf`, and
   * `writeBoundaries` does not copy it into `area.starts_at`: a row that held
   * it went on holding it after the rule moved the entry elsewhere, and a
   * boundary anchored below every book takes the whole ordinal walk with it.
   */
  startsAt: string
}

/**
 * The areas a run is cut into, walked exactly as `layoutRange` walks it.
 *
 * Pure, and separate from the writing, because the walk is the claim worth
 * testing on its own and a test of it needs no database.
 *
 * **Sorted by anchor**, which is the sort `layoutRange` makes. Two boundaries on
 * one anchor is not hypothetical: it is what a boundary move that empties an
 * area leaves behind, and the two have to be stepped over in the order they were
 * recorded or a plank's worth of books draws on the plank before.
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

/** An area of a run, as the rows hold it. */
export interface RunArea extends DerivedArea {
  id: number
}

/**
 * `areasOf` read backwards: the boundaries a run of areas is cut by.
 *
 * The first area of a run opens at nothing and is therefore not a boundary; each
 * one after it is, anchored where the area starts. **A boundary's kind is not
 * stored**, and it never was a fact of its own: `shelf` meant "a new bookcase
 * starts here", which is exactly an area whose fixture is not the previous
 * area's. Deriving it is what makes this the inverse of `areasOf` rather than a
 * second opinion about the same shelves.
 *
 * **The id is the area's**, so a boundary is identified by the area it opens.
 * That is the one place the two models differ in kind rather than in spelling: a
 * separator's id used to survive another boundary being inserted before it, and
 * an area's identity is its place in the run. Everything that acts on a boundary
 * id reads the list and acts on it inside one transaction, and the retraction,
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
 * **Two ends answering two questions, and each caller says which it is asking**
 * (#499). This used to carry one bound, a bookcase, and both questions read it:
 *
 * - `end` is where the **run** stops, which is a plank, because a run runs from
 *   its rule's entry area until the next area any rule points at. `runFrom` has
 *   always said it that way in the domain and `docs/shelving.md` settles it in
 *   one line.
 * - `limit` is where a **move** stops, which is a bookcase, because a move
 *   rehangs whole pieces and a piece somebody else's run begins on is that
 *   run's furniture. That is #420 and it is a decision rather than a rounding.
 *
 * The asymmetry is real and it is not the mistake. The mistake was one bound
 * standing for both, which cost two things nobody chose: planks between a
 * previous run and an entry part way down a piece fell out of every band while
 * `runFrom` still gave them to the run before, and two runs opening on one
 * piece bounded the earlier range at its own start, so `f.position >= 2 AND
 * f.position < 2` gave a whole range no run at all — silently, with no error
 * and nothing on any list.
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
 * The furniture and the rules, read back out of the rows.
 *
 * **`position >= 0` is the whole of what keeps a retired area out.** It is
 * written here rather than in `slotsInOrder`, because the domain has no notion
 * of furniture that has been taken out: what it is handed is the collection as
 * it stands.
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
 * which is `GENRE_RANGES` used in the one direction it has not been used in yet.
 * That pairing is already the single place a slug and a range are the same fact,
 * so asking it here is what stops "which bookcase does non-fiction start on"
 * having a second answer.
 *
 * **Which of them, when two rules name one genre, is `ruleForRange`'s answer and
 * not a second one made here.** This picked with `rules.find`, first row back
 * from a `SELECT` with no `ORDER BY`, while `claim` picked by area-before-
 * fixture, then priority, then id, and two rules on one genre is an arrangement
 * #430 item 1 deliberately kept legal. So an area rule on `2A` and a fixture
 * rule on bookcase 1, both asking for Fiction, had `claim` file every fiction
 * book at `2A` and had this draw the fiction run from `1A`: one question, two
 * answers, and the book left standing where neither the misfile list nor the
 * carry list would name it. That is #463.
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
     * asked, and **neither of them is "where does the next range begin"**.
     *
     * That was the whole of #420 for the piece bound: the two genre rules were
     * the only thing that could bound a band, so a bookcase somebody stood past
     * the last of them, and wrote their own rule on, fell inside non-fiction's
     * band and a move about two other bookcases rewrote its planks.
     *
     * It is the whole of #499 for the plank bound. The next range's start was
     * kept in the arithmetic as well, as a `Math.min`, for the one case the
     * pieces could not express: two runs opening on one piece. But a bound of
     * "the next range's bookcase" is this range's own bookcase in that case, so
     * the earlier range came back bounded at its own start and every read of it
     * answered about nothing. The plank bound expresses that case exactly, and
     * with it the `min` has nothing left to contribute: any next range starting
     * on a later piece is one of the run starts `nextRunStartAfter` already
     * walks, so it could never have been the smaller of the two.
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
 * The rule that serves a range. **The one answer to which rule that is**, and
 * `bandsOf` asks it rather than choosing again.
 *
 * `GENRE_RANGES` is the one place a genre slug and a shelf range are the same
 * fact, so a second way of finding "the non-fiction rule" would be a second
 * answer to which run is which.
 *
 * **Two rules may name one genre**, which #430 item 1 established and nothing
 * here makes an error. When they do, this is the one that wins, and it is the
 * one `claim` would hand a book carrying that genre: `byPrecedence` is the
 * ladder `claim` sorts by, imported rather than copied. Before #463 this took
 * whichever row came back first — no `ORDER BY`, so insertion order in practice
 * and nothing in principle — and the run a book was filed into and the run the
 * app drew were two different runs.
 *
 * **It is the ordering that is shared, not the question.** `claim` is asked of a
 * book and this is asked of a range, and putting a synthetic book carrying the
 * genre slug through `claim` would answer a third question: `matches` needs
 * *every* condition to hold, so a rule reading "Fiction and Signed" would stop
 * being fiction's rule, and `under` would make a rule about the whole `genre`
 * tree into both ranges' rule at once. Which rules are candidates stays what it
 * has always been — the ones naming this range's slug — and only the choice
 * among them is now made in one place.
 *
 * **A switched-off rule is tried last rather than left out**, which is the one
 * place this deliberately answers where `claim` answers nothing, and it is
 * written down here because the next person will otherwise delete it. `claim`
 * refuses a disabled rule outright: it files no books, so it wins none. This
 * cannot, for the reason `entryAreas` keeps disabled rules: turning a rule off
 * stops it claiming books and **does not merge its run into the one before it**,
 * so a range whose only rule is off still has a run, still empty, standing where
 * it stood. Ordering enabled first is what keeps the two together where it
 * matters: when a range has one rule on and one off, the one that files the
 * books is the one the run begins at, and `claim` and this agree again.
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

/**
 * One area, whatever has become of it: what it reads as, where it stands,
 * whether it is still on a face, and what is standing on it.
 */
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
 * **This is the one answer to "where are the books".** It was two, and #401 is
 * what that cost. The face reads filter `position >= 0`, which is right for
 * drawing a piece of furniture and is wrong for counting what is on it, and the
 * per-area count used to be a subquery hanging off one of them: so a bookcase
 * whose planks had all been retired by a run move reported nought areas and
 * nought books while the carry list, which reads this function, named `4A` as
 * the place forty-six books were leaving. Both answers came out of the same
 * database in the same second and only one of them could be acted on.
 *
 * There is now exactly one statement in this app that counts the books standing
 * on an area, it is below, and it does not know what a retired area is.
 * `areasOnFaces` narrows it to the face for everything that draws furniture, and
 * `everyArea` hands it over whole to the reads that have to account for books.
 *
 * `furnitureIn` answers the collection as it stands and so cannot answer this: a
 * book can be recorded on a plank somebody has since taken out, and what a
 * person wrote down is still `4A`. Same reading as `withPlacements` makes for
 * the wire, through the same `labelFor` and the same `faceOf`, so a plan names
 * the plank the catalogue names.
 *
 * **Keyed on the id, and the id is the point.** A label is a rendering of an
 * area and changes the moment somebody names a piece; the key does not. Anything
 * deciding whether two places are the same place reads the key, and anything
 * showing a person where to walk reads the label. #356 is what happens when
 * those two jobs are given to the same string.
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
       * `faceOf` on this side too, and for the plank's reason one line down: a
       * piece can be off the floor with books still recorded on its planks, and
       * a retired piece's position is `-(bookcase + 1)` (`retireFixture`). What
       * somebody wrote down is still "4A", so the number has to decode before it
       * reaches a label.
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

/**
 * The same read, keyed on the id, for the callers that only want to know what a
 * place is called and where it stands.
 */
export async function areaFaces(db: Db): Promise<Map<number, AreaFace>> {
  return new Map((await areasStanding(db)).map((area) => [area.id, {
    label: area.label,
    fixtureId: area.fixtureId,
    fixturePosition: area.fixturePosition,
    areaPosition: area.areaPosition,
  }]))
}

/** What every area is called, for a caller that needs nothing else about it. */
export async function plankLabels(db: Db): Promise<Map<number, string>> {
  return new Map(
    [...await areaFaces(db)].map(([id, face]) => [id, face.label]),
  )
}

/**
 * Which area of a run a sort key lands in, or null when the run has no areas.
 *
 * **`layoutRange`'s walk, said as the row it lands on rather than as the label
 * it draws.** Every area after the first is a boundary (`boundariesFrom`), so
 * this steps the ones the key has reached and answers the last of them, and the
 * run's first area for a key below every anchor, because a book that sorts
 * before the first boundary is on the first plank.
 *
 * **Anchor order, not position order, and that is load bearing.** `layoutRange`
 * sorts the boundary list by anchor, so a run whose anchors do not ascend with
 * its positions draws a plank's worth of books somewhere other than where the
 * rules walking the areas in order would put them. That disagreement is exactly
 * what `areaDisagreements` exists to catch, and walking positions here would
 * have made it agree with the rules by construction and stop catching anything.
 *
 * That this agrees with `layoutRange` on a well formed run is not left as an
 * argument: `shelves.test.ts` lays a seeded run out both ways and compares where
 * every key landed, plank for plank.
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

/** One fixture of a band: the planks on its face, and the ones taken out. */
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
 * **This one really does read the band by bookcase, and it is not the omission
 * `runAreasOf` had** (#490). The two ask different questions. `runAreasOf` asks
 * which planks the run is, and a run opens at a plank, so dropping
 * `band.start.area` there put two of somebody else's planks inside this run.
 * This asks what is already standing where the run's planks are about to be
 * written, and the answer has to include the planks the run does *not* own on
 * the piece it opens on: `writeBoundaries` looks a plank up by
 * `fixture.areas.get(position)` and creates one when it is missing, so an
 * `existing` that stopped at the entry would insert a second `2A` beside the
 * one already hanging there the moment a run opened at `2C`.
 *
 * **The piece the run *ends* on is read whole for the same reason** (#499), and
 * that is why the bound below is `<= end.shelf` and not the move's `limit`. A
 * run ending at `2C` owns `2A` and `2B`, so the piece has to be here for those
 * two to be found rather than made a second time; and `2C` itself has to be
 * here so that neither retirement loop in `writeBoundaries` can be handed a
 * piece it has only half of.
 *
 * Nothing here reaches a plank the run does not own. Every loop in
 * `writeBoundaries` that can take one off a face is bounded: the whole-piece
 * retirement skips any piece `wanted` names, which always includes the entry
 * piece, and both loops stop at `band.end` on the piece the run ends on. So the
 * extra rows are read and never written, which is the point.
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
    // second fixture at one position was created later, by whatever produced the
    // interleaving `bandsOf` describes.
    let fixture = byPosition.get(row.fixture_position)
    if (!fixture) {
      fixture = { id: row.fixture_id, areas: new Map(), retired: new Map() }
      byPosition.set(row.fixture_position, fixture)
    }
    if (fixture.id !== row.fixture_id) continue
    if (row.area_id === null || row.area_position === null) continue

    // Retired planks are kept apart rather than dropped, so a boundary being put
    // back finds the row it took out instead of making a second one. A book
    // placed on that plank keeps pointing at the row it was placed on, which is
    // the whole reason the row survived a removal.
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
 * **The run opens at the band's plank, not at the band's bookcase**, and that is
 * #490. `bandOf` answers where a run begins with a `RangeStart`, which is a
 * plank: `ruleForRange` picks the rule and `entryAreaOf` resolves the area it
 * points at, so a rule written on `2C` says the run begins at `2C`.
 * `docs/shelving.md` says the same in one line — "a run runs from its rule's
 * entry area until the next area any rule points at" — and `runFrom` reads it
 * that way in the domain. This read took `start.shelf` and dropped `start.area`,
 * so it handed back `2A, 2B, 2C` and called `2A` the plank the run opens at.
 * Everything downstream of one read then answered from a run two planks too
 * long: `boundariesFrom` invented a boundary and shifted every real one along,
 * so the shelves screen drew six books on a `2E` that does not exist while every
 * plank that does reported nothing; `areaOfKey` landed a book on somebody else's
 * plank, which is the destination the misfile list prints; and `relocateRunTo`
 * would have taken the two planks before the entry off a face they were still
 * the previous run's part of.
 *
 * **The run closes at a plank too, and that is #499 rather than a tidy-up.**
 * This read used `band.limit`, which is a fixture position because *a move*
 * stops one piece earlier than a run does — #420, and `docs/shelving.md` under
 * "A run stops where the next run begins, and a move stops a piece earlier".
 * That decision is untouched and `band.limit` still holds it; what changed is
 * that this statement is not the one it is about. Asking a move's bound which
 * planks a run has cost the two things the band's own docstring names: `2A` and
 * `2B` under a run ending at `2C` fell out of every read while `runFrom` went
 * on giving them to the run before, and two runs opening on one piece bounded
 * the earlier one at its own start, so this statement asked for
 * `f.position >= 2 AND f.position < 2` and a whole range came back with no run.
 *
 * So the band answers both ends with a plank now, and the reader that wants a
 * piece — the move, and only the move — asks `band.limit` for it by name.
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
 * One plank, said both ways.
 *
 * **The id decides and the label is read**, which is the whole of #356 and of
 * #359 after it. Anything working out where a book goes reads `areaId`; anything
 * putting a sentence in front of a person reads `label`.
 *
 * `areaId` is null for exactly one plank: the one a plan proposes to make and
 * has not made yet. There is no row to name, so there is nothing to identify it
 * by, and the caller's job at that point is to make it rather than to write a
 * book onto it.
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
 * is all the arithmetic in shared/layout.ts can know. The furniture addresses it
 * as a row. This is the join between the two, read once, and it is what lets a
 * route take an id in, hand the layout the address it understands, and put a
 * name in front of a person on the way back out.
 */
export interface RunPlanks {
  /** Where in this run a plank stands, or null when the run has no such plank. */
  addressOf(areaId: number): PlankAt | null
  /** The plank at an address, identified and named. */
  at(where: PlankAt): Plank
  /**
   * The piece the plank at an address hangs on, and where it hangs on it.
   *
   * The structural half of `at`, taken off the same row and the same decode, so
   * what a screen groups by and what it prints cannot come from two readings.
   * `at` answers the string a person reads and this answers the furniture, which
   * is the pair #446 put on the listing as `standing` and #447 brings here.
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
}

export async function planksOf(db: Db, range: ShelfRange): Promise<RunPlanks> {
  const run = await runAreasOf(db, range)
  const areas = new Map((await areasStanding(db)).map((area) => [area.id, area]))
  /*
   * The pieces, for the one plank that has no row: a cascade that fills a
   * bookcase proposes a plank below the last one, and until somebody says they
   * carried a book there it does not exist. Naming it `2C` on a piece somebody
   * has called "Hall shelf" would be the very mismatch this is here to close,
   * so the piece is asked for its name and only the letter is invented.
   *
   * One piece per position, the one that was there first, which is the reading
   * `runAreasOf` makes of the same shelves. Two pieces standing at one position
   * is what a second bookcase pushed into the same place looks like, and the run
   * is the one that was there.
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
 * encoding is its own inverse. **A retired area still names the plank it was**,
 * which is the property that matters: a book placed on `1C` before somebody
 * removed the divider above it is still recorded on `1C`, and the misfile list
 * is what says the shelves no longer have one. A marker that lost the number
 * would have the catalogue answering `1@` for a book somebody can go and find.
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
 * **A rule pointing at an area off a face is its own defect** (#420), and it is
 * a quiet one: `furnitureIn` reads `position >= 0`, so `entryAreaOf` answers
 * null, the rule stops opening a run, and every book it claims is filed nowhere
 * while the rule goes on reading as enabled on its own screen. The app was found
 * holding one that filed comics onto a shelf it would not draw.
 *
 * So the answer is not to refuse the retirement and not to delete the rule.
 * **A rule names a place, and when the plank goes the place is the bookcase.**
 * `area_id` becomes null and `fixture_id` the piece the plank was on, which is
 * the same shape a range's own rule already has and resolves, through
 * `entryAreaOf`, to the first area of that piece. The rule keeps claiming the
 * same books and keeps opening a run, one plank up.
 *
 * `removeAreaIfUnused` still refuses to **delete** an area a rule points at, and
 * that is untouched: it runs first, finds the rule, and hands the area here.
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
 * A fixture can have retired the same plank before, which is a plank made,
 * removed, made again and removed again. The second one cannot have the position
 * the first has, so it goes below every position on that fixture and loses the
 * number. That is a worse answer and it is the rare one; the label it loses is
 * for a plank two removals ago.
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
 * The difference from `retireOrRemove` is the whole of #391's first half.
 * Somebody asking for an area to go means the row goes if nothing pins it, and
 * that is `retireOrRemove`. **A move is not that request.** It is about a run of
 * books, and the planks it steps over on the way belong to whoever built them:
 * a plank nobody has filled yet is exactly the one `removeAreaIfUnused` would
 * delete, and it is exactly the one somebody put up this afternoon and gave a
 * name to.
 *
 * `docs/shelving.md` already said so: "The planks the run leaves behind are
 * retired rather than deleted." The code disagreed and the document is the
 * authority.
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
 * Idempotent: writing the boundaries a range already has means nothing.
 *
 * `note` and `name` are left alone on an area that already exists. They are
 * somebody's words about a plank, and a boundary carries neither.
 */
export async function writeBoundaries(
  db: Db,
  range: ShelfRange,
  separators: readonly Separator[],
): Promise<void> {
  const band = await bandOf(db, range)
  if (!band) return

  // The collection everything hangs off. Absent only on a database `0013` has
  // not run on, which has no fixtures to reconcile against either.
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
   * **The run's last piece carries planks the run does not own**, exactly as its
   * first piece does, and #499 is what happens when only the first is accounted
   * for: a run ending at `2C` derives `2A` and `2B`, so the tail would see `2C`
   * sitting past the last derived position and take the next run's entry plank
   * off its face.
   *
   * Undefined on every other piece, which is every piece the run owns whole.
   */
  const beyond = (fixturePosition: number): number | undefined =>
    band.end !== undefined && fixturePosition === band.end.shelf ? band.end.area : undefined

  /*
   * The plank the run opens at, and the one row here does not write an anchor
   * onto. **That is #485, and it is an invariant rather than a repair.**
   *
   * `areasOf` anchors this one at the empty string, which sorts below every
   * sort key, because the walk needs to say "from the beginning" about the
   * plank a book falls onto before it has passed any boundary. That is a fact
   * about the walk. It is not a fact about the plank, and writing it onto the
   * row records **where the run begins** in a column that says **where an area
   * is cut off from the one before it**.
   *
   * Where a run begins is decided in one place: the rule that serves the range,
   * through `ruleForRange` and `entryAreaOf`, which is what `bandsOf` above
   * asks and what `runFrom` asks in the domain. Every walk over a run already
   * reads it from there and never from an anchor: `areaFor` takes the first
   * slot whatever it holds ("the boundaries say where the run is cut, not where
   * it starts"), `areaOfKey` lands on `run[0]` before it looks at anything, and
   * `boundariesFrom` does not give the first area a boundary at all. So the
   * anchor on this row is read by nobody while the run opens here.
   *
   * It was read the moment the run stopped opening here. Taking the rule off an
   * area is one press on "Change what belongs here", and it moved the entry
   * without touching the furniture: the plank kept the empty anchor, `bandsOf`
   * put it back in the middle of the run, and `areaOfKey` and `layoutRange`
   * both sort the boundaries by anchor, so a boundary anchored below every book
   * sorted to the front and the whole ordinal walk slid one plank along. The
   * shelves route then drew a board for a plank that does not exist and left a
   * bookcase holding twelve books undrawn, `areaDisagreements` reported the two
   * readings disagreeing on every book, and three screens gave three counts.
   *
   * Not writing it is the whole fix. An area keeps the anchor it earned through
   * becoming a run's entry and through stopping being one, so there is nothing
   * to restore afterwards and no moment in between when the row is lying.
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
      // The row a book was placed on is the row the ledger names, so putting a
      // boundary back has to put that plank back and not a second one beside it:
      // that is what makes a retraction return a book to where it was recorded
      // rather than to a plank with the same label and a different id.
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
   * and **the piece keeps standing**.
   *
   * It used to be deleted here once nothing was left on it, and #391 is what
   * that cost: a bookcase somebody had put up an hour earlier stood after the
   * run, so a move about two other bookcases reached it, took its planks and
   * then took the piece, and nothing on any screen mentioned either. A piece of
   * furniture is a thing in a room. It goes when somebody says so, through
   * `dropFixture`, which refuses while books or rules are on it and says what
   * becomes of them. Nothing else in this file may delete one.
   */
  for (const [fixturePosition, fixture] of existing) {
    if (wanted.has(fixturePosition)) continue
    /*
     * **And it stops at `limit` and not at `end`, which is #420 exactly.**
     * Emptying a bookcase is a statement about a whole piece, so the piece bound
     * is the one it may go up to: a piece another run begins on is that run's
     * furniture, whether the plank it begins at is the top one or the last.
     * `fixturesIn` reads the piece the run ends on so the planks there can be
     * found rather than made twice, and this loop is the reason that has to be
     * the only thing done with them. Bounding here at `end` instead took the
     * three shelves above somebody's comics rule off the hall bookcase, which is
     * the state #420 is about, arrived at from the other side.
     */
    if (band.limit !== undefined && fixturePosition >= band.limit) continue
    for (const [position, id] of fixture.areas) await retireOrRemove(db, id, position)
  }
}

/**
 * Hang a whole run on a different bookcase.
 *
 * **This is not a fourth statement that writes a boundary.** The three in
 * `DrizzleSeparatorRepository` each change the boundary list of a range, and
 * this one preserves it exactly: the cuts are read before anything moves and
 * written back afterwards, through `writeBoundaries` like every other change to
 * the areas, so the run arrives on the new bookcase with the same number of
 * planks holding the same books. What changes is which furniture the run hangs
 * on, which is `placement_rule.fixture_id`.
 *
 * Called on the caller's transaction handle, and there is a reason it has to be:
 * between the retirement and the write there is a moment when the range's rule
 * points at a bookcase with nothing on its face, and no other reader may see it.
 *
 * ## The order is load bearing
 *
 * The run's own planks are taken out **first**, before the rule is retargeted.
 * They are areas on the face, and leaving them there while the run moved
 * elsewhere would leave a stretch of planks that belong to no run and that the
 * range before this one would flow onto. Retiring them first also means a
 * destination overlapping the source needs no special case: by the time the
 * destination is built, nothing of the old run is standing.
 *
 * A plank that has been retired comes **back** rather than being made again,
 * exactly as `writeBoundaries` restores one, so moving a run away and back
 * returns every book to the row the ledger already names.
 *
 * ## Nothing here deletes anything
 *
 * Every plank of the run is retired, including one no book has ever stood on,
 * and no fixture is removed at all. Both were deletions once and #391 is what
 * they cost: a bookcase somebody had just put up stood after the run with four
 * empty planks on it, so a move about two other bookcases deleted all four and
 * then the piece, silently. What a move does to the furniture is now said in
 * front of somebody first, as `RunMovePlan.emptied`, and what it does is take
 * planks off a face rather than take rows away.
 *
 * ## And it takes nothing off a piece it was not about
 *
 * Not deleting was not enough, which is #420. `boundariesOf` and `runAreasOf`
 * read the range's **band**, and a band was bounded only by the next genre
 * range's start, so the last range in the room reached across every bookcase
 * standing past it. A rule somebody wrote on one of those bookcases cut the run
 * for the plan and not for this write, and the two disagreed by three planks:
 * the plan moved six and this moved seven, so the shelves of a bookcase in
 * another room came off its face onto nothing, and the seventh plank was stood
 * up on the emptied bookcase as a `4D` nobody had asked for.
 *
 * `bandsOf` now stops where any rule's run begins, through `nextRunStartAfter`,
 * which is the cut `runFrom` already made in the domain read a piece at a time.
 * One definition, asked by both, so the planks the plan names are the planks
 * this takes. `refuseAHalfStrippedPiece` is the backstop for the day they drift
 * again.
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
   * **The stretch that moves, said here rather than inherited** (#499).
   *
   * `runAreasOf` answers which planks the run *is*, which since #499 is a plank
   * bound and can therefore run onto a piece another rule stands part way down.
   * A move may not take that piece: #420 is the decision and
   * `refuseAHalfStrippedPiece` below is what stops it being undone quietly. So
   * this reads `band.limit`, the bookcase bound, by name — the same bound
   * `relocateRun` filters the plan by, out of the same `nextRunStartAfter`, so
   * the planks the plan names are still the planks this takes.
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
      // the run today and may not tomorrow, and blanking it here would leave
      // exactly the row #485 is about.
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
 * **A move empties pieces; it does not half strip one.** A plank a move takes
 * off a face is a plank of a piece the run is leaving, the plan says so as
 * `RunMovePlan.emptied` before anybody presses anything, and the books still
 * standing on it reach a person through the piece's own page (#403). A plank
 * taken off a piece that goes on standing with other planks on its face reaches
 * nobody: no screen draws it, the piece does not name it, and the row is there
 * to be found only by somebody reading the table. That is the state #420
 * reports and it is the state this refuses to commit.
 *
 * It cannot fire while `bandsOf` and `relocateRun` stop at the same piece, which
 * is the fix. It is here because they are two functions, they can drift, and the
 * cost of the drift the last time was four shelves nobody could reach and a rule
 * filing books onto one of them. A move that would do it again fails loudly
 * inside its own transaction instead.
 */
async function refuseAHalfStrippedPiece(db: Db, taken: readonly RunArea[]): Promise<void> {
  const ids = taken.map((area) => area.id)
  if (!ids.length) return

  /*
   * Resolved through the rows rather than through `fixturePosition`, because
   * `fixture.position` carries no unique index and the live catalogue already
   * has two pieces numbered 4. Asking by number would judge one piece by
   * another's planks.
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

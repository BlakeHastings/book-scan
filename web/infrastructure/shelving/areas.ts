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
 * ## Statements, not the query builder
 *
 * The reconcile is conditional deletes and find-or-create, which read as SQL and
 * read as machinery through a builder. `areaForLabel` beside it is written the
 * same way and for the same reason.
 */

import { entryAreaOf, type PlacementRule, type RuleOperator } from '../../domain/placement/rules'
import {
  slotsInOrder, type Area, type Fixture, type Slot,
} from '../../domain/placement/geography'
import type { SortStrategy } from '../../domain/placement/strategies'
import { GENRE_RANGES } from '../../domain/tagging/genre'
import type { Db } from '../../server/driver'
import type { RangeStart, Separator } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'

/** One area as the boundaries describe it: where it hangs and what it opens at. */
export interface DerivedArea {
  /** The fixture's ordinal, 1-based, which is the `1` in `1A`. */
  fixturePosition: number
  /** The area's ordinal within it, 0-based, which is the `A` in `1A`. */
  position: number
  /** The sort key of the first book on it. Empty on the first area of a run. */
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

/** A range, and the bookcase the range after it begins on. */
export interface RangeBand {
  start: RangeStart
  /** One past the last bookcase this range may use, or undefined for the last. */
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
 * A disabled rule still says where its run begins, for the reason `entryAreas`
 * counts one: turning a rule off stops it claiming books and does not merge its
 * run into the one before it.
 */
export async function bandsOf(db: Db): Promise<Map<ShelfRange, RangeBand>> {
  const { order, rules } = await furnitureIn(db)

  const starts: { range: ShelfRange; start: RangeStart }[] = []
  for (const { slug, range } of GENRE_RANGES) {
    const rule = rules.find((one) => one.conditions.some((condition) =>
      condition.field === 'tag' && condition.value === slug.value))
    if (!rule) continue

    const areaId = entryAreaOf(rule, order)
    const slot = order.find((one) => one.area.id === areaId)
    if (!slot) continue

    starts.push({
      range,
      start: { shelf: slot.fixture.position, area: slot.area.position },
    })
  }

  starts.sort((a, b) => (a.start.shelf - b.start.shelf) || (a.start.area - b.start.area))

  const bands = new Map<ShelfRange, RangeBand>()
  starts.forEach(({ range, start }, at) => {
    bands.set(range, { start, limit: starts[at + 1]?.start.shelf })
  })
  return bands
}

/** Where one range begins, or null when no rule points anywhere for it. */
export async function bandOf(db: Db, range: ShelfRange): Promise<RangeBand | null> {
  return (await bandsOf(db)).get(range) ?? null
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

/** The fixtures in a band, lowest id first at each position, with their areas. */
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
      WHERE f.position >= ?${band.limit === undefined ? '' : ' AND f.position < ?'}
      ORDER BY f.position, f.id, a.position`,
    band.limit === undefined ? [band.start.shelf] : [band.start.shelf, band.limit],
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
 */
export async function runAreasOf(db: Db, range: ShelfRange): Promise<RunArea[]> {
  const band = await bandOf(db, range)
  if (!band) return []

  const rows = await db.all<RunRow>(
    `SELECT a.id, a.fixture_id, f.position AS fixture_position, a.position, a.starts_at
       FROM area a JOIN fixture f ON f.id = a.fixture_id
      WHERE a.position >= 0
        AND f.position >= ?${band.limit === undefined ? '' : ' AND f.position < ?'}
      ORDER BY f.position, f.id, a.position`,
    band.limit === undefined ? [band.start.shelf] : [band.start.shelf, band.limit],
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

/** Take an area out of the run, whichever way it can go. */
async function retireOrRemove(db: Db, id: number, position: number): Promise<void> {
  if (!(await removeAreaIfUnused(db, id))) await retireArea(db, id, position)
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

  const derived = areasOf(band.start, separators)
    .filter((area) => band.limit === undefined || area.fixturePosition < band.limit)

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
          'UPDATE area SET position = ?, starts_at = ? WHERE id = ?',
          [area.position, area.startsAt, restored],
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
      await db.run(
        'UPDATE area SET starts_at = ? WHERE id = ? AND starts_at IS DISTINCT FROM ?',
        [area.startsAt, id, area.startsAt],
      )
    }

    // The tail of a fixture that has lost boundaries.
    const last = areas[areas.length - 1]!.position
    for (const [position, id] of fixture.areas) {
      if (position > last) await retireOrRemove(db, id, position)
    }
  }

  // Whole bookcases the range no longer reaches. Their areas go first, and the
  // fixture only follows when every one of them went: a fixture still holding an
  // area a book was placed in stays, so the placement keeps somewhere to point.
  for (const [fixturePosition, fixture] of existing) {
    if (wanted.has(fixturePosition)) continue

    for (const [position, id] of fixture.areas) await retireOrRemove(db, id, position)

    await db.run(
      `DELETE FROM fixture WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM area a WHERE a.fixture_id = fixture.id)
         AND NOT EXISTS (SELECT 1 FROM placement_rule r WHERE r.fixture_id = fixture.id)`,
      [fixture.id],
    )
  }
}

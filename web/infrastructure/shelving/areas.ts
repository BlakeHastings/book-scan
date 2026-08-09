/**
 * The areas a range's separators name, and who writes them.
 *
 * This is the bridge #170 leaves behind on the placement side, and it is the
 * same shape `server/photographs.ts` is on the capture side. `area` is the
 * model; `separators` is still what `Shelves.layout`, `Store.resolveKey` and the
 * misfile review read, and cutting all of that over is #220's fourth step.
 * Until then both are written, and this file is the one place that says how a
 * boundary translates into a row.
 *
 * **It is the same derivation `0013_the_shelves_become_fixtures_and_rules.sql`
 * performs, said in TypeScript.** They have to agree, because the migration
 * writes the areas for every separator that existed and this writes them for
 * every separator changed afterwards, and `placement-backfill.test.ts` asserts
 * both halves with one book-by-book comparison.
 *
 * Deleting this file is a late step of the cut-over rather than an early one.
 *
 * ## Why "the boundaries changed" is owned here rather than at each caller
 *
 * `0013` walked `separators` once and built `area` from it. Nothing wrote an
 * area afterwards, so adding, moving or removing a boundary left the two
 * diverging: four separators against two areas, watched live in #185, where a
 * book moved to a plank that came into existence after the migration kept its
 * old placement because no area existed to hold it (#213).
 *
 * The recording therefore lives on the four statements that write `separators`,
 * in `DrizzleSeparatorRepository`, and not on the six places in `Shelves`, the
 * command handler and the routes that call them. A caller cannot forget
 * something it never had to remember, and the application layer keeps a port
 * that says nothing about areas: `SeparatorRepository` is unchanged, so nothing
 * above infrastructure learned a new word.
 *
 * A reconciliation was the alternative and was rejected for the reason #214
 * rejected it for `capture`: a sweep leaves the drift real between its runs, so
 * "does `area` describe this shelf" becomes "as of the last sweep", which is a
 * worse thing to hand a cut-over than the problem it replaces.
 *
 * ## A range at a time, not a boundary at a time
 *
 * A photograph is a fact about one book, so #214 could record one row per
 * statement. An area is not a fact about one separator: `position` counts
 * boundaries from the start of the run and `starts_at` is the anchor of the
 * boundary that opens it, so moving the first boundary of a range re-anchors
 * every area after it. So the unit here is the range, re-derived from the
 * separators as the statement left them, and reconciled against the rows.
 *
 * Reconciled rather than rebuilt, and that is not an optimisation.
 * `book_placement.area_id` and `books.current_area_id` name area rows, so an
 * area that survives a boundary change has to keep its id or the ledger would be
 * pointed at a different plank by furniture being renumbered.
 *
 * ## What happens to an area whose boundary is removed
 *
 * The run gets one shorter, so the **last** area of the range is the one with
 * nothing left to describe: removing the boundary at D from anchors `B, D, F`
 * leaves `B, F`, so the area that was anchored at D is re-anchored to F and the
 * area that was anchored at F is the surplus one.
 *
 * It is deleted **only when nothing names it**. `book_placement.area_id` is
 * `ON DELETE RESTRICT` on purpose: a placement is a record of where a book
 * actually was, and furniture being taken out later must not quietly rewrite it.
 * So an area that has ever held a book is kept, the two models then disagree
 * about the books on it, and `areaDisagreements` says so by name. Nothing is
 * orphaned and nothing is silent, which is the whole of the trade: the ledger
 * keeps its history and the drift is reported rather than papered over.
 *
 * ## Statements, not the query builder
 *
 * Written as SQL against `Db` rather than through Drizzle, the way
 * `areaForLabel` beside it is. The reconcile is conditional deletes and
 * find-or-create, which read as SQL and read as machinery through a builder,
 * and this file is one whose whole future is being deleted.
 */

import type { Db } from '../../server/driver'
import type { RangeStart, Separator } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'

/** One area as the separators describe it: where it hangs and what it opens at. */
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
 * Pure, and separate from the writing for the reason `photographsOf` is: the
 * walk is the claim worth testing on its own, and a test of it needs no
 * database.
 *
 * **Sorted by anchor over a list already in `position` order**, which is the
 * sort `layoutRange` makes and the order `0013` reads the table in. Two
 * boundaries on one anchor is not hypothetical: it is what a boundary move that
 * empties an area leaves behind, and the two have to be stepped over in the
 * order they were recorded or a plank's worth of books draws on the plank
 * before.
 *
 * The run's first area is anchored at the empty string, which sorts below every
 * sort key this catalogue can hold. That is how "from the beginning" is said
 * without a null.
 */
export function areasOf(start: RangeStart, separators: Separator[]): DerivedArea[] {
  const ordered = [...separators]
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))

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

/** A range, and the bookcase the range after it begins on. */
interface RangeBand {
  start: RangeStart
  /** One past the last bookcase this range may use, or undefined for the last. */
  limit?: number
}

interface RangeRow {
  shelf_range: ShelfRange
  start_shelf: number
  start_area: number
}

/**
 * Which bookcases a range's run may occupy.
 *
 * The ranges stand on the floor in one order and their fixtures are numbered in
 * it, which is the order `0013` walks them in and the order
 * `slotsInOrder` reads them back in. So a range's run runs from its own starting
 * bookcase up to the next range's, and nowhere past it.
 *
 * **That bound is a real one and it is the arrangement `0013` refuses.**
 * Non-fiction starts on bookcase 4, so a fiction range that grew to a fourth
 * bookcase would put two fixtures at position 4 and the two runs would
 * interleave, which is a catalogue already drawing two planks with the label
 * `4A`. Nothing here refuses a separator over it, because `separators` is
 * authoritative and a shadow table does not get to veto the shelves. The areas
 * past the bound are simply not written, and `areaDisagreements` names every
 * book the two models then disagree about.
 */
async function bandOf(db: Db, range: ShelfRange): Promise<RangeBand | null> {
  const rows = await db.all<RangeRow>(
    `SELECT shelf_range, start_shelf, start_area FROM shelf_ranges
      ORDER BY start_shelf, start_area, shelf_range`,
  )

  const at = rows.findIndex((row) => row.shelf_range === range)
  if (at === -1) return null

  return {
    start: { shelf: rows[at]!.start_shelf, area: rows[at]!.start_area },
    limit: rows[at + 1]?.start_shelf,
  }
}

interface ExistingRow {
  fixture_id: number
  fixture_position: number
  area_id: number | null
  area_position: number | null
}

/** The fixtures in a band, lowest id first at each position, with their areas. */
async function fixturesIn(
  db: Db,
  band: RangeBand,
): Promise<Map<number, { id: number; areas: Map<number, number> }>> {
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

  const byPosition = new Map<number, { id: number; areas: Map<number, number> }>()
  for (const row of rows) {
    // The first id wins, which is the run this range's own fixtures are in: a
    // second fixture at one position was created later, by whatever produced the
    // interleaving `bandOf` describes.
    let fixture = byPosition.get(row.fixture_position)
    if (!fixture) {
      fixture = { id: row.fixture_id, areas: new Map() }
      byPosition.set(row.fixture_position, fixture)
    }
    if (fixture.id !== row.fixture_id) continue
    if (row.area_id !== null && row.area_position !== null) {
      fixture.areas.set(row.area_position, row.area_id)
    }
  }

  return byPosition
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
 * Write down the areas a range's separators now name.
 *
 * Called by every statement that writes `separators`, on that statement's
 * transaction handle, so the boundary and the areas commit together or neither
 * does.
 *
 * Reads the separators rather than being handed them, which is the opposite of
 * what `recordPhotographsOf` does with its row and for the same reason: the
 * caller has written one boundary and the answer is about all of them, so a
 * read is what makes this describe the table as the statement left it.
 *
 * Idempotent. Calling it twice about one range means the same as calling it
 * once, so it is also the repair for a range that drifted before this existed:
 * the next boundary written in that range brings it back into step.
 *
 * `note` is left alone on an area that already exists. A note is somebody's word
 * about a boundary, `Separator` does not carry one, and nothing in the shelving
 * code has ever written one, so there is nothing here to copy and no reason to
 * blank what `0013` carried over.
 */
export async function recordAreasOf(db: Db, range: ShelfRange): Promise<void> {
  const band = await bandOf(db, range)
  if (!band) return

  // The collection everything hangs off. Absent only on a database `0013` has
  // not run on, which has no fixtures to reconcile against either.
  const collection = await db.get<{ id: number }>(
    'SELECT id FROM collection ORDER BY id LIMIT 1',
  )
  if (!collection) return

  const separators = await db.all<{ kind: 'shelf' | 'area'; starts_at: string; position: number }>(
    'SELECT kind, starts_at, position FROM separators WHERE shelf_range = ? ORDER BY position',
    [range],
  )

  const derived = areasOf(band.start, separators.map((row): Separator => ({
    id: 0,
    range,
    kind: row.kind,
    startsAt: row.starts_at,
    position: row.position,
  }))).filter((area) => band.limit === undefined || area.fixturePosition < band.limit)

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
      fixture = { id: row.id, areas: new Map() }
    }

    for (const area of areas) {
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
      if (position > last) await removeAreaIfUnused(db, id)
    }
  }

  // Whole bookcases the range no longer reaches. Their areas go first, and the
  // fixture only follows when every one of them went: a fixture still holding an
  // area a book was placed in stays, so the placement keeps somewhere to point.
  for (const [fixturePosition, fixture] of existing) {
    if (wanted.has(fixturePosition)) continue

    let emptied = true
    for (const id of fixture.areas.values()) {
      if (!(await removeAreaIfUnused(db, id))) emptied = false
    }
    if (!emptied) continue

    await db.run(
      `DELETE FROM fixture WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM area a WHERE a.fixture_id = fixture.id)
         AND NOT EXISTS (SELECT 1 FROM placement_rule r WHERE r.fixture_id = fixture.id)`,
      [fixture.id],
    )
  }
}

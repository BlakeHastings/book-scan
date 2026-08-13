/**
 * The furniture as rows: reading a piece back, and writing one somebody
 * described.
 *
 * `areas.ts` beside this file writes the areas a **boundary change** implies,
 * reconciling a derived list against the rows. This one writes the areas a
 * **person** asked for: a bookcase they own, named, with the planks they can
 * see on it. Both end up in the same two tables and they are deliberately not
 * the same function, because reconciling a list and honouring a request are
 * different jobs and the second one has to be able to say what it did.
 *
 * ## Renumbering is where the unique index bites
 *
 * `area_fixture_position_key` stops two areas on one fixture sharing an ordinal,
 * and Postgres checks a unique index **per row** rather than at the end of the
 * statement. So the obvious `UPDATE area SET position = position + 1` collides
 * with itself the moment two of the rows it is walking are adjacent, and so does
 * a loop that writes each area's new ordinal in turn: moving `C` to `A` puts it
 * on top of the `A` that has not moved yet.
 *
 * `resequenceFace` therefore writes every ordinal **twice**. The first pass
 * parks each area above every ordinal on the fixture, where nothing can be
 * standing; the second brings them down to the numbers they were given. No row
 * ever holds a number another row holds, at any point in either pass, so the
 * index never has to be relaxed and there is nothing to defer.
 *
 * **The index is not the thing to change.** `fixture.position` is deliberately
 * not unique and `docs/data-model.md` says why, and the area index is the other
 * half of that decision: one fixture with two areas called `B` is a shelf with
 * two planks nobody can tell apart, which is not a catalogue anybody has.
 *
 * ## The parking band cannot reach the retired areas
 *
 * A retired area sits at a negative ordinal, `-(plank + 1)`, which is how a
 * plank a book was placed on stays nameable after somebody takes the divider
 * out. The parking band is above every ordinal in use and therefore positive, so
 * a renumbering can neither collide with a retired area nor accidentally bring
 * one back onto the face. See `retiredPosition` and `faceOf` in `areas.ts`.
 */

import type { SortStrategy } from '../../domain/placement/strategies'
import type { Db } from '../../server/driver'

/** A fixture as the rows hold it. */
export interface FixtureRow {
  id: number
  collectionId: number
  position: number
  kind: string
  name: string
  sortStrategy: SortStrategy
  note: string
}

/** An area as the rows hold it, with how many books are standing in it. */
export interface AreaRow {
  id: number
  fixtureId: number
  position: number
  name: string
  startsAt: string
  sortStrategy: SortStrategy
  note: string
  books: number
}

interface RawFixture {
  id: number
  collection_id: number
  position: number
  kind: string
  name: string
  sort_strategy: SortStrategy
  note: string
}

interface RawArea {
  id: number
  fixture_id: number
  position: number
  name: string
  starts_at: string
  sort_strategy: SortStrategy
  note: string
  books: number
}

/**
 * Every fixture on the floor, in the order a book meets them.
 *
 * `position >= 0` throughout, which is the whole of what keeps a retired area
 * off the face. Ordered by position and then by id, the same total order
 * `slotsInOrder` imposes, because two fixtures really can carry one position and
 * without the id the answer would vary between reads.
 */
export async function fixturesOnTheFloor(db: Db): Promise<FixtureRow[]> {
  const rows = await db.all<RawFixture>(
    `SELECT id, collection_id, position, kind, name, sort_strategy, note
       FROM fixture WHERE position >= 0 ORDER BY position, id`,
  )
  return rows.map((row) => ({
    id: Number(row.id),
    collectionId: Number(row.collection_id),
    position: Number(row.position),
    kind: row.kind,
    name: row.name,
    sortStrategy: row.sort_strategy,
    note: row.note,
  }))
}

/**
 * Every area on a face, in the order it sits, with its book count.
 *
 * The count is `books.current_area_id`, which is the projection of the ledger
 * and therefore what a person would find if they walked to the plank: an
 * assignment nobody has acted on does not move a book and does not count here.
 */
export async function areasOnFaces(db: Db): Promise<AreaRow[]> {
  const rows = await db.all<RawArea>(
    `SELECT a.id, a.fixture_id, a.position, a.name, a.starts_at, a.sort_strategy, a.note,
            (SELECT count(*) FROM books b WHERE b.current_area_id = a.id) AS books
       FROM area a WHERE a.position >= 0 ORDER BY a.fixture_id, a.position`,
  )
  return rows.map((row) => ({
    id: Number(row.id),
    fixtureId: Number(row.fixture_id),
    position: Number(row.position),
    name: row.name,
    startsAt: row.starts_at,
    sortStrategy: row.sort_strategy,
    note: row.note,
    books: Number(row.books),
  }))
}

/** One fixture, or nothing when the id names a retired one or none at all. */
export async function fixtureOnTheFloor(db: Db, id: number): Promise<FixtureRow | null> {
  return (await fixturesOnTheFloor(db)).find((one) => one.id === id) ?? null
}

/** One area on a face, or nothing when it has been retired or never existed. */
export async function areaOnAFace(db: Db, id: number): Promise<AreaRow | null> {
  return (await areasOnFaces(db)).find((one) => one.id === id) ?? null
}

/** The one row everything hangs off, or nothing on a database with no schema. */
export async function collectionId(db: Db): Promise<number | null> {
  const row = await db.get<{ id: number }>('SELECT id FROM collection ORDER BY id LIMIT 1')
  return row ? Number(row.id) : null
}

/** The strategies a person may choose between, which is the offerable ones. */
export async function offerableStrategies(
  db: Db,
): Promise<{ code: SortStrategy; label: string; isInherit: boolean }[]> {
  const rows = await db.all<{ code: SortStrategy; label: string; is_inherit: boolean }>(
    'SELECT code, label, is_inherit FROM sort_strategy WHERE available ORDER BY is_inherit DESC, code',
  )
  return rows.map((row) => ({ code: row.code, label: row.label, isInherit: row.is_inherit }))
}

/** What the collection falls back on, which is never `inherit`. */
export async function collectionStrategy(db: Db): Promise<SortStrategy> {
  const row = await db.get<{ default_sort_strategy: SortStrategy }>(
    'SELECT default_sort_strategy FROM collection ORDER BY id LIMIT 1',
  )
  return row?.default_sort_strategy ?? 'author'
}

export interface NewFixture {
  collectionId: number
  kind: string
  name: string
  position: number
  sortStrategy: SortStrategy
  note: string
}

/** Write a piece of furniture down. Answers the id it was given. */
export async function insertFixture(db: Db, fixture: NewFixture): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO fixture (collection_id, kind, name, position, sort_strategy, note)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      fixture.collectionId, fixture.kind, fixture.name, fixture.position,
      fixture.sortStrategy, fixture.note,
    ],
  )
  return Number(row!.id)
}

/** The number the next piece takes when nobody says where it goes. */
export async function nextFixturePosition(db: Db): Promise<number> {
  const row = await db.get<{ top: number }>(
    'SELECT coalesce(max(position), 0) AS top FROM fixture WHERE position >= 0',
  )
  return Number(row?.top ?? 0) + 1
}

export interface FixtureEdit {
  kind?: string
  name?: string
  position?: number
  sortStrategy?: SortStrategy
  note?: string
}

/**
 * Change a piece of furniture.
 *
 * A plain update, including for `position`, because `fixture.position` carries
 * no unique index and must not gain one: the live catalogue already has two
 * pieces numbered 4, and refusing that would refuse an arrangement somebody has.
 * Renumbering the pieces around it would be worse than allowing the duplicate,
 * since every label on every one of them is derived from its number and moving
 * them all would relabel every book in the house.
 */
export async function updateFixture(db: Db, id: number, edit: FixtureEdit): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    if (value === undefined) return
    sets.push(`${column} = ?`)
    values.push(value)
  }

  set('kind', edit.kind)
  set('name', edit.name)
  set('position', edit.position)
  set('sort_strategy', edit.sortStrategy)
  set('note', edit.note)
  if (!sets.length) return

  await db.run(`UPDATE fixture SET ${sets.join(', ')} WHERE id = ?`, [...values, id])
}

export interface NewArea {
  fixtureId: number
  position: number
  name: string
  startsAt: string
  sortStrategy: SortStrategy
  note: string
}

/** Write a plank down. Answers the id it was given. */
export async function insertArea(db: Db, area: NewArea): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO area (fixture_id, position, name, starts_at, sort_strategy, note)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      area.fixtureId, area.position, area.name, area.startsAt,
      area.sortStrategy, area.note,
    ],
  )
  return Number(row!.id)
}

export interface AreaEdit {
  name?: string
  startsAt?: string
  sortStrategy?: SortStrategy
  note?: string
}

export async function updateArea(db: Db, id: number, edit: AreaEdit): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    if (value === undefined) return
    sets.push(`${column} = ?`)
    values.push(value)
  }

  set('name', edit.name)
  set('starts_at', edit.startsAt)
  set('sort_strategy', edit.sortStrategy)
  set('note', edit.note)
  if (!sets.length) return

  await db.run(`UPDATE area SET ${sets.join(', ')} WHERE id = ?`, [...values, id])
}

/**
 * Give a fixture's face the ordinals `order` asks for, 0, 1, 2 and on.
 *
 * **Two passes, and the reason is at the top of this file.** Every area is
 * parked above every ordinal on the fixture first, then brought down. A single
 * pass would put an area on an ordinal another area still holds, and the unique
 * index refuses that the moment the row is written rather than at commit.
 *
 * `order` must be the whole face. Handing it a subset would leave the areas it
 * left out holding ordinals inside the range being written, which is the same
 * collision arriving from the other direction.
 *
 * Call it on a transaction handle. Between the two passes the fixture's areas
 * are all sitting a long way off its face, and no other reader may see that.
 */
export async function resequenceFace(
  db: Db,
  fixtureId: number,
  order: readonly number[],
): Promise<void> {
  if (!order.length) return

  const row = await db.get<{ top: number }>(
    'SELECT coalesce(max(position), -1) AS top FROM area WHERE fixture_id = ? AND position >= 0',
    [fixtureId],
  )
  const park = Math.max(Number(row?.top ?? -1), order.length - 1) + 1

  for (const [at, id] of order.entries()) {
    await db.run(
      'UPDATE area SET position = ? WHERE id = ? AND fixture_id = ?',
      [park + at, id, fixtureId],
    )
  }
  for (const [at, id] of order.entries()) {
    await db.run(
      'UPDATE area SET position = ? WHERE id = ? AND fixture_id = ?',
      [at, id, fixtureId],
    )
  }
}

/** What still names a fixture, which is what stands between it and deletion. */
export interface FixtureHolds {
  areas: number
  books: number
  rules: number
  /**
   * True when the row will outlive the removal because the ledger names one of
   * its planks. See `FixtureRemoval.retires`.
   */
  retires: boolean
}

export async function whatHoldsFixture(db: Db, id: number): Promise<FixtureHolds> {
  const row = await db.get<{ areas: number; books: number; rules: number; recorded: number }>(
    `SELECT
       (SELECT count(*) FROM area a WHERE a.fixture_id = ? AND a.position >= 0) AS areas,
       (SELECT count(*) FROM books b JOIN area a ON a.id = b.current_area_id
         WHERE a.fixture_id = ?) AS books,
       (SELECT count(*) FROM placement_rule r
          LEFT JOIN area a ON a.id = r.area_id
         WHERE r.fixture_id = ? OR a.fixture_id = ?) AS rules,
       (SELECT count(*) FROM area a
         WHERE a.fixture_id = ?
           AND EXISTS (SELECT 1 FROM book_placement p WHERE p.area_id = a.id)) AS recorded`,
    [id, id, id, id, id],
  )
  return {
    areas: Number(row?.areas ?? 0),
    books: Number(row?.books ?? 0),
    rules: Number(row?.rules ?? 0),
    retires: Number(row?.recorded ?? 0) > 0,
  }
}

/**
 * Take a fixture away, once nothing names it.
 *
 * Conditional rather than attempted, for `removeAreaIfUnused`'s reason: the
 * alternative is a foreign key violation rolling back whatever else the caller
 * was doing. A fixture still carrying an area that a book was ever placed in
 * stays, because that area cannot go, and the history pinning the furniture it
 * names is the point.
 */
export async function removeFixtureIfUnused(db: Db, id: number): Promise<boolean> {
  const { changes } = await db.run(
    `DELETE FROM fixture WHERE id = ?
       AND NOT EXISTS (SELECT 1 FROM area a WHERE a.fixture_id = fixture.id)
       AND NOT EXISTS (SELECT 1 FROM placement_rule r WHERE r.fixture_id = fixture.id)`,
    [id],
  )
  return changes > 0
}

/**
 * Every book whose history mentions an area, whether it is standing there now or
 * only ever was.
 *
 * The union is not belt and braces. `books.current_area_id` holds where a person
 * put a book, and `book_placement` holds that as well as an assignment nobody
 * has acted on: a book the rules moved here last week and nobody carried is
 * still a book this area is about, and leaving it out would strand its
 * assignment on a plank that no longer exists.
 */
export async function booksNaming(db: Db, areaId: number): Promise<number[]> {
  const rows = await db.all<{ id: number }>(
    `SELECT DISTINCT b.id FROM books b
      WHERE b.current_area_id = ?
         OR EXISTS (SELECT 1 FROM book_placement p WHERE p.book_id = b.id AND p.area_id = ?)
      ORDER BY b.id`,
    [areaId, areaId],
  )
  return rows.map((row) => Number(row.id))
}

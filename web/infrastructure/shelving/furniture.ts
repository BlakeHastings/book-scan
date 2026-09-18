/**
 * The furniture as rows: reading a piece back, and writing one somebody
 * described.
 *
 * `areas.ts` beside this file writes the areas a boundary change implies; this
 * one writes the areas a person asked for. Both end up in the same two tables
 * and they are deliberately not the same function.
 *
 * `area_fixture_position_key` stops two areas on one fixture sharing an ordinal,
 * and Postgres checks a unique index per row rather than at the end of the
 * statement. So `UPDATE area SET position = position + 1` collides with itself
 * the moment two of the rows it is walking are adjacent, and so does a loop that
 * writes each area's new ordinal in turn. `resequenceFace` therefore writes
 * every ordinal twice: the first pass parks each area above every ordinal on the
 * fixture, the second brings them down to the numbers they were given, so no row
 * ever holds a number another row holds at any point.
 *
 * The parking band is above every ordinal in use and therefore positive, so a
 * renumbering can neither collide with a retired area, which sits at
 * `-(plank + 1)`, nor bring one back onto the face. See `retiredPosition` and
 * `faceOf` in `areas.ts`.
 */

import { standingOf, type Placement } from '../../domain/placement/ledger'
import type { SortStrategy } from '../../domain/placement/strategies'
import type { Db } from '../../server/driver'
import { DrizzlePlacementLedger } from '../placement/ledger-repository'
import { areasStanding, retiredPosition } from './areas'

export interface FixtureRow {
  id: number
  collectionId: number
  position: number
  kind: string
  name: string
  sortStrategy: SortStrategy
  note: string
}

export interface AreaRow {
  id: number
  fixtureId: number
  position: number
  name: string
  startsAt: string
  sortStrategy: SortStrategy
  note: string
  books: number
  /**
   * True when it has been taken off the face and the row kept, which is what
   * `retiredPosition` records. `position` is the plank it still is.
   */
  gone: boolean
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

/**
 * Every fixture on the floor, in the order a book meets them.
 *
 * `position >= 0` throughout, which is what keeps a retired piece off the floor.
 * Ordered by position and then by id, the same total order `slotsInOrder`
 * imposes, because two fixtures really can carry one position and without the id
 * the answer would vary between reads.
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
 * Every area there has ever been, in the order it sits, with its book count.
 *
 * The count is `books.current_area_id`, which is the projection of the ledger
 * and therefore what a person would find if they walked to the plank: an
 * assignment nobody has acted on does not move a book and does not count here.
 *
 * It comes from `areasStanding` rather than from a statement of its own, so a
 * book standing on a retired plank is counted by the reads that draw a room, a
 * piece or an area as well as by the carry list.
 */
export async function everyArea(db: Db): Promise<AreaRow[]> {
  return (await areasStanding(db)).map((area) => ({
    id: area.id,
    fixtureId: area.fixtureId,
    position: area.position,
    name: area.name,
    startsAt: area.startsAt,
    sortStrategy: area.sortStrategy,
    note: area.note,
    books: area.books,
    gone: area.gone,
  }))
}

/**
 * The same, narrowed to the areas that are on a face, which is what everything
 * that draws a piece of furniture wants: putting a retired plank back into this
 * list would put a boundary back into every run derived from it. What a retired
 * plank still has is books standing on it, and that is `everyArea`'s to answer.
 */
export async function areasOnFaces(db: Db): Promise<AreaRow[]> {
  return (await everyArea(db)).filter((area) => !area.gone)
}

/** One fixture, or nothing when the id names a retired one or none at all. */
export async function fixtureOnTheFloor(db: Db, id: number): Promise<FixtureRow | null> {
  return (await fixturesOnTheFloor(db)).find((one) => one.id === id) ?? null
}

/** One area on a face, or nothing when it has been retired or never existed. */
export async function areaOnAFace(db: Db, id: number): Promise<AreaRow | null> {
  return (await areasOnFaces(db)).find((one) => one.id === id) ?? null
}

/**
 * One area whatever has become of it, or nothing when no such row exists.
 *
 * For the reads that are about the books rather than about the furniture. An
 * area's own page is one: books standing on a plank somebody took out is a page
 * that has to open, and `areaOnAFace` answers 404 for it.
 */
export async function anyArea(db: Db, id: number): Promise<AreaRow | null> {
  return (await everyArea(db)).find((one) => one.id === id) ?? null
}

/** The one row everything hangs off, or nothing on a database with no schema. */
export async function collectionId(db: Db): Promise<number | null> {
  const row = await db.get<{ id: number }>('SELECT id FROM collection ORDER BY id LIMIT 1')
  return row ? Number(row.id) : null
}

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

/**
 * Change what the collection falls back on.
 *
 * Answers whether a row was there to write: a database with no collection in it
 * is a database with no schema, and a silent no-op would look from the screen
 * exactly like a setting that saves.
 *
 * It moves no book and reorders nothing by itself. This is the answer the
 * placement rules read next time they are asked where a book belongs, and the
 * difference between that and where a book actually stands is the carry list.
 */
export async function updateCollectionStrategy(
  db: Db,
  strategy: SortStrategy,
): Promise<boolean> {
  const row = await db.get<{ id: number }>('SELECT id FROM collection ORDER BY id LIMIT 1')
  if (!row) return false
  await db.run('UPDATE collection SET default_sort_strategy = ? WHERE id = ?', [
    strategy, Number(row.id),
  ])
  return true
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
 * no unique index and must not gain one: two pieces numbered the same is an
 * arrangement somebody has, and refusing it would refuse their catalogue.
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
 * Two passes, for the reason at the top of this file. Every area is parked above
 * every ordinal on the fixture first, then brought down. A single pass would put
 * an area on an ordinal another area still holds, and the unique index refuses
 * that the moment the row is written rather than at commit.
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

export interface FixtureHolds {
  areas: number
  /**
   * Every book the piece is still about: standing on one of its planks, or
   * assigned to one and not carried yet.
   */
  books: number
  /**
   * How many of `books` are not on the piece at all and are on their way to it,
   * because the rules put them on one of its planks and nobody has walked it.
   */
  assigned: number
  rules: number
  /**
   * True when the row will outlive the removal because the ledger names one of
   * its planks. See `FixtureRemoval.retires`.
   */
  retires: boolean
}

/**
 * What still names a fixture, which is what stands between it and deletion.
 *
 * `books` is the question `booksNaming` answers, asked of a whole piece. A book
 * the rules have assigned to a plank here and nobody has carried yet is standing
 * somewhere else, so counting `books.current_area_id` alone would let the
 * refusal miss it, retire every plank, and leave the assignment naming one that
 * is off every face.
 *
 * The standing half comes out of `areasStanding`, through `everyArea`, rather
 * than out of a count of its own: there is one statement in this app that counts
 * the books standing on an area, and this is not allowed to become a second.
 */
export async function whatHoldsFixture(db: Db, id: number): Promise<FixtureHolds> {
  const row = await db.get<{ areas: number; rules: number; recorded: number }>(
    `SELECT
       (SELECT count(*) FROM area a WHERE a.fixture_id = ? AND a.position >= 0) AS areas,
       (SELECT count(*) FROM placement_rule r
          LEFT JOIN area a ON a.id = r.area_id
         WHERE r.fixture_id = ? OR a.fixture_id = ?) AS rules,
       (SELECT count(*) FROM area a
         WHERE a.fixture_id = ?
           AND EXISTS (SELECT 1 FROM book_placement p WHERE p.area_id = a.id)) AS recorded`,
    [id, id, id, id],
  )

  // Every plank, retired ones included: a book left standing on a plank a
  // boundary took out is still a book on this piece.
  const planks = (await everyArea(db)).filter((area) => area.fixtureId === id)
  const standing = planks.reduce((count, area) => count + area.books, 0)
  const assigned = await booksOnTheirWayTo(db, planks.map((area) => area.id))

  return {
    areas: Number(row?.areas ?? 0),
    books: standing + assigned,
    assigned,
    rules: Number(row?.rules ?? 0),
    retires: Number(row?.recorded ?? 0) > 0,
  }
}

/**
 * How many books the rules have sent to one of these planks and nobody has
 * carried, counting only the ones not standing on one of them already.
 *
 * The same two steps `planAreaRemoval` takes for a single plank. `booksNaming`
 * answers every book a plank has ever been about, which includes the ones that
 * only passed through, and the ledger is what says which of those the plank is
 * still about today: a piece that once held books but holds none and is owed
 * none goes, and a piece somebody is still being told to carry a book to does
 * not.
 *
 * Narrowed before it is added to the standing count: a book standing on one
 * plank of a piece and assigned to another is one book, and counting it twice
 * would put a number on a screen that nothing in the room matches.
 */
async function booksOnTheirWayTo(db: Db, planks: readonly number[]): Promise<number> {
  if (!planks.length) return 0

  const naming = [...new Set(
    (await Promise.all(planks.map((plank) => booksNaming(db, plank)))).flat(),
  )]
  if (!naming.length) return 0

  const history = new Map<number, Placement[]>()
  for (const row of await new DrizzlePlacementLedger(db).forBooks(naming)) {
    const rows = history.get(row.bookId)
    if (rows) rows.push(row)
    else history.set(row.bookId, [row])
  }

  const on = new Set(planks)
  return naming.filter((book) => {
    const standing = standingOf(history.get(book) ?? [])
    return standing.assigned !== null
      && on.has(standing.assigned)
      && !(standing.area !== null && on.has(standing.area))
  }).length
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
 * Take a piece off the floor without deleting it.
 *
 * The fixture's answer to `retireArea`, and deliberately the same encoding:
 * `-(position + 1)`, so bookcase 4 goes to -5 and still names the bookcase it
 * was. Every read that draws the room already filters `position >= 0`, so the
 * piece leaves the floor, stops taking a number from `nextFixturePosition` and
 * stops falling inside any range's band; every read that turns a stored position
 * into a label decodes it back through `faceOf`, so a book recorded on `4A`
 * still reads as `4A`.
 *
 * It is needed because the row cannot always go. `book_placement.area_id` is
 * ON DELETE RESTRICT, so a piece whose planks a book was ever placed on keeps
 * every one of them and therefore keeps itself.
 *
 * No collision to handle, unlike `retireArea`. `fixture.position` carries no
 * unique index, deliberately (`updateFixture` says why), so two pieces retired
 * from one number is a thing the rows can hold.
 */
export async function retireFixture(db: Db, id: number, position: number): Promise<void> {
  await db.run('UPDATE fixture SET position = ? WHERE id = ?', [retiredPosition(position), id])
}

/**
 * Every book whose history mentions an area, whether it is standing there now or
 * only ever was.
 *
 * The union is not belt and braces. `books.current_area_id` holds where a person
 * put a book, and `book_placement` holds that as well as an assignment nobody
 * has acted on: a book the rules moved here and nobody carried is still a book
 * this area is about, and leaving it out would strand its assignment on a plank
 * that no longer exists.
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

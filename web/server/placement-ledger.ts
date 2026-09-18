/**
 * Where a book is, on the way in and on the way out.
 *
 * No statement anywhere reads a location from `books`. This file is the only
 * place a placement is written and the only place one is read back as the flat
 * shape the wire still speaks in, where `location` and `checked_out_at` keep the
 * names the dropped columns had.
 *
 * There are exactly four statements in this repository that change where a book
 * is, and all four are in `store.ts`: the insert in `addBook`, the update in
 * `updateBook`, `setLocation` and `setCheckedOut`. Every one of them calls into
 * this file, inside its own transaction, so a placement cannot be written without
 * a row. A fifth would have to be added to `Store` beside them.
 *
 * Two things the routes therefore refuse: a location naming furniture the
 * collection does not have, because there is nothing behind the ledger to hold
 * such a label, and an empty label, because the ledger is append only and there
 * is nothing to unsay. Neither refusal is reachable from the app.
 */

import { labelFor, type Area, type Fixture } from '../domain/placement/geography'
import { faceOf } from '../infrastructure/shelving/areas'
import { CHECKED_OUT } from '../domain/books/state'
import { areaIndex } from '../shared/layout'
import { parseLocation, type AreaStanding } from '../shared/shelving'
import { areaForLabel, DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import type { Db } from './driver'

export interface PlacedBook {
  id: number
  /** The book's sort key as the same statement is writing it. */
  sortKey: string
  /** The recorded location, exactly as it is being written down. */
  location: string
}

/**
 * The area a recorded label names, or null when nothing does. `parseLocation`
 * first, so `s4 b`, `S4B` and `4B` are the one plank they are everywhere else.
 */
export async function areaOfLocation(db: Db, label: string): Promise<number | null> {
  const parsed = parseLocation(label)
  if (!parsed) return null

  const position = areaIndex(parsed.section)
  if (position < 0) return null

  return areaForLabel(db, parsed.shelf, position)
}

/**
 * A location naming furniture the collection does not have.
 *
 * Thrown rather than returned, so the transaction that was writing it rolls
 * back: a save that could not record where the book went must not half-happen.
 * The routes turn it into a 400 with this sentence in it.
 */
export class UnknownPlank extends Error {
  constructor(readonly label: string) {
    super(label
      ? `There is no plank called ${label}, so a book cannot be recorded on it.`
      : 'There is no such plank, so a book cannot be recorded on it.')
  }
}

/**
 * Record that somebody put this book where `location` says.
 *
 * Called from inside the transaction that writes the book, and given that
 * transaction's handle, so the row and everything else the save writes commit
 * together or neither does.
 *
 * An empty label writes nothing, and that is not the same as refusing one: an
 * edit that carries no location says nothing about the room. A label naming no
 * plank is refused, because there is nowhere for it to be recorded.
 */
export async function recordPlaced(db: Db, book: PlacedBook, at: string): Promise<void> {
  const label = book.location.trim()
  if (!label) return

  const areaId = await areaOfLocation(db, label)
  if (areaId === null) throw new UnknownPlank(label)

  await recordPlacedIn(db, book, areaId, at, `recorded at ${label}`)
}

/**
 * The same, for a caller that already holds the plank rather than its name. The
 * area is checked to exist rather than trusted, because the ledger's foreign key
 * would otherwise answer an id off a screen with a constraint violation halfway
 * through a transaction instead of with a sentence somebody can read.
 */
export async function recordPlacedIn(
  db: Db,
  book: PlacedBook,
  areaId: number,
  at: string,
  reason = 'recorded on the plank it was put on',
): Promise<void> {
  const area = await db.get<{ id: number }>('SELECT id FROM area WHERE id = ?', [areaId])
  if (!area) throw new UnknownPlank('')

  await new DrizzlePlacementLedger(db).record({
    bookId: book.id,
    kind: 'placed',
    areaId,
    sortKey: book.sortKey,
    actor: 'person',
    reason,
    createdAt: at,
  })
}

/**
 * A book's placement, flattened to the shape the wire still asks for.
 *
 * Every field is derived and none of them is a column. `location` is the label of
 * the area `books.current_area_id` names, which is the projection of the ledger
 * and is checked against it on every start; `checked_out_at` is when the latest
 * `checked_out` row was written, and only while the book is in that state.
 */
export interface PlacementFields {
  /** Where a person last said the book is, or '' for a book nobody has placed. */
  location: string
  /**
   * The area `location` is a rendering of, or null for a book nobody has placed.
   * It travels beside the label because a label answers "what does somebody
   * read" and only the id answers "is this the same place".
   */
  area_id: number | null
  /**
   * Where that area stands, and what the piece holding it is called: which boards
   * come in which order, and what to write over the ones that share a piece. Null
   * with `area_id`, for a book nobody has placed. See `AreaStanding`.
   */
  standing: AreaStanding | null
  /** Set while the book is off the shelf, null while it is on one. */
  checked_out_at: string | null
}

/** A book nowhere, which is every book nobody has put anywhere. */
export const NOT_PLACED: PlacementFields = {
  location: '', area_id: null, standing: null, checked_out_at: null,
}

interface PlacementRow {
  id: number
  area_id: number | null
  fixture_id: number | null
  fixture_position: number | null
  fixture_name: string | null
  fixture_kind: string | null
  area_position: number | null
  area_name: string | null
  checked_out_at: string | null
}

/**
 * The label is built by the domain, not by the statement. `labelFor` is the one
 * place a fixture's position and an area's become the thing written on a recorded
 * location, and deriving it a second time in SQL would be a second answer to what
 * a plank is called.
 */
function fieldsOf(row: PlacementRow): PlacementFields {
  return {
    location: labelOf(row),
    area_id: row.area_id === null ? null : Number(row.area_id),
    standing: standingOn(row),
    checked_out_at: row.checked_out_at,
  }
}

/**
 * Where the joined fixture and area stand, or null when the book is on neither.
 * The same three columns `labelOf` reads and the same `faceOf` decode, taken once
 * so that what a drawing orders by and what a person reads cannot come from two
 * different readings of one row.
 */
function standingOn(row: PlacementRow): AreaStanding | null {
  if (row.fixture_id === null || row.fixture_position === null || row.area_position === null) {
    return null
  }

  return {
    fixtureId: Number(row.fixture_id),
    fixture: faceOf(Number(row.fixture_position)),
    plank: faceOf(Number(row.area_position)),
    name: row.fixture_name ?? '',
    kind: row.fixture_kind ?? '',
  }
}

/** Where a joined fixture and area read as a label, or '' for neither. */
function labelOf(row: {
  fixture_id: number | null
  fixture_position: number | null
  fixture_name: string | null
  area_position: number | null
  area_name: string | null
}): string {
  if (row.fixture_id === null || row.fixture_position === null || row.area_position === null) {
    return ''
  }

  const fixture: Fixture = {
    id: row.fixture_id,
    // The same decode as the plank below, because a piece can be off the floor
    // with books still recorded on it. See `retireFixture`.
    position: faceOf(row.fixture_position),
    kind: '',
    name: row.fixture_name ?? '',
    sortStrategy: 'inherit',
  }
  const area: Area = {
    id: 0,
    fixtureId: row.fixture_id,
    /*
     * `faceOf`, because a book can be recorded on a plank the shelves no longer
     * have: the area was retired rather than deleted because this placement names
     * it. What a person wrote down is still "1C", and reading the stored negative
     * straight would answer `1@` about a book somebody can go and find.
     */
    position: faceOf(row.area_position),
    name: row.area_name ?? '',
    startsAt: '',
    sortStrategy: 'inherit',
  }

  return labelFor({ fixture, area })
}

/**
 * Where a book has been, newest first.
 *
 * Bounded, because a book that has been carried around for years has a long
 * ledger and this is drawn on a phone. What is not returned is said by `total`
 * rather than quietly dropped.
 */
export interface Been {
  kind: string
  /** The plank it names, as the label reads off the furniture. '' for neither. */
  location: string
  /** `person` or `app`, which is what makes a carry different from a decision. */
  actor: string
  reason: string
  at: string
}

export async function historyOf(
  db: Db,
  bookId: number,
  limit = 40,
): Promise<{ been: Been[]; total: number }> {
  const counted = await db.get<{ total: number }>(
    'SELECT CAST(COUNT(*) AS INTEGER) AS total FROM book_placement WHERE book_id = ?',
    [bookId],
  )

  const rows = await db.all<{
    kind: string
    actor: string | null
    reason: string | null
    created_at: string
    fixture_id: number | null
    fixture_position: number | null
    fixture_name: string | null
    area_position: number | null
    area_name: string | null
  }>(
    `SELECT p.kind, p.actor, p.reason, p.created_at,
            f.id AS fixture_id, f.position AS fixture_position, f.name AS fixture_name,
            a.position AS area_position, a.name AS area_name
       FROM book_placement p
       LEFT JOIN area a ON a.id = p.area_id
       LEFT JOIN fixture f ON f.id = a.fixture_id
      WHERE p.book_id = ?
      ORDER BY p.id DESC
      LIMIT ?`,
    [bookId, Math.max(1, Math.min(200, limit))],
  )

  return {
    been: rows.map((row) => ({
      kind: String(row.kind),
      location: labelOf(row),
      actor: row.actor ?? '',
      reason: row.reason ?? '',
      at: String(row.created_at),
    })),
    total: counted?.total ?? 0,
  }
}

/**
 * Give each row the placement of the book it is, in one statement, because asking
 * per book would turn opening the library into a statement per row.
 *
 * A book nobody has placed gets the empty answer rather than being dropped,
 * because "this book is nowhere" is a thing a listing has to draw.
 */
export async function withPlacements<Row extends { id: number }>(
  db: Db,
  rows: readonly Row[],
): Promise<(Row & PlacementFields)[]> {
  if (!rows.length) return []

  const found = await db.all<PlacementRow>(
    `SELECT b.id, b.current_area_id AS area_id,
            f.id AS fixture_id, f.position AS fixture_position, f.name AS fixture_name,
            f.kind AS fixture_kind,
            a.position AS area_position, a.name AS area_name,
            CASE WHEN b.state = ? THEN
              (SELECT p.created_at FROM book_placement p
                WHERE p.book_id = b.id AND p.kind = 'checked_out'
                ORDER BY p.id DESC LIMIT 1)
            END AS checked_out_at
       FROM books b
       LEFT JOIN area a ON a.id = b.current_area_id
       LEFT JOIN fixture f ON f.id = a.fixture_id
      WHERE b.id = ANY (?::int[])`,
    [CHECKED_OUT, rows.map((row) => row.id)],
  )

  const byId = new Map(found.map((row) => [Number(row.id), fieldsOf(row)]))
  return rows.map((row) => ({ ...row, ...(byId.get(row.id) ?? NOT_PLACED) }))
}

/** The same for a lookup that answered one row, or none. */
export async function withPlacementsOf<Row extends { id: number }>(
  db: Db,
  row: Row | undefined,
): Promise<(Row & PlacementFields) | undefined> {
  if (!row) return undefined
  return (await withPlacements(db, [row]))[0]
}

/**
 * Record a book leaving the house, or coming back into it.
 *
 * Going out is one row and it names no area, because a book in a bag holds no
 * position. Coming back is two: `checked_in`, which takes it out of every area
 * there is, and then `placed`, at the plank it came off, read out of the book's
 * own history rather than decided again by the rules, which would move a book
 * somebody put back where they found it.
 *
 * A book with no plank behind it is one nobody had placed before it went out,
 * and it comes back nowhere, which is where it was.
 */
export async function recordCheckedOut(
  db: Db,
  book: PlacedBook,
  out: boolean,
  at: string,
): Promise<void> {
  const ledger = new DrizzlePlacementLedger(db)
  await ledger.record({
    bookId: book.id,
    kind: out ? 'checked_out' : 'checked_in',
    areaId: null,
    sortKey: book.sortKey,
    actor: 'person',
    reason: out ? 'checked out' : 'checked in',
    createdAt: at,
  })
  if (out) return

  const came = await db.get<{ area_id: number }>(
    `SELECT p.area_id FROM book_placement p
      WHERE p.book_id = ? AND p.kind IN ('placed', 'pinned') AND p.area_id IS NOT NULL
      ORDER BY p.id DESC LIMIT 1`,
    [book.id],
  )
  if (!came) return

  await ledger.record({
    bookId: book.id,
    kind: 'placed',
    areaId: Number(came.area_id),
    sortKey: book.sortKey,
    actor: 'person',
    reason: 'back on the plank it came off',
    createdAt: at,
  })
}

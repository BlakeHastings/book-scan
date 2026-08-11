/**
 * Where a book is, on the way in and on the way out.
 *
 * The same job `photographs.ts` does for the ten image columns, on the three
 * this step was beside: `books.location`, `books.shelved_at` and
 * `books.checked_out_at`. **They are gone (#232)**, so this file stopped being a
 * bridge between two records and became the only place a placement is written
 * and the only place one is read back as the flat shape the wire still speaks
 * in.
 *
 * It lives in `server/` because that is the layer the flattening belongs to. The
 * domain owns what a book's rows add up to (`standingOf`), the application layer
 * owns when a row is written, and what this adds is the two fields the client,
 * the browser suite and the misfile review still read.
 *
 * ## The flat shape is the wire's, not the schema's
 *
 * `location` and `checked_out_at` have the names the dropped columns had, and
 * that is deliberate and temporary: #223 made the same call about
 * `books.is_fiction` and #228 about the photographs. Changing the shape of every
 * book on the wire in the same change that drops five columns and moves every
 * writer is not a change anybody can review as one thing. What matters is that
 * no statement anywhere reads a location from `books`, and none does.
 *
 * **`shelved_at` is not in that shape, because nothing ever read it.** Three
 * statements wrote it and no query, route, client or scenario selected it back;
 * its one reader was `0015`, which turned it into the `created_at` of a `placed`
 * row and has already run. So it left the wire in the same change that dropped
 * the column, and the fact it held is in the ledger where the rest of the
 * history is.
 *
 * ## Why this is called from `Store` and not from a route
 *
 * `capture` drifts behind the image columns because `recordPhotographs` runs
 * from the two save routes and the background chain behind one of them, and the
 * cover backfill, the hash backfill and two CLIs write those columns without it
 * (#200). That is the failure to avoid here, and the way to avoid it is to write
 * the ledger row where the column is written rather than where the request is
 * handled.
 *
 * **There are exactly four statements in this repository that change where a
 * book is**, and all four are in `store.ts`: the insert in `addBook`, the update
 * in `updateBook`, `setLocation` and `setCheckedOut`. Every one of them calls
 * into this file, inside its own transaction, so a placement cannot be written
 * without a row. A fifth would have to be added to `Store`, next to the four
 * that do.
 *
 * ## The two things this could not say, and what they became
 *
 * **A location the furniture does not have.** `PATCH /api/books/:id/location`
 * accepted any label `parseLocation` accepts, so `9Z` was recordable, there was
 * no area row for it, and no `placed` row was written: the column moved and the
 * ledger did not. `0015` counted those on the way in.
 *
 * There is nothing behind the ledger to hold such a label now, so the route
 * **refuses** it and names the planks the range has. That is a deliberate change
 * in what the app accepts, and it is the change that makes one record of where a
 * book is possible at all: a location naming furniture nobody owns was never a
 * fact about the room, and the app used to keep it while quietly disagreeing
 * with itself about the same book.
 *
 * **Clearing a recorded location**, which the route described as taking a book
 * back to never-placed. `withdrawn` means given away and `checked_out` means it
 * is out of the house in somebody's bag, so neither says it, and the ledger is
 * append only: there is nothing to unsay. The route refuses an empty label for
 * the same reason it refuses `9Z`, and says which of the two things somebody
 * probably meant.
 *
 * Neither refusal is reachable from the app: every label the client sends comes
 * from a layout the server drew, and there is no screen that clears one.
 */

import { labelFor, type Area, type Fixture } from '../domain/placement/geography'
import { faceOf } from '../infrastructure/shelving/areas'
import { CHECKED_OUT } from '../domain/books/state'
import { areaIndex } from '../shared/layout'
import { parseLocation } from '../shared/shelving'
import { areaForLabel, DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import type { Db } from './driver'

/** What every write here needs to know about the book being moved. */
export interface PlacedBook {
  id: number
  /** The book's sort key as the same statement is writing it. */
  sortKey: string
  /** The recorded location, exactly as it is going into `books.location`. */
  location: string
}

/**
 * The area a recorded label names, or null when nothing does.
 *
 * `parseLocation` first, so `s4 b`, `S4B` and `4B` are the one plank they are
 * everywhere else, and then the letters back through `areaIndex`.
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
 * The routes turn it into a 400 with this sentence in it, which is the same
 * shape `RetractionRefused` has in `server/shelves.ts`.
 */
export class UnknownPlank extends Error {
  constructor(readonly label: string) {
    super(`There is no plank called ${label}, so a book cannot be recorded on it.`)
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
 * edit that carries no location is somebody changing a title, and it says
 * nothing about the room. A label naming no plank is refused, because there is
 * nowhere for it to be recorded and pretending otherwise is what
 * `books.location` used to do.
 */
export async function recordPlaced(db: Db, book: PlacedBook, at: string): Promise<void> {
  const label = book.location.trim()
  if (!label) return

  const areaId = await areaOfLocation(db, label)
  if (areaId === null) throw new UnknownPlank(label)

  await new DrizzlePlacementLedger(db).record({
    bookId: book.id,
    kind: 'placed',
    areaId,
    sortKey: book.sortKey,
    actor: 'person',
    reason: `recorded at ${label}`,
    createdAt: at,
  })
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * A book's placement, flattened to the shape the wire still asks for.
 *
 * Both fields are derived and neither is a column. `location` is the label of
 * the area `books.current_area_id` names, which is the projection of the ledger
 * and is checked against it on every start; `checked_out_at` is when the latest
 * `checked_out` row was written, and only while the book is in that state.
 */
export interface PlacementFields {
  /** Where a person last said the book is, or '' for a book nobody has placed. */
  location: string
  /** Set while the book is off the shelf, null while it is on one. */
  checked_out_at: string | null
}

/** A book nowhere, which is every book nobody has put anywhere. */
export const NOT_PLACED: PlacementFields = { location: '', checked_out_at: null }

interface PlacementRow {
  id: number
  fixture_id: number | null
  fixture_position: number | null
  fixture_name: string | null
  area_position: number | null
  area_name: string | null
  checked_out_at: string | null
}

/**
 * The label is built by the domain, not by the statement.
 *
 * `labelFor` is the one place a fixture's position and an area's become the
 * thing written on a recorded location, and it is the same function
 * `areaDisagreements` and the rule engine read a placement back with. Deriving
 * it a second time in SQL would be a second answer to what a plank is called,
 * and the two would part company the first time somebody named a bookcase.
 */
function fieldsOf(row: PlacementRow): PlacementFields {
  if (row.fixture_id === null || row.fixture_position === null || row.area_position === null) {
    return { location: '', checked_out_at: row.checked_out_at }
  }

  const fixture: Fixture = {
    id: row.fixture_id,
    position: row.fixture_position,
    kind: '',
    name: row.fixture_name ?? '',
    sortStrategy: 'inherit',
  }
  const area: Area = {
    id: 0,
    fixtureId: row.fixture_id,
    /*
     * `faceOf`, because a book can be recorded on a plank the shelves no longer
     * have: somebody removed the divider above it, the run got shorter, and the
     * area was retired rather than deleted because this placement names it. What
     * a person wrote down is still "1C", and the misfile list is what says the
     * shelves disagree. Reading the stored negative straight would answer `1@`
     * about a book somebody can go and find.
     */
    position: faceOf(row.area_position),
    name: row.area_name ?? '',
    startsAt: '',
    sortStrategy: 'inherit',
  }

  return { location: labelFor({ fixture, area }), checked_out_at: row.checked_out_at }
}

/**
 * Give each row the placement of the book it is, in one statement.
 *
 * The same shape and the same argument as `withPhotographs`: a shelf group is a
 * hundred books and the library listing is every one of them, so asking per book
 * would turn opening the library into a statement per row.
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
    `SELECT b.id, f.id AS fixture_id, f.position AS fixture_position, f.name AS fixture_name,
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
 * there is, and then `placed`, at the plank it came off.
 *
 * **The second row is what a checkout round trip used to cost nothing**, because
 * `books.location` was never touched by one and the book simply reappeared where
 * the column said. `docs/data-model.md` has a returning book placed again by the
 * rules, and that is a different thing: it would move a book somebody put back
 * where they found it. So the plank it came off is read out of its own history
 * and written down again, which is what actually happened in the room, and the
 * rules get their say the next time they run.
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

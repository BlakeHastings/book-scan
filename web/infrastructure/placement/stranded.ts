/**
 * A third comparison `projectionDisagreements` cannot make: whether the
 * plank or piece a book's ledger names is still on the shelves at all.
 *
 * `books.current_area_id` is derived from the same ledger this compares
 * against, so it cannot be the other side of the comparison. What is
 * independent of both is `area.position` and `fixture.position`, written
 * only by the furniture writers (`retireArea`, `retireFixture`,
 * `writeBoundaries`, `relocateRun`, and the renumbering door in
 * `server/furniture.ts`), none of which reads the ledger to decide what to
 * write. Comparing those against the ledger is a comparison between two
 * independently written sets of rows.
 *
 * This is not the misfile review (`Shelves.review`) wearing a different hat.
 * A stranded book also shows there as an ordinary misfile, but carrying it
 * only clears the symptom: the plank it names is gone, and no carry
 * restores it. This also does not compare the ledger against the run's
 * current answer, since those disagree constantly and legitimately as books
 * are added; that comparison is `Shelves.review`'s job.
 *
 * `no-such-area` is unreachable while `book_placement.area_id` stays `ON
 * DELETE RESTRICT`: that restriction already refuses to delete any area a
 * ledger row names, so `SET NULL` on `books.current_area_id` can never fire
 * for one of them either. It is still checked and reported, at the cost of
 * one `LEFT JOIN`, because it is exactly what would appear the day that
 * restriction is relaxed.
 *
 * Nothing here writes or repairs. Unlike the projection, neither side is
 * derived from the other: the ledger is right about what happened and the
 * furniture is right about what the shelves are, and what is wrong is
 * whichever writer changed one without recording the other. The books
 * themselves are a decision for whoever owns them, made at the shelves.
 */

import { labelFor, type Area, type Fixture } from '../../domain/placement/geography'
import type { Db } from '../../server/driver'
import { faceOf } from '../shelving/areas'
import { FOLDED } from './projection'

/** Why the place a book's ledger names is not on the shelves. */
export type Stranding =
  /** Somebody removed the boundary that opened it, so the plank came off. */
  | 'plank-off-the-face'
  /** The whole piece was taken away, planks and all (`retireFixture`). */
  | 'piece-off-the-floor'
  /** The row is not there. Unreachable while the `RESTRICT` stands; see above. */
  | 'no-such-area'

/** One book the ledger is still sending somebody to a plank that is gone. */
export interface StrandedBook {
  bookId: number
  title: string
  /** The area the ledger folds to, which is the row that is off the face. */
  areaId: number
  /**
   * What the receipt reads, decoded through `faceOf`. A retired plank is
   * stored as `-(plank + 1)`, so a book put on `1C` before that divider was
   * removed is still recorded as `1C`; this is the same decode `labelOf` in
   * `server/placement-ledger.ts` makes. Empty for `no-such-area`.
   */
  recorded: string
  why: Stranding
}

/** The phrase each stranding is said with, so the log and the endpoint agree. */
const WHY_SAID: Record<Stranding, string> = {
  'plank-off-the-face': 'the plank was taken off the face',
  'piece-off-the-floor': 'the piece was taken off the floor',
  'no-such-area': 'the area row is gone',
}

/** The stranding said the way a reviewer reads it, in one line. */
export function describeStranding(one: StrandedBook): string {
  return `#${one.bookId} ${one.title}: recorded on ${one.recorded || 'a plank with no row'}` +
    `, and ${WHY_SAID[one.why]}`
}

interface StrandedRow {
  id: number
  title: string
  area_id: number
  area_position: number | null
  area_name: string | null
  fixture_id: number | null
  fixture_position: number | null
  fixture_name: string | null
}

/**
 * The ledger's answer joined to the furniture, and the face test. `position
 * >= 0` is what "on the face" means everywhere else too (`furnitureIn`,
 * `runAreasOf`); written here as its negation because this selects the books
 * left pointing at what those exclude.
 *
 * The join to `fixture` is a `LEFT JOIN` although `area.fixture_id` is `NOT
 * NULL`: a fixture that is not there means the area is not there either, by
 * `ON DELETE CASCADE` on `area_fixture_id_fkey`, so it collapses into
 * `no-such-area` rather than needing a fourth kind.
 */
const OFF_THE_FACE = `
       FROM books b
       LEFT JOIN LATERAL (${FOLDED}) folded ON true
       LEFT JOIN area a ON a.id = folded.area_id
       LEFT JOIN fixture f ON f.id = a.fixture_id
      WHERE folded.kind IN ('placed', 'pinned')
        AND (a.id IS NULL OR f.id IS NULL OR a.position < 0 OR f.position < 0)`

/**
 * Why one row is stranded, decided in one place. Checks the piece before the
 * plank: retiring a fixture leaves its areas' own position unchanged, so
 * checking the plank first would report the coarser fact as the finer one.
 */
function whyOf(row: StrandedRow): Stranding {
  if (row.area_position === null || row.fixture_id === null || row.fixture_position === null) {
    return 'no-such-area'
  }
  if (row.fixture_position < 0) return 'piece-off-the-floor'
  return 'plank-off-the-face'
}

/**
 * The label, built by the domain rather than by the statement. `labelFor` is
 * the one place a fixture's position and an area's become the label on a
 * receipt, and what `placement-ledger.ts` and `area-drift.ts` both render
 * through; rendering it again in SQL risks the two sides disagreeing on the
 * same plank's name.
 */
function recordedOn(row: StrandedRow): string {
  if (row.fixture_id === null || row.fixture_position === null || row.area_position === null) {
    return ''
  }

  const fixture: Fixture = {
    id: row.fixture_id,
    position: faceOf(row.fixture_position),
    kind: '',
    name: row.fixture_name ?? '',
    sortStrategy: 'inherit',
  }
  const area: Area = {
    id: row.area_id,
    fixtureId: row.fixture_id,
    position: faceOf(row.area_position),
    name: row.area_name ?? '',
    startsAt: '',
    sortStrategy: 'inherit',
  }
  return labelFor({ fixture, area })
}

/**
 * Every book whose ledger names a plank the shelves no longer have, newest
 * first, bounded. The callers are a startup line and a `curl`, not a
 * report; `countStrandedBooks` gives the total.
 */
export async function strandedBooks(db: Db, limit = 10): Promise<StrandedBook[]> {
  const rows = await db.all<StrandedRow>(
    `SELECT b.id, b.title, folded.area_id,
            a.position AS area_position, a.name AS area_name,
            f.id AS fixture_id, f.position AS fixture_position, f.name AS fixture_name
     ${OFF_THE_FACE}
      ORDER BY b.id DESC
      LIMIT ?`,
    [limit],
  )

  return rows.map((row) => ({
    bookId: Number(row.id),
    title: row.title,
    areaId: Number(row.area_id),
    recorded: recordedOn(row),
    why: whyOf(row),
  }))
}

/** How many there are, which is the number worth saying out loud. */
export async function countStrandedBooks(db: Db): Promise<number> {
  const row = await db.get<{ n: string }>(
    `SELECT count(*)::text AS n ${OFF_THE_FACE}`,
  )
  return Number(row?.n ?? '0')
}

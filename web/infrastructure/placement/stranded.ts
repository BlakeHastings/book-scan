/**
 * The third opinion the projection check does not have (#518).
 *
 * `projectionDisagreements` compares two answers about one book: the column and
 * the ledger it is folded from. It is a good check and it has a hole the exact
 * shape of the family it looks like it exists for. On 2026-09-02 four acts were
 * found that changed where a book belongs and recorded nothing — removing a
 * boundary (#465), deleting a bookcase (#484), overflow past a boundary (#487)
 * and renumbering a piece (#491) — and it reported healthy through every one,
 * because each of them wrote to **neither** side it compares. The two went on
 * agreeing with each other while both were wrong about the furniture.
 *
 * So this asks a third thing, and the third thing is the furniture's own face.
 *
 * ## Breaking the loop first
 *
 * The obvious third reading is "where the book physically is", and this
 * repository does not have one. `books.location` went in `0024` (#232), so a
 * book's whereabouts is now derived from `books.current_area_id`, which is the
 * projection this would be checking. Comparing a projection against a reading
 * derived from that projection is a restatement, not a check, and it agrees with
 * itself the same way the two halves already do.
 *
 * **What is not derived from either side is `area.position` and
 * `fixture.position`.** Those are written by the furniture writers and by
 * nothing else: `retireArea` and `retireFixture` take a plank off a face and a
 * piece off the floor, `writeBoundaries` puts one back, `relocateRun` moves a
 * run, and the renumbering door in `server/furniture.ts` renumbers a piece. Not
 * one of them reads `book_placement` or `current_area_id` to decide what to
 * write there. So "is the plank this book's ledger names still on a face" is a
 * comparison between two sets of rows written by two sets of writers, which is
 * what makes it a third opinion rather than the same opinion twice.
 *
 * And it is answerable without knowing where the book physically is, which is
 * the whole reason it can be asked at all. It does not ask whether the book is
 * where it should be. It asks whether the place the ledger sends somebody to
 * still exists on the shelves.
 *
 * ## Why this is not the misfile list wearing a different hat
 *
 * A book whose ledger names a retired plank does appear on the misfile review,
 * because `Shelves.review` compares the recorded area against where the run puts
 * the sort key and a retired area is never the run's answer. It appears there as
 * an ordinary misfile, indistinguishable from a book two places along in the
 * alphabet, and **carrying it clears the symptom without touching the cause**.
 * That is the difference that decides the audience: the drift check's family is
 * resolved by carrying books, and this one is only hidden by it. The plank is
 * gone; no amount of walking to a shelf puts it back.
 *
 * That is also why this does not compare the ledger against the *run*. Where the
 * run puts a book and where the ledger says it is disagree constantly and
 * legitimately — somebody shelves a book, three arrive before it, and the run's
 * answer moves. That comparison exists, it is `Shelves.review`, it has a screen,
 * and repeating it here with `ok: false` on the end would put a shelf's ordinary
 * state on a machine-readable alarm.
 *
 * ## One check, not two: the `SET NULL` / `RESTRICT` map (#518)
 *
 * #518 asks what this does about a book whose area is gone, because
 * `books.current_area_id` is `ON DELETE SET NULL` while `book_placement.area_id`
 * is `ON DELETE RESTRICT`, and asks whether that asymmetry makes this one check
 * or two. It makes it one, and the reason is that the asymmetry describes a
 * state this schema cannot reach:
 *
 * - `RESTRICT` means Postgres refuses to delete an area **any** ledger row
 *   names. For the two halves to agree at all, the area they agree on is named
 *   by the latest place-ish ledger row, so the refusal is already standing over
 *   exactly the books this check is about.
 * - `SET NULL` therefore never fires for one of them. It would need the delete
 *   to succeed, and the delete cannot.
 * - The one deletion path in the tree, `removeAreaIfUnused`, asks all three
 *   references — the ledger, the projection and a rule — before it tries, so it
 *   never even attempts a delete `RESTRICT` would refuse.
 *
 * What happens instead of a deletion is **retirement**: the row stays, both
 * halves go on naming it, and it comes off the face. That is one state with one
 * audience, so it is one check, and what it looks for is a negative position
 * rather than a missing row. `stranded.test.ts` proves the refusal rather than
 * asserting it here.
 *
 * A missing row is still reported, as `no-such-area`, and that is deliberate
 * belt and braces rather than a second question: it costs one `LEFT JOIN`, it
 * says nothing on any catalogue this schema can produce, and it is precisely
 * what somebody would see the day the `RESTRICT` is relaxed.
 *
 * ## Reported, not repaired
 *
 * Nothing here writes, and unlike the projection there is no repair to offer at
 * all. `rebuildProjection` exists because the projection holds nothing the
 * ledger does not, so it can be thrown away and folded again. Neither side here
 * is derived from the other: the ledger is right about what somebody did and the
 * furniture is right about what the shelves are, and what is wrong is the writer
 * that changed one without recording the other. The books themselves are then a
 * decision for whoever owns them, taken at the shelves through the carry list.
 *
 * #485 is the standing reason for the shape: its diagnosis depended on a broken
 * state surviving restarts, and a check that quietly tidied up would have hidden
 * a three-week-old defect indefinitely.
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
   * What the receipt reads, decoded through `faceOf`.
   *
   * A retired plank still names the plank it was, as `-(plank + 1)`, so a book
   * put on `1C` before the divider above it went is still recorded on `1C`.
   * Reading the stored negative straight would say `1@` about a book somebody
   * can go and find, which is the same decode `labelOf` in
   * `server/placement-ledger.ts` makes and for the same reason.
   *
   * Empty for `no-such-area`, where there is nothing left to render.
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
 * The ledger's answer joined to the furniture, and the face test.
 *
 * `position >= 0` is the whole of what "on the face" means, and it is the same
 * predicate every read of the furniture already makes (`furnitureIn`,
 * `runAreasOf`). Written here as its negation rather than borrowed, because
 * those readers select the furniture and this one selects the books left
 * pointing at what they exclude.
 *
 * The join to `fixture` is a `LEFT JOIN` although `area.fixture_id` is `NOT
 * NULL` and keyed: a fixture that is not there means the area row is not there
 * either, by the `ON DELETE cascade` on `area_fixture_id_fkey`, so it collapses
 * into `no-such-area` below rather than needing a fourth kind.
 */
const OFF_THE_FACE = `
       FROM books b
       LEFT JOIN LATERAL (${FOLDED}) folded ON true
       LEFT JOIN area a ON a.id = folded.area_id
       LEFT JOIN fixture f ON f.id = a.fixture_id
      WHERE folded.kind IN ('placed', 'pinned')
        AND (a.id IS NULL OR f.id IS NULL OR a.position < 0 OR f.position < 0)`

/**
 * Why one row is stranded, decided in one place.
 *
 * The piece before the plank, because retiring a piece leaves its areas where
 * they were: a book on a retired bookcase has a perfectly ordinary plank
 * position and it is the floor underneath that went (#484). Asking the plank
 * first would report the coarser fact as the finer one.
 */
function whyOf(row: StrandedRow): Stranding {
  if (row.area_position === null || row.fixture_id === null || row.fixture_position === null) {
    return 'no-such-area'
  }
  if (row.fixture_position < 0) return 'piece-off-the-floor'
  return 'plank-off-the-face'
}

/**
 * The label, built by the domain rather than by the statement.
 *
 * `labelFor` is the one place a fixture's position and an area's become the
 * thing written on a receipt, and it is what `placement-ledger.ts` and
 * `area-drift.ts` both render through. A second rendering in SQL is how one
 * side of a comparison came to say `2A` about the plank the other called
 * `Hall shelf · A` (#356).
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
 * first, bounded.
 *
 * Bounded for `projectionDisagreements`' reason: the callers are a startup line
 * and a `curl`, and a line per book is not a report, it is a reason to stop
 * reading. `countStrandedBooks` is the total.
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

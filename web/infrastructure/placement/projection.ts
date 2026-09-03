/**
 * The check that lets `books.current_area_id` exist.
 *
 * A projection is a denormalisation: one fact written twice, in a ledger that
 * is the truth and a column that is fast. `docs/data-model.md` asks for it
 * deliberately, because drawing a shelf needs every book's position at once and
 * taking the latest row of each of hundreds of books on every render is the
 * wrong shape. **The cost is that it rots**, and it rots silently, because a
 * stale `current_area_id` is a plausible answer rather than an error.
 *
 * Two tables in this repository already drift behind what they shadow: `capture`
 * behind the eight image columns (#200), and the one #213 filed. Both were found
 * afterwards. So this one is watched from the day it lands, and the watching is
 * worth more than the projection: a check that proves the two agree is what
 * turns "written in the same transaction" from a claim about the code into a
 * fact about the rows.
 *
 * ## Where this runs
 *
 * `applySchema` runs it on every start, which is every time the app comes up in
 * front of the catalogue, and it is one indexed pass. `0015` runs the same
 * comparison once, immediately after writing the projection, so a migration that
 * wrote something nobody can reproduce refuses rather than leaving it to be
 * discovered. And the ledger test replays the rows through the domain fold in
 * TypeScript and compares that with the column, which is the independent reading
 * neither of the SQL ones is.
 *
 * ## Reported, not repaired
 *
 * Nothing here writes. A projection that disagrees with the ledger is rebuilt by
 * running the fold again, and that is a decision somebody makes knowing what
 * disagreed, in the same way a recorded location is never corrected on a book's
 * behalf. Repairing on sight would destroy the evidence of how it happened,
 * which is the only thing that says whether a writer is missing.
 *
 * ## Who reads it (#505)
 *
 * For its first weeks the only reader was `console.error` in `applySchema`, and
 * that reader has a hole in it no amount of reading fixes: **the line is printed
 * once, at startup, and a writer goes missing while the process runs.** A
 * projection that agreed at boot and stopped agreeing at four o'clock says so on
 * the next restart, whenever that is.
 *
 * So `GET /api/health` asks this question live, and answers `ok: false` when the
 * answer is bad. That is deliberately not a card on the owner's phone, which is
 * what #504 gave the drift check: a drift between the shelf and the rules is
 * resolved by carrying books, and a disagreement here is resolved by finding the
 * writer that did not record itself. Telling the owner would be telling somebody
 * about a defect he cannot act on.
 *
 * ## What it cannot see, which is #518
 *
 * This compares two answers, so an act that writes to **neither** of them leaves
 * them agreeing while both are wrong. All four of the 2026-09-02 defects were
 * that shape (#465, #484, #487, #491) and this reported healthy through every
 * one. Catching those needs a third thing to compare against, which is the
 * furniture; that is a different check and it is filed as #518 rather than bolted
 * on here.
 */

import { KINDS_ABOUT_THE_ANSWER } from '../../domain/placement/ledger'
import type { Db } from '../../server/driver'

/**
 * The kinds the fold walks past, as SQL, written from the domain's own list.
 *
 * One definition rather than a literal in each statement below. See
 * `KINDS_ABOUT_THE_ANSWER`.
 */
const NOT_ABOUT_A_PLACE = `p.kind NOT IN (${
  KINDS_ABOUT_THE_ANSWER.map((kind) => `'${kind}'`).join(', ')})`

/**
 * How a person runs the repair, in one string, because three places say it.
 *
 * The startup line, the `/api/health` answer and the script's own usage all name
 * the same command, and they name it from here rather than each spelling it out.
 * The line this replaces told its reader to call `rebuildProjection()` in a
 * named file, which is an instruction to open an editor rather than a thing to
 * run.
 */
export const REBUILD_COMMAND =
  "npm run rebuild-projection -- --target '<connection>' --repair"

/** One book whose column and whose rows do not say the same thing. */
export interface ProjectionDisagreement {
  bookId: number
  title: string
  /** What `books.current_area_id` says. */
  projected: number | null
  /** What the ledger says, folded. */
  fromLedger: number | null
}

interface DisagreementRow {
  id: number
  title: string
  projected: number | null
  from_ledger: number | null
}

/**
 * The fold, in SQL: the latest row that is not `assigned`, and the area it names
 * when it is a row that puts a book somewhere.
 *
 * `assigned` and `released` are excluded rather than handled, because one is
 * where the rules want a book and the other is somebody declining that, and
 * neither is ever where the book is. The other four either put the book in an
 * area (`placed`, `pinned`) or take it out of every area there is
 * (`checked_out`, `checked_in`, `withdrawn`), which is `standingOf` in
 * `domain/placement/ledger.ts` and has to stay that.
 */
const FOLDED = `
  SELECT p.kind, p.area_id FROM book_placement p
   WHERE p.book_id = b.id AND ${NOT_ABOUT_A_PLACE}
   ORDER BY p.id DESC LIMIT 1`

/**
 * Every book whose projection disagrees with its ledger, newest first, bounded.
 *
 * Bounded because the caller is a startup line and a log entry per book is not
 * a report, it is a reason to stop reading the log. `countProjectionDisagreements`
 * is the total.
 */
export async function projectionDisagreements(
  db: Db,
  limit = 10,
): Promise<ProjectionDisagreement[]> {
  const rows = await db.all<DisagreementRow>(
    `SELECT b.id, b.title, b.current_area_id AS projected,
            CASE WHEN folded.kind IN ('placed', 'pinned') THEN folded.area_id END AS from_ledger
       FROM books b
       LEFT JOIN LATERAL (${FOLDED}) folded ON true
      WHERE b.current_area_id IS DISTINCT FROM
            (CASE WHEN folded.kind IN ('placed', 'pinned') THEN folded.area_id END)
      ORDER BY b.id DESC
      LIMIT ?`,
    [limit],
  )

  return rows.map((row) => ({
    bookId: row.id,
    title: row.title,
    projected: row.projected,
    fromLedger: row.from_ledger,
  }))
}

/** How many there are, which is the number worth saying out loud. */
export async function countProjectionDisagreements(db: Db): Promise<number> {
  const row = await db.get<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM books b
       LEFT JOIN LATERAL (${FOLDED}) folded ON true
      WHERE b.current_area_id IS DISTINCT FROM
            (CASE WHEN folded.kind IN ('placed', 'pinned') THEN folded.area_id END)`,
  )
  return Number(row?.n ?? '0')
}

/**
 * Rebuild `books.current_area_id` from the ledger, and say how many rows moved.
 *
 * The repair for a projection that has rotted, and the reason the projection is
 * allowed to be a denormalisation at all: it holds nothing that is not in the
 * ledger, so it can always be thrown away and folded again. This is the same
 * statement `0015` writes it with.
 *
 * Deliberately not called by anything that runs on its own. Rebuilding on sight
 * would destroy the evidence that says whether a writer is missing, which is
 * the question a disagreement actually asks.
 *
 * **It is not dead, and it now has a way to be run** (#505). `REBUILD_COMMAND`
 * above is that way: `web/scripts/rebuild-projection.ts` names its target on its
 * own command line, prints the disagreements, and writes only when asked a
 * second time with `--repair`. Nothing on the startup path, no route and no
 * button reaches this function, and there is a test for each of those absences.
 */
export async function rebuildProjection(db: Db): Promise<number> {
  const { changes } = await db.run(
    `UPDATE books b
        SET current_area_id =
              (CASE WHEN folded.kind IN ('placed', 'pinned') THEN folded.area_id END)
       FROM (SELECT id FROM books) AS ids
       LEFT JOIN LATERAL (
         SELECT p.kind, p.area_id FROM book_placement p
          WHERE p.book_id = ids.id AND ${NOT_ABOUT_A_PLACE}
          ORDER BY p.id DESC LIMIT 1
       ) folded ON true
      WHERE ids.id = b.id
        AND b.current_area_id IS DISTINCT FROM
            (CASE WHEN folded.kind IN ('placed', 'pinned') THEN folded.area_id END)`,
  )
  return changes
}

/**
 * The check that lets `books.current_area_id` exist.
 *
 * A projection is a denormalisation: one fact written twice, in a ledger
 * that is the truth and a column that is fast. It rots silently, because a
 * stale `current_area_id` is a plausible answer rather than an error.
 *
 * `applySchema` runs this on every start, as one indexed pass. `0015` runs
 * the same comparison once, immediately after writing the projection, so a
 * migration that wrote something nobody can reproduce refuses rather than
 * leaving it to be discovered. The ledger test replays the rows through the
 * domain fold in TypeScript and compares that with the column, which is an
 * independent reading neither of the SQL ones is.
 *
 * Nothing here writes. A projection that disagrees with the ledger is
 * rebuilt deliberately, by somebody who has seen what disagreed; repairing
 * on sight would destroy the evidence of how it happened, which is the
 * only thing that says whether a writer is missing.
 *
 * `GET /api/health` asks this question live rather than only at startup,
 * since a writer can go missing while the process runs and a startup-only
 * check would not notice until the next restart. It answers `ok: false`
 * rather than alerting the owner directly: a disagreement here is resolved
 * by finding the missing writer, not by carrying a book.
 *
 * This compares two answers, so an act that writes to neither of them
 * leaves them agreeing while both are wrong. `stranded.ts`, beside this
 * file, is a separate check against a third thing (the furniture) rather
 * than a third comparison folded into this one: this function asks whether
 * a writer forgot the ledger, that one asks whether a writer forgot the
 * books.
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
 * How a person runs the repair, in one string, since three places say it:
 * the startup line, the `/api/health` answer and the script's own usage.
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
 * The fold, in SQL: the latest row that is not `assigned`, and the area it
 * names when it is a row that puts a book somewhere.
 *
 * `assigned` and `released` are excluded rather than handled: one is where
 * the rules want a book and the other is somebody declining that, and
 * neither is ever where the book is. The other four either put the book in
 * an area (`placed`, `pinned`) or take it out of every area there is
 * (`checked_out`, `checked_in`, `withdrawn`), matching `standingOf` in
 * `domain/placement/ledger.ts`.
 *
 * Exported because `stranded.ts` asks the ledger the same question: one
 * spelling of "what does the ledger fold to" rather than two. It never
 * reads `books.current_area_id`, which is the side a check must keep
 * independent.
 *
 * Correlated on an outer `books b`, so a caller has to alias its own table `b`.
 */
export const FOLDED = `
  SELECT p.kind, p.area_id FROM book_placement p
   WHERE p.book_id = b.id AND ${NOT_ABOUT_A_PLACE}
   ORDER BY p.id DESC LIMIT 1`

/**
 * Every book whose projection disagrees with its ledger, newest first,
 * bounded. The caller is a startup line, not a report;
 * `countProjectionDisagreements` gives the total.
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
 * Rebuild `books.current_area_id` from the ledger, and say how many rows
 * moved. Safe because the projection holds nothing that is not in the
 * ledger, so it can always be thrown away and folded again. This is the
 * same statement `0015` writes it with.
 *
 * Deliberately not called by anything that runs on its own; `REBUILD_COMMAND`
 * above is how a person runs it, via `web/scripts/rebuild-projection.ts`,
 * which prints the disagreements and writes only when asked a second time
 * with `--repair`.
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

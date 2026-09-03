/**
 * Fold the placement ledger back into `books.current_area_id`, deliberately.
 *
 * `rebuildProjection` had no runtime caller at all, which #505 said was one of
 * two things: the repair somebody runs after a disagreement is found, or dead
 * code pretending to be an answer. It is the first, and this file is the way it
 * is run. The startup line and `GET /api/health` name this command, from the one
 * constant all three read.
 *
 * ## It is not on any automatic path, and that is the point
 *
 * Nothing calls this on start, on a schedule, or from a route. #485's whole
 * diagnosis depended on a broken state being stable across restarts: a check
 * that quietly repaired would have hidden a three-week-old defect indefinitely,
 * and a disagreement is the only evidence there is of *which* writer stopped
 * recording itself. So the ordinary use of this file writes nothing:
 *
 *     npm run rebuild-projection -- --target '<connection>'
 *
 * prints what disagrees and stops. `--repair` is a second, separate decision,
 * made by somebody who has read the names and gone looking for the writer.
 *
 * ## Where the target comes from
 *
 * The command line, or `BOOKSCAN_REBUILD_TARGET`, and nowhere else. It
 * deliberately does not read `ConnectionStrings__bookscan`, for the reason
 * `seed-world.ts` and `backup-catalogue.ts` do not: this writes, and a
 * connection string that happens to be in a shell must not be able to decide
 * what gets written to.
 *
 * Unlike `seed-world.ts` it does **not** refuse port 5433. That refusal exists
 * there because seeding writes synthetic rows over somebody's collection; this
 * writes one derived column from rows the same database already holds, and the
 * live catalogue is the one catalogue this repair exists for. Agents are covered
 * by `scripts/guard-live-data.mjs`, which refuses a command naming 5433 from
 * inside a worktree. **Running this against the live catalogue is the owner's,
 * like every other write to it.**
 *
 * It opens a plain pool rather than `openPostgres`, because `openPostgres` runs
 * `applySchema`, and a repair that migrates the database on the way past is a
 * second thing happening under one command.
 */

import pg from 'pg'
import { pathToFileURL } from 'node:url'

import { connectionConfig, describeConnection, PgDb } from '../server/db.pg'
import type { Db } from '../server/driver'
import {
  countProjectionDisagreements, projectionDisagreements, rebuildProjection,
  REBUILD_COMMAND, type ProjectionDisagreement,
} from '../infrastructure/placement/projection'

/** What one run found, and what it did about it. */
export interface RebuildReport {
  /** How many disagreed when this started. */
  before: number
  /** A bounded page of them, newest first, the same page the log line names. */
  named: ProjectionDisagreement[]
  /** Rows written. `null` when this was a dry run and nothing was asked for. */
  changed: number | null
  /** How many disagree now. Equal to `before` on a dry run. */
  after: number
}

/**
 * Ask, optionally repair, and ask again.
 *
 * The asking again is not ceremony. `rebuildProjection` reports rows it wrote,
 * and rows written is not the same claim as "they agree now": a book whose
 * ledger holds a row the fold has no answer for would be updated and still
 * disagree. The second count is the one worth printing.
 */
export async function rebuildProjectionRun(
  db: Db,
  options: { repair: boolean },
): Promise<RebuildReport> {
  const before = await countProjectionDisagreements(db)
  const named = before === 0 ? [] : await projectionDisagreements(db, 50)

  if (!options.repair || before === 0) {
    return { before, named, changed: null, after: before }
  }

  const changed = await rebuildProjection(db)
  return { before, named, changed, after: await countProjectionDisagreements(db) }
}

/** One disagreement, as a line somebody can read next to a book. */
export function describeDisagreement(one: ProjectionDisagreement): string {
  return `  #${one.bookId} ${one.title}: column ${one.projected ?? 'nowhere'}, ` +
    `ledger ${one.fromLedger ?? 'nowhere'}`
}

const USAGE =
  "Usage: npm run rebuild-projection -- --target '<connection>' [--repair]"

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const repair = args.includes('--repair')
  const targetAt = args.indexOf('--target')
  const unknown = args.filter((arg, index) =>
    arg !== '--repair' && arg !== '--target' && args[index - 1] !== '--target')
  if (unknown.length) {
    console.error(`Unrecognised argument: ${unknown.join(' ')}\n${USAGE}`)
    process.exit(2)
  }

  const target = (targetAt >= 0 ? args[targetAt + 1] : process.env.BOOKSCAN_REBUILD_TARGET) ?? ''
  if (!target) {
    console.error(
      'No target. This can write rows, so it will not take one from the ' +
      'environment the app is running in.\n' +
      "Read the api resource's connection out of `aspire describe` and pass it." +
      `\n${USAGE}`,
    )
    process.exit(2)
  }

  // Host, port and database, never the credentials, so a run that ends up in a
  // log or a transcript says which catalogue it opened without carrying a
  // password there.
  console.log(`Catalogue: ${describeConnection(target)}`)

  const pool = new pg.Pool(connectionConfig(target))
  try {
    const report = await rebuildProjectionRun(new PgDb(pool), { repair })

    if (report.before === 0) {
      console.log("Every book's current area agrees with its ledger. Nothing to repair.")
      return
    }

    console.error(
      `${report.before} books have a current area their ledger does not agree ` +
      'with, so something wrote a placement without recording it:',
    )
    for (const one of report.named) console.error(describeDisagreement(one))
    if (report.named.length < report.before) {
      console.error(`  ... and ${report.before - report.named.length} more.`)
    }

    if (!repair) {
      console.error('')
      console.error(
        'Nothing has been written. Find the writer that changed a placement ' +
        'and did not record it first: the disagreement is the only evidence of ' +
        'which one it was, and this repair erases it.',
      )
      console.error(`When you have, run it again with --repair (${REBUILD_COMMAND}).`)
      process.exitCode = 1
      return
    }

    console.log(`Rebuilt ${report.changed} rows from the ledger.`)
    if (report.after === 0) {
      console.log("Every book's current area now agrees with its ledger.")
      return
    }

    // Rows written is not "they agree now". Say so rather than exiting 0 on a
    // repair that did not repair.
    console.error(
      `${report.after} books still disagree after the rebuild, so the ledger ` +
      'itself does not fold to what the column holds. Do not run this again; ' +
      'the rows are what needs looking at.',
    )
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}

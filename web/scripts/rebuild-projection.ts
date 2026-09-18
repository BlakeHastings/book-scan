/**
 * Fold the placement ledger back into `books.current_area_id`.
 *
 * Nothing calls this on start, on a schedule, or from a route: a check that
 * quietly repaired would hide a broken state indefinitely, and a
 * disagreement is the only evidence of which writer stopped recording
 * itself. Run with no `--repair`, it prints what disagrees and writes
 * nothing; `--repair` is a second, separate decision.
 *
 * The target comes from the command line, or `BOOKSCAN_REBUILD_TARGET`, and
 * nowhere else. It deliberately does not read `ConnectionStrings__bookscan`:
 * this writes, and a connection string that happens to be in a shell must
 * not decide what gets written to. Unlike `seed-world.ts` it does not refuse
 * port 5433: that refusal exists there because seeding writes synthetic rows
 * over somebody's collection, while this writes one derived column from rows
 * the same database already holds, and the live catalogue is the one
 * catalogue this repair exists for. It opens a plain pool rather than
 * `openPostgres`, so it does not migrate the database on the way past.
 */

import pg from 'pg'
import { pathToFileURL } from 'node:url'

import { connectionConfig, describeConnection, PgDb } from '../server/db.pg'
import type { Db } from '../server/driver'
import {
  countProjectionDisagreements, projectionDisagreements, rebuildProjection,
  REBUILD_COMMAND, type ProjectionDisagreement,
} from '../infrastructure/placement/projection'

export interface RebuildReport {
  before: number
  named: ProjectionDisagreement[]
  /** `null` when this was a dry run: nothing was asked for and nothing was written. */
  changed: number | null
  after: number
}

/**
 * Ask, optionally repair, and ask again: rows written is not the same claim
 * as "they agree now", since a book whose ledger holds a row the fold has no
 * answer for would be updated and still disagree.
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

  // Host, port and database, never the credentials, so a log or transcript
  // says which catalogue this opened without carrying a password.
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

    // Rows written is not "they agree now": say so rather than exiting 0 on a
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

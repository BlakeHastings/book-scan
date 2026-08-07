/**
 * Command line front end for rehashCovers. Run it from web/:
 *
 *     npx tsx server/rehash-covers.ts            # dry run, writes nothing
 *     npx tsx server/rehash-covers.ts --apply    # write the new hashes
 *     npx tsx server/rehash-covers.ts --apply --force
 *
 * It reads ConnectionStrings__bookscan and BOOKSCAN_DATA exactly as the server
 * does, so the operator chooses the catalogue and the photographs and nothing
 * here has a default of its own beyond the server's.
 * Because that catalogue is somebody's real book collection, this is a dry run
 * unless told otherwise, it prints the directory it resolved before it touches
 * anything, and it waits before a write so a wrong path can be interrupted.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { catalogueConnection, describeConnection, openPostgres } from './db.pg'
import type { Db } from './driver'
import { Store } from './store'
import { rehashCovers } from './rehash'

const USAGE = `Recompute the stored cover hashes with the current algorithm.

Usage: npx tsx server/rehash-covers.ts [--apply] [--force]

  --apply   Write the new hashes. Without it nothing is written and the run
            only reports what it would do.
  --force   Recompute hashes that are already in the current format, instead
            of skipping them.

The catalogue is ConnectionStrings__bookscan and the cover images are under
BOOKSCAN_DATA, or ./data when that is unset, both the same as the server. Back
the catalogue up before running with --apply.`

/** Seconds between printing the target and writing to it. */
const GRACE = 5

function main(): Promise<number> {
  const args = process.argv.slice(2)
  const known = ['--apply', '--force', '--help', '-h']
  const unknown = args.filter((arg) => !known.includes(arg))

  if (unknown.length) {
    console.error(`Unrecognised argument: ${unknown.join(' ')}\n\n${USAGE}`)
    return Promise.resolve(2)
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return Promise.resolve(0)
  }

  const apply = args.includes('--apply')
  const force = args.includes('--force')

  // Both resolved the way web/server/index.ts resolves them, so an operator who
  // has them exported for the server gets the same catalogue and the same
  // photographs here. The covers are still files; only the rows moved.
  const dataDir = resolve(process.env.BOOKSCAN_DATA ?? 'data')
  const coverDir = join(dataDir, 'covers')

  let connection: string
  try {
    connection = catalogueConnection()
  } catch (error) {
    console.error((error as Error).message)
    return Promise.resolve(1)
  }

  console.log('')
  console.log('  Rehash stored cover hashes')
  console.log('  ' + '-'.repeat(60))
  console.log(`  data directory  ${dataDir}`)
  console.log(`  database        ${describeConnection(connection)}`)
  console.log(`  cover images    ${coverDir}`)
  console.log(`  BOOKSCAN_DATA   ${process.env.BOOKSCAN_DATA ?? '(unset, using ./data)'}`)
  console.log(`  mode            ${apply ? 'APPLY, rows will be written' : 'DRY RUN, nothing will be written'}`)
  console.log(`  scope           ${force ? 'every stored image (--force)' : 'images whose hash is not in the current format'}`)
  console.log('  ' + '-'.repeat(60))
  console.log('')

  return run(connection, coverDir, apply, force)
}

async function run(
  connection: string,
  coverDir: string,
  apply: boolean,
  force: boolean,
): Promise<number> {
  if (apply) {
    console.log(`  Writing to the catalogue above in ${GRACE} seconds. Ctrl-C to stop.`)
    await new Promise((done) => setTimeout(done, GRACE * 1000))
    console.log('')
  }

  const db = await openPostgres(connection)
  try {
    return await work(db, coverDir, apply, force)
  } finally {
    // A pool left open holds the process alive after the report is printed,
    // which a file handle did not.
    await db.close()
  }
}

async function work(
  db: Db,
  coverDir: string,
  apply: boolean,
  force: boolean,
): Promise<number> {
  const store = new Store(db)
  const report = await rehashCovers(store, {
    apply,
    force,
    read: (name) => readFileSync(join(coverDir, name)),
    onNote: (line) => console.log(`  ${line}`),
  })

  const count = (label: string, value: number) =>
    console.log(`  ${label.padEnd(16)}${value}`)

  console.log('')
  count('rows examined', report.rows)
  count('images examined', report.images)
  count('rehashed', report.rehashed)
  count('skipped', report.skipped)
  count('failed', report.failed)
  count(apply ? 'rows written' : 'rows to write', report.changed)

  if (report.failures.length) {
    console.log('')
    console.log('  Could not hash:')
    for (const failure of report.failures) {
      const where = failure.image ? join(coverDir, failure.image) : '(no image recorded)'
      console.log(`    book ${failure.id} ${failure.title}`)
      console.log(`      ${where}`)
      console.log(`      ${failure.reason}`)
    }
  }

  if (!apply && report.changed) {
    console.log('')
    console.log('  Nothing was written. Re-run with --apply to write these hashes.')
  }

  console.log('')
  // A failure here is a cover that is gone or unreadable, which is worth an
  // operator noticing rather than reading past in a wall of counts.
  return report.failed ? 1 : 0
}

main().then(
  (code) => { process.exitCode = code },
  (error: unknown) => {
    console.error(error)
    process.exitCode = 1
  },
)

/**
 * Command line front end for backfillCaptures. Run it from web/:
 *
 *     npx tsx server/crop-captures.ts                  # dry run, writes nothing
 *     npx tsx server/crop-captures.ts --apply
 *     npx tsx server/crop-captures.ts --apply --limit 20
 *     npx tsx server/crop-captures.ts --apply --force
 *
 * New captures are cropped and hashed by the queue worker as their photographs
 * arrive, so this exists only for the ones photographed before that. It is not
 * wired to a timer or a route and nothing runs it for you, for the same reason
 * `crop-books.ts` is not: reading every photograph in somebody's queue is time
 * only the owner can decide to spend.
 *
 * It reads ConnectionStrings__bookscan and BOOKSCAN_DATA exactly as the server
 * does, so the operator chooses the catalogue and the photographs and nothing
 * here has a default of its own beyond the server's.
 * It is a dry run unless told otherwise, it prints the directory it resolved
 * before it touches anything, and it waits before a write so a wrong path can
 * be interrupted.
 *
 * It writes new files and new columns only. No photograph is opened for
 * writing anywhere in this path, so the worst a bad run can do is leave crops
 * worth deleting.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { catalogueConnection, describeConnection, openPostgres } from './db.pg'
import type { Db } from './driver'
import { CaptureQueue } from './queue'
import { backfillCaptures } from './capturecrop'

const USAGE = `Crop queued captures to the book and hash their fronts, keeping every original.

Usage: npx tsx server/crop-captures.ts [--apply] [--force] [--limit N]

  --apply     Write the crops, the hashes and the rows. Without it nothing is
              written and the run only reports what it would do.
  --force     Look again at photographs already examined and re-hash fronts
              already hashed, instead of skipping them. Use after a change to
              the detector or the hash format.
  --limit N   Stop after N captures. Useful for seeing what it does to a
              handful before letting it loose on the queue.

The catalogue is ConnectionStrings__bookscan and the photographs are under
BOOKSCAN_DATA, or ./data when that is unset, both the same as the server.
Originals are never written to, but back the catalogue up before --apply anyway.`

/** Seconds between printing the target and writing to it. */
const GRACE = 5

function main(): Promise<number> {
  const args = process.argv.slice(2)
  const known = ['--apply', '--force', '--limit', '--help', '-h']
  const unknown = args.filter((arg, index) =>
    !known.includes(arg) && args[index - 1] !== '--limit')

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

  let limit: number | undefined
  const limitAt = args.indexOf('--limit')
  if (limitAt >= 0) {
    limit = Number(args[limitAt + 1])
    if (!Number.isInteger(limit) || limit <= 0) {
      console.error(`--limit needs a whole number above zero.\n\n${USAGE}`)
      return Promise.resolve(2)
    }
  }

  // Both resolved the way web/server/index.ts resolves them, so an operator
  // who has them exported for the server gets the same catalogue and the same
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
  console.log('  Crop and hash queued captures')
  console.log('  ' + '-'.repeat(60))
  console.log(`  data directory  ${dataDir}`)
  console.log(`  database        ${describeConnection(connection)}`)
  console.log(`  photographs     ${coverDir}`)
  console.log(`  BOOKSCAN_DATA   ${process.env.BOOKSCAN_DATA ?? '(unset, using ./data)'}`)
  console.log(`  mode            ${apply ? 'APPLY, crops, hashes and rows will be written' : 'DRY RUN, nothing will be written'}`)
  console.log(`  scope           ${force ? 'every capture (--force)' : 'captures not yet examined'}`)
  console.log(`  limit           ${limit ?? 'none, the whole queue'}`)
  console.log('  originals       never written to')
  console.log('  ' + '-'.repeat(60))
  console.log('')

  return run(connection, coverDir, { apply, force, limit })
}

async function run(
  connection: string,
  coverDir: string,
  options: { apply: boolean; force: boolean; limit?: number },
): Promise<number> {
  const { apply } = options

  if (apply) {
    console.log(`  Writing to the catalogue above in ${GRACE} seconds. Ctrl-C to stop.`)
    await new Promise((done) => setTimeout(done, GRACE * 1000))
    console.log('')
  }

  const db = await openPostgres(connection)
  try {
    return await work(db, coverDir, options)
  } finally {
    // A pool left open holds the process alive after the report is printed,
    // which a file handle did not.
    await db.close()
  }
}

async function work(
  db: Db,
  coverDir: string,
  options: { apply: boolean; force: boolean; limit?: number },
): Promise<number> {
  const { apply, force, limit } = options

  // No image reader and no lookup options: this never drains the queue, so
  // nothing here reads a photograph for an ISBN or asks a catalogue anything.
  const queue = new CaptureQueue(db, () => null)

  const report = await backfillCaptures(queue, {
    apply,
    force,
    limit,
    read: (name) => readFileSync(join(coverDir, name)),
    write: (name, data) => { writeFileSync(join(coverDir, name), data) },
    onNote: (line) => console.log(`  ${line}`),
  })

  const count = (label: string, value: number) =>
    console.log(`  ${label.padEnd(18)}${value}`)

  console.log('')
  count('captures', report.rows)
  count('photos examined', report.images)
  count(apply ? 'cropped' : 'would crop', report.cropped)
  count('kept whole', report.declined)
  count('already examined', report.skipped)
  count(apply ? 'fronts hashed' : 'would hash', report.hashed)
  count('already hashed', report.hashKept)
  count('no detail to hash', report.hashRefused)
  count('unreadable', report.failed)

  if (report.failures.length) {
    console.log('')
    console.log('  Could not read:')
    for (const failure of report.failures) {
      console.log(`    capture ${failure.id}`)
      console.log(`      ${join(coverDir, failure.image)}`)
      console.log(`      ${failure.reason}`)
    }
  }

  if (!apply && (report.cropped || report.hashed)) {
    console.log('')
    console.log('  Nothing was written. Re-run with --apply to write these.')
  }

  console.log('')
  // A failure here is a photograph that is gone or unreadable, which is worth
  // an operator noticing rather than reading past in a wall of counts.
  return report.failed ? 1 : 0
}

main().then(
  (code) => { process.exitCode = code },
  (error: unknown) => {
    console.error(error)
    process.exitCode = 1
  },
)

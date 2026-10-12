/**
 * Command line front end for rehashCovers. Run with `--help` for usage.
 *
 * The catalogue is `--target` and nothing else; the photographs are under
 * `BOOKSCAN_DATA` exactly as the server reads it.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describeConnection, openPostgres } from './db.pg'
import type { Db } from './driver'
import { Store } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { rehashCovers } from './rehash'
import { NO_TARGET, targetIn } from './write-target'

const USAGE = `Recompute the stored cover hashes with the current algorithm.

Usage: npx tsx server/rehash-covers.ts --target '<connection>' [--apply] [--force]

  --target  The catalogue to read and write. Required, and taken from nowhere
            else: not ConnectionStrings__bookscan, which the server runs on.
  --apply   Write the new hashes. Without it nothing is written and the run
            only reports what it would do.
  --force   Recompute hashes that are already in the current format, instead
            of skipping them.

The cover images are under BOOKSCAN_DATA, or ./data when that is unset, the
same as the server. Back the catalogue up before running with --apply.`

/** Seconds between printing the target and writing to it. */
const GRACE = 5

export function main(args: string[]): Promise<number> {
  const known = ['--apply', '--force', '--target', '--help', '-h']
  const unknown = args.filter((arg, index) =>
    !known.includes(arg) && args[index - 1] !== '--target')

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

  // Resolved the same way web/server/index.ts resolves it, so an operator who
  // has it exported for the server gets the same photographs here.
  const dataDir = resolve(process.env.BOOKSCAN_DATA ?? 'data')
  const coverDir = join(dataDir, 'covers')

  const connection = targetIn(args)
  if (!connection) {
    console.error(`${NO_TARGET}\n\n${USAGE}`)
    return Promise.resolve(2)
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
    // A pool left open holds the process alive after the report is printed.
    await db.close()
  }
}

async function work(
  db: Db,
  coverDir: string,
  apply: boolean,
  force: boolean,
): Promise<number> {
  const store = new Store(db, new DrizzleAuthorRepository(db))
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
  return report.failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error: unknown) => {
      console.error(error)
      process.exitCode = 1
    },
  )
}

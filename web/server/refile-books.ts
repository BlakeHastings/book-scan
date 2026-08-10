/**
 * Command line front end for refileBooks. Run it from web/:
 *
 *     npx tsx server/refile-books.ts            # dry run, writes nothing
 *     npx tsx server/refile-books.ts --apply    # write the recomputed keys
 *
 * It reads ConnectionStrings__bookscan exactly as the server does, so the
 * operator chooses the catalogue and nothing here has a default of its own.
 * Because that catalogue is somebody's real book collection, and because what
 * this writes decides where books physically go, it is a dry run unless told
 * otherwise, it prints the database it resolved before it touches anything, and
 * it waits before a write so a wrong target can be interrupted. The same shape
 * as server/rehash-covers.ts, for the same reasons.
 *
 * A dry run is also the answer to "which books did #195 file under nobody",
 * because a book with a wrong stored key is exactly a book this reports.
 */

import { catalogueConnection, describeConnection, openPostgres } from './db.pg'
import type { Db } from './driver'
import { Store } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { refileBooks } from './refile'

const USAGE = `Recompute the stored filing name and sort key of every catalogued book.

Usage: npx tsx server/refile-books.ts [--apply]

  --apply   Write the recomputed columns. Without it nothing is written and the
            run only reports which books would move and where to.

The catalogue is ConnectionStrings__bookscan, the same as the server. A book
moving here is a book that has to be physically moved on the shelf afterwards,
so read the report before running with --apply, and back the catalogue up.`

/** Seconds between printing the target and writing to it. */
const GRACE = 5

function main(): Promise<number> {
  const args = process.argv.slice(2)
  const known = ['--apply', '--help', '-h']
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

  let connection: string
  try {
    connection = catalogueConnection()
  } catch (error) {
    console.error((error as Error).message)
    return Promise.resolve(1)
  }

  console.log('')
  console.log('  Recompute stored filing names and sort keys')
  console.log('  ' + '-'.repeat(60))
  console.log(`  database        ${describeConnection(connection)}`)
  console.log(`  mode            ${apply ? 'APPLY, rows will be written' : 'DRY RUN, nothing will be written'}`)
  console.log('  ' + '-'.repeat(60))
  console.log('')

  return run(connection, apply)
}

async function run(connection: string, apply: boolean): Promise<number> {
  if (apply) {
    console.log(`  Writing to the catalogue above in ${GRACE} seconds. Ctrl-C to stop.`)
    await new Promise((done) => setTimeout(done, GRACE * 1000))
    console.log('')
  }

  const db = await openPostgres(connection)
  try {
    return await work(db, apply)
  } finally {
    // A pool left open holds the process alive after the report is printed.
    await db.close()
  }
}

/** A sort key is mostly unit separators, which a terminal does not draw. */
const readable = (key: string) => (key ? key.replace(/\x1f/g, ' | ') : '(nothing)')

async function work(db: Db, apply: boolean): Promise<number> {
  const report = await refileBooks(new Store(db, new DrizzleAuthorRepository(db)), { apply })

  for (const book of report.moved) {
    console.log(`  book ${book.id}  ${book.title}`)
    console.log(`    files under  ${book.filesUnder || '(nobody)'}`)
    console.log(`    sorts at     ${readable(book.sortKey[0])}`)
    console.log(`                 ${readable(book.sortKey[1])}`)
  }

  const count = (label: string, value: number) =>
    console.log(`  ${label.padEnd(16)}${value}`)

  console.log('')
  count('books examined', report.examined)
  count('would move', report.moved.length)
  count(apply ? 'rows written' : 'rows to write', report.written)

  if (!apply && report.moved.length) {
    console.log('')
    console.log('  Nothing was written. Re-run with --apply to write these keys,')
    console.log('  then expect the same books on the needs-attention list until')
    console.log('  somebody has carried each of them to where it now belongs.')
  }

  console.log('')
  return 0
}

main().then(
  (code) => { process.exitCode = code },
  (error: unknown) => {
    console.error(error)
    process.exitCode = 1
  },
)

/**
 * Command line front end for the stage H migration. Run it from web/:
 *
 *     npx tsx server/migrate-sqlite-to-pg.ts --target <connection>
 *     npx tsx server/migrate-sqlite-to-pg.ts --target <connection> --apply
 *     npx tsx server/migrate-sqlite-to-pg.ts --target <connection> --verify
 *
 * It follows the conventions rehash-covers.ts set, for the same reason that
 * file has them: it prints exactly what it is about to do, refuses a source
 * that is not there, is a dry run unless told otherwise, and waits before a
 * write so a wrong target can be interrupted.
 *
 * **The target is named on the command line and is never inherited.** The one
 * thing this tool could do that nothing else in the repository can is write to
 * a catalogue, so it does not read `ConnectionStrings__bookscan`, the variable
 * the running app reads. That is the same rule the test harness follows with
 * `BOOKSCAN_TEST_DATABASE_URL`, and it exists for the same reason: a connection
 * string left in a shell should not be able to decide what gets written to.
 * `BOOKSCAN_MIGRATE_TARGET` is accepted as an alternative to `--target` for an
 * operator who would rather not put a password in shell history.
 *
 * **The source is opened read-only.** It is a snapshot of somebody's whole
 * collection and this tool has no business changing it. It also refuses a
 * source with a `-wal` file beside it, which means the database is live or was
 * copied without its journal; the runbook says `VACUUM INTO` for that reason.
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openReadOnlyDatabase } from './db'
import { describeConnection, openPostgres } from './db.pg'
import type { Db } from './driver'
import {
  checkSchemas,
  migrateCatalogue,
  readable,
  targetHoldsData,
  verifyCatalogue,
  type VerifyReport,
} from './migrate'

const USAGE = `Move a SQLite catalogue into Postgres and prove it arrived intact.

Usage: npx tsx server/migrate-sqlite-to-pg.ts --target <connection> [options]

  --target <s>  The Postgres catalogue to write. A postgres:// URL or an
                ADO.NET keyword string. BOOKSCAN_MIGRATE_TARGET is read when
                this is not given. ConnectionStrings__bookscan is deliberately
                NOT read: the target is named here or not at all.
  --source <p>  The SQLite file to read. Defaults to <BOOKSCAN_DATA>/books.db.
                Opened read-only and never written to.
  --covers <p>  Where the cover files are, for checking that migrated rows
                still point at files that exist. Defaults to
                <BOOKSCAN_DATA>/covers, beside the source.
  --apply       Write. Without it nothing is written and the run reports what
                it would do, then verifies whatever is already there.
  --force       Allow a target that already holds a catalogue. It is emptied
                and rewritten, inside the same transaction as the copy.
  --verify      Verify only. Writes nothing, compares the two databases and
                reports. This is what to run again after a cutover.

Take the snapshot with VACUUM INTO, not cp: a copied .db without its -wal can
be hours out of date. See docs/stage-h-runbook.md.`

/** Seconds between printing the target and writing to it. */
const GRACE = 5

interface Options {
  source: string
  covers: string
  target: string
  apply: boolean
  force: boolean
  verifyOnly: boolean
}

export function parseArgs(argv: readonly string[]): Options | { error: string } {
  const flags = ['--apply', '--force', '--verify', '--help', '-h']
  const values = ['--target', '--source', '--covers']
  const given = new Map<string, string>()
  const seen = new Set<string>()

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (flags.includes(arg)) { seen.add(arg); continue }
    if (values.includes(arg)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        return { error: `${arg} needs a value` }
      }
      given.set(arg, value)
      i += 1
      continue
    }
    return { error: `Unrecognised argument: ${arg}` }
  }

  const dataDir = resolve(process.env.BOOKSCAN_DATA ?? 'data')
  return {
    source: resolve(given.get('--source') ?? join(dataDir, 'books.db')),
    covers: resolve(given.get('--covers') ?? join(dataDir, 'covers')),
    target: given.get('--target') ?? process.env.BOOKSCAN_MIGRATE_TARGET ?? '',
    apply: seen.has('--apply'),
    force: seen.has('--force'),
    verifyOnly: seen.has('--verify'),
  }
}

function line(label: string, value: string | number): void {
  // Wide enough for the longest label below plus a gap, because a label that
  // runs into its value is how "positions differ 197" reads as one word.
  console.log(`  ${label.padEnd(24)}${value}`)
}

/** Print a verification in the shape the acceptance check is written down from. */
export function printReport(report: VerifyReport): void {
  console.log('')
  console.log('  Rows, and the content behind them')
  console.log('  ' + '-'.repeat(70))
  console.log('  table            sqlite  postgres  digest(sqlite)   digest(postgres)')
  for (const table of report.tables) {
    console.log(
      `  ${table.table.padEnd(15)}` +
      `${String(table.sourceRows).padStart(6)}` +
      `${String(table.targetRows).padStart(10)}  ` +
      `${table.sourceDigest}  ${table.targetDigest}` +
      `${table.sourceDigest === table.targetDigest ? '' : '   DIFFERENT'}`,
    )
  }
  const cells = report.tables.reduce((sum, t) => sum + t.cells, 0)
  console.log(`  ${'cells compared'.padEnd(15)}${String(cells).padStart(6)}`)

  console.log('')
  console.log('  Ordering, which is what a collation gets wrong silently')
  console.log('  ' + '-'.repeat(70))
  line('books ordered', `${report.ordering.sourceOrder.length} in the source, ` +
    `${report.ordering.targetOrder.length} in the target`)
  line('positions differ', report.ordering.disagreements.length)
  line('duplicate keys', report.ordering.duplicateKeys.length
    ? report.ordering.duplicateKeys.join('; ') : 'none')
  line('db collation', `${report.ordering.databaseCollation}` +
    `${report.ordering.collationIsLinguistic ? '' : '  (byte order: the check below is vacuous)'}`)
  for (const declared of report.ordering.declaredCollations) {
    line(`  ${declared.table}.${declared.column}`, declared.collation)
  }
  line('negative control', report.ordering.controlDisagreements
    ? `${report.ordering.controlDisagreements} positions move under the database's ` +
      `own collation, so the comparison above discriminates`
    : 'NO DIFFERENCE, so the comparison above proved nothing')
  if (report.ordering.controlExample) line('  first move', report.ordering.controlExample)
  line('shelf boundaries', `${report.ordering.boundaries.length} checked, ` +
    `${report.ordering.boundaryDisagreements} resolve to a different book`)
  for (const boundary of report.ordering.boundaries) {
    line(`  separator ${boundary.separator}`,
      `${boundary.range}: first book ${boundary.sourceFirstBook ?? 'none'} -> ` +
      `${boundary.targetFirstBook ?? 'none'}`)
  }

  console.log('')
  console.log('  Nulls and empty strings, per column, where they differ or are interesting')
  console.log('  ' + '-'.repeat(70))
  for (const table of report.tables) {
    for (const { source, target } of table.columns) {
      const same = source.nulls === target.nulls && source.empties === target.empties &&
        source.types.join(',') === target.types.join(',')
      // Only the columns where the distinction is live are worth printing on a
      // good run. A column that agrees and holds neither is noise.
      if (same && source.nulls === 0 && source.empties === 0) continue
      console.log(
        `  ${(table.table + '.' + source.column).padEnd(30)}` +
        `sqlite null=${String(source.nulls).padStart(4)} ''=${String(source.empties).padStart(4)} ` +
        `[${source.types.join('|') || '-'}]   ` +
        `postgres null=${String(target.nulls).padStart(4)} ''=${String(target.empties).padStart(4)} ` +
        `[${target.types.join('|') || '-'}]${same ? '' : '   DIFFERENT'}`,
      )
    }
  }

  if (report.covers) {
    console.log('')
    console.log('  Covers')
    console.log('  ' + '-'.repeat(70))
    line('directory', report.covers.directory)
    line('referenced', report.covers.referenced)
    line('present', report.covers.present)
    line('missing', report.covers.missing.length)
    for (const name of report.covers.missing.slice(0, 20)) line('  ', name)
  }

  console.log('')
  console.log('  Identity sequences, so the next scan does not collide')
  console.log('  ' + '-'.repeat(70))
  for (const sequence of report.sequences) {
    line(sequence.table, `highest id ${sequence.maxId ?? 'none'}, next id ` +
      `${sequence.nextId}${sequence.ok ? '' : '   COLLIDES'}`)
  }

  console.log('')
  if (report.problems.length === 0) {
    console.log(`  VERIFIED. Nothing differs. (${report.elapsedMs} ms)`)
  } else {
    console.log(`  ${report.problems.length} PROBLEMS:`)
    for (const problem of report.problems.slice(0, 50)) console.log(`    ${problem}`)
    if (report.problems.length > 50) {
      console.log(`    ... and ${report.problems.length - 50} more`)
    }
  }
  console.log('')
}

async function run(options: Options): Promise<number> {
  console.log('')
  console.log('  Stage H: SQLite to Postgres')
  console.log('  ' + '-'.repeat(70))
  line('source', options.source)
  line('covers', options.covers)
  line('target', describeConnection(options.target))
  line('mode', options.verifyOnly ? 'VERIFY ONLY, nothing will be written'
    : options.apply ? 'APPLY, rows will be written'
    : 'DRY RUN, nothing will be written')
  if (options.force) line('force', 'a target that already holds a catalogue will be emptied')
  console.log('  ' + '-'.repeat(70))
  console.log('')

  if (!existsSync(options.source)) {
    console.error(`  No catalogue at ${options.source}. Nothing was read or changed.`)
    return 1
  }
  if (existsSync(`${options.source}-wal`)) {
    console.error(
      `  There is a write-ahead log beside ${options.source}.\n` +
      `  That means the database is open somewhere, or was copied without it, and\n` +
      `  either way what is in the .db file may be hours out of date. Stop the app\n` +
      `  and take a snapshot with VACUUM INTO. See docs/stage-h-runbook.md.`,
    )
    return 1
  }
  if (!options.covers || !existsSync(options.covers)) {
    console.error(
      `  No cover directory at ${options.covers}. The database holds bare filenames\n` +
      `  joined against it, so without it nothing can check that the photographs\n` +
      `  are still reachable. Pass --covers.`,
    )
    return 1
  }

  const source = openReadOnlyDatabase(options.source)
  let target: Db | undefined
  try {
    target = await openPostgres(options.target)

    const schema = await checkSchemas(source, target)
    if (schema.length) {
      console.error('  The two schemas do not agree, so nothing was written:')
      for (const problem of schema) console.error(`    ${problem}`)
      return 1
    }
    console.log('  Schemas agree: every table, every column, both directions.')

    const held = await targetHoldsData(target)
    const populated = Object.entries(held)
    if (populated.length && !options.verifyOnly) {
      const summary = populated.map(([table, n]) => `${table} ${n}`).join(', ')
      if (!options.force) {
        console.error('')
        console.error(`  The target already holds a catalogue: ${summary}.`)
        console.error('  Nothing was written. Re-run with --force to empty and rewrite it.')
        return 1
      }
      console.log(`  The target already holds ${summary}. --force will empty it.`)
    }

    if (options.apply && !options.verifyOnly) {
      console.log('')
      console.log(`  Writing to the target above in ${GRACE} seconds. Ctrl-C to stop.`)
      await new Promise((done) => setTimeout(done, GRACE * 1000))
      console.log('')
      const result = await migrateCatalogue(source, target, {
        force: options.force,
        onNote: (text) => console.log(`  ${text}`),
      })
      console.log('')
      line('copied in', `${result.elapsedMs} ms`)
      for (const [table, n] of Object.entries(result.read)) {
        line(`  ${table}`, `${n} read, ${result.written[table]} written`)
      }
    } else if (!options.verifyOnly) {
      console.log('')
      console.log('  Dry run. Nothing was written. What is below compares the source')
      console.log('  against the target as it stands, so on an empty target every')
      console.log('  count differs and that is the expected result of a dry run.')
    }

    const report = await verifyCatalogue(source, target, { coverDir: options.covers })
    printReport(report)

    if (!options.apply && !options.verifyOnly) {
      console.log('  Nothing was written. Re-run with --apply to move the catalogue.')
      console.log('')
      return 0
    }
    return report.problems.length ? 1 : 0
  } finally {
    await source.close()
    if (target) await target.close()
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log(USAGE)
    return argv.length === 0 ? 2 : 0
  }

  const options = parseArgs(argv)
  if ('error' in options) {
    console.error(`${options.error}\n\n${USAGE}`)
    return 2
  }
  if (!options.target) {
    console.error(
      'No target. Pass --target <connection> or set BOOKSCAN_MIGRATE_TARGET.\n' +
      'ConnectionStrings__bookscan is deliberately not read; see the top of this file.\n\n' +
      USAGE,
    )
    return 2
  }
  return run(options)
}

// `readable` is re-exported so a person reading a sort key out of a report can
// call the same function the report used, rather than guessing what the bars
// in it were.
export { readable }

// Only when run directly. Importing this file from a test must not start a
// migration, and process.argv in a vitest worker is not this tool's.
if (process.argv[1] && /migrate-sqlite-to-pg/.test(process.argv[1])) {
  main().then(
    (code) => { process.exitCode = code },
    (error: unknown) => {
      console.error(error)
      process.exitCode = 1
    },
  )
}

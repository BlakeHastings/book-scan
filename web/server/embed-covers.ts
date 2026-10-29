/**
 * Command line front end for the cover embedding backfill. Run with `--help`
 * for usage.
 *
 * The catalogue is `--target` and nothing else; the photographs are under
 * `BOOKSCAN_DATA` exactly as the server reads it. The server runs the same
 * backfill on every start once the model has loaded, so this is for a catalogue
 * no server is running on, or for seeing what a start would do.
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EmbedPhotographsHandler } from '../application/capture/embed-photographs'
import { PgvectorCoverEmbeddings } from '../infrastructure/capture/cover-embeddings'
import { OnnxCoverEncoder } from '../infrastructure/capture/onnx-cover-encoder'
import { describeConnection, openPostgres } from './db.pg'
import { NO_TARGET, targetIn } from './write-target'

const USAGE = `Embed the front and catalogue photographs that have no embedding yet.

Usage: npx tsx server/embed-covers.ts --target '<connection>' [--apply]

  --target  The catalogue to read and write. Required, and taken from nowhere
            else: not ConnectionStrings__bookscan, which the server runs on.
  --apply   Load the model and write the embeddings. Without it nothing is
            loaded or written and the run only counts what it would embed.

The photographs are under BOOKSCAN_DATA, or ./data when that is unset, the
same as the server. The model's weights are cached in ~/.cache/bookscan/models
and fetched from a pinned revision the first time.`

/** Seconds between printing the target and writing to it. */
const GRACE = 5

/** Far more photographs than any catalogue has, to count them in one ask. */
const ALL = 1_000_000

export async function main(args: string[]): Promise<number> {
  const known = ['--apply', '--target', '--help', '-h']
  const unknown = args.filter((arg, index) => !known.includes(arg) && args[index - 1] !== '--target')
  if (unknown.length) {
    console.error(`Unrecognised argument: ${unknown.join(' ')}\n\n${USAGE}`)
    return 2
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  const apply = args.includes('--apply')
  const coverDir = join(resolve(process.env.BOOKSCAN_DATA ?? 'data'), 'covers')
  const connection = targetIn(args)
  if (!connection) {
    console.error(`${NO_TARGET}\n\n${USAGE}`)
    return 2
  }

  const encoder = new OnnxCoverEncoder()
  console.log('')
  console.log('  Embed cover photographs')
  console.log('  ' + '-'.repeat(60))
  console.log(`  database        ${describeConnection(connection)}`)
  console.log(`  photographs     ${coverDir}`)
  console.log(`  model           ${encoder.model}`)
  console.log(`  mode            ${apply ? 'APPLY, rows will be written' : 'DRY RUN, nothing will be written'}`)
  console.log('  ' + '-'.repeat(60))
  console.log('')

  const db = await openPostgres(connection)
  try {
    const embeddings = new PgvectorCoverEmbeddings(db)
    const todo = await embeddings.unembedded(encoder.model, { limit: ALL })
    console.log(`  photographs without an embedding  ${todo.length}`)
    if (!apply || !todo.length) {
      if (todo.length) console.log('\n  Nothing was written. Re-run with --apply to embed them.')
      console.log('')
      return 0
    }

    console.log(`  Writing to the catalogue above in ${GRACE} seconds. Ctrl-C to stop.`)
    await new Promise((done) => setTimeout(done, GRACE * 1000))
    console.log(`  model loaded: ${await encoder.load()}`)

    const done = await new EmbedPhotographsHandler(
      encoder, embeddings, { read: (file) => readFile(join(coverDir, file)) },
    ).handle({ now: () => new Date().toISOString() })
    console.log(`  embedded  ${done.embedded}`)
    console.log(`  failed    ${done.failed.length}`)
    for (const { photograph, reason } of done.failed) {
      console.log(`    book ${photograph.bookId}, ${join(coverDir, photograph.file)}: ${reason}`)
    }
    console.log('')
    return done.failed.length ? 1 : 0
  } finally {
    // A pool left open holds the process alive after the report is printed.
    await db.close()
  }
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

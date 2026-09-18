// SessionStart check: say out loud when the catalogue's backup has stopped.
//
// It reports and repairs nothing: it starts no task and opens no connection to
// the catalogue. `web/server/backup-watch.ts`, over `GET /api/backup`, asks the
// same question of the same disk; where the two disagree that file is right and
// this is the copy to fix.
//
// The dumps and the covers are measured differently. The covers are mirrored
// with `robocopy /E /XO`, whose default `/COPY:DAT` preserves source timestamps,
// so the newest file in the destination is the newest file at the source, and
// its age says how long since somebody photographed a book rather than how long
// since the mirror ran. The covers are therefore checked by comparison: the
// mirror is current when the destination's newest is at least as new as the
// source's, whatever age that is. Where the source cannot be read, that is said
// rather than falling back to an age.
//
// It reports what the manifest's `verified` block says and does not second-guess
// it, so a backup that is fresh and wrong in a way the verification does not
// test passes here.
//
// Silent at session start when there is nothing to say, because a line printed
// every session is a line nobody reads. `--status` is a question somebody asked,
// so that answers.
//
// Where neither the environment nor the machine record names a directory, it
// says so rather than passing quietly. The exception is a machine that records
// `"catalogue": "elsewhere"` in `.git/factory/backup-dirs.json`, and that holds
// only while nothing is configured: a machine naming even one directory has
// something here claiming to be watched and is complained about as before. The
// record is worded that way round on purpose. Recorded the other way, as a
// machine that expects to hold a catalogue, losing one file would silently
// retire the alarm on the machine that most needs it.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * The age of a dump is not a question here. There is no nightly schedule: a
 * backup is taken before any operation that touches the catalogue, by whoever is
 * doing the operation, so there is no clock for an age to be late against.
 *
 * What the disk can prove is the two things below: that scanning has happened
 * since the last dump, and that the last dump verified. Covers are only written
 * when somebody photographs a book, so editing a record, moving a book or
 * running a repair leaves no file and nothing here can see it.
 */

/**
 * Where the backups live, from the environment first and the machine record
 * second. `catalogue` comes from the record only, and is `'elsewhere'` just
 * where the record says so in those words, `null` for every machine that has not
 * said it, including one with no record at all.
 *
 * The record sits in `.git/factory/`, inside the git common directory, shared by
 * every worktree and inherited by no clone: these are machine facts and are
 * never committed.
 */
export function directories(env = process.env, factoryDir = null) {
  const fromEnv = {
    dumps: env.BOOKSCAN_BACKUP_DIR ?? null,
    covers: env.BOOKSCAN_COVERS_DIR ?? null,
    coversSource: env.BOOKSCAN_COVERS_SOURCE ?? null,
    catalogue: null,
  }
  if (fromEnv.dumps && fromEnv.covers && fromEnv.coversSource) return fromEnv

  const dir = factoryDir ?? commonDir()
  const record = dir && join(dir, 'factory', 'backup-dirs.json')
  if (record && existsSync(record)) {
    try {
      const said = JSON.parse(readFileSync(record, 'utf8'))
      return {
        dumps: fromEnv.dumps ?? said.dumps ?? null,
        covers: fromEnv.covers ?? said.covers ?? null,
        coversSource: fromEnv.coversSource ?? said.coversSource ?? null,
        catalogue: said.catalogue === 'elsewhere' ? 'elsewhere' : null,
      }
    } catch {
      // A malformed record is the same as no record.
    }
  }
  return fromEnv
}

function commonDir() {
  try {
    return execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function newestIn(dir, ending = '') {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }

  let best = null
  for (const name of entries) {
    if (ending && !name.endsWith(ending)) continue
    let stat
    try {
      stat = statSync(join(dir, name))
    } catch {
      continue
    }
    if (!best || stat.mtimeMs > best.at) best = { name, at: stat.mtimeMs }
  }
  return best
}

const hoursSince = (at, now) => (now - at) / 3_600_000
const days = (hours) => (hours / 24).toFixed(1)

/** Believed only while nothing here is claiming to be watched. See the header. */
function holdsNoCatalogue(dirs) {
  return dirs.catalogue === 'elsewhere' && !dirs.dumps && !dirs.covers && !dirs.coversSource
}

/**
 * What the verification beside a dump says about it. Absent or unreadable is
 * reported as unknown rather than as failure: a dump whose manifest cannot be
 * read is a different problem from a dump that failed to restore.
 */
function verificationOf(dir, dumpName) {
  const manifest = join(dir, dumpName.replace(/\.dump$/, '.json'))
  try {
    const said = JSON.parse(readFileSync(manifest, 'utf8'))
    if (!said.verified) return { known: false }
    return {
      known: true,
      ok: said.verified.ok === true && (said.verified.differences ?? []).length === 0,
      differences: said.verified.differences ?? [],
    }
  } catch {
    return { known: false }
  }
}

export function complaints(dirs, now = Date.now()) {
  const said = []

  // A machine configured with nothing, which is correct here, rather than a
  // machine left unconfigured.
  if (holdsNoCatalogue(dirs)) return said

  const missing = [
    dirs.dumps ? null : 'no dump directory',
    dirs.covers ? null : 'no covers destination',
    dirs.coversSource ? null : 'no covers source',
  ].filter(Boolean)

  if (missing.length) {
    said.push(
      `Backup freshness is not fully watched (${missing.join(', ')}).`
      + '\n  Set BOOKSCAN_BACKUP_DIR, BOOKSCAN_COVERS_DIR and BOOKSCAN_COVERS_SOURCE,'
      + '\n  or write .git/factory/backup-dirs.json.',
    )
    if (!dirs.dumps && !dirs.covers) return said
  }

  const newestDump = dirs.dumps ? newestIn(dirs.dumps, '.dump') : null

  if (dirs.dumps) {
    if (!newestDump) {
      said.push(`No dump at all in ${dirs.dumps}.`)
    } else {
      const verified = verificationOf(dirs.dumps, newestDump.name)
      if (!verified.known) {
        said.push(`The newest dump has no readable verification beside it (${newestDump.name}).`)
      } else if (!verified.ok) {
        said.push(
          `The newest dump did not verify clean: ${verified.differences.length} difference(s).`,
        )
      }
    }
  }

  // The one thing about timing the disk can prove: somebody has photographed a
  // book since the last dump was taken, so there is work no backup holds.
  if (newestDump && dirs.coversSource) {
    const scanned = newestIn(dirs.coversSource)
    if (scanned && scanned.at > newestDump.at) {
      said.push(
        `Books have been photographed since the last backup: the newest is`
        + ` ${days(hoursSince(scanned.at, now))} days old and the newest dump is`
        + ` ${days(hoursSince(newestDump.at, now))} days old.`
        + '\n  Take one before the next operation (docs/backup-runbook.md).',
      )
    }
  }

  // A comparison rather than an age. See the header on robocopy timestamps.
  if (dirs.covers && dirs.coversSource) {
    const copied = newestIn(dirs.covers)
    const source = newestIn(dirs.coversSource)

    if (!source) {
      said.push(
        `The covers source ${dirs.coversSource} could not be read, so the mirror`
        + ' cannot be checked.',
      )
    } else if (!copied) {
      said.push(`No cover has ever been copied to ${dirs.covers}.`)
    } else if (copied.at < source.at) {
      said.push(
        `The covers mirror is behind: the newest photograph is ${days(hoursSince(source.at, now))}`
        + ` days old and the newest copy of one is ${days(hoursSince(copied.at, now))} days old.`,
      )
    }
  }

  return said
}

if (process.argv[1]?.endsWith('check-backup-freshness.mjs')) {
  const dirs = directories()
  const said = complaints(dirs)

  if (process.argv.includes('--status')) {
    console.log(`dumps:  ${dirs.dumps ?? '(not configured)'}`)
    console.log(`covers: ${dirs.covers ?? '(not configured)'}`)
    console.log('')
    if (holdsNoCatalogue(dirs)) {
      console.log('This machine records that the catalogue is elsewhere, in'
        + '\n.git/factory/backup-dirs.json, so there is nothing here to watch and'
        + '\nnothing to say at the start of a session. Take that line out and this is'
        + '\nloud again, which is what every machine that has not written it gets.')
    } else {
      console.log(said.length
        ? said.join('\n')
        : 'Nothing has been photographed since the newest dump, and that dump verified clean.')
    }
    process.exit(0)
  }

  if (said.length) {
    console.log('The catalogue backup needs attention.')
    console.log('')
    for (const line of said) console.log(`- ${line}`)
    console.log('')
    console.log('The catalogue is somebody\'s afternoons and cannot be re-scanned cheaply.')
    console.log('See docs/backup-runbook.md. This check only reports; it repairs nothing.')
  }

  // Never non-zero: a SessionStart hook that fails is a session that starts
  // badly, and this is a notice rather than a gate.
  process.exit(0)
}

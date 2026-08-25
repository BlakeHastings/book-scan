// SessionStart check: say out loud when the catalogue's backup has stopped.
//
// WHAT THIS DETECTS
// On 2026-08-24 the newest dump was **5.8 days old** and the newest cover was
// **16.9 days old**, and nobody knew. `install-backup-task.ps1` registers a
// version-pinned `pwsh` path, and PowerShell updated to 7.6.5, so the task ran
// and died in under a second every night (#454).
//
// Nothing was broken in a way anything watched. The task existed, the schedule
// fired, the directory was there with fourteen dumps in it, and the most recent
// one restored and verified clean. Every question except "when" had a healthy
// answer.
//
// THIS IS NOT A SECOND ANSWER TO A QUESTION ALREADY ANSWERED
// `web/server/backup-watch.ts`, over `GET /api/backup`, already asks the right
// question and asks it better than a process check could: is there a dump less
// than about a day old whose manifest says a verification restored it and found
// no differences? Its runbook explains why the *result* rather than the job —
// the job ran on both of the nights nobody found out about.
//
// **The gap was never a missing check. It was that nothing carried an existing
// check's answer to a person.** That check needs the server running and someone
// to ask it. This reads the same two facts off the same disk and puts them
// where somebody will see them without asking: the start of a session.
//
// Deriving one answer in two places is this project's most expensive defect
// family — five defects and counting — so the duplication is deliberate, narrow,
// and worth naming. What is duplicated is the *question*, not the catalogue's
// state: this opens no connection and reads no database. If the two ever
// disagree, `backup-watch.ts` is right and this is the copy to fix.
//
// WHY TWO CLOCKS
// The dumps and the covers stopped **twelve days apart**. A check watching only
// the dumps would have reported healthy through most of the gap, and a check
// watching only the newest file in either would have been satisfied by the other
// still running. They are aged independently for that reason.
//
// WHY IT SAYS THE NUMBER
// "The backup is stale" gets normalised and then ignored. "The newest backup is
// 5.8 days old" is a fact somebody acts on. And it stays **silent when things
// are fine**, because a line that prints every session is a line nobody reads,
// which is how six days went by.
//
// WHAT THIS DOES NOT COVER
// Repair. It reports and does nothing else — it starts no task, touches no
// scheduled job, and opens no connection to the catalogue. #454 is the repair
// and it belongs to whoever the owner asks.
//
// Nor does it cover a backup that is fresh and wrong in a way the verification
// does not test. The manifest's `verified` block is only as good as what
// `backup-catalogue.ts` compares, and the runbook is explicit that row counts do
// not move when a collation breaks. This reports what that block says; it does
// not second-guess it.
//
// And it cannot watch what it has not been told about. Where neither the
// environment nor the machine record names a directory, it says so rather than
// passing quietly, because a watcher that is silently watching nothing is the
// same defect this file exists to catch.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * How old is too old.
 *
 * The runbook's own question is "less than about a day ago". A day and a half
 * allows one late run without crying wolf, and still catches a task that has
 * stopped, because a stopped task never comes back on its own.
 */
const STALE_AFTER_HOURS = 36

/**
 * Where the backups live, from the environment first and the machine record
 * second.
 *
 * These are machine facts — which disk this operator keeps backups on — so they
 * are never committed. `.git/factory/` is where this project already puts that
 * kind of state: inside the git common directory, shared by every worktree and
 * inherited by no clone.
 */
export function directories(env = process.env, factoryDir = null) {
  const fromEnv = {
    dumps: env.BOOKSCAN_BACKUP_DIR ?? null,
    covers: env.BOOKSCAN_COVERS_DIR ?? null,
  }
  if (fromEnv.dumps && fromEnv.covers) return fromEnv

  const dir = factoryDir ?? commonDir()
  const record = dir && join(dir, 'factory', 'backup-dirs.json')
  if (record && existsSync(record)) {
    try {
      const said = JSON.parse(readFileSync(record, 'utf8'))
      return {
        dumps: fromEnv.dumps ?? said.dumps ?? null,
        covers: fromEnv.covers ?? said.covers ?? null,
      }
    } catch {
      // A malformed record is the same as no record, and saying so is the
      // caller's job rather than this function's.
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

/** The newest entry in a directory, by modification time, or null. */
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

/**
 * What the verification beside a dump says about it.
 *
 * Absent or unreadable is reported as unknown rather than as failure: a dump
 * whose manifest cannot be read is a different problem from a dump that failed
 * to restore, and calling them the same thing would make the loud case
 * unbelievable.
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

/**
 * Everything worth saying, or an empty list when there is nothing to say.
 *
 * Returned rather than printed so the test can ask the question without
 * reading stdout, and so the two clocks are visibly independent.
 */
export function complaints(dirs, now = Date.now(), staleAfter = STALE_AFTER_HOURS) {
  const said = []

  if (!dirs.dumps || !dirs.covers) {
    said.push(
      'Backup freshness is not being watched'
      + `${dirs.dumps ? '' : ' (no dump directory)'}`
      + `${dirs.covers ? '' : ' (no covers directory)'}.`
      + '\n  Set BOOKSCAN_BACKUP_DIR and BOOKSCAN_COVERS_DIR, or write'
      + ' .git/factory/backup-dirs.json.',
    )
    if (!dirs.dumps && !dirs.covers) return said
  }

  if (dirs.dumps) {
    const newest = newestIn(dirs.dumps, '.dump')
    if (!newest) {
      said.push(`No dump at all in ${dirs.dumps}.`)
    } else {
      const old = hoursSince(newest.at, now)
      if (old > staleAfter) {
        said.push(`The newest catalogue dump is ${days(old)} days old (${newest.name}).`)
      }
      const verified = verificationOf(dirs.dumps, newest.name)
      if (!verified.known) {
        said.push(`The newest dump has no readable verification beside it (${newest.name}).`)
      } else if (!verified.ok) {
        said.push(
          `The newest dump did not verify clean: ${verified.differences.length} difference(s).`,
        )
      }
    }
  }

  if (dirs.covers) {
    const newest = newestIn(dirs.covers)
    if (!newest) {
      said.push(`No cover has ever been copied to ${dirs.covers}.`)
    } else {
      const old = hoursSince(newest.at, now)
      if (old > staleAfter) {
        said.push(`The newest backed-up cover is ${days(old)} days old.`)
      }
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
    console.log(said.length ? said.join('\n') : 'Both are fresh and the newest dump verified clean.')
    process.exit(0)
  }

  // Silent when there is nothing to say. A line printed every session is a line
  // nobody reads, and that is how six days went by unnoticed.
  if (said.length) {
    console.log('The catalogue backup needs attention.')
    console.log('')
    for (const line of said) console.log(`- ${line}`)
    console.log('')
    console.log('The catalogue is somebody\'s afternoons and cannot be re-scanned cheaply.')
    console.log('See docs/backup-runbook.md. This check only reports; it repairs nothing.')
  }

  // Never non-zero: this is a notice at the start of a session, not a gate, and
  // a SessionStart hook that fails is a session that starts badly.
  process.exit(0)
}

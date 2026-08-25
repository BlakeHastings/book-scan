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
// WHY TWO CLOCKS, AND WHY THEY ARE NOT THE SAME KIND OF CLOCK
// The dumps and the covers stopped eleven days apart, so watching only one would
// have reported healthy through most of the gap. But they must be measured
// differently, and getting that wrong is a defect this file shipped once.
//
// **A dump is produced by the run** — one new file a night — so its age is the
// time since the last successful run, and an age is the right question.
//
// **The covers are mirrored with `robocopy /E /XO`**, whose default `/COPY:DAT`
// preserves source timestamps. So the newest file in the destination is the
// newest file *at the source*, and its age measures how long since somebody
// photographed a book, not how long since the mirror ran. Verified on
// 2026-08-25: 1541 files on each side, newest identical at
// `2026-08-08T04:21:01.189Z`, and destination mtimes spread over thirteen
// distinct hours instead of clustering at the 03:30 schedule.
//
// The first version of this file aged the covers destination and reported "the
// newest backed-up cover is 16.9 days old". A real number about the wrong thing:
// the mirror was current and nobody had scanned for seventeen days. On a quiet
// week it would cry wolf over a sync that ran perfectly every night, which is
// the failure this file exists to argue against. It was caught in review, not by
// me, and it is written here because the plausible-looking number is what made
// it survive being run.
//
// So the covers are checked by **comparison**: the mirror is current when the
// destination's newest is at least as new as the source's, whatever age that is.
// True on a quiet week, false the moment a copy is missed. Where the source
// cannot be read, that is said rather than falling back to an age, because the
// age is the answer that looked right and was not.
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
 * THE AGE OF A DUMP IS NOT A QUESTION HERE, AND THIS FILE ASKED IT TWICE.
 *
 * The first version aged the dumps against a 36 hour threshold, on the
 * assumption that a nightly schedule produces one every night. **There is no
 * nightly schedule.** #241 retired it on 2026-08-12 and replaced it with a rule:
 * a backup is taken before any operation that touches the catalogue, by whoever
 * is doing the operation.
 *
 * Measured, which is what settled it: all fourteen dumps on the disk were
 * written at irregular local times — 16:14, 10:47, 13:14, 22:32, 08:28, 00:05,
 * 20:21 — and **not one at 03:30**. They are people backing up before work, and
 * that is #241's model doing exactly what it says.
 *
 * (A task called `book-scan catalogue backup` does still fire at 03:30 and fail
 * with `ERROR_FILE_NOT_FOUND` every night. It is a leftover from before #241 and
 * it has never written a dump to that directory. Removing it is #454.)
 *
 * So under the rule that actually exists, an age says nothing. There is no
 * schedule for it to be late against, and complaining that the newest dump is
 * five days old on a week when nobody touched the catalogue is the third time
 * this file would have cried wolf about a backup that was fine.
 *
 * WHAT THE DISK CAN ACTUALLY PROVE
 * Two things, and they are the two things below: that scanning has happened
 * since the last dump, and that the last dump verified.
 *
 * **WHAT IT CANNOT PROVE, WHICH MATTERS MORE THAN IT LOOKS.** Covers are only
 * written when somebody photographs a book. Editing a record, moving a book,
 * lending one, running a repair — none of them leave a file. So this is silent
 * through a week of edits, and under #241 the only thing covering that is the
 * person doing the operation taking a dump first. That is a procedural
 * guarantee and nothing here can detect its absence. It is written down rather
 * than implied, because a check that looks like it watches the catalogue and
 * only watches the camera is precisely the shape of thing this project keeps
 * finding.
 */

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
    coversSource: env.BOOKSCAN_COVERS_SOURCE ?? null,
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
export function complaints(dirs, now = Date.now()) {
  const said = []

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

  // The one thing about timing the disk can actually prove: somebody has
  // photographed a book since the last dump was taken, so there is work no
  // backup holds. An age would say nothing here, because #241 replaced the
  // schedule with "back up before the operation" and there is no clock to be
  // late against. See the header, including what this cannot see.
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

  // The covers are a comparison rather than an age. See the header: robocopy
  // preserves source timestamps, so the destination's newest file is the
  // source's newest file and its age says nothing about when the mirror ran.
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
    console.log(said.length
      ? said.join('\n')
      : 'Nothing has been photographed since the newest dump, and that dump verified clean.')
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

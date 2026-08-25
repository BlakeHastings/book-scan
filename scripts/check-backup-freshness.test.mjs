// What the backup check must say, and when it must say nothing.
//
//   node scripts/check-backup-freshness.test.mjs
//
// The silent cases matter as much as the loud ones. A check that speaks every
// session is a check nobody reads, and the failure it exists to catch is
// exactly the one that went unnoticed for six days because everything looked
// fine. So: silent when fresh, and specific when not.
//
// The two clocks are tested apart, because the real failure had them twelve
// days out of step — dumps stopped on 2026-08-19, covers on 2026-08-08 — and a
// check satisfied by either one being healthy would have said nothing for most
// of that.
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { complaints, directories } from './check-backup-freshness.mjs'

const root = mkdtempSync(join(tmpdir(), 'backup-fresh-'))
const NOW = Date.parse('2026-08-25T00:00:00Z')
const hoursAgo = (h) => new Date(NOW - h * 3_600_000)

/** A backup directory holding one dump of a given age, with its manifest. */
function dumpsDir(name, ageHours, verified = { ok: true, differences: [] }) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const stem = 'bookscan-20260819T065827Z'
  writeFileSync(join(dir, `${stem}.dump`), 'pretend')
  if (verified !== null) {
    writeFileSync(join(dir, `${stem}.json`), JSON.stringify({ dump: `${stem}.dump`, verified }))
  }
  const when = hoursAgo(ageHours)
  utimesSync(join(dir, `${stem}.dump`), when, when)
  return dir
}

/** A covers directory holding one file of a given age. */
function coversDir(name, ageHours) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, '1786162699453_noisbn_back_crop.jpg')
  writeFileSync(file, 'pretend')
  const when = hoursAgo(ageHours)
  utimesSync(file, when, when)
  return dir
}

let failed = 0
const check = (name, actual, expected) => {
  if (actual !== expected) {
    failed++
    console.error(`FAIL  ${name}: expected ${expected}, got ${actual}`)
  }
}

// --- Silent when everything is fine. This is the case that keeps it readable.
{
  const said = complaints({ dumps: dumpsDir('ok-d', 6), covers: coversDir('ok-c', 6) }, NOW)
  check('fresh and verified says nothing', said.length, 0)
}

// --- Just inside and just outside the threshold.
{
  const said = complaints({ dumps: dumpsDir('edge-in', 35), covers: coversDir('edge-in-c', 35) }, NOW)
  check('35 hours is still fine', said.length, 0)
}
{
  const said = complaints({ dumps: dumpsDir('edge-out', 37), covers: coversDir('edge-out-c', 6) }, NOW)
  check('37 hours complains', said.length, 1)
  check('and says it is a dump', /dump is 1\.5 days old/.test(said[0]), true)
}

// --- The two clocks are independent, which is the shape of the real failure.
{
  // Dumps healthy, covers twelve days behind: exactly 2026-08-19 vs 2026-08-08.
  const said = complaints({ dumps: dumpsDir('two-a', 6), covers: coversDir('two-b', 24 * 17) }, NOW)
  check('a stale covers clock is caught while dumps are fresh', said.length, 1)
  check('and it names the covers', /cover is 17\.0 days old/.test(said[0]), true)
}
{
  const said = complaints({ dumps: dumpsDir('two-c', 24 * 6), covers: coversDir('two-d', 6) }, NOW)
  check('a stale dump clock is caught while covers are fresh', said.length, 1)
  check('and it names the dump', /dump is 6\.0 days old/.test(said[0]), true)
}
{
  const said = complaints({ dumps: dumpsDir('both-a', 24 * 6), covers: coversDir('both-b', 24 * 17) }, NOW)
  check('both stale gives both lines', said.length, 2)
}

// --- The result, not the file's existence. A fresh dump that did not verify is
// --- the "ran and produced nothing usable" case this project keeps meeting.
{
  const dir = dumpsDir('bad-verify', 6, { ok: false, differences: ['books: 288 vs 0'] })
  const said = complaints({ dumps: dir, covers: coversDir('bad-verify-c', 6) }, NOW)
  check('a fresh dump that failed verification complains', said.length, 1)
  check('and says how many differences', /1 difference\(s\)/.test(said[0]), true)
}
{
  const dir = dumpsDir('no-manifest', 6, null)
  const said = complaints({ dumps: dir, covers: coversDir('no-manifest-c', 6) }, NOW)
  check('a dump with no manifest is reported as unknown, not as failure', said.length, 1)
  check('and says the verification is unreadable', /no readable verification/.test(said[0]), true)
}

// --- Empty and missing directories.
{
  const empty = join(root, 'empty')
  mkdirSync(empty, { recursive: true })
  const said = complaints({ dumps: empty, covers: coversDir('empty-c', 6) }, NOW)
  check('no dump at all complains', said.length, 1)
}
{
  const said = complaints({ dumps: join(root, 'nope'), covers: coversDir('nope-c', 6) }, NOW)
  check('an unreadable directory complains rather than passing', said.length, 1)
}

// --- Not configured must be loud. A watcher silently watching nothing is the
// --- same defect this file exists to catch.
{
  const said = complaints({ dumps: null, covers: null }, NOW)
  check('nothing configured says so', said.length, 1)
  check('and names both variables', /BOOKSCAN_BACKUP_DIR/.test(said[0]), true)
}
{
  const said = complaints({ dumps: dumpsDir('half', 6), covers: null }, NOW)
  check('half configured still says so', said.length, 1)
  check('and names the missing half', /no covers directory/.test(said[0]), true)
}

// --- Resolution order: the environment wins over the machine record.
{
  mkdirSync(join(root, 'factory'), { recursive: true })
  writeFileSync(
    join(root, 'factory', 'backup-dirs.json'),
    JSON.stringify({ dumps: 'D:/from-record', covers: 'D:/covers-record' }),
  )
  const both = directories({ BOOKSCAN_BACKUP_DIR: 'D:/from-env', BOOKSCAN_COVERS_DIR: 'D:/c-env' }, root)
  check('environment wins for dumps', both.dumps, 'D:/from-env')
  const mixed = directories({ BOOKSCAN_BACKUP_DIR: 'D:/from-env' }, root)
  check('record fills the half the environment left', mixed.covers, 'D:/covers-record')
  check('and the environment keeps the half it set', mixed.dumps, 'D:/from-env')
  const neither = directories({}, root)
  check('record answers when the environment is silent', neither.dumps, 'D:/from-record')
}

rmSync(root, { recursive: true, force: true })

if (failed > 0) {
  console.error(`\n${failed} case(s) behaved wrongly.`)
  process.exit(1)
}
console.log('check-backup-freshness: all cases behaved as expected.')

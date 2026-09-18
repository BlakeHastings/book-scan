// What the backup check must say, and when it must say nothing.
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { complaints, directories } from './check-backup-freshness.mjs'

const root = mkdtempSync(join(tmpdir(), 'backup-fresh-'))
const NOW = Date.parse('2026-08-25T00:00:00Z')
const hoursAgo = (h) => new Date(NOW - h * 3_600_000)

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

{
  const said = complaints({ dumps: dumpsDir('ok-d', 6), covers: coversDir('ok-c', 6), coversSource: coversDir('ok-s', 6) }, NOW)
  check('fresh and verified says nothing', said.length, 0)
}

{
  const said = complaints({
    dumps: dumpsDir('quiet-old', 24 * 6),
    covers: coversDir('quiet-old-c', 24 * 17),
    coversSource: coversDir('quiet-old-s', 24 * 17),
  }, NOW)
  check('an old dump with nothing scanned since says nothing', said.length, 0)
}
{
  const said = complaints({
    dumps: dumpsDir('ancient', 24 * 90),
    covers: coversDir('ancient-c', 24 * 120),
    coversSource: coversDir('ancient-s', 24 * 120),
  }, NOW)
  check('and age alone never complains, however old', said.length, 0)
}

{
  const said = complaints({
    dumps: dumpsDir('unbacked', 24 * 3),
    covers: coversDir('unbacked-c', 20),
    coversSource: coversDir('unbacked-s', 20),
  }, NOW)
  check('scanning newer than the dump complains', said.length, 1)
  check('and names both ages', /newest is 0\.8 days old and the newest dump is 3\.0 days old/.test(said[0]), true)
}
{
  // One hour either side of the dump, so the rule is the comparison and not a
  // tolerance.
  const said = complaints({
    dumps: dumpsDir('just-after', 24),
    covers: coversDir('just-after-c', 25),
    coversSource: coversDir('just-after-s', 25),
  }, NOW)
  check('scanning just before the dump is covered by it', said.length, 0)
}

{
  const said = complaints({
    dumps: dumpsDir('quiet-d', 6),
    covers: coversDir('quiet-dest', 24 * 17),
    coversSource: coversDir('quiet-src', 24 * 17),
  }, NOW)
  check('a quiet week with a current mirror says nothing', said.length, 0)
}
{
  const said = complaints({
    dumps: dumpsDir('behind-d', 6),
    covers: coversDir('behind-dest', 24 * 17),
    coversSource: coversDir('behind-src', 20),
  }, NOW)
  check('a mirror that missed a copy complains', said.length, 1)
  check('and gives both ages', /newest photograph is 0\.8 days old/.test(said[0]), true)
}
{
  const said = complaints({
    dumps: dumpsDir('src-gone-d', 6),
    covers: coversDir('src-gone-dest', 6),
    coversSource: join(root, 'no-such-source'),
  }, NOW)
  check('an unreadable source says so rather than guessing', said.length, 1)
  check('and does not fall back to an age', /could not be read/.test(said[0]), true)
}

{
  const said = complaints({
    dumps: dumpsDir('two-c', 24 * 6),
    covers: coversDir('two-d', 6),
    coversSource: coversDir('two-d-src', 6),
  }, NOW)
  check('a stale dump clock is caught while the mirror is current', said.length, 1)
  check('and it names the dump', /dump is 6\.0 days old/.test(said[0]), true)
}
{
  const said = complaints({
    dumps: dumpsDir('both-a', 24 * 6),
    covers: coversDir('both-dest', 24 * 17),
    coversSource: coversDir('both-src', 20),
  }, NOW)
  check('a stale dump and a behind mirror give both lines', said.length, 2)
}

{
  const dir = dumpsDir('bad-verify', 6, { ok: false, differences: ['books: 288 vs 0'] })
  const said = complaints({ dumps: dir, covers: coversDir('bad-verify-c', 6), coversSource: coversDir('bad-verify-s', 6) }, NOW)
  check('a fresh dump that failed verification complains', said.length, 1)
  check('and says how many differences', /1 difference\(s\)/.test(said[0]), true)
}
{
  const dir = dumpsDir('no-manifest', 6, null)
  const said = complaints({ dumps: dir, covers: coversDir('no-manifest-c', 6), coversSource: coversDir('no-manifest-s', 6) }, NOW)
  check('a dump with no manifest is reported as unknown, not as failure', said.length, 1)
  check('and says the verification is unreadable', /no readable verification/.test(said[0]), true)
}

{
  const empty = join(root, 'empty')
  mkdirSync(empty, { recursive: true })
  const said = complaints({ dumps: empty, covers: coversDir('empty-c', 6), coversSource: coversDir('empty-s', 6) }, NOW)
  check('no dump at all complains', said.length, 1)
}
{
  const said = complaints({ dumps: join(root, 'nope'), covers: coversDir('nope-c', 6), coversSource: coversDir('nope-s', 6) }, NOW)
  check('an unreadable directory complains rather than passing', said.length, 1)
}

{
  const said = complaints({ dumps: null, covers: null, coversSource: null }, NOW)
  check('nothing configured says so', said.length, 1)
  check('and names both variables', /BOOKSCAN_BACKUP_DIR/.test(said[0]), true)
}
{
  const said = complaints({ dumps: dumpsDir('half', 6), covers: null, coversSource: null }, NOW)
  check('half configured still says so', said.length, 1)
  check('and names the missing half', /no covers destination/.test(said[0]), true)
}

{
  const said = complaints({ dumps: null, covers: null, coversSource: null, catalogue: 'elsewhere' }, NOW)
  check('a machine that records the catalogue elsewhere says nothing', said.length, 0)
}
{
  const said = complaints({ dumps: null, covers: null, coversSource: null, catalogue: null }, NOW)
  check('a machine that has declared nothing is still loud', said.length, 1)
  check('and still names the variables', /BOOKSCAN_BACKUP_DIR/.test(said[0]), true)
}
{
  const said = complaints({
    dumps: dumpsDir('claimed', 6), covers: null, coversSource: null, catalogue: 'elsewhere',
  }, NOW)
  check('a configured directory outranks the declaration', said.length, 1)
  check('and names the missing half as usual', /no covers destination/.test(said[0]), true)
}
{
  const said = complaints({
    dumps: dumpsDir('declared-d', 6),
    covers: coversDir('declared-dest', 24 * 17),
    coversSource: coversDir('declared-src', 20),
    catalogue: 'elsewhere',
  }, NOW)
  check('a mirror that missed a copy complains whatever the record says', said.length, 1)
  check('and it is still the mirror it names', /covers mirror is behind/.test(said[0]), true)
}

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
  check('a record naming paths declares nothing', neither.catalogue, null)
}
{
  const dir = join(root, 'no-catalogue-here')
  mkdirSync(join(dir, 'factory'), { recursive: true })
  writeFileSync(join(dir, 'factory', 'backup-dirs.json'), JSON.stringify({ catalogue: 'elsewhere' }))
  const said = directories({}, dir)
  check('a record naming no directory still answers the catalogue question', said.catalogue, 'elsewhere')
  check('and names no directories', said.dumps, null)
}
{
  const said = directories({}, join(root, 'no-such-factory-root'))
  check('no record declares nothing', said.catalogue, null)
}

rmSync(root, { recursive: true, force: true })

if (failed > 0) {
  console.error(`\n${failed} case(s) behaved wrongly.`)
  process.exit(1)
}
console.log('check-backup-freshness: all cases behaved as expected.')

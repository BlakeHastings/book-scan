/**
 * The check that notices a backup has stopped.
 *
 * Every case here is built out of files in a scratch directory this file made
 * itself. **Nothing in this file names `E:\book-scan-backups`**, opens a
 * catalogue, or reads anything outside the checkout: the whole point of the
 * thing under test is that it answers a question about files, so a failing case
 * is a directory with the wrong files in it, which costs nothing to make and
 * takes no real backup anywhere near a test.
 *
 * The dates are the ones from the two incidents, because a fixture built to the
 * shape of what actually happened is worth more than a round number.
 */

import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dumpFileName, manifestFileName, type Manifest } from './backup'
import { BACKUP_AGE_LIMIT_HOURS, watchBackups } from './backup-watch'
import { removeScratchRoot, scratchRoot } from './scratchdir'

let root: string

beforeAll(() => { root = scratchRoot('backup-watch') })
afterAll(() => { removeScratchRoot(root) })

/** A directory of its own for one case. */
function directory(): string {
  return mkdtempSync(join(root, 'dir-'))
}

/** A manifest as the tool writes one, with only the fields this check reads. */
function manifestFor(dump: string, verified: Manifest['verified']): string {
  return `${JSON.stringify({
    dump,
    takenAt: new Date().toISOString(),
    source: '127.0.0.1:5433/bookscan',
    digest: { counts: {}, digests: {}, shelfOrder: null, areaOrder: null,
      collation: 'en_US.utf8', ctype: 'en_US.utf8', encoding: 'UTF8',
      serverVersionNum: 180003 },
    bytes: 172483,
    client: 'docker postgres:18.3',
    verified,
  }, null, 2)}\n`
}

/** Put a dump and its manifest in a directory, as a run would have. */
function dumped(
  dir: string,
  at: Date,
  verified: Manifest['verified'] | 'no manifest' = { at: at.toISOString(), ok: true, scratch: 'bookscan_verify_42c215a724', differences: [] },
): string {
  const name = dumpFileName(at)
  writeFileSync(join(dir, name), 'not a real dump, and nothing here restores one')
  if (verified !== 'no manifest') {
    writeFileSync(join(dir, manifestFileName(name)), manifestFor(name, verified))
  }
  return name
}

const AUGUST_13 = new Date('2026-08-13T08:30:01Z')
const hoursBefore = (n: number) => new Date(AUGUST_13.getTime() - n * 3_600_000)

describe('a verified dump newer than about a day', () => {
  it('is what a working nightly backup looks like', async () => {
    const dir = directory()
    dumped(dir, hoursBefore(30))
    const newest = dumped(dir, hoursBefore(6))

    const watch = await watchBackups(dir, AUGUST_13)

    expect(watch.state).toBe('fresh')
    expect(watch.verified?.dump).toBe(newest)
    expect(watch.ageHours).toBe(6)
  })

  it('is still fine at the last hour before the limit', async () => {
    const dir = directory()
    dumped(dir, hoursBefore(BACKUP_AGE_LIMIT_HOURS - 1))

    expect((await watchBackups(dir, AUGUST_13)).state).toBe('fresh')
  })

  it('has stopped being fine at the limit itself', async () => {
    const dir = directory()
    dumped(dir, hoursBefore(BACKUP_AGE_LIMIT_HOURS))

    expect((await watchBackups(dir, AUGUST_13)).state).toBe('stale')
  })
})

/*
 * This is the shape of both incidents. The dumps of the 9th and the 11th are
 * real ones and are perfectly good; what is wrong is that it is the 13th. A
 * check on whether the job started would have been satisfied by both of the
 * nights in between, because it started on both of them.
 */
describe('a backup that has stopped', () => {
  it('is stale when the newest verified dump is days old', async () => {
    const dir = directory()
    dumped(dir, new Date('2026-08-09T21:14:34Z'))
    const last = dumped(dir, new Date('2026-08-11T15:47:41Z'))

    const watch = await watchBackups(dir, AUGUST_13)

    expect(watch.state).toBe('stale')
    expect(watch.verified?.dump).toBe(last)
    expect(watch.ageHours).toBeGreaterThanOrEqual(40)
    expect(watch.where).toBe(dir)
  })

  it('names the limit it was measured against, so the screen need not know it', async () => {
    const dir = directory()
    dumped(dir, hoursBefore(72))

    expect((await watchBackups(dir, AUGUST_13)).limitHours).toBe(BACKUP_AGE_LIMIT_HOURS)
  })
})

describe('a dump nobody has restored', () => {
  it('does not count, however new it is', async () => {
    const dir = directory()
    dumped(dir, hoursBefore(1), 'no manifest')

    const watch = await watchBackups(dir, AUGUST_13)

    expect(watch.state).toBe('unverified')
    expect(watch.newest?.dump).toBe(dumpFileName(hoursBefore(1)))
    expect(watch.verified).toBeUndefined()
  })

  it('does not count when the verification ran and failed', async () => {
    const dir = directory()
    dumped(dir, hoursBefore(1), {
      at: AUGUST_13.toISOString(),
      ok: false,
      scratch: 'bookscan_verify_42c215a724',
      differences: [{ what: 'shelf order', expected: '9ede898a', actual: '719a2f4c' }],
    })

    expect((await watchBackups(dir, AUGUST_13)).state).toBe('unverified')
  })

  it('does not count when its manifest is half written', async () => {
    const dir = directory()
    const name = dumped(dir, hoursBefore(1), 'no manifest')
    writeFileSync(join(dir, manifestFileName(name)), '{ "dump": "bookscan-2026')

    expect((await watchBackups(dir, AUGUST_13)).state).toBe('unverified')
  })

  it('is passed over in favour of an older one that did verify', async () => {
    const dir = directory()
    const good = dumped(dir, hoursBefore(4))
    dumped(dir, hoursBefore(1), 'no manifest')

    const watch = await watchBackups(dir, AUGUST_13)

    expect(watch.state).toBe('fresh')
    expect(watch.verified?.dump).toBe(good)
    expect(watch.newest?.dump).not.toBe(good)
  })
})

/*
 * The disk is a separate physical one, which is the right choice and is also a
 * thing with a cable. A check that reported "fine" because it could not look
 * would be the exact failure this whole issue is about, one layer further in.
 */
describe('a directory that cannot be read', () => {
  it('is never a pass', async () => {
    const watch = await watchBackups(join(root, 'no-such-disk', 'book-scan-backups'), AUGUST_13)

    expect(watch.state).toBe('unreachable')
    expect(watch.state).not.toBe('fresh')
    expect(watch.why).toBe('there is no such folder')
  })

  it('is a different answer from an empty one', async () => {
    expect((await watchBackups(directory(), AUGUST_13)).state).toBe('none')
  })

  it('is a different answer from not watching at all', async () => {
    const watch = await watchBackups('', AUGUST_13)

    expect(watch.state).toBe('unwatched')
    expect(watch.where).toBe('')
  })
})

describe('what it does and does not read', () => {
  it('ignores a part file from an interrupted run and anything else in there', async () => {
    const dir = directory()
    writeFileSync(join(dir, 'bookscan-20260814T083019Z.dump.part'), '')
    writeFileSync(join(dir, 'notes.txt'), 'left here by somebody')

    expect((await watchBackups(dir, AUGUST_13)).state).toBe('none')
  })

  it('dates a dump from its name and not from when the file was touched', async () => {
    const dir = directory()
    // Written now, named three days ago, which is what a directory copied from
    // somewhere else looks like. The name is the catalogue's clock.
    dumped(dir, new Date('2026-08-10T03:30:00Z'))

    expect((await watchBackups(dir, AUGUST_13)).state).toBe('stale')
  })

  it('changes nothing on the disk it looked at', async () => {
    const dir = directory()
    dumped(dir, hoursBefore(2))
    dumped(dir, hoursBefore(50), 'no manifest')
    const before = readdirSync(dir).sort().map((name) => {
      const info = statSync(join(dir, name))
      return `${name} ${info.size} ${info.mtimeMs}`
    })

    await watchBackups(dir, AUGUST_13)

    const after = readdirSync(dir).sort().map((name) => {
      const info = statSync(join(dir, name))
      return `${name} ${info.size} ${info.mtimeMs}`
    })
    expect(after).toEqual(before)
  })
})

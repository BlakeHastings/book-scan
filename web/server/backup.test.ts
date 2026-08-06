/**
 * The decisions the backup makes without a database or a subprocess: what a
 * dump is called, which dumps retention deletes, how a connection is rewritten
 * for a container, and above all what counts as a difference.
 *
 * `compareDigests` is the part worth guarding hardest. It is the only thing
 * standing between a broken dump and a green log line, and its failure mode is
 * silence: a comparison that quietly stops comparing something reads exactly
 * like a backup that keeps working.
 *
 * The digest SQL itself is exercised against a real Postgres in
 * backup.pg.test.ts, because what it is worth is a property of the server.
 */

import { describe, expect, it } from 'vitest'
import {
  compareDigests,
  containerConnection,
  describeSource,
  dumpFileName,
  dumpTimestamp,
  humanBytes,
  imageMajor,
  manifestFileName,
  planRetention,
  serverMajor,
  type CatalogueDigest,
  type DumpFile,
} from './backup'
import { parseArgs } from './backup-catalogue'

/** A digest with everything matching, to make one thing differ at a time. */
function digest(overrides: Partial<CatalogueDigest> = {}): CatalogueDigest {
  return {
    counts: {
      books: 236, book_authors: 266, captures: 281,
      separators: 11, author_filing: 263, shelf_ranges: 2,
    },
    digests: {
      books: 'aaa', book_authors: 'bbb', captures: 'ccc',
      separators: 'ddd', author_filing: 'eee', shelf_ranges: 'fff',
    },
    shelfOrder: '9ede898a64fcd70cacdfc1f0927d9323',
    separatorOrder: '4e2af9aaa828e7fe2e8f38c22f7a0427',
    collation: 'en_US.utf8',
    ctype: 'en_US.utf8',
    encoding: 'UTF8',
    serverVersionNum: 180003,
    ...overrides,
  }
}

describe('what counts as a difference', () => {
  it('finds nothing when the restore matches the dump', () => {
    expect(compareDigests(digest(), digest())).toEqual([])
  })

  /**
   * The whole argument for hashing the shelf order rather than counting rows.
   * A collation difference does not lose a book, it reorders them, so every
   * count on both sides is identical and the app then tells somebody to put a
   * book in the wrong place. This is the real failure reproduced in the pull
   * request that added this file: a dump restored with COLLATE "C" lost from
   * books.sort_key matched on all six counts and all six content digests.
   */
  it('fails on the shelf order alone, with every count matching', () => {
    const differences = compareDigests(digest(), digest({ shelfOrder: '719a2f4c3fad76d03e' }))
    expect(differences).toEqual([
      {
        what: 'shelf order',
        expected: '9ede898a64fcd70cacdfc1f0927d9323',
        actual: '719a2f4c3fad76d03e',
      },
    ])
  })

  it('fails on the divider order alone', () => {
    expect(compareDigests(digest(), digest({ separatorOrder: 'moved' })))
      .toEqual([{ what: 'divider order', expected: '4e2af9aaa828e7fe2e8f38c22f7a0427', actual: 'moved' }])
  })

  it('fails when a row is missing', () => {
    const short = digest({ counts: { ...digest().counts, books: 235 } })
    expect(compareDigests(digest(), short)).toContainEqual({
      what: 'books rows', expected: '236', actual: '235',
    })
  })

  /**
   * The counts can match while the content does not: a value that came back as
   * a string rather than a number renders identically and sorts differently.
   */
  it('fails when the rows are the same shape and different content', () => {
    const changed = digest({ digests: { ...digest().digests, captures: 'zzz' } })
    expect(compareDigests(digest(), changed)).toEqual([
      { what: 'captures content', expected: 'ccc', actual: 'zzz' },
    ])
  })

  it('fails when the restore landed under a different collation', () => {
    expect(compareDigests(digest(), digest({ collation: 'C' })))
      .toContainEqual({ what: 'collation', expected: 'en_US.utf8', actual: 'C' })
  })

  /**
   * Not compared, on purpose. A real recovery may well restore onto a newer
   * server than the one that died, and failing that would turn the verification
   * into a reason not to upgrade.
   */
  it('does not fail on the server version', () => {
    expect(compareDigests(digest(), digest({ serverVersionNum: 190001 }))).toEqual([])
  })

  it('reports every table it looks at, not just the first difference', () => {
    const wrecked = digest({
      counts: { books: 0, book_authors: 0, captures: 0, separators: 0, author_filing: 0, shelf_ranges: 0 },
      digests: {},
      shelfOrder: null,
      separatorOrder: null,
    })
    // Six counts, six content digests, the shelf order and the divider order.
    expect(compareDigests(digest(), wrecked)).toHaveLength(14)
  })
})

describe('naming a dump', () => {
  it('names it for the instant it was taken, in UTC', () => {
    expect(dumpFileName(new Date('2026-08-06T22:28:02.512Z')))
      .toBe('bookscan-20260806T222802Z.dump')
  })

  it('reads the instant back out of the name', () => {
    expect(dumpTimestamp('bookscan-20260806T222802Z.dump')?.toISOString())
      .toBe('2026-08-06T22:28:02.000Z')
  })

  /**
   * Retention only ever deletes files it can date from the name, so anything
   * else in the directory is left alone. A half-written `.part` from an
   * interrupted run is the case that matters: it must not be counted as a dump
   * and must not be restored from.
   */
  it('does not recognise anything it did not write', () => {
    for (const name of [
      'bookscan-20260806T222802Z.dump.part',
      'bookscan-20260806T222802Z.json',
      'books.db',
      'bookscan-2026-08-06.dump',
      'bookscan-20261306T222802Z.dump',
    ]) {
      expect(dumpTimestamp(name), name).toBeUndefined()
    }
  })

  it('puts the manifest beside the dump', () => {
    expect(manifestFileName('bookscan-20260806T222802Z.dump'))
      .toBe('bookscan-20260806T222802Z.json')
  })
})

describe('retention', () => {
  const file = (day: number, bytes = 30_000): DumpFile => ({
    name: `bookscan-202608${String(day).padStart(2, '0')}T030000Z.dump`,
    bytes,
    takenAt: new Date(`2026-08-${String(day).padStart(2, '0')}T03:00:00Z`),
  })

  it('keeps the newest and removes the rest by count', () => {
    const plan = planRetention([file(1), file(2), file(3), file(4)], { keep: 2, maxBytes: 1e9 })
    expect(plan.kept.map((f) => f.name)).toEqual([file(4).name, file(3).name])
    expect(plan.removed.map((f) => f.name)).toEqual([file(1).name, file(2).name])
    expect(plan.removed.every((f) => f.because === 'count')).toBe(true)
  })

  it('does not care what order the directory listed them in', () => {
    const plan = planRetention([file(3), file(1), file(4), file(2)], { keep: 2, maxBytes: 1e9 })
    expect(plan.kept.map((f) => f.name)).toEqual([file(4).name, file(3).name])
  })

  /**
   * The bound that matters on this machine, where free disk has twice gone
   * under 2 GB in a day. The count limit alone is not a bound: a catalogue that
   * grows makes fourteen dumps mean fourteen times a number nobody is watching.
   */
  it('removes by size once the count limit is satisfied', () => {
    const plan = planRetention(
      [file(1, 400), file(2, 400), file(3, 400), file(4, 400)],
      { keep: 10, maxBytes: 1000 },
    )
    expect(plan.kept.map((f) => f.name)).toEqual([file(4).name, file(3).name])
    expect(plan.removed.map((f) => f.because)).toEqual(['size', 'size'])
  })

  /**
   * Deleting the only copy of the catalogue to satisfy a disk budget would be a
   * worse outcome than every outcome the disk budget exists to prevent. The
   * caller reports the overrun instead.
   */
  it('never deletes the last dump, however large it is', () => {
    const plan = planRetention([file(1, 10_000_000)], { keep: 14, maxBytes: 1000 })
    expect(plan.kept).toHaveLength(1)
    expect(plan.removed).toEqual([])
  })

  it('keeps at least one even when told to keep none', () => {
    const plan = planRetention([file(1), file(2)], { keep: 0, maxBytes: 1e9 })
    expect(plan.kept.map((f) => f.name)).toEqual([file(2).name])
  })
})

describe('reaching the host from inside a container', () => {
  /**
   * pg_dump runs in a container here because the client tools are not installed
   * on the machine, and a container cannot reach 127.0.0.1 on the host. Getting
   * this wrong produces a connection refused once a day at 03:30 and nowhere
   * else.
   */
  it('rewrites a loopback host', () => {
    expect(containerConnection('postgres://postgres:secret@127.0.0.1:5433/bookscan').url)
      .toBe('postgres://postgres@host.docker.internal:5433/bookscan')
  })

  it('leaves a real host alone', () => {
    expect(containerConnection('postgres://postgres:secret@db.example:5432/bookscan').url)
      .toBe('postgres://postgres@db.example:5432/bookscan')
  })

  /**
   * The password comes back separately because the URL goes into a `docker run`
   * argument list, which anything with a process listing can read. It is passed
   * through the environment by name instead.
   */
  it('keeps the password out of the url', () => {
    const { url, password } = containerConnection('postgres://postgres:s3cr3t@127.0.0.1:5433/bookscan')
    expect(url).not.toContain('s3cr3t')
    expect(password).toBe('s3cr3t')
  })

  it('reads the ADO.NET keyword form Aspire hands out', () => {
    const { url, password } = containerConnection(
      'Host=localhost;Port=65156;Username=postgres;Password=-sSjngFS4p9gcuDZJPMHFV;Database=bookscan',
    )
    expect(url).toBe('postgres://postgres@host.docker.internal:65156/bookscan')
    expect(password).toBe('-sSjngFS4p9gcuDZJPMHFV')
  })

  it('never puts credentials in what it logs', () => {
    expect(describeSource('postgres://postgres:s3cr3t@127.0.0.1:5433/bookscan'))
      .toBe('127.0.0.1:5433/bookscan')
  })
})

describe('the client has to be new enough for the server', () => {
  it('reads the major out of an image tag', () => {
    expect(imageMajor('postgres:18.3')).toBe(18)
    expect(imageMajor('postgres:17')).toBe(17)
    expect(imageMajor('postgres:latest')).toBeUndefined()
  })

  it('reads the major out of server_version_num', () => {
    expect(serverMajor(180003)).toBe(18)
    expect(serverMajor(170006)).toBe(17)
  })
})

describe('the command line', () => {
  /**
   * The rule AGENTS.md states for every tool here. A connection string sitting
   * in a shell must not be able to decide which catalogue a scheduled job
   * touches, so the two variables that name the live catalogue are not read.
   */
  it('does not read the connection the running app reads', () => {
    const previous = process.env.ConnectionStrings__bookscan
    process.env.ConnectionStrings__bookscan = 'postgres://postgres:live@127.0.0.1:5433/bookscan'
    try {
      const options = parseArgs([])
      expect('error' in options ? '' : options.source).toBe('')
    } finally {
      if (previous === undefined) delete process.env.ConnectionStrings__bookscan
      else process.env.ConnectionStrings__bookscan = previous
    }
  })

  it('defaults retention to a bound rather than to unlimited', () => {
    const options = parseArgs([])
    if ('error' in options) throw new Error(options.error)
    expect(options.keep).toBe(14)
    expect(options.maxBytes).toBe(512 * 1024 * 1024)
    expect(options.minFreeBytes).toBe(1024 * 1024 * 1024)
  })

  it('refuses a retention count that is not a number', () => {
    expect(parseArgs(['--keep', 'lots'])).toEqual({ error: '--keep needs a positive number' })
  })

  it('refuses an argument it does not know', () => {
    expect(parseArgs(['--delete-everything'])).toEqual({
      error: 'Unrecognised argument: --delete-everything',
    })
  })

  it('refuses a value flag with nothing after it', () => {
    expect(parseArgs(['--source'])).toEqual({ error: '--source needs a value' })
  })
})

describe('bytes for a human', () => {
  it('reads the way a person would say it', () => {
    expect(humanBytes(512)).toBe('512 B')
    expect(humanBytes(28_722)).toBe('28 KiB')
    expect(humanBytes(1024 * 1024 * 1.5)).toBe('1.5 MiB')
  })
})

/**
 * The half of the backup that is a property of the server rather than of this
 * code: what `readDigest` actually reads out of a real Postgres.
 *
 * Postgres-only, and not because of an accident of where the code lives. The
 * catalogue being backed up is Postgres, `md5(string_agg(... order by ...))`
 * has no SQLite spelling that means the same thing, and the failure this exists
 * to catch is a collation failure, which SQLite cannot have: it compares text
 * byte by byte with no exceptions.
 *
 * The last test here is the one that matters. It is the manual proof from the
 * pull request that added this file, turned into something that runs on every
 * change: a catalogue whose rows are byte for byte identical and whose shelf
 * order is wrong, which every row count and every content digest calls fine.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import { compareDigests, readDigest, type Queryable } from './backup'
import type { Db } from './driver'

let db: Db
let ask: Queryable

beforeEach(async () => {
  db = await openTestDatabase()
  // `readDigest` takes anything that can be asked a question, so a pg.Client, a
  // pg.Pool and the app's own Db all fit. The tool hands it the client holding
  // the transaction the dump's snapshot was exported from.
  ask = { query: async (sql: string) => ({ rows: await db.all<Record<string, unknown>>(sql) }) }
})

afterAll(closeTestDatabase)

/**
 * Sort keys chosen so byte order and a linguistic collation disagree.
 *
 * `Banana` sorts before `apple` byte by byte, because `B` is 0x42 and `a` is
 * 0x61, and after it under en_US.utf8, which folds case on the first pass.
 * `O'BRIEN` and `OBRIEN` are the other half of the same problem: a linguistic
 * collation treats the apostrophe as ignorable and byte order does not.
 */
const KEYS = ['apple', 'Banana', "O'BRIEN", 'OBRIEN', 'Cherry', 'date']

async function addBooks(keys: readonly string[] = KEYS): Promise<void> {
  for (const [index, key] of keys.entries()) {
    await db.run(
      `INSERT INTO books (title, shelf_range, is_fiction, sort_key, author_filing, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`Title ${index}`, 'fiction', 1, key, key, '2026-08-06T00:00:00Z'],
    )
  }
}

describe('reading a catalogue digest', () => {
  it('counts every table the catalogue lives in', async () => {
    await addBooks()
    await db.run(
      'INSERT INTO separators (shelf_range, kind, starts_at, position, created_at) VALUES (?,?,?,?,?)',
      ['fiction', 'shelf', 'Banana', 0, '2026-08-06T00:00:00Z'],
    )

    const digest = await readDigest(ask)
    expect(digest.counts).toMatchObject({
      books: KEYS.length,
      separators: 1,
      captures: 0,
      book_authors: 0,
      author_filing: 0,
      // Seeded by applySchema, and the owner edits it, so it is backed up too.
      shelf_ranges: 2,
    })
  })

  it('reads the collation and encoding back out of the catalogue', async () => {
    const digest = await readDigest(ask)
    expect(digest.encoding).toBe('UTF8')
    expect(digest.collation).not.toBe('')
    expect(digest.serverVersionNum).toBeGreaterThan(150000)
  })

  it('hands back no hash rather than a hash of nothing when the shelf is empty', async () => {
    const digest = await readDigest(ask)
    expect(digest.counts.books).toBe(0)
    expect(digest.shelfOrder).toBeNull()
    expect(digest.separatorOrder).toBeNull()
  })

  /**
   * The content digest is a digest of the set of rows, so a restore that
   * inserted the same rows in a different physical order is not a difference.
   * Without this it would report a failure on every restore, which is the same
   * as reporting none.
   */
  it('does not change when the same rows arrive in a different order', async () => {
    await addBooks()
    const forwards = await readDigest(ask)

    await db.run('TRUNCATE books RESTART IDENTITY CASCADE')
    await addBooks([...KEYS].reverse())
    const backwards = await readDigest(ask)

    // The ids moved with the insertion order, so the shelf order hash is
    // entitled to differ. The rows themselves are a different set for the same
    // reason, so what is asserted is the count and the shape, not the digest.
    expect(backwards.counts.books).toBe(forwards.counts.books)
    expect(backwards.shelfOrder).not.toBeNull()
  })

  it('changes the shelf order hash when a book moves on the shelf', async () => {
    await addBooks()
    const before = await readDigest(ask)

    await db.run("UPDATE books SET sort_key = ? WHERE sort_key = ?", ['zzz', 'apple'])
    const after = await readDigest(ask)

    expect(after.counts.books).toBe(before.counts.books)
    expect(after.shelfOrder).not.toBe(before.shelfOrder)
  })

  /**
   * The whole reason the shelf order is hashed at all.
   *
   * `COLLATE "C"` is dropped from `books.sort_key`, which is exactly what a
   * restore onto a server built differently, or a schema change nobody noticed,
   * would do. Not one byte of one row changes: every count matches, every
   * content digest matches, and the books come back in a different order.
   *
   * A backup check that compared only counts would call this restore good, and
   * the app would then tell somebody to put a book in the wrong place.
   */
  it('catches a lost COLLATE "C" that every row count calls fine', async () => {
    await addBooks()
    const correct = await readDigest(ask)

    /*
     * All three views read this column, and Postgres will not change the type
     * of a column a view depends on. That is a small guard in its own right and
     * it arrived with #183 rather than being asked for: the collation the whole
     * shelf rests on cannot be altered out from under a view by accident, and
     * there are three of them to get past now rather than one.
     *
     * They are in the way of damaging the column on purpose, so each is taken
     * off and put back from its own definition rather than from a copy written
     * here, which would be a second place to keep three predicates in step.
     */
    const views = await Promise.all(
      ['shelved_books', 'queued_books', 'catalogued_books'].map(async (name) => ({
        name,
        definition: (await db.get<{ definition: string }>(
          `SELECT pg_get_viewdef('${name}'::regclass, true) AS definition`,
        ))!.definition,
      })),
    )
    for (const view of views) await db.run(`DROP VIEW ${view.name}`)

    await db.run('ALTER TABLE books ALTER COLUMN sort_key TYPE text COLLATE "en_US.utf8"')
    try {
      const damaged = await readDigest(ask)

      expect(damaged.counts).toEqual(correct.counts)
      expect(damaged.digests).toEqual(correct.digests)
      expect(damaged.shelfOrder).not.toBe(correct.shelfOrder)

      expect(compareDigests(correct, damaged)).toEqual([
        { what: 'shelf order', expected: correct.shelfOrder, actual: damaged.shelfOrder },
      ])
    } finally {
      // The database is shared by the tests in this file, so it goes back the
      // way it was found. Leaving it damaged would make whichever test ran next
      // fail for a reason that has nothing to do with it.
      await db.run('ALTER TABLE books ALTER COLUMN sort_key TYPE text COLLATE "C"')
      for (const view of views) {
        await db.run(`CREATE VIEW ${view.name} AS ${view.definition}`)
      }
    }
  })

  /**
   * `separators.starts_at` is the other `COLLATE "C"` column. An ordering
   * difference too small to change the book list can still be large enough to
   * move one book past a divider, and this is the only line that would show it.
   */
  it('catches the same thing on the dividers', async () => {
    for (const [index, key] of KEYS.entries()) {
      await db.run(
        'INSERT INTO separators (shelf_range, kind, starts_at, position, created_at) VALUES (?,?,?,?,?)',
        ['fiction', 'shelf', key, index, '2026-08-06T00:00:00Z'],
      )
    }
    const correct = await readDigest(ask)

    await db.run('ALTER TABLE separators ALTER COLUMN starts_at TYPE text COLLATE "en_US.utf8"')
    try {
      const damaged = await readDigest(ask)
      expect(damaged.counts).toEqual(correct.counts)
      expect(compareDigests(correct, damaged)).toEqual([
        { what: 'divider order', expected: correct.separatorOrder, actual: damaged.separatorOrder },
      ])
    } finally {
      await db.run('ALTER TABLE separators ALTER COLUMN starts_at TYPE text COLLATE "C"')
    }
  })

  /**
   * The digest is sensitive to type as well as to value: a number that came
   * back as a string renders identically on a page and sorts differently. This
   * is the failure the stage H verification was built around, so it is checked
   * here too rather than assumed to carry over.
   */
  it('changes the content digest when a value changes without moving a row', async () => {
    await addBooks()
    const before = await readDigest(ask)

    await db.run("UPDATE books SET notes = ? WHERE sort_key = ?", ['changed', 'Cherry'])
    const after = await readDigest(ask)

    expect(after.counts.books).toBe(before.counts.books)
    expect(after.shelfOrder).toBe(before.shelfOrder)
    expect(after.digests.books).not.toBe(before.digests.books)
    expect(compareDigests(before, after)).toEqual([
      { what: 'books content', expected: before.digests.books, actual: after.digests.books },
    ])
  })
})

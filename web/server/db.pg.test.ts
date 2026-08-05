/**
 * The things that are only true of Postgres, and that no SQLite test can say
 * anything about.
 *
 * The four store-level test files carry the weight of stage F: they run
 * unchanged against both databases, so anything the migration broke shows up
 * as one of the assertions that already guarded SQLite. What is left is what
 * those files cannot see, and all of it is a silent failure rather than a loud
 * one:
 *
 *   - the collation, which reorders a shelf without erroring
 *   - a transaction that is not pinned to one connection, which Postgres
 *     accepts and which passes on a quiet machine
 *   - the parameters with nothing to take a type from, which stage E cast and
 *     could not check
 *   - the aggregates that come back as strings, which render identically
 *
 * Runs only in the `postgres` project. See vitest.config.ts.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import { SORT_KEY_COLUMNS } from './db.pg'
import type { Db } from './driver'
import { Store, type DraftBook } from './store'

let db: Db
let store: Store

beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db)
})

afterAll(closeTestDatabase)

// ---------------------------------------------------------------------------
// Collation. Risk 1 in docs/postgres-migration.md, and the biggest.
// ---------------------------------------------------------------------------

/**
 * The fixture from store.test.ts, "text ordering, which every shelf depends
 * on". Same books, deliberately: the sort keys these produce are the real
 * ones, built by the real `buildSortKey`, and they carry the `\x1f` that joins
 * a key's components and the `.` in a padded series index. Both are exactly
 * the sort of character a linguistic collation is entitled to ignore.
 */
const FIXTURE: DraftBook[] = [
  { title: 'Nana', authors: ['Émile Zola'], isFiction: true },
  { title: 'Alpha', authors: ['Ed Smithers'], isFiction: true },
  { title: 'Zenith', authors: ['Zoe Smith'], isFiction: true },
  { title: 'Beta', authors: ["Ann O'Brien"], isFiction: true },
  { title: 'The Alpha', authors: ["Ann O'Brien"], isFiction: true },
  { title: 'Chapter 10', authors: ['Ian McEwan'], isFiction: true },
  { title: 'Chapter 2', authors: ['Ian McEwan'], isFiction: true },
  { title: 'Flowers in the Attic', authors: ['V.C. Andrews'], isFiction: true },
]

const byBytes = (keys: string[]) =>
  [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

describe('collation, which the entire shelving order rests on', () => {
  it('is not running on a byte-order database, or the checks below prove nothing', async () => {
    // The guard on everything else in this file. A cluster created with a
    // `C` or `C.UTF-8` collation orders every column byte by byte whatever the
    // column says, so `COLLATE "C"` could be deleted from the schema and every
    // test here would stay green until a managed Postgres handed the app a
    // linguistic collation. testdb.ts creates its databases with `en_US.utf8`
    // for exactly this reason, and this is the assertion that it worked.
    const row = await db.get<{ datcollate: string }>(
      'SELECT datcollate FROM pg_database WHERE datname = current_database()',
    )
    expect(row).toBeDefined()
    expect(['C', 'C.UTF-8', 'POSIX']).not.toContain(row!.datcollate)
  })

  it('declares COLLATE "C" on every column a sort key is compared in', async () => {
    // Read out of the catalogue rather than out of the DDL string, so this
    // says what the database did and not what the file asked for.
    expect(SORT_KEY_COLUMNS).toHaveLength(4)

    for (const [table, column] of SORT_KEY_COLUMNS) {
      const found = await db.get<{ collname: string | null }>(
        `SELECT co.collname
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           LEFT JOIN pg_collation co ON co.oid = a.attcollation
          WHERE c.relname = ? AND a.attname = ? AND a.attnum > 0`,
        [table, column],
      )
      expect(found, `${table}.${column} is not declared`).toBeDefined()
      expect(found!.collname, `${table}.${column}`).toBe('C')
    }
  })

  it('returns the shelf in byte order, which is the order SQLite returns', async () => {
    for (const book of FIXTURE) await store.addBook(book)

    const keys = (await store.listRange('fiction')).map((row) => row.sort_key)
    expect(keys).toEqual(byBytes(keys))
  })

  it('orders these very keys differently without COLLATE "C", which is the point of it', async () => {
    // The confirmation the plan asks for: a test that has only ever passed
    // proves nothing, so here is the same fixture in a column that took the
    // database's own collation. If this ever stops finding a difference, the
    // database is not the one described above and the checks here are hollow.
    for (const book of FIXTURE) await store.addBook(book)
    const keys = (await store.listRange('fiction')).map((row) => row.sort_key)

    await db.run('DROP TABLE IF EXISTS ordering_control')
    await db.run('CREATE TABLE ordering_control (v text)')
    for (const key of keys) await db.run('INSERT INTO ordering_control (v) VALUES (?)', [key])

    const linguistic = (await db.all<{ v: string }>(
      'SELECT v FROM ordering_control ORDER BY v',
    )).map((row) => row.v)

    expect(linguistic).not.toEqual(byBytes(keys))

    // And specifically the pair the fixture was chosen for. A collation that
    // ignores the separator compares SMITHZOE against SMITHERSED and puts
    // Smithers first, which is a real book on a real shelf in the wrong place.
    const surname = (key: string) => key.split(String.fromCharCode(31))[0]!
    expect(linguistic.map(surname).indexOf('SMITHERS ED'))
      .toBeLessThan(linguistic.map(surname).indexOf('SMITH ZOE'))
    expect(byBytes(keys).map(surname).indexOf('SMITH ZOE'))
      .toBeLessThan(byBytes(keys).map(surname).indexOf('SMITHERS ED'))
  })

  it('seeks the same neighbours through < and > as it orders by', async () => {
    // Placement does not sort, it seeks either side of a key with two
    // inequalities. An index or a comparison under a different collation from
    // the ORDER BY would answer the two questions inconsistently, and only the
    // placement half is what tells somebody where to put the book.
    for (const book of FIXTURE) await store.addBook(book)

    const shelf = await store.listRange('fiction')
    const zenith = shelf.find((row) => row.title === 'Zenith')!
    const { predecessor, successor } = await store.neighbours('fiction', zenith.sort_key)

    const index = shelf.findIndex((row) => row.id === zenith.id)
    expect(predecessor?.id).toBe(shelf[index - 1]!.id)
    expect(successor?.id).toBe(shelf[index + 1]!.id)
    expect(successor?.title).toBe('Alpha') // Smithers, after Smith
  })
})

// ---------------------------------------------------------------------------
// Transactions, and the connection they are pinned to.
// ---------------------------------------------------------------------------

describe('a transaction is pinned to one connection', () => {
  const pid = async (handle: Db) =>
    (await handle.get<{ pid: number }>('SELECT pg_backend_pid() AS pid'))!.pid

  const names = async () =>
    (await db.all<{ display_key: string }>(
      'SELECT display_key FROM author_filing ORDER BY display_key',
    )).map((row) => row.display_key)

  const write = (handle: Db, key: string) =>
    handle.run('INSERT INTO author_filing (display_key, filing_name) VALUES (?, ?)', [key, key])

  it('runs every statement in the work on one backend, and not on the pool', async () => {
    // The direct measurement. A pool hands out whichever connection is free,
    // so an implementation that took one per statement would send BEGIN to one
    // backend and the INSERT to another. Postgres accepts all of it, the
    // rollback undoes nothing, and on a quiet machine the pool hands back the
    // same idle connection every time and nothing ever notices.
    const inside: number[] = []
    let begun = () => {}
    const hasBegun = new Promise<void>((resolve) => { begun = resolve })
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })

    const open = db.tx(async (tx) => {
      inside.push(await pid(tx))
      // Through the handle the class holds, not the one tx was given.
      // Shelves.moveAcrossBoundary does exactly this.
      inside.push(await pid(db))
      begun()
      await held
      inside.push(await pid(tx))
    })

    // Measured from this test's async context rather than from inside the
    // work, which is the difference that matters. Anything scheduled inside the
    // work, a setImmediate or a promise chain, inherits the AsyncLocalStorage
    // and so belongs to the transaction, correctly: it is the transaction's own
    // continuation. An unrelated request is one that never entered it.
    await hasBegun
    const outside = await pid(db)
    release()
    await open

    expect(new Set(inside).size, `three statements, backends ${inside.join(', ')}`).toBe(1)
    expect(outside, 'an unrelated statement took the transaction\'s connection')
      .not.toBe(inside[0])
  })

  it('rolls its own writes back and leaves an unrelated one alone', async () => {
    // The same fact without reading a pid, and the reason the pid matters. An
    // unpinned insert would be its own autocommitted transaction on another
    // connection, so it would survive this rollback.
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })

    const rolled = db.tx(async (tx) => {
      await write(tx, 'doomed')
      await held
      throw new Error('rolled back')
    })
    const unrelated = write(db, 'unrelated')

    release()
    await expect(rolled).rejects.toThrow('rolled back')
    await unrelated

    expect(await names()).toEqual(['unrelated'])
  })

  it('does not need SqliteDb\'s lock: the unrelated statement does not wait', async () => {
    // The behaviour that is genuinely different, and the reason for moving.
    // SqliteDb has one connection, so everything queues behind an open
    // transaction. Here the outside write completes while the transaction is
    // still open, which is what "accepts concurrent connections" buys.
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    let outsideFinished = false

    const open = db.tx(async (tx) => {
      await write(tx, 'inside')
      await held
    })
    await write(db, 'outside').then(() => { outsideFinished = true })

    expect(outsideFinished).toBe(true)
    release()
    await open
    expect(await names()).toEqual(['inside', 'outside'])
  })

  it('commits what the work did', async () => {
    await db.tx(async (tx) => { await write(tx, 'a') })
    expect(await names()).toEqual(['a'])
  })

  it('rolls back only the inner transaction when the inner one fails', async () => {
    await db.tx(async (tx) => {
      await write(tx, 'outer')
      await expect(tx.tx(async (inner) => {
        await write(inner, 'inner')
        throw new Error('inner failed')
      })).rejects.toThrow('inner failed')
    })
    expect(await names()).toEqual(['outer'])
  })

  it('rolls the inner one back with the outer one when the outer fails', async () => {
    await expect(db.tx(async (tx) => {
      await write(tx, 'outer')
      await tx.tx(async (inner) => { await write(inner, 'inner') })
      throw new Error('outer failed')
    })).rejects.toThrow('outer failed')
    expect(await names()).toEqual([])
  })

  it('nests through the handle the store holds, not only the one it was handed', async () => {
    // Shelves.moveAcrossBoundary opens a transaction and calls `remove`, which
    // opens one of its own against `this.db`. A nested BEGIN would be a warning
    // and a no-op here, so the inner rollback would take the outer one's work.
    await db.tx(async () => {
      await write(db, 'outer')
      await db.tx(async () => { await write(db, 'inner') })
    })
    expect(await names()).toEqual(['inner', 'outer'])
  })

  it('does not nest one caller\'s transaction inside another\'s', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })

    const first = db.tx(async (tx) => {
      await write(tx, 'first')
      await held
      throw new Error('first failed')
    })
    const second = db.tx(async (tx) => { await write(tx, 'second') })

    release()
    await expect(first).rejects.toThrow('first failed')
    await second

    expect(await names()).toEqual(['second'])
  })

  it('gives the connection back whether the work commits or throws', async () => {
    // A leak here costs the process one of ten. Twenty transactions, half of
    // them failing, and the twenty-first still runs.
    for (let i = 0; i < 20; i += 1) {
      if (i % 2 === 0) {
        await db.tx(async (tx) => { await write(tx, `k${i}`) })
      } else {
        await expect(db.tx(async (tx) => {
          await write(tx, `k${i}`)
          throw new Error('no')
        })).rejects.toThrow('no')
      }
    }
    expect(await names()).toHaveLength(10)
  })
})

// ---------------------------------------------------------------------------
// The parameters stage E cast and could not check, and the aggregates.
// ---------------------------------------------------------------------------

describe('the parameters with nothing to take a type from', () => {
  /**
   * All four statements as the stores spell them, plus the fifth shape stage E
   * deliberately left alone. Every one of these is a candidate for
   * "could not determine data type of parameter", and none of them could be
   * checked before this stage because there was no Postgres to check against.
   *
   * The stores run these through the parameterised suite as well. They are
   * repeated here so a failure names the statement rather than the feature.
   */
  it('Store.updateBook: NULLIF(CAST(@location AS TEXT), \'\')', async () => {
    const { id } = await store.addBook({ title: 'A', authors: ['Ann Author'], isFiction: true })
    await expect(db.run(
      "UPDATE books SET location = COALESCE(NULLIF(CAST(@location AS TEXT), ''), location) WHERE id = @id",
      { location: '', id },
    )).resolves.toEqual({ changes: 1 })
  })

  it('Store.missingCovers: CAST(:retry AS INTEGER) = 1, and a bare LIMIT parameter', async () => {
    await expect(store.missingCovers(5, false)).resolves.toEqual([])
    await expect(store.missingCovers(5, true)).resolves.toEqual([])
  })

  it('CaptureQueue.edit: CAST(@resolved AS INTEGER) = 1 inside a CASE', async () => {
    await db.run(
      "INSERT INTO captures (status, created_at) VALUES ('ready', ?)",
      [new Date().toISOString()],
    )
    await expect(db.run(
      `UPDATE captures SET
         status = CASE
           WHEN status IN ('ready', 'failed') AND CAST(@resolved AS INTEGER) = 1
             THEN 'ready'
           ELSE status
         END
       WHERE id = @id`,
      { resolved: 1, id: 1 },
    )).resolves.toEqual({ changes: 1 })
  })

  it("CaptureQueue.process, the settle: CAST(@statedTitle AS TEXT) != ''", async () => {
    await db.run(
      "INSERT INTO captures (status, created_at) VALUES ('pending', ?)",
      [new Date().toISOString()],
    )
    await expect(db.run(
      `UPDATE captures
          SET status = CASE
            WHEN isbn13 != '' OR CAST(@statedTitle AS TEXT) != '' THEN 'ready'
            ELSE 'failed'
          END
        WHERE id = @id AND status = 'pending'`,
      { statedTitle: '', id: 1 },
    )).resolves.toEqual({ changes: 1 })
  })

  it("CaptureQueue.attach: a parameter concatenated with two string literals", async () => {
    // The shape stage E refused to guess at: `',' || @slot || ','` is a
    // parameter between two literals, all three of them untyped. Postgres
    // resolves an operator whose inputs are all unknown as text, so this runs
    // as written and the statement was left as it was.
    await db.run(
      "INSERT INTO captures (status, analysed, created_at) VALUES ('pending', 'back,front', ?)",
      [new Date().toISOString()],
    )
    await expect(db.run(
      `UPDATE captures
          SET analysed = REPLACE(REPLACE(',' || analysed || ',', ',' || @slot || ',', ','), ',,', ',')
        WHERE id = @id`,
      { slot: 'front', id: 1 },
    )).resolves.toEqual({ changes: 1 })

    const row = await db.get<{ analysed: string }>('SELECT analysed FROM captures WHERE id = ?', [1])
    expect(row!.analysed).toBe(',back,')
  })
})

describe('aggregates, which come back as strings without a cast', () => {
  it('hands back numbers from the statements the stores actually run', async () => {
    await store.addBook({ title: 'A', authors: ['Ann Author'], isFiction: true })
    const counts = await store.counts()

    expect(counts).toEqual({ total: 1, fiction: 1, nonfiction: 0, checkedOut: 0 })
    for (const [name, value] of Object.entries(counts)) {
      expect(typeof value, name).toBe('number')
    }
  })

  it('hands back a string without the cast, which is why the cast is there', async () => {
    // Not hypothetical and not cosmetic. COUNT returns bigint, node-postgres
    // will not narrow a bigint to a JavaScript number because it does not fit,
    // and /api/health and every save response carry these. A total of "57"
    // renders identically and fails every piece of arithmetic downstream.
    await store.addBook({ title: 'A', authors: ['Ann Author'], isFiction: true })
    const row = await db.get<{ n: unknown }>('SELECT COUNT(*) AS n FROM books')

    expect(typeof row!.n).toBe('string')
  })
})

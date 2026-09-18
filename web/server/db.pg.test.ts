// Runs only in the `postgres` project. See vitest.config.ts.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import { connectionConfig, describeConnection, SORT_KEY_COLUMNS } from './db.pg'
import { lockKey, type Db, type TxOptions } from './driver'
import { Store, type DraftBook } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'

let db: Db
let store: Store

beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
})

afterAll(closeTestDatabase)

describe('reading the connection Aspire hands over', () => {
  /**
   * A connection string as Aspire actually produces it: ADO.NET keyword form,
   * not a URL. node-postgres reads only the URL form and would have taken
   * this entire string as a hostname.
   */
  const FROM_ASPIRE =
    'Host=localhost;Port=65156;Username=postgres;Password=-sSjngFS4p9gcuDZJPMHFV;Database=bookscan'

  it('reads the keyword form Aspire actually produces', () => {
    expect(connectionConfig(FROM_ASPIRE)).toEqual({
      host: 'localhost',
      port: 65156,
      user: 'postgres',
      password: '-sSjngFS4p9gcuDZJPMHFV',
      database: 'bookscan',
    })
  })

  it('passes a URL through, which is what the test harness and a hand-written one are', () => {
    const url = 'postgres://someone:secret@db.example:5433/bookscan'
    expect(connectionConfig(url)).toEqual({ connectionString: url })
  })

  it('takes a quoted value, which is how a password with a separator is spelled', () => {
    // Splitting on ';' first truncates this password at the separator, which
    // arrives as an authentication failure saying nothing about the cut.
    const parsed = connectionConfig("Host=h;Password='a;b';Database=d")
    expect(parsed.password).toBe('a;b')
    expect(parsed.database).toBe('d')
    // Doubling escapes the delimiter that opened the value, and only that one.
    expect(connectionConfig("Host=h;Password='it''s';Database=d").password).toBe("it's")
    expect(connectionConfig(`Host=h;Password="it''s";Database=d`).password).toBe("it''s")
  })

  it('describes a connection without its credentials, because this reaches /api/health', () => {
    expect(describeConnection(FROM_ASPIRE)).toBe('postgres localhost:65156/bookscan')
    expect(describeConnection(FROM_ASPIRE)).not.toContain('sSjngFS4p9gcuDZJPMHFV')

    const described = describeConnection('postgres://someone:secret@db.example:5433/bookscan')
    expect(described).toBe('postgres db.example:5433/bookscan')
    expect(described).not.toContain('secret')
  })
})

/**
 * The fixture from store.test.ts, "text ordering, which every shelf depends
 * on". Same books, deliberately: the sort keys these produce are the real
 * ones, built by the real `buildSortKey`, and they carry the `\x1f` that joins
 * a key's components and the `.` in a padded series index. Both are exactly
 * the sort of character a linguistic collation is entitled to ignore.
 */
const FIXTURE: DraftBook[] = [
  { title: 'Nana', authors: ['Émile Zola'], genre: FICTION_SLUG },
  { title: 'Alpha', authors: ['Ed Smithers'], genre: FICTION_SLUG },
  { title: 'Zenith', authors: ['Zoe Smith'], genre: FICTION_SLUG },
  { title: 'Beta', authors: ["Ann O'Brien"], genre: FICTION_SLUG },
  { title: 'The Alpha', authors: ["Ann O'Brien"], genre: FICTION_SLUG },
  { title: 'Chapter 10', authors: ['Ian McEwan'], genre: FICTION_SLUG },
  { title: 'Chapter 2', authors: ['Ian McEwan'], genre: FICTION_SLUG },
  { title: 'Flowers in the Attic', authors: ['V.C. Andrews'], genre: FICTION_SLUG },
]

const byBytes = (keys: string[]) =>
  [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

describe('collation, which the entire shelving order rests on', () => {
  it('is not running on a byte-order database, or the checks below prove nothing', async () => {
    // The guard on everything else in this file: without a linguistic
    // collation, `COLLATE "C"` could be deleted from the schema and every
    // test here would stay green. testdb.ts creates its databases with
    // `en_US.utf8` for exactly this reason.
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
    // A negative control: the same fixture read through the database's own
    // collation. If this ever stops finding a difference, the database is not
    // the one described above and the checks here are hollow.
    for (const book of FIXTURE) await store.addBook(book)
    const keys = (await store.listRange('fiction')).map((row) => row.sort_key)

    await db.run('DROP TABLE IF EXISTS ordering_control')
    await db.run('CREATE TABLE ordering_control (v text)')
    for (const key of keys) await db.run('INSERT INTO ordering_control (v) VALUES (?)', [key])

    const linguistic = (await db.all<{ v: string }>(
      'SELECT v FROM ordering_control ORDER BY v',
    )).map((row) => row.v)

    expect(linguistic).not.toEqual(byBytes(keys))

    // The pair the fixture was chosen for: a collation that ignores the
    // separator compares SMITHZOE against SMITHERSED and puts Smithers first,
    // a real book on the wrong shelf position.
    const surname = (key: string) => key.split(String.fromCharCode(31))[0]!
    expect(linguistic.map(surname).indexOf('SMITHERS ED'))
      .toBeLessThan(linguistic.map(surname).indexOf('SMITH ZOE'))
    expect(byBytes(keys).map(surname).indexOf('SMITH ZOE'))
      .toBeLessThan(byBytes(keys).map(surname).indexOf('SMITHERS ED'))
  })

  it('decides which books are past an area anchor by bytes, which is where a plank begins', async () => {
    /*
     * A plank is every book from its anchor to the next one. Under a
     * linguistic collation the comparison below does not fail outright: it
     * answers with one book too many, a real book drawn on the wrong plank of
     * a diagram somebody is holding.
     */
    for (const book of FIXTURE) await store.addBook(book)
    const keys = (await store.listRange('fiction')).map((row) => row.sort_key)
    const anchor = keys.find((key) => key.startsWith('SMITHERS ED'))!

    // A fixture cannot hold two areas at one position, so this uses positions
    // 0 and 1 of a bookcase built for the test.
    const fixture = await db.get<{ id: number }>(
      `INSERT INTO fixture (collection_id, kind, name, position, sort_strategy, note)
       SELECT id, 'bookshelf', '', 9002, 'inherit', '' FROM collection ORDER BY id LIMIT 1
       RETURNING id`,
    )
    expect(fixture, 'no collection to hang a bookcase off').toBeDefined()
    await db.run(
      `INSERT INTO area (fixture_id, position, name, starts_at, sort_strategy, note)
       VALUES (?, 0, '', '', 'inherit', ''), (?, 1, '', ?, 'inherit', '')`,
      [fixture!.id, fixture!.id, anchor],
    )

    // Compared twice: once as the columns declare themselves (no collation
    // named, on purpose, so a column that lost COLLATE "C" shows up here too)
    // and once forcing the database's own collation.
    const pastTheAnchor = async (collation = '') => (await db.all<{ sort_key: string }>(
      `SELECT b.sort_key FROM shelved_books b
         JOIN area a ON a.fixture_id = ? AND a.position = 1
        WHERE b.sort_key ${collation} >= a.starts_at ${collation}
        ORDER BY b.sort_key`,
      [fixture!.id],
    )).map((row) => row.sort_key)

    const byteOrder = await pastTheAnchor()
    expect(byteOrder).toEqual(byBytes(keys).filter((key) => key >= anchor))

    const linguistic = await pastTheAnchor('COLLATE "default"')
    expect(linguistic).not.toEqual(byteOrder)

    // Smith, Zoe files before Smithers, Ed by bytes, but after her under a
    // collation that ignores the separator.
    const smithZoe = (found: string[]) => found.some((key) => key.startsWith('SMITH ZOE'))
    expect(smithZoe(byteOrder)).toBe(false)
    expect(smithZoe(linguistic)).toBe(true)
  })

  it('seeks the same neighbours through < and > as it orders by', async () => {
    // Placement seeks either side of a key with two inequalities rather than
    // sorting; a comparison under a different collation from the ORDER BY
    // would answer the two questions inconsistently.
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
    // A pool hands out whichever connection is free, so an implementation
    // that took one connection per statement would send BEGIN to one backend
    // and the INSERT to another; Postgres accepts it silently, and a quiet
    // machine might hand back the same idle connection every time.
    const inside: number[] = []
    let begun = () => {}
    const hasBegun = new Promise<void>((resolve) => { begun = resolve })
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })

    const open = db.tx(async (tx) => {
      inside.push(await pid(tx))
      // Through the handle the class holds, not the one tx was given, as
      // Shelves.moveAcrossBoundary does.
      inside.push(await pid(db))
      begun()
      await held
      inside.push(await pid(tx))
    })

    // Measured from this test's own async context, not from inside the work:
    // anything scheduled inside the work inherits the AsyncLocalStorage and
    // belongs to the transaction, so only code that never entered it counts
    // as unrelated.
    await hasBegun
    const outside = await pid(db)
    release()
    await open

    expect(new Set(inside).size, `three statements, backends ${inside.join(', ')}`).toBe(1)
    expect(outside, 'an unrelated statement took the transaction\'s connection')
      .not.toBe(inside[0])
  })

  it('rolls its own writes back and leaves an unrelated one alone', async () => {
    // An unpinned insert would be its own autocommitted transaction on
    // another connection, so it would survive this rollback.
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
    // SqliteDb has one connection, so everything queues behind an open
    // transaction; here the outside write completes while the transaction is
    // still open.
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
    // A nested BEGIN is a warning and a no-op here, so the inner rollback
    // would take the outer one's work with it, as it would for
    // Shelves.moveAcrossBoundary calling remove against `this.db`.
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

describe('the parameters with nothing to take a type from', () => {
  /**
   * Each of these could fail with "could not determine data type of
   * parameter". Repeated here, on top of the parameterised suite, so a
   * failure names the statement rather than the feature.
   */
  it('writeBoundaries: an anchor compared with IS DISTINCT FROM an untyped parameter', async () => {
    // `recordAreasOf` writes an anchor only when it differs from the one
    // already there, so the parameter appears twice: once assigned to a
    // `text COLLATE "C"` column and once compared against it, and the
    // comparison is the half with nothing to take a type from.
    const fixture = await db.get<{ id: number }>(
      `INSERT INTO fixture (collection_id, kind, name, position, sort_strategy, note)
       SELECT id, 'bookshelf', '', 9001, 'inherit', '' FROM collection ORDER BY id LIMIT 1
       RETURNING id`,
    )
    const area = await db.get<{ id: number }>(
      `INSERT INTO area (fixture_id, position, name, starts_at, sort_strategy, note)
       VALUES (?, 0, '', '', 'inherit', '') RETURNING id`,
      [fixture!.id],
    )

    await expect(db.run(
      'UPDATE area SET starts_at = ? WHERE id = ? AND starts_at IS DISTINCT FROM ?',
      ['SMITH ZOE', area!.id, 'SMITH ZOE'],
    )).resolves.toEqual({ changes: 1 })
    // And nothing the second time, which is the point of the comparison.
    await expect(db.run(
      'UPDATE area SET starts_at = ? WHERE id = ? AND starts_at IS DISTINCT FROM ?',
      ['SMITH ZOE', area!.id, 'SMITH ZOE'],
    )).resolves.toEqual({ changes: 0 })
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
    // `',' || @slot || ','` concatenates a parameter between two literals,
    // all three untyped; Postgres resolves an operator whose inputs are all
    // unknown as text, so this runs as written.
    await db.run(
      "INSERT INTO captures (status, analysed, created_at) VALUES ('pending', 'back,front', ?)",
      [new Date().toISOString()],
    )
    await expect(db.run(
      `UPDATE captures
          SET analysed = TRIM(BOTH ',' FROM
            REPLACE(REPLACE(',' || analysed || ',', ',' || @slot || ',', ','), ',,', ','))
        WHERE id = @id`,
      { slot: 'front', id: 1 },
    )).resolves.toEqual({ changes: 1 })

    const row = await db.get<{ analysed: string }>('SELECT analysed FROM captures WHERE id = ?', [1])
    expect(row!.analysed).toBe('back')
  })
})

describe('aggregates, which come back as strings without a cast', () => {
  it('hands back numbers from the statements the stores actually run', async () => {
    await store.addBook({ title: 'A', authors: ['Ann Author'], genre: FICTION_SLUG })
    const counts = await store.counts()

    expect(counts).toEqual({ total: 1, fiction: 1, nonfiction: 0, checkedOut: 0 })
    for (const [name, value] of Object.entries(counts)) {
      expect(typeof value, name).toBe('number')
    }
  })

  it('hands back a string without the cast, which is why the cast is there', async () => {
    // COUNT returns bigint, and node-postgres will not narrow a bigint to a
    // JavaScript number because it does not fit. /api/health and every save
    // response carry these, and a total of "57" renders identically while
    // failing every piece of arithmetic downstream.
    await store.addBook({ title: 'A', authors: ['Ann Author'], genre: FICTION_SLUG })
    const row = await db.get<{ n: unknown }>('SELECT COUNT(*) AS n FROM books')

    expect(typeof row!.n).toBe('string')
  })
})

/**
 * A transaction alone does not serialise a read-then-write sequence on
 * Postgres: READ COMMITTED gives every statement its own snapshot, so a
 * SELECT and the INSERT decided from it can still have somebody else's row
 * appear between them. This is why `TxOptions.serialiseOn` exists. The first
 * test below is a negative control: without it, a suite where everything
 * happened to be serialised by something else would look like proof the lock
 * works.
 */
describe('serialising a transaction against another one', () => {
  /**
   * Not the bound the answer is decided by: the answer comes from one of two
   * observable facts below, whichever appears first. This is only how long
   * to wait before concluding neither will and failing loudly. Kept
   * comfortably under vitest's twenty second `testTimeout`, so this message
   * is what prints rather than "test timed out".
   */
  const NEITHER_FACT_YET_MS = 10_000

  /** How often to ask Postgres. Cheap: one indexless read of a small view. */
  const ASK_AGAIN_MS = 5

  const pause = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

  /**
   * Whether Postgres is holding a transaction back on an advisory lock.
   *
   * A backend blocked inside `pg_advisory_xact_lock` has a `pg_locks` row
   * with `granted` false, for exactly as long as the wait does; nothing here
   * is timed.
   *
   * Scoped to this file's own database, which `openTestDatabase` creates
   * fresh per test: `pg_locks` is cluster wide and this suite runs many
   * files against one server in parallel, so without the filter another
   * worker's lock would answer the question.
   */
  const blockedOnAnAdvisoryLock = async (): Promise<boolean> => {
    const row = await db.get<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory'
            AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
       ) AS waiting`,
    )
    return row!.waiting
  }

  /**
   * Ask until one of two exhaustive outcomes has happened: the transaction
   * ran, or it is queued behind a lock.
   *
   * `ran` is checked first on each pass, because a probe that acquired and
   * finished leaves no `pg_locks` row behind to find.
   */
  async function whicheverHappensFirst(ran: () => boolean): Promise<boolean> {
    const deadline = Date.now() + NEITHER_FACT_YET_MS
    while (Date.now() < deadline) {
      if (ran()) return true
      if (await blockedOnAnAdvisoryLock()) return false
      await pause(ASK_AGAIN_MS)
    }

    throw new Error(
      `Neither happened within ${NEITHER_FACT_YET_MS / 1000}s: the second ` +
      'transaction has not run, and Postgres reports nothing in this database ' +
      'waiting for an advisory lock. So it is being held up by something that ' +
      'is not the lock, and until that is understood nothing this describe ' +
      'block asserts means anything. Starving it of pool connections is the way ' +
      'that has happened before; see warmTheConnections. Note that starving it ' +
      'badly enough starves this probe too, and then the failure is vitest ' +
      'timing the test out rather than this message.',
    )
  }

  /**
   * Not a speed-up: a pool with one connection serialises everything by
   * starvation, so every test here would report the second transaction
   * waited regardless of the lock, and the whole file would pass while
   * proving nothing.
   */
  const warmTheConnections = () =>
    Promise.all([db.get('SELECT 1'), db.get('SELECT 1'), db.get('SELECT 1'), db.get('SELECT 1')])

  /**
   * Hold one transaction open, start another alongside it, and answer
   * whether the second got through while the first was still open.
   *
   * The first transaction is released in a `finally` regardless of what the
   * assertion did: a held transaction that outlives its test takes a
   * connection with it, and every test after this one then fails for a
   * reason that is not its own.
   */
  async function ranAlongside(
    holding: TxOptions | undefined,
    probing: TxOptions | undefined,
  ): Promise<boolean> {
    await warmTheConnections()

    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    let holdingNow = () => {}
    const inside = new Promise<void>((resolve) => { holdingNow = resolve })
    let through = false

    const first = db.tx(async () => { holdingNow(); await held }, holding)
    // An observable fact, not a wait: `tx` takes the lock as the first
    // statement inside BEGIN and only then runs the work, so a body that has
    // begun is a transaction already holding whatever it named.
    await inside

    const second = db.tx(async () => { through = true }, probing)
    try {
      return await whicheverHappensFirst(() => through)
    } finally {
      release()
      await Promise.allSettled([first, second])
    }
  }

  it('lets two transactions naming nothing overlap, which is the point of Postgres', async () => {
    expect(
      await ranAlongside(undefined, undefined),
      'an unlocked transaction waited for an unrelated one, so nothing below means anything',
    ).toBe(true)
  })

  it('makes a transaction naming the same string wait for the open one', async () => {
    expect(
      await ranAlongside({ serialiseOn: 'shelf:fiction' }, { serialiseOn: 'shelf:fiction' }),
      'both transactions held shelf:fiction at once',
    ).toBe(false)
  })

  it('does not make an unrelated name wait, so the two ranges stay independent', async () => {
    expect(
      await ranAlongside({ serialiseOn: 'shelf:fiction' }, { serialiseOn: 'shelf:nonfiction' }),
      'a nonfiction save waited for a fiction one',
    ).toBe(true)
  })

  it('does not make a plain read wait, which is what a range lock must not do', async () => {
    await warmTheConnections()

    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const first = db.tx(async () => { await held }, { serialiseOn: 'shelf:fiction' })
    try {
      await expect(db.all('SELECT 1 AS n')).resolves.toHaveLength(1)
    } finally {
      release()
      await first
    }
  })

  it('releases the lock when the transaction rolls back, not when the code says so', async () => {
    // This is why it is pg_advisory_xact_lock and not the session-scoped
    // spelling: a session lock outlives a crash on a pooled connection, so
    // the next request to get that connection would block forever on
    // something it never asked for.
    await expect(
      db.tx(async () => { throw new Error('no') }, { serialiseOn: 'shelf:fiction' }),
    ).rejects.toThrow('no')

    await expect(
      db.tx(async () => 'through', { serialiseOn: 'shelf:fiction' }),
    ).resolves.toBe('through')
  })

  it('lets a nested transaction re-take a lock its outer one already holds', async () => {
    // Advisory locks count per transaction rather than blocking, which is
    // what lets Shelves.moveAcrossBoundary call Shelves.remove, both naming
    // the same range, without deadlocking against itself.
    await expect(db.tx(
      async () => db.tx(async () => 'nested', { serialiseOn: 'shelf:fiction' }),
      { serialiseOn: 'shelf:fiction' },
    )).resolves.toBe('nested')
  })

  it('sends a key Postgres accepts as a bigint, whatever the name', async () => {
    for (const name of ['shelf:fiction', 'shelf:nonfiction', '', 'a'.repeat(200), '\u{1f4da}']) {
      const key = lockKey(name)
      expect(key, name).toBeGreaterThanOrEqual(-(2n ** 63n))
      expect(key, name).toBeLessThan(2n ** 63n)
      await expect(db.tx(async () => 'ok', { serialiseOn: name })).resolves.toBe('ok')
    }
  })
})

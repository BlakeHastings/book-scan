/**
 * `DbUnitOfWork` against real Postgres: what commits, what rolls back, what a
 * nested run joins, which locks it refuses, and that two units of work on one
 * book take turns. Turns are measured from an ordering log written inside the
 * work, with the timestamps beside it, rather than assumed from the lock.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from '../../server/testdb'
import { lockKey, type Db } from '../../server/driver'
import { bookLock, FURNITURE_LOCK, rangeLock, type LockName } from '../../application/locks'
import type { WorkScope } from '../../application/ports'
import { DbUnitOfWork, SystemClock } from './unit-of-work'

let db: Db
let work: DbUnitOfWork

beforeAll(async () => {
  db = await openTestDatabase()
})

beforeEach(async () => {
  await openTestDatabase()
  work = new DbUnitOfWork(db)
})

afterAll(closeTestDatabase)

/** Any table would do; `tag` is one with nothing hanging off it. */
const say = (said: string) =>
  db.run('INSERT INTO tag (slug, label) VALUES (?, ?)', [`probe/${said}`, said])

/** What has been committed, read from outside any unit of work. */
const committed = async () =>
  (await db.all<{ label: string }>(`SELECT label FROM tag WHERE slug LIKE 'probe/%' ORDER BY label`))
    .map((row) => row.label)

const pause = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

/** A pool with one spare connection would serialise two units of work by starvation. */
const warmTheConnections = () =>
  Promise.all([db.get('SELECT 1'), db.get('SELECT 1'), db.get('SELECT 1'), db.get('SELECT 1')])

describe('a unit of work', () => {
  it('commits what its work wrote when the work resolves', async () => {
    await expect(work.run(async () => { await say('kept'); return 'done' })).resolves.toBe('done')
    expect(await committed()).toEqual(['kept'])
  })

  it('rolls back everything its work wrote when the work throws, and rethrows', async () => {
    await expect(work.run(async () => {
      await say('first')
      await say('second')
      throw new Error('changed my mind')
    })).rejects.toThrow('changed my mind')
    expect(await committed()).toEqual([])
  })

  it('joins a unit of work it runs inside, on the same transaction', async () => {
    const outer = await work.run(async () => {
      await say('outer')
      const inner = await work.run(async () => {
        await say('inner')
        return db.get<{ id: string }>('SELECT txid_current()::text AS id')
      })
      const own = await db.get<{ id: string }>('SELECT txid_current()::text AS id')
      return { inner: inner?.id, own: own?.id }
    })
    expect(outer.inner).toBe(outer.own)
    expect(await committed()).toEqual(['inner', 'outer'])
  })

  it('rolls back a joined unit of work with the outer one', async () => {
    await expect(work.run(async () => {
      await work.run(async () => { await say('inner') })
      throw new Error('outer gave up')
    })).rejects.toThrow('outer gave up')
    expect(await committed()).toEqual([])
  })

  it('undoes only a joined unit of work that threw, when the outer one carries on', async () => {
    await work.run(async () => {
      await say('outer')
      await expect(work.run(async () => {
        await say('inner')
        throw new Error('inner gave up')
      })).rejects.toThrow('inner gave up')
    })
    expect(await committed()).toEqual(['outer'])
  })
})

describe('the locks a unit of work takes', () => {
  /** Lock names this backend holds right now, read from `pg_locks`. */
  const heldHere = async (names: string[]) => {
    const pid = (await db.get<{ pid: number }>('SELECT pg_backend_pid() AS pid'))!.pid
    const held: string[] = []
    for (const name of names) {
      // A bigint advisory key shows in `pg_locks` split in two: its high half
      // as `classid` and its low half as `objid`.
      const key = BigInt.asUintN(64, lockKey(name))
      const row = await db.get<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_locks
          WHERE locktype = 'advisory' AND granted AND pid = ? AND objsubid = 1
            AND classid::bigint = CAST(? AS bigint) AND objid::bigint = CAST(? AS bigint)`,
        [pid, (key >> 32n).toString(), (key & 0xffffffffn).toString()],
      )
      if (row && row.n > 0) held.push(name)
    }
    return held
  }

  it('takes a lock mid-work that comes later in the order, and holds it to the end', async () => {
    const held = await work.run(async (scope) => {
      await scope.serialiseOn(rangeLock('fiction'))
      await scope.serialiseOn(FURNITURE_LOCK)
      return heldHere([bookLock(7), rangeLock('fiction'), FURNITURE_LOCK])
    }, { serialiseOn: [bookLock(7)] })
    expect(held).toEqual([bookLock(7), rangeLock('fiction'), FURNITURE_LOCK])
  })

  it('refuses a lock mid-work that comes before one it holds, and rolls back', async () => {
    await expect(work.run(async (scope) => {
      await say('written before the refusal')
      await scope.serialiseOn(bookLock(7))
    }, { serialiseOn: [rangeLock('fiction')] }))
      .rejects.toThrow('book:7 cannot be taken while holding shelf:fiction')
    expect(await committed()).toEqual([])
  })

  it('refuses the range once it holds the furniture', async () => {
    await expect(work.run(async (scope) => {
      await scope.serialiseOn(rangeLock('nonfiction'))
    }, { serialiseOn: [FURNITURE_LOCK] }))
      .rejects.toThrow('shelf:nonfiction cannot be taken while holding furniture')
  })

  it('refuses a nested unit of work, or a plain nested transaction, naming an earlier lock', async () => {
    await expect(work.run(
      () => work.run(async () => 'inner', { serialiseOn: [bookLock(7)] }),
      { serialiseOn: [FURNITURE_LOCK] },
    )).rejects.toThrow('book:7 cannot be taken while holding furniture')

    await expect(work.run(
      () => db.tx(async () => 'inner', { serialiseOn: rangeLock('fiction') }),
      { serialiseOn: [FURNITURE_LOCK] },
    )).rejects.toThrow('shelf:fiction cannot be taken while holding furniture')
  })

  it('takes the locks it was given in order, whatever order they were named in', async () => {
    const held = await work.run(
      async () => heldHere([bookLock(7), rangeLock('fiction'), FURNITURE_LOCK]),
      { serialiseOn: [FURNITURE_LOCK, rangeLock('fiction'), bookLock(7)] },
    )
    expect(held).toEqual([bookLock(7), rangeLock('fiction'), FURNITURE_LOCK])
  })

  it('lets a mid-work lock it already holds be taken again', async () => {
    await expect(work.run(async (scope) => {
      await scope.serialiseOn(bookLock(7))
      return 'through'
    }, { serialiseOn: [bookLock(7), FURNITURE_LOCK] })).resolves.toBe('through')
  })
})

describe('two units of work at once', () => {
  const HOLD_MS = 150

  interface Entry { who: string; what: 'in' | 'out'; at: number }

  /** Each unit of work writes when it got in and when it is about to let go. */
  async function side(
    log: Entry[],
    who: string,
    take: (scope: WorkScope) => Promise<void>,
    locks: LockName[],
  ) {
    return work.run(async (scope) => {
      await take(scope)
      log.push({ who, what: 'in', at: performance.now() })
      await pause(HOLD_MS)
      log.push({ who, what: 'out', at: performance.now() })
    }, { serialiseOn: locks })
  }

  const nothingMore = async () => {}

  it('on different books overlap, so the log below can see an overlap when there is one', async () => {
    await warmTheConnections()
    const log: Entry[] = []
    await Promise.all([
      side(log, 'A', nothingMore, [bookLock(7)]),
      side(log, 'B', nothingMore, [bookLock(8)]),
    ])
    expect(log.map((entry) => entry.what)).toEqual(['in', 'in', 'out', 'out'])
  })

  it('on the same book take turns: the second gets in only after the first has let go', async () => {
    await warmTheConnections()
    const log: Entry[] = []
    await Promise.all([
      side(log, 'A', nothingMore, [bookLock(7)]),
      side(log, 'B', nothingMore, [bookLock(7)]),
    ])
    const [first, firstOut, second, secondOut] = log
    expect(log.map((entry) => `${entry.who} ${entry.what}`))
      .toEqual([`${first!.who} in`, `${first!.who} out`, `${second!.who} in`, `${second!.who} out`])
    expect(second!.who).not.toBe(first!.who)
    expect(second!.at - firstOut!.at, 'the second got in before the first let go').toBeGreaterThanOrEqual(0)
    expect(secondOut!.at - first!.at).toBeGreaterThanOrEqual(2 * HOLD_MS - 5)
  })

  it('refuses the one taking a book after its range, rather than deadlocking against the other', async () => {
    await warmTheConnections()
    let bothHoldTheirFirst = () => {}
    const ready = new Promise<void>((resolve) => { bothHoldTheirFirst = resolve })
    let holding = 0
    const holdThenTake = (first: LockName, then: LockName) => work.run(async (scope) => {
      holding += 1
      if (holding === 2) bothHoldTheirFirst()
      await ready
      await scope.serialiseOn(then)
      return `${first} then ${then}`
    }, { serialiseOn: [first] })

    const outcomes = await Promise.allSettled([
      holdThenTake(rangeLock('fiction'), bookLock(7)),
      holdThenTake(bookLock(7), rangeLock('fiction')),
    ])
    expect(outcomes.map((one) => one.status === 'fulfilled' ? one.value : String(one.reason)))
      .toEqual([
        'Error: book:7 cannot be taken while holding shelf:fiction: the order is book, shelf, furniture',
        'book:7 then shelf:fiction',
      ])
  })

  it('on the same book take turns when the second only names the book mid-work', async () => {
    await warmTheConnections()
    const log: Entry[] = []
    const first = side(log, 'A', nothingMore, [bookLock(7)])
    while (log.length === 0) await pause(5)
    await Promise.all([
      first,
      side(log, 'B', (scope) => scope.serialiseOn(bookLock(7)), []),
    ])
    expect(log.map((entry) => `${entry.who} ${entry.what}`)).toEqual(['A in', 'A out', 'B in', 'B out'])
    expect(log[2]!.at - log[1]!.at).toBeGreaterThanOrEqual(0)
  })
})

describe('the system clock', () => {
  it('says what time it is now', () => {
    const before = Date.now()
    const now = new SystemClock().now().getTime()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(Date.now())
  })
})

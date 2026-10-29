/**
 * Every act that writes a range's boundaries rewrites the furniture, because a
 * boundary is the area it opens, so each one has to queue behind whoever is
 * already rearranging the room, and has to have taken its place in that queue
 * before it reads the room it plans from.
 *
 * "Waits" is answered from `pg_locks`, not from a timer: a backend blocked in
 * `pg_advisory_xact_lock` has a row there that is not granted for exactly as
 * long as it waits. See the same probe in `db.pg.test.ts`.
 *
 * Saving a book is not in this file and is not covered: `CatalogueBookHandler`
 * and `ReviseBookHandler` read the furniture under the range's lock alone, which
 * is known and is #604's to decide.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, keepThisCatalogue, openTestDatabase } from './testdb'
import { testBooks } from './testbooks'
import { lockKey, type Db } from './driver'
import { Shelves } from './shelves'
import { applyRunMove } from './relocate-run'
import { addAreaTo, addFixture, dropArea } from './furniture'
import { createApp, type BookScanApp } from './index'
import { signedIn } from './testauth'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { FURNITURE_LOCK, rangeLock } from '../application/locks'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'
import { plankAt, type PlankAt } from '../shared/layout'
import type { ShelfRange } from '../shared/shelving'

let db: Db
let shelves: Shelves
let bob = 0

const plank = (label: string): PlankAt => plankAt(label)!

/** Fiction is Ann and Bob on 1A and Cat on 1B; non-fiction is two books on 4A. */
beforeAll(async () => {
  db = await openTestDatabase()
  shelves = new Shelves(db)

  for (const author of ['Ann Author', 'Bob Baker', 'Cat Cole']) {
    const { id } = await testBooks(db).catalogue({ title: 'Book', authors: [author], genre: FICTION_SLUG })
    if (author === 'Bob Baker') bob = id
  }
  for (const author of ['Dan Dale', 'Eve Edge']) {
    await testBooks(db).catalogue({ title: 'Book', authors: [author], genre: NON_FICTION_SLUG })
  }
  const cut = await shelves.overflow('fiction', plank('1A'), 'area')
  if (!cut.ok) throw new Error(`the fixture could not cut 1B: ${cut.error}`)

  await keepThisCatalogue('a_room_with_one_boundary')
})

beforeEach(async () => {
  await openTestDatabase('a_room_with_one_boundary')
})

afterAll(closeTestDatabase)

/** Comfortably under vitest's twenty seconds, so this file's message is what prints. */
const NEITHER_FACT_YET_MS = 10_000
const ASK_AGAIN_MS = 5
const pause = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * Which backends hold or want the lock `name`, in this database only, since
 * `pg_locks` is cluster wide and other files run beside this one. A bigint
 * advisory key is shown split in two: its high half as `classid`, its low half
 * as `objid`, and `objsubid` 1.
 */
async function lockersOf(name: string): Promise<{ pid: number; granted: boolean }[]> {
  const key = BigInt.asUintN(64, lockKey(name))
  return db.all<{ pid: number; granted: boolean }>(
    `SELECT pid, granted FROM pg_locks
      WHERE locktype = 'advisory' AND objsubid = 1
        AND classid::bigint = CAST(? AS bigint) AND objid::bigint = CAST(? AS bigint)
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    [(key >> 32n).toString(), (key & 0xffffffffn).toString()],
  )
}

/**
 * A pool with one spare connection would serialise the act behind the holder by
 * starvation and every test here would pass on that alone.
 */
const warmTheConnections = () =>
  Promise.all([db.get('SELECT 1'), db.get('SELECT 1'), db.get('SELECT 1'), db.get('SELECT 1')])

interface Queued<T> {
  /** True when the act got through while the furniture lock was held by somebody else. */
  ranAlongside: boolean
  /** Whether the backend waiting for the furniture already held the range's lock. */
  heldTheRange: boolean
  answer: T
}

/**
 * Hold `FURNITURE_LOCK` in one transaction, doing `meanwhile` inside it, and
 * start `act` beside it. Answers whichever of two things happens first: the act
 * finished, or Postgres has it queued for the furniture.
 *
 * The holder is released in a `finally`, because a held transaction that
 * outlives its test takes a connection with it.
 */
async function whileTheFurnitureIsHeld<T>(
  range: ShelfRange,
  act: () => Promise<T>,
  meanwhile: (tx: Db) => Promise<unknown> = async () => {},
): Promise<Queued<T>> {
  return whileHeld([FURNITURE_LOCK], range, act, meanwhile)
}

/**
 * The same, holding any of the names: `ranAlongside` is false as soon as the
 * act is queued for one of them.
 */
async function whileHeld<T>(
  names: readonly string[],
  range: ShelfRange,
  act: () => Promise<T>,
  meanwhile: (tx: Db) => Promise<unknown> = async () => {},
): Promise<Queued<T>> {
  await warmTheConnections()

  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  let holding = () => {}
  const inside = new Promise<void>((resolve) => { holding = resolve })

  const holder = db.tx(async (tx) => {
    await meanwhile(tx)
    holding()
    await held
  }, { serialiseOn: names })
  await inside

  let finished = false
  const acting = act().finally(() => { finished = true })

  try {
    const deadline = Date.now() + NEITHER_FACT_YET_MS
    let ranAlongside: boolean | undefined
    let heldTheRange = false
    while (ranAlongside === undefined) {
      if (Date.now() > deadline) {
        throw new Error(
          `Neither happened within ${NEITHER_FACT_YET_MS / 1000}s: the act has not ` +
          `finished, and nothing in this database is waiting for ${names.join(' or ')}. ` +
          'Something other than that lock is holding it up.',
        )
      }
      if (finished) {
        ranAlongside = true
        break
      }
      const waiting = (await Promise.all(names.map(lockersOf)))
        .flat().filter((one) => !one.granted)
      if (waiting.length) {
        heldTheRange = (await lockersOf(rangeLock(range)))
          .some((one) => one.granted && one.pid === waiting[0]!.pid)
        ranAlongside = false
        break
      }
      await pause(ASK_AGAIN_MS)
    }
    release()
    await holder
    return { ranAlongside, heldTheRange, answer: await acting }
  } finally {
    release()
    await Promise.allSettled([holder, acting])
  }
}

const fictionBoundary = async (): Promise<number> => {
  const [only] = await shelves.list('fiction')
  if (!only) throw new Error('the fixture has no fiction boundary')
  return only.id
}

interface Act {
  name: string
  range: ShelfRange
  /** What has to be true of the room first, done before anybody holds anything. */
  before?: () => Promise<unknown>
  act: () => Promise<{ ok: boolean; error?: string }>
}

/** The five acts that write a range's boundaries. */
const acts: Act[] = [
  {
    name: 'saying a plank is full',
    range: 'fiction',
    act: () => shelves.overflow('fiction', plank('1B'), 'area'),
  },
  {
    name: 'moving a book across a boundary',
    range: 'fiction',
    act: () => shelves.moveAcrossBoundary('fiction', bob, 'next'),
  },
  {
    name: 'taking a boundary move back',
    range: 'fiction',
    before: () => shelves.moveAcrossBoundary('fiction', bob, 'next'),
    act: () => shelves.retractMove('fiction', bob),
  },
  {
    name: 'removing a boundary',
    range: 'fiction',
    act: async () => shelves.remove(await fictionBoundary(), { theAreaGoes: true }),
  },
  {
    name: 'moving the non-fiction run to bookcase 3',
    range: 'nonfiction',
    act: () => applyRunMove(db, 'nonfiction', 3, new Date().toISOString()),
  },
]

describe('every act that writes a boundary waits for whoever holds the furniture', () => {
  it.each(acts)('$name', async ({ range, before, act }) => {
    await before?.()
    const queued = await whileTheFurnitureIsHeld(range, act)

    expect(queued.ranAlongside, 'it wrote the furniture while somebody else held it').toBe(false)
    expect(queued.heldTheRange, `it waited for the furniture before taking ${rangeLock(range)}`)
      .toBe(true)
    expect(queued.answer.ok, JSON.stringify(queued.answer)).toBe(true)
  })
})

/**
 * The lock has to be held before the plan is read, not only before the write.
 * The holder renumbers a bookcase and commits; an act that read the room before
 * queueing would answer with the old number.
 */
describe('an act plans from the room the furniture writer left', () => {
  /** A bare statement rather than `editFixture`, whose read-back is not what is under test here. */
  const renumber = (from: number, to: number) => (tx: Db) =>
    tx.run('UPDATE fixture SET position = ? WHERE position = ?', [to, from])

  it('a boundary move names the planks by their new bookcase', async () => {
    const queued = await whileTheFurnitureIsHeld(
      'fiction',
      () => shelves.moveAcrossBoundary('fiction', bob, 'next'),
      renumber(1, 9),
    )

    expect(queued.ranAlongside).toBe(false)
    expect(queued.answer.ok, queued.answer.error).toBe(true)
    // `move` is worked out from the layout read before anything is written.
    expect([queued.answer.move?.from, queued.answer.move?.to]).toEqual(['9A', '9B'])
  })

  it('a run relocation moves the run from its bookcase as it is now numbered', async () => {
    const queued = await whileTheFurnitureIsHeld(
      'nonfiction',
      () => applyRunMove(db, 'nonfiction', 3, new Date().toISOString()),
      renumber(4, 8),
    )

    expect(queued.ranAlongside).toBe(false)
    expect(queued.answer.ok, JSON.stringify(queued.answer)).toBe(true)
    if (!queued.answer.ok) return
    expect(queued.answer.plan.from).toBe(8)
  })

  it('removing a boundary somebody has just taken off the furniture finds it already gone', async () => {
    const boundary = await fictionBoundary()
    const queued = await whileTheFurnitureIsHeld(
      'fiction',
      () => shelves.remove(boundary, { theAreaGoes: true }),
      (tx) => dropArea(tx, boundary, new Date().toISOString()),
    )

    expect(queued.ranAlongside).toBe(false)
    expect(queued.answer).toEqual({ ok: true, removed: null })
  })
})

/**
 * `DELETE /api/areas/:id` is the furniture screen's door to the same removal
 * `RemoveSeparatorHandler` makes, and it reached `dropArea` holding the
 * furniture alone, so a save filing into that run could read the room halfway
 * through the change (#661). Driven over HTTP, because the route is the door.
 */
describe('deleting an area over HTTP waits for whoever holds its range', () => {
  let server: Server
  let app: BookScanApp
  let baseUrl = ''
  let cookie = ''
  let scratch = ''

  beforeEach(async () => {
    scratch = scratchRoot('furniture-lock')
    cookie = (await signedIn(db)).cookie
    app = createApp({ db, coverDir: scratch, startBackgroundWork: false })
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await app.settled()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    removeScratchRoot(scratch)
  })

  const deleteArea = async (id: number) => {
    const response = await fetch(`${baseUrl}/api/areas/${id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    return { status: response.status, body: await response.json() as unknown }
  }

  /** The areas on the piece at this number, in the order they hang. */
  const areasOnBookcase = async (position: number): Promise<number[]> =>
    (await db.all<{ id: number }>(
      `SELECT a.id FROM area a JOIN fixture f ON f.id = a.fixture_id
        WHERE f.position = ? AND a.position >= 0 ORDER BY a.position`,
      [position],
    )).map((row) => Number(row.id))

  it('a boundary of the fiction run', async () => {
    const [, boundary] = await areasOnBookcase(1)
    const queued = await whileHeld([rangeLock('fiction')], 'fiction', () => deleteArea(boundary!))

    expect(queued.ranAlongside, 'it wrote the fiction run while somebody else held it').toBe(false)
    expect(queued.answer.status, JSON.stringify(queued.answer.body)).toBe(200)
  })

  it('the plank the fiction run opens on', async () => {
    const [opening] = await areasOnBookcase(1)
    const queued = await whileHeld([rangeLock('fiction')], 'fiction', () => deleteArea(opening!))

    expect(queued.ranAlongside, 'it wrote the fiction run while somebody else held it').toBe(false)
    expect(queued.answer.status, JSON.stringify(queued.answer.body)).toBe(200)
  })

  /*
   * A piece standing before the first run belongs to no range, so its areas
   * are no run's boundaries and nothing a save reads changes. It takes the
   * furniture alone, as it always did, and does not queue behind a save in
   * either range.
   */
  it('an area no run stands on takes no range', async () => {
    await db.run('UPDATE fixture SET position = position + 1')
    const piece = await addFixture(db, { position: 1, name: 'By the door' })
    if (!piece.ok) throw new Error(piece.error)
    for (const startsAt of ['', 'm']) {
      const added = await addAreaTo(db, piece.fixture.id, { startsAt })
      if (!added.ok) throw new Error(added.error)
    }
    const [, second] = await areasOnBookcase(1)

    const queued = await whileHeld(
      [rangeLock('fiction'), rangeLock('nonfiction')], 'fiction', () => deleteArea(second!),
    )

    expect(queued.ranAlongside, 'it queued for a range it does not stand in').toBe(true)
    expect(queued.answer.status, JSON.stringify(queued.answer.body)).toBe(200)
  })
})

describe('the order the locks are taken in', () => {
  /*
   * The first transaction is the shape removing a boundary has always had: the
   * range, then the furniture from inside, in a savepoint. The second names the
   * pair furniture first. Taken as named, it would hold the furniture while
   * waiting for the range the first holds, the first would then wait for the
   * furniture, and Postgres would fail one of them with a deadlock.
   */
  it('is the range before the furniture, whatever order a caller names them in', async () => {
    let waited = () => {}
    const secondIsWaiting = new Promise<void>((resolve) => { waited = resolve })
    let holding = () => {}
    const inside = new Promise<void>((resolve) => { holding = resolve })

    await warmTheConnections()
    const first = db.tx(async () => {
      holding()
      await secondIsWaiting
      return db.tx(async () => 'first', { serialiseOn: FURNITURE_LOCK })
    }, { serialiseOn: rangeLock('fiction') })
    await inside

    const second = db.tx(async () => 'second', {
      serialiseOn: [FURNITURE_LOCK, rangeLock('fiction')],
    })
    try {
      const deadline = Date.now() + NEITHER_FACT_YET_MS
      while (!(await lockersOf(rangeLock('fiction'))).some((one) => !one.granted)) {
        if (Date.now() > deadline) throw new Error('the second never queued for the range')
        await pause(ASK_AGAIN_MS)
      }
    } finally {
      waited()
    }

    expect(await Promise.allSettled([first, second])).toEqual([
      { status: 'fulfilled', value: 'first' },
      { status: 'fulfilled', value: 'second' },
    ])
  })

  it('keeps a lock taken by a savepoint after rolling back to it', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    let holding = () => {}
    const inside = new Promise<void>((resolve) => { holding = resolve })

    await warmTheConnections()
    const outer = db.tx(async () => {
      await expect(db.tx(async () => { throw new Error('rolled back') }, {
        serialiseOn: FURNITURE_LOCK,
      })).rejects.toThrow('rolled back')
      holding()
      await held
    }, { serialiseOn: rangeLock('fiction') })
    await inside

    try {
      const furniture = await lockersOf(FURNITURE_LOCK)
      expect(furniture.filter((one) => one.granted), 'the rollback let the furniture go')
        .toHaveLength(1)
    } finally {
      release()
    }
    await outer
  })
})

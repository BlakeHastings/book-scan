/**
 * `0030`, watched running: a move receipt learns which plank, from its address.
 *
 * The migration's whole job is to answer, once, the question every reader of
 * `outstanding_move` used to ask on every read — which plank does `4B` name —
 * and to write the answer down so nobody has to ask again (#481).
 *
 * **So the claim it has to make is that it answers exactly what the reader
 * answered.** `areaForRecordedLabel` is the reading that was there the moment
 * before this ran: `parseLocation` and `areaIndex` for the address, then a
 * lookup that will reach a plank taken off the face, because the move that wrote
 * the receipt is the thing that retired the plank. That function is gone with
 * its last caller, and this is where its behaviour is pinned instead, spelled in
 * SQL and asked of a catalogue with every shape of furniture it distinguished:
 * a plank on a face, a plank retired with nothing standing in its place, a plank
 * retired with a live one that has taken its address, a plank on a piece that
 * has come off the floor, two pieces on one number, and an address that names
 * nothing at all.
 *
 * The third of those is why the ids are worth having, and it is also the one
 * case the migration cannot get right for a row written before it: an address
 * alone does not say which of two rows reading `1B` a receipt meant, and the
 * reader it is replacing answered the live one. So it answers the live one too.
 * Every receipt written after this carries the id the move recorded and never
 * comes near this question.
 *
 * Nothing here connects to anything but a scratch database it made.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { migrateToLatest } from './migrate'
import { closeScratchDatabases, scratchDatabase } from './testdb'

const THIS_ONE = '0030_a_move_receipt_names_the_plank'

afterAll(closeScratchDatabases)

/**
 * The backfill half of the migration, replayed over rows written since.
 *
 * **The catalogue is migrated to latest first and the receipts are written after
 * it**, rather than being stopped at `0029` and migrated forward, because
 * `migrationsThrough` starts at `0001` every time and `0023` in the middle of
 * that folder builds a `TEMP TABLE ... ON COMMIT DROP` which does not survive
 * being handed statement by statement to a pool. What is under test is the
 * reading, not the `ALTER TABLE`, so the two column additions are skipped and
 * everything after them is run exactly as Drizzle's migrator would run it. The
 * rows below carry no ids to begin with, which is the state the migration meets.
 */
async function replayTheBackfill(pool: pg.Pool): Promise<void> {
  const sql = readFileSync(
    fileURLToPath(new URL(`./migrations/${THIS_ONE}.sql`, import.meta.url)), 'utf8',
  )
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim() && !/^\s*ALTER TABLE/m.test(statement)) await pool.query(statement)
  }
}

let pool: pg.Pool
/** Every area the fixture below builds, by the name this file gave it. */
let areas: Record<string, number>

beforeAll(async () => {
  pool = await scratchDatabase()
  await migrateToLatest(pool)

  /*
   * The collection `0013` made, rather than a second one: that migration seeds
   * bookcases 1 and 4 with planks on them, and a fixture of this file's standing
   * on one of those numbers would be answering somebody else's address. So the
   * furniture below stands at 11 and up, where nothing else does.
   */
  const collection = (await pool.query<{ id: number }>(
    'SELECT id FROM collection ORDER BY id LIMIT 1',
  )).rows[0]!.id

  const fixture = async (position: number, name = '') => (await pool.query<{ id: number }>(
    `INSERT INTO fixture (collection_id, kind, name, position, sort_strategy, note)
     VALUES ($1, 'bookshelf', $2, $3, 'inherit', '') RETURNING id`,
    [collection, name, position],
  )).rows[0]!.id

  const area = async (fixtureId: number, position: number) => (await pool.query<{ id: number }>(
    `INSERT INTO area (fixture_id, position, name, starts_at, sort_strategy, note)
     VALUES ($1, $2, '', '', 'inherit', '') RETURNING id`,
    [fixtureId, position],
  )).rows[0]!.id

  // Bookcase 11: plank A on the face, and two rows that both read `11B` — one
  // retired at -(1 + 1), one standing at 1. This is the shape a move that
  // emptied the last plank leaves behind once somebody adds a plank back.
  const eleven = await fixture(11)
  areas = {
    liveA: await area(eleven, 0),
    retiredB: await area(eleven, -2),
    liveB: await area(eleven, 1),
  }

  // Bookcase 12: plank A retired, with nothing standing in its place.
  const twelve = await fixture(12)
  areas.onlyRetired = await area(twelve, -1)

  // A bookcase that has come off the floor, at -(13 + 1), with a plank still on
  // its face. `retireFixture` leaves the areas where they were.
  const thirteen = await fixture(-14)
  areas.onARetiredPiece = await area(thirteen, 0)

  // Two pieces standing on 15. `fixture.position` is deliberately not unique,
  // and the reading takes the piece that was there first.
  const fifteenFirst = await fixture(15)
  const fifteenSecond = await fixture(15)
  areas.firstAtFifteen = await area(fifteenFirst, 0)
  areas.secondAtFifteen = await area(fifteenSecond, 0)

  const receipts: [string, string, string][] = [
    ['on the face', '11A', '11B'],
    ['retired with nothing in its place', '12A', '11A'],
    ['on a piece off the floor', '13A', '11A'],
    ['two pieces on one number', '15A', '11A'],
    ['an address naming nothing', '19Z', '11A'],
    ['no address at all', 'Hall shelf · B', '11A'],
  ]

  for (const [title, from, to] of receipts) {
    const book = (await pool.query<{ id: number }>(
      `INSERT INTO books (title, shelf_range, sort_key, title_filing, scanned_at)
       VALUES ($1, 'fiction', $2, $2, '2026-01-01T00:00:00Z') RETURNING id`,
      [title, title.toLowerCase()],
    )).rows[0]!.id

    await pool.query(
      `INSERT INTO outstanding_move
         (book_id, shelf_range, from_label, to_label, restore, made_at)
       VALUES ($1, 'fiction', $2, $3, '{"reanchor":[],"recreate":[]}', '2026-01-01T00:00:00Z')`,
      [book, from, to],
    )
  }

  await replayTheBackfill(pool)
}, 120_000)

/** What the migration wrote, keyed by the receipt's own `from` address. */
const backfilled = async () => Object.fromEntries((await pool.query<{
  from_label: string; from_area_id: number | null; to_area_id: number | null
}>(
  'SELECT from_label, from_area_id, to_area_id FROM outstanding_move',
)).rows.map((row) => [row.from_label, {
  from: row.from_area_id === null ? null : Number(row.from_area_id),
  to: row.to_area_id === null ? null : Number(row.to_area_id),
}]))

it('reads an address on the face into the plank standing at it', async () => {
  expect((await backfilled())['11A']).toEqual({ from: areas.liveA, to: areas.liveB })
})

it('reaches a plank the furniture no longer has, which is the ordinary case', async () => {
  // The move that wrote a receipt is what retired the plank it names, so a
  // reading that stopped at the face would answer nothing for the receipts this
  // table mostly holds.
  expect((await backfilled())['12A']?.from).toBe(areas.onlyRetired)
})

it('reaches a plank on a piece that has come off the floor', async () => {
  expect((await backfilled())['13A']?.from).toBe(areas.onARetiredPiece)
})

it('takes the piece that was there first where two stand on one number', async () => {
  // The rule `fixturesIn` and `runAreasOf` read a band by, and the reason an
  // address is not an identity: both of these planks read `15A`, and nothing in
  // the string says which one a receipt was about.
  expect((await backfilled())['15A']?.from).toBe(areas.firstAtFifteen)
  expect((await backfilled())['15A']?.from).not.toBe(areas.secondAtFifteen)
})

it('answers nothing for an address the furniture has no plank for', async () => {
  // A receipt keeps its labels and its restore, so the retraction still works.
  // What it does not get is the undo on the misfile list, which its address had
  // already stopped earning: this is the answer the reader gave for it too.
  expect((await backfilled())['19Z']).toEqual({ from: null, to: areas.liveA })
})

it('answers nothing for a label that is not an address at all', async () => {
  // `parseLocation` returns null on the named form and a test pins that. Nothing
  // writes one here — the layout arithmetic has never heard of a piece's name —
  // and the migration is written not to invent a plank for one that appeared.
  expect((await backfilled())['Hall shelf · B']).toEqual({ from: null, to: areas.liveA })
})

it('prefers the plank on the face where a retired one shares its address', async () => {
  // The reading being reproduced, and the case that says why a receipt should
  // not have to be read this way at all: two rows answer to `1B`, the migration
  // has only the address to go on, and it gives the same answer the code it
  // replaces gave. A receipt written since carries the id the move recorded.
  expect((await backfilled())['11A']?.to).toBe(areas.liveB)
  expect((await backfilled())['11A']?.to).not.toBe(areas.retiredB)
})

it('leaves every label exactly as the move wrote it', async () => {
  const labels = (await pool.query<{ from_label: string; to_label: string }>(
    'SELECT from_label, to_label FROM outstanding_move ORDER BY from_label',
  )).rows
  expect(labels.map((row) => [row.from_label, row.to_label])).toEqual([
    ['11A', '11B'],
    ['12A', '11A'],
    ['13A', '11A'],
    ['15A', '11A'],
    ['19Z', '11A'],
    ['Hall shelf · B', '11A'],
  ])
})

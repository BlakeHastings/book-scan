/**
 * The repair, and that running it is two decisions rather than one (#505).
 *
 * `rebuildProjection` had no runtime caller at all. #505 said that is either the
 * repair somebody runs after a disagreement is found, in which case it needs a
 * way to be run, or dead code that should go. It is the first, and what is
 * tested here is the part that makes it safe to keep: **asking does not write.**
 *
 * `placement-ledger.test.ts` is where the check and the fold themselves are put
 * through their cases against a live-sized catalogue. This is the wrapper.
 */

import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { PgDb } from '../server/db.pg'
import type { Db } from '../server/driver'
import { countProjectionDisagreements } from '../infrastructure/placement/projection'
import { describeDisagreement, rebuildProjectionRun } from './rebuild-projection'

let pool: pg.Pool
let db: Db

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
})

afterAll(async () => {
  await closeScratchDatabases()
})

/** A position no real bookcase has, so the teardown can name this file's own. */
const OURS = 9505
let made = 0

beforeEach(async () => {
  // Books cascade their placements; areas go with the bookcase they hang on.
  await pool.query('DELETE FROM books')
  await pool.query('DELETE FROM fixture WHERE position >= $1', [OURS])
  made = 0
})

/** A book whose column names a plank and whose ledger says nothing at all. */
async function aBookPlacedWithoutARecord(title: string): Promise<void> {
  // A bookcase each, because a fixture cannot hold two areas at one position and
  // a plank each is fewer moving parts than counting them.
  const fixture = await db.get<{ id: number }>(
    `INSERT INTO fixture (collection_id, kind, name, position, sort_strategy, note)
     SELECT id, 'bookshelf', '', ?, 'inherit', '' FROM collection ORDER BY id LIMIT 1
     RETURNING id`,
    [OURS + made++],
  )
  expect(fixture, 'no collection to hang a bookcase off').toBeDefined()

  const area = await db.get<{ id: number }>(
    `INSERT INTO area (fixture_id, position, name, starts_at, sort_strategy, note)
     VALUES (?, 0, '', '', 'inherit', '') RETURNING id`,
    [fixture!.id],
  )
  await db.run(
    `INSERT INTO books (title, shelf_range, sort_key, scanned_at, state, current_area_id)
     VALUES (?, 'fiction', ?, '2026-09-03T00:00:00.000Z', 'shelved', ?)`,
    [title, title.toUpperCase(), area!.id],
  )
}

describe('rebuilding the placement projection', () => {
  it('says nothing is wrong, and writes nothing, on a catalogue that agrees', async () => {
    expect(await rebuildProjectionRun(db, { repair: true }))
      .toEqual({ before: 0, named: [], changed: null, after: 0 })
  })

  it('names what disagrees and writes nothing when it is only asked', async () => {
    await aBookPlacedWithoutARecord('A Book Nobody Wrote Down')

    const report = await rebuildProjectionRun(db, { repair: false })

    // The rows first, because this is the assertion that matters: #485's
    // diagnosis depended on the broken state being stable, and a dry run that
    // repaired would erase the only evidence of which writer stopped recording
    // itself. Asserted before the report so a run that repaired fails here
    // rather than on a field.
    expect(await countProjectionDisagreements(db)).toBe(1)

    expect(report.before).toBe(1)
    expect(report.named.map((one) => one.title)).toEqual(['A Book Nobody Wrote Down'])
    // `null` rather than `0`: nothing was attempted, which is a different fact
    // from a repair that moved no rows.
    expect(report.changed).toBeNull()
  })

  it('repairs only when asked a second time, and re-asks rather than claiming', async () => {
    await aBookPlacedWithoutARecord('A Book Nobody Wrote Down')
    await aBookPlacedWithoutARecord('Another Book Nobody Wrote Down')

    const report = await rebuildProjectionRun(db, { repair: true })

    expect(report.before).toBe(2)
    expect(report.changed).toBe(2)
    // Rows written is not the same claim as "they agree now", so the count is
    // taken again afterwards rather than inferred from the rows updated.
    expect(report.after).toBe(0)
    expect(await countProjectionDisagreements(db)).toBe(0)
  })

  it('describes a book by both of the answers that disagree about it', async () => {
    await aBookPlacedWithoutARecord('A Book Nobody Wrote Down')

    const [one] = (await rebuildProjectionRun(db, { repair: false })).named

    expect(describeDisagreement(one!)).toMatch(
      /^ {2}#\d+ A Book Nobody Wrote Down: column \d+, ledger nowhere$/,
    )
  })
})

/**
 * What Drizzle actually generates, read back.
 *
 * `web/server/dividers.test.ts` and `web/server/shelves.test.ts` already prove
 * that removing a boundary does the right thing to real rows, on both drivers.
 * They cannot say *why* a statement works, and two of the things this file
 * pins are invisible to them until the day they break:
 *
 * - the placeholders come out as `?`, because `Db` translates that style per
 *   driver and refuses a statement whose placeholders it cannot account for.
 *   A Drizzle upgrade that renames `escapeParam` would silently go back to
 *   `$1`, and on Postgres, where `$1` is also what `Db` writes, the failure
 *   would be a confusing double-numbering rather than an obvious one.
 * - the insert does not contain the word `default`. That is the whole reason
 *   `add` is written the way it is, and a later well-meaning tidy back to
 *   `build.insert(...)` would pass every Postgres test in this repository and
 *   break every SQLite one.
 *
 * The database here is a fake that records rather than executes, which is the
 * one thing a real database cannot do: `Db` hands back rows, not the statement
 * it was given.
 */

import { describe, expect, it } from 'vitest'
import { DrizzleSeparatorRepository } from './separator-repository'
import type { Db, Params } from '../../server/driver'

interface Recorded {
  sql: string
  params: Params | undefined
}

/** A `Db` that answers with whatever it was handed and remembers the question. */
class RecordingDb implements Db {
  readonly seen: Recorded[] = []

  constructor(private readonly rows: unknown[] = []) {}

  async all<Row>(sql: string, params?: Params): Promise<Row[]> {
    this.seen.push({ sql, params })
    return this.rows as Row[]
  }

  async get<Row>(sql: string, params?: Params): Promise<Row | undefined> {
    this.seen.push({ sql, params })
    return this.rows[0] as Row | undefined
  }

  async run(sql: string, params?: Params): Promise<{ changes: number }> {
    this.seen.push({ sql, params })
    return { changes: 1 }
  }

  async tx<T>(work: (db: Db) => Promise<T>): Promise<T> {
    return work(this)
  }

  async close(): Promise<void> {}
}

/** The statement, with the whitespace Drizzle and the templates leave behind. */
const said = (db: RecordingDb) => db.seen.map((one) => one.sql.replace(/\s+/g, ' ').trim())

describe('the statements the separators repository generates', () => {
  it('reads a range in position order, with the placeholder style Db reads', async () => {
    const db = new RecordingDb()
    await new DrizzleSeparatorRepository(db).inRange('fiction')

    expect(said(db)[0]).toBe(
      'select "id", "shelf_range", "kind", "starts_at", "position", "note", "created_at" ' +
      'from "separators" where "separators"."shelf_range" = ? ' +
      'order by "separators"."position" asc',
    )
    expect(db.seen[0]?.params).toEqual(['fiction'])
  })

  it('never writes a $1, which is the style Db writes rather than reads', async () => {
    const db = new RecordingDb()
    const repository = new DrizzleSeparatorRepository(db)

    await repository.inRange('fiction')
    await repository.rangeOf(4)
    await repository.add({
      range: 'fiction', kind: 'area', startsAt: 'k', position: 0, note: '', createdAt: 'now',
    })
    await repository.reanchor(4, 'k')
    await repository.reposition(4, 1)
    await repository.remove(4)

    // Ten rather than six: since #213 each write also asks which range it is
    // in and hands the range to `recordAreasOf`, which reads `shelf_ranges`
    // first and finds nothing here, because this database answers every
    // question with the same empty list.
    expect(said(db)).toHaveLength(10)
    for (const statement of said(db)) expect(statement).not.toMatch(/\$\d/)
  })

  it('names the columns it inserts rather than defaulting the rest', async () => {
    const db = new RecordingDb()
    await new DrizzleSeparatorRepository(db).add({
      range: 'nonfiction',
      kind: 'shelf',
      startsAt: 'sortkey',
      position: 2,
      note: '',
      createdAt: '2026-08-06T00:00:00.000Z',
    })

    // No "id", and above all no `default`: SQLite answers a DEFAULT in a VALUES
    // list with `near "default": syntax error`, and this app still ships both.
    expect(said(db)[0]).toBe(
      'insert into "separators" ("shelf_range", "kind", "starts_at", "position", ' +
      '"note", "created_at") values (?, ?, ?, ?, ?, ?)',
    )
    expect(db.seen[0]?.params).toEqual(
      ['nonfiction', 'shelf', 'sortkey', 2, '', '2026-08-06T00:00:00.000Z'],
    )
  })

  it('re-anchors and repositions one boundary at a time', async () => {
    const db = new RecordingDb()
    const repository = new DrizzleSeparatorRepository(db)
    await repository.reanchor(7, 'later')
    await repository.reposition(7, 3)
    await repository.remove(7)

    // The range is asked for **before** each statement, which is what makes
    // `remove` able to record at all: the row it deletes is the only thing that
    // knows which range the boundary was in.
    const asked = 'select "shelf_range" from "separators" where "separators"."id" = ?'
    expect(said(db)).toEqual([
      asked,
      'update "separators" set "starts_at" = ? where "separators"."id" = ?',
      asked,
      'update "separators" set "position" = ? where "separators"."id" = ?',
      asked,
      'delete from "separators" where "separators"."id" = ?',
    ])
    expect(db.seen.map((one) => one.params))
      .toEqual([[7], ['later', 7], [7], [3, 7], [7], [7]])
  })
})

describe('what comes back out', () => {
  it('is a domain separator, not a row', async () => {
    const db = new RecordingDb([{
      id: 3,
      shelf_range: 'fiction',
      kind: 'area',
      starts_at: 'smithzoe',
      position: 1,
      note: 'set at the shelf',
      created_at: '2026-08-06T00:00:00.000Z',
    }])

    expect(await new DrizzleSeparatorRepository(db).inRange('fiction')).toEqual([{
      id: 3,
      range: 'fiction',
      kind: 'area',
      startsAt: 'smithzoe',
      position: 1,
    }])
  })

  it('names the range a boundary is in, and says nothing when it has gone', async () => {
    const found = new RecordingDb([{ shelf_range: 'nonfiction' }])
    expect(await new DrizzleSeparatorRepository(found).rangeOf(3)).toBe('nonfiction')

    const gone = new RecordingDb([])
    expect(await new DrizzleSeparatorRepository(gone).rangeOf(3)).toBeUndefined()
  })
})

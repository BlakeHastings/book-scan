/**
 * The capture repository, against a real Postgres.
 *
 * Postgres only, and it has to be: `capture` is created by a migration, and
 * migrations exist only for Postgres. The database each test opens is built by
 * running every migration, which is also the only way to get one with this table
 * in it.
 *
 * Two things here are worth more than the rest. The first is that recording a
 * photograph twice is the same as recording it once, and recording a *different*
 * file is a second photograph rather than a replacement, which is the whole
 * reason this table exists. The second is that every field a repeat writes moves
 * in one direction only: that is what makes two overlapping crop passes safe
 * without a lock, and the lost update it prevents is one this project has
 * already had, in stage G, on the column this replaces.
 */

import pg from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PgDb } from '../../server/db.pg'
import type { Db } from '../../server/driver'
import { RecordPhotographsHandler } from '../../application/capture/record-photographs'
import { verdictOf } from '../../domain/capture/photographs'
import { closeScratchDatabases, migratedDatabase } from '../db/testdb'
import { DrizzleCaptureRepository } from './capture-repository'

let pool: pg.Pool
let db: Db
let captures: DrizzleCaptureRepository

const SHOT_AT = '2026-08-06T09:00:00.000Z'

/** A book to hang photographs on. `capture.book_id` is a foreign key. */
async function aBook(title: string): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO books (title, shelf_range, sort_key, scanned_at)
     VALUES (?, 'fiction', ?, '2026-08-06') RETURNING id`,
    [title, title],
  )
  return Number(row?.id)
}

beforeEach(async () => {
  if (!pool) {
    pool = await migratedDatabase()
    db = new PgDb(pool)
  }
  await db.run('TRUNCATE books, capture RESTART IDENTITY CASCADE')
  captures = new DrizzleCaptureRepository(db)
})

afterAll(async () => {
  await closeScratchDatabases()
})

describe('recording a photograph', () => {
  it('writes it down and reads it back as a photograph, not as a row', async () => {
    const id = await aBook('Dune')
    await captures.record(id, [{
      kind: 'front', file: 'front.jpg', cropFile: 'front_crop.jpg',
      examined: true, hash: 'd:front', takenAt: SHOT_AT,
    }])

    expect((await captures.of(id)).list).toEqual([{
      kind: 'front', file: 'front.jpg', cropFile: 'front_crop.jpg',
      examined: true, hash: 'd:front', takenAt: SHOT_AT,
    }])
  })

  it('defaults a photograph nobody has said anything else about', async () => {
    const id = await aBook('Dune')
    await captures.record(id, [{ kind: 'spine', file: 'spine.jpg', takenAt: SHOT_AT }])

    const [photograph] = (await captures.of(id)).list
    expect(photograph).toMatchObject({ cropFile: '', examined: false, hash: '' })
    expect(verdictOf(photograph!)).toBe('unexamined')
  })

  it('is the same photograph the second time it is offered', async () => {
    const id = await aBook('Dune')
    const shot = { kind: 'front', file: 'front.jpg', takenAt: SHOT_AT } as const
    await captures.record(id, [shot])
    await captures.record(id, [shot])

    expect((await captures.of(id)).count).toBe(1)
  })

  it('makes a re-shot spine a second photograph, and keeps the first', async () => {
    /*
     * The feature the whole table is for. Under the eight columns this replaces
     * there was one `edge_image`, so re-shooting a blurred spine meant writing
     * over the only record of it. Here it is a new file, so it is a new row.
     */
    const id = await aBook('Dune')
    await captures.record(id, [{ kind: 'spine', file: 'blurred.jpg', takenAt: SHOT_AT }])
    await captures.record(id, [{
      kind: 'spine', file: 'sharp.jpg', takenAt: '2026-08-07T09:00:00.000Z',
    }])

    const photographs = await captures.of(id)
    expect(photographs.latest('spine')?.file).toBe('sharp.jpg')
    expect(photographs.ofKind('spine').map((one) => one.file)).toEqual(['sharp.jpg', 'blurred.jpg'])
  })

  it('keeps two books apart even when they name the same file', async () => {
    // The unique index is on the book and the file together, not on the file.
    // Two books can name one downloaded cover, and neither owns it.
    const dune = await aBook('Dune')
    const messiah = await aBook('Dune Messiah')
    const artwork = { kind: 'catalogue', file: 'cover.jpg', takenAt: SHOT_AT } as const
    await captures.record(dune, [artwork])
    await captures.record(messiah, [artwork])

    expect((await captures.of(dune)).count).toBe(1)
    expect((await captures.of(messiah)).count).toBe(1)
  })
})

describe('what a repeat may change', () => {
  it('fills in a crop and a hash that arrive later', async () => {
    // The ordinary case: the photograph lands on the save, and the detector and
    // the hasher each finish a second afterwards.
    const id = await aBook('Dune')
    await captures.record(id, [{ kind: 'front', file: 'front.jpg', takenAt: SHOT_AT }])
    await captures.record(id, [{
      kind: 'front', file: 'front.jpg', cropFile: 'front_crop.jpg',
      examined: true, hash: 'd:front', takenAt: SHOT_AT,
    }])

    expect((await captures.of(id)).latest('front')).toMatchObject({
      cropFile: 'front_crop.jpg', examined: true, hash: 'd:front',
    })
  })

  it('never takes a crop back off, whatever a later caller says', async () => {
    /*
     * The lost update stage G found, on the column this replaces. Two crop
     * passes over one book overlap routinely, one fired after a save and one
     * from the backfill loop, and the second one arriving with nothing to say
     * must not erase what the first one found. The crop is a file on a disk this
     * statement cannot reach: blanking the column would make it unreachable
     * rather than making it untrue.
     */
    const id = await aBook('Dune')
    await captures.record(id, [{
      kind: 'front', file: 'front.jpg', cropFile: 'front_crop.jpg',
      examined: true, hash: 'd:front', takenAt: SHOT_AT,
    }])
    await captures.record(id, [{
      kind: 'front', file: 'front.jpg', cropFile: '', examined: false, hash: '',
      takenAt: SHOT_AT,
    }])

    expect((await captures.of(id)).latest('front')).toMatchObject({
      cropFile: 'front_crop.jpg', examined: true, hash: 'd:front',
    })
  })

  it('never says a photograph has stopped having been examined', async () => {
    // "Looked at and declined" is a fact about a photograph and about a moment,
    // and nothing that happens afterwards makes it not have happened.
    const id = await aBook('Dune')
    await captures.record(id, [{
      kind: 'back', file: 'back.jpg', examined: true, takenAt: SHOT_AT,
    }])
    await captures.record(id, [{
      kind: 'back', file: 'back.jpg', examined: false, takenAt: SHOT_AT,
    }])

    const photograph = (await captures.of(id)).latest('back')!
    expect(verdictOf(photograph)).toBe('declined')
  })

  it('does not let a repeat move when a photograph was taken or what it is of', async () => {
    const id = await aBook('Dune')
    await captures.record(id, [{ kind: 'front', file: 'front.jpg', takenAt: SHOT_AT }])
    await captures.record(id, [{
      kind: 'catalogue', file: 'front.jpg', takenAt: '2030-01-01T00:00:00.000Z',
    }])

    expect((await captures.of(id)).list[0]).toMatchObject({
      kind: 'front', takenAt: SHOT_AT,
    })
  })
})

describe('reading a book back', () => {
  it('answers newest first within a kind, and by insertion order on a tie', async () => {
    const id = await aBook('Dune')
    // The tie is the normal case, not a corner: every row the migration writes
    // carries books.scanned_at, which was one value for all three slots.
    await captures.record(id, [
      { kind: 'front', file: 'a.jpg', takenAt: SHOT_AT },
      { kind: 'front', file: 'b.jpg', takenAt: SHOT_AT },
      { kind: 'front', file: 'c.jpg', takenAt: '2026-09-01T00:00:00.000Z' },
    ])

    expect((await captures.of(id)).ofKind('front').map((one) => one.file))
      .toEqual(['c.jpg', 'a.jpg', 'b.jpg'])
  })

  it('answers an empty set for a book nobody has photographed', async () => {
    expect((await captures.of(await aBook('Dune'))).count).toBe(0)
  })

  it('takes a book\'s photographs with the book', async () => {
    // `ON DELETE cascade`, and there is deliberately no other way to remove a
    // capture row. See the note on `CaptureRepository`.
    const id = await aBook('Dune')
    await captures.record(id, [{ kind: 'front', file: 'front.jpg', takenAt: SHOT_AT }])
    await db.run('DELETE FROM books WHERE id = ?', [id])

    const left = await db.get<{ count: string }>('SELECT count(*)::text AS count FROM capture')
    expect(left?.count).toBe('0')
  })

  it('refuses a kind that is not one rather than handing it to the domain', async () => {
    // `kind` is a text column with no check constraint, so a value nothing in
    // this codebase writes could be in it. A blind cast would push the problem
    // somewhere far away from the row that caused it.
    const id = await aBook('Dune')
    await db.run(
      `INSERT INTO capture (book_id, kind, file, taken_at) VALUES (?, 'edge', 'e.jpg', ?)`,
      [id, SHOT_AT],
    )
    await expect(captures.of(id)).rejects.toThrow(/not a kind/)
  })
})

describe('the handler over the top', () => {
  it('drops the slots a book has no photograph in', async () => {
    // The columns it is fed from default to '' rather than to null, so an empty
    // slot arrives as an empty string.
    const id = await aBook('Dune')
    await new RecordPhotographsHandler(captures).handle({
      bookId: id,
      photographs: [
        { kind: 'front', file: 'front.jpg', takenAt: SHOT_AT },
        { kind: 'back', file: '', takenAt: SHOT_AT },
      ],
    })

    expect((await captures.of(id)).kinds()).toEqual(['front'])
  })

  it('writes nothing at all for a book with no photographs', async () => {
    const id = await aBook('Dune')
    await new RecordPhotographsHandler(captures).handle({ bookId: id, photographs: [] })
    expect((await captures.of(id)).count).toBe(0)
  })
})

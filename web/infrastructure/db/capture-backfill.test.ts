/**
 * The migration that turns the eight image columns on `books` into rows in
 * `capture`, run on a database in the state the owner's catalogue is in.
 *
 * That state is specific and it is why this file exists rather than a paragraph
 * in a pull request: the live catalogue was built by `applySchema` during stage
 * H and has never had a migration recorded against it, so a run there **adopts**
 * the baseline and then applies everything after it. That is what is done below,
 * on a database seeded here.
 *
 * The claim that has to be checked by a machine is that **no photograph is
 * lost**. There are 236 books in the live catalogue and every file any of those
 * columns names has to end up as exactly one capture row. The migration counts
 * that itself and refuses to finish when the numbers disagree; this file proves
 * both halves of that, the passing one and the failing one, on a catalogue
 * shaped like the real one.
 *
 * Nothing in this file, or in the migration it exercises, connects to anything
 * but a scratch database this test made, and nothing anywhere reads, writes or
 * deletes a cover file. The migration moves rows.
 */

import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { SCHEMA } from '../../server/db.pg'
import { migrateToLatest } from './migrate'
import { dropScratchDatabases, scratchDatabase } from './testdb'

afterAll(async () => {
  await dropScratchDatabases()
})

interface Seed {
  title: string
  frontImage?: string
  backImage?: string
  edgeImage?: string
  coverImage?: string
  frontCrop?: string
  backCrop?: string
  edgeCrop?: string
  /** The comma separated slot list, exactly as `books.cropped` holds it. */
  cropped?: string
  frontHash?: string
  coverHash?: string
  coverCheckedAt?: string | null
  scannedAt?: string
}

/**
 * A database with the pre-Drizzle schema and some photographed books in it.
 *
 * `SCHEMA` rather than `applySchema`, which runs the migrations itself and
 * would hand back a database that had already had this one. `SCHEMA` is the
 * fixed point the baseline is proved against, and it is what stage H left on
 * the live catalogue.
 */
async function catalogueOf(books: Seed[]): Promise<pg.Pool> {
  const pool = await scratchDatabase()
  await pool.query(SCHEMA)

  for (const [at, book] of books.entries()) {
    await pool.query(
      `INSERT INTO books (
         title, shelf_range, is_fiction, sort_key, scanned_at,
         front_image, back_image, edge_image, cover_image,
         front_crop, back_crop, edge_crop, cropped,
         front_hash, cover_hash, cover_checked_at
       ) VALUES ($1, 'fiction', 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        book.title,
        `key-${String(at).padStart(4, '0')}`,
        book.scannedAt ?? '2026-01-02T03:04:05.000Z',
        book.frontImage ?? '',
        book.backImage ?? '',
        book.edgeImage ?? '',
        book.coverImage ?? '',
        book.frontCrop ?? '',
        book.backCrop ?? '',
        book.edgeCrop ?? '',
        book.cropped ?? '',
        book.frontHash ?? '',
        book.coverHash ?? '',
        book.coverCheckedAt ?? null,
      ],
    )
  }
  return pool
}

interface CaptureRow {
  title: string
  kind: string
  file: string
  crop_file: string
  examined: boolean
  hash: string
  taken_at: string
}

async function capturesOf(pool: pg.Pool): Promise<CaptureRow[]> {
  const rows = await pool.query<CaptureRow>(
    `SELECT b.title, c.kind, c.file, c.crop_file, c.examined, c.hash, c.taken_at
       FROM capture c JOIN books b ON b.id = c.book_id
      ORDER BY b.title, c.kind, c.file`,
  )
  return rows.rows
}

describe('the image columns becoming capture rows', () => {
  it('gives every photograph a row of its own, with the crop beside it', async () => {
    const pool = await catalogueOf([{
      title: 'Dune',
      frontImage: 'front.jpg', backImage: 'back.jpg', edgeImage: 'edge.jpg',
      coverImage: 'cover.jpg',
      frontCrop: 'front_crop.jpg', edgeCrop: 'edge_crop.jpg',
      cropped: 'front,back,edge',
      frontHash: 'd:front', coverHash: 'd:cover',
      coverCheckedAt: '2026-02-03T00:00:00.000Z',
      scannedAt: '2026-01-02T03:04:05.000Z',
    }])

    // Adopted, because this database has the baseline tables and has never been
    // migrated. That is the path the real catalogue would take.
    expect(await migrateToLatest(pool)).toBe('adopted')

    expect(await capturesOf(pool)).toEqual([
      {
        title: 'Dune', kind: 'back', file: 'back.jpg', crop_file: '',
        // Named in `cropped` with an empty crop column: the detector looked at
        // this photograph and could not find the book in it.
        examined: true, hash: '', taken_at: '2026-01-02T03:04:05.000Z',
      },
      {
        title: 'Dune', kind: 'catalogue', file: 'cover.jpg', crop_file: '',
        examined: false, hash: 'd:cover',
        // The artwork is dated from when it was fetched, not from the scan.
        taken_at: '2026-02-03T00:00:00.000Z',
      },
      {
        title: 'Dune', kind: 'front', file: 'front.jpg', crop_file: 'front_crop.jpg',
        examined: true, hash: 'd:front', taken_at: '2026-01-02T03:04:05.000Z',
      },
      {
        // `edge` becomes `spine`. The column name does not survive the move.
        title: 'Dune', kind: 'spine', file: 'edge.jpg', crop_file: 'edge_crop.jpg',
        examined: true, hash: '', taken_at: '2026-01-02T03:04:05.000Z',
      },
    ])
  })

  it('keeps "looked at and declined" apart from "never looked at"', async () => {
    /*
     * The distinction the whole `examined` column exists for, and the one this
     * migration is most able to quietly destroy. Two books, each with a front
     * photograph and no crop, and they are not the same fact: one has been
     * through the detector, which found nothing, and one has never been opened.
     * Only the first licenses a caption to say the book could not be picked out
     * of the photo.
     */
    const pool = await catalogueOf([
      { title: 'Declined', frontImage: 'a.jpg', frontCrop: '', cropped: 'front' },
      { title: 'Never looked at', frontImage: 'b.jpg', frontCrop: '', cropped: '' },
    ])
    await migrateToLatest(pool)

    expect((await capturesOf(pool)).map((row) => `${row.title} ${row.examined}`))
      .toEqual(['Declined true', 'Never looked at false'])
  })

  it('does not call a slot examined because another slot on the book was', async () => {
    // `books.cropped` is one string per row describing three photographs, so a
    // reader that asked "is this row cropped" rather than "is this slot in the
    // list" would answer yes for all three. That is the smearing this table
    // undoes, and it would look exactly like a working migration.
    const pool = await catalogueOf([{
      title: 'Dune',
      frontImage: 'front.jpg', backImage: 'back.jpg', edgeImage: 'edge.jpg',
      frontCrop: 'front_crop.jpg', cropped: 'front',
    }])
    await migrateToLatest(pool)

    expect((await capturesOf(pool)).map((row) => `${row.kind} ${row.examined}`))
      .toEqual(['back false', 'front true', 'spine false'])
  })

  it('loses no photograph across a catalogue the size of the real one', async () => {
    /*
     * 236 books, which is what the live catalogue holds, photographed the way
     * a real one is: not every book has every slot, and the covers were
     * downloaded for some and not for others. The assertion is the one the
     * issue asks for, made from the columns rather than from a number written
     * down here, so it cannot drift from the fixture.
     */
    const seeds: Seed[] = Array.from({ length: 236 }, (_, at) => ({
      title: `Book ${String(at).padStart(3, '0')}`,
      frontImage: `front-${at}.jpg`,
      backImage: at % 3 === 0 ? `back-${at}.jpg` : '',
      edgeImage: at % 2 === 0 ? `edge-${at}.jpg` : '',
      coverImage: at % 4 === 0 ? `cover-${at}.jpg` : '',
      frontCrop: at % 5 === 0 ? `front-${at}_crop.jpg` : '',
      cropped: at % 5 === 0 ? 'front' : at % 7 === 0 ? 'front,edge' : '',
    }))
    const pool = await catalogueOf(seeds)
    await migrateToLatest(pool)

    const counted = await pool.query<{ named: string; rows: string; crops: string; carried: string }>(
      `SELECT
         (SELECT count(*) FROM (
            SELECT id, front_image AS f FROM books WHERE front_image <> ''
            UNION SELECT id, back_image FROM books WHERE back_image <> ''
            UNION SELECT id, edge_image FROM books WHERE edge_image <> ''
            UNION SELECT id, cover_image FROM books WHERE cover_image <> ''
          ) named)::text AS named,
         (SELECT count(*) FROM capture)::text AS rows,
         (SELECT count(*) FROM books WHERE front_crop <> '')::text AS crops,
         (SELECT count(*) FROM capture WHERE crop_file <> '')::text AS carried`,
    )

    const { named, rows, crops, carried } = counted.rows[0]!
    // 236 fronts, 79 backs, 118 spines and 59 covers: 492 photographs, 492 rows.
    expect(rows).toBe(named)
    expect(rows).toBe('492')
    expect(carried).toBe(crops)
    expect(carried).toBe('48')
  })

  it('refuses to finish when a crop names a file no photograph does', async () => {
    /*
     * The loud failure, watched rather than asserted about. A crop column with
     * a filename in it and an empty photograph column beside it is a file no
     * capture row can reach, so it would be lost silently. It should not be
     * possible: `cropPhotos` only writes a crop for a photograph it has just
     * read. If it happens anyway, this is a startup that stops and says so,
     * which is recoverable, rather than a catalogue that quietly has fewer
     * photographs in it than it did.
     */
    const pool = await catalogueOf([
      { title: 'A crop with no photograph', frontImage: '', frontCrop: 'orphan_crop.jpg' },
    ])

    await expect(migrateToLatest(pool)).rejects.toThrow(/would have lost a crop/)

    // Refused as a whole. Nothing was half written.
    const survived = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables " +
      "WHERE table_schema = 'public' AND table_name = 'capture'",
    )
    expect(survived.rows[0]?.count).toBe('0')
  })

  it('leaves every column it read exactly as it was', async () => {
    // Nothing is dropped by this migration. Those columns are still what the
    // gallery, the crop backfill and the shelf row read, and a run that lost
    // one would be a run that blanked somebody's shelf.
    const pool = await catalogueOf([{
      title: 'Dune',
      frontImage: 'front.jpg', backImage: 'back.jpg', edgeImage: 'edge.jpg',
      coverImage: 'cover.jpg', frontCrop: 'front_crop.jpg', cropped: 'front',
      frontHash: 'd:front', coverHash: 'd:cover',
    }])
    await migrateToLatest(pool)

    const row = await pool.query(
      `SELECT front_image, back_image, edge_image, cover_image,
              front_crop, back_crop, edge_crop, cropped, front_hash, cover_hash
         FROM books`,
    )
    expect(row.rows[0]).toEqual({
      front_image: 'front.jpg', back_image: 'back.jpg', edge_image: 'edge.jpg',
      cover_image: 'cover.jpg', front_crop: 'front_crop.jpg', back_crop: '',
      edge_crop: '', cropped: 'front', front_hash: 'd:front', cover_hash: 'd:cover',
    })
  })

  it('leaves the queue table and its three image columns alone', async () => {
    /*
     * Stated as a test because it is a scope decision somebody will want to
     * check rather than take on trust. `captures.book_id` is nullable, and
     * `capture.book_id` is not: a queue row nobody has confirmed yet has
     * photographs and no book to hang them on, and giving it one needs the
     * state model #183 is about. See the head of the migration.
     */
    const pool = await catalogueOf([])
    await pool.query(
      `INSERT INTO captures (status, front_image, back_image, edge_image, cropped, created_at)
       VALUES ('pending', 'q_front.jpg', 'q_back.jpg', 'q_edge.jpg', 'front', '2026-01-01')`,
    )
    await migrateToLatest(pool)

    const queue = await pool.query<{ front_image: string; cropped: string }>(
      'SELECT front_image, cropped FROM captures',
    )
    expect(queue.rows[0]).toEqual({ front_image: 'q_front.jpg', cropped: 'front' })
    expect(await capturesOf(pool)).toEqual([])
  })

  it('is not run twice on a database that has already had it', async () => {
    const pool = await catalogueOf([{
      title: 'Dune', frontImage: 'front.jpg', frontCrop: 'front_crop.jpg', cropped: 'front',
    }])
    await migrateToLatest(pool)
    const after = await capturesOf(pool)

    expect(await migrateToLatest(pool)).toBe('migrated')
    expect(await capturesOf(pool)).toEqual(after)
  })

  it('says nothing about a catalogue with no photographs in it', async () => {
    const pool = await catalogueOf([{ title: 'Never photographed' }])
    await migrateToLatest(pool)
    expect(await capturesOf(pool)).toEqual([])
  })
})

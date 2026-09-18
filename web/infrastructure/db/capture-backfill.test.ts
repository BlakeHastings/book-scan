/**
 * The migration that turns the eight image columns on `books` into rows in
 * `capture`, run on a database in the state the owner's catalogue is in:
 * built by `applySchema` and never migrated, so a run here adopts the
 * baseline and then applies everything after it.
 *
 * The claim checked by a machine is that no photograph is lost: every file
 * any of those columns names has to end up as exactly one capture row. The
 * migration counts that itself and refuses to finish when the numbers
 * disagree; this file proves both halves of that, the passing one and the
 * failing one, on a catalogue shaped like the real one.
 *
 * Nothing in this file, or in the migration it exercises, connects to
 * anything but a scratch database this test made.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { SCHEMA } from '../../server/db.pg'
import { migrateToLatest } from './migrate'
import { closeScratchDatabases, scratchDatabase } from './testdb'

afterAll(async () => {
  await closeScratchDatabases()
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
 * Uses `SCHEMA` rather than `applySchema`, which runs the migrations itself
 * and would hand back a database that had already had this one.
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

    // Adopted: this database has the baseline tables and has never been migrated.
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
    // Two books, each with a front photograph and no crop: one has been
    // through the detector, which found nothing, and one has never been
    // opened. Only the first licenses a caption saying the book could not
    // be picked out of the photo.
    const pool = await catalogueOf([
      { title: 'Declined', frontImage: 'a.jpg', frontCrop: '', cropped: 'front' },
      { title: 'Never looked at', frontImage: 'b.jpg', frontCrop: '', cropped: '' },
    ])
    await migrateToLatest(pool)

    expect((await capturesOf(pool)).map((row) => `${row.title} ${row.examined}`))
      .toEqual(['Declined true', 'Never looked at false'])
  })

  it('does not call a slot examined because another slot on the book was', async () => {
    // `books.cropped` is one string per row describing three photographs,
    // so a reader that asked "is this row cropped" rather than "is this
    // slot in the list" would answer yes for all three.
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
    // A catalogue photographed the way a real one is: not every book has
    // every slot, and covers were downloaded for some and not others. The
    // assertion below is built from the columns rather than a number
    // written down here, so it cannot drift from the fixture.
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

    // Counted from the fixture rather than from the columns, since `0019`
    // drops them by the time this test can ask; the numbers still come
    // from the seeds above.
    const namedByColumns = new Set(seeds.flatMap((seed, at) => [
      `${at}:${seed.frontImage}`,
      seed.backImage ? `${at}:${seed.backImage}` : '',
      seed.edgeImage ? `${at}:${seed.edgeImage}` : '',
      seed.coverImage ? `${at}:${seed.coverImage}` : '',
    ].filter(Boolean)))
    const cropsByColumns = seeds.filter((seed) => seed.frontCrop).length

    const counted = await pool.query<{ rows: string; carried: string }>(
      `SELECT (SELECT count(*) FROM capture)::text AS rows,
              (SELECT count(*) FROM capture WHERE crop_file <> '')::text AS carried`,
    )

    const { rows, carried } = counted.rows[0]!
    expect(rows).toBe(String(namedByColumns.size))
    expect(rows).toBe('492')
    expect(carried).toBe(String(cropsByColumns))
    expect(carried).toBe('48')
  })

  it('refuses to finish when a crop names a file no photograph does', async () => {
    // A crop naming a file with no photograph column beside it is a file no
    // capture row could reach; `cropPhotos` should never write one, but if
    // it happens the migration refuses rather than losing it silently.
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

  it('leaves nothing on books for anything to read a photograph from', async () => {
    // `0019` drops the ten columns that fed the gallery, the crop backfill
    // and the shelf row; by then everything reads `capture` instead.
    const pool = await catalogueOf([{
      title: 'Dune',
      frontImage: 'front.jpg', backImage: 'back.jpg', edgeImage: 'edge.jpg',
      coverImage: 'cover.jpg', frontCrop: 'front_crop.jpg', cropped: 'front',
      frontHash: 'd:front', coverHash: 'd:cover',
    }])
    await migrateToLatest(pool)

    const left = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'books'
          AND column_name IN ('front_image', 'back_image', 'edge_image',
                              'cover_image', 'front_hash', 'cover_hash',
                              'front_crop', 'back_crop', 'edge_crop', 'cropped')`,
    )
    expect(left.rows).toEqual([])

    expect(await capturesOf(pool)).toEqual([
      {
        title: 'Dune', kind: 'back', file: 'back.jpg', crop_file: '',
        examined: false, hash: '', taken_at: '2026-01-02T03:04:05.000Z',
      },
      {
        title: 'Dune', kind: 'catalogue', file: 'cover.jpg', crop_file: '',
        examined: false, hash: 'd:cover', taken_at: '2026-01-02T03:04:05.000Z',
      },
      {
        title: 'Dune', kind: 'front', file: 'front.jpg', crop_file: 'front_crop.jpg',
        examined: true, hash: 'd:front', taken_at: '2026-01-02T03:04:05.000Z',
      },
      {
        title: 'Dune', kind: 'spine', file: 'edge.jpg', crop_file: '',
        examined: false, hash: '', taken_at: '2026-01-02T03:04:05.000Z',
      },
    ])
  })

  it('leaves the queue table alone, and 0011 is what answers for its photographs', async () => {
    // This migration deliberately migrates nothing out of the queue table:
    // `captures.book_id` is nullable and `capture.book_id` is not, and an
    // unconfirmed queue row has photographs and no book to hang them on.
    // `0011` is where that resolves, by making the queue row a book.
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

    expect((await capturesOf(pool)).map((row) => [row.kind, row.file]))
      .toEqual([['back', 'q_back.jpg'], ['front', 'q_front.jpg'], ['spine', 'q_edge.jpg']])
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

/**
 * The repair `0017` owes, and the refusal `0019` makes.
 *
 * These cover a window when capture rows were written by two save routes
 * only: the cover backfill, the hash backfill and two command line tools
 * wrote a column directly and recorded nothing, so a book touched by one of
 * them has the column and no matching photograph row.
 *
 * The chain is applied by hand up to a point, since `migrateToLatest` runs
 * the whole folder and there is nothing left to repair after `0006` or to
 * repair from after `0019`. `migrate.test.ts` reads the folder the same way
 * for the baseline.
 */

const migrationsDir = fileURLToPath(new URL('./migrations/', import.meta.url))

async function applyFile(pool: pg.Pool, file: string): Promise<void> {
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) await pool.query(statement)
  }
}

/** Every migration file in order, up to and including the one named. */
async function applyThrough(pool: pg.Pool, last: string): Promise<pg.Pool> {
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
  for (const file of files) {
    await applyFile(pool, file)
    if (file.startsWith(last)) return pool
  }
  throw new Error(`no migration numbered ${last}`)
}

/** The one file, found by its number, so a rename does not silently skip it. */
function migrationNumbered(number: string): string {
  const found = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql')).sort()
    .find((name) => name.startsWith(number))
  if (!found) throw new Error(`no migration numbered ${number}`)
  return found
}

/**
 * A book with photographs in its columns and whichever of them the
 * write-through missed left out of `capture`. `recorded` names the columns
 * that did become rows: the ones a save wrote, not a column a background
 * job wrote afterwards.
 */
async function drifted(
  pool: pg.Pool,
  book: Seed & { recorded: ('front' | 'back' | 'spine' | 'catalogue')[] },
): Promise<number> {
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO books (
       title, shelf_range, is_fiction, sort_key, scanned_at,
       front_image, back_image, edge_image, cover_image,
       front_crop, back_crop, edge_crop, cropped, front_hash, cover_hash
     ) VALUES ($1, 'fiction', 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      book.title, `key-${book.title}`, book.scannedAt ?? '2026-01-02T03:04:05.000Z',
      book.frontImage ?? '', book.backImage ?? '', book.edgeImage ?? '',
      book.coverImage ?? '', book.frontCrop ?? '', book.backCrop ?? '',
      book.edgeCrop ?? '', book.cropped ?? '', book.frontHash ?? '', book.coverHash ?? '',
    ],
  )
  const id = inserted.rows[0]!.id

  const files: Record<string, string | undefined> = {
    front: book.frontImage, back: book.backImage,
    spine: book.edgeImage, catalogue: book.coverImage,
  }
  for (const kind of book.recorded) {
    await pool.query(
      `INSERT INTO capture (book_id, kind, file, crop_file, examined, hash, taken_at)
       VALUES ($1, $2, $3, '', false, '', $4)`,
      [id, kind, files[kind], book.scannedAt ?? '2026-01-02T03:04:05.000Z'],
    )
  }
  return id
}

describe('the photographs the write-through missed', () => {
  it('gives a row to a photograph a column names and nothing recorded', async () => {
    const pool = await applyThrough(await scratchDatabase(), '0016')
    // The exact shape of the drift: a save recorded the front, and the cover
    // backfill wrote `cover_image` afterwards without recording anything.
    await drifted(pool, {
      title: 'Dune', frontImage: 'front.jpg', coverImage: 'cover.jpg',
      coverHash: 'd:cover', coverCheckedAt: '2026-03-04T00:00:00.000Z',
      recorded: ['front'],
    })

    await applyFile(pool, migrationNumbered('0017'))

    expect((await capturesOf(pool)).map((row) => [row.kind, row.file, row.hash]))
      .toEqual([['catalogue', 'cover.jpg', 'd:cover'], ['front', 'front.jpg', '']])
  })

  it('carries a crop and a hash onto a row that was written without them', async () => {
    // The other half of the same window, which a count of rows would miss:
    // `rehash-covers` and `crop-books` wrote a hash and a crop onto a row
    // that already existed, so the row is there but missing what the
    // column knows.
    const pool = await applyThrough(await scratchDatabase(), '0016')
    await drifted(pool, {
      title: 'Dune', frontImage: 'front.jpg',
      frontCrop: 'front_crop.jpg', cropped: 'front', frontHash: 'd:front',
      recorded: ['front'],
    })

    await applyFile(pool, migrationNumbered('0017'))

    expect(await capturesOf(pool)).toEqual([{
      title: 'Dune', kind: 'front', file: 'front.jpg',
      crop_file: 'front_crop.jpg', examined: true, hash: 'd:front',
      taken_at: '2026-01-02T03:04:05.000Z',
    }])
  })

  it('keeps "looked at and declined" apart from "never looked at", both ways', async () => {
    // Checked through the repair in both directions: the column says a
    // detector was shown the front and not the back, and the repair must
    // make the first `examined` and must not make the second one.
    const pool = await applyThrough(await scratchDatabase(), '0016')
    await drifted(pool, {
      title: 'Dune', frontImage: 'front.jpg', backImage: 'back.jpg',
      cropped: 'front', recorded: ['front', 'back'],
    })

    await applyFile(pool, migrationNumbered('0017'))

    expect((await capturesOf(pool)).map((row) => `${row.kind} ${row.examined}`))
      .toEqual(['back false', 'front true'])
  })

  it('changes nothing on a second run', async () => {
    const pool = await applyThrough(await scratchDatabase(), '0016')
    await drifted(pool, {
      title: 'Dune', frontImage: 'front.jpg', coverImage: 'cover.jpg', recorded: ['front'],
    })

    await applyFile(pool, migrationNumbered('0017'))
    const after = await capturesOf(pool)
    await applyFile(pool, migrationNumbered('0017'))

    expect(await capturesOf(pool)).toEqual(after)
  })
})

describe('dropping the image columns', () => {
  it('refuses rather than dropping a photograph nothing else records', async () => {
    // A column naming a file with no capture row behind it is a photograph
    // about to become unreachable, with no second copy to recover it from.
    const pool = await applyThrough(await scratchDatabase(), '0018')
    await drifted(pool, { title: 'Dune', frontImage: 'front.jpg', recorded: [] })

    await expect(applyFile(pool, migrationNumbered('0019')))
      .rejects.toThrow(/refusing to drop the image columns/)

    // Refused as a whole. The columns are still there and so is the photograph.
    const left = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'books'
          AND column_name = 'front_image'`,
    )
    expect(left.rows[0]?.count).toBe('1')
  })

  it('refuses rather than losing that a detector was shown a photograph', async () => {
    // `examined` is what the caption rests on; a row that disagrees with
    // the column about to be dropped would lose that fact rather than move it.
    const pool = await applyThrough(await scratchDatabase(), '0018')
    await drifted(pool, {
      title: 'Dune', frontImage: 'front.jpg', cropped: 'front', recorded: ['front'],
    })
    await pool.query("UPDATE capture SET examined = false")

    await expect(applyFile(pool, migrationNumbered('0019')))
      .rejects.toThrow(/a detector was shown have no row saying so/)
  })
})

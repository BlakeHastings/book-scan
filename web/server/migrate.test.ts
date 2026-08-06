/**
 * The stage H migration, and the verification that is the actual deliverable.
 *
 * Two halves, and the second is the one that matters. Anybody can move rows.
 * What makes moving somebody's irreplaceable catalogue safe is being able to
 * demonstrate afterwards that nothing changed, so most of what is below breaks
 * the migrated copy on purpose and asserts that the verification says so. A
 * check that has only ever been seen to pass proves nothing, which is the rule
 * this repository already states about regression tests, and it applies with
 * more force here than anywhere else in the codebase: this is the check
 * standing between the owner and a silently corrupted catalogue.
 *
 * Runs only in the `postgres` project, because it is inherently about both
 * databases at once: SQLite in memory on one side, a real Postgres on the
 * other. See vitest.config.ts.
 */

import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './db'
import type { Db } from './driver'
import {
  checkSchemas,
  migrateCatalogue,
  targetHoldsData,
  verifyCatalogue,
  type VerifyReport,
} from './migrate'
import { Store } from './store'
import { closeTestDatabase, openTestDatabase } from './testdb'

let source: Db
let target: Db
let sourceStore: Store

beforeEach(async () => {
  // `:memory:` on the source side, exactly as every other database test opens
  // one. The migration reads it and never writes to it, so it does not need to
  // be a file for anything asserted here.
  source = openDatabase(':memory:')
  sourceStore = new Store(source)
  target = await openTestDatabase()
})

afterEach(async () => {
  await source.close()
})

afterAll(closeTestDatabase)

/**
 * A directory known to contain one known file, for the cover check. Nothing is
 * written: the check only asks whether a filename resolves to something on
 * disk, so a font shipped with the fixtures answers that question as well as a
 * photograph would and leaves no temporary files behind.
 */
const COVER_DIR = fileURLToPath(new URL('./fixtures-assets/', import.meta.url))
const PRESENT = 'Gelasio-Regular.ttf'
const ABSENT = 'no-such-cover.jpg'

/**
 * The ordering hazards, taken from the fixture in store.test.ts that guards the
 * same property. `Smith, Zoe` before `Smithers, Ed` is the discriminating pair:
 * a linguistic collation puts them the other way round.
 */
const FIXTURE: { title: string; authors: string[] }[] = [
  { title: 'Nana', authors: ['Émile Zola'] },
  { title: 'Alpha', authors: ['Ed Smithers'] },
  { title: 'Zenith', authors: ['Zoe Smith'] },
  { title: 'Beta', authors: ["Ann O'Brien"] },
  { title: 'The Alpha', authors: ["Ann O'Brien"] },
  { title: 'Chapter 10', authors: ['Ian McEwan'] },
  { title: 'Chapter 2', authors: ['Ian McEwan'] },
  { title: 'Flowers in the Attic', authors: ['V.C. Andrews'] },
]

/**
 * A catalogue with one of everything the real one has: books in both ranges, a
 * series with a fractional index, ordered authors, a separator anchored to a
 * real sort key, a filing override, and a capture that became a book.
 */
async function seedSource(): Promise<void> {
  for (const book of FIXTURE) {
    await sourceStore.addBook({ title: book.title, authors: book.authors, isFiction: true })
  }
  await sourceStore.addBook({
    title: 'A History of Bees',
    authors: ['Maja Lunde'],
    isFiction: false,
    seriesName: 'Climate Quartet',
    seriesIndex: 1.5,
    frontImage: PRESENT,
  })

  await source.run(
    `INSERT INTO author_filing (display_key, filing_name, is_corporate, note)
     VALUES (?, ?, ?, ?)`,
    ['ursula k le guin', 'Le Guin, Ursula K', 0, 'not Guin'],
  )

  const anchor = await source.get<{ sort_key: string }>(
    "SELECT sort_key FROM books WHERE title = 'Zenith'",
  )
  await source.run(
    `INSERT INTO separators (shelf_range, kind, starts_at, position, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['fiction', 'shelf', anchor!.sort_key, 0, '', '2026-08-01T10:00:00.000Z'],
  )

  await source.run(
    `INSERT INTO captures (status, front_image, isbn13, book_id, created_at, processed_at,
                           cropped, front_crop, edited_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['done', PRESENT, '9780000000001', 1, '2026-08-01T10:00:00.000Z',
     '2026-08-01T10:00:05.000Z', 'front', '', null],
  )
}

const verify = (): Promise<VerifyReport> =>
  verifyCatalogue(source, target, { coverDir: COVER_DIR })

describe('moving a catalogue into Postgres', () => {
  beforeEach(seedSource)

  it('agrees on every table and every column before it writes anything', async () => {
    expect(await checkSchemas(source, target)).toEqual([])
  })

  it('refuses a source that is missing a column the target has', async () => {
    // The source has to have been brought forward by the SQLite code path
    // first. A column the target has and the source does not would arrive
    // carrying a default nobody chose, which is a value invented during a
    // migration and indistinguishable afterwards from one somebody set.
    await source.run('ALTER TABLE books DROP COLUMN notes')
    const problems = await checkSchemas(source, target)
    expect(problems.join('\n')).toContain('notes')
    expect(problems.join('\n')).toContain('addMissingColumns')
  })

  it('carries every row across and says so', async () => {
    const result = await migrateCatalogue(source, target)
    expect(result.read).toEqual({
      shelf_ranges: 2, author_filing: 1, books: 9, book_authors: 9,
      captures: 1, separators: 1,
    })
    expect(result.written).toEqual(result.read)

    const report = await verify()
    expect(report.problems).toEqual([])
    expect(report.tables.map((t) => [t.table, t.sourceRows, t.targetRows])).toEqual([
      ['shelf_ranges', 2, 2], ['author_filing', 1, 1], ['books', 9, 9],
      ['book_authors', 9, 9], ['captures', 1, 1], ['separators', 1, 1],
    ])
    for (const table of report.tables) {
      expect(table.sourceDigest).toEqual(table.targetDigest)
    }
  })

  it('keeps the ids, because the covers and the joins are keyed on them', async () => {
    await migrateCatalogue(source, target)
    const ids = await target.all<{ id: number; title: string }>(
      'SELECT id, title FROM books ORDER BY id',
    )
    const before = await source.all<{ id: number; title: string }>(
      'SELECT id, title FROM books ORDER BY id',
    )
    expect(ids).toEqual(before)
    // The capture points at book 1 and has to keep pointing at the same book.
    const capture = await target.get<{ book_id: number }>('SELECT book_id FROM captures')
    expect(capture?.book_id).toBe(1)
  })

  it('restarts the identity sequences, so the next scan does not collide', async () => {
    await migrateCatalogue(source, target)
    const report = await verify()
    expect(report.sequences).toEqual([
      { table: 'books', maxId: 9, nextId: 10, ok: true },
      { table: 'captures', maxId: 1, nextId: 2, ok: true },
      { table: 'separators', maxId: 1, nextId: 2, ok: true },
    ])

    // The thing the sequence check is a proxy for: scanning the next book.
    const next = await new Store(target).addBook({
      title: 'The Next One', authors: ['Zoe Smith'], isFiction: true,
    })
    expect(next.id).toBe(10)
  })

  it('notices when the sequence was not restarted', async () => {
    await migrateCatalogue(source, target)
    await target.run('ALTER TABLE books ALTER COLUMN id RESTART WITH 1')
    const report = await verify()
    expect(report.problems.join('\n')).toContain('the next insert collides')
  })
})

describe('what the migration must not silently change', () => {
  beforeEach(seedSource)

  it("keeps '' and NULL apart, which is what says a photo was examined", async () => {
    // The distinction db.ts documents: a slot named in `cropped` whose crop
    // column is '' was looked at and declined. NULL there means nothing ever
    // looked. One becoming the other re-crops a photo forever or claims a
    // judgement nobody made.
    await source.run(
      "UPDATE books SET cropped = 'front', front_crop = '', back_crop = NULL WHERE id = 1",
    )
    await migrateCatalogue(source, target)

    const row = await target.get<{ cropped: string; front_crop: string | null; back_crop: string | null }>(
      'SELECT cropped, front_crop, back_crop FROM books WHERE id = 1',
    )
    expect(row).toEqual({ cropped: 'front', front_crop: '', back_crop: null })
    expect(await verify()).toMatchObject({ problems: [] })
  })

  it('notices an empty string that arrived as a null', async () => {
    await migrateCatalogue(source, target)
    await target.run("UPDATE books SET front_crop = NULL WHERE front_crop = ''")
    const report = await verify()
    expect(report.problems.join('\n')).toContain("front_crop: sqlite str:\"\" != postgres null")
  })

  it('keeps numbers numbers and nulls nulls', async () => {
    await migrateCatalogue(source, target)
    const row = await target.get<Record<string, unknown>>(
      "SELECT id, is_fiction, series_index, checked_out_at FROM books WHERE title = 'A History of Bees'",
    )
    expect(typeof row!.id).toBe('number')
    expect(typeof row!.is_fiction).toBe('number')
    expect(row!.is_fiction).toBe(0)
    expect(row!.series_index).toBe(1.5)
    expect(row!.checked_out_at).toBeNull()

    const timestamp = await target.get<{ scanned_at: unknown }>(
      'SELECT scanned_at FROM books WHERE id = 1',
    )
    // text, not timestamptz: a Date here would change every JSON payload the
    // client reads. See the column note in db.pg.ts.
    expect(typeof timestamp!.scanned_at).toBe('string')
  })

  it('notices a single character that changed in a single cell', async () => {
    await migrateCatalogue(source, target)
    await target.run("UPDATE books SET title = 'Nanb' WHERE title = 'Nana'")
    const report = await verify()
    expect(report.problems.join('\n')).toContain('books id=1 title')
    expect(report.tables.find((t) => t.table === 'books')!.sourceDigest)
      .not.toEqual(report.tables.find((t) => t.table === 'books')!.targetDigest)
  })

  it('notices a row that did not arrive', async () => {
    await migrateCatalogue(source, target)
    await target.run('DELETE FROM book_authors WHERE book_id = 2')
    const report = await verify()
    expect(report.problems.join('\n')).toContain('book_authors: 9 rows in, 8 out')
  })
})

describe('the ordering, which is what a collation gets wrong silently', () => {
  beforeEach(seedSource)

  it('comes out of both databases in the same order, position by position', async () => {
    await migrateCatalogue(source, target)
    const report = await verify()

    expect(report.ordering.disagreements).toEqual([])
    expect(report.ordering.sourceOrder).toEqual(report.ordering.targetOrder)
    expect(report.ordering.sourceOrder).toHaveLength(9)
    for (const declared of report.ordering.declaredCollations) {
      expect(declared.collation).toBe('C')
    }
  })

  it('was compared on a database that could have disagreed', async () => {
    // The negative control, and without it the assertion above is decoration.
    // A byte order database orders every column correctly whatever the column
    // says, so COLLATE "C" could be deleted from the schema with nothing
    // noticing until a managed Postgres handed the app a linguistic collation.
    await migrateCatalogue(source, target)
    const report = await verify()

    expect(report.ordering.collationIsLinguistic).toBe(true)
    expect(report.ordering.controlDisagreements).toBeGreaterThan(0)
    expect(report.ordering.controlExample).toContain('position')
  })

  it('notices one book moved past another', async () => {
    await migrateCatalogue(source, target)
    // Smithers before Smith is exactly what a linguistic collation does to this
    // pair, so this is the failure a wrong collation would produce, injected.
    const smith = await target.get<{ sort_key: string }>(
      "SELECT sort_key FROM books WHERE title = 'Zenith'",
    )
    await target.run(
      "UPDATE books SET sort_key = ? WHERE title = 'Alpha' AND shelf_range = 'fiction'",
      // Sort keys are normalised to upper case, so this is SMITH becoming
      // SMITG: one letter, and Smithers now files ahead of Smith.
      [smith!.sort_key.replace('SMITH', 'SMITG')],
    )
    const report = await verify()
    expect(report.ordering.disagreements.length).toBeGreaterThan(0)
    expect(report.problems.join('\n')).toContain('the shelf order differs')
  })

  it('resolves every shelf boundary to the same book on both sides', async () => {
    await migrateCatalogue(source, target)
    const report = await verify()
    expect(report.ordering.boundaryDisagreements).toBe(0)
    expect(report.ordering.boundaries).toHaveLength(1)
    const boundary = report.ordering.boundaries[0]!
    expect(boundary.sourceFirstBook).toBe(boundary.targetFirstBook)
    expect(boundary.targetFirstBook).not.toBeNull()
  })

  it('notices a boundary that now opens on a different book', async () => {
    await migrateCatalogue(source, target)
    // The separator is asked the same question of both databases, with the
    // source's own anchor, so what is being checked is the comparison and not
    // the row. Moving the book the boundary opens on is therefore the failure
    // this can see: a shelf that now begins one book later.
    await target.run("UPDATE books SET sort_key = 'ZZZZ' WHERE title = 'Zenith'")
    const report = await verify()
    expect(report.ordering.boundaryDisagreements).toBe(1)
    expect(report.problems.join('\n')).toContain('resolve to a different book')
  })
})

describe('the covers, which the database only names', () => {
  beforeEach(seedSource)

  it('passes when every referenced file resolves', async () => {
    await migrateCatalogue(source, target)
    const report = await verify()
    expect(report.covers).toMatchObject({ referenced: 1, present: 1, missing: [] })
    expect(report.problems).toEqual([])
  })

  it('reports a book whose photograph is not where the row says it is', async () => {
    // The rows can be perfect and the book still have no photographs: the
    // database holds a bare filename and the file lives on disk beside it.
    await source.run('UPDATE books SET back_image = ? WHERE id = 1', [ABSENT])
    await migrateCatalogue(source, target)
    const report = await verify()
    expect(report.covers).toMatchObject({
      referenced: 2,
      present: 1,
      missing: [ABSENT],
    })
    expect(report.problems.join('\n')).toContain('cover files are not in')
  })
})

describe('running it more than once', () => {
  beforeEach(seedSource)

  it('leaves a target it has already written to detectable', async () => {
    await migrateCatalogue(source, target)
    expect(await targetHoldsData(target)).toEqual({
      books: 9, book_authors: 9, captures: 1, separators: 1, author_filing: 1,
    })
  })

  it('produces the same catalogue when run again with force', async () => {
    await migrateCatalogue(source, target)
    const first = await verify()
    // The half-finished case cannot be constructed here, because there is no
    // such state: the copy is one transaction, so a failure at any point leaves
    // the target as it was. What can be constructed is the operator's actual
    // recovery, which is to run it again over whatever is there.
    await migrateCatalogue(source, target, { force: true })
    const second = await verify()

    expect(second.problems).toEqual([])
    expect(second.tables.map((t) => t.targetDigest))
      .toEqual(first.tables.map((t) => t.targetDigest))
    // Ids survive a re-run, which is what makes the cover filenames on disk and
    // the captures' book_id still mean what they meant.
    expect(second.ordering.targetOrder).toEqual(first.ordering.targetOrder)
    expect(second.sequences).toEqual(first.sequences)
  })

  it('rolls the whole copy back when one row cannot be written', async () => {
    // The shape of a failure part way through: a book already in the target
    // holds the id the source's first book has, so the copy gets as far as
    // author_filing and the first batch of books and is then refused. Without
    // one transaction around the whole thing, the target would be left holding
    // part of a catalogue, which is the state nobody can reason about at 11pm.
    await new Store(target).addBook({
      title: 'Already Here', authors: ['Ann Author'], isFiction: true,
    })
    const before = await targetHoldsData(target)

    await expect(migrateCatalogue(source, target)).rejects.toThrow()

    expect(await targetHoldsData(target)).toEqual(before)
    expect(await target.get('SELECT title FROM books')).toEqual({ title: 'Already Here' })
  })
})

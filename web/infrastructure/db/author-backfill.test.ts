/**
 * The migration that turns `book_authors` into authors, aliases and credits,
 * run on a database in the state the owner's catalogue is actually in.
 *
 * That state is specific, and it is why this file exists rather than a paragraph
 * in a pull request. The live catalogue was built by `applySchema` during stage
 * H, so a run there **adopts** the baseline and then applies every migration
 * after it. That is what is done below, on a database seeded here, and the
 * counts asserted are the ones a real run would report.
 *
 * The claim this file exists for above all others: **no book moves.** The shelf
 * order is hashed the way `server/backup.ts` hashes it, before and after, and
 * the two are compared. A count does not move when an ordering does, and an
 * ordering that moves is the app telling somebody to put a book in the wrong
 * place.
 *
 * Nothing in this file, or in the migration it exercises, connects to anything
 * but a scratch database this test made.
 */

import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { SCHEMA } from '../../server/db.pg'
import { SHELF_ORDER_SQL } from '../../server/backup'
import { buildSortKey, filingName, titleFiling } from '../../shared/shelving'
import { migrateToLatest } from './migrate'
import { dropScratchDatabases, scratchDatabase } from './testdb'

afterAll(async () => {
  await dropScratchDatabases()
}, 60_000)

interface Seed {
  title: string
  /** As printed on the book, in the order they are printed. */
  authors: string[]
  /** What the app filed it under, when that is not what the heuristic gives. */
  filingOverride?: string
  /** A book carried over with no `book_authors` rows, the way stage H could. */
  withoutCredits?: boolean
}

/**
 * A database with the pre-Drizzle schema and some books in it.
 *
 * `SCHEMA` rather than `applySchema`, which runs the migrations itself and would
 * hand back a database that had already had this one. `SCHEMA` is the fixed
 * point the baseline is proved against, and it is what stage H left on the live
 * catalogue.
 *
 * The filing name and the sort key are computed here by the same functions the
 * server computes them with, so the rows are the rows the app would have
 * written rather than fixtures that happen to look like them.
 *
 * Two statements however many books, and ids supplied rather than generated.
 * A round trip per row is what it was, and against a container shared by a dozen
 * test files that is enough to blow through vitest's five second default while
 * proving nothing extra.
 */
async function catalogueOf(books: Seed[]): Promise<pg.Pool> {
  const pool = await scratchDatabase()
  await pool.query(SCHEMA)
  if (!books.length) return pool

  const seeded = books.map((book, at) => {
    const printed = book.authors.filter((name) => name.trim())
    const filing = book.filingOverride ?? filingName(printed[0] ?? '')
    return { id: at + 1, book, printed, filing }
  })

  await pool.query(
    `INSERT INTO books (id, title, authors, shelf_range, is_fiction, author_filing,
                        title_filing, sort_key, scanned_at)
     SELECT seed.id, seed.title, seed.authors, 'fiction', 1, seed.filing,
            seed.title_filing, seed.sort_key, '2026-01-02T03:04:05.000Z'
       FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
         AS seed(id, title, authors, filing, title_filing, sort_key)`,
    [
      seeded.map((one) => one.id),
      seeded.map((one) => one.book.title),
      seeded.map((one) => one.printed.join(', ')),
      seeded.map((one) => one.filing),
      seeded.map((one) => titleFiling(one.book.title)),
      seeded.map((one) => buildSortKey({ authorFiling: one.filing, title: one.book.title })),
    ],
  )

  const credits = seeded.flatMap((one) => (one.book.withoutCredits
    ? []
    : one.printed.map((name, at) => ({ id: one.id, position: at + 1, name }))))
  if (credits.length) {
    await pool.query(
      `INSERT INTO book_authors (book_id, position, name)
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[])`,
      [
        credits.map((one) => one.id),
        credits.map((one) => one.position),
        credits.map((one) => one.name),
      ],
    )
  }
  return pool
}

/** The vocabulary, as `display name | filing name | corporate | primary`. */
async function aliasesOf(pool: pg.Pool): Promise<string[]> {
  const rows = await pool.query<{ line: string }>(
    `SELECT al.display_name || ' | ' || al.filing_name || ' | '
            || a.is_corporate || ' | ' || al.is_primary AS line
       FROM author_alias al
       JOIN author a ON a.id = al.author_id
      ORDER BY al.display_name`,
  )
  return rows.rows.map((row) => row.line)
}

/** Who each book credits, in order, as `title: first, second`. */
async function creditsOf(pool: pg.Pool): Promise<string[]> {
  const rows = await pool.query<{ line: string }>(
    `SELECT b.title || ': ' || string_agg(al.display_name, ', ' ORDER BY ba.position) AS line
       FROM book_author ba
       JOIN books b ON b.id = ba.book_id
       JOIN author_alias al ON al.id = ba.author_alias_id
      GROUP BY b.id, b.title
      ORDER BY b.title`,
  )
  return rows.rows.map((row) => row.line)
}

/** The shelf order hash, exactly as the backup verification computes it. */
async function shelfOrder(pool: pg.Pool): Promise<string> {
  const rows = await pool.query<{ hash: string }>(SHELF_ORDER_SQL)
  return rows.rows[0]!.hash
}

describe('book_authors becoming authors and aliases', () => {
  it('gives every distinct printed name an author and an alias of its own', async () => {
    const pool = await catalogueOf([
      { title: 'Consider Phlebas', authors: ['Iain M. Banks'] },
      { title: 'The Wasp Factory', authors: ['Iain Banks'] },
      { title: 'The Shining', authors: ['Stephen King'] },
      { title: 'The Talisman', authors: ['Stephen King', 'Peter Straub'] },
    ])

    // Adopted, because this database has the baseline tables and has never been
    // migrated. That is the path the real catalogue would take.
    expect(await migrateToLatest(pool)).toBe('adopted')

    // Four names, four authors. Banks and Banks M are one person and this
    // migration deliberately does not know that: see the migration's own note.
    expect(await aliasesOf(pool)).toEqual([
      'Iain Banks | Banks, Iain | 0 | 1',
      'Iain M. Banks | Banks, Iain M. | 0 | 1',
      'Peter Straub | Peter Straub | 0 | 1',
      'Stephen King | King, Stephen | 0 | 1',
    ])
    // Peter Straub is never first-listed, so no filing name was ever computed
    // for him and the printed name stands. Which authors those are is on the row.
    const unfiled = await pool.query<{ note: string }>(
      `SELECT a.note FROM author a JOIN author_alias al ON al.author_id = a.id
        WHERE al.display_name = 'Peter Straub'`,
    )
    expect(unfiled.rows[0]!.note).toMatch(/never been first-listed|Never first-listed/i)
  })

  it('credits the alias, in the order the names are printed', async () => {
    const pool = await catalogueOf([
      { title: 'The Talisman', authors: ['Stephen King', 'Peter Straub'] },
      { title: 'Good Omens', authors: ['Terry Pratchett', 'Neil Gaiman'] },
    ])
    await migrateToLatest(pool)

    expect(await creditsOf(pool)).toEqual([
      'Good Omens: Terry Pratchett, Neil Gaiman',
      'The Talisman: Stephen King, Peter Straub',
    ])
  })

  it('folds one name spelled two ways into one alias, and keeps the commoner spelling', async () => {
    const pool = await catalogueOf([
      { title: 'The Hobbit', authors: ['J. R. R. Tolkien'] },
      { title: 'The Silmarillion', authors: ['J.R.R. Tolkien'] },
      { title: 'Unfinished Tales', authors: ['J. R. R. Tolkien'] },
      // Accents are not folded, on purpose: this is the conservative direction,
      // and it is the one difference from `normalise()` in shared/shelving.ts.
      { title: 'One Hundred Years of Solitude', authors: ['Gabriel García Márquez'] },
      { title: 'Love in the Time of Cholera', authors: ['Gabriel Garcia Marquez'] },
    ])
    await migrateToLatest(pool)

    const names = (await aliasesOf(pool)).map((line) => line.split(' | ')[0])
    expect(names).toEqual([
      'Gabriel Garcia Marquez', 'Gabriel García Márquez', 'J. R. R. Tolkien',
    ])
    expect(await creditsOf(pool)).toEqual([
      'Love in the Time of Cholera: Gabriel Garcia Marquez',
      'One Hundred Years of Solitude: Gabriel García Márquez',
      'The Hobbit: J. R. R. Tolkien',
      'The Silmarillion: J. R. R. Tolkien',
      'Unfinished Tales: J. R. R. Tolkien',
    ])
  })

  it('takes the filing name from the row, so an override survives', async () => {
    // The two cases docs/shelving.md says no heuristic gets right. The app files
    // them by an override, which is already baked into books.author_filing, so
    // the alias gets the corrected name without this migration knowing why.
    const pool = await catalogueOf([
      {
        title: 'One Hundred Years of Solitude',
        authors: ['Gabriel García Márquez'],
        filingOverride: 'García Márquez, Gabriel',
      },
    ])
    await pool.query(
      `INSERT INTO author_filing (display_key, filing_name, is_corporate, note)
       VALUES ('GABRIEL GARCÍA MÁRQUEZ', 'García Márquez, Gabriel', 0, 'Compound surname.')`,
    )
    await migrateToLatest(pool)

    expect(await aliasesOf(pool))
      .toEqual(['Gabriel García Márquez | García Márquez, Gabriel | 0 | 1'])
  })

  it('absorbs the corporate flag and the note the override table held', async () => {
    const pool = await catalogueOf([
      {
        title: 'Atlas of the World',
        authors: ['National Geographic Society'],
        filingOverride: 'National Geographic Society',
      },
    ])
    await pool.query(
      `INSERT INTO author_filing (display_key, filing_name, is_corporate, note)
       VALUES ('NATIONAL GEOGRAPHIC SOCIETY', 'National Geographic Society', 1,
               'Files as printed.')`,
    )
    await migrateToLatest(pool)

    expect(await aliasesOf(pool))
      .toEqual(['National Geographic Society | National Geographic Society | 1 | 1'])
    const note = await pool.query<{ note: string }>('SELECT note FROM author')
    expect(note.rows[0]!.note).toContain('Files as printed.')
  })

  it('leaves a book with no credited rows out rather than splitting its string', async () => {
    // A comma separates two authors and also separates `Last, First`, which is
    // why `book_authors` exists. Guessing would put a fabricated name in the
    // vocabulary permanently; the string is still on the row either way.
    const pool = await catalogueOf([
      { title: 'Dune', authors: ['Frank Herbert'] },
      { title: 'An old import', authors: ['Herbert, Frank'], withoutCredits: true },
    ])
    await migrateToLatest(pool)

    expect(await aliasesOf(pool)).toEqual(['Frank Herbert | Herbert, Frank | 0 | 1'])
    expect(await creditsOf(pool)).toEqual(['Dune: Frank Herbert'])
    const kept = await pool.query<{ authors: string }>(
      "SELECT authors FROM books WHERE title = 'An old import'",
    )
    expect(kept.rows[0]!.authors).toBe('Herbert, Frank')
  })

  it('leaves every column it read exactly as it was', async () => {
    const pool = await catalogueOf([
      { title: 'Dune', authors: ['Frank Herbert'] },
    ])
    await migrateToLatest(pool)

    const row = await pool.query<{ authors: string; author_filing: string; sort_key: string }>(
      'SELECT authors, author_filing, sort_key FROM books',
    )
    expect(row.rows[0]).toEqual({
      authors: 'Frank Herbert',
      author_filing: 'Herbert, Frank',
      sort_key: buildSortKey({ authorFiling: 'Herbert, Frank', title: 'Dune' }),
    })
    const credits = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM book_authors',
    )
    expect(credits.rows[0]!.count).toBe('1')
  })

  it('does not move a single book on the shelf', async () => {
    // The claim the whole migration turns on, proved rather than asserted: the
    // shelf order hash from server/backup.ts, taken before and after. It is a
    // digest of every book id in sort_key order, so a book that changed places
    // changes it and a book that did not cannot.
    const pool = await catalogueOf(
      Array.from({ length: 120 }, (_, at) => ({
        title: `Book ${String(at).padStart(3, '0')}`,
        authors: at % 7 === 0
          ? [`Author ${String(at % 13)}`, `Second ${String(at % 5)}`]
          : [`Author ${String(at % 13)}`],
      })),
    )

    const before = await shelfOrder(pool)
    await migrateToLatest(pool)
    const after = await shelfOrder(pool)

    // Printed rather than only compared, because the pull request quotes them.
    console.log(`[shelf order] before ${before} after ${after}`)
    expect(after).toBe(before)
    expect(before).not.toBeNull()
  })

  it('numbers the sequences past the ids it supplied', async () => {
    // The ids are written rather than generated, so the sequence still points at
    // 1 unless it is moved, and the first author somebody adds afterwards
    // collides with one of these.
    const pool = await catalogueOf([
      { title: 'Dune', authors: ['Frank Herbert'] },
      { title: 'The Hobbit', authors: ['J. R. R. Tolkien'] },
    ])
    await migrateToLatest(pool)

    const added = await pool.query<{ id: number }>(
      "INSERT INTO author (is_corporate, note) VALUES (0, '') RETURNING id",
    )
    expect(added.rows[0]!.id).toBe(3)
    const alias = await pool.query<{ id: number }>(
      `INSERT INTO author_alias (author_id, display_name, filing_name, is_primary)
       VALUES ($1, 'Somebody New', 'New, Somebody', 1) RETURNING id`,
      [added.rows[0]!.id],
    )
    expect(alias.rows[0]!.id).toBe(3)
  })

  it('is not run twice on a database that has already had it', async () => {
    const pool = await catalogueOf([
      { title: 'Dune', authors: ['Frank Herbert'] },
    ])
    await migrateToLatest(pool)
    const after = await aliasesOf(pool)

    expect(await migrateToLatest(pool)).toBe('migrated')
    expect(await aliasesOf(pool)).toEqual(after)
  })

  it('says nothing about a catalogue with no books in it', async () => {
    const pool = await catalogueOf([])
    await migrateToLatest(pool)

    expect(await aliasesOf(pool)).toEqual([])
    // The vocabulary starts empty, unlike tags: there is no author every
    // catalogue has, so seeding one would be inventing a person.
    const counted = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM author',
    )
    expect(counted.rows[0]!.count).toBe('0')
  })
})

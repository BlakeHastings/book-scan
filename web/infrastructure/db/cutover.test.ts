/**
 * The claim both halves of the cut-over rest on, checked book by book: the
 * genre tag and the alias's filing name put every book exactly where
 * `books.is_fiction` and `books.author_filing` put it. Every shelved book is
 * placed twice, once by the two columns and once by the rows `0002` and
 * `0004` derived from them, and the two answers are compared one book at a
 * time.
 *
 * One comparison, not two: a book's place is `(shelf_range, sort_key)`, the
 * range from the genre and the first component of the key from the filing
 * name. Splitting the two would mean comparing half a position each time.
 *
 * Also covers `0020`, the repair the authors' half owes.
 *
 * Nothing in this file connects to anything but a scratch database it made.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { rangeOfGenre } from '../../domain/tagging/genre'
import { TagSlug, type AppliedTag, type TagConfidence, type TagSource } from '../../domain/tagging/tags'
import { SCHEMA } from '../../server/db.pg'
import { buildSortKey, filingName, type ShelfRange } from '../../shared/shelving'
import { migrateToLatest } from './migrate'
import { closeScratchDatabases, migrationsThrough, scratchDatabase } from './testdb'

/**
 * The pools open right now, given back as each test finishes with one. See
 * `genre-cutover.test.ts` for why: enough scratch databases held open at
 * once can run the container out of connections.
 */
const openHere: pg.Pool[] = []

afterEach(async () => {
  await Promise.all(openHere.splice(0).map((pool) => pool.end().catch(() => undefined)))
})

afterAll(async () => {
  await closeScratchDatabases()
})

/**
 * One name on a book, and what the app had computed for its filing name.
 * `shelvedAs` is `books.author_filing`, the first component of the sort key
 * a book is physically shelved by. An empty one is a real state, not a
 * missing name: `Store.filingFor` returns '' for a name written in a script
 * with no `A-Z` in it, rather than running the heuristic.
 */
interface SeedAuthor {
  printed: string
  shelvedAs: string
}

/**
 * Twelve names, three of them interesting: `Gabriel García Márquez` carries
 * a filing name no heuristic produces, covering a corrected name as well as
 * a derived one; the Greek and the Cyrillic name carry nothing.
 */
const NAMES: SeedAuthor[] = [
  { printed: 'Ursula K. Le Guin', shelvedAs: 'Le Guin, Ursula K.' },
  { printed: 'Iain M. Banks', shelvedAs: 'Banks, Iain M.' },
  { printed: 'Terry Pratchett', shelvedAs: 'Pratchett, Terry' },
  { printed: 'Octavia E. Butler', shelvedAs: 'Butler, Octavia E.' },
  { printed: 'Kazuo Ishiguro', shelvedAs: 'Ishiguro, Kazuo' },
  { printed: 'Homer', shelvedAs: 'Homer' },
  { printed: 'National Geographic Society', shelvedAs: 'National Geographic Society' },
  { printed: 'Gabriel García Márquez', shelvedAs: 'García Márquez, Gabriel' },
  { printed: 'Yuval Noah Harari', shelvedAs: 'Harari, Yuval Noah' },
  { printed: 'Carl Sagan', shelvedAs: 'Sagan, Carl' },
  { printed: 'Νίκος Καζαντζάκης', shelvedAs: '' },
  { printed: 'Фёдор Достоевский', shelvedAs: '' },
]

/** The names left filing under nobody, which is what this file is about. */
const FILED_UNDER_NOBODY = NAMES.filter((name) => !name.shelvedAs).map((name) => name.printed)

/**
 * Which books those two names are on, and there are deliberately few of
 * them: the live catalogue has one author written in a script with no
 * `A-Z` in it, so spreading them evenly would misrepresent the shape.
 */
const NON_LATIN_AT = new Map<number, SeedAuthor>([
  [55, NAMES[10]!],
  [100, NAMES[10]!],
  [137, NAMES[11]!],
])

/** The ten names every other book cycles through. */
const LATIN = NAMES.slice(0, 10)

interface SeedBook {
  title: string
  author: SeedAuthor
  range: ShelfRange
  /** What `classification_source` says, which is what `0002` reads. */
  source: 'manual' | 'auto'
  confidence: string
}

/**
 * A catalogue shaped like the live one: every third book non-fiction, every
 * fourth decided by a person, exercising `rangeOfGenre`'s source precedence
 * across the whole catalogue. Ten names cycle through the rest, so a name
 * being refiled moves a run rather than a row.
 */
const LIVE_SIZED: SeedBook[] = Array.from({ length: 237 }, (_, at) => ({
  title: `Book ${String(at).padStart(3, '0')}`,
  author: NON_LATIN_AT.get(at) ?? LATIN[at % LATIN.length]!,
  range: at % 3 === 0 ? ('nonfiction' as const) : ('fiction' as const),
  source: at % 4 === 0 ? ('manual' as const) : ('auto' as const),
  confidence: ['high', 'medium', 'weak', ''][at % 4]!,
}))

/** The key the shelf is actually ordered by, built the way a save builds it. */
function keyFor(book: SeedBook): string {
  return buildSortKey({ authorFiling: book.author.shelvedAs, title: book.title })
}

/**
 * The catalogue as the pre-Drizzle schema left it, never migrated. Uses
 * `SCHEMA` rather than `applySchema`, which would run the migrations itself
 * and hand back a database that had already had the ones under test.
 */
async function catalogueOf(books: SeedBook[]): Promise<pg.Pool> {
  const pool = await scratchDatabase()
  openHere.push(pool)
  await pool.query(SCHEMA)

  await pool.query(
    `INSERT INTO books (title, authors, shelf_range, is_fiction, author_filing, sort_key,
                        scanned_at, classification_source, classification_confidence)
     SELECT title, printed, shelf_range, is_fiction, author_filing, sort_key,
            '2026-01-02T03:04:05.000Z', source, confidence
       FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::text[],
                   $7::text[], $8::text[])
            WITH ORDINALITY AS seed(title, printed, shelf_range, is_fiction, author_filing,
                                    sort_key, source, confidence, at)
      ORDER BY at`,
    [
      books.map((book) => book.title),
      books.map((book) => book.author.printed),
      books.map((book) => book.range),
      books.map((book) => (book.range === 'fiction' ? 1 : 0)),
      books.map((book) => book.author.shelvedAs),
      books.map(keyFor),
      books.map((book) => book.source),
      books.map((book) => book.confidence),
    ],
  )

  // The positional table: "the first-listed author" is a fact here, not a
  // guess at where a comma belongs. `0004` reads this.
  await pool.query(
    `INSERT INTO book_authors (book_id, position, name)
     SELECT b.id, 1, b.authors FROM books b WHERE b.authors <> ''`,
  )

  return pool
}

/** Where one book files: the range it joins and the key it sorts at. */
interface Filed {
  id: number
  title: string
  range: ShelfRange | null
  sortKey: string
  /** The name the key was built from, so a difference can be read as a name. */
  filesUnder: string
}

/** A book's place as the two columns decide it, which is where it actually is. */
async function underTheColumns(pool: pg.Pool, from: string): Promise<Filed[]> {
  const { rows } = await pool.query<{
    id: number; title: string; is_fiction: number; author_filing: string
  }>(`SELECT id, title, is_fiction, author_filing FROM ${from} ORDER BY id`)

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    range: row.is_fiction === 1 ? 'fiction' : 'nonfiction',
    filesUnder: row.author_filing,
    sortKey: buildSortKey({ authorFiling: row.author_filing, title: row.title }),
  }))
}

/** A book's place as the genre tag and the credited alias decide it. */
async function underTheRows(pool: pg.Pool): Promise<Filed[]> {
  const { rows } = await pool.query<{
    id: number; title: string; filing_name: string | null
    slugs: string[]; sources: TagSource[]; confidences: TagConfidence[]
  }>(
    // The three tag arrays are aggregated in one order so they stay index
    // aligned: a slug and the source that wrote it have to arrive as a pair.
    // The alias is joined at the lowest credit position, since that is what
    // the sort key has always been built from.
    `SELECT b.id, b.title, a.filing_name,
            array_remove(array_agg(t.slug ORDER BY t.slug, bt.source), NULL) AS slugs,
            array_remove(array_agg(bt.source ORDER BY t.slug, bt.source), NULL) AS sources,
            array_remove(array_agg(bt.confidence ORDER BY t.slug, bt.source), NULL)
              AS confidences
       FROM shelved_books b
       LEFT JOIN book_author ba ON ba.book_id = b.id
            AND ba.position = (SELECT min(inner_ba.position) FROM book_author inner_ba
                                WHERE inner_ba.book_id = b.id)
       LEFT JOIN author_alias a ON a.id = ba.author_alias_id
       LEFT JOIN book_tag bt ON bt.book_id = b.id
       LEFT JOIN tag t ON t.id = bt.tag_id
      GROUP BY b.id, b.title, a.filing_name
      ORDER BY b.id`,
  )

  return rows.map((row) => {
    const carried: AppliedTag[] = row.slugs.map((slug, at) => ({
      slug: TagSlug.of(slug),
      source: row.sources[at]!,
      confidence: row.confidences[at]!,
    }))
    const filesUnder = row.filing_name ?? ''
    return {
      id: row.id,
      title: row.title,
      range: rangeOfGenre(carried),
      filesUnder,
      sortKey: buildSortKey({ authorFiling: filesUnder, title: row.title }),
    }
  })
}

/** The books the two derivations put in different places, said for a reviewer. */
function disagreements(old: Filed[], now: Filed[]): string[] {
  const byId = new Map(now.map((one) => [one.id, one]))
  return old.flatMap((one) => {
    const other = byId.get(one.id)
    if (other && other.range === one.range && other.sortKey === one.sortKey) return []
    if (!other) return [`${one.title}: the columns place it, the rows do not have it`]
    if (other.range !== one.range) {
      return [`${one.title}: the column says ${one.range}, the tags say ${other.range ?? 'nothing'}`]
    }
    return [
      `${one.title}: the column files it under ${one.filesUnder || '(nobody)'}, ` +
      `the alias files it under ${other.filesUnder || '(nobody)'}`,
    ]
  })
}

/** The shelf order hash, spelled as `server/backup.ts` and `0013` spell it. */
async function shelfOrder(pool: pg.Pool, from: string): Promise<string | null> {
  const { rows } = await pool.query<{ hash: string | null }>(
    `SELECT md5(string_agg(id::text, ',' order by sort_key, id)) AS hash FROM ${from}`,
  )
  return rows[0]?.hash ?? null
}

/** One migration as a statement, so it can be watched running. */
function migrationText(tag: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./migrations/${tag}.sql`, import.meta.url)), 'utf8',
  )
}

/** The repair under test here, named once. */
const THE_REPAIR = '0020_the_alias_files_what_the_shelf_was_built_from'

/** Run a statement and hand back everything postgres said out loud. */
async function noticesFrom(pool: pg.Pool, sql: string): Promise<string[]> {
  const client = await pool.connect()
  const said: string[] = []
  const listen = (notice: { message?: string }) => said.push(notice.message ?? '')
  client.on('notice', listen)
  try {
    await client.query(sql)
  } finally {
    client.off('notice', listen)
    client.release()
  }
  return said
}

/** What one alias files under now, by the name printed on the books. */
async function filesUnder(pool: pg.Pool, printed: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ filing_name: string }>(
    'SELECT filing_name FROM author_alias WHERE display_name = $1',
    [printed],
  )
  return rows[0]?.filing_name
}

describe('the tags and the aliases deciding where every book files', () => {
  it('puts every book where books.is_fiction and books.author_filing put it', async () => {
    const pool = await catalogueOf(LIVE_SIZED)

    const before = await shelfOrder(pool, 'books WHERE checked_out_at IS NULL')
    // Read while both columns still exist, before the migrations drop them.
    const old = await underTheColumns(pool, 'books')
    // Adopted: this database has the baseline tables and has never been migrated.
    expect(await migrateToLatest(pool)).toBe('adopted')

    const now = await underTheRows(pool)
    expect(old).toHaveLength(LIVE_SIZED.length)
    expect(now).toHaveLength(LIVE_SIZED.length)

    // Every book but the ones filed under nobody: `books.author_filing` is
    // '' on them, so the columns file them ahead of everything in their
    // range, while the alias carries the printed name instead. No book
    // moves today: `books.sort_key` is written by a save and nothing here
    // rewrites one.
    const moving = LIVE_SIZED
      .filter((book) => FILED_UNDER_NOBODY.includes(book.author.printed))
      .map((book) =>
        `${book.title}: the column files it under (nobody), ` +
        `the alias files it under ${book.author.printed}`)

    expect(moving.length).toBeGreaterThan(0)
    expect(disagreements(old, now)).toEqual(moving)

    // Confirms the stored key really is the one the columns derive.
    const stored = await pool.query<{ id: number; sort_key: string }>(
      'SELECT id, sort_key FROM shelved_books ORDER BY id',
    )
    expect(stored.rows.map((row) => row.sort_key))
      .toEqual(old.map((one) => one.sortKey))

    const after = await shelfOrder(pool, 'shelved_books')
    console.log(`[cutover] shelf order ${before} before, ${after} after; ` +
      `${old.length} books placed twice and compared one at a time; ` +
      `${moving.length} named as moving, all of them #195`)
    for (const line of moving) console.log(`[cutover]   ${line}`)
    expect(after).toBe(before)
  })

  it('names exactly the book whose tag changed and the books whose alias was refiled', async () => {
    const pool = await catalogueOf(LIVE_SIZED)
    const old = await underTheColumns(pool, 'books')
    await migrateToLatest(pool)

    const alreadyMoving = LIVE_SIZED
      .filter((book) => FILED_UNDER_NOBODY.includes(book.author.printed)).length
    expect(disagreements(old, await underTheRows(pool))).toHaveLength(alreadyMoving)

    await pool.query(
      `UPDATE book_tag SET tag_id = (SELECT id FROM tag WHERE slug = 'genre/non-fiction')
        WHERE book_id = (SELECT id FROM books WHERE title = 'Book 041')`,
    )
    await pool.query(
      "UPDATE author_alias SET filing_name = 'Guin, Ursula K. Le' WHERE display_name = $1",
      ['Ursula K. Le Guin'],
    )

    const named = disagreements(old, await underTheRows(pool))
    const byLeGuin = LIVE_SIZED
      .filter((book) => book.author.printed === 'Ursula K. Le Guin')
      .map((book) =>
        `${book.title}: the column files it under Le Guin, Ursula K., ` +
        'the alias files it under Guin, Ursula K. Le')

    console.log(`[cutover] one tag swapped and one alias refiled: ${named.length} books named`)
    for (const line of named.slice(0, 4)) console.log(`[cutover]   ${line}`)
    expect(named).toContain('Book 041: the column says fiction, the tags say nonfiction')
    expect(byLeGuin.every((line) => named.includes(line))).toBe(true)
    // Nothing else moved: the whole list is the swapped tag, the refiled
    // name's books, and the books already accounted for above.
    expect(named).toHaveLength(1 + byLeGuin.length + alreadyMoving)
  })
})

describe('the repair the authors half of the cut-over owes', () => {
  /**
   * An alias that drifted behind the column, which is what `0020` repairs.
   * Made the way the live catalogue makes one: a saved filing override
   * writes into `books.author_filing`, and `AuthorRepository.introduce`
   * deliberately does not write that onto an alias somebody has already filed.
   */
  async function withADriftedAlias(): Promise<pg.Pool> {
    const pool = await catalogueOf(LIVE_SIZED)
    // Through the migration before the repair: `0004` has already taken the
    // filing name off the book rows, and `shelved_books` exists, which
    // `0020` hashes either side of itself.
    await migrationsThrough(pool, '0016_one_genre_tag_per_book')

    await pool.query(
      `UPDATE books SET author_filing = 'Pratchett, Terence David John'
        WHERE authors = 'Terry Pratchett'`,
    )
    return pool
  }

  it('files an alias under what the shelf was built from, and counts it', async () => {
    const pool = await withADriftedAlias()
    expect(await filesUnder(pool, 'Terry Pratchett')).toBe('Pratchett, Terry')

    const before = await shelfOrder(pool, 'shelved_books')
    const said = await noticesFrom(pool, migrationText(THE_REPAIR))
    const after = await shelfOrder(pool, 'shelved_books')

    expect(await filesUnder(pool, 'Terry Pratchett')).toBe('Pratchett, Terence David John')
    expect(said.some((line) => line.includes('alias filing names: 1 aliases now file under')))
      .toBe(true)

    // Not one book moved, which the migration checks itself and refuses on.
    expect(after).toBe(before)
    expect(said.some((line) => line.startsWith('shelf order unchanged'))).toBe(true)
    console.log(`[cutover] repair shelf order ${before} before, ${after} after`)
  })

  it('invents no filing name for the ones #195 left, and names them', async () => {
    const pool = await withADriftedAlias()
    const said = await noticesFrom(pool, migrationText(THE_REPAIR))

    // The printed name stands: a copy of `filingName()` written in SQL
    // would overrule it, producing a different answer than what was
    // decided originally.
    for (const printed of FILED_UNDER_NOBODY) {
      expect(await filesUnder(pool, printed)).toBe(printed)
      expect(filingName(printed)).not.toBe(printed)
      console.log(`[cutover] ${printed}: the alias says "${await filesUnder(pool, printed)}", ` +
        `the fold says "${filingName(printed)}"`)
    }

    expect(said.some((line) =>
      line.includes(`filing as printed: ${FILED_UNDER_NOBODY.length} aliases`))).toBe(true)
    for (const printed of FILED_UNDER_NOBODY) {
      expect(said.some((line) => line.includes(printed))).toBe(true)
    }
  })

  it('is safe to run again, and says plainly when there is nothing to repair', async () => {
    const pool = await withADriftedAlias()
    const statement = migrationText(THE_REPAIR)
    await pool.query(statement)
    const repaired = await filesUnder(pool, 'Terry Pratchett')

    // Idempotent migrations must say so when there is nothing to repair,
    // since silence and success look the same in a log.
    const said = await noticesFrom(pool, statement)
    expect(await filesUnder(pool, 'Terry Pratchett')).toBe(repaired)
    expect(said.some((line) =>
      line.includes('every alias already files under what the shelf was built from'))).toBe(true)
  })
})

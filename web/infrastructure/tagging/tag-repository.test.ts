/**
 * The tag repository and the restatement handler, against a real Postgres.
 *
 * Postgres only, and it has to be: `tag` and `book_tag` are created by a
 * migration, and migrations exist only for Postgres. The database each test
 * opens is built by running every migration, which is also the only way to get
 * one with these tables in it.
 *
 * The database is created with a linguistic collation on purpose (see
 * `infrastructure/db/testdb.ts`), so the `COLLATE "C"` declaration on `tag.slug`
 * is doing work here rather than being masked by a byte-ordered database.
 */

import pg from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PgDb } from '../../server/db.pg'
import type { Db } from '../../server/driver'
import { RestateTagsHandler } from '../../application/tagging/restate-tags'
import { ApplyTagHandler, RemoveTagHandler } from '../../application/tagging/apply-tag'
import { TagSlug } from '../../domain/tagging/tags'
import { dropScratchDatabases, migratedDatabase } from '../db/testdb'
import { DbBookTransactions } from './transactions'
import { DrizzleTagRepository, vocabularyQuery } from './tag-repository'

let pool: pg.Pool
let db: Db
let tags: DrizzleTagRepository

const NOW = '2026-08-06T09:00:00.000Z'

/** A book to hang tags on. `book_tag.book_id` is a foreign key. */
async function aBook(title: string): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO books (title, shelf_range, is_fiction, sort_key, scanned_at)
     VALUES (?, 'fiction', 1, ?, '2026-08-06') RETURNING id`,
    [title, title],
  )
  return Number(row?.id)
}

beforeEach(async () => {
  if (!pool) {
    pool = await migratedDatabase()
    db = new PgDb(pool)
  }
  await db.run('TRUNCATE books, tag, book_tag RESTART IDENTITY CASCADE')
  tags = new DrizzleTagRepository(db)
})

afterAll(async () => {
  await dropScratchDatabases()
})

describe('the vocabulary', () => {
  it('defines a slug once, however many times it is asked for', async () => {
    const first = await tags.define(TagSlug.of('genre/fantasy'), 'Fantasy')
    const again = await tags.define(TagSlug.of('genre/fantasy'), 'Fantasy')
    expect(again.id).toBe(first.id)
  })

  it('does not let a second caller rewrite the label', async () => {
    // A catalogue spelling a heading differently this week is not somebody
    // deciding to rename a tag.
    await tags.define(TagSlug.of('genre/fantasy'), 'Fantasy')
    const again = await tags.define(TagSlug.of('genre/fantasy'), 'FANTASY, EPIC')
    expect(again.label).toBe('Fantasy')
  })

  it('renames the label and leaves the slug exactly where it was', async () => {
    // The owner's decision, and the reason there is no method that would do
    // otherwise: every rule references the slug.
    const before = await tags.define(TagSlug.of('genre/non-fiction'), 'Non-fiction')
    await tags.relabel(TagSlug.of('genre/non-fiction'), 'Not made up')

    const [after] = await tags.vocabulary(TagSlug.of('genre/non-fiction'))
    expect(after?.id).toBe(before.id)
    expect(after?.slug.value).toBe('genre/non-fiction')
    expect(after?.label).toBe('Not made up')
  })

  it('answers under with the tag and its descendants and nothing adjacent', async () => {
    for (const slug of [
      'genre', 'genre/fantasy', 'genre/fantasy/epic', 'genres/fantasy', 'genre-adjacent', 'mine',
    ]) {
      await tags.define(TagSlug.of(slug), slug)
    }

    expect((await tags.vocabulary(TagSlug.of('genre'))).map((one) => one.slug.value))
      .toEqual(['genre', 'genre/fantasy', 'genre/fantasy/epic'])
  })

  it('reads a prefix out of the index rather than scanning the vocabulary', async () => {
    // The claim COLLATE "C" is there to make true, checked by reading the plan
    // back rather than by asserting the answers, which are the same either way.
    // A vocabulary this size is where the planner starts preferring a scan, so a
    // sequential one here would be a real finding.
    await pool.query(
      `INSERT INTO tag (slug, label)
       SELECT 'subject/' || lpad(n::text, 6, '0'), 'x'
         FROM generate_series(1, 5000) AS n`,
    )
    await pool.query('ANALYZE tag')

    const query = vocabularyQuery(TagSlug.of('subject/000123'))
    const plan = await db.all<{ 'QUERY PLAN': string }>(
      `EXPLAIN ${query.text}`, query.values,
    )
    const text = plan.map((row) => row['QUERY PLAN']).join('\n')

    expect(text).toMatch(/Index (Only )?Scan/)
    expect(text).not.toMatch(/Seq Scan/)
  })
})

describe('what a book carries', () => {
  it('applies a tag, and applying it again says the same thing', async () => {
    const book = await aBook('Dune')
    await tags.define(TagSlug.of('mine/lent-out'), 'Lent out')

    const application = {
      slug: TagSlug.of('mine/lent-out'), source: 'person' as const,
      confidence: 'high' as const, addedAt: NOW,
    }
    await tags.apply(book, [application])
    await tags.apply(book, [application])

    expect((await tags.of(book)).map((one) => one.slug.value)).toEqual(['mine/lent-out'])
  })

  it('lets a catalogue and a person say the same thing separately', async () => {
    // Two rows, not one. If they collapsed, the catalogue taking its claim back
    // would take the person's with it.
    const book = await aBook('Dune')
    await tags.define(TagSlug.of('genre/fiction'), 'Fiction')
    await tags.apply(book, [
      { slug: TagSlug.of('genre/fiction'), source: 'catalogue', confidence: 'high', addedAt: NOW },
      { slug: TagSlug.of('genre/fiction'), source: 'person', confidence: 'high', addedAt: NOW },
    ])

    expect((await tags.of(book)).map((one) => one.source)).toEqual(['catalogue', 'person'])
  })

  it('refuses to apply a tag nobody has defined', async () => {
    const book = await aBook('Dune')
    await expect(tags.apply(book, [{
      slug: TagSlug.of('genre/undefined'), source: 'person', confidence: 'high', addedAt: NOW,
    }])).rejects.toThrow(/no tag genre\/undefined/)
  })

  it('retracts only the named source when one is given', async () => {
    const book = await aBook('Dune')
    await tags.define(TagSlug.of('genre/fiction'), 'Fiction')
    await tags.apply(book, [
      { slug: TagSlug.of('genre/fiction'), source: 'catalogue', confidence: 'high', addedAt: NOW },
      { slug: TagSlug.of('genre/fiction'), source: 'person', confidence: 'high', addedAt: NOW },
    ])

    await tags.retract(book, [TagSlug.of('genre/fiction')], 'catalogue')
    expect((await tags.of(book)).map((one) => one.source)).toEqual(['person'])
  })

  it('retracts every source when a person removes a tag', async () => {
    const book = await aBook('Dune')
    await tags.define(TagSlug.of('genre/fiction'), 'Fiction')
    await tags.apply(book, [
      { slug: TagSlug.of('genre/fiction'), source: 'catalogue', confidence: 'high', addedAt: NOW },
      { slug: TagSlug.of('genre/fiction'), source: 'person', confidence: 'high', addedAt: NOW },
    ])

    await new RemoveTagHandler(tags).handle({ bookId: book, slug: TagSlug.of('genre/fiction') })
    expect(await tags.of(book)).toEqual([])
  })

  it('goes away with the book it was on', async () => {
    const book = await aBook('Dune')
    await tags.define(TagSlug.of('genre/fiction'), 'Fiction')
    await tags.apply(book, [
      { slug: TagSlug.of('genre/fiction'), source: 'person', confidence: 'high', addedAt: NOW },
    ])

    await db.run('DELETE FROM books WHERE id = ?', [book])
    const left = await db.get<{ count: string }>('SELECT count(*)::text AS count FROM book_tag')
    expect(left?.count).toBe('0')
  })
})

describe('a lookup re-running', () => {
  const restate = () => new RestateTagsHandler(tags, new DbBookTransactions(db))

  it('cannot take away a tag a person applied', async () => {
    // The one this feature exists to guarantee, at the level where it would
    // actually go wrong: a person's decision, a lookup that does not mention it,
    // and the decision still there afterwards.
    const book = await aBook('Dune')

    await new ApplyTagHandler(tags).handle({
      bookId: book, slug: TagSlug.of('mine/lent-out'), label: 'Lent out', now: NOW,
    })
    await restate().handle({
      bookId: book,
      source: 'catalogue',
      claims: [
        { slug: TagSlug.of('genre/fiction'), confidence: 'high' },
        { slug: TagSlug.of('subject/dune'), confidence: 'medium' },
      ],
      now: NOW,
    })

    // The catalogue has changed its mind about everything it said, and says
    // nothing about what the person said.
    await restate().handle({
      bookId: book,
      source: 'catalogue',
      claims: [{ slug: TagSlug.of('subject/desert'), confidence: 'medium' }],
      now: '2026-08-07T09:00:00.000Z',
    })

    expect((await tags.of(book)).map((one) => `${one.slug.value}:${one.source}`))
      .toEqual(['mine/lent-out:person', 'subject/desert:catalogue'])
  })

  it('cannot take away a guess either, only its own claims', async () => {
    const book = await aBook('Dune')
    await tags.define(TagSlug.of('genre/fiction'), 'Fiction')
    await tags.apply(book, [
      { slug: TagSlug.of('genre/fiction'), source: 'guess', confidence: 'medium', addedAt: NOW },
    ])

    await restate().handle({ bookId: book, source: 'catalogue', claims: [], now: NOW })

    expect((await tags.of(book)).map((one) => one.source)).toEqual(['guess'])
  })

  it('keeps the day a tag was first claimed when it is claimed again', async () => {
    const book = await aBook('Dune')
    const claims = [{ slug: TagSlug.of('subject/dune'), confidence: 'medium' as const }]

    await restate().handle({ bookId: book, source: 'catalogue', claims, now: NOW })
    await restate().handle({
      bookId: book, source: 'catalogue', claims, now: '2027-01-01T00:00:00.000Z',
    })

    const row = await db.get<{ added_at: string }>('SELECT added_at FROM book_tag')
    expect(row?.added_at).toBe(NOW)
  })

  it('defines the tags it claims, with a readable label', async () => {
    const book = await aBook('Dune')
    await restate().handle({
      bookId: book,
      source: 'catalogue',
      claims: [{ slug: TagSlug.of('subject/juvenile-fiction'), confidence: 'high' }],
      now: NOW,
    })

    const [defined] = await tags.vocabulary(TagSlug.of('subject/juvenile-fiction'))
    expect(defined?.label).toBe('Juvenile fiction')
  })
})

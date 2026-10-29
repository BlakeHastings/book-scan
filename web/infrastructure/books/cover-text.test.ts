/**
 * `MatchCoverTextHandler` over `DrizzleCoverTextReadModel`, against a real
 * Postgres with `pg_trgm`, asked with text the way PaddleOCR returns it off a
 * cover: out of order, wrongly spaced, with letters swapped for digits.
 *
 * How well this does on photographs is the harness's question
 * (`server/cover-matching/`); these are the rules a single reading is held to.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db, Params } from '../../server/driver'
import { closeTestDatabase, openTestDatabase } from '../../server/testdb'
import { testBooks } from '../../server/testbooks'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { MatchCoverTextHandler, tellsAnything } from '../../application/books/queries/match-cover-text'
import { DrizzleCoverTextReadModel } from './cover-text-read-model'

let db: Db

async function shelve(title: string, ...authors: string[]): Promise<number> {
  return (await testBooks(db).catalogue({ title, authors, genre: FICTION_SLUG })).id
}

const titlesFor = async (text: string) =>
  (await new MatchCoverTextHandler(new DrizzleCoverTextReadModel(db)).handle({ text, limit: 4 }))
    .map((candidate) => candidate.title)

beforeEach(async () => {
  db = await openTestDatabase()
  await shelve('The Left Hand of Darkness', 'Ursula K. Le Guin')
  await shelve('The Dispossessed', 'Ursula K. Le Guin')
  await shelve('A Princess of Mars', 'Edgar Rice Burroughs')
  await shelve('The Gods of Mars', 'Edgar Rice Burroughs')
  await shelve('The Warlord of Mars', 'Edgar Rice Burroughs')
  await shelve('Perdido Street Station', 'China Miéville')
  await shelve('The City & the City', 'China Miéville')
  await shelve('Station Eleven', 'Emily St. John Mandel')
  await shelve('The Hidden Garden', 'Rafael Adeyemi')
})

afterAll(closeTestDatabase)

describe('MatchCoverTextHandler', () => {
  it('finds the book a noisy reading names, first', async () => {
    expect((await titlesFor('URSULA K.LE GUIN THE LEFT HAND 0F DARKNES5 A NOVEL'))[0])
      .toBe('The Left Hand of Darkness')
    // Lines out of order, two words run together, an accent OCR never reads.
    expect((await titlesFor('STREET STATION Perdido CHINAMIEVILLE'))[0]).toBe('Perdido Street Station')
  })

  it('ranks the right volume of a series above its siblings', async () => {
    expect((await titlesFor('EDGAR RICE BURROUGHS THE GODS OF MARS')).slice(0, 3))
      .toEqual(['The Gods of Mars', 'The Warlord of Mars', 'A Princess of Mars'])
  })

  it('still ranks an author\'s books first when the cover shows only the name', async () => {
    const found = await titlesFor('ursula k le guin')
    expect(found.slice(0, 2).sort()).toEqual(['The Dispossessed', 'The Left Hand of Darkness'])
  })

  it('is not led by short words, stop words or single letters', async () => {
    // Every title here has "the" or "of" in it, and nothing else on this
    // reading names a book.
    expect(await titlesFor('THE OF A I O T HE')).toEqual([])
    expect(tellsAnything('the of a i o t he')).toBe(false)
    expect(tellsAnything('the of a i o t he mars')).toBe(true)
  })

  it('answers only books in the catalogue', async () => {
    await db.run(
      `INSERT INTO books (title, shelf_range, sort_key, scanned_at, state)
       VALUES ('The Hidden Orchard', 'fiction', 'The Hidden Orchard', '2026-10-28', 'scanned')`,
    )
    expect(await titlesFor('the hidden orchard')).not.toContain('The Hidden Orchard')
  })

  it('walks the trigram indexes nearest first, not every book', async () => {
    // What the read model actually sent, planned with sequential scans priced
    // out: a table of nine rows is otherwise cheaper to read whole and sort
    // than through any index, which says nothing about whether this one serves.
    const sent: { sql: string, params?: Params }[] = []
    const watched: Db = { ...db, all: (sql, params) => { sent.push({ sql, params }); return db.all(sql, params) } }
    await new DrizzleCoverTextReadModel(watched).near('perdido station guin', 5)
    expect(sent).toHaveLength(1)

    const plan = await db.tx(async (tx) => {
      await tx.run('SET LOCAL enable_seqscan = off')
      return tx.all<{ 'QUERY PLAN': string }>(`EXPLAIN ${sent[0]!.sql}`, sent[0]!.params)
    })
    const text = plan.map((row) => row['QUERY PLAN']).join('\n')
    expect(text).toMatch(/Index Scan using idx_books_title_trgm[^\n]*\n\s*Order By: \(title <->/)
    expect(text).toMatch(/Index Scan using idx_author_alias_display_name_trgm[^\n]*\n\s*Order By: \(display_name <->/)
  })
})

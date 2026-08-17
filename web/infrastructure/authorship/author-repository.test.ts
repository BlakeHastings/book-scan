/**
 * The author repository and the two curation handlers, against a real Postgres.
 *
 * Postgres only, and it has to be: `author`, `author_alias` and `book_author`
 * are created by a migration, and the database each test opens is built by
 * running every migration, which is the only way to get one with these tables.
 *
 * The database is created with a linguistic collation on purpose (see
 * `infrastructure/db/testdb.ts`), so the `COLLATE "C"` declaration on
 * `author_alias.filing_name` is doing work here rather than being masked by a
 * byte-ordered database.
 */

import pg from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PgDb } from '../../server/db.pg'
import type { Db } from '../../server/driver'
import { CreditBookHandler } from '../../application/authorship/credit-book'
import {
  FileAliasHandler, MergeAuthorsHandler,
} from '../../application/authorship/curate-authors'
import { PrintedName, nameKey } from '../../domain/authorship/authors'
import { closeScratchDatabases, migratedDatabase } from '../db/testdb'
import { DrizzleAuthorRepository, NAME_KEY_SQL } from './author-repository'
import { statement } from '../db/query'

let pool: pg.Pool
let db: Db
let authors: DrizzleAuthorRepository

/** A book to credit. `book_author.book_id` is a foreign key. */
async function aBook(title: string): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO books (title, shelf_range, sort_key, scanned_at)
     VALUES (?, 'fiction', ?, '2026-08-06') RETURNING id`,
    [title, title],
  )
  return Number(row?.id)
}

const printed = (name: string) => PrintedName.of(name)

beforeEach(async () => {
  if (!pool) {
    pool = await migratedDatabase()
    db = new PgDb(pool)
  }
  await db.run('TRUNCATE books, author, author_alias, book_author RESTART IDENTITY CASCADE')
  authors = new DrizzleAuthorRepository(db)
})

afterAll(async () => {
  await closeScratchDatabases()
}, 60_000)

describe('the fold that says two spellings are one name', () => {
  it('agrees with the domain, which is the thing this file exists to check', async () => {
    // Three copies of this fold exist: `nameKey`, `NAME_KEY_SQL`, and the one in
    // migrations/0004_authors_become_rows.sql, which cannot call TypeScript. A
    // divergence would show up as a duplicate author months later, so it is
    // asked of Postgres here instead.
    const names = [
      'J.R.R. Tolkien', 'J. R. R. Tolkien', "Tim O'Brien", 'Ursula K. Le Guin',
      'Gabriel García Márquez', 'Gabriel Garcia Marquez', 'National Geographic Society',
      'Martin Luther King Jr.', 'Homer', '  spaced   out  ', 'Böll, Heinrich',
    ]

    for (const name of names) {
      const query = statement(NAME_KEY_SQL(name))
      const row = await db.get<{ upper: string }>(
        `SELECT ${query.text} AS upper`, query.values,
      )
      expect([name, row?.upper]).toEqual([name, nameKey(name)])
    }
  })
})

describe('introducing a name', () => {
  it('gives a name nobody has seen an author of its own', async () => {
    const banks = await authors.introduce(printed('Iain Banks'), 'Banks, Iain')
    const banksM = await authors.introduce(printed('Iain M. Banks'), 'Banks, Iain M.')

    // The conservative half of the rule the migration follows: nothing here can
    // know these are one person, and the guess that says they are is the one
    // nothing can undo.
    expect(banksM.authorId).not.toBe(banks.authorId)
    expect(banks.isPrimary).toBe(true)
  })

  it('introduces one name once, however it is spelled', async () => {
    const first = await authors.introduce(printed('J. R. R. Tolkien'), 'Tolkien, J. R. R.')
    const again = await authors.introduce(printed('J.R.R. Tolkien'), 'Tolkien, J.R.R.')
    expect(again.id).toBe(first.id)
    expect((await authors.everyone())).toHaveLength(1)
  })

  it('does not let a later save rewrite a filing name', async () => {
    // A book being re-saved is not somebody deciding to file its author
    // differently, and deriving the filing name every time is exactly how a
    // correction gets undone.
    await authors.introduce(printed('Gabriel García Márquez'), 'García Márquez, Gabriel')
    const again = await authors.introduce(printed('Gabriel García Márquez'), 'Márquez, Gabriel García')
    expect(again.filing).toBe('García Márquez, Gabriel')
  })

  it('leaves no author behind when the name was already there', async () => {
    await authors.introduce(printed('Homer'), 'Homer')
    await authors.introduce(printed('HOMER'), 'Homer')
    const counted = await db.get<{ count: string }>('SELECT count(*)::text AS count FROM author')
    expect(counted?.count).toBe('1')
  })
})

describe('what a book credits', () => {
  it('keeps the printed order', async () => {
    const id = await aBook('The Talisman')
    const king = await authors.introduce(printed('Stephen King'), 'King, Stephen')
    const straub = await authors.introduce(printed('Peter Straub'), 'Straub, Peter')

    await authors.credit(id, [king.id, straub.id])
    expect((await authors.creditsOf(id)).map((one) => one.name.value))
      .toEqual(['Stephen King', 'Peter Straub'])
  })

  it('restates rather than adds, so a dropped co-author is dropped', async () => {
    const id = await aBook('The Talisman')
    const king = await authors.introduce(printed('Stephen King'), 'King, Stephen')
    const straub = await authors.introduce(printed('Peter Straub'), 'Straub, Peter')

    await authors.credit(id, [king.id, straub.id])
    await authors.credit(id, [straub.id])
    expect((await authors.creditsOf(id)).map((one) => one.name.value)).toEqual(['Peter Straub'])
  })

  it('answers every book credited to any of one person\'s names', async () => {
    // The join the comma-joined string could not do, and the reason an author
    // holds no name.
    const wasp = await aBook('The Wasp Factory')
    const phlebas = await aBook('Consider Phlebas')
    const banks = await authors.introduce(printed('Iain Banks'), 'Banks, Iain')
    const banksM = await authors.introduce(printed('Iain M. Banks'), 'Banks, Iain M.')
    await authors.credit(wasp, [banks.id])
    await authors.credit(phlebas, [banksM.id])

    expect(await authors.booksCreditedTo([banks.id])).toEqual([wasp])
    expect(await authors.booksCreditedTo([banks.id, banksM.id])).toEqual([wasp, phlebas])
    expect(await authors.booksCreditedTo([])).toEqual([])
  })

  it('refuses to lose a name a book is credited to', async () => {
    // `book_author.author_alias_id` is not ON DELETE cascade on purpose: deleting
    // a name somebody's books credit should be refused, not silently take the
    // credits with it.
    const id = await aBook('Dune')
    const herbert = await authors.introduce(printed('Frank Herbert'), 'Herbert, Frank')
    await authors.credit(id, [herbert.id])

    await expect(db.run('DELETE FROM author_alias WHERE id = ?', [herbert.id]))
      .rejects.toThrow()
  })
})

describe('a person filing a name differently', () => {
  it('changes what it files under and nothing about what is printed', async () => {
    const alias = await authors.introduce(printed('Gabriel García Márquez'), 'Márquez, Gabriel García')
    await new FileAliasHandler(authors).handle({
      aliasId: alias.id, filing: 'García Márquez, Gabriel',
    })

    const found = await authors.aliasFor(printed('Gabriel García Márquez'))
    expect(found?.filing).toBe('García Márquez, Gabriel')
    expect(found?.name.value).toBe('Gabriel García Márquez')
  })

  it('refuses a name that is not there, and an empty filing name', async () => {
    const handler = new FileAliasHandler(authors)
    await expect(handler.handle({ aliasId: 9999, filing: 'Nobody' }))
      .rejects.toThrow(/no name 9999/)
    await expect(handler.handle({ aliasId: 1, filing: '  ' }))
      .rejects.toThrow(/file under something/)
  })
})

describe('two authors turning out to be one person', () => {
  it('moves every name and leaves one primary, without moving a book', async () => {
    const wasp = await aBook('The Wasp Factory')
    const phlebas = await aBook('Consider Phlebas')
    const banks = await authors.introduce(printed('Iain Banks'), 'Banks, Iain')
    const banksM = await authors.introduce(printed('Iain M. Banks'), 'Banks, Iain M.')
    await authors.credit(wasp, [banks.id])
    await authors.credit(phlebas, [banksM.id])

    await new MergeAuthorsHandler(authors).handle({
      intoId: banks.authorId, fromId: banksM.authorId,
    })

    const everyone = await authors.everyone()
    expect(everyone).toHaveLength(1)
    expect(everyone[0]!.aliases.map((one) => [one.name.value, one.filing, one.isPrimary]))
      .toEqual([
        ['Iain Banks', 'Banks, Iain', true],
        ['Iain M. Banks', 'Banks, Iain M.', false],
      ])

    // The whole point: the books still credit the same names, and the names
    // still file under the same strings, so no shelf moved.
    expect((await authors.creditsOf(phlebas)).map((one) => [one.name.value, one.filing]))
      .toEqual([['Iain M. Banks', 'Banks, Iain M.']])
    expect(await authors.booksCreditedTo(everyone[0]!.aliases.map((one) => one.id)))
      .toEqual([wasp, phlebas])
  })

  it('refuses an author who is not there, and one who is already themselves', async () => {
    const banks = await authors.introduce(printed('Iain Banks'), 'Banks, Iain')
    const handler = new MergeAuthorsHandler(authors)

    await expect(handler.handle({ intoId: banks.authorId, fromId: banks.authorId }))
      .rejects.toThrow(/already themselves/)
    await expect(handler.handle({ intoId: banks.authorId, fromId: 9999 }))
      .rejects.toThrow(/no author 9999/)
  })
})

describe('crediting a book from what was saved about it', () => {
  const handler = () => new CreditBookHandler(authors)

  it('introduces the names and credits them in order', async () => {
    const id = await aBook('Good Omens')
    await handler().handle({ bookId: id, authors: ['Terry Pratchett', 'Neil Gaiman'] })

    expect((await authors.creditsOf(id)).map((one) => [one.name.value, one.filing])).toEqual([
      ['Terry Pratchett', 'Pratchett, Terry'],
      ['Neil Gaiman', 'Gaiman, Neil'],
    ])
  })

  it('files the first-listed name under the override, and only that one', async () => {
    const id = await aBook('One Hundred Years of Solitude')
    await handler().handle({
      bookId: id,
      authors: ['Gabriel García Márquez', 'Gregory Rabassa'],
      filingOverride: 'García Márquez, Gabriel',
    })

    expect((await authors.creditsOf(id)).map((one) => one.filing))
      .toEqual(['García Márquez, Gabriel', 'Rabassa, Gregory'])
  })

  it('does not undo a correction when the book is saved again', async () => {
    const id = await aBook('One Hundred Years of Solitude')
    await handler().handle({
      bookId: id,
      authors: ['Gabriel García Márquez'],
      filingOverride: 'García Márquez, Gabriel',
    })
    // Saved again with no override, the way a re-lookup would.
    await handler().handle({ bookId: id, authors: ['Gabriel García Márquez'] })

    expect((await authors.creditsOf(id))[0]!.filing).toBe('García Márquez, Gabriel')
  })

  it('credits a person once however many ways the catalogue spells them', async () => {
    const id = await aBook('The Silmarillion')
    await handler().handle({ bookId: id, authors: ['J. R. R. Tolkien', 'J.R.R. Tolkien'] })
    expect(await authors.creditsOf(id)).toHaveLength(1)
  })

  it('leaves a book with no usable names crediting nobody', async () => {
    const id = await aBook('Anonymous')
    await handler().handle({ bookId: id, authors: ['', '  ', '---'] })
    expect(await authors.creditsOf(id)).toEqual([])
  })
})

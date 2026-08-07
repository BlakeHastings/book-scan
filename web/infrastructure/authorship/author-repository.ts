/**
 * `AuthorRepository` over Drizzle, executed through `Db`.
 *
 * The third slice built the way #172 established: the SQL is generated from
 * `infrastructure/db/schema.ts` rather than written out, so a column renamed in
 * the schema is a compile error here rather than a statement that fails on
 * somebody's shelf, and `Db` still owns the connection, the transaction and the
 * advisory lock. Drizzle never sees a connection. See `infrastructure/db/query.ts`
 * for why that is, and `separator-repository.ts` for why an insert spells its own
 * column list instead of using the insert builder.
 *
 * ## A name is looked up folded, and stored as printed
 *
 * `author_alias.display_name` is unique on the exact string, because a book
 * credits a printed name and the printed name is the only identity the model
 * has. But `J.R.R. Tolkien` and `J. R. R. Tolkien` are one name, so a lookup
 * folds both sides with `NAME_KEY_SQL`, which is `nameKey` in
 * `domain/authorship/authors.ts` said in SQL.
 *
 * **There are three copies of that fold and they have to agree**: the domain
 * function, this expression, and the one in
 * `migrations/0004_authors_become_rows.sql`, which cannot call TypeScript.
 * `author-repository.test.ts` asks Postgres for this one's answer over a table
 * of names and compares it against the domain's, so a divergence is a test
 * failure rather than a duplicate author appearing months later.
 *
 * The fold is not indexed, so a lookup is a scan of the vocabulary. Deliberate
 * rather than overlooked: an expression index would carry the same expression a
 * fourth time, and a collection has hundreds of authors where it has thousands
 * of books. If that stops being true the index goes on the expression, not on a
 * second stored column that could disagree with the first.
 */

import { asc, eq, inArray, sql } from 'drizzle-orm'
import type {
  AuthorRepository, StoredAlias, StoredAuthor,
} from '../../application/authorship/ports'
import { Author, PrintedName } from '../../domain/authorship/authors'
import type { Db } from '../../server/driver'
import { build, statement } from '../db/query'
import { author, authorAlias, bookAuthor } from '../db/schema'
import { bookLock } from '../tagging/transactions'

/**
 * `nameKey`, in SQL.
 *
 * `[:alnum:]` rather than `A-Za-z0-9`: the ASCII class would treat every
 * accented letter as a separator and cut `García` into two words. Where the two
 * folds can still disagree is on a character Postgres's ctype and JavaScript's
 * `toUpperCase` classify differently, and a disagreement there costs an extra
 * alias rather than a wrong merge, which is the direction to be wrong in.
 */
export const NAME_KEY_SQL = (value: unknown) =>
  sql`upper(btrim(regexp_replace(btrim(${value}), '[^[:alnum:]]+', ' ', 'g')))`

/** A row as the driver hands it back: column names, not domain names. */
interface AliasRow {
  id: number
  author_id: number
  display_name: string
  filing_name: string
  is_primary: number
}

interface AuthorRow {
  id: number
  is_corporate: number
  note: string
}

const toAlias = (row: AliasRow): StoredAlias => ({
  id: row.id,
  authorId: row.author_id,
  name: PrintedName.of(row.display_name),
  filing: row.filing_name,
  isPrimary: row.is_primary === 1,
})

const ALIAS_COLUMNS = {
  id: authorAlias.id,
  authorId: authorAlias.authorId,
  displayName: authorAlias.displayName,
  filingName: authorAlias.filingName,
  isPrimary: authorAlias.isPrimary,
}

const AUTHOR_COLUMNS = {
  id: author.id,
  isCorporate: author.isCorporate,
  note: author.note,
}

export class DrizzleAuthorRepository implements AuthorRepository {
  constructor(private readonly db: Db) {}

  /**
   * An author and their first name in one statement, then read back.
   *
   * Two statements rather than an upsert, for the reason `DrizzleTagRepository.
   * define` gives: an upsert would rewrite the filing name every time a book was
   * saved, and the filing name is a person's to change.
   *
   * The author and the alias are inserted together so a race cannot leave an
   * author behind with no name: the alias insert selects from the author insert,
   * and the author insert writes nothing when the name has appeared since the
   * read above. The loser of the race then reads the winner's row.
   */
  async introduce(name: PrintedName, filing: string): Promise<StoredAlias> {
    const found = await this.aliasFor(name)
    if (found) return found

    const insert = statement(sql`
      with new_author as (
        insert into ${author} (${sql.identifier(author.note.name)})
        select ''
         where not exists (
           select 1 from ${authorAlias}
            where ${NAME_KEY_SQL(authorAlias.displayName)} = ${NAME_KEY_SQL(name.value)}
         )
        returning ${sql.identifier(author.id.name)}
      )
      insert into ${authorAlias} (
        ${sql.identifier(authorAlias.authorId.name)},
        ${sql.identifier(authorAlias.displayName.name)},
        ${sql.identifier(authorAlias.filingName.name)},
        ${sql.identifier(authorAlias.isPrimary.name)}
      )
      select ${sql.identifier(author.id.name)}, ${name.value}, ${filing}, 1
        from new_author
      on conflict (${sql.identifier(authorAlias.displayName.name)}) do nothing
    `)
    await this.db.run(insert.text, insert.values)

    const alias = await this.aliasFor(name)
    // The insert either wrote the row or found one already there, so there is no
    // third case. An absence here is a broken statement, not a state to handle.
    if (!alias) throw new Error(`the name ${name.value} was neither written nor found`)
    return alias
  }

  async aliasFor(name: PrintedName): Promise<StoredAlias | null> {
    const query = statement(
      build.select(ALIAS_COLUMNS).from(authorAlias)
        .where(sql`${NAME_KEY_SQL(authorAlias.displayName)} = ${NAME_KEY_SQL(name.value)}`)
        // The fold is wider than the unique index, so it can in principle match
        // two rows. The oldest is the one the migration or the first save wrote,
        // and answering the same one every time matters more than which it is.
        .orderBy(asc(authorAlias.id)).limit(1),
    )
    const row = await this.db.get<AliasRow>(query.text, query.values)
    return row ? toAlias(row) : null
  }

  async everyone(): Promise<StoredAuthor[]> {
    const authors = statement(
      build.select(AUTHOR_COLUMNS).from(author).orderBy(asc(author.id)),
    )
    const aliases = statement(
      build.select(ALIAS_COLUMNS).from(authorAlias)
        .orderBy(asc(authorAlias.authorId), asc(authorAlias.id)),
    )
    return assemble(
      await this.db.all<AuthorRow>(authors.text, authors.values),
      await this.db.all<AliasRow>(aliases.text, aliases.values),
    )
  }

  async find(authorId: number): Promise<StoredAuthor | null> {
    const one = statement(
      build.select(AUTHOR_COLUMNS).from(author).where(eq(author.id, authorId)),
    )
    const found = await this.db.get<AuthorRow>(one.text, one.values)
    if (!found) return null

    const aliases = statement(
      build.select(ALIAS_COLUMNS).from(authorAlias)
        .where(eq(authorAlias.authorId, authorId)).orderBy(asc(authorAlias.id)),
    )
    return assemble([found], await this.db.all<AliasRow>(aliases.text, aliases.values))[0] ?? null
  }

  async file(aliasId: number, filing: string): Promise<void> {
    const query = statement(
      build.update(authorAlias).set({ filingName: filing }).where(eq(authorAlias.id, aliasId)),
    )
    const { changes } = await this.db.run(query.text, query.values)
    if (!changes) throw new Error(`there is no name ${aliasId} to file`)
  }

  /**
   * Move every alias, then delete the emptied author.
   *
   * The delete is what makes this a merge rather than a copy: an author with no
   * names is nobody, and leaving the row would put an unnameable person in every
   * listing. Nothing else references an author, so nothing is orphaned, and the
   * books still credit the same aliases, which is why nothing moves on a shelf.
   *
   * The moved aliases stop being primary in the same statement, so there is
   * never a moment when one person has two names they are called by.
   */
  async absorb(intoId: number, fromId: number): Promise<void> {
    await this.db.tx(async (tx) => {
      const move = statement(
        build.update(authorAlias).set({ authorId: intoId, isPrimary: 0 })
          .where(eq(authorAlias.authorId, fromId)),
      )
      await tx.run(move.text, move.values)

      const remove = statement(build.delete(author).where(eq(author.id, fromId)))
      await tx.run(remove.text, remove.values)
    })
  }

  async creditsOf(bookId: number): Promise<StoredAlias[]> {
    const query = statement(
      build.select(ALIAS_COLUMNS).from(bookAuthor)
        .innerJoin(authorAlias, eq(bookAuthor.authorAliasId, authorAlias.id))
        .where(eq(bookAuthor.bookId, bookId))
        .orderBy(asc(bookAuthor.position)),
    )
    return (await this.db.all<AliasRow>(query.text, query.values)).map(toAlias)
  }

  /**
   * The book's credits afterwards are exactly these, in this order.
   *
   * Delete then insert, in a transaction serialised on the book, so two saves of
   * one book take turns rather than interleaving into a mixture of both. The
   * lock name comes from `infrastructure/tagging/transactions.ts`, which asks
   * that a second thing serialising on a book import that name rather than spell
   * its own: two spellings of a lock name are two locks, and the second one
   * serialises against nothing.
   */
  async credit(bookId: number, aliasIds: readonly number[]): Promise<void> {
    await this.db.tx(async (tx) => {
      const clear = statement(build.delete(bookAuthor).where(eq(bookAuthor.bookId, bookId)))
      await tx.run(clear.text, clear.values)

      for (const [at, aliasId] of aliasIds.entries()) {
        const add = statement(sql`
          insert into ${bookAuthor} (
            ${sql.identifier(bookAuthor.bookId.name)},
            ${sql.identifier(bookAuthor.position.name)},
            ${sql.identifier(bookAuthor.authorAliasId.name)}
          ) values (${bookId}, ${at + 1}, ${aliasId})
        `)
        await tx.run(add.text, add.values)
      }
    }, { serialiseOn: bookLock(bookId) })
  }

  /**
   * Every book credited to any of these names.
   *
   * The join the comma-joined string could not do. "Everything by this person"
   * is this, over all of one author's aliases at once, which is what makes
   * Banks and Banks M one answer while they stay two places on the shelf.
   */
  async booksCreditedTo(aliasIds: readonly number[]): Promise<number[]> {
    if (!aliasIds.length) return []
    const query = statement(
      build.selectDistinct({ bookId: bookAuthor.bookId }).from(bookAuthor)
        .where(inArray(bookAuthor.authorAliasId, [...aliasIds]))
        .orderBy(asc(bookAuthor.bookId)),
    )
    return (await this.db.all<{ book_id: number }>(query.text, query.values))
      .map((row) => row.book_id)
  }
}

/** Rows to aggregates, with the ids the application layer acts on kept beside. */
function assemble(authors: AuthorRow[], aliases: AliasRow[]): StoredAuthor[] {
  const byAuthor = new Map<number, StoredAlias[]>()
  for (const row of aliases) {
    const found = byAuthor.get(row.author_id) ?? []
    found.push(toAlias(row))
    byAuthor.set(row.author_id, found)
  }

  return authors.flatMap((row) => {
    const stored = byAuthor.get(row.id) ?? []
    // An author with no names cannot be built and should not exist: `absorb`
    // deletes the one it empties. Skipped rather than thrown on, because a
    // listing that refuses to render is a worse answer than one missing a row
    // that has nothing to show anyway.
    if (!stored.length) return []
    return [{
      id: row.id,
      author: Author.of(
        stored.map((alias) => ({
          name: alias.name, filing: alias.filing, isPrimary: alias.isPrimary,
        })),
        row.is_corporate === 1,
        row.note,
      ),
      aliases: stored,
    }]
  })
}

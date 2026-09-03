/**
 * `TagRepository` over Drizzle, executed through `Db`.
 *
 * The second slice built the way #172 established: the SQL is generated from
 * `infrastructure/db/schema.ts` rather than written out, so a column renamed in
 * the schema is a compile error here rather than a statement that fails on
 * somebody's shelf, and `Db` still owns the connection, the transaction and the
 * advisory lock. Drizzle never sees a connection. See `infrastructure/db/query.ts`
 * for why that is, and `separator-repository.ts` for why an insert spells its own
 * column list instead of using the insert builder.
 *
 * **Postgres only.** `tag` and `book_tag` arrive in a migration, and migrations
 * exist only for Postgres: SQLite keeps a hand-written schema that stage I (#178)
 * is removing along with the driver. Nothing here is dialect-specific on purpose,
 * but nothing tests it on SQLite either, because there is no SQLite database in
 * this project that has these tables.
 *
 * ## The prefix query is a range, not a LIKE
 *
 * "Everything under `genre`" is asked as `slug >= 'genre/' AND slug < 'genre0'`
 * rather than `slug LIKE 'genre/%'`, and the difference is the whole reason the
 * column carries `COLLATE "C"`. A range over a byte-ordered column is an index
 * range on `tag_slug_key`, which is what docs/data-model.md promises. A `LIKE`
 * whose pattern arrives as a parameter cannot be turned into one when the plan is
 * made, so it degrades to a scan of the vocabulary, and it does so silently: the
 * answers are identical and only the plan changes. `tag-repository.test.ts` reads
 * the plan back out of Postgres rather than trusting this paragraph.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Tag, TagApplication, TagRepository } from '../../application/tagging/ports'
import {
  TagSlug, type AppliedTag, type TagConfidence, type TagSource,
} from '../../domain/tagging/tags'
import type { Db } from '../../server/driver'
import { build, statement, type Statement } from '../db/query'
import { bookTag, tag } from '../db/schema'

/** A row as the driver hands it back: column names, not domain names. */
interface TagRow {
  id: number
  slug: string
  label: string
  note: string
}

interface AppliedRow {
  slug: string
  source: TagSource
  confidence: TagConfidence
  added_at: string
}

const toTag = (row: TagRow): Tag => ({
  id: row.id,
  slug: TagSlug.of(row.slug),
  label: row.label,
  note: row.note,
})

const toApplied = (row: AppliedRow): AppliedTag => ({
  slug: TagSlug.of(row.slug),
  source: row.source,
  confidence: row.confidence,
})

/**
 * The first string, byte for byte, that is not under this prefix.
 *
 * `genre/` gives `genre0`, because `/` is 0x2F and `0` is 0x30. Every string
 * beginning `genre/` sorts between the two and nothing else does, which is what
 * makes the pair a half-open range a btree can seek. Correct for any prefix
 * whose last character is not 0x10FFFF, and every slug ends in `/` here.
 */
function afterPrefix(prefix: string): string {
  const last = prefix.charCodeAt(prefix.length - 1)
  return prefix.slice(0, -1) + String.fromCharCode(last + 1)
}

/**
 * The vocabulary query, or the part of it at or under one slug.
 *
 * Exported so the test can hand the exact statement to `EXPLAIN` and read the
 * plan back. A test that built its own equivalent query would prove that some
 * range query uses the index, which is not the claim being made.
 */
export function vocabularyQuery(under?: TagSlug): Statement {
  const columns = { id: tag.id, slug: tag.slug, label: tag.label, note: tag.note }
  if (!under) return statement(build.select(columns).from(tag).orderBy(asc(tag.slug)))

  const from = `${under.value}/`
  return statement(
    build.select(columns).from(tag)
      // The tag itself, then everything beneath it. Two conditions rather than
      // one `LIKE`, so both halves are btree comparisons on the indexed column.
      .where(sql`${tag.slug} = ${under.value}
             or (${tag.slug} >= ${from} and ${tag.slug} < ${afterPrefix(from)})`)
      .orderBy(asc(tag.slug)),
  )
}

export class DrizzleTagRepository implements TagRepository {
  constructor(private readonly db: Db) {}

  /**
   * `ON CONFLICT DO NOTHING`, then read it back.
   *
   * Two statements rather than an upsert, and that is the point rather than a
   * shortcut: an upsert would rewrite the label every time a catalogue spelled a
   * heading differently, and the label is a person's to change. The conflict
   * target is the slug, so two callers racing to define one tag both end up with
   * the row the first of them wrote.
   */
  async define(slug: TagSlug, label: string, note = ''): Promise<Tag> {
    const insert = statement(sql`
      insert into ${tag} (
        ${sql.identifier(tag.slug.name)},
        ${sql.identifier(tag.label.name)},
        ${sql.identifier(tag.note.name)}
      ) values (${slug.value}, ${label}, ${note})
      on conflict (${sql.identifier(tag.slug.name)}) do nothing
    `)
    await this.db.run(insert.text, insert.values)

    const found = await this.bySlug(slug)
    // The insert either wrote the row or found one already there, so there is no
    // third case. An absence here is a broken statement, not a state to handle.
    if (!found) throw new Error(`the tag ${slug.value} was neither written nor found`)
    return found
  }

  async relabel(slug: TagSlug, label: string): Promise<void> {
    const query = statement(
      build.update(tag).set({ label }).where(eq(tag.slug, slug.value)),
    )
    await this.db.run(query.text, query.values)
  }

  async vocabulary(under?: TagSlug): Promise<Tag[]> {
    const query = vocabularyQuery(under)
    return (await this.db.all<TagRow>(query.text, query.values)).map(toTag)
  }

  async of(bookId: number): Promise<AppliedTag[]> {
    const query = statement(
      build.select({
        slug: tag.slug,
        source: bookTag.source,
        confidence: bookTag.confidence,
        addedAt: bookTag.addedAt,
      }).from(bookTag)
        .innerJoin(tag, eq(bookTag.tagId, tag.id))
        .where(eq(bookTag.bookId, bookId))
        .orderBy(asc(tag.slug), asc(bookTag.source)),
    )
    return (await this.db.all<AppliedRow>(query.text, query.values)).map(toApplied)
  }

  /**
   * One statement per application, each finding its tag by slug.
   *
   * The `select` inside the insert is what keeps the id out of this layer's
   * callers: a handler names a slug, which is the identity, and never a row id.
   * A slug nobody has defined writes nothing, which would be a tag that silently
   * failed to be applied, so it is turned into an error here.
   */
  async apply(bookId: number, applications: readonly TagApplication[]): Promise<void> {
    for (const application of applications) {
      const query = statement(sql`
        insert into ${bookTag} (
          ${sql.identifier(bookTag.bookId.name)},
          ${sql.identifier(bookTag.tagId.name)},
          ${sql.identifier(bookTag.source.name)},
          ${sql.identifier(bookTag.confidence.name)},
          ${sql.identifier(bookTag.addedAt.name)}
        )
        select ${bookId}, ${tag.id}, ${application.source},
               ${application.confidence}, ${application.addedAt}
          from ${tag} where ${tag.slug} = ${application.slug.value}
        on conflict (
          ${sql.identifier(bookTag.bookId.name)},
          ${sql.identifier(bookTag.tagId.name)},
          ${sql.identifier(bookTag.source.name)}
        ) do update set ${sql.identifier(bookTag.confidence.name)} = excluded.${sql.identifier(bookTag.confidence.name)}
      `)
      const { changes } = await this.db.run(query.text, query.values)
      if (!changes) {
        throw new Error(`there is no tag ${application.slug.value} to apply to book ${bookId}`)
      }
    }
  }

  /**
   * Take tags off a book, optionally only the ones one source claimed.
   *
   * **`source` is part of the `where`, not a filter applied afterwards.** That
   * is what makes "a lookup may retract its own tags and no others" a property
   * of the statement rather than of the code that built the list.
   */
  async retract(bookId: number, slugs: readonly TagSlug[], source?: TagSource): Promise<void> {
    if (!slugs.length) return

    const targets = build.select({ id: tag.id }).from(tag)
      .where(inArray(tag.slug, slugs.map((slug) => slug.value)))

    const query = statement(
      build.delete(bookTag).where(and(
        eq(bookTag.bookId, bookId),
        inArray(bookTag.tagId, targets),
        ...(source ? [eq(bookTag.source, source)] : []),
      )),
    )
    await this.db.run(query.text, query.values)
  }

  /**
   * One statement, with "nothing carries it" inside the `where`.
   *
   * `book_tag.tag_id` is `ON DELETE CASCADE`, so an unguarded delete here does
   * not fail against a tag somebody is using: it silently takes that tag off
   * every book carrying it. The guard is therefore not a nicety and it is not
   * something a caller may be trusted to have done, which is why it is in the
   * statement. `rowCount` says whether the row was there and unused, and a
   * caller that gets `false` asks the database why rather than guessing.
   */
  async remove(slug: TagSlug): Promise<boolean> {
    const query = statement(sql`
      delete from ${tag}
       where ${tag.slug} = ${slug.value}
         and not exists (
           select 1 from ${bookTag}
            where ${bookTag.tagId} = ${tag.id}
         )
    `)
    const done = await this.db.run(query.text, query.values)
    return done.changes > 0
  }

  private async bySlug(slug: TagSlug): Promise<Tag | undefined> {
    const query = statement(
      build.select({ id: tag.id, slug: tag.slug, label: tag.label, note: tag.note })
        .from(tag).where(eq(tag.slug, slug.value)),
    )
    const row = await this.db.get<TagRow>(query.text, query.values)
    return row ? toTag(row) : undefined
  }
}

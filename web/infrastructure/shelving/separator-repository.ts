/**
 * `SeparatorRepository` over Drizzle, executed through `Db`.
 *
 * The vertical slice #172 exists to be judged on. Everything the shelving code
 * does to the `separators` table happens here and nowhere else, in six methods,
 * and the SQL is generated from `infrastructure/db/schema.ts` rather than
 * written out, so a column renamed in the schema is a compile error here rather
 * than a statement that fails on somebody's shelf.
 *
 * ## The one query that is not built by the query builder
 *
 * `add` uses a `sql` template. It has to, and the reason is the most useful
 * thing this slice found:
 *
 * **Drizzle's insert builder names every column of the table and writes the
 * `DEFAULT` keyword for the ones the caller left out**, so `db.insert(...)`
 * produces `insert into "separators" ("id", ...) values (default, ?, ...)`.
 * Postgres takes that. SQLite has no spelling for `DEFAULT` in a `VALUES` list
 * and answers `near "default": syntax error`, and this app still ships both
 * drivers behind one `Db` until stage I removes SQLite. There is no option on
 * the builder for it: the pg dialect omits a column only when the column
 * refuses inserts altogether, which for an identity column means declaring it
 * `GENERATED ALWAYS`, and it is deliberately `BY DEFAULT` so the stage H
 * migration can carry the ids the SQLite rows already have.
 *
 * So `add` spells the column list itself, from the schema's own column names.
 * The select, update and delete the builder generates are accepted verbatim by
 * both drivers, which is why they are left alone, and why the whole of
 * `dividers.test.ts` runs against this file on SQLite as well as Postgres.
 */

import { asc, eq, sql } from 'drizzle-orm'
import type { NewSeparator, SeparatorRepository } from '../../application/shelving/ports'
import type { Separator, SeparatorKind } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'
import type { Db } from '../../server/driver'
import { build, statement } from '../db/query'
import { separators } from '../db/schema'

/** A row as the driver hands it back: column names, not domain names. */
interface SeparatorRow {
  id: number
  shelf_range: ShelfRange
  kind: SeparatorKind
  starts_at: string
  position: number
  note: string
  created_at: string
}

/**
 * Hand-written, and chosen rather than settled for. Drizzle can be told to
 * hydrate objects itself, and doing so would make the domain shape a function
 * of the table shape, which is the dependency the epic exists to remove. Six
 * lines is a cheap price for `Separator` being free to stop looking like a row,
 * which is exactly what #170 is going to do to it.
 */
const toSeparator = (row: SeparatorRow): Separator => ({
  id: row.id,
  range: row.shelf_range,
  kind: row.kind,
  startsAt: row.starts_at,
  position: row.position,
})

export class DrizzleSeparatorRepository implements SeparatorRepository {
  constructor(private readonly db: Db) {}

  async inRange(range: ShelfRange): Promise<Separator[]> {
    const query = statement(
      build.select().from(separators)
        .where(eq(separators.shelfRange, range))
        .orderBy(asc(separators.position)),
    )
    return (await this.db.all<SeparatorRow>(query.text, query.values)).map(toSeparator)
  }

  async rangeOf(id: number): Promise<ShelfRange | undefined> {
    const query = statement(
      build.select({ shelfRange: separators.shelfRange }).from(separators)
        .where(eq(separators.id, id)),
    )
    const row = await this.db.get<{ shelf_range: ShelfRange }>(query.text, query.values)
    return row?.shelf_range
  }

  async add(separator: NewSeparator): Promise<void> {
    // Keyed by the schema's column names so the two lists cannot drift apart,
    // and ordered, because a column list and a value list that disagree is how
    // an author ends up in a publisher column with nothing noticing.
    const written: Record<string, unknown> = {
      [separators.shelfRange.name]: separator.range,
      [separators.kind.name]: separator.kind,
      [separators.startsAt.name]: separator.startsAt,
      [separators.position.name]: separator.position,
      [separators.note.name]: separator.note,
      [separators.createdAt.name]: separator.createdAt,
    }
    const names = Object.keys(written)

    const query = statement(sql`
      insert into ${separators} (${sql.join(names.map((name) => sql.identifier(name)), sql`, `)})
      values (${sql.join(Object.values(written).map((value) => sql`${value}`), sql`, `)})
    `)
    await this.db.run(query.text, query.values)
  }

  async reanchor(id: number, startsAt: string): Promise<void> {
    const query = statement(
      build.update(separators).set({ startsAt }).where(eq(separators.id, id)),
    )
    await this.db.run(query.text, query.values)
  }

  async reposition(id: number, position: number): Promise<void> {
    const query = statement(
      build.update(separators).set({ position }).where(eq(separators.id, id)),
    )
    await this.db.run(query.text, query.values)
  }

  async remove(id: number): Promise<void> {
    const query = statement(build.delete(separators).where(eq(separators.id, id)))
    await this.db.run(query.text, query.values)
  }
}

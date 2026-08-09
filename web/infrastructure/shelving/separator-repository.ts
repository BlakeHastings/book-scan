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
 *
 * ## Every write here also writes the areas the boundaries name
 *
 * `0013` built `area` from `separators` once and nothing kept the two in step
 * afterwards (#213). The four statements below are the whole of what writes
 * `separators`, so the recording lives on them rather than on `Shelves`, the
 * command handler and the routes that call them: `Shelves.applyBoundary`,
 * `moveAcrossBoundary`, `retractMove` and `RemoveSeparatorHandler` are all
 * covered without any of them being touched, exactly as #214's two command line
 * tools were.
 *
 * `SeparatorRepository` is unchanged, so nothing above this layer learned a new
 * word: the application layer still asks for a boundary to be added and knows
 * nothing about the furniture that follows from it.
 *
 * Each write and its recording go in one transaction, which nests as a savepoint
 * inside the one the caller usually already has open. See `areas.ts` for why the
 * unit is the range rather than the boundary, and for what happens to an area
 * whose boundary is removed.
 */

import { asc, eq, sql } from 'drizzle-orm'
import type { NewSeparator, SeparatorRepository } from '../../application/shelving/ports'
import type { Separator, SeparatorKind } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'
import type { Db } from '../../server/driver'
import { build, statement } from '../db/query'
import { separators } from '../db/schema'
import { recordAreasOf } from './areas'

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

/**
 * Which range a boundary is in, asked of whichever handle the caller holds.
 *
 * A function rather than only a method because the writes below ask it on their
 * own transaction's handle, before a statement that may delete the row.
 */
async function rangeOf(db: Db, id: number): Promise<ShelfRange | undefined> {
  const query = statement(
    build.select({ shelfRange: separators.shelfRange }).from(separators)
      .where(eq(separators.id, id)),
  )
  const row = await db.get<{ shelf_range: ShelfRange }>(query.text, query.values)
  return row?.shelf_range
}

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
    return rangeOf(this.db, id)
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
    await this.db.tx(async (tx) => {
      await tx.run(query.text, query.values)
      await recordAreasOf(tx, separator.range)
    })
  }

  async reanchor(id: number, startsAt: string): Promise<void> {
    const query = statement(
      build.update(separators).set({ startsAt }).where(eq(separators.id, id)),
    )
    await this.write(id, query)
  }

  /**
   * Renumbering changes nothing a book can see and still writes areas.
   *
   * `position` is the tie-break between two boundaries sharing an anchor, and
   * two on one anchor is what a boundary move that empties an area leaves
   * behind, so the order they are stepped over in is the order this column
   * gives. A renumbering that skipped the recording would leave the two models
   * disagreeing about exactly the arrangement that is hardest to reason about.
   */
  async reposition(id: number, position: number): Promise<void> {
    const query = statement(
      build.update(separators).set({ position }).where(eq(separators.id, id)),
    )
    await this.write(id, query)
  }

  async remove(id: number): Promise<void> {
    const query = statement(build.delete(separators).where(eq(separators.id, id)))
    await this.write(id, query)
  }

  /**
   * Run a statement about one boundary, and write the areas of the range it was
   * in.
   *
   * The range is read **before** the statement, because `remove` deletes the one
   * row that knows it. A boundary that has already gone leaves nothing to record
   * and the statement itself is a no-op, so both do nothing.
   */
  private async write(id: number, query: { text: string; values: unknown[] }): Promise<void> {
    await this.db.tx(async (tx) => {
      const range = await rangeOf(tx, id)
      await tx.run(query.text, query.values)
      if (range) await recordAreasOf(tx, range)
    })
  }
}

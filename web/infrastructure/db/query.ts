/**
 * How a Drizzle query becomes something `Db` will run.
 *
 * ## Drizzle runs inside `Db`, not instead of it
 *
 * `Db` (web/server/driver.ts) is not in the way here and is not being worked
 * around. Stages F and G proved transaction pinning on it against a real
 * Postgres with `pg_backend_pid()`, and it carries the advisory lock that makes
 * a read-then-write over one shelf range take its turn. Handing Drizzle its own
 * pool would put the separators repository outside both, so a boundary written
 * through Drizzle would sit in a different transaction from the books the same
 * request moved, and `serialiseOn` would be silently unenforced for it.
 *
 * So what is taken from Drizzle is the typed schema and the SQL it builds, and
 * what stays with `Db` is the execution. Drizzle never sees a connection.
 *
 * ## The one adaptation, and why it is a subclass
 *
 * `Db` reads three placeholder styles and translates them per driver
 * (`bindParams`). It does not read `$1`, which is the style Drizzle's Postgres
 * dialect emits, and it should not: `$1` is one driver's spelling, and teaching
 * the translator to read the dialect it also writes is how a statement gets
 * numbered twice.
 *
 * `PgDialect.escapeParam` is the single method that decides that spelling, so
 * the subclass below is three lines and changes nothing else about how the SQL
 * is built. The alternative was a scanner that rewrote `$n` back to `?` after
 * the fact and reordered the values to match, which is a second copy of the
 * quoting and comment rules `bindParams` already implements, written to undo
 * work that had just been done.
 *
 * The cost, and it is worth knowing before fourteen tables follow: `PgDialect`
 * is exported from `drizzle-orm/pg-core` but `escapeParam` is not part of any
 * documented extension point, so a Drizzle upgrade could rename it. It fails
 * loudly if that happens, because the generated SQL would carry `$1` and the
 * translator refuses a statement whose placeholders it cannot account for.
 * `separator-repository.test.ts` asserts the generated text, so the refusal
 * arrives in a unit test rather than on somebody's shelf.
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQLWrapper } from 'drizzle-orm'

/**
 * Postgres, spelled with the anonymous placeholder the translator reads.
 *
 * Nothing else about the dialect changes: the quoting, the operators, the
 * `RETURNING` clause and the identifier casing are all Drizzle's.
 */
class AnonymousPlaceholders extends PgDialect {
  override escapeParam(): string {
    return '?'
  }
}

const dialect = new AnonymousPlaceholders()

/**
 * A Drizzle instance with no connection under it, used only to build queries.
 *
 * `drizzle.mock()` is Drizzle's own name for this: it wires up the query
 * builders and leaves the session throwing, so `.getSQL()` works and executing
 * one cannot. That is the property wanted here, and it is stronger than a
 * convention: there is no connection for a stray `await` on a builder to reach.
 */
export const build = drizzle.mock()

/** A statement in the shape `Db.all`, `Db.get` and `Db.run` take. */
export interface Statement {
  text: string
  values: unknown[]
}

/**
 * Render anything Drizzle can build into text and values.
 *
 * Takes an `SQLWrapper`, which is what every query builder and every `sql`
 * template already is, so a caller never has to say which of the two it has.
 */
export function statement(query: SQLWrapper): Statement {
  const { sql, params } = dialect.sqlToQuery(query.getSQL())
  return { text: sql, values: [...params] }
}

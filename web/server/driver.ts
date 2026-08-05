/**
 * The seam between the stores and whatever database is underneath them.
 *
 * Nothing in this file knows what a driver is. It holds the interface the three
 * stores are written against and the placeholder translation both drivers need,
 * so a second implementation is a new file rather than an edit to this one.
 *
 * The interface is deliberately the smallest thing that answers what
 * `Store`, `Shelves` and `CaptureQueue` actually ask for. What is missing from
 * it is the point:
 *
 * - No `prepare`, and no statement object. A prepared statement is a handle
 *   whose lifetime the caller then owns, and better-sqlite3's version of it
 *   runs synchronously. Both are properties of one driver, and a store that
 *   could see either would be written to them.
 * - No `exec` for arbitrary multi-statement SQL. The only caller that wants it
 *   is schema creation, which is per-dialect and stays with the driver.
 * - No `pragma`. SQLite has them, Postgres does not, and the stores have never
 *   asked.
 * - No `lastInsertRowid`. Stage D replaced the three reads of it with
 *   `INSERT ... RETURNING id`, so there is nothing left to expose.
 * - No escape hatch to the underlying handle. An escape hatch is how the
 *   driver-specific call that stage F is supposed to find gets to hide until
 *   production.
 */

/**
 * What a statement is given: a list for `?` placeholders, or a map for the
 * `@name` and `:name` ones. Both styles are in the SQL as stage D left it, and
 * translating them is this file's job rather than each call site's.
 */
export type Params = readonly unknown[] | Readonly<Record<string, unknown>>

export interface Db {
  all<Row>(sql: string, params?: Params): Promise<Row[]>
  get<Row>(sql: string, params?: Params): Promise<Row | undefined>
  run(sql: string, params?: Params): Promise<{ changes: number }>
  /**
   * Run `work` in a transaction, committing when it resolves and rolling back
   * when it rejects.
   *
   * Nests. `Store.addBook` opens a transaction and a caller may already be
   * inside one, so an implementation opens a savepoint rather than refusing or
   * silently flattening the inner one into the outer.
   */
  tx<T>(work: (db: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** A statement with every placeholder rewritten, and the values in order. */
export interface BoundStatement {
  text: string
  values: unknown[]
}

/**
 * How one dialect spells the nth placeholder. `position` is 1-based, which is
 * what the numbered style wants and what the anonymous style ignores.
 */
export type PlaceholderStyle = (position: number) => string

/** SQLite, and the style most of the statements are already written in. */
export const anonymous: PlaceholderStyle = () => '?'

/** Postgres, which has only this one. Unused until stage F, tested here. */
export const numbered: PlaceholderStyle = (position) => `$${position}`

const NAME_START = /[A-Za-z_]/
const NAME_BODY = /[A-Za-z0-9_]/

/**
 * Rewrite every placeholder in `sql` into one dialect's style, and put the
 * values in the order that style will read them.
 *
 * Three styles reach this function, and they are not a matter of taste. `?` is
 * in most statements; `@name` is in the two big writes, `attach`, `claim`,
 * `edit` and the worker's settle; `:name` is in `findByIsbn` and
 * `missingCovers`. Stage D left them alone on purpose: hand-rewriting a
 * 26-column insert into positional parameters is how an author ends up in a
 * publisher column with nothing noticing.
 *
 * A name that appears twice gets a placeholder and a value each time it
 * appears, because the anonymous style has no way to refer back to an earlier
 * one. `CaptureQueue.attach` mentions `@slot` twice, so this is exercised
 * rather than theoretical, as is a statement whose placeholder count varies per
 * call: `CaptureQueue.list` builds its `IN (?, ?, ...)` from however many
 * statuses it was asked for, and a translator that walked the placeholders in
 * order needs to know nothing about that.
 *
 * **Quoted text and comments are skipped**, which is not a nicety. The SQL in
 * this repository carries `--` comments explaining the statements they sit in,
 * and those comments contain apostrophes ("the row's own columns") and colons.
 * A scanner that took either for SQL would either rewrite a comment or lose
 * track of where the string literals end.
 */
export function bindParams(
  sql: string,
  params: Params | undefined,
  style: PlaceholderStyle,
): BoundStatement {
  const positional = Array.isArray(params) ? (params as readonly unknown[]) : undefined
  const named = positional === undefined && params !== undefined
    ? (params as Readonly<Record<string, unknown>>)
    : undefined

  const values: unknown[] = []
  const seen = new Set<string>()
  let text = ''
  let taken = 0
  let i = 0

  while (i < sql.length) {
    const char = sql[i]

    // A line comment runs to the newline, which is left to the next pass.
    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      text += sql.slice(i, stop)
      i = stop
      continue
    }

    if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      text += sql.slice(i, stop)
      i = stop
      continue
    }

    // A string literal or a quoted identifier. Doubling the quote escapes it,
    // which is how both dialects spell it and how `"checkedOut"` survives.
    if (char === "'" || char === '"') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] !== char) {
          j += 1
          continue
        }
        if (sql[j + 1] === char) {
          j += 2
          continue
        }
        j += 1
        break
      }
      text += sql.slice(i, j)
      i = j
      continue
    }

    if (char === '?') {
      // `?1` is SQLite's repeated-parameter syntax, which Postgres has no
      // spelling for. Stage B removed the one use of it; this refuses rather
      // than reading it as an anonymous placeholder followed by a stray digit.
      if (NAME_BODY.test(sql[i + 1] ?? '')) {
        throw new Error(`numbered placeholders are not supported: ${sql.slice(i, i + 4)}`)
      }
      if (!positional) {
        throw new Error('a statement with ? placeholders needs a list of values')
      }
      if (taken >= positional.length) {
        throw new Error(
          `too few values: the statement has more ? placeholders than the ${positional.length} given`,
        )
      }
      values.push(positional[taken])
      taken += 1
      text += style(values.length)
      i += 1
      continue
    }

    if ((char === '@' || char === ':') && NAME_START.test(sql[i + 1] ?? '')) {
      let j = i + 1
      while (j < sql.length && NAME_BODY.test(sql[j] ?? '')) j += 1
      const name = sql.slice(i + 1, j)

      if (!named) {
        throw new Error(`a statement with ${char}${name} needs a map of values`)
      }
      if (!(name in named)) {
        throw new Error(`no value was given for ${char}${name}`)
      }
      values.push(named[name])
      seen.add(name)
      text += style(values.length)
      i = j
      continue
    }

    text += char
    i += 1
  }

  // Both mismatches are refused for the same reason better-sqlite3 refuses
  // them: a value nobody read is a name somebody mistyped, and finding that at
  // the call site beats finding it in a row that quietly kept its old value.
  if (positional && taken !== positional.length) {
    throw new Error(
      `too many values: ${positional.length} given, ${taken} ? placeholders in the statement`,
    )
  }
  if (named) {
    const unused = Object.keys(named).filter((name) => !seen.has(name))
    if (unused.length) {
      throw new Error(`values given for names the statement does not use: ${unused.join(', ')}`)
    }
  }

  return { text, values }
}

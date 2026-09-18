/**
 * The seam between the stores and the database underneath them. Nothing here
 * knows what a driver is: this interface is what the stores may see, and
 * db.pg.ts is what they may not.
 *
 * Deliberately missing: `prepare` and any statement handle, `exec` for
 * multi-statement SQL (only schema creation wants it, and that stays with the
 * driver), `pragma`, `lastInsertRowid` (use `INSERT ... RETURNING id` instead),
 * and any escape hatch to the underlying handle.
 */

/** What a statement is given: a list for `?` placeholders, or a map for `@name`/`:name` ones. */
export type Params = readonly unknown[] | Readonly<Record<string, unknown>>

/**
 * A transaction is not mutual exclusion. Postgres runs at READ COMMITTED,
 * where every statement takes its own fresh snapshot, so a `SELECT` and the
 * `INSERT` decided from it, inside one `BEGIN`/`COMMIT`, can still have
 * somebody else's row appear between them. A read-then-write that has to be
 * the only one in flight has to say so.
 */
export interface TxOptions {
  /**
   * Serialise this transaction against every other one naming the same string.
   *
   * The name is the thing being read and then written, not the statement: two
   * books being filed into the fiction range contend, a book going into fiction
   * and a book going into nonfiction do not, and nothing that only reads waits
   * for either. See `rangeLock` in shelves.ts for the one namespace in use.
   *
   * Held for the length of the transaction and released only by commit or
   * rollback, never by this code.
   */
  serialiseOn?: string
}

export interface Db {
  all<Row>(sql: string, params?: Params): Promise<Row[]>
  get<Row>(sql: string, params?: Params): Promise<Row | undefined>
  run(sql: string, params?: Params): Promise<{ changes: number }>
  /**
   * Run `work` in a transaction, committing when it resolves and rolling back
   * when it rejects.
   *
   * Nests: a caller may already be inside a transaction, so an implementation
   * opens a savepoint rather than refusing or flattening the inner one into
   * the outer. `options.serialiseOn` is about concurrency, not atomicity; see
   * `TxOptions`.
   */
  tx<T>(work: (db: Db) => Promise<T>, options?: TxOptions): Promise<T>
  close(): Promise<void>
}

/**
 * A stable 64-bit signed key for a lock name, using FNV-1a: the same name
 * always produces the same number and two names rarely collide. A collision is
 * not a correctness bug here, just two unrelated ranges serialising against
 * each other.
 *
 * Written here rather than in db.pg.ts so it can be tested without a server.
 */
export function lockKey(name: string): bigint {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < name.length; i += 1) {
    hash ^= BigInt(name.charCodeAt(i))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  // Postgres advisory locks take a signed bigint, so the top half of the
  // unsigned range has to come back as a negative number rather than as a
  // value the server refuses.
  return hash >= 0x8000000000000000n ? hash - 0x10000000000000000n : hash
}

export interface BoundStatement {
  text: string
  values: unknown[]
}

const NAME_START = /[A-Za-z_]/
const NAME_BODY = /[A-Za-z0-9_]/

/**
 * Rewrite every placeholder in `sql` as `$1`, `$2`, and put the values in the
 * order Postgres will read them.
 *
 * A name that appears twice gets a placeholder and a value each time it
 * appears, rather than a second reference to the first placeholder.
 *
 * Quoted text and comments are skipped rather than scanned as SQL: the SQL in
 * this repository carries `--` comments containing apostrophes and colons, and
 * a scanner that took either for SQL would rewrite a comment or lose track of
 * where a string literal ends.
 */
export function bindParams(sql: string, params?: Params): BoundStatement {
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
      // spelling for; this refuses rather than reading it as an anonymous
      // placeholder followed by a stray digit.
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
      text += `$${values.length}`
      i += 1
      continue
    }

    // `::` is a cast, not a name: reading the second colon as a placeholder
    // would turn a cast into a parameter nobody passed.
    if (char === ':' && sql[i + 1] === ':') {
      text += '::'
      i += 2
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
      text += `$${values.length}`
      i = j
      continue
    }

    text += char
    i += 1
  }

  // Both mismatches are refused: a value nobody read is likely a name
  // somebody mistyped.
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

/**
 * The seam between the stores and the database underneath them.
 *
 * Nothing in this file knows what a driver is. It holds the interface the three
 * stores are written against and the placeholder translation the driver needs.
 * It stays a separate file from db.pg.ts now that there is one implementation
 * again, because it is what the stores may see and db.pg.ts is what they may
 * not.
 *
 * The interface is deliberately the smallest thing that answers what
 * `Store`, `Shelves` and `CaptureQueue` actually ask for. What is missing from
 * it is the point:
 *
 * - No `prepare`, and no statement object. A prepared statement is a handle
 *   whose lifetime the caller then owns, and better-sqlite3's version of it ran
 *   synchronously. Both were properties of one driver, and a store that could
 *   see either would have been written to them.
 * - No `exec` for arbitrary multi-statement SQL. The only caller that wants it
 *   is schema creation, which is per-dialect and stays with the driver.
 * - No `pragma`. SQLite had them, Postgres does not, and the stores never
 *   asked.
 * - No `lastInsertRowid`. Stage D replaced the three reads of it with
 *   `INSERT ... RETURNING id`, so there is nothing left to expose.
 * - No escape hatch to the underlying handle. An escape hatch is how a
 *   driver-specific call gets to hide until production.
 */

/**
 * What a statement is given: a list for `?` placeholders, or a map for the
 * `@name` and `:name` ones. Both styles are in the SQL as stage D left it, and
 * translating them is this file's job rather than each call site's.
 */
export type Params = readonly unknown[] | Readonly<Record<string, unknown>>

/**
 * What a transaction is asked for beyond atomicity.
 *
 * **A transaction is not mutual exclusion, and assuming it is was the mistake
 * stage G had to unpick.** A transaction commits or rolls back as one unit, and
 * that does not stop another transaction committing a row in the middle of this
 * one: Postgres runs at READ COMMITTED, where every statement takes its own
 * fresh snapshot. A `SELECT` and the `INSERT` decided from it, inside one
 * `BEGIN`/`COMMIT`, can still have somebody else's row appear between them.
 *
 * The SQLite driver happened to be safe here, and for a reason that was a
 * property of that driver rather than of transactions: there was one connection
 * and a transaction held it for its whole length. That is exactly the lock
 * `PgDb` deliberately does not carry over, because Postgres has real
 * connections and an unrelated statement running alongside is the point of
 * having moved to it.
 *
 * So a read-then-write that has to be *the only one* in flight has to say so.
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
   * Held for the length of the transaction and released by the commit or the
   * rollback, never by this code. A lock whose release is somebody's `finally`
   * block is a lock that outlives a crash, and on a pooled connection it would
   * outlive it on a connection handed to the next request.
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
   * Nests. `Store.addBook` opens a transaction and a caller may already be
   * inside one, so an implementation opens a savepoint rather than refusing or
   * silently flattening the inner one into the outer.
   *
   * `options.serialiseOn` is the part that is about concurrency rather than
   * atomicity. See `TxOptions`.
   */
  tx<T>(work: (db: Db) => Promise<T>, options?: TxOptions): Promise<T>
  close(): Promise<void>
}

/**
 * A stable 64-bit signed key for a lock name.
 *
 * FNV-1a, because the only properties wanted are that the same name always
 * produces the same number and that two names rarely collide. A collision is
 * not a correctness bug here: two unrelated ranges would serialise against each
 * other, which costs concurrency and nothing else.
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

/** A statement with every placeholder rewritten, and the values in order. */
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
 * Until stage I the output spelling was an argument, because SQLite wanted `?`
 * where Postgres wants `$n`, and routing SQLite through this translator from
 * stage E is what got the translation exercised by the whole suite a stage
 * before the driver that needed it existed. There is one output spelling now.
 *
 * Three input styles reach this function, and they are not a matter of taste.
 * `?` is in most statements; `@name` is in the two big writes, `attach`, `claim`,
 * `edit` and the worker's settle; `:name` is in `findByIsbn` and
 * `missingCovers`. Stage D left them alone on purpose: hand-rewriting a
 * 26-column insert into positional parameters is how an author ends up in a
 * publisher column with nothing noticing.
 *
 * A name that appears twice gets a placeholder and a value each time it
 * appears, rather than a second reference to the first placeholder.
 * `CaptureQueue.attach` mentions `@slot` twice, so this is exercised
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
      text += `$${values.length}`
      i += 1
      continue
    }

    // `::` is a cast, not a name. Stage D took the one use of it out for being
    // Postgres-only, and reading the second colon as a placeholder would turn
    // any that came back into a parameter nobody passed.
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

/**
 * Reading, and resetting, the database the app under test is writing to.
 *
 * This is the point of the suite. A book that renders on screen but was
 * persisted with the wrong filing name, or not persisted at all, is exactly
 * the bug a screen-only assertion misses, so every journey ends by opening the
 * database and looking.
 *
 * **Postgres since stage G, and the shape of that change is worth stating.**
 * The connection is not guessed and not rebuilt here: it is read out of the api
 * resource's own environment by global-setup, so this opens the database the
 * AppHost gave the app rather than one reconstructed and hoped to match. That
 * is the same argument the old version made for asking `/api/health` for a file
 * path, and it is a better answer than teaching a health endpoint to hand out a
 * password.
 *
 * Every method is asynchronous now, because `pg` is. That is the only change to
 * the step files: not one assertion moved, and if one had to, the migration
 * changed behaviour and that is the finding rather than something to
 * accommodate.
 *
 * Safe to open alongside the running server, which is the whole reason a real
 * database was worth moving to: these are separate connections, and the app
 * goes on serving while a scenario reads.
 */

import pg from 'pg'

export interface BookRow {
  id: number
  isbn13: string
  isbn10: string
  title: string
  subtitle: string
  authors: string
  publisher: string
  published: string
  pages: string
  shelf_range: string
  author_filing: string
  sort_key: string
  location: string
  front_image: string
  back_image: string
  edge_image: string
  cover_image: string
  isbn_source: string
  lookup_source: string
  checked_out_at: string | null
}

/**
 * A book photographed but not yet filed.
 *
 * Not a table any more since #183: the queue was dissolved into `books`, so a
 * row here is a book in one of the three early states, read back through the
 * projection below. The field names are unchanged because the app's wire
 * vocabulary is unchanged, and a suite that had to be rewritten alongside a
 * table move would stop being independent evidence that the move kept its
 * promises.
 */
export interface CaptureRow {
  id: number
  status: string
  isbn13: string
  isbn10: string
  isbn_source: string
  title_guess: string
  /** What the background worker read off the photographs. */
  draft_json: string
  /** What a person stated while it sat in the queue. */
  edit_json: string
  edited_by: string
  edited_at: string | null
  note: string
  claimed_by: string
  book_id: number | null
  /**
   * Hash of the front photograph, written by the background pass after the
   * reading. Empty until then, and empty for good on a frame the hash refused
   * as featureless. It is what lets a book held up be recognised as one
   * already waiting to be shelved.
   */
  front_hash: string
}

/**
 * A queued book in the shape the queue has always handed one over.
 *
 * A mirror of `QUEUE_ROW` in web/server/queue.ts, copied rather than imported
 * for the same reason `connectionConfig` below is a copy: this package is a
 * separate npm tree, and reaching into the app to save a dozen lines would give
 * the suite a build dependency on the thing it is testing.
 *
 * Four names are aliased back because #183 renamed the columns underneath them.
 * `status` is derived from `state`, so the four words the steps know survive the
 * seven states arriving. `note` is `scan_note`, because `books.notes` is already
 * a person's note about a book. `created_at` is `scanned_at`, the same moment
 * under the name `books` has always used. And the capture that became a book is
 * the book, so `book_id` is the row's own id once it has left the queue.
 */
const QUEUE_ROW = `
  id,
  CASE "state"
    WHEN 'scanned' THEN 'pending'
    WHEN 'identified' THEN 'ready'
    WHEN 'unidentified' THEN 'failed'
    ELSE 'done'
  END AS status,
  isbn13, isbn10, isbn_source, title_guess, cover_text, analysed,
  draft_json, edit_json, edited_by, edited_at,
  scan_note AS note, claimed_by, claimed_at,
  CASE WHEN "state" IN ('scanned', 'unidentified', 'identified') THEN NULL ELSE id END AS book_id,
  scanned_at AS created_at, processed_at`

/**
 * The photographs, joined on rather than selected, because they are rows in
 * `capture` and not columns on `books` (#228).
 *
 * `current_photograph` is the app's own relation for "the newest photograph of
 * each kind", which is the question every screen asks. Reading it here rather
 * than reproducing the tie-break is deliberate: this suite asserts on what
 * reaches the database, and a second copy of the rule would let both copies be
 * wrong together.
 */
const PHOTOGRAPHS = `
  COALESCE(front.file, '')     AS front_image,
  COALESCE(back.file, '')      AS back_image,
  COALESCE(spine.file, '')     AS edge_image,
  COALESCE(artwork.file, '')   AS cover_image,
  COALESCE(front.hash, '')     AS front_hash`

/** The four joins `PHOTOGRAPHS` reads, against a relation aliased `b`. */
const PHOTOGRAPH_JOINS = `
  LEFT JOIN current_photograph front   ON front.book_id = b.id   AND front.kind = 'front'
  LEFT JOIN current_photograph back    ON back.book_id = b.id    AND back.kind = 'back'
  LEFT JOIN current_photograph spine   ON spine.book_id = b.id   AND spine.kind = 'spine'
  LEFT JOIN current_photograph artwork ON artwork.book_id = b.id AND artwork.kind = 'catalogue'`

export interface SeparatorRow {
  id: number
  shelf_range: string
  kind: string
  starts_at: string
  position: number
}

/**
 * Turn the connection Aspire produced into one node-postgres understands.
 *
 * A copy of the reasoning in web/server/db.pg.ts, not a copy of the code: this
 * package is a separate npm tree with its own dependencies, and importing
 * across the two to save fifteen lines would give the suite a build dependency
 * on the thing it is testing. Aspire hands over ADO.NET keywords, because it
 * produces connection strings for the .NET clients it was built around, and
 * node-postgres reads only the URL form and would take the whole keyword string
 * as a hostname.
 */
export function connectionConfig(value: string): pg.ClientConfig {
  const trimmed = value.trim()
  if (/^postgres(ql)?:\/\//i.test(trimmed)) return { connectionString: trimmed }

  const fields = new Map<string, string>()
  for (const pair of trimmed.split(';')) {
    const at = pair.indexOf('=')
    if (at === -1) continue
    fields.set(pair.slice(0, at).trim().toLowerCase().replace(/\s+/g, ''), pair.slice(at + 1))
  }

  const port = fields.get('port')
  return {
    host: fields.get('host') ?? fields.get('server'),
    port: port ? Number(port) : undefined,
    user: fields.get('username') ?? fields.get('userid') ?? fields.get('user'),
    password: fields.get('password') ?? fields.get('pwd'),
    database: fields.get('database') ?? fields.get('initialcatalog'),
  }
}

/** Host, port and database. Never the credentials: this reaches the console. */
export function describeConnection(value: string): string {
  const config = connectionConfig(value)
  if (config.connectionString) {
    const url = new URL(config.connectionString)
    return `postgres ${url.hostname}:${url.port || '5432'}${url.pathname}`
  }
  return `postgres ${config.host ?? '?'}:${config.port ?? 5432}/${config.database ?? '?'}`
}

export class Catalogue {
  private readonly pool: pg.Pool

  /**
   * @param connection what the api resource was given as
   *   `ConnectionStrings__bookscan`
   * @param coverDir where the app writes photographs, which is still a
   *   directory on disk: cover storage is explicitly out of scope for this
   *   migration and the database holds bare filenames, not paths.
   */
  constructor(connection: string, readonly coverDir: string) {
    this.pool = new pg.Pool({ ...connectionConfig(connection), max: 2 })
    // node-postgres emits `error` on the pool when an idle client fails, and an
    // `error` event with no listener is one EventEmitter throws. Without this a
    // Postgres blip takes the test runner down rather than one scenario.
    this.pool.on('error', () => {})
  }

  private async all<Row>(sql: string, values: unknown[] = []): Promise<Row[]> {
    const result = await this.pool.query(sql, values)
    return result.rows as Row[]
  }

  /**
   * Back to nothing catalogued.
   *
   * One statement where there were five deletes, because CASCADE handles the
   * order the deletes were spelling out by hand. RESTART IDENTITY so a scenario
   * that reads an id back sees the same numbers a fresh catalogue gives.
   *
   * `shelf_ranges` is deliberately not truncated: it is seeded when the schema
   * is created, and emptying it would leave the app with no range to file into.
   *
   * Photographs on disk are left alone. They are named after the moment they
   * were taken so they cannot collide, and no assertion counts them.
   *
   * `captures` has dropped off the list since #183. The table is still there
   * with its rows in it, but nothing reads or writes it, and naming a table this
   * suite has no opinion about would be asserting that it still matters. It is
   * emptied anyway: it holds a foreign key into `books`, so CASCADE reaches it.
   */
  async reset(): Promise<void> {
    await this.pool.query(
      'TRUNCATE book_authors, books, separators, author_filing, ' +
      'author, author_alias RESTART IDENTITY CASCADE',
    )
  }

  /**
   * The catalogue, in shelf order.
   *
   * `catalogued_books`, not `books`, since #183 put the queue in the same
   * table. A book waiting to be identified has no sort key, so it would sort to
   * the front of this list as a row with no title in it, and the first scenario
   * that left a book in the queue and then asserted the order would fail for a
   * reason that had nothing to do with what it was testing. That view holds
   * exactly the rows `books` held before the queue moved in.
   */
  async books(): Promise<BookRow[]> {
    return this.all<BookRow>(
      `SELECT b.*, ${PHOTOGRAPHS} FROM catalogued_books b ${PHOTOGRAPH_JOINS}
        ORDER BY b.sort_key ASC`,
    )
  }

  /*
   * `catalogued_books` rather than `books` for both of these, because
   * `author_filing` is a column on the views since #227: what a book files under
   * is a fact about its first credit's alias, joined back on. A scenario asks
   * about a book it has just saved onto a shelf, which is a catalogued book.
   */
  async bookByIsbn(isbn13: string): Promise<BookRow | undefined> {
    return (await this.all<BookRow>(
      `SELECT b.*, ${PHOTOGRAPHS} FROM catalogued_books b ${PHOTOGRAPH_JOINS}
        WHERE b.isbn13 = $1`,
      [isbn13],
    ))[0]
  }

  async bookByTitle(title: string): Promise<BookRow | undefined> {
    return (await this.all<BookRow>(
      `SELECT b.*, ${PHOTOGRAPHS} FROM catalogued_books b ${PHOTOGRAPH_JOINS}
        WHERE b.title = $1`,
      [title],
    ))[0]
  }

  async separators(range = 'fiction'): Promise<SeparatorRow[]> {
    return this.all<SeparatorRow>(
      'SELECT * FROM separators WHERE shelf_range = $1 ORDER BY position ASC',
      [range],
    )
  }

  /**
   * The work queue itself. Read because #65 is a claim about what reaches the
   * database while a book is still in it, which no screen assertion can make.
   *
   * `queued_books` is the queue now, and it is the right relation rather than
   * merely the working one: the steps that read this all ask about a book
   * somebody has photographed and not yet shelved, and `books` would hand them
   * every book in the catalogue as well. Two of the projected columns are
   * therefore constant here, `status` never reading `done` and `book_id` always
   * reading null, which is exactly what a capture waiting in the queue always
   * was.
   */
  async captures(): Promise<CaptureRow[]> {
    return this.all<CaptureRow>(
      `SELECT ${QUEUE_ROW}, ${PHOTOGRAPHS} FROM queued_books b
       ${PHOTOGRAPH_JOINS} ORDER BY b.id ASC`,
    )
  }

  async captureCount(): Promise<number> {
    // CAST for the reason the stores carry one: COUNT is a bigint and
    // node-postgres hands a bigint back as a string rather than lose precision,
    // so `toBe(1)` would fail against "1" and say nothing about why.
    //
    // Counted over the queue and not over `books`, because "the queue holds one
    // book" is a claim about what is still waiting. A book that has been shelved
    // has left the queue without leaving the table, so counting the table would
    // make every scenario that shelves anything count it twice.
    const [row] = await this.all<{ n: number }>(
      'SELECT CAST(COUNT(*) AS INTEGER) AS n FROM queued_books',
    )
    return row!.n
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

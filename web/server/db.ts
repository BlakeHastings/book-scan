/**
 * SQLite schema and driver. Mirrors the design in docs/shelving.md.
 *
 * One deviation from that document: the column is `shelf_range`, not `range`.
 * RANGE is a reserved word in SQLite's window-function grammar and quoting it
 * everywhere is worse than renaming it once.
 *
 * **This is the only production file that imports better-sqlite3.** The stores
 * are written against the `Db` interface in driver.ts and cannot see what is
 * underneath them, which is what makes stage F a new file rather than an edit
 * to every call site:
 *
 *     grep -rn better-sqlite3 web/server --include='*.ts' | grep -v '\.test\.'
 */

import Database from 'better-sqlite3'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ShelfRange } from '../shared/shelving'
import { anonymous, bindParams, type Db, type Params, type TxOptions } from './driver'

const SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    isbn13                    TEXT    DEFAULT '',
    isbn10                    TEXT    DEFAULT '',
    title                     TEXT    NOT NULL,
    subtitle                  TEXT    DEFAULT '',
    authors                   TEXT    DEFAULT '',
    publisher                 TEXT    DEFAULT '',
    published                 TEXT    DEFAULT '',
    pages                     TEXT    DEFAULT '',
    notes                     TEXT    DEFAULT '',

    shelf_range               TEXT    NOT NULL,
    is_fiction                INTEGER NOT NULL,
    classification_source     TEXT    DEFAULT 'auto',
    classification_confidence TEXT    DEFAULT 'unknown',

    author_filing             TEXT    DEFAULT '',
    series_name               TEXT    DEFAULT '',
    series_index              REAL,
    title_filing              TEXT    DEFAULT '',
    sort_key                  TEXT    NOT NULL,

    location                  TEXT    DEFAULT '',
    lookup_source             TEXT    DEFAULT '',

    -- Three photos per book: cover, back (barcode and blurb), spine.
    front_image               TEXT    DEFAULT '',
    back_image                TEXT    DEFAULT '',
    edge_image                TEXT    DEFAULT '',
    -- The publisher's cover, fetched from the catalogue rather than
    -- photographed. Kept beside the three photos: it is what a matched book is
    -- supposed to look like, which is the thing worth comparing against.
    cover_image               TEXT    DEFAULT '',
    -- When a cover was last looked for. Set whether or not one was found, so
    -- a book with no cover anywhere is not re-fetched on every backfill.
    cover_checked_at          TEXT,
    -- Difference hashes of the front photo and the catalogue cover, for
    -- shortlisting a book held up to the camera. See imagehash.ts.
    front_hash                TEXT    DEFAULT '',
    cover_hash                TEXT    DEFAULT '',
    -- Versions of the three photos cut down to the book itself, so a view can
    -- show the book without the room around it. Separate files and separate
    -- columns, never a replacement: the photograph is the record and a crop is
    -- derived from it, so a bad crop costs nothing and can be redone.
    front_crop                TEXT    DEFAULT '',
    back_crop                 TEXT    DEFAULT '',
    edge_crop                 TEXT    DEFAULT '',
    -- Which slots have been through the detector, comma separated, whether or
    -- not it found a book. A slot named here with an empty crop column was
    -- looked at and declined, which is what lets a view say "shown whole"
    -- about that photo without saying it about every photo taken before any
    -- of this existed.
    cropped                   TEXT    DEFAULT '',
    isbn_source               TEXT    DEFAULT '',
    -- Vestigial. Meant to hold the raw OCR text a capture read off a book, so
    -- a misread ISBN could be explained later without re-photographing. No
    -- client path ever wrote it (see #36), and the argument for wiring it up
    -- did not hold: the photos themselves are kept indefinitely and are the
    -- ground truth, while OCR text is a lossy, engine-version-dependent
    -- reading of them. The schema is append only, so the column stays and is
    -- always ''. Do not read or write it.
    ocr_text                  TEXT    DEFAULT '',

    scanned_at                TEXT    NOT NULL,
    shelved_at                TEXT,
    -- Set while the book is physically off the shelf. A checked-out book is
    -- still catalogued but holds no position, so it neither appears as a
    -- neighbour nor takes up room in the layout.
    checked_out_at            TEXT
);

-- The index that makes predecessor/successor two seeks rather than a scan.
CREATE INDEX IF NOT EXISTS idx_books_shelf  ON books (shelf_range, sort_key);
CREATE INDEX IF NOT EXISTS idx_books_isbn13 ON books (isbn13);

-- Ordered authors, so "first-listed author" is unambiguous. Parsing the
-- comma-joined display string back apart is ambiguous with "Last, First".
CREATE TABLE IF NOT EXISTS book_authors (
    book_id  INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name     TEXT    NOT NULL,
    PRIMARY KEY (book_id, position)
);

-- Load-bearing. No heuristic gets Garcia Marquez and Le Guin both right.
CREATE TABLE IF NOT EXISTS author_filing (
    display_key  TEXT PRIMARY KEY,
    filing_name  TEXT NOT NULL,
    is_corporate INTEGER NOT NULL DEFAULT 0,
    note         TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS shelf_ranges (
    shelf_range TEXT    PRIMARY KEY,
    start_label TEXT    NOT NULL,
    -- Which bookcase this range begins on. Non-fiction has its own, so both
    -- ranges laid out from bookcase 1 would give two real planks one name.
    start_shelf INTEGER NOT NULL DEFAULT 1,
    start_area  INTEGER NOT NULL DEFAULT 0,
    note        TEXT    DEFAULT ''
);

-- The work queue. A capture is three photos and nothing else until the
-- background worker has read them, which is what lets the person holding the
-- books keep moving instead of waiting on OCR.
--
-- Deliberately separate from the books table. That one drives shelf ordering
-- and misfile detection, and letting half-identified rows into it would
-- corrupt both.
CREATE TABLE IF NOT EXISTS captures (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    -- pending: not yet read. ready: identified, awaiting confirmation.
    -- failed: read, but no ISBN or no catalogue match. done: became a book.
    status       TEXT    NOT NULL DEFAULT 'pending',
    front_image  TEXT    DEFAULT '',
    back_image   TEXT    DEFAULT '',
    edge_image   TEXT    DEFAULT '',
    isbn13       TEXT    DEFAULT '',
    isbn10       TEXT    DEFAULT '',
    isbn_source  TEXT    DEFAULT '',
    -- The first line OCR read off the front cover, and only ever that. A
    -- title a person stated goes to edit_json and is never mirrored here, so
    -- a guess and a confirmed title cannot be mistaken for one another (#156).
    title_guess  TEXT    DEFAULT '',
    -- Largest readable lines off the front cover, newline separated.
    cover_text   TEXT    DEFAULT '',
    -- Which slots the worker has already read, comma separated. Photos arrive
    -- one at a time, so the worker needs to know what is new.
    analysed     TEXT    DEFAULT '',
    -- The looked-up metadata, as a draft the review pane can load directly.
    -- Written only by the background worker. See edit_json below.
    draft_json   TEXT    DEFAULT '',
    -- What a person stated about this book while it sat in the queue, as the
    -- subset of draft fields they actually filled in.
    --
    -- Deliberately a second column rather than an edit of draft_json. The
    -- worker owns draft_json and re-reads photographs whenever a new one
    -- arrives, so a correction stored there is one re-analysis away from being
    -- silently overwritten. Two columns means the person and the worker never
    -- write the same cell, and a capture is read as draft_json with edit_json
    -- laid over the top. See the precedence comment in queue.ts.
    edit_json    TEXT    DEFAULT '',
    -- When a person last looked at this capture, and who. Set even by a look
    -- that changed nothing, because "nobody has been here yet" and "somebody
    -- read it and left it alone" are different facts and the queue exists to
    -- tell you which books still want attention.
    edited_by    TEXT    DEFAULT '',
    edited_at    TEXT,
    note         TEXT    DEFAULT '',
    -- Soft lease, so two people cannot work the same capture at once.
    claimed_by   TEXT    DEFAULT '',
    claimed_at   TEXT,
    -- The same three-photos-and-a-crop arrangement books carry, and it means
    -- exactly what it means there: separate files and separate columns, never
    -- a replacement. The photograph is the record, a crop is derived from it,
    -- so a bad crop costs nothing and can be redone, and nothing on this path
    -- ever opens a photograph for writing.
    front_crop   TEXT    DEFAULT '',
    back_crop    TEXT    DEFAULT '',
    edge_crop    TEXT    DEFAULT '',
    -- Which slots have been through the detector, comma separated, whether or
    -- not it found a book. A slot named here with an empty crop column was
    -- looked at and declined, which is what lets the queue say "shown whole"
    -- about that photo without saying it about every photo taken before any
    -- of this existed. Same contract as books.cropped.
    cropped      TEXT    DEFAULT '',
    -- Frequency hash of the front photo, in the format imagehash.ts writes.
    -- The same column, the same algorithm and the same format tag as
    -- books.front_hash, so a book held up to the camera can be compared
    -- against the queue without anything comparing across two schemes. Left
    -- empty when the photo could not be hashed: a wrong match is worse than
    -- no match, so this fails closed exactly as the books path does.
    front_hash   TEXT    DEFAULT '',
    book_id      INTEGER REFERENCES books(id) ON DELETE SET NULL,
    created_at   TEXT    NOT NULL,
    processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_captures_status ON captures (status, id);

-- Where each shelf begins.
--
-- A boundary says WHERE a shelf starts and nothing about how much it holds.
-- An earlier version stored a capacity, which is not a fact about the
-- furniture: swap a paperback for a hardback and the same shelf holds one
-- fewer. Nothing here predicts capacity. A person says when a shelf is full
-- and the boundary moves.
CREATE TABLE IF NOT EXISTS separators (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    shelf_range TEXT    NOT NULL,
    -- 'shelf' ends a shelf; 'area' ends the whole bookcase and resets to
    -- shelf 1 of the next one.
    kind        TEXT    NOT NULL DEFAULT 'shelf',
    -- Sort key of the first book on this shelf.
    starts_at   TEXT    NOT NULL,
    -- Ordinal within its range: the first separator closes the first shelf.
    position    INTEGER NOT NULL,
    note        TEXT    DEFAULT '',
    created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_separators ON separators (shelf_range, position);
`

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
  notes: string
  shelf_range: ShelfRange
  is_fiction: number
  classification_source: string
  classification_confidence: string
  author_filing: string
  series_name: string
  series_index: number | null
  title_filing: string
  sort_key: string
  location: string
  lookup_source: string
  front_image: string
  back_image: string
  edge_image: string
  isbn_source: string
  /** Vestigial; always ''. See the comment on this column in SCHEMA above. */
  ocr_text: string
  scanned_at: string
  shelved_at: string | null
  /** ISO timestamp while the book is off the shelf, null while it is on one. */
  checked_out_at: string | null
  /** Publisher cover from the catalogue, as a filename under /api/covers. */
  cover_image: string
  /** When a cover was last looked for, found or not. */
  cover_checked_at: string | null
  /** Difference hashes, for matching a book held up to the camera. */
  front_hash: string
  cover_hash: string
  /**
   * The three photos cut to the book, as filenames under /api/covers. Empty
   * where the detector was never run or could not find the book.
   */
  front_crop: string
  back_crop: string
  edge_crop: string
  /** Slots the detector has looked at, comma separated. See SCHEMA above. */
  cropped: string
}

/**
 * Add any column the schema gained since this database was created. Cheaper
 * and safer than a numbered migration chain for a single-user catalogue, and
 * it means an existing books.db keeps working after a schema change.
 */
function addMissingColumns(db: Database.Database): void {
  // CREATE TABLE IF NOT EXISTS is a no-op on a table that already exists, so
  // new columns have to be added explicitly or an existing database silently
  // keeps the old shape.
  const wanted: Record<string, [string, string][]> = {
    books: [
      ['front_image', "TEXT DEFAULT ''"],
      ['back_image', "TEXT DEFAULT ''"],
      ['edge_image', "TEXT DEFAULT ''"],
      ['isbn_source', "TEXT DEFAULT ''"],
      ['ocr_text', "TEXT DEFAULT ''"],
      ['subtitle', "TEXT DEFAULT ''"],
      ['checked_out_at', 'TEXT'],
      ['cover_image', "TEXT DEFAULT ''"],
      ['cover_checked_at', 'TEXT'],
      ['front_hash', "TEXT DEFAULT ''"],
      ['cover_hash', "TEXT DEFAULT ''"],
      ['front_crop', "TEXT DEFAULT ''"],
      ['back_crop', "TEXT DEFAULT ''"],
      ['edge_crop', "TEXT DEFAULT ''"],
      ['cropped', "TEXT DEFAULT ''"],
    ],
    captures: [
      ['cover_text', "TEXT DEFAULT ''"],
      ['analysed', "TEXT DEFAULT ''"],
      ['edit_json', "TEXT DEFAULT ''"],
      ['edited_by', "TEXT DEFAULT ''"],
      ['edited_at', 'TEXT'],
      ['front_crop', "TEXT DEFAULT ''"],
      ['back_crop', "TEXT DEFAULT ''"],
      ['edge_crop', "TEXT DEFAULT ''"],
      ['cropped', "TEXT DEFAULT ''"],
      ['front_hash', "TEXT DEFAULT ''"],
    ],
    separators: [
      ['starts_at', "TEXT DEFAULT ''"],
    ],
    shelf_ranges: [
      ['start_shelf', 'INTEGER NOT NULL DEFAULT 1'],
      ['start_area', 'INTEGER NOT NULL DEFAULT 0'],
    ],
  }

  for (const [table, columns] of Object.entries(wanted)) {
    const existing = new Set(
      (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name),
    )
    if (existing.size === 0) continue // table not created yet

    for (const [name, definition] of columns) {
      if (!existing.has(name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
      }
    }
  }
}

/**
 * Rebuild a separators table left over from the capacity model.
 *
 * Adding starts_at was not enough: the old capacity column is NOT NULL, so
 * every insert against an existing database failed. The old rows are still
 * meaningful though, and thrown away silently would lose the boundaries
 * somebody walked their shelves to set. A capacity of N on the first shelf
 * means the second shelf began at book N+1, so each row converts into the
 * sort key of the book it used to start before.
 */
function migrateSeparators(db: Database.Database): void {
  const columns = (db.pragma('table_info(separators)') as { name: string }[])
    .map((c) => c.name)
  if (columns.length === 0 || !columns.includes('capacity')) return

  const legacy = db
    .prepare('SELECT * FROM separators ORDER BY shelf_range, position')
    .all() as { id: number; shelf_range: string; kind: string; capacity: number; position: number; note: string; created_at: string }[]

  const rebuild = db.transaction(() => {
    db.exec('ALTER TABLE separators RENAME TO separators_legacy')
    db.exec(`
      CREATE TABLE separators (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          shelf_range TEXT    NOT NULL,
          kind        TEXT    NOT NULL DEFAULT 'shelf',
          starts_at   TEXT    NOT NULL,
          position    INTEGER NOT NULL,
          note        TEXT    DEFAULT '',
          created_at  TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_separators ON separators (shelf_range, position);
    `)

    const bookAt = db.prepare(
      `SELECT sort_key FROM books WHERE shelf_range = ?
        ORDER BY sort_key ASC LIMIT 1 OFFSET ?`,
    )
    const insert = db.prepare(
      `INSERT INTO separators (shelf_range, kind, starts_at, position, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )

    // Capacities were cumulative down a range: the nth boundary began after
    // the sum of every capacity before it.
    const consumed = new Map<string, number>()
    for (const row of legacy) {
      const before = consumed.get(row.shelf_range) ?? 0
      const offset = before + row.capacity
      const next = bookAt.get(row.shelf_range, offset) as { sort_key: string } | undefined
      consumed.set(row.shelf_range, offset)

      // A boundary past the end of the range no longer describes anywhere.
      if (!next) continue
      insert.run(row.shelf_range, row.kind, next.sort_key, before === 0 ? 0 : consumed.size,
                 row.note ?? '', row.created_at)
    }

    db.exec('DROP TABLE separators_legacy')
  })

  rebuild()
}

/** How deep in transactions the caller currently is, if it is in one at all. */
interface TxDepth {
  depth: number
}

/**
 * `Db` over better-sqlite3.
 *
 * Every statement goes through the translator in driver.ts rather than being
 * handed to better-sqlite3 in the style it was written in, even though
 * better-sqlite3 understands all three styles itself. That is deliberate: it
 * means the translation is exercised by the whole existing suite now, on the
 * database that already works, rather than being written blind in stage F and
 * first exercised by the driver nobody has run yet. Stage F changes one
 * argument, from `anonymous` to `numbered`.
 *
 * better-sqlite3 is synchronous, so the promises here are already resolved by
 * the time they are returned. What that costs, and what the lock below is for:
 * an `await` inside a transaction is a point where some other request's
 * continuation can run, and a statement of its own would land inside a
 * transaction it knows nothing about. That could not happen while the stores
 * handed synchronous closures to `db.transaction`, so it is not something this
 * stage is entitled to introduce.
 */
class SqliteDb implements Db {
  /**
   * Whether the calling code is inside one of this connection's transactions,
   * and how deep. Async-context tracked rather than a counter on the
   * connection: a counter cannot tell the transaction's own statements from an
   * unrelated request's, and would nest the unrelated one into the transaction.
   */
  private readonly context = new AsyncLocalStorage<TxDepth>()

  /**
   * The connection, held one caller at a time. SQLite has a single connection
   * here, so this is what keeps a transaction's statements contiguous on it.
   */
  private lock: Promise<unknown> = Promise.resolve()

  constructor(private readonly handle: Database.Database) {}

  async all<Row>(sql: string, params?: Params): Promise<Row[]> {
    return this.exclusive(async () => {
      const { text, values } = bindParams(sql, params, anonymous)
      return this.handle.prepare(text).all(...values) as Row[]
    })
  }

  async get<Row>(sql: string, params?: Params): Promise<Row | undefined> {
    return this.exclusive(async () => {
      const { text, values } = bindParams(sql, params, anonymous)
      return this.handle.prepare(text).get(...values) as Row | undefined
    })
  }

  async run(sql: string, params?: Params): Promise<{ changes: number }> {
    return this.exclusive(async () => {
      const { text, values } = bindParams(sql, params, anonymous)
      return { changes: this.handle.prepare(text).run(...values).changes }
    })
  }

  /**
   * `options.serialiseOn` needs nothing here, and that is a fact about this
   * driver rather than about transactions.
   *
   * There is one connection, `exclusive` hands it to one caller at a time, and
   * a transaction holds it from BEGIN to COMMIT. Every transaction is therefore
   * already serialised against every other one, whatever they name, which is
   * strictly stronger than what `serialiseOn` asks for. `PgDb` has to do real
   * work for the same guarantee because it has real connections.
   */
  async tx<T>(work: (db: Db) => Promise<T>, _options?: TxOptions): Promise<T> {
    const open = this.context.getStore()
    if (open) return this.savepoint(open, work)
    return this.exclusive(() => this.transaction(work))
  }

  async close(): Promise<void> {
    this.handle.close()
  }

  /**
   * Run `job` with the connection to itself.
   *
   * Statements issued from inside a transaction skip the queue, because that
   * transaction is already holding it. Everything else waits its turn, which is
   * the ordering better-sqlite3 gave for free by being synchronous.
   */
  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return job()

    const running = this.lock.then(job, job)
    // The chain itself must never reject, or one failed statement would be
    // inherited by every statement queued behind it.
    this.lock = running.then(() => undefined, () => undefined)
    return running
  }

  private async transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
    this.handle.exec('BEGIN')
    try {
      const result = await this.context.run({ depth: 1 }, () => work(this))
      this.handle.exec('COMMIT')
      return result
    } catch (error) {
      this.handle.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * A transaction inside a transaction. SQLite spells it SAVEPOINT, Postgres
   * spells it the same way, and the alternative, quietly joining the outer
   * transaction, would make the inner one's rollback undo the outer one's work.
   */
  private async savepoint<T>(open: TxDepth, work: (db: Db) => Promise<T>): Promise<T> {
    const name = `bookscan_${open.depth}`
    this.handle.exec(`SAVEPOINT ${name}`)
    try {
      const result = await this.context.run({ depth: open.depth + 1 }, () => work(this))
      this.handle.exec(`RELEASE ${name}`)
      return result
    } catch (error) {
      this.handle.exec(`ROLLBACK TO ${name}`)
      this.handle.exec(`RELEASE ${name}`)
      throw error
    }
  }
}

/**
 * Open an existing catalogue for reading and nothing else.
 *
 * `openDatabase` below writes to whatever it is given before it returns: WAL
 * mode is a change to the file header, `CREATE TABLE IF NOT EXISTS` is a write
 * on an empty file, `addMissingColumns` alters tables and the seed inserts
 * rows. All of that is correct for a database the server is about to serve, and
 * none of it is acceptable for the one thing stage H reads: the owner's
 * catalogue, or a snapshot of it that is the only copy of an afternoon's
 * scanning. So the migration gets its own opener, and the source is not
 * writable rather than merely not written to.
 *
 * `fileMustExist` matters as much as `readonly`. Without it a mistyped path
 * produces an empty database and a cheerful report of nothing to migrate, which
 * is the failure that looks like success.
 */
export function openReadOnlyDatabase(path: string): Db {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  // Belt and braces on top of `readonly`: `query_only` makes the connection
  // refuse a write even if something later hands it a statement that is one.
  db.pragma('query_only = ON')
  db.pragma('busy_timeout = 5000')
  return new SqliteDb(db)
}

export function openDatabase(path: string): Db {
  mkdirSync(dirname(path), { recursive: true })

  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Two people scanning at once means overlapping writes. WAL allows one
  // writer alongside readers; this stops a contended write failing outright
  // instead of waiting its turn.
  db.pragma('busy_timeout = 5000')
  db.exec(SCHEMA)
  addMissingColumns(db)
  migrateSeparators(db)

  const version = db.pragma('user_version', { simple: true }) as number
  if (version < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }

  // Shelf 4 is dedicated to non-fiction; fiction starts at 1A.
  //
  // ON CONFLICT DO NOTHING rather than INSERT OR IGNORE: the two mean the same
  // thing here, and only one of them is spelled the same way in every dialect.
  const seed = db.prepare(
    `INSERT INTO shelf_ranges
       (shelf_range, start_label, start_shelf, start_area, note)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  )
  seed.run('fiction', '1A', 1, 0, 'Starts on the first bookcase')
  seed.run('nonfiction', '4A', 4, 0, 'Bookcase 4 is dedicated to non-fiction')

  // A database seeded before ranges had a starting bookcase still says S4.
  db.prepare(
    "UPDATE shelf_ranges SET start_shelf = 4, start_area = 0, start_label = '4A' " +
    "WHERE shelf_range = 'nonfiction' AND start_label = 'S4'",
  ).run()
  db.prepare(
    "UPDATE shelf_ranges SET start_label = '1A' WHERE shelf_range = 'fiction' " +
    "AND start_label != '1A'",
  ).run()

  // Everything above is schema and pragma work, which is per-dialect and stays
  // here. What leaves this file is the wrapper, and nothing on the other side
  // of it can tell which database it got.
  return new SqliteDb(db)
}

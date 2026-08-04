/**
 * SQLite schema and store. Mirrors the design in docs/shelving.md.
 *
 * One deviation from that document: the column is `shelf_range`, not `range`.
 * RANGE is a reserved word in SQLite's window-function grammar and quoting it
 * everywhere is worse than renaming it once.
 */

import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ShelfRange } from '../shared/shelving'

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
    title_guess  TEXT    DEFAULT '',
    -- Largest readable lines off the front cover, newline separated.
    cover_text   TEXT    DEFAULT '',
    -- Which slots the worker has already read, comma separated. Photos arrive
    -- one at a time, so the worker needs to know what is new.
    analysed     TEXT    DEFAULT '',
    -- The looked-up metadata, as a draft the review pane can load directly.
    draft_json   TEXT    DEFAULT '',
    note         TEXT    DEFAULT '',
    -- Soft lease, so two people cannot work the same capture at once.
    claimed_by   TEXT    DEFAULT '',
    claimed_at   TEXT,
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
    ],
    captures: [
      ['cover_text', "TEXT DEFAULT ''"],
      ['analysed', "TEXT DEFAULT ''"],
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

export function openDatabase(path: string): Database.Database {
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
  const seed = db.prepare(
    `INSERT OR IGNORE INTO shelf_ranges
       (shelf_range, start_label, start_shelf, start_area, note)
     VALUES (?, ?, ?, ?, ?)`,
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

  return db
}

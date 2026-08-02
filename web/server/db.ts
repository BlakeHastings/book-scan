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
    isbn_source               TEXT    DEFAULT '',
    ocr_text                  TEXT    DEFAULT '',

    scanned_at                TEXT    NOT NULL,
    shelved_at                TEXT
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
    shelf_range TEXT PRIMARY KEY,
    start_label TEXT NOT NULL,
    note        TEXT DEFAULT ''
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
  ocr_text: string
  scanned_at: string
  shelved_at: string | null
}

/**
 * Add any column the schema gained since this database was created. Cheaper
 * and safer than a numbered migration chain for a single-user catalogue, and
 * it means an existing books.db keeps working after a schema change.
 */
function addMissingColumns(db: Database.Database): void {
  const existing = new Set(
    (db.pragma('table_info(books)') as { name: string }[]).map((c) => c.name),
  )

  const wanted: [string, string][] = [
    ['front_image', "TEXT DEFAULT ''"],
    ['back_image', "TEXT DEFAULT ''"],
    ['edge_image', "TEXT DEFAULT ''"],
    ['isbn_source', "TEXT DEFAULT ''"],
    ['ocr_text', "TEXT DEFAULT ''"],
    ['subtitle', "TEXT DEFAULT ''"],
  ]

  for (const [name, definition] of wanted) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE books ADD COLUMN ${name} ${definition}`)
    }
  }
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

  const version = db.pragma('user_version', { simple: true }) as number
  if (version < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }

  // Shelf 4 is dedicated to non-fiction; fiction starts at 1A.
  const seed = db.prepare(
    `INSERT OR IGNORE INTO shelf_ranges (shelf_range, start_label, note)
     VALUES (?, ?, ?)`,
  )
  seed.run('fiction', '1A', 'Everything except the non-fiction shelf')
  seed.run('nonfiction', 'S4', 'Shelf 4 is dedicated to non-fiction')

  return db
}

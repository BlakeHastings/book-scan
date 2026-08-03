/**
 * Reading, and resetting, the database the app under test is writing to.
 *
 * This is the point of the suite. A book that renders on screen but was
 * persisted with the wrong filing name, or not persisted at all, is exactly
 * the bug a screen-only assertion misses, so every journey ends by opening the
 * database and looking.
 *
 * The path is not guessed. The AppHost points BOOKSCAN_DATA at a directory
 * belonging to this run, and the server reports the database it opened on
 * /api/health, so the suite asserts against the file the app named rather than
 * one it reconstructed and hoped matched.
 *
 * Safe to open alongside the running server: the app opens SQLite in WAL mode
 * with a five second busy timeout, so a second connection can read while it
 * writes, and the deletes below wait rather than failing.
 */

import Database, { type Database as Db } from 'better-sqlite3'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

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
  is_fiction: number
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

export interface SeparatorRow {
  id: number
  shelf_range: string
  kind: string
  starts_at: string
  position: number
}

export class Catalogue {
  private readonly db: Db

  constructor(readonly path: string) {
    if (!existsSync(path)) {
      throw new Error(
        `The app has not created ${path} yet. It is created on startup, so ` +
        'this means the api resource never came up.',
      )
    }
    this.db = new Database(path, { readonly: false, fileMustExist: true })
    this.db.pragma('busy_timeout = 5000')
  }

  /** Where photographs are written, beside the database. */
  get coverDir(): string {
    return join(dirname(this.path), 'covers')
  }

  /**
   * Back to nothing catalogued.
   *
   * Deleting rows rather than deleting the file, because the server holds the
   * database open for the whole run and would go on writing to a file that no
   * longer had a name. Photographs on disk are left alone: they are named
   * after the moment they were taken so they cannot collide, and no assertion
   * counts them.
   */
  reset(): void {
    this.db.exec(`
      DELETE FROM captures;
      DELETE FROM book_authors;
      DELETE FROM books;
      DELETE FROM separators;
      DELETE FROM author_filing;
    `)
  }

  books(): BookRow[] {
    return this.db
      .prepare('SELECT * FROM books ORDER BY sort_key ASC')
      .all() as BookRow[]
  }

  bookByIsbn(isbn13: string): BookRow | undefined {
    return this.db
      .prepare('SELECT * FROM books WHERE isbn13 = ?')
      .get(isbn13) as BookRow | undefined
  }

  bookByTitle(title: string): BookRow | undefined {
    return this.db
      .prepare('SELECT * FROM books WHERE title = ?')
      .get(title) as BookRow | undefined
  }

  separators(range = 'fiction'): SeparatorRow[] {
    return this.db
      .prepare('SELECT * FROM separators WHERE shelf_range = ? ORDER BY position ASC')
      .all(range) as SeparatorRow[]
  }

  captureCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}

/**
 * `BookRepository` over `Db`: the `books` row, its printed names, its credits and
 * its tags.
 *
 * Reads `books` by id rather than a view, because a book is loaded in whatever
 * state it is in. Writes nothing about the queue (`claimed_*`, the guesses the
 * identifier fills in) and nothing about where the book stands
 * (`current_area_id`, `book_placement`): those have writers of their own.
 *
 * Every statement goes through the `Db` it was given, so inside a unit of work
 * it lands in that transaction without being handed one.
 */

import type { BookRepository } from '../../application/books/ports'
import { Book, type BookRecord, type StoredBook, type TagChange } from '../../domain/books/book'
import { isQueued, type BookState } from '../../domain/books/state'
import type { Db } from '../../server/driver'
import type { ShelfRange } from '../../shared/shelving'
import { DrizzleTagRepository } from '../tagging/tag-repository'

interface BookRow {
  id: number
  state: BookState
  isbn13: string
  isbn10: string
  title: string
  subtitle: string
  publisher: string
  published: string
  pages: string
  notes: string
  shelf_range: string
  classification_source: string
  classification_confidence: string
  series_name: string
  series_index: number | null
  title_filing: string
  sort_key: string
  lookup_source: string
  isbn_source: string
}

const QUEUED_SQL = ['scanned', 'unidentified', 'identified'].map((state) => `'${state}'`).join(', ')

export class DrizzleBookRepository implements BookRepository {
  private readonly tags: DrizzleTagRepository

  constructor(private readonly db: Db) {
    this.tags = new DrizzleTagRepository(db)
  }

  async load(id: number): Promise<Book | null> {
    const row = await this.db.get<BookRow>(
      `SELECT id, "state", isbn13, isbn10, title, subtitle, publisher, published,
              pages, notes, shelf_range, classification_source,
              classification_confidence, series_name, series_index, title_filing,
              sort_key, lookup_source, isbn_source
         FROM books WHERE id = ?`,
      [id],
    )
    if (!row) return null

    const printed = await this.db.all<{ name: string }>(
      'SELECT name FROM book_authors WHERE book_id = ? ORDER BY position',
      [id],
    )
    const credits = await this.db.all<{ author_alias_id: number }>(
      'SELECT author_alias_id FROM book_author WHERE book_id = ? ORDER BY position',
      [id],
    )

    const stored: StoredBook = {
      id: row.id,
      state: row.state,
      record: {
        isbn13: row.isbn13 ?? '',
        isbn10: row.isbn10 ?? '',
        title: row.title,
        subtitle: row.subtitle ?? '',
        authors: printed.map((one) => one.name),
        publisher: row.publisher ?? '',
        published: row.published ?? '',
        pages: row.pages ?? '',
        notes: row.notes ?? '',
        seriesName: row.series_name ?? '',
        seriesIndex: row.series_index,
        classificationSource: row.classification_source ?? '',
        classificationConfidence: row.classification_confidence ?? '',
        lookupSource: row.lookup_source ?? '',
        isbnSource: row.isbn_source ?? '',
      },
      tags: await this.tags.of(id),
      shelfRange: (row.shelf_range || null) as ShelfRange | null,
      filing: { titleFiling: row.title_filing ?? '', sortKey: row.sort_key },
      credits: credits.map((one) => Number(one.author_alias_id)),
    }
    return Book.restore(stored)
  }

  async save(book: Book): Promise<void> {
    const id = book.id
    if (id === null) throw new Error('a book nobody has added cannot be saved')

    const { row, credits, tags } = book.changes
    if (row) await this.writeRow(id, book)
    if (credits) await this.writeCredits(id, book.credits)
    await this.writeTags(id, tags)
    book.saved(id)
  }

  /**
   * The state is written only over a queued state, the way the save statement
   * always decided it: a book checked out between this book's load and this
   * write keeps being checked out.
   */
  private async writeRow(id: number, book: Book): Promise<void> {
    const shelving = isQueued(book.state) ? '' : `"state" = CASE WHEN "state" IN (${QUEUED_SQL}) THEN @state ELSE "state" END,`
    await this.db.run(
      `UPDATE books SET
         isbn13 = @isbn13, isbn10 = @isbn10, title = @title,
         subtitle = @subtitle, authors = @authors, publisher = @publisher,
         published = @published, pages = @pages, notes = @notes,
         shelf_range = @shelf_range,
         classification_source = @classification_source,
         classification_confidence = @classification_confidence,
         series_name = @series_name, series_index = @series_index,
         title_filing = @title_filing, sort_key = @sort_key,
         ${shelving}
         lookup_source = @lookup_source, isbn_source = @isbn_source
       WHERE id = @id`,
      { id, state: book.state, ...columnsOf(book.record), ...derivedOf(book) },
    )
    await this.writePrintedNames(id, book.record.authors)
  }

  private async writePrintedNames(id: number, authors: readonly string[]): Promise<void> {
    await this.db.run('DELETE FROM book_authors WHERE book_id = ?', [id])
    for (const [index, name] of authors.entries()) {
      await this.db.run(
        'INSERT INTO book_authors (book_id, position, name) VALUES (?, ?, ?)',
        [id, index + 1, name],
      )
    }
  }

  private async writeCredits(id: number, aliasIds: readonly number[]): Promise<void> {
    await this.db.run('DELETE FROM book_author WHERE book_id = ?', [id])
    for (const [index, aliasId] of aliasIds.entries()) {
      await this.db.run(
        'INSERT INTO book_author (book_id, position, author_alias_id) VALUES (?, ?, ?)',
        [id, index + 1, aliasId],
      )
    }
  }

  private async writeTags(id: number, changes: readonly TagChange[]): Promise<void> {
    for (const change of changes) {
      if (change.kind === 'retract') await this.tags.retract(id, change.slugs, change.source)
      else await this.tags.apply(id, change.writes)
    }
  }
}

function columnsOf(record: BookRecord) {
  return {
    isbn13: record.isbn13,
    isbn10: record.isbn10,
    title: record.title,
    subtitle: record.subtitle,
    // The comma-joined display string the wire still reads.
    authors: record.authors.join(', '),
    publisher: record.publisher,
    published: record.published,
    pages: record.pages,
    notes: record.notes,
    classification_source: record.classificationSource,
    classification_confidence: record.classificationConfidence,
    series_name: record.seriesName,
    series_index: record.seriesIndex,
    lookup_source: record.lookupSource,
    isbn_source: record.isbnSource,
  }
}

function derivedOf(book: Book) {
  return {
    // The empty range keeps the row out of every `shelf_range = ?` there is.
    shelf_range: book.shelfRange ?? '',
    title_filing: book.filing.titleFiling,
    sort_key: book.filing.sortKey,
  }
}

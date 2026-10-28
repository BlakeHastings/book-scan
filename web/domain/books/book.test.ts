import { describe, expect, it } from 'vitest'
import { Book, namesADifferentBook, UntitledBook, type StoredBook } from './book'
import { TagSlug, type AppliedTag } from '../tagging/tags'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../tagging/catalogue-claims'
import type { BookState } from './state'
import { buildSortKey } from '../../shared/shelving'

const NOW = '2026-10-28T09:00:00.000Z'

function stored(over: Partial<StoredBook> = {}): Book {
  return Book.restore({
    id: 7,
    state: 'shelved',
    record: {
      isbn13: '9780441013593', isbn10: '0441013597', title: 'Dune', subtitle: '',
      authors: ['Frank Herbert'], publisher: '', published: '', pages: '', notes: '',
      seriesName: '', seriesIndex: null, classificationSource: 'auto',
      classificationConfidence: 'unknown', lookupSource: '', isbnSource: '',
    },
    tags: [],
    shelfRange: 'fiction',
    filing: { titleFiling: 'DUNE', sortKey: 'old' },
    credits: [],
    ...over,
  })
}

const tag = (slug: string, source: AppliedTag['source']): AppliedTag =>
  ({ slug: TagSlug.of(slug), source, confidence: 'high' })

const carried = (book: Book) => book.tags.map((one) => `${one.slug.value}:${one.source}`).sort()

describe('describing a book', () => {
  it('refuses a book with no title', () => {
    expect(() => Book.catalogue({ title: '  ', authors: [] })).toThrow(UntitledBook)
    expect(() => stored().revise({ title: '', authors: [] })).toThrow(UntitledBook)
  })

  it('resolves both ISBN forms from either, and keeps what was typed when it is not an ISBN', () => {
    const resolved = Book.catalogue({ title: 'Dune', authors: [], isbn10: '0441013597' })
    expect([resolved.record.isbn13, resolved.record.isbn10]).toEqual(['9780441013593', '0441013597'])

    const raw = Book.catalogue({ title: 'Dune', authors: [], isbn13: '12345' })
    expect([raw.record.isbn13, raw.record.isbn10]).toEqual(['12345', ''])
  })

  it('keeps the printed names trimmed, non-empty and in order', () => {
    const book = Book.catalogue({ title: 'Good Omens', authors: [' Terry Pratchett ', '', 'Neil Gaiman'] })
    expect(book.record.authors).toEqual(['Terry Pratchett', 'Neil Gaiman'])
  })
})

describe('the state a save leaves a book in', () => {
  it.each<[BookState, BookState]>([
    ['scanned', 'shelved'],
    ['unidentified', 'shelved'],
    ['identified', 'shelved'],
    ['shelved', 'shelved'],
    ['checked_out', 'checked_out'],
    ['withdrawn', 'withdrawn'],
  ])('moves %s to %s', (before, after) => {
    const confirmed = stored({ state: before })
    confirmed.confirm({ title: 'Dune', authors: [] })
    expect(confirmed.state).toBe(after)

    const revised = stored({ state: before })
    revised.revise({ title: 'Dune', authors: [] })
    expect(revised.state).toBe(after)
  })

  it('catalogues a new book straight onto a shelf', () => {
    expect(Book.catalogue({ title: 'Dune', authors: [] }).state).toBe('shelved')
  })
})

describe('correcting which book a row is', () => {
  const tags = [
    tag('genre/fiction', 'person'), tag('subject/sand', 'catalogue'), tag('mine/signed', 'person'),
  ]

  it('withdraws every source\'s tag about the work, and keeps what was said about the copy', () => {
    const book = stored({ tags })
    book.revise({ title: 'Emma', authors: [], isbn13: '9780141439587' })
    expect(carried(book)).toEqual(['mine/signed:person'])
  })

  it('withdraws before the genre is read back, so the new book files under its own genre', () => {
    const book = stored({ tags })
    book.revise({ title: 'Emma', authors: [], isbn13: '9780141439587' })
    expect(book.stateGenre({ genre: NON_FICTION_SLUG, classificationSource: 'auto' }, NOW)).toBe('nonfiction')
  })

  it('takes nothing away when the ISBN is the same book in its other form', () => {
    const book = stored({ tags })
    book.revise({ title: 'Dune', authors: [], isbn10: '0441013597' })
    expect(carried(book)).toHaveLength(3)
  })

  it('takes nothing away when a queued book is confirmed under a corrected ISBN', () => {
    const book = stored({ tags, state: 'identified' })
    book.confirm({ title: 'Emma', authors: [], isbn13: '9780141439587' })
    expect(carried(book)).toHaveLength(3)
  })

  it('reads a row with no ISBN as an identification rather than a correction', () => {
    expect(namesADifferentBook({ isbn13: '', isbn10: '' }, { isbn13: '9780141439587' })).toBe(false)
  })
})

describe('stating a genre', () => {
  it("withdraws the guess when a person answers", () => {
    const book = stored({ tags: [tag('genre/non-fiction', 'guess')] })
    expect(book.stateGenre({ genre: FICTION_SLUG, classificationSource: 'manual' }, NOW)).toBe('fiction')
    expect(carried(book)).toEqual(['genre/fiction:person'])
  })

  it("never lets a guess withdraw a person's answer, or move the book", () => {
    const book = stored({ tags: [tag('genre/fiction', 'person')] })
    expect(book.stateGenre({ genre: NON_FICTION_SLUG, classificationSource: 'auto' }, NOW)).toBe('fiction')
    expect(carried(book)).toEqual(['genre/fiction:person', 'genre/non-fiction:guess'])
  })

  it('restates nothing when the save states nothing, and reads back what is there', () => {
    const book = stored({ tags: [tag('genre/non-fiction', 'guess')] })
    expect(book.stateGenre({ genre: null }, NOW)).toBe('nonfiction')
    expect(book.changes.tags).toEqual([])
  })

  it('answers no range for a book nothing has given a genre', () => {
    expect(stored().stateGenre({ genre: null }, NOW)).toBeNull()
  })

  it("restates only the stating source's own tags", () => {
    const book = stored({ tags: [tag('genre/fiction', 'catalogue'), tag('genre/fiction', 'guess')] })
    book.stateGenre({ genre: NON_FICTION_SLUG, classificationSource: 'auto' }, NOW)
    expect(carried(book)).toEqual(['genre/fiction:catalogue', 'genre/non-fiction:guess'])
  })
})

describe('a person tagging a book', () => {
  it('applies as a person and removes every source', () => {
    const book = stored({ tags: [tag('mine/lent-out', 'catalogue')] })
    book.applyTag(TagSlug.of('mine/lent-out'), 'high', NOW)
    expect(carried(book)).toEqual(['mine/lent-out:catalogue', 'mine/lent-out:person'])

    book.removeTag(TagSlug.of('mine/lent-out'))
    expect(book.tags).toEqual([])
    expect(book.changes.tags.map((change) => change.kind)).toEqual(['apply', 'retract'])
  })
})

describe('credits and filing', () => {
  it('credits each alias once, in printed order', () => {
    const book = stored()
    book.credit([4, 9, 4, 2])
    expect(book.credits).toEqual([4, 9, 2])
  })

  it('derives the sort key and title filing from the record', () => {
    const book = stored()
    book.revise({ title: 'The Dune', authors: ['Frank Herbert'], seriesName: 'Dune', seriesIndex: 1 })
    const filed = book.file('HERBERT, FRANK')
    expect(filed.titleFiling).toBe('DUNE')
    expect(filed.sortKey).toBe(buildSortKey({
      authorFiling: 'HERBERT, FRANK', title: 'The Dune', seriesName: 'Dune', seriesIndex: 1,
    }))
  })

  it('has nothing to write until something changes it, and nothing after it is saved', () => {
    const book = stored()
    expect(book.changes).toEqual({ row: false, credits: false, tags: [] })
    book.revise({ title: 'Dune', authors: [] })
    expect(book.changes.row).toBe(true)
    book.saved(7)
    expect(book.changes).toEqual({ row: false, credits: false, tags: [] })
  })
})

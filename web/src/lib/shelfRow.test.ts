/**
 * What a row of spines is made of.
 *
 * Every case here is a book that really is in the catalogue. Books added
 * before the spine slot existed have no spine photo and never will unless
 * somebody re-photographs them, so a row that only knows how to draw a spine
 * would be full of holes. And a book that is off the bookcase is not standing
 * in the run at all, which is the difference between a drawing of a shelf and
 * a list of what is filed there.
 */

import { describe, expect, it } from 'vitest'
import {
  coverLabel, coverOf, listOf, missingFrom, rowOf, spineLabel, spineOf,
} from './shelfRow'
import type { BookRow, CheckedOutAt, ShelfGroupDto } from './api'

function book(overrides: Partial<BookRow> = {}): BookRow {
  return {
    id: 1,
    title: 'Dune',
    subtitle: '',
    authors: 'Frank Herbert',
    author_filing: 'Herbert, Frank',
    publisher: '',
    published: '',
    pages: '',
    notes: '',
    series_name: '',
    series_index: null,
    location: '1A',
    shelf_range: 'fiction',
    is_fiction: 1,
    classification_source: 'auto',
    classification_confidence: 'high',
    isbn13: '',
    isbn10: '',
    isbn_source: '',
    lookup_source: '',
    front_image: '',
    back_image: '',
    edge_image: '',
    checked_out_at: null,
    cover_image: '',
    sort_key: 'herbert frank|dune',
    ...overrides,
  }
}

function group(books: BookRow[], label = '1A'): ShelfGroupDto {
  return {
    area: 0,
    shelf: 1,
    label,
    books: books.map((b) => ({ book: b })),
    separatorId: null,
    kind: null,
  }
}

describe('spineOf', () => {
  it('shows the spine photo when there is one', () => {
    const spine = spineOf(book({ edge_image: 'e.jpg', front_image: 'f.jpg', back_image: 'b.jpg' }))
    expect(spine.spine).toBe('e.jpg')
    expect(spine.spineSlot).toBe('edge')
  })

  it('falls back to the front cover for a book catalogued before spines', () => {
    const spine = spineOf(book({ front_image: 'f.jpg', back_image: 'b.jpg' }))
    expect(spine.spine).toBe('f.jpg')
    expect(spine.spineSlot).toBe('front')
  })

  it('falls back to the back cover rather than showing nothing', () => {
    const spine = spineOf(book({ back_image: 'b.jpg' }))
    expect(spine.spine).toBe('b.jpg')
    expect(spine.spineSlot).toBe('back')
  })

  it('says which face it fell back to, rather than calling a cover a spine', () => {
    // The whole point of carrying the slot around. Framing a cover like a
    // spine crops the wrong part of it, and calling it a spine is a lie
    // somebody standing at the shelf will catch immediately.
    expect(spineOf(book({ front_image: 'f.jpg' })).spineSlot).not.toBe('edge')
  })

  it('leaves a book with no photo at all to be drawn as a blank', () => {
    const spine = spineOf(book())
    expect(spine.spine).toBe('')
    expect(spine.spineSlot).toBe('')
  })

  it('writes the filing name down a blank spine, since that is what you read', () => {
    expect(spineOf(book()).authorFiling).toBe('Herbert, Frank')
  })

  it('falls back to the author, then the title, when nothing files it', () => {
    expect(spineOf(book({ author_filing: '' })).authorFiling).toBe('Frank Herbert')
    expect(spineOf(book({ author_filing: '', authors: '' })).authorFiling).toBe('Dune')
  })
})

describe('spineLabel', () => {
  it('names a real spine plainly', () => {
    expect(spineLabel(spineOf(book({ edge_image: 'e.jpg' })))).toBe('Dune, spine')
  })

  it('says a cover is standing in and that no spine photo exists', () => {
    expect(spineLabel(spineOf(book({ front_image: 'f.jpg' }))))
      .toBe('Dune, front cover, no spine photo')
    expect(spineLabel(spineOf(book({ back_image: 'b.jpg' }))))
      .toBe('Dune, back cover, no spine photo')
  })

  it('admits when there is no photograph at all', () => {
    expect(spineLabel(spineOf(book()))).toBe('Dune, no photo')
  })
})

describe('coverOf', () => {
  it('shows your own photograph of the front, which is the face of the book', () => {
    const tile = coverOf(book({ front_image: 'f.jpg', edge_image: 'e.jpg', cover_image: 'c.jpg' }))
    expect(tile.cover).toBe('f.jpg')
    expect(tile.coverSlot).toBe('front')
    expect(tile.fromCatalogue).toBe(false)
  })

  it('uses the catalogue cover only when no photo of this copy exists', () => {
    const tile = coverOf(book({ cover_image: 'c.jpg' }))
    expect(tile.cover).toBe('c.jpg')
    expect(tile.fromCatalogue).toBe(true)
  })

  it('leaves a book with no picture anywhere to be drawn as a name', () => {
    // A publisher image can simply be missing, and plenty of books here were
    // catalogued with photos of only one side. Neither is an error.
    const tile = coverOf(book())
    expect(tile.cover).toBe('')
    expect(tile.coverSlot).toBe('')
    expect(tile.authorFiling).toBe('Herbert, Frank')
  })
})

describe('coverLabel', () => {
  it('names a real front cover plainly', () => {
    expect(coverLabel(coverOf(book({ front_image: 'f.jpg' })))).toBe('Dune, front cover')
  })

  it('says when a spine or a back is standing in for the cover', () => {
    expect(coverLabel(coverOf(book({ edge_image: 'e.jpg' }))))
      .toBe('Dune, spine, no cover photo')
    expect(coverLabel(coverOf(book({ back_image: 'b.jpg' }))))
      .toBe('Dune, back cover, no front cover photo')
  })

  it('says a catalogue picture is the publisher\'s and not this copy', () => {
    // The one a reader would otherwise get wrong. A stock cover sitting in a
    // grid of photographs looks like another photograph.
    expect(coverLabel(coverOf(book({ cover_image: 'c.jpg' }))))
      .toBe("Dune, the publisher's picture, not this copy")
  })

  it('admits when there is no picture at all', () => {
    expect(coverLabel(coverOf(book()))).toBe('Dune, no picture')
  })
})

describe('rowOf', () => {
  it('draws the group in the order it was laid out', () => {
    const row = rowOf(group([
      book({ id: 1, title: 'Amber' }),
      book({ id: 2, title: 'Bounty' }),
      book({ id: 3, title: 'Cider' }),
    ]))
    expect(row.map((s) => s.title)).toEqual(['Amber', 'Bounty', 'Cider'])
  })

  it('is exactly the books on the bookcase, since the server has already left the absent ones out', () => {
    // The server lays out only books with no checked_out_at, so the run has
    // already closed up behind one that is off. Adding it back as a marker
    // would put every number after it out by one, and the numbers are what
    // somebody counts along to find a book.
    const row = rowOf(group([book({ id: 1 }), book({ id: 2 })]))
    expect(row).toHaveLength(2)
  })
})

describe('listOf', () => {
  const off = (label: string, book: BookRow): CheckedOutAt => ({ book, label })

  it('numbers the books on the bookcase in the order they stand', () => {
    const rows = listOf(
      group([
        book({ id: 1, title: 'Amber', sort_key: 'a' }),
        book({ id: 2, title: 'Bounty', sort_key: 'b' }),
      ]),
      [],
    )
    expect(rows.map((r) => [r.book.title, r.n])).toEqual([['Amber', 1], ['Bounty', 2]])
  })

  it('files an absent book into its alphabetical slot rather than at the end', () => {
    const rows = listOf(
      group([
        book({ id: 1, title: 'Amber', sort_key: 'a' }),
        book({ id: 3, title: 'Cider', sort_key: 'c' }),
      ]),
      [off('1A', book({ id: 2, title: 'Bounty', sort_key: 'b' }))],
    )
    expect(rows.map((r) => r.book.title)).toEqual(['Amber', 'Bounty', 'Cider'])
  })

  it('gives an absent book no position, because you cannot count to it', () => {
    // This is the whole difference between the list and the two drawings of
    // the furniture. The list can show the gap without lying about where the
    // books either side of it are, because it never claimed to be a picture.
    const rows = listOf(
      group([book({ id: 1, title: 'Amber', sort_key: 'a' })]),
      [off('1A', book({ id: 2, title: 'Bounty', sort_key: 'b' }))],
    )
    expect(rows.map((r) => [r.book.title, r.n, r.here]))
      .toEqual([['Amber', 1, true], ['Bounty', 0, false]])
  })

  it('leaves books that are off a different plank out of this one', () => {
    const rows = listOf(
      group([book({ id: 1, sort_key: 'a' })], '1A'),
      [off('1B', book({ id: 2, title: 'Elsewhere', sort_key: 'b' }))],
    )
    expect(rows).toHaveLength(1)
  })
})

describe('missingFrom', () => {
  const off = (label: string, id: number): CheckedOutAt => ({ book: book({ id }), label })

  it('counts only the books belonging to this area', () => {
    expect(missingFrom('1A', [off('1A', 1), off('1B', 2), off('1A', 3)])).toBe(2)
  })

  it('is zero when the bookcase is whole', () => {
    expect(missingFrom('1A', [])).toBe(0)
  })
})

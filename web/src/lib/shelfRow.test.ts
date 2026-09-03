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
  coverNote, coverOf, listOf, missingFrom, spineLabel, spineOf,
} from './shelfRow'
import type { CheckedOutAt, FiledBookRow, ShelfGroupDto } from './api'

function book(overrides: Partial<FiledBookRow> = {}): FiledBookRow {
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
    area_id: 1,
    standing: { fixtureId: 1, fixture: 1, plank: 0, name: '', kind: 'bookshelf' },
    shelf_range: 'fiction',
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
    state: 'shelved',
    cover_image: '',
    front_crop: '',
    back_crop: '',
    edge_crop: '',
    cropped: '',
    sort_key: 'herbert frank|dune',
    ...overrides,
  }
}

function group(books: FiledBookRow[], areaId = 11, label = '1A'): ShelfGroupDto {
  return {
    area: 0,
    shelf: 1,
    label,
    areaId,
    standing: { fixtureId: 1, fixture: 1, plank: 0, name: '', kind: 'bookshelf' },
    books: books.map((b) => ({ book: b })),
    opensWith: null,
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

  it('shows the crop, which is the whole point of the gallery', () => {
    // The owner's complaint was this view: "in the background is, like, my
    // feet, still in the photo".
    const tile = coverOf(book({
      front_image: 'f.jpg', front_crop: 'f_crop.jpg', cropped: 'front',
    }))
    expect(tile.cover).toBe('f_crop.jpg')
    expect(tile.coverSlot).toBe('front')
    expect(tile.cropped).toBe(true)
  })

  it('falls back to the whole photo where the book could not be found', () => {
    const tile = coverOf(book({ front_image: 'f.jpg', cropped: 'front' }))
    expect(tile.cover).toBe('f.jpg')
    expect(tile.cropped).toBe(false)
  })
})

describe('coverNote', () => {
  it('says nothing about a real front cover, because there is nothing to say', () => {
    expect(coverNote(coverOf(book({ front_image: 'f.jpg' })))).toBe('')
  })

  it('says when a spine or a back is standing in for the cover', () => {
    expect(coverNote(coverOf(book({ edge_image: 'e.jpg' }))))
      .toBe('Spine, no cover photo')
    expect(coverNote(coverOf(book({ back_image: 'b.jpg' }))))
      .toBe('Back cover, no front cover photo')
  })

  it('says a catalogue picture is the publisher\'s and not this copy', () => {
    // The one a reader would otherwise get wrong. A stock cover sitting in a
    // grid of photographs looks like another photograph.
    expect(coverNote(coverOf(book({ cover_image: 'c.jpg' }))))
      .toBe("The publisher's picture, not this copy")
  })

  it('says nothing about a book nobody has photographed', () => {
    // The cloth under the tile is already the drawing of that, on every screen
    // in the app, and a note repeating it would be one book in four shouting
    // that a field is empty.
    expect(coverNote(coverOf(book()))).toBe('')
  })
})

describe('listOf', () => {
  const off = (areaId: number, book: FiledBookRow, label = '1A'): CheckedOutAt =>
    ({ book, areaId, label })

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
      [off(11, book({ id: 2, title: 'Bounty', sort_key: 'b' }))],
    )
    expect(rows.map((r) => r.book.title)).toEqual(['Amber', 'Bounty', 'Cider'])
  })

  it('gives an absent book no position, because you cannot count to it', () => {
    // This is the whole difference between the list and the two drawings of
    // the furniture. The list can show the gap without lying about where the
    // books either side of it are, because it never claimed to be a picture.
    const rows = listOf(
      group([book({ id: 1, title: 'Amber', sort_key: 'a' })]),
      [off(11, book({ id: 2, title: 'Bounty', sort_key: 'b' }))],
    )
    expect(rows.map((r) => [r.book.title, r.n, r.here]))
      .toEqual([['Amber', 1, true], ['Bounty', 0, false]])
  })

  it('leaves books that are off a different plank out of this one', () => {
    const rows = listOf(
      group([book({ id: 1, sort_key: 'a' })], 11),
      [off(12, book({ id: 2, title: 'Elsewhere', sort_key: 'b' }), '1B')],
    )
    expect(rows).toHaveLength(1)
  })

  /**
   * #447, and behind it #356: the two sides used to be two strings, and a plank
   * has two renderers. The absent book carries the area now, so the ordinal walk
   * and the furniture disagreeing about what to call a plank cannot take a book
   * out of the gap it belongs in.
   */
  it('files an absent book by its area, not by what the two sides call it', () => {
    const rows = listOf(
      group([book({ id: 1, title: 'Amber', sort_key: 'a' })], 11, 'Hall shelf · A'),
      [off(11, book({ id: 2, title: 'Bounty', sort_key: 'b' }), '1A')],
    )
    expect(rows.map((r) => r.book.title)).toEqual(['Amber', 'Bounty'])
  })
})

describe('missingFrom', () => {
  const off = (areaId: number, id: number, label = '1A'): CheckedOutAt =>
    ({ book: book({ id }), areaId, label })

  it('counts only the books belonging to this area', () => {
    expect(missingFrom(group([], 11), [off(11, 1), off(12, 2, '1B'), off(11, 3)])).toBe(2)
  })

  it('is zero when the bookcase is whole', () => {
    expect(missingFrom(group([], 11), [])).toBe(0)
  })

  /**
   * Two pieces standing on one number is an arrangement this catalogue has, and
   * both their top planks read `4A`. Counting by the label would put one piece's
   * absent books in the other piece's board (#447).
   */
  it('does not count a book off the other piece standing on the same number', () => {
    expect(missingFrom(group([], 11, '4A'), [off(99, 1, '4A')])).toBe(0)
  })
})

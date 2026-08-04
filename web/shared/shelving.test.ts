import { describe, expect, it } from 'vitest'
import {
  bookCover, buildPlacement, buildSortKey, compareLocations, filingName,
  normalise, parseLocation, reviewShelving, shelfPhoto, shelfPhotoSlot,
  titleFiling, type FiledBook, type Neighbour,
} from './shelving'

describe('normalise', () => {
  it('folds accents to plain ASCII', () => {
    expect(normalise('Böll')).toBe('BOLL')
    expect(normalise('García Márquez')).toBe('GARCIA MARQUEZ')
  })

  it('strips punctuation and collapses whitespace', () => {
    expect(normalise("O'Brien,  Tim")).toBe('O BRIEN TIM')
  })

  it('keeps space sorting below letters so short surnames come first', () => {
    // This is the property that makes SMITH ANN precede SMITHSON A.
    expect(normalise('Smith, Ann') < normalise('Smithson, A')).toBe(true)
  })
})

describe('filingName', () => {
  // The table from docs/shelving.md, including the two known-wrong cases.
  const cases: [string, string][] = [
    ['Ursula K. Le Guin', 'Le Guin, Ursula K.'],
    ['J. R. R. Tolkien', 'Tolkien, J. R. R.'],
    ['Tim O\'Brien', "O'Brien, Tim"],
    ['Homer', 'Homer'],
    ['Douglas Adams', 'Adams, Douglas'],
    ['Charles de Lint', 'de Lint, Charles'],
  ]

  it.each(cases)('files %s as %s', (input, expected) => {
    expect(filingName(input)).toBe(expected)
  })

  it('moves suffixes after the inverted name', () => {
    expect(filingName('Martin Luther King Jr.')).toBe('King, Martin Luther Jr.')
  })

  it('drops honorifics', () => {
    expect(filingName('Dr. Seuss')).toBe('Seuss')
  })

  it('leaves mononyms and corporate names uninverted', () => {
    expect(filingName('Voltaire')).toBe('Voltaire')
  })

  it('is knowingly wrong on Spanish compound surnames', () => {
    // Documented limitation. If this ever starts passing, the override table
    // may no longer be needed for this case, but do not "fix" it with a
    // heuristic: middle names are indistinguishable from a second surname.
    expect(filingName('Gabriel García Márquez')).toBe('Márquez, Gabriel García')
  })

  it('handles empty and whitespace input', () => {
    expect(filingName('')).toBe('')
    expect(filingName('   ')).toBe('')
  })
})

describe('titleFiling', () => {
  it('drops leading articles', () => {
    expect(titleFiling('The Hobbit')).toBe('HOBBIT')
    expect(titleFiling('A Wizard of Earthsea')).toBe('WIZARD OF EARTHSEA')
    expect(titleFiling('An Ember in the Ashes')).toBe('EMBER IN THE ASHES')
  })

  it('does not strip an article that is part of a word', () => {
    expect(titleFiling('Theft of Fire')).toBe('THEFT OF FIRE')
  })
})

describe('buildSortKey', () => {
  const key = (authorFiling: string, title: string, seriesName = '', seriesIndex: number | null = null) =>
    buildSortKey({ authorFiling, title, seriesName, seriesIndex })

  it('orders by author before title', () => {
    expect(key('Adams, Douglas', 'Zzz') < key('Banks, Iain', 'Aaa')).toBe(true)
  })

  it('puts an author\'s series ahead of their standalones', () => {
    const series = key('Pratchett, Terry', 'Mort', 'Discworld', 4)
    const standalone = key('Pratchett, Terry', 'Good Omens')
    expect(series < standalone).toBe(true)
  })

  it('orders a series numerically, not lexically', () => {
    const second = key('Pratchett, Terry', 'Equal Rites', 'Discworld', 2)
    const tenth = key('Pratchett, Terry', 'Moving Pictures', 'Discworld', 10)
    expect(second < tenth).toBe(true)
  })

  it('slots a half-numbered novella between whole books', () => {
    const five = key('A, B', 'Five', 'S', 5)
    const half = key('A, B', 'Novella', 'S', 5.5)
    const six = key('A, B', 'Six', 'S', 6)
    expect(five < half && half < six).toBe(true)
  })

  it('ignores a leading article when ordering standalones', () => {
    const hobbit = key('Tolkien, J. R. R.', 'The Hobbit')
    const silmarillion = key('Tolkien, J. R. R.', 'The Silmarillion')
    expect(hobbit < silmarillion).toBe(true)
  })
})

describe('parseLocation and compareLocations', () => {
  it('parses the accepted label forms', () => {
    expect(parseLocation('1A')).toEqual({ shelf: 1, section: 'A' })
    expect(parseLocation('S1A')).toEqual({ shelf: 1, section: 'A' })
    expect(parseLocation('S4')).toEqual({ shelf: 4, section: '' })
    expect(parseLocation('s4 b')).toEqual({ shelf: 4, section: 'B' })
    expect(parseLocation('nowhere')).toBeNull()
  })

  it('orders by shelf number, not by string', () => {
    // The bug this guards against: '10A' < '2A' as plain strings.
    expect(compareLocations('2A', '10A')).toBeLessThan(0)
  })

  it('sorts a bare shelf ahead of its sections', () => {
    expect(compareLocations('S4', 'S4A')).toBeLessThan(0)
  })

  it('sorts unparseable labels last so they surface', () => {
    expect(compareLocations('junk', '1A')).toBeGreaterThan(0)
  })
})

describe('buildPlacement', () => {
  const neighbour = (id: number, title: string, location: string): Neighbour => ({
    id, title, authorFiling: `Author ${id}`, location, sortKey: String(id),
    images: { front: '', back: '', edge: '' },
  })

  it('reports one location when both neighbours share it', () => {
    const result = buildPlacement(
      'fiction', neighbour(1, 'Alpha', '1A'), neighbour(2, 'Beta', '1A'), '1A',
    )
    expect(result.kind).toBe('between-same-location')
    expect(result.suggestedLocation).toBe('1A')
    expect(result.instruction).toContain('Alpha')
    expect(result.instruction).toContain('Beta')
  })

  it('flags the boundary when neighbours are on different shelves', () => {
    const result = buildPlacement(
      'fiction', neighbour(1, 'Alpha', '2C'), neighbour(2, 'Beta', '2D'), '1A',
    )
    expect(result.kind).toBe('between-different-locations')
    expect(result.instruction).toContain('boundary')
  })

  it('handles the very first book in a range', () => {
    const result = buildPlacement('nonfiction', null, null, 'S4')
    expect(result.kind).toBe('first-in-range')
    expect(result.suggestedLocation).toBe('S4')
    expect(result.instruction).toContain('non-fiction')
  })

  it('handles the ends of a range', () => {
    expect(buildPlacement('fiction', null, neighbour(1, 'A', '1A'), '1A').kind)
      .toBe('start-of-range')
    expect(buildPlacement('fiction', neighbour(1, 'A', '3B'), null, '1A').kind)
      .toBe('end-of-range')
  })
})

describe('shelfPhoto', () => {
  const withImages = (images: { front: string; back: string; edge: string }): Neighbour => ({
    id: 1, title: 'T', authorFiling: 'A', location: '1A', sortKey: '1', images,
  })

  it('prefers the spine, which is what you see on a shelf', () => {
    expect(shelfPhoto(withImages({ front: 'f.jpg', back: 'b.jpg', edge: 'e.jpg' })))
      .toBe('e.jpg')
  })

  it('falls back to the front cover when there is no spine photo', () => {
    expect(shelfPhoto(withImages({ front: 'f.jpg', back: 'b.jpg', edge: '' })))
      .toBe('f.jpg')
  })

  it('returns nothing for a book with no photos, rather than a broken src', () => {
    expect(shelfPhoto(withImages({ front: '', back: '', edge: '' }))).toBe('')
    expect(shelfPhoto(null)).toBe('')
  })
})

describe('bookCover', () => {
  const images = (overrides: Partial<Record<'front' | 'back' | 'edge' | 'catalogue', string>>) =>
    ({ front: '', back: '', edge: '', catalogue: '', ...overrides })

  it('shows the front cover first, since the book is lying face up', () => {
    // The opposite order from shelfImage, on purpose. A spine wins on a shelf
    // because it is the only face you can see; a grid of covers is showing
    // the face nobody can see from the shelf.
    const picked = bookCover(images({ front: 'f.jpg', edge: 'e.jpg', back: 'b.jpg', catalogue: 'c.jpg' }))
    expect(picked.name).toBe('f.jpg')
    expect(picked.slot).toBe('front')
    expect(picked.fromCatalogue).toBe(false)
  })

  it('would rather show a spine of this copy than a stock picture of some copy', () => {
    const picked = bookCover(images({ edge: 'e.jpg', catalogue: 'c.jpg' }))
    expect(picked.name).toBe('e.jpg')
    expect(picked.slot).toBe('edge')
    expect(picked.fromCatalogue).toBe(false)
  })

  it('falls back through the back cover before the catalogue', () => {
    expect(bookCover(images({ back: 'b.jpg', catalogue: 'c.jpg' })).slot).toBe('back')
  })

  it('takes the publisher picture as a last resort, and says so', () => {
    const picked = bookCover(images({ catalogue: 'c.jpg' }))
    expect(picked.name).toBe('c.jpg')
    expect(picked.slot).toBe('catalogue')
    expect(picked.fromCatalogue).toBe(true)
  })

  it('admits to nothing at all rather than handing back a broken src', () => {
    // Both halves can be missing: a book nobody has photographed, whose ISBN
    // no catalogue has a cover for. The grid draws a name instead.
    const picked = bookCover(images({}))
    expect(picked.name).toBe('')
    expect(picked.slot).toBe('')
    expect(picked.fromCatalogue).toBe(false)
  })
})

describe('reviewShelving', () => {
  const book = (
    id: number,
    location: string,
    derivedLocation: string,
    over: Partial<FiledBook> = {},
  ): FiledBook => ({
    id,
    title: `Book ${id}`,
    authorFiling: `Author, A${id}`,
    location,
    derivedLocation,
    sortKey: String(id).padStart(3, '0'),
    checkedOut: false,
    ...over,
  })

  const ids = (review: ReturnType<typeof reviewShelving>) =>
    review.misfiles.map((m) => m.book.id)

  it('says nothing about a shelf that agrees with itself', () => {
    expect(ids(reviewShelving([
      book(1, '1A', '1A'), book(2, '1A', '1A'), book(3, '1B', '1B'),
      book(4, '2A', '2A'),
    ]))).toEqual([])
  })

  it('names the book that is in the wrong place, and where it goes', () => {
    const review = reviewShelving([
      book(1, '1A', '1A'), book(2, '3C', '1A'), book(3, '1B', '1B'),
    ])
    expect(ids(review)).toEqual([2])
    expect(review.misfiles[0]).toMatchObject({ from: '3C', to: '1A' })
    expect(review.misfiles[0]!.instruction).toContain('3C')
    expect(review.misfiles[0]!.instruction).toContain('1A')
  })

  it('blames the stray book rather than its innocent neighbour', () => {
    // The failure mode of the pairwise rank check this replaced. Book 2 is on
    // the wrong bookcase; comparing each book with the one before it flags
    // book 3, which is exactly where it should be, and lets book 2 off.
    const review = reviewShelving([
      book(1, '1A', '1A'), book(2, '3C', '1A'), book(3, '1B', '1B'),
      book(4, '1B', '1B'), book(5, '1C', '1C'),
    ])
    expect(ids(review)).toEqual([2])
  })

  it('reports every book a moved boundary displaced, not just the first', () => {
    // Marking a shelf full pushes a whole run along. All of them are physical
    // jobs and none of them will happen if only one is listed.
    expect(ids(reviewShelving([
      book(1, '1A', '1A'), book(2, '1A', '1B'), book(3, '1A', '1B'),
      book(4, '1B', '1C'),
    ]))).toEqual([2, 3, 4])
  })

  it('does not call a book misfiled over the way its label was typed', () => {
    // s4 b and S4B are the same plank. Comparing the strings would send
    // somebody across the room for nothing.
    expect(ids(reviewShelving([book(1, 's4 b', 'S4B')]))).toEqual([])
    expect(ids(reviewShelving([book(1, '4B', '4B')]))).toEqual([])
  })

  it('leaves a book nobody has ever placed out of it', () => {
    const review = reviewShelving([book(1, '', '1A'), book(2, '   ', '1B')])
    expect(review.misfiles).toEqual([])
    expect(review.excluded.map((e) => [e.book.id, e.reason]))
      .toEqual([[1, 'never-placed'], [2, 'never-placed']])
  })

  it('leaves a checked-out book out of it, having no position to be wrong', () => {
    // Off the shelf entirely. Its old location is not a claim about anywhere.
    const review = reviewShelving([book(1, '1A', '', { checkedOut: true })])
    expect(review.misfiles).toEqual([])
    expect(review.excluded[0]!.reason).toBe('checked-out')
  })

  it('sets aside a label it cannot read instead of guessing at it', () => {
    const review = reviewShelving([book(1, 'in the box', '1A')])
    expect(review.misfiles).toEqual([])
    expect(review.excluded[0]!.reason).toBe('unreadable-location')
  })

  it('orders the list by where the books are, since that is the walk', () => {
    const review = reviewShelving([
      book(1, '2B', '1A'), book(2, '1A', '2C'), book(3, '2A', '1B'),
    ])
    expect(review.misfiles.map((m) => m.from)).toEqual(['1A', '2A', '2B'])
  })

  it('does not need its input sorted', () => {
    // Every judgement is per book, so there is no precondition to violate.
    const shuffled = [book(3, '1B', '1B'), book(1, '2A', '1A'), book(2, '1A', '1A')]
    expect(ids(reviewShelving(shuffled))).toEqual([1])
  })
})

describe('shelfPhotoSlot', () => {
  const withImages = (images: { front: string; back: string; edge: string }): Neighbour => ({
    id: 1, title: 'T', authorFiling: 'A', location: '1A', sortKey: '1', images,
  })

  it('reports which photo shelfPhoto chose, so it can be framed for that side', () => {
    expect(shelfPhotoSlot(withImages({ front: 'f', back: 'b', edge: 'e' }))).toBe('edge')
    expect(shelfPhotoSlot(withImages({ front: 'f', back: 'b', edge: '' }))).toBe('front')
    expect(shelfPhotoSlot(withImages({ front: '', back: 'b', edge: '' }))).toBe('back')
  })

  it('agrees with shelfPhoto about which file it picked', () => {
    const n = withImages({ front: 'f', back: 'b', edge: '' })
    expect(shelfPhoto(n)).toBe('f')
    expect(shelfPhotoSlot(n)).toBe('front')
  })

  it('returns nothing when there are no photos', () => {
    expect(shelfPhotoSlot(withImages({ front: '', back: '', edge: '' }))).toBe('')
    expect(shelfPhotoSlot(null)).toBe('')
  })
})

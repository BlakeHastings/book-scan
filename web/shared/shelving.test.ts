import { describe, expect, it } from 'vitest'
import {
  bookCover, buildPlacement, buildSortKey, filingName,
  normalise, parseLocation, placementOnAPlank, reviewShelving, shelfImage, shelfPhoto,
  shelfPhotoSlot, titleFiling, type FiledBook, type Neighbour,
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
    expect(normalise('Smith, Ann') < normalise('Smithson, A')).toBe(true)
  })

  it('keeps letters that are not A-Z rather than folding a name to nothing', () => {
    expect(normalise('Фёдор Достоевский')).toBe('ФЕДОР ДОСТОЕВСКИИ')
    expect(normalise('村上春樹')).toBe('村上春樹')
    expect(normalise('Νίκος Καζαντζάκης')).toBe('ΝΙΚΟΣ ΚΑΖΑΝΤΖΑΚΗΣ')
    expect(normalise('Jens Bjørneboe')).toBe('JENS BJØRNEBOE')
  })

  it('keeps both halves of a name that mixes scripts', () => {
    expect(normalise('Smith, Иван')).toBe('SMITH ИВАН')
    expect(normalise('Smith, Иван')).not.toBe(normalise('Smith'))
    expect(normalise('Smith, Ann') < normalise('Smith, Иван')).toBe(true)
    expect(normalise('Smith, Иван') < normalise('Smithson, A')).toBe(true)
  })

  it('folds accents the same way it always did, so nothing already filed moves', () => {
    // Cyrillic ё decomposes into e + combining diaeresis, the same mechanism
    // that drops Latin accents.
    expect(normalise('García')).toBe('GARCIA')
    expect(normalise('Фёдор')).toBe(normalise('Федор'))
  })
})

describe('filingName', () => {
  // See docs/shelving.md; includes two known-wrong cases.
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
    // Documented limitation, not a bug to fix with a heuristic: middle names
    // are indistinguishable from a second surname.
    expect(filingName('Gabriel García Márquez')).toBe('Márquez, Gabriel García')
  })

  it('handles empty and whitespace input', () => {
    expect(filingName('')).toBe('')
    expect(filingName('   ')).toBe('')
  })

  it('inverts a name written in another script the way it inverts any other', () => {
    expect(filingName('Фёдор Достоевский')).toBe('Достоевский, Фёдор')
    expect(filingName('Νίκος Καζαντζάκης')).toBe('Καζαντζάκης, Νίκος')
    // A CJK name has no spaces, so it reads as a mononym and files as printed.
    expect(filingName('村上春樹')).toBe('村上春樹')
  })

  it('answers what was printed when it has nothing to invert', () => {
    // An empty filing name sorts ahead of every real one, so a book would
    // shelve as though it had no author.
    expect(filingName('Dr.')).toBe('Dr.')
    expect(filingName('(Various)')).toBe('(Various)')
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

  it('files a non-Latin author in the range rather than ahead of all of it', () => {
    // The author component leads every key, so an empty one sorts first regardless of title.
    const dostoevsky = key('Достоевский, Фёдор', 'Crime and Punishment')
    expect(key('Austen, Jane', 'Persuasion') < dostoevsky).toBe(true)
    expect(key('Zusak, Markus', 'The Book Thief') < dostoevsky).toBe(true)
    expect(dostoevsky < key('村上春樹', 'Norwegian Wood')).toBe(true)
  })

  it('ignores a leading article when ordering standalones', () => {
    const hobbit = key('Tolkien, J. R. R.', 'The Hobbit')
    const silmarillion = key('Tolkien, J. R. R.', 'The Silmarillion')
    expect(hobbit < silmarillion).toBe(true)
  })
})

describe('parseLocation', () => {
  it('parses the accepted label forms', () => {
    expect(parseLocation('1A')).toEqual({ shelf: 1, section: 'A' })
    expect(parseLocation('S1A')).toEqual({ shelf: 1, section: 'A' })
    expect(parseLocation('S4')).toEqual({ shelf: 4, section: '' })
    expect(parseLocation('s4 b')).toEqual({ shelf: 4, section: 'B' })
    expect(parseLocation('nowhere')).toBeNull()
  })

  it('does not understand a label with a piece\'s name in it, and should not', () => {
    // Deliberate: a label is what somebody typed, not what decides which plank it is; the row does.
    expect(parseLocation('Hall shelf · A')).toBeNull()
  })
})

describe('buildPlacement', () => {
  const neighbour = (
    id: number,
    title: string,
    location: string,
    areaId: number | null = null,
  ): Neighbour => ({
    id, title, authorFiling: `Author ${id}`, authors: '', location, areaId, sortKey: String(id),
    images: { front: '', back: '', edge: '' },
  })

  it('reports one location when both neighbours share it', () => {
    const result = buildPlacement(
      'fiction', neighbour(1, 'Alpha', '1A', 7), neighbour(2, 'Beta', '1A', 7), '1A',
    )
    expect(result.kind).toBe('between-same-location')
    expect(result.suggestedLocation).toBe('1A')
    expect(result.instruction).toContain('Alpha')
    expect(result.instruction).toContain('Beta')
  })

  it('flags the boundary when neighbours are on different shelves', () => {
    const result = buildPlacement(
      'fiction', neighbour(1, 'Alpha', '2C', 7), neighbour(2, 'Beta', '2D', 8), '1A',
    )
    expect(result.kind).toBe('between-different-locations')
    expect(result.instruction).toContain('boundary')
  })

  it('sees the boundary between two planks of a piece somebody has named', () => {
    const result = buildPlacement(
      'nonfiction',
      neighbour(1, 'Alpha', 'Hall shelf · A', 2),
      neighbour(2, 'Beta', 'Hall shelf · B', 7),
      'Hall shelf · A',
    )
    expect(result.kind).toBe('between-different-locations')
    expect(result.instruction).toContain('boundary')
    expect(result.instruction).toContain('Hall shelf · A')
    expect(result.instruction).toContain('Hall shelf · B')
  })

  // See `AreaStanding`: two areas can legitimately share a label.
  it('keeps two planks apart when they read as the same label', () => {
    const result = buildPlacement(
      'fiction', neighbour(1, 'Alpha', '4A', 2), neighbour(2, 'Beta', '4A', 11), '1A',
    )
    expect(result.kind).toBe('between-different-locations')
  })

  it('does not call two books nobody has placed the same place', () => {
    const result = buildPlacement(
      'fiction', neighbour(1, 'Alpha', ''), neighbour(2, 'Beta', ''), '1A',
    )
    expect(result.kind).toBe('between-different-locations')
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

  it('falls back to the printed authors string when a neighbour has no filing name', () => {
    const uncredited: Neighbour = {
      id: 2, title: 'Beta', authorFiling: '', authors: 'J. R. R. Tolkien',
      location: '1A', areaId: 7, sortKey: '2', images: { front: '', back: '', edge: '' },
    }
    const result = buildPlacement('fiction', neighbour(1, 'Alpha', '1A', 7), uncredited, '1A')
    expect(result.instruction).toContain('J. R. R. Tolkien')
    expect(result.instruction).not.toContain('Unknown author')
  })

  /**
   * `rangeStart` null means no rule names where the range begins at all,
   * distinct from a range whose neighbours simply have no location.
   */
  describe('when no rule says where the range begins', () => {
    it('says so, and offers no plank', () => {
      const result = buildPlacement('nonfiction', null, null, null)
      expect(result.kind).toBe('range-has-no-start')
      expect(result.suggestedLocation).toBe('')
      expect(result.instruction).toBe(
        'Nothing says where non-fiction begins, so there is nowhere to put this book. '
        + 'Say what belongs on a bookcase or a shelf first.',
      )
    })

    it('never names a plank in the sentence, whichever neighbours it has', () => {
      const both = [neighbour(1, 'Alpha', '1A', 7), neighbour(2, 'Beta', '2B', 8)] as const
      for (const [predecessor, successor] of [
        [null, null], [both[0], null], [null, both[1]], [both[0], both[1]],
      ] as const) {
        const result = buildPlacement('fiction', predecessor, successor, null)
        expect(result.kind).toBe('range-has-no-start')
        expect(result.instruction).not.toMatch(/\d[A-Z]/)
      }
    })

    it('still carries the two books either side, which is the sequence', () => {
      const result = buildPlacement(
        'fiction', neighbour(1, 'Alpha', '1A', 7), neighbour(2, 'Beta', '1A', 7), null,
      )
      expect(result.predecessor?.title).toBe('Alpha')
      expect(result.successor?.title).toBe('Beta')
    })

    it('is not what an empty label means, which is a neighbour nobody has placed', () => {
      // '' and null differ: a start with unplaced neighbours still has somewhere to suggest, a null start has nowhere.
      const result = buildPlacement(
        'fiction', neighbour(1, 'Alpha', ''), neighbour(2, 'Beta', ''), '1A',
      )
      expect(result.kind).toBe('between-different-locations')
      expect(result.suggestedLocation).toBe('1A')
    })
  })

  it('says "Unknown author" only once neither name is available', () => {
    const nameless: Neighbour = {
      id: 2, title: 'Beta', authorFiling: '', authors: '',
      location: '1A', areaId: 7, sortKey: '2', images: { front: '', back: '', edge: '' },
    }
    const result = buildPlacement('fiction', neighbour(1, 'Alpha', '1A', 7), nameless, '1A')
    expect(result.instruction).toContain('Unknown author')
  })
})

/**
 * Unlike `buildPlacement`, no instruction here mentions the range: these
 * neighbours are only the two books either side of a gap on one plank.
 */
describe('placementOnAPlank', () => {
  const neighbour = (id: number, title: string): Neighbour => ({
    id, title, authorFiling: `Author ${id}`, authors: '', location: '3A', areaId: 3, sortKey: String(id),
    images: { front: '', back: '', edge: '' },
  })

  it('names the plank and the two books the gap is between', () => {
    const result = placementOnAPlank(
      'nonfiction', '3A', neighbour(1, 'Alpha'), neighbour(2, 'Beta'),
    )
    expect(result.kind).toBe('on-a-plank')
    expect(result.suggestedLocation).toBe('3A')
    expect(result.instruction).toContain('3A')
    expect(result.instruction).toContain('Alpha')
    expect(result.instruction).toContain('Beta')
  })

  it('says where on the plank when there is only a book on one side', () => {
    const after = placementOnAPlank('nonfiction', '3A', neighbour(1, 'Alpha'), null)
    expect(after.instruction).toContain('at the end')
    expect(after.instruction, 'it claims a place in the whole run').not.toContain('non-fiction')

    const before = placementOnAPlank('nonfiction', '3A', null, neighbour(2, 'Beta'))
    expect(before.instruction).toContain('at the start')
    expect(before.instruction, 'it claims a place in the whole run').not.toContain('non-fiction')
  })

  it('says a bare plank is bare rather than calling the book the first in a range', () => {
    const result = placementOnAPlank('nonfiction', 'Landing shelves · Top', null, null)
    expect(result.instruction).toBe(
      'Landing shelves · Top has nothing on it yet, so this book starts it.',
    )
  })

  it('names a neighbour the way every other placement names one', () => {
    const uncredited: Neighbour = {
      id: 2, title: 'Beta', authorFiling: '', authors: 'J. R. R. Tolkien',
      location: '3A', areaId: 3, sortKey: '2', images: { front: '', back: '', edge: '' },
    }
    const result = placementOnAPlank('fiction', '3A', neighbour(1, 'Alpha'), uncredited)
    expect(result.instruction).toContain('J. R. R. Tolkien')
    expect(result.instruction).not.toContain('Unknown author')
  })
})

describe('shelfPhoto', () => {
  const withImages = (images: { front: string; back: string; edge: string }): Neighbour => ({
    id: 1, title: 'T', authorFiling: 'A', authors: '', location: '1A', areaId: 1, sortKey: '1', images,
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

  it('draws the cropped spine, and names the whole photo alongside it', () => {
    const picked = shelfImage({
      front: '', back: '', edge: 'e.jpg', crops: { edge: 'e_crop.jpg' },
    })
    expect(picked.name).toBe('e_crop.jpg')
    expect(picked.slot).toBe('edge')
    expect(picked.whole).toBe('e.jpg')
  })

  it('picks the slot before it looks at the crops, exactly as bookCover does', () => {
    // Crop status never affects slot choice, or two books on a shelf could show different faces depending on which happened to have a crop.
    const picked = shelfImage({
      front: 'f.jpg', back: '', edge: 'e.jpg', crops: { front: 'f_crop.jpg' },
    })
    expect(picked.slot).toBe('edge')
    expect(picked.name).toBe('e.jpg')
  })
})

describe('bookCover', () => {
  const images = (overrides: Partial<Record<'front' | 'back' | 'edge' | 'catalogue', string>>) =>
    ({ front: '', back: '', edge: '', catalogue: '', ...overrides })

  it('shows the front cover first, since the book is lying face up', () => {
    // Opposite priority from shelfImage, deliberately: a shelf only shows the spine, a cover grid shows the face you can't see there.
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
    const picked = bookCover(images({}))
    expect(picked.name).toBe('')
    expect(picked.slot).toBe('')
    expect(picked.fromCatalogue).toBe(false)
  })

  it('shows the crop of the chosen photo, and still names the whole one', () => {
    const picked = bookCover({
      ...images({ front: 'f.jpg' }),
      crops: { front: 'f_crop.jpg' },
    })
    expect(picked.name).toBe('f_crop.jpg')
    expect(picked.whole).toBe('f.jpg')
    expect(picked.cropped).toBe(true)
  })

  it('shows the whole photo where the book could not be found in it', () => {
    const picked = bookCover({ ...images({ front: 'f.jpg' }), crops: {} })
    expect(picked.name).toBe('f.jpg')
    expect(picked.whole).toBe('f.jpg')
    expect(picked.cropped).toBe(false)
  })

  it('picks the slot before it looks at the crops', () => {
    // Front still wins even with no crop of its own, or a grid would show different faces for books depending on which happened to have a crop.
    const picked = bookCover({
      ...images({ front: 'f.jpg', edge: 'e.jpg' }),
      crops: { edge: 'e_crop.jpg' },
    })
    expect(picked.slot).toBe('front')
    expect(picked.name).toBe('f.jpg')
    expect(picked.cropped).toBe(false)
  })

  it('does not pretend a publisher picture was cropped', () => {
    // A catalogue image has no room around it to cut away, so it is never marked as cropped.
    const picked = bookCover({
      ...images({ catalogue: 'c.jpg' }),
      crops: { front: 'f_crop.jpg' },
    })
    expect(picked.name).toBe('c.jpg')
    expect(picked.cropped).toBe(false)
    expect(picked.whole).toBe('c.jpg')
  })
})

describe('reviewShelving', () => {
  /** Planks are matched by id, not label: `1A` and `2C` are just how a person names them for the test. */
  const planks = new Map<string, { id: number; fixture: number; plank: number }>()
  const plank = (label: string) => {
    const found = planks.get(label)
    if (found) return found
    const made = {
      id: planks.size + 1,
      fixture: Number.parseInt(label, 10),
      plank: label.replace(/^\d+/, '').charCodeAt(0) - 65,
    }
    planks.set(label, made)
    return made
  }

  const book = (
    id: number,
    location: string,
    derivedLocation: string,
    over: Partial<FiledBook> = {},
  ): FiledBook => ({
    id,
    title: `Book ${id}`,
    authorFiling: `Author, A${id}`,
    authors: '',
    location,
    areaId: location.trim() ? plank(location).id : null,
    derivedLocation,
    derivedAreaId: derivedLocation.trim() ? plank(derivedLocation).id : null,
    standing: location.trim()
      ? { fixture: plank(location).fixture, plank: plank(location).plank }
      : null,
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

  it('falls back to the printed authors string when a book has no filing name', () => {
    // Same fallback as buildPlacement's instruction: an empty authorFiling does not mean nothing is known.
    const review = reviewShelving([
      book(1, '3C', '1A', { authorFiling: '', authors: 'Ursula K. Le Guin' }),
    ])
    expect(review.misfiles[0]!.instruction).toContain('Ursula K. Le Guin')
    expect(review.misfiles[0]!.instruction).not.toContain('unknown author')
  })

  it('says "unknown author" only once neither name is available', () => {
    const review = reviewShelving([
      book(1, '3C', '1A', { authorFiling: '', authors: '' }),
    ])
    expect(review.misfiles[0]!.instruction).toContain('unknown author')
  })

  it('blames the stray book rather than its innocent neighbour', () => {
    const review = reviewShelving([
      book(1, '1A', '1A'), book(2, '3C', '1A'), book(3, '1B', '1B'),
      book(4, '1B', '1B'), book(5, '1C', '1C'),
    ])
    expect(ids(review)).toEqual([2])
  })

  it('reports every book a moved boundary displaced, not just the first', () => {
    expect(ids(reviewShelving([
      book(1, '1A', '1A'), book(2, '1A', '1B'), book(3, '1A', '1B'),
      book(4, '1B', '1C'),
    ]))).toEqual([2, 3, 4])
  })

  it('judges the plank rather than what it is called', () => {
    const one = book(1, '4B', '4B')
    expect(ids(reviewShelving([
      { ...one, location: 'Hall shelf · B', derivedLocation: '4B' },
    ]))).toEqual([])
    expect(ids(reviewShelving([book(2, '4B', '4B')]))).toEqual([])
  })

  it('does not stop judging a book because its bookcase has a name', () => {
    const stray = book(1, '3C', '1A')
    const review = reviewShelving([
      { ...stray, location: 'Hall shelf · C', derivedLocation: 'Hall shelf · A' },
    ])
    expect(review.excluded).toEqual([])
    expect(ids(review)).toEqual([1])
  })

  it('leaves a book nobody has ever placed out of it', () => {
    const review = reviewShelving([book(1, '', '1A'), book(2, '   ', '1B')])
    expect(review.misfiles).toEqual([])
    expect(review.excluded.map((e) => [e.book.id, e.reason]))
      .toEqual([[1, 'never-placed'], [2, 'never-placed']])
  })

  it('leaves a checked-out book out of it, having no position to be wrong', () => {
    const review = reviewShelving([book(1, '1A', '', { checkedOut: true })])
    expect(review.misfiles).toEqual([])
    expect(review.excluded[0]!.reason).toBe('checked-out')
  })

  it('says so when the run has nowhere to put a book, rather than passing it', () => {
    const review = reviewShelving([book(1, '1A', '')])
    expect(review.misfiles).toEqual([])
    expect(review.excluded.map((e) => [e.book.id, e.reason])).toEqual([[1, 'unplaceable']])
  })

  it('orders the list by where the books are, since that is the walk', () => {
    const review = reviewShelving([
      book(1, '2B', '1A'), book(2, '1A', '2C'), book(3, '2A', '1B'),
    ])
    expect(review.misfiles.map((m) => m.from)).toEqual(['1A', '2A', '2B'])
  })

  it('does not need its input sorted', () => {
    const shuffled = [book(3, '1B', '1B'), book(1, '2A', '1A'), book(2, '1A', '1A')]
    expect(ids(reviewShelving(shuffled))).toEqual([1])
  })
})

describe('shelfPhotoSlot', () => {
  const withImages = (images: { front: string; back: string; edge: string }): Neighbour => ({
    id: 1, title: 'T', authorFiling: 'A', authors: '', location: '1A', areaId: 1, sortKey: '1', images,
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

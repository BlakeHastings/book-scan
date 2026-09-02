import { describe, expect, it } from 'vitest'
import {
  bookCover, buildPlacement, buildSortKey, compareLocations, filingName,
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
    // This is the property that makes SMITH ANN precede SMITHSON A.
    expect(normalise('Smith, Ann') < normalise('Smithson, A')).toBe(true)
  })

  it('keeps letters that are not A-Z rather than folding a name to nothing', () => {
    // Issue #195. Dropping everything outside [A-Z0-9 ] is a fold for a Latin
    // name and a deletion for one written in another script, and a name that
    // folds to nothing sorts ahead of every name in the range.
    // ё and й lose their marks the way é does, because rule 1 does not know
    // which alphabet it is looking at. Filing Достоевский next to Достоевскии
    // is the same trade already accepted for Böll and Boll.
    expect(normalise('Фёдор Достоевский')).toBe('ФЕДОР ДОСТОЕВСКИИ')
    expect(normalise('村上春樹')).toBe('村上春樹')
    expect(normalise('Νίκος Καζαντζάκης')).toBe('ΝΙΚΟΣ ΚΑΖΑΝΤΖΑΚΗΣ')
    expect(normalise('Jens Bjørneboe')).toBe('JENS BJØRNEBOE')
  })

  it('keeps both halves of a name that mixes scripts', () => {
    // The one that surprises. The Latin half used to be the whole answer, so
    // this name and a plain `Smith` folded to the same key and filed together.
    expect(normalise('Smith, Иван')).toBe('SMITH ИВАН')
    expect(normalise('Smith, Иван')).not.toBe(normalise('Smith'))
    // Still governed by the space rule above, so it lands inside the SMITH
    // block rather than after SMITHSON.
    expect(normalise('Smith, Ann') < normalise('Smith, Иван')).toBe(true)
    expect(normalise('Smith, Иван') < normalise('Smithson, A')).toBe(true)
  })

  it('folds accents the same way it always did, so nothing already filed moves', () => {
    // The combining marks Latin decomposes into are still dropped. Cyrillic ё
    // decomposes the same way and loses its diaeresis for the same reason.
    expect(normalise('García')).toBe('GARCIA')
    expect(normalise('Фёдор')).toBe(normalise('Федор'))
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

  it('inverts a name written in another script the way it inverts any other', () => {
    // Issue #195. The heuristic never had a problem with these names; nothing
    // reached it, because the caller folded them away first.
    expect(filingName('Фёдор Достоевский')).toBe('Достоевский, Фёдор')
    expect(filingName('Νίκος Καζαντζάκης')).toBe('Καζαντζάκης, Νίκος')
    // A CJK name is written surname first and has no spaces, so it is a
    // mononym to this and files as printed, which is right.
    expect(filingName('村上春樹')).toBe('村上春樹')
  })

  it('answers what was printed when it has nothing to invert', () => {
    // Not tidiness. An empty filing name sorts ahead of every real one, so a
    // book with an author would shelve as though it had none (#195).
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
    // Issue #195. The author component was empty for these, which is what
    // every key starts with, so the book landed first in its range whatever
    // else was on the shelf.
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

  /*
   * #468, and the reason a neighbour carries its area. The two labels are what
   * a person reads off a piece they have named, `parseLocation` understands
   * neither, and `compareLocations` reports two labels it cannot parse equal.
   * Deciding "same plank" from that told somebody standing at a bookcase to
   * file a book between two books that are not both on the plank it named.
   */
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

  /*
   * The other half of the same claim: two pieces really can stand on one
   * number, so one label can name two planks. `AreaStanding` says why.
   */
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
    // A book with no author_author credit still carries books.authors, which
    // is a name a person can read. Saying nobody is known is only honest once
    // that is checked too. See #235.
    const uncredited: Neighbour = {
      id: 2, title: 'Beta', authorFiling: '', authors: 'J. R. R. Tolkien',
      location: '1A', areaId: 7, sortKey: '2', images: { front: '', back: '', edge: '' },
    }
    const result = buildPlacement('fiction', neighbour(1, 'Alpha', '1A', 7), uncredited, '1A')
    expect(result.instruction).toContain('J. R. R. Tolkien')
    expect(result.instruction).not.toContain('Unknown author')
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
 * The same question asked about one plank, for a book somebody is carrying to it.
 *
 * Every test here is really one claim: **no sentence says anything about the
 * range.** `buildPlacement` above is entitled to, because it looked the book up
 * in the run; these neighbours are the two books either side of a gap on one
 * plank, and the rest of the range is on other planks. Somebody carrying the
 * third of eight books onto an empty plank was told, twice, that it was the last
 * book in non-fiction (#429).
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
    // A cropped front does not promote the front over an uncropped spine. The
    // spine wins on a shelf whatever happened to crop, or two books on the
    // same shelf would be drawn showing different faces.
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
    // The front photo has no crop and the spine does. The front still wins:
    // otherwise a grid would show a spine for one book and a cover for the
    // next because of which photo happened to crop, which is a worse rule
    // than either "always the front" or "always the spine".
    const picked = bookCover({
      ...images({ front: 'f.jpg', edge: 'e.jpg' }),
      crops: { edge: 'e_crop.jpg' },
    })
    expect(picked.slot).toBe('front')
    expect(picked.name).toBe('f.jpg')
    expect(picked.cropped).toBe(false)
  })

  it('does not pretend a publisher picture was cropped', () => {
    // There is no room around a catalogue image to cut away, so it is never
    // marked as cut down to the book.
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
  /**
   * A plank, as the furniture would hand it over: an id, a label and where it
   * stands.
   *
   * The tests below name planks the way a person does, `1A` and `2C`, and this
   * turns that into the shape the check reads. Two labels for one plank is the
   * case #356 is about, so a label is never the key here either: `plank` is what
   * decides identity and the label is only what a row would show.
   */
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
    // Same fallback as buildPlacement's instruction, and the same reason: an
    // empty author_filing does not mean nothing is known. See #235.
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

  it('judges the plank rather than what it is called', () => {
    // One plank, rendered twice: the ledger writes what the piece is called and
    // the layout writes where it stands. Reading the strings sends somebody
    // across the room for nothing, and #356 is what happened when it did.
    const one = book(1, '4B', '4B')
    expect(ids(reviewShelving([
      { ...one, location: 'Hall shelf · B', derivedLocation: '4B' },
    ]))).toEqual([])
    expect(ids(reviewShelving([book(2, '4B', '4B')]))).toEqual([])
  })

  it('does not stop judging a book because its bookcase has a name', () => {
    // The defect exactly: a label the check could not parse took the book out
    // of the answer, so a book in the wrong place came back as nothing to do.
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
    // Off the shelf entirely. Its old location is not a claim about anywhere.
    const review = reviewShelving([book(1, '1A', '', { checkedOut: true })])
    expect(review.misfiles).toEqual([])
    expect(review.excluded[0]!.reason).toBe('checked-out')
  })

  it('says so when the run has nowhere to put a book, rather than passing it', () => {
    // The one way left to reach this check and not be judged by it, and it is
    // about the furniture rather than about the book. It is reported so the
    // count can be said out loud: a book nobody has looked at is not a book
    // that is fine.
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
    // Every judgement is per book, so there is no precondition to violate.
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

import { describe, expect, it } from 'vitest'
import {
  buildPlacement, buildSortKey, compareLocations, filingName, findMisfiles,
  normalise, parseLocation, titleFiling, type Neighbour, type ShelvedBook,
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

describe('findMisfiles', () => {
  const book = (id: number, location: string): ShelvedBook => ({
    id, title: `Book ${id}`, authorFiling: `A${id}`, location, sortKey: String(id),
  })

  it('accepts a shelf whose locations never go backwards', () => {
    expect(findMisfiles([book(1, '1A'), book(2, '1A'), book(3, '1B'), book(4, '2A')]))
      .toHaveLength(0)
  })

  it('catches a book shelved ahead of where it sorts', () => {
    const found = findMisfiles([book(1, '1B'), book(2, '1A')])
    expect(found).toHaveLength(1)
    expect(found[0]!.book.id).toBe(2)
  })

  it('ignores books that have no location yet', () => {
    // Unshelved is not misfiled.
    expect(findMisfiles([book(1, '2A'), book(2, ''), book(3, '2B')])).toHaveLength(0)
  })
})

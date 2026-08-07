import { describe, expect, it } from 'vitest'
import { Author, Credits, PrintedName, nameKey } from './authors'

const alias = (printed: string, filing?: string, isPrimary = false) => ({
  name: PrintedName.of(printed),
  filing: filing ?? PrintedName.of(printed).derivedFiling,
  isPrimary,
})

describe('two spellings of one name', () => {
  it('folds case, punctuation and whitespace together', () => {
    expect(nameKey('J.R.R. Tolkien')).toBe(nameKey('J. R. R. Tolkien'))
    expect(nameKey('ursula k. le guin')).toBe(nameKey('Ursula K. Le Guin'))
    expect(nameKey("Tim O'Brien")).toBe(nameKey('Tim O Brien'))
  })

  it('keeps accents apart, which is the safe direction to be wrong in', () => {
    // An alias too many is merged in a second. An alias too few has already
    // filed two people's books under one name and nothing says which were whose.
    expect(nameKey('Gabriel García Márquez')).not.toBe(nameKey('Gabriel Garcia Marquez'))
  })

  it('does not fold two different names together', () => {
    expect(nameKey('Iain Banks')).not.toBe(nameKey('Iain M. Banks'))
    expect(nameKey('Smith Ann')).not.toBe(nameKey('Smithson A'))
  })
})

describe('a printed name', () => {
  it('refuses what could not be a name', () => {
    expect(PrintedName.parse('')).toBeNull()
    expect(PrintedName.parse('   ')).toBeNull()
    // These all fold to the same empty key, so accepting them would make one
    // alias out of unrelated punctuation.
    expect(PrintedName.parse('---')).toBeNull()
    expect(PrintedName.parse('?!')).toBeNull()
    expect(() => PrintedName.of('')).toThrow(/could be a name/)
  })

  it('keeps what was printed, collapsing only runs of whitespace', () => {
    expect(PrintedName.of('  Ursula   K. Le Guin ').value).toBe('Ursula K. Le Guin')
  })

  it('derives the filing name the shelving code already derives', () => {
    expect(PrintedName.of('Ursula K. Le Guin').derivedFiling).toBe('Le Guin, Ursula K.')
    expect(PrintedName.of('Homer').derivedFiling).toBe('Homer')
    expect(PrintedName.of('National Geographic Society').derivedFiling)
      .toBe('Society, National Geographic')
  })

  it('files a name written in a non-Latin script rather than skipping it', () => {
    // Issue #195: `Store.filingFor` returns '' for these, because it guards its
    // override lookup with `normalise()`, which folds to [A-Z0-9 ] and so folds
    // the whole name away. The book then files ahead of everything in its range.
    // Nothing here reproduces that, and this is the test that says so.
    expect(PrintedName.of('村上春樹').derivedFiling).toBe('村上春樹')
    expect(PrintedName.of('Пушкин Александр').derivedFiling).toBe('Александр, Пушкин')
    expect(nameKey('村上春樹')).not.toBe('')
  })
})

describe('an author', () => {
  it('shows the name marked primary, and the first one when none is', () => {
    expect(Author.of([alias('Iain Banks'), alias('Iain M. Banks', undefined, true)])
      .primary.name.value).toBe('Iain M. Banks')
    expect(Author.of([alias('Iain Banks'), alias('Iain M. Banks')])
      .primary.name.value).toBe('Iain Banks')
  })

  it('is nobody without a name', () => {
    expect(() => Author.of([])).toThrow(/nobody/)
  })

  it('knows every name it publishes under, however spelled', () => {
    const banks = Author.of([alias('Iain M. Banks', undefined, true)])
    expect(banks.publishes(PrintedName.of('iain m banks'))).toBe(true)
    expect(banks.publishes(PrintedName.of('Iain Banks'))).toBe(false)
  })
})

describe('two authors turning out to be one person', () => {
  const banks = Author.of([alias('Iain Banks', 'Banks, Iain', true)])
  const banksM = Author.of([alias('Iain M. Banks', 'Banks, Iain M.', true)])

  it('keeps every alias, with its own printed and filing name', () => {
    // The property that makes merging safe: nothing about how a book files
    // changes, because the books still credit the same aliases.
    const merged = banks.absorbing(banksM)
    expect(merged.aliases.map((one) => [one.name.value, one.filing])).toEqual([
      ['Iain Banks', 'Banks, Iain'],
      ['Iain M. Banks', 'Banks, Iain M.'],
    ])
  })

  it('leaves exactly one primary, the absorbing author\'s', () => {
    const merged = banks.absorbing(banksM)
    expect(merged.aliases.filter((one) => one.isPrimary)).toHaveLength(1)
    expect(merged.primary.name.value).toBe('Iain Banks')
  })

  it('does not add a name both already publish under', () => {
    const merged = banks.absorbing(Author.of([alias('iain banks', 'Banks, Iain', true)]))
    expect(merged.aliases).toHaveLength(1)
  })

  it('stays corporate when either side is, and keeps both notes', () => {
    const society = Author.of([alias('National Geographic Society')], true, 'Files as printed.')
    const natGeo = Author.of([alias('National Geographic')], false, 'Same body.')
    expect(society.absorbing(natGeo).isCorporate).toBe(true)
    expect(society.absorbing(natGeo).note).toBe('Files as printed. Same body.')
    expect(natGeo.absorbing(society).isCorporate).toBe(true)
  })
})

describe('who a book credits', () => {
  it('keeps the printed order, because the first-listed name files the book', () => {
    const credits = Credits.of(['Stephen King', 'Peter Straub'])
    expect(credits.filingName?.value).toBe('Stephen King')
    expect(credits.positioned).toEqual([
      { position: 1, name: PrintedName.of('Stephen King') },
      { position: 2, name: PrintedName.of('Peter Straub') },
    ])
  })

  it('credits a person once however many ways they are spelled', () => {
    const credits = Credits.of(['J. R. R. Tolkien', 'J.R.R. Tolkien', 'Christopher Tolkien'])
    expect(credits.names.map((name) => name.value))
      .toEqual(['J. R. R. Tolkien', 'Christopher Tolkien'])
  })

  it('drops what could not be a name rather than crediting it', () => {
    expect(Credits.of(['', '  ', '---', 'Homer']).names.map((name) => name.value))
      .toEqual(['Homer'])
    expect(Credits.of([]).isEmpty).toBe(true)
    expect(Credits.of(['']).filingName).toBeNull()
  })
})

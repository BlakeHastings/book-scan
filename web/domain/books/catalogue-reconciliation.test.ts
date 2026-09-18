/**
 * The reconciliation rules: which catalogue to believe when two disagree.
 * No network, no MARC, no lookup, tested as a pure decision.
 *
 * Cases below are from docs/catalogue-sources.md, checked against 238 real books.
 */

import { describe, expect, it } from 'vitest'
import {
  normaliseTitle, reconcile, sameBook,
  type SupplementaryRecord,
} from './catalogue-reconciliation'

const LOC = 'Library of Congress'
const K10 = 'K10plus'

function record(over: Partial<SupplementaryRecord> = {}): SupplementaryRecord {
  return {
    source: LOC,
    title: 'Dune',
    pages: null,
    subjects: [],
    dewey: [],
    lc: [],
    ...over,
  }
}

/** Nothing held at all, which is the state that lets a supplement contribute. */
const GAP = { title: 'Dune', pages: '', genreStated: false }

describe('normaliseTitle', () => {
  it('takes the ISBD punctuation MARC carries as data', () => {
    // A MARC 245 subfield carries the punctuation that would introduce the next one.
    expect(normaliseTitle('Dune /')).toBe('dune')
    expect(normaliseTitle('The hobbit, or, There and back again :')).toBe(
      'hobbit or there and back again',
    )
  })

  it('drops a leading article, which two catalogues disagree about constantly', () => {
    expect(normaliseTitle('The Left Hand of Darkness'))
      .toBe(normaliseTitle('Left Hand of Darkness'))
    expect(normaliseTitle('Der Steppenwolf')).toBe('steppenwolf')
  })

  it('does not drop an article that is the whole title', () => {
    // "The" as a one-word title would normalise to nothing and match anything.
    expect(normaliseTitle('The')).toBe('the')
  })

  it('folds accents and the letters that do not decompose', () => {
    expect(normaliseTitle('Les Misérables')).toBe(normaliseTitle('Les Miserables'))
    expect(normaliseTitle('Die Verwandlung: Größe')).toBe('verwandlung grosse')
  })

  it('does not transliterate across scripts', () => {
    // Deliberate: a transliterated match would treat a translation as the same book.
    expect(normaliseTitle('Дюна')).not.toBe(normaliseTitle('Dune'))
  })
})

describe('sameBook', () => {
  it('accepts the same title written two ways', () => {
    expect(sameBook('Dune', 'Dune /')).toBe(true)
    expect(sameBook("L'Étranger", 'L etranger')).toBe(true)
  })

  it('accepts a record that carries a subtitle we do not', () => {
    expect(sameBook(
      'The Hitchhiker\'s Guide to the Galaxy',
      'The hitchhiker\'s guide to the galaxy : a trilogy in four parts',
    )).toBe(true)
  })

  it('refuses a one-word title that is merely a prefix of theirs', () => {
    // Guards against a plain startsWith match: "Dune" is a prefix of "Dune Messiah" but a different book.
    expect(sameBook('Dune', 'Dune Messiah')).toBe(false)
    expect(sameBook('It', 'It happened one night')).toBe(false)
  })

  it('refuses a translation', () => {
    expect(sameBook('Dune', 'Дюна')).toBe(false)
  })

  it('refuses when either side has no title', () => {
    // Nothing can be verified against nothing, so nothing is taken.
    expect(sameBook('', 'Dune')).toBe(false)
    expect(sameBook('Dune', '')).toBe(false)
    expect(sameBook('Dune', '  /  ')).toBe(false)
  })
})

describe('a supplement fills a gap and never overrides', () => {
  it('takes a page count when we hold none', () => {
    const taken = reconcile(GAP, [record({ pages: 535 })])

    expect(taken.pages).toBe('535')
    expect(taken.pagesFrom).toBe(LOC)
    expect(taken.verified).toEqual([LOC])
  })

  it('refuses to touch a page count we already hold', () => {
    // Existing data is never overwritten, even by a match: a different printing's extent looks identical to a mistake.
    const taken = reconcile({ ...GAP, pages: '535' }, [record({ pages: 604 })])

    expect(taken.pages).toBe('')
    expect(taken.pagesFrom).toBe('')
    // Still verified, and still says so. What is refused is taking the number,
    // not looking at the record.
    expect(taken.verified).toEqual([LOC])
  })

  it('refuses to put a heading in front of the classifier when a genre was stated', () => {
    // A flipped genre would send a book to the wrong bookcase.
    const taken = reconcile(
      { ...GAP, genreStated: true },
      [record({ subjects: ['History'], dewey: ['973.7'] })],
    )

    expect(taken.subjects).toEqual([])
    expect(taken.dewey).toEqual([])
    expect(taken.headingsFrom).toEqual([])
  })
})

describe('is it even the same book', () => {
  it('takes nothing from a record whose title disagrees', () => {
    // A page count from the wrong record is worse than no page count at all.
    const taken = reconcile(GAP, [
      record({ source: K10, title: 'Sandworms of Dune', pages: 494, subjects: ['Science fiction'] }),
    ])

    expect(taken.pages).toBe('')
    expect(taken.subjects).toEqual([])
    expect(taken.verified).toEqual([])
    expect(taken.rejected).toEqual([K10])
  })

  it('takes from the one that matches and not from the one that does not', () => {
    const taken = reconcile(GAP, [
      record({ source: LOC, title: 'Sandworms of Dune', pages: 494 }),
      record({ source: K10, title: 'Dune /', pages: 535 }),
    ])

    expect(taken.pages).toBe('535')
    expect(taken.pagesFrom).toBe(K10)
    expect(taken.verified).toEqual([K10])
    expect(taken.rejected).toEqual([LOC])
  })

  it('verifies nothing when we have no title of our own', () => {
    const taken = reconcile({ title: '', pages: '', genreStated: false }, [record({ pages: 535 })])

    expect(taken.pages).toBe('')
    expect(taken.rejected).toEqual([LOC])
  })
})

describe('when two of them disagree', () => {
  it('settles a page count by rank, and says who disagreed', () => {
    // Rank is the order the caller passed. Taking one is better than the
    // collection-wide median a blank page count would fall back to.
    const taken = reconcile(GAP, [
      record({ source: LOC, pages: 535 }),
      record({ source: K10, pages: 604 }),
    ])

    expect(taken.pages).toBe('535')
    expect(taken.pagesFrom).toBe(LOC)
    expect(taken.pagesDisagreedWith).toEqual([K10])
  })

  it('does not report a disagreement when they agree', () => {
    const taken = reconcile(GAP, [
      record({ source: LOC, pages: 535 }),
      record({ source: K10, pages: 535 }),
    ])

    expect(taken.pages).toBe('535')
    expect(taken.pagesDisagreedWith).toEqual([])
  })

  it('falls to the second when the first has nothing to say', () => {
    // A source answering with no extent statement is the ordinary case, not a
    // disagreement, so it does not appear in `pagesDisagreedWith`.
    const taken = reconcile(GAP, [
      record({ source: LOC, pages: null }),
      record({ source: K10, pages: 604 }),
    ])

    expect(taken.pages).toBe('604')
    expect(taken.pagesFrom).toBe(K10)
    expect(taken.pagesDisagreedWith).toEqual([])
  })

  it('merges headings in rank order rather than choosing between them', () => {
    // Genre is not decided here; this only orders headings, best first, for `server/classify.ts`'s ladder to consume.
    const taken = reconcile(GAP, [
      record({ source: LOC, subjects: ['Science fiction'], lc: ['PS3558.E63'] }),
      record({ source: K10, subjects: ['Belletristik'], dewey: ['813.54'] }),
    ])

    expect(taken.subjects).toEqual(['Science fiction', 'Belletristik'])
    expect(taken.dewey).toEqual(['813.54'])
    expect(taken.lc).toEqual(['PS3558.E63'])
    expect(taken.headingsFrom).toEqual([LOC, K10])
  })

  it('does not credit a source that matched and had nothing to add', () => {
    const taken = reconcile(GAP, [
      record({ source: LOC }),
      record({ source: K10, subjects: ['Science fiction'] }),
    ])

    expect(taken.verified).toEqual([LOC, K10])
    expect(taken.headingsFrom).toEqual([K10])
  })
})

describe('nobody answered', () => {
  it('is an ordinary answer rather than an error', () => {
    const taken = reconcile(GAP, [])

    expect(taken).toEqual({
      pages: '', pagesFrom: '', pagesDisagreedWith: [],
      subjects: [], dewey: [], lc: [],
      headingsFrom: [], verified: [], rejected: [],
    })
  })
})

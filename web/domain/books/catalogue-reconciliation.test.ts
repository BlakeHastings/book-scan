/**
 * The reconciliation rules, argued with directly (#305).
 *
 * No network, no MARC, no lookup: this is the part of "what do you believe when
 * two catalogues answer" that is a decision rather than a fetch, so it is tested
 * as one. `server/catalogue-sru.test.ts` covers reading a record and
 * `server/lookup-supplement.test.ts` covers the two ends joined together.
 *
 * The cases below are the ones `docs/catalogue-sources.md` actually met while
 * asking five catalogues about 238 real books, and each names which.
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
    // A 245 subfield is written with the punctuation that would introduce the
    // next one, so this is what a title proper actually arrives as.
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
    // Deliberate. One of the two K10plus mismatches the measurement found was a
    // Russian translation of a book we hold in English, and its page count is
    // not our book's page count.
    expect(normaliseTitle('Дюна')).not.toBe(normaliseTitle('Dune'))
  })
})

describe('sameBook', () => {
  it('accepts the same title written two ways', () => {
    expect(sameBook('Dune', 'Dune /')).toBe(true)
    expect(sameBook("L'Étranger", 'L etranger')).toBe(true)
  })

  it('accepts a record that carries a subtitle we do not', () => {
    // One of the two K10plus title disagreements in the measurement. The record
    // was the right book; it just spelled more of the title.
    expect(sameBook(
      'The Hitchhiker\'s Guide to the Galaxy',
      'The hitchhiker\'s guide to the galaxy : a trilogy in four parts',
    )).toBe(true)
  })

  it('refuses a one-word title that is merely a prefix of theirs', () => {
    /*
     * The guard that makes this more than `startsWith`, and the reason it is
     * worth a missed page count. `Dune` and `Dune Messiah` are two books, and a
     * spine drawn to the wrong one is drawn wrong with nothing reporting it.
     */
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
    /*
     * The rule the whole change rests on. The measurement's case is 33 books
     * that have no page count, not a claim that the 183 that do are wrong, and a
     * rule that could rewrite one of those turns a gain into a risk that nothing
     * would report: a spine drawn to a different printing's extent looks exactly
     * like a spine drawn correctly.
     */
    const taken = reconcile({ ...GAP, pages: '535' }, [record({ pages: 604 })])

    expect(taken.pages).toBe('')
    expect(taken.pagesFrom).toBe('')
    // Still verified, and still says so. What is refused is taking the number,
    // not looking at the record.
    expect(taken.verified).toEqual([LOC])
  })

  it('refuses to put a heading in front of the classifier when a genre was stated', () => {
    // Shelf 4 is the only non-fiction bookcase, so a supplement able to flip a
    // genre is a supplement able to send a book to the wrong room. It cannot.
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
    /*
     * The step the measurement kept and #305 does not mention. The Deutsche
     * Nationalbibliothek answered for 14 of the 238 books and most of those
     * answers were a different book entirely; its apparent gain of nine authors
     * was nine mistakes. A page count off the wrong record is worse than no page
     * count.
     */
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
    /*
     * Rank is the order the caller passed, and `server/catalogue-sru.ts` puts
     * Library of Congress first because the measurement verified 34 of 34 of its
     * records as the right book against 29 of 31 for K10plus.
     *
     * Taking nothing was the other option and it is worse: a book with no page
     * count is drawn at the collection-wide median, which is a guess about every
     * book, where one real edition's extent is right for that edition.
     */
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
    /*
     * The genre is not settled here at all. `server/classify.ts` has a
     * precedence ladder and already answers `unknown` where two confident
     * signals contradict each other, and `docs/catalogue-sources.md` is explicit
     * that a second opinion about what counts as a stated genre must not be
     * written. All this does is put the headings in front of it, best first.
     */
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
    // The normal case, and the reason #305 exists. Four of the nineteen
    // unclassified books are gained by nobody and never will be.
    const taken = reconcile(GAP, [])

    expect(taken).toEqual({
      pages: '', pagesFrom: '', pagesDisagreedWith: [],
      subjects: [], dewey: [], lc: [],
      headingsFrom: [], verified: [], rejected: [],
    })
  })
})

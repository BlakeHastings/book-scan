import { describe, expect, it } from 'vitest'
import { clothFor, pagesOf } from './bookLook'
import { MEDIAN_PAGES, spineWidth } from '../design/Shelf'

describe('how thick the catalogue says a book is', () => {
  it('reads a count somebody stored as a number', () => {
    expect(pagesOf({ pages: '320' })).toBe(320)
  })

  /*
   * A catalogue answers "320 pages" often enough that dropping those would
   * quietly move a chunk of the shelf onto the fallback width.
   */
  it('reads a count out of what a catalogue actually returns', () => {
    expect(pagesOf({ pages: '320 pages' })).toBe(320)
  })

  it('has no answer for a book nobody looked up, which is one in four', () => {
    expect(pagesOf({ pages: '' })).toBeUndefined()
    expect(pagesOf({ pages: 'unknown' })).toBeUndefined()
    expect(pagesOf({})).toBeUndefined()
    expect(pagesOf({ pages: '0' })).toBeUndefined()
  })

  /*
   * The pinned rule, reaching real data. A width comes off the book or it comes
   * off the median of the books that have one, and there is no third answer for
   * a `pages` column holding a word.
   */
  it('draws a book the catalogue cannot answer for at the median', () => {
    expect(spineWidth(pagesOf({ pages: '' }))).toBe(spineWidth(MEDIAN_PAGES))
    expect(spineWidth(pagesOf({ pages: '900' }))).toBeGreaterThan(spineWidth(MEDIAN_PAGES))
  })
})

describe('the binding a book with no photograph is drawn in', () => {
  it('is the same one every time the same book is drawn', () => {
    expect(clothFor(41)).toBe(clothFor(41))
  })

  it('is not the same one for every book', () => {
    expect(new Set([1, 2, 3, 4, 5, 6].map(clothFor)).size).toBeGreaterThan(3)
  })

  it('answers for an id the catalogue could not produce, rather than nothing', () => {
    expect(clothFor(0)).toBeTruthy()
    expect(clothFor(-7)).toBeTruthy()
  })
})

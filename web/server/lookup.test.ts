import { describe, expect, it } from 'vitest'
import { parseSeries } from './lookup'
import { classify } from './classify'

describe('parseSeries', () => {
  it('handles the real Open Library value for Dune', () => {
    // Two designations packed into one field. The first is the primary.
    expect(parseSeries('Dune (1); Dune Chronicles, Book 1'))
      .toEqual({ name: 'Dune', index: 1 })
  })

  it('handles the common separator forms', () => {
    expect(parseSeries('Discworld ; 5')).toEqual({ name: 'Discworld', index: 5 })
    expect(parseSeries('The Wheel of Time #3')).toEqual({ name: 'The Wheel of Time', index: 3 })
    expect(parseSeries('Foundation, Book 2')).toEqual({ name: 'Foundation', index: 2 })
    expect(parseSeries('Earthsea Cycle, Vol. 4')).toEqual({ name: 'Earthsea Cycle', index: 4 })
  })

  it('keeps a bare series name with no number', () => {
    expect(parseSeries('Discworld')).toEqual({ name: 'Discworld', index: null })
  })

  it('does not invent an index from a name ending in a number', () => {
    // "Area 51" is the series name, not series 51. Requiring an explicit
    // separator is what protects this.
    expect(parseSeries('Area 51')).toEqual({ name: 'Area 51', index: null })
  })

  it('handles empty input', () => {
    expect(parseSeries('')).toEqual({ name: '', index: null })
  })
})

describe('classify', () => {
  it('trusts a Google BISAC category above everything else', () => {
    expect(classify({ categories: ['Fiction / Fantasy / Epic'] }))
      .toMatchObject({ isFiction: true, confidence: 'high' })
    expect(classify({ categories: ['Biography & Autobiography / Personal Memoirs'] }))
      .toMatchObject({ isFiction: false, confidence: 'high' })
  })

  it('falls back to Open Library subjects', () => {
    expect(classify({ subjects: ['Science fiction', 'Fiction'] }))
      .toMatchObject({ isFiction: true, confidence: 'medium' })
    expect(classify({ subjects: ['Technology and civilization', 'History'] }))
      .toMatchObject({ isFiction: false, confidence: 'medium' })
  })

  it('refuses to guess when two confident sources disagree', () => {
    const result = classify({
      categories: ['History / Modern'],
      subjects: ['Fiction'],
    })
    expect(result.confidence).toBe('unknown')
    expect(result.reason).toContain('disagree')
  })

  it('returns unknown rather than a silent default when there is no signal', () => {
    // S4 is the only non-fiction shelf, so an unmarked guess would send the
    // book to the wrong bookcase without anyone noticing.
    expect(classify({}).confidence).toBe('unknown')
  })

  it('reads Dewey when the catalogues are quiet', () => {
    expect(classify({ deweyDecimal: ['813.54'] }))
      .toMatchObject({ isFiction: true, confidence: 'medium' })
    expect(classify({ deweyDecimal: ['973.7'] }))
      .toMatchObject({ isFiction: false, confidence: 'medium' })
  })
})

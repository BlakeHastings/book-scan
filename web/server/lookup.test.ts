import { describe, expect, it } from 'vitest'
import { parseSeries } from './lookup'
import { classify } from './classify'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'

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
      .toMatchObject({ genre: FICTION_SLUG, confidence: 'high' })
    expect(classify({ categories: ['Biography & Autobiography / Personal Memoirs'] }))
      .toMatchObject({ genre: NON_FICTION_SLUG, confidence: 'high' })
  })

  it('falls back to Open Library subjects', () => {
    expect(classify({ subjects: ['Science fiction', 'Fiction'] }))
      .toMatchObject({ genre: FICTION_SLUG, confidence: 'medium' })
    expect(classify({ subjects: ['Technology and civilization', 'History'] }))
      .toMatchObject({ genre: NON_FICTION_SLUG, confidence: 'medium' })
  })

  it('refuses to guess when two confident sources disagree', () => {
    const result = classify({
      categories: ['History / Modern'],
      subjects: ['Fiction'],
    })
    expect(result.confidence).toBe('unknown')
    expect(result.reason).toContain('disagree')
  })

  it('states no genre at all when no source stated one', () => {
    /*
     * #304. This rung used to answer `genre/fiction` with the confidence set to
     * `unknown` and a sentence asking the person to fix it, and a save wrote
     * that as a tag whether or not anybody read the sentence. S4 is the only
     * non-fiction shelf, so an unmarked guess sends the book to the wrong
     * bookcase without anybody noticing.
     *
     * Every rung above this one is grounded in something a catalogue said. This
     * one is grounded in nothing, so it says nothing.
     */
    expect(classify({}).genre).toBeNull()
    expect(classify({}).confidence).toBe('unknown')
    // Subjects that are real and say nothing about this question, which is
    // most of what Open Library returns for most books.
    expect(classify({ subjects: ['Paperback', 'Accessible book', 'In library'] }).genre)
      .toBeNull()
  })

  it('still answers a genre wherever a source did state one, confidence and all', () => {
    // The change is about the rung with nothing under it, not about weakening
    // the ladder: an LC class of PZ is a weak signal and it is still a signal.
    expect(classify({ lcClassifications: ['PZ7.R79835'] }))
      .toMatchObject({ genre: FICTION_SLUG, confidence: 'weak' })
  })

  it('reads Dewey when the catalogues are quiet', () => {
    expect(classify({ deweyDecimal: ['813.54'] }))
      .toMatchObject({ genre: FICTION_SLUG, confidence: 'medium' })
    expect(classify({ deweyDecimal: ['973.7'] }))
      .toMatchObject({ genre: NON_FICTION_SLUG, confidence: 'medium' })
  })
})

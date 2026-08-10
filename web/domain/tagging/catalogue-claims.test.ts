/**
 * What a catalogue's answer turns into, before anything is stored.
 *
 * The interesting cases are all about mess: two vocabularies, inconsistent
 * casing, headings that are really paths, and a subject list that can run to
 * hundreds of entries typed by anybody.
 */

import { describe, expect, it } from 'vitest'
import {
  FICTION, FICTION_SLUG, NON_FICTION, NON_FICTION_SLUG, SUBJECT_LIMIT,
  claimsFrom, genreClaim,
} from './catalogue-claims'

const slugs = (claims: { slug: { value: string } }[]) => claims.map((one) => one.slug.value)

describe('the fiction flag as a tag', () => {
  it('is one of two slugs, carrying the confidence it was decided with', () => {
    expect(genreClaim(FICTION_SLUG, 'high')).toEqual({ slug: FICTION, confidence: 'high' })
    expect(genreClaim(NON_FICTION_SLUG, 'weak'))
      .toEqual({ slug: NON_FICTION, confidence: 'weak' })
    expect(FICTION.value).toBe('genre/fiction')
    expect(NON_FICTION.value).toBe('genre/non-fiction')
    // The two strings the wire carries are the two slugs and not a second
    // spelling of them. See the note on FICTION_SLUG.
    expect([FICTION_SLUG, NON_FICTION_SLUG]).toEqual([FICTION.value, NON_FICTION.value])
  })
})

describe('subject headings from a catalogue', () => {
  it('keeps a BISAC heading as the path it already is', () => {
    const claims = claimsFrom({
      genre: FICTION_SLUG,
      confidence: 'high',
      categories: ['Fiction / Fantasy / Epic'],
    })
    expect(slugs(claims)).toEqual(['genre/fiction', 'subject/fiction/fantasy/epic'])
  })

  it('files three spellings of one subject as one tag', () => {
    // The failure this prevents is silent: three rows, and a rule matching one
    // of them claiming a third of the books.
    const claims = claimsFrom({
      genre: FICTION_SLUG,
      confidence: 'high',
      subjects: ['Science Fiction', 'science fiction', 'SCIENCE FICTION'],
    })
    expect(slugs(claims)).toEqual(['genre/fiction', 'subject/science-fiction'])
  })

  it('trusts a publisher heading further than a contributor typed one', () => {
    const claims = claimsFrom({
      genre: FICTION_SLUG,
      confidence: 'high',
      categories: ['Fiction'],
      subjects: ['Dune'],
    })
    expect(claims.map((one) => one.confidence)).toEqual(['high', 'high', 'medium'])
  })

  it('drops a heading with nothing in it rather than filing it under subject', () => {
    // Otherwise every unparseable heading in the catalogue lands on one tag.
    const claims = claimsFrom({ genre: NON_FICTION_SLUG, confidence: 'medium', subjects: ['---', '?'] })
    expect(slugs(claims)).toEqual(['genre/non-fiction'])
  })

  it('stops at a dozen subjects, because a book with two hundred tags has none', () => {
    const many = Array.from({ length: 40 }, (_, at) => `Subject ${at}`)
    const claims = claimsFrom({ genre: FICTION_SLUG, confidence: 'high', subjects: many })
    expect(claims).toHaveLength(SUBJECT_LIMIT + 1)
  })

  it('says only the genre when the catalogue offered no headings', () => {
    expect(slugs(claimsFrom({ genre: FICTION_SLUG, confidence: 'unknown' }))).toEqual(['genre/fiction'])
  })
})

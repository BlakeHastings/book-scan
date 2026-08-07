/**
 * The tag rules, with no database anywhere near them.
 *
 * Two claims are made about this design and both of them are made here, where
 * they can be read in ten seconds:
 *
 * 1. **The slug is the identity**, so every spelling of one idea normalises to
 *    one slug, and hierarchy is a property of the path rather than of a table.
 * 2. **A source may take back its own tags and no others.** Not "does not
 *    usually": the removal list `restatedBy` produces cannot contain another
 *    source's row, because the only rows it looks at are its own.
 */

import { describe, expect, it } from 'vitest'
import { BookTags, TagSlug, slugSegment, type AppliedTag, type TagClaim } from './tags'

const applied = (slug: string, source: AppliedTag['source'], confidence: AppliedTag['confidence'] = 'high'): AppliedTag =>
  ({ slug: TagSlug.of(slug), source, confidence })

const claim = (slug: string, confidence: TagClaim['confidence'] = 'high'): TagClaim =>
  ({ slug: TagSlug.of(slug), confidence })

describe('normalising what somebody wrote into a slug', () => {
  it('folds the spellings a catalogue answers with into one', () => {
    // The failure this prevents: three rows for one idea, and a rule matching
    // one of them claiming a third of the books it should.
    const spellings = ['Fiction', 'fiction', 'FICTION', ' Fiction ', 'Fiction.']
    expect(new Set(spellings.map((one) => TagSlug.of(one).value))).toEqual(new Set(['fiction']))
  })

  it('makes one word out of anything that is not a letter or a digit', () => {
    expect(TagSlug.of('Science Fiction').value).toBe('science-fiction')
    expect(TagSlug.of('sci-fi').value).toBe('sci-fi')
    expect(TagSlug.of('Sci  --  Fi').value).toBe('sci-fi')
  })

  it('files an accented heading beside its unaccented spelling', () => {
    expect(TagSlug.of('Bandes dessinées').value).toBe('bandes-dessinees')
  })

  it('keeps the word an ampersand stands for', () => {
    // Dropping it gives biography-autobiography, which nobody would search for.
    expect(TagSlug.of('Biography & Autobiography').value).toBe('biography-and-autobiography')
  })

  it('is not a slug when there is nothing in it', () => {
    expect(TagSlug.parse('   ')).toBeNull()
    expect(TagSlug.parse('///')).toBeNull()
    expect(TagSlug.parse('?!')).toBeNull()
    expect(() => TagSlug.of('?!')).toThrow(/nothing in it/)
  })

  it('normalises one segment at a time', () => {
    expect(slugSegment('Epic!')).toBe('epic')
  })
})

describe('hierarchy in the slug', () => {
  it('takes a catalogue heading that is already hierarchical as one', () => {
    // BISAC writes it this way, and it is a path rather than a string to flatten.
    expect(TagSlug.of('Fiction / Fantasy / Epic').value).toBe('fiction/fantasy/epic')
  })

  it('answers is and under as different questions', () => {
    const genre = TagSlug.of('genre')
    const fantasy = TagSlug.of('genre/fantasy')

    expect(fantasy.isUnder(genre)).toBe(true)
    expect(genre.isUnder(genre)).toBe(false)
    expect(genre.isAtOrUnder(genre)).toBe(true)
    // A shared prefix that is not a path segment is not a parent, or `genres`
    // would swallow `genre`.
    expect(TagSlug.of('genres/fantasy').isUnder(genre)).toBe(false)
  })

  it('finds a child of a parent nobody ever created', () => {
    // Question 2 on #170: a book may carry genre/fantasy in a vocabulary that
    // has never heard of genre, and `under genre` still finds it.
    const fantasy = TagSlug.of('genre/fantasy')
    expect(fantasy.isUnder(TagSlug.of('genre'))).toBe(true)
    expect(fantasy.ancestors.map(String)).toEqual(['genre'])
    expect(TagSlug.of('a/b/c').ancestors.map(String)).toEqual(['a/b', 'a'])
  })

  it('has no parent at the top', () => {
    expect(TagSlug.of('genre').parent).toBeNull()
  })
})

describe('what a book carries', () => {
  const book = BookTags.of([
    applied('genre/fantasy', 'catalogue'),
    applied('mine/lent-out', 'person'),
    applied('genre/fiction', 'guess', 'medium'),
  ])

  it('knows a tag whoever applied it', () => {
    expect(book.has(TagSlug.of('mine/lent-out'))).toBe(true)
    expect(book.has(TagSlug.of('genre/horror'))).toBe(false)
  })

  it('answers under with everything at or beneath the slug', () => {
    expect(book.at(TagSlug.of('genre')).map((one) => one.slug.value))
      .toEqual(['genre/fantasy', 'genre/fiction'])
  })
})

describe('a source restating what it claims', () => {
  const book = BookTags.of([
    applied('genre/fantasy', 'catalogue'),
    applied('subject/dune', 'catalogue', 'medium'),
    applied('mine/lent-out', 'person'),
  ])

  it('takes back what it no longer claims', () => {
    const { retracted } = book.restatedBy('catalogue', [claim('genre/fantasy')])
    expect(retracted.map((one) => one.slug.value)).toEqual(['subject/dune'])
  })

  it('leaves a person alone, and that is not a filter applied afterwards', () => {
    // The rule the whole design turns on. Whatever the catalogue claims, and
    // however little of it, nothing it produces may name another source's row.
    for (const claims of [[], [claim('genre/horror')], [claim('mine/lent-out')]]) {
      const { retracted, untouched } = book.restatedBy('catalogue', claims)
      expect(retracted.every((one) => one.source === 'catalogue')).toBe(true)
      expect(untouched).toContainEqual(applied('mine/lent-out', 'person'))
    }
  })

  it('claiming nothing retracts everything it said, and nothing anybody else did', () => {
    const { retracted, applied: written } = book.restatedBy('catalogue', [])
    expect(retracted.map((one) => one.slug.value)).toEqual(['genre/fantasy', 'subject/dune'])
    expect(written).toEqual([])
  })

  it('leaves a tag it still claims alone rather than rewriting it', () => {
    // So added_at stays the day the catalogue first said so, not the day a
    // lookup last ran.
    const { retracted, applied: written } = book.restatedBy(
      'catalogue', [claim('genre/fantasy'), claim('subject/dune', 'medium')],
    )
    expect(retracted).toEqual([])
    expect(written).toEqual([])
  })

  it('rewrites one whose confidence has changed', () => {
    const { applied: written } = book.restatedBy('catalogue', [claim('subject/dune', 'high')])
    expect(written.map((one) => one.slug.value)).toEqual(['subject/dune'])
  })

  it('collapses two spellings of one claim', () => {
    const { applied: written } = book.restatedBy('guess', [
      { slug: TagSlug.of('Fiction'), confidence: 'high' },
      { slug: TagSlug.of('FICTION'), confidence: 'weak' },
    ])
    expect(written.map((one) => one.slug.value)).toEqual(['fiction'])
    expect(written[0]?.confidence).toBe('high')
  })

  it('a person restating does not disturb the catalogue', () => {
    // The rule runs both ways: it is about a source owning its own rows, not
    // about people being privileged in the arithmetic.
    const { retracted } = book.restatedBy('person', [])
    expect(retracted.map((one) => one.slug.value)).toEqual(['mine/lent-out'])
  })
})

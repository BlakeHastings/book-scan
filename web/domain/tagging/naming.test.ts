import { describe, expect, it } from 'vitest'
import { NAMED_UNDER, labelTyped, nameIn, nameTag, sameThing } from './naming'
import { FICTION, NON_FICTION, SUBJECT } from './catalogue-claims'
import type { KnownTag } from './naming'

const vocabulary = (...slugs: string[]): KnownTag[] =>
  slugs.map((slug) => ({ slug, label: '' }))

describe('two spellings of one idea', () => {
  // The slug alone folds case and spaces but not the plural; two rows byte-ordered apart would mean one thing twice.
  it('is one key for "Comic Book", "comic books" and "COMIC-BOOKS"', () => {
    expect(sameThing('Comic Book')).toBe('comicbook')
    expect(sameThing('comic books')).toBe('comicbook')
    expect(sameThing('COMIC-BOOKS')).toBe('comicbook')
  })

  it('is one key for the three ways anybody writes non-fiction', () => {
    expect(sameThing('Non-fiction')).toBe('nonfiction')
    expect(sameThing('non fiction')).toBe('nonfiction')
    expect(sameThing('Nonfiction')).toBe('nonfiction')
  })

  // A fold that swallowed these would refuse a tag somebody wants and offer a different one instead, worse than the duplicate it avoids.
  it('keeps apart words that are not the same word', () => {
    expect(sameThing('Comics')).not.toBe(sameThing('Comic book'))
    expect(sameThing('Poetry')).toBe('poetry')
    expect(sameThing('Business')).toBe('business')
    expect(sameThing('History')).toBe(sameThing('Histories'))
  })

  it('is nothing at all for a name with nothing in it', () => {
    expect(sameThing('')).toBe('')
    expect(sameThing('  ')).toBe('')
    expect(sameThing('???')).toBe('')
  })

  // Not the identity, deliberately not stored: storing it would make a second key that has to agree with the slug forever.
  it('is asked of a name rather than of a path', () => {
    expect(nameIn('subject/comic-book')).toBe('comic-book')
    expect(nameIn('genre')).toBe('genre')
  })
})

describe('naming a tag', () => {
  it('offers the tag that exists rather than making a second one', () => {
    const answer = nameTag('comic books', vocabulary('subject/comic-book', 'subject/history'))

    expect(answer.kind).toBe('already')
    expect(answer.kind === 'already' && answer.tags.map((one) => one.slug))
      .toEqual(['subject/comic-book'])
  })

  // Distinguished because a person typing the exact spelling needs no explanation, but one typing a near miss does.
  it('says when what was typed was not how the tag is spelled', () => {
    const vocab = vocabulary('subject/comic-book')

    expect(nameTag('comic books', vocab)).toMatchObject({ nearly: true })
    expect(nameTag('Comic Book', vocab)).toMatchObject({ nearly: false })
  })

  // Across namespaces: a word the collection already keeps means it whichever heading it sits under.
  it('finds what the collection means wherever it is kept', () => {
    const answer = nameTag('Cookery', vocabulary('genre/cookery'))

    expect(answer.kind).toBe('already')
  })

  it('makes a new one only when nothing means it', () => {
    const answer = nameTag('Comic book', vocabulary('subject/history'))

    expect(answer).toEqual({
      kind: 'new',
      slug: 'subject/comic-book',
      label: 'Comic book',
    })
  })

  // A box that happens to say "fiction" is not a person choosing a genre, so it writes nothing and points at where that act lives.
  it('never writes a genre, however the word is spelled', () => {
    for (const typed of ['fiction', 'Fiction', 'FICTION', 'non fiction', 'Non-fiction']) {
      expect(nameTag(typed, []).kind, `"${typed}"`).toBe('genre')
    }
  })

  it('puts every new tag under one namespace, and it is not genre', () => {
    const answer = nameTag('Bought in Hay', [])

    expect(answer.kind).toBe('new')
    expect(answer.kind === 'new' && answer.slug.startsWith(`${SUBJECT.value}/`)).toBe(true)
    expect(NAMED_UNDER.value).toBe(SUBJECT.value)
    expect(answer.kind === 'new' && answer.slug.startsWith('genre/')).toBe(false)
    expect(FICTION.value.startsWith('genre/') && NON_FICTION.value.startsWith('genre/')).toBe(true)
  })

  // A slash is a hyphen here: where a tag sits decides which rules can reach it, not what somebody happened to type.
  it('reads a slash as part of the name rather than as nesting', () => {
    const answer = nameTag('comic/book', [])

    expect(answer).toEqual({
      kind: 'new',
      slug: 'subject/comic-book',
      label: 'Comic/book',
    })
  })

  it('has nothing to say about a name with nothing in it', () => {
    expect(nameTag('', vocabulary('subject/history')).kind).toBe('nothing')
    expect(nameTag('  ', vocabulary('subject/history')).kind).toBe('nothing')
  })
})

describe('the label a new tag carries', () => {
  it('is what was typed, closed up and led with a capital', () => {
    expect(labelTyped('comic  book ')).toBe('Comic book')
  })

  // Theirs, not the app's: lowercasing an initialism would be correcting somebody's own word.
  it('leaves the rest of it alone', () => {
    expect(labelTyped('MTG')).toBe('MTG')
    expect(labelTyped('books by Le Guin')).toBe('Books by Le Guin')
  })
})

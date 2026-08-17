import { describe, expect, it } from 'vitest'
import { NAMED_UNDER, labelTyped, nameIn, nameTag, sameThing } from './naming'
import { FICTION, NON_FICTION, SUBJECT } from './catalogue-claims'
import type { KnownTag } from './naming'

const vocabulary = (...slugs: string[]): KnownTag[] =>
  slugs.map((slug) => ({ slug, label: '' }))

describe('two spellings of one idea', () => {
  /*
   * The owner's own example, and the reason this file exists. The slug folds
   * the case and the space on its own; the plural is what it does not fold, and
   * two rows byte-ordered apart is two tags meaning one thing.
   */
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

  /* Words that only look alike are left alone. A fold that swallowed these
     would refuse a tag somebody genuinely wants and offer them a different
     one, which is worse than the duplicate it was avoiding. */
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

  /* The identity is the slug and this is not it. Said as a test because the
     tempting next change is to store this, and storing it makes it a second
     key that has to agree with the first one for ever. */
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

  /* The near miss is told apart from the plain one, because a person typing a
     word they already keep needs no explanation and a person being refused a
     second spelling of it does. */
  it('says when what was typed was not how the tag is spelled', () => {
    const vocab = vocabulary('subject/comic-book')

    expect(nameTag('comic books', vocab)).toMatchObject({ nearly: true })
    expect(nameTag('Comic Book', vocab)).toMatchObject({ nearly: false })
  })

  /* Across namespaces, because a collection that already keeps the word means
     it whichever heading it sits under. Two of them under two headings is the
     same defect wearing a different coat. */
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

  /* #304. The app states a genre only when a source did, and a person choosing
     one is a different act with two options of its own. A box that happens to
     say "fiction" is not that act, so it writes nothing and says where the act
     lives instead. */
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

  /* A slash is a hyphen here. Where a tag sits decides which rules can reach
     it, and a free-text box is not where that gets decided by accident. */
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

  /* Theirs rather than the app's: a label is the half of a tag a person reads,
     and lowercasing an initialism to match a house style would be the app
     correcting somebody's own word. */
  it('leaves the rest of it alone', () => {
    expect(labelTyped('MTG')).toBe('MTG')
    expect(labelTyped('books by Le Guin')).toBe('Books by Le Guin')
  })
})

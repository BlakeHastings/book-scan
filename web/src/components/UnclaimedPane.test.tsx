/** Rendered as markup: this project has no DOM in its test setup, and this screen holds no state. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { UnclaimedPane } from './UnclaimedPane'
import type { UnclaimedBook } from '../lib/api'

const tabs = { home: () => {}, library: () => {}, scan: () => {}, queue: () => {} }

/** The words on the screen, with the markup and the class names gone. */
const words = (markup: string) => markup.replace(/<[^>]*>/g, ' ')

const untagged = (id: number, title: string, place: string | null = '1B'): UnclaimedBook => ({
  id,
  title,
  authorFiling: `Author ${id}`,
  standing: place === null ? null : { areaId: id, label: place },
  tags: [],
  why: 'untagged',
})

const unmatched = (id: number, title: string, ...tags: string[]): UnclaimedBook => ({
  id,
  title,
  authorFiling: `Author ${id}`,
  standing: { areaId: id, label: '1C' },
  tags,
  why: 'unmatched',
})

function drawn(over: Partial<Parameters<typeof UnclaimedPane>[0]> = {}): string {
  const books = over.books === undefined ? [untagged(1, 'The Peregrine')] : over.books
  return renderToStaticMarkup(UnclaimedPane({
    books,
    total: books?.length ?? 0,
    error: '',
    settled: null,
    tabs,
    onBack: () => {},
    onSay: () => {},
    onClaimed: () => {},
    onFurniture: () => {},
    ...over,
  }) as ReactElement)
}

describe('the books no rule claims', () => {
  it('draws the two states as two blocks with a sentence each', () => {
    const said = words(drawn({
      books: [
        untagged(1, 'The Peregrine'),
        untagged(2, 'Wildwood'),
        unmatched(3, 'The Big Sleep', 'Crime'),
        unmatched(4, 'The Long Goodbye', 'Crime'),
      ],
      total: 4,
    }))

    expect(said).toContain('Nobody has said what they are')
    expect(said).toContain('Nothing asks for what they carry')
    expect(said.match(/Two books/g) ?? []).toHaveLength(2)
  })

  it('counts a block of one as one, which is what the last of them looks like', () => {
    const said = words(drawn({
      books: [untagged(1, 'The Peregrine'), unmatched(3, 'The Big Sleep', 'Crime')],
      total: 2,
    }))

    expect(said).toContain('Nobody has said what it is')
    expect(said).toContain('Nothing asks for what it carries')
    expect(said).not.toContain('what they are')
  })

  it('says where a book with no tag stands, because that is how you reach it', () => {
    expect(drawn({ books: [untagged(1, 'The Peregrine', '4A')], total: 1 }))
      .toContain('4A')
  })

  it('says the tag rather than the place on a book carrying one', () => {
    const html = drawn({ books: [unmatched(3, 'The Big Sleep', 'Crime')], total: 1 })

    expect(words(html)).toContain('Crime')
    expect(html, 'the second block draws where the book stands').not.toContain('1C')
  })

  it('leaves the place off a book nobody has ever said anything about', () => {
    const html = drawn({ books: [untagged(1, 'The Peregrine', null)], total: 1 })

    expect(words(html)).toContain('The Peregrine')
    expect(html).not.toContain('wf-row__place')
  })

  it('says once that saying what a book is does not move it', () => {
    const said = words(drawn())

    expect(said).toContain('Nothing here moves a book')
    expect(said).toContain('it joins your carry list')
  })

  // Checked as the absence of any preselected answer, not as a list of
  // forbidden buttons, since a future helpful default is exactly the
  // regression this guards against.
  it('chooses nothing for anybody, and files nothing', () => {
    const html = drawn({
      books: [untagged(1, 'The Peregrine'), unmatched(3, 'The Big Sleep', 'Crime')],
      total: 2,
    })

    // Excludes the tab bar's own `--on`, which is unrelated, by naming the
    // three control kinds explicitly rather than matching the suffix alone.
    expect(html, 'an answer on this screen is preselected').not.toMatch(
      /wf-(choice__opt|seg__opt|tag)--on|aria-pressed="true"/,
    )
    expect(words(html), 'this screen offers to file books itself')
      .not.toMatch(/file (them|these|the rest|everything)/i)
    expect(words(html)).not.toMatch(/non-fiction/i)
  })

  it('writes nothing itself, and offers no box to write in', () => {
    const html = drawn({
      books: [untagged(1, 'The Peregrine'), unmatched(3, 'The Big Sleep', 'Crime')],
      total: 2,
    })

    expect(html).not.toContain('wf-name')
    expect(html).not.toContain('wf-field')
  })

  it('says no word out of the model', () => {
    const said = words(drawn({
      books: [untagged(1, 'The Peregrine'), unmatched(3, 'The Big Sleep', 'Crime')],
      total: 2,
    }))

    for (const word of [
      'run', 'range', 'shelf', 'plank', 'separator', 'capture', 'placement', 'cut',
    ]) {
      expect(said, `the screen says "${word}"`).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'))
    }
  })
})

describe('the numbers a drawing of twelve never sees', () => {
  it('says nothing at all until the read has answered', () => {
    const html = drawn({ books: null, total: 0 })

    expect(words(html)).not.toContain('Every book is claimed')
    expect(html, 'the top bar counted books nobody has counted yet').not.toContain('wf-top__sub')
    expect(html, 'the frame went with it').toContain('wf-tab')
  })

  it('draws the day there is nothing to do as a day with nothing to do', () => {
    const said = words(drawn({ books: [], total: 0 }))

    expect(said).toContain('Every book is claimed')
    expect(said).toContain('Every book has a rule that wants it')
    expect(said).not.toContain('Nobody has said what they are')
  })

  it('counts one book as one book rather than as these one', () => {
    const said = words(drawn({ books: [untagged(1, 'The Peregrine')], total: 1 }))

    expect(said).toContain('No rule asks for this book, so nothing will ever move it')
    expect(said).toContain('Say what The Peregrine is')
  })

  it('offers the first of a dozen rather than naming it', () => {
    const many = Array.from({ length: 12 }, (_, at) => untagged(at + 1, `Book ${at + 1}`))
    const said = words(drawn({ books: many, total: 12 }))

    expect(said).toContain('No rule asks for these twelve')
    expect(said).toContain('Say what the first one is')
  })

  it('says so when the page is short of the count above it', () => {
    const said = words(drawn({
      books: [untagged(1, 'The Peregrine'), untagged(2, 'Wildwood')],
      total: 500,
    }))

    expect(said).toContain('Two of 500')
    expect(said).toContain('as soon as these are settled')
  })

  it('says nothing of the sort when the page is the whole of it', () => {
    expect(words(drawn())).not.toContain('Not all of them at once')
  })
})

describe('what saying a word did', () => {
  it('says a rule has the book when one took it', () => {
    const said = words(drawn({
      books: [untagged(2, 'Wildwood')],
      total: 1,
      settled: { title: 'The Peregrine', claimed: true, tags: ['Non-fiction'] },
    }))

    expect(said).toContain('The Peregrine is filed now, and a rule wants it')
    expect(said).toContain('it is on your carry list')
  })

  it('says the word was written down and did not file it, when it did not', () => {
    const said = words(drawn({
      books: [unmatched(1, 'The Big Sleep', 'Crime')],
      total: 1,
      settled: { title: 'The Big Sleep', claimed: false, tags: ['Crime'] },
    }))

    expect(said).toContain('The Big Sleep is under Crime')
    expect(said).toContain('No rule asks for that yet, so it is still here')
  })

  it('says nothing at all about a book somebody looked at and left', () => {
    const said = words(drawn({
      books: [untagged(1, 'The Peregrine')],
      total: 1,
      settled: { title: 'The Peregrine', claimed: false, tags: [] },
    }))

    expect(said).not.toContain('The Peregrine is under')
    expect(said).not.toContain('is filed now')
  })

  it('keeps saying it on the screen the last one empties', () => {
    const said = words(drawn({
      books: [],
      total: 0,
      settled: { title: 'The Peregrine', claimed: true, tags: ['Non-fiction'] },
    }))

    expect(said).toContain('The Peregrine is filed now')
    expect(said).toContain('Every book has a rule that wants it')
  })
})

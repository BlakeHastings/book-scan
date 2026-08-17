/**
 * The screen that answers "which books does no rule claim", held to what it
 * says rather than only looked at.
 *
 * Rendered as markup the way `ClaimedPane.test.tsx` does it: this project has
 * no DOM in its test setup and this screen holds no state.
 *
 * Four things here are the ones that come back wrong.
 *
 * **The two states told apart.** A book with no tag at all and a book carrying
 * a tag no rule asks for are both unclaimed and their remedies are different,
 * which is why the read says which and why the screen draws two blocks. One
 * list of identical rows is the obvious tidy-up and it offers one remedy for
 * two problems.
 *
 * **Nothing writes a tag by itself.** #304 stopped this app stating a genre
 * nobody stated, on the owner's explicit instruction, and the way that comes
 * back is a helpful default: a preselected answer, or a button that files the
 * lot as non-fiction. There is no such thing on this screen and there must not
 * be one.
 *
 * **None of it, and one of it.** A drawing of twelve never sees either, and the
 * empty state is the one this whole flow is trying to reach.
 *
 * **The word about a book that did not help.** Saying a book is Crime in a room
 * with no rule about Crime leaves the book exactly where it was, and a screen
 * that said nothing would read as the press having failed.
 */

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
    // A count on each, so neither block is only a paragraph about the other.
    expect(said.match(/Two books/g) ?? []).toHaveLength(2)
  })

  it('counts a block of one as one, which is what the last of them looks like', () => {
    // "Nobody has said what they are" over "One book" is the screen not
    // reading its own count, and it was drawn that way until it was looked at
    // on a collection with one left.
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
    // The one difference between the two lists, and it is the decision rather
    // than the drawing: what somebody is deciding in the second block is
    // whether Crime should have a rule, and where the book happens to stand
    // does not help them answer that.
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

  /*
   * #304, which is the thing this whole screen is not allowed to undo. There is
   * no answer preselected anywhere, no button that files anything, and nothing
   * that would write a tag without somebody choosing a word. Checked as the
   * absence of a chosen answer rather than as a list of forbidden buttons,
   * because the next helpful default is the one this is really for.
   */
  it('chooses nothing for anybody, and files nothing', () => {
    const html = drawn({
      books: [untagged(1, 'The Peregrine'), unmatched(3, 'The Big Sleep', 'Crime')],
      total: 2,
    })

    /* Every way this system marks an answer as chosen: a choice, a segmented
       control, a lit tag, and the state any of them announces. The tab bar's
       own `--on` is not one of those, which is why this names the three rather
       than looking for the suffix. */
    expect(html, 'an answer on this screen is preselected').not.toMatch(
      /wf-(choice__opt|seg__opt|tag)--on|aria-pressed="true"/,
    )
    expect(words(html), 'this screen offers to file books itself')
      .not.toMatch(/file (them|these|the rest|everything)/i)
    expect(words(html)).not.toMatch(/non-fiction/i)
  })

  it('writes nothing itself, and offers no box to write in', () => {
    // Saying what a book is happens on its own screen, which is the drawing and
    // is what keeps this one a list. A panel opened from here would be a second
    // place a tag can be applied from.
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
    // "Every book is claimed" is the one sentence this screen must never say
    // wrongly, and an empty list drawn from a request in flight says it for as
    // long as the read takes.
    const html = drawn({ books: null, total: 0 })

    expect(words(html)).not.toContain('Every book is claimed')
    expect(words(html)).not.toContain('Nothing files these these')
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
    // A room whose rules have nearly all been switched off. A screen listing
    // two under a heading that says five hundred is a screen lying about how
    // much work is left.
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
    // The failure this line exists for: applying Crime in a room with no rule
    // about Crime leaves the book exactly where it was and on this list, which
    // without a sentence reads as the press having done nothing at all.
    const said = words(drawn({
      books: [unmatched(1, 'The Big Sleep', 'Crime')],
      total: 1,
      settled: { title: 'The Big Sleep', claimed: false, tags: ['Crime'] },
    }))

    expect(said).toContain('The Big Sleep is under Crime')
    expect(said).toContain('No rule asks for that yet, so it is still here')
  })

  it('says nothing at all about a book somebody looked at and left', () => {
    // Walking in, looking and walking out is the ordinary thing to do here, and
    // a line reporting it is the app narrating somebody's own inaction at them.
    const said = words(drawn({
      books: [untagged(1, 'The Peregrine')],
      total: 1,
      settled: { title: 'The Peregrine', claimed: false, tags: [] },
    }))

    expect(said).not.toContain('The Peregrine is under')
    expect(said).not.toContain('is filed now')
  })

  it('keeps saying it on the screen the last one empties', () => {
    // Somebody who has just settled the last book is standing here. A screen
    // that went blank would throw away the answer they were working for.
    const said = words(drawn({
      books: [],
      total: 0,
      settled: { title: 'The Peregrine', claimed: true, tags: ['Non-fiction'] },
    }))

    expect(said).toContain('The Peregrine is filed now')
    expect(said).toContain('Every book has a rule that wants it')
  })
})

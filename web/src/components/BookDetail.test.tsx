/**
 * Rendered to static markup rather than into a DOM: this project has no
 * browser environment in its test setup. `Amiss`, out of the design system,
 * holds no state, so it is callable as the plain function it is.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { BookDetail } from './BookDetail'
import { Amiss } from '../design/Book'
import { emptyDraft, type Misfile } from '../lib/api'

const misfile: Misfile = {
  book: {
    id: 7,
    title: 'Dune',
    authorFiling: 'Herbert, Frank',
    authors: 'Frank Herbert',
    location: 'A1',
    areaId: 11,
    derivedLocation: 'B2',
    derivedAreaId: 22,
    standing: { fixture: 1, plank: 0 },
    sortKey: 'herbert frank dune',
    checkedOut: false,
  },
  from: 'A1',
  to: 'B2',
  toAreaId: 22,
  instruction: 'Move Dune from A1 to B2',
  sharedNumber: null,
}

/** A catalogued book, opened to look at rather than to correct. */
function detail(overrides: Partial<Parameters<typeof BookDetail>[0]> = {}) {
  return renderToStaticMarkup(
    <BookDetail
      draft={{ ...emptyDraft, title: 'Dune', authors: 'Frank Herbert' }}
      lookup={null}
      photos={{}}
      derivedFiling="Herbert, Frank"
      saving={false}
      relookupBusy={false}
      relookupError=""
      saved
      onChange={() => {}}
      onRelookup={() => {}}
      onClearRelookupError={() => {}}
      onShelve={() => {}}
      onSaveEdits={async () => true}
      onDiscard={() => {}}
      {...overrides}
    />,
  )
}

/** The words on the screen, with the markup and therefore the classes gone. */
const words = (markup: string) => markup.replace(/<[^>]*>/g, ' ')

describe('BookDetail, for a book the shelving review has flagged', () => {
  it('says it is supposed to be moved, in one sentence', () => {
    const html = detail({ misfile })

    expect(html).toContain('wf-amiss')
    expect(words(html)).toContain('This book is supposed to be moved.')
  })

  it('names neither the place it was nor the place it is going', () => {
    const said = words(detail({ misfile }))

    expect(said).not.toContain('A1')
    expect(said).not.toContain('B2')
    expect(said).not.toMatch(/last seen/i)
    expect(said).not.toMatch(/needs attention/i)
  })

  it('offers no answer of its own, because pressing it is the answer', () => {
    const said = words(detail({ misfile })).toLowerCase()

    expect(said).not.toContain('moved it')
    expect(said).not.toContain('undo the move')
  })

  it('offers no way to dismiss the flag without moving the book', () => {
    const html = detail({ misfile }).toLowerCase()

    expect(html).not.toContain('dismiss')
    expect(html).not.toContain('ignore')
    expect(html).not.toContain('clear flag')
  })
})

describe('BookDetail, for a book that is where it belongs', () => {
  it('adds nothing at all, not even an all-clear', () => {
    const html = detail()

    expect(html).not.toContain('wf-amiss')
    expect(words(html)).not.toContain('supposed to be moved')
  })

  it('stays quiet while the review is still being fetched', () => {
    expect(detail({ misfile: null })).not.toContain('wf-amiss')
  })
})

/** Walks the unrendered element tree for any prop named `onClick`, since the claim is that a tap reaches the caller's handler rather than that a particular element drew it. */
function pressesIn(node: unknown, found: Array<() => void> = []): Array<() => void> {
  if (Array.isArray(node)) {
    for (const one of node) pressesIn(one, found)
    return found
  }
  if (!node || typeof node !== 'object') return found

  const element = node as ReactElement & { props: Record<string, unknown> }
  const props = element.props ?? {}
  if (typeof props.onClick === 'function') found.push(props.onClick as () => void)
  for (const value of Object.values(props)) pressesIn(value, found)
  return found
}

describe('the notice is the door', () => {
  it('takes one press, and it is the whole notice', () => {
    let opened = 0
    const presses = pressesIn(Amiss({ onPress: () => { opened += 1 } }))

    expect(presses).toHaveLength(1)
    presses[0]!()
    expect(opened).toBe(1)
  })

  it('is drawn once, in the words the design system settles', () => {
    const html = detail({ misfile })

    expect(html.match(/class="wf-amiss"/g) ?? []).toHaveLength(1)
    expect(words(html)).toContain(
      words(renderToStaticMarkup(<Amiss />)).trim(),
    )
  })
})

describe('deleting a book', () => {
  it('offers the button with nothing written over it', () => {
    const said = words(detail({ onDelete: () => {} }))

    expect(said).toContain('Delete this book and its photos')
    expect(said).not.toMatch(/off disk/i)
    expect(said).not.toMatch(/put them back/i)
    expect(said).not.toMatch(/nothing here can/i)
  })

  it('draws nothing about deleting where there is no way to', () => {
    expect(words(detail())).not.toContain('Delete this book and its photos')
  })
})

describe('the tags on the form that corrects a record', () => {
  const form = (overrides: Partial<Parameters<typeof BookDetail>[0]> = {}) =>
    detail({ saved: false, ...overrides })

  it('draws what a person has already said, beside the two genres', () => {
    const said = words(form({
      tags: [{ slug: 'subject/gardening', label: 'Gardening', source: 'person' as const, confidence: 'high' }],
      onAddTag: () => {},
      onRemoveTag: () => {},
    }))

    expect(said).toContain('Fiction')
    expect(said).toContain('Non-fiction')
    expect(said).toContain('Gardening')
  })

  it('offers a way to say another one', () => {
    expect(words(form({ onAddTag: () => {} }))).toContain('Add a tag')
  })

  it('offers nothing where there is nowhere to write one', () => {
    expect(words(form())).not.toContain('Add a tag')
  })

  it('does not repeat a genre the buttons beside it already answer', () => {
    const said = words(form({
      tags: [{ slug: 'genre/fiction', label: 'Fiction', source: 'person' as const, confidence: 'high' }],
      onAddTag: () => {},
    }))

    // Once: the button. "Non-fiction" is a lower-case f and is not this word.
    expect(said.match(/Fiction/g) ?? []).toHaveLength(1)
  })

  it('never draws the slug', () => {
    const said = words(form({
      tags: [{ slug: 'subject/gardening', label: 'Gardening', source: 'person' as const, confidence: 'high' }],
      onAddTag: () => {},
    }))

    expect(said).not.toContain('subject/gardening')
  })
})

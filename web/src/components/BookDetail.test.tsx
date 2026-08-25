/**
 * What the screen for a book the catalogue already holds says about a book
 * that is not where it belongs, and what it stopped saying about deleting one.
 *
 * Rendered to static markup rather than into a DOM: this project has no
 * browser environment in its test setup, and everything asserted here is what
 * the page says on arrival, which server rendering produces exactly. The one
 * thing that needs a tap is the notice, and that is `Amiss` out of the design
 * system, which holds no state and so is callable as the plain function it is.
 *
 * ## What round ten changed about these claims, said out loud
 *
 * Three of the claims this file used to make are gone on purpose and are not
 * weakened versions of themselves:
 *
 * - **that the notice names both places.** It named where the book was last
 *   seen and where the order now wants it, and it does not any more (#409).
 *   The reverse is asserted below, because a location report growing back is
 *   exactly how this comes undone.
 * - **that a location can be written from here.** "Moved it" wrote one from
 *   whatever screen a person happened to be looking at. The write now happens
 *   on the screen that places a book, when somebody standing at the bookcase
 *   says it fits.
 * - **that a move can be taken back from here.** Both of those answers are
 *   still offered on the library's list of books needing attention, and
 *   `ShelfView.test.tsx` pins every one of them there, including the two kinds
 *   of entry #196 is about.
 *
 * The tests about what the photographs read moved with the block that drew
 * them, to `CaptureReview.test.tsx`, which is the screen that still shows it.
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

  /*
   * The pinned rule is that a book screen is about the book rather than about
   * where it sits, and this notice survives it by being a call to action
   * rather than a location report. Both places are still on the screen: the
   * board draws the row with the gap in it, and the step this opens names the
   * plank. Reciting them here is how the paragraph comes back.
   */
  it('names neither the place it was nor the place it is going', () => {
    const said = words(detail({ misfile }))

    expect(said).not.toContain('A1')
    expect(said).not.toContain('B2')
    expect(said).not.toMatch(/last seen/i)
    expect(said).not.toMatch(/needs attention/i)
  })

  /*
   * The whole of the notice is one target and there is nothing inside it to
   * aim at. "Moved it" was a claim about the room typed from an armchair; what
   * this offers instead is the walk.
   */
  it('offers no answer of its own, because pressing it is the answer', () => {
    const said = words(detail({ misfile })).toLowerCase()

    expect(said).not.toContain('moved it')
    expect(said).not.toContain('undo the move')
  })

  /*
   * Anything that reads as "make this warning go away" invites writing a
   * location nobody has been to, which destroys the only record of where the
   * book actually is, so no such wording is offered next to it.
   */
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

/**
 * Find the one press in an unrendered element tree.
 *
 * `Amiss` holds no state, so it is callable as the plain function it is, and
 * what comes back is one button with the whole notice inside it. The claim is
 * that the tap reaches the caller's handler rather than that a particular
 * element drew it, so this looks for the element carrying an `onClick` and
 * says how many it found: two would mean something inside the notice had
 * become a target of its own, which is the thing #409 took off it.
 */
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

  /*
   * One notice on the page and one sentence in it, and the sentence is the
   * design system's rather than one this screen writes. Where the drawing and
   * the app say the same thing in two places they are two things that agree
   * until one of them is edited; that is why `Amiss` takes no words.
   *
   * What it opens is checked where it can be: the browser suite presses it and
   * lands on the step that places a book, which is the claim #409 is about.
   */
  it('is drawn once, in the words the design system settles', () => {
    const html = detail({ misfile })

    expect(html.match(/class="wf-amiss"/g) ?? []).toHaveLength(1)
    expect(words(html)).toContain(
      words(renderToStaticMarkup(<Amiss />)).trim(),
    )
  })
})

describe('deleting a book', () => {
  /*
   * > At the bottom of the detail view as well: we don't want to explain to
   * > them that deleting takes the record and its photographs off disk and
   * > nothing here could put them back. We don't need to put that text there.
   *
   * The button stays and the sentence over it goes. What that sentence said is
   * word for word in the dialog the button opens, which is where a warning
   * belongs: at the moment of the act rather than permanently on the page. The
   * dialog itself is driven in the browser suite, because opening it is a tap.
   */
  it('offers the button with nothing written over it', () => {
    const said = words(detail({ onDelete: () => {} }))

    expect(said).toContain('Delete this book and its photos')
    expect(said).not.toMatch(/off disk/i)
    expect(said).not.toMatch(/put them back/i)
    expect(said).not.toMatch(/nothing here can/i)
  })

  /* The button is drawn from the way out being there rather than from the
     screen deciding a book may be deleted, which is the shape it has always
     had: `onDelete` is present only for a book already on the shelves. */
  it('draws nothing about deleting where there is no way to', () => {
    expect(words(detail())).not.toContain('Delete this book and its photos')
  })
})

/**
 * Saying what a book already on a shelf is (#433).
 *
 * The queue's check-the-details screen has had "Add a tag" since #377 and a
 * rule has been able to name a tag nothing carries yet since #400. This is the
 * third door and it was missing, so the only thing anybody could say about a
 * book they already owned was which of two genres it was.
 *
 * The form is what these assert, because a catalogued book opens as a record
 * and the fields are behind the pencil. `detail({ saved: false })` opens on the
 * form, which is what a book fresh off the camera does.
 */
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

  /* Drawn from there being somewhere to write one rather than from the screen
     deciding a book may be tagged, which is the shape `onDelete` already has.
     A tag is written the moment it is said, so a screen with nothing to write
     to must not offer the press. */
  it('offers nothing where there is nowhere to write one', () => {
    expect(words(form())).not.toContain('Add a tag')
  })

  /* The slug is the identity and the label is what a person reads, which is a
     pinned rule and the reason this row draws labels. */
  it('never draws the slug', () => {
    const said = words(form({
      tags: [{ slug: 'subject/gardening', label: 'Gardening', source: 'person' as const, confidence: 'high' }],
      onAddTag: () => {},
    }))

    expect(said).not.toContain('subject/gardening')
  })
})

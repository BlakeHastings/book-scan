/**
 * What the move and plan screens tell somebody standing in front of a bookcase.
 *
 * The failure this guards against is the plan being read and believed: 50 books
 * carried, three pinned ones silently left behind, and no way to tell from the
 * screen that anything was omitted. So the counts are held to the reasons, and
 * every book the rules will not touch is held to a name.
 *
 * The design rules the gallery pins reach here too, and the ones this screen can
 * break are checked: no word out of the model on screen, the four places in the
 * tab bar, and no arrow between two areas.
 *
 * Rendered as markup rather than driven in a browser, the same way
 * `CarryPane.test.tsx` does it. The pane holds no state, which is what makes
 * that possible and is why it is split out of the screen at all.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { MoveRunPane } from './MoveRunPane'
import { destinationsFor } from '../screens/ArrangeScreen'
import type { PlannedBook, RunMovePlan } from '../lib/api'

const book = (id: number): PlannedBook =>
  ({ id, title: `Title ${id}`, authorFiling: `Author, ${id}` })

const books = (from: number, count: number) =>
  Array.from({ length: count }, (_, at) => book(from + at))

const plan = (over: Partial<RunMovePlan> = {}): RunMovePlan => ({
  from: 4,
  to: 3,
  planks: [{ from: '4A', to: '3A' }, { from: '4B', to: '3B' }, { from: '4C', to: '3C' }],
  groups: [
    { from: '4A', to: '3A', books: books(1, 8) },
    { from: '4B', to: '3B', books: books(9, 20) },
    { from: '4C', to: '3C', books: books(29, 22) },
  ],
  moving: 50,
  staying: 0,
  skipped: [],
  unclaimed: [],
  ...over,
})

const drawn = (over: Partial<Parameters<typeof MoveRunPane>[0]> = {}): string =>
  renderToStaticMarkup(MoveRunPane({
    named: 'non-fiction',
    livesOn: 4,
    areas: [
      { label: '4A', books: 8 },
      { label: '4B', books: 20 },
      { label: '4C', books: 22 },
    ],
    destinations: [
      { number: 3, said: 'Nothing on it yet' },
      { number: 4, said: 'Where it lives now' },
      { number: 5, said: 'A bookcase you do not have yet' },
    ],
    bookcase: 3,
    plan: null,
    waiting: null,
    applied: null,
    busy: false,
    error: '',
    tabs: { home: () => {}, library: () => {}, scan: () => {}, queue: () => {} },
    onBookcase: () => {},
    onBack: () => {},
    onPlan: () => {},
    onUnplan: () => {},
    onApply: () => {},
    onCarry: () => {},
    ...over,
  }) as ReactElement)

/**
 * The words on the screen, with the markup and the class names gone.
 *
 * The spaces are collapsed, because a tag becomes a space and two labels with
 * an element each around them would otherwise have to be asserted with the
 * gaps between the elements counted.
 */
const words = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

const planned = (over: Partial<RunMovePlan> = {}) => drawn({ plan: plan(over) })

describe('choosing where a stretch of books should live', () => {
  it('says where they are now, and what they are cut into', () => {
    const html = words(drawn())

    expect(html).toContain('Bookcase 4')
    expect(html).toContain('Three areas: 4A with 8 books, 4B with 20 books, 4C with 22 books')
  })

  it('offers the bookcases it can go to, and says what each one means', () => {
    const html = drawn()

    expect(html.match(/class="wf-choice__opt/g) ?? []).toHaveLength(3)
    expect(words(html)).toContain('Where it lives now')
    expect(words(html)).toContain('A bookcase you do not have yet')
  })

  it('says there is nothing to move rather than drawing an empty picker', () => {
    const html = drawn({ areas: [] })

    expect(words(html)).toContain('Nothing is filed under non-fiction yet')
    expect(html).not.toContain('wf-choice__opt')
  })
})

describe('the plan for moving a stretch of books', () => {
  it('leads with the number of books to carry, not with fifty lines', () => {
    const html = words(planned())

    expect(html).toContain('50 books to carry')
    expect(html).toContain('Bookcase 4 to bookcase 3')
  })

  it('groups by the two areas each move names, with the count on the line', () => {
    const html = words(planned())

    expect(html).toContain('4A to 3A · 8 books')
    expect(html).toContain('4B to 3B · 20 books')
    expect(html).toContain('4C to 3C · 22 books')
  })

  /*
   * Every arrow in Unicode lives in the block the design system refuses
   * outright, and the two ends of a move are two labels and the word "to". The
   * screen this replaced drew "4A -> 3A" with the glyph.
   */
  it('says "to" between two areas rather than drawing an arrow', () => {
    expect(planned()).not.toMatch(/[\u{2190}-\u{2BFF}]/u)
  })

  it('says how many books it left alone and why, in words', () => {
    const html = words(planned({
      moving: 46,
      skipped: [
        { reason: 'pinned', books: books(1, 3) },
        { reason: 'checked-out', books: books(90, 1) },
      ],
    }))

    expect(html).toContain('Four books')
    expect(html).toContain('Three you pinned.')
    expect(html).toContain('One checked out.')
  })

  /*
   * The count and the names are one claim. A card that said four over a list of
   * three would be the omission the reasons exist to prevent, and a pinned book
   * is the one somebody has to be able to find by name: they decided it stays,
   * and the plan is where they find out it did.
   */
  it('names every book it is leaving alone, with the reason beside it', () => {
    const html = planned({
      skipped: [
        { reason: 'pinned', books: books(1, 2) },
        { reason: 'checked-out', books: [book(90)] },
      ],
    })

    expect(html.match(/class="wf-row"/g) ?? []).toHaveLength(3)
    expect(words(html)).toContain('Title 1')
    expect(words(html)).toContain('Author, 1')
    expect(words(html)).toContain('Pinned')
    expect(words(html)).toContain('Checked out')
  })

  it('names the books no rule claims rather than counting them as staying put', () => {
    const html = words(planned({ unclaimed: [book(77)] }))

    expect(html).toContain('One book matches no rule at all')
    expect(html).toContain('Title 77')
  })

  it('says what it is leaving where it is', () => {
    expect(words(planned({ moving: 0, groups: [], staying: 12 })))
      .toContain('Twelve books stay exactly where they are')
  })

  it('says so plainly when the books are already on that bookcase', () => {
    const html = words(planned({ planks: [], groups: [], moving: 0, staying: 50 }))

    expect(html).toContain('It already starts on bookcase 3')
    expect(html).toContain('0 books to carry')
  })

  /*
   * Applying does not start a job of its own: these fifty join a list that
   * already has three on it, and the screen after this says fifty-three. A plan
   * that reported its own fifty and handed over a different number would look
   * like an arithmetic bug.
   */
  it('says what is already waiting, so the next screen is not a surprise', () => {
    expect(words(drawn({ plan: plan(), waiting: 3 })))
      .toContain('Three books are on your carry list')
    expect(words(drawn({ plan: plan(), waiting: 0 })))
      .not.toContain('on your carry list')
  })

  it('says that applying writes nothing anybody has to carry yet', () => {
    expect(words(planned())).toContain('Nothing moves until you carry the books yourself')
  })
})

describe('what applying wrote', () => {
  it('counts the rows it wrote and the books to carry separately', () => {
    const html = words(drawn({ applied: { moved: 50, wrote: 47 } }))

    expect(html).toContain('47 books now belong somewhere else.')
    expect(html).toContain('The 50 books to carry are on your carry list')
    expect(html).toContain('Go and carry them')
  })

  it('says nothing needs carrying when nothing does', () => {
    const html = words(drawn({ applied: { moved: 0, wrote: 0 } }))

    expect(html).toContain('Nothing needs carrying')
    expect(html).toContain('Open the list')
  })
})

describe('the design rules this screen could break', () => {
  it('draws four places in the tab bar, the way every screen does', () => {
    for (const html of [drawn(), planned(), drawn({ applied: { moved: 1, wrote: 1 } })]) {
      expect(html.match(/class="wf-tab[ "]/g) ?? []).toHaveLength(4)
    }
  })

  it('lets no word out of the model reach the screen', () => {
    const html = words(planned({
      skipped: [{ reason: 'never-placed', books: [book(9)] }],
      unclaimed: [book(8)],
    }))

    for (const word of ['run', 'range', 'shelf', 'shelves', 'plank', 'placement', 'sort key']) {
      expect(html, `the plan says "${word}"`).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'))
    }
  })

  it('draws the refusal the server gave, in the server’s own words', () => {
    expect(words(drawn({ error: 'Bookcase 2 already has areas on it.' })))
      .toContain('Bookcase 2 already has areas on it.')
  })
})

describe('the bookcases a move is offered', () => {
  const piece = (position: number, areas: number) =>
    ({ position, areas: Array.from({ length: areas }, () => ({})) })

  it('offers the one it is on, the empty ones, and one that does not exist yet', () => {
    const found = destinationsFor([piece(1, 11), piece(2, 0), piece(4, 3)], 4)

    expect(found.map((one) => one.number)).toEqual([2, 3, 4, 5])
    expect(found.find((one) => one.number === 4)!.said).toBe('Where it lives now')
    expect(found.find((one) => one.number === 2)!.said).toBe('Nothing on it yet')
    expect(found.find((one) => one.number === 5)!.said).toBe('A bookcase you do not have yet')
  })

  /*
   * A bookcase holds one stretch of books, and the server refuses a destination
   * with areas already on it. Offering one would be a target that exists to say
   * no.
   */
  it('never offers a bookcase somebody else’s books are already on', () => {
    expect(destinationsFor([piece(1, 11), piece(4, 3)], 4).map((one) => one.number))
      .toEqual([2, 3, 4, 5])
  })
})

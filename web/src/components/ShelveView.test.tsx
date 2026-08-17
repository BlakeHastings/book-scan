/**
 * What the shuffle list tells somebody standing at the shelves with books in
 * their hands.
 *
 * #149: above this list sat a one line summary of the planks involved,
 * deduplicated, printed under a heading that promised the order it happened.
 * After two accepted moves it read `1B → 2A → 1A` for a shuffle that ran
 * `1A → 1B → 2A`, while the correct version sat directly underneath it. The
 * summary is gone, and these tests hold the list to the claim the heading
 * makes, on the case that broke it: a cascade that uses the same pair of
 * planks twice.
 *
 * Rendered as markup rather than driven in a browser, the same way
 * `QueuePane.test.tsx` does it. `MovesSoFar` holds no state, which is what
 * makes that possible and is why it is split out of the pane at all.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MovesSoFar } from './ShelveView'
import {
  asking, confirm, emptyCascade, pushCarry, pushFrame,
  type Cascade, type Frame,
} from '../lib/cascade'

const frame = (title: string, from: string, to: string, id = 1): Frame => ({
  // Invented and only distinct: this file is about what the list says, and the
  // plank a frame carries is what the write is addressed to. See #359.
  fromAreaId: 100 + from.charCodeAt(from.length - 1),
  from,
  kind: 'area',
  proposal: {
    id, title, authorFiling: `${title} author`, to,
    toAreaId: 100 + to.charCodeAt(to.length - 1),
    strip: null,
  },
})

const settle = (cascade: Cascade): Cascade => {
  const top = asking(cascade)!
  return confirm(cascade, {
    id: top.proposal.id, title: top.proposal.title, from: top.from, to: top.proposal.to,
  })
}

const drawn = (cascade: Cascade) =>
  renderToStaticMarkup(MovesSoFar({ cascade })!)

/*
 * 1A is full, so its last book goes to 1B. 1B will not take it, so 1B's last
 * book goes to 2A. Back at 1A, 1B is still too tight, so another book goes
 * 1B to 2A. Then 1B takes the book off 1A. Three moves over three planks, and
 * the pair 1B to 2A is walked twice.
 */
const revisiting = (): Cascade => {
  let cascade = pushFrame(emptyCascade, frame('The Dispossessed', '1A', '1B'))
  cascade = pushFrame(cascade, frame('Snow Crash', '1B', '2A', 2))
  cascade = settle(cascade)
  cascade = pushFrame(cascade, frame('The Book Thief', '1B', '2A', 3))
  cascade = settle(cascade)
  return settle(cascade)
}

describe('a shuffle that uses the same planks twice', () => {
  it('draws every move, including the one a dedupe would have swallowed', () => {
    const html = drawn(revisiting())
    expect(html.match(/<li/g)).toHaveLength(3)
    for (const title of ['Snow Crash', 'The Book Thief', 'The Dispossessed']) {
      expect(html).toContain(title)
    }
  })

  it('puts them in the order the books were carried, which is what it claims', () => {
    const html = drawn(revisiting())
    expect(html).toContain('Shuffle, in the order it happened')
    expect(html.indexOf('Snow Crash')).toBeLessThan(html.indexOf('The Book Thief'))
    expect(html.indexOf('The Book Thief')).toBeLessThan(html.indexOf('The Dispossessed'))
  })

  /*
   * The guard against #149 coming back in another shape. A route drawn between
   * plank names is the thing that cannot be true here: the order the person
   * walked and the order the displacement propagated are different orders, and
   * an arrow asserts one without saying which. Every plank in this block is
   * named inside a move that also names its book.
   */
  it('states no route between planks', () => {
    expect(drawn(revisiting())).not.toContain('→')
  })
})

describe('nothing having happened', () => {
  it('draws nothing at all rather than an empty heading', () => {
    expect(MovesSoFar({ cascade: emptyCascade })).toBeNull()
  })

  it('does not call it a shuffle when only the book in hand moved on', () => {
    const carried = pushCarry(emptyCascade, {
      id: 0, title: 'Dune', from: '1A', to: '1B',
    })
    const html = drawn(carried)
    expect(html).toContain('Where it went instead')
    expect(html).not.toContain('Shuffle')
  })
})

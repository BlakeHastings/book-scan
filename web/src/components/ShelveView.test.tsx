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
import { MovesSoFar, ShelveView } from './ShelveView'
import {
  asking, confirm, emptyCascade, pushCarry, pushFrame,
  type Cascade, type Frame,
} from '../lib/cascade'
import type { PlacementResponse } from '../lib/api'

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
    // One numbered step per move. It was one `<li>` per move until #387 drew
    // this as the design system's numbered steps; the count is the same claim.
    expect(html.match(/wf-step__n/g)).toHaveLength(3)
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

/**
 * A range no rule serves, on the screen somebody is standing at a bookcase with
 * (#479).
 *
 * The screen has three ways of not knowing which plank it is talking about, and
 * two of them are waits: the placement has not arrived, or it has and a boundary
 * move has made it stale. All three used to draw "Working out where it goes...",
 * which is a promise that an answer is on its way. For this one nothing is on
 * its way until somebody writes a rule, and that is the same silence #562 found
 * on the first screen: the screen drawn while you wait, shown for a state that
 * is not waiting.
 */
describe('a book whose range nothing places', () => {
  const nowhere = {
    kind: 'range-has-no-start',
    range: 'nonfiction',
    instruction:
      'Nothing says where non-fiction begins, so there is nowhere to put this book. '
      + 'Say what belongs on a bookcase or a shelf first.',
    suggestedLocation: '',
    derivedLocation: '',
    derivedAreaId: null,
    predecessor: null,
    successor: null,
    authorFiling: 'Berger, John',
    sortKey: 'berger john|ways of seeing',
    strip: null,
  } as unknown as PlacementResponse

  const drawnFor = (placement: PlacementResponse | null, stale = false) =>
    renderToStaticMarkup(
      <ShelveView
        placement={placement}
        stale={stale}
        range="nonfiction"
        title="Ways of Seeing"
        saving={false}
        onShelved={() => {}}
        onBack={() => {}}
        cascade={emptyCascade}
        setCascade={() => {}}
        onRefresh={async () => {}}
      />,
    )

  it('says nothing places the range, rather than promising an answer', () => {
    const html = drawnFor(nowhere)
    expect(html).toContain('Nothing says where non-fiction')
    expect(html).not.toContain('Working out where')
  })

  it('is what tells that screen apart from the one still waiting', () => {
    // The same screen with no placement at all, which is the wait. It draws the
    // wait, and that stays right: an answer really is coming.
    const waiting = drawnFor(null)
    expect(waiting).toContain('Working out where')
    expect(waiting).not.toContain('Nothing says where')
  })

  it('names no plank, because there is none to name', () => {
    // Every sentence on this screen carries a plank's name in its wording, and
    // the one built out of an empty label read "Start at ." (#479).
    const html = drawnFor(nowhere)
    expect(html).not.toContain('Start at')
    expect(html).not.toContain('gap at')
  })

  it('offers no answer to press, because every one of them writes', () => {
    // "It fits, save" records the book on a plank and the two "no room" buttons
    // ask a route to move furniture. None of them is a question that can be
    // asked about a run that does not exist, so all three stay off.
    const html = drawnFor(nowhere)
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(3)
  })

  it('says nothing has been changed and what ends the state', () => {
    const html = drawnFor(nowhere)
    expect(html).toContain('Nothing has been changed and nothing is lost')
    expect(html).toContain('Where a range begins is whatever your rules say')
  })

  it('does not say it about a book that is simply in neither run', () => {
    // The other absence, and #304's sentence, which stays exactly as it was: a
    // book with no genre tag is in neither ordered list, where this is a list
    // standing nowhere.
    const html = renderToStaticMarkup(
      <ShelveView
        placement={null}
        stale={false}
        range={null}
        title="Ways of Seeing"
        saving={false}
        onShelved={() => {}}
        onBack={() => {}}
        cascade={emptyCascade}
        setCascade={() => {}}
        onRefresh={async () => {}}
      />,
    )
    expect(html).toContain('is fiction or')
    expect(html).not.toContain('Nothing says where')
  })
})

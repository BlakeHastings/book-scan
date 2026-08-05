/**
 * The shuffle, unwound one book at a time.
 *
 * The case that matters here is the one the owner reported in #110 and no
 * test covered: a chain several books deep where the answer on the way out is
 * no. Before the fix, a single yes at the bottom emptied the stack and handed
 * the question straight back to the book in hand, so the books in between
 * were recorded as placed without anybody having looked at them.
 *
 * The other half is #111: a frame is a question, not a fact. Nothing lands in
 * `done` until somebody says they carried the book, so a cascade abandoned
 * four deep leaves behind exactly the moves that were made.
 */

import { describe, expect, it } from 'vitest'
import {
  asking, confirm, depth, emptyCascade, pushCarry, pushFrame, repropose,
  started, whereYouAre, type Cascade, type Done, type Frame,
} from './cascade'

const frame = (
  title: string, from: string, to: string, id = 1, kind: 'shelf' | 'area' = 'area',
): Frame => ({
  from,
  kind,
  proposal: { id, title, authorFiling: `${title} author`, to, strip: null },
})

/** What a frame becomes once somebody says they carried the book. */
const carried = (f: Frame): Done => ({
  id: f.proposal.id, title: f.proposal.title, from: f.from, to: f.proposal.to,
})

const settle = (cascade: Cascade): Cascade =>
  confirm(cascade, carried(asking(cascade)!))

describe('descending', () => {
  it('asks about nothing until a book is displaced', () => {
    expect(asking(emptyCascade)).toBeNull()
    expect(depth(emptyCascade)).toBe(0)
    expect(started(emptyCascade)).toBe(false)
  })

  it('asks about the book it proposes to move', () => {
    const one = pushFrame(emptyCascade, frame('The Dispossessed', '1A', '1B'))
    expect(asking(one)?.proposal.title).toBe('The Dispossessed')
    expect(depth(one)).toBe(1)
  })

  it('asks about the deepest book, not the first', () => {
    const two = pushFrame(
      pushFrame(emptyCascade, frame('The Dispossessed', '1A', '1B')),
      frame('Snow Crash', '1B', '1C', 2),
    )
    expect(asking(two)?.proposal.title).toBe('Snow Crash')
    expect(depth(two)).toBe(2)
  })

  it('records nothing on the way down, however deep it goes', () => {
    let cascade = pushFrame(emptyCascade, frame('The Dispossessed', '1A', '1B'))
    cascade = pushFrame(cascade, frame('Snow Crash', '1B', '1C', 2))
    cascade = pushFrame(cascade, frame('The Book Thief', '1C', '1D', 3))

    // #111: three questions asked, no book carried, nothing to write down.
    expect(cascade.done).toEqual([])
    expect(started(cascade)).toBe(true)
  })
})

describe('unwinding', () => {
  const three = (): Cascade => {
    let cascade = pushFrame(emptyCascade, frame('The Dispossessed', '1A', '1B'))
    cascade = pushFrame(cascade, frame('Snow Crash', '1B', '1C', 2))
    return pushFrame(cascade, frame('The Book Thief', '1C', '1D', 3))
  }

  it('hands the question back one level, not all the way to the top', () => {
    let cascade = settle(three())
    // This is #110. It used to be null here, back at the book in hand, with
    // the two books in between recorded as placed on nobody's say-so.
    expect(asking(cascade)?.proposal.title).toBe('Snow Crash')
    expect(depth(cascade)).toBe(2)

    cascade = settle(cascade)
    expect(asking(cascade)?.proposal.title).toBe('The Dispossessed')

    cascade = settle(cascade)
    expect(asking(cascade)).toBeNull()
    expect(depth(cascade)).toBe(0)
  })

  it('keeps only the moves that were confirmed, in the order they happened', () => {
    const cascade = settle(settle(three()))
    expect(cascade.done.map((step) => step.title))
      .toEqual(['The Book Thief', 'Snow Crash'])
    // The outermost move is still a question, so it is still not a fact.
    expect(cascade.done.some((step) => step.title === 'The Dispossessed')).toBe(false)
  })

  it('descends again from where the answer was no, and unwinds from there', () => {
    let cascade = pushFrame(emptyCascade, frame('The Dispossessed', '1A', '1B'))
    cascade = pushFrame(cascade, frame('Snow Crash', '1B', '1C', 2))
    cascade = settle(cascade)

    // No on the way out. The same push the first no made, from one level up.
    cascade = pushFrame(cascade, frame('The Book Thief', '1B', '1C', 3))
    expect(asking(cascade)?.proposal.title).toBe('The Book Thief')
    expect(depth(cascade)).toBe(2)

    cascade = settle(cascade)
    expect(asking(cascade)?.proposal.title).toBe('The Dispossessed')

    cascade = settle(cascade)
    expect(asking(cascade)).toBeNull()
    expect(cascade.done.map((step) => step.title))
      .toEqual(['Snow Crash', 'The Book Thief', 'The Dispossessed'])
  })

  it('redraws the frame it comes back to, which the moves below have changed', () => {
    let cascade = pushFrame(emptyCascade, frame('The Dispossessed', '1A', '1B'))
    cascade = pushFrame(cascade, frame('Snow Crash', '1B', '1C', 2))
    cascade = settle(cascade)

    cascade = repropose(cascade, {
      id: 1, title: 'The Dispossessed', authorFiling: 'Le Guin, Ursula K.',
      to: '1B', strip: null,
    })
    // The plank it is full of is still the one that was said to be full.
    expect(asking(cascade)?.from).toBe('1A')
    expect(asking(cascade)?.proposal.authorFiling).toBe('Le Guin, Ursula K.')
  })
})

describe('the book in hand moving on', () => {
  it('is done rather than asked about, and never joins the stack', () => {
    const cascade = pushCarry(emptyCascade, {
      id: 0, title: 'Dune', from: '1A', to: '1B',
    })
    expect(asking(cascade)).toBeNull()
    expect(depth(cascade)).toBe(0)
    expect(cascade.done[0]?.inHand).toBe(true)
  })
})

describe('saying where you are', () => {
  const three = (): Cascade => {
    let cascade = pushFrame(emptyCascade, frame('The Dispossessed', '1A', '1B'))
    cascade = pushFrame(cascade, frame('Snow Crash', '1B', '1C', 2))
    return pushFrame(cascade, frame('The Book Thief', '1C', '1D', 3))
  }

  it('says nothing when the question is about the book in hand', () => {
    expect(whereYouAre(emptyCascade, 'Dune')).toBe('')
  })

  it('names the book being placed, the depth, and what is still to come', () => {
    expect(whereYouAre(three(), 'Dune')).toBe(
      'Placing The Book Thief, 3 books deep. 2 books to check again after this, then Dune.',
    )
  })

  it('counts down as it unwinds', () => {
    expect(whereYouAre(settle(three()), 'Dune')).toBe(
      'Placing Snow Crash, 2 books deep. 1 book to check again after this, then Dune.',
    )
    expect(whereYouAre(settle(settle(three())), 'Dune')).toBe(
      'Placing The Dispossessed, 1 book deep. Then back to Dune.',
    )
  })
})

/**
 * #149. There was a summary line above the list reading `1B → 2A → 1A` for a
 * shuffle that ran `1A → 1B → 2A`, built by deduplicating the from and to of
 * every step. It is gone, and what is tested here is the record it was drawn
 * from: every move stays in the list, in the order it was carried out, however
 * many times a plank turns up.
 */
describe('a shuffle that comes back to a plank it already used', () => {
  /*
   * The shape from the issue, and not a contrived one. 1A is full, so its last
   * book goes to 1B. 1B will not take it, so 1B's last book goes to 2A. That
   * one is carried, the question comes back to 1A, and 1B is *still* too
   * tight, so another book goes 1B to 2A. Then 1B takes the book from 1A and
   * the chain closes. Three moves over three planks, and the pair 1B to 2A is
   * walked twice.
   */
  const revisiting = (): Cascade => {
    let cascade = pushFrame(emptyCascade, frame('The Dispossessed', '1A', '1B'))
    cascade = pushFrame(cascade, frame('Snow Crash', '1B', '2A', 2))
    cascade = settle(cascade)
    // The same push the first no made, one level up, exactly as #110 has it.
    cascade = pushFrame(cascade, frame('The Book Thief', '1B', '2A', 3))
    cascade = settle(cascade)
    return settle(cascade)
  }

  it('keeps every move, in the order the books were actually carried', () => {
    expect(revisiting().done.map((step) => `${step.from} to ${step.to}`))
      .toEqual(['1B to 2A', '1B to 2A', '1A to 1B'])
  })

  it('does not collapse two moves that share a plank into one', () => {
    // Two different books off 1B, and the person carried both. The summary
    // deduplicated planks and so could only ever show one of them, which is
    // the whole defect.
    const done = revisiting().done
    expect(done).toHaveLength(3)
    expect(done.map((step) => step.title))
      .toEqual(['Snow Crash', 'The Book Thief', 'The Dispossessed'])
  })
})

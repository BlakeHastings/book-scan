import { describe, expect, it } from 'vitest'
import {
  assignmentFor, currentAreaOf, isAtAPlace, needsAttention, standingOf,
  KINDS_AT_A_PLACE, PLACEMENT_KINDS, type Placement, type PlacementKind,
} from './ledger'

let nextId = 0

/** A row, with the fields that do not decide anything filled in once. */
const row = (kind: PlacementKind, areaId: number | null = null): Placement => ({
  id: (nextId += 1),
  bookId: 7,
  kind,
  areaId,
  sortKey: 'key',
  ruleId: kind === 'assigned' ? 1 : null,
  actor: 'person',
  reason: '',
  createdAt: '2026-08-09T00:00:00.000Z',
})

describe('the vocabulary', () => {
  it('names an area on exactly the kinds that put a book somewhere', () => {
    // The schema's check constraint is written from this list, so the table
    // cannot hold a row the fold has no answer for.
    expect(PLACEMENT_KINDS.filter(isAtAPlace)).toEqual([...KINDS_AT_A_PLACE])
  })
})

describe('folding a book’s rows', () => {
  it('says nowhere for a book nobody has put anywhere', () => {
    expect(currentAreaOf([])).toBeNull()
  })

  it('follows what somebody did and not what the rules wanted', () => {
    // An `assigned` row is only where the rules want the book; only a `placed` row means it moved.
    const rows = [row('placed', 3), row('assigned', 9)]
    const standing = standingOf(rows)

    expect(standing.area).toBe(3)
    expect(standing.assigned).toBe(9)
    expect(needsAttention(standing)).toBe(true)
  })

  it('stops needing attention once somebody carries the book', () => {
    const standing = standingOf([row('placed', 3), row('assigned', 9), row('placed', 9)])
    expect(standing.area).toBe(9)
    expect(needsAttention(standing)).toBe(false)
  })

  it('folds in id order however the rows arrive', () => {
    const first = row('placed', 1)
    const second = row('placed', 2)
    expect(currentAreaOf([second, first])).toBe(2)
    expect(currentAreaOf([first, second])).toBe(2)
  })

  it('takes a checked out book out of every area, and puts none back on return', () => {
    // Checked out has no position; returning writes a new placed row rather than restoring the old one.
    const out = standingOf([row('placed', 3), row('checked_out')])
    expect(out.area).toBeNull()
    expect(out.checkedOut).toBe(true)

    const back = standingOf([row('placed', 3), row('checked_out'), row('checked_in')])
    expect(back.area).toBeNull()
    expect(back.checkedOut).toBe(false)
  })

  it('leaves a withdrawn book nowhere, and keeps saying so', () => {
    const standing = standingOf([row('placed', 3), row('withdrawn')])
    expect(standing).toEqual({
      area: null,
      assigned: null,
      declined: null,
      pinned: false,
      checkedOut: false,
      withdrawn: true,
    })
  })
})

describe('a pin beats every rule, forever', () => {
  it('is where the book is, and clears what the rules had asked for', () => {
    const standing = standingOf([row('placed', 1), row('assigned', 5), row('pinned', 1)])
    expect(standing.area).toBe(1)
    expect(standing.pinned).toBe(true)
    // An assignment left standing would report a pinned book as misfiled forever.
    expect(standing.assigned).toBeNull()
    expect(needsAttention(standing)).toBe(false)
  })

  it('is undone by another row rather than by a flag somebody clears', () => {
    const standing = standingOf([row('pinned', 1), row('placed', 2)])
    expect(standing.pinned).toBe(false)
    expect(standing.area).toBe(2)
  })
})

describe('an assignment is written only where the answer differs', () => {
  it('writes nothing when the rules want the book where it already is', () => {
    expect(assignmentFor(standingOf([row('placed', 4)]), 4)).toBeNull()
  })

  it('writes nothing twice when nobody has carried the book yet', () => {
    // Comparing against the placement alone, rather than the existing assignment, would rewrite the same row on every run.
    const rows = [row('placed', 4), row('assigned', 6)]
    expect(assignmentFor(standingOf(rows), 6)).toBeNull()
  })

  it('writes one when the rules have changed their mind', () => {
    const rows = [row('placed', 4), row('assigned', 6)]
    expect(assignmentFor(standingOf(rows), 7)).toBe(7)
  })

  it('writes one for a book nobody has placed', () => {
    expect(assignmentFor(standingOf([]), 2)).toBe(2)
  })

  it('writes none for a pinned, withdrawn or checked out book', () => {
    expect(assignmentFor(standingOf([row('pinned', 1)]), 9)).toBeNull()
    expect(assignmentFor(standingOf([row('withdrawn')]), 9)).toBeNull()
    expect(assignmentFor(standingOf([row('checked_out')]), 9)).toBeNull()
  })

  it('writes none when no rule claims the book', () => {
    // Null from the rules is a real answer: inventing a destination would file the book somewhere nobody asked for.
    expect(assignmentFor(standingOf([row('placed', 4)]), null)).toBeNull()
  })
})

/** Nothing here may move a book, rewrite a placement, touch a pinned book, or resurface work already declined. */
describe('withdrawing an intention', () => {
  it('leaves the book exactly where it stands', () => {
    const rows = [row('placed', 4), row('assigned', 6), row('released')]
    const standing = standingOf(rows)

    expect(standing.area).toBe(4)
    expect(currentAreaOf(rows)).toBe(4)
  })

  it('takes the wanted answer off, so nothing is asking any more', () => {
    const standing = standingOf([row('placed', 4), row('assigned', 6), row('released')])

    expect(standing.assigned).toBeNull()
    expect(needsAttention(standing)).toBe(false)
  })

  it('remembers which answer was declined', () => {
    expect(standingOf([row('placed', 4), row('assigned', 6), row('released')]).declined).toBe(6)
  })

  it('does not hand the same work back the next time a plan is applied', () => {
    // The rule is still there; a run that ignored the withdrawal would write the identical assignment again.
    const rows = [row('placed', 4), row('assigned', 6), row('released')]
    expect(assignmentFor(standingOf(rows), 6)).toBeNull()
  })

  it('still asks when a rule changes its answer to somewhere else', () => {
    // Declining is about a specific answer, not the book itself, so a different answer is still work.
    const rows = [row('placed', 4), row('assigned', 6), row('released')]
    expect(assignmentFor(standingOf(rows), 7)).toBe(7)
  })

  it('forgets the answer once somebody moves the book', () => {
    // A new placement is new information; the declined answer no longer applies.
    const rows = [row('placed', 4), row('assigned', 6), row('released'), row('placed', 5)]
    const standing = standingOf(rows)

    expect(standing.declined).toBeNull()
    expect(assignmentFor(standing, 6)).toBe(6)
  })

  it('forgets it when the book is pinned, or goes out of the house', () => {
    const pinned = [row('placed', 4), row('assigned', 6), row('released'), row('pinned', 4)]
    expect(standingOf(pinned).declined).toBeNull()

    const out = [row('placed', 4), row('assigned', 6), row('released'), row('checked_out')]
    expect(standingOf(out).declined).toBeNull()
  })

  it('is put back on the list by an assignment naming the same area', () => {
    // Another row, not a delete: restoring is itself withdrawable the same way.
    const rows = [row('placed', 4), row('assigned', 6), row('released'), row('assigned', 6)]
    const standing = standingOf(rows)

    expect(standing.assigned).toBe(6)
    expect(standing.declined).toBeNull()
    expect(needsAttention(standing)).toBe(true)
    expect(standing.area).toBe(4)
  })

  it('cannot be reached by a pinned book, because a pin clears the assignment', () => {
    // A pin clears the standing assignment, so there is nothing here to withdraw.
    const rows = [row('placed', 4), row('assigned', 6), row('pinned', 4), row('released')]
    const standing = standingOf(rows)

    expect(standing.area).toBe(4)
    expect(standing.pinned).toBe(true)
    expect(standing.declined).toBeNull()
  })

  it('changes nothing for a book already carried where it was wanted', () => {
    // The assignment is already satisfied, so withdrawing over it does nothing.
    const rows = [row('placed', 4), row('assigned', 6), row('placed', 6), row('released')]
    const standing = standingOf(rows)

    expect(standing.area).toBe(6)
    expect(standing.declined).toBeNull()
  })
})

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
    /*
     * The whole design in one assertion. An `assigned` row is where the rules
     * say the book belongs; the book has not moved, so the projection must not
     * move either. A fold that followed assignments would put every book where
     * nobody has carried it, and the misfile list would be empty by
     * construction.
     */
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
    // A book in a bag holds no position, so there is nothing for another book to
    // be filed next to. On return it is placed again, which is another row.
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
      area: null, assigned: null, pinned: false, checkedOut: false, withdrawn: true,
    })
  })
})

describe('a pin beats every rule, forever', () => {
  it('is where the book is, and clears what the rules had asked for', () => {
    const standing = standingOf([row('placed', 1), row('assigned', 5), row('pinned', 1)])
    expect(standing.area).toBe(1)
    expect(standing.pinned).toBe(true)
    // Pinning says "this is where it goes, whatever the rules want". An
    // assignment left standing would report a pinned book as misfiled forever.
    expect(standing.assigned).toBeNull()
    expect(needsAttention(standing)).toBe(false)
  })

  it('is undone by another row rather than by a flag somebody clears', () => {
    // The decision to stop pinning is in the history, which is the point: there
    // is nothing anywhere a person can be surprised by.
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
    /*
     * The failure this rule exists to prevent, and the one that is easy to get
     * subtly wrong: comparing the rules' answer against the placement alone
     * would rewrite the same assignment on every run for as long as the book
     * stays where it is, which is the same flood arriving more slowly.
     */
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
    // Null from the rules is a real answer: a book no rule claims has nowhere
    // the rules can put it, and inventing one would file it somewhere nobody
    // asked for and report nothing.
    expect(assignmentFor(standingOf([row('placed', 4)]), null)).toBeNull()
  })
})

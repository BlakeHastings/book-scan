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

/**
 * The other half of applying, which is #402.
 *
 * Every one of these is about a thing that must not happen: a book moving, a
 * placement being rewritten, a pinned book being reached, or the work coming
 * straight back the next time somebody applies a plan.
 */
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
    /*
     * The question #402 says decides the design. The rule that wrote the
     * assignment is still on that place, so a run that knew nothing about the
     * withdrawal would write the identical row again and give somebody back the
     * work they had just taken off their list.
     */
    const rows = [row('placed', 4), row('assigned', 6), row('released')]
    expect(assignmentFor(standingOf(rows), 6)).toBeNull()
  })

  it('still asks when a rule changes its answer to somewhere else', () => {
    // A different area is something the person has not seen and turned down, so
    // it is work rather than a repeat. Declining is about an answer, not about
    // a book, which is what stops this becoming a pin nobody chose.
    const rows = [row('placed', 4), row('assigned', 6), row('released')]
    expect(assignmentFor(standingOf(rows), 7)).toBe(7)
  })

  it('forgets the answer once somebody moves the book', () => {
    // A placement is new information about the room, so the question the person
    // answered no longer exists and the rules get their say again.
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
    // The way back out, and it is another row rather than a delete: a
    // withdrawal somebody could not withdraw would be the one-way door this
    // whole change exists to remove, one door along.
    const rows = [row('placed', 4), row('assigned', 6), row('released'), row('assigned', 6)]
    const standing = standingOf(rows)

    expect(standing.assigned).toBe(6)
    expect(standing.declined).toBeNull()
    expect(needsAttention(standing)).toBe(true)
    expect(standing.area).toBe(4)
  })

  it('cannot be reached by a pinned book, because a pin clears the assignment', () => {
    // A pin beats every rule, so there is no standing assignment to withdraw and
    // nothing here can touch one. This is the same fact from the other end.
    const rows = [row('placed', 4), row('assigned', 6), row('pinned', 4), row('released')]
    const standing = standingOf(rows)

    expect(standing.area).toBe(4)
    expect(standing.pinned).toBe(true)
    expect(standing.declined).toBeNull()
  })

  it('changes nothing for a book already carried where it was wanted', () => {
    // Partly carried is the normal case. A book that reached the other end has
    // its assignment satisfied, so a withdrawal over the top of it withdraws
    // nothing and the book keeps the home somebody walked it to.
    const rows = [row('placed', 4), row('assigned', 6), row('placed', 6), row('released')]
    const standing = standingOf(rows)

    expect(standing.area).toBe(6)
    expect(standing.declined).toBeNull()
  })
})

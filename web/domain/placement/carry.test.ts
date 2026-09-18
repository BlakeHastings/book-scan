import { describe, expect, it } from 'vitest'
import {
  booksOnArea, carryWork, lastCarry, type AreaFace, type CarryableBook,
} from './carry'
import { labelFor, slotsInOrder, type Area, type Fixture } from './geography'
import type { Placement, PlacementKind } from './ledger'
import { INHERIT } from './strategies'

const fixture = (id: number, position: number): Fixture =>
  ({ id, position, kind: 'bookshelf', name: '', sortStrategy: INHERIT })

const area = (id: number, fixtureId: number, position: number): Area =>
  ({ id, fixtureId, position, name: '', startsAt: '', sortStrategy: INHERIT })

/** Three bookcases; area ids chosen so `40` reads `4A`. Bookcase 1 has two areas, the other two have three. */
const ORDER = new Map<number, AreaFace>(slotsInOrder(
  [fixture(1, 1), fixture(3, 3), fixture(4, 4)],
  [
    area(10, 1, 0), area(11, 1, 1),
    area(30, 3, 0), area(31, 3, 1), area(32, 3, 2),
    area(40, 4, 0), area(41, 4, 1), area(42, 4, 2),
  ],
).map((slot) => [slot.area.id, {
  label: labelFor(slot),
  fixtureId: slot.fixture.id,
  fixturePosition: slot.fixture.position,
  areaPosition: slot.area.position,
}]))

let nextRow = 0

const row = (
  bookId: number,
  kind: PlacementKind,
  areaId: number | null,
  createdAt = '2026-08-11T09:00:00.000Z',
): Placement => ({
  id: (nextRow += 1),
  bookId,
  kind,
  areaId,
  sortKey: '',
  ruleId: null,
  actor: kind === 'assigned' ? 'rules' : 'person',
  reason: '',
  createdAt,
})

/**
 * Every third book has no photograph: a list must not drop a book nobody has
 * photographed. What is checked here is that pictures arrive, not how they're drawn.
 */
const book = (id: number): CarryableBook => ({
  id,
  title: `Book ${id}`,
  authorFiling: `Author, ${id}`,
  spine: id % 3 === 0 ? '' : `spine-${id}.jpg`,
  cover: id % 3 === 0 ? '' : `front-${id}.jpg`,
})

describe('the outstanding work, as trips', () => {
  it('groups by the two areas each move names, and counts what is in them', () => {
    const books = [book(1), book(2), book(3)]
    const rows = [
      row(1, 'placed', 40), row(1, 'assigned', 30),
      row(2, 'placed', 40), row(2, 'assigned', 30),
      row(3, 'placed', 41), row(3, 'assigned', 31),
    ]

    const work = carryWork(books, rows, ORDER)

    expect(work.moving).toBe(3)
    expect(work.trips.map((trip) => [trip.from, trip.to, trip.books.length]))
      .toEqual([['4A', '3A', 2], ['4B', '3B', 1]])
  })

  it('leaves a book alone once somebody has put it where the rules wanted it', () => {
    const rows = [row(1, 'placed', 40), row(1, 'assigned', 30), row(1, 'placed', 30)]

    expect(carryWork([book(1)], rows, ORDER).moving).toBe(0)
  })

  it('says nothing about a book nobody has asked to move', () => {
    expect(carryWork([book(1)], [row(1, 'placed', 40)], ORDER).moving).toBe(0)
  })

  // A pin clears the standing assignment, so a pinned book could fall off the list quietly if not explicitly counted.
  it('counts every book it will not move, with the reason', () => {
    const books = [book(1), book(2), book(3), book(4)]
    const rows = [
      row(1, 'placed', 40), row(1, 'assigned', 30), row(1, 'pinned', 40),
      row(2, 'placed', 40), row(2, 'checked_out', null),
      row(3, 'withdrawn', null),
      row(4, 'assigned', 30),
    ]

    const work = carryWork(books, rows, ORDER)

    expect(work.moving).toBe(0)
    expect(work.skipped).toEqual([
      { reason: 'pinned', books: 1 },
      { reason: 'checked-out', books: 1 },
      { reason: 'withdrawn', books: 1 },
      { reason: 'never-placed', books: 1 },
    ])
  })

  // Ordered by how much is coming off each piece, not by label: bookcase 4 sorts last but has most to move.
  it('walks the piece with most to come off it first, then its areas in order', () => {
    const books = [1, 2, 3, 4, 5, 6].map(book)
    const rows = [
      // One book off bookcase 1, which sorts first by label and last by size.
      row(1, 'placed', 10), row(1, 'assigned', 11),
      // Five off bookcase 4, the second area before the first in the input.
      row(2, 'placed', 41), row(2, 'assigned', 31),
      row(3, 'placed', 40), row(3, 'assigned', 30),
      row(4, 'placed', 40), row(4, 'assigned', 30),
      row(5, 'placed', 42), row(5, 'assigned', 32),
      row(6, 'placed', 42), row(6, 'assigned', 32),
    ]

    const work = carryWork(books, rows, ORDER)

    expect(work.trips.map((trip) => trip.from)).toEqual(['4A', '4B', '4C', '1A'])
  })

  it('keeps two trips off one area together, which is what grouping is for', () => {
    const books = [1, 2, 3].map(book)
    const rows = [
      row(1, 'placed', 41), row(1, 'assigned', 31),
      row(2, 'placed', 41), row(2, 'assigned', 32),
      row(3, 'placed', 40), row(3, 'assigned', 30),
    ]

    const work = carryWork(books, rows, ORDER)

    expect(work.trips.map((trip) => `${trip.from} to ${trip.to}`))
      .toEqual(['4A to 3A', '4B to 3B', '4B to 3C'])
  })
})

describe('what has already been carried', () => {
  it('finds the carry the app asked for, and not a move nobody asked for', () => {
    const asked = [row(1, 'placed', 40), row(1, 'assigned', 30), row(1, 'placed', 30)]
    const own = [row(2, 'placed', 40), row(2, 'placed', 30)]

    expect(lastCarry(asked)).toEqual({
      fromAreaId: 40, toAreaId: 30, at: '2026-08-11T09:00:00.000Z',
    })
    expect(lastCarry(own)).toBeNull()
  })

  it('says how much of a trip is done, so resuming does not read as starting', () => {
    const books = [1, 2, 3].map(book)
    const rows = [
      // Two still to carry off 4A.
      row(1, 'placed', 40), row(1, 'assigned', 30, '2026-08-09T10:00:00.000Z'),
      row(2, 'placed', 40), row(2, 'assigned', 30, '2026-08-09T10:00:00.000Z'),
      // One carried on Sunday, out of the same run.
      row(3, 'placed', 40), row(3, 'assigned', 30, '2026-08-09T10:00:00.000Z'),
      row(3, 'placed', 30, '2026-08-09T14:00:00.000Z'),
    ]

    const work = carryWork(books, rows, ORDER)

    expect(work.moving).toBe(2)
    expect(work.trips[0]!.carried).toBe(1)
    expect(work.carried).toEqual({ books: 1, when: '2026-08-09' })
  })

  it('does not count an older carry between the same two areas as this stretch', () => {
    const books = [1, 2].map(book)
    const rows = [
      // Carried 4A to 3A in July, and settled there ever since.
      row(1, 'placed', 40), row(1, 'assigned', 30, '2026-07-01T10:00:00.000Z'),
      row(1, 'placed', 30, '2026-07-01T11:00:00.000Z'),
      // Assigned the same journey last week, and still on 4A.
      row(2, 'placed', 40), row(2, 'assigned', 30, '2026-08-11T10:00:00.000Z'),
    ]

    const work = carryWork(books, rows, ORDER)

    expect(work.moving).toBe(1)
    expect(work.trips[0]!.carried).toBe(0)
  })
})

describe('what the newest run of the rules changed', () => {
  const RUN = '2026-08-12T08:00:00.000Z'

  it('names the books somebody carried that have to be carried again', () => {
    const books = [1, 2, 3].map(book)
    const rows = [
      // Carried to 3A on Sunday, and now wanted on 1A.
      row(1, 'placed', 40), row(1, 'assigned', 30, '2026-08-09T10:00:00.000Z'),
      row(1, 'placed', 30, '2026-08-09T14:00:00.000Z'), row(1, 'assigned', 10, RUN),
      // Joined the list without ever having been carried.
      row(2, 'placed', 41), row(2, 'assigned', 31, RUN),
      // Was on the list, and the run wants it where it already is.
      row(3, 'placed', 42), row(3, 'assigned', 30, '2026-08-09T10:00:00.000Z'),
      row(3, 'assigned', 42, RUN),
    ]

    const work = carryWork(books, rows, ORDER)

    expect(work.changed).toEqual({
      joined: 2,
      left: 1,
      // Pictures ride along: a person is being told to fetch a book back and needs to recognise it.
      again: [{
        book: {
          id: 1,
          title: 'Book 1',
          authorFiling: 'Author, 1',
          spine: 'spine-1.jpg',
          cover: 'front-1.jpg',
        },
        from: '3A',
        to: '1A',
      }],
    })
  })

  it('says nothing when the run only re-pointed books that were already moving', () => {
    const rows = [
      row(1, 'placed', 40), row(1, 'assigned', 30, '2026-08-09T10:00:00.000Z'),
      row(1, 'assigned', 31, RUN),
    ]

    expect(carryWork([book(1)], rows, ORDER).changed).toBeNull()
  })

  // Counted as of the run, not live: carrying a book afterwards must not shrink the reported change.
  it('counts a book that joined even once somebody has carried it', () => {
    const rows = [
      row(1, 'placed', 40), row(1, 'assigned', 30, RUN),
      row(2, 'placed', 41), row(2, 'assigned', 31, RUN), row(2, 'placed', 31, RUN),
    ]

    const work = carryWork([book(1), book(2)], rows, ORDER)

    expect(work.moving).toBe(1)
    expect(work.changed).toEqual({ left: 0, joined: 2, again: [] })
  })

  it('says nothing at all about a catalogue the rules have never run over', () => {
    expect(carryWork([book(1)], [row(1, 'placed', 40)], ORDER).changed).toBeNull()
  })
})

describe('one trip, read at the area the books come off', () => {
  it('draws everything on the area and says why each one is staying', () => {
    const books = [1, 2, 3, 4].map(book)
    const rows = [
      row(1, 'placed', 40), row(1, 'assigned', 30),
      row(2, 'placed', 40), row(2, 'assigned', 30), row(2, 'pinned', 40),
      row(3, 'placed', 40), row(3, 'assigned', 31),
      row(4, 'placed', 40),
    ]

    const standing = booksOnArea(books, new Map([[1, 320]]), rows, 40, 30)

    expect(standing.map((one) => [one.id, one.going, one.staying])).toEqual([
      [1, true, null],
      [2, false, 'pinned'],
      [3, false, 'elsewhere'],
      [4, false, 'settled'],
    ])
    expect(standing[0]!.pages).toBe(320)
  })

  it('leaves out a book that is not on the area at all', () => {
    const rows = [row(1, 'placed', 41), row(1, 'assigned', 30)]

    expect(booksOnArea([book(1)], new Map(), rows, 40, 30)).toEqual([])
  })

  // Both booksOnArea and carryWork are checked: both draw books, on the board and in the trip rows.
  it('carries the pictures through, on the board and in the trips', () => {
    const books = [1, 2, 3].map(book)
    const rows = [
      row(1, 'placed', 40), row(1, 'assigned', 30),
      row(2, 'placed', 40), row(2, 'assigned', 30),
      row(3, 'placed', 40), row(3, 'assigned', 30),
    ]

    const standing = booksOnArea(books, new Map(), rows, 40, 30)
    const carried = carryWork(books, rows, ORDER).trips[0]!.books

    // The third has none, which is a real book and not a book to leave out.
    expect(standing.map((one) => [one.spine, one.cover])).toEqual([
      ['spine-1.jpg', 'front-1.jpg'],
      ['spine-2.jpg', 'front-2.jpg'],
      ['', ''],
    ])
    expect(carried.map((one) => one.spine)).toEqual(['spine-1.jpg', 'spine-2.jpg', ''])
  })
})

/** What every test in this block checks: no book moves, and nothing is quietly forgotten. */
describe('work somebody left where it is', () => {
  const rules = (bookId: number, name: string, at: number) =>
    ({ ...row(bookId, 'assigned', at), reason: name })

  it('takes the books off the trips and leaves them standing where they were', () => {
    const books = [book(1), book(2)]
    const rows = [
      row(1, 'placed', 40), row(1, 'assigned', 30), row(1, 'released', null),
      row(2, 'placed', 40), row(2, 'assigned', 30), row(2, 'released', null),
    ]

    const work = carryWork(books, rows, ORDER)

    expect(work.moving).toBe(0)
    expect(work.trips).toEqual([])
    expect(booksOnArea(books, new Map(), rows, 40, 30).map((one) => one.staying))
      .toEqual(['left', 'left'])
  })

  it('says how many, off which area, where the rules wanted them, and by which rule', () => {
    const books = [book(1), book(2), book(3)]
    const rows = [
      row(1, 'placed', 40), rules(1, 'Non-fiction', 30), row(1, 'released', null),
      row(2, 'placed', 40), rules(2, 'Non-fiction', 30), row(2, 'released', null),
      row(3, 'placed', 41), rules(3, 'Paperbacks', 31), row(3, 'released', null),
    ]

    expect(carryWork(books, rows, ORDER).setAside).toEqual([
      { fromAreaId: 40, toAreaId: 30, from: '4A', to: '3A', books: 2, rules: ['Non-fiction'] },
      { fromAreaId: 41, toAreaId: 31, from: '4B', to: '3B', books: 1, rules: ['Paperbacks'] },
    ])
  })

  it('leaves the books somebody already carried at the other end', () => {
    // Partly carried is the normal case: a book already carried must not be brought back by withdrawing the rest.
    const books = [book(1), book(2), book(3)]
    const rows = [
      row(1, 'placed', 40), row(1, 'assigned', 30), row(1, 'placed', 30),
      row(2, 'placed', 40), row(2, 'assigned', 30), row(2, 'placed', 30),
      row(3, 'placed', 40), row(3, 'assigned', 30), row(3, 'released', null),
    ]

    const work = carryWork(books, rows, ORDER)

    expect(work.moving).toBe(0)
    expect(work.setAside.map((one) => [one.from, one.to, one.books]))
      .toEqual([['4A', '3A', 1]])
    expect(booksOnArea(books, new Map(), rows, 30, 30).map((one) => one.id)).toEqual([1, 2])
  })

  it('never counts a pinned book, because a pin left nothing to withdraw', () => {
    const books = [book(1), book(2)]
    const rows = [
      row(1, 'placed', 40), row(1, 'assigned', 30), row(1, 'released', null),
      row(2, 'placed', 40), row(2, 'assigned', 30), row(2, 'pinned', 40),
    ]

    const work = carryWork(books, rows, ORDER)

    expect(work.setAside.map((one) => one.books)).toEqual([1])
    expect(work.skipped).toEqual([{ reason: 'pinned', books: 1 }])
  })

  it('stops calling it carried, because nobody carried anything', () => {
    // lastCarry looks for an assignment followed by a placement landing in it; a withdrawal is neither.
    const rows = [row(1, 'placed', 40), row(1, 'assigned', 30), row(1, 'released', null)]

    expect(lastCarry(rows)).toBeNull()
    expect(carryWork([book(1)], rows, ORDER).carried.books).toBe(0)
  })

  it('is gone from the list once the work is put back on it', () => {
    const rows = [
      row(1, 'placed', 40), row(1, 'assigned', 30), row(1, 'released', null),
      row(1, 'assigned', 30),
    ]

    const work = carryWork([book(1)], rows, ORDER)

    expect(work.setAside).toEqual([])
    expect(work.moving).toBe(1)
    expect(work.trips[0]!.from).toBe('4A')
  })

  it('says nothing at all on a list nobody has decided anything about', () => {
    const rows = [row(1, 'placed', 40), row(1, 'assigned', 30)]

    expect(carryWork([book(1)], rows, ORDER).setAside).toEqual([])
  })
})

/**
 * What the carry screens say, held to a claim rather than only looked at.
 *
 * Rendered as markup the way `HomePane.test.tsx` does it: this project has no
 * DOM in its test setup and none of these screens holds state.
 *
 * The design rules the gallery pins reach here too, and the ones this flow can
 * break are checked: no word out of the model on screen, the four places in the
 * tab bar, and a list that never quietly drops a book it is not carrying.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { CarryPane } from './CarryPane'
import { CarriedPane } from './CarriedPane'
import { CarryStalePane } from './CarryStalePane'
import { TripPane } from './TripPane'
import type { CarryTrip, CarryWork, StandingBook, TripAtAnArea } from '../lib/api'

const book = (id: number, title: string, filing: string) => ({ id, title, authorFiling: filing })

const trip = (over: Partial<CarryTrip> = {}): CarryTrip => ({
  fromAreaId: 40,
  toAreaId: 30,
  from: '4A',
  to: '3A',
  carried: 0,
  books: [
    book(1, 'A Short History of Nearly Everything', 'Bryson, Bill'),
    book(2, 'Silent Spring', 'Carson, Rachel'),
    book(3, 'The White Album', 'Didion, Joan'),
  ],
  ...over,
})

const work = (over: Partial<CarryWork> = {}): CarryWork => ({
  moving: 3,
  trips: [trip()],
  skipped: [],
  carried: { books: 0, when: '' },
  changed: null,
  ...over,
})

const standing = (over: Partial<StandingBook> = {}): StandingBook => ({
  id: 1,
  title: 'A Short History of Nearly Everything',
  authorFiling: 'Bryson, Bill',
  pages: 544,
  going: true,
  staying: null,
  ...over,
})

const carry = (over: Partial<Parameters<typeof CarryPane>[0]> = {}): string =>
  renderToStaticMarkup(CarryPane({
    work: work(),
    onTrip: () => {},
    onChanged: () => {},
    onHome: () => {},
    onLibrary: () => {},
    onQueue: () => {},
    onScan: () => {},
    ...over,
  }) as ReactElement)

const atArea = (over: Partial<TripAtAnArea> = {}): TripAtAnArea => ({
  from: '4A',
  to: '3A',
  fromAreaId: 40,
  toAreaId: 30,
  books: [standing(), standing({ id: 2, title: 'Silent Spring', authorFiling: 'Carson, Rachel' })],
  ...over,
})

const attrip = (over: Partial<Parameters<typeof TripPane>[0]> = {}): string =>
  renderToStaticMarkup(TripPane({
    trip: atArea(),
    only: false,
    onTake: () => {},
    onBack: () => {},
    onHome: () => {},
    onQueue: () => {},
    onScan: () => {},
    ...over,
  }) as ReactElement)

/** The words on the screen, with the markup and the class names gone. */
const words = (markup: string) => markup.replace(/<[^>]*>/g, ' ')

describe('the list of books to carry', () => {
  it('is trips and not books, and each row names both ends', () => {
    const html = carry()

    expect(html.match(/class="wf-trip"/g) ?? []).toHaveLength(1)
    expect(words(html)).toContain('4A')
    expect(words(html)).toContain('3A')
    expect(words(html)).toContain('3 books, one trip')
  })

  it('says the stretch of shelf a trip covers, to pull it without opening it', () => {
    expect(words(carry())).toContain('Bryson to Didion')
  })

  it('says nothing rather than an empty list when there is nothing to carry', () => {
    const html = carry({ work: work({ moving: 0, trips: [] }) })

    expect(words(html)).toContain('Every book is where the rules want it')
    expect(html).not.toContain('wf-trip')
  })

  it('draws nothing at all until the read has answered', () => {
    expect(carry({ work: null })).not.toContain('wf-trip')
  })

  /*
   * The plan says what it will not touch and so does this, in the same words: a
   * list of fifty-three that had quietly dropped three pinned books would be
   * believed, and the person would come back three books short.
   */
  it('counts every book it is not carrying, with the reason', () => {
    const html = words(carry({
      work: work({
        skipped: [
          { reason: 'pinned', books: 3 },
          { reason: 'checked-out', books: 2 },
          { reason: 'never-placed', books: 1 },
        ],
      }),
    }))

    expect(html).toContain('Six books')
    expect(html).toContain('Three you pinned.')
    expect(html).toContain('Two checked out.')
    expect(html).toContain('One never confirmed onto a bookcase.')
  })

  it('reads as carrying on rather than as starting, once anything is carried', () => {
    const html = words(carry({
      work: work({
        carried: { books: 15, when: '2026-08-09' },
        trips: [trip({ carried: 7, to: '3B' })],
      }),
    }))

    // The day itself is `whenSaid`'s, and is checked where that is, against a
    // fixed today rather than against the clock this run happens on.
    expect(html).toContain('You carried fifteen ')
    expect(html).toContain('Carry on at 4A')
    expect(html).toContain('Seven of the ten are on 3B already')
  })

  /*
   * Applying a plan is itself a change, so a list somebody has just made and is
   * looking at has nothing to explain. The offer is for coming back to one.
   */
  it('offers what changed only once there is a while-you-were-away', () => {
    const fresh = work({ changed: { left: 0, joined: 20, again: [] } })

    expect(words(carry({ work: fresh }))).not.toContain('What changed')
    expect(words(carry({
      work: { ...fresh, carried: { books: 9, when: '2026-08-09' } },
    }))).toContain('What changed while you were away')
  })

  it('offers it anyway when a book somebody carried has to be carried again', () => {
    expect(words(carry({
      work: work({
        changed: {
          left: 0,
          joined: 1,
          again: [{ book: book(9, 'Underland', 'Macfarlane, Robert'), from: '3B', to: '2A' }],
        },
      }),
    }))).toContain('What changed while you were away')
  })

  it('draws four places in the tab bar, the way every screen does', () => {
    expect(carry().match(/class="wf-tab[ "]/g) ?? []).toHaveLength(4)
  })

  it('lets no word out of the model reach the screen', () => {
    const html = words(carry({
      work: work({ skipped: [{ reason: 'never-placed', books: 1 }] }),
    }))

    expect(html).not.toMatch(/assigned|placed|area_id|sort_key|book_placement|nonfiction/i)
  })
})

describe('one trip, at the area the books come off', () => {
  it('draws every book on the area, staying ones included', () => {
    const html = attrip({
      trip: atArea({
        books: [
          standing(),
          standing({ id: 2, title: 'Silent Spring', going: false, staying: 'pinned' }),
        ],
      }),
    })

    expect(html.match(/class="wf-spine /g) ?? []).toHaveLength(2)
    expect(html.match(/class="wf-perch"/g) ?? []).toHaveLength(1)
    expect(words(html)).toContain('One you pinned.')
  })

  it('says which of the books on the area are going, in the bar', () => {
    const html = words(attrip({
      trip: atArea({
        books: [
          standing(),
          standing({ id: 2, going: false, staying: 'pinned' }),
          standing({ id: 3, going: false, staying: 'settled' }),
        ],
      }),
    }))

    expect(html).toContain('one of the three books here go')
  })

  /*
   * "Two of the two books here go to 3A" is arithmetic rather than an answer,
   * and a mark on every book on the board answers nothing while looking like a
   * row of cats. Both found by looking at a real trip where nothing stayed.
   */
  it('does not answer "which of these" when the answer is all of them', () => {
    const html = attrip()

    expect(words(html)).toContain('Everything here goes to 3A')
    expect(words(html)).not.toContain('two of the two')
    expect(html).not.toContain('wf-perch')
  })

  it('skips the list for one book and names it instead', () => {
    const html = words(attrip({
      only: true,
      trip: atArea({
        books: [standing({ title: 'The Book Thief', authorFiling: 'Zusak, Markus' })],
      }),
    }))

    expect(html).toContain('One book to carry')
    expect(html).toContain('Take  The Book Thief  off 4A.')
    expect(html).toContain('It goes on 3A.')
    expect(html).toContain('I have it')
  })
})

describe('the end of a trip', () => {
  const carried = (over: Partial<Parameters<typeof CarriedPane>[0]> = {}) =>
    renderToStaticMarkup(CarriedPane({
      placed: 8,
      to: '3A',
      board: [standing({ going: false, staying: 'settled' })],
      work: work({ moving: 45, trips: [trip({ from: '4B', to: '3B' })] }),
      onTrip: () => {},
      onHome: () => {},
      onQueue: () => {},
      onScan: () => {},
      ...over,
    }) as ReactElement)

  it('says what went down, and offers the next trip by name', () => {
    const html = words(carried())

    expect(html).toContain('Eight books are on 3A.')
    expect(html).toContain('Next: three books off 4B')
    expect(html).toContain('Forty-five books, one trip')
  })

  it('says stopping is stopping when there is nothing left', () => {
    const html = words(carried({ work: work({ moving: 0, trips: [] }) }))

    expect(html).toContain('That is everything')
    expect(html).not.toContain('Still to carry')
  })
})

describe('what changed while you were away', () => {
  const stale = (over: Partial<Parameters<typeof CarryStalePane>[0]> = {}) =>
    renderToStaticMarkup(CarryStalePane({
      work: work({
        moving: 47,
        changed: {
          left: 11,
          joined: 20,
          again: [
            { book: book(9, 'Salt Fat Acid Heat', 'Nosrat, Samin'), from: '3B', to: '2A' },
          ],
        },
      }),
      onCarry: () => {},
      onHome: () => {},
      onQueue: () => {},
      onScan: () => {},
      ...over,
    }) as ReactElement)

  /*
   * The counts lead, because the first question is whether the job got bigger,
   * and the books carried once and now to be carried again are named: nobody may
   * find that out one book at a time standing at a shelf.
   */
  it('leads with the size of the job and names the books to carry again', () => {
    const html = words(stale())

    expect(html).toContain('Your last change took 11 books off your list and put 20 books on.')
    expect(html).toContain('Eleven books no longer move')
    expect(html).toContain('Twenty books joined')
    expect(html).toContain('Salt Fat Acid Heat')
    expect(html).toContain('3B to 2A')
  })

  it('has nothing to accept or dismiss, and one way on', () => {
    const html = stale()

    expect(html.match(/class="wf-btn/g) ?? []).toHaveLength(1)
    expect(words(html)).toContain('Show me what is left')
  })
})

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

/**
 * One book as the carry wire answers it: the name, and the two pictures.
 *
 * The photographs are named after the book rather than left off, because they
 * are what somebody at a shelf matches the phone against, and a fixture with
 * none would be a fixture of the bug. `noPhoto` is the other real case, and it
 * has its own tests rather than being the default here.
 */
const book = (id: number, title: string, filing: string, photographed = true) => ({
  id,
  title,
  authorFiling: filing,
  spine: photographed ? `spine-${id}.jpg` : '',
  cover: photographed ? `front-${id}.jpg` : '',
})

const trip = (over: Partial<CarryTrip> = {}): CarryTrip => ({
  fromAreaId: 40,
  toAreaId: 30,
  from: '4A',
  to: '3A',
  sharedNumber: null,
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
  setAside: [],
  ...over,
})

const standing = (over: Partial<StandingBook> = {}): StandingBook => ({
  ...book(1, 'A Short History of Nearly Everything', 'Bryson, Bill'),
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
    onAsk: () => {},
    onKeep: () => {},
    onLeave: () => {},
    onRestore: () => {},
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
  sharedNumber: null,
  books: [standing(), standing({ id: 2, title: 'Silent Spring', authorFiling: 'Carson, Rachel' })],
  ...over,
})

const attrip = (over: Partial<Parameters<typeof TripPane>[0]> = {}): string =>
  renderToStaticMarkup(TripPane({
    trip: atArea(),
    only: false,
    onTake: () => {},
    onAsk: () => {},
    onKeep: () => {},
    onLeave: () => {},
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

  /**
   * #447. `GET /api/carry` printed such a row as `4A -> 4A`, with the counts and
   * the areas right and nothing on the screen saying the two ends are two
   * different pieces. Somebody reading it walks to a bookcase and finds the
   * books already on it.
   *
   * The stretch of authors is displaced rather than joined, because it reads as
   * a row somebody can act on and this is not one until a piece has a name.
   */
  it('says so on a trip whose two ends read the same', () => {
    const html = words(carry({
      work: work({ trips: [trip({ from: '4A', to: '4A', toAreaId: 41, sharedNumber: 4 })] }),
    }))

    expect(html).toContain('Both ends read 4A: two pieces stand at 4 and neither is named.')
    expect(html).toContain('Name one of them to tell this trip apart.')
    expect(html).not.toContain('Bryson to Didion')
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

/**
 * Saying no to the work, and what stays on the screen afterwards (#402).
 *
 * The state the owner was stuck in is the one at the bottom of this block: a
 * list he had decided against, with no way to say so. What these hold is that
 * the way out says plainly that nothing moves, that it can be undone, and that
 * the rule which wanted the books is still there to be changed.
 */
describe('leaving the books where they are', () => {
  const aside = {
    fromAreaId: 40,
    toAreaId: 30,
    from: '4A',
    to: '3A',
    books: 22,
    rules: ['Non-fiction'],
  }

  it('offers it, quietly and under the two that carry on with the work', () => {
    expect(words(carry())).toContain('Leave them where they are')
  })

  it('asks first, and says that nothing moves and that it can be undone', () => {
    const html = words(carry({ asking: true }))

    expect(html).toContain('Three books stay where they are')
    expect(html).toContain('Nothing is moved and nothing is carried')
    expect(html).toContain('put this work back on the list afterwards')
    // And says the rules are unchanged, which is the thing only he can decide
    // about and the reason the work would otherwise come back.
    expect(html).toContain('rules that want them elsewhere are unchanged')
  })

  it('does not ask until it is asked to', () => {
    expect(carry()).not.toContain('wf-sure')
  })

  it('names what was left, where the rules wanted it, and which rule asked', () => {
    const html = words(carry({ work: work({ setAside: [aside] }) }))

    expect(html).toContain('Left where they are')
    expect(html).toContain('Twenty-two books')
    expect(html).toContain('Twenty-two on 4A the rules want on 3A, asked for by Non-fiction.')
    expect(html).toContain('Put them back on the list')
  })

  /*
   * Two different empty lists, and saying the wrong one is a lie about whose
   * decision emptied it. "Every book is where the rules want it" is the rules
   * agreeing; this is a person having answered them.
   */
  it('does not claim the rules agree with a list somebody emptied by deciding', () => {
    const html = words(carry({ work: work({ moving: 0, trips: [], setAside: [aside] }) }))

    expect(html).toContain('Nothing is waiting to be carried')
    expect(html).not.toContain('Every book is where the rules want it')
    expect(html).toContain('Twenty-two on 4A the rules want on 3A')
    expect(html).toContain('Put them back on the list')
  })

  it('still says the rules agree when they do', () => {
    const html = words(carry({ work: work({ moving: 0, trips: [] }) }))

    expect(html).toContain('Every book is where the rules want it')
    expect(html).not.toContain('Left where they are')
  })

  it('lets no word out of the model reach any of it', () => {
    const html = words(carry({ work: work({ setAside: [aside] }), asking: true }))

    expect(html).not.toMatch(/assigned|released|declined|book_placement|area_id/i)
  })
})

describe('one trip, at the area the books come off', () => {
  /**
   * The same fact at the shelf, and above the instruction rather than under it:
   * "Take these three off 4A" followed by "They go on 4A" is an instruction
   * somebody would carry out and change nothing (#447).
   */
  it('says when both ends read the same, before telling anybody to lift a book', () => {
    const html = words(attrip({ trip: atArea({ to: '4A', sharedNumber: 4 }) }))

    expect(html).toContain('Two pieces stand here')
    expect(html).toContain('Both ends read 4A: two pieces stand at 4 and neither is named.')
  })

  it('says nothing of the sort on an ordinary trip', () => {
    expect(words(attrip())).not.toContain('Two pieces stand here')
  })

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

  it('offers leaving this walk undone, last and quiet', () => {
    expect(words(attrip())).toContain('Leave them where they are')
    expect(words(attrip({
      only: true,
      trip: atArea({ books: [standing()] }),
    }))).toContain('Leave it where it is')
  })

  it('asks first, about these books and this pair of areas', () => {
    const html = words(attrip({ asking: true }))

    expect(html).toContain('Two books stay on 4A')
    expect(html).toContain('Nothing is moved and nothing is carried')
    expect(html).toContain('rules that want these on 3A are unchanged')
  })

  /*
   * A book somebody left where it is is not a book the rules want here, and
   * saying "already where the rules want it" about one would have the app
   * agreeing with itself about a decision it did not make.
   */
  it('says a book left where it is was left, rather than calling it settled', () => {
    const html = words(attrip({
      trip: atArea({
        books: [
          standing(),
          standing({ id: 2, going: false, staying: 'left' }),
          standing({ id: 3, going: false, staying: 'settled' }),
        ],
      }),
    }))

    expect(html).toContain('One you left where it is.')
    expect(html).toContain('One already where the rules want it.')
  })
})

/**
 * The books are drawn by their photographs, on every screen in this flow (#386).
 *
 * **Not decoration here.** Somebody is standing at a bookcase holding a phone up
 * against eleven spines looking for eight, so the picture is the match. They
 * were all missing, and it read as two faults rather than one: no photographs,
 * and a board that no longer looked like books at all. One cause, one seam: the
 * carry read sent no pictures, so the shared drawings had nothing to draw and
 * fell back to the cloth. These hold the panes to passing on what they are sent.
 */
describe('a book to carry is drawn by its own picture', () => {
  const carried = (over: Partial<Parameters<typeof CarriedPane>[0]> = {}) =>
    renderToStaticMarkup(CarriedPane({
      placed: 3,
      to: '3A',
      board: [standing(), standing({ ...book(2, 'Silent Spring', 'Carson, Rachel', false) })],
      work: work(),
      onTrip: () => {},
      onHome: () => {},
      onQueue: () => {},
      onScan: () => {},
      ...over,
    }) as ReactElement)

  const stale = (photographed: boolean) =>
    renderToStaticMarkup(CarryStalePane({
      work: work({
        changed: {
          left: 0,
          joined: 1,
          again: [{
            book: book(9, 'Salt Fat Acid Heat', 'Nosrat, Samin', photographed),
            from: '3B',
            to: '2A',
          }],
        },
      }),
      onCarry: () => {},
      onHome: () => {},
      onQueue: () => {},
      onScan: () => {},
    }) as ReactElement)

  it('puts the photograph of its spine on the board it is standing on', () => {
    expect(attrip()).toContain('class="wf-spine__photo" src="/api/covers/spine-1.jpg?w=160"')
  })

  it('puts the photograph of its cover on the row that names it', () => {
    expect(attrip()).toContain('class="wf-row__photo" src="/api/covers/front-1.jpg?w=160"')
  })

  /*
   * The one this must not answer by hiding the book. A book nobody has
   * photographed is an ordinary book on an ordinary shelf, and what it wears is
   * the dyed cloth every other view of the collection binds it in, with its name
   * down the spine. It is drawn, it is countable, and it is a thing to fix.
   */
  it('draws a book nobody has photographed as a book, in cloth, with its name', () => {
    const html = attrip({
      trip: atArea({
        books: [standing({ ...book(2, 'Silent Spring', 'Carson, Rachel', false) })],
      }),
    })

    expect(html).toContain('class="wf-spine wf-spine--sky"')
    expect(html).toContain('Carson')
    expect(html).not.toContain('wf-spine__photo')
    expect(html).not.toContain('wf-row__photo')
  })

  it('draws the same picture on the board at the end of the trip', () => {
    const html = carried()

    expect(html).toContain('class="wf-spine__photo" src="/api/covers/spine-1.jpg?w=160"')
    // The second book has none, and is still one of the two on the board.
    expect(html.match(/class="wf-spine /g) ?? []).toHaveLength(2)
    expect(html.match(/wf-spine__photo/g) ?? []).toHaveLength(1)
  })

  it('draws it on a book that has to be carried again', () => {
    expect(stale(true)).toContain('class="wf-row__photo" src="/api/covers/front-9.jpg?w=160"')
    expect(stale(false)).not.toContain('wf-row__photo')
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

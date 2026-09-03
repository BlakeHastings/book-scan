/**
 * The list of books that are not where the order puts them, which is the whole
 * reason the shelves screen is reachable.
 *
 * It is drawn here and nowhere else. #196 found it offering one answer where
 * there are two, and #358 found it silently setting 181 of 238 books aside and
 * reporting an empty list, which reads as everything being fine. #387 redrew it
 * with the design system, and a redraw is exactly the change that quietly loses
 * a button, so every part of it is held to a claim here rather than looked at.
 *
 * Rendered to static markup rather than into a DOM, the way `BookDetail.test`
 * is and for the same reason: this project has no browser environment in its
 * test setup, and everything asserted here is what the screen says on arrival.
 * `Misfiled` is split out of `ShelfView` and holds no state, so it is callable
 * as the plain function it is.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Misfiled } from './ShelfView'
import type { Misfile, ShelvingReviewResponse } from '../lib/api'

function misfile(overrides: Partial<Misfile['book']> = {}, from = '1A', to = '2B'): Misfile {
  return {
    book: {
      id: 7,
      title: 'Dune',
      authorFiling: 'Herbert, Frank',
      authors: 'Frank Herbert',
      location: from,
      areaId: 11,
      derivedLocation: to,
      derivedAreaId: 22,
      standing: { fixture: 1, plank: 0 },
      sortKey: 'herbert frank dune',
      checkedOut: false,
      ...overrides,
    },
    from,
    to,
    toAreaId: 22,
    instruction: `Move Dune from ${from} to ${to}`,
    sharedNumber: null,
  }
}

/** A review that says which of these the app opened and can close again. */
function review(outstandingMoves: number[] = []): ShelvingReviewResponse {
  return { misfiles: [], excluded: [], outstandingMoves }
}

function drawn(misfiles: Misfile[], response: ShelvingReviewResponse, moving = 0) {
  return renderToStaticMarkup(
    <Misfiled
      misfiles={misfiles}
      review={response}
      moving={moving}
      onOpen={() => {}}
      onMoved={() => {}}
      onTakeBack={() => {}}
    />,
  )
}

describe('the list of books that are not where they should be', () => {
  it('names both places for every book on it', () => {
    // One without the other is not something you can act on at the bookcase:
    // which plank to take it off, and which to put it on.
    const html = drawn([misfile()], review())
    expect(html).toContain('Dune')
    expect(html).toContain('Herbert, Frank')
    expect(html).toContain('Last seen on 1A')
    expect(html).toContain('2B')
  })

  /**
   * The row that reads "last seen on 1B, now puts it on 1B" (#491).
   *
   * Two pieces standing at one number is legal (`fixture.position` carries no
   * unique index) and draws two planks with one letter, so this really is an
   * instruction to carry a book from a plank to itself unless something says
   * which two planks they are. The carry screen has said it since #447 through
   * `sharedSaid`; this list said nothing at all, and one renumber puts five of
   * these in front of somebody holding a phone.
   */
  it('says so when both planks read the same', () => {
    const html = drawn([{ ...misfile({}, '1B', '1B'), sharedNumber: 1 }], review())

    expect(html).toContain('Last seen on 1B')
    expect(html).toContain('Both ends read 1B: two pieces stand at 1 and neither is named.')
  })

  it('says nothing of the sort on an ordinary row', () => {
    expect(drawn([misfile()], review())).not.toContain('Both ends read')
  })

  it('counts itself, because an unread list is a list nobody scrolls', () => {
    const html = drawn([misfile({ id: 1 }), misfile({ id: 2, title: 'Emma' })], review())
    expect(html).toContain('Needs attention (2)')
  })

  it('says nothing has been changed for anybody', () => {
    // The sentence that stops this reading as a to-do list the app is working
    // through. A location is descriptive: closing one of these is a walk.
    expect(drawn([misfile()], review())).toContain('Nothing has been changed for you')
  })

  it('offers "Moved it" on every book, which is the walk being reported', () => {
    expect(drawn([misfile()], review())).toContain('Moved it')
  })

  /*
   * #196. "Moved it" closes the gap by recording that somebody walked to a
   * shelf; this closes it by withdrawing an assignment nobody acted on. Without
   * it the only way out of a mistapped move was to claim the walk and then move
   * the book back: two false statements to undo one tap.
   */
  it('offers "Undo the move" where the server says the app made the move', () => {
    expect(drawn([misfile()], review([7]))).toContain('Undo the move')
  })

  /*
   * And nowhere else. The two kinds of entry look identical on screen and are
   * not the same thing: the other is the order having genuinely moved a book,
   * and the only thing that closes it is carrying the book. Offering an undo
   * there would move the furniture on the person's behalf and call it an undo.
   */
  it('offers it nowhere else', () => {
    // The answers, not the words around them, so this stays a claim about the
    // buttons whatever the rows happen to say.
    const answers = (html: string) => html.split('wf-card__foot')[1] ?? ''
    expect(answers(drawn([misfile()], review([99])))).not.toContain('Undo the move')
    expect(answers(drawn([misfile()], review()))).not.toContain('Undo the move')
    expect(answers(drawn([misfile()], review([7])))).toContain('Undo the move')
  })

  /**
   * The instruction over the list names the one answer every row has (#433).
   *
   * It named both, and "Undo the move" is on the rows the app made a move for
   * and on no others, so on a list of misfiles the app did not make the words
   * promised a button that was nowhere in the page. That is not a rendering to
   * fix: docs/shelving.md settles it under "Taking the move back is not the
   * opposite move", because a book pushed onto the next plank by a newcomer has
   * no assignment behind it, and moving the boundary to close that would be a
   * new decision about the furniture made on somebody's behalf wearing the word
   * undo. So the promise went to the rows that can keep it, and the button did
   * not move at all.
   */
  it('promises nothing over the list that a row on it may not offer', () => {
    const said = drawn([misfile()], review())

    expect(said).toContain('once the book is actually there.')
    expect(said).not.toContain('Undo the move')
    expect(said).not.toContain('if you never picked it up')
  })

  it('says on the row itself where the move can be put back', () => {
    const html = drawn([misfile()], review([7]))

    expect(html).toContain('The app made this move and nobody has picked the book up')
    expect(html).toContain('Undo the move')
  })

  it('says it on no other row, because no other row can', () => {
    expect(drawn([misfile()], review())).not.toContain('The app made this move')
    expect(drawn([misfile()], review([99]))).not.toContain('The app made this move')
  })

  /* Both answers go quiet together while a write is in flight, so a second tap
     cannot record a second walk nobody made. */
  it('goes quiet on the book being written and on no other', () => {
    const html = drawn([misfile({ id: 7 }), misfile({ id: 8, title: 'Emma' })], review([7, 8]), 7)
    const cards = html.split('attention__row')
    expect(cards[1], 'the book being written is still pressable').toContain('disabled')
    expect(cards[2], 'the other book was disabled too').not.toContain('disabled')
  })

  it('draws a book nobody has credited rather than dropping it', () => {
    // It arrives with two empty names, which is what says so. A row of the
    // report is a book to walk to, and one with no author is still that.
    const html = drawn([misfile({ authorFiling: '', authors: '' })], review())
    expect(html).toContain('Dune')
    expect(html).toContain('unknown author')
  })
})

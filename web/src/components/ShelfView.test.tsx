/**
 * Rendered to static markup rather than into a DOM: this project has no
 * browser environment in its test setup. `Misfiled` is split out of
 * `ShelfView` and holds no state, so it is callable as a plain function.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Drifted, Misfiled, NothingDrawn } from './ShelfView'
import type { DriftingBook, Misfile, ShelvingReviewResponse } from '../lib/api'

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
    const html = drawn([misfile()], review())
    expect(html).toContain('Dune')
    expect(html).toContain('Herbert, Frank')
    expect(html).toContain('Last seen on 1A')
    expect(html).toContain('2B')
  })

  // Two pieces can legally stand at the same position number
  // (`fixture.position` has no unique index), so "from" and "to" can read
  // identically without saying which two planks they are.
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
    expect(drawn([misfile()], review())).toContain('Nothing has been changed for you')
  })

  it('offers "Moved it" on every book, which is the walk being reported', () => {
    expect(drawn([misfile()], review())).toContain('Moved it')
  })

  it('offers "Undo the move" where the server says the app made the move', () => {
    expect(drawn([misfile()], review([7]))).toContain('Undo the move')
  })

  it('offers it nowhere else', () => {
    const answers = (html: string) => html.split('wf-card__foot')[1] ?? ''
    expect(answers(drawn([misfile()], review([99])))).not.toContain('Undo the move')
    expect(answers(drawn([misfile()], review()))).not.toContain('Undo the move')
    expect(answers(drawn([misfile()], review([7])))).toContain('Undo the move')
  })

  // See docs/shelving.md: undoing a move is not the opposite move.
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

  it('goes quiet on the book being written and on no other', () => {
    const html = drawn([misfile({ id: 7 }), misfile({ id: 8, title: 'Emma' })], review([7, 8]), 7)
    const cards = html.split('attention__row')
    expect(cards[1], 'the book being written is still pressable').toContain('disabled')
    expect(cards[2], 'the other book was disabled too').not.toContain('disabled')
  })

  it('draws a book nobody has credited rather than dropping it', () => {
    const html = drawn([misfile({ authorFiling: '', authors: '' })], review())
    expect(html).toContain('Dune')
    expect(html).toContain('unknown author')
  })
})

describe('the books the shelf and the rules disagree about', () => {
  const drifting = (over: Partial<DriftingBook> = {}): DriftingBook => ({
    bookId: 7,
    title: 'Dune',
    fromLayout: '1A',
    fromRules: '2B',
    ...over,
  })

  const card = (books: DriftingBook[], total = books.length) =>
    renderToStaticMarkup(<Drifted drift={{ books, total }} onOpen={() => {}} />)

  it('names both places for every book on it', () => {
    const html = card([drifting()])

    expect(html).toContain('Dune')
    expect(html).toContain('drawn in 1A, claimed into 2B')
  })

  it('says so when no rule claims the book at all', () => {
    const html = card([drifting({ fromRules: '' })])

    expect(html).toContain('drawn in 1A, and no rule claims it')
    expect(html).not.toContain('claimed into ')
  })

  it('counts the whole collection in its title, not the run on screen', () => {
    // Uses `total`, not the length of `books` drawn: the count describes the
    // whole collection's disagreement, not just what is on screen.
    expect(card([drifting()], 12))
      .toContain('Twelve books are drawn in one place and claimed by another')
  })

  it('says out loud that nothing will be repaired', () => {
    const html = card([drifting()])

    expect(html).toContain('Nothing has been moved and nothing will be')
    expect(html).toContain('never repaired')
    expect(html).toContain('rather than moving a book to make the two agree')
  })

  it('carries no control that would put any of it right', () => {
    // Deliberate: no action here, since repairing a disagreement would destroy
    // the evidence of how it happened.
    const html = card([drifting(), drifting({ bookId: 8, title: 'Emma' })])

    expect(html, 'the card grew an action').not.toContain('wf-btn')
    expect((html.match(/class="wf-row"/g) ?? []).length, 'the books stopped being rows').toBe(2)
  })

  it('stops naming books long before it becomes a wall of them', () => {
    const many = Array.from({ length: 40 }, (_, at) =>
      drifting({ bookId: at + 1, title: `Book ${at + 1}` }))
    const html = card(many, 300)

    expect((html.match(/class="wf-row"/g) ?? []).length).toBe(25)
    expect(html).toContain('275 more books')
    expect(html).toContain('300 books are drawn in one place')
  })
})

describe('a range with no planks to draw', () => {
  const drawnEmpty = (begins: string | null | undefined, filed: number | null = null) =>
    renderToStaticMarkup(
      <NothingDrawn range="nonfiction" begins={begins} filed={filed} />,
    )

  it('says nothing is catalogued only when the range has somewhere to be', () => {
    const html = drawnEmpty('4A')
    expect(html).toContain('Nothing catalogued in this range yet')
    expect(html).not.toContain('Nothing says where')
  })

  it('says nothing places the range when nothing does', () => {
    const html = drawnEmpty(null)
    expect(html).toContain('Nothing says where non-fiction begins')
    expect(html).not.toContain('Nothing catalogued in this range yet')
  })

  it('says the books are still there, which is the half that was a lie', () => {
    expect(drawnEmpty(null, 7)).toContain('The 7 books filed here are still catalogued')
    expect(drawnEmpty(null, 1)).toContain('The one book filed here is still catalogued')
  })

  it('invents no count when nothing has answered with one', () => {
    const html = drawnEmpty(null)
    expect(html).toContain('Nothing has been changed')
    expect(html).not.toMatch(/[0-9]+ books filed here/)
  })

  it('says what ends the state rather than only naming it', () => {
    expect(drawnEmpty(null, 7)).toContain('Describe the room and say what belongs where')
  })

  it('reads a server that does not send the field as the ordinary empty range', () => {
    // `begins` is optional on the wire: undefined means nobody said, only null
    // is the claim that nothing places the range.
    expect(drawnEmpty(undefined)).toContain('Nothing catalogued in this range yet')
  })
})

/**
 * The edit view for one piece of furniture, and the thing it stopped drawing.
 *
 * The owner, on #367: "on the edit view we shouldn't have that there. It should
 * just have what you call it, what it is, where it stands." What came off is the
 * piece drawn at the top with its areas and a way to cut another one in, which
 * is the second time he has given that note about that drawing sitting over a
 * screen that is for something else.
 *
 * Rendered as markup and read as markup, the way `FurniturePane.test.tsx` does
 * it: this project has no DOM in its test setup and this pane holds no state.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FixturePane } from './FixturePane'
import type { Sorting } from './AreaPane'
import { RESTING } from '../app/writing'
import type { AreaBook, AreaDto, FixtureDto, FurnitureDto, RuleDto } from '../lib/api'

const area = (over: Partial<AreaDto> = {}): AreaDto => ({
  id: 1, position: 0, label: '4A', name: '', startsAt: '', sortStrategy: 'inherit',
  ordering: 'author', selfContained: false, note: '', books: 8,
  holds: 'Non-fiction starts here', entry: true, rule: null, own: [], gone: false,
  ...over,
})

const fixture = (over: Partial<FixtureDto> = {}): FixtureDto => ({
  id: 1, position: 4, label: '4', kind: 'bookshelf', name: '', sortStrategy: 'inherit',
  note: '', books: 8, areas: [area(), area({ id: 2, position: 1, label: '4B' })],
  sharing: [], gone: [], holds: 'Anything tagged Non-fiction', rule: null, own: [],
  ...over,
})

const room: FurnitureDto = {
  fixtures: [fixture(), fixture({ id: 2, position: 5, label: '5', name: 'The landing' })],
  defaultSortStrategy: 'author',
  strategies: [{ code: 'inherit', label: 'Same as the shelf it is on', isInherit: true }],
}

const nothing = () => {}

const shelved = (over: Partial<AreaBook> = {}): AreaBook => ({
  id: 1,
  title: 'On Food and Cooking',
  authorFiling: 'McGee, Harold',
  spine: '',
  spineSlot: '',
  pages: '',
  titleFiling: 'On Food and Cooking',
  published: '1984',
  sortKey: 'MCGEE',
  tagSlugs: [],
  tags: [],
  claimedBy: 'Non-fiction',
  ...over,
})

function drawn(
  piece = room.fixtures[0]!,
  books: AreaBook[] = [],
  sorting: Sorting = { open: false, chosen: 'inherit', effect: '', busy: false },
  leaving = false,
): string {
  return renderToStaticMarkup(
    <FixturePane
      room={room}
      piece={piece}
      draft={{ name: piece.name, kind: '', order: room.fixtures.map((_, at) => at) }}
      books={books}
      sorting={sorting}
      writing={RESTING}
      removal={{ books: 8, assigned: 0, areas: 2, rules: 0, retires: false }}
      busy={false}
      error=""
      tabs={{ home: nothing, library: nothing, scan: nothing, queue: nothing }}
      leaving={leaving}
      unsaved={leaving}
      onBack={nothing}
      onAskLeave={nothing}
      onStay={nothing}
      onDraft={nothing}
      onSave={nothing}
      onChange={nothing}
      onCarry={nothing}
      onOpenSort={nothing}
      onChooseSort={nothing}
      onSaveSort={nothing}
      onCloseSort={nothing}
      onDelete={nothing}
    />,
  )
}

const words = (markup: string): string => markup.replace(/<[^>]*>/g, ' ')

describe('the edit view for a piece', () => {
  it('is what you call it, what it is, and where it stands', () => {
    const said = words(drawn())
    expect(said).toMatch(/What you call it/)
    expect(said).toMatch(/What it is/)
    expect(said).toMatch(/Where it stands/)
  })

  /**
   * The whole of the third thing in #367. The areas are not gone from the app,
   * they are on the room, drawn against the piece they are on, which is the
   * screen this one is opened from.
   */
  it('does not draw the piece, its areas, or a way to add one', () => {
    const markup = drawn()
    expect(markup).not.toMatch(/wf-nest/)
    expect(markup).not.toMatch(/wf-box__reads/)
    expect(markup).not.toMatch(/wf-add/)
    expect(words(markup)).not.toMatch(/Add an area to this bookcase/)
  })

  /** The preview of what the areas read as stays: it is a name, not a number. */
  it('still says what the areas will be called', () => {
    expect(words(drawn())).toMatch(/What it will be called/)
    expect(words(drawn())).toMatch(/4A, 4B/)
  })

  /**
   * The same number the room's own ordering column stopped drawing. It is
   * `fixture.position`, correct in the model and meaningless beside a piece
   * somebody has named.
   */
  it('draws no number beside a piece in the column', () => {
    expect(drawn()).toMatch(/wf-order__name/)
    expect(drawn()).not.toMatch(/wf-order__n"/)
  })
})

/**
 * The two rules a piece answers, which it did not answer at all until #381.
 *
 * > Whenever we're in the detailed view of a fixture or an area, we need to be
 * > able to very easily see and change the current sort rule and the current
 * > filter rule.
 *
 * They are the widgets an area's page draws, called from here, and the point of
 * the checks below is the two places where a piece is **not** an area. What it
 * inherits from is the whole library, because nothing stands between a piece and
 * the collection; and nothing overflows between pieces, so the sentence an area
 * carries about taking what came before it must not turn up on one.
 */
describe('the two rules on a piece', () => {
  const nonFiction: RuleDto = {
    id: 2,
    name: 'Non-fiction',
    about: 'fixture',
    place: '4',
    placeId: 1,
    enabled: true,
    conditions: [{ operator: 'is', tag: 'Non-fiction', carried: 412 }],
    said: 'Anything tagged Non-fiction',
    range: 'nonfiction',
  }
  /*
   * `own` is what is written on the piece and `rule` is the stretch of books it
   * opens. They are the same row here and they are not the same question: a
   * second rule on the piece would be another entry in `own` and would leave
   * `rule` alone, because both would open the one stretch. See #384.
   */
  const holding = fixture({ rule: nonFiction, own: [nonFiction] })

  it('shows what belongs on it and the one way to change that', () => {
    const said = words(drawn(holding))

    expect(said).toMatch(/Anything tagged Non-fiction/)
    expect(said).toMatch(/Tagged\s*Non-fiction/)
    expect(said).toMatch(/Change what belongs here/)
    expect(said).toMatch(/Move these books to another bookcase/)
  })

  /**
   * The same widget the area's page draws, leading with the same thing: the
   * ordering itself (#405). It headed this card "The way the whole library
   * does" for a round, which is where the answer comes from rather than what
   * it is, over three numbered levels two of which pointed at each other.
   */
  it('leads with the ordering itself, and says where it is set underneath', () => {
    const said = words(drawn(holding))

    expect(said).toMatch(/Sort rule/)
    expect(said).toMatch(/By the author/)
    expect(said).not.toMatch(/The way the whole library does/)
    expect(said).toMatch(/Set for the whole library, which Bookcase 4 follows/)
    // And what a piece decides for the areas standing on it, which is the half
    // of that sentence an area's own page has no reason to say.
    expect(said).toMatch(/every area on it that orders nothing of its own/)
  })

  /** A piece that states an ordering of its own is the one that decides. */
  it('says it is set here where the piece is the one that decides', () => {
    const said = words(drawn({ ...holding, sortStrategy: 'title' }))

    expect(said).toMatch(/By the title/)
    expect(said).toMatch(/Set here/)
  })

  /**
   * The two ends of the books, said the way the ordering reads. This is the
   * only evidence a piece's page carries once the answers are shut, because a
   * piece is more than one row of books and one row of books is one area, so
   * there is no board here to be the picture of them.
   */
  it('says the two ends of the books standing on it', () => {
    const said = words(drawn(holding, [
      shelved({ id: 1, authorFiling: 'McGee, Harold', sortKey: 'MCGEE' }),
      shelved({ id: 2, authorFiling: 'David, Elizabeth', sortKey: 'DAVID' }),
    ]))

    expect(said).toMatch(/David, Elizabeth\s+to\s+McGee, Harold/)
  })

  /** The same on this page, and this is the page it was got wrong on. */
  it('keeps the ordering in force at the top while the answers are open', () => {
    const said = words(drawn(holding, [shelved()], {
      open: true, chosen: 'published', effect: '', busy: false,
    }))

    expect(said).toMatch(/By the author\s+Sort rule/)
    expect(said).toMatch(/How they would stand/)
  })

  /**
   * The overflow sentence and the warning that goes with it belong to an area.
   * Books flow along a piece, never between two of them, so neither has any
   * counterpart here and neither is drawn.
   */
  it('never warns a piece about overflow, which does not happen to one', () => {
    const said = words(drawn(holding, [], {
      open: true, chosen: 'title', effect: '', busy: false,
    }))

    expect(said).not.toMatch(/overflows/)
  })

  /*
   * The overflow sentence belongs to an area and to nothing else. Books flow
   * along a piece, never between two of them, so a piece saying it takes what
   * came before it would be inventing a fact about somebody's room.
   */
  it('never says it takes what overflows from anything', () => {
    expect(words(drawn(holding))).not.toMatch(/overflows/)
  })

  it('shows what the ordering does to the books standing on it', () => {
    const said = words(drawn(holding, [
      shelved({ id: 1, authorFiling: 'McGee, Harold', sortKey: 'MCGEE' }),
      shelved({ id: 2, authorFiling: 'David, Elizabeth', sortKey: 'DAVID', title: 'Italian Food' }),
    ]))

    expect(said.indexOf('David, Elizabeth')).toBeLessThan(said.indexOf('McGee, Harold'))
  })
})

/**
 * #401: a piece whose areas were taken out with its books still standing on it.
 *
 * The top of this screen said "0 areas, 0 books" about the owner's bookcase 4 at
 * the same moment the carrying list named its areas as the place forty-six books
 * were leaving. Nought areas is true and stays, because the areas were taken off
 * the piece. Nought books was the defect.
 */
describe('a piece whose areas were taken out with books still on them', () => {
  const emptied = fixture({
    books: 46,
    areas: [],
    gone: [
      area({ id: 91, label: '4A', books: 8, gone: true }),
      area({ id: 92, label: '4B', books: 20, gone: true }),
      area({ id: 93, label: '4C', books: 18, gone: true }),
    ],
  })

  it('counts the books standing on it rather than the ones on its face', () => {
    expect(words(drawn(emptied))).toMatch(/0 areas, 46 books/)
  })

  it('names the areas that were taken out and what is standing on each', () => {
    const said = words(drawn(emptied))
    expect(said).toMatch(/Areas you took out/)
    expect(said).toMatch(/4A holds 8 books, 4B holds 20 books, 4C holds 18 books/)
  })

  it('says nothing has moved, because nothing has', () => {
    expect(words(drawn(emptied))).toMatch(/Nothing has moved/)
  })

  it('says nothing of the sort about a piece whose areas are all still there', () => {
    expect(words(drawn())).not.toMatch(/took out/)
  })
})

/**
 * #430 item 4, one screen over from where it was found.
 *
 * The area's page threw a typed name away on Back with no prompt and no trace.
 * This page holds more: what the piece is called, what it is, and the order the
 * room stands in, all of it in a draft until Save. Same defect, same sentence.
 */
describe('going back with a draft nobody has saved', () => {
  it('quotes the name back and names the button that keeps it', () => {
    const said = words(drawn(room.fixtures[0]!, [], undefined, true))

    expect(said).toMatch(/has not been saved/)
    expect(said).toMatch(/Going back now throws it away/)
    expect(said).toMatch(/Go back without it/)
  })

  it('draws no dialog at all where nothing has been typed', () => {
    expect(words(drawn())).not.toMatch(/has not been saved/)
  })
})

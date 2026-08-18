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
): string {
  return renderToStaticMarkup(
    <FixturePane
      room={room}
      piece={piece}
      draft={{ name: piece.name, kind: '', order: room.fixtures.map((_, at) => at) }}
      books={books}
      sorting={sorting}
      writing={RESTING}
      removal={{ books: 8, areas: 2, rules: 0, retires: false }}
      busy={false}
      error=""
      tabs={{ home: nothing, library: nothing, scan: nothing, queue: nothing }}
      onBack={nothing}
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

  it('says its ordering comes from the whole library and not from a piece', () => {
    const said = words(drawn(holding))

    expect(said).toMatch(/Sort rule/)
    expect(said).toMatch(/The way the whole library does/)
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

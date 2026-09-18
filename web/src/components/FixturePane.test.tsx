/** Rendered as markup: this project has no DOM in its test setup, and this pane holds no state. */

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

  it('does not draw the piece, its areas, or a way to add one', () => {
    const markup = drawn()
    expect(markup).not.toMatch(/wf-nest/)
    expect(markup).not.toMatch(/wf-box__reads/)
    expect(markup).not.toMatch(/wf-add/)
    expect(words(markup)).not.toMatch(/Add an area to this bookcase/)
  })

  it('still says what the areas will be called', () => {
    expect(words(drawn())).toMatch(/What it will be called/)
    expect(words(drawn())).toMatch(/4A, 4B/)
  })

  // `fixture.position` is correct in the model but meaningless beside a piece
  // somebody has named, so it is not drawn.
  it('draws no number beside a piece in the column', () => {
    expect(drawn()).toMatch(/wf-order__name/)
    expect(drawn()).not.toMatch(/wf-order__n"/)
  })
})

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
  // `own` is what is written on the piece; `rule` is the stretch of books it
  // opens. A second rule on the piece would add to `own` while `rule` stays
  // the same, since both would open one stretch.
  const holding = fixture({ rule: nonFiction, own: [nonFiction] })

  it('shows what belongs on it and the one way to change that', () => {
    const said = words(drawn(holding))

    expect(said).toMatch(/Anything tagged Non-fiction/)
    expect(said).toMatch(/Tagged\s*Non-fiction/)
    expect(said).toMatch(/Change what belongs here/)
    expect(said).toMatch(/Move these books to another bookcase/)
  })

  it('leads with the ordering itself, and says where it is set underneath', () => {
    const said = words(drawn(holding))

    expect(said).toMatch(/Sort rule/)
    expect(said).toMatch(/By the author/)
    expect(said).not.toMatch(/The way the whole library does/)
    expect(said).toMatch(/Set for the whole library, which Bookcase 4 follows/)
    expect(said).toMatch(/every area on it that orders nothing of its own/)
  })

  it('says it is set here where the piece is the one that decides', () => {
    const said = words(drawn({ ...holding, sortStrategy: 'title' }))

    expect(said).toMatch(/By the title/)
    expect(said).toMatch(/Set here/)
  })

  it('says the two ends of the books standing on it', () => {
    const said = words(drawn(holding, [
      shelved({ id: 1, authorFiling: 'McGee, Harold', sortKey: 'MCGEE' }),
      shelved({ id: 2, authorFiling: 'David, Elizabeth', sortKey: 'DAVID' }),
    ]))

    expect(said).toMatch(/David, Elizabeth\s+to\s+McGee, Harold/)
  })

  it('keeps the ordering in force at the top while the answers are open', () => {
    const said = words(drawn(holding, [shelved()], {
      open: true, chosen: 'published', effect: '', busy: false,
    }))

    expect(said).toMatch(/By the author\s+Sort rule/)
    expect(said).toMatch(/How they would stand/)
  })

  it('never warns a piece about overflow, which does not happen to one', () => {
    const said = words(drawn(holding, [], {
      open: true, chosen: 'title', effect: '', busy: false,
    }))

    expect(said).not.toMatch(/overflows/)
  })

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

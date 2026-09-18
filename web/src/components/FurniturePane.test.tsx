/** Rendered as markup: this project has no DOM in its test setup, and this pane holds no state. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FurniturePane } from './FurniturePane'
import type { AreaDto, FixtureDto, FurnitureDto } from '../lib/api'

const area = (over: Partial<AreaDto> = {}): AreaDto => ({
  id: 1, position: 0, label: '4A', name: '', startsAt: '', sortStrategy: 'inherit',
  ordering: 'author', selfContained: false, note: '', books: 8,
  holds: 'Non-fiction starts here', entry: true, rule: null, own: [], gone: false,
  ...over,
})

const fixture = (over: Partial<FixtureDto> = {}): FixtureDto => ({
  id: 1, position: 4, label: '4', kind: 'bookshelf', name: '', sortStrategy: 'inherit',
  note: '', books: 8, areas: [area()], sharing: [], gone: [],
  holds: 'Anything tagged Non-fiction', rule: null, own: [],
  ...over,
})

const furniture = (fixtures: FixtureDto[]): FurnitureDto => ({
  fixtures,
  defaultSortStrategy: 'author',
  strategies: [{ code: 'inherit', label: 'Same as the shelf it is on', isInherit: true }],
})

const nothing = () => {}

function drawn(room: FurnitureDto | null, ordering: number[] | null = null): string {
  return renderToStaticMarkup(
    <FurniturePane
      room={room}
      ordering={ordering}
      busy={false}
      error=""
      tabs={{ home: nothing, library: nothing, scan: nothing, queue: nothing }}
      onBack={nothing}
      onFixture={nothing}
      onArea={nothing}
      onAddArea={nothing}
      onAddFixture={nothing}
      onOrder={nothing}
      onReorder={nothing}
      onSaveOrder={nothing}
      onKeepOrder={nothing}
    />,
  )
}

/** The words on the screen, with the markup and therefore the class names gone. */
const words = (markup: string): string => markup.replace(/<[^>]*>/g, ' ')

describe('the room, drawn', () => {
  it('names an unnamed piece by what it is and where it stands', () => {
    expect(words(drawn(furniture([fixture()])))).toMatch(/Bookcase 4/)
    expect(words(drawn(furniture([fixture({ kind: 'crate' })])))).toMatch(/Crate 4/)
  })

  it('calls a named piece what it is called, and never by its number', () => {
    const said = words(drawn(furniture([fixture({ name: 'By the window' })])))
    expect(said).toMatch(/By the window/)
    expect(said).not.toMatch(/Bookcase 4/)
  })

  it('says what belongs on every piece and in every area', () => {
    const said = words(drawn(furniture([
      fixture(),
      fixture({ id: 2, position: 5, holds: 'No rule sends books here', areas: [
        area({ id: 3, label: '5A', holds: 'Put here by hand', entry: true }),
      ] }),
    ])))

    expect(said).toMatch(/Anything tagged Non-fiction/)
    expect(said).toMatch(/Non-fiction starts here/)
    expect(said).toMatch(/No rule sends books here/)
    expect(said).toMatch(/Put here by hand/)
  })

  // Two fixtures can legally share a position number; without saying so, the
  // screen would show `4A` twice with no explanation.
  it('survives two pieces standing on one number, and says they do', () => {
    const said = words(drawn(furniture([
      fixture({ id: 1, sharing: [2] }),
      fixture({ id: 2, sharing: [1], areas: [area({ id: 2 })] }),
    ])))

    expect(said).toMatch(/two pieces stand at 4/)
    expect(said.match(/4A/g)).toHaveLength(2)
  })

  it('never says "1 books"', () => {
    expect(words(drawn(furniture([fixture({ books: 1, areas: [area({ books: 1 })] })]))))
      .not.toMatch(/1 books/)
  })

  it('offers a way to add an area to each piece, in that piece\'s own words', () => {
    const said = words(drawn(furniture([
      fixture(), fixture({ id: 2, kind: 'desk', position: 5 }),
    ])))
    expect(said).toMatch(/Add an area to this bookcase/)
    expect(said).toMatch(/Add an area to this desk/)
  })

  /** A piece arrives with no areas, because it has no books on it to cut. */
  it('draws a piece nobody has cut yet', () => {
    expect(() => drawn(furniture([fixture({ areas: [], books: 0 })]))).not.toThrow()
  })

  it('says nothing at all before the room has come back', () => {
    const said = words(drawn(null))
    expect(said).not.toMatch(/Nothing is in the room/)
    expect(said).not.toMatch(/Add a fixture/)
  })

  it('says the room is empty once it knows that it is', () => {
    expect(words(drawn(furniture([])))).toMatch(/Nothing is in the room yet/)
  })

  it('offers to change the order only where there is an order to change', () => {
    expect(words(drawn(furniture([fixture()])))).not.toMatch(/Change the order/)
    expect(words(drawn(furniture([fixture(), fixture({ id: 2 })])))).toMatch(/Change the order/)
  })
})

describe('putting the room in order', () => {
  const three = furniture([
    fixture({ id: 1, position: 1, label: '1' }),
    fixture({ id: 2, position: 2, label: '2' }),
    fixture({ id: 3, position: 4, label: '4' }),
  ])

  it('draws the pieces in the order they are being dragged into', () => {
    const said = words(drawn(three, [2, 0, 1]))
    expect(said.indexOf('Bookcase 4')).toBeLessThan(said.indexOf('Bookcase 1'))
  })

  it('draws no number beside a piece', () => {
    const markup = drawn(three, [2, 0, 1])
    expect(markup).toMatch(/wf-order__name/)
    expect(markup).not.toMatch(/wf-order__n"/)
  })

  // Position numbers are the room's own and stay fixed: renumbering 1, 2, 4
  // to 1, 2, 3 would rewrite the recorded location of every book on the
  // piece currently called 4.
  it('promises what the pieces will be called, and not what they will be numbered', () => {
    const said = words(drawn(three, [2, 0, 1]))
    expect(said).toMatch(/What they will be called/)
    expect(said).toMatch(/Bookcase 4 becomes Bookcase 1/)
    expect(said).toMatch(/That changes 3 area labels as well, 4A to 1A/)
  })

  it('says a named room is renamed by nothing', () => {
    const named = furniture([
      fixture({ id: 1, position: 1, name: 'Bookshelf 1' }),
      fixture({ id: 2, position: 4, name: 'Bookshelf 2' }),
      fixture({ id: 3, position: 5, name: 'Bookshelf 3' }),
    ])
    expect(words(drawn(named, [2, 0, 1]))).toMatch(/Nothing is renamed/)
  })

  it('does not credit a name for a room nobody has dragged yet', () => {
    const said = words(drawn(three, [0, 1, 2]))
    expect(said).toMatch(/Nothing has moved yet/)
    expect(said).not.toMatch(/Nothing is renamed/)
  })

  it('writes nothing until it is saved, and offers to leave it alone', () => {
    const said = words(drawn(three, [0, 1, 2]))
    expect(said).toMatch(/Save the order/)
    expect(said).toMatch(/Leave it as it is/)
  })
})

describe('a piece whose areas were taken out with books still on them', () => {
  const emptied = fixture({
    id: 9,
    position: 4,
    books: 46,
    areas: [],
    gone: [
      area({ id: 91, label: '4A', books: 8, gone: true }),
      area({ id: 92, label: '4B', books: 20, gone: true }),
      area({ id: 93, label: '4C', books: 18, gone: true }),
    ],
    holds: 'No rule sends books here',
  })

  it('says how many books are on it rather than nought', () => {
    expect(words(drawn(furniture([emptied])))).toMatch(/46 books/)
  })

  it('draws every area that was taken out, with what is standing on it', () => {
    const said = words(drawn(furniture([emptied])))
    for (const [label, books] of [['4A', 8], ['4B', 20], ['4C', 18]] as const) {
      expect(said).toMatch(new RegExp(`${label}\\s+${books} books`))
    }
  })

  it('says they were taken out, so they do not read as areas that are there', () => {
    expect(words(drawn(furniture([emptied])))).toMatch(/Taken out/)
    expect(drawn(furniture([emptied]))).toMatch(/wf-box--gone/)
  })

  it('says the one book on one of them in the singular', () => {
    const one = fixture({
      id: 9, position: 4, books: 1, areas: [],
      gone: [area({ id: 91, label: '4A', books: 1, gone: true })],
    })
    const said = words(drawn(furniture([one])))
    expect(said).not.toMatch(/1 books/)
    expect(said).toMatch(/This book is still here/)
  })

  it('still offers the way to put an area back on it', () => {
    expect(words(drawn(furniture([emptied])))).toMatch(/Add an area to this bookcase/)
  })
})

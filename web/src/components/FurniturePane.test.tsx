/**
 * The room screen, against a room rather than a tidy one.
 *
 * Rendered as markup and read as markup, the way `HomePane.test.tsx` does it:
 * this project has no DOM in its test setup, and this pane holds no state.
 *
 * What is checked is what a wireframe never had to survive, which is every
 * awkward thing about the owner's actual house: **two pieces both standing at
 * 4**, a piece nothing files onto, a piece that is a crate, an area holding one
 * book, and a room nobody has described yet.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FurniturePane } from './FurniturePane'
import type { AreaDto, FixtureDto, FurnitureDto } from '../lib/api'

const area = (over: Partial<AreaDto> = {}): AreaDto => ({
  id: 1, position: 0, label: '4A', name: '', startsAt: '', sortStrategy: 'inherit',
  ordering: 'author', selfContained: false, note: '', books: 8,
  holds: 'Non-fiction starts here', entry: true, rule: null,
  ...over,
})

const fixture = (over: Partial<FixtureDto> = {}): FixtureDto => ({
  id: 1, position: 4, label: '4', kind: 'bookshelf', name: '', sortStrategy: 'inherit',
  note: '', books: 8, areas: [area()], sharing: [],
  holds: 'Anything tagged Non-fiction', rule: null,
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

  /**
   * The question the whole screen exists for. Every area says what files onto
   * it, and a piece nothing files onto says that rather than saying nothing,
   * because "nothing" is the answer for a crate by the door.
   */
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

  /**
   * The owner has two pieces both called 4, which the catalogue reports rather
   * than refuses. Both draw areas labelled `4A`, so a screen that did not say
   * so would show one twice with no explanation and somebody would go looking
   * for the mistake in the wrong place.
   */
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

  /**
   * Drawing an empty room while the first request is in flight would be saying
   * something false about somebody's house for as long as it takes.
   */
  it('says nothing at all before the room has come back', () => {
    const said = words(drawn(null))
    expect(said).not.toMatch(/Nothing is in the room/)
    expect(said).not.toMatch(/Add a fixture/)
  })

  it('says the room is empty once it knows that it is', () => {
    expect(words(drawn(furniture([])))).toMatch(/Nothing is in the room yet/)
  })

  /** One piece cannot be put in a different order to itself. */
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

  /**
   * The numbers are this room's own, gap and all. Renumbering 1, 2, 4 to 1, 2,
   * 3 because somebody dragged something would rewrite the recorded location of
   * every book on the piece called 4.
   */
  it('promises the room its own numbers back and no others', () => {
    const said = words(drawn(three, [2, 0, 1]))
    expect(said).toMatch(/Bookcase 4 1, Bookcase 1 2, Bookcase 2 4/)
  })

  it('writes nothing until it is saved, and offers to leave it alone', () => {
    const said = words(drawn(three, [0, 1, 2]))
    expect(said).toMatch(/Save the order/)
    expect(said).toMatch(/Leave it as it is/)
  })
})

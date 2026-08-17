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
import type { AreaDto, FixtureDto, FurnitureDto } from '../lib/api'

const area = (over: Partial<AreaDto> = {}): AreaDto => ({
  id: 1, position: 0, label: '4A', name: '', startsAt: '', sortStrategy: 'inherit',
  ordering: 'author', selfContained: false, note: '', books: 8,
  holds: 'Non-fiction starts here', entry: true, rule: null,
  ...over,
})

const fixture = (over: Partial<FixtureDto> = {}): FixtureDto => ({
  id: 1, position: 4, label: '4', kind: 'bookshelf', name: '', sortStrategy: 'inherit',
  note: '', books: 8, areas: [area(), area({ id: 2, position: 1, label: '4B' })],
  sharing: [], holds: 'Anything tagged Non-fiction', rule: null,
  ...over,
})

const room: FurnitureDto = {
  fixtures: [fixture(), fixture({ id: 2, position: 5, label: '5', name: 'The landing' })],
  defaultSortStrategy: 'author',
  strategies: [{ code: 'inherit', label: 'Same as the shelf it is on', isInherit: true }],
}

const nothing = () => {}

function drawn(piece = room.fixtures[0]!): string {
  return renderToStaticMarkup(
    <FixturePane
      room={room}
      piece={piece}
      draft={{ name: piece.name, kind: '', order: room.fixtures.map((_, at) => at) }}
      removal={{ books: 8, areas: 2, rules: 0, retires: false }}
      busy={false}
      error=""
      tabs={{ home: nothing, library: nothing, scan: nothing, queue: nothing }}
      onBack={nothing}
      onDraft={nothing}
      onSave={nothing}
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

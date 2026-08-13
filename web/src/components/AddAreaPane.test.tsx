/**
 * Cutting an area in two, and the thing that screen gets wrong if nobody
 * watches it.
 *
 * The new area lands **directly after the area being cut**, so every area
 * behind it reads differently the moment it exists. Drawn as "4C, new" bolted
 * onto the end of the list as it stands, the screen shows two areas called `4C`
 * and promises a name the answer will disagree with. The labels here are worked
 * out from the positions the areas will have, by the same function the server
 * works the real ones out with.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AddAreaPane, type SplitBook } from './AddAreaPane'
import type { AreaDto, FixtureDto } from '../lib/api'

const area = (position: number, label: string, books: number): AreaDto => ({
  id: position + 1, position, label, name: '', startsAt: '', sortStrategy: 'inherit',
  ordering: 'author', selfContained: false, note: '', books,
  holds: 'Non-fiction, carrying on', entry: false, rule: null,
})

const piece: FixtureDto = {
  id: 4, position: 4, label: '4', kind: 'bookshelf', name: '', sortStrategy: 'inherit',
  note: '', books: 7,
  areas: [area(0, '4A', 2), area(1, '4B', 4), area(2, '4C', 1)],
  sharing: [],
  holds: 'Anything tagged Non-fiction',
  rule: null,
}

const books: SplitBook[] = [
  { id: 1, title: 'Sapiens', authorFiling: 'Harari, Yuval Noah', sortKey: 'a' },
  { id: 2, title: 'A Brief History of Time', authorFiling: 'Hawking, Stephen', sortKey: 'b' },
  { id: 3, title: 'The Sixth Extinction', authorFiling: 'Kolbert, Elizabeth', sortKey: 'c' },
  { id: 4, title: 'Cosmos', authorFiling: 'Sagan, Carl', sortKey: 'd' },
]

const nothing = () => {}

function drawn(
  over: { area?: AreaDto | null; at?: number | null; books?: SplitBook[] } = {},
): string {
  return renderToStaticMarkup(
    <AddAreaPane
      piece={piece}
      area={over.area === undefined ? piece.areas[1]! : over.area}
      books={over.books ?? books}
      at={over.at ?? null}
      busy={false}
      error=""
      tabs={{ home: nothing, library: nothing, scan: nothing, queue: nothing }}
      onBack={nothing}
      onPick={nothing}
      onAdd={nothing}
    />,
  )
}

const words = (markup: string): string => markup.replace(/<[^>]*>/g, ' ')

/** The labels of the boxes under the piece, in the order they are drawn. */
const reading = (markup: string): string[] =>
  [...markup.matchAll(/<span class="wf-box__reads">([^<]+)<\/span>/g)].map((one) => one[1]!)

describe('cutting an area in two', () => {
  it('shuffles every label behind the new one rather than showing two of them', () => {
    expect(reading(drawn({ at: 2 }))).toEqual(['4A', '4B', '4C, new', '4D'])
  })

  it('splits the count between the two of them at the book that was picked', () => {
    const said = words(drawn({ at: 2 }))
    expect(said).toMatch(/4B keeps 2 books, the new one takes 2 books/)
  })

  /**
   * The counts above are where the books belong. The count on the new area
   * reads nought until somebody has been to the shelf, because a count is where
   * a person last said the books were and cutting an area is not somebody
   * saying it. Unsaid, the split looks like it did not work.
   */
  it('says the books do not move and have to be confirmed', () => {
    const said = words(drawn({ at: 2 }))
    expect(said).toMatch(/Nothing moves and nothing is carried/)
    expect(said).toMatch(/still counted on 4B/)
  })

  it('cuts nothing until a book has been picked, and says so', () => {
    const said = words(drawn())
    expect(said).toMatch(/Nothing is cut until you say which book the new area starts at/)
    expect(said).not.toMatch(/keeps/)
  })

  it('marks the book the new area starts at', () => {
    expect(words(drawn({ at: 2 }))).toMatch(/The Sixth Extinction\s+Kolbert, Elizabeth\s+Starts here/)
  })

  /**
   * A piece nobody has cut yet has no books on it to cut, so the first area
   * opens at the beginning and there is no list to draw.
   */
  it('draws no list for a piece with no areas on it', () => {
    const bare = { ...piece, areas: [], books: 0 }
    const markup = renderToStaticMarkup(
      <AddAreaPane
        piece={bare}
        area={null}
        books={[]}
        at={null}
        busy={false}
        error=""
        tabs={{ home: nothing, library: nothing, scan: nothing, queue: nothing }}
        onBack={nothing}
        onPick={nothing}
        onAdd={nothing}
      />,
    )
    expect(reading(markup)).toEqual(['4A, new'])
    expect(words(markup)).toMatch(/Nothing has been cut into Bookcase 4 yet/)
    expect(words(markup)).toMatch(/Bookcase 4 gets its first area/)
  })

  /**
   * A crate nothing files onto is filled by hand, and cutting it in two does
   * not change that: nothing runs on into the new area because nothing runs.
   */
  it('says what will actually reach the new area', () => {
    expect(words(drawn({ at: 1 }))).toMatch(/Put here by hand/)
  })
})

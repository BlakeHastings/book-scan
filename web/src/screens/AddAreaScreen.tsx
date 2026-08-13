/**
 * Cutting another area into a piece of furniture.
 *
 * ## Where the books come from, and why it is two requests
 *
 * A boundary is a book: the first one of the new area. The furniture routes
 * describe the room and count what stands in each area, and they do not list
 * books, so the books come from the shelves, which are answered a run at a
 * time. Which run an area is in is a question with no route on it either, so
 * both are asked and the one holding an area of this label is the one that
 * answers. A crate nothing files onto is in neither, which is correct: there is
 * no order to cut.
 *
 * That is a departure worth naming rather than hiding, and it is named in the
 * pull request: a route that answered "the books standing in this area" would
 * replace both requests and the matching between them.
 */

import { useEffect, useState } from 'react'
import { AddAreaPane, type SplitBook } from '../components/AddAreaPane'
import { useArranging } from '../app/arranging'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api } from '../lib/api'

export function AddAreaScreen() {
  const { setRoute } = useNavigation()
  const { fixtureId, areaId, setAreaId } = useArranging()
  const { room, error, setError, busy, write } = useRoom()
  const [books, setBooks] = useState<SplitBook[]>([])
  const [at, setAt] = useState<number | null>(null)
  const tabs = useRoomTabs()
  useDesignPage()

  const piece = room?.fixtures.find((one) => one.id === fixtureId) ?? null
  /*
   * The area being cut. Arriving from an area screen it is that area; arriving
   * from "add an area to this bookcase" it is the last one on the piece,
   * because an area added after the last one still has to say where it starts.
   */
  const area = piece
    ? piece.areas.find((one) => one.id === areaId) ?? piece.areas[piece.areas.length - 1] ?? null
    : null

  useEffect(() => {
    if (!area) return
    let stale = false
    Promise.all([api.shelves('fiction'), api.shelves('nonfiction')])
      .then(([fiction, nonfiction]) => {
        if (stale) return
        const group = [...fiction.groups, ...nonfiction.groups]
          .find((one) => one.label === area.label)
        setBooks((group?.books ?? []).map(({ book }): SplitBook => ({
          id: book.id,
          title: book.title,
          authorFiling: book.author_filing,
          sortKey: book.sort_key,
        })))
      })
      .catch((caught) => setError((caught as Error).message))
    return () => { stale = true }
  }, [area, setError])

  const add = async () => {
    if (!piece) return
    const start = at === null ? null : books[at] ?? null
    const done = await write(() => api.addArea(piece.id, {
      position: area ? area.position + 1 : 0,
      startsAt: start ? start.sortKey : '',
    }))
    if (done) {
      setAreaId(done.area.id)
      setRoute('area')
    }
  }

  return (
    <AddAreaPane
      piece={piece}
      area={piece && piece.areas.length ? area : null}
      books={books}
      at={at}
      busy={busy}
      error={error}
      tabs={tabs}
      onBack={() => setRoute(areaId === null ? 'fixture' : 'area')}
      onPick={setAt}
      onAdd={add}
    />
  )
}

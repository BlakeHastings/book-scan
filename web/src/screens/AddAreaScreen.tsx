/**
 * Cutting another area into a piece of furniture.
 *
 * ## Where the books come from
 *
 * A boundary is a book: the first one of the new area. So this screen needs the
 * books standing in the area being cut, and it asks the area for them, by its
 * row: `GET /api/areas/:id/books`.
 *
 * **That route is what #318 asked for and #323 built, and it replaced a match on
 * labels.** There was no route that listed an area's books, so #313 asked for
 * both stretches of shelving and took the group whose *label* equalled this
 * area's. A label is worked out at read time from a piece's number and name and
 * an area's ordinal and name, and is stored nowhere precisely so that nothing
 * depends on it holding still. A rename, a reorder, or the owner's two pieces of
 * furniture both standing at 4 would each have handed this screen somebody
 * else's books, and it would have cut the boundary silently in the wrong place.
 *
 * A piece nothing files onto answers an empty list, which is correct: there is
 * no order to cut.
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

  const cutting = area?.id ?? null

  useEffect(() => {
    if (cutting === null) return
    let stale = false
    api.areaBooks(cutting)
      .then((read) => {
        if (stale) return
        setBooks(read.books.map(({ id, title, authorFiling, sortKey }): SplitBook =>
          ({ id, title, authorFiling, sortKey })))
      })
      .catch((caught) => setError((caught as Error).message))
    return () => { stale = true }
  }, [cutting, setError])

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

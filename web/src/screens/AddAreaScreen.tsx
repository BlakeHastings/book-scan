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
 *
 * ## With no books there is no decision, and the button used to wait for one
 *
 * The screen exists to ask which book the new area starts at, so it would not
 * let anybody past until one had been picked. On a run with nothing standing in
 * it there is no book to pick and there never will be, so the button was dead:
 * pressing "add the area" did nothing at all, for ever (#367). The owner: "if
 * the user adds a new area to the fixture and there's no books there, there's no
 * decision to be made, we should just add it."
 *
 * **So the empty run is added straight away, anchored where the run it follows
 * is anchored.** Not at the beginning: the areas of a piece are read in the
 * order the books run along it and the server refuses a face whose anchors do
 * not ascend, so an area cut in after `Cookery` cannot open before it. Equal
 * anchors are allowed and are already real in this catalogue, which is what an
 * area emptied by a boundary move leaves behind; the new area takes the empty
 * stretch its neighbour was holding, and because that stretch is empty no book
 * moves and nothing is carried.
 *
 * **Whether the run is empty is a fact this screen has to wait for.** The books
 * arrive from a request, so "none came back" and "none have come back yet" look
 * identical for as long as it takes, and offering the decisionless version of
 * the screen in that gap would let somebody cut an unanchored area into a run
 * of books by pressing quickly.
 */

import { useEffect, useState } from 'react'
import { AddAreaPane, type SplitBook } from '../components/AddAreaPane'
import { useArranging } from '../app/arranging'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api } from '../lib/api'

export function AddAreaScreen() {
  const { fixtureId, areaId, setAreaId, instead, back } = useArranging()
  const { room, error, setError, busy, write } = useRoom()
  const [books, setBooks] = useState<SplitBook[]>([])
  const [coming, setComing] = useState(true)
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
    // A piece with no areas has no run to ask about, and it is the one case
    // where an empty list is known without asking anybody.
    if (cutting === null) { setComing(false); return }
    let stale = false
    setComing(true)
    api.areaBooks(cutting)
      .then((read) => {
        if (stale) return
        setBooks(read.books.map(({ id, title, authorFiling, sortKey }): SplitBook =>
          ({ id, title, authorFiling, sortKey })))
        setComing(false)
      })
      .catch((caught) => {
        if (stale) return
        setError((caught as Error).message)
        setComing(false)
      })
    return () => { stale = true }
  }, [cutting, setError])

  const add = async () => {
    if (!piece) return
    const start = at === null ? null : books[at] ?? null
    const done = await write(() => api.addArea(piece.id, {
      position: area ? area.position + 1 : 0,
      /*
       * Three cases and one line. A book was picked, so the new area opens at
       * it; there is no area to cut, so it opens at the beginning; or the run
       * it follows is empty, so it opens where that run opens, which is the
       * only anchor that both ascends and takes no book off anybody.
       */
      startsAt: start ? start.sortKey : area ? area.startsAt : '',
    }))
    if (done) {
      setAreaId(done.area.id)
      // The area that has just been made, in the place of the screen that made
      // it: back from it is where the adding was started, not this screen again.
      instead('area')
    }
  }

  return (
    <AddAreaPane
      piece={piece}
      area={piece && piece.areas.length ? area : null}
      books={books}
      coming={coming}
      at={at}
      busy={busy}
      error={error}
      tabs={tabs}
      /*
       * Where somebody came from, which is the room as often as it is the
       * piece: this screen is reached from the room's own list, from an area
       * being split, and it used to answer all of them with the piece's edit
       * page (#367).
       */
      onBack={() => back('fixture')}
      onPick={setAt}
      onAdd={add}
    />
  )
}

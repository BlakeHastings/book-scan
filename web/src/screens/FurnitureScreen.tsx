/**
 * The room, and the two things you can do to it as a whole: add a piece, and
 * put the pieces in order.
 *
 * ## A new piece arrives with no areas, and this screen opens it
 *
 * An area is a decision about where one run of books stops and the next
 * begins, and a piece somebody has only just named has no books on it to cut.
 * So adding one writes the piece and goes straight to its own screen, which is
 * where it gets a name and where the first area is cut into it.
 *
 * ## Saving an order is several writes, and only the ones that changed
 *
 * There is one route for a piece's number and this screen can move five of
 * them at once, so it writes each piece whose number is no longer where it
 * stands. **The owner has two pieces both standing at 4**, and nothing here
 * renumbers a piece for being beside one: see `renumbering`.
 */

import { useState } from 'react'
import { FurniturePane } from '../components/FurniturePane'
import { useArranging } from '../app/arranging'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api } from '../lib/api'
import { renumbering } from '../lib/furniture'

export function FurnitureScreen() {
  const { leaveRoom, setRoute } = useNavigation()
  const { openFixture, openArea, setFixtureId, setAreaId } = useArranging()
  const { room, error, busy, write } = useRoom()
  const [ordering, setOrdering] = useState<number[] | null>(null)
  const tabs = useRoomTabs()
  useDesignPage()

  const addFixture = async () => {
    const added = await write(() => api.addFixture({ kind: 'bookshelf' }))
    if (added) openFixture(added.fixture.id)
  }

  const saveOrder = async () => {
    if (!room || !ordering) return
    const wanted = renumbering(ordering.map((at) => room.fixtures[at]!))
    const done = await write(async () => {
      for (const piece of wanted) await api.editFixture(piece.id, { position: piece.position })
      return true
    })
    if (done) setOrdering(null)
  }

  return (
    <FurniturePane
      room={room}
      ordering={ordering}
      busy={busy}
      error={error}
      tabs={tabs}
      /*
       * Back to wherever this was opened from (#350), which is the wrinkle
       * #333 named and left: this went to the library and nowhere else, so
       * walking in from the corner and straight back out landed you on your
       * books rather than where you started. The corner is on two screens now,
       * so a fixed target would be wrong more often than right.
       */
      onBack={leaveRoom}
      onFixture={openFixture}
      onArea={openArea}
      onAddArea={(fixtureId) => {
        /*
         * Adding an area to a piece is cutting the last one it has, because
         * that is what an area is. `AddAreaScreen` picks the area to cut when
         * it is not told one, so nothing is chosen here.
         */
        setFixtureId(fixtureId)
        setAreaId(null)
        setRoute('addarea')
      }}
      onAddFixture={addFixture}
      onOrder={() => setOrdering(room ? room.fixtures.map((_, at) => at) : null)}
      onReorder={setOrdering}
      onSaveOrder={saveOrder}
      onKeepOrder={() => setOrdering(null)}
    />
  )
}

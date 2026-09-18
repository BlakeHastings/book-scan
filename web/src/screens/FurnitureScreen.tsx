/**
 * Adding an area writes immediately with no screen in between: it is safe because it relabels
 * nothing, since a label comes from a piece's number and name plus an area's ordinal and name,
 * and an area added at the end takes an ordinal nothing else has. Where it opens is the server's
 * answer, chosen so that no book changes the area it belongs to; see `anchorForNewArea`.
 *
 * Saving an order writes only the pieces whose number changed; see `renumbering` for why two
 * pieces can validly stand at the same number and neither gets renumbered for being beside one.
 */

import { useState } from 'react'
import { FurniturePane } from '../components/FurniturePane'
import { useArranging } from '../app/arranging'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api } from '../lib/api'
import { renumbering } from '../lib/furniture'

export function FurnitureScreen() {
  const { leaveRoom } = useNavigation()
  const { openFixture, openArea } = useArranging()
  const { room, error, busy, write } = useRoom()
  const [ordering, setOrdering] = useState<number[] | null>(null)
  const tabs = useRoomTabs()
  useDesignPage()

  const addFixture = async () => {
    const added = await write(() => api.addFixture({ kind: 'bookshelf' }))
    if (added) openFixture(added.fixture.id)
  }

  const addArea = (fixtureId: number) => write(() => api.addArea(fixtureId))

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
      onBack={leaveRoom}
      onFixture={openFixture}
      onArea={openArea}
      onAddArea={(fixtureId) => { void addArea(fixtureId) }}
      onAddFixture={addFixture}
      onOrder={() => setOrdering(room ? room.fixtures.map((_, at) => at) : null)}
      onReorder={setOrdering}
      onSaveOrder={saveOrder}
      onKeepOrder={() => setOrdering(null)}
    />
  )
}

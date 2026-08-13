/** What files onto this area, and what beats what when two rules want a book. */

import { BelongsPane } from '../components/BelongsPane'
import { useArranging } from '../app/arranging'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'

export function BelongsScreen() {
  const { setRoute } = useNavigation()
  const { fixtureId, areaId } = useArranging()
  const { room, error } = useRoom()
  const tabs = useRoomTabs()
  useDesignPage()

  const piece = room?.fixtures.find((one) => one.id === fixtureId) ?? null
  const area = piece?.areas.find((one) => one.id === areaId) ?? null

  return (
    <BelongsPane
      room={room}
      piece={piece}
      area={area}
      error={error}
      tabs={tabs}
      onBack={() => setRoute('area')}
    />
  )
}

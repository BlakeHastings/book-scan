/**
 * How your books are ordered goes to the server, since it is one row in the collection the
 * whole house shares; it goes through `useRoom`, so the answer is re-read after the write
 * rather than assumed.
 *
 * Which hand you hold the phone in and which picture of a book comes first both stay on the
 * phone: nobody signs in, so a preference written to the collection would be one person in
 * the house deciding for everybody.
 */

import { useState } from 'react'
import { SettingsPane } from '../components/SettingsPane'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { useSummary } from '../app/summary'
import { api, type SortStrategyCode } from '../lib/api'
import { rememberFirstPicture, rememberedFirstPicture } from '../lib/firstPicture'
import { rememberHand, rememberedHand } from '../lib/hand'

export function SettingsScreen() {
  const { leaveRoom } = useNavigation()
  const { room, error, busy, write } = useRoom()
  const [hand, setHand] = useState(rememberedHand)
  const [firstPicture, setFirstPicture] = useState(rememberedFirstPicture)
  const tabs = useRoomTabs()
  // Off the health read the app already makes on every change of screen, so this screen costs no request of its own.
  const { lookups } = useSummary()
  useDesignPage()

  return (
    <SettingsPane
      room={room}
      hand={hand}
      firstPicture={firstPicture}
      busy={busy}
      error={error}
      tabs={tabs}
      lookups={lookups}
      onBack={leaveRoom}
      onOrder={(code: SortStrategyCode) => { void write(() => api.editCollection(code)) }}
      onHand={(next) => { setHand(next); rememberHand(next) }}
      onFirstPicture={(next) => { setFirstPicture(next); rememberFirstPicture(next) }}
    />
  )
}

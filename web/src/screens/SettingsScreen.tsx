/**
 * Settings, and the two writes behind it.
 *
 * The screen the corner's menu opens second (#350). `SettingsPane` carries the
 * argument about what is on it and what is deliberately not; this is the
 * wiring, and the two halves are wired differently on purpose.
 *
 * **How your books are ordered goes to the server**, because it is one row in
 * the collection and the whole house shares it. It goes through `useRoom`,
 * which is the hook the six furniture screens already use, so the answer is
 * re-read after the write rather than assumed: this screen draws what the
 * server says the ordering is and never what it just asked for.
 *
 * **Which hand you hold the phone in stays on the phone**, because it is about
 * the hand holding this particular device and not about the collection. It is
 * the same stored answer the camera reads, in `lib/hand.ts`, so choosing it
 * here moves the shutter there.
 *
 * **Which picture of a book comes first stays on the phone too** (#365), and
 * for the same reason as the hand: nobody signs in, so a preference written to
 * the collection would be one person in the house deciding for everybody. It is
 * the same stored answer a book's page reads, in `lib/firstPicture.ts`, so
 * choosing it here changes what the next book you open shows you.
 *
 * The way back is wherever the corner was pressed, which is `leaveRoom`. This
 * screen can be arrived at from the first screen or from the library and both
 * have to be returned to.
 */

import { useState } from 'react'
import { SettingsPane } from '../components/SettingsPane'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api, type SortStrategyCode } from '../lib/api'
import { rememberFirstPicture, rememberedFirstPicture } from '../lib/firstPicture'
import { rememberHand, rememberedHand } from '../lib/hand'

export function SettingsScreen() {
  const { leaveRoom } = useNavigation()
  const { room, error, busy, write } = useRoom()
  const [hand, setHand] = useState(rememberedHand)
  const [firstPicture, setFirstPicture] = useState(rememberedFirstPicture)
  const tabs = useRoomTabs()
  useDesignPage()

  return (
    <SettingsPane
      room={room}
      hand={hand}
      firstPicture={firstPicture}
      busy={busy}
      error={error}
      tabs={tabs}
      onBack={leaveRoom}
      onOrder={(code: SortStrategyCode) => { void write(() => api.editCollection(code)) }}
      onHand={(next) => { setHand(next); rememberHand(next) }}
      onFirstPicture={(next) => { setFirstPicture(next); rememberFirstPicture(next) }}
    />
  )
}

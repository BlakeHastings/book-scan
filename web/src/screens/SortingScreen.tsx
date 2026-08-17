/**
 * How an area is ordered, and the acknowledgement the server asks for first.
 *
 * The first press sends the change without one. An area given an order of its
 * own takes no overflow, so the run it was in is cut and the areas after it
 * stop being fed by the one before; the server refuses that until somebody has
 * been shown what it does, and hands back the sentence to show them, with the
 * count of areas in it. The second press carries the acknowledgement.
 *
 * A change that cuts nothing is written on the first press, which is most of
 * them: putting an area back to inheriting rejoins a run it was already at the
 * head of, and the server says so by not refusing.
 */

import { useEffect, useState } from 'react'
import { SortingPane } from '../components/SortingPane'
import { useArranging } from '../app/arranging'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api, Refusal, type SortStrategyCode } from '../lib/api'

export function SortingScreen() {
  const { fixtureId, areaId, back } = useArranging()
  const { room, error, setError, busy, read } = useRoom()
  const [chosen, setChosen] = useState<SortStrategyCode | null>(null)
  const [effect, setEffect] = useState('')
  const [busySaving, setBusySaving] = useState(false)
  const tabs = useRoomTabs()
  useDesignPage()

  const piece = room?.fixtures.find((one) => one.id === fixtureId) ?? null
  const area = piece?.areas.find((one) => one.id === areaId) ?? null

  useEffect(() => {
    if (area && chosen === null) setChosen(area.sortStrategy)
  }, [area, chosen])

  const save = async () => {
    if (!area || !chosen) return
    if (chosen === area.sortStrategy) { back('area'); return }
    setBusySaving(true)
    setError('')
    try {
      await api.editArea(area.id, { sortStrategy: chosen, acknowledge: effect !== '' })
      await read()
      back('area')
    } catch (caught) {
      if (caught instanceof Refusal && caught.effect) {
        // Not a failure: the server is asking for this sentence to be read
        // before it writes. The next press is the answer to it.
        setEffect(caught.message)
      } else {
        setError((caught as Error).message)
      }
    } finally {
      setBusySaving(false)
    }
  }

  return (
    <SortingPane
      room={room}
      piece={piece}
      area={area}
      chosen={chosen ?? 'inherit'}
      effect={effect}
      busy={busy || busySaving}
      error={error}
      tabs={tabs}
      onBack={() => back('area')}
      onChoose={(code) => { setEffect(''); setChosen(code) }}
      onSave={save}
    />
  )
}

/**
 * One area: what it is called, what belongs in it, how it is ordered, and the
 * two ways to stop it existing as it is.
 *
 * ## The dialog is drawn from the server's own plan
 *
 * Pressing "remove this area" asks `GET /api/areas/:id/removal`, which writes
 * nothing and answers with which area takes the books in, how many are refiled,
 * how many are left alone and why, and every label that reads differently
 * afterwards. What somebody approves is therefore what happens: the write path
 * folds the same books with the same function.
 *
 * The one state that is a refusal rather than a plan is an area that is the
 * only one on its piece. There is nowhere on that piece for its books to go, so
 * the dialog does not offer to do it; it offers the thing somebody meant, which
 * is the piece going, and that has a plan of its own in front of it.
 */

import { useEffect, useState } from 'react'
import { AreaPane, type Asking } from '../components/AreaPane'
import { useArranging } from '../app/arranging'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api } from '../lib/api'

export function AreaScreen() {
  const { fixtureId, areaId, onward, instead, back } = useArranging()
  const { room, error, setError, busy, write } = useRoom()
  const [name, setName] = useState<string | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const tabs = useRoomTabs()
  useDesignPage()

  const piece = room?.fixtures.find((one) => one.id === fixtureId) ?? null
  const area = piece?.areas.find((one) => one.id === areaId) ?? null

  useEffect(() => {
    if (area && name === null) setName(area.name)
  }, [area, name])

  const ask = async () => {
    if (!area) return
    setError('')
    try {
      const answer = await api.areaRemoval(area.id)
      setAsking({ kind: 'merge', plan: answer.plan })
    } catch (caught) {
      /*
       * The refusal is the third state rather than a failure: an area with
       * nothing before or after it on its piece has nowhere to send its books,
       * and the server says so in the sentence the dialog then carries.
       */
      setAsking({ kind: 'only', said: (caught as Error).message })
    }
  }

  const remove = async () => {
    if (!area) return
    const done = await write(() => api.dropArea(area.id))
    setAsking(null)
    // The area this screen is about has gone, so the piece it was on takes its
    // place rather than standing on top of it: back is still where you came in.
    if (done) instead('fixture')
  }

  return (
    <AreaPane
      piece={piece}
      area={area}
      name={name ?? ''}
      asking={asking}
      busy={busy}
      error={error}
      tabs={tabs}
      onBack={() => back('fixture')}
      onName={setName}
      onSaveName={() => area && write(() => api.editArea(area.id, { name: (name ?? '').trim() }))}
      onBelongs={() => onward('belongs')}
      onSorting={() => onward('sorting')}
      onSplit={() => onward('addarea')}
      onAsk={ask}
      onKeep={() => setAsking(null)}
      onRemove={remove}
      onPiece={() => { setAsking(null); onward('fixture') }}
    />
  )
}

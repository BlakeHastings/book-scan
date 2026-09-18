/**
 * One area: what it is called, what belongs in it, how it is ordered, and
 * the way to stop it existing.
 *
 * Editing what belongs here writes nothing directly: it produces a plan
 * over every book in the collection, applying writes where the rules want
 * each book and carries none of them, and the way on is the carry list.
 * The state behind it is `app/writing.ts`, shared with the piece's own
 * page so the two cannot drift.
 *
 * Pressing "remove this area" asks `GET /api/areas/:id/removal`, which
 * writes nothing and answers with the same plan the write path then
 * applies, so what somebody approves is what happens.
 *
 * An area that is the only one on its piece refuses removal instead of
 * planning it: there is nowhere on that piece for its books to go, so the
 * dialog offers removing the piece instead.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AreaPane, type Asking } from '../components/AreaPane'
import { useArranging } from '../app/arranging'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { useLeaving } from '../app/leaving'
import { useWriting } from '../app/writing'
import { api, Refusal, type AreaBook, type SortStrategyCode } from '../lib/api'

export function AreaScreen() {
  const { openArranging, openClaim } = useNavigation()
  const { leaveFor } = useLeaving()
  const { fixtureId, areaId, onward, instead, back } = useArranging()
  const { room, error, setError, busy, write, read } = useRoom()
  const [name, setName] = useState<string | null>(null)
  const [books, setBooks] = useState<AreaBook[]>([])
  const [asking, setAsking] = useState<Asking | null>(null)
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<SortStrategyCode | null>(null)
  const [effect, setEffect] = useState('')
  const [saving, setSaving] = useState(false)
  const tabs = useRoomTabs()
  useDesignPage()

  const piece = room?.fixtures.find((one) => one.id === fixtureId) ?? null
  /*
   * Its face, and then the areas taken out that books are still standing
   * on. Both are areas of this piece here, though they are separate on the
   * wire since a piece's own drawing must see only the first.
   */
  const area = piece?.areas.find((one) => one.id === areaId)
    ?? piece?.gone.find((one) => one.id === areaId)
    ?? null

  /*
   * The rule under a thumb: the same hook the piece's page uses, so the
   * two pages cannot drift into disagreeing behaviour.
   */
  const place = useMemo(
    () => (areaId === null ? null : { about: 'area' as const, id: areaId }),
    [areaId],
  )
  const writing = useWriting(place, () => { void read() })

  useEffect(() => {
    if (area && name === null) setName(area.name)
  }, [area, name])

  /*
   * The books standing here, by identity rather than by matching a label.
   * They are also what the sort rule shows: the same books in the order an
   * ordering would put them.
   */
  const load = useCallback(() => {
    if (areaId === null) return () => {}
    let stale = false
    api.areaBooks(areaId)
      .then((got) => { if (!stale) setBooks(got.books) })
      .catch((caught) => { if (!stale) setError((caught as Error).message) })
    return () => { stale = true }
  }, [areaId, setError])

  useEffect(() => load(), [load])

  const ask = async () => {
    if (!area) return
    setError('')
    try {
      const answer = await api.areaRemoval(area.id)
      setAsking({ kind: 'merge', plan: answer.plan })
    } catch (caught) {
      /*
       * The refusal is a third state rather than a failure: an area with
       * nothing before or after it on its piece has nowhere to send its
       * books.
       */
      setAsking({ kind: 'only', said: (caught as Error).message })
    }
  }

  const remove = async () => {
    if (!area) return
    const done = await write(() => api.dropArea(area.id))
    setAsking(null)
    // The area is gone, so back now lands on the piece it was on.
    if (done) instead('fixture')
  }

  const saveSort = async () => {
    if (!area || !chosen) return
    if (chosen === area.sortStrategy) { setOpen(false); return }
    setSaving(true)
    setError('')
    try {
      await api.editArea(area.id, { sortStrategy: chosen, acknowledge: effect !== '' })
      await read()
      setOpen(false)
      setEffect('')
    } catch (caught) {
      if (caught instanceof Refusal && caught.effect) {
        // Not a failure: the server is asking for this sentence to be read
        // before it writes. The next press is the answer to it.
        setEffect(caught.message)
      } else {
        setError((caught as Error).message)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <AreaPane
      room={room}
      piece={piece}
      area={area}
      name={name ?? ''}
      books={books}
      sorting={{
        open,
        chosen: chosen ?? area?.sortStrategy ?? 'inherit',
        effect,
        busy: saving,
      }}
      writing={writing}
      asking={asking}
      busy={busy}
      error={error}
      tabs={tabs}
      onBack={() => back('fixture')}
      /*
       * Which press this is belongs to the pane, since the pane is what
       * holds the typed name.
       */
      onAskLeave={() => setAsking({ kind: 'unsaved' })}
      onName={setName}
      onSaveName={() => area && write(() => api.editArea(area.id, { name: (name ?? '').trim() }))}
      onChange={() => { if (area?.rule?.range) openArranging(area.rule.range) }}
      /*
       * The room was read again as the write landed, so what this page
       * says about itself on the way past is the room as it now is.
       */
      onCarry={() => leaveFor('carry')}
      onOpenSort={() => { setChosen(area?.sortStrategy ?? 'inherit'); setEffect(''); setOpen(true) }}
      onChooseSort={(code) => { setEffect(''); setChosen(code) }}
      onSaveSort={saveSort}
      onCloseSort={() => { setOpen(false); setEffect('') }}
      onClaimed={openClaim}
      onAsk={ask}
      onKeep={() => setAsking(null)}
      onRemove={remove}
      onPiece={() => { setAsking(null); onward('fixture') }}
    />
  )
}

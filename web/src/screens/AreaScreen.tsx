/**
 * One area: what it is called, what belongs in it, how it is ordered, and the
 * way to stop it existing.
 *
 * ## Four screens became one (#381)
 *
 * Cutting an area in two, what belongs here and how it is ordered were three
 * screens hanging off this one, and the owner walked them and said what was
 * wrong with all three. Adding an area is now a press on the fixtures screen
 * with no screen behind it; the other two are the widgets in `design/Rules.tsx`,
 * drawn here and on the piece's own page.
 *
 * ## Only one of the two rules is written from here
 *
 * **How it is ordered is.** There is nowhere else that writes it, and the write
 * itself is safe to offer one tap from a reading screen because the server
 * refuses it until somebody has been shown what it does: an area given an order
 * of its own takes no overflow, so the stretch it was in is cut and the areas
 * after it stop being fed by the one before. The first press collects that
 * sentence, the widget shows it, and the second press carries the
 * acknowledgement. A change that cuts nothing is written on the first press,
 * which is most of them.
 *
 * **What belongs here is not.** #323 settled that deliberately: a rule change is
 * what makes books need carrying, so it goes through the one journey that says
 * where every book would go before it writes anything. This page is a door to
 * that journey and not a second way to do it.
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

import { useCallback, useEffect, useState } from 'react'
import { AreaPane, type Asking } from '../components/AreaPane'
import { useArranging } from '../app/arranging'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api, Refusal, type AreaBook, type SortStrategyCode } from '../lib/api'

export function AreaScreen() {
  const { openArranging, openClaim } = useNavigation()
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
  const area = piece?.areas.find((one) => one.id === areaId) ?? null

  useEffect(() => {
    if (area && name === null) setName(area.name)
  }, [area, name])

  /*
   * The books standing here, by identity rather than by matching a label
   * (#318). They are what the list of books is, and they are also what the sort
   * rule shows: the same books in the order an ordering would put them, which
   * is the only honest answer to why they read the way they do.
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
      asking={asking}
      busy={busy}
      error={error}
      tabs={tabs}
      onBack={() => back('fixture')}
      onName={setName}
      onSaveName={() => area && write(() => api.editArea(area.id, { name: (name ?? '').trim() }))}
      onChange={() => { if (area?.rule?.range) openArranging(area.rule.range) }}
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

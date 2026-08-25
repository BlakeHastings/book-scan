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
 * ## Both rules are written from here now (#384)
 *
 * **How it is ordered** has been since #381. The write is safe to offer one tap
 * from a reading screen because the server refuses it until somebody has been
 * shown what it does: an area given an order of its own takes no overflow, so
 * the stretch it was in is cut and the areas after it stop being fed by the one
 * before. The first press collects that sentence, the widget shows it, and the
 * second press carries the acknowledgement.
 *
 * **What belongs here is written from here as well**, and that reverses what
 * #323 settled. The owner asked for it in as many words: "we want to be able to
 * assign any rules that are available [...] then that's what is now only allowed
 * in that area, and we should issue moves to adjust the books to where they need
 * to go based off these new rules."
 *
 * What #323 was really protecting survives untouched, and it is not "one screen
 * changes rules": it is **one way books move**. Editing here writes nothing. It
 * produces a plan over every book in the collection, with counts and with the
 * pinned ones said out loud; applying writes where the rules want each book and
 * carries none of them; and the way on is the carry list this app already keeps.
 * The state behind it is `app/writing.ts`, shared with the piece's own page so
 * the two cannot drift.
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
   * Its face and then the areas taken out that books are still standing on
   * (#401). Both are areas of this piece as far as this screen is concerned;
   * they are apart on the wire because everything that draws a piece of
   * furniture must see only the first, and `AreaPane` draws the second one
   * differently rather than pretending it is still there.
   */
  const area = piece?.areas.find((one) => one.id === areaId)
    ?? piece?.gone.find((one) => one.id === areaId)
    ?? null

  /*
   * The rule under a thumb. The same hook the piece's page uses, because the
   * behaviour is the same fact one level down from the widget the two pages
   * already share: a second copy of it here is two behaviours that agree until
   * one of them is edited.
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
      writing={writing}
      asking={asking}
      busy={busy}
      error={error}
      tabs={tabs}
      /*
       * Back with a name typed and never kept used to throw it away in silence
       * (#430 item 4). The button that keeps it is under the field and this is
       * at the top of the screen, which is the right place for both, so what
       * was missing was the app noticing.
       */
      onBack={() => {
        if (area && (name ?? '').trim() !== area.name) setAsking({ kind: 'unsaved' })
        else back('fixture')
      }}
      onLeave={() => { setAsking(null); back('fixture') }}
      onName={setName}
      onSaveName={() => area && write(() => api.editArea(area.id, { name: (name ?? '').trim() }))}
      onChange={() => { if (area?.rule?.range) openArranging(area.rule.range) }}
      /*
       * Applying wrote where the books belong and carried nothing, so the honest
       * next screen is the one that lists what somebody would walk. The room was
       * read again as the write landed, so what this page says about itself on
       * the way past is the room as it now is.
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

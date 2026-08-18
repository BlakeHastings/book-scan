/**
 * One piece of furniture, as a form with a preview of what it will be called.
 *
 * ## It no longer draws the piece
 *
 * There was a drawing of the piece at the top of this, with its areas under it
 * and a way to cut another one into it. The owner took it off (#367): "on the
 * edit view we shouldn't have that there. It should just have what you call it,
 * what it is, where it stands." It is the same note he gave about the area
 * screen, where the bookcase over everything that screen was for "is taking up
 * so much of the screen", and nothing is lost by it: the room draws every piece
 * with its areas and the way to add one, which is where somebody was looking
 * before they opened this.
 *
 * ## The draft is seeded from the answer and thrown away with the screen
 *
 * The three things that can be changed are held here while somebody types, and
 * they are seeded once, from the room the server described. Re-seeding them on
 * every read would take the field away from under a thumb; not seeding them at
 * all would mean an empty name field for a piece that has a name. The screen is
 * unmounted on the way out, which is what clears it.
 *
 * ## Deleting is asked for and refused in the same breath
 *
 * A piece with books on it cannot be taken out of the room, and the sentence
 * saying so is the server's: "Its 63 books move to other furniture first." The
 * drawing sends this button to the plan, which is where those books get carried
 * from, and that screen is not built yet; until it is, this asks and shows the
 * refusal, which is the same sentence in the same words.
 */

import { useEffect, useMemo, useState } from 'react'
import { FixturePane, type FixtureDraft } from '../components/FixturePane'
import { useArranging } from '../app/arranging'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { useLeaving } from '../app/leaving'
import { useWriting } from '../app/writing'
import { api, type AreaBook, type FixtureRemoval, type SortStrategyCode } from '../lib/api'
import { renumbering } from '../lib/furniture'

export function FixtureScreen() {
  const { openArranging } = useNavigation()
  const { leaveFor } = useLeaving()
  const { fixtureId, instead, back } = useArranging()
  const { room, error, setError, busy, write, read } = useRoom()
  const [draft, setDraft] = useState<FixtureDraft | null>(null)
  const [removal, setRemoval] = useState<FixtureRemoval | null>(null)
  const [books, setBooks] = useState<AreaBook[]>([])
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<SortStrategyCode | null>(null)
  const [saving, setSaving] = useState(false)
  const tabs = useRoomTabs()
  useDesignPage()

  const piece = room?.fixtures.find((one) => one.id === fixtureId) ?? null

  /* The rule under a thumb, by the same hook the area's page uses. */
  const place = useMemo(
    () => (fixtureId === null ? null : { about: 'fixture' as const, id: fixtureId }),
    [fixtureId],
  )
  const writing = useWriting(place, () => { void read() })

  // Seeded once, from whatever the first read said. `draft` staying null is
  // what makes this an "only if it has not been" rather than a dependency list.
  useEffect(() => {
    if (!room || !piece || draft) return
    setDraft({
      name: piece.name,
      /*
       * `bookshelf` is what a piece is written as when nobody has said what it
       * is, which is a schema default rather than somebody's word. It is drawn
       * as the placeholder rather than typed into the box, so a field somebody
       * has never touched does not read as an answer they gave.
       */
      kind: piece.kind === 'bookshelf' ? '' : piece.kind,
      order: room.fixtures.map((_, at) => at),
    })
  }, [room, piece, draft])

  useEffect(() => {
    if (fixtureId === null) return
    api.fixtureRemoval(fixtureId)
      .then((answer) => setRemoval(answer.removal))
      .catch(() => setRemoval(null))
  }, [fixtureId, room])

  /*
   * What is standing on it, which is what the sort rule shows the ordering of.
   * Asked of the piece rather than area by area: the ordering is a fact about
   * the whole face, and stitching one request per plank back into an order
   * would be this screen doing the ordering twice.
   */
  useEffect(() => {
    if (fixtureId === null) return
    let stale = false
    api.fixtureBooks(fixtureId)
      .then((got) => { if (!stale) setBooks(got.books) })
      .catch(() => { if (!stale) setBooks([]) })
    return () => { stale = true }
  }, [fixtureId])

  const save = async () => {
    if (!room || !piece || !draft) return
    const wanted = renumbering(draft.order.map((at) => room.fixtures[at]!))
    const done = await write(async () => {
      for (const one of wanted) await api.editFixture(one.id, { position: one.position })
      await api.editFixture(piece.id, {
        name: draft.name.trim(),
        kind: draft.kind.trim() || 'bookshelf',
      })
      return true
    })
    /*
     * The room, and not back: saving is finished with this piece, and the piece
     * it puts in order is the room's. `instead` rather than `onward` so the
     * trail is not grown by a screen that is leaving.
     */
    if (done) instead('furniture')
  }

  const remove = async () => {
    if (!piece) return
    const done = await write(() => api.dropFixture(piece.id))
    if (done) instead('furniture')
  }

  /*
   * Changing what the piece is ordered by is written straight away, and that is
   * a difference from an area rather than an oversight. An area with an order of
   * its own takes no overflow, so setting one cuts the stretch it was in and the
   * server refuses until somebody has been shown that; a piece cuts nothing.
   *
   * What it does do is reorder every area on it that orders nothing itself,
   * which is why the widget draws the books in the chosen order before this is
   * ever pressed: the warning is the books themselves.
   */
  const saveSort = async () => {
    if (!piece || !chosen) return
    if (chosen === piece.sortStrategy) { setOpen(false); return }
    setSaving(true)
    setError('')
    try {
      await api.editFixture(piece.id, { sortStrategy: chosen })
      await read()
      setOpen(false)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FixturePane
      room={room}
      piece={piece}
      draft={draft ?? { name: '', kind: '', order: [] }}
      books={books}
      sorting={{
        open,
        chosen: chosen ?? piece?.sortStrategy ?? 'inherit',
        effect: '',
        busy: saving,
      }}
      writing={writing}
      removal={removal}
      busy={busy}
      error={error}
      tabs={tabs}
      onBack={() => back('furniture')}
      onDraft={(next) => { setError(''); setDraft(next) }}
      onSave={save}
      onChange={() => { if (piece?.rule?.range) openArranging(piece.rule.range) }}
      /* Applying wrote where the books belong and carried nothing, so the next
         screen is the one that lists what somebody would walk. */
      onCarry={() => leaveFor('carry')}
      onOpenSort={() => { setChosen(piece?.sortStrategy ?? 'inherit'); setOpen(true) }}
      onChooseSort={setChosen}
      onSaveSort={saveSort}
      onCloseSort={() => setOpen(false)}
      onDelete={remove}
    />
  )
}

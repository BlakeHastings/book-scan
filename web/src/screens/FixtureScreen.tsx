/**
 * One piece of furniture, as a form with a preview of what it will be called.
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

import { useEffect, useState } from 'react'
import { FixturePane, type FixtureDraft } from '../components/FixturePane'
import { useArranging } from '../app/arranging'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api, type FixtureRemoval } from '../lib/api'
import { renumbering } from '../lib/furniture'

export function FixtureScreen() {
  const { setRoute } = useNavigation()
  const { fixtureId, openArea, setAreaId } = useArranging()
  const { room, error, setError, busy, write } = useRoom()
  const [draft, setDraft] = useState<FixtureDraft | null>(null)
  const [removal, setRemoval] = useState<FixtureRemoval | null>(null)
  const tabs = useRoomTabs()
  useDesignPage()

  const piece = room?.fixtures.find((one) => one.id === fixtureId) ?? null

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
    if (done) setRoute('furniture')
  }

  const remove = async () => {
    if (!piece) return
    const done = await write(() => api.dropFixture(piece.id))
    if (done) setRoute('furniture')
  }

  return (
    <FixturePane
      room={room}
      piece={piece}
      draft={draft ?? { name: '', kind: '', order: [] }}
      removal={removal}
      busy={busy}
      error={error}
      tabs={tabs}
      onBack={() => setRoute('furniture')}
      onDraft={(next) => { setError(''); setDraft(next) }}
      onArea={(areaId) => piece && openArea(piece.id, areaId)}
      onAddArea={() => { setAreaId(null); setRoute('addarea') }}
      onSave={save}
      onDelete={remove}
    />
  )
}

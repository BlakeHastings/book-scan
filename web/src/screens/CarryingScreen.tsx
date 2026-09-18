/**
 * Where one carried book goes, which is the screen a new book gets.
 *
 * `ShelveView` is rendered here exactly as `ShelveScreen` renders it, with
 * a different book in hand and a different thing done when the person
 * says it fits. `carrying.test` pins that there is only one implementation.
 *
 * Saying an area is full needs nothing new: the cascade already in that
 * screen works here unchanged, including writing down each displaced book
 * as it is confirmed.
 *
 * "It fits" here calls `PATCH /api/books/:id/location`, the same route
 * the queue's save uses. Nothing was written when the book was picked up:
 * a book in transit gets no row, so an abandoned armful leaves nothing to
 * unwind.
 */

import { useCallback, useEffect, useState } from 'react'
import { ShelveView } from '../components/ShelveView'
import { Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { Phone } from '../design/Phone'
import { api, draftFromBook, type PlacementResponse } from '../lib/api'
import { rangeOfSlug } from '../../domain/tagging/genre'
import { useArmful } from '../app/armful'
import { useErrorBanner } from '../app/errorBanner'
import { useLeaving } from '../app/leaving'
import { usePaper } from '../app/paper'
import { useNavigation } from '../app/navigation'
import { said, words } from '../lib/carryWords'
import type { ShelfRange } from '../../shared/shelving'

export function CarryingScreen() {
  const { setRoute } = useNavigation()
  const { setError } = useErrorBanner()
  const { leaveFor } = useLeaving()
  const { trip, books, done, placed, putBack, cascade, setCascade } = useArmful()

  usePaper()

  const tabs: Record<TabName, () => void> = {
    home: () => leaveFor('home'),
    library: () => leaveFor('library'),
    scan: () => leaveFor('capture'),
    queue: () => leaveFor('queue'),
  }

  const book = books[done]
  const [placement, setPlacement] = useState<PlacementResponse | null>(null)
  /**
   * The run this book is in, or null when no genre tag claims it. A book
   * on a carry list was put there by a rule, so in practice it is one of
   * the two; null rather than a stand-in, since a range is what every
   * shuffle on this screen is addressed to.
   */
  const [range, setRange] = useState<ShelfRange | null>('fiction')
  const [stale, setStale] = useState(true)
  const [saving, setSaving] = useState(false)

  /**
   * Where this one goes: on the plank this trip is taking it to.
   *
   * `trip.toAreaId` is passed explicitly rather than re-deriving where the
   * book belongs now from the rules: with two pieces of furniture
   * claiming the same tag, "where it belongs" can answer a different
   * plank than the one this walk is for.
   *
   * The trip is never re-answered underneath somebody (`app/armful.tsx`),
   * so this cannot drift while they walk.
   */
  const load = useCallback(async () => {
    if (!book || !trip) return
    setStale(true)
    try {
      const { book: row } = await api.getBook(book.id)
      const draft = draftFromBook(row)
      setRange(rangeOfSlug(draft.genre))
      setPlacement(await api.previewPlacement(draft, book.id, trip.toAreaId))
      setStale(false)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [book, trip, setError])

  useEffect(() => {
    if (!trip || !book) { setRoute(trip ? 'carried' : 'carry'); return }
    void load()
  }, [trip, book, load, setRoute])

  if (!trip || !book) return null

  const left = books.length - done

  const shelved = async (shelvedAt: number) => {
    setSaving(true)
    try {
      // The plank, not its name. See `onShelved` on `ShelveView`.
      await api.setLocationIn(book.id, shelvedAt)
      placed()
      if (left === 1) setRoute('carried')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /*
   * Putting the armful back writes nothing, since nothing was written for
   * the books still in the air. The ones already down stay down, since
   * they are recorded on the shelves, which is what lets somebody walk
   * away mid-trip.
   */
  const back = () => { putBack(); setRoute('carry') }

  /*
   * The frame, which is the one the where-it-goes screen wears: this
   * screen wears whatever that one wears, since it is that one with a
   * different book in hand.
   */
  return (
    <div className="wf">
      <Phone
        tab="library"
        onTab={(name) => tabs[name]()}
        top={
          <TopBar
            title="Where it goes"
            sub={book.title}
            onBack={back}
          />
        }
      >
        {/* The armful counted down, so somebody knows whether they are
            nearly done without going back. Added around this screen
            rather than inside it, so the two do not quietly become two
            screens. */}
        <Said>
          {left === 1
            ? `Last of ${words(books.length)} in your hands.`
            : `${said(left)} of ${words(books.length)} still in your hands.`}
        </Said>

        <ShelveView
          placement={placement}
          stale={stale}
          range={range}
          title={book.title}
          saving={saving}
          onShelved={(shelvedAt) => void shelved(shelvedAt)}
          onBack={back}
          backSaid="Back to books to carry"
          cascade={cascade}
          setCascade={setCascade}
          onRefresh={load}
        />

        <Button tone="quiet" block off={saving} onPress={back}>
          Put them back on {trip.from}
        </Button>
      </Phone>
    </div>
  )
}

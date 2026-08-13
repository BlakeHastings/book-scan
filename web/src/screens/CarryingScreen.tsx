/**
 * Where one carried book goes, which is the screen a new book gets.
 *
 * **This is the owner's instruction taken literally.** He has said twice that he
 * likes the where-it-goes screen, and #291 asks for a displaced book to be
 * reshelved "the same way as whenever we're initially shelving them". So it is
 * not copied for the carry flow, it is called by it: `ShelveView` is rendered
 * here exactly as `ShelveScreen` renders it, with a different book in hand and a
 * different thing done when the person says it fits.
 *
 * A second implementation would be the place the two quietly came apart, and the
 * way that happens is somebody adding one thing to one of them. `carrying.test`
 * pins that there is one.
 *
 * ## Saying an area is full needs nothing new
 *
 * The cascade in `docs/shelving.md` is already in that screen: a person says the
 * plank will not take the book, the last book on it is offered to the next
 * plank, and the question is asked again one at a time. That is what the drawn
 * design calls "the armful gets bigger", and it works here unchanged, including
 * writing down each displaced book as it is confirmed.
 *
 * ## What "It fits" does here
 *
 * `PATCH /api/books/:id/location`, the one route that changes where the
 * catalogue thinks a book is, and the same one the queue's save uses. Nothing
 * else is written and nothing was written when the book was picked up: a book in
 * transit gets no row, so an abandoned armful leaves nothing to unwind.
 */

import { useCallback, useEffect, useState } from 'react'
import { ShelveView } from '../components/ShelveView'
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
  const { trip, books, done, placed, putBack } = useArmful()

  usePaper()

  const tabs: Record<TabName, () => void> = {
    home: () => leaveFor('home'),
    library: () => leaveFor('library'),
    scan: () => leaveFor('capture'),
    queue: () => leaveFor('queue'),
  }

  const book = books[done]
  const [placement, setPlacement] = useState<PlacementResponse | null>(null)
  const [range, setRange] = useState<ShelfRange>('fiction')
  const [stale, setStale] = useState(true)
  const [saving, setSaving] = useState(false)

  /**
   * Where this one goes, worked out the way the review pane works it out.
   *
   * The book's own row rather than the two fields the list carries, because the
   * placing preview is answered from a draft and the answer has to be the one a
   * save of that book would give.
   */
  const load = useCallback(async () => {
    if (!book) return
    setStale(true)
    try {
      const { book: row } = await api.getBook(book.id)
      const draft = draftFromBook(row)
      setRange(rangeOfSlug(draft.genre))
      setPlacement(await api.previewPlacement(draft, book.id))
      setStale(false)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [book, setError])

  useEffect(() => {
    if (!trip || !book) { setRoute(trip ? 'carried' : 'carry'); return }
    void load()
  }, [trip, book, load, setRoute])

  if (!trip || !book) return null

  const left = books.length - done

  const shelved = async (shelvedAt: string) => {
    setSaving(true)
    try {
      await api.setLocation(book.id, shelvedAt)
      placed()
      if (left === 1) setRoute('carried')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /*
   * Putting the armful back writes nothing, because nothing was written for the
   * books still in the air. The ones already down stay down: they are on the
   * shelves and recorded there, which is what lets somebody walk away mid-trip.
   */
  const back = () => { putBack(); setRoute('carry') }

  /*
   * The frame, which is the one the where-it-goes screen wears (#316).
   *
   * It wore the app's header until that screen was converted, and the rule has
   * not changed: this screen wears whatever that one wears, because it is that
   * one with a different book in hand. `screens.tsx` says the same thing from
   * the other end.
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
        {/* The armful counted down, so somebody knows whether they are nearly
            done without going back. It is the one thing this screen adds to the
            one a newly scanned book gets, and it is added around that screen
            rather than inside it: a heading or a count added *to* it is how the
            two would quietly become two screens. */}
        <p className="hint">
          {left === 1
            ? `Last of ${words(books.length)} in your hands.`
            : `${said(left)} of ${words(books.length)} still in your hands.`}
        </p>

        <ShelveView
          placement={placement}
          stale={stale}
          range={range}
          title={book.title}
          saving={saving}
          onShelved={(shelvedAt) => void shelved(shelvedAt)}
          onBack={back}
          onRefresh={load}
        />

        <Button tone="quiet" block off={saving} onPress={back}>
          Put them back on {trip.from}
        </Button>
      </Phone>
    </div>
  )
}

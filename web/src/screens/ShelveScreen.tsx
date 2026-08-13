/**
 * Where to put the book, and the answer to whether it fitted.
 *
 * Two states of one screen, which is `where` and `done` in the drawings. The
 * question is `ShelveView`, unchanged in everything it does: the guided
 * shuffle, the cascade, what is written down and when. What is converted is
 * the frame around it and the shape of the answers.
 *
 * ## `Placing` was not touched
 *
 * The design system's `Placing` is called by the carry flow as well as by this
 * one and a test pins that, and somebody is building the carry screens right
 * now, so nothing about it moved. This screen draws the same four things in
 * the same order out of what the app already has: the sentence naming the two
 * neighbours, the area drawn with the gap in it, the book in the hand, and the
 * answers. The drawing is `ShelfStrip` rather than the wireframe's `Shelf`,
 * because the app's shelves carry photographs of real spines and the wireframe
 * stands dyed cloth in for them.
 *
 * ## The end of the journey
 *
 * A new book used to be saved straight back to the camera. It now lands on
 * "Shelved", which is the drawing: the same run of books, with the book
 * standing where the gap was. Nothing new was built for it, the same way
 * nothing was in the wireframe: the before is a gap and the after is the book
 * in it, so the strip is redrawn with `placedIndex` where `gapIndex` was.
 *
 * Only for a book that was not in the catalogue yet. Checking a book back in
 * and carrying one across a boundary both come through here too, and both
 * still go back where they came from: they are journeys that started
 * somewhere else and owe that screen a return.
 */

import { useState } from 'react'
import { Button } from '../design/Controls'
import { Card, Confirmation } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Phone } from '../design/Phone'
import { ShelveView } from '../components/ShelveView'
import { PlacementView } from '../components/ShelfStrip'
import { rangeOfSlug } from '../../domain/tagging/genre'
import { filingName } from '../../shared/shelving'
import type { PlacementResponse } from '../lib/api'
import { useBookActions } from '../app/bookActions'
import { useBookInHand } from '../app/bookInHand'
import { useErrorBanner } from '../app/errorBanner'
import { useLeaving } from '../app/leaving'
import { useNavigation } from '../app/navigation'
import { usePaper } from '../app/paper'
import { useSummary } from '../app/summary'

/** What was shelved, kept only long enough to draw the end of the journey. */
interface Shelved {
  title: string
  area: string
  /**
   * The placement as it now stands, with the book standing where the gap was.
   *
   * A placement rather than a bare strip because it is drawn by
   * `PlacementView`, which is what draws every other shelf in the app. There is
   * one component that draws a run of books with a book of yours in it and
   * there must not be a second: `carrying.test.tsx` pins that, and this screen
   * is the newest thing that would have been one.
   */
  placement: PlacementResponse | null
}

export function ShelveScreen() {
  const { setRoute } = useNavigation()
  const { error, setError } = useErrorBanner()
  const { leaveFor, returnToOrigin } = useLeaving()
  const {
    draft, bookId, saving, placement, placementStale, refreshPlacement,
  } = useBookInHand()
  const { save } = useBookActions()

  const { queueCounts } = useSummary()

  const [shelved, setShelved] = useState<Shelved | null>(null)

  /** How many books are still on the table, or null while nobody has said. */
  const waiting = queueCounts
    ? queueCounts.pending + queueCounts.ready + queueCounts.failed
    : null

  usePaper()

  const title = draft.title || 'this book'

  const tabs: Record<TabName, () => void> = {
    home: () => leaveFor('home'),
    library: () => leaveFor('library'),
    scan: () => leaveFor('capture'),
    queue: () => leaveFor('queue'),
  }

  /**
   * The area with the book in it, from the one that had a gap in it.
   *
   * The strip on screen a moment ago is the same shelf, drawn with the space
   * the book was about to go in. So this is that strip with the book standing
   * where the space was, which is what `placedIndex` means to `ShelfStrip`.
   * Nothing is asked of the server for it: the answer is already in hand and a
   * second read would be a round trip to redraw a picture that has not changed
   * in any way this screen does not already know about.
   */
  const withTheBookIn = (): PlacementResponse | null => {
    const strip = placement?.strip
    if (!placement || !strip) return null
    const at = strip.gapIndex
    const filed = draft.authorFilingOverride
      || filingName(draft.authors.split(',')[0]?.trim() ?? '')
    return {
      ...placement,
      strip: {
        ...strip,
        books: [
          ...strip.books.slice(0, at),
          { id: 0, title: draft.title, authorFiling: filed, spine: '', spineSlot: 'edge' },
          ...strip.books.slice(at),
        ],
        placedIndex: at,
      },
    }
  }

  const shelveIt = async (shelvedAt: string) => {
    // Read before the save, which is what clears the book in hand on the
    // paths that go back where they came from.
    const ending: Shelved = {
      title,
      area: shelvedAt || placement?.derivedLocation || '',
      placement: withTheBookIn(),
    }
    const fresh = bookId === null
    if (await save(shelvedAt, fresh ? 'here' : 'origin')) {
      if (fresh) setShelved(ending)
    }
  }

  if (shelved) {
    return (
      <div className="wf">
        <Phone tab="queue" onTab={(name) => tabs[name]()} top={<TopBar title="Shelved" />}>
          {shelved.placement ? (
            /* The same drawing the question was asked on, with the book in it.
               `instruction` off: the sentence naming the neighbours was the
               question, and it has been answered. */
            <div className="wf-bleed">
              <PlacementView
                placement={shelved.placement}
                pending={false}
                instruction={false}
              />
            </div>
          ) : (
            /* No drawing to redraw, which is what an empty range looks like:
               this book is the first thing on it. Then the sentence is all
               there is to say, and the cat says it. */
            <Confirmation said={`${shelved.title} is on ${shelved.area}.`} />
          )}

          <Button tone="primary" block onPress={returnToOrigin}>
            Next book
          </Button>
          <Button tone="quiet" block onPress={() => { returnToOrigin(); setRoute('home') }}>
            That is enough for today
          </Button>

          {/* What is still on the table, which is the reason "next book" is
              the answer this screen leads with. Left out entirely when the
              queue has not answered: a count from a request that has not come
              back is a guess, and this one decides whether somebody carries on
              or stops. */}
          {waiting !== null && (
            <Card
              weight="quiet"
              kind="Still waiting"
              title={
                waiting === 0
                  ? 'Nothing left on the table'
                  : waiting === 1
                    ? 'One more on the table'
                    : `${waiting} more on the table`
              }
            />
          )}
        </Phone>
      </div>
    )
  }

  return (
    <div className="wf">
      <Phone
        tab="queue"
        onTab={(name) => tabs[name]()}
        top={<TopBar title="Where it goes" sub={title} onBack={() => setRoute('review')} />}
      >
        {error && <div className="warn" onClick={() => setError('')}>{error}</div>}

        <ShelveView
          placement={placement}
          stale={placementStale}
          range={rangeOfSlug(draft.genre)}
          title={title}
          saving={saving}
          onShelved={(shelvedAt) => void shelveIt(shelvedAt)}
          onBack={() => setRoute('review')}
          onRefresh={refreshPlacement}
        />
      </Phone>
    </div>
  )
}

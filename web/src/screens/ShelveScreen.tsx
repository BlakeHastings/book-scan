/**
 * Where to put the book, and the answer to whether it fitted.
 *
 * Two states of one screen: `where` and `done`. The question is
 * `ShelveView`; `PlacementView` (`ShelfStrip`) draws the shelf itself,
 * since the app's shelves carry photographs of real spines rather than the
 * wireframe's dyed cloth.
 *
 * A new book lands on "Shelved": the same run of books, with the book
 * standing where the gap was. Checking a book back in or carrying one
 * across a boundary both go back where they came from instead.
 *
 * The book itself is put down by the save, not by this screen: still
 * holding it while showing "Shelved" would let the next photograph land
 * on the book that was just finished.
 */

import { useState } from 'react'
import { Button } from '../design/Controls'
import { Card, Confirmation } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Phone } from '../design/Phone'
import { ShelveView } from '../components/ShelveView'
import { Trouble } from '../components/RoomFrame'
import { PlacementView } from '../components/ShelfStrip'
import { rangeOfSlug } from '../../domain/tagging/genre'
import { filingName } from '../../shared/shelving'
import type { PlacementResponse } from '../lib/api'
import { useBookActions } from '../app/bookActions'
import { useBookInHand } from '../app/bookInHand'
import { useErrorBanner } from '../app/errorBanner'
import { useLeaving } from '../app/leaving'
import { useNavigation, type Route } from '../app/navigation'
import { usePaper } from '../app/paper'
import { useSummary } from '../app/summary'

/** What was shelved, kept only long enough to draw the end of the journey. */
interface Shelved {
  title: string
  area: string
  /**
   * The placement as it now stands, with the book standing where the gap
   * was. Drawn by `PlacementView`, the one component that draws a run of
   * books with a book of yours in it; `carrying.test.tsx` pins that there
   * must not be a second.
   */
  placement: PlacementResponse | null
  /**
   * Where "Next book" leads, read off the book while it was still in
   * hand. Taken before the save rather than asked for after it, since the
   * origin is put down with the book.
   */
  next: Route
}

export function ShelveScreen() {
  const { setRoute } = useNavigation()
  const { error } = useErrorBanner()
  const { leaveFor, landing } = useLeaving()
  const {
    draft, bookId, saving, placement, placementStale, refreshPlacement,
    cascade, setCascade,
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
   * The area with the book in it, from the one that had a gap in it. The
   * strip on screen a moment ago is the same shelf, so this is that strip
   * with the book standing where the space was, which is what
   * `placedIndex` means to `ShelfStrip`. Nothing is asked of the server
   * for it: the answer is already in hand.
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

  const shelveIt = async (shelvedAt: number) => {
    // Read before the save, which is what puts the book down on every path
    // out of here. The plank was answered about by id and is named here
    // for the sentence.
    const ending: Shelved = {
      title,
      area: placement?.derivedLocation ?? '',
      placement: withTheBookIn(),
      next: landing,
    }
    /*
     * A book that was not in the catalogue a moment ago ends on "Shelved",
     * written down in the same update that puts the book down. Everything
     * else came from somewhere and owes that screen a return, which the
     * save makes itself.
     */
    if (bookId === null) await save(shelvedAt, 'here', () => setShelved(ending))
    else await save(shelvedAt, 'origin')
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

          {/* Both of these are a route and nothing else. There is no book
              to put down by the time either can be pressed: the save did
              that, standing at the bookcase. */}
          <Button tone="primary" block onPress={() => setRoute(shelved.next)}>
            Next book
          </Button>
          <Button tone="quiet" block onPress={() => setRoute('home')}>
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
        <Trouble said={error} />

        <ShelveView
          placement={placement}
          stale={placementStale}
          range={rangeOfSlug(draft.genre)}
          title={title}
          saving={saving}
          onShelved={(shelvedAt) => void shelveIt(shelvedAt)}
          onBack={() => setRoute('review')}
          cascade={cascade}
          setCascade={setCascade}
          onRefresh={refreshPlacement}
        />
      </Phone>
    </div>
  )
}

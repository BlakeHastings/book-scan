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

import { useEffect, useState } from 'react'
import { Button } from '../design/Controls'
import { Card, Confirmation } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Phone } from '../design/Phone'
import { ShelveView } from '../components/ShelveView'
import { Trouble } from '../components/RoomFrame'
import { PlacementView } from '../components/ShelfStrip'
import { genreOfRange, rangeOfSlug } from '../../domain/tagging/genre'
import { filingName } from '../../shared/shelving'
import { api, deviceName, type AtAPlace, type PlacementResponse } from '../lib/api'
import { afterShelving, nextOffTheTable, type AfterShelving } from '../app/afterShelving'
import { useBookActions } from '../app/bookActions'
import { useBookInHand } from '../app/bookInHand'
import { useErrorBanner } from '../app/errorBanner'
import { useLeaving } from '../app/leaving'
import { useNavigation, type Route } from '../app/navigation'
import { useOpenBook } from '../app/openBook'
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
   * Where finishing leads and the tab it is under, read off the book while
   * it was still in hand. Taken before the save rather than asked for after
   * it, since the origin is put down with the book.
   */
  next: Route
  tab: TabName
  /** The capture just shelved, and where it sat in the queue listing, so the next one is the one after it. */
  capture: number | null
  from: number
}

export function ShelveScreen() {
  const { setRoute, queueReturn } = useNavigation()
  const { error, setError } = useErrorBanner()
  const { leaveFor, landing, cameFrom } = useLeaving()
  const {
    draft, setDraft, bookId, captureId, saving, placement, placementStale, refreshPlacement,
    cascade, setCascade, catalogued,
  } = useBookInHand()
  const { save } = useBookActions()
  const { openCapture } = useOpenBook()

  const { queueCounts, setQueueCounts } = useSummary()

  const [shelved, setShelved] = useState<Shelved | null>(null)
  const [after, setAfter] = useState<AfterShelving | null>(null)
  const [wanted, setWanted] = useState<AtAPlace | null>(null)

  // A failed read leaves the run's answer as the only suggestion, which is
  // what this screen offered before it asked.
  useEffect(() => {
    setWanted(null)
    if (bookId === null) return
    let live = true
    api.bookClaim(bookId)
      .then((found) => { if (live) setWanted(found.claim.wanted) })
      .catch(() => {})
    return () => { live = false }
  }, [bookId])

  /** How many books are still on the table, or null while nobody has said. */
  const waiting = queueCounts
    ? queueCounts.pending + queueCounts.ready + queueCounts.failed
    : null

  /*
   * A book picked up from the queue is followed by the next one in it, so the
   * queue is asked once the save has answered: before it, the book just
   * shelved is still listed as ready.
   */
  useEffect(() => {
    setAfter(null)
    if (!shelved) return
    if (shelved.next !== 'queue') {
      setAfter(afterShelving(shelved.next, null, null))
      return
    }
    let live = true
    api.listCaptures()
      .then((listed) => {
        if (!live) return
        setQueueCounts(listed.counts)
        const table = nextOffTheTable(listed.captures, shelved.capture, shelved.from, deviceName())
        const left = listed.counts.pending + listed.counts.ready + listed.counts.failed
        setAfter(afterShelving('queue', table, left))
      })
      .catch(() => { if (live) setAfter(afterShelving('queue', null, null)) })
    return () => { live = false }
  }, [shelved, setQueueCounts])

  const takeUp = async (next: AfterShelving) => {
    if ('route' in next) {
      setRoute(next.route)
      return
    }
    try {
      const { capture } = await api.claimCapture(next.capture.id, deviceName())
      openCapture(capture, { id: capture.id, index: next.index })
    } catch (caught) {
      // Somebody else picked it up in the moment between: the queue says who.
      setError((caught as Error).message)
      setRoute('queue')
    }
  }

  usePaper()

  // A screen of its own: arriving from the bottom of review must not leave the
  // sentence about where the book goes scrolled up under the header.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [shelved])

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
      tab: cameFrom,
      capture: captureId,
      from: queueReturn?.index ?? 0,
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
        <Phone tab={shelved.tab} onTab={(name) => tabs[name]()} top={<TopBar title="Shelved" />}>
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

          {/* There is no book to put down by the time either can be pressed:
              the save did that, standing at the bookcase. The first is drawn
              once it knows what it leads to, so its words never change under
              a thumb. */}
          {after && (
            <Button tone="primary" block onPress={() => void takeUp(after)}>
              {after.word}
            </Button>
          )}
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
        tab={cameFrom}
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
          byHand={bookId !== null}
          wanted={wanted}
          onGenre={(range) => setDraft((current) => ({
            ...current, genre: genreOfRange(range), classificationSource: 'manual',
          }))}
          otherCopy={catalogued?.id ?? null}
        />
      </Phone>
    </div>
  )
}

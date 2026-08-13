/**
 * One book, looked at and edited.
 *
 * Two screens rather than one, since #316, and the drawings are why. `review`
 * is the step between a photograph and a shelf: the photographs at the top,
 * the fields somebody corrects, and two answers at the bottom. `book` is a
 * page about a book you already own, with everything you can do to it on it.
 * The app had one screen doing both, which is what made "the book page is
 * about the book, not about where it sits" and "the photographs lead" two
 * rules pulling on the same markup.
 *
 * So a capture is drawn by `CaptureReview`, converted here, and a catalogued
 * book is still drawn by `BookDetail`, untouched: it is the `book` screen and
 * #315 is converting it.
 *
 * Everything either of them offers to do still comes from the book itself
 * (#59); this file only wires the book in hand to whichever draws it.
 */

import { useEffect } from 'react'
import { Chrome } from '../app/Chrome'
import { BookDetail } from '../components/BookDetail'
import { CaptureReview } from '../components/CaptureReview'
import { PlacementView } from '../components/ShelfStrip'
import { filingName } from '../../shared/shelving'
import type { TabName } from '../design/Chrome'
import { useBookActions } from '../app/bookActions'
import { useBookInHand } from '../app/bookInHand'
import { useErrorBanner } from '../app/errorBanner'
import { useLeaving } from '../app/leaving'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

export function ReviewScreen() {
  const { setRoute } = useNavigation()
  const { error, setError } = useErrorBanner()
  const { leaveFor, returnToOrigin } = useLeaving()
  const { openNeighbour } = useOpenBook()
  const book = useBookInHand()
  const {
    saveEdits, deleteBook, checkOut, relookup, startBoundaryMove,
    deletingBook, checkingOut, boundaryMoving,
  } = useBookActions()

  const {
    draft, lookup, thumbs, crops, examined, saving, relookupBusy, relookupError,
    evidence, bookId, origin, notice, placement, placementStale, coverImage,
    checkedOutAt, misfile, misfileTakeable, misfileMoving,
    confirmMisfileMoved, takeMisfileBack, setDraft, setNotice, setRelookupError,
    setActiveSlot,
  } = book

  const derivedFiling = filingName(draft.authors.split(',')[0]?.trim() ?? '')

  /*
   * The converted screen takes the design system's paper, the same way the
   * first one does. Only for the capture: a catalogued book is still drawn by
   * `BookDetail` on the app's own dark page, and painting the body warm under
   * it would be half a conversion showing through.
   */
  const converted = bookId === null
  useEffect(() => {
    if (!converted) return
    document.body.classList.add('wf-page')
    return () => document.body.classList.remove('wf-page')
  }, [converted])

  if (converted) {
    const tabs: Record<TabName, () => void> = {
      home: () => leaveFor('home'),
      library: () => leaveFor('library'),
      scan: () => leaveFor('capture'),
      queue: () => leaveFor('queue'),
    }

    return (
      <CaptureReview
        draft={draft}
        lookup={lookup}
        photos={thumbs}
        derivedFiling={derivedFiling}
        saving={saving}
        relookupBusy={relookupBusy}
        relookupError={relookupError}
        /* What the photographs read, shown beside the form as evidence
           and never poured into it (#147). */
        coverText={evidence.coverText}
        captureNote={evidence.note}
        notice={notice}
        onDismissNotice={() => setNotice('')}
        error={error}
        onDismissError={() => setError('')}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        onRelookup={relookup}
        onClearRelookupError={() => setRelookupError('')}
        /*
         * Back to the camera, pointed at the photograph somebody wants again.
         * `leaveFor` decides whether the book survives the trip, which is
         * `bookStillInHand`'s call and unchanged: a capture opened from the
         * queue is put down first, because the next shot would otherwise
         * overwrite its back cover (#62).
         */
        onRetake={(slot) => { setActiveSlot(slot); leaveFor('capture') }}
        onShelve={() => setRoute('shelve')}
        onLeave={returnToOrigin}
        tabs={tabs}
      />
    )
  }

  /*
   * The frame, asked for here rather than in the route table.
   *
   * A catalogued book is the `book` screen and is not converted yet, so it
   * still wants the app's header. Its route says `chrome: false` because the
   * other path brings its own, and the screen that knows which path it is on
   * is this one.
   */
  return (
    <Chrome>
      <main className="main">
        {notice && (
          <div className="warn warn--soft" onClick={() => setNotice('')}>{notice}</div>
        )}

        <BookDetail
          draft={draft}
          lookup={lookup}
          photos={thumbs}
          crops={crops}
          examined={examined}
          derivedFiling={derivedFiling}
          saving={saving}
          relookupBusy={relookupBusy}
          relookupError={relookupError}
          coverText={evidence.coverText}
          captureNote={evidence.note}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          onRelookup={relookup}
          onClearRelookupError={() => setRelookupError('')}
          saved
          /*
           * Only for a book that is actually on a shelf, where the drawing
           * says where it is.
           */
          placement={(
            <PlacementView
              placement={placement}
              pending={placementStale}
              instruction={false}
              onOpen={openNeighbour}
            />
          )}
          doneLabel={origin === 'scan' ? 'Scan another' : 'Back to library'}
          onShelve={() => setRoute('shelve')}
          onSaveEdits={saveEdits}
          onDiscard={returnToOrigin}
          shelfLabel={placement?.derivedLocation ?? ''}
          onDelete={deleteBook}
          deleting={deletingBook}
          catalogueCover={coverImage || lookup?.coverUrl || ''}
          checkedOutAt={checkedOutAt}
          onCheckOut={checkOut}
          checkingOut={checkingOut}
          boundaryMoves={placement?.strip?.boundary ?? null}
          onBoundaryMove={startBoundaryMove}
          boundaryMoving={boundaryMoving}
          misfile={misfile}
          onMisfileMoved={confirmMisfileMoved}
          onMisfileTakenBack={misfileTakeable ? takeMisfileBack : undefined}
          misfileMoving={misfileMoving}
        />
      </main>
    </Chrome>
  )
}

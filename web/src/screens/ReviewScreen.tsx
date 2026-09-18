/**
 * One book, looked at and edited.
 *
 * Two screens rather than one: `review` is the step between a photograph
 * and a shelf, with the photographs at the top and two answers at the
 * bottom; `book` is a page about a book you already own, with everything
 * you can do to it on it.
 *
 * A capture is drawn by `CaptureReview` and a catalogued book by
 * `BookDetail`. Everything either of them offers to do still comes from
 * the book itself; this file only wires the book in hand to whichever
 * draws it.
 */

import { useEffect } from 'react'
import { api } from '../lib/api'
import { BookDetail } from '../components/BookDetail'
import { CaptureReview } from '../components/CaptureReview'
import { Where } from '../design/Book'
import { Place } from '../design/List'
import { Shelf } from '../design/Shelf'
import { filingName } from '../../shared/shelving'
import type { TabName } from '../design/Chrome'
import { standing } from '../lib/bookLook'
import { useBookActions } from '../app/bookActions'
import { useBookInHand } from '../app/bookInHand'
import { useErrorBanner } from '../app/errorBanner'
import { useLeaving } from '../app/leaving'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'
import { useTagging } from '../app/tagging'

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
    draft, lookup, thumbs, crops, saving, relookupBusy, relookupError,
    evidence, bookId, captureId, origin, notice, placement, placementStale, coverImage,
    checkedOutAt, misfile, catalogued, setCatalogued, setDraft, setRelookupError,
    setActiveSlot,
  } = book

  const derivedFiling = filingName(draft.authors.split(',')[0]?.trim() ?? '')

  /*
   * The book being named, whichever kind it is. A capture is a row in
   * `books` from its first photograph, which is why the hook takes an id
   * rather than a kind: the same call names a book that has been on a
   * shelf for a year.
   */
  const tagging = useTagging(bookId ?? captureId)

  /**
   * Ask whether this capture's ISBN is already on a shelf.
   *
   * The camera fills this in from its own poll, so a book carried straight
   * from the shutter arrives with the answer. A capture opened from the
   * queue does not, since the row it was handed cannot carry this: the
   * catalogue moves underneath it.
   *
   * Only for a capture: a book already in the catalogue is the book, and
   * telling somebody their own book is already catalogued is nonsense.
   */
  useEffect(() => {
    if (bookId !== null || captureId === null) return
    let cancelled = false
    void api.getCapture(captureId)
      .then(({ catalogued: onAShelf }) => {
        if (!cancelled) setCatalogued(onAShelf)
      })
      // Swallowed on purpose: a finding beside a form somebody is filling
      // in is not worth an error banner over it.
      .catch(() => {})
    return () => { cancelled = true }
  }, [bookId, captureId, setCatalogued])

  /* Both screens take the design system's paper, not the app's own dark page. */
  useEffect(() => {
    document.body.classList.add('wf-page')
    return () => document.body.classList.remove('wf-page')
  }, [])

  const tabs: Record<TabName, () => void> = {
    home: () => leaveFor('home'),
    library: () => leaveFor('library'),
    scan: () => leaveFor('capture'),
    queue: () => leaveFor('queue'),
  }

  if (bookId === null) {
    return (
      <CaptureReview
        draft={draft}
        lookup={lookup}
        /* Whether this book is already on a shelf, from either of the two
           things that can know: the catalogue's own ISBN check, or the
           lookup's own answer from a moment ago. They cannot disagree
           about a book, only about how recently they were asked. */
        catalogued={catalogued ?? lookup?.duplicateOf ?? null}
        photos={thumbs}
        derivedFiling={derivedFiling}
        saving={saving}
        relookupBusy={relookupBusy}
        relookupError={relookupError}
        /* The publisher's picture for the matched ISBN, drawn beside the
           photograph so the match can be confirmed by looking. */
        catalogueCover={coverImage || lookup?.coverUrl || ''}
        /* What the photographs read, shown beside the form as evidence
           and never poured into it. */
        coverText={evidence.coverText}
        captureNote={evidence.note}
        notice={notice}
        error={error}
        onDismissError={() => setError('')}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        onRelookup={relookup}
        onClearRelookupError={() => setRelookupError('')}
        /*
         * Back to the camera, pointed at the photograph somebody wants
         * again. A capture opened from the queue is put down first, since
         * the next shot would otherwise overwrite its back cover.
         */
        onRetake={(slot) => { setActiveSlot(slot); leaveFor('capture') }}
        onShelve={() => setRoute('shelve')}
        onLeave={returnToOrigin}
        tabs={tabs}
        tags={tagging.tags}
        vocabulary={tagging.vocabulary}
        taggingBusy={tagging.busy}
        taggingError={tagging.error}
        onAddTag={tagging.add}
        onRemoveTag={tagging.remove}
        canTag={captureId !== null}
      />
    )
  }

  return (
    <BookDetail
      draft={draft}
      lookup={lookup}
      photos={thumbs}
      crops={crops}
      derivedFiling={derivedFiling}
      saving={saving}
      relookupBusy={relookupBusy}
      relookupError={relookupError}
      onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      onRelookup={relookup}
      onClearRelookupError={() => setRelookupError('')}
      saved
      tabs={tabs}
      notice={notice}
      error={error}
      onDismissError={() => setError('')}
      /*
       * Where the book stands, drawn rather than said. Built here with the
       * same `standing` function the book's own page uses, so the same
       * shelf is never drawn two different ways.
       *
       * `.placement--stale` dims the drawing while the placement is being
       * fetched again, for someone who has just said "Moved it".
       */
      placement={(
        <Where>
          <div className={placementStale ? 'placement--stale' : ''}>
            {checkedOutAt ? (
              /*
               * A book in a pile stands in no run: the run it stood in has
               * closed up behind it. Drawing that run under a card saying
               * the book is off the bookcase would contradict the sentence
               * above it.
               */
              <div>
                <Place quiet>Out of the house</Place>
              </div>
            ) : placement?.strip ? (
              <div className="wf-bleed">
                <Shelf
                  label={placement.strip.label}
                  items={standing(placement.strip, bookId, openNeighbour)}
                />
              </div>
            ) : (
              <div>
                <Place quiet={!placement?.derivedLocation}>
                  {placement?.derivedLocation
                    ? `On ${placement.derivedLocation}`
                    : 'Not on a bookcase'}
                </Place>
              </div>
            )}
          </div>
        </Where>
      )}
      doneLabel={origin === 'scan' ? 'Scan another' : 'Back to library'}
      onShelve={() => setRoute('shelve')}
      onSaveEdits={saveEdits}
      onDiscard={returnToOrigin}
      onDelete={deleteBook}
      deleting={deletingBook}
      catalogueCover={coverImage || lookup?.coverUrl || ''}
      checkedOutAt={checkedOutAt}
      onCheckOut={checkOut}
      checkingOut={checkingOut}
      boundaryMoves={placement?.strip?.boundary ?? null}
      onBoundaryMove={startBoundaryMove}
      boundaryMoving={boundaryMoving}
      /*
       * Whether this book is where it belongs, and nothing else about it.
       * The notice is a door to the shelving step rather than a write:
       * nothing about a misfile is written from here, only from the screen
       * that places books.
       */
      misfile={misfile}
      /*
       * The third door onto saying what a book is. Same hook and same
       * immediate write as the queue's check-the-details screen: a
       * person's tag is written when it is said, not carried in a draft
       * that a closed browser loses.
       */
      tags={tagging.tags}
      vocabulary={tagging.vocabulary}
      taggingBusy={tagging.busy}
      taggingError={tagging.error}
      onAddTag={tagging.add}
      onRemoveTag={tagging.remove}
    />
  )
}

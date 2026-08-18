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
 * So a capture is drawn by `CaptureReview` and a catalogued book by
 * `BookDetail`, and **both of them are the design system's now** (#387). This
 * file no longer decides whether the app's own header goes round one of them,
 * because neither wants one: each brings its own top bar and its own
 * four-place tab bar, and the route table says `chrome: false` for the whole
 * screen rather than for one path of it.
 *
 * Everything either of them offers to do still comes from the book itself
 * (#59); this file only wires the book in hand to whichever draws it.
 *
 * **Saying what a book is used to be a hook in this file and is now in
 * `app/tagging.ts`** (#341). Nothing about it changed except where it lives: the
 * screen about the books no rule claims needs the same act, and the way that
 * ends up as two ways of saying what a book is, disagreeing about what a busy
 * panel looks like, is somebody copying twenty lines rather than moving them.
 */

import { useEffect } from 'react'
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
    checkedOutAt, misfile, setDraft, setNotice, setRelookupError,
    setActiveSlot,
  } = book

  const derivedFiling = filingName(draft.authors.split(',')[0]?.trim() ?? '')

  const tagging = useTagging(bookId === null ? captureId : null)

  /*
   * Both screens take the design system's paper, the same way the first one
   * does. It was only the capture until #387, because a catalogued book was
   * still drawn on the app's own dark page and painting the body warm under it
   * would have been half a conversion showing through.
   */
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
        photos={thumbs}
        derivedFiling={derivedFiling}
        saving={saving}
        relookupBusy={relookupBusy}
        relookupError={relookupError}
        /* The publisher's picture for the ISBN this matched, drawn beside the
           photograph somebody took so the match can be confirmed by looking.
           The same expression `BookDetail` is handed below, because it is the
           same question asked on the other screen. */
        catalogueCover={coverImage || lookup?.coverUrl || ''}
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
      onDismissNotice={() => setNotice('')}
      error={error}
      onDismissError={() => setError('')}
      /*
       * Where the book stands, drawn rather than said.
       *
       * The run comes off the same placement preview the boundary moves above
       * are read from, and it is drawn by `Shelf` with `standing`, which is the
       * function the book's own page draws its run with. That is the whole
       * reason it is built here rather than inside `BookDetail`: this screen
       * has the placement and the book's id, and the drawing has to be the one
       * the page behind it uses or the same shelf is drawn two ways one press
       * apart.
       *
       * `.placement--stale` is the app saying a placement read is outstanding,
       * and it stays: the drawing dims while the answer it is made of is being
       * fetched again, which is what somebody who has just said "Moved it"
       * needs to see.
       */
      placement={(
        <Where>
          <div className={placementStale ? 'placement--stale' : ''}>
            {checkedOutAt ? (
              /*
               * A book in a pile stands in no run, and the run it used to
               * stand in has closed up behind it. Drawing that run under a
               * card which has just said the book is off the bookcase is a
               * drawing contradicting the sentence above it, so the label is
               * the answer here, exactly as it is on the book's own page.
               * Found by checking a book out and looking at it.
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
       * Whether this book is where it belongs, and nothing else about it (#409).
       *
       * The notice it draws is a door to the shelving step rather than a pair of
       * answers, and the way to that step is `onShelve` above, which is the same
       * route a new book and a checked-in book take. So nothing about a misfile
       * is written from here any more: the write happens when somebody says the
       * book fits, standing at the bookcase, on the screen that places books.
       */
      misfile={misfile}
    />
  )
}

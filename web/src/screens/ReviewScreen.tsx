/**
 * One book, looked at and edited.
 *
 * The same screen for a queued capture and for a catalogued book, so there is
 * one place a book is worked on rather than two. Everything it offers to do
 * comes from the book itself (#59); this file only wires the book in hand to
 * the component that draws it.
 */

import { BookDetail } from '../components/BookDetail'
import { PlacementView } from '../components/ShelfStrip'
import { filingName } from '../../shared/shelving'
import { useBookActions } from '../app/bookActions'
import { useBookInHand } from '../app/bookInHand'
import { useLeaving } from '../app/leaving'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

export function ReviewScreen() {
  const { setRoute } = useNavigation()
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
  } = book

  const derivedFiling = filingName(draft.authors.split(',')[0]?.trim() ?? '')

  return (
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
        /* What the photographs read, shown beside the form as evidence
           and never poured into it (#147). */
        coverText={evidence.coverText}
        captureNote={evidence.note}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        onRelookup={relookup}
        onClearRelookupError={() => setRelookupError('')}
        saved={bookId !== null}
        /*
         * Only for a book that is actually on a shelf, where the drawing
         * says where it is. For one still being scanned it would be
         * answering a question nobody has asked yet, on a page already
         * asking them to check a dozen fields. The shelving step puts it
         * back when they say they are ready to place it.
         */
        placement={bookId !== null ? (
          <PlacementView
            placement={placement}
            pending={placementStale}
            instruction={false}
            onOpen={openNeighbour}
          />
        ) : undefined}
        doneLabel={
          bookId === null ? 'Done'
            : origin === 'scan' ? 'Scan another' : 'Back to library'
        }
        onShelve={() => setRoute('shelve')}
        onSaveEdits={saveEdits}
        onDiscard={returnToOrigin}
        shelfLabel={placement?.derivedLocation ?? ''}
        onDelete={bookId !== null ? deleteBook : undefined}
        deleting={deletingBook}
        /* A saved book has its cover on disk; one still being confirmed
           only has whatever the lookup just handed back. */
        catalogueCover={coverImage || lookup?.coverUrl || ''}
        checkedOutAt={checkedOutAt}
        onCheckOut={bookId !== null ? checkOut : undefined}
        checkingOut={checkingOut}
        boundaryMoves={placement?.strip?.boundary ?? null}
        onBoundaryMove={bookId !== null ? startBoundaryMove : undefined}
        boundaryMoving={boundaryMoving}
        misfile={misfile}
        onMisfileMoved={confirmMisfileMoved}
        onMisfileTakenBack={misfileTakeable ? takeMisfileBack : undefined}
        misfileMoving={misfileMoving}
      />

      {/* Only for a book still being scanned. A catalogued book came
          from the library and goes back there. */}
      {bookId === null && (
        <div className="actions">
          <button className="btn" onClick={() => leaveFor('capture')}>
            Back to camera
          </button>
        </div>
      )}
    </main>
  )
}

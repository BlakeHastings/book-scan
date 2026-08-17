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

import { useCallback, useEffect, useState } from 'react'
import { Chrome } from '../app/Chrome'
import { BookDetail } from '../components/BookDetail'
import { CaptureReview } from '../components/CaptureReview'
import { PlacementView } from '../components/ShelfStrip'
import { filingName } from '../../shared/shelving'
import { api, type AppliedTag, type TagRow } from '../lib/api'
import type { TabName } from '../design/Chrome'
import { useBookActions } from '../app/bookActions'
import { useBookInHand } from '../app/bookInHand'
import { useErrorBanner } from '../app/errorBanner'
import { useLeaving } from '../app/leaving'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

/**
 * What a person has said this book is, and the vocabulary they said it in.
 *
 * State only this screen uses, so it lives in this screen's file, which is the
 * rule `src/screens` is arranged by. It is deliberately not in `bookInHand`:
 * these are rows in the database rather than fields of a draft, and the reason
 * they can be is #183. A capture is a row in `books` from its first photograph,
 * so there is somewhere to hang a tag on long before anybody shelves the book.
 *
 * **Written the moment it is said, rather than carried in the draft.** That is
 * the same decision the capture autosave already made, and for the same reason
 * (#65): one person photographs, another works out what the book is, a third
 * shelves it, and the middle person's work has to survive them putting the phone
 * down. A tag held in React until the shelving step is a tag lost by the browser
 * being closed, and a person's tag is the one kind of tag nothing else in this
 * system is allowed to reproduce.
 *
 * Only a person's are shown. A book out of Open Library carries up to twelve
 * subject headings, and a wall of them on the screen somebody is trying to get a
 * book off is not what a fast path looks like.
 */
function useTagging(bookId: number | null) {
  const [tags, setTags] = useState<AppliedTag[]>([])
  const [vocabulary, setVocabulary] = useState<TagRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /* Both at once when the book changes, and both dropped when it does. The
     `live` flag is what stops an answer for the last book landing on this one,
     which on a queue somebody is working through is a second apart. */
  useEffect(() => {
    setError('')
    if (bookId === null) {
      setTags([])
      return
    }

    let live = true
    setTags([])
    void api.bookTags(bookId)
      .then((answer) => {
        if (live) setTags(answer.tags.filter((tag) => tag.source === 'person'))
      })
      .catch(() => { /* The tags are an addition to this screen, not the screen. */ })
    return () => { live = false }
  }, [bookId])

  /* The vocabulary is the collection's rather than the book's, so it is read
     once and not again per book. */
  useEffect(() => {
    let live = true
    void api.tags()
      .then((answer) => { if (live) setVocabulary(answer.tags) })
      .catch(() => { /* An empty vocabulary offers nothing and refuses nothing. */ })
    return () => { live = false }
  }, [])

  const said = (answer: { tags: AppliedTag[] }) => {
    setTags(answer.tags.filter((tag) => tag.source === 'person'))
  }

  const add = useCallback((tag: { slug: string; label: string }) => {
    if (bookId === null) return
    setBusy(true)
    setError('')
    api.applyTag(bookId, tag)
      .then(said)
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setBusy(false))
  }, [bookId])

  const remove = useCallback((slug: string) => {
    if (bookId === null) return
    setBusy(true)
    setError('')
    api.removeTag(bookId, slug)
      .then(said)
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setBusy(false))
  }, [bookId])

  return { tags, vocabulary, busy, error, add, remove }
}

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
    evidence, bookId, captureId, origin, notice, placement, placementStale, coverImage,
    checkedOutAt, misfile, misfileTakeable, misfileMoving,
    confirmMisfileMoved, takeMisfileBack, setDraft, setNotice, setRelookupError,
    setActiveSlot,
  } = book

  const derivedFiling = filingName(draft.authors.split(',')[0]?.trim() ?? '')

  const tagging = useTagging(bookId === null ? captureId : null)

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

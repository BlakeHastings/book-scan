import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Draft, LookupResponse } from '../lib/api'
import type { Frame } from '../lib/gallery'
import { type Slot } from '../lib/scanner'
import { BookFields } from './BookFields'
import { BookGallery } from './BookGallery'
import { ConfirmDialog } from './ConfirmDialog'
import { IsbnPrompt } from './IsbnPrompt'

interface Props {
  draft: Draft
  lookup: LookupResponse | null
  photos: Partial<Record<Slot, string>>
  /** The same photos cut to the book, where the detector found one. */
  crops?: Partial<Record<Slot, string>>
  /** Slots the detector has been shown, whether or not it found a book. */
  examined?: Slot[]
  derivedFiling: string
  saving: boolean
  relookupBusy: boolean
  relookupError: string
  /** True once the book is in the catalogue, which changes what you can do. */
  saved: boolean
  onChange: (patch: Partial<Draft>) => void
  onRelookup: (isbn: string) => void
  onClearRelookupError: () => void
  /** New book: on to the shelving step. */
  onShelve: () => void
  /** Existing book: write the edits and stay here. Resolves false if it failed. */
  onSaveEdits: () => Promise<boolean>
  onDiscard: () => void
  /** Label for the way out, since it depends on where you came from. */
  doneLabel?: string
  /** The shelf drawing. Rendered under the actions, as context not as a task. */
  placement?: ReactNode
  /** Null while the book is on a shelf, a timestamp while it is off one. */
  checkedOutAt?: string | null
  /** Take it off the shelf, or put it back. Saved books only. */
  onCheckOut?: (out: boolean) => void
  checkingOut?: boolean
  /** Present only for a book already on the shelves. */
  onDelete?: () => void
  deleting?: boolean
  /** Derived shelf, for display only. */
  shelfLabel?: string
  /**
   * The publisher's cover for whatever ISBN this matched, so the match itself
   * can be checked. An ISBN is thirteen digits nobody can verify by reading;
   * the cover is the one part of a lookup a person can confirm at a glance.
   */
  catalogueCover?: string
}

/**
 * Shown in place of the ISBN while a relookup is in flight. Short, rotated
 * rather than fixed, and dropped the moment an answer arrives: this is a flow
 * used repeatedly in one sitting, and the same line every time stops reading
 * as a joke by the third book.
 */
const HUNTING_FOR_IT = [
  'Checking the card catalogue...',
  'Trying the shelf it is definitely not on...',
  'Asking a librarian for a withering look...',
  'Following the trail of dog-eared pages...',
  'Squinting at a spine from across the room...',
  'Ruling out the large-print edition...',
]

/**
 * Everything known about one book.
 *
 * Two states, because there are two jobs. A book that is already catalogued is
 * something you look at: its facts read as text, and nothing invites a change
 * you did not mean. A book fresh off the camera, or one you have chosen to
 * edit, is something you correct, and only then do the fields become inputs.
 *
 * The actions sit at the top in both. They are the reason you opened the page,
 * and burying them under a form you did not come to fill in means scrolling
 * past twelve fields to reach the one button you wanted.
 */
export function BookDetail({
  draft, lookup, photos, crops, examined, derivedFiling, saving,
  relookupBusy, relookupError, saved,
  onChange, onRelookup, onClearRelookupError, onShelve, onSaveEdits, onDiscard,
  onDelete, deleting = false, shelfLabel = '', doneLabel = 'Done', placement,
  checkedOutAt = null, onCheckOut, checkingOut = false, catalogueCover = '',
}: Props) {
  // A catalogued book opens as a record. A new one opens ready to correct,
  // because correcting it is the whole reason it is on screen.
  const [editing, setEditing] = useState(!saved)
  const [asking, setAsking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [zoomed, setZoomed] = useState<Frame | null>(null)
  const [jokeIndex, setJokeIndex] = useState(0)
  const wasBusy = useRef(false)

  // Pick a new line each time a lookup starts, never repeating the one just
  // shown, so back-to-back changes on different books do not echo each other.
  useEffect(() => {
    if (relookupBusy && !wasBusy.current) {
      setJokeIndex((current) => {
        if (HUNTING_FOR_IT.length <= 1) return 0
        let next = Math.floor(Math.random() * HUNTING_FOR_IT.length)
        while (next === current) next = Math.floor(Math.random() * HUNTING_FOR_IT.length)
        return next
      })
    }
    wasBusy.current = relookupBusy
  }, [relookupBusy])

  const category = draft.isFiction ? 'Fiction' : 'Non-fiction'
  const filing = draft.authorFilingOverride || derivedFiling

  /*
   * Whether a save can run at all, for either kind of book.
   *
   * One expression, read by both buttons, because there is only one question
   * here and it does not depend on which of them is drawn. A relookup in
   * flight is about to replace the title, the authors and the ISBN; a save
   * started before it lands writes the record it was about to correct. #74
   * established that for a catalogued book and wrote the condition into that
   * branch, which left the new-book branch next to it doing the same work
   * unguarded, and that is the branch somebody changing an ISBN is most often
   * on: resolving a fresh capture. Copying the condition across would leave
   * two of them to keep in step, which is how one came to be missed. So it is
   * shared, the way #68 gave the Camera tab and Back to camera one
   * backToCamera().
   *
   * A lookup that fails or finds nothing clears relookupBusy in its finally,
   * so both buttons come back either way and neither can strand a book.
   */
  const saveBlocked = saving || relookupBusy || !draft.title
  const whyBlocked = relookupBusy ? 'Waiting for the ISBN lookup to finish' : undefined

  return (
    <>
      {!editing && (
        <header className="detail__head">
          <h2 className="detail__title">{draft.title || 'Untitled'}</h2>
          {draft.subtitle && <p className="detail__subtitle">{draft.subtitle}</p>}
          <p className="detail__author">{draft.authors || 'no author'}</p>
        </header>
      )}

      {/* Stated plainly and near the top: everything below, the strip
          especially, means something different for a book in a pile. */}
      {checkedOutAt && (
        <div className="checkedout">
          <strong>Off the bookcase</strong>
          <span>
            Taken down {new Date(checkedOutAt).toLocaleDateString()}. Nothing is
            filed next to it, and the bookcase has closed up behind it.
          </span>
        </div>
      )}

      <div className="actions actions--top">
        {editing ? (
          <>
            {saved ? (
              <button
                className="btn btn--primary"
                onClick={async () => {
                  // Back to the record only if the write went through; on a
                  // failure the edits must stay on screen to be retried.
                  if (await onSaveEdits()) setEditing(false)
                }}
                disabled={saveBlocked}
                title={whyBlocked}
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            ) : (
              <button
                className="btn btn--primary"
                onClick={onShelve}
                disabled={saveBlocked}
                title={whyBlocked}
              >
                Looks right, shelve it
              </button>
            )}
            <button
              className="btn"
              onClick={() => (saved ? setEditing(false) : onDiscard())}
              // Cancelling a catalogued book's edit drops back to the record
              // view without going through App at all, so nothing else would
              // stop a relookup's answer landing on it afterwards. Simplest
              // to make it wait, the same as Save: leaving mid-lookup is a
              // new book's edit unravelling entirely (onDiscard, already
              // session-safe), not a record view still showing a field the
              // lookup was about to change.
              disabled={saving || (saved && relookupBusy)}
              title={saved && relookupBusy ? 'Waiting for the ISBN lookup to finish' : undefined}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {/*
              * The one action the book's own state decides, and the only thing
              * that decides it. There is a single way in for a catalogued
              * book now, so this page cannot know whether somebody arrived
              * meaning to take it down or put it back, and it does not need
              * to: a book on the bookcase can come off it, a book that is off
              * can go back, and neither is ever offered as the other.
              */}
            {checkedOutAt ? (
              /* Back on through the same guided shuffle as a new book, which
                 is the point: it is how a shelf gets rearranged by hand. */
              <button className="btn btn--primary" onClick={onShelve}>
                Put it back on the bookcase
              </button>
            ) : onCheckOut ? (
              <button
                className="btn btn--primary"
                onClick={() => onCheckOut(true)}
                disabled={checkingOut}
              >
                {checkingOut ? 'Taking it off...' : 'Take it off the bookcase'}
              </button>
            ) : null}

            {/* Available in either state, because correcting a record has
                nothing to do with where the book physically is. */}
            <button className="btn" onClick={() => setEditing(true)}>
              Edit details
            </button>
            <button className="btn" onClick={onDiscard}>{doneLabel}</button>
          </>
        )}
      </div>

      {placement}

      {/*
        * One photo at a time, with the spine beside it.
        *
        * These used to be five images stacked down the page: the catalogue
        * cover and the front photo side by side to compare, then all three
        * captures again below. That is most of a phone screen for something
        * you are looking at with the book itself in your other hand. The
        * catalogue cover and the front photo are still adjacent, so flicking
        * between them answers "is this the same book" by putting one exactly
        * where the other was, which is a sharper comparison than two
        * thumbnails at half width.
        */}
      <BookGallery
        sources={{
          catalogue: catalogueCover,
          front: photos.front,
          back: photos.back,
          edge: photos.edge,
          crops,
          examined,
        }}
        onZoom={setZoomed}
      />

      {/* Full screen shows the whole photograph, not the crop the gallery
          drew. Cropping exists so the gallery is a wall of books rather than a
          wall of carpet; nothing about that means the photograph somebody took
          should become unreachable, and this is where the owner's "the full
          versus the cropped" choice actually lives. */}
      {zoomed && (
        <div className="lightbox" onClick={() => setZoomed(null)}>
          <img src={zoomed.full || zoomed.src} alt={zoomed.label} />
          <span className="lightbox__hint">
            {zoomed.full && zoomed.full !== zoomed.src
              ? 'The whole photo. Tap to close'
              : 'Tap to close'}
          </span>
        </div>
      )}

      {/* The ISBN is the key everything else hangs off, so it is changeable
          even though it is not a field: a wrong digit means every other value
          is wrong, and the fix is to re-fetch rather than retype the lot. */}
      <div className="isbn-block">
        <div className="isbn-block__values">
          <span className="isbn-block__label">ISBN</span>
          {relookupBusy ? (
            <span className="isbn-block__number isbn-block__number--busy">
              {HUNTING_FOR_IT[jokeIndex]}
            </span>
          ) : (
            <>
              <span className="isbn-block__number">{draft.isbn13 || 'not set'}</span>
              {draft.isbn10 && <span className="isbn-block__alt">also {draft.isbn10}</span>}
              {draft.isbnSource && (
                <span className="isbn-block__source">read from {draft.isbnSource}</span>
              )}
            </>
          )}
        </div>
        {editing && (
          relookupBusy ? (
            <span className="isbn-block__busy" role="status" aria-live="polite">
              <span className="isbn-block__busy-dot" aria-hidden="true" />
              Looking up
            </span>
          ) : (
            <button
              className="btn"
              onClick={() => { onClearRelookupError(); setAsking(true) }}
            >
              Change ISBN
            </button>
          )
        )}
      </div>

      {/* Surfaced here rather than only in the prompt, because a failure
          arrives after the prompt has already closed: the user is back on
          this view by the time the answer comes in. Tap to dismiss, same as
          the banner above. */}
      {!relookupBusy && relookupError && (
        <div className="warn isbn-block__error" onClick={onClearRelookupError}>
          Could not look that up: {relookupError.replace(/\.?$/, '')}. The
          digits you typed are still saved; tap to dismiss and try again.
        </div>
      )}

      {asking && (
        <IsbnPrompt
          initial={draft.isbn13 || draft.isbn10}
          onCancel={() => setAsking(false)}
          onSubmit={(isbn) => { onRelookup(isbn); setAsking(false) }}
        />
      )}

      {confirmingDelete && onDelete && (
        <ConfirmDialog
          title="Delete this book?"
          body={
            `${draft.title || 'This book'} will be removed from the catalogue and ` +
            'its photos deleted from disk. This cannot be undone.'
          }
          confirmLabel="Delete book"
          busy={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={onDelete}
        />
      )}

      {editing ? (
        <BookFields
          draft={draft}
          lookup={lookup}
          derivedFiling={derivedFiling}
          onChange={onChange}
        />
      ) : (
        <dl className="facts">
          <Fact label="Category" value={category} />
          <Fact label="Files under" value={filing} />
          <Fact label="Bookcase" value={shelfLabel} />
          <Fact label="Series" value={seriesText(draft)} />
          <Fact label="Publisher" value={draft.publisher} />
          <Fact label="Published" value={draft.published} />
          <Fact label="Pages" value={draft.pages} />
          <Fact label="Notes" value={draft.notes} />
        </dl>
      )}

      {/* Kept well away from Save and Cancel so it cannot be hit by accident. */}
      {onDelete && (
        <div className="danger-zone">
          <button className="btn btn--ghost" onClick={() => setConfirmingDelete(true)}>
            Delete this book and its photos
          </button>
        </div>
      )}
    </>
  )
}

function seriesText(draft: Draft): string {
  if (!draft.seriesName) return ''
  return draft.seriesIndex ? `${draft.seriesName} #${draft.seriesIndex}` : draft.seriesName
}

/** A row of the record. Empty values are dropped rather than shown as blanks. */
function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="facts__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

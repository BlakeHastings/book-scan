import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Draft, LookupResponse, Misfile } from '../lib/api'
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
  /** Check it out, or check it in. Saved books only. */
  onCheckOut?: (out: boolean) => void
  checkingOut?: boolean
  /**
   * Which plank a boundary move would land this book on, in each direction.
   * Null or absent everywhere it cannot go: not shelved, still being edited,
   * or genuinely in the middle of its area, where the server would refuse the
   * move anyway (#96). Read from the same placement preview the shelf drawing
   * below already uses, so nothing extra is fetched to offer it.
   */
  boundaryMoves?: { next: string | null; previous: string | null } | null
  /** Carry the first or last book of an area to the plank beside it. */
  onBoundaryMove?: (direction: 'next' | 'previous') => void
  boundaryMoving?: boolean
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
  /**
   * This book's entry in the shelving review, when the catalogue and the
   * order disagree about where it is.
   *
   * Null or absent for every book that is not flagged, which is nearly all of
   * them, and nothing is drawn in that case. The judgement is the server's:
   * this arrives from `api.misfiles`, already carrying the two facts the
   * library row carries, rather than being worked out again here from the
   * placement below (see findMisfile in src/lib/misfile.ts).
   */
  misfile?: Misfile | null
  /** A person says they have carried the book to where the order puts it. */
  onMisfileMoved?: () => void
  /**
   * A person says they never picked it up, so the boundary move goes back.
   *
   * Absent unless the server reports this misfile as an outstanding move. That
   * is the difference between an assignment the app made and the order having
   * genuinely moved a book, and only the first one is anybody's to withdraw.
   */
  onMisfileTakenBack?: () => void
  misfileMoving?: boolean
  /**
   * The lines OCR read off this capture's cover photograph, newline
   * separated, exactly as the queue row already quotes them.
   *
   * Empty for a catalogued book, which has no capture behind it, and for a
   * capture whose photographs produced nothing readable.
   */
  coverText?: string
  /**
   * The queue's note on this capture: usually why it could not settle what
   * the book is, and the line the next person needs before they start.
   */
  captureNote?: string
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
  boundaryMoves = null, onBoundaryMove, boundaryMoving = false,
  misfile = null, onMisfileMoved, onMisfileTakenBack, misfileMoving = false,
  coverText = '', captureNote = '',
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
  const whyBlocked = relookupBusy
    ? 'Waiting for the ISBN lookup to finish'
    // Reachable since #156, and it was not before: a capture the app could not
    // identify used to arrive with the OCR guess sitting in the Title box, so
    // this button was live and one tap shelved that guess. Now the box is
    // empty, and a disabled button with nothing said about it is the shape
    // that makes somebody prod at a screen wondering what is broken.
    : !draft.title
      ? 'Give it a title first'
      : undefined

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
          <strong>Checked out</strong>
          <span>
            Checked out {new Date(checkedOutAt).toLocaleDateString()}. Nothing
            is filed next to it, and the bookcase has closed up behind it.
          </span>
        </div>
      )}

      {/* Beside the checked-out banner, and for the same reason: it is a fact
          about where the book physically is, and the page below reads
          differently once you know it. The two are mutually exclusive in
          practice, since a book off the shelf holds no position to be wrong
          about and the server excludes it from the review entirely. */}
      {misfile && onMisfileMoved && (
        <MisfileNotice
          misfile={misfile}
          moving={misfileMoving}
          onMoved={onMisfileMoved}
          onTakeBack={onMisfileTakenBack}
        />
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
              /* Check-in goes through the same guided shuffle as a new book,
                 which is the point: it is how a shelf gets rearranged by
                 hand. */
              <button className="btn btn--primary" onClick={onShelve}>
                Check in
              </button>
            ) : onCheckOut ? (
              <button
                className="btn btn--primary"
                onClick={() => onCheckOut(true)}
                disabled={checkingOut}
              >
                {checkingOut ? 'Checking out...' : 'Check out'}
              </button>
            ) : null}

            {/*
              * Offered only when this book's own recorded position is the
              * first or last of its area, and only in the direction that has
              * somewhere to go (#96). The library used to draw this next to
              * every area instead, which is cramped in a scrolling run of
              * spines and one tap away from moving a book nobody meant to
              * touch; here there is no ambiguity about which book it is.
              * Starting the move hands off to the shelving step exactly the
              * way it always has: named plank, walk over, confirm.
              */}
            {!checkedOutAt && onBoundaryMove && boundaryMoves?.next && (
              <button
                className="btn"
                onClick={() => onBoundaryMove('next')}
                disabled={boundaryMoving}
              >
                {boundaryMoving ? 'Moving...' : `Move it on to ${boundaryMoves.next}`}
              </button>
            )}
            {!checkedOutAt && onBoundaryMove && boundaryMoves?.previous && (
              <button
                className="btn"
                onClick={() => onBoundaryMove('previous')}
                disabled={boundaryMoving}
              >
                {boundaryMoving ? 'Moving...' : `Move it back to ${boundaryMoves.previous}`}
              </button>
            )}

            {/* Available in either state, because correcting a record has
                nothing to do with where the book physically is. */}
            <button className="btn" onClick={() => setEditing(true)}>
              Edit details
            </button>
            <button className="btn" onClick={onDiscard}>{doneLabel}</button>
          </>
        )}
      </div>

      {/* In the page rather than only in that button's tooltip: this is a
          phone, there is no hover, and a `title` attribute is never read on
          one. Says what to do, not what is wrong. */}
      {editing && !saved && !draft.title && !relookupBusy && (
        <p className="hint hint--blocked">
          Type the title off the book to shelve it. Nothing has been filled in
          from the photographs; what the cover reads is quoted below.
        </p>
      )}

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

      {/* Directly above the fields, because this is what somebody reads while
          they type into them. Anywhere higher and it is off screen by the
          time the Title box is, which is the complaint in a shorter form. */}
      <CaptureEvidence coverText={coverText} note={captureNote} />

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

/**
 * What the photographs said, on the screen where somebody has to work out
 * what the book is.
 *
 * This is the page for exactly the captures the app could not settle by
 * itself, and its one piece of evidence used to be on the previous screen:
 * the queue row said "Cover reads: Song of Solomon", and opening the row
 * showed neither that nor the note. Somebody correcting a stack of these was
 * backing out to re-read a line they had just been shown and holding it in
 * their head while typing (#147).
 *
 * Shown as evidence and never as a value. Nothing here is pre-filled into a
 * field and there is deliberately no control that copies it across: OCR is a
 * lossy, engine-version-dependent reading of a photograph, and a guess
 * promoted into a box somebody then saves enters the catalogue wearing the
 * clothes of a confirmed value. So it is quoted beside the form rather than
 * poured into it, and it says both where it came from and how much to trust
 * it.
 *
 * The note gets the same room. Three people work one pile, and a note is how
 * one of them hands the work to the next.
 */
export function CaptureEvidence({ coverText = '', note = '' }: {
  coverText?: string
  note?: string
}) {
  const lines = coverText.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length && !note) return null

  return (
    <section className="evidence">
      {note && (
        <p className="evidence__note">
          <span className="evidence__label">Note</span>
          {note}
        </p>
      )}

      {lines.length > 0 && (
        <div className="evidence__cover">
          <span className="evidence__label">The cover photo reads</span>
          <ul className="evidence__lines">
            {lines.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
          <p className="evidence__caveat">
            Read off the photograph by a machine, and often wrong. Nothing here
            has been filled in for you: type what the book itself says.
          </p>
        </div>
      )}
    </section>
  )
}

/**
 * The one thing this page was missing: that the catalogue and the order
 * disagree about where this book is, and that a person can close it.
 *
 * Both places are named, the same two the library's "Needs attention" row
 * carries, because "this book is misfiled" is not actionable on its own: you
 * are standing in front of the bookcase and need to know which shelf to take
 * it off and which to put it on. The placement drawing further down already
 * says where it belongs, so this does not draw that again; what it adds is the
 * disagreement itself.
 *
 * "Moved it" means somebody has physically carried the book. There is
 * deliberately no dismiss, no ignore and no clear: the recorded location is the
 * sole record of where the book actually is, and writing it to tidy a screen
 * would throw that record away and leave the book lost.
 *
 * "Undo the move" is not one of those, and it is offered only when the server
 * says a boundary move is outstanding on this book. It withdraws something the
 * app did and writes no location at all, so the record of where the book is
 * survives it untouched. Where it is absent, the list is still a report and can
 * still only be closed by a walk to the shelf.
 */
export function MisfileNotice({ misfile, moving, onMoved, onTakeBack }: {
  misfile: Misfile
  moving: boolean
  onMoved: () => void
  onTakeBack?: (() => void) | undefined
}) {
  return (
    <div className="misfile">
      <strong className="misfile__head">Needs attention</strong>
      <span className="misfile__where">
        Last seen on {misfile.from}. The order now puts it on{' '}
        <strong>{misfile.to}</strong>.
      </span>
      <span className="misfile__hint">
        Nothing has been changed for you. Tap "Moved it" once the book is
        actually there
        {onTakeBack ? ', or undo the move if you never picked it up.' : '.'}
      </span>
      <button className="btn btn--ghost" disabled={moving} onClick={onMoved}>
        {moving ? '...' : 'Moved it'}
      </button>
      {onTakeBack && (
        <button className="btn btn--ghost" disabled={moving} onClick={onTakeBack}>
          {moving ? '...' : 'Undo the move'}
        </button>
      )}
    </div>
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

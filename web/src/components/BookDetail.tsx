import { useState, type ReactNode } from 'react'
import type { Draft, LookupResponse } from '../lib/api'
import { SLOTS, SLOT_LABEL, type Slot } from '../lib/scanner'
import { BookFields } from './BookFields'
import { ConfirmDialog } from './ConfirmDialog'
import { IsbnPrompt } from './IsbnPrompt'

interface Props {
  draft: Draft
  lookup: LookupResponse | null
  photos: Partial<Record<Slot, string>>
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
}

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
  draft, lookup, photos, derivedFiling, saving,
  relookupBusy, relookupError, saved,
  onChange, onRelookup, onClearRelookupError, onShelve, onSaveEdits, onDiscard,
  onDelete, deleting = false, shelfLabel = '', doneLabel = 'Done', placement,
  checkedOutAt = null, onCheckOut, checkingOut = false,
}: Props) {
  // A catalogued book opens as a record. A new one opens ready to correct,
  // because correcting it is the whole reason it is on screen.
  const [editing, setEditing] = useState(!saved)
  const [asking, setAsking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [zoomed, setZoomed] = useState<Slot | null>(null)

  const taken = SLOTS.filter((slot) => photos[slot])
  const category = draft.isFiction ? 'Fiction' : 'Non-fiction'
  const filing = draft.authorFilingOverride || derivedFiling

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
          <strong>Off the shelf</strong>
          <span>
            Taken down {new Date(checkedOutAt).toLocaleDateString()}. Nothing is
            filed next to it, and the shelf has closed up behind it.
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
                disabled={saving || !draft.title}
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            ) : (
              <button
                className="btn btn--primary"
                onClick={onShelve}
                disabled={saving || !draft.title}
              >
                Looks right, shelve it
              </button>
            )}
            <button
              className="btn"
              onClick={() => (saved ? setEditing(false) : onDiscard())}
              disabled={saving}
            >
              Cancel
            </button>
          </>
        ) : checkedOutAt ? (
          <>
            {/* Back on through the same guided shuffle as a new book, which is
                the point: it is how a shelf gets rearranged by hand. */}
            <button className="btn btn--primary" onClick={onShelve}>
              Put it back on the shelf
            </button>
            <button className="btn" onClick={onDiscard}>{doneLabel}</button>
          </>
        ) : (
          <>
            <button className="btn btn--primary" onClick={() => setEditing(true)}>
              Edit details
            </button>
            <button className="btn" onClick={onDiscard}>{doneLabel}</button>
          </>
        )}
      </div>

      {!editing && onCheckOut && !checkedOutAt && (
        <div className="actions">
          <button
            className="btn btn--ghost"
            onClick={() => onCheckOut(true)}
            disabled={checkingOut}
          >
            {checkingOut ? 'Taking it off...' : 'Take it off the shelf'}
          </button>
        </div>
      )}

      {placement}

      {taken.length > 0 && (
        <div className="photos">
          {taken.map((slot) => (
            <figure key={slot} className="photo" onClick={() => setZoomed(slot)}>
              <img src={photos[slot]} alt={SLOT_LABEL[slot]} loading="lazy" />
              <figcaption>{SLOT_LABEL[slot]}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {zoomed && photos[zoomed] && (
        <div className="lightbox" onClick={() => setZoomed(null)}>
          <img src={photos[zoomed]} alt={SLOT_LABEL[zoomed]} />
          <span className="lightbox__hint">Tap to close</span>
        </div>
      )}

      {/* The ISBN is the key everything else hangs off, so it is changeable
          even though it is not a field: a wrong digit means every other value
          is wrong, and the fix is to re-fetch rather than retype the lot. */}
      <div className="isbn-block">
        <div className="isbn-block__values">
          <span className="isbn-block__label">ISBN</span>
          <span className="isbn-block__number">{draft.isbn13 || 'not set'}</span>
          {draft.isbn10 && <span className="isbn-block__alt">also {draft.isbn10}</span>}
          {draft.isbnSource && (
            <span className="isbn-block__source">read from {draft.isbnSource}</span>
          )}
        </div>
        {editing && (
          <button
            className="btn"
            onClick={() => { onClearRelookupError(); setAsking(true) }}
          >
            Change ISBN
          </button>
        )}
      </div>

      {asking && (
        <IsbnPrompt
          initial={draft.isbn13 || draft.isbn10}
          busy={relookupBusy}
          error={relookupError}
          onCancel={() => { setAsking(false); onClearRelookupError() }}
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
          <Fact label="Shelf" value={shelfLabel} />
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

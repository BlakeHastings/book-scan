import { useState } from 'react'
import type { Draft, LookupResponse } from '../lib/api'
import { SLOTS, SLOT_LABEL, type Slot } from '../lib/scanner'
import { ConfirmDialog } from './ConfirmDialog'
import { IsbnPrompt } from './IsbnPrompt'
import { ReviewPane } from './ReviewPane'

interface Props {
  draft: Draft
  lookup: LookupResponse | null
  photos: Partial<Record<Slot, string>>
  derivedFiling: string
  saving: boolean
  relookupBusy: boolean
  relookupError: string
  onChange: (patch: Partial<Draft>) => void
  onRelookup: (isbn: string) => void
  onClearRelookupError: () => void
  onSave: () => void
  onDiscard: () => void
  /** Present only for a book already on the shelves. */
  onDelete?: () => void
  deleting?: boolean
  /** Derived shelf, for display only. */
  shelfLabel?: string
}

/**
 * Everything known about one book: its three photos, every editable field, and
 * the ISBN it was matched on.
 *
 * The ISBN sits at the top and is changeable, because it is the key the whole
 * record hangs off. A misread digit means every other field is wrong, and the
 * fix is to correct the ISBN and re-fetch rather than retype the metadata by
 * hand.
 */
export function BookDetail({
  draft, lookup, photos, derivedFiling, saving,
  relookupBusy, relookupError,
  onChange, onRelookup, onClearRelookupError, onSave, onDiscard,
  onDelete, deleting = false, shelfLabel = '',
}: Props) {
  const [asking, setAsking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [zoomed, setZoomed] = useState<Slot | null>(null)

  const taken = SLOTS.filter((slot) => photos[slot])

  return (
    <>
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

      <div className="isbn-block">
        <div className="isbn-block__values">
          <span className="isbn-block__label">ISBN</span>
          <span className="isbn-block__number">
            {draft.isbn13 || 'not set'}
          </span>
          {draft.isbn10 && (
            <span className="isbn-block__alt">also {draft.isbn10}</span>
          )}
          {draft.isbnSource && (
            <span className="isbn-block__source">read from {draft.isbnSource}</span>
          )}
        </div>
        <button
          className="btn"
          onClick={() => { onClearRelookupError(); setAsking(true) }}
        >
          Change ISBN
        </button>
      </div>

      {asking && (
        <IsbnPrompt
          initial={draft.isbn13 || draft.isbn10}
          busy={relookupBusy}
          error={relookupError}
          onCancel={() => { setAsking(false); onClearRelookupError() }}
          onSubmit={(isbn) => {
            onRelookup(isbn)
            setAsking(false)
          }}
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

      <ReviewPane
        draft={draft}
        lookup={lookup}
        derivedFiling={derivedFiling}
        onChange={onChange}
        onSave={onSave}
        onDiscard={onDiscard}
        saving={saving}
        shelfLabel={shelfLabel}
      />

      {/* Only offered for a book that is actually on the shelves. Kept away
          from Save and Cancel so it is not hit by accident. */}
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

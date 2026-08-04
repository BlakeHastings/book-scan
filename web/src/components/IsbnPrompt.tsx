import { useEffect, useRef, useState } from 'react'
import { resolveIsbnPair } from '../../shared/isbn'
import { IsbnCamera } from './IsbnCamera'

interface Props {
  initial: string
  onCancel: () => void
  onSubmit: (isbn: string) => void
}

/**
 * Asks for an ISBN and validates it before spending a network round trip.
 *
 * The photos stay visible behind it: the whole point is to read the digits off
 * the cover on screen and type them in, so a full-screen dialog would hide the
 * thing being copied.
 *
 * The lookup itself happens after this closes, not while it is open: submit
 * hands the ISBN off and this unmounts immediately, so the search plays out on
 * the detail view underneath rather than inside a busy modal. That is also
 * why there is no busy or error state here; both belong to the screen the
 * answer actually lands on.
 */
export function IsbnPrompt({ initial, onCancel, onSubmit }: Props) {
  const [value, setValue] = useState(initial)
  const [scanning, setScanning] = useState(false)
  const [readFrom, setReadFrom] = useState<'barcode' | 'ocr' | ''>('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const pair = resolveIsbnPair(value)
  const digits = value.replace(/[^0-9Xx]/g, '')
  const valid = Boolean(pair.isbn13)
  // Only complain once enough has been typed to judge it.
  const showInvalid = digits.length >= 10 && !valid

  if (scanning) {
    return (
      <IsbnCamera
        onCancel={() => setScanning(false)}
        onRead={(isbn, source) => {
          setValue(isbn)
          setReadFrom(source)
          setScanning(false)
        }}
      />
    )
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Change ISBN">
      <div className="modal__card">
        <h3 className="modal__title">Change ISBN</h3>
        <p className="hint">
          Type the ISBN, or tap the camera to read it off the book. Hyphens and
          spaces are fine.
        </p>

        <div className="isbn-input">
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => { setValue(event.target.value); setReadFrom('') }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && valid) onSubmit(value)
              if (event.key === 'Escape') onCancel()
            }}
            placeholder="978-0-441-01359-3"
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          <button
            type="button"
            className="isbn-input__cam"
            onClick={() => setScanning(true)}
            aria-label="Photograph the ISBN"
            title="Photograph the ISBN"
          >
            <CameraIcon />
          </button>
        </div>

        <p className={showInvalid ? 'modal__check modal__check--bad' : 'modal__check'}>
          {showInvalid
            ? 'That is not a valid ISBN-10 or ISBN-13. Check the digits.'
            : valid
              ? `Reads as ${pair.isbn13}${pair.isbn10 ? ` (${pair.isbn10})` : ''}`
              : 'Enter 10 or 13 digits.'}
        </p>

        {/* Named rather than implied. A barcode read is as good as typing it;
            a text read is a guess at digits and deserves a second look. */}
        {readFrom && valid && (
          <p className={readFrom === 'ocr' ? 'modal__read modal__read--soft' : 'modal__read'}>
            {readFrom === 'barcode'
              ? 'Scanned from the barcode.'
              : 'Read from the printed text. Check the digits before looking it up.'}
          </p>
        )}

        <div className="actions">
          <button
            className="btn btn--primary"
            onClick={() => onSubmit(value)}
            disabled={!valid}
          >
            Look up and replace
          </button>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

/** Outline camera, sized to sit inside the input. */
function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1-2h6.6l1 2h2.2A1.5 1.5 0 0 1 19 8.5v9A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="11" cy="13" r="3.2" />
    </svg>
  )
}

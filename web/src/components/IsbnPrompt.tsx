import { useEffect, useRef, useState } from 'react'
import { resolveIsbnPair } from '../../shared/isbn'

interface Props {
  initial: string
  busy: boolean
  error: string
  onCancel: () => void
  onSubmit: (isbn: string) => void
}

/**
 * Asks for an ISBN and validates it before spending a network round trip.
 *
 * The photos stay visible behind it: the whole point is to read the digits off
 * the cover on screen and type them in, so a full-screen dialog would hide the
 * thing being copied.
 */
export function IsbnPrompt({ initial, busy, error, onCancel, onSubmit }: Props) {
  const [value, setValue] = useState(initial)
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

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Change ISBN">
      <div className="modal__card">
        <h3 className="modal__title">Change ISBN</h3>
        <p className="hint">
          Type the ISBN printed on the book. Hyphens and spaces are fine.
        </p>

        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && valid && !busy) onSubmit(value)
            if (event.key === 'Escape') onCancel()
          }}
          placeholder="978-0-441-01359-3"
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />

        <p className={showInvalid ? 'modal__check modal__check--bad' : 'modal__check'}>
          {showInvalid
            ? 'That is not a valid ISBN-10 or ISBN-13. Check the digits.'
            : valid
              ? `Reads as ${pair.isbn13}${pair.isbn10 ? ` (${pair.isbn10})` : ''}`
              : 'Enter 10 or 13 digits.'}
        </p>

        {error && <div className="warn">{error}</div>}

        <div className="actions">
          <button
            className="btn btn--primary"
            onClick={() => onSubmit(value)}
            disabled={!valid || busy}
          >
            {busy ? 'Looking up...' : 'Look up and replace'}
          </button>
          <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

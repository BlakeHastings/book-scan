/**
 * The cataloguing camera's answer to "this book is already in the queue".
 *
 * A notice rather than a panel: it sits above the bar in `Viewfinder`'s
 * `over`, so the shutter, "New book" and "Done" stay where they are and stay
 * pressable while it is up. Two choices and no third, each saying what it does
 * to the photographs just taken. Who has the other one open is not said here:
 * the only name the queue has for that is a device id.
 */

import { captureName, type QueueMatch } from '../lib/api'

interface Props {
  /** The captures already waiting that this book appears to be, closest first. */
  matches: QueueMatch[]
  /** Go and finish the one already in the queue, dropping what was just taken. */
  onSame: (match: QueueMatch) => void
  /** Keep what was just taken as a book of its own. */
  onAnother: () => void
  disabled?: boolean
}

export function QueuedNotice({ matches, onSame, onAnother, disabled }: Props) {
  const closest = matches[0]
  if (!closest) return null

  const name = captureName(closest.capture).text
  const more = matches.length - 1
  // Opening one still being read would land on a form with nothing in it, so
  // the choice waits for it and says so rather than refusing after the tap.
  const stillReading = closest.capture.status === 'pending'

  return (
    <section className="cam__queued" aria-label="Already in the queue">
      <p className="cam__queued-said">
        <strong>Already in the queue:</strong>
        {` ${name}`}
        {more > 0 ? `, and ${more} more like it` : ''}
        {stillReading ? '. It is still being read.' : '.'}
      </p>
      <div className="cam__queued-choices">
        <button
          type="button"
          className="cam__queued-choice"
          onClick={() => onSame(closest)}
          disabled={disabled || stillReading}
        >
          Same book: open the one in the queue
        </button>
        <button
          type="button"
          className="cam__queued-choice"
          onClick={onAnother}
          disabled={disabled}
        >
          Another copy: keep scanning
        </button>
      </div>
    </section>
  )
}

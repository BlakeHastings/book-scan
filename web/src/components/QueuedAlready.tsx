import { draftFromCapture, type QueueMatch } from '../lib/api'
import { coverUrl } from './PlacementCard'
import { queueThumb } from '../lib/queuePhoto'
import { confidenceLine, matchConfidence } from '../../shared/confidence'

interface Props {
  /** The captures already waiting that this book appears to be. */
  matches: QueueMatch[]
  /** Open one of them. Claiming it is the caller's business, not this panel's. */
  onOpen: (match: QueueMatch) => void
  /** The way past the answer, which every use of this must have. */
  onDismiss: () => void
  /** What the way past says, since it differs by where the person is stood. */
  dismissLabel: string
  /**
   * The shot being answered, as a data URL.
   *
   * Only the scanner has one: it hashes a single frame and keeps it so every
   * answer can be held against the same picture. The Add flow leaves this out
   * altogether, because the photographs it is asking about are on the chips
   * below, and a box captioned "your shot" with nothing in it reads as a
   * picture that failed to load rather than as one that was never taken.
   */
  shot?: string
  /** What tapping a match will do, said before it is tapped. */
  note: string
  disabled?: boolean
  /** Extra class on the panel, for where it has to sit on a busier screen. */
  className?: string
}

/**
 * "This is already in the queue."
 *
 * One panel, drawn the same wherever the answer comes from, because it is the
 * same answer: somebody photographed this book already and has not shelved it
 * yet. It reached the scanner first (#122) and the Add flow second (#146), and
 * the Add flow is the door people actually use when working through a stack,
 * so a second wording would be the one most people read.
 *
 * Said as a finding, never as an instruction to scan again. Scanning it again
 * is the thing that has been happening and is the thing being stopped.
 *
 * Nothing here decides anything. It draws what was found, offers each capture,
 * and offers the way past, and a person picks. Two copies of one book genuinely
 * exist sometimes, so an answer with no way out of it would be worse than no
 * answer: the person would photograph the book again to escape it.
 */
export function QueuedAlready({
  matches, onOpen, onDismiss, dismissLabel, shot, note, disabled, className,
}: Props) {
  if (!matches.length) return null

  return (
    <div className={`isbncam__choices isbncam__choices--queued ${className ?? ''}`.trim()}>
      <div className={`choices__head${shot === undefined ? ' choices__head--noshot' : ''}`}>
        {shot === undefined ? null : shot
          ? <img className="choices__shot" src={shot} alt="The shot this is answering" />
          : <span className="choice__nocover">your shot</span>}
        <span className="choice__text">
          <span className="choice__title">
            {matches.length === 1
              ? 'This is already in the queue'
              : 'These are already in the queue'}
          </span>
          <span className="choice__author">
            Scanned already and waiting to be shelved. {note}
          </span>
        </span>
      </div>

      {matches.map((match) => {
        const { capture, distance, basis } = match
        // What anybody has worked out about it, over what the worker read,
        // exactly as the queue draws it. A capture has no catalogue id and
        // often no title yet, so the number it was given stands in.
        const draft = draftFromCapture(capture)
        const title = draft.title || `Book #${capture.id}`
        const thumb = queueThumb(capture, 'front')
        // Two kinds of evidence, said as the two different things they are.
        // An ISBN is exact and carries its own check digit; a hash distance is
        // a likeness with a measured error rate, and it is the one that gets a
        // band and a percentage because it is the one that is a measurement.
        const confidence = basis === 'cover' && distance !== null
          ? matchConfidence(distance)
          : null
        const said = confidence
          ? confidenceLine(confidence)
          : `same ISBN, ${capture.isbn13}`
        return (
          <button
            key={capture.id}
            className="choice choice--close"
            onClick={() => onOpen(match)}
            disabled={disabled}
            aria-label={`${title}, already in the queue, ${said}`}
          >
            {thumb
              ? <img src={coverUrl(thumb)} alt="" loading="lazy" />
              : <span className="choice__nocover">no photo</span>}
            <span className="choice__text">
              <span className="choice__title">{title}</span>
              {/* Who has been near it, because the person holding the book
                  needs to know whether they are picking up their own work
                  or somebody else's half-finished job. */}
              <span className="choice__author">
                {capture.claimed_by
                  ? `${capture.claimed_by} has it open`
                  : capture.edited_at
                    ? `looked at by ${capture.edited_by || 'someone'}`
                    : 'nobody has been near it yet'}
              </span>
              <span className="choice__confidence choice__confidence--close">
                {confidence ? confidence.label : 'same ISBN'}
                {confidence?.percent != null
                  ? <span className="choice__percent"> · {confidence.percent}%</span>
                  : <span className="choice__percent"> · {capture.isbn13}</span>}
              </span>
              {capture.status === 'pending' && (
                <span className="choice__note">still being read</span>
              )}
            </span>
          </button>
        )
      })}

      {/* The way out, and it has to be here. A wrong answer with no way
          past it is worse than no answer: the person would photograph the
          book again to escape it, which is the thing being prevented. */}
      <button className="btn btn--ghost" onClick={onDismiss}>
        {dismissLabel}
      </button>
    </div>
  )
}

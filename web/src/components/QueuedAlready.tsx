import { captureName, type QueueMatch } from '../lib/api'
import { shotsOf } from '../lib/queuePhoto'
import { Card, Said } from '../design/Card'
import { Button } from '../design/Controls'
import { Queued } from '../design/Queue'
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
 *
 * ## What the gallery answers for here, and what it does not (#387)
 *
 * **The panel is not drawn anywhere.** #411 said so and left it, and it is
 * still true: no screen in the gallery has an answer floating over a live
 * camera. So its position over the picture is the app's, in `styles.css`, the
 * way the camera's own error line and toast already are, and `Viewfinder`'s
 * `over` slot exists to be handed exactly this.
 *
 * **What is inside it is drawn, and it is drawn for this exact thing.** Every
 * row here is a book waiting on the table, which is what `Queued` is: the same
 * component the queue screen draws the same capture with, so the book offered
 * here and the row it opens cannot read differently. The bad news goes in the
 * card's title, where `Card`'s header says news belongs, and the way past is a
 * `Button` rather than a panel of its own.
 *
 * The evidence rides the pills `Queued` already carries, because that is what
 * they are for: how alike, said in words with its percentage; what needs a
 * person, where the capture is still being read; and who has it, which is the
 * device pill. A pill is never only a colour, and none of these is.
 */
export function QueuedAlready({
  matches, onOpen, onDismiss, dismissLabel, shot, note, disabled, className,
}: Props) {
  if (!matches.length) return null

  // Three states, not two. No frame at all is the Add flow, which is asking
  // about photographs that are elsewhere on screen; an empty string is the
  // scanner with a frame still being shrunk, which is a placeholder rather
  // than an absence.
  const yourShot = shot === undefined
    ? null
    : shot
      ? <img className="queued__shot" src={shot} alt="The shot this is answering" />
      : <span className="queued__shot queued__shot--waiting">your shot</span>

  return (
    <div className={`queued ${className ?? ''}`.trim()}>
      <Card
        title={matches.length === 1
          ? 'This is already in the queue'
          : 'These are already in the queue'}
        kind="Scanned already and waiting to be shelved"
        foot={
          /* The way out, and it has to be here. A wrong answer with no way
             past it is worse than no answer: the person would photograph the
             book again to escape it, which is the thing being prevented. */
          <Button tone="quiet" block onPress={onDismiss}>
            {dismissLabel}
          </Button>
        }
      >
        {/* The frame every answer below is being held against, kept with the
            sentence saying what tapping one does. */}
        {yourShot}
        <Said>{note}</Said>

        {matches.map((match) => {
          const { capture, distance, basis } = match
          // Named exactly as the queue names it, out of the same rule, so the
          // book offered here and the row it opens read the same. Whether that
          // name is a guess does not change the answer this panel gives: the
          // evidence is the hash distance or the ISBN, both said below, and
          // neither of them came from the cover text.
          const name = captureName(capture)
          // Two kinds of evidence, said as the two different things they are.
          // An ISBN is exact and carries its own check digit; a hash distance
          // is a likeness with a measured error rate, and it is the one that
          // gets a band and a percentage because it is the one that is a
          // measurement.
          const confidence = basis === 'cover' && distance !== null
            ? matchConfidence(distance)
            : null
          const said = confidence
            ? confidenceLine(confidence)
            : `same ISBN, ${capture.isbn13}`
          return (
            <button
              key={capture.id}
              type="button"
              className="queued__pick"
              onClick={() => onOpen(match)}
              disabled={disabled}
              aria-label={`${name.text}, already in the queue, ${said}`}
            >
              <Queued
                name={name.text}
                guessed={name.guessed}
                /* Who has been near it, because the person holding the book
                   needs to know whether they are picking up their own work or
                   somebody else's half-finished job. */
                sub={capture.claimed_by
                  ? `${capture.claimed_by} has it open`
                  : capture.edited_at
                    ? `looked at by ${capture.edited_by || 'someone'}`
                    : 'nobody has been near it yet'}
                shots={shotsOf(capture)}
                state={confidence
                  ? `${confidence.label}${confidence.percent != null ? ` · ${confidence.percent}%` : ''}`
                  : `same ISBN · ${capture.isbn13}`}
                wants={capture.status === 'pending' ? 'still being read' : undefined}
              />
            </button>
          )
        })}
      </Card>
    </div>
  )
}

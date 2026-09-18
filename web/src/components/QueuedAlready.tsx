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
  /** The shot being answered, as a data URL. Only the scanner provides one; the Add flow leaves it out entirely. */
  shot?: string
  /** What tapping a match will do, said before it is tapped. */
  note: string
  disabled?: boolean
  /** Extra class on the panel, for where it has to sit on a busier screen. */
  className?: string
}

/** Positioning over the camera lives in the app's styles.css and `Viewfinder`'s `over` slot; nothing here decides where this sits. */
export function QueuedAlready({
  matches, onOpen, onDismiss, dismissLabel, shot, note, disabled, className,
}: Props) {
  if (!matches.length) return null

  // Undefined means no scanner frame at all (the Add flow); an empty string
  // means a frame is still being processed. The two must stay distinct, or
  // "no shot" would look like a failed image load.
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
          <Button tone="quiet" block onPress={onDismiss}>
            {dismissLabel}
          </Button>
        }
      >
        {yourShot}
        <Said>{note}</Said>

        {matches.map((match) => {
          const { capture, distance, basis } = match
          // Named by the same rule the queue uses, so the book offered here
          // and the row it opens read the same regardless of whether the name is a guess.
          const name = captureName(capture)
          // ISBN is exact; hash distance is a measured likeness, which is why
          // only it gets a confidence band and percentage.
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
                // Lets the person tell whether they are picking up their own
                // work or somebody else's half-finished job.
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

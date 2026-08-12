/**
 * The photographs of one book, wherever they are drawn.
 *
 * ## Why there is one of these and not two
 *
 * There were two. A book's page had a read-only rail of what had been
 * photographed; the camera had an interactive strip of the same three things.
 * They were separate components in separate files emitting the same class
 * names, so `library.css` held two blocks fighting over `.wf-shot`, and the
 * winner was whichever was written last. Nothing said so: it typechecked, the
 * suite was green, and every photograph on the book page rendered as an empty
 * dashed outline. It was found by opening the screen.
 *
 * They are one idea. A book has photographs, of a few kinds, and some of the
 * kinds have not been taken. The only thing that differs between the two
 * screens is whether a person can do anything about that, so that is a mode
 * rather than a second component.
 *
 * ## The three facts, and which screen needs which
 *
 * - **Which kinds exist.** A cloth stands in for a photograph that has been
 *   taken; no cloth is a kind nobody has taken yet, drawn as the empty shape
 *   of itself rather than left off, because "no back photograph" is a thing to
 *   know and a thing to fix. Every screen needs this.
 * - **Which kind the shutter fills next.** Only the camera and its review know
 *   this; a book's page has no shutter to point at anything.
 * - **Whether a person can act.** `act` turns each photograph into a target
 *   that takes it again. A thumbnail somebody can see and cannot act on is
 *   half of what the owner asked for twice, so the camera and the review pass
 *   it and the book's page does not.
 *
 * ## One marker class, stating presence
 *
 * `wf-shot--taken` and nothing for the rest. The two components carried the
 * same fact in opposite directions, one marking absence and one marking
 * presence, which is most of how they broke each other. Presence is the
 * direction that survives: a taken photograph wears a single cloth class, and
 * `:not(.wf-shot--taken)` is what keeps every rule about an empty box from
 * painting over it. Marking absence instead would leave the cloth defended by
 * nothing but the order the rules happen to be written in, which is the state
 * this component was just rescued from. A shot with no class at all falls out
 * as an empty outline, which is the honest failure of the two.
 */

import type { Cloth } from './Shelf'

export interface Shot {
  /** What this photograph is of: Front, Spine, Back. */
  word: string
  /**
   * The cloth standing in for a photograph that has been taken. Absent means
   * nobody has taken this one yet, which is drawn as a dashed empty box.
   */
  cloth?: Cloth
  /** The one the shutter will fill next. Nothing marks it on a book's page. */
  next?: boolean
  /** Where taking this one again goes. Only read when `act` is set. */
  onPress?: () => void
}

/**
 * The photographs of one book: what exists, what is next, and, where a person
 * is allowed to, the way to take any of them again.
 *
 * Small on a book's page, where it is a record of what has been photographed
 * and scrolls inside itself; smaller still on the camera, where it floats on
 * the picture beside the button and every pixel it takes is a pixel of the
 * photograph; big on the review, where the whole point is being able to see
 * that a photograph came out blurred.
 */
export function Shots({
  shots,
  act = false,
  size = 'small',
  on = 'paper',
}: {
  shots: Shot[]
  /**
   * Whether a person can do anything about what they are looking at. Off, this
   * is a record; on, each photograph is a target that takes it again.
   */
  act?: boolean
  size?: 'small' | 'big'
  /** Whether this is drawn on paper or on top of the picture. */
  on?: 'paper' | 'picture'
}) {
  const className = [
    'wf-shots',
    size === 'big' ? 'wf-shots--big' : '',
    on === 'picture' ? 'wf-shots--picture' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} role="list" aria-label="Photographs">
      {shots.map((shot) => {
        const marks = [
          'wf-shot',
          shot.cloth ? 'wf-shot--taken' : '',
          shot.next ? 'wf-shot--next' : '',
        ]
          .filter(Boolean)
          .join(' ')

        const box = (
          <span className={`wf-shot__box${shot.cloth ? ` wf-spine--${shot.cloth}` : ''}`}>
            {act && shot.cloth && <span className="wf-shot__again">Retake</span>}
            {/* The word rather than a ring. An empty box marked only by a
                solid outline read as a photograph of something black, which is
                a thing a spine photograph can very well be. */}
            {!shot.cloth && shot.next && <span className="wf-shot__next">Next</span>}
          </span>
        )

        if (!act) {
          return (
            <span className={marks} role="listitem" key={shot.word}>
              {box}
              <span className="wf-shot__word">{shot.word}</span>
            </span>
          )
        }

        return (
          <button
            key={shot.word}
            type="button"
            role="listitem"
            className={marks}
            aria-label={
              shot.cloth
                ? `Take the ${shot.word.toLowerCase()} again`
                : `Photograph the ${shot.word.toLowerCase()}`
            }
            onClick={shot.onPress}
          >
            {box}
            <span className="wf-shot__word">{shot.word}</span>
          </button>
        )
      })}
    </div>
  )
}

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
 * - **What shape each one is.** A spine is cropped to a sliver, so a spine
 *   drawn in a cover's rectangle is a drawing of a photograph the app does not
 *   keep. `sliver` is that fact and every screen reads it.
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
 *
 * ## The second mode: the photographs drawn as the book
 *
 * A book's page used to wear a cover at the top and a rail of every photograph
 * under it. The owner read that and said what it should be instead:
 *
 * > We should have the spine on the left side of the book image and the book
 * > cover there, because the spine is going to be cropped into a very thin
 * > sliver, and it should be rendered. The cropped version should be rendered
 * > right next to the front of the book, and then the user should be able to
 * > swipe on the front of the book to see the other pictures, rather than us
 * > show them all underneath it.
 *
 * So `mode="book"` draws the same photographs as one object: the spine cropped
 * to the sliver a spine photograph really is, standing against the front, and
 * the rest behind the front rather than beside it. It is the same list, the
 * same cloths and the same `--taken` marker; what changes is the arrangement.
 * A second component would be the mistake this file was made to end.
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
  /**
   * This photograph is cropped to the shape of a spine: a tall thin sliver
   * rather than a rectangle the shape of a cover.
   *
   * One fact, read in three places, which is why it is not three flags. On a
   * book's page it is what makes the spine stand against the front instead of
   * taking a turn behind it. In a rail it is what stops a sliver being given a
   * cover's worth of width. On the camera it is the shape of the viewfinder,
   * because the frame somebody lines a book up inside should be the shape the
   * photograph is going to be kept in.
   *
   * > Whenever we're on the spine shot, it should be a cropped shot of the
   * > spine.
   *
   * A flag rather than matching on the word, because "Spine" is a label and a
   * label is the thing somebody rewrites without knowing what reads it.
   */
  sliver?: boolean
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
  mode = 'rail',
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
  /**
   * How they are arranged. A rail is every photograph side by side; a book is
   * the spine standing against the front, with the rest behind it.
   */
  mode?: 'rail' | 'book'
}) {
  if (mode === 'book') return <TheBook shots={shots} />

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
          // The same marker the book's page uses for the same fact, so a
          // cropped spine is one class in one place rather than a second
          // treatment invented per screen.
          shot.sliver ? 'wf-shot--sliver' : '',
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

/**
 * The same photographs, arranged as the book they are photographs of.
 *
 * The spine is cropped to a sliver and stands against the front, which is what
 * makes the two read as one object rather than as two pictures. Everything
 * else is behind the front and is reached by swiping it.
 *
 * ## Swiping is drawn, not built
 *
 * There is no gesture here and there should not be: a wireframe that
 * implements a carousel is a second implementation of the app, and the thing
 * being reviewed is the arrangement. What a static drawing can carry honestly
 * is the state: the front is showing, there are this many photographs, and the
 * others are that way. The dots do that, and they do the other job the rail
 * did as well, which is saying that a kind nobody has photographed exists and
 * is empty. A dot that is not filled is a photograph nobody has taken.
 */
function TheBook({ shots }: { shots: Shot[] }) {
  const spine = shots.find((shot) => shot.sliver)
  const deck = shots.filter((shot) => !shot.sliver)
  const front = deck[0]

  const shot = (one: Shot | undefined, where: string) => (
    <span
      className={`wf-shot wf-shot--${where}${one?.cloth ? ' wf-shot--taken' : ''}`}
      aria-hidden="true"
    >
      <span className={`wf-shot__box${one?.cloth ? ` wf-spine--${one.cloth}` : ''}`}>
        {/* The shape of the missing thing, said in the box where it would be.
            Only the front carries it: a sliver is too thin for a word, and it
            is already drawn as an empty outline. */}
        {where === 'face' && !one?.cloth && (
          <span className="wf-shot__none">No photograph</span>
        )}
      </span>
    </span>
  )

  return (
    <div className="wf-shots wf-shots--book">
      {shot(spine, 'sliver')}
      <span className="wf-deck">
        {/* The edge of the next one, behind the front and inset at both ends,
            so the front reads as the top of a stack rather than as the only
            photograph there is. Nothing moves: this is the state drawn, and
            the dots below say how many are in it. */}
        {deck.length > 1 && <span className="wf-deck__behind" aria-hidden="true" />}
        {shot(front, 'face')}
      </span>
      <span className="wf-shots__dots" role="list" aria-label="Photographs">
        {deck.map((one, at) => (
          <span
            key={one.word}
            role="listitem"
            className={[
              'wf-dot',
              one.cloth ? 'wf-dot--taken' : '',
              at === 0 ? 'wf-dot--showing' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={one.cloth ? one.word : `${one.word}, not photographed`}
          />
        ))}
      </span>
    </div>
  )
}

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
 *
 * And the swipe he asked for is now in it, which is #351. The half of the
 * sentence above that had never been built was "the user should be able to
 * swipe on the front of the book to see the other pictures": the rest were
 * behind the front and there was no way to reach them. `TheBook`, at the
 * bottom of this file, is where that lives.
 */

import { useEffect, useRef, useState } from 'react'
import type { Cloth } from './Shelf'
/*
 * The one piece of arithmetic a swipe needs, taken from where the app's other
 * swipe already keeps it rather than written again here. Which frame a
 * horizontal scroll has landed on is a decision, and a second copy of it is a
 * second answer waiting to disagree; `library.css` has already been through
 * that with `.wf-shot` and this file is the result. It is pure, it imports
 * nothing itself, and it is the same rounding both galleries round by.
 */
import { frameAtScroll } from '../lib/gallery'

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
  /**
   * The photograph itself, where there is one.
   *
   * The gallery has none and stands a cloth in for each, which is what `cloth`
   * is. The app has the real thing, and a review screen that drew a dyed
   * rectangle instead of the photograph somebody just took would be answering
   * the wrong question: the reason this is on that screen at all is so a blurred
   * one can be seen and taken again.
   *
   * Either counts as taken. Presence is the one marker, for the reason the
   * header gives.
   */
  photo?: string
  /**
   * What has become of it since, in words. "reading", "ISBN found".
   *
   * Words rather than a dot, because a coloured dot on a photograph is a legend
   * somebody has to have been told, and this is a screen used one-handed at a
   * bookcase.
   */
  note?: string
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
        const taken = Boolean(shot.cloth || shot.photo)

        const marks = [
          'wf-shot',
          // The same marker the book's page uses for the same fact, so a
          // cropped spine is one class in one place rather than a second
          // treatment invented per screen.
          shot.sliver ? 'wf-shot--sliver' : '',
          taken ? 'wf-shot--taken' : '',
          shot.next ? 'wf-shot--next' : '',
        ]
          .filter(Boolean)
          .join(' ')

        const box = (
          <span className={`wf-shot__box${shot.cloth ? ` wf-spine--${shot.cloth}` : ''}`}>
            {shot.photo && <img className="wf-shot__img" src={shot.photo} alt="" />}
            {act && taken && <span className="wf-shot__again">Retake</span>}
            {/* The word rather than a ring. An empty box marked only by a
                solid outline read as a photograph of something black, which is
                a thing a spine photograph can very well be. */}
            {!taken && shot.next && <span className="wf-shot__next">Next</span>}
          </span>
        )

        const words = (
          <>
            <span className="wf-shot__word">{shot.word}</span>
            {shot.note && <span className="wf-shot__note">{shot.note}</span>}
          </>
        )

        if (!act) {
          return (
            <span className={marks} role="listitem" key={shot.word}>
              {box}
              {words}
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
              taken
                ? `Take the ${shot.word.toLowerCase()} again`
                : `Photograph the ${shot.word.toLowerCase()}`
            }
            onClick={shot.onPress}
          >
            {box}
            {words}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The same photographs, arranged as the book they are photographs of, and
 * swiped through.
 *
 * The spine is cropped to a sliver and stands against the front, which is what
 * makes the two read as one object rather than as two pictures. Everything
 * else is behind the front, and a swipe across the front is what brings it
 * forward. That is one sentence of the owner's, answered in two halves: the
 * arrangement in #269 and the gesture in #351.
 *
 * ## The swipe is a scroll container, not a drag handler
 *
 * This is the whole of why it does not fight the page. The record under it
 * scrolls down, the photographs scroll across, and a thumb rarely moves along
 * either axis exactly. The browser settles that itself: it reads the first few
 * pixels of a gesture, gives the axis to whichever of the two wants it, and
 * hands the other one to the page. A hand-rolled pointer drag has to guess the
 * same thing from the same few pixels and guesses wrong on a diagonal, which is
 * how a carousel ends up eating a scroll. `BookGallery` on the review screen
 * has been built this way since #78 for this reason, and this is the same
 * answer rather than a second one.
 *
 * It is also why a swipe cannot turn into a tap. A finger that moved scrolled
 * the container, and a browser does not raise a click after that; nothing here
 * has to decide how far is too far, because nothing here is deciding.
 *
 * ## The dots are how somebody without a swipe changes picture
 *
 * A swipe is undiscoverable on its own and a mouse has no swipe at all, so
 * every photograph is one tap away on the dots underneath, which are buttons
 * and take the keyboard like any other. They keep the job they already had as
 * well: a dot that is not filled is a kind nobody has photographed, which is
 * the same thing the empty dashed box says and the reason the rail under this
 * is not missed. What they gain is saying which one is showing while it moves
 * rather than only which one started.
 *
 * The wireframe draws all of that because it is this component: the gallery and
 * the app import one `Shots`, so an interaction the app has is an interaction
 * the drawing has. It used to say a carousel in a wireframe would be a second
 * implementation of the app, which was right about copying one in and wrong
 * about the way out of it.
 */
function TheBook({ shots }: { shots: Shot[] }) {
  const spine = shots.find((one) => one.sliver)
  const deck = shots.filter((one) => !one.sliver)

  /*
   * Which photograph is showing. Kept because two other things have to agree
   * with the scroll position: the dot drawn long, and the edge of the card
   * behind, which is a claim that there is another one that way.
   */
  const [at, setAt] = useState(0)
  const track = useRef<HTMLSpanElement>(null)
  const showing = Math.min(at, Math.max(deck.length - 1, 0))

  /*
   * A different book starts at its first photograph.
   *
   * This is not remounted when the book under it changes: walking the gallery
   * from one drawn book to the next is one component with new props, and so is
   * a screen that re-reads its book. Two things then belong to the book that
   * has just been left, and one of them is not React's to reset: the index
   * here, and the scroll position, which is the browser's. Found by walking
   * the gallery from a book with photographs to one with none and landing on
   * its third empty box. It is the same fault #81 found on the review screen's
   * gallery, in the one place that looked like it could not have it.
   */
  const shown = useRef('')
  const held = deck.map((one) => `${one.word}|${one.photo ?? ''}|${one.cloth ?? ''}`).join('~')
  useEffect(() => {
    if (shown.current === held) return
    shown.current = held
    setAt(0)
    // Not smooth: this is a different book rather than a move within one, and
    // an animation back to the start would read as the last one sliding away.
    track.current?.scrollTo({ left: 0 })
  })

  /**
   * How wide one photograph is, measured rather than assumed.
   *
   * The width lives in the stylesheet, once, and both the box and the track it
   * scrolls in are cut from it. Reading it back off the element is what stops
   * the dots drifting out of step if it is ever changed there.
   */
  const frameWidth = () => track.current?.firstElementChild?.clientWidth ?? 0

  /** The way through the photographs that is not a gesture. */
  const goTo = (to: number) => {
    setAt(to)
    track.current?.scrollTo({ left: to * frameWidth(), behavior: 'smooth' })
  }

  const shot = (one: Shot | undefined, where: string) => {
    const taken = Boolean(one?.cloth || one?.photo)
    return (
      <span
        key={one?.word ?? where}
        className={`wf-shot wf-shot--${where}${taken ? ' wf-shot--taken' : ''}`}
        aria-hidden="true"
      >
        <span className={`wf-shot__box${one?.cloth ? ` wf-spine--${one.cloth}` : ''}`}>
          {one?.photo && <img className="wf-shot__img" src={one.photo} alt="" />}
          {/*
            The shape of the missing thing, said in the box where it would be.
            Only a face carries it: a sliver is too thin for a word, and it is
            already drawn as an empty outline.

            It names its kind, which it did not have to before the swipe: only
            the front was ever drawn here, so "No photograph" could only have
            meant the front. Three of these are reachable now, and without the
            word a swipe across a book nobody has photographed moves from one
            identical empty box to another and reads as nothing happening. The
            word is `wf-shot__word`, the same one the rail puts under a
            photograph, rather than a second way of saying which kind this is.
          */}
          {where === 'face' && !taken && (
            <span className="wf-shot__none">
              {one?.word && <span className="wf-shot__word">{one.word}</span>}
              No photograph
            </span>
          )}
        </span>
      </span>
    )
  }

  return (
    <div className="wf-shots wf-shots--book">
      {shot(spine, 'sliver')}
      <span className="wf-deck">
        {/*
          The edge of the next one, behind the front and inset at both ends, so
          the front reads as the top of a stack rather than as the only
          photograph there is. It goes when there is nothing further to reach,
          because by then it would be pointing at nothing.
        */}
        {showing < deck.length - 1 && <span className="wf-deck__behind" aria-hidden="true" />}
        <span
          className="wf-deck__track"
          ref={track}
          onScroll={(event) => {
            setAt(frameAtScroll(event.currentTarget.scrollLeft, frameWidth(), deck.length))
          }}
        >
          {/* A book nobody has photographed at all is still drawn as a book:
              one empty face, saying what is missing, rather than a spine with
              a gap beside it. */}
          {deck.length ? deck.map((one) => shot(one, 'face')) : shot(undefined, 'face')}
        </span>
      </span>
      {/*
        Only where there is somewhere to go. One photograph has no second one
        to offer, and a row of one dot is a target that does nothing, which is
        worse than not being a target.
      */}
      {deck.length > 1 && (
        <span className="wf-shots__dots" role="group" aria-label="Photographs">
          {deck.map((one, index) => (
            <button
              key={one.word}
              type="button"
              className={[
                'wf-dot',
                one.cloth || one.photo ? 'wf-dot--taken' : '',
                index === showing ? 'wf-dot--showing' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={one.cloth || one.photo ? one.word : `${one.word}, not photographed`}
              aria-current={index === showing ? 'true' : undefined}
              onClick={() => goTo(index)}
            />
          ))}
        </span>
      )}
    </div>
  )
}

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
 *
 * ## One swipe, in three places, and it is a scroll container every time
 *
 * There are now three arrangements in this file that a finger moves sideways
 * across: the deck on a book's page, the deck the details screen gives the
 * photographs somebody took, and the full screen view. **They are one
 * implementation**, `Swipe`, below. That is not tidiness. The one thing every
 * round of this has turned on is that a swipe must not become a tap and a tap
 * must not become a swipe, and the answer is that nothing here decides: the
 * strip is a native scroll container with snap points, the browser gives the
 * sideways axis to whichever of the two wants it, and no click follows a
 * finger that scrolled. A second copy of that is a second place for somebody
 * to reach for a pointer-drag handler and get a diagonal thumb wrong.
 *
 * ## Full screen means the whole picture
 *
 * The photographs drawn here are crops, because a crop of a book is a book and
 * the whole photograph is a book on a carpet. Tapping one opens it full screen,
 * and full screen shows `full`: the photograph somebody actually took. That is
 * the decision the app's old lightbox made and it is kept word for word, in the
 * component the book's page now draws with.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
   * This picture came out of a catalogue rather than out of the camera.
   *
   * At most one of them, and it is the publisher's picture of the edition
   * rather than a picture of this copy. A flag rather than matching on the
   * word for the reason `sliver` is one: "Downloaded" is a label, and a label
   * is the thing somebody rewrites without knowing what reads it.
   *
   * `deckOrder` is the only thing that reads it, and what it decides is which
   * picture a book opens on.
   */
  catalogue?: boolean
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
   * The whole photograph `photo` was cut down from, where a crop exists.
   *
   * Read by the full screen view and by nothing else. Everywhere a book is
   * drawn small it is drawn cropped, because a crop of a book is a book and the
   * whole photograph is a book on a carpet; the one place that stops being the
   * right answer is the place somebody has gone to in order to look at the
   * photograph itself. `Frame.full` in `lib/gallery.ts` is the same field for
   * the same reason and this is deliberately the same word.
   *
   * Absent means there was nothing to cut, so `photo` already is the whole of
   * it and full screen shows that.
   */
  full?: string
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
 * Which of a book's pictures somebody wants to see first.
 *
 * > On the book detail view, we should show the catalogue picture of the front
 * > of the book first if possible, instead of the one the user took. We should
 * > probably add that as a setting the user can set if they would like.
 *
 * Two answers to one question, and the question is a preference rather than a
 * property of a book, so it is stored on the phone: `lib/firstPicture.ts` is
 * where it is kept and the settings screen is where it is asked, the same
 * arrangement `lib/hand.ts` and the camera already have.
 */
export type FirstPicture = 'catalogue' | 'yours'

/**
 * The order the pictures are swiped through, given which one comes first.
 *
 * **"If possible" is the whole of this function.** A catalogue picture is
 * brought to the front only when there is one; a book nobody has downloaded a
 * cover for keeps the photograph somebody took at the front rather than
 * opening on an empty frame with "No photograph" written in it, which is what
 * moving an absent picture would produce and is the one outcome this must not
 * have. Every kind stays in the deck either way, because a kind nobody has
 * photographed is still a thing to know and a thing to fix.
 *
 * Nothing else moves. The rest keep the order they were handed in, which is
 * the order they are taken in, so choosing the catalogue picture changes one
 * thing rather than reshuffling the deck.
 *
 * Pure, exported and drawn by one component, so the gallery and the app cannot
 * disagree about which picture a book opens on.
 */
export function deckOrder(deck: Shot[], first: FirstPicture): Shot[] {
  if (first !== 'catalogue') return deck

  const at = deck.findIndex((one) => one.catalogue && Boolean(one.cloth || one.photo))
  if (at <= 0) return deck

  return [deck[at]!, ...deck.filter((_, index) => index !== at)]
}

/**
 * The three slots the details screen draws, and what goes in each of them.
 *
 * > At the top of this screen we need to show the catalogue image if it's
 * > available. If it's not available, we don't show it. The spine should be on
 * > the far left, not on the far right. The front should be right next to the
 * > spine. [...] If the catalogue image is not available, then it should just
 * > be the spine, the front, and our back. When the catalogue image is
 * > available, you should be able to swipe on our front picture to be able to
 * > see the back picture.
 *
 * Three slots either way, and the spine leads both. What changes is the middle
 * and the end: with a downloaded cover the middle is that cover and the end is
 * a deck of the photographs somebody took, swiped between; without one the
 * photographs take a slot each and there is nothing to swipe.
 *
 * **The catalogue picture is never an empty frame**, and that is decided here
 * by arithmetic rather than by a caller remembering to leave it out. A picture
 * nobody has downloaded is not a slot, not a dot and not somewhere a swipe can
 * land, because there is nothing behind it to look at. That is `deckOrder`'s
 * rule about the same picture, arriving at the other screen that draws it.
 *
 * The photographs are different, and the difference is what this screen is for:
 * a front nobody has taken is drawn as the empty shape of itself, because the
 * empty box is the button that takes it.
 *
 * Pure, exported and drawn by one component, so the gallery and the app cannot
 * disagree about what the top of that screen is.
 */
export function threeSlots(
  spine: Shot,
  /** The publisher's picture of the edition, present or not. */
  catalogue: Shot,
  /** The photographs somebody took, in the order they are taken. */
  ours: Shot[],
): { shots: Shot[]; deck?: Shot[] } {
  if (!catalogue.cloth && !catalogue.photo) return { shots: [spine, ...ours] }
  return { shots: [spine, catalogue], deck: ours }
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
  deck,
  act = false,
  size,
  on = 'paper',
  mode = 'rail',
  first = 'catalogue',
  full = false,
}: {
  shots: Shot[]
  /**
   * The last slot of a rail, as a stack swiped between rather than as one
   * photograph.
   *
   * Read only by `mode="rail"`. The details screen is the one caller: with a
   * downloaded cover on the record there are four pictures and three slots, so
   * the two photographs somebody took share the last one. `threeSlots` is what
   * decides that, and it hands this the pair.
   *
   * Absent is the ordinary case and draws exactly what it always drew.
   */
  deck?: Shot[]
  /**
   * Whether a person can do anything about what they are looking at. Off, this
   * is a record; on, each photograph that has somewhere to go is a target that
   * takes it again.
   *
   * "That has somewhere to go" is `onPress`, and it is the whole of the
   * condition. A downloaded cover on the details screen is drawn beside two
   * photographs that can be taken again and cannot be itself, so this is asked
   * per picture rather than per screen.
   */
  act?: boolean
  /**
   * How much room the photographs get.
   *
   * Deliberately unset by default rather than `small`, because the two modes
   * have opposite ordinary sizes and one default cannot be right for both. A
   * rail is small unless a screen asks for big; a book is big unless a screen
   * asks for small. Both defaults are the size their callers were already
   * drawing at, so naming the prop changed nothing that was on screen.
   */
  size?: 'small' | 'big'
  /** Whether this is drawn on paper or on top of the picture. */
  on?: 'paper' | 'picture'
  /**
   * How they are arranged. A rail is every photograph side by side; a book is
   * the spine standing against the front, with the rest behind it.
   */
  mode?: 'rail' | 'book'
  /**
   * Which picture the book opens on. Read only by `mode="book"`: a rail draws
   * every photograph at once and has no first.
   */
  first?: FirstPicture
  /**
   * Whether tapping a picture opens it full screen.
   *
   * Read only by `mode="book"`, and off unless a caller asks, which is the
   * whole of how the queue row is protected. A row is one whole `<button>` and
   * a button inside a button is not markup; off, every picture is the same
   * inert span it has always been and the row draws what it drew.
   */
  full?: boolean
}) {
  if (mode === 'book') return <TheBook shots={shots} size={size} first={first} full={full} />

  const className = [
    'wf-shots',
    size === 'big' ? 'wf-shots--big' : '',
    on === 'picture' ? 'wf-shots--picture' : '',
  ]
    .filter(Boolean)
    .join(' ')

  /**
   * One photograph of the rail, whether it is standing in a slot of its own or
   * taking its turn in the deck at the end.
   *
   * The same element either way, which is the point: a photograph that can be
   * swiped to is not a second kind of thumbnail, and the box, the word, the
   * marker class and the way to take it again are the ones every screen reads.
   */
  const one = (shot: Shot) => {
    const taken = Boolean(shot.cloth || shot.photo)
    /*
     * A picture with nowhere to go is not a target, even on a screen where the
     * rest of them are.
     *
     * The downloaded cover is the one this is about and it arrived with #373.
     * It is the publisher's picture of the edition rather than a photograph of
     * this copy, so there is no shutter that could take it again, and drawing
     * "Retake" across it was an offer of something that does not exist. Read
     * off `onPress` rather than off a second flag, because "there is somewhere
     * for this press to go" is exactly the question, and every screen that
     * meant to be actionable was already answering it.
     */
    const press = act && Boolean(shot.onPress)

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
        {press && taken && <span className="wf-shot__again">Retake</span>}
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

    if (!press) {
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
  }

  return (
    <div className={className} role="list" aria-label="Photographs">
      {shots.map(one)}
      {/*
        The last slot, where two photographs share it.

        Not a wrapper the rail always has: with no deck this renders nothing at
        all, so every screen that was drawing three photographs in three slots
        draws exactly the markup it drew. The word under each picture travels
        with it inside the strip, so the one on screen names itself without
        anything having to be told which is showing.
      */}
      {deck && deck.length > 0 && (
        <span className="wf-shot-deck">
          <Swipe deck={deck} draw={one} />
        </span>
      )}
    </div>
  )
}

/**
 * The pictures of one book, side by side in a strip a finger moves across.
 *
 * **This is the one mechanism, and reusing it is the point.** A book's page,
 * the details screen and the full screen view all put pictures in a row and let
 * a thumb move between them, and every one of them has to leave the page its
 * own axis and has to leave a tap a tap. That is settled by the strip being a
 * native scroll container with snap points: the browser reads the first few
 * pixels of a gesture, gives the sideways axis to whichever wants it and hands
 * the other one to the page, and a finger that moved scrolled the strip so no
 * click follows it. A pointer-drag handler has to guess all of that from the
 * same few pixels and gets a diagonal thumb wrong, which is how a carousel ends
 * up eating a scroll. `.gallery__track` on the review screen has been built
 * this way since #78 and this is that answer rather than a third one.
 *
 * The dots underneath are how anybody who does not swipe changes picture. They
 * are buttons with a target far bigger than the mark, and the one drawn long
 * follows the scroll rather than being fixed on the first. A single picture has
 * no dots, because a row of one dot is a target that does nothing.
 */
function Swipe({
  deck,
  behind = false,
  draw,
  empty,
}: {
  /** The pictures, in the order a swipe reaches them. */
  deck: Shot[]
  /**
   * Whether to draw the edge of the next picture behind the front, so the
   * front reads as the top of a stack. A book's page does; a slot in a rail
   * does not, because the card would stick out into the gap beside it and the
   * dots are already directly underneath.
   */
  behind?: boolean
  /** How one picture is drawn, which is the caller's, not this component's. */
  draw: (one: Shot) => ReactNode
  /** What a deck with nothing in it draws instead of nothing. */
  empty?: ReactNode
}) {
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

  return (
    <>
      <span className="wf-deck">
        {/*
          The edge of the next one, behind the front and inset at both ends, so
          the front reads as the top of a stack rather than as the only
          photograph there is. It goes when there is nothing further to reach,
          because by then it would be pointing at nothing.
        */}
        {behind && showing < deck.length - 1 && (
          <span className="wf-deck__behind" aria-hidden="true" />
        )}
        <span
          className="wf-deck__track"
          ref={track}
          onScroll={(event) => {
            setAt(frameAtScroll(event.currentTarget.scrollLeft, frameWidth(), deck.length))
          }}
        >
          {deck.length ? deck.map(draw) : empty}
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
    </>
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
 * ## The swipe is `Swipe`, which is a scroll container and not a drag handler
 *
 * The strip, the snapping, the dots and the reset when a different book arrives
 * are all above, in one place, because three arrangements in this file are now
 * swiped across and they must not answer the gesture question three ways. The
 * argument for a scroll container rather than a pointer drag is written there;
 * the short of it is that the record under this scrolls down, the photographs
 * scroll across, and the browser is the only thing that settles which axis a
 * thumb meant.
 *
 * A dot that is not filled is a kind nobody has photographed, which is the same
 * thing the empty dashed box says and the reason the rail under this is not
 * missed.
 *
 * The wireframe draws all of that because it is this component: the gallery and
 * the app import one `Shots`, so an interaction the app has is an interaction
 * the drawing has. It used to say a carousel in a wireframe would be a second
 * implementation of the app, which was right about copying one in and wrong
 * about the way out of it.
 *
 * ## Tapping a picture opens it whole (#373)
 *
 * > It should be possible that if we just tap the image of the spine or of the
 * > book, that we get a full screen view of it that can be exited out of, or
 * > you can swipe on to go see any of the other images.
 *
 * `Whole`, at the bottom of this file. Two things about it are decisions rather
 * than mechanics, and both are written where they are made: full screen shows
 * the photograph rather than the crop, and only pictures that exist are frames
 * it can reach.
 *
 * **It is off unless a caller asks for it**, which is what keeps it away from
 * the row below.
 *
 * ## The same book, smaller, in a list (#363)
 *
 * The queue draws one of these per waiting book, and the owner asked for it by
 * name: "the same component that we're using to show the book and the spine of
 * the book whenever you select a book, like the book detail view, is what we
 * should use here." So `size="small"` is a width and a height and nothing else.
 * The arrangement, the sliver, the marker class and the empty box are all the
 * ones above, because a second small book would be the drift this file exists
 * to end.
 *
 * **A row hands it one photograph, and that is a decision rather than an
 * oversight.** Two things stop a deck being swiped inside a queue row: the row
 * is itself a target that is dragged sideways to discard, and `.queue__slide`
 * gives the browser `touch-action: pan-y`, which takes the sideways axis away
 * from everything inside it. A strip that cannot be scrolled and dots that
 * cannot be pressed would be a swipe drawn and not delivered, and the dots are
 * `<button>`s, which cannot legally sit inside the button the whole row is. The
 * book's own page is where the other photographs are, one tap away.
 *
 * **The full screen view is off there for the same two reasons**, and it is off
 * by not being asked for rather than by anything here knowing what a queue row
 * is. A picture that opens one is a `<button>`, which is the thing that cannot
 * be inside the button a row is; and a row is dragged sideways to discard, so a
 * picture on it that swallowed a press would be taking the row's own gesture.
 * The pull request this arrived in pinned the row's drawing as an exact string,
 * for the same reason #363's did: this is the drawing that has to be provably
 * untouched.
 *
 * ## Which of them the book opens on
 *
 * The deck has an order and the owner has an opinion about the front of it:
 * the picture a catalogue holds, where there is one, rather than the
 * photograph somebody took. That is `deckOrder`, above, and it is one function
 * so that changing the answer cannot leave the dots counting one deck while
 * the strip scrolls another.
 *
 * **It cannot reach the row above.** A deck of one is returned untouched, by
 * `deckOrder`'s own arithmetic rather than by a caller remembering to ask for
 * it: there is nothing at an index above zero to bring to the front. A queue
 * row hands this one photograph, so the row draws exactly what it drew, and
 * the ordering is a question only a page with a real deck ever asks.
 */
function TheBook({ shots, size, first, full }: {
  shots: Shot[]
  size?: 'small' | 'big'
  first: FirstPicture
  full: boolean
}) {
  const spine = shots.find((one) => one.sliver)
  /*
   * The pictures a swipe goes through, in the order somebody asked for.
   *
   * The spine is not one of them and never was: it stands against the front
   * and is the one you look for a book by. Which of the rest leads is
   * `deckOrder`, and it is worked out here rather than by each caller so the
   * dots, the card behind and the frame that is showing all count the same
   * deck.
   */
  const deck = deckOrder(shots.filter((one) => !one.sliver), first)

  /*
   * What full screen has to show, which is the pictures there are.
   *
   * **An empty frame is not somewhere full screen can go.** A dashed box with
   * "No photograph" in it says everything it has to say at the size it is
   * drawn; blown up to fill a phone it is the same sentence in a bigger room,
   * and a swipe that lands on one is a swipe that appears to have done nothing.
   * So a kind nobody has photographed keeps its box and its dot in the book
   * above, where it is a thing to know and a thing to fix, and is not a frame
   * here. It follows that an empty box is not a target either: there is nothing
   * behind it to open.
   *
   * The spine leads, then the deck in the order the deck is already in, so what
   * a swipe reaches here is what is drawn on the page, left to right. Nothing
   * re-decides which picture comes first: that is the setting's answer and it
   * is read once, above.
   */
  const there = [spine, ...deck].filter(
    (one): one is Shot => Boolean(one && (one.cloth || one.photo)),
  )
  const [looking, setLooking] = useState<number | null>(null)
  /*
   * The way out, held still rather than made again each render.
   *
   * `Whole` hangs a key listener off this, and a listener that is taken down
   * and put back up on every render has a gap in it every time. There are a
   * lot of renders while a strip is scrolling, which is exactly when somebody
   * changing their mind presses the key.
   */
  const leave = useCallback(() => setLooking(null), [])

  const shot = (one: Shot | undefined, where: string) => {
    const taken = Boolean(one?.cloth || one?.photo)
    const marks = `wf-shot wf-shot--${where}${taken ? ' wf-shot--taken' : ''}`
    const box = (
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
    )

    /*
     * A picture worth opening is a target; everything else is the drawing it
     * always was.
     *
     * Both halves of that condition are load bearing. `full` is off in a queue
     * row, where this whole block is inside one `<button>` and a second one
     * would not be markup at all, and it is off wherever nobody has asked for
     * the full screen view. `taken` is the empty box, which has nothing behind
     * it to open.
     */
    if (!full || !taken || !one) {
      return (
        <span key={one?.word ?? where} className={marks} aria-hidden="true">
          {box}
        </span>
      )
    }

    return (
      <button
        key={one.word}
        type="button"
        className={marks}
        aria-label={`See the whole ${one.word.toLowerCase()} picture`}
        onClick={() => setLooking(there.indexOf(one))}
      >
        {box}
      </button>
    )
  }

  return (
    /*
     * A span rather than a div, because a queue row is one whole button and a
     * `<div>` inside a `<button>` is not phrasing content. Nothing else
     * changes: every rule about this block sets its own `display`, so the box
     * it makes is the box it made.
     */
    <span
      className={`wf-shots wf-shots--book${size === 'small' ? ' wf-shots--book-small' : ''}`}
    >
      {shot(spine, 'sliver')}
      <Swipe
        deck={deck}
        behind
        draw={(one) => shot(one, 'face')}
        /* A book nobody has photographed at all is still drawn as a book:
           one empty face, saying what is missing, rather than a spine with
           a gap beside it. */
        empty={shot(undefined, 'face')}
      />
      {looking !== null && there.length > 0 && (
        <Whole shots={there} at={looking} onLeave={leave} />
      )}
    </span>
  )
}

/**
 * One picture, whole, over everything else.
 *
 * > On the book detail view, it should be possible that if we just tap the
 * > image of the spine or of the book, that we get a full screen view of it
 * > that can be exited out of, or you can swipe on to go see any of the other
 * > images.
 *
 * ## It shows the photograph, not the crop
 *
 * **This is the one thing about it that must not be lost.** Every picture of a
 * book in this app is drawn cropped, because a crop of a book is a book and the
 * whole photograph is a book on a carpet, and a wall of the second is a wall of
 * carpet. That is right everywhere the picture is small. It stops being right
 * at the one place somebody has gone to in order to look at the picture itself,
 * which is here, so this reads `full` and falls back to the crop only where
 * there was nothing to cut. The app's book page has answered it that way since
 * the owner asked for "the full versus the cropped", and this is that answer
 * moved rather than a new one.
 *
 * ## Getting out, three ways, because it covers the way back
 *
 * The named button in the corner, the key anybody with a keyboard reaches for,
 * and a tap on the picture, which is what the old one did and what somebody who
 * has just tapped a picture to open it expects to be able to tap again. The
 * third is only safe because the strip is a scroll container: a finger that
 * moved scrolled it and no click follows, so a swipe that goes nowhere in
 * particular does not close the thing it was trying to move.
 *
 * The dots stop their press reaching that: they are inside the picture's own
 * area and their whole job is to stay here and change picture.
 */
function Whole({ shots, at, onLeave }: {
  /** The pictures there are, in the order the page draws them. */
  shots: Shot[]
  /** Which one was tapped. */
  at: number
  onLeave: () => void
}) {
  const [showing, setShowing] = useState(at)
  const track = useRef<HTMLSpanElement | null>(null)
  /* Which one it opened on, held so the strip can be put there once. */
  const opened = useRef(at)

  /*
   * Opening on the picture that was tapped, before anything is painted.
   *
   * A callback ref rather than an effect, and `useCallback` with no
   * dependencies rather than a fresh function each render, which is the part
   * that would break quietly: a ref callback whose identity changes is detached
   * and reattached on every render, so the strip would be scrolled back to the
   * tapped picture every time the dots moved it. An effect would run after the
   * first paint instead, which is a visible jump from the first picture to the
   * one somebody actually asked for.
   */
  const hold = useCallback((node: HTMLSpanElement | null) => {
    track.current = node
    if (!node) return
    const frame = node.children[opened.current] as HTMLElement | undefined
    if (frame) node.scrollLeft = frame.offsetLeft
  }, [])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onLeave()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onLeave])

  const frameWidth = () => track.current?.firstElementChild?.clientWidth ?? 0
  const goTo = (to: number) => {
    setShowing(to)
    track.current?.scrollTo({ left: to * frameWidth(), behavior: 'smooth' })
  }

  return (
    /*
     * A span, and every rule about it sets its own display, for the same
     * reason the book above is one: this is drawn inside the book, and the
     * book is drawn inside a button on one of the two screens that call it.
     * It is not drawn there, because `full` is off there, but the markup has
     * to stay legal either way rather than depend on that staying true.
     *
     * The press that closes it is on the whole thing rather than on the
     * picture, so a tap anywhere that is not a dot gets out. There is a named
     * button for it as well, and a key, because a handler on a box is not
     * something a keyboard or a screen reader can find.
     */
    <span
      className="wf-whole"
      role="dialog"
      aria-modal="true"
      aria-label="The whole picture"
      onClick={onLeave}
    >
      <span
        className="wf-whole__track"
        ref={hold}
        onScroll={(event) => {
          setShowing(frameAtScroll(event.currentTarget.scrollLeft, frameWidth(), shots.length))
        }}
      >
        {shots.map((one) => (
          <span className="wf-whole__frame" key={one.word}>
            {one.photo ? (
              <img className="wf-whole__img" src={one.full || one.photo} alt={one.word} />
            ) : (
              /* The gallery has no photographs and stands a cloth in for each,
                 which is what a wireframe of this is: the shape and the room it
                 takes, at the size it really is. */
              <span className={`wf-whole__cloth wf-spine--${one.cloth}`} aria-hidden="true" />
            )}
          </span>
        ))}
      </span>

      {/* Which one this is, said rather than counted off the dots. */}
      <span className="wf-whole__word">{shots[showing]?.word}</span>

      {shots.length > 1 && (
        <span className="wf-whole__dots" role="group" aria-label="Photographs">
          {shots.map((one, index) => (
            <button
              key={one.word}
              type="button"
              className={`wf-dot wf-dot--taken${index === showing ? ' wf-dot--showing' : ''}`}
              aria-label={one.word}
              aria-current={index === showing ? 'true' : undefined}
              onClick={(event) => {
                // Everything else here closes. This is the one press that is
                // about staying, so it stops before it reaches that.
                event.stopPropagation()
                goTo(index)
              }}
            />
          ))}
        </span>
      )}

      <button type="button" className="wf-whole__away" onClick={onLeave}>
        Close
      </button>
    </span>
  )
}

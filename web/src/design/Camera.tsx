/**
 * The camera, and the photographs it has already taken.
 *
 * ## The screen is the picture
 *
 * The first pass put a top bar, a sentence telling you what to photograph, a
 * viewfinder capped at 40dvh, a row of three selectors, a shutter, a second
 * row of three slots and a button under all of it. The owner's verdict was
 * that the view was completely broken, and the sentence that fixes it is his:
 *
 * > As much space on the screen as we can should be the actual pass through
 * > from the camera feed.
 *
 * So there is no bar, no sentence, and no second set of anything. The picture
 * is the whole screen and every control floats on it. The only opaque thing
 * drawn over it is a gradient at the bottom, dark enough that a cream label
 * reads against a photograph of a white paperback.
 *
 * ## Which edge the button goes to, and why it is a setting
 *
 * A person doing this is standing in front of a bookcase with a book in one
 * hand and the phone in the other. The phone is held low, near the book, and
 * the only finger free to press anything is the thumb of the hand holding it.
 * A thumb sweeps an arc from the bottom corner on its own side; the centre of
 * the bottom edge is *further* away than the near corner, not nearer, and the
 * far corner is a two-handed reach. A control centred at the bottom is
 * therefore the one place it should not be, which is what the first pass did.
 *
 * The default is the **right**, because most people are right-handed and the
 * phone is usually in the dominant hand when the other one is doing the
 * awkward job of holding a book open on a shelf edge. That is a majority, not
 * a fact about the person using it, so it is a setting rather than a decision:
 * `data-hand` moves the whole near cluster to the other edge and the
 * photographs to the one it left. Nothing else about the screen changes,
 * which is the test of whether the layout was really about reach.
 *
 * The switch lives in the **far top corner**, deliberately: it is pressed once
 * ever, and the hardest place to reach is the right place for a control you
 * touch once. In the app it belongs beside the rest of the settings and this
 * is the wireframe standing in for one.
 *
 * ## The frame is the shape of the photograph, not always a rectangle
 *
 * There was one guide on this screen, the same rounded rectangle whatever was
 * being photographed, and the owner named what it should have been:
 *
 * > In our current world, that is a cropped shot where we crop to the spine
 * > shape. The person can easily take the photo and fit it in. [...] Whenever
 * > we're on the spine shot, it should be a cropped shot of the spine.
 *
 * The app crops a spine photograph to the spine. So the frame somebody lines a
 * book up inside is the shape that will be kept: a tall thin slot on the
 * spine, the cover's rectangle on a cover. Anything else asks a person to fill
 * a box and then throws most of what they filled it with away.
 *
 * Which shape it is comes off the shot the shutter is about to take, by way of
 * `sliver` on that shot, and not off its word. That is the same flag the book
 * page reads to stand the spine against the front, so there is one fact about
 * what a spine photograph is and three screens reading it.
 *
 * Nothing here is wired to a camera and the slot is not a crop: this is a
 * wireframe and the frame is drawn.
 *
 * ## One set of indicators
 *
 * `Shots` is that set, and it is the only one. It says which photographs
 * exist, which one the button will take next, and it is how a photograph is
 * taken again, because a thumbnail you can see and cannot act on is the half
 * of this the owner asked for twice. The same component is on the review
 * screen at a size somebody can judge a blurred photograph from.
 *
 * It lives in `Shots.tsx` and it is not the camera's. A book's page draws the
 * same photographs as a record nobody can press, which is what `act` is for;
 * for a while these were two components of one name emitting one set of class
 * names, and they broke each other in `library.css` without git or the suite
 * saying a word. See the note at the top of that file.
 *
 * ## The app drives this one, and that is why there are escape hatches
 *
 * The gallery draws a hatched rectangle where the photograph goes. The app puts
 * a live `<video>` there, a guide rectangle measured off the crop it is really
 * going to keep, a torch, a settings sheet and the answer to "this book is
 * already in the queue". None of that is the wireframe's business, and none of
 * it is a second camera screen either: it is this frame with things handed to
 * it. So `picture`, `guide`, `top`, `far` and `over` are slots, each defaulting
 * to what the gallery already drew.
 *
 * A second component would be the mistake `Shots.tsx` was made to end: two
 * things emitting `.wf-view` and `.wf-shutter`, agreeing until one of them is
 * edited.
 */

import { useState, type ReactNode } from 'react'
import { IconBack } from './Icons'
import { Shots, type Shot } from './Shots'

/** Which edge the near cluster sits against. */
export type Hand = 'left' | 'right'

/**
 * The whole camera screen: a picture, and four things floating on it.
 *
 * This is the one component in the library that holds state, and it holds one
 * bit of it. Which edge the button belongs on cannot be settled by looking at
 * a drawing of both, only by holding the phone and pressing it, so the switch
 * works here rather than being described in a caption.
 *
 * Given a `hand` it stops holding even that: the app remembers the answer
 * between sittings and keeps the switch with the rest of the camera's
 * settings, which is where the header above says it belongs.
 */
export function Viewfinder({
  shots,
  onLeave,
  onDone,
  onShutter,
  picture,
  guide,
  top,
  far,
  over,
  done = 'Done with this book',
  doneOff = false,
  also,
  shutterName = 'Take the photograph',
  shutterOff = false,
  hand: fixed,
}: {
  shots: Shot[]
  onLeave?: () => void
  onDone?: () => void
  onShutter?: () => void
  /** What fills the frame. The gallery draws one; the app plays one. */
  picture?: ReactNode
  /**
   * Where to hold the book. The default is read off the shot the shutter is
   * about to take and is a drawing; the app measures its own off the crop it
   * is really going to keep, because a boundary you cannot see is one you will
   * get wrong.
   */
  guide?: ReactNode
  /** Anything else floating along the top, beside the way out. */
  top?: ReactNode
  /** The far top corner. Defaults to the handedness switch. */
  far?: ReactNode
  /** Drawn over the picture and under the controls: sheets, findings, hints. */
  over?: ReactNode
  /** What the button beside the shutter says. */
  done?: ReactNode
  doneOff?: boolean
  /** A second, quieter answer above it, where a screen has one. */
  also?: { word: ReactNode; onPress?: () => void; off?: boolean }
  /**
   * What the shutter does, for anybody who cannot see the picture it is over.
   *
   * The button is a circle and always will be, so the only word it carries is
   * this one, and this app has three cameras' worth of shutter with three
   * different jobs behind it: one keeps a photograph, one works out which book
   * you are holding, one reads thirteen digits off a barcode. Named rather than
   * shared, because "Take the photograph" is true of exactly the first and the
   * two cameras are not allowed to be confusable (#355).
   */
  shutterName?: string
  shutterOff?: boolean
  /** Which edge the near cluster is on, where the caller owns that answer. */
  hand?: Hand
}) {
  const [chosen, setChosen] = useState<Hand>('right')
  const hand = fixed ?? chosen
  const other: Hand = hand === 'right' ? 'left' : 'right'

  /* The shape of the frame is the shape of the photograph about to be taken,
     so it is read off the shot the shutter will fill and off nothing else. */
  const taking = shots.find((shot) => shot.next)

  return (
    <div className="wf-view" data-hand={hand}>
      {picture ?? <div className="wf-view__picture" aria-hidden="true" />}
      {guide ?? (
        <div
          className={`wf-view__guide${taking?.sliver ? ' wf-view__guide--slot' : ''}`}
          aria-hidden="true"
        />
      )}

      <button type="button" className="wf-view__leave" aria-label="Back" onClick={onLeave}>
        <IconBack />
      </button>

      {top && <div className="wf-view__top">{top}</div>}

      {far ?? (
        <button
          type="button"
          className="wf-view__far wf-view__chip"
          onClick={() => setChosen(other)}
          aria-label={`Move the button to the ${other}`}
        >
          Move it {other}
        </button>
      )}

      {over}

      <div className="wf-view__bar">
        {/*
          A camera that keeps nothing draws no strip of what it kept, and one
          of the two does keep nothing: the camera that reads a book already in
          the collection takes a frame, answers with an identity and throws the
          frame away. An empty rail there is a list announced as "Photographs"
          with no photographs in it, and a gap where the bar expects a control.
          The span holds the near cluster against its own edge.
        */}
        {shots.length > 0 ? <Shots shots={shots} act on="picture" /> : <span />}
        <div className="wf-view__near">
          {also && (
            <button
              type="button"
              className="wf-view__done wf-view__done--quiet"
              onClick={also.onPress}
              disabled={also.off}
            >
              {also.word}
            </button>
          )}
          <button
            type="button"
            className="wf-view__done"
            onClick={onDone}
            disabled={doneOff}
          >
            {done}
          </button>
          {/*
            The shutter waits on nothing. Nothing is put in front of it, it is
            never behind a confirmation, and the only thing that disables it is
            there being no stream to take a photograph from. See #294 for what
            work sitting behind other work costs.
          */}
          <button
            type="button"
            className="wf-shutter"
            aria-label={shutterName}
            onClick={onShutter}
            disabled={shutterOff}
          >
            <span className="wf-shutter__inner" />
          </button>
        </div>
      </div>
    </div>
  )
}

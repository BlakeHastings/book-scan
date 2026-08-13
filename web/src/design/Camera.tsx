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
 */

import { useState } from 'react'
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
 */
export function Viewfinder({
  shots,
  onLeave,
  onDone,
  onShutter,
}: {
  shots: Shot[]
  onLeave?: () => void
  onDone?: () => void
  onShutter?: () => void
}) {
  const [hand, setHand] = useState<Hand>('right')
  const other: Hand = hand === 'right' ? 'left' : 'right'

  /* The shape of the frame is the shape of the photograph about to be taken,
     so it is read off the shot the shutter will fill and off nothing else. */
  const taking = shots.find((shot) => shot.next)

  return (
    <div className="wf-view" data-hand={hand}>
      <div className="wf-view__picture" aria-hidden="true" />
      <div
        className={`wf-view__guide${taking?.sliver ? ' wf-view__guide--slot' : ''}`}
        aria-hidden="true"
      />

      <button type="button" className="wf-view__leave" aria-label="Back" onClick={onLeave}>
        <IconBack />
      </button>

      <button
        type="button"
        className="wf-view__hand"
        onClick={() => setHand(other)}
        aria-label={`Move the button to the ${other}`}
      >
        Move it {other}
      </button>

      <div className="wf-view__bar">
        <Shots shots={shots} act on="picture" />
        <div className="wf-view__near">
          <button type="button" className="wf-view__done" onClick={onDone}>
            Done with this book
          </button>
          <button
            type="button"
            className="wf-shutter"
            aria-label="Take the photograph"
            onClick={onShutter}
          >
            <span className="wf-shutter__inner" />
          </button>
        </div>
      </div>
    </div>
  )
}

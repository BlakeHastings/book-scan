/**
 * The camera, and the photographs it has already taken. The picture is the
 * whole screen; every control floats on it, and the only opaque thing drawn
 * over it is a gradient at the bottom for label legibility.
 *
 * The near control cluster defaults to the right edge (`data-hand`), the
 * reachable corner for a thumb while the other hand holds a book; the switch
 * for it sits in the far top corner since it is pressed at most once.
 *
 * The frame's shape follows the shot the shutter is about to take, by way of
 * `sliver` on that shot rather than its word: a tall slot for a spine
 * photograph, a rectangle for a cover, since the app crops to that shape. The
 * book page reads the same `sliver` flag, so there is one fact about what a
 * spine photograph is.
 *
 * `Shots` (in `Shots.tsx`, not owned by the camera) is the one component that
 * draws photograph indicators, shared with the review screen and the book
 * page (where `act` controls whether they are pressable).
 *
 * `picture`, `guide`, `top`, `far`, `over`, `said` and `across` are slots the
 * app fills in place of the gallery's drawings. `.wf-view` is a two-row grid:
 * the bar takes the height its own contents ask for, and everything in `over`
 * sits in the row above it, so nothing in there needs to know how many
 * controls the bar holds or count pixels to clear them. `across` is the only
 * slot that also covers the controls, for content that must not stop at the
 * bar (an ungranted camera, a settings sheet).
 */

import { useState, type ReactNode } from 'react'
import { IconBack } from './Icons'
import { Shots, type Shot } from './Shots'

/** Which edge the near cluster sits against. */
export type Hand = 'left' | 'right'

/**
 * The whole camera screen: a picture, and four things floating on it. This is
 * the one component in the library that holds state (which edge the button
 * is on). Given a `hand`, it defers to the caller instead, since the app
 * remembers the answer between sittings.
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
  across,
  said,
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
   * Where to hold the book. The default is a rough drawing read off the shot
   * about to be taken, placed inside the picture above the bar where a
   * control can never cover it. A frame handed in here is a real crop
   * fraction of the picture instead, so it is placed against the whole
   * picture rather than the shrunk box above the bar, and it carries its own
   * insets.
   */
  guide?: ReactNode
  /** Anything else floating along the top, beside the way out. */
  top?: ReactNode
  /** The far top corner. Defaults to the handedness switch. */
  far?: ReactNode
  /**
   * Drawn on the picture above the bar, and under the controls: findings,
   * hints, the answer to "this book is already in the queue". Anything in
   * here that anchors to the bottom anchors to the top of the bar, so
   * `bottom: var(--s3)` means "just above the controls" without any
   * stylesheet needing to know how many controls this camera has.
   */
  over?: ReactNode
  /**
   * Drawn across the whole screen, the controls included: an ungranted
   * camera, or the sheet about the camera. Drawn last, so it is in front of
   * the bar without needing a z-index.
   */
  across?: ReactNode
  /** The one line this screen has to say, in the bar and above the controls. */
  said?: ReactNode
  /** What the button beside the shutter says. */
  done?: ReactNode
  doneOff?: boolean
  /** A second, quieter answer above it, where a screen has one. */
  also?: { word: ReactNode; onPress?: () => void; off?: boolean }
  /**
   * What the shutter does, for anybody who cannot see the picture it is over.
   * The button is always a circle, so this is its only word. This app's three
   * cameras do different jobs and must not be confusable, so each names its
   * own rather than sharing "Take the photograph".
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

      {guide}

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

      {/* The darkened bottom of the picture. Nothing may depend on it for legibility; every word down here beds itself. */}
      <div className="wf-view__band" aria-hidden="true" />

      <div className="wf-view__over">
        {guide === undefined && (
          <div
            className={`wf-view__guide${taking?.sliver ? ' wf-view__guide--slot' : ''}`}
            aria-hidden="true"
          />
        )}
        {over}
      </div>

      <div className="wf-view__bar">
        {said}

        <div className="wf-view__controls">
          {/* A camera that keeps no photographs draws no strip; the span holds the near cluster against its own edge instead. */}
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
            {/* The shutter is never behind a confirmation; the only thing that disables it is having no stream to take a photograph from. */}
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

      {across}
    </div>
  )
}

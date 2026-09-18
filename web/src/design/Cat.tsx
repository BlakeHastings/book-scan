/**
 * The mascot. He is a black cat, and he does three jobs: **bookend** at the
 * end of a run, **marker for a gap** as ears in the empty slot, and **loaf**
 * on a confirmation. Drawn rather than photographed, in one colour, so he
 * reads from 20px to 76px without a second asset. No emoji, here or anywhere.
 *
 * `--cat-rim` goes pale at night, since a pure black cat on a dark room would
 * otherwise be a hole cut in the page. Each silhouette is painted twice, once
 * with the rim and once filled over the top, so the rim does not draw a line
 * where his head rests on his body; see `Silhouette` below.
 *
 * A **pose** and a **behaviour** are independent axes: a pose is a static
 * shape, a behaviour is what it does over time (loop or once). Both are
 * tables rather than branches: a fifth pose is one entry in `BOX` and one in
 * `DRAW`; a second behaviour is one entry in `DOING` plus keyframes in
 * `library.css`. A caller that names no behaviour gets exactly the markup it
 * got before. The animation is CSS only, no timer or `requestAnimationFrame`,
 * so this stays a plain function that renders the same markup on the server
 * as in a browser.
 */

import type { ReactElement, ReactNode } from 'react'

export type CatPose = 'sitting' | 'peeking' | 'loaf' | 'sleeping' | 'lying'

/**
 * What he is doing, over time rather than as a shape. `dozing` is asleep but
 * alive: the tail sweeps and the eyes crack open now and then. It belongs to
 * the `lying` pose, the one drawn with a tail long enough to see it.
 */
export type CatDoing = 'dozing'

/** Whether a behaviour repeats forever or runs through one time. */
export type CatPlay = 'loop' | 'once'

interface Props {
  pose?: CatPose
  /**
   * Height in pixels. Width follows the pose's own proportions. For `lying`
   * this is the height of the whole drawing, not just the cat: the top half
   * of the box is cat and the bottom half is tail. See `.wf-doors__cat`.
   */
  size?: number
  /** What he is doing here. Omitted, he is a still drawing and nothing animates. */
  doing?: CatDoing
  /** Whether that behaviour loops or plays once. Loops by default. */
  play?: CatPlay
  /**
   * What he is doing here, for a screen reader. Omit it where he is purely
   * decoration and the words beside him already say everything.
   */
  label?: string
  className?: string
}

/** Proportions per pose, so a caller only ever picks a height. */
const BOX: Record<CatPose, { w: number; h: number }> = {
  sitting: { w: 44, h: 60 },
  peeking: { w: 40, h: 28 },
  loaf: { w: 68, h: 42 },
  sleeping: { w: 68, h: 38 },
  /* Half cat, half tail, and the halving is load-bearing: see `size` above. */
  lying: { w: 102, h: 92 },
}

/** What each pose actually draws. A fifth pose is a line here and a line above. */
const DRAW: Record<CatPose, () => ReactElement> = {
  sitting: Sitting,
  peeking: Peeking,
  loaf: Loaf,
  sleeping: Sleeping,
  lying: Lying,
}

/**
 * What each behaviour is called in the stylesheet.
 *
 * The class is the whole of the wiring: the keyframes, their durations and
 * which parts of him they move all live next to the drawing they belong to, in
 * `library.css`, so a second behaviour is a line here and a block there.
 */
const DOING: Record<CatDoing, string> = {
  dozing: 'wf-cat--dozing',
}

/**
 * Loop or play once, as a class rather than as a property per animation.
 *
 * Each behaviour's rules take their iteration count from `--cat-repeat`, so a
 * behaviour written tomorrow gets both answers without being told about
 * either.
 */
const PLAYING: Record<CatPlay, string> = {
  loop: 'wf-cat--loop',
  once: 'wf-cat--once',
}

export function Cat({ pose = 'sitting', size = 40, doing, play = 'loop', label, className }: Props) {
  const box = BOX[pose]
  const width = Math.round((box.w / box.h) * size)
  const Parts = DRAW[pose]

  return (
    <svg
      className={['wf-cat', doing && DOING[doing], doing && PLAYING[play], className]
        .filter(Boolean)
        .join(' ')}
      width={width}
      height={size}
      viewBox={`0 0 ${box.w} ${box.h}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <Parts />
    </svg>
  )
}

/**
 * One cat-shaped hole in the page, however many shapes it is made of.
 *
 * The parts are drawn twice: with the rim, then filled over the top. The
 * second pass covers the half of each rim that falls inside the union, so the
 * outline survives only where the cat meets the page. Without it a head
 * resting on a body has a full circle drawn across it, which is invisible in
 * daylight and obvious at night.
 */
function Silhouette({ children }: { children: ReactNode }) {
  return (
    <>
      <g className="wf-cat__body">{children}</g>
      <g className="wf-cat__fill">{children}</g>
    </>
  )
}

/**
 * Upright at the end of a run, tail curled round his feet. The tail is drawn
 * twice for the same reason the silhouette is: it sits entirely on the page
 * rather than on himself, and a black stroke on a dark room is nothing at all.
 */
function Sitting() {
  return (
    <>
      <path className="wf-cat__tail wf-cat__tail--rim" d="M32 57c9 1 12-7 8-13" />
      <path className="wf-cat__tail" d="M32 57c9 1 12-7 8-13" />
      <Silhouette>
        <path d="M22 30c8 0 13 9 13 21 0 5-2 8-5 8H14c-3 0-5-3-5-8 0-12 5-21 13-21Z" />
        <path d="M11.5 15.5 10.2 3.6c-.1-1.2 1.1-2 2.1-1.3l9.4 6.2ZM32.5 15.5l1.3-11.9c.1-1.2-1.1-2-2.1-1.3l-9.4 6.2Z" />
        <circle cx="22" cy="21" r="12.5" />
      </Silhouette>
      <ellipse className="wf-cat__eye" cx="17" cy="20" rx="2.1" ry="3" />
      <ellipse className="wf-cat__eye" cx="27" cy="20" rx="2.1" ry="3" />
      <path className="wf-cat__nose" d="M22 25.6l2.2 1.9h-4.4Z" />
      <path className="wf-cat__whisker" d="M8 22h-6M8 25.5l-5.5 2M36 22h6M36 25.5l5.5 2" />
    </>
  )
}

/** Ears and eyes over the edge of the slot the book belongs in. */
function Peeking() {
  return (
    <>
      <Silhouette>
        <path d="M9.5 12.5 8.2 2.6c-.1-1.2 1.1-2 2.1-1.3L18 6.4ZM30.5 12.5l1.3-9.9c.1-1.2-1.1-2-2.1-1.3L22 6.4Z" />
        <path d="M20 4c7.7 0 14 6.3 14 14v10H6V18C6 10.3 12.3 4 20 4Z" />
      </Silhouette>
      <ellipse className="wf-cat__eye" cx="14.5" cy="17" rx="2.2" ry="3.1" />
      <ellipse className="wf-cat__eye" cx="25.5" cy="17" rx="2.2" ry="3.1" />
      <path className="wf-cat__nose" d="M20 22.4l2.2 1.9h-4.4Z" />
    </>
  )
}

/**
 * Folded up, paws under, thoroughly pleased.
 *
 * No tail: a loaf has its tail underneath it, and the curl that used to be
 * drawn here sat entirely inside the body where nothing could see it.
 */
function Loaf() {
  return (
    <>
      <Silhouette>
        <path d="M46.5 12.5 45.2 2.6c-.1-1.2 1.1-2 2.1-1.3L55 6.4ZM63.5 12.5l1.3-9.9c.1-1.2-1.1-2-2.1-1.3L57 6.4Z" />
        <path d="M24 12c14 0 26 5 32 5 6 0 10 5 10 12 0 8-5 12-13 12H16C8 41 3 36 3 29c0-10 9-17 21-17Z" />
        <circle cx="55" cy="17" r="12" />
      </Silhouette>
      <ellipse className="wf-cat__eye" cx="50.5" cy="16" rx="2" ry="2.9" />
      <ellipse className="wf-cat__eye" cx="60" cy="16" rx="2" ry="2.9" />
      <path className="wf-cat__nose" d="M55.2 21.4l2.2 1.9H53Z" />
      <path className="wf-cat__whisker" d="M43 18h-6M43 21.5l-5.5 2M67 18h6M67 21.5l5.5 2" />
    </>
  )
}

/** The same loaf with his eyes shut, for a screen with nothing waiting on it. */
function Sleeping() {
  return (
    <>
      <Silhouette>
        <path d="M46.5 12.5 45.2 2.6c-.1-1.2 1.1-2 2.1-1.3L55 6.4ZM63.5 12.5l1.3-9.9c.1-1.2-1.1-2-2.1-1.3L57 6.4Z" />
        <path d="M24 10c14 0 26 5 32 5 6 0 10 5 10 11 0 7-5 11-13 11H16C8 37 3 33 3 26c0-9 9-16 21-16Z" />
        <circle cx="55" cy="16" r="11.5" />
      </Silhouette>
      <path className="wf-cat__shut" d="M47.5 15c1.6 2 4 2 5.6 0M57.5 15c1.6 2 4 2 5.6 0" />
      <path className="wf-cat__nose" d="M55.2 20.4l2.2 1.9H53Z" />
    </>
  )
}

/**
 * Asleep, and with a tail long enough to go somewhere. The cat lies across
 * the top half of the box, and the bottom half is tail: the tail has to leave
 * the cat and reach down past whatever he is lying on to be covered by it. His
 * belly sits at the middle of the box, so a layout puts that middle on the top
 * edge of something with a `-50%` transform and no measurement of a cat;
 * `.wf-doors` is his bed and each `.wf-door` paints over him so the tail
 * passes behind the buttons.
 *
 * The eyes are the sleeping pose's shut lids with a pair of slits drawn over
 * the top, invisible until `dozing` opens them, in the same colour as the
 * lids so the two never disagree about where an eye is.
 */
/* Ends inside the first button below with room to spare; must not reach past the box. */
const LYING_TAIL = 'M31 42c-11 8-17 15-17 23 0 9 5 17 14 21'

function Lying() {
  return (
    <>
      {/* The tail before the cat, so the join disappears under him: it starts inside the body and the silhouette painted after covers the stub. */}
      <g className="wf-cat__sweep">
        <path className="wf-cat__tail wf-cat__tail--rim" d={LYING_TAIL} />
        <path className="wf-cat__tail" d={LYING_TAIL} />
      </g>
      {/* Named so something can ask where he ends: `e2e/features/the-cat-is-alive.feature` measures this group against the top edge of the first button. */}
      <g className="wf-cat__rest" transform="translate(19 2) scale(1.2)">
        <Silhouette>
          <path d="M46.5 12.5 45.2 2.6c-.1-1.2 1.1-2 2.1-1.3L55 6.4ZM63.5 12.5l1.3-9.9c.1-1.2-1.1-2-2.1-1.3L57 6.4Z" />
          <path d="M24 10c14 0 26 5 32 5 6 0 10 5 10 11 0 7-5 11-13 11H16C8 37 3 33 3 26c0-9 9-16 21-16Z" />
          <circle cx="55" cy="16" r="11.5" />
        </Silhouette>
        <path className="wf-cat__shut" d="M47.5 15c1.6 2 4 2 5.6 0M57.5 15c1.6 2 4 2 5.6 0" />
        <ellipse className="wf-cat__peep" cx="50.3" cy="15.2" rx="2.9" ry="2.2" />
        <ellipse className="wf-cat__peep" cx="60.3" cy="15.2" rx="2.9" ry="2.2" />
        <path className="wf-cat__nose" d="M55.2 20.4l2.2 1.9H53Z" />
      </g>
    </>
  )
}

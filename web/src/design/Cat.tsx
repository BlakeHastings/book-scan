/**
 * The mascot. He is a black cat, and he does three jobs.
 *
 * As a **bookend** he sits at the end of a run and closes it. As the **marker
 * for a gap** he is the pair of ears in the empty slot where the book you are
 * holding goes. On the **confirmation** he is a loaf, because the job is done
 * and there is nothing to do but be pleased about it.
 *
 * He is drawn rather than photographed and drawn in one colour, so he reads at
 * 20px in a shelf slot and at 76px on the index without a second asset.
 *
 * Two things about him were found by looking at him rather than by drawing
 * him, and both are about the rim. A pure black cat on a dark room is a hole
 * cut in the page with two eyes in it, so `--cat-rim` goes pale at night. And
 * a rim on every part of him drew a line where his head rests on his body, so
 * the silhouette is painted twice: once with the rim, once filled over the top
 * of it. See `Silhouette` below.
 *
 * No emoji, here or anywhere. That is the point of him.
 */

import type { ReactNode } from 'react'

export type CatPose = 'sitting' | 'peeking' | 'loaf' | 'sleeping'

interface Props {
  pose?: CatPose
  /** Height in pixels. Width follows the pose's own proportions. */
  size?: number
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
}

export function Cat({ pose = 'sitting', size = 40, label, className }: Props) {
  const box = BOX[pose]
  const width = Math.round((box.w / box.h) * size)

  return (
    <svg
      className={['wf-cat', className].filter(Boolean).join(' ')}
      width={width}
      height={size}
      viewBox={`0 0 ${box.w} ${box.h}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {pose === 'sitting' && <Sitting />}
      {pose === 'peeking' && <Peeking />}
      {pose === 'loaf' && <Loaf />}
      {pose === 'sleeping' && <Sleeping />}
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

/** Upright at the end of a run, tail curled round his feet. */
function Sitting() {
  return (
    <>
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
      <path className="wf-cat__whisker" d="M43 18h-6M43 21.5l-5.5 2" />
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

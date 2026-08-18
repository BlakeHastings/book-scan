/**
 * Watching the cat, which is the one thing in this app that has to be watched.
 *
 * Everywhere else in this suite a wait is a wait on a condition, never a sleep,
 * because a fixed pause standing in for an answer that arrives when it arrives
 * is a flake with a timer on it. **Here the passing of time is the measurement
 * rather than a way of avoiding one.** The question is whether the drawing is
 * different a second from now, and there is no condition that answers it: the
 * only way to find out what a frame looks like is to be there when it is drawn.
 *
 * What is compared is always two frames from the same run of the same browser,
 * seconds apart. No image is stored and nothing is compared against a baseline,
 * so there is no font, driver or graphics stack that can make this go red
 * without the cat having changed.
 */

import { createHash } from 'node:crypto'
import { expect, type Locator, type Page } from '@playwright/test'

import { Given, Then } from './fixtures.js'

/** How often a frame is taken. Fourteen of them make up a thirteen second look. */
const EVERY = 930

/** The drawing itself, wherever on the screen it has been put. */
function cat(page: Page): Locator {
  return page.locator('.wf-cat')
}

/** A frame, as something two of which can be told apart. */
async function frameOf(what: Locator): Promise<string> {
  return createHash('sha1').update(await what.screenshot()).digest('hex')
}

/**
 * Every distinct frame the drawing showed over a window.
 *
 * The screenshots are of the element rather than of the page, so a scrollbar,
 * the time, or anything else that might move somewhere else on the screen
 * cannot count as the cat having moved.
 */
async function framesOver(page: Page, seconds: number): Promise<Set<string>> {
  const drawing = cat(page)
  await expect(drawing).toBeVisible()

  const seen = new Set<string>()
  const until = Date.now() + seconds * 1000

  seen.add(await frameOf(drawing))
  while (Date.now() < until) {
    await page.waitForTimeout(EVERY)
    seen.add(await frameOf(drawing))
  }

  return seen
}

Given('I have asked for less motion', async ({ page }) => {
  // The setting a phone actually carries, asked of the browser the way the
  // browser asks the operating system. It has to be set before the page is
  // opened, because a media query answered after an animation has started is
  // a different test from one answered before it.
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

Then('the cat should be drawn more than one way over {int} seconds', async (
  { page },
  seconds: number,
) => {
  const frames = await framesOver(page, seconds)

  expect(
    frames.size,
    `the cat was drawn the same way in every frame over ${seconds} seconds, so nothing about him moves`,
  ).toBeGreaterThan(1)
})

Then('the cat should be drawn exactly one way over {int} seconds', async (
  { page },
  seconds: number,
) => {
  const frames = await framesOver(page, seconds)

  expect(
    frames.size,
    `the cat was drawn ${frames.size} different ways for somebody who asked for less motion`,
  ).toBe(1)
})

/**
 * The tail is long enough to be underneath the button rather than above it.
 *
 * Ten pixels is a real bite rather than an edge touching an edge, which is what
 * a rounding difference or a hairline border could produce on its own. The
 * horizontal overlap is asked as well, because a tail hanging down beside a
 * full width button and a tail hanging down across it have the same vertical
 * story.
 */
Then('his tail should reach into the first thing I can do', async ({ page }) => {
  const tail = page.locator('.wf-cat__sweep')
  const door = page.locator('.wf-door').first()

  await expect(tail, 'the cat on the first screen has no tail').toBeVisible()
  await expect(door, 'the first screen offers nothing to do').toBeVisible()

  const drawn = await tail.boundingBox()
  const button = await door.boundingBox()
  expect(drawn, 'the tail has no box').not.toBeNull()
  expect(button, 'the button has no box').not.toBeNull()

  const into = drawn!.y + drawn!.height - button!.y
  expect(into, `the tail stops ${Math.round(-into)}px above the button`).toBeGreaterThan(10)
  expect(
    drawn!.x < button!.x + button!.width && drawn!.x + drawn!.width > button!.x,
    'the tail runs down beside the button rather than across it',
  ).toBe(true)
})

/**
 * And it is underneath rather than over the top, which is the whole of "behind".
 *
 * Proved by taking him away. If any part of him were painted over the button,
 * the pixels of the button where his tail runs would change when he goes; they
 * do not, so whatever of him is inside them is behind them. Two shots of the
 * same rectangle in the same second, so nothing but the cat can be the
 * difference, and no stored image to go stale.
 *
 * The rectangle is the overlap of the two boxes pulled four pixels inside the
 * button rather than the button element itself. A button has fractional page
 * coordinates and rounded corners, and both let a screenshot of the element
 * carry a sliver of the page above and beside it, where the tail is legitimately
 * visible. That sliver would fail this every time while the drawing was right.
 */
Then('taking him away should change nothing about it', async ({ page }) => {
  const door = await page.locator('.wf-door').first().boundingBox()
  const tail = await page.locator('.wf-cat__sweep').boundingBox()
  expect(door && tail, 'the tail or the button has no box').toBeTruthy()

  const inset = 4
  const left = Math.ceil(Math.max(door!.x + inset, tail!.x))
  const top = Math.ceil(door!.y + inset)
  const clip = {
    x: left,
    y: top,
    width: Math.floor(Math.min(door!.x + door!.width - inset, tail!.x + tail!.width)) - left,
    height: Math.floor(Math.min(door!.y + door!.height - inset, tail!.y + tail!.height)) - top,
  }
  expect(clip.width, 'the tail and the button do not overlap sideways at all')
    .toBeGreaterThan(8)
  expect(clip.height, 'the tail and the button barely overlap')
    .toBeGreaterThan(8)

  const shot = async () =>
    createHash('sha1').update(await page.screenshot({ clip })).digest('hex')

  const withHim = await shot()
  await cat(page).evaluate((drawing) => {
    ;(drawing as SVGElement).style.visibility = 'hidden'
  })
  const without = await shot()
  await cat(page).evaluate((drawing) => {
    ;(drawing as SVGElement).style.visibility = ''
  })

  expect(
    without,
    'the tail is painted across the face of the button rather than behind it',
  ).toBe(withHim)
})

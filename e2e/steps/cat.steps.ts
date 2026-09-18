/**
 * Watching the cat, which is the one thing in this app that has to be
 * watched.
 *
 * Everywhere else in this suite a wait is a wait on a condition, never a
 * sleep. Here the passing of time is the measurement itself: the question is
 * whether the drawing differs a second from now, and the only way to find out
 * is to be there when it is drawn.
 *
 * What is compared is always two frames from the same run of the same
 * browser, seconds apart, so no font, driver or graphics stack can make this
 * go red without the cat having changed.
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
 * Where he is: whether he is resting on the first thing to do, not merely
 * near it.
 *
 * `.wf-cat__rest` is the drawing of him without the tail; lying on something
 * means his underside is within twelve pixels of that thing's top edge. The
 * tail is asked about separately.
 *
 * The strip under the buttons is compared by pixels rather than by boxes: a
 * stroked SVG path reports a bounding box inflated by the stroke width times
 * the miter limit, about twenty pixels wider than the ink inside it here.
 */
Then('he should be lying on the first thing I can do', async ({ page }) => {
  const resting = page.locator('.wf-cat__rest')
  const door = page.locator('.wf-door').first()
  const doors = page.locator('.wf-doors')

  await expect(resting, 'nothing on the first screen is a cat lying down').toBeVisible()
  await expect(door, 'the first screen offers nothing to lie on').toBeVisible()

  const him = await resting.boundingBox()
  const button = await door.boundingBox()
  const block = await doors.boundingBox()
  expect(him && button && block, 'something on this screen has no box').toBeTruthy()

  const belly = him!.y + him!.height - button!.y
  expect(
    Math.abs(belly),
    `he lies ${Math.round(-belly)}px above the button rather than on it`,
  ).toBeLessThan(12)
  expect(
    him!.x < button!.x + button!.width && him!.x + him!.width > button!.x,
    'he is drawn beside the buttons rather than over them',
  ).toBe(true)

  const under = {
    x: Math.ceil(block!.x),
    y: Math.ceil(block!.y + block!.height) + 1,
    width: Math.floor(block!.width),
    height: 24,
  }
  const shot = async () =>
    createHash('sha1').update(await page.screenshot({ clip: under })).digest('hex')

  const withHim = await shot()
  await hide(page, true)
  const without = await shot()
  await hide(page, false)

  expect(without, 'his tail hangs out below the last button').toBe(withHim)
})

/** Take him off the screen without moving anything, and put him back. */
async function hide(page: Page, away: boolean): Promise<void> {
  await cat(page).evaluate((drawing, gone) => {
    ;(drawing as SVGElement).style.visibility = gone ? 'hidden' : ''
  }, away)
}

/**
 * And he is clear of the counts, which is the complaint said the other way.
 *
 * Two ways of asking it, since either alone can be satisfied by an accident: a
 * cat positioned out of flow can be a child of anything, so the DOM question
 * and the geometry question are different questions.
 */
Then('no part of him should be in among the counts', async ({ page }) => {
  const counts = page.locator('.wf-stats')
  await expect(counts, 'the first screen has no counts on it').toBeVisible()

  expect(
    await page.locator('.wf-stats .wf-cat').count(),
    'the cat is drawn inside the counts grid',
  ).toBe(0)

  const grid = await counts.boundingBox()
  const drawing = await page.locator('.wf-cat').boundingBox()
  expect(grid && drawing, 'the counts or the cat has no box').toBeTruthy()

  const over = grid!.y + grid!.height - drawing!.y
  expect(over, `he overlaps the counts by ${Math.round(over)}px`).toBeLessThanOrEqual(0)
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
 * And it is underneath rather than over the top, which is the whole of
 * "behind".
 *
 * Proved by taking him away: if any part of him were painted over the button,
 * the pixels where his tail runs would change when he goes.
 *
 * The compared rectangle is the overlap of the two boxes, inset four pixels
 * from the button element itself: fractional page coordinates and rounded
 * corners can let a screenshot of the element carry a sliver of the page
 * above and beside it, where the tail is legitimately visible.
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
  await hide(page, true)
  const without = await shot()
  await hide(page, false)

  expect(
    without,
    'the tail is painted across the face of the button rather than behind it',
  ).toBe(withHim)
})

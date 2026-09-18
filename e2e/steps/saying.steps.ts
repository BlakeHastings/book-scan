/**
 * Where the things this camera floats on its picture end up, which is a
 * question only a browser can answer.
 *
 * `renderToStaticMarkup` has no layout, so nothing under `web/src` can tell an
 * overlap from a clean gap; only a screenshot can.
 *
 * What is asked is overlap, not a distance: a gap of a particular size is a
 * fact about `--s3` and would go red the day the spacing scale changed, which
 * is not a defect. Two boxes intersecting is the defect, on any phone.
 *
 * Asked at more than one size: a number can be right on a 414 by 896 phone and
 * wrong on a shorter one, so a suite pinned to one viewport can only ever find
 * half of these.
 */

import { expect } from '@playwright/test'

import { Given, Then } from './fixtures.js'

/**
 * Every control on the camera, named the way the screen names them.
 *
 * `button`, not "the ones I expect to be near it": the rule must hold for a
 * control nobody thought about when the line was placed. The rail of
 * photographs is buttons too, and it is deliberately included.
 */
const CONTROLS = '.wf-view button'

/**
 * Everything this camera says in words, wherever it says it.
 *
 * The line and the hint are two different elements said in two different
 * places (the line stays until the book changes, the hint fades after a
 * couple of seconds), but both are words the camera is saying, so the rule is
 * the same for both.
 */
const SAID = '.wf-view__found, .cam__toast'

/**
 * The phone this scenario is being held on.
 *
 * The suite's own default viewport (414 by 896) is the phone this app was
 * drawn at, and it is also the size at which some overlap defects here are a
 * fraction of a pixel: invisible. A scenario that needs a shorter phone says
 * so and gets one.
 */
Given('the phone is {int} by {int}', async ({ page }, width: number, height: number) => {
  await page.setViewportSize({ width, height })
})

Then('the camera should say {string}', async ({ page }, words: string) => {
  await expect(page.locator('.wf-view__found')).toHaveText(words)
})

Then('the camera should be hinting {string}', async ({ page }, words: string) => {
  await expect(page.locator('.cam__toast')).toHaveText(words)
})

Then('nothing the camera says should be under a control', async ({ page }) => {
  const worst = await page.evaluate(({ controls, said }) => {
    /* How far two boxes intersect, in the smaller of the two directions.
       Positive is an overlap; zero or less is a gap, and how big the gap is
       does not matter. */
    const overlap = (a: DOMRect, b: DOMRect) => Math.round(Math.min(
      Math.min(a.right, b.right) - Math.max(a.left, b.left),
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    ))

    const words = [...document.querySelectorAll(said)]
    if (words.length === 0) {
      return { said: '', name: 'the camera is not saying anything at all', over: 1 }
    }

    let found = { said: '', name: '', over: -Infinity }
    for (const line of words) {
      for (const control of document.querySelectorAll(controls)) {
        const box = control.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) continue

        const over = overlap(line.getBoundingClientRect(), box)
        if (over > found.over) {
          const named = control.textContent || control.getAttribute('aria-label') || 'a control'
          found = { said: (line.textContent ?? '').trim(), name: named.trim(), over }
        }
      }
    }
    return found
  }, { controls: CONTROLS, said: SAID })

  expect(
    worst.over,
    `"${worst.name}" is drawn over "${worst.said}" by ${worst.over}px`,
  ).toBeLessThanOrEqual(0)
})

/**
 * The one thing on this camera that is not a word.
 *
 * Asked against both the words and the buttons, since a frame overlapping
 * either is the same defect: a boundary you cannot see is one you will get
 * wrong.
 *
 * `:not(--crop)` is a real exclusion, not a convenience: the cataloguing
 * camera's own frame is the rectangle the shutter keeps, given as fractions of
 * the picture, and moving it would change what gets saved. Every camera that
 * draws the design system's frame is still checked.
 */
Then('the frame you aim inside should be clear of the bar', async ({ page }) => {
  const worst = await page.evaluate(({ controls, said }) => {
    const overlap = (a: DOMRect, b: DOMRect) => Math.round(Math.min(
      Math.min(a.right, b.right) - Math.max(a.left, b.left),
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    ))

    const guide = document.querySelector('.wf-view__guide:not(.wf-view__guide--crop)')
    if (!guide) return { name: 'this camera draws no frame to aim inside', over: 1 }

    const frame = guide.getBoundingClientRect()
    let found = { name: '', over: -Infinity }
    for (const thing of document.querySelectorAll(`${controls}, ${said}`)) {
      const box = thing.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue

      const over = overlap(frame, box)
      if (over > found.over) {
        const named = thing.textContent || thing.getAttribute('aria-label') || 'something'
        found = { name: named.trim(), over }
      }
    }
    return found
  }, { controls: CONTROLS, said: SAID })

  expect(
    worst.over,
    `"${worst.name}" is drawn over the frame by ${worst.over}px`,
  ).toBeLessThanOrEqual(0)
})

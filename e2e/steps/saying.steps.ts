/**
 * Where the things this camera floats on its picture end up, which is a
 * question only a browser can answer.
 *
 * `.wf-view__found` and the buttons beside it come out of `Viewfinder` in the
 * same order, with the same classes, whether they overlap by 24px or clear each
 * other by 12. `renderToStaticMarkup` has no layout, so nothing under
 * `web/src` can tell the two apart, which is why #554 survived every suite this
 * repository has and was found by taking a screenshot. `tabs.steps.ts` is the
 * same shape for the same reason and says so at more length.
 *
 * **What is asked is overlap and not a distance.** A gap of a particular size
 * is a fact about `--s3` and would go red the day somebody changed the spacing
 * scale, which is not a defect. Two boxes intersecting is the defect, in any
 * layout, on any phone, and it is what a person sees.
 *
 * **And it is asked at more than one size** (#584, #585). Every fault these
 * steps exist for was a number that was right on a 414 by 896 phone and wrong on
 * a shorter one, so a suite pinned to one viewport can only ever find half of
 * them. Two of the three defects behind this file are invisible at the size
 * `playwright.config.ts` sets and plain at 375 by 667.
 */

import { expect } from '@playwright/test'

import { Given, Then } from './fixtures.js'

/**
 * Every control on the camera, named the way the screen names them.
 *
 * `button` and not "the ones I expect to be near it": the point of this rule is
 * that it holds for a control nobody thought about when the line was placed,
 * and "Done with this book" was exactly such a control. The rail of
 * photographs is buttons too, and it is deliberately in — it is the widest
 * thing at the bottom of the cataloguing camera and it is the reason the line
 * spans the whole width rather than sharing a row with anything.
 */
const CONTROLS = '.wf-view button'

/**
 * Everything this camera says in words, wherever it says it.
 *
 * Two, and they are said in two different places on purpose: the line goes in
 * the bar because it stays until the book changes, and the hint floats on the
 * picture because it leaves after a couple of seconds. Both are words the camera
 * is saying, so the rule is the same for both, which is the whole reason this
 * step is not called "the line".
 */
const SAID = '.wf-view__found, .cam__toast'

/**
 * The phone this scenario is being held on.
 *
 * The suite's own viewport is 414 by 896 and that is the right default: it is
 * the phone this app was drawn at and every other scenario should be looking at
 * what the owner looks at. It is also the size at which the two defects behind
 * #584 and #585 are a 4px overlap and a 0.4px miss, which is to say invisible.
 * A scenario that needs a shorter phone says so and gets one.
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
 * The one thing on this camera that is not a word (#584).
 *
 * It is asked against the words as well as against the buttons, because that is
 * how this one failed first: at 414 by 896 the frame's bottom edge came down 4px
 * behind the line saying what is in your hands, and the frame read as a
 * rectangle open at the bottom rather than as anything overlapping a control.
 * A boundary you cannot see is one you will get wrong, and half a boundary is
 * the same defect wearing a smaller number.
 *
 * **`:not(--crop)` is a real exclusion and not a convenience.** The cataloguing
 * camera hands in its own frame, which for the spine is the rectangle the
 * shutter is going to keep, given as fractions of the picture. That one cannot
 * be moved without changing what gets saved, so it is out of scope here and is
 * its own issue; asserting on it would make this step red for a defect nobody
 * is fixing in it. Every camera that draws the design system's frame is in.
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

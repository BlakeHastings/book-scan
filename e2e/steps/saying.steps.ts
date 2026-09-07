/**
 * Where the line the camera says ends up, which is a question only a browser
 * can answer.
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
 */

import { expect } from '@playwright/test'

import { Then } from './fixtures.js'

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

Then('the camera should say {string}', async ({ page }, words: string) => {
  await expect(page.locator('.wf-view__found')).toHaveText(words)
})

Then('nothing the camera says should be under a control', async ({ page }) => {
  const worst = await page.evaluate((controls) => {
    const said = document.querySelector('.wf-view__found')
    if (!said) return { name: 'the camera is not saying anything at all', over: 1 }

    const line = said.getBoundingClientRect()
    let found = { name: '', over: -Infinity }
    for (const control of document.querySelectorAll(controls)) {
      const box = control.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue

      /* How far the two boxes intersect, in the smaller of the two directions.
         Positive is an overlap; zero or less is a gap, and how big the gap is
         does not matter. */
      const across = Math.min(line.right, box.right) - Math.max(line.left, box.left)
      const down = Math.min(line.bottom, box.bottom) - Math.max(line.top, box.top)
      const over = Math.round(Math.min(across, down))
      if (over > found.over) {
        const named = control.textContent || control.getAttribute('aria-label') || 'a control'
        found = { name: named.trim(), over }
      }
    }
    return found
  }, CONTROLS)

  expect(
    worst.over,
    `"${worst.name}" is drawn over the line by ${worst.over}px`,
  ).toBeLessThanOrEqual(0)
})

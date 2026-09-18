/**
 * Where the four places are, which is a question only a browser can answer.
 *
 * `renderToStaticMarkup` has no layout and no scroll position, so nothing
 * under `web/src` can tell a stuck bar from a floating one. So this drives a
 * real page, scrolls it, and reads boxes.
 *
 * Two things are asked of every screen: where the bar is (its bottom edge
 * should be the bottom edge of the glass, at every scroll position) and what
 * it covers (nothing drawn in the body may reach its top edge, since a bar
 * taken out of the flow reserves no room).
 */

import { expect, type Page } from '@playwright/test'

import { Then, When } from './fixtures.js'
import { openTheApp } from '../support/opening.js'

/** How far off the bottom of the glass the bar's own bottom edge is. */
async function offTheGlass(page: Page): Promise<number> {
  const bar = page.locator('.wf-tabs')
  await expect(bar, 'this screen draws no tab bar at all').toBeVisible()

  return page.evaluate(() => {
    const box = document.querySelector('.wf-tabs')!.getBoundingClientRect()
    return Math.round(window.innerHeight - box.bottom)
  })
}

When('I scroll to the bottom of the screen', async ({ page }) => {
  /*
   * A page that does not scroll cannot come unstuck, so a scenario that ends
   * up on one has quietly stopped asking anything. Polled rather than
   * asserted outright: a screen full of books is only full once they have
   * arrived, and the tab is drawn before they have.
   */
  await expect
    .poll(
      () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
      { message: 'this screen never became taller than the phone, so nothing here is scrolled' },
    )
    .toBeGreaterThan(0)

  // The scroll is not an action the app answers, so there is no condition to
  // wait on after it. One frame is all that is being waited for.
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
    return new Promise(requestAnimationFrame)
  })
})

/**
 * The whole of the complaint, in one number: zero, and nothing else. A
 * tolerance written to feel safe would still accept a bar that has come
 * unstuck.
 */
Then('the four places should be against the bottom of the glass', async ({ page }) => {
  const off = await offTheGlass(page)

  expect(
    off,
    `the tab bar has come unstuck and is floating ${off}px up the screen`,
  ).toBe(0)
})

Then('nothing on the screen should be hidden behind them', async ({ page }) => {
  const covered = await page.evaluate(() => {
    const bar = document.querySelector('.wf-tabs')!.getBoundingClientRect()
    const body = document.querySelector('.wf-screen__body')
    if (!body) return { name: 'no body was drawn on this screen', by: 0 }

    let worst = { name: '', by: -Infinity }
    for (const drawn of body.querySelectorAll('*')) {
      const box = drawn.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      const by = Math.round(box.bottom - bar.top)
      if (by > worst.by) worst = { name: drawn.className || drawn.tagName, by }
    }
    return worst
  })

  expect(
    covered.by,
    `"${covered.name}" runs ${covered.by}px under the tab bar`,
  ).toBeLessThanOrEqual(0)
})

/**
 * The gallery, which is where this was seen and the only place it happens.
 *
 * The wireframe draws its way on to the next screen inside the same scroller,
 * which is the shape that takes a sticky bar off the glass: a sticky box stops
 * sticking where its containing block ends. The working app does not draw
 * this shape today, so a scenario written only against it would miss the bug.
 */
When('I open the wireframe of the library', async ({ page, webUrl }) => {
  await openTheApp(page, `${webUrl}#/design/library`, page.locator('.wf-next'))
  await expect(page.locator('.wf-next'), 'the wireframe draws no way on from here')
    .toBeVisible()
})

Then('the way on to the next screen should be above them', async ({ page }) => {
  const under = await page.evaluate(() => {
    const bar = document.querySelector('.wf-tabs')!.getBoundingClientRect()
    const next = document.querySelector('.wf-next')!.getBoundingClientRect()
    return Math.round(next.bottom - bar.top)
  })

  expect(under, `the way on to the next screen is ${under}px under the tab bar`)
    .toBeLessThanOrEqual(0)
})

/**
 * A `transform` on an ancestor makes a `fixed` descendant position against
 * that ancestor instead of the viewport. The cat, which animates two
 * transforms across the first screen, is not an ancestor of the tab bar, so
 * this should hold regardless. Watched for longer than his slowest cycle: he
 * rests for about half of eleven seconds.
 */
Then(
  'the four places should stay against the bottom of the glass for {int} seconds',
  async ({ page }, seconds: number) => {
    await expect(page.locator('.wf-cat'), 'nothing is moving on this screen')
      .toBeVisible()

    const seen = new Set<number>()
    const until = Date.now() + seconds * 1000

    seen.add(await offTheGlass(page))
    while (Date.now() < until) {
      await page.waitForTimeout(900)
      seen.add(await offTheGlass(page))
    }

    expect(
      [...seen],
      'the tab bar moved while the cat was moving, so something is carrying it',
    ).toEqual([0])
  },
)

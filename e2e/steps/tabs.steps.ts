/**
 * Where the four places are, which is a question only a browser can answer.
 *
 * `.wf-tabs` is one line of CSS and a `<nav>` of four buttons, and the markup
 * is the same markup whether the bar is against the bottom of the glass or
 * halfway up the phone. `renderToStaticMarkup` has no layout and no scroll
 * position, so nothing under `web/src` can tell the two apart; #393 found the
 * same thing about the corner sheet. So this drives a real page, scrolls it,
 * and reads boxes.
 *
 * Two things are asked of every screen here, because the fix has two halves and
 * either one alone is a different defect.
 *
 * **Where the bar is.** Its bottom edge is the bottom edge of the glass, at
 * every scroll position rather than only at the top of the page.
 *
 * **What it covers.** A bar taken out of the flow reserves no room, so the last
 * thing on the screen would end up underneath it and the change would trade a
 * floating tab bar for a button nobody can press. Nothing drawn in the body of
 * the screen may reach the top edge of the bar.
 */

import { expect, type Page } from '@playwright/test'

import { Then, When } from './fixtures.js'

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
   * A page that does not scroll cannot come unstuck, so a scenario that ends up
   * on one has quietly stopped asking anything. It is waited for rather than
   * asserted outright because a screen full of books is only full once the
   * books have arrived, and the tab is drawn before they have.
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
 * The whole of the complaint, in one number.
 *
 * > Whenever I scroll down, the bar at the bottom with Today, Library, Scan and
 * > Queue ends up scrolling up a bit for some reason, so it ends up in the
 * > middle of the screen, which is not ideal.
 *
 * Zero, and nothing else. Not "near the bottom": the bar was 47px up the phone
 * when this was reported, which is small enough that a tolerance written to be
 * safe would have accepted the defect.
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
 * The wireframe draws its way on to the next screen after the screen, inside
 * the same scroller, and that is exactly the shape that took the bar off the
 * glass: a sticky box stops sticking where its containing block ends. The
 * working app draws nothing after a screen today, so a scenario written only
 * against the app would have passed on the broken revision.
 */
When('I open the wireframe of the library', async ({ page, webUrl }) => {
  await page.goto(`${webUrl}#/design/library`)
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
 * The trap #412 laid, checked rather than reasoned about.
 *
 * A `transform` on an ancestor makes a `fixed` descendant position against that
 * ancestor instead of against the viewport, and the cat lies across the first
 * screen with two animated transforms in him. He is not an ancestor of the tab
 * bar, so this should hold; the point is that "should" is the word that made it
 * worth watching. Longer than his slowest cycle, for the reason the cat's own
 * scenarios give: he rests for about half of eleven seconds.
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

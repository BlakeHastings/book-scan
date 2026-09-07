/**
 * The first screen when the two reads it is made of do not come back (#562).
 *
 * ## Why this is here rather than only in `HomePane.test.tsx`
 *
 * That file renders the screen from props and can say what a person sees for a
 * given pair of values. What it cannot reach is the pair of `.catch` handlers in
 * `app/summary.tsx` that decide the values, because they are effects and this
 * project has no DOM in its unit setup. The whole of #562 was in those two
 * handlers, so a suite that only rendered the component would have gone green
 * over the defect and green over the fix without telling them apart.
 *
 * ## What is refused, and what is deliberately not
 *
 * The two reads themselves, and nothing else. `GET /api/auth/session` is left
 * alone on purpose: the gate asks it before anything else is drawn, and a
 * browser that cannot reach it is answered by the way in rather than by the
 * first screen. Refusing it here would be a scenario about the gate wearing this
 * one's name.
 *
 * `route.abort()` rather than a `503`, because the state being reproduced is the
 * server not being there. A refusal that arrives is the other half of the same
 * `catch` and needs no separate scenario: `lib/api.ts` turns any non-`ok`
 * response into the same rejection, and the two the gate writes never get that
 * far.
 */

import { expect, type Page } from '@playwright/test'

import { Given, Then, When } from './fixtures.js'
import { openTheApp } from '../support/opening.js'

/**
 * The two the first screen is made of: the collection's counts and the queue's.
 *
 * Named as paths rather than as a pattern over `/api`, so a read this scenario
 * did not mean to refuse keeps working and shows up as itself.
 */
const THE_FIRST_SCREEN_ASKS = ['**/api/health', '**/api/captures']

/** The card, which is the whole of what this scenario is about. */
function couldNotCount(page: Page) {
  return page.locator('.wf-card', { hasText: 'Your books could not be counted' })
}

Given('nothing answers the first screen', async ({ page }) => {
  for (const path of THE_FIRST_SCREEN_ASKS) {
    await page.route(path, (route) => route.abort())
  }
})

When('I open the app with nothing answering', async ({ page, webUrl }) => {
  // Waiting for the card rather than for a count, because a count is exactly
  // what this screen cannot draw. `openTheApp` is still what loads the page: it
  // is the only place this suite does, and its one reload is for the machine's
  // network moving underneath the browser (#448), which is a different event
  // from a request this scenario refused itself.
  await openTheApp(page, webUrl, couldNotCount(page))
})

Then('it should say it could not count my books', async ({ page }) => {
  await expect(
    couldNotCount(page),
    'the first screen said nothing at all about the reads that did not come back',
  ).toBeVisible()

  await expect(page.locator('.wf-card', { hasText: 'asks again' })).toBeVisible()
})

Then('there should be no counts on the screen', async ({ page }) => {
  // The half that was already right, kept here so a future fix cannot answer
  // this card by drawing nought catalogued underneath it.
  await expect(page.locator('.wf-stat')).toHaveCount(0)
})

Then('the app should have offered me no way in', async ({ page }) => {
  // A `401` and a `403` are the gate's answers and they belong to `gate.tsx`,
  // which replaces this whole screen. Nothing was refused here, so the way in
  // must not be what a person meets: it would tell somebody who is signed in
  // that they are not.
  await expect(page.locator('.wf-tabs')).toBeVisible()
  await expect(page.getByText('These are somebody\'s own books')).toHaveCount(0)
})

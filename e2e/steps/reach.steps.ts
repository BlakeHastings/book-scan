/**
 * The first screen when the two reads it is made of do not come back.
 *
 * Not reachable from `HomePane.test.tsx`: that file renders from props, but
 * the two `.catch` handlers that decide those props live in `app/summary.tsx`
 * as effects, and this project's unit setup has no DOM.
 *
 * `GET /api/auth/session` is left alone deliberately: the gate asks it before
 * anything else is drawn, so a browser that cannot reach it is answered by the
 * way in, not by this screen. `route.abort()` rather than a `503`, since the
 * state being reproduced is the server not being there, and `lib/api.ts` turns
 * any non-`ok` response into the same rejection either way.
 */

import { expect, type Page } from '@playwright/test'

import { Given, Then, When } from './fixtures.js'
import { openTheApp } from '../support/opening.js'

/**
 * The two the first screen is made of: the collection's counts and the
 * queue's. Named as paths rather than a pattern over `/api`, so a read this
 * scenario did not mean to refuse keeps working.
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
  // Waiting for the card, not a count: a count is exactly what this screen
  // cannot draw. `openTheApp`'s own reload is for the machine's network moving
  // underneath the browser, a different event from a request this scenario
  // refused itself.
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
  // A 401 or 403 belongs to `gate.tsx`, which replaces this whole screen.
  // Nothing was refused here, so the way in must not appear: it would tell
  // somebody signed in that they are not.
  await expect(page.locator('.wf-tabs')).toBeVisible()
  await expect(page.getByText('These are somebody\'s own books')).toHaveCount(0)
})

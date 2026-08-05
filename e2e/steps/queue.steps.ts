/**
 * The queue as a shared workspace rather than a private one.
 *
 * These steps exist to act out a handoff: one browser session works on a book
 * and puts it down, another picks it up. The second session is a genuinely
 * different person as far as the app is concerned, because the device name a
 * claim is made under lives in localStorage and is cleared between the two.
 * Faking it by reusing the same identity would test a page refresh, which is
 * not the thing that was broken.
 */

import { expect } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { Then, When } from './fixtures.js'

/** The queue reads a photograph in the background. Seconds, not milliseconds. */
const QUEUE_TIMEOUT = 90 * 1000

/**
 * To the queue from wherever the scenario happens to be.
 *
 * Three ways in, and all three are needed: the camera has its own chip, the
 * home screen has a tile and hides the header nav, and everywhere else has the
 * tab. Which one is on screen depends on what the scenario just did rather
 * than on anything it says.
 */
When('I go to the queue', async ({ page }) => {
  for (const entry of [
    page.locator('button.cam__chip-btn', { hasText: 'Queue' }),
    page.locator('button.home__queue'),
    page.locator('nav button.tab', { hasText: 'Queue' }),
  ]) {
    if (await entry.isVisible()) {
      await entry.click()
      break
    }
  }
  await expect(page.locator('.queue__row').first()).toBeVisible({ timeout: QUEUE_TIMEOUT })
})

/**
 * Open the book waiting in the queue.
 *
 * The row itself is the control since #120: there is no "Shelve" button to
 * aim at any more, because there was no reason for somebody holding a book to
 * have to hit a target smaller than the line the book is on.
 *
 * The wait is on the row becoming available, which happens when the background
 * worker has finished reading the photographs. Tapping before then does
 * nothing at all by design, so without the wait this would click into silence
 * and fail later for the wrong reason. `aria-disabled` rather than `disabled`
 * is what says so: the row must keep receiving pointer events while it is
 * pending, since those are what the discard swipe is made of.
 */
When('I open the queued book', async ({ page }) => {
  const row = page.locator('.queue__row').first()
  const open = row.locator('.queue__open:not([aria-disabled="true"])')
  await expect(open).toBeVisible({ timeout: QUEUE_TIMEOUT })
  await open.click()
  await expect(page.locator('.isbn-block')).toBeVisible()
})

/**
 * Leave the book in the queue rather than shelving it.
 *
 * This is the moment the work used to be lost: nothing had been saved, because
 * nothing could be until the book became a catalogued book.
 */
When('I put the book down without shelving it', async ({ page }) => {
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.queue__row').first()).toBeVisible()
})

/**
 * Leave the book by the header nav rather than by a button on the page.
 *
 * This is the way out that used to send nothing at all: no write of what had
 * been typed, and no release, so the book stayed claimed by somebody who had
 * walked away for the whole five minutes of the lease (#150).
 */
When('I leave by the {string} tab', async ({ page }, tab: string) => {
  await page.locator('nav button.tab', { hasText: tab }).click()
})

/**
 * Whether the queue is holding this book for somebody.
 *
 * Read off the row rather than off the screen, on the same reasoning as the
 * recorded-as step below: the claim is what stalls the next person, it lives
 * in the database, and it outlives the browser that took it. A screen-only
 * assertion would pass on precisely the defect, which is a page that went
 * away and left the lease running behind it.
 */
Then('the queued book should be held by somebody', async ({ catalogue }) => {
  const [capture] = catalogue.captures()
  expect(capture, 'nothing is in the queue').toBeTruthy()
  expect(capture.claimed_by, 'nobody has claimed the book').not.toBe('')
})

/**
 * Polled rather than read once: putting the book down is a request the page
 * fires on its way out, so the row is freed a moment after the tap lands.
 */
Then('the queued book should be held by nobody', async ({ catalogue }) => {
  await expect
    .poll(() => catalogue.captures()[0]?.claimed_by ?? 'nothing is in the queue', {
      message: 'the queue is still holding the book for somebody who has left',
    })
    .toBe('')
})

/**
 * A second person, on the same queue.
 *
 * The device name is what a claim is recorded under and what lets a browser
 * reclaim its own work after a refresh, so clearing it is what makes the
 * reload a different person rather than the same one coming back.
 */
When('I come back as somebody else', async ({ page, webUrl }) => {
  await page.evaluate(() => window.localStorage.removeItem('bookscan.device'))
  await page.goto(webUrl)
  await expect(page.locator('.tile__title', { hasText: 'Add' })).toBeVisible()
})

Then('the queued book should be listed as {string}', async ({ page }, title: string) => {
  await expect(page.locator('.queue__row').first().locator('.queue__title'))
    .toHaveText(title)
})

Then('the queue should hold one book', async ({ catalogue }) => {
  expect(catalogue.captureCount(), 'the queue holds more than the one book').toBe(1)
})

/**
 * The capture row itself, not the screen.
 *
 * The whole claim of #65 is about what reaches the database while a book is
 * still in the queue, so a screen-only assertion would pass on exactly the
 * behaviour that was broken: work held in a browser and never written down.
 */
Then('the queued book should be recorded as:', async ({ catalogue }, table: DataTable) => {
  const captures = catalogue.captures()
  expect(captures, 'nothing is in the queue').toHaveLength(1)

  const expected = table.rowsHash()
  const columns = captures[0] as unknown as Record<string, unknown>
  const actual: Record<string, string> = {}
  for (const column of Object.keys(expected)) {
    actual[column] = String(columns[column] ?? '')
  }
  expect(actual).toEqual(expected)
})

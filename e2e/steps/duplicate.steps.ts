/**
 * Holding up a book somebody has already photographed.
 *
 * The steps that photograph a front cover drive the front cover camera, which
 * is a second Playwright project rather than a flag a step can set: Chromium is
 * handed the video file on the command line. Everything tagged `@front-camera`
 * runs there and nothing else does.
 *
 * The steps about the panel itself are shared with the back cover camera, and
 * that is not an accident of naming. The Add flow asks the same question from
 * the other end (#146) and draws the same panel, in the same words, with the
 * same way past it, because it is the same answer: somebody photographed this
 * book already and has not shelved it yet.
 *
 * The one wait that is not a wait on the screen is the hash. A capture is
 * accepted the moment its photographs exist and read afterwards, so a scenario
 * that photographed a book a moment ago and scanned it straight away would be
 * racing a background job rather than testing anything. Waiting for the column
 * is waiting for the thing the answer actually depends on.
 *
 * That job is no longer the one that reads the photographs (#294). The hash
 * used to be written by the same serial pass, after the reading, which put a
 * few milliseconds of local work behind OCR and a catalogue lookup and every
 * capture queued in front of this one; a reading that hung meant a hash that
 * never arrived, and this wait timing out is how that showed. It is now its
 * own job, fired beside the reading and sharing nothing with it, so what this
 * waits on is a file being read and a number being computed.
 */

import { expect } from '@playwright/test'

import { Given, Then, When } from './fixtures.js'
import { homeScreen, inHandShutter, leaveTheCamera, reviewScreen } from './app.steps.js'
import { BOOK_IN_HAND } from '../support/books.js'

/**
 * The panels below wait on the background pass that reads the photographs,
 * which is OCR and a catalogue lookup: seconds, not milliseconds. Generous
 * rather than tight on purpose, because a wait that is only just long enough
 * is a flake waiting for a slow machine.
 */
const QUEUE_TIMEOUT = 90 * 1000

/**
 * Same check the back cover step makes, for the same reason: the camera file
 * is chosen when the browser launches, so a feature naming a different book
 * would silently be testing this one.
 */
Given('the camera is pointed at the front cover of {string}', async ({}, title: string) => {
  expect(
    title,
    'the front cover camera file is built for BOOK_IN_HAND in support/books.ts, ' +
    'and is handed to Chromium by the chromium-front-cover project in ' +
    'playwright.config.ts. A different book needs its own project.',
  ).toBe(BOOK_IN_HAND.title)
})

/**
 * Photograph the front rather than the back.
 *
 * The camera opens on the back, because that is where the barcode is. Here the
 * point is a capture whose front photograph exists, since the front is the
 * only slot a capture is hashed from.
 */
When('I photograph the front of the book', async ({ page }) => {
  await page.locator('button.wf-shot', { hasText: 'Front' }).click()
  await expect(page.locator('.wf-shot--next')).toContainText('Front')
  await page.locator('button.wf-shutter').click()

  // The photograph has to have reached the server before the queue has
  // anything to hash, and the photograph appearing in its box is what says so.
  await expect(page.locator('.wf-shot--taken', { hasText: 'Front' }))
    .toBeVisible({ timeout: QUEUE_TIMEOUT })
})

/** Send what has been photographed to the queue and start a fresh book. */
When('I send it to the queue', async ({ page, catalogue }) => {
  await page.getByRole('button', { name: /^Next book/ }).click()

  // The hash, not the status. See the note at the top of this file: the two
  // are written by two background jobs that do not wait on each other, and it
  // is the hash the scan below depends on.
  await expect
    .poll(
      async () => (await catalogue.captures())[0]?.front_hash ?? '',
      {
        message: 'the queued capture was never hashed, so nothing could match it',
        timeout: QUEUE_TIMEOUT,
      },
    )
    .not.toBe('')
})

/** Back to the home screen, which is where scanning starts from. */
When('I go back to the start', async ({ page }) => {
  await leaveTheCamera(page)
  await expect(homeScreen(page)).toBeVisible()
})

Then('it should say the book is already in the queue', async ({ page }) => {
  const panel = page.locator('.isbncam__choices--queued')
  await expect(panel).toBeVisible({ timeout: QUEUE_TIMEOUT })
  await expect(panel).toContainText('already in the queue')
  // Said as a finding about work already done, not as a shortlist of books to
  // choose between. The wording is the answer here.
  await expect(panel).toContainText('waiting to be shelved')
  // And it is the queue answer, not the books shortlist wearing a new class.
  await expect(page.locator('.isbncam__choices:not(.isbncam__choices--queued)')).toHaveCount(0)
})

When('I open the book it found in the queue', async ({ page }) => {
  await page.locator('.isbncam__choices--queued button.choice').first().click()
})

Then('the review screen should be showing a queued book', async ({ page }) => {
  // The review screen for the capture that already existed. Nothing about
  // getting here made a second one; the scenario asserts the count separately.
  await expect(reviewScreen(page)).toBeVisible({ timeout: QUEUE_TIMEOUT })
})

When('I say it is a different book', async ({ page }) => {
  await page.getByRole('button', { name: /different book/i }).click()
})

Then('it should stop saying the book is already in the queue', async ({ page }) => {
  await expect(page.locator('.isbncam__choices--queued')).toHaveCount(0)
})

Then('the camera should still be ready to scan', async ({ page }) => {
  await expect(inHandShutter(page)).toBeEnabled()
  await expect(page.locator('video.wf-view__video')).toBeVisible()
})

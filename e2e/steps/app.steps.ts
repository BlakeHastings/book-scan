/**
 * Driving the app the way a person does: taps on a phone-sized screen.
 *
 * Every wait here is a wait on a condition, never a sleep. The queue reads a
 * photograph in the background and the page polls for the result, so "the
 * camera recognises the book" is genuinely something that arrives when it
 * arrives; waiting a fixed two seconds for it would be a guess that eventually
 * turns into a flake.
 */

import { expect } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { Then, When } from './fixtures.js'

/** The queue decodes the barcode and looks it up. Seconds, not milliseconds. */
const QUEUE_TIMEOUT = 90 * 1000

When('I open the app', async ({ page, webUrl }) => {
  await page.goto(webUrl)
  await expect(page.locator('.tile__title', { hasText: 'Add' })).toBeVisible()
})

/**
 * The one way in for a book the catalogue already has.
 *
 * Two taps: the tile, then the shutter. The wait between them is a wait on a
 * frame arriving, same as the cataloguing camera, because a shutter pressed
 * before the fake device has delivered anything photographs an empty canvas.
 */
When('I scan the book', async ({ page }) => {
  await page.locator('button.tile', { hasText: 'Scan' }).click()
  await expect
    .poll(
      () => page.locator('video.isbncam__video').evaluate(
        (video) => (video as HTMLVideoElement).videoWidth,
      ),
      { message: 'the fake camera never produced a frame' },
    )
    .toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Scan', exact: true }).click()
})

Then('it should open the book {string}', async ({ page }, title: string) => {
  await expect(page.locator('.detail__title')).toHaveText(title, { timeout: QUEUE_TIMEOUT })
})

/**
 * What the book's page puts in front of you, in order.
 *
 * Exact and ordered, because the claim is not just that an action exists but
 * that the page leads with the one the book's state calls for. A page that
 * offered both directions, or neither, would still pass a looser check.
 */
Then('the book should offer:', async ({ page }, table: DataTable) => {
  const wanted = table.raw().map((row) => row[0] ?? '')
  await expect(page.locator('.actions--top .btn')).toHaveText(wanted)
})

When('I take it off the bookcase', async ({ page }) => {
  await page.getByRole('button', { name: 'Take it off the bookcase' }).click()
  await expect(page.locator('.checkedout')).toBeVisible()
})

When('I put it back on the bookcase', async ({ page }) => {
  await page.getByRole('button', { name: 'Put it back on the bookcase' }).click()
  await expect(page.locator('.shelve__ask')).toBeVisible()
})

/**
 * The same guided shuffle a new book goes through, but a book that came back
 * returns to the scanner rather than to the cataloguing camera, because that
 * is where the next book off the pile is dealt with.
 */
When('I say it fits and put it back', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()
  await expect(page.locator('video.isbncam__video')).toBeVisible({ timeout: QUEUE_TIMEOUT })
})

When('I start the camera', async ({ page }) => {
  await page.locator('button.tile', { hasText: 'Add' }).click()
  await page.getByRole('button', { name: 'Start camera' }).click()

  // The fake device is a file, so the first frame arrives almost at once. What
  // matters is that a frame arrived at all: without one the shutter draws an
  // empty canvas, and the failure would surface much later as a photograph the
  // server cannot read.
  await expect
    .poll(
      () => page.locator('video.cam__video').evaluate(
        (video) => (video as HTMLVideoElement).videoWidth,
      ),
      { message: 'the fake camera never produced a frame' },
    )
    .toBeGreaterThan(0)

  await expect(page.locator('.cam__error')).toHaveCount(0)
})

When('I photograph the book', async ({ page }) => {
  // The back cover is the slot the camera opens on, which is deliberate: it
  // carries the barcode, so identification starts on the first shot.
  await expect(page.locator('.cam__chip--on')).toContainText('Back')
  await page.locator('button.shutter').click()
})

Then('the camera should recognise the book as {string}', async ({ page }, title: string) => {
  await expect(page.locator('.cam__found')).toContainText(title, { timeout: QUEUE_TIMEOUT })
})

When('I review what it found', async ({ page }) => {
  const review = page.locator('button.cam__review')
  await expect(review).toBeEnabled({ timeout: QUEUE_TIMEOUT })
  await review.click()
  await expect(page.locator('.review')).toBeVisible()
})

Then('the review screen should show:', async ({ page }, table: DataTable) => {
  for (const [label, value] of Object.entries(table.rowsHash())) {
    // Exact, because the fields are labelled by wrapping <label> elements and
    // a loose match for "Title" also finds "Subtitle".
    await expect(page.getByLabel(label, { exact: true }), `the "${label}" field`)
      .toHaveValue(value)
  }
})

Then('the ISBN should read {string}', async ({ page }, isbn: string) => {
  await expect(page.locator('.isbn-block__number')).toHaveText(isbn)
})

/**
 * The provenance, on screen. It is drawn only when there is a source to draw,
 * so an absent line and a wrong line fail the same way here, which is what is
 * wanted: a book whose reading nobody recorded is the bug.
 */
Then('the ISBN should say it was read from {string}', async ({ page }, source: string) => {
  await expect(page.locator('.isbn-block__source')).toHaveText(`read from ${source}`)
})

When('I confirm the details and go to shelve it', async ({ page }) => {
  await page.getByRole('button', { name: 'Looks right, shelve it' }).click()
  await expect(page.locator('.shelve__ask')).toBeVisible()
})

/**
 * The instruction sentence. Which element carries it depends on whether the
 * app could draw the shelf: with books on it you get the strip and its
 * instruction, and on a completely empty range you get the card instead. Both
 * say the same sentence, and the sentence is what the feature is about.
 */
Then('the placement should read {string}', async ({ page }, text: string) => {
  await expect(
    page.locator('.placement-view__instruction, .placement__instruction'),
  ).toHaveText(text)
})

Then('the shelf drawing should be labelled {string}', async ({ page }, label: string) => {
  await expect(page.locator('.strip__label')).toHaveText(label)
})

Then(
  'it should tell me to put {string} in the gap at {string}',
  async ({ page }, title: string, shelf: string) => {
    await expect(page.locator('.shelve__ask')).toContainText(
      `Put ${title} in the gap at ${shelf}`,
    )
  },
)

When('I say there is no room on the shelf', async ({ page }) => {
  await page.getByRole('button', { name: 'No room, move one along' }).click()
})

Then(
  'it should ask me to move {string} from {string} to {string}',
  async ({ page }, title: string, from: string, to: string) => {
    await expect(page.locator('.shelve__ask')).toContainText(
      `Take ${title} off the end of ${from} and put it at the start of ${to}.`,
    )
  },
)

When('I say the moved book fitted', async ({ page }) => {
  await page.getByRole('button', { name: 'Yes, it fit' }).click()
})

When('I say it fits and save it', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()

  // Saving a new book hands the screen back to the camera for the next one, so
  // the shutter reappearing is how the app says it is done.
  await expect(page.locator('button.shutter')).toBeVisible({ timeout: QUEUE_TIMEOUT })
})

Then(
  'the library should show {string} on shelf {string}',
  async ({ page }, title: string, shelf: string) => {
    // Reached from the camera, which is where somebody scanning a pile is.
    const library = page.locator('button.cam__chip-btn', { hasText: 'Library' })
    if (await library.isVisible()) await library.click()

    const row = page.locator('li.shelfrow', { hasText: title })
    await expect(row).toBeVisible()
    await expect(row.locator('.shelfrow__loc')).toHaveText(shelf)
  },
)

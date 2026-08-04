/**
 * Driving the app the way a person does: taps on a phone-sized screen.
 *
 * Every wait here is a wait on a condition, never a sleep. The queue reads a
 * photograph in the background and the page polls for the result, so "the
 * camera recognises the book" is genuinely something that arrives when it
 * arrives; waiting a fixed two seconds for it would be a guess that eventually
 * turns into a flake.
 */

import { expect, type Page } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { Then, When } from './fixtures.js'
import { stubBookByTitle } from '../support/books.js'

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

/**
 * To the library from wherever this scenario happens to be.
 *
 * Three ways in, because the library is reachable from the camera, the home
 * tiles and the header, and which one is on screen depends on what the
 * scenario just did rather than on anything it says.
 */
async function openLibrary(page: Page): Promise<void> {
  for (const entry of [
    page.locator('button.cam__chip-btn', { hasText: 'Library' }),
    page.locator('button.tile', { hasText: 'Library' }),
    page.locator('nav button.tab', { hasText: 'Library' }),
  ]) {
    if (await entry.isVisible()) {
      await entry.click()
      break
    }
  }

  // Groups and the attention list are filled by the same load, so a rendered
  // shelf means the misfile check has been asked and answered too. Without
  // this wait, "nothing needs attention" would pass on a page that has not
  // finished asking.
  await expect(page.locator('.shelfgroup').first()).toBeVisible()
}

When('I go to the library', async ({ page }) => {
  await openLibrary(page)
})

When(
  'I open {string} from the off-bookcase list',
  async ({ page }, title: string) => {
    await page.locator('button.offshelf__row', { hasText: title }).click()
    // A catalogued book opens as a record, not as the editable form, so the
    // heading is what says the right book is on screen.
    await expect(page.locator('.detail__title')).toHaveText(title)
  },
)

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

/**
 * The list of books the catalogue thinks are in the wrong place.
 *
 * Asserted as absent rather than as "does not contain this title", because the
 * failure being guarded against is the app reporting a move it has just walked
 * somebody through: any entry at all, for any book in a scenario that has only
 * ever put books where it was told, is that failure.
 */
Then('nothing should need attention', async ({ page }) => {
  await expect(page.locator('.attention')).toHaveCount(0)
})

/**
 * A catalogued book opened by tapping its row in the shelf listing, rather
 * than the off-bookcase list `openLibrary` above already covers. Same
 * destination, a different route in.
 */
When('I open {string} from the library', async ({ page }, title: string) => {
  await page.locator('li.shelfrow', { hasText: title }).locator('.shelfrow__body').click()
  await expect(page.locator('.detail__title')).toHaveText(title)
})

When('I start editing the details', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit details' }).click()
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
})

/**
 * The Change ISBN flow: open the prompt, type the digits, submit. The lookup
 * it starts is asynchronous and outlives this step; whether Save waits for it
 * is what a scenario using this step is checking, not asserted here.
 */
When('I change the ISBN to that of {string}', async ({ page }, title: string) => {
  const target = stubBookByTitle(title)
  await page.getByRole('button', { name: 'Change ISBN' }).click()
  await page.locator('.isbn-input input').fill(target.isbn13)
  await page.getByRole('button', { name: 'Look up and replace' }).click()
})

Then('Save changes should be unavailable while the lookup runs', async ({ page }) => {
  // Short and explicit rather than the suite's default 30s: this is either
  // already true by the time "Look up and replace" has been clicked, or it
  // never becomes true, and a regression should say so in seconds, not
  // three quarters of a minute.
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled({ timeout: 2_000 })
})

/**
 * The delay armed on the stub (see "I arm a slow lookup" in
 * catalogue.steps.ts) is what makes this worth waiting for rather than
 * asserting instantly: a fix that disabled Save but never re-enabled it would
 * time out here instead of passing.
 */
Then(
  'Save changes should be available again once the lookup answers',
  async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Save changes' }))
      .toBeEnabled({ timeout: 10_000 })
  },
)

When('I save the changes', async ({ page }) => {
  await page.getByRole('button', { name: 'Save changes' }).click()
  // Saving a catalogued book returns to its record view, not the camera.
  await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible()
})

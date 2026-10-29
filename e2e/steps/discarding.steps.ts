/**
 * Throwing a book away from each place somebody would try it. Every assertion
 * is on the database, since a screen that stops drawing a book is not the same
 * as the book being gone.
 */

import { expect } from '@playwright/test'

import { Then, When } from './fixtures.js'

const QUEUE_TIMEOUT = 90 * 1000

Then('it should say saving adds a second copy', async ({ page }) => {
  await expect(page.getByText('Saving adds a second copy')).toBeVisible({ timeout: QUEUE_TIMEOUT })
  await expect(page.getByText(/Already catalogued as #\d+ \(Dune\)/)).toBeVisible()
})

When('I discard the scan', async ({ page }) => {
  await page.getByRole('button', { name: 'Discard this scan and its photos' }).click()
  const dialog = page.locator('.wf-sure')
  await expect(dialog).toContainText('The copy already catalogued')
  await dialog.getByRole('button', { name: 'Discard it' }).click()
  // Off the review screen, which happens only once the server has answered.
  await expect(page.getByRole('button', { name: 'That is the book' })).toHaveCount(0)
  await expect(page.locator('.queue__row')).toHaveCount(0)
})

/**
 * A finger dragged left across the row, as a mouse: the row reads pointer
 * events and a mouse's primary button is one, so this is the same gesture to
 * the code that decides it.
 */
When('I slide the queued book away', async ({ page }) => {
  const slide = page.locator('.queue__row .queue__slide').first()
  await expect(slide).toBeVisible({ timeout: QUEUE_TIMEOUT })
  const box = (await slide.boundingBox())!
  const y = box.y + box.height / 2
  const from = box.x + box.width - 20
  await page.mouse.move(from, y)
  await page.mouse.down()
  for (let step = 1; step <= 12; step++) await page.mouse.move(from - step * 15, y)
  await page.mouse.up()
})

Then('the queued book should say it is being discarded', async ({ page }) => {
  await expect(page.locator('.queue__undo')).toContainText('Nothing has been deleted yet')
})

/** Polled: the discard is sent on the way out, so it lands a moment after the tap. */
Then('the queue should come to hold {int} books', async ({ catalogue }, count: number) => {
  await expect
    .poll(() => catalogue.captureCount(), {
      message: `the queue never came to hold ${count} books`,
      timeout: 5_000,
    })
    .toBe(count)
})

Then('the catalogue should hold one copy of {string}', async ({ catalogue }, title: string) => {
  const copies = (await catalogue.books()).filter((book) => book.title === title)
  expect(copies, `the catalogue does not hold exactly one "${title}"`).toHaveLength(1)
})

When('I delete the book from its own page', async ({ page }) => {
  await page.getByRole('button', { name: 'Delete this book and its photos' }).click()
  const dialog = page.locator('.wf-sure')
  await expect(dialog).toContainText('photographs are deleted from disk')
  await dialog.getByRole('button', { name: 'Delete book' }).click()
  await expect(dialog).toHaveCount(0)
})

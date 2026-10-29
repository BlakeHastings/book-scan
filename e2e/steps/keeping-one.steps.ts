/**
 * Several scans of one book in the queue, drawn as one group with a way to keep
 * one. The count at the end is read from the database: a group that stops
 * drawing a scan is not the same as the scan being discarded.
 */

import { expect } from '@playwright/test'

import { Then, When } from './fixtures.js'

/** The second scan is read in the background before it carries an ISBN to group on. */
const QUEUE_TIMEOUT = 90 * 1000

Then(
  'the queue should show one group of {int} scans of {string}',
  async ({ page }, n: number, title: string) => {
    const group = page.locator('.queue__same')
    await expect(group).toHaveCount(1, { timeout: QUEUE_TIMEOUT })
    await expect(group).toHaveAttribute('aria-label', `${n} scans of ${title}`)
    await expect(group.locator('.queue__row')).toHaveCount(n)
    await expect(group).toContainText(`${n} scans of this book`)
    // Nothing outside the group: the scans are not also drawn as separate books.
    await expect(page.locator('.queue__row')).toHaveCount(n)
  },
)

When('I keep one of the scans', async ({ page }) => {
  await page.locator('.queue__same').getByRole('button', { name: 'Keep this one' }).first().click()
})

Then('the other scan should say it is being discarded', async ({ page }) => {
  const group = page.locator('.queue__same')
  await expect(group.locator('.queue__undo')).toHaveCount(1)
  await expect(group.locator('.queue__undo')).toContainText('Nothing has been deleted yet')
  await expect(group.getByRole('button', { name: 'Keep this one' })).toHaveCount(0)
})

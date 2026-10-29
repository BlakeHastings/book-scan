/**
 * A book named by the title read off its front cover. The suggestion is the
 * queue's, written beside the reading, so it is on review as soon as the
 * camera says the reading has settled.
 */

import { expect } from '@playwright/test'

import { Then, When } from './fixtures.js'

function offer(page: import('@playwright/test').Page) {
  return page.locator('.wf-card', { hasText: 'Found by the title on the cover' })
}

Then(
  'review should ask whether it is {string} by {string}',
  async ({ page }, title: string, author: string) => {
    await expect(offer(page).locator('.wf-card__title')).toHaveText(`Looks like ${title} by ${author}?`)
    await expect(offer(page).getByRole('button', { name: 'Yes, that is it' })).toBeVisible()
  },
)

Then('review should not ask whether it is any book', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'That is the book' })).toBeVisible()
  await expect(offer(page)).toHaveCount(0)
})

When('I say that is the book it found', async ({ page }) => {
  await offer(page).getByRole('button', { name: 'Yes, that is it' }).click()
  await expect(offer(page)).toHaveCount(0)
})

Then('review should say the title and author were read off the cover', async ({ page }) => {
  await expect(page.locator('.wf-said', { hasText: 'Title and author read off the cover' })).toBeVisible()
})

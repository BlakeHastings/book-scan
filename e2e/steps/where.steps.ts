/** The shelving screen as it reads on a phone: the questions it asks, and where its sentence sits. */

import { expect, type Page } from '@playwright/test'

import { Then, When } from './fixtures.js'

const REDRAW = 15_000

Then('it should ask whether the book is fiction or non-fiction', async ({ page }) => {
  await expect(page.locator('.shelve__ask')).toContainText('fiction or non-fiction?')
  await expect(page.getByRole('button', { name: 'Fiction', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Non-fiction', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'It fits, save' })).toHaveCount(0)
})

When('I say here that it is {string}', async ({ page }, answer: string) => {
  await page.getByRole('button', { name: answer, exact: true }).click()
  await expect(page.getByRole('button', { name: 'It fits, save' }))
    .toBeEnabled({ timeout: REDRAW })
})

/**
 * Read after two animation frames, once the strip has centred its gap, since
 * that is the moment that used to move the page.
 */
async function whereTheSentenceIs(page: Page) {
  await expect(page.locator('.wf-instruction')).toBeVisible()
  return page.evaluate(() => new Promise<{
    scrollY: number; left: number; right: number; top: number
    headerBottom: number; screenWidth: number
  }>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sentence = document.querySelector('.wf-instruction')!.getBoundingClientRect()
      const header = document.querySelector('.wf-top')!.getBoundingClientRect()
      resolve({
        scrollY: Math.round(window.scrollY),
        left: Math.round(sentence.left),
        right: Math.round(sentence.right),
        top: Math.round(sentence.top),
        headerBottom: Math.round(header.bottom),
        screenWidth: document.documentElement.clientWidth,
      })
    }))
  }))
}

Then(
  'the sentence about where it goes should sit inside the page, below the header',
  async ({ page }) => {
    const seen = await whereTheSentenceIs(page)
    const said = JSON.stringify(seen)
    expect(seen.scrollY, `the page has scrolled: ${said}`).toBe(0)
    expect(seen.top, `the sentence is under the header: ${said}`)
      .toBeGreaterThanOrEqual(seen.headerBottom)
    expect(seen.left, `the sentence touches the left edge: ${said}`).toBeGreaterThanOrEqual(8)
    expect(seen.right, `the sentence touches the right edge: ${said}`)
      .toBeLessThanOrEqual(seen.screenWidth - 8)
  },
)

/** Shorter than the suite's default, so the shelving screen is taller than the glass and can scroll. */
When('I am holding a phone with a short screen', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 640 })
})

Then('the page should still be at the top', async ({ page }) => {
  const seen = await whereTheSentenceIs(page)
  expect(seen.scrollY, `the page has scrolled: ${JSON.stringify(seen)}`).toBe(0)
})

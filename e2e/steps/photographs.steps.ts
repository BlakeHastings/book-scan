/**
 * Looking at a book's photographs: what the phone downloads to draw them, the
 * shape they are drawn, and the picture opened over the whole screen.
 */

import { expect, type Page } from '@playwright/test'

import { Then, When } from './fixtures.js'

/** Every photograph address the page has asked for since counting started. */
let asked: string[] = []

When('I start counting the photographs downloaded', async ({ page }) => {
  asked = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/covers/')) asked.push(url.pathname + url.search)
  })
})

Then('every photograph drawn should be a copy rather than the original', async ({ page }) => {
  // Every photograph on the screen has finished, so nothing is still to be asked for.
  await expect
    .poll(() => page.locator('.wf-shot__img').evaluateAll((all) => all.every((img) => (img as HTMLImageElement).complete)))
    .toBe(true)
  expect(asked.length, 'nothing was downloaded, so this proves nothing').toBeGreaterThan(0)
  const originals = asked.filter((path) => !/\?w=\d+$/.test(path))
  expect(originals, 'these were downloaded at the size the camera took them').toEqual([])
})

Then('every photograph of the book should be drawn taller than it is wide', async ({ page }) => {
  const boxes = await page.locator('.wf-shots--big .wf-shot--taken .wf-shot__box').evaluateAll((all) =>
    all
      .map((box) => box.getBoundingClientRect())
      .filter((rect) => rect.width > 0)
      .map((rect) => ({ width: Math.round(rect.width), height: Math.round(rect.height) })),
  )
  expect(boxes.length).toBeGreaterThan(0)
  for (const box of boxes) {
    expect(box.height, `a photograph drawn ${box.width} wide and ${box.height} tall`).toBeGreaterThan(box.width)
  }
})

function viewer(page: Page) {
  return page.getByRole('dialog', { name: 'The whole picture' })
}

When('I press a photograph of the book', async ({ page }) => {
  await page.getByRole('listitem', { name: /^See the whole .* picture$/ }).first().click()
})

Then('it should be open over the whole screen', async ({ page }) => {
  await expect(viewer(page)).toBeVisible()
  const picture = viewer(page).locator('.wf-whole__frame--showing img')
  await expect(picture).toBeVisible()
  // The copy as wide as a phone screen, not the original, until somebody zooms.
  await expect(picture).toHaveAttribute('src', /\?w=\d+$/)
  const box = (await picture.boundingBox())!
  const screen = page.viewportSize()!
  expect(box.width).toBeGreaterThan(screen.width * 0.6)
})

When('I press {string} on it', async ({ page }, name: string) => {
  await viewer(page).getByRole('button', { name, exact: true }).click()
})

When('I use the back gesture', async ({ page }) => {
  await expect(viewer(page)).toBeVisible()
  await page.goBack()
})

When('I tap the picture once', async ({ page }) => {
  await viewer(page).locator('.wf-whole__frame--showing img').click()
})

Then('it should no longer be open', async ({ page }) => {
  await expect(viewer(page)).toHaveCount(0)
})

Then('{string} should still be on the screen', async ({ page }, name: string) => {
  await expect(page.getByRole('button', { name })).toBeVisible()
})

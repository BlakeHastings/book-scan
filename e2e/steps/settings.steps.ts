/** The Settings screen, and the resets on it. */

import { expect } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { Given, Then, When } from './fixtures.js'

/** How long a press is given to redraw before a claim is made about the screen. */
const REDRAW = 15_000

/** The placement rows as they stood before the scenario pressed anything. */
let before: { id: number; title: string; kind: string; actor: string }[] = []

Given('{string} is pinned where it stands', async ({ catalogue }, title: string) => {
  await catalogue.pin(title)
})

Given('I have noted the placement history', async ({ catalogue }) => {
  before = await catalogue.placements()
  expect(before.length, 'there should be a history to keep').toBeGreaterThan(0)
})

When('I open the settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Your fixtures', exact: true }).first().click()
  await page.getByRole('button', { name: /^Settings/ }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: REDRAW })
})

Then('the settings should say {string}', async ({ page }, words: string) => {
  await expect(page.getByText(words, { exact: false }).first()).toBeVisible({ timeout: REDRAW })
})

Then('I should not be offered to {string}', async ({ page }, word: string) => {
  await expect(page.getByRole('button', { name: word, exact: true }).first()).toBeDisabled()
})

When('I ask to {string}', async ({ page }, word: string) => {
  await page.getByRole('button', { name: word, exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: word })).toBeVisible({ timeout: REDRAW })
})

Then('it should not let me {string} until I type {string}', async ({ page }, word: string, phrase: string) => {
  const asked = page.getByRole('dialog', { name: word })
  const act = asked.getByRole('button', { name: word, exact: true })
  await expect(act).toBeDisabled()

  const box = asked.getByRole('textbox')
  await box.fill(phrase.slice(0, -1))
  await expect(act).toBeDisabled()
  await box.fill(phrase)
  await expect(act).toBeEnabled()
})

When('I type {string} and {string}', async ({ page }, phrase: string, word: string) => {
  const asked = page.getByRole('dialog', { name: word })
  await asked.getByRole('textbox').fill(phrase)
  await asked.getByRole('button', { name: word, exact: true }).click()
  await expect(asked).toBeHidden({ timeout: REDRAW })
})

Then('no shelved book should be on a plank', async ({ catalogue }) => {
  const books = await catalogue.books()
  expect(books.length).toBeGreaterThan(0)
  expect(books.filter((one) => one.current_area_id !== null).map((one) => one.title)).toEqual([])
})

Then(
  'the placement history should have kept every row and gained:',
  async ({ catalogue }, table: DataTable) => {
    const after = await catalogue.placements()
    expect(after.slice(0, before.length), 'no row should have been deleted').toEqual(before)
    const gained = after.slice(before.length)
      .map(({ title, kind, actor }) => ({ title, kind, actor }))
      .sort((a, b) => a.title.localeCompare(b.title))
    expect(gained).toEqual(table.hashes())
  },
)

Then('{string} should still carry the tag {string}', async ({ catalogue }, title: string, slug: string) => {
  const tags = await catalogue.tagsOf(title)
  expect(tags.map((one) => one.slug)).toContain(slug)
})

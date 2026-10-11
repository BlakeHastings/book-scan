/** The queue's second job: catalogued books that stand on no plank. */

import { expect } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { After, Given, Then, When } from './fixtures.js'
import { stubBookByTitle } from '../support/books.js'

const REDRAW = 15_000

const theGroup = (page: import('@playwright/test').Page) =>
  page.getByRole('list', { name: 'Books not on a shelf yet' })

Then('the queue should say {string}', async ({ page }, words: string) => {
  await expect(page.getByText(words, { exact: false }).first()).toBeVisible({ timeout: REDRAW })
})

Then('the books not on a shelf should be, in order:', async ({ page }, table: DataTable) => {
  const titles = table.hashes().map((row) => row.title ?? '')
  const rows = theGroup(page).locator('.wf-queued__title')
  await expect(rows).toHaveText(titles, { timeout: REDRAW })
})

When('I place {string} from the queue', async ({ page }, title: string) => {
  await theGroup(page).getByRole('button', { name: new RegExp(title) }).click()
  const fits = page.getByRole('button', { name: 'It fits, save' })
  await expect(fits).toBeEnabled({ timeout: REDRAW })
  await fits.click()
  // Placing a book picked up from the queue goes back to the queue.
  await expect(theGroup(page)).toBeVisible({ timeout: REDRAW })
})

Then('{string} should stand on a plank, put there by a person', async ({ catalogue }, title: string) => {
  const book = await catalogue.bookByTitle(title)
  expect(book?.state).toBe('shelved')
  expect(book?.current_area_id).not.toBeNull()
  const rows = (await catalogue.placements()).filter((row) => row.title === title)
  expect(rows.at(-1)).toMatchObject({ kind: 'placed', actor: 'person' })
})

Then('every book should still be catalogued', async ({ catalogue }) => {
  const books = await catalogue.books()
  expect(books.map((book) => book.state)).toEqual(['shelved', 'shelved', 'shelved'])
})

Given('the catalogue also holds {string}, which nothing says is fiction or not', async ({ apiUrl }, title: string) => {
  const book = stubBookByTitle(title)
  const response = await fetch(`${apiUrl}/api/books`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      isbn13: book.isbn13,
      isbn10: book.isbn10,
      title: book.title,
      authors: book.authors,
      publisher: book.publisher,
      published: book.published,
      pages: book.pages,
    }),
  })
  expect(response.ok, `seeding "${title}" failed: ${response.status}`).toBe(true)
})

When('I put {string} on the first shelf offered', async ({ page }, title: string) => {
  await theGroup(page).getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByText('Put it somewhere yourself')).toBeVisible({ timeout: REDRAW })
  await page.getByRole('button', { name: /^On / }).first().click()
  await expect(page.getByRole('heading', { name: 'Queue' })).toBeVisible({ timeout: REDRAW })
})

After(async ({ catalogue }) => {
  await catalogue.dropScenarioRules()
})

Given('a rule wants books tagged {string} on {string}', async ({ catalogue }, slug: string, label: string) => {
  await catalogue.ruleOnPlank(await catalogue.plankId(label), slug)
})

Given('{string} is tagged {string}', async ({ apiUrl, catalogue }, title: string, slug: string) => {
  const book = await catalogue.bookByTitle(title)
  const response = await fetch(`${apiUrl}/api/books/${book!.id}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  })
  expect(response.ok, `tagging "${title}" failed: ${response.status}`).toBe(true)
})

When('I put {string} where the rules want it, on {string}', async ({ page }, title: string, label: string) => {
  await theGroup(page).getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByText(`The rules put it on ${label}`)).toBeVisible({ timeout: REDRAW })
  await page.getByRole('button', { name: `It is on ${label}, save` }).click()
  await expect(page.getByRole('heading', { name: 'Queue' })).toBeVisible({ timeout: REDRAW })
})

Then('{string} should stand on {string}', async ({ catalogue }, title: string, label: string) => {
  const book = await catalogue.bookByTitle(title)
  expect(book?.current_area_id).toBe(await catalogue.plankId(label))
})

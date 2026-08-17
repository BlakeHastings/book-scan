/**
 * Saying what a book is, on the check-the-details screen (#372).
 *
 * Two kinds of step here and the difference is the point of the file. The ones
 * that drive the panel act like a person: open it, type, press the row that is
 * offered. The ones that check go to the database, because what #372 has to be
 * true about is a row: a person's tag surviving a save that states a genre is
 * not something a screen can be asked, and the failure it guards against was
 * silent by construction.
 */

import { expect, type Page } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { Given, Then, When } from './fixtures.js'

/** The panel, which is drawn over the screen it was opened from. */
function panel(page: Page) {
  return page.locator('.wf-name')
}

/** The offer to make one that is not there. Absent is the refusal. */
function makeRow(page: Page) {
  return panel(page).locator('.wf-make')
}

/** The tags on the screen underneath, the two genre answers included. */
function tagRow(page: Page) {
  return page.locator('.wf-tags .wf-tag')
}

async function open(page: Page, typed: string) {
  await page.locator('button.wf-tag--add').click()
  await expect(panel(page)).toBeVisible()
  await panel(page).locator('input').fill(typed)
}

/**
 * A tag the collection already keeps, put there without driving this screen.
 *
 * Through the real route rather than by writing a row, for the reason the
 * shelves are seeded through the API: what the scenario is about is what
 * happens the *second* time somebody names it, and the first time has to have
 * been a real one or the thing being tested is a fixture.
 *
 * It hangs off a book, because that is the only way a tag comes into existence
 * here: nothing in this app defines a word nobody has put on a book. So the
 * scenario seeds a book, tags it, and the tag outlives it.
 */
Given('the collection already keeps a tag called {string}', async (
  { apiUrl, catalogue }, label: string,
) => {
  const created = await fetch(`${apiUrl}/api/books`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `A book that carried ${label}`,
      authors: ['Nobody'],
      genre: 'genre/fiction',
      classificationSource: 'auto',
      classificationConfidence: 'high',
    }),
  })
  expect(created.ok, `seeding a book to hang "${label}" off failed`).toBe(true)
  const { id } = (await created.json()) as { id: number }

  const tagged = await fetch(`${apiUrl}/api/books/${id}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  })
  expect(tagged.ok, `seeding the tag "${label}" failed`).toBe(true)

  const kept = await catalogue.vocabulary()
  expect(kept.map((one) => one.label)).toContain(label)
})

When('I name a new tag {string}', async ({ page }, label: string) => {
  await open(page, label)
  await expect(makeRow(page)).toBeVisible()
  await makeRow(page).click()
  // The panel closes on the choice, which is what makes this the fast path
  // rather than a form with a way out of its own.
  await expect(panel(page)).toBeHidden()
})

When('I start naming a tag as {string}', async ({ page }, typed: string) => {
  await open(page, typed)
})

/**
 * The genre, answered where it is answered: one of the two options, tapped.
 *
 * Not through the panel, and that is the whole point of there being two things
 * on this row. #304 is that a genre is stated only when a source did or a person
 * answered this question, and the box above cannot reach it.
 */
When('I say the book is fiction', async ({ page }) => {
  await tagRow(page).filter({ hasText: /^Fiction$/ }).first().click()
})

When('I add the tag it offers', async ({ page }) => {
  await panel(page).locator('.wf-suggest').first().click()
  await expect(panel(page)).toBeHidden()
})

Then('it should offer {string} and no way to make another', async (
  { page }, label: string,
) => {
  await expect(panel(page).locator('.wf-suggest', { hasText: label })).toBeVisible()
  await expect(makeRow(page)).toHaveCount(0)
})

Then('it should offer no way to make another', async ({ page }) => {
  await expect(makeRow(page)).toHaveCount(0)
})

Then('it should say the two are above the box', async ({ page }) => {
  await expect(panel(page)).toContainText('above')
  await expect(panel(page)).toContainText('Fiction and non-fiction')
})

Then('the book should be tagged {string}', async ({ page }, label: string) => {
  await expect(tagRow(page).filter({ hasText: label }).first()).toBeVisible()
})

/**
 * What the row says afterwards, with who said each one.
 *
 * The source is in the table on purpose. "Dune carries a comic book tag" would
 * pass on a tag the catalogue happened to send, and what #372 is about is a
 * person's word surviving a save that states a genre by the same person.
 */
Then('the catalogue should have {string} tagged:', async (
  { catalogue }, title: string, table: DataTable,
) => {
  const carried = await catalogue.tagsOf(title)
  for (const [label, source] of table.raw()) {
    expect(
      carried.map((one) => `${one.label}/${one.source}`),
      `"${title}" is not tagged ${label} by a ${source}`,
    ).toContain(`${label}/${source}`)
  }
})

/**
 * One word, one tag, asked of the whole collection rather than of the book.
 *
 * This is the assertion the near-duplicate refusal exists for. A book carrying
 * "Comic book" says nothing about whether the vocabulary also grew a second row
 * spelled "Comic books" alongside it, and that second row is the failure: two
 * counts each holding half the answer, and two rules to write.
 */
Then('the collection should keep one tag reading {string}', async (
  { catalogue }, label: string,
) => {
  const kept = await catalogue.vocabulary()
  const reading = kept.filter((one) => one.label.toLowerCase().startsWith(label.toLowerCase()))
  expect(reading, `the collection keeps ${reading.length} tags reading like "${label}"`)
    .toHaveLength(1)
})

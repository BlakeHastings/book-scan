/**
 * Working the carry list, and deciding not to.
 *
 * A file of its own because what these are about is one thing: **what happens
 * to the books when somebody says no to the work**. #402 is the reason they
 * exist. Forty-six of the owner's books had a wanted move on them and the app
 * had no way to be told he was not going to make it, so the list asked forever
 * and the only exits were to carry them or to look at it.
 *
 * Every claim these make ends in the database, and it is always the same claim
 * said two ways: **where each book is recorded did not change**. That is the one
 * thing withdrawing an intention must never touch, and it is invisible from a
 * screen that has correctly stopped drawing the work.
 */

import { expect } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { Given, Then, When } from './fixtures.js'

/** How long a press is given to redraw before a claim is made about the screen. */
const REDRAW = 15_000

/**
 * Where every book stood before the decision, by title.
 *
 * Module scope, which is per worker and therefore per scenario file rather than
 * shared between scenarios running at once: playwright-bdd gives each worker its
 * own module instance, and every scenario that reads this writes it first.
 */
let stood = new Map<string, number | null>()

/** The list itself, which is where the owner is looking. */
When('I open the list of books to carry', async ({ page }) => {
  await page.getByRole('button', { name: /Go and carry them|Open the list/ }).click()
  await expect(page.getByRole('heading', { name: 'Books to carry' }))
    .toBeVisible({ timeout: REDRAW })
})

/**
 * What the first screen says is outstanding, which is the number #458 is about.
 *
 * Read off the tile rather than off the list behind it, because the complaint
 * was that this number said nothing was left to do while the manage screen
 * named books that were. A scenario that only opened the list would never see
 * the disagreement.
 */
Then('the first screen should say {string} to carry', async ({ page }, said: string) => {
  await expect(page.locator('.wf-stat', { hasText: 'to carry' }))
    .toContainText(said, { timeout: REDRAW })
})

/**
 * The list itself, opened from that tile rather than from the door beside it.
 *
 * The wait is on the top bar rather than on a heading, because a job of one
 * book skips the list and lands on the trip: `CarryScreen` chooses the trip and
 * redirects when `moving` is 1, so the screen that arrives says "One book to
 * carry" and the one for several says "Books to carry". Both are the list from
 * where somebody is standing, and waiting for one of the two names would make
 * this step depend on how much work there happens to be.
 */
When('I open that list from the first screen', async ({ page }) => {
  await page.locator('.wf-stat', { hasText: 'to carry' }).click()
  await expect(page.locator('.wf-top__title')).toContainText(/carry/i, { timeout: REDRAW })
})

/**
 * The first trip on the list, opened at the piece the books come off.
 *
 * The primary button rather than the row, because that is the answer the screen
 * leads with, and it names where to start: "Start at 5A", or "Carry on at 5A" on
 * a list somebody is part way through.
 */
When('I start the first trip', async ({ page }) => {
  await page.getByRole('button', { name: /^(Start|Carry on) at / }).click()
  await expect(page.getByRole('button', { name: /^I have (all .+|it)$/ }))
    .toBeVisible({ timeout: REDRAW })
})

/**
 * The books are off the shelf and in somebody's hands.
 *
 * **This writes nothing**, which is the one thing to know about it: a book in
 * transit gets no row, so this is a navigation and there is nothing to unwind if
 * the phone locks halfway across the room.
 */
When('I take the books off the shelf', async ({ page }) => {
  await page.getByRole('button', { name: /^I have (all .+|it)$/ }).click()
  await expect(page.locator('.wf-top__title')).toHaveText('Where it goes', { timeout: REDRAW })
})

/**
 * Every book in the armful put down, one at a time, saying so each time.
 *
 * The same press for each, because that is what a person does: the screen names
 * a plank, they put the book on it, they say it fitted, and the next book is in
 * their hand. It ends when the trip does, on "Carried".
 *
 * A bounded loop rather than a wait for a count, because the armful is however
 * many books the trip had, and a loop that could not end is how a broken flow
 * reads as a hung test rather than as a failure.
 */
When('I say each book fits', async ({ page }) => {
  for (let at = 0; at < 20; at += 1) {
    if (await page.locator('.wf-top__title').textContent() === 'Carried') return
    await page.getByRole('button', { name: 'It fits, save' }).click()
    await expect(page.getByRole('button', { name: 'Saving...' }))
      .toHaveCount(0, { timeout: REDRAW })
  }
  await expect(page.locator('.wf-top__title')).toHaveText('Carried', { timeout: REDRAW })
})

/**
 * Where the book actually ended up, which is the half no screen can answer.
 *
 * #429 is exactly this gap: the finished screen said a book was on `3A` while
 * the row it drew for `3A` had nothing on it, because nothing had ever been
 * written there. A sentence over a write that did not happen where it said reads
 * the same as one over a write that did.
 */
Then('{string} should be standing on {string}', async (
  { catalogue }, title: string, plank: string,
) => {
  const book = await catalogue.bookByTitle(title)
  expect(book, `no book called "${title}" is catalogued`).toBeTruthy()
  expect(book!.current_area_id, `${title} is not on ${plank}`)
    .toBe(await catalogue.plankId(plank))
})

/**
 * What the list says, line by line.
 *
 * Substrings rather than whole screens, the way the plan's own step reads them:
 * the claim is that each sentence is in front of the person.
 */
Then('the carry list should say:', async ({ page }, table: DataTable) => {
  for (const row of table.raw()) {
    await expect(page.locator('body'), `the list does not say "${row[0]}"`)
      .toContainText(row[0] ?? '', { timeout: REDRAW })
  }
})

Then('the carry list should not say {string}', async ({ page }, said: string) => {
  await expect(page.locator('body')).not.toContainText(said)
})

/** The reading everything after it is compared against. */
Given('I note where every book stands', async ({ catalogue }) => {
  stood = new Map((await catalogue.books()).map((book) => [book.title, book.current_area_id]))
  expect(stood.size, 'nothing was catalogued to note').toBeGreaterThan(0)
})

/**
 * Somebody walks one book across the room and says so.
 *
 * Through `PATCH /api/books/:id/location`, which is the one route that changes
 * where the catalogue thinks a book is and is what the carrying screens press.
 * Driven rather than pressed because the scenario is about what happens to the
 * books that were **not** carried, and the carrying journey has its own
 * scenarios.
 */
Given('I have already carried {string} to {string}', async (
  { apiUrl, catalogue }, title: string, plank: string,
) => {
  const book = await catalogue.bookByTitle(title)
  expect(book, `no book called "${title}" is catalogued`).toBeTruthy()

  const response = await fetch(`${apiUrl}/api/books/${book!.id}/location`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ areaId: await catalogue.plankId(plank) }),
  })
  expect(response.ok, `recording the carry failed: ${response.status}`).toBe(true)
})

/**
 * The decision, and it is two presses because the second one is a question.
 *
 * The dialog's own button is asked for inside the dialog: it says the same words
 * as the one that opened it, which is deliberate, so a press has to name where
 * it is looking.
 */
When('I leave them where they are', async ({ page }) => {
  await page.getByRole('button', { name: /^Leave (them where they are|it where it is)$/ })
    .last().click()
  await page.locator('.wf-sure').getByRole('button', { name: /^Leave them where they are$/ })
    .click()
  await expect(page.locator('.wf-sure')).toHaveCount(0, { timeout: REDRAW })
})

When('I put them back on the list', async ({ page }) => {
  await page.getByRole('button', { name: 'Put them back on the list' }).click()
  await expect(page.getByText('Left where they are')).toHaveCount(0, { timeout: REDRAW })
})

/**
 * The claim the whole feature is really making, and no screen can make it.
 *
 * Every book, by title, still recorded on the plank it was recorded on. A list
 * that had emptied by moving books, or by clearing where they are, draws
 * exactly the same as one that emptied honestly.
 */
Then('every book should still stand where it stood', async ({ catalogue }) => {
  const now = new Map((await catalogue.books()).map((book) => [book.title, book.current_area_id]))

  expect([...now.entries()].sort(), 'a book is recorded somewhere else than it was')
    .toEqual([...stood.entries()].sort())
})

Then('{string} should still be recorded on {string}', async (
  { catalogue }, title: string, plank: string,
) => {
  const book = await catalogue.bookByTitle(title)
  expect(book, `no book called "${title}" is catalogued`).toBeTruthy()
  expect(book!.current_area_id, `${title} is not on ${plank}`)
    .toBe(await catalogue.plankId(plank))
})

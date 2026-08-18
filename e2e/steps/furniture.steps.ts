/**
 * The furniture itself: putting a piece up, walking to it, and moving a stretch
 * of books off one bookcase and onto another.
 *
 * A file of its own rather than more of `app.steps.ts`, because what these are
 * about is one thing: **what an operation about books does to the shelves**.
 * #391 is the reason they exist. A move deleted a bookcase somebody had put up
 * an hour earlier, along with its four areas and the name written on one of
 * them, and nothing on any screen mentioned it.
 *
 * The pieces are seeded through the real API, the way `catalogue.steps.ts`
 * seeds shelf furniture, because a scenario about what a move does to a piece
 * should spend its presses on the move. Everything the scenario is actually
 * about is driven in the browser, and the closing assertions go to the
 * database, because a bookcase that draws correctly and was deleted underneath
 * is exactly the failure a screen-only test waves through.
 */

import { expect } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { Given, Then, When } from './fixtures.js'
import { stubBookByTitle } from '../support/books.js'

/** How long a press is given to redraw before a claim is made about the screen. */
const REDRAW = 15_000

/**
 * Books that file on the last bookcase in the room.
 *
 * Non-fiction rather than fiction, and that is the whole reason this step is
 * here rather than reusing the one next door: the last range in the room has no
 * range after it to stop at, so a piece standing past its end is the tail of
 * that run. That is what put an empty bookcase inside an operation about
 * somewhere else, and a scenario about it has to be on the last run.
 */
Given('the catalogue already holds these non-fiction books:', async ({ apiUrl }, table: DataTable) => {
  for (const row of table.hashes()) {
    const book = stubBookByTitle(row.title ?? '')
    const response = await fetch(`${apiUrl}/api/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isbn13: book.isbn13,
        isbn10: book.isbn10,
        title: book.title,
        authors: [row.author ?? book.authors[0]],
        publisher: book.publisher,
        published: book.published,
        pages: book.pages,
        genre: 'genre/non-fiction',
        classificationSource: 'auto',
        classificationConfidence: 'high',
      }),
    })
    expect(response.ok, `seeding "${book.title}" failed: ${response.status}`).toBe(true)
  }
})

/**
 * A piece somebody has put up and not filled yet, with the shelves they hung on
 * it and whatever they called them.
 *
 * Through `POST /api/fixtures` and `POST /api/fixtures/:id/areas`, which is what
 * the furniture screen presses. Its number defaults to one past the last piece,
 * which is where somebody describing their room in the order they walk it wants
 * it, and is exactly where the trouble was.
 */
Given(
  'a bookcase called {string} stands after them, with these shelves:',
  async ({ apiUrl }, name: string, table: DataTable) => {
    const made = await fetch(`${apiUrl}/api/fixtures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    expect(made.ok, `putting up "${name}" failed: ${made.status}`).toBe(true)
    const { fixture } = (await made.json()) as { fixture: { id: number } }

    for (const row of table.raw()) {
      const added = await fetch(`${apiUrl}/api/fixtures/${fixture.id}/areas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: row[0] ?? '' }),
      })
      expect(added.ok, `hanging a shelf on "${name}" failed: ${added.status}`).toBe(true)
    }
  },
)

/**
 * The way to the furniture, which is a menu behind the corner icon.
 *
 * Two presses and they are one intention, so they are one step: the corner
 * opens the menu and the row inside it opens the screen. The row is found by
 * the words it always carries rather than by the counts beside it, which change
 * with the room.
 */
When('I open my fixtures', async ({ page }) => {
  if (await page.getByRole('heading', { name: 'Your fixtures' }).isVisible()) return

  /*
   * The library tab rather than wherever the last step left off, because the
   * menu is anchored to the top of the page: opened from a scrolled screen the
   * page dims and nothing appears, which the baseline found and #391 is not
   * about. A fresh screen is at the top of itself.
   */
  await page.locator('button.wf-tab', { hasText: 'Library' }).click()
  await page.getByRole('button', { name: 'Your fixtures', exact: true }).first().click()
  await page.getByText(/pieces?, .*areas?/).first().click()
  await expect(page.getByRole('heading', { name: 'Your fixtures' })).toBeVisible({
    timeout: REDRAW,
  })
})

When('I open the bookcase called {string}', async ({ page }, name: string) => {
  await page.getByText(name, { exact: true }).first().click()
  await expect(page.getByRole('heading', { name, exact: true }).first())
    .toBeVisible({ timeout: REDRAW })
})

/** One shelf of a piece, by the label the furniture screen draws on it. */
When('I open the shelf called {string}', async ({ page }, label: string) => {
  await page.getByText(label, { exact: true }).first().click()
  await expect(page.getByRole('heading', { name: label, exact: true }).first())
    .toBeVisible({ timeout: REDRAW })
})

/** Say where the stretch should live, and ask what it would take to get it there. */
When('I ask to move these books to bookcase {int}', async ({ page }, bookcase: number) => {
  await page.getByRole('button', { name: 'Move these books to another bookcase' }).click()
  await page.getByRole('button', { name: new RegExp(`^Bookcase ${bookcase}\\b`) }).click()
  await page.getByRole('button', { name: 'Show me the plan' }).click()
  await expect(page.getByRole('heading', { name: 'The plan' })).toBeVisible({ timeout: REDRAW })
})

/**
 * What the plan says, line by line, before anybody agrees to it.
 *
 * Substrings rather than whole screens, because the claim is that each of these
 * sentences is somewhere in front of the person, not that the screen contains
 * nothing else.
 */
Then('the plan should say:', async ({ page }, table: DataTable) => {
  for (const row of table.raw()) {
    await expect(page.locator('body'), `the plan does not say "${row[0]}"`)
      .toContainText(row[0] ?? '', { timeout: REDRAW })
  }
})

When('I apply the plan', async ({ page }) => {
  await page.getByRole('button', { name: 'Apply it' }).click()
  await expect(page.getByRole('button', { name: /Go and carry them|Open the list/ }))
    .toBeVisible({ timeout: REDRAW })
})

Then('my fixtures should still include {string}', async ({ page }, name: string) => {
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: REDRAW })
})

/**
 * The row itself, which is the half a screen cannot answer.
 *
 * A piece drawing correctly is not the claim. The claim is that no row was
 * deleted, so the name somebody wrote on a shelf is still somewhere to be found
 * even where the shelf has come off the face of the piece.
 */
Then('the catalogue should still hold a piece called {string}', async ({ catalogue }, name: string) => {
  const areas = await catalogue.areas()
  expect(areas.some((row) => row.fixture_name === name),
    `no piece called "${name}" is left in the catalogue`).toBe(true)
})

Then('the catalogue should still hold an area called {string}', async ({ catalogue }, name: string) => {
  const areas = await catalogue.areas()
  expect(areas.map((row) => row.name), `no area called "${name}" is left`).toContain(name)
})

/**
 * The word on the button that opens what belongs here.
 *
 * #391's second half. On a shelf that files by overflow the card draws the rule
 * that reaches it, and the button used to offer to **change** that rule. What it
 * opened was an editor seeded with the rules written on the shelf, of which
 * there were none, so somebody read a preview of nothing, pressed "Write it
 * down" and was told "Nothing changed about where the books belong".
 */
Then('it should offer to {string}', async ({ page }, word: string) => {
  await expect(page.getByRole('button', { name: word, exact: true }))
    .toBeVisible({ timeout: REDRAW })
})

Then('it should not offer to {string}', async ({ page }, word: string) => {
  await expect(page.getByRole('button', { name: word, exact: true })).toHaveCount(0)
})

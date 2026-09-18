/**
 * The furniture itself: putting a piece up, walking to it, and moving a
 * stretch of books off one bookcase and onto another.
 */

import { expect } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { After, Given, Then, When } from './fixtures.js'
import { stubBookByTitle } from '../support/books.js'

/** How long a press is given to redraw before a claim is made about the screen. */
const REDRAW = 15_000

async function furniture(apiUrl: string): Promise<{ id: number; position: number; name: string }[]> {
  const read = await fetch(`${apiUrl}/api/fixtures`)
  expect(read.ok, `reading the furniture failed: ${read.status}`).toBe(true)
  const { fixtures } = (await read.json()) as {
    fixtures: { id: number; position: number; name: string }[]
  }
  return fixtures
}

/**
 * The piece this scenario put up in front of everything else, or null.
 *
 * `catalogue.reset()` will not take it down: reset keeps every piece a
 * `placement_rule` points at, and a piece given a rule is indistinguishable
 * from those, so it would survive into the next scenario.
 */
let putUpFirst: number | null = null

After(async ({ apiUrl }) => {
  if (putUpFirst === null) return
  const piece = putUpFirst
  putUpFirst = null

  await fetch(`${apiUrl}/api/placement/rule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ about: 'fixture', placeId: piece, rules: [] }),
  })
  await fetch(`${apiUrl}/api/fixtures/${piece}`, { method: 'DELETE' })
})

/** Non-fiction: the last range in the room has no range after it to stop at, so a piece standing past its end is the tail of that run. */
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
 * Nothing renumbers a room on anybody's behalf: the pieces already standing
 * are bumped along one at a time before this one takes number one, since
 * every label on every piece is derived from its number.
 */
Given(
  'a bookcase called {string} stands first, with these shelves:',
  async ({ apiUrl }, name: string, table: DataTable) => {
    const made = await fetch(`${apiUrl}/api/fixtures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    expect(made.ok, `putting up "${name}" failed: ${made.status}`).toBe(true)
    const { fixture } = (await made.json()) as { fixture: { id: number } }
    putUpFirst = fixture.id

    const standing = await furniture(apiUrl)
    for (const piece of standing) {
      if (piece.id === fixture.id) continue
      const bumped = await fetch(`${apiUrl}/api/fixtures/${piece.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: piece.position + 1 }),
      })
      expect(bumped.ok, `moving piece ${piece.position} along failed`).toBe(true)
    }

    const first = await fetch(`${apiUrl}/api/fixtures/${fixture.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: 1 }),
    })
    expect(first.ok, `standing "${name}" first failed: ${first.status}`).toBe(true)

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

Given('{string} is for non-fiction as well', async ({ apiUrl }, name: string) => {
  const piece = (await furniture(apiUrl)).find((one) => one.name === name)
  expect(piece, `no piece called "${name}" is standing`).toBeTruthy()

  const wrote = await fetch(`${apiUrl}/api/placement/rule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      about: 'fixture',
      placeId: piece!.id,
      rules: [{ conditions: [{ operator: 'is', tag: 'genre/non-fiction' }] }],
    }),
  })
  expect(wrote.ok, `writing a rule on "${name}" failed: ${wrote.status}`).toBe(true)
})

/** The row is found by the words it always carries rather than the counts beside it, which change with the room. */
When('I open my fixtures', async ({ page }) => {
  if (await page.getByRole('heading', { name: 'Your fixtures' }).isVisible()) return

  /* The library tab: the menu is anchored to the top of the page, and opened from a scrolled screen it dims with nothing appearing. */
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

When('I open the shelf called {string}', async ({ page }, label: string) => {
  await page.getByText(label, { exact: true }).first().click()
  await expect(page.getByRole('heading', { name: label, exact: true }).first())
    .toBeVisible({ timeout: REDRAW })
})

/**
 * The screen sets the picker's default from a read of the shelves that lands
 * after the screen is drawn, so a press that gets in before that read is
 * quietly overwritten by it. Waiting on `aria-pressed` waits for the state
 * the press was actually for.
 */
When('I ask to move these books to bookcase {int}', async ({ page }, bookcase: number) => {
  await page.getByRole('button', { name: 'Move these books to another bookcase' }).click()

  const chosen = page.getByRole('button', { name: new RegExp(`^Bookcase ${bookcase}\\b`) })
  await expect(chosen, `bookcase ${bookcase} is not offered`).toBeVisible({ timeout: REDRAW })
  await chosen.click()
  await expect(chosen, `bookcase ${bookcase} did not stay chosen`)
    .toHaveAttribute('aria-pressed', 'true', { timeout: REDRAW })

  await page.getByRole('button', { name: 'Show me the plan' }).click()
  await expect(page.getByRole('heading', { name: 'The plan' })).toBeVisible({ timeout: REDRAW })
})

Then('the plan should say:', async ({ page }, table: DataTable) => {
  for (const row of table.raw()) {
    await expect(page.locator('body'), `the plan does not say "${row[0]}"`)
      .toContainText(row[0] ?? '', { timeout: REDRAW })
  }
})

Then('the screen should say:', async ({ page }, table: DataTable) => {
  for (const row of table.raw()) {
    await expect(page.locator('body'), `the screen does not say "${row[0]}"`)
      .toContainText(row[0] ?? '', { timeout: REDRAW })
  }
})

/** What is printed down a spine is the filing name; what a spine is called (its accessible name) is the book. This checks the latter. */
Then('the row of books should name:', async ({ page }, table: DataTable) => {
  const board = page.locator('.wf-shelf__board')
  await expect(board.first()).toBeVisible({ timeout: REDRAW })

  for (const row of table.raw()) {
    await expect(
      board.getByRole('button', { name: new RegExp(`^${row[0]}\\b`) }),
      `no book called "${row[0]}" is standing on the board`,
    ).toBeVisible({ timeout: REDRAW })
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

Then('the catalogue should still hold a piece called {string}', async ({ catalogue }, name: string) => {
  const areas = await catalogue.areas()
  expect(areas.some((row) => row.fixture_name === name),
    `no piece called "${name}" is left in the catalogue`).toBe(true)
})

Then('the catalogue should still hold an area called {string}', async ({ catalogue }, name: string) => {
  const areas = await catalogue.areas()
  expect(areas.map((row) => row.name), `no area called "${name}" is left`).toContain(name)
})

Then('it should offer to {string}', async ({ page }, word: string) => {
  await expect(page.getByRole('button', { name: word, exact: true }))
    .toBeVisible({ timeout: REDRAW })
})

Then('it should not offer to {string}', async ({ page }, word: string) => {
  await expect(page.getByRole('button', { name: word, exact: true })).toHaveCount(0)
})

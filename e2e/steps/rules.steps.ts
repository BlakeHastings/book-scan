/**
 * Saying what belongs on a piece of furniture, on the piece's own screen.
 */

import { expect } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { After, Given, Then, When } from './fixtures.js'

const REDRAW = 15_000

interface Line { operator: string; tag: string }
interface Taken { about: 'area' | 'fixture'; placeId: number; rules: { conditions: Line[] }[] }

/**
 * The rules this scenario took off the room's own pieces, put back afterwards
 * so the next scenario's room is the one `catalogue.reset()` expects. Put back
 * in the order they were read, which keeps fiction tried before non-fiction.
 */
let takenOff: Taken[] = []
let piecesWritten: number[] = []

async function json<T>(response: Response, what: string): Promise<T> {
  expect(response.ok, `${what} failed: ${response.status}`).toBe(true)
  return (await response.json()) as T
}

async function writeRules(apiUrl: string, place: Taken): Promise<void> {
  await json(await fetch(`${apiUrl}/api/placement/rule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      about: place.about,
      placeId: place.placeId,
      rules: place.rules.map((rule) => ({ id: null, conditions: rule.conditions })),
    }),
  }), `writing the rules on ${place.about} ${place.placeId}`)
}

After(async ({ apiUrl }) => {
  const written = piecesWritten
  const taken = takenOff
  piecesWritten = []
  takenOff = []

  // Hall's rules come off first, or the ones put back would lose every tie to them.
  for (const piece of written) {
    await writeRules(apiUrl, { about: 'fixture', placeId: piece, rules: [] })
  }
  for (const place of taken) await writeRules(apiUrl, place)
})

Given('no other piece says what belongs on it', async ({ apiUrl }) => {
  const { fixtures } = await json<{
    fixtures: { id: number; name: string; own: unknown[]; areas: { id: number; own: unknown[] }[] }[]
  }>(await fetch(`${apiUrl}/api/fixtures`), 'reading the furniture')

  const places: { about: 'area' | 'fixture'; placeId: number }[] = []
  for (const piece of fixtures) {
    if (piece.own.length > 0) places.push({ about: 'fixture', placeId: piece.id })
    for (const area of piece.areas) {
      if (area.own.length > 0) places.push({ about: 'area', placeId: area.id })
    }
  }

  for (const place of places) {
    const { rules } = await json<{ rules: { conditions: Line[] }[] }>(
      await fetch(`${apiUrl}/api/placement/rule?about=${place.about}&placeId=${place.placeId}`),
      'reading the rules on a place',
    )
    takenOff.push({ ...place, rules })
    await writeRules(apiUrl, { ...place, rules: [] })
  }

  const hall = fixtures.find((piece) => piece.name === 'Hall')
  if (hall) piecesWritten.push(hall.id)
})

/** The first rule on the place, or a line on the rule already open. */
When('I say {string} belongs here', async ({ page }, tag: string) => {
  const say = page.getByRole('button', { name: 'Say what belongs here', exact: true })
  if (await say.isVisible()) await say.click()
  await page.getByRole('button', { name: 'Allow something here', exact: true }).click()
  await pick(page, tag)
})

/** Another rule on the same place, which is "or". */
When('I say {string} belongs here as well', async ({ page }, tag: string) => {
  await page.getByRole('button', { name: 'Allow something else as well', exact: true }).click()
  await pick(page, tag)
})

/**
 * A tag the collection made from its slug reads "Non fiction" where one a
 * person named reads "Non-fiction", so the two spellings are one word here.
 */
const spelt = (tag: string): string => tag.replace(/-/g, '[- ]')

async function pick(page: import('@playwright/test').Page, tag: string): Promise<void> {
  const offered = page.getByRole('button', { name: new RegExp(`^${spelt(tag)} · \\d+$`) })
  await expect(offered, `"${tag}" is not offered`).toBeVisible({ timeout: REDRAW })
  await offered.click()
  await expect(page.locator('.wf-tag', { hasText: new RegExp(`^${spelt(tag)}$`) }).first())
    .toBeVisible({ timeout: REDRAW })
}

When('I ask to add a tag to that rule', async ({ page }) => {
  await page.getByRole('button', { name: 'Add a tag', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: 'Which tag has to be on a book' }))
    .toBeVisible({ timeout: REDRAW })
})

Then('it should not offer the tag {string}', async ({ page }, tag: string) => {
  await expect(page.getByRole('button', { name: new RegExp(`^${spelt(tag)} · \\d+$`) }))
    .toHaveCount(0)
})

When('I ask what would move', async ({ page }) => {
  await page.getByRole('button', { name: 'Show me what would move', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Write it down', exact: true }))
    .toBeVisible({ timeout: REDRAW })
})

When('I press {string}', async ({ page }, word: string) => {
  await page.getByRole('button', { name: word, exact: true }).first().click()
})

When('I write it down', async ({ page }) => {
  await page.getByRole('button', { name: 'Write it down', exact: true }).click()
  await expect(page.getByRole('button', { name: /Go and carry them|Open the list/ }))
    .toBeVisible({ timeout: REDRAW })
})

Then('{string} should hold these rules:', async ({ catalogue }, piece: string, table: DataTable) => {
  const wanted = table.raw().map((row) => [row[0] ?? ''])
  await expect.poll(() => catalogue.rulesOnPiece(piece), { timeout: REDRAW })
    .toEqual(wanted)
})

Then('{string} should hold no rule', async ({ catalogue }, piece: string) => {
  expect(await catalogue.rulesOnPiece(piece)).toEqual([])
})

Then('every book should belong on {string}', async ({ catalogue }, piece: string) => {
  const books = await catalogue.assignedPieces()
  expect(new Set(books.map((book) => book.genre)))
    .toEqual(new Set(['genre/fiction', 'genre/non-fiction']))
  for (const book of books) {
    expect(book.piece, `"${book.title}" (${book.genre}) belongs on "${book.piece}"`).toBe(piece)
  }
})

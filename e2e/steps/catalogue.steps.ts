/**
 * Setting a scenario up, and checking what the app wrote down afterwards.
 *
 * Nothing here touches the browser. Shelf furniture is seeded through the real
 * API rather than by photographing two more books, because a scenario about
 * placement should spend its time on placement; and the closing assertions go
 * to SQLite, because a book that renders correctly and persisted incorrectly
 * is exactly the failure a screen-only test waves through.
 */

import { expect } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { Given, Then } from './fixtures.js'
import { BOOK_IN_HAND, stubBookByTitle } from '../support/books.js'
import type { BookRow } from '../support/database.js'

Given('the catalogue is empty', async ({ catalogue }) => {
  catalogue.reset()
  expect(catalogue.books(), 'the catalogue should have been emptied').toHaveLength(0)
})

/**
 * A statement of fact about the stub, and a guard.
 *
 * The stub answers for every book this suite knows about, so there is nothing
 * to switch on. Naming the book in the feature file is still worth it: it says
 * out loud that the lookup is answered locally, which is why the suite does
 * not care whether Open Library is up.
 */
Given('the catalogue service knows about {string}', async ({}, title: string) => {
  expect(stubBookByTitle(title).isbn13).not.toBe('')
})

/**
 * Books already on the shelves.
 *
 * Written through POST /api/books, the same route the app itself uses, so the
 * filing name and sort key are derived by the code under test rather than
 * invented here. A test that inserted rows straight into SQLite could seed a
 * shelf the application could never have produced.
 */
Given('the catalogue already holds:', async ({ apiUrl }, table: DataTable) => {
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
        isFiction: true,
        classificationSource: 'auto',
        classificationConfidence: 'high',
      }),
    })
    expect(response.ok, `seeding "${book.title}" failed: ${response.status}`).toBe(true)
  }
})

/**
 * A book already down off the shelf when the scenario starts.
 *
 * Through the real checkout route, which takes an id and a direction and no
 * photograph, because that is the only thing in the app allowed to change this
 * state and a scenario that wrote the column directly would prove nothing
 * about it.
 */
Given('{string} is off the bookcase', async ({ apiUrl, catalogue }, title: string) => {
  const book = catalogue.bookByTitle(title)
  expect(book, `no book called "${title}" to take off the bookcase`).toBeTruthy()

  const response = await fetch(`${apiUrl}/api/books/${book?.id}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ out: true }),
  })
  expect(response.ok, `checking "${title}" out failed: ${response.status}`).toBe(true)
  expect((await response.json()).outcome).toBe('checked-out')
})

/**
 * Where the book physically is, according to the database rather than the
 * screen. This is what makes "scanning writes nothing" a claim worth making:
 * the page can say whatever it likes, the column is the fact.
 */
Then(
  'the catalogue should record {string} as {word} the bookcase',
  async ({ catalogue }, title: string, where: string) => {
    const book = catalogue.bookByTitle(title)
    expect(book, `no book called "${title}" in the database`).toBeTruthy()

    if (where === 'off') {
      expect(book?.checked_out_at, `"${title}" is still on the bookcase`).not.toBeNull()
    } else {
      expect(book?.checked_out_at, `"${title}" is still off the bookcase`).toBeNull()
    }
  },
)

/**
 * The camera is a launch argument, not something a step can change, so this
 * checks that the feature is talking about the book Chromium was actually
 * given rather than silently testing a different one.
 */
Given('the camera is pointed at the back cover of {string}', async ({}, title: string) => {
  expect(
    title,
    'the camera file is chosen when the browser launches, from BOOK_IN_HAND in ' +
    'support/books.ts. A scenario needing a different book needs its own ' +
    'Playwright project with its own --use-file-for-fake-video-capture.',
  ).toBe(BOOK_IN_HAND.title)
})

Then(
  'the catalogue should hold {string} recorded as:',
  async ({ catalogue }, title: string, table: DataTable) => {
    const book = catalogue.bookByTitle(title)
    expect(book, `no book called "${title}" in the database`).toBeTruthy()

    const expected = table.rowsHash()
    const columns = book as unknown as Record<string, unknown>
    const actual: Record<string, string> = {}
    for (const column of Object.keys(expected)) {
      actual[column] = String(columns[column] ?? '')
    }
    expect(actual).toEqual(expected)
  },
)

Then('the photograph of {string} should be on disk', async ({ catalogue }, title: string) => {
  const book = catalogue.bookByTitle(title) as BookRow
  expect(book?.back_image, 'the book kept no back cover photograph').toBeTruthy()

  const file = join(catalogue.coverDir, book.back_image)
  expect(existsSync(file), `${file} is missing`).toBe(true)
})

Then('the catalogue should be filed in this order:', async ({ catalogue }, table: DataTable) => {
  const wanted = table.raw().map((row) => row[0])
  expect(catalogue.books().map((book) => book.title)).toEqual(wanted)
})

Then(
  'a new area should be recorded for fiction, starting at {string}',
  async ({ catalogue }, title: string) => {
    const moved = catalogue.bookByTitle(title)
    expect(moved, `no book called "${title}"`).toBeTruthy()

    const separators = catalogue.separators('fiction')
    expect(separators, 'no shelf boundary was written').toHaveLength(1)
    expect(separators[0]?.kind).toBe('area')
    // A boundary is recorded as the sort key of the first book on the new
    // shelf. This is what makes the drawn shelf and the real shelf agree.
    expect(separators[0]?.starts_at).toBe(moved?.sort_key)
  },
)

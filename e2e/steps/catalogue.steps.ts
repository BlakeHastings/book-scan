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

import { Given, Then, When } from './fixtures.js'
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
 * Holds one lookup open, so a scenario can assert on what the app does while
 * a relookup is genuinely still running rather than reasoning about a race it
 * cannot see or control the timing of otherwise.
 *
 * Talks to the stub's own control endpoint (support/catalogue-stub.ts), not
 * the app: the delay is armed before the ISBN change that triggers the
 * lookup, so it has to already be in place when the request arrives.
 */
When(
  'I arm a slow lookup of {string} taking {int}ms',
  async ({ stubUrl }, title: string, ms: number) => {
    const book = stubBookByTitle(title)
    const response = await fetch(`${stubUrl}/__control/delay-next-lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbn13: book.isbn13, ms }),
    })
    expect(response.ok, `arming the stub delay failed: ${response.status}`).toBe(true)
  },
)

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
 * Somebody standing in front of a plank saying it will not take another book,
 * and then carrying the book it gave up.
 *
 * Through the real overflow route, and then through the location route for the
 * book it displaced, because those are two statements and the app makes both.
 * Seeding only the first would leave the scenario starting with a book already
 * reported as misfiled, and "nothing should need attention" later would then
 * be testing the seed rather than the move.
 */
async function fillUp(apiUrl: string, label: string, kind: 'area' | 'shelf') {
  const response = await fetch(`${apiUrl}/api/shelves/overflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ range: 'fiction', label, kind }),
  })
  expect(response.ok, `filling ${label} failed: ${response.status}`).toBe(true)

  const { step } = (await response.json()) as {
    step: { id: number; to: string } | null
  }
  expect(step, `${label} had no book to give up`).toBeTruthy()

  const recorded = await fetch(`${apiUrl}/api/books/${step!.id}/location`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: step!.to }),
  })
  expect(recorded.ok, `recording the displaced book failed: ${recorded.status}`)
    .toBe(true)
}

/** A plank with a second one after it. */
Given(
  '{string} filled up, so its last book started a new area',
  async ({ apiUrl }, label: string) => {
    await fillUp(apiUrl, label, 'area')
  },
)

/**
 * Several planks with books on each, arrived at one answer at a time.
 *
 * A cascade that has to go deep and then descend AGAIN needs planks past the
 * one being filled that still have a book to give up, and there is only one
 * way for a plank to come into existence: somebody said the one before it was
 * full. So the arrangement is spelled as the sequence of times that happened,
 * which is both what the room looks like and how it got that way.
 */
Given('the areas filled up in this order:', async ({ apiUrl }, table: DataTable) => {
  for (const row of table.raw()) await fillUp(apiUrl, row[0] ?? '', 'area')
})

/**
 * Two bookcases, reached the way the app reaches them.
 *
 * Twice, because one answer only creates the second bookcase and moves one
 * book on to it. A second answer puts another book there, which is what leaves
 * a bookcase with a first book that has something after it, and that is the
 * arrangement the move under test needs.
 */
Given(
  '{string} filled up twice, so its last two books are on bookcase 2',
  async ({ apiUrl }, label: string) => {
    for (let round = 1; round <= 2; round += 1) {
      const response = await fetch(`${apiUrl}/api/shelves/overflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range: 'fiction', label, kind: 'shelf' }),
      })
      expect(response.ok, `filling ${label} (round ${round}) failed: ${response.status}`)
        .toBe(true)

      const { step } = (await response.json()) as {
        step: { id: number; to: string } | null
      }
      expect(step, `${label} had no book to give up on round ${round}`).toBeTruthy()

      const recorded = await fetch(`${apiUrl}/api/books/${step!.id}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: step!.to }),
      })
      expect(recorded.ok, `recording the displaced book failed: ${recorded.status}`)
        .toBe(true)
    }
  },
)

/**
 * Where the shelves themselves put a book, which is not the same question as
 * where the catalogue records it.
 *
 * This one is derived from the boundaries, so it is what somebody looking at
 * the drawing sees. Asserting it mid-cascade is how "nothing moved" is
 * checked: a proposed step used to shift the boundary immediately, and the
 * book vanished off the plank the person was still standing at (#111).
 */
Then(
  'the bookcase should still show {string} on {string}',
  async ({ apiUrl }, title: string, label: string) => {
    const response = await fetch(`${apiUrl}/api/shelves?range=fiction`)
    expect(response.ok, `reading the shelves failed: ${response.status}`).toBe(true)

    const { groups } = (await response.json()) as {
      groups: { label: string; books: { book: { title: string } }[] }[]
    }
    const on = groups.find((group) =>
      group.books.some((entry) => entry.book.title === title))
    expect(on?.label, `"${title}" is drawn on ${on?.label ?? 'no plank at all'}`)
      .toBe(label)
  },
)

/** The id of a seeded book, read back through the route the client reads. */
async function bookIdByTitle(apiUrl: string, title: string): Promise<number> {
  const response = await fetch(`${apiUrl}/api/books?range=fiction`)
  expect(response.ok, `listing fiction failed: ${response.status}`).toBe(true)

  const { books } = (await response.json()) as { books: { id: number; title: string }[] }
  const found = books.find((book) => book.title === title)
  expect(found, `no book called "${title}" is catalogued`).toBeTruthy()
  return found!.id
}

/**
 * Where the catalogue last saw a book, set through the one route that changes
 * a position.
 *
 * A location and the order disagreeing is not an exotic state: it is what the
 * library's "needs attention" list is for, and it is what a book is in the
 * moment somebody moves it without saying so. Seeding it here gets a scenario
 * to that state without acting out the move that caused it.
 */
Given('{string} was last recorded at {string}', async ({ apiUrl }, title: string, label: string) => {
  const id = await bookIdByTitle(apiUrl, title)
  const response = await fetch(`${apiUrl}/api/books/${id}/location`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: label }),
  })
  expect(response.ok, `recording ${title} at ${label} failed: ${response.status}`).toBe(true)
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

/**
 * Enough books on one plank that the drawn row is wider than the phone.
 *
 * Where a row comes to rest is only a question once it is longer than the
 * screen, and the six books this suite stubs draw a row that fits with room
 * to spare. These are padding and read as padding: the only thing that matters
 * about each of them is which side of the book in hand it files, which is the
 * whole reason it is here.
 *
 * Written through POST /api/books like the rest of the furniture, so the
 * filing names and sort keys come from the code under test rather than from
 * this file.
 */
const PADDING_BEFORE = [
  'Achebe, Chinua', 'Amis, Kingsley', 'Baldwin, James', 'Brontë, Charlotte',
  'Calvino, Italo', 'Chandler, Raymond', 'Conrad, Joseph', 'Dickens, Charles',
  'Eliot, George', 'Forster, E. M.', 'Greene, Graham', 'Hardy, Thomas',
]
const PADDING_AFTER = [
  'Ishiguro, Kazuo', 'Joyce, James', 'Kafka, Franz', 'Lessing, Doris',
  'Morrison, Toni', 'Nabokov, Vladimir', 'Orwell, George', 'Pratchett, Terry',
  'Rushdie, Salman', 'Steinbeck, John', 'Tolstoy, Leo', 'Woolf, Virginia',
]

async function pad(apiUrl: string, count: number, filings: string[]) {
  expect(
    count,
    `only ${filings.length} padding names are defined in catalogue.steps.ts`,
  ).toBeLessThanOrEqual(filings.length)

  for (let i = 0; i < count; i += 1) {
    const filing = filings[i]!
    const response = await fetch(`${apiUrl}/api/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Shelf filler ${i + 1}`,
        authors: [filing],
        authorFilingOverride: filing,
        isFiction: true,
        classificationSource: 'manual',
        classificationConfidence: 'high',
      }),
    })
    expect(response.ok, `padding with "${filing}" failed: ${response.status}`).toBe(true)
  }
}

Given(
  '{int} more books are on the shelves, all filing before {string}',
  async ({ apiUrl }, count: number, title: string) => {
    expect(title, 'the padding is chosen against the book in hand').toBe(BOOK_IN_HAND.title)
    await pad(apiUrl, count, PADDING_BEFORE)
  },
)

Given(
  '{int} more books are on the shelves, all filing after {string}',
  async ({ apiUrl }, count: number, title: string) => {
    expect(title, 'the padding is chosen against the book in hand').toBe(BOOK_IN_HAND.title)
    await pad(apiUrl, count, PADDING_AFTER)
  },
)

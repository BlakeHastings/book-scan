/** Setting a scenario up, and checking what the app wrote down afterwards. Nothing here touches the browser. */

import { expect } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { After, Given, Then, When } from './fixtures.js'
import { BOOK_IN_HAND, stubBookByTitle } from '../support/books.js'
import type { BookRow, Catalogue, PlankRow } from '../support/database.js'

Given('the catalogue is empty', async ({ catalogue }) => {
  await catalogue.reset()
  expect(await catalogue.books(), 'the catalogue should have been emptied').toHaveLength(0)
})

Given('the catalogue service knows about {string}', async ({}, title: string) => {
  expect(stubBookByTitle(title).isbn13).not.toBe('')
})

/** Armed on the stub's control endpoint, like the slow lookup above, because it has to be in place before the barcode is read. */
Given('no source can name {string}', async ({ stubUrl }, title: string) => {
  const book = stubBookByTitle(title)
  const response = await fetch(`${stubUrl}/__control/answer-for-nobody`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isbn13: book.isbn13 }),
  })
  expect(response.ok, `silencing "${title}" failed: ${response.status}`).toBe(true)
})

/**
 * Give every book its name back at the end of every scenario.
 *
 * The stub is started once for the whole run, so a book silenced above stays
 * silenced for every scenario after it unless this runs.
 */
After(async ({ stubUrl }) => {
  await fetch(`${stubUrl}/__control/answer-for-everybody`, { method: 'POST' })
})

/**
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
        genre: 'genre/fiction',
        classificationSource: 'auto',
        classificationConfidence: 'high',
      }),
    })
    expect(response.ok, `seeding "${book.title}" failed: ${response.status}`).toBe(true)
  }
})

/**
 * Calls the overflow route, then the location route for the book it displaced.
 * Seeding only the first would leave the scenario starting with a book already
 * reported as misfiled.
 */
async function fillUp(
  apiUrl: string,
  catalogue: Catalogue,
  label: string,
  kind: 'area' | 'shelf',
) {
  const response = await fetch(`${apiUrl}/api/shelves/overflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The plank id, not an address: an address is a rendering the route would have to read back.
    body: JSON.stringify({ range: 'fiction', areaId: await catalogue.plankId(label), kind }),
  })
  expect(response.ok, `filling ${label} failed: ${response.status}`).toBe(true)

  const { step } = (await response.json()) as {
    step: { id: number; toAreaId: number | null } | null
  }
  expect(step, `${label} had no book to give up`).toBeTruthy()

  const recorded = await fetch(`${apiUrl}/api/books/${step!.id}/location`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ areaId: step!.toAreaId }),
  })
  expect(recorded.ok, `recording the displaced book failed: ${recorded.status}`)
    .toBe(true)
}

/** Moves nothing: every area keeps its id, and only the piece's label changes from a number to a phrase. */
Given('bookcase {int} is called {string}', async ({ catalogue }, position: number, name: string) => {
  await catalogue.nameFixture(position, name)
})

Given(
  '{string} filled up, so its last book started a new area',
  async ({ apiUrl, catalogue }, label: string) => {
    await fillUp(apiUrl, catalogue, label, 'area')
  },
)

/** Unlike `fillUp` above, this deliberately does not record where the displaced book went: the boundary has moved but the book has not. */
Given(
  '{string} filled up and nobody carried the book',
  async ({ apiUrl, catalogue }, label: string) => {
    const response = await fetch(`${apiUrl}/api/shelves/overflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        range: 'fiction', areaId: await catalogue.plankId(label), kind: 'area',
      }),
    })
    expect(response.ok, `filling ${label} failed: ${response.status}`).toBe(true)

    const { step } = (await response.json()) as { step: { id: number } | null }
    expect(step, `${label} had no book to give up`).toBeTruthy()
  },
)

/** There is only one way for a plank to come into existence: somebody said the one before it was full, so the arrangement is spelled as that sequence. */
Given('the areas filled up in this order:', async ({ apiUrl, catalogue }, table: DataTable) => {
  for (const row of table.raw()) await fillUp(apiUrl, catalogue, row[0] ?? '', 'area')
})

Given(
  '{string} filled up twice, so its last two books are on bookcase 2',
  async ({ apiUrl, catalogue }, label: string) => {
    for (let round = 1; round <= 2; round += 1) {
      const response = await fetch(`${apiUrl}/api/shelves/overflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          range: 'fiction', areaId: await catalogue.plankId(label), kind: 'shelf',
        }),
      })
      expect(response.ok, `filling ${label} (round ${round}) failed: ${response.status}`)
        .toBe(true)

      const { step } = (await response.json()) as {
        step: { id: number; toAreaId: number | null } | null
      }
      expect(step, `${label} had no book to give up on round ${round}`).toBeTruthy()

      const recorded = await fetch(`${apiUrl}/api/books/${step!.id}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areaId: step!.toAreaId }),
      })
      expect(recorded.ok, `recording the displaced book failed: ${recorded.status}`)
        .toBe(true)
    }
  },
)

/** Where the shelves themselves put a book, which is not the same question as where the catalogue records it. */
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

async function bookIdByTitle(apiUrl: string, title: string): Promise<number> {
  const response = await fetch(`${apiUrl}/api/books?range=fiction`)
  expect(response.ok, `listing fiction failed: ${response.status}`).toBe(true)

  const { books } = (await response.json()) as { books: { id: number; title: string }[] }
  const found = books.find((book) => book.title === title)
  expect(found, `no book called "${title}" is catalogued`).toBeTruthy()
  return found!.id
}

/**
 * A location and the order disagreeing is not an exotic state: it is what the
 * library's "needs attention" list is for.
 */
Given(
  '{string} was last recorded at {string}',
  async ({ apiUrl, catalogue }, title: string, label: string) => {
    const id = await bookIdByTitle(apiUrl, title)

    // The plank first, because a recorded location names an area the app will
    // not invent. `standUpPlank` stands it past the end of every run, so no
    // book moves on to it and the drawing is unchanged.
    const plank = /^[Ss]?(\d+)([A-Za-z]*)$/.exec(label)
    expect(plank, `"${label}" is not a plank this suite can stand up`).toBeTruthy()
    await catalogue.standUpPlank(Number(plank![1]), plankIndex(plank![2]!))

    const response = await fetch(`${apiUrl}/api/books/${id}/location`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: label }),
    })
    expect(response.ok, `recording ${title} at ${label} failed: ${response.status}`).toBe(true)
  },
)

Given('{string} is off the bookcase', async ({ apiUrl, catalogue }, title: string) => {
  const book = await catalogue.bookByTitle(title)
  expect(book, `no book called "${title}" to take off the bookcase`).toBeTruthy()

  const response = await fetch(`${apiUrl}/api/books/${book?.id}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ out: true }),
  })
  expect(response.ok, `checking "${title}" out failed: ${response.status}`).toBe(true)
  expect((await response.json()).outcome).toBe('checked-out')
})

/** Reads `state`, not `checked_out_at`: the wire's `checked_out_at` is derived from `state` and the ledger, not stored separately. */
Then(
  'the catalogue should record {string} as {word} the bookcase',
  async ({ catalogue }, title: string, where: string) => {
    const book = await catalogue.bookByTitle(title)
    expect(book, `no book called "${title}" in the database`).toBeTruthy()

    expect(book?.state, `"${title}" is ${where === 'off' ? 'still on' : 'still off'} the bookcase`)
      .toBe(where === 'off' ? 'checked_out' : 'shelved')
  },
)

/** The camera is a launch argument, not something a step can change, so this checks the feature names the book Chromium was actually given. */
Given('the camera is pointed at the back cover of {string}', async ({}, title: string) => {
  expect(
    title,
    'the camera file is chosen when the browser launches, from BOOK_IN_HAND in ' +
    'support/books.ts. A scenario needing a different book needs its own ' +
    'Playwright project with its own --use-file-for-fake-video-capture.',
  ).toBe(BOOK_IN_HAND.title)
})

/**
 * A, B, ... Z, AA: a plank's ordinal written the way a location writes it.
 * Bijective base 26, so 0 is A, 25 is Z and 26 is AA.
 *
 * A copy of `areaLabel` in web/shared/layout.ts: this package is a separate
 * npm tree, so reaching into the app would give the suite a build dependency
 * on the thing it is testing.
 */
function areaLetters(index: number): string {
  let n = index
  let letters = ''
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return letters
}

/** `areaLetters` read backwards. */
function plankIndex(letters: string): number {
  expect(letters, 'a plank is named by its letters, so "S4" names none').not.toBe('')

  let n = 0
  for (const character of letters.toUpperCase()) n = n * 26 + (character.charCodeAt(0) - 64)
  return n - 1
}

/**
 * The label is derived here from `current_area_id` and its fixture, following
 * the same rule `labelFor` in web/domain/placement/geography.ts applies,
 * rather than read back off `GET /api/books`: this suite exists to check what
 * reached the database, and asking the app where it thinks the book is would
 * only get the app to agree with itself.
 */
function locationOf(areas: readonly PlankRow[], book: BookRow): string {
  if (book.current_area_id === null) return ''

  const area = areas.find((one) => one.id === book.current_area_id)
  expect(area, `"${book.title}" is on area ${book.current_area_id}, which no fixture holds`)
    .toBeTruthy()

  // A negative position is a plank that has been taken out, stored as
  // -(position + 1) so it still names the plank it was. `faceOf` in
  // web/infrastructure/shelving/areas.ts applies the same reading.
  const position = area!.position < 0 ? -area!.position - 1 : area!.position

  const left = area!.fixture_name || String(area!.fixture_position)
  const right = area!.name || areaLetters(position)
  return area!.fixture_name || area!.name ? `${left} · ${right}` : `${left}${right}`
}

Then(
  'the catalogue should hold {string} recorded as:',
  async ({ catalogue }, title: string, table: DataTable) => {
    const book = await catalogue.bookByTitle(title)
    expect(book, `no book called "${title}" in the database`).toBeTruthy()

    const expected = table.rowsHash()
    const areas = 'location' in expected ? await catalogue.areas() : []

    const columns = book as unknown as Record<string, unknown>
    const actual: Record<string, string> = {}
    for (const column of Object.keys(expected)) {
      // `location` is not a column: it is answered from the placement instead.
      actual[column] = column === 'location'
        ? locationOf(areas, book!)
        : String(columns[column] ?? '')
    }
    expect(actual).toEqual(expected)
  },
)

/** `edge_image` is the newest spine, so a second spine attached to the book takes the first one's place in it. */
function photographsOf(book: BookRow): { spine: string; read: string } {
  return { spine: book.edge_image, read: book.analysed }
}

/** Reading the photographs is a background pass, and it takes seconds. */
const READING_TIMEOUT = 90 * 1000

Then('all three photographs should have been read', async ({ catalogue }) => {
  await expect
    .poll(
      async () => {
        const [capture] = await catalogue.captures()
        return (capture?.analysed.split(',').filter(Boolean) ?? []).sort().join(',')
      },
      {
        message: 'the queue never finished reading all three photographs',
        timeout: READING_TIMEOUT,
      },
    )
    .toBe('back,edge,front')
})

/** Module scope, which is per worker and therefore per scenario: playwright-bdd gives each worker its own module instance. */
let noted: { spine: string; read: string } | null = null

let photographsThen = 0

When('I note the photographs of {string}', async ({ catalogue }, title: string) => {
  const book = await catalogue.bookByTitle(title)
  expect(book, `no book called "${title}" is catalogued`).toBeTruthy()

  noted = photographsOf(book!)
  expect(noted.spine, `"${title}" has no spine photograph to lose`).not.toBe('')
  expect(noted.read, `"${title}" has no reading to lose`).not.toBe('')

  photographsThen = await catalogue.photographCount()
})

/**
 * Waits on any photograph landing, not the correct one, since it must finish
 * whether the shutter attached it to the right book or the wrong one.
 */
Then('the photograph should have reached a book', async ({ catalogue }) => {
  await expect
    .poll(() => catalogue.photographCount(), {
      message: 'the photograph never reached the database',
      timeout: READING_TIMEOUT,
    })
    .toBe(photographsThen + 1)
})

/** Asserted here rather than on the screen: the screen says "reading" regardless of which book the photograph actually landed on. */
Then('the photographs of {string} should be untouched', async ({ catalogue }, title: string) => {
  expect(noted, 'nothing was noted to compare against').toBeTruthy()

  const book = await catalogue.bookByTitle(title)
  expect(book, `no book called "${title}" is catalogued`).toBeTruthy()

  expect(photographsOf(book!), `something has been written on to "${title}"`).toEqual(noted)
})

Then('the photograph of {string} should be on disk', async ({ catalogue }, title: string) => {
  const book = await catalogue.bookByTitle(title) as BookRow
  expect(book?.back_image, 'the book kept no back cover photograph').toBeTruthy()

  const file = join(catalogue.coverDir, book.back_image)
  expect(existsSync(file), `${file} is missing`).toBe(true)
})

Then('the catalogue should be filed in this order:', async ({ catalogue }, table: DataTable) => {
  const wanted = table.raw().map((row) => row[0])
  expect((await catalogue.books()).map((book) => book.title)).toEqual(wanted)
})

/**
 * A boundary is anchored to the sort key of the first book on the new plank,
 * so naming that book says which boundary this is.
 *
 * Listed in anchor order, the order somebody walking the shelves meets them,
 * not the `position` column: position records creation order, and a bookcase
 * break made after the plank break beyond it sits earlier on the furniture
 * than it does in the table.
 */
Then(
  'the boundaries recorded for fiction should be:',
  async ({ catalogue }, table: DataTable) => {
    const books = await catalogue.books()
    const actual = [...await catalogue.boundaries('fiction')]
      .sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0))
      .map((boundary) => ({
        kind: boundary.kind,
        'starts at': books.find((book) => book.sort_key === boundary.starts_at)?.title
          ?? `no book at ${boundary.starts_at}`,
      }))

    expect(actual).toEqual(table.hashes())
  },
)

Then(
  'a new area should be recorded for fiction, starting at {string}',
  async ({ catalogue }, title: string) => {
    const moved = await catalogue.bookByTitle(title)
    expect(moved, `no book called "${title}"`).toBeTruthy()

    const boundaries = await catalogue.boundaries('fiction')
    expect(boundaries, 'no shelf boundary was written').toHaveLength(1)
    expect(boundaries[0]?.kind).toBe('area')
    expect(boundaries[0]?.starts_at).toBe(moved?.sort_key)
  },
)

/** Padding books, used only for which side of the book in hand each one files on. */
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
        genre: 'genre/fiction',
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

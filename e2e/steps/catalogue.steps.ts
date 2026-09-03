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

import { After, Given, Then, When } from './fixtures.js'
import { BOOK_IN_HAND, stubBookByTitle } from '../support/books.js'
import type { BookRow, Catalogue, PlankRow } from '../support/database.js'

Given('the catalogue is empty', async ({ catalogue }) => {
  await catalogue.reset()
  expect(await catalogue.books(), 'the catalogue should have been emptied').toHaveLength(0)
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
 * The opposite, and it is not the absence of the step above (#435).
 *
 * A book no source can name is ordinary: an old paperback, a book club
 * edition, anything printed before ISBNs were universal. It is also the case
 * the app is worst at, because a book nothing can name has nothing on screen
 * to recognise it by, which makes it the book most likely to be photographed
 * twice. So it has to be possible to say it out loud in a scenario, rather
 * than only reachable by inventing an ISBN nothing knows.
 *
 * Armed on the stub's control endpoint, like the slow lookup above, because it
 * has to be in place before the barcode is read.
 */
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
 * silenced for every scenario after it, and the book it would be is the one
 * the camera is pointed at in all of them. That is the sort of leak that shows
 * up as an unrelated feature failing three files later, so it is undone here
 * rather than remembered.
 *
 * Unconditional, because a hook that only runs where it is needed needs
 * something to tell it, and one local request per scenario is cheaper than
 * that something.
 */
After(async ({ stubUrl }) => {
  await fetch(`${stubUrl}/__control/answer-for-everybody`, { method: 'POST' })
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
        genre: 'genre/fiction',
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
async function fillUp(
  apiUrl: string,
  catalogue: Catalogue,
  label: string,
  kind: 'area' | 'shelf',
) {
  const response = await fetch(`${apiUrl}/api/shelves/overflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The plank, which is what a screen sends: it is holding one, and an
    // address is a rendering the route would have to read back (#359).
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

/**
 * A piece of furniture with a name on it, which is what the furniture screens
 * are for and what #356 turned out to cost.
 *
 * It moves nothing: every area keeps its id and every book keeps the area it was
 * placed in. What changes is that every label on the piece is a phrase rather
 * than a number, which is exactly the thing that must not decide anything.
 */
Given('bookcase {int} is called {string}', async ({ catalogue }, position: number, name: string) => {
  await catalogue.nameFixture(position, name)
})

/** A plank with a second one after it. */
Given(
  '{string} filled up, so its last book started a new area',
  async ({ apiUrl, catalogue }, label: string) => {
    await fillUp(apiUrl, catalogue, label, 'area')
  },
)

/**
 * The same answer, walked away from before the book was carried (#487).
 *
 * `fillUp` above records where the displaced book went, because every scenario
 * using it wants a settled room. This one deliberately does not: the whole
 * question is what the app says while the boundary has moved and the book has
 * not, which is the state somebody is in who put the phone down. It is also the
 * state every one of those scenarios passes through for a moment.
 */
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

/**
 * Several planks with books on each, arrived at one answer at a time.
 *
 * A cascade that has to go deep and then descend AGAIN needs planks past the
 * one being filled that still have a book to give up, and there is only one
 * way for a plank to come into existence: somebody said the one before it was
 * full. So the arrangement is spelled as the sequence of times that happened,
 * which is both what the room looks like and how it got that way.
 */
Given('the areas filled up in this order:', async ({ apiUrl, catalogue }, table: DataTable) => {
  for (const row of table.raw()) await fillUp(apiUrl, catalogue, row[0] ?? '', 'area')
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
Given(
  '{string} was last recorded at {string}',
  async ({ apiUrl, catalogue }, title: string, label: string) => {
    const id = await bookIdByTitle(apiUrl, title)

    // The plank first, because the app will not invent one. A recorded location
    // names an area since #232, so a label naming furniture nobody owns is
    // refused, and a scenario about a book recorded where the shelves do not
    // put it has to own the shelf it names. `standUpPlank` stands it past the
    // end of every run, so no book moves on to it and the drawing is unchanged.
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

/**
 * A book already down off the shelf when the scenario starts.
 *
 * Through the real checkout route, which takes an id and a direction and no
 * photograph, because that is the only thing in the app allowed to change this
 * state and a scenario that wrote the row directly would prove nothing about
 * it.
 */
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

/**
 * Where the book physically is, according to the database rather than the
 * screen. This is what makes "scanning writes nothing" a claim worth making:
 * the page can say whatever it likes, the row is the fact.
 *
 * The state, not `books.checked_out_at`, which is gone (#232). It is the same
 * claim rather than a weaker one: the column and the state were made from each
 * other, every shelf query already read the state, and the wire's
 * `checked_out_at` is now derived from it and from the ledger. What is asserted
 * here is the half the app decides on.
 */
Then(
  'the catalogue should record {string} as {word} the bookcase',
  async ({ catalogue }, title: string, where: string) => {
    const book = await catalogue.bookByTitle(title)
    expect(book, `no book called "${title}" in the database`).toBeTruthy()

    expect(book?.state, `"${title}" is ${where === 'off' ? 'still on' : 'still off'} the bookcase`)
      .toBe(where === 'off' ? 'checked_out' : 'shelved')
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

/**
 * A, B, ... Z, AA: a plank's ordinal written the way a location writes it.
 *
 * Bijective base 26, so 0 is A, 25 is Z and 26 is AA. Every plank this suite
 * builds is a single letter, and spelling only that case would be a second and
 * wrong answer to what a plank is called, waiting for the first scenario that
 * needs two.
 *
 * A copy of `areaLabel` in web/shared/layout.ts, for the reason `connectionConfig`
 * in support/database.ts is a copy: this package is a separate npm tree, and
 * reaching into the app would give the suite a build dependency on the thing it
 * is testing.
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

/**
 * `areaLetters` read backwards, for the one Given that has to build the plank a
 * label names before the app will accept the label.
 *
 * An inverse away from what it inverts stops being one, so the two are together.
 */
function plankIndex(letters: string): number {
  expect(letters, 'a plank is named by its letters, so "S4" names none').not.toBe('')

  let n = 0
  for (const character of letters.toUpperCase()) n = n * 26 + (character.charCodeAt(0) - 64)
  return n - 1
}

/**
 * What the catalogue records as a book's location, built back up out of rows.
 *
 * **`books.location` is gone (#232).** The wire still speaks in labels, because
 * that is what is written on a shelf and what the feature files assert; the
 * database speaks in rows, and where a book is is `books.current_area_id`
 * pointing at an area hanging off a fixture. So the label is derived here, from
 * the two rows that make it, which is the same rule `labelFor` in
 * web/domain/placement/geography.ts applies: the fixture's number and the
 * plank's letters run together, or both sides' names joined by a separator once
 * anybody names one.
 *
 * Derived rather than read back off `GET /api/books` on purpose. This suite
 * exists to check what reached the database, and asking the app where it thinks
 * the book is would only get the app to agree with itself. What that costs is
 * the negative position below: a derivation kept away from the thing it derives
 * has to be kept in step with it by hand.
 */
function locationOf(areas: readonly PlankRow[], book: BookRow): string {
  if (book.current_area_id === null) return ''

  const area = areas.find((one) => one.id === book.current_area_id)
  expect(area, `"${book.title}" is on area ${book.current_area_id}, which no fixture holds`)
    .toBeTruthy()

  // A negative position is a plank that has been taken out, stored as
  // `-(position + 1)` so that it still names the plank it was: removing the
  // divider above 2B does not move the book that was recorded on 2B, and the
  // misfile list is what says the shelves no longer have one. `faceOf` in
  // web/infrastructure/shelving/areas.ts is the same reading, and
  // `withPlacements` applies it to answer the wire.
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
    // Read once, and only when a table asks where the book is: most of these
    // tables are about a title and an ISBN and have no opinion about the floor.
    const areas = 'location' in expected ? await catalogue.areas() : []

    const columns = book as unknown as Record<string, unknown>
    const actual: Record<string, string> = {}
    for (const column of Object.keys(expected)) {
      // `location` is the one key here that is not a column and has not been one
      // since #232. It is answered from the placement instead, so the feature
      // files go on naming the plank a person would read off the shelf.
      actual[column] = column === 'location'
        ? locationOf(areas, book!)
        : String(columns[column] ?? '')
    }
    expect(actual).toEqual(expected)
  },
)

/**
 * What one book's photographs are, as the database has them.
 *
 * The two facts a photograph landing on the wrong book changes, and neither of
 * them is on a screen: which file is this book's spine, and which of its
 * photographs the queue has read. `edge_image` is the newest spine, so a second
 * spine attached to the book takes the first one's place in it and the bookcase
 * view stops drawing that book's picture.
 */
function photographsOf(book: BookRow): { spine: string; read: string } {
  return { spine: book.edge_image, read: book.analysed }
}

/** Reading the photographs is a background pass, and it takes seconds. */
const READING_TIMEOUT = 90 * 1000

/**
 * Every photograph taken has been read.
 *
 * A wait rather than a claim, and the scenario it belongs to needs it to be
 * one: what that scenario asserts is a photograph and a reading not changing,
 * so it has to start from a reading that has finished changing on its own.
 */
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

/**
 * The reading everything after it is compared against.
 *
 * Module scope, which is per worker and therefore per scenario: playwright-bdd
 * gives each worker its own module instance, and the scenario that reads this
 * writes it first.
 */
let noted: { spine: string; read: string } | null = null

/** How many photographs existed then, which is what the next one is counted against. */
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
 * One more photograph exists than did, whoever it belongs to.
 *
 * The wait the assertion after it needs, and it has to be a wait that finishes
 * whether the shutter did the right thing or the wrong one: a photograph is a
 * row of its own and taking one writes exactly one, on to whichever book the
 * camera thought it was holding. Waiting instead for the correct outcome would
 * let the wrong one be asserted before it had happened, and the scenario would
 * pass by reading the database too early.
 */
Then('the photograph should have reached a book', async ({ catalogue }) => {
  await expect
    .poll(() => catalogue.photographCount(), {
      message: 'the photograph never reached the database',
      timeout: READING_TIMEOUT,
    })
    .toBe(photographsThen + 1)
})

/**
 * Nothing has happened to them since, which is the whole of #431.
 *
 * A shelved book was still the book in hand at the camera, so the next press of
 * the shutter attached its photograph to that book: a different book's picture
 * became its spine, and the slot dropped out of `analysed` leaving a list with
 * an empty entry at each end of it. Measured on book 54, `back,front,edge` and
 * a spine file named for its ISBN became `,back,front,` and a file named for no
 * ISBN at all.
 *
 * Asserted here rather than on the screen, because the screen said "reading",
 * which is what it says about a photograph that landed on the right book.
 */
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
 * Every boundary the database holds, said as the book each one starts at.
 *
 * The proof that a removal removed the right row. A boundary is anchored to
 * the sort key of the first book on the new plank, so naming that book says
 * which boundary this is in the words the feature file can check; the id would
 * say nothing to a reader and the label on screen is the half that was already
 * lying (#145).
 *
 * Listed in anchor order, which is the order somebody walking the shelves
 * meets them, not the `position` column: position records the order the
 * boundaries were created in, and a bookcase break made after the plank break
 * beyond it sits earlier on the furniture than it does in the table.
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
    // A boundary is recorded as the sort key of the first book on the new
    // shelf. This is what makes the drawn shelf and the real shelf agree.
    expect(boundaries[0]?.starts_at).toBe(moved?.sort_key)
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

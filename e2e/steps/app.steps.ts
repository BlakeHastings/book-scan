/**
 * Driving the app the way a person does: taps on a phone-sized screen.
 *
 * Every wait here is a wait on a condition, never a sleep. The queue reads a
 * photograph in the background and the page polls for the result, so "the
 * camera recognises the book" is genuinely something that arrives when it
 * arrives; waiting a fixed two seconds for it would be a guess that eventually
 * turns into a flake.
 */

import { expect, type Page } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { Then, When } from './fixtures.js'
import { stubBookByTitle } from '../support/books.js'

/** The queue decodes the barcode and looks it up. Seconds, not milliseconds. */
const QUEUE_TIMEOUT = 90 * 1000

/**
 * The first screen has arrived and has its numbers in it.
 *
 * Three tiles until #303, and the design system since. A count is a better wait
 * than the frame around it: the top bar and the tab bar are drawn before
 * anything has been asked of the server, and the counts are what every
 * scenario that starts here is about to act on.
 *
 * It waited on the heading "The collection" until #361 took the headings off
 * this screen. The count under it is the thing that survived that round, and it
 * is the more honest wait of the two anyway: a heading is drawn whether or not
 * the catalogue has answered.
 */
export function homeScreen(page: Page) {
  return page.locator('.wf-stat', { hasText: 'catalogued' })
}

When('I open the app', async ({ page, webUrl }) => {
  await page.goto(webUrl)
  await expect(homeScreen(page)).toBeVisible()
})

/**
 * The one way in for a book the catalogue already has.
 *
 * ## The door moved twice, and this is where it ended up (#350, #355)
 *
 * It was the first screen's top right, one tap from where every one of these
 * scenarios starts. That corner is the profile icon now, so the camera that
 * identifies a book already in your hand went to the screen about finding a
 * book: Library, find, then the corner of the find screen, which is three
 * taps and four with the shutter.
 *
 * Nobody chose that, and #355 gave the first screen a door to the same camera
 * back, under the collection's counts. So this walks the door a person walks:
 * **one tap from the first screen, and the shutter is the second.** Back to
 * what it cost before the corner changed hands.
 *
 * It is written out as taps rather than shortcut through a route on purpose,
 * and that is the half of this step that matters more than the count: a
 * journey that reached the camera by setting a route would keep passing on the
 * day nothing in the interface led there any more, which is exactly the
 * failure this file caught the first time the door moved.
 *
 * The find screen's corner still works and is still the door from there. It is
 * not walked here because these scenarios all start on the first screen, and a
 * journey should walk what the person it stands for would walk.
 *
 * The wait before the shutter is a wait on a frame arriving, same as the
 * cataloguing camera, because a shutter pressed before the fake device has
 * delivered anything photographs an empty canvas.
 */
When('I scan the book', async ({ page }) => {
  await page.getByRole('button', { name: 'Find the book in your hand' }).click()
  await expect
    .poll(
      () => page.locator('video.wf-view__video').evaluate(
        (video) => (video as HTMLVideoElement).videoWidth,
      ),
      { message: 'the fake camera never produced a frame' },
    )
    .toBeGreaterThan(0)

  await inHandShutter(page).click()
})

/**
 * The shutter on the camera that finds a book you already own.
 *
 * Named rather than located, and that is the assertion hiding in a helper. Both
 * cameras are drawn by `Viewfinder` since #408, so both shutters are the same
 * circle with the same class, and the only thing that tells them apart without
 * looking at which screen you are on is what the button is called. If this ever
 * finds two, the two cameras have stopped being distinguishable and #355 is
 * back.
 */
export function inHandShutter(page: Page) {
  return page.getByRole('button', { name: 'Find this book', exact: true })
}

Then('it should open the book {string}', async ({ page }, title: string) => {
  await expect(bookTitle(page)).toHaveText(title, { timeout: QUEUE_TIMEOUT })
})

/**
 * What the book's page puts in front of you, in order.
 *
 * Exact and ordered, because the claim is not just that an action exists but
 * that the page leads with the one the book's state calls for. A page that
 * offered both directions, or neither, would still pass a looser check.
 */
Then('the book should offer:', async ({ page }, table: DataTable) => {
  const wanted = table.raw().map((row) => row[0] ?? '')
  await expect(bookActions(page)).toHaveText(wanted)
})

When('I check it out', async ({ page }) => {
  await page.getByRole('button', { name: 'Check out' }).click()
  await expect(page.locator('.checkedout')).toBeVisible()
})

When('I check it in', async ({ page }) => {
  await page.getByRole('button', { name: 'Check in' }).click()
  await expect(page.locator('.shelve__ask')).toBeVisible()
})

/**
 * The same guided shuffle a new book goes through, but a book that came back
 * returns to the scanner rather than to the cataloguing camera, because that
 * is where the next book off the pile is dealt with.
 */
When('I say it fits and put it back', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()
  // The scanner and not the cataloguing camera, which is the whole claim of
  // this step, so it waits on the shutter that says which camera this is
  // rather than on a video element both of them now have.
  await expect(inHandShutter(page)).toBeVisible({ timeout: QUEUE_TIMEOUT })
})

/**
 * The end of putting a book back that was picked up in the library.
 *
 * Landing back in the library is the assertion, the same way the move step
 * below asserts landing in the shelves. Finishing here used to end at the
 * cataloguing camera, a room somebody who was browsing their shelves then has
 * to navigate out of (#89).
 */
When('I say it fits and finish putting it back', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()
  await toTheShelves(page)
})

When('I start the camera', async ({ page }) => {
  await page.locator('button.wf-tab', { hasText: 'Scan' }).click()
  await page.getByRole('button', { name: 'Start camera' }).click()

  // The fake device is a file, so the first frame arrives almost at once. What
  // matters is that a frame arrived at all: without one the shutter draws an
  // empty canvas, and the failure would surface much later as a photograph the
  // server cannot read.
  await expect
    .poll(
      () => page.locator('video.wf-view__video').evaluate(
        (video) => (video as HTMLVideoElement).videoWidth,
      ),
      { message: 'the fake camera never produced a frame' },
    )
    .toBeGreaterThan(0)

  await expect(page.locator('.cam__error')).toHaveCount(0)
})

When('I photograph the book', async ({ page }) => {
  // The back cover is the slot the camera opens on, which is deliberate: it
  // carries the barcode, so identification starts on the first shot.
  // The photographs are `Shots` since #316, and the one the shutter is about
  // to fill is the one marked as next.
  await expect(page.locator('.wf-shot--next')).toContainText('Back')
  await page.locator('button.wf-shutter').click()
})

Then('the camera should recognise the book as {string}', async ({ page }, title: string) => {
  await expect(page.locator('.wf-view__found')).toContainText(title, { timeout: QUEUE_TIMEOUT })
})

/**
 * Put this book down and start the next one off the pile, which is the tap
 * somebody makes between every two books they photograph.
 *
 * The photographs already went to the queue as they were taken, so this clears
 * the camera and nothing else. Waiting for the banner to go back to saying
 * nothing is in hand is waiting for that to have happened, rather than for a
 * duration.
 */
When('I start the next book', async ({ page }) => {
  await page.getByRole('button', { name: /^Next book/ }).click()
  await expect(page.locator('.wf-view__found--empty')).toBeVisible()
})

When('I review what it found', async ({ page }) => {
  const review = page.getByRole('button', { name: 'Done with this book' })
  await expect(review).toBeEnabled({ timeout: QUEUE_TIMEOUT })
  await review.click()
  await expect(reviewScreen(page)).toBeVisible()
})

/**
 * The review screen for a book that is not in the catalogue yet.
 *
 * Its one primary answer is what says it is on screen. Everything else on it
 * is a field somebody may or may not have filled in, and the screen it shares
 * a route with, a catalogued book, has no such button on it at all.
 */
export function reviewScreen(page: Page) {
  return page.getByRole('button', { name: 'That is the book' })
}

/**
 * The title of the book a record is about, as the design system draws it.
 *
 * It was `.detail__title`, the app's own heading, until the book's page and
 * the screen its pencil opens were converted (#387). Both draw `Head` now, so
 * one selector answers for the record wherever it is reached from.
 */
function bookTitle(page: Page) {
  return page.locator('.wf-book__title')
}

/**
 * What the record offers, in order.
 *
 * The row is `Actions` out of the design system rather than `.actions--top`,
 * and it is still exactly the row: the claim these steps make is that the page
 * leads with the action the book's state calls for, and a page offering both
 * directions or neither would still pass a looser check.
 */
function bookActions(page: Page) {
  return page.locator('.wf-actions .wf-btn')
}

/** The ISBN as the review screen draws it: the field with a camera in it. */
function isbnField(page: Page) {
  return page.locator('.wf-field', { hasText: 'ISBN' }).locator('.wf-field__value')
}

/** How the review screen words each way an ISBN can have been read. */
const READ_FROM: Record<string, string> = {
  barcode: 'Read off the barcode',
  ocr: 'Read off the printed number',
  manual: 'Typed in by hand',
}

Then('the review screen should show:', async ({ page }, table: DataTable) => {
  for (const [label, value] of Object.entries(table.rowsHash())) {
    // Exact, because the fields are labelled by wrapping <label> elements and
    // a loose match for "Title" also finds "Subtitle".
    await expect(page.getByLabel(label, { exact: true }), `the "${label}" field`)
      .toHaveValue(value)
  }
})

Then('the ISBN should read {string}', async ({ page }, isbn: string) => {
  await expect(isbnField(page)).toHaveText(isbn)
})

/**
 * The provenance, on screen. It is drawn only when there is a source to draw,
 * so an absent line and a wrong line fail the same way here, which is what is
 * wanted: a book whose reading nobody recorded is the bug.
 */
Then('the ISBN should say it was read from {string}', async ({ page }, source: string) => {
  await expect(page.locator('.wf-top__sub')).toHaveText(READ_FROM[source] ?? source)
})

When('I confirm the details and go to shelve it', async ({ page }) => {
  await page.getByRole('button', { name: 'That is the book' }).click()
  await expect(page.locator('.shelve__ask')).toBeVisible()
})

/**
 * The instruction sentence. Which element carries it depends on whether the
 * app could draw the shelf: with books on it you get the strip and its
 * instruction, and on a completely empty range you get the card instead. Both
 * say the same sentence, and the sentence is what the feature is about.
 */
Then('the placement should read {string}', async ({ page }, text: string) => {
  await expect(
    page.locator('.placement-view__instruction, .placement__instruction'),
  ).toHaveText(text)
})

Then('the shelf drawing should be labelled {string}', async ({ page }, label: string) => {
  await expect(page.locator('.strip__label')).toHaveText(label)
})

Then(
  'it should tell me to put {string} in the gap at {string}',
  async ({ page }, title: string, shelf: string) => {
    await expect(page.locator('.shelve__ask')).toContainText(
      `Put ${title} in the gap at ${shelf}`,
    )
  },
)

/**
 * The first of the two "no room" answers.
 *
 * Its wording depends on where in the plank the book belongs, because the two
 * answers are different physical jobs: one moves a book off the shelf, the
 * other moves the book already in your hand. Matched loosely here and asserted
 * exactly by the step below, where a feature cares which one it is being
 * offered.
 */
When('I say there is no room on the shelf', async ({ page }) => {
  await page.getByRole('button', { name: /^No room, (?!start a new bookcase)/ }).click()
})

Then('the first answer should read {string}', async ({ page }, label: string) => {
  await expect(page.getByRole('button', { name: /^No room, (?!start a new bookcase)/ }))
    .toHaveText(label)
})

Then(
  'it should ask me to move {string} from {string} to {string}',
  async ({ page }, title: string, from: string, to: string) => {
    await expect(page.locator('.shelve__ask')).toContainText(
      `Take ${title} off the end of ${from} and put it at the start of ${to}.`,
    )
  },
)

/**
 * The answer when the book belongs at the end of the full plank: it is the one
 * that moves, and it is still in your hand, so there is nothing to confirm.
 */
Then('it should tell me the book itself goes on to {string}', async ({ page }, label: string) => {
  await expect(page.locator('.moves li').last())
    .toContainText(`goes on to ${label}`, { timeout: 30 * 1000 })
})

/**
 * Asserted as the absence of the whole question, not as "does not mention this
 * title". A shuffle offered at all here is the defect: the person is holding
 * the book that has to move, so being asked whether a different one fitted
 * somewhere means one was sent there for nothing.
 */
Then('it should not ask me to move any other book', async ({ page }) => {
  // No book was sent anywhere, so there is nothing to confirm having carried.
  await expect(page.locator('.shelve__ask')).not.toContainText('Did it fit there?')
  await expect(page.getByRole('button', { name: 'Yes, it fit' })).toHaveCount(0)
  // And one step happened, the one that named the book in hand.
  await expect(page.locator('.moves li')).toHaveCount(1)
})

/**
 * Confirming one move, and waiting for it to have been made.
 *
 * The answer is three writes and a redraw: the boundary shifts, the book's
 * location is recorded, the frame comes off the stack. The move only joins the
 * list of things that have happened once all of that has landed, so waiting
 * for the list to grow is waiting on the condition rather than on a duration.
 * Without it a step asserting against the database races the writes it is
 * asserting about.
 */
When('I say the moved book fitted', async ({ page }) => {
  const made = await page.locator('.moves__placed').count()
  await page.getByRole('button', { name: 'Yes, it fit' }).click()
  await expect(page.locator('.moves__placed')).toHaveCount(made + 1)
})

/**
 * The same answer as "there is no room on the shelf", given about a plank the
 * cascade has already reached rather than about the one the book started on.
 *
 * A separate step because a feature has to be able to say which of the two
 * questions it is answering; deliberately NOT a separate path through the app,
 * which is the point of #110. Both are one person at one plank saying it will
 * not take the book they are holding.
 */
When('I say there is no room on that one either', async ({ page }) => {
  await page.getByRole('button', { name: /^No, .+ is full too$/ }).click()
})

/**
 * Where you are in the chain, said on screen.
 *
 * Four books deep with a re-descent in it is not something anybody holds in
 * their head, and every frame looks the same otherwise: two plank labels and a
 * title. So the screen says which book is being placed and how far in that is.
 */
Then(
  'it should say I am placing {string}, {int} books deep',
  async ({ page }, title: string, deep: number) => {
    await expect(page.locator('.shelve__where'))
      .toContainText(`Placing ${title}, ${deep} books deep`)
  },
)

/**
 * The step drawn rather than described (#112).
 *
 * The same strip the placing preview uses, on the plank the book is going on,
 * with the gap where it goes and the filing name written down the spine
 * hanging under it. Somebody four levels deep is looking at a shelf, and a
 * picture of the gap is easier to act on than a sentence naming two planks.
 */
Then(
  'it should draw the gap for {string} on {string}',
  async ({ page }, authorFiling: string, label: string) => {
    await expect(page.locator('.strip__label')).toHaveText(label)
    await expect(page.locator('.strip__new-author')).toHaveText(authorFiling)
  },
)

/**
 * Where the drawn row has come to rest, measured rather than reasoned about.
 *
 * Read after two animation frames, so what is measured is where the row
 * settled and not where it happened to be mid-commit: the component scrolls
 * the gap into view as an effect, and the browser's scroll snapping then has
 * its own say about where the row is allowed to stop.
 */
async function whereTheGapIs(page: Page) {
  await expect(page.locator('.strip__gap')).toBeVisible()
  return page.locator('.strip__gap').evaluate((gap) => new Promise<{
    gapLeft: number; gapRight: number
    visibleLeft: number; visibleRight: number
    rowWidth: number; screenWidth: number
    scrollLeft: number
  }>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const scroller = gap.closest('.strip__scroll') as HTMLElement
      const seen = scroller.getBoundingClientRect()
      const it = gap.getBoundingClientRect()
      resolve({
        gapLeft: Math.round(it.left),
        gapRight: Math.round(it.right),
        visibleLeft: Math.round(seen.left),
        visibleRight: Math.round(seen.right),
        rowWidth: scroller.scrollWidth,
        screenWidth: scroller.clientWidth,
        scrollLeft: Math.round(scroller.scrollLeft),
      })
    }))
  }))
}

/**
 * The guard on the three checks below.
 *
 * A row that fits on the screen cannot have its gap anywhere but on the
 * screen, so without this a scenario could go green having proved nothing.
 */
Then('the shelf drawing should be longer than the screen', async ({ page }) => {
  const seen = await whereTheGapIs(page)
  expect(
    seen.rowWidth,
    `the drawn row is ${seen.rowWidth}px across a ${seen.screenWidth}px screen, so ` +
    'it never needed scrolling and this scenario is not testing what it says',
  ).toBeGreaterThan(seen.screenWidth)
})

/**
 * The whole point of the shelving step, and #119.
 *
 * The strip answers one question, where this book goes, and it answers it by
 * drawing a hole in a shelf. A hole that is off the side of the screen when
 * the screen settles is the step having quietly stopped answering, and the
 * person holding the book goes hunting for it.
 */
Then('the gap should be on screen without scrolling the shelf', async ({ page }) => {
  const seen = await whereTheGapIs(page)
  const said =
    `the gap sits at x ${seen.gapLeft} to ${seen.gapRight}, and the visible part of ` +
    `the shelf runs from x ${seen.visibleLeft} to ${seen.visibleRight} ` +
    `(row ${seen.rowWidth}px, screen ${seen.screenWidth}px, resting at ` +
    `scrollLeft ${seen.scrollLeft})`

  expect(seen.gapLeft, `off the left: ${said}`).toBeGreaterThanOrEqual(seen.visibleLeft)
  expect(seen.gapRight, `off the right: ${said}`).toBeLessThanOrEqual(seen.visibleRight)
})

/**
 * Out of the shelving step without answering it, which is #111's case.
 *
 * Either marker will do, because the page underneath depends on what was being
 * shelved: a capture still being confirmed lands on the editable fields, and a
 * catalogued book on its own header. They are mutually exclusive and both mean
 * the same thing here, which is that the shelving step has been left without
 * anything being said about where the book is.
 */
When('I go back to the book details', async ({ page }) => {
  await page.getByRole('button', { name: 'Back to book details' }).click()
  await expect(reviewScreen(page).or(bookTitle(page))).toBeVisible()
})

When('I say it fits and save it', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()

  // A new book ends on "Shelved" since #316, which is the drawn end of the
  // journey: the same run of books with this one standing where the gap was.
  // Taking the next book off the pile is the answer that leads on from it, and
  // the shutter reappearing is how the app says the whole thing is done.
  await expect(page.locator('.wf-top__title'))
    .toHaveText('Shelved', { timeout: QUEUE_TIMEOUT })
  await page.getByRole('button', { name: 'Next book' }).click()
  await expect(page.locator('button.wf-shutter')).toBeVisible({ timeout: QUEUE_TIMEOUT })
})

/**
 * To the library from wherever this scenario happens to be.
 *
 * Three ways in, because the library is reachable from the camera, the first
 * screen's tab bar and the header of every screen that is not those two, and
 * which one is on screen depends on what the scenario just did rather than on
 * anything it says.
 */
export async function leaveTheCamera(page: Page): Promise<void> {
  // The camera has one way out and it is the round target in the corner. It
  // had a row of navigation chips until #316 and the drawn screen has none:
  // the picture is the whole screen. So anywhere else is two taps from here,
  // out to the first screen and then a tab, which is what this is.
  const out = page.locator('.wf-view__leave')
  if (await out.isVisible()) {
    await out.click()
    await expect(homeScreen(page)).toBeVisible()
  }
}

async function openLibrary(page: Page): Promise<void> {
  /*
   * Already looking at them, so this is not a journey.
   *
   * It became one since #315: the tab opens the library somebody browses and
   * the shelves are a button further in, so pressing it from the shelves is a
   * round trip that unmounts them and back. What that costs is what a scenario
   * has just been told. The removal reports the books it displaced on the
   * screen it happened on, and a step that walked away and came back would read
   * an empty list and call it a defect.
   */
  if (await page.locator('.shelfgroup').first().isVisible()) return

  await leaveTheCamera(page)

  for (const entry of [
    page.locator('button.wf-tab', { hasText: 'Library' }),
    page.locator('nav button.tab', { hasText: 'Library' }),
  ]) {
    if (await entry.isVisible()) {
      await entry.click()
      break
    }
  }

  await toTheShelves(page)
}

/**
 * The shelves as a job of work, which is one tap further in since #315.
 *
 * The library tab is now the library as somebody browses it: every book they
 * own, drawn three ways, with a filter and a way to find one. What these
 * journeys are about is the other half of what that screen used to carry, the
 * areas themselves and the books that are not where they now belong, and it is
 * behind one button at the bottom of it while the carrying and furniture
 * screens are built (#314, #313).
 *
 * Every step that ends on the shelves goes through here, so when that button
 * goes away with the screen it names, this is the one place that changes.
 *
 * Groups and the attention list are filled by the same load, so a rendered
 * shelf means the misfile check has been asked and answered too. Without that
 * wait, "nothing needs attention" would pass on a page that has not finished
 * asking.
 */
async function toTheShelves(page: Page): Promise<void> {
  const groups = page.locator('.shelfgroup').first()
  if (await groups.isVisible()) return

  // Renamed by #364. It said "Check the bookcases against the order", which the
  // owner could not read, and it is now named for the list behind it.
  const through = page.getByRole('button', { name: 'Books that are not where they should be' })
  await expect(through).toBeVisible({ timeout: QUEUE_TIMEOUT })
  await through.click()
  await expect(groups).toBeVisible({ timeout: QUEUE_TIMEOUT })
}

When('I go to the library', async ({ page }) => {
  await openLibrary(page)
})

When(
  'I open {string} from the off-bookcase list',
  async ({ page }, title: string) => {
    await page.locator('.offshelf button.wf-row', { hasText: title }).click()
    // A catalogued book opens as a record, not as the editable form, so the
    // heading is what says the right book is on screen.
    await expect(bookTitle(page)).toHaveText(title)
  },
)

Then(
  'the library should show {string} on shelf {string}',
  async ({ page }, title: string, shelf: string) => {
    // Reached from the camera, which is where somebody scanning a pile is.
    await openLibrary(page)

    // The shelves draw each area as a run of spines, so a book is in the right
    // place when its spine is inside that area's section. The spine's tooltip
    // is what carries the title: what is printed down a spine is the filing
    // name, and at that width there is no room for either, which is also true
    // of the shelf itself. `ShelfItem.name` is what puts the title there (#387).
    const area = page.locator(`section.shelfgroup[data-label="${shelf}"]`)
    await expect(area.locator(`button.wf-spine[title*=${JSON.stringify(title)}]`)).toBeVisible()
  },
)

/**
 * No boundary control anywhere in the library, in whichever of the three
 * drawings is on screen (#96, #82). The move is a book's own business now;
 * a control drawn into a scrolling run of spines is what put the wrong book
 * one mistap away in the first place.
 */
Then('the library should offer no boundary moves', async ({ page }) => {
  await expect(page.locator('.boundary')).toHaveCount(0)
})

/**
 * The boundary moves a book's own page offers, exactly.
 *
 * Asserted as a closed list rather than as "this button exists": half the
 * claim is about what is *not* offered, and a book in the middle of a run
 * offers neither direction. Filtered to just the "Move it..." buttons, since
 * this scenario is checking one book's edges, not the whole action bar the
 * way `the book should offer:` does for scanning.
 */
Then(
  'the book should offer to move it:',
  async ({ page }, table: DataTable) => {
    const wanted = table.raw().map((row) => row[0] ?? '')
    await expect(bookActions(page).filter({ hasText: /^Move it / })).toHaveText(wanted)
  },
)

Then('the book should not offer to move it', async ({ page }) => {
  await expect(bookActions(page).filter({ hasText: /^Move it / })).toHaveCount(0)
})

/**
 * Start a boundary move from the book's own page, which starts a placement
 * rather than finishing one.
 *
 * The wait is on the shelving step appearing, because that is the whole
 * claim: a move is told-walk-confirm like every other placement, not a
 * button that quietly rewrites where a book is.
 */
When('I choose to move it on to {string}', async ({ page }, label: string) => {
  await page.getByRole('button', { name: `Move it on to ${label}` }).click()
  await expect(page.locator('.shelve__ask')).toBeVisible()
})

When('I choose to move it back to {string}', async ({ page }, label: string) => {
  await page.getByRole('button', { name: `Move it back to ${label}` }).click()
  await expect(page.locator('.shelve__ask')).toBeVisible()
})

/**
 * The end of a move, which is the end of any placement: the person says the
 * book is on the plank they were sent to.
 *
 * Landing back in the library rather than at the cataloguing camera is part of
 * the assertion. Somebody adjusting where a plank ends is working through the
 * shelves, and the next adjustment is there.
 */
When('I say it fits and finish the move', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()
  await toTheShelves(page)
})

/**
 * The list of books the catalogue thinks are in the wrong place.
 *
 * Asserted as absent rather than as "does not contain this title", because the
 * failure being guarded against is the app reporting a move it has just walked
 * somebody through: any entry at all, for any book in a scenario that has only
 * ever put books where it was told, is that failure.
 */
Then('nothing should need attention', async ({ page }) => {
  await expect(page.locator('.attention')).toHaveCount(0)
})

/** One book's line in that list, whichever order the list happens to be in. */
const attentionRow = (page: Page, title: string) =>
  page.locator('.attention__row').filter({ hasText: title })

/**
 * The way back out of a move nobody acted on (#196).
 *
 * Asserted next to "Moved it" rather than instead of it, because the two are
 * different statements and the entry has to offer both: one says somebody
 * walked to the shelf, the other says nobody went anywhere.
 */
Then(
  'the list should offer to undo the move for {string}',
  async ({ page }, title: string) => {
    const row = attentionRow(page, title)
    await expect(row.getByRole('button', { name: 'Moved it' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Undo the move' })).toBeVisible()
  },
)

When('I undo the move for {string}', async ({ page }, title: string) => {
  await attentionRow(page, title).getByRole('button', { name: 'Undo the move' }).click()
  // The list is re-read from the server afterwards, so the entry going is the
  // server's answer rather than the screen tidying itself up.
  await expect(attentionRow(page, title)).toHaveCount(0)
})

/**
 * The same disagreement as an attention row, said on the book's own page.
 *
 * Both shelves are named, because the sentence has to be actionable by
 * somebody holding the book: which plank to take it off, and which to put it
 * on.
 */
Then(
  'the book should say it was last seen on {string} and now belongs on {string}',
  async ({ page }, from: string, to: string) => {
    await expect(page.locator('.misfile__where')).toHaveText(
      `Last seen on ${from}. The order now puts it on ${to}.`,
    )
  },
)

/**
 * "Moved it", tapped on the book's own page rather than in the library list.
 *
 * **The wait before the tap is the whole scenario.** Arriving on this page
 * schedules a placement read 250ms later, and a browser driven at machine
 * speed taps inside that window, so the arrival read lands after the write and
 * redraws the shelf that the write itself failed to redraw. Written without
 * this wait, the scenario passed against the defect it was written for: the
 * drawing settled about 120ms after the tap, from a request that had nothing
 * to do with the tap. Somebody who reads the banner before answering it waits
 * longer than 250ms, and then nothing is left to hide the missing read.
 *
 * `.placement--stale` is the app saying so itself: it marks the drawing while
 * a placement read is outstanding, so its absence is the page having caught up
 * with where it is.
 *
 * The banner going is all this waits for afterwards, on purpose: that much
 * worked before #197 and would make this step pass either way. What the fix is
 * about is asserted separately, by the step below, on the drawing the banner
 * sat above.
 */
When('I say I have moved it', async ({ page }) => {
  await expect(page.locator('.placement--stale')).toHaveCount(0)
  await page.locator('.misfile').getByRole('button', { name: 'Moved it' }).click()
  await expect(page.locator('.misfile')).toHaveCount(0)
})

/**
 * The book drawn as a spine in its row, rather than as the gap it goes in.
 *
 * Three things at once, because any one of them alone passes on the stale
 * drawing #197 left up: the row is the right area, there is no hole in it, and
 * exactly one book in it is marked as the one being looked at.
 *
 * **The marked book is no longer named by the title given here** (#387). The
 * page draws `Shelf` out of the design system now, the same component the
 * book's own page draws its run with, and a spine there reads what it files
 * under rather than what it is called: the cat on top of it is what says which
 * book, and he says "This is the book" rather than its title. Which book gets
 * the cat is decided by the book's id, so one perch in the right row is the
 * whole of the claim this step can make and the whole of the claim #197 needs.
 */
Then(
  'the shelf drawing should draw {string} in place on {string}',
  async ({ page }, _title: string, label: string) => {
    await expect(page.locator('.wf-shelf__label')).toHaveText(label)
    await expect(page.locator('.wf-gap')).toHaveCount(0)
    await expect(page.locator('.wf-shelf .wf-perch')).toHaveCount(1)
  },
)

/**
 * A catalogued book opened by tapping its spine in the shelf drawing, rather
 * than the off-bookcase list `openLibrary` above already covers. Same
 * destination, a different route in.
 */
When('I open {string} from the library', async ({ page }, title: string) => {
  await page.locator(`button.wf-spine[title*=${JSON.stringify(title)}]`).first().click()
  await expect(bookTitle(page)).toHaveText(title)
})

When('I start editing the details', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit details' }).click()
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
})

/**
 * Type into one of the book's fields. Exact, for the reason the review screen
 * assertion is: "Title" also matches "Subtitle" loosely.
 */
When('I set {string} to {string}', async ({ page }, label: string, value: string) => {
  await page.getByLabel(label, { exact: true }).fill(value)
})

/**
 * The banner a book off the bookcase carries.
 *
 * Asserted after an edit as well as before one, because the screen and the
 * database disagreeing is half of #87: the row was checked back in and the
 * page went on offering to put the book back, which sends somebody through a
 * shelving step for a book already in the layout.
 */
Then('the book should say it is off the bookcase', async ({ page }) => {
  await expect(page.locator('.checkedout')).toBeVisible()
})

/**
 * The Change ISBN flow: open the prompt, type the digits, submit. The lookup
 * it starts is asynchronous and outlives this step; whether Save waits for it
 * is what a scenario using this step is checking, not asserted here.
 */
When('I change the ISBN to that of {string}', async ({ page }, title: string) => {
  const target = stubBookByTitle(title)
  // Two screens ask for it and they ask the same way now (#387). It was a
  // button called "Change ISBN" on a catalogued book and the camera at the end
  // of the ISBN field on the review screen; converting the first one gave it
  // the second one's field, which the drawing puts there because thirteen
  // digits typed off a book by somebody holding the book is the slowest way to
  // answer it. Both open the same prompt, and the prompt still has a keyboard.
  await page.getByRole('button', { name: /Read the barcode/ }).click()
  // The prompt's own box, which is the design system's field since #408 and
  // carries its label rather than a class of its own. The ISBN on the screen
  // underneath is drawn and not typed into, so this names exactly one box.
  await page.getByRole('textbox', { name: 'ISBN' }).fill(target.isbn13)
  await page.getByRole('button', { name: 'Look up and replace' }).click()
})

/**
 * Named rather than fixed to "Save changes", because the button that saves
 * depends on which book is on screen: a catalogued one is written where it
 * stands, a fresh capture goes on down the shelving step. They are two labels
 * for one decision, and #88 was the two of them having drifted apart, so one
 * step drives both and a scenario names the button it is standing in front of.
 */
Then(
  '{string} should be unavailable while the lookup runs',
  async ({ page }, label: string) => {
    // Short and explicit rather than the suite's default 30s: this is either
    // already true by the time "Look up and replace" has been clicked, or it
    // never becomes true, and a regression should say so in seconds, not
    // three quarters of a minute.
    await expect(page.getByRole('button', { name: label })).toBeDisabled({ timeout: 2_000 })
  },
)

/**
 * The delay armed on the stub (see "I arm a slow lookup" in
 * catalogue.steps.ts) is what makes this worth waiting for rather than
 * asserting instantly: a fix that disabled the button but never re-enabled it
 * would time out here instead of passing.
 */
Then(
  '{string} should be available again once the lookup answers',
  async ({ page }, label: string) => {
    await expect(page.getByRole('button', { name: label }))
      .toBeEnabled({ timeout: 10_000 })
  },
)

When('I save the changes', async ({ page }) => {
  await page.getByRole('button', { name: 'Save changes' }).click()
  // Saving a catalogued book returns to its record view, not the camera.
  await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible()
})

/**
 * The shelves read down the page: every area and every boundary line, in the
 * order somebody scrolling meets them.
 *
 * Read off the DOM in document order rather than by querying each kind of
 * element separately, because the order is the claim. #145 was a set of lines
 * every one of which was correct in isolation and drawn one area too low.
 *
 * **An area is named by its plank and no longer by two halves** (#387). The
 * heading was "Bookcase 2" and "Area B" in two spans; the design system's
 * `Shelf` carries `2B` whole on the board, with the piece named once above the
 * areas that share it, so that is what a line of this table is.
 */
Then(
  'the library should read, top to bottom:',
  async ({ page }, table: DataTable) => {
    const wanted = table.raw().map((row) => row[0] ?? '')

    const lines = await page.evaluate(() => {
      const body = document.querySelector('.wf-screen__body')
      if (!body) return []

      const text = (element: Element, selector: string) =>
        element.querySelector(selector)?.textContent?.trim() ?? ''

      return [...body.children].flatMap((element) => {
        if (element.classList.contains('divider')) {
          return [text(element, '.wf-said')]
        }
        if (element.classList.contains('shelfgroup')) {
          return [text(element, '.wf-shelf__label')]
        }
        return []
      })
    })

    expect(lines).toEqual(wanted)
  },
)

/**
 * Tap Remove on the line drawn immediately above a named area.
 *
 * Deliberately positional. Somebody adjusting the shelves is pointing at the
 * gap between two planks, and the whole of #145 was that the line sitting in
 * that gap deleted a boundary from somewhere else. Naming the area and
 * stepping back one element is how that tap is reproduced.
 */
When(
  'I remove the boundary drawn above {string}',
  async ({ page }, area: string) => {
    const line = page.locator(
      `xpath=//section[contains(@class,"shelfgroup")][@data-label=${JSON.stringify(area)}]`
      + '/preceding-sibling::*[1]',
    )
    await expect(line, `nothing is drawn above ${area}`).toHaveClass(/divider/)

    const drawn = await page.locator('.divider').count()
    await line.getByRole('button', { name: 'Remove' }).click()
    // One line fewer, which is the redraw finishing. Waiting on the moves
    // panel instead would assume that a removal always moves a book.
    await expect(page.locator('.divider')).toHaveCount(drawn - 1)
  },
)

/**
 * The physical job the app hands back, in full.
 *
 * A closed list, because the failure being guarded against is books being
 * carried that did not need to move: #145 asked for four of them.
 *
 * Each one is a `Row` out of the design system now (#387), so the book and the
 * two planks are two elements rather than one line of text, and they are read
 * as two rather than glued back together with a colon.
 */
Then('it should say to move exactly:', async ({ page }, table: DataTable) => {
  const wanted = table.hashes()
  const rows = page.locator('.tomove .wf-row')
  await expect(rows).toHaveCount(wanted.length)

  for (const [at, row] of wanted.entries()) {
    await expect(rows.nth(at).locator('.wf-row__title')).toHaveText(row.book ?? '')
    await expect(rows.nth(at).locator('.wf-row__sub'))
      .toHaveText(`${row.from} to ${row.to}`)
  }
})

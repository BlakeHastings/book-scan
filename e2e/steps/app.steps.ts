/**
 * Driving the app the way a person does: taps on a phone-sized screen.
 *
 * Every wait here is a wait on a condition, never a sleep, since the queue
 * answers in the background and a fixed delay would eventually flake.
 */

import { expect, type Page } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'

import { Then, When } from './fixtures.js'
import { stubBookByTitle } from '../support/books.js'
import { openTheApp } from '../support/opening.js'

/** The queue decodes the barcode and looks it up. Seconds, not milliseconds. */
const QUEUE_TIMEOUT = 90 * 1000

/**
 * The first screen has arrived and has its numbers in it.
 *
 * The count is a better wait than the frame around it: the top bar and tab bar
 * are drawn before anything has been asked of the server, so waiting on the
 * count rather than the frame confirms the catalogue actually answered.
 */
export function homeScreen(page: Page) {
  return page.locator('.wf-stat', { hasText: 'catalogued' })
}

When('I open the app', async ({ page, webUrl }) => {
  await openTheApp(page, webUrl, homeScreen(page))
  await expect(homeScreen(page)).toBeVisible()
})

/**
 * The one way in for a book the catalogue already has.
 *
 * Driven as taps through the UI rather than a direct route, so it keeps
 * failing the day nothing in the interface actually leads there any more.
 *
 * The wait before the shutter is a wait on a frame arriving: a shutter pressed
 * before the fake device has delivered anything photographs an empty canvas.
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
 * Named rather than located: both cameras share the same shutter circle and
 * class, so only the accessible name tells them apart.
 */
export function inHandShutter(page: Page) {
  return page.getByRole('button', { name: 'Find this book', exact: true })
}

Then('it should open the book {string}', async ({ page }, title: string) => {
  await expect(bookTitle(page)).toHaveText(title, { timeout: QUEUE_TIMEOUT })
})

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

When('I say it fits and put it back', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()
  // Waits on the scanner's own shutter rather than a video element, since both
  // cameras now have one and only the shutter says which camera this is.
  await expect(inHandShutter(page)).toBeVisible({ timeout: QUEUE_TIMEOUT })
})

When('I say it fits and finish putting it back', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()
  await toTheShelves(page)
})

When('I start the camera', async ({ page }) => {
  await page.locator('button.wf-tab', { hasText: 'Scan' }).click()
  await page.getByRole('button', { name: 'Start camera' }).click()

  // Without a frame, the shutter draws an empty canvas and the failure only
  // surfaces later as a photograph the server cannot read.
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

When('I choose the {word} photograph', async ({ page }, side: string) => {
  // By label rather than by role: each of these is a <button> carrying
  // role="listitem", so getByRole('button') finds none of them.
  await page.getByLabel(`Photograph the ${side}`, { exact: true }).click()
})

When('I photograph the book', async ({ page }) => {
  // The camera opens on the back cover deliberately: it carries the barcode,
  // so identification starts on the first shot.
  await expect(page.locator('.wf-shot--next')).toContainText('Back')
  await page.locator('button.wf-shutter').click()
})

/**
 * All three sides, which is what somebody photographing a book actually does.
 *
 * Each press waits for the slot marker to move before the next: `shoot` reads
 * the active slot out of the render it was clicked in, so two presses inside
 * one frame would photograph the same side twice.
 */
When('I photograph all three sides of the book', async ({ page }) => {
  const nextSlot = page.locator('.wf-shot--next')
  const shutter = page.locator('button.wf-shutter')

  await expect(nextSlot).toContainText('Back')
  await shutter.click()
  // The capture does not exist until the first photograph reaches the server,
  // so the second press waits for the queue to have read the barcode off it.
  await expect(page.locator('.wf-shot__note').first())
    .toHaveText('ISBN found', { timeout: QUEUE_TIMEOUT })

  await expect(nextSlot).toContainText('Front')
  await shutter.click()

  await expect(nextSlot).toContainText('Spine')
  await shutter.click()
  await expect(page.locator('.wf-shot__img')).toHaveCount(3)
})

/**
 * The shutter, pressed at whatever the camera is pointed at.
 *
 * Deliberately without the check that the back cover is the slot about to be
 * filled, which every other press here makes.
 */
When('I press the shutter', async ({ page }) => {
  await page.locator('button.wf-shutter').click()
})

Then('the camera should recognise the book as {string}', async ({ page }, title: string) => {
  await expect(page.locator('.wf-view__found')).toContainText(title, { timeout: QUEUE_TIMEOUT })
})

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

export function reviewScreen(page: Page) {
  return page.getByRole('button', { name: 'That is the book' })
}

/** Both the record view and its edit screen draw `Head`, so one selector answers for either. */
function bookTitle(page: Page) {
  return page.locator('.wf-book__title')
}

function bookActions(page: Page) {
  return page.locator('.wf-actions .wf-btn')
}

function isbnField(page: Page) {
  return page.locator('.wf-field', { hasText: 'ISBN' }).locator('.wf-field__value')
}

const READ_FROM: Record<string, string> = {
  barcode: 'Read off the barcode',
  ocr: 'Read off the printed number',
  manual: 'Typed in by hand',
}

Then('the review screen should show:', async ({ page }, table: DataTable) => {
  for (const [label, value] of Object.entries(table.rowsHash())) {
    // Exact, since a loose match for "Title" also finds "Subtitle".
    await expect(page.getByLabel(label, { exact: true }), `the "${label}" field`)
      .toHaveValue(value)
  }
})

Then('the ISBN should read {string}', async ({ page }, isbn: string) => {
  await expect(isbnField(page)).toHaveText(isbn)
})

Then('the ISBN should say it was read from {string}', async ({ page }, source: string) => {
  await expect(page.locator('.wf-top__sub')).toHaveText(READ_FROM[source] ?? source)
})

When('I confirm the details and go to shelve it', async ({ page }) => {
  await page.getByRole('button', { name: 'That is the book' }).click()
  await expect(page.locator('.shelve__ask')).toBeVisible()
})

Then('the placement should read {string}', async ({ page }, text: string) => {
  await expect(
    page.locator('.wf-instruction'),
  ).toHaveText(text)
})

Then('the shelf drawing should be labelled {string}', async ({ page }, label: string) => {
  await expect(page.locator('.wf-shelf__label')).toHaveText(label)
})

Then(
  'it should tell me to put {string} in the gap at {string}',
  async ({ page }, title: string, shelf: string) => {
    await expect(page.locator('.shelve__ask')).toContainText(
      `Put ${title} in the gap at ${shelf}`,
    )
  },
)

/** The button's wording depends on where in the plank the book belongs, so it is matched loosely here. */
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

Then('it should tell me the book itself goes on to {string}', async ({ page }, label: string) => {
  await expect(page.locator('.wf-step').last())
    .toContainText(`goes on to ${label}`, { timeout: 30 * 1000 })
})

Then('it should not ask me to move any other book', async ({ page }) => {
  await expect(page.locator('.shelve__ask')).not.toContainText('Did it fit there?')
  await expect(page.getByRole('button', { name: 'Yes, it fit' })).toHaveCount(0)
  await expect(page.locator('.wf-step')).toHaveCount(1)
})

/**
 * Confirming one move, and waiting for it to have been made.
 *
 * The move only joins the list of things that have happened once its writes
 * have landed, so waiting for the list to grow avoids a step asserting
 * against the database racing the writes it is asserting about.
 */
When('I say the moved book fitted', async ({ page }) => {
  const done = page.locator('.wf-step', { hasText: 'moved and written down' })
  const made = await done.count()
  await page.getByRole('button', { name: 'Yes, it fit' }).click()
  await expect(done).toHaveCount(made + 1)
})

/** Matched on the whole sentence, including the words that mean the write landed. */
Then(
  'the shuffle should still list {string} carried from {string} to {string}',
  async ({ page }, title: string, from: string, to: string) => {
    await expect(page.locator('.wf-step')).toContainText(
      `${title}: end of ${from} to start of ${to} · moved and written down`,
    )
  },
)

/**
 * The same answer as "there is no room on the shelf", given about a plank the
 * cascade has already reached rather than the one the book started on.
 */
When('I say there is no room on that one either', async ({ page }) => {
  await page.getByRole('button', { name: /^No, .+ is full too$/ }).click()
})

Then(
  'it should say I am placing {string}, {int} books deep',
  async ({ page }, title: string, deep: number) => {
    await expect(page.locator('.shelve__ask'))
      .toContainText(`Placing ${title}, ${deep} books deep`)
  },
)

Then(
  'it should draw the gap for {string} on {string}',
  async ({ page }, title: string, label: string) => {
    await expect(page.locator('.wf-shelf__label')).toHaveText(label)
    await expect(page.locator('.wf-shelf__inhand')).toHaveText(`In your hand: ${title}`)
    await expect(page.locator('.wf-gap')).toBeVisible()
  },
)

/**
 * Read after two animation frames so the row has settled: it scrolls the gap
 * into view as an effect, and the browser's scroll snapping has its own say
 * about where it is allowed to stop.
 */
async function whereTheGapIs(page: Page) {
  await expect(page.locator('.wf-gap')).toBeVisible()
  return page.locator('.wf-gap').evaluate((gap) => new Promise<{
    gapLeft: number; gapRight: number
    visibleLeft: number; visibleRight: number
    rowWidth: number; screenWidth: number
    scrollLeft: number
  }>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const scroller = gap.closest('.wf-shelf__scroll') as HTMLElement
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

/** A row that fits on the screen cannot have its gap anywhere but on screen, so this guards the checks below from proving nothing. */
Then('the shelf drawing should be longer than the screen', async ({ page }) => {
  const seen = await whereTheGapIs(page)
  expect(
    seen.rowWidth,
    `the drawn row is ${seen.rowWidth}px across a ${seen.screenWidth}px screen, so ` +
    'it never needed scrolling and this scenario is not testing what it says',
  ).toBeGreaterThan(seen.screenWidth)
})

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

/** Either marker will do: a capture still being confirmed lands on the editable fields, a catalogued book on its own header. */
When('I go back to the book details', async ({ page }) => {
  await page.getByRole('button', { name: 'Back to book details' }).click()
  await expect(reviewScreen(page).or(bookTitle(page))).toBeVisible()
})

/** Stops on the screen that says where the book went, unlike the step below which carries on to the next book. */
When('I say it fits', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()
  await expect(page.locator('.wf-top__title'))
    .toHaveText('Shelved', { timeout: QUEUE_TIMEOUT })
})

When('I say it fits and save it', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()

  await expect(page.locator('.wf-top__title'))
    .toHaveText('Shelved', { timeout: QUEUE_TIMEOUT })
  await page.getByRole('button', { name: 'Next book' }).click()
  await expect(page.locator('button.wf-shutter')).toBeVisible({ timeout: QUEUE_TIMEOUT })
})

export async function leaveTheCamera(page: Page): Promise<void> {
  // The camera's only way out is the round target in the corner.
  const out = page.locator('.wf-view__leave')
  if (await out.isVisible()) {
    await out.click()
    await expect(homeScreen(page)).toBeVisible()
  }
}

async function openLibrary(page: Page): Promise<void> {
  // A removal reports the books it displaced on the screen it happened on, so
  // navigating away and back would read an empty list and call it a defect.
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
 * Groups and the attention list are filled by the same load, so a rendered
 * shelf means the misfile check has been asked and answered too. Without that
 * wait, "nothing needs attention" would pass on a page that has not finished
 * asking.
 */
async function toTheShelves(page: Page): Promise<void> {
  const groups = page.locator('.shelfgroup').first()
  if (await groups.isVisible()) return

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
    await expect(bookTitle(page)).toHaveText(title)
  },
)

Then(
  'the library should show {string} on shelf {string}',
  async ({ page }, title: string, shelf: string) => {
    await openLibrary(page)

    // The title is carried by the spine's tooltip, not the printed spine text,
    // since there is no room to print it down a spine at that width.
    const area = page.locator(`section.shelfgroup[data-label="${shelf}"]`)
    await expect(area.locator(`button.wf-spine[title*=${JSON.stringify(title)}]`)).toBeVisible()
  },
)

Then('the library should offer no boundary moves', async ({ page }) => {
  await expect(page.locator('.boundary')).toHaveCount(0)
})

/** Filtered to just the "Move it..." buttons, since this checks one book's edges rather than the whole action bar. */
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

When('I choose to move it on to {string}', async ({ page }, label: string) => {
  await page.getByRole('button', { name: `Move it on to ${label}` }).click()
  await expect(page.locator('.shelve__ask')).toBeVisible()
})

When('I choose to move it back to {string}', async ({ page }, label: string) => {
  await page.getByRole('button', { name: `Move it back to ${label}` }).click()
  await expect(page.locator('.shelve__ask')).toBeVisible()
})

/* Waits on the confirmation dialog rather than the shelving step, since this move empties and removes the area. */
When('I choose to move it back to {string}, which empties the area', async (
  { page },
  label: string,
) => {
  await page.getByRole('button', { name: `Move it back to ${label}` }).click()
  await expect(page.locator('.wf-sure')).toBeVisible()
})

Then('it should say that {string} goes with the book', async ({ page }, area: string) => {
  const dialog = page.locator('.wf-sure')

  await expect(dialog).toContainText(`${area} goes when this book leaves it`)
  await expect(dialog).toContainText('an area with no books on it comes off the furniture')
  await expect(dialog.getByRole('button', { name: /^Move it to / })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeVisible()
})

When('I keep the area', async ({ page }) => {
  await page.locator('.wf-sure').getByRole('button', { name: 'Keep it' }).click()
  await expect(page.locator('.wf-sure')).toHaveCount(0)
})

When('I agree that the area goes', async ({ page }) => {
  await page.locator('.wf-sure').getByRole('button', { name: /^Move it to / }).click()
  await expect(page.locator('.wf-sure')).toHaveCount(0)
  await expect(page.locator('.shelve__ask')).toBeVisible()
})

When('I say it fits and finish the move', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()
  await toTheShelves(page)
})

Then('nothing should need attention', async ({ page }) => {
  await expect(page.locator('.attention')).toHaveCount(0)
})

const attentionRow = (page: Page, title: string) =>
  page.locator('.attention__row').filter({ hasText: title })

/** Reads the persistent attention list, not `.tomove`, which is the answer a removal hands back on the screen it happened on. */
Then(
  'the shelves should say {string} was last seen on {string} and belongs on {string}',
  async ({ page }, title: string, from: string, to: string) => {
    await expect(attentionRow(page, title))
      .toContainText(`Last seen on ${from}. The order now puts it on ${to}`)
  },
)

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
  await expect(attentionRow(page, title)).toHaveCount(0)
})

Then('the book should say it is supposed to be moved', async ({ page }) => {
  const notice = page.locator('.wf-amiss')

  await expect(notice).toHaveText('This book is supposed to be moved.')
  await expect(notice.getByRole('button')).toHaveCount(0)
})

/**
 * Arriving on this page schedules a placement read 250ms later, and a browser
 * driven at machine speed presses inside that window. `.placement--stale` is
 * the app saying that read is outstanding, so waiting for it to clear first
 * avoids pressing before the page has caught up with where the book is.
 */
When('I press the notice about moving it', async ({ page }) => {
  await expect(page.locator('.placement--stale')).toHaveCount(0)
  await page.locator('.wf-amiss').click()
  await expect(page.locator('.shelve__ask')).toBeVisible()
})

When('I open {string} from the library', async ({ page }, title: string) => {
  await page.locator(`button.wf-spine[title*=${JSON.stringify(title)}]`).first().click()
  await expect(bookTitle(page)).toHaveText(title)
})

When('I start editing the details', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit details' }).click()
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
})

/** Exact, since "Title" also matches "Subtitle" loosely. */
When('I set {string} to {string}', async ({ page }, label: string, value: string) => {
  await page.getByLabel(label, { exact: true }).fill(value)
})

Then('the page should say nothing about what deleting does', async ({ page }) => {
  await expect(
    page.getByRole('button', { name: 'Delete this book and its photos' }),
  ).toBeVisible()
  await expect(page.locator('.wf-screen__body')).not.toContainText('off disk')
  await expect(page.locator('.wf-screen__body')).not.toContainText('put them back')
})

When('I ask to delete the book', async ({ page }) => {
  await page.getByRole('button', { name: 'Delete this book and its photos' }).click()
  await expect(page.locator('.wf-sure')).toBeVisible()
})

Then('the dialog should say what is lost and that nothing can put it back', async ({ page }) => {
  const dialog = page.locator('.wf-sure')

  await expect(dialog).toContainText('It goes out of the catalogue')
  await expect(dialog).toContainText('photographs are deleted from disk')
  await expect(dialog).toContainText('Nothing here can put either back')
  await expect(dialog.getByRole('button', { name: 'Delete book' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeVisible()
})

When('I keep the book', async ({ page }) => {
  await page.locator('.wf-sure').getByRole('button', { name: 'Keep it' }).click()
  await expect(page.locator('.wf-sure')).toHaveCount(0)
})

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
  await page.getByRole('button', { name: /Read the barcode/ }).click()
  // The ISBN on the screen underneath is drawn, not a textbox, so this names
  // exactly the prompt's own field.
  await page.getByRole('textbox', { name: 'ISBN' }).fill(target.isbn13)
  await page.getByRole('button', { name: 'Look up and replace' }).click()
})

/** Named rather than fixed to "Save changes": which button saves depends on which book is on screen. */
Then(
  '{string} should be unavailable while the lookup runs',
  async ({ page }, label: string) => {
    // Short and explicit rather than the suite's default 30s: this is either
    // already true or never becomes true, and a regression should say so in
    // seconds.
    await expect(page.getByRole('button', { name: label })).toBeDisabled({ timeout: 2_000 })
  },
)

/** See "I arm a slow lookup" in catalogue.steps.ts for the delay this waits out. */
Then(
  '{string} should be available again once the lookup answers',
  async ({ page }, label: string) => {
    await expect(page.getByRole('button', { name: label }))
      .toBeEnabled({ timeout: 10_000 })
  },
)

When('I save the changes', async ({ page }) => {
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible()
})

/** Read off the DOM in document order rather than by querying each kind of element separately, since the order is the claim. */
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

/** Deliberately positional: a boundary is the gap between two planks, so the line above the named area is the one meant. */
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
    /* Two presses: removing a boundary hands its area's books to the area in front, so the first press asks and the second confirms. */
    await page.getByRole('dialog').getByRole('button', { name: 'Remove it' }).click()
    // Waiting on the line count rather than the moves panel, since a removal does not always move a book.
    await expect(page.locator('.divider')).toHaveCount(drawn - 1)
  },
)

When(
  'I press Remove on the boundary drawn above {string}',
  async ({ page }, area: string) => {
    const line = page.locator(
      `xpath=//section[contains(@class,"shelfgroup")][@data-label=${JSON.stringify(area)}]`
      + '/preceding-sibling::*[1]',
    )
    await expect(line, `nothing is drawn above ${area}`).toHaveClass(/divider/)
    await line.getByRole('button', { name: 'Remove' }).click()
  },
)

Then('I should be asked {string}', async ({ page }, question: string) => {
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-label', question)
})

When('I keep it', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Keep it' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

/** The book and the two planks are read as separate elements rather than one line of text glued together with a colon. */
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

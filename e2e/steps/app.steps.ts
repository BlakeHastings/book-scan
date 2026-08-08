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

When('I open the app', async ({ page, webUrl }) => {
  await page.goto(webUrl)
  await expect(page.locator('.tile__title', { hasText: 'Add' })).toBeVisible()
})

/**
 * The one way in for a book the catalogue already has.
 *
 * Two taps: the tile, then the shutter. The wait between them is a wait on a
 * frame arriving, same as the cataloguing camera, because a shutter pressed
 * before the fake device has delivered anything photographs an empty canvas.
 */
When('I scan the book', async ({ page }) => {
  await page.locator('button.tile', { hasText: 'Scan' }).click()
  await expect
    .poll(
      () => page.locator('video.isbncam__video').evaluate(
        (video) => (video as HTMLVideoElement).videoWidth,
      ),
      { message: 'the fake camera never produced a frame' },
    )
    .toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Scan', exact: true }).click()
})

Then('it should open the book {string}', async ({ page }, title: string) => {
  await expect(page.locator('.detail__title')).toHaveText(title, { timeout: QUEUE_TIMEOUT })
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
  await expect(page.locator('.actions--top .btn')).toHaveText(wanted)
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
  await expect(page.locator('video.isbncam__video')).toBeVisible({ timeout: QUEUE_TIMEOUT })
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
  await expect(page.locator('.shelfgroup').first()).toBeVisible({ timeout: QUEUE_TIMEOUT })
})

When('I start the camera', async ({ page }) => {
  await page.locator('button.tile', { hasText: 'Add' }).click()
  await page.getByRole('button', { name: 'Start camera' }).click()

  // The fake device is a file, so the first frame arrives almost at once. What
  // matters is that a frame arrived at all: without one the shutter draws an
  // empty canvas, and the failure would surface much later as a photograph the
  // server cannot read.
  await expect
    .poll(
      () => page.locator('video.cam__video').evaluate(
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
  await expect(page.locator('.cam__chip--on')).toContainText('Back')
  await page.locator('button.shutter').click()
})

Then('the camera should recognise the book as {string}', async ({ page }, title: string) => {
  await expect(page.locator('.cam__found')).toContainText(title, { timeout: QUEUE_TIMEOUT })
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
  await page.locator('button.cam__next').click()
  await expect(page.locator('.cam__found--empty')).toBeVisible()
})

When('I review what it found', async ({ page }) => {
  const review = page.locator('button.cam__review')
  await expect(review).toBeEnabled({ timeout: QUEUE_TIMEOUT })
  await review.click()
  await expect(page.locator('.review')).toBeVisible()
})

Then('the review screen should show:', async ({ page }, table: DataTable) => {
  for (const [label, value] of Object.entries(table.rowsHash())) {
    // Exact, because the fields are labelled by wrapping <label> elements and
    // a loose match for "Title" also finds "Subtitle".
    await expect(page.getByLabel(label, { exact: true }), `the "${label}" field`)
      .toHaveValue(value)
  }
})

Then('the ISBN should read {string}', async ({ page }, isbn: string) => {
  await expect(page.locator('.isbn-block__number')).toHaveText(isbn)
})

/**
 * The provenance, on screen. It is drawn only when there is a source to draw,
 * so an absent line and a wrong line fail the same way here, which is what is
 * wanted: a book whose reading nobody recorded is the bug.
 */
Then('the ISBN should say it was read from {string}', async ({ page }, source: string) => {
  await expect(page.locator('.isbn-block__source')).toHaveText(`read from ${source}`)
})

When('I confirm the details and go to shelve it', async ({ page }) => {
  await page.getByRole('button', { name: 'Looks right, shelve it' }).click()
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
  await expect(page.locator('.review, .detail__head')).toBeVisible()
})

When('I say it fits and save it', async ({ page }) => {
  await page.getByRole('button', { name: 'It fits, save' }).click()

  // Saving a new book hands the screen back to the camera for the next one, so
  // the shutter reappearing is how the app says it is done.
  await expect(page.locator('button.shutter')).toBeVisible({ timeout: QUEUE_TIMEOUT })
})

/**
 * To the library from wherever this scenario happens to be.
 *
 * Three ways in, because the library is reachable from the camera, the home
 * tiles and the header, and which one is on screen depends on what the
 * scenario just did rather than on anything it says.
 */
async function openLibrary(page: Page): Promise<void> {
  for (const entry of [
    page.locator('button.cam__chip-btn', { hasText: 'Library' }),
    page.locator('button.tile', { hasText: 'Library' }),
    page.locator('nav button.tab', { hasText: 'Library' }),
  ]) {
    if (await entry.isVisible()) {
      await entry.click()
      break
    }
  }

  // Groups and the attention list are filled by the same load, so a rendered
  // shelf means the misfile check has been asked and answered too. Without
  // this wait, "nothing needs attention" would pass on a page that has not
  // finished asking.
  await expect(page.locator('.shelfgroup').first()).toBeVisible()
}

When('I go to the library', async ({ page }) => {
  await openLibrary(page)
})

When(
  'I open {string} from the off-bookcase list',
  async ({ page }, title: string) => {
    await page.locator('button.offshelf__row', { hasText: title }).click()
    // A catalogued book opens as a record, not as the editable form, so the
    // heading is what says the right book is on screen.
    await expect(page.locator('.detail__title')).toHaveText(title)
  },
)

Then(
  'the library should show {string} on shelf {string}',
  async ({ page }, title: string, shelf: string) => {
    // Reached from the camera, which is where somebody scanning a pile is.
    const library = page.locator('button.cam__chip-btn', { hasText: 'Library' })
    if (await library.isVisible()) await library.click()

    // The library draws each area as a run of spines now, so a book is in
    // the right place when its spine is inside that area's section. The
    // spine's tooltip is what carries the title: at 34px wide there is no
    // room to print it, which is also true of the shelf itself.
    const area = page.locator(`section.shelfgroup[data-label="${shelf}"]`)
    await expect(area.locator(`button.spine[title*=${JSON.stringify(title)}]`)).toBeVisible()
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
    await expect(
      page.locator('.actions--top .btn').filter({ hasText: /^Move it / }),
    ).toHaveText(wanted)
  },
)

Then('the book should not offer to move it', async ({ page }) => {
  await expect(
    page.locator('.actions--top .btn').filter({ hasText: /^Move it / }),
  ).toHaveCount(0)
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
  await expect(page.locator('.shelfgroup').first()).toBeVisible()
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
 * A catalogued book opened by tapping its spine in the shelf drawing, rather
 * than the off-bookcase list `openLibrary` above already covers. Same
 * destination, a different route in.
 */
When('I open {string} from the library', async ({ page }, title: string) => {
  await page.locator(`button.spine[title*=${JSON.stringify(title)}]`).first().click()
  await expect(page.locator('.detail__title')).toHaveText(title)
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
  await page.getByRole('button', { name: 'Change ISBN' }).click()
  await page.locator('.isbn-input input').fill(target.isbn13)
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
 * The library read down the page: every area heading and every boundary line,
 * in the order somebody scrolling meets them.
 *
 * Read off the DOM in document order rather than by querying each kind of
 * element separately, because the order is the claim. #145 was a set of lines
 * every one of which was correct in isolation and drawn one area too low.
 */
Then(
  'the library should read, top to bottom:',
  async ({ page }, table: DataTable) => {
    const wanted = table.raw().map((row) => row[0] ?? '')

    const lines = await page.evaluate(() => {
      const main = document.querySelector('main.main--library')
      if (!main) return []

      const text = (element: Element, selector: string) =>
        element.querySelector(selector)?.textContent?.trim() ?? ''

      return [...main.children].flatMap((element) => {
        if (element.classList.contains('divider')) {
          return [text(element, '.divider__label')]
        }
        if (element.classList.contains('shelfgroup')) {
          return [
            `${text(element, '.shelfgroup__label')} ${text(element, '.shelfgroup__shelf')}`,
          ]
        }
        return []
      })
    })

    expect(lines).toEqual(wanted)
  },
)

/**
 * Tap Remove on the line drawn immediately above a named heading.
 *
 * Deliberately positional. Somebody adjusting the shelves is pointing at the
 * gap between two planks, and the whole of #145 was that the line sitting in
 * that gap deleted a boundary from somewhere else. Naming the heading and
 * stepping back one element is how that tap is reproduced.
 */
When(
  'I remove the boundary drawn above {string}',
  async ({ page }, heading: string) => {
    const parts = /^(Bookcase \d+) (Area \w+)$/.exec(heading)
    expect(parts, `"${heading}" is not an area heading`).toBeTruthy()
    const [, bookcase, area] = parts!

    const line = page.locator(
      'xpath=//section[contains(@class,"shelfgroup")]' +
      `[.//span[normalize-space()="${bookcase}"] and .//span[normalize-space()="${area}"]]` +
      '/preceding-sibling::*[1]',
    )
    await expect(line, `nothing is drawn above ${heading}`).toHaveClass(/divider/)

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
 */
Then('it should say to move exactly:', async ({ page }, table: DataTable) => {
  const wanted = table.hashes().map((row) => `${row.book}: ${row.from} to ${row.to}`)
  await expect(page.locator('.moves li')).toHaveText(wanted)
})

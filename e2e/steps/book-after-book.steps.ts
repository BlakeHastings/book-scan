/**
 * Photographing one book after another, with the server slow or refusing.
 *
 * The request is held or refused in the browser with `page.route` rather than
 * by stopping the api, so the step decides exactly when a photograph arrives
 * and nothing else on the machine is disturbed. A refusal is answered the way
 * a proxy in front of a restarting server answers: 502 with an HTML body,
 * which is what `lib/api.ts` meets on a deployment rather than a JSON error.
 */

import { expect, type Page, type Route } from '@playwright/test'

import { Then, When } from './fixtures.js'

const PHOTOGRAPHS = '**/api/captures'

const BAD_GATEWAY = {
  status: 502,
  contentType: 'text/html',
  body: '<html><body><h1>502 Bad Gateway</h1></body></html>',
}

/** Reading a photograph and writing it down are background work. Seconds, not milliseconds. */
const ARRIVAL_TIMEOUT = 60 * 1000

/** Module scope is per worker and so per scenario; see `catalogue.steps.ts`. */
let release: (() => void) | null = null

function isUpload(route: Route): boolean {
  return route.request().method() === 'POST'
}

/** Two frames, so whatever a response set has been drawn before anything is asserted about it. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

When('the server is slow to take the next photograph', async ({ page }) => {
  let held = false
  await page.route(PHOTOGRAPHS, async (route) => {
    if (!isUpload(route) || held) return route.fallback()
    held = true
    await new Promise<void>((resolve) => { release = resolve })
    await route.continue()
  })
})

When('the photograph arrives at last', async ({ page }) => {
  expect(release, 'no photograph was held back').toBeTruthy()
  const arrived = page.waitForResponse(
    (response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/captures',
  )
  release!()
  await (await arrived).finished()
  await settled(page)
})

/** Watched from the page itself, so a banner drawn and taken down between two steps is still seen. */
async function watchForErrors(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = window as unknown as { cameraErrors: string[] }
    seen.cameraErrors = []
    new MutationObserver(() => {
      const banner = document.querySelector('.cam__error')
      if (banner && !seen.cameraErrors.includes(banner.textContent ?? '')) {
        seen.cameraErrors.push(banner.textContent ?? '')
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
}

When('the server answers the next photograph with a bad gateway once', async ({ page }) => {
  await watchForErrors(page)
  let refused = false
  await page.route(PHOTOGRAPHS, async (route) => {
    if (!isUpload(route) || refused) return route.fallback()
    refused = true
    await route.fulfill(BAD_GATEWAY)
  })
})

When('the server answers every photograph with a bad gateway', async ({ page }) => {
  await page.route(PHOTOGRAPHS, async (route) => {
    if (!isUpload(route)) return route.fallback()
    await route.fulfill(BAD_GATEWAY)
  })
})

When('the server comes back', async ({ page }) => {
  await page.unroute(PHOTOGRAPHS)
})

Then('the camera should be holding nothing', async ({ page }) => {
  await expect(page.locator('.wf-view__found--empty')).toBeVisible()
  await expect(page.locator('.wf-shot__img')).toHaveCount(0)
  await expect(page.locator('.wf-shot--next')).toContainText('Back')
})

Then('the camera should say the back cover did not reach the server', async ({ page }) => {
  await expect(page.locator('.cam__error'))
    .toContainText('The back cover did not reach the server', { timeout: ARRIVAL_TIMEOUT })
  await expect(page.locator('.cam__error')).toContainText('Take it again')
})

Then('the camera should not be showing an error', async ({ page }) => {
  await expect(page.locator('.cam__error')).toHaveCount(0)
})

Then('the camera should not have shown an error', async ({ page }) => {
  const shown = await page.evaluate(
    () => (window as unknown as { cameraErrors?: string[] }).cameraErrors ?? [],
  )
  expect(shown, 'the camera showed an error').toEqual([])
  await expect(page.locator('.cam__error')).toHaveCount(0)
})

/**
 * Polled, since the last photograph is still being written when the step
 * starts. A book holding the right photographs once is the whole answer: a
 * second capture, or a second row on the first, both fail it.
 */
Then(
  'the queue should hold {int} book(s) with one back photograph each',
  async ({ catalogue }, count: number) => {
    await expect
      .poll(
        async () => {
          const captures = await catalogue.captures()
          const kinds = await catalogue.photographKinds(captures.map((capture) => capture.id))
          return [...kinds.values()].map((each) => each.join(','))
        },
        { message: 'the queue never held the photographs it should', timeout: ARRIVAL_TIMEOUT },
      )
      .toEqual(Array.from({ length: count }, () => 'back'))
  },
)

/** What the save carried, per scenario like `release` above. */
let saved: Record<string, unknown> | null = null

When('I watch what the save sends', async ({ page }) => {
  saved = null
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/books') return
    saved = request.postDataJSON() as Record<string, unknown>
  })
})

/** The server would now refuse to write them twice, so only the request itself can show the client sent them. */
Then('the save should not have sent any photograph again', async () => {
  expect(saved, 'no save was seen').toBeTruthy()
  expect(saved!.captureId, 'the save named no capture').toBeTruthy()
  const images = (saved!.images ?? {}) as Record<string, unknown>
  expect(Object.keys(images).filter((slot) => images[slot]), 'photographs sent with the save').toEqual([])
})

/** The queue reads a photograph in the background, OCR included. Seconds, not milliseconds. */
const READING_TIMEOUT = 90 * 1000

Then('the camera should say it has read no ISBN yet', async ({ page }) => {
  await expect(page.locator('.wf-view__found'))
    .toContainText('No ISBN read yet', { timeout: READING_TIMEOUT })
})

When('I finish with the book without an ISBN', async ({ page }) => {
  const done = page.getByRole('button', { name: 'Done with this book' })
  await expect(done).toBeEnabled({ timeout: READING_TIMEOUT })
  await done.click()
})

Then('review should carry what the queue said about the photographs', async ({ page }) => {
  await expect(page.locator('.evidence')).toContainText('No ISBN')
})

Then(
  '{string} should hold one back, one front and one spine photograph',
  async ({ catalogue }, title: string) => {
    const book = await catalogue.bookByTitle(title)
    expect(book, `no book called "${title}" is catalogued`).toBeTruthy()

    const kinds = (await catalogue.photographKinds([book!.id])).get(book!.id) ?? []
    expect([...kinds].sort(), `the photographs "${title}" holds`)
      .toEqual(['back', 'front', 'spine'])
  },
)

/**
 * The world a step runs in.
 *
 * Three things beyond the browser: the database the app is writing to, the API
 * (for setting a scenario up without driving the camera through it), and the
 * address of the app itself. All three are discovered by global setup, since
 * Aspire assigns the ports.
 */

import { test as base, createBdd } from 'playwright-bdd'

import { Catalogue } from '../support/database.js'
import { describeCommitment } from '../support/machine.js'

function fromEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. It is set by global-setup.ts once Aspire has ` +
      'assigned the ports, so this means setup did not run or did not finish.',
    )
  }
  return value
}

export interface Fixtures {
  /**
   * Nothing a step uses. It watches the page and speaks only on a red scenario.
   *
   * ## Why a blank page had to start explaining itself (#448)
   *
   * A scenario that fails on `expect(locator).toBeVisible()` says the element
   * was not there and stops. When the reason is that two of the sixty module
   * requests behind that page were refused by the network stack, the person
   * reading the failure is told about a heading and not about the page never
   * having loaded, and the honest conclusions available to them are "the app is
   * broken" and "the suite is flaky". Both are wrong and one of them ends in
   * pressing re-run, which is the habit #448 is about.
   *
   * So every console error, every page error, every request the browser gave up
   * on, and the crash of a page or a whole context are collected for the length
   * of a scenario and printed **only if that scenario fails**, with the
   * machine's committed memory beside them. A green run says nothing new.
   */
  browserTrouble: void
  /** The app's Postgres catalogue, so a scenario can start clean and look. */
  catalogue: Catalogue
  /** Base URL of the API, for seeding shelves without photographing them. */
  apiUrl: string
  /** Base URL of the page under test. */
  webUrl: string
  /** Base URL of the catalogue stub's own control plane, see catalogue-stub.ts. */
  stubUrl: string
}

export const test = base.extend<Fixtures>({
  browserTrouble: [async ({ page }, use, testInfo) => {
    const trouble: string[] = []
    const note = (line: string) => {
      // A page that cannot load says the same thing sixty times. The reader
      // needs the shape of it, not every instance.
      if (trouble.length < 40) trouble.push(line)
    }

    page.on('console', (message) => {
      if (message.type() === 'error') note(`console error: ${message.text()}`)
    })
    page.on('pageerror', (error) => note(`page error: ${error.message}`))
    page.on('requestfailed', (request) => {
      note(`request failed: ${request.failure()?.errorText ?? 'no reason given'} ${request.url()}`)
    })
    page.on('crash', () => note('the page crashed'))
    page.context().on('close', () => {
      if (page.isClosed()) return
      note('the browser context closed while the scenario was still running')
    })

    await use()

    if (testInfo.status === testInfo.expectedStatus) return

    const said = describeCommitment()
    const lines = [
      ...(trouble.length
        ? ['[e2e] what the browser reported during this scenario:', ...trouble.map((l) => `  ${l}`)]
        : ['[e2e] the browser reported no console error and no failed request.']),
      ...(said ? [`[e2e] ${said}`] : []),
    ]
    console.log(lines.join('\n'))
    await testInfo.attach('browser trouble', {
      body: lines.join('\n'),
      contentType: 'text/plain',
    })
  }, { auto: true }],

  catalogue: async ({}, use) => {
    const catalogue = new Catalogue(
      fromEnvironment('BOOKSCAN_E2E_DB'),
      fromEnvironment('BOOKSCAN_E2E_COVERS'),
    )
    try {
      await use(catalogue)
    } finally {
      // A pool left open holds the worker alive after the last scenario, which
      // reads as a hung run rather than as a leaked connection.
      await catalogue.close()
    }
  },

  apiUrl: async ({}, use) => {
    await use(fromEnvironment('BOOKSCAN_E2E_API_URL'))
  },

  webUrl: async ({}, use) => {
    await use(fromEnvironment('BOOKSCAN_E2E_WEB_URL'))
  },

  stubUrl: async ({}, use) => {
    await use(fromEnvironment('BOOKSCAN_E2E_STUB_URL'))
  },
})

export const { Given, When, Then, Before, After } = createBdd(test)

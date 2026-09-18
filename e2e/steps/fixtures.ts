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
   * Nothing a step uses directly: it watches the page and speaks only on a
   * red scenario.
   *
   * Every console error, page error, abandoned request, response of 400 or
   * worse, and page or context crash are collected for the scenario and
   * printed only if it fails, alongside the machine's committed memory. A
   * green run says nothing new.
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

/**
 * The suite arrives signed in, in both of the ways it talks to the app.
 *
 * A cookie is put on the context (not the page), so every page a scenario
 * opens has it. `fetch` is wrapped once, rather than editing the many call
 * sites across the step files that call it directly, and attaches the cookie
 * only to requests at the api's own origin: the catalogue stub's control
 * plane and every other address are untouched.
 */
function attachTheSession(): void {
  const apiUrl = process.env.BOOKSCAN_E2E_API_URL
  const session = process.env.BOOKSCAN_E2E_SESSION
  if (!apiUrl || !session) return

  const underneath = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!target.startsWith(apiUrl)) return underneath(input as RequestInfo, init)
    return underneath(input as RequestInfo, {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), cookie: session },
    })
  }) as typeof fetch
}

attachTheSession()

export const test = base.extend<Fixtures>({
  context: async ({ context }, use) => {
    const session = fromEnvironment('BOOKSCAN_E2E_SESSION')
    const [name, value] = session.split('=')
    await context.addCookies([{
      name: name ?? '',
      value: value ?? '',
      url: fromEnvironment('BOOKSCAN_E2E_WEB_URL'),
      httpOnly: true,
      // The dev server speaks HTTPS, so a `Secure` cookie is storable there,
      // which is the same attribute the server sets it with.
      secure: true,
      sameSite: 'Lax',
    }])
    await use(context)
  },

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
    /*
     * A request that arrived and was refused: the half `requestfailed` cannot
     * see. That event fires only when the network gave up; a 500 from Vite's
     * proxy or a 401 from the gate is a successful round trip as far as the
     * browser is concerned, and `fetch` resolves normally.
     */
    page.on('response', (response) => {
      if (response.status() < 400) return
      note(`answered ${response.status()}: ${response.url()}`)
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

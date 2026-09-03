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
 * The suite arrives signed in, in both of the ways it talks to the app (#521).
 *
 * Every route under `/api` is behind the gate: the browser's requests for
 * screens and photographs, and the direct `fetch(apiUrl, ...)` calls the steps
 * below use to set a scenario up without photographing forty books through the
 * camera. Both have to carry the session `global-setup.ts` obtained through
 * `GET /api/auth/dev/start`.
 *
 * ## The browser half
 *
 * A cookie put on the context, which is what a browser that had walked the
 * sign-in itself would be holding. `context` rather than `page`, so every page
 * a scenario opens has it.
 *
 * ## The `fetch` half, and why it is a wrapper rather than thirty edits
 *
 * Twenty-eight call sites across the step files write
 * `fetch(`${apiUrl}/api/...`)` directly, and adding a header to each is
 * twenty-eight chances to miss one — where missing one shows up as a scenario
 * failing for a reason that looks nothing like a missing cookie. So the header
 * is attached in one place, to requests at the api's own origin and to nothing
 * else: the catalogue stub's control plane and every other address are
 * untouched.
 *
 * This is the suite behaving like the browser beside it rather than a
 * convenience. A step that could reach the API without a session would be
 * setting scenarios up through a door the app does not have.
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

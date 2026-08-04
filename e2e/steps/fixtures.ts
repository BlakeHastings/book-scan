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
  /** The app's SQLite file, opened read-write so a scenario can start clean. */
  catalogue: Catalogue
  /** Base URL of the API, for seeding shelves without photographing them. */
  apiUrl: string
  /** Base URL of the page under test. */
  webUrl: string
  /** Base URL of the catalogue stub's own control plane, see catalogue-stub.ts. */
  stubUrl: string
}

export const test = base.extend<Fixtures>({
  catalogue: async ({}, use) => {
    const catalogue = new Catalogue(fromEnvironment('BOOKSCAN_E2E_DB'))
    await use(catalogue)
    catalogue.close()
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

/**
 * Everything that has to exist before the first scenario, and be taken down
 * after the last one.
 *
 *   1. the camera video, so Chromium has a book to look at
 *   2. the catalogue stub, so no lookup leaves this machine
 *   3. the app, started through Aspire with both of those wired in
 *
 * The URLs and the database path are discovered here and handed to the test
 * workers through the environment, because Aspire assigns the ports and this
 * suite must never assume 5173 or 3001.
 */

import type { FullConfig } from '@playwright/test'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { WEB_ROOT } from './support/paths.js'
import { BOOK_IN_HAND } from './support/books.js'
import { ensureCameraVideo } from './support/camera-fixture.js'
import { startCatalogueStub, type CatalogueStub } from './support/catalogue-stub.js'
import {
  describeResources, startAppHost, stopAppHost, urlOf, waitForResource,
} from './support/aspire.js'

/**
 * A directory of this run's own.
 *
 * The AppHost turns this into `web/data/e2e/<id>`. It is deliberately not
 * BOOKSCAN_DATA: that variable is the one thing standing between a dev server
 * and the owner's real catalogue, and nothing in this repository sets it. The
 * AppHost keeps sole authority over where the data goes, and all this does is
 * ask for a subdirectory beneath the one it already chose.
 */
function runId(): string {
  return `run-${Date.now().toString(36)}`
}

/**
 * Throw away what earlier runs left behind.
 *
 * Every run gets a directory of its own, which is the right trade for
 * isolation and the wrong one for disk: a database and a pile of cover
 * photographs per run, forever. Nothing reads a finished run's data, so the
 * previous ones go before this one starts, while the app is not yet holding
 * any of it open.
 *
 * The path is built here from the checkout, never from an environment
 * variable, so this cannot be pointed anywhere but at scratch data inside
 * `web/data/e2e`.
 */
function pruneOldRuns(): void {
  const root = join(WEB_ROOT, 'data', 'e2e')
  if (!existsSync(root)) return

  for (const entry of readdirSync(root)) {
    try {
      rmSync(join(root, entry), { recursive: true, force: true })
    } catch {
      // A run that is somehow still held open is not worth failing over.
    }
  }
}

let stub: CatalogueStub | null = null

async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const started = Date.now()
  const say = (message: string) => console.log(`[e2e] ${message}`)

  pruneOldRuns()

  say(`generating the camera video for ${BOOK_IN_HAND.isbn13}`)
  await ensureCameraVideo(BOOK_IN_HAND.isbn13)

  stub = await startCatalogueStub()
  say(`catalogue stub on ${stub.url}`)

  const id = runId()
  say(`starting the app through Aspire (data in web/data/e2e/${id})`)
  await startAppHost({
    BOOKSCAN_E2E_RUN: id,
    BOOKSCAN_OPENLIBRARY_URL: stub.url,
    BOOKSCAN_GOOGLE_BOOKS_URL: stub.url,
    BOOKSCAN_COVERS_URL: stub.url,
  })

  await waitForResource('api')
  await waitForResource('web')

  const resources = await describeResources()
  const apiUrl = urlOf(resources, 'api', 'http')
  // Vite terminates TLS itself, so the page is https even though Aspire
  // describes the endpoint as http. See urlOf.
  const webUrl = urlOf(resources, 'web', 'https')

  // The server is the authority on which database it opened. Asking it beats
  // rebuilding the path here and hoping the two agree.
  const health = await fetch(`${apiUrl}/api/health`).then((r) => r.json()) as {
    db: string
  }

  process.env.BOOKSCAN_E2E_WEB_URL = webUrl
  process.env.BOOKSCAN_E2E_API_URL = apiUrl
  process.env.BOOKSCAN_E2E_DB = health.db

  say(`web ${webUrl}`)
  say(`api ${apiUrl}`)
  say(`db  ${health.db}`)
  say(`ready in ${Math.round((Date.now() - started) / 1000)}s`)

  return async () => {
    // Only this AppHost. Other Aspire apps belonging to other projects are
    // commonly running on the same machine.
    await stopAppHost().catch((error: Error) => {
      console.error(`[e2e] aspire stop failed: ${error.message}`)
    })
    if (stub?.unknown.length) {
      console.warn(`[e2e] the app asked the stub for: ${stub.unknown.join(', ')}`)
    }
    await stub?.close()
  }
}

export default globalSetup

/**
 * The URLs and the database path are discovered here and handed to the test
 * workers through the environment, because Aspire assigns the ports and this
 * suite must never assume fixed ports.
 */

import type { FullConfig } from '@playwright/test'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

import { connectionConfig, describeConnection } from './support/database.js'
import { describeCommitment } from './support/machine.js'

import { WEB_ROOT } from './support/paths.js'
import { BOOK_IN_HAND } from './support/books.js'
import { ensureCameraVideo, ensureFrontCameraVideo } from './support/camera-fixture.js'
import { startCatalogueStub, type CatalogueStub } from './support/catalogue-stub.js'
import {
  START_BUDGET_SECONDS,
  describeResources, reportResourceState, startAppHost, stopAppHost, urlOf, waitForResource,
} from './support/aspire.js'

/** Deliberately sets neither BOOKSCAN_DATA nor a connection string: the AppHost keeps sole authority over both. */
function runId(): string {
  return `run-${Date.now().toString(36)}`
}

/** Built from the checkout, never from an environment variable, so this cannot be pointed anywhere but at scratch data inside `web/data/e2e`. */
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

/** Deliberately narrow: drops only databases matching the `bookscan_run_%` pattern this file's `runId` produces, and never the current run's own. */
async function pruneOldDatabases(connection: string, keep: string): Promise<string[]> {
  const config = connectionConfig(connection)
  // The maintenance database, because a session cannot drop the database it is
  // connected to.
  const admin = new pg.Client({ ...config, database: 'postgres' })
  const dropped: string[] = []
  try {
    await admin.connect()
    const { rows } = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'bookscan\\_run\\_%' AND datname <> $1",
      [keep],
    )
    for (const { datname } of rows) {
      try {
        // Identifiers cannot be parameters, and these names came out of
        // pg_database rather than from anywhere a value could be injected.
        await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`)
        dropped.push(datname)
      } catch {
        // Somebody else's run may still hold it. Theirs to clean up.
      }
    }
  } catch (error) {
    console.warn(`[e2e] could not prune old run databases: ${(error as Error).message}`)
  } finally {
    await admin.end().catch(() => {})
  }
  return dropped
}

/** `aspire wait` reports only that a resource failed to start, never why, so the resource's own output is the only place the reason can be. */
async function waitForHealthy(name: string): Promise<void> {
  try {
    await waitForResource(name)
  } catch (error) {
    await reportResourceState(name)
    throw error
  }
}

let stub: CatalogueStub | null = null

async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const started = Date.now()
  const say = (message: string) => console.log(`[e2e] ${message}`)

  const headroom = describeCommitment()
  if (headroom) say(headroom)

  pruneOldRuns()

  say(`generating the camera video for ${BOOK_IN_HAND.isbn13}`)
  await ensureCameraVideo(BOOK_IN_HAND.isbn13)
  // Generated here rather than lazily: Chromium is handed the path on the
  // command line, and a missing file makes getUserMedia fail in a way that
  // reads as a broken app.
  say(`generating the front cover video for ${BOOK_IN_HAND.title}`)
  await ensureFrontCameraVideo(BOOK_IN_HAND.title, BOOK_IN_HAND.authors[0]!)

  stub = await startCatalogueStub()
  say(`catalogue stub on ${stub.url}`)

  const id = runId()
  say(`starting the app through Aspire (data in web/data/e2e/${id})`)
  await startAppHost({
    BOOKSCAN_E2E_RUN: id,
    BOOKSCAN_OPENLIBRARY_URL: stub.url,
    BOOKSCAN_GOOGLE_BOOKS_URL: stub.url,
    BOOKSCAN_COVERS_URL: stub.url,
    // Left unset, these default to the real Library of Congress and k10plus,
    // and this suite must never talk to either.
    BOOKSCAN_LOC_SRU_URL: `${stub.url}/sru/lcdb`,
    BOOKSCAN_K10PLUS_SRU_URL: `${stub.url}/sru/k10plus`,
  })

  await waitForHealthy('api')
  await waitForHealthy('web')

  const resources = await describeResources()
  const apiUrl = urlOf(resources, 'api', 'http')
  // Vite terminates TLS itself, so the page is https even though Aspire
  // describes the endpoint as http. See urlOf.
  const webUrl = urlOf(resources, 'web', 'https')

  /*
   * Read out of the api resource's own environment: /api/health deliberately
   * reports no credentials, since a password there is a password in every log
   * that scrapes it.
   */
  const api = resources.find((resource) => resource.displayName === 'api')
  const connection = api?.environment?.ConnectionStrings__bookscan
  const dataDir = api?.environment?.BOOKSCAN_DATA
  if (!connection || !dataDir) {
    throw new Error(
      'The api resource has no ConnectionStrings__bookscan or no BOOKSCAN_DATA. ' +
      'Both are set by apphost.mts, so this means the AppHost is not the one ' +
      `this suite expects. Saw: ${Object.keys(api?.environment ?? {}).join(', ')}`,
    )
  }

  /*
   * Obtained through the real door: `apphost.mts` sets `BOOKSCAN_DEV_SIGN_IN`,
   * and `GET /api/auth/dev/start` walks the same steps Google's callback walks.
   * Nothing here writes a session into the database by hand.
   */
  const signedIn = await fetch(`${apiUrl}/api/auth/dev/start`, { redirect: 'manual' })
  const session = (signedIn.headers.get('set-cookie') ?? '')
    .split(/,(?=[^;]+=)/)
    .map((one) => one.trim().split(';')[0] ?? '')
    .find((pair) => pair.startsWith('bookscan_session='))
  if (!session) {
    throw new Error(
      'The api did not hand out a session at /api/auth/dev/start. That door is ' +
      'opened by BOOKSCAN_DEV_SIGN_IN, which apphost.mts sets, so this means the ' +
      `AppHost is not the one this suite expects. It answered ${signedIn.status}.`,
    )
  }

  // Asked as a check, not the source: if it opened something other than what
  // the AppHost handed it, every assertion below would run against the wrong
  // database.
  const health = await fetch(`${apiUrl}/api/health`, { headers: { cookie: session } })
    .then((r) => r.json()) as { db: string }
  const described = describeConnection(connection)
  if (health.db !== described) {
    throw new Error(
      `The api opened ${health.db}, not ${described}. The suite would be ` +
      'reading a different database from the one under test.',
    )
  }

  const dropped = await pruneOldDatabases(connection, `bookscan_${id.replace(/-/g, '_')}`)
  if (dropped.length) say(`dropped ${dropped.length} database(s) from earlier runs`)

  process.env.BOOKSCAN_E2E_WEB_URL = webUrl
  process.env.BOOKSCAN_E2E_API_URL = apiUrl
  // In the shape a `Cookie:` header wants it. See `steps/fixtures.ts`, which
  // puts it in the browser.
  process.env.BOOKSCAN_E2E_SESSION = session
  process.env.BOOKSCAN_E2E_DB = connection
  process.env.BOOKSCAN_E2E_COVERS = join(dataDir, 'covers')
  // Not one of the BOOKSCAN_*_URL variables: those tell the API where
  // catalogues live, this tells a test where the stub's control plane lives,
  // and the app itself never touches it.
  process.env.BOOKSCAN_E2E_STUB_URL = stub.url

  say(`web ${webUrl}`)
  say(`api ${apiUrl}`)
  // Redacted: the connection string carries a password, and CI keeps this log.
  say(`db  ${described}`)
  const elapsed = Math.round((Date.now() - started) / 1000)
  say(`ready in ${elapsed}s (of a ${START_BUDGET_SECONDS}s budget)`)
  if (elapsed * 2 > START_BUDGET_SECONDS) {
    console.warn(
      `[e2e] WARNING: starting the app took ${elapsed}s, over half the ` +
      `${START_BUDGET_SECONDS}s the CLI allows. That margin is what #535 spent. ` +
      'Find out what got slower before it crosses.',
    )
  }

  return async () => {
    // Only this AppHost: other Aspire apps for other projects commonly run on
    // the same machine.
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

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
import pg from 'pg'

import { connectionConfig, describeConnection } from './support/database.js'

import { WEB_ROOT } from './support/paths.js'
import { BOOK_IN_HAND } from './support/books.js'
import { ensureCameraVideo, ensureFrontCameraVideo } from './support/camera-fixture.js'
import { startCatalogueStub, type CatalogueStub } from './support/catalogue-stub.js'
import {
  describeResources, reportResourceState, startAppHost, stopAppHost, urlOf, waitForResource,
} from './support/aspire.js'

/**
 * A run of this run's own.
 *
 * The AppHost turns this into two things: `web/data/e2e/<id>` for the
 * photographs, and a Postgres database called `bookscan_<id>` for the rows.
 * Both were one thing while the catalogue was a file. Since stage G they are
 * not, because the container's volume now survives the run, so a directory per
 * run would isolate the photographs and quietly share the catalogue with
 * whatever a developer has been scanning into this checkout.
 *
 * It is deliberately not BOOKSCAN_DATA and deliberately not a connection
 * string. Those two variables are what stand between a dev server and the
 * owner's real catalogue, and nothing in this repository sets either. The
 * AppHost keeps sole authority over both, and all this does is ask for a
 * subdirectory and a database name beneath what it already chose.
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

/**
 * Drop the databases earlier runs left in the container's volume.
 *
 * The other half of `pruneOldRuns`, and it exists for the same reason: a
 * database per run is the right trade for isolation and the wrong one for a
 * volume that now survives every run, so without this they accumulate forever.
 * Nothing reads a finished run's rows.
 *
 * Deliberately narrow. It drops only databases named `bookscan_run_%`, which is
 * a name only this file's `runId` produces, so a developer's own `bookscan` and
 * anything else on that server are untouched. It also never drops the current
 * run's own database, which is open.
 *
 * A failure here is logged and ignored: a scratch database left behind is not
 * worth failing a run over, and a server that refuses the query is one where
 * there was nothing of ours to drop anyway.
 */
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

/**
 * Wait for a resource, and if it never becomes healthy, say why before failing.
 *
 * The failure this exists for is `aspire wait web` reporting that the resource
 * "entered a failed state ... because it failed to start", which is every word
 * the job used to get (#277). Note what that sentence is not: it is not the
 * five minute timeout expiring. The CLI stopped waiting because it saw the
 * resource fail, so the resource's own output is the only place the reason can
 * be, and raising the timeout would change nothing at all.
 *
 * The original error is rethrown untouched, so the run still fails the same way
 * with the same message. All this adds is the transcript above it.
 */
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

  pruneOldRuns()

  say(`generating the camera video for ${BOOK_IN_HAND.isbn13}`)
  await ensureCameraVideo(BOOK_IN_HAND.isbn13)
  // The second project's camera. Generated here rather than lazily, because
  // Chromium is handed the path on the command line and a missing file makes
  // getUserMedia fail in a way that reads as a broken app.
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
    // The two catalogues #305 added. Nothing in a green run asks them, because
    // every stub book already has a page count and a genre and they are only
    // asked about a book missing one, but an origin left unset is the real
    // Library of Congress and this suite talks to nobody.
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
   * Where the rows and the photographs are.
   *
   * Both are read out of the api resource's own environment, which is the same
   * argument the file-path version made for asking /api/health: the suite
   * asserts against what the app was actually given rather than something it
   * rebuilt and hoped matched. `/api/health` cannot answer the first half any
   * more, deliberately. It reports host, port and database and no credentials,
   * because a password on a health endpoint is a password in every log that
   * scrapes one, and the alternative to reading the environment here would have
   * been teaching that endpoint to hand one out.
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
   * A session, before anything else is asked of the api (#521).
   *
   * Every route under `/api` is behind the gate now, including `/api/health`
   * below and including the photographs, so this suite has to arrive holding a
   * session exactly as a phone does. That is the point rather than an
   * inconvenience: a browser suite that could reach the app without one would be
   * proving the app as it is not deployed.
   *
   * It is obtained through the real door. `apphost.mts` sets
   * `BOOKSCAN_DEV_SIGN_IN`, so this checkout's api carries a development
   * provider, and `GET /api/auth/dev/start` walks the same three steps Google's
   * callback walks: find or create the user, enable them, mint a session row.
   * Nothing here reaches into the database to write a session by hand, so a
   * change to how a session is made breaks this run rather than leaving it green
   * against a shape the app no longer writes.
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

  // The server is still asked, as a check rather than as the source: if it
  // opened something other than what the AppHost handed it, the two disagree
  // and every assertion below would be made against the wrong database.
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
  // The cookie, in the shape a `Cookie:` header wants it, for the workers. They
  // are separate processes, so it travels the same way every other discovered
  // value here does. See `steps/fixtures.ts`, which puts it in the browser.
  process.env.BOOKSCAN_E2E_SESSION = session
  process.env.BOOKSCAN_E2E_DB = connection
  process.env.BOOKSCAN_E2E_COVERS = join(dataDir, 'covers')
  // The stub's own control endpoint, so a scenario can hold a lookup open for
  // as long as it needs. Not one of the BOOKSCAN_*_URL variables: those tell
  // the API where the catalogues live, this tells a test where the stub's
  // control plane lives, and the app itself never touches it.
  process.env.BOOKSCAN_E2E_STUB_URL = stub.url

  say(`web ${webUrl}`)
  say(`api ${apiUrl}`)
  // Redacted, and this is not decoration. The connection now carries a
  // password, and CI keeps this log.
  say(`db  ${described}`)
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

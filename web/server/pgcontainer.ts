/**
 * The Postgres the test run talks to. Vitest `globalSetup` for the `postgres`
 * project only, so the SQLite project still needs nothing.
 *
 * This is the accepted cost recorded in docs/postgres-migration.md section 4:
 * `npm test` grows a Docker dependency it did not have. It was chosen over
 * keeping the fast suite on SQLite, because a suite that does not exercise the
 * database being shipped is exactly how a collation difference passes
 * everything and surfaces on somebody's shelf.
 *
 * **The escape hatch is `BOOKSCAN_TEST_DATABASE_URL`, and it is the only
 * connection variable anything here reads.** Not `DATABASE_URL`, not
 * `ConnectionStrings__bookscan`. That is deliberate and it is the same rule as
 * `BOOKSCAN_DATA`: an ambient connection variable in somebody's shell, pointed
 * at a real catalogue, must not be something a test run can pick up. Set it
 * only at a scratch server you are willing to have databases created on and
 * dropped from.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import type { TestProject } from 'vitest/node'

/**
 * The major version the eventual managed target will run, per the plan's
 * decision 3. Changing it is a decision, not a refresh: collation behaviour is
 * a property of the server and of the libc it was built against.
 *
 * **Read from `postgres-version.json` at the repository root, which is the one
 * place it is written.** It used to be a literal here, and the AppHost had no
 * pin at all and took whatever Aspire defaulted to, so the two drifted two
 * major versions apart without anything saying so (#162). One file, three
 * readers: this, `apphost.mts`, and `scripts/check-postgres-version.mjs`, which
 * holds `.github/workflows/ci.yml` to the same value because a workflow's
 * `services:` image cannot be an expression over a file.
 */
const version = JSON.parse(
  readFileSync(new URL('../../postgres-version.json', import.meta.url), 'utf8'),
) as { image: string; tag: string }

export const POSTGRES_IMAGE = `${version.image}:${version.tag}`

let container: StartedPostgreSqlContainer | undefined

/**
 * The server a run that brought its own was pointed at, and the tag every
 * database that run made carries. Both undefined when the container is ours,
 * because then there is nothing to clean up by name.
 */
let borrowed: { url: string; tag: string } | undefined

/**
 * The mark this run puts in the name of every scratch database it makes.
 *
 * It is what lets `teardown` drop **this** run's databases off a server it
 * borrowed without touching a database some other run is in the middle of
 * using. Two checkouts really do run the suite at once here, and a sweep by
 * `bookscan_%` alone would take the other one's catalogue out from under it.
 */
function runTag(): string {
  return randomBytes(4).toString('hex')
}

export async function setup(project: TestProject): Promise<void> {
  const tag = runTag()
  project.provide('scratchTag', tag)

  const existing = process.env.BOOKSCAN_TEST_DATABASE_URL
  if (existing) {
    borrowed = { url: existing, tag }
    project.provide('postgresUrl', existing)
    return
  }

  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()
  project.provide('postgresUrl', container.getConnectionUri())
}

/**
 * Where every scratch database this run made is dropped, and the only place.
 *
 * **`DROP DATABASE` forces an immediate checkpoint, and waits for it** (#343).
 * That is a property of Postgres rather than of this suite: `dropdb` requests
 * `CHECKPOINT_IMMEDIATE | CHECKPOINT_FORCE | CHECKPOINT_WAIT` so the
 * checkpointer is known to have forgotten the sync requests for the files it is
 * about to unlink. A checkpoint flushes every dirty buffer in the server, not
 * only the dropped database's, so a drop issued while fifteen other workers are
 * writing pays for their pages and blocks behind them. Measured on this machine
 * across three full runs: 160 databases dropped per run, from inside `afterAll`
 * hooks that overlap other files' test bodies, at a median of 1.0 to 8.7
 * seconds each and a worst case of 73 seconds, for 660 to 760 seconds of
 * checkpoint waiting spread through a 110 second run. Creating a database, by
 * contrast, is a tenth of a second at the median.
 *
 * So no test file drops anything any more. A worker gives its connections back
 * and leaves the database standing, and the drops happen here, after the last
 * test in the run has finished, where the server is idle and there are no dirty
 * pages left to pay for.
 *
 * **A run that started its own container drops nothing at all.** The container
 * is stopped on the next line and removed with everything in it, so a hundred
 * and sixty `DROP DATABASE` statements against a server that is about to cease
 * to exist are a hundred and sixty checkpoints bought for nothing.
 *
 * A run pointed at a server by `BOOKSCAN_TEST_DATABASE_URL` is the other case,
 * and that server is somebody's, so it is swept: this run's tag, and nothing
 * else. Concurrently, because Postgres coalesces concurrent checkpoint requests
 * into one pass and these have an idle server to themselves (#226 measured the
 * same thing under load and settled on four; there is nothing to share the
 * server with here, so the same four is simply a bound on connections).
 *
 * If the process dies before this runs, databases are left behind on a borrowed
 * server. That was already true of the `afterAll` hooks this replaces.
 */
export async function teardown(): Promise<void> {
  if (borrowed) await dropEverythingThisRunMade(borrowed.url, borrowed.tag)
  borrowed = undefined

  await container?.stop()
  container = undefined
}

async function dropEverythingThisRunMade(url: string, tag: string): Promise<void> {
  const admin = new pg.Pool({ connectionString: url, max: 4 })
  admin.on('error', () => {})
  try {
    const made = await admin.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`bookscan_%_${tag}_%`],
    )
    await Promise.all(made.rows.map(({ datname }) =>
      // WITH (FORCE) because a pool that failed to close is not worth failing a
      // green run over, and neither is a database left behind.
      admin.query(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`).catch(() => undefined)))
  } catch {
    // Same reasoning: a sweep that could not run is a tidiness problem on
    // somebody's own server, not a reason to redden a run that passed.
  } finally {
    await admin.end().catch(() => undefined)
  }
}

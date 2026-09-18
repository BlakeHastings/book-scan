/**
 * The Postgres the test run talks to. Vitest `globalSetup` for the
 * `postgres` project only; the SQLite project needs nothing here.
 *
 * `BOOKSCAN_TEST_DATABASE_URL` is the only connection variable anything here
 * reads, never `DATABASE_URL` or `ConnectionStrings__bookscan`: an ambient
 * connection variable in somebody's shell, pointed at a real catalogue, must
 * not be something a test run can pick up. Set it only at a scratch server
 * you are willing to have databases created on and dropped from.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import type { TestProject } from 'vitest/node'

/**
 * The major Postgres version the eventual managed target will run. Changing
 * it is a decision, not a refresh: collation behaviour is a property of the
 * server and the libc it was built against.
 *
 * Read from `postgres-version.json` at the repository root, the one place it
 * is written. `apphost.mts` and `scripts/check-postgres-version.mjs` also
 * read it; the latter holds `.github/workflows/ci.yml` to the same value,
 * since a workflow's `services:` image cannot be an expression over a file.
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
 * The mark this run puts in the name of every scratch database it makes, so
 * `teardown` can drop this run's databases off a borrowed server without
 * touching one another concurrent run is using.
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
 * `DROP DATABASE` forces an immediate checkpoint and waits for it: Postgres
 * flushes every dirty buffer in the server, not only the dropped database's,
 * so a drop issued while other workers are writing pays for their pages too.
 * No test file drops anything any more; a worker leaves its database
 * standing and the drops happen here, once the run is done and the server is
 * idle.
 *
 * A run that started its own container drops nothing here at all: the
 * container is stopped and removed with everything in it. A run pointed at
 * a borrowed server (`BOOKSCAN_TEST_DATABASE_URL`) sweeps only this run's
 * tag, concurrently, since Postgres coalesces concurrent checkpoint requests
 * into one pass.
 *
 * If the process dies before this runs, databases are left behind on a
 * borrowed server.
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

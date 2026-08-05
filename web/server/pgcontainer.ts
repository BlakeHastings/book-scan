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

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { TestProject } from 'vitest/node'

/**
 * Pinned to the major version the eventual managed target will run, per the
 * plan's decision 3. Changing it is a decision, not a refresh: collation
 * behaviour is a property of the server and of the libc it was built against.
 */
export const POSTGRES_IMAGE = 'postgres:17'

let container: StartedPostgreSqlContainer | undefined

export async function setup(project: TestProject): Promise<void> {
  const existing = process.env.BOOKSCAN_TEST_DATABASE_URL
  if (existing) {
    project.provide('postgresUrl', existing)
    return
  }

  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()
  project.provide('postgresUrl', container.getConnectionUri())
}

export async function teardown(): Promise<void> {
  await container?.stop()
  container = undefined
}

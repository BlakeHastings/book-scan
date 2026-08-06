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

import { readFileSync } from 'node:fs'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
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

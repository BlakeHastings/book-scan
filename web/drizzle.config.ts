/**
 * drizzle-kit, which is used for exactly one thing here: turning
 * `infrastructure/db/schema.ts` into SQL migrations.
 *
 *     npm run db:generate
 *
 * There is deliberately no `dbCredentials` block. `drizzle-kit push`, `pull`
 * and `studio` all need a live server, and every one of them is a way to point
 * a schema tool at a catalogue by having a connection string in scope. That is
 * the hazard AGENTS.md spends a section on, and the way to not have it is to
 * not configure it: `generate` reads TypeScript and writes files, and needs no
 * database at all. Migrations are applied by the app, through
 * `infrastructure/db/migrate.ts`, against the connection it was already given.
 */

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './infrastructure/db/schema.ts',
  out: './infrastructure/db/migrations',
})

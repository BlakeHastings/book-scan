/**
 * drizzle-kit, used for exactly one thing here: turning
 * `infrastructure/db/schema.ts` into SQL migrations with `npm run db:generate`.
 *
 * There is deliberately no `dbCredentials` block, and none should be added:
 * `generate` reads TypeScript and writes files, needing no database, while
 * `drizzle-kit push`, `pull` and `studio` all need a live server and so are a
 * way to point a schema tool at a catalogue by having a connection string in
 * scope. Migrations are applied by the app itself, through
 * `infrastructure/db/migrate.ts`, against the connection it was already given.
 */

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './infrastructure/db/schema.ts',
  out: './infrastructure/db/migrations',
})

import react from '@vitejs/plugin-react'
import { defaultExclude, defineConfig } from 'vitest/config'

/**
 * Two projects, because stage F needs the same tests run against two databases.
 *
 * `sqlite` is the suite as it was: every test file, no services, no Docker.
 * `postgres` re-runs only the four files that open a database, against a real
 * Postgres in a container, plus db.pg.test.ts, which is about the driver itself
 * and has nothing to say on SQLite.
 *
 * The four files are not copied and their assertions are not parameterised.
 * They open their database through server/testdb.ts and are otherwise unaware
 * of which one they got, which is the point: the Postgres implementation is
 * correct exactly to the extent that the tests already guarding SQLite pass
 * unchanged against it.
 *
 * The `sqlite` project deliberately does not name an `include`. Vitest's
 * default already matched every test in this repository, including the two
 * `.tsx` component tests under src/components, and a hand-written glob here
 * silently dropped them: the run stayed green and the count fell by 21. So the
 * only thing said about that project is what it leaves out.
 *
 * Vitest reads this file in preference to vite.config.ts, so the React plugin
 * is named again here. basicSsl is not: it is for the dev server the phone
 * talks to, and nothing under test binds a socket.
 */

/** The files that open a database, and so have something to say on both. */
const BOTH_DRIVERS = [
  'server/store.test.ts',
  'server/shelves.test.ts',
  'server/queue.test.ts',
  'server/rehash.test.ts',
]

/** Postgres-only: the driver, the collation and the transaction pinning. */
const POSTGRES_ONLY = ['server/db.pg.test.ts']

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'sqlite',
          exclude: [...defaultExclude, ...POSTGRES_ONLY],
        },
      },
      {
        test: {
          name: 'postgres',
          include: [...BOTH_DRIVERS, ...POSTGRES_ONLY],
          env: { BOOKSCAN_TEST_DRIVER: 'postgres' },
          // Only this project pays for a container.
          globalSetup: ['./server/pgcontainer.ts'],
        },
      },
    ],
  },
})

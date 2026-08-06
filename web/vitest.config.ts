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

/**
 * The files that open a database, and so have something to say on both.
 *
 * The plan named four. `dividers.test.ts` arrived on master during this stage
 * and is a fifth: it opens the `separators` table through `Db` to assert which
 * row a Remove actually deleted, which is precisely a claim that has to hold on
 * the database being shipped. **Anything added here later that opens a database
 * belongs on this list**, or it guards SQLite only.
 */
const BOTH_DRIVERS = [
  'server/store.test.ts',
  'server/shelves.test.ts',
  'server/queue.test.ts',
  'server/rehash.test.ts',
  'server/dividers.test.ts',
]

/**
 * Postgres-only: the driver, the collation and the transaction pinning, since
 * stage H the data migration, which is about both databases at once and has
 * nothing it could assert with only one of them; since #172 the schema
 * migrations, which exist only for Postgres, because SQLite keeps the
 * hand-written schema in server/db.ts and the two functions that bring an old
 * catalogue file forward; and since #177 the backup digest, which reads
 * `md5(string_agg(... order by ...))` out of a real server and exists to catch
 * a collation failure SQLite cannot have.
 *
 * These are not on BOTH_DRIVERS and that is not an oversight. A file belongs
 * there when it opens a database and its assertions hold on either one. These
 * would not compile against SQLite, let alone pass.
 */
const POSTGRES_ONLY = [
  'server/db.pg.test.ts',
  'server/migrate.test.ts',
  'infrastructure/db/migrate.test.ts',
  'server/backup.pg.test.ts',
]

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

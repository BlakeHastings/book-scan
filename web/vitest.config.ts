import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * One project, because stage I left one database.
 *
 * Stages F and G ran two: `sqlite`, which was every test file and needed no
 * services, and `postgres`, which re-ran the five files that opened a database
 * against a real one. That arrangement was the verification argument for the
 * Postgres driver, and it was worth what it cost while there were two drivers
 * to disagree. There is one now, so a second list of files to re-run has
 * nothing to re-run them against.
 *
 * What that costs, said plainly rather than discovered: **every `npm test` now
 * starts a Postgres container**, including a run that only touches
 * `src/lib/`. `npx vitest run --project sqlite` used to be the half that needed
 * nothing and there is no such half any more. `BOOKSCAN_TEST_DATABASE_URL`
 * still points the harness at a server you already have, and is how CI avoids
 * the pull. See server/pgcontainer.ts.
 *
 * No `include`, deliberately. Vitest's default already matches every test in
 * this repository, including the component tests under src/components, and a
 * hand-written glob silently dropped them once: the run stayed green and the
 * count fell by 21.
 *
 * Vitest reads this file in preference to vite.config.ts, so the React plugin
 * is named here. basicSsl is not: it is for the dev server the phone talks to,
 * and nothing under test binds a socket.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    // Every file, so the container is started once for the run rather than per
    // project. Files that never open a database pay the startup and nothing
    // else; files that do get their own database out of server/testdb.ts.
    globalSetup: ['./server/pgcontainer.ts'],
  },
})

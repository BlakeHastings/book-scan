import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Every `npm test` starts a Postgres container, including a run that only
 * touches `src/lib/`. `BOOKSCAN_TEST_DATABASE_URL` points the harness at a
 * server you already have instead; see server/pgcontainer.ts.
 *
 * No `include`, deliberately: a hand-written glob once silently dropped the
 * component tests under src/components while the run stayed green.
 *
 * Vitest reads this file in preference to vite.config.ts, so the React plugin
 * is named here. basicSsl is not: it is for the dev server the phone talks to,
 * and nothing under test binds a socket.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    // Every file, so the container is started once for the run rather than per
    // project.
    globalSetup: ['./server/pgcontainer.ts'],

    /**
     * Files run in parallel against one shared container, so a `CREATE
     * DATABASE` or `DROP DATABASE` in a hook can queue behind the others:
     * `DROP DATABASE` forces a checkpoint, and Postgres runs those one at a
     * time, which can stall other files' hooks as well as the one that asked
     * for it. `hookTimeout` is raised to cover that queue; `testTimeout`
     * stays low because individual test bodies do not wait on it, only hooks
     * do. No test file drops a database itself any more: they are swept
     * once, after the last test, by `server/pgcontainer.ts`.
     */
    hookTimeout: 120_000,
    testTimeout: 20_000,
  },
})

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

    /*
     * Twelve files now create a database of their own and drop it again, where
     * nine did before stage I and four of those opened `:memory:` instead. They
     * run in parallel against one container, so a `CREATE DATABASE` or a `DROP
     * DATABASE` waits behind the others, and vitest's ten second default for a
     * hook is not enough for the last one in the queue on a laptop.
     *
     * Found by watching it: the suite went green, then red in seven files at
     * once with every test in them passing and `Hook timed out in 10000ms` in
     * each, which reads like a driver fault and is a queue. CI, on a service
     * container rather than a Docker Desktop VM, has not hit it.
     *
     * **The same queue reaches test bodies, which is what #185 found.** Several
     * backfill files call `scratchDatabase()` inside `it` rather than in a hook,
     * so they wait in exactly the queue described above and fail at vitest's five
     * second default instead of the sixty this line buys. It showed up as
     * `state-backfill.test.ts` and `capture-backfill.test.ts` timing out at the
     * line that creates their database, in a run where nothing about either had
     * changed and one more file had joined the queue.
     *
     * So `testTimeout` is raised too, and deliberately not to sixty. The reason
     * it was left alone still holds: a test that runs long is a test worth being
     * told about, and the files that legitimately take tens of seconds say so per
     * test already (see bookcrop.test.ts). Twenty seconds is longer than any
     * queue this container has produced and short enough that a test which has
     * actually stopped still reports as one.
     *
     * **Raised again to 120 seconds (#226), and the queue it buys for is a
     * different one from the sentence above.** The drop helper in
     * `infrastructure/db/testdb.ts` used to run every drop for a file
     * concurrently against a bare `pg.Pool`, which is what pushed the suite over
     * Postgres's hundred connections: measured with `pg_stat_activity`, up to
     * ten connections per file, all `active` and waiting on the same
     * `IPC/CheckpointStart`, because `DROP DATABASE` forces a checkpoint and
     * Postgres runs one at a time. Capping that pool at four connections cut the
     * measured peak from 79-80 down to the 40s, and was chosen over a single
     * connection: a single connection was tried first and measured worse, not
     * just more cautious, because Postgres coalesces concurrent checkpoint
     * requests into one pass and a fully serial drop pays for a fresh checkpoint
     * on every database instead of sharing one with whichever other drops
     * happen to be in flight. Even at four, a file dropping a dozen databases
     * under a heavily loaded parallel run can still queue behind that
     * checkpoint for longer than sixty seconds, seen directly: several
     * `infrastructure/db/*-backfill.test.ts` files timing out in their
     * `afterAll` with every test in them passing. Sixty seconds bought that
     * margin at nine files; it does not at the file count and the per-file
     * connection cap this repository had then, so this buys it again the same
     * way: measured longer than anything the capped pool produced, not raised
     * until the failure stopped showing up. `testTimeout` was deliberately left
     * at twenty: hooks were what waited on the checkpoint queue, individual
     * tests were not.
     *
     * **That last sentence is the one #343 was filed against.** It stopped being
     * true, and the failure was a *test body* timing out: a `DROP DATABASE` in
     * one file's `afterAll` forces an immediate checkpoint, a checkpoint flushes
     * every dirty buffer in the server rather than the dropped database's, and
     * so it stalls the fifteen worker processes that are mid-test as much as the
     * one that asked for it. Measured across three full runs on this machine:
     * 160 databases dropped per run, 660 to 760 seconds of waiting on those
     * drops spread through a run whose test files spanned about 110 seconds.
     * **No test file drops a database now.** They are swept once, after the last
     * test, by `server/pgcontainer.ts`, or not at all when the container this
     * run started is about to be removed with them inside it.
     *
     * **Both numbers are left exactly where they were, on purpose.** #343 ruled
     * out raising a timeout, and lowering one on the strength of a change a day
     * old is the same mistake pointed the other way: the case for a smaller hook
     * budget is runs, not reasoning. What the measurements say is that nothing
     * needs the 120 any more, and that is a change to make once this shape has
     * some weeks behind it rather than in the pull request that created it.
     *
     * Six files under `infrastructure/db/` used to pin their own `afterAll` to
     * a literal `60_000` that matched this constant by agreement rather than by
     * reference. Removed rather than raised to match: a number that has to be
     * kept equal to this one by a human noticing is the same defect the CI and
     * local Postgres versions have a shared file to avoid (`postgres-version.json`),
     * at file-config scale rather than repo scale. They now take the default.
     */
    hookTimeout: 120_000,
    testTimeout: 20_000,
  },
})

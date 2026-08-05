// Aspire TypeScript AppHost
// For more information, see: https://aspire.dev
//
// Two resources, both living in ./web:
//   api  the Express server (web/server/index.ts)
//   web  the Vite React client
//
// Ports are assigned by Aspire rather than hardcoded, which is what lets
// several worktrees run at once. That covers Aspire's own ports too:
// aspire.config.json deliberately has no "profiles" block, because a profile
// pins the dashboard, the OTLP endpoint and the resource service to fixed
// ports, and a second checkout then fails to bind them. Do not add one back.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createBuilder } from './.aspire/modules/aspire.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * An end to end run wants a database of its own, so a suite that assumes an
 * empty catalogue does not wipe whatever a developer has been scanning into
 * this checkout. The runner passes an id and gets `web/data/e2e/<id>`.
 *
 * Sanitised to one path segment on purpose. This value comes from an
 * environment variable, and the one thing that must remain true of the data
 * directory is that it is inside the checkout: a value containing `..` or a
 * drive letter would be a way back out to the live catalogue. Anything but
 * letters, digits, dash and underscore is dropped, so the result can only ever
 * name a folder beneath `web/data`.
 */
const e2eRun = (process.env.BOOKSCAN_E2E_RUN ?? '').replace(/[^A-Za-z0-9_-]/g, '');

// Scan data for THIS checkout only.
//
// Set explicitly rather than left to the server's `process.env.BOOKSCAN_DATA
// ?? 'data'` default. The default would inherit BOOKSCAN_DATA from the
// surrounding shell, and if that pointed at the live catalogue a development
// run would write to real data. An explicit value here overrides anything
// inherited, so an Aspire run can only ever touch this checkout.
const dataDir = e2eRun
  ? join(here, 'web', 'data', 'e2e', e2eRun)
  : join(here, 'web', 'data');

/**
 * Catalogue origins, forwarded only when the surrounding process supplies
 * them. The end to end suite sets them to a local stub so the run does not
 * depend on Open Library or Google Books being up; nothing else sets them, and
 * an unset variable is not forwarded at all, so `aspire start` by hand behaves
 * exactly as it did before.
 */
const stubbed = [
  'BOOKSCAN_OPENLIBRARY_URL',
  'BOOKSCAN_GOOGLE_BOOKS_URL',
  'BOOKSCAN_COVERS_URL',
] as const;

const builder = await createBuilder();

/**
 * Postgres, provisioned and idle.
 *
 * **The app is still on SQLite.** `server/index.ts` reads `BOOKSCAN_DB` and
 * defaults it to `sqlite`, and nothing here sets it, so this container is
 * started, referenced and not connected to. That separation is deliberate: the
 * AppHost change is proven on its own, before the stage that flips the default
 * (G) makes it the thing every request depends on.
 *
 * Three things not done here, each one a decision rather than an omission:
 *
 * - **No `withHostPort`.** A fixed port is exactly what issue #28 was about,
 *   and several checkouts have to keep starting side by side. Aspire assigns
 *   one, as it does for every other endpoint in this file.
 * - **No `withDataVolume`.** A volume with a fixed name is one database shared
 *   by every worktree, which is issue #28 wearing a different hat, and a volume
 *   named per checkout is a decision about developer data the owner has not
 *   made yet (plan decision 2). Without one a scratch catalogue is ephemeral,
 *   which is a change from `web/data/books.db` persisting today, and is what
 *   the end to end suite wants anyway since it assumes an empty catalogue.
 * - **No image tag pinned, because it cannot be.** `addPostgres` exposes no
 *   `withImageTag` on the TypeScript surface, only `withHostPort`,
 *   `withDataVolume`, `withPassword` and the two admin UIs. Aspire 13.4.2 runs
 *   `postgres:18.3` here, read off `docker ps` after `aspire start`, while the
 *   test suite deliberately pins `postgres:17` (server/pgcontainer.ts) as the
 *   plan's decision 3 asks. The two therefore differ. It costs nothing while
 *   the app is on SQLite and this container is idle; it is an owner decision
 *   before stage G, which is when the app starts using this one.
 *
 * The cost, stated because it is per checkout and not per machine: one
 * Postgres container for every running checkout. Five worktrees is five
 * containers.
 */
const postgres = await builder.addPostgres('postgres');

// The name is the connection string name: the api resource receives it as
// ConnectionStrings__bookscan, which is what server/index.ts reads when
// BOOKSCAN_DB=postgres.
const catalogue = await postgres.addDatabase('bookscan');

let apiBuilder = builder
  .addNodeApp('api', './web', 'server/index.ts')
  // tsx, because the server is TypeScript and is not built before running.
  .withRunScript('dev:server')
  // Aspire picks the port and passes it as PORT, which server/index.ts
  // already reads.
  .withHttpEndpoint({ env: 'PORT' })
  .withEnvironment('BOOKSCAN_DATA', dataDir)
  // Set explicitly for the same reason BOOKSCAN_DATA is: the connection has to
  // be the one this AppHost provisioned and not one inherited from a shell
  // that might name somebody's real catalogue.
  .withReference(catalogue)
  .waitFor(catalogue);

// Appended before the chain is awaited, so this is the same single builder
// chain the resource was always described by, just a few links longer.
for (const name of stubbed) {
  const value = process.env[name];
  if (value) apiBuilder = apiBuilder.withEnvironment(name, value);
}

const api = await apiBuilder;

const web = await builder
  .addViteApp('web', './web', { runScriptName: 'dev:client' })
  // VITE_PORT, not PORT: the api reads PORT, and `npm run dev` runs both
  // through concurrently in one shell, so a shared name would collide.
  .withHttpEndpoint({ env: 'VITE_PORT' })
  // The client is served to a phone on the LAN, so the browser resolves
  // /api against its own origin and Vite proxies it. The proxy target comes
  // from here rather than a literal in vite.config.ts.
  .withEnvironment('API_URL', api.getEndpoint('http'))
  // The phone is a different device, so this endpoint has to leave localhost.
  .withExternalHttpEndpoints()
  // Aspire manages lifecycle; opening a browser per restart is noise.
  .withEnvironment('BROWSER', 'none')
  .waitFor(api);

await builder.build().run();

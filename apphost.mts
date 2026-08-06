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

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createBuilder } from './.aspire/modules/aspire.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The Postgres major version, read from the one file that carries it.
 *
 * Not a literal here, and not a literal in web/server/pgcontainer.ts either.
 * Those were two literals and they disagreed for two major versions (#162):
 * the AppHost ran whatever tag Aspire happened to default to, 18.3, while the
 * test suite pinned 17, so since stage G the browser suite proved one database
 * and the unit suite proved another. A suite that does not exercise the
 * database being shipped is the whole reason there is a Postgres container per
 * test run at all.
 *
 * Read at run time rather than imported, because the two readers are in
 * different TypeScript projects with different module resolution: the AppHost
 * is NodeNext at the repo root, `web/` is bundler resolution. A JSON file both
 * can open, and `scripts/check-postgres-version.mjs` can compare against
 * `ci.yml`, is the thing all three agree on.
 */
const postgresVersion = JSON.parse(
  readFileSync(join(here, 'postgres-version.json'), 'utf8'),
) as { image: string; tag: string };

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
 * Postgres, and as of stage G the database the app actually opens.
 *
 * `server/index.ts` defaults `BOOKSCAN_DB` to `postgres`, so every request in a
 * run started from here goes to this container. SQLite is one variable away and
 * stays that way until stage I: `BOOKSCAN_DB=sqlite` opens
 * `<BOOKSCAN_DATA>/books.db` exactly as before.
 *
 * Three decisions, each one a decision rather than an omission:
 *
 * - **No `withHostPort`.** A fixed port is exactly what issue #28 was about,
 *   and several checkouts have to keep starting side by side. Aspire assigns
 *   one, as it does for every other endpoint in this file.
 * - **A data volume, named per checkout.** See `volumeName` below. Plan
 *   decision 2, settled: a seeded scratch world surviving a restart is worth
 *   more than a clean slate every run, `web/data/books.db` persisted before
 *   this migration and losing that would be a regression in developing here,
 *   and Aspire's own guidance prefers a persistent lifetime for a database.
 * - **The image tag is pinned, from `postgres-version.json`.** It can be:
 *   `withImageTag` is declared on `PostgresServerResource` itself in the
 *   generated TypeScript surface, not only on a bare container, which
 *   `aspire docs api search withImageTag` finds and
 *   `aspire docs api list typescript/aspire.hosting.postgresql/postgresserverresource`
 *   does not, because that listing shows the Postgres-specific members and not
 *   the container ones the resource also carries. The comment that used to sit
 *   here said it could not be done, on the strength of that listing, and it was
 *   wrong: #162. Left unpinned, Aspire 13.4.2 ran `postgres:18.3` while the
 *   suite pinned `postgres:17`, so the browser suite proved one major version
 *   and the unit suite proved another.
 * - **The tag is the major only, so the minor floats.** A managed Postgres
 *   applies its own minor updates and does not ask, so pinning a minor here
 *   would be proving a version nothing runs. The major is the thing that is a
 *   decision.
 *
 * The cost, stated because it is per checkout and not per machine: one
 * Postgres container and one volume for every running checkout. Five worktrees
 * is five of each.
 */

/**
 * A volume this checkout does not share with any other.
 *
 * A fixed name would be issue #28 wearing a different hat: every worktree
 * writing to one database, so a scenario run in one checkout deletes what
 * somebody was looking at in another. The checkout's own path is the thing that
 * distinguishes them, hashed because a volume name may not contain a drive
 * letter, a colon or a backslash. Short enough to read in `docker volume ls`
 * and long enough not to collide.
 *
 * Deleting a volume by hand is how a developer gets the clean slate this no
 * longer gives them for free: `docker volume rm <name>` with the AppHost
 * stopped, printed below so nobody has to work out which one is theirs.
 */
const volumeName = `bookscan-pg-${createHash('sha256').update(here).digest('hex').slice(0, 12)}`;

/**
 * The database inside that volume, which is per run for the browser suite.
 *
 * A directory per run was enough while the catalogue was a file: the suite
 * assumes an empty catalogue, and `web/data/e2e/<id>` gave it one. On Postgres
 * that directory still isolates the photographs and isolates nothing else,
 * because the rows are in a container whose volume now survives the run. So the
 * run gets a database of its own by the same id, and `reset()` truncating it is
 * a statement about this run rather than about whatever a developer has been
 * scanning into `bookscan`.
 *
 * The resource is still called `bookscan` whatever the database is called, so
 * the api still receives `ConnectionStrings__bookscan` and `server/index.ts`
 * reads one name. Only the catalogue on the other end of it moves.
 *
 * `e2eRun` is already sanitised to letters, digits, dash and underscore; the
 * dashes go too, because they would need quoting in an identifier.
 */
const databaseName = e2eRun ? `bookscan_${e2eRun.replace(/-/g, '_')}` : 'bookscan';

const postgres = await builder
  .addPostgres('postgres')
  .withImageTag(postgresVersion.tag)
  .withDataVolume({ name: volumeName });

const catalogue = await postgres.addDatabase('bookscan', { databaseName });

console.log(
  `[apphost] ${postgresVersion.image}:${postgresVersion.tag}, ` +
    `volume ${volumeName}, database ${databaseName}`,
);

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

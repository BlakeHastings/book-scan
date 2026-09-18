// Aspire TypeScript AppHost
// For more information, see: https://aspire.dev
//
// Ports are assigned by Aspire rather than hardcoded, which is what lets several
// worktrees run at once. That covers Aspire's own ports too: aspire.config.json
// deliberately has no "profiles" block, because a profile pins the dashboard,
// the OTLP endpoint and the resource service to fixed ports, and a second
// checkout then fails to bind them. Do not add one back.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createBuilder } from './.aspire/modules/aspire.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The Postgres major version, read from the one file that carries it, so that
 * this and `web/server/pgcontainer.ts` cannot disagree.
 *
 * Read at run time rather than imported, because the two readers are in
 * different TypeScript projects with different module resolution: the AppHost is
 * NodeNext at the repo root, `web/` is bundler resolution.
 */
const postgresVersion = JSON.parse(
  readFileSync(join(here, 'postgres-version.json'), 'utf8'),
) as { image: string; tag: string };

/**
 * An end to end run wants a directory of its own, so a suite that assumes an
 * empty catalogue does not wipe whatever a developer has been scanning into this
 * checkout. The runner passes an id and gets `web/data/e2e/<id>`.
 *
 * Sanitised to one path segment on purpose: this value comes from an environment
 * variable, and a `..` or a drive letter in it would be a way back out to the
 * live catalogue.
 */
const e2eRun = (process.env.BOOKSCAN_E2E_RUN ?? '').replace(/[^A-Za-z0-9_-]/g, '');

// Set explicitly rather than left to the server's `BOOKSCAN_DATA ?? 'data'`
// default, which would inherit BOOKSCAN_DATA from the surrounding shell. An
// explicit value here overrides anything inherited, so an Aspire run can only
// ever touch this checkout.
const dataDir = e2eRun
  ? join(here, 'web', 'data', 'e2e', e2eRun)
  : join(here, 'web', 'data');

/**
 * Catalogue origins, forwarded only when the surrounding process supplies them.
 * The end to end suite points them at a local stub; an unset variable is not
 * forwarded at all.
 */
const stubbed = [
  'BOOKSCAN_OPENLIBRARY_URL',
  'BOOKSCAN_GOOGLE_BOOKS_URL',
  'BOOKSCAN_COVERS_URL',
] as const;

const builder = await createBuilder();

/**
 * Postgres, and the only database the app can open. Three things below are
 * decisions rather than omissions.
 *
 * No `withHostPort`: a fixed port stops several checkouts starting side by side,
 * so Aspire assigns one, as it does for every other endpoint here. A data volume
 * named per checkout, so a seeded scratch world survives a restart. And the
 * image tag is pinned from `postgres-version.json`, to the major only, because a
 * managed Postgres applies its own minor updates and does not ask.
 *
 * The cost is per checkout and not per machine: one Postgres container and one
 * volume for every running checkout.
 */

/**
 * A volume this checkout does not share with any other, or every worktree would
 * write to one database. The checkout's own path is what distinguishes them,
 * hashed because a volume name may not contain a drive letter, a colon or a
 * backslash.
 *
 * `docker volume rm <name>` with the AppHost stopped is the clean slate this no
 * longer gives for free, which is why the name is printed below.
 */
const volumeName = `bookscan-pg-${createHash('sha256').update(here).digest('hex').slice(0, 12)}`;

/**
 * The database inside that volume, which is per run for the browser suite: the
 * run's own directory isolates the photographs and nothing else, because the
 * rows are in a container whose volume survives the run.
 *
 * The resource is still called `bookscan` whatever the database is called, so
 * the api still receives `ConnectionStrings__bookscan` and `server/index.ts`
 * reads one name.
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

/**
 * The install both `api` and `web` need, run once rather than twice.
 *
 * They are two Aspire resources pointing at the same directory, `./web`, so left
 * alone each of `addNodeApp`/`addViteApp` gets its own default npm installer and
 * two concurrent installs write to the same `node_modules`. Both wait for this
 * one below instead.
 *
 * `scripts/npm-install.mjs` installs only when there is something to install,
 * because `npm ci`'s documented first act is to delete `node_modules`, which
 * would take Vite's dependency pre-bundling cache with it on every start. A
 * disagreement between the lock file and the tree still fails the start.
 */
const npmInstall = await builder.addExecutable(
  'npm-install',
  'node',
  './web',
  [join(here, 'scripts', 'npm-install.mjs')],
);

let apiBuilder = builder
  .addNodeApp('api', './web', 'server/index.ts')
  // tsx, because the server is TypeScript and is not built before running.
  .withRunScript('dev:server')
  // The install above already covers this directory; Aspire's own default
  // installer would otherwise run a second, uncoordinated `npm install` here.
  .withNpm({ install: false })
  .waitForCompletion(npmInstall)
  // Aspire picks the port and passes it as PORT, which server/index.ts
  // already reads.
  .withHttpEndpoint({ env: 'PORT' })
  .withEnvironment('BOOKSCAN_DATA', dataDir)
  // Empty means unwatched to `server/backup-watch.ts`. Set explicitly for the
  // same reason BOOKSCAN_DATA is: the name may be in the shell already, and an
  // inherited value must not decide what an Aspire run reads off a disk.
  .withEnvironment('BOOKSCAN_BACKUP_DIR', '')
  /*
   * The development door, and this is the only place in this repository that
   * opens it. It is a provider rather than a bypass: `GET /api/auth/dev/start`
   * finds or creates a user, enables them, and mints an ordinary session row.
   * The value is who that identity is, not a flag. See `docs/the-gate.md`.
   */
  .withEnvironment('BOOKSCAN_DEV_SIGN_IN', 'developer')
  /*
   * Every variable that would configure a real provider, cleared, for the same
   * reason `BOOKSCAN_DATA` is set explicitly. An inherited client id would make
   * a development checkout sign people in through Google, and because
   * `signInFrom` refuses the development door beside a real provider it would
   * instead stop `aspire start` coming up at all.
   *
   * This list grows with the registry. `BOOKSCAN_OIDC_MICROSOFT_TENANT` matters
   * more than it looks: it is not a credential, so it is the one most likely to
   * be left in a shell profile, and on its own it is enough to stop a worktree
   * starting.
   */
  .withEnvironment('BOOKSCAN_OIDC_GOOGLE_CLIENT_ID', '')
  .withEnvironment('BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET', '')
  .withEnvironment('BOOKSCAN_OIDC_MICROSOFT_CLIENT_ID', '')
  .withEnvironment('BOOKSCAN_OIDC_MICROSOFT_CLIENT_SECRET', '')
  .withEnvironment('BOOKSCAN_OIDC_MICROSOFT_TENANT', '')
  .withEnvironment('BOOKSCAN_PUBLIC_ORIGIN', '')
  // The connection has to be the one this AppHost provisioned and not one
  // inherited from a shell that might name somebody's real catalogue.
  .withReference(catalogue)
  .waitFor(catalogue);

// Appended before the chain is awaited, so this is still the single builder
// chain the resource was always described by.
for (const name of stubbed) {
  const value = process.env[name];
  if (value) apiBuilder = apiBuilder.withEnvironment(name, value);
}

const api = await apiBuilder;

const web = await builder
  .addViteApp('web', './web', { runScriptName: 'dev:client' })
  // Same directory as `api`, same install: see `npmInstall` above.
  .withNpm({ install: false })
  .waitForCompletion(npmInstall)
  // VITE_PORT, not PORT: the api reads PORT, and `npm run dev` runs both
  // through concurrently in one shell, so a shared name would collide.
  .withHttpEndpoint({ env: 'VITE_PORT' })
  // The client is served to a phone on the LAN, so the browser resolves /api
  // against its own origin and Vite proxies it. The proxy target comes from here
  // rather than a literal in vite.config.ts.
  .withEnvironment('API_URL', api.getEndpoint('http'))
  // The phone is a different device, so this endpoint has to leave localhost.
  .withExternalHttpEndpoints()
  .withEnvironment('BROWSER', 'none')
  .waitFor(api);

await builder.build().run();

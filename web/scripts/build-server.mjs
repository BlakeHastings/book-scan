/**
 * The server build (#512).
 *
 *     cd web && npm run build:server
 *
 * Until this existed there was no server build at all: every way of starting
 * this app ran TypeScript source through `tsx`, including the scheduled task
 * that serves the owner's live catalogue. `docs/deployment-survey.md` section 3
 * is where that was established, and `docs/running-from-a-build.md` is where
 * the choice below is argued rather than asserted.
 *
 * ## Why a bundler and not a `tsc` emit
 *
 * `tsc` emits, and what it emits does not run. The sources address each other
 * without file extensions (`import './db.pg'`), which is what `tsx` and Vite
 * resolve today and what Node's ESM loader refuses:
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *     '...\dist-server-trial\instrumentation' imported from
 *     '...\dist-server-trial\server\index.js'
 *
 * observed by doing it, on 2026-09-03. `tsc` will not rewrite a specifier, so
 * making its output runnable means putting `.js` on 359 relative imports across
 * 75 files in `server/`, `infrastructure/`, `application/`, `domain/` and
 * `shared/`, a change to every layer made for the build's benefit, or writing a
 * resolver here to do it afterwards. esbuild already resolves exactly what tsx
 * and Vite resolve, so the build agrees with development by construction.
 *
 * **This does not flatten the layers.** They were never enforced by the module
 * layout: `npm run lint:layers` is `dependency-cruiser` over the *source*
 * graph, it runs unchanged in CI, and a domain file importing from
 * infrastructure still fails the pull request. What a bundler flattens is the
 * artefact, and the artefact is not what that check reads. The client half of
 * this repository has bundled `src/`, `shared/` and `domain/` into two chunks
 * since `vite build` existed, and nobody calls that a layering change.
 *
 * ## What is deliberately not bundled
 *
 * `packages: 'external'`. Nothing from `node_modules` goes in, so `sharp`,
 * `onnxruntime-node` and the wasm OCR and barcode stacks are loaded at runtime
 * exactly as they are today, from the tree `npm ci` installed. A deployment
 * ships `node_modules` either way; what it no longer ships is the TypeScript
 * and a compiler to read it.
 *
 * ## The one thing bundling changes, and why the migrations are copied
 *
 * `import.meta.url` stops meaning "this module" and starts meaning "the
 * bundle". Three of the five sites that use it are test-only; the one that runs
 * in production is `MIGRATIONS_FOLDER` in `infrastructure/db/migrate.ts`, which
 * reads the 30 `.sql` files off disk at startup. So they are copied next to the
 * bundle and counted, and the count is checked here rather than discovered on a
 * first start against somebody's database.
 */

import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('../', import.meta.url))

/*
 * `web/dist-server/`, and the sibling relationship to `web/dist/` is load
 * bearing rather than cosmetic. `server/index.ts` finds the built client with
 * `new URL('../dist/', import.meta.url)`, which names `web/dist` from
 * `web/server/index.ts` under tsx and from `web/dist-server/index.js` under
 * `npm start`. Move this output one directory deeper or shallower and the
 * server stops finding the client it is supposed to serve.
 */
const OUT = join(WEB, 'dist-server')
const ENTRY = join(WEB, 'server', 'index.ts')
/*
 * The second entry point, and it is here because of the image (#531).
 *
 * Who is allowed in is decided outside the app, by `scripts/enable-user.ts`,
 * and `docs/the-gate.md` gives the reason: a route that admits somebody needs a
 * role, and #171 has not decided one. That is a fine answer while the only way
 * to run this app is a checkout with `tsx` in it. It stops being one the moment
 * the app is an image, because **the first user cannot be enabled by an enabled
 * user, and an image that cannot admit anybody is a login screen with nothing
 * behind it.**
 *
 * So it is bundled beside the server, run as `node dist-server/enable-user.js`,
 * and the runtime stage still carries no TypeScript and no compiler. It is
 * built separately rather than as a second entry point in one call on purpose:
 * esbuild derives output paths from the common ancestor of its entry points, so
 * one call with both would write `dist-server/server/index.js` and break the
 * `../dist/` sibling relationship the client serving depends on.
 */
const ADMIT_ENTRY = join(WEB, 'scripts', 'enable-user.ts')
const MIGRATIONS_SRC = join(WEB, 'infrastructure', 'db', 'migrations')
const MIGRATIONS_OUT = join(OUT, 'migrations')

const sqlFiles = (dir) => readdirSync(dir).filter((name) => name.endsWith('.sql'))

/** Bytes, as a build log wants to read them. */
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const result = await build({
  entryPoints: [ENTRY],
  outfile: join(OUT, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  // The floor of `engines.node` in the root package.json, not the version this
  // machine happens to run. A build that only works on the developer's Node is
  // the thing this issue exists to end.
  target: 'node20.19',
  // Everything in node_modules stays in node_modules. See the header.
  packages: 'external',
  /*
   * Source maps, and this is not the same question as the client's.
   *
   * Nothing serves this file. `express.static` is mounted over `web/dist`, the
   * client, and never over `web/dist-server`, so a map here reaches nobody but
   * whoever is reading the server's own logs. What it buys is a stack trace
   * that names `server/index.ts:4020` instead of `index.js:13567`, on the one
   * process that now has no compiler behind it. `npm start` passes
   * `--enable-source-maps` so Node actually reads it.
   */
  sourcemap: true,
  logLevel: 'info',
  metafile: true,
})

/*
 * The same settings as the server, and they are the same for the same reasons:
 * the node target is the floor of `engines.node`, packages stay external so
 * `pg` is loaded from the installed tree, and the map is there because nothing
 * serves this file either.
 */
await build({
  entryPoints: [ADMIT_ENTRY],
  outfile: join(OUT, 'enable-user.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20.19',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
})

if (!existsSync(MIGRATIONS_SRC)) {
  throw new Error(`No migrations at ${MIGRATIONS_SRC}`)
}
cpSync(MIGRATIONS_SRC, MIGRATIONS_OUT, { recursive: true })

/*
 * Checked, not assumed. `applySchema` reads `migrations/meta/_journal.json` and
 * every `.sql` beside it before the process listens, so a copy that silently
 * missed a file would come back as a failed start against a real catalogue.
 * Comparing the counts here is the difference between finding that in a build
 * and finding it on somebody's database.
 */
const wanted = sqlFiles(MIGRATIONS_SRC).length
const got = sqlFiles(MIGRATIONS_OUT).length
if (wanted !== got) {
  throw new Error(`Copied ${got} migrations, expected ${wanted}`)
}
const journal = join(MIGRATIONS_OUT, 'meta', '_journal.json')
if (!existsSync(journal)) {
  throw new Error(`No migration journal at ${journal}`)
}

const bundle = join(OUT, 'index.js')
const emitted = Object.entries(result.metafile.outputs)
  .find(([name]) => name.endsWith('index.js'))
const admit = join(OUT, 'enable-user.js')
console.log(
  `[build:server] ${relative(WEB, bundle)} ${kb(statSync(bundle).size)}`
  + ` from ${Object.keys(emitted[1].inputs).length} modules,`
  + ` ${wanted} migrations beside it in ${relative(WEB, MIGRATIONS_OUT)}`,
)
console.log(
  `[build:server] ${relative(WEB, admit)} ${kb(statSync(admit).size)},`
  + ' so a deployment can admit its first user with no checkout',
)
console.log('[build:server] start it with `npm start` from web/')

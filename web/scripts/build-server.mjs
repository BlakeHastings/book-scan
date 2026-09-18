/**
 * The server build.
 *
 *     cd web && npm run build:server
 *
 * Nothing from `node_modules` is bundled (`packages: 'external'`), so `sharp`,
 * `onnxruntime-node` and the wasm OCR and barcode stacks are loaded at runtime
 * from the tree `npm ci` installed, exactly as they are today.
 *
 * Bundling changes what `import.meta.url` means: it stops naming this module
 * and starts naming the bundle. The one production use of it,
 * `MIGRATIONS_FOLDER` in `infrastructure/db/migrate.ts`, reads the `.sql`
 * files off disk at startup, so they are copied next to the bundle and the
 * count is checked here rather than discovered on a first start against
 * somebody's database.
 */

import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('../', import.meta.url))

// `server/index.ts` finds the built client with `new URL('../dist/',
// import.meta.url)`, which names `web/dist` from `web/dist-server/index.js`
// under `npm start`. Move this output one directory deeper or shallower and
// the server stops finding the client it is supposed to serve.
const OUT = join(WEB, 'dist-server')
const ENTRY = join(WEB, 'server', 'index.ts')
// Bundled beside the server so `scripts/enable-user.ts` can run as `node
// dist-server/enable-user.js`, since the runtime image carries no TypeScript
// and no compiler. Built separately rather than as a second entry point in
// one call: esbuild derives output paths from the common ancestor of its
// entry points, so one call with both would write `dist-server/server/index.js`
// and break the `../dist/` sibling relationship above.
const ADMIT_ENTRY = join(WEB, 'scripts', 'enable-user.ts')
const MIGRATIONS_SRC = join(WEB, 'infrastructure', 'db', 'migrations')
const MIGRATIONS_OUT = join(OUT, 'migrations')

const sqlFiles = (dir) => readdirSync(dir).filter((name) => name.endsWith('.sql'))

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
  // machine happens to run.
  target: 'node20.19',
  // Everything in node_modules stays in node_modules. See the header.
  packages: 'external',
  // Nothing serves this file, so it reaches nobody but whoever reads the
  // server's own logs; it turns a stack trace into `server/index.ts:4020`
  // instead of `index.js:13567`. `npm start` passes `--enable-source-maps` so
  // Node actually reads it.
  sourcemap: true,
  logLevel: 'info',
  metafile: true,
})

// The same settings as the server, for the same reasons.
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

// `applySchema` reads `migrations/meta/_journal.json` and every `.sql` beside
// it before the process listens, so a copy that silently missed a file would
// come back as a failed start against a real catalogue rather than here.
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

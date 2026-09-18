// Holds `deploy/contract.json` to the code it describes, in both directions: a
// variable read and not declared is one a deployer was never told about, and a
// variable declared and no longer read is one they set for nothing.
//
// It also holds the facts a deployer trips over to the files that decide them:
// the port and the mount to the Dockerfile, the bind to `web/server/bind.ts`
// and the listen call it feeds, and the Postgres major to
// `postgres-version.json`.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Where a deployment's environment can be read from.
 *
 * The client is not here on purpose: it reads no environment at run time and
 * cannot, because Vite inlines `import.meta.env` at build time and there is no
 * `process` in a browser.
 */
const SCANNED = [
  join('web', 'server'),
  join('web', 'infrastructure'),
  join('web', 'domain'),
  join('web', 'application'),
  join('web', 'shared'),
  join('web', 'scripts'),
  join('web', 'instrumentation.ts'),
]

/**
 * Read at run time and deliberately not part of a deployment's surface. Each is
 * a tool or a harness rather than the server, and each carries its reason rather
 * than sitting here as a bare name.
 */
export const NOT_A_DEPLOYMENT_SURFACE = new Map([
  ['BOOKSCAN_TEST_DATABASE_URL', 'the test harness only, and the only connection variable it reads'],
  ['BOOKSCAN_SEED_TARGET', 'web/scripts/seed-world.ts, a development seeder'],
  ['BOOKSCAN_REBUILD_TARGET', 'web/scripts/rebuild-projection.ts, a maintenance command'],
  ['BOOKSCAN_BACKUP_SOURCE', 'web/server/backup-catalogue.ts, which takes its target on its own command line'],
  ['BOOKSCAN_BACKUP_SCRATCH', 'web/server/backup-catalogue.ts, as above'],
  ['BOOKSCAN_E2E_RUN', 'the browser suite, read by apphost.mts'],
])

/** Comments out, so a variable named in prose is not read as a variable that is read. */
export function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/**
 * Every environment variable name a file reads.
 *
 * The last shape is what catches `web/server/auth/providers.ts`, which names its
 * variables once as exported constants and then indexes an environment with
 * them, so a scan for `process.env.` alone would miss the sign-in surface.
 */
export function envNamesIn(source) {
  const text = withoutComments(source)
  const names = new Set()

  const add = (name) => {
    if (/^(?:[A-Z][A-Z0-9_]*|ConnectionStrings__[A-Za-z0-9_]+)$/.test(name)) names.add(name)
  }

  for (const m of text.matchAll(/process\.env\.([A-Za-z_$][\w$]*)/g)) add(m[1])
  for (const m of text.matchAll(/process\.env\[\s*['"`]([^'"`]+)['"`]\s*\]/g)) add(m[1])
  for (const m of text.matchAll(/\benv\[\s*['"`]([^'"`]+)['"`]\s*\]/g)) add(m[1])
  for (const m of text.matchAll(/['"`](BOOKSCAN_[A-Z0-9_]+|OTEL_[A-Z0-9_]+|GOOGLE_BOOKS_API_KEY|ConnectionStrings__[A-Za-z0-9_]+)['"`]/g)) add(m[1])

  return names
}

/** Every `.ts` file under a path, minus the tests, which read variables no deployment sets. */
function sourceFiles(path) {
  const full = join(root, path)
  if (statSync(full).isFile()) return [path]

  const found = []
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      found.push(...sourceFiles(child))
    } else if (/\.m?ts$/.test(entry.name) && !/\.test\.m?ts$/.test(entry.name)) {
      found.push(child)
    }
  }
  return found
}

/** `read` is a Map of name to the files that read it. */
export function compare(read, declared) {
  const problems = []
  const byName = new Map(declared.map((one) => [one.name, one]))

  for (const [name, files] of read) {
    if (byName.has(name)) continue
    if (NOT_A_DEPLOYMENT_SURFACE.has(name)) continue
    problems.push(
      `${name} is read at ${files.join(', ')} and deploy/contract.json does not declare it. ` +
      'Add it, or add it to NOT_A_DEPLOYMENT_SURFACE in this script with the reason it is not one.',
    )
  }

  for (const entry of declared) {
    if (entry.readAt === null) continue // Read by a dependency rather than by this app; the contract says so.
    const files = read.get(entry.name)
    if (!files) {
      problems.push(
        `deploy/contract.json declares ${entry.name} and nothing reads it any more. ` +
        'A variable a deployment sets and the app ignores is worse than one nobody documented.',
      )
      continue
    }
    if (!files.includes(entry.readAt)) {
      problems.push(
        `deploy/contract.json says ${entry.name} is read at ${entry.readAt}; it is read at ${files.join(', ')}.`,
      )
    }
  }

  return problems
}

export function factProblems({ contract, dockerfile, serverIndex, serverBind, postgres }) {
  const problems = []
  const say = (claim, ok) => { if (!ok) problems.push(claim) }

  /*
   * Four things have to agree about the bind: which variable decides it, what
   * each word means, which word is the default, and that the listen call takes
   * the address those produced rather than one of its own. The last is the one
   * worth having, because everything above it could be right while `app.listen`
   * still carried a literal.
   */
  say(
    `the contract says ${contract.network.bindVariable} chooses the bind, and web/server/bind.ts reads a different name`,
    serverBind.includes(`export const BIND = '${contract.network.bindVariable}'`),
  )
  for (const [word, address] of Object.entries(contract.network.bindOptions)) {
    say(
      `the contract says ${contract.network.bindVariable}=${word} binds ${address}, and web/server/bind.ts does not`,
      new RegExp(`^ {2}${word}: '${address.replace(/\./g, '\\.')}',$`, 'm').test(serverBind),
    )
  }
  say(
    `the contract says the bind defaults to ${contract.network.bindDefault}, and web/server/bind.ts does not`,
    serverBind.includes(`export const DEFAULT_BIND: BindName = '${contract.network.bindDefault}'`),
  )
  say(
    `the contract says the server binds ${contract.network.bind} by default, and its own bindOptions say ` +
    `${contract.network.bindDefault} is ${contract.network.bindOptions[contract.network.bindDefault]}`,
    contract.network.bindOptions[contract.network.bindDefault] === contract.network.bind,
  )
  say(
    'the contract says the bind is chosen by a variable, and web/server/index.ts listens on an address of its own',
    serverIndex.includes('app.listen(PORT, BIND.address'),
  )
  say(
    `the contract says the port is ${contract.network.port}, and the Dockerfile does not EXPOSE it`,
    new RegExp(`^EXPOSE ${contract.network.port}$`, 'm').test(dockerfile),
  )
  say(
    `the contract says the Dockerfile defaults PORT to ${contract.image.env.PORT}`,
    dockerfile.includes(`ENV PORT=${contract.image.env.PORT}`),
  )
  const mount = contract.mounts.find((one) => one.required)
  say(
    `the contract says ${mount.path} is the mount, and the Dockerfile does not declare it`,
    dockerfile.includes(`VOLUME ["${mount.path}"]`),
  )
  say(
    `the contract says the image sets BOOKSCAN_DATA to ${contract.image.env.BOOKSCAN_DATA}`,
    dockerfile.includes(`ENV BOOKSCAN_DATA=${contract.image.env.BOOKSCAN_DATA}`),
  )
  say(
    `the contract says the image sets HOME to ${contract.image.env.HOME}`,
    dockerfile.includes(`ENV HOME=${contract.image.env.HOME}`),
  )
  say(
    'the contract says the image does not run as root, and the Dockerfile has no USER node',
    contract.image.runsAsRoot === false && /^USER node$/m.test(dockerfile),
  )
  const cmd = /^CMD (\[.*\])$/m.exec(dockerfile)
  say(
    "the contract's entrypoint is not the Dockerfile's CMD",
    cmd !== null && JSON.stringify(JSON.parse(cmd[1])) === JSON.stringify(contract.image.entrypoint),
  )
  say(
    'the contract says the image carries no HEALTHCHECK, and the Dockerfile has one',
    contract.image.healthcheck === null && !/^HEALTHCHECK\b/m.test(dockerfile),
  )
  say(
    `the contract says Postgres ${contract.dependencies.postgres.major}, postgres-version.json says ${postgres.tag}`,
    String(contract.dependencies.postgres.major) === String(postgres.tag),
  )
  say(
    'the contract names a registry repository that is not lowercase, which a registry will refuse',
    contract.image.repository === contract.image.repository.toLowerCase(),
  )

  return problems
}

/**
 * Nothing in the contract may name a place: a hostname that arrives here is a
 * hostname that is public forever.
 *
 * Deliberately crude. It looks for the shape of a host rather than for a list of
 * known-bad strings, and every exception is named one by one.
 */
export function siteSpecificProblems(contract, allowedHosts) {
  const problems = []
  const allowed = new Set(allowedHosts)

  // RFC 2606 keeps `example` and `localhost` for exactly this: a document that
  // has to show the shape of a URL without naming a place.
  const excused = (host) =>
    allowed.has(host) ||
    host === 'localhost' ||
    /(^|\.)(?:example|invalid|localhost)(\.|$)/.test(host)

  const text = JSON.stringify(contract)

  for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
    if (!excused(m[1])) problems.push(`deploy/contract.json names the host ${m[1]}, and only the public catalogue origins may appear in it`)
  }
  for (const m of text.matchAll(/\b(?:[A-Za-z0-9-]+\.)+(?:com|net|org|io|dev|app|uk|co|home|lan|local|internal)\b/g)) {
    if (!excused(m[0])) problems.push(`deploy/contract.json contains ${m[0]}, which looks like a hostname. Nothing site-specific belongs here.`)
  }

  return problems
}

function main() {
  const contract = JSON.parse(readFileSync(join(root, 'deploy', 'contract.json'), 'utf8'))

  const read = new Map()
  for (const path of SCANNED) {
    for (const file of sourceFiles(path)) {
      const names = envNamesIn(readFileSync(join(root, file), 'utf8'))
      const asPosix = relative(root, join(root, file)).split(sep).join('/')
      for (const name of names) {
        if (!read.has(name)) read.set(name, [])
        read.get(name).push(asPosix)
      }
    }
  }

  const problems = [
    ...compare(read, contract.environment),
    ...factProblems({
      contract,
      dockerfile: readFileSync(join(root, 'Dockerfile'), 'utf8'),
      serverIndex: readFileSync(join(root, 'web', 'server', 'index.ts'), 'utf8'),
      serverBind: readFileSync(join(root, 'web', 'server', 'bind.ts'), 'utf8'),
      postgres: JSON.parse(readFileSync(join(root, 'postgres-version.json'), 'utf8')),
    }),
    ...siteSpecificProblems(contract, [
      ...contract.dependencies.outboundHttps.hosts.map((one) => one.host),
      /*
       * A host is allowed to appear in this contract only because the contract
       * also declares that a deployment must be able to reach it. Nothing is
       * excused by being written into this script.
       */
      ...contract.dependencies.outboundHttps.signInHosts.map((one) => one.host),
      contract.image.registry,
    ]),
  ]

  // A check that passes because it found nothing proves nothing.
  if (read.size === 0) {
    problems.push('no environment variables were found in the scanned source at all, so this check proved nothing')
  }

  if (problems.length > 0) {
    console.error('deploy/contract.json and the code it describes disagree:\n')
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('\nSee docs/publishing.md. The contract is what a private repository deploys from.')
    process.exit(1)
  }

  console.log(
    `deploy/contract.json holds: ${contract.environment.length} variables declared, ` +
    `${read.size} read in ${SCANNED.length} scanned paths, the port, bind, mount and Postgres major all agree.`,
  )
}

if (process.argv[1] && process.argv[1].endsWith('check-deploy-contract.mjs')) main()

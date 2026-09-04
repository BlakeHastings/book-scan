// Holds `deploy/contract.json` to the code it describes.
//
// WHY THIS EXISTS
// The contract is the thing a private repository deploys from without reading
// this one's source. That is only worth anything while it is true, and a
// document describing an environment surface is exactly the kind of file that
// stops being true silently: somebody adds `process.env.BOOKSCAN_SOMETHING`,
// the app works on their machine, and the deployer finds out at runtime that
// there is a variable nobody told them about. Both directions matter — a
// variable declared and no longer read is a deployer setting something that
// does nothing, which is the failure this project keeps finding.
//
// This project has form here, which is why the contract is checked rather than
// reviewed: a guard that never loaded, a check whose only reader was a log
// line, a build CI had never run. A contract nobody verifies is the same shape.
//
// It also holds the four facts a deployer trips over to the files that decide
// them: the port and the mount to the Dockerfile, the loopback bind to the
// server, and the Postgres major to `postgres-version.json`, which is the one
// place that version is written.
//
// Usage, from a workflow step or by hand at the repository root:
//   node scripts/check-deploy-contract.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Where a deployment's environment can be read from.
 *
 * The client is not here on purpose: it reads no environment at run time, and
 * cannot — Vite inlines `import.meta.env` at build time and there is no
 * `process` in a browser. `web/vite.config.ts` reads two variables and both
 * configure the dev server, which no deployment runs.
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
 * Read at run time and deliberately not part of a deployment's surface.
 *
 * Each one is a tool or a harness rather than the server, and each is here with
 * the reason rather than as a bare name, because the next person to add one has
 * to make the same argument. `docs/deployment-survey.md` calls these the blast
 * radius: they are not configuration a deployment sets, and an ambient value
 * can still point one of them somewhere it should not go.
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
 * Four shapes, because this codebase uses four. The last one is what catches
 * `web/server/auth/providers.ts`, which names its variables once as exported
 * constants and then indexes an environment with them, so a scan for
 * `process.env.` alone would miss the whole sign-in surface.
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

/**
 * The two directions, as a pure function so the tests can drive both.
 *
 * `read` is a Map of name to the files that read it; `declared` is the
 * contract's environment array.
 */
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

/**
 * The facts a deployer meets first, checked against the files that decide them
 * rather than against the last person to edit the contract.
 */
export function factProblems({ contract, dockerfile, serverIndex, postgres }) {
  const problems = []
  const say = (claim, ok) => { if (!ok) problems.push(claim) }

  say(
    `the contract says the server binds ${contract.network.bind}, and web/server/index.ts does not`,
    serverIndex.includes(`app.listen(PORT, '${contract.network.bind}'`),
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
 * Nothing in the contract may name a place. The whole point of publishing it is
 * that the repository consuming it never has to tell this one anything, and the
 * exposure runs both ways: a hostname that arrives here is a hostname that is
 * public forever.
 *
 * Deliberately crude. It looks for the shape of a host rather than for a list
 * of known-bad strings. The exceptions are named one by one: the five public
 * catalogue origins this app talks to, which are already in its source, and the
 * registry the image is published to, which is a property of this repository
 * rather than of anywhere it runs.
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
      postgres: JSON.parse(readFileSync(join(root, 'postgres-version.json'), 'utf8')),
    }),
    ...siteSpecificProblems(contract, [
      ...contract.dependencies.outboundHttps.hosts.map((one) => one.host),
      /*
       * The identity providers' own hosts (#537). Excused on exactly the same
       * terms as the catalogue origins above, and for the same reason: a host is
       * allowed to appear in this contract only because the contract also
       * declares that a deployment must be able to reach it. Nothing is excused
       * by being written into this script.
       *
       * This became load-bearing rather than tidy when Microsoft arrived.
       * `login.microsoftonline.com` is the one host this repository does write
       * down, because a discovery document is only worth reading on account of
       * where it was fetched from, and a deployment that cannot reach it can
       * sign nobody in through that door.
       */
      ...contract.dependencies.outboundHttps.signInHosts.map((one) => one.host),
      contract.image.registry,
    ]),
  ]

  // A check that passes because it found nothing is the failure this file is
  // about, so say what it read.
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

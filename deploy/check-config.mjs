#!/usr/bin/env node
/**
 * Check a deployment's configuration against `contract.json`, before anything
 * starts.
 *
 * This is the machine-readable half of #533. The contract beside this file says
 * what the server reads and what it refuses; this reads an environment and says
 * which of those a given configuration gets wrong. It is shipped inside the
 * published image at `/app/deploy/`, so the repository that deploys this can ask
 * the image itself rather than reading this repository's source:
 *
 *     docker run --rm --env-file ./its-own-env <image> \
 *       node /app/deploy/check-config.mjs
 *
 * or, without handing a container the values at all:
 *
 *     docker run --rm -v "$PWD/its-own-env:/tmp/env:ro" <image> \
 *       node /app/deploy/check-config.mjs --env-file /tmp/env
 *
 * **It prints names and never values.** Two of the variables it looks at are a
 * Postgres password and an OAuth client secret, and a checker whose output could
 * not be pasted into an issue would not be run.
 *
 * It has no dependencies and imports nothing from the app, so it works in the
 * runtime image, in a checkout with no `node_modules`, and in the consumer's CI.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not open a connection, resolve a hostname, or check that a mount
 * exists. Everything it knows comes from the contract and from names in an
 * environment, which is what makes it safe to run anywhere, including somewhere
 * that has no access to the deployment it is checking.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CONTRACT = fileURLToPath(new URL('./contract.json', import.meta.url))

/** A variable is set if it exists and is not blank. Empty means unset everywhere in this app. */
function set(env, name) {
  return typeof env[name] === 'string' && env[name].trim() !== ''
}

/**
 * The whole check, as a pure function, so the tests drive it rather than a process.
 *
 * Returns problems in two severities and a third list that is neither. `errors`
 * are configurations the app will refuse or that will be quietly wrong; the
 * exit code is theirs alone. `warnings` are things worth a second look.
 */
export function checkConfig(env, contract, options = {}) {
  const errors = []
  const warnings = []
  const notes = []

  const declared = new Map(contract.environment.map((one) => [one.name, one]))

  // 1. Required, and the one refusal that is also a requirement.
  for (const entry of contract.environment) {
    if (!entry.required) continue
    if (set(env, entry.name)) continue
    errors.push(
      `${entry.name} is not set, and it is required. ${entry.whenAbsent}`,
    )
  }

  // 2. Variables the contract says a deployment must not set. Driven off the
  //    contract's own wording rather than a second list here, so there is one
  //    place to change when a variable changes character.
  for (const entry of contract.environment) {
    const rule = entry.deployments ?? ''
    if (!rule.startsWith('must not set')) continue
    if (!set(env, entry.name)) continue
    if (options.allowDevelopment) {
      warnings.push(`${entry.name} is set. ${rule} Allowed here by --allow-development.`)
      continue
    }
    errors.push(`${entry.name} is set. It ${rule}`)
  }

  // 3. The refusals the server makes at start, asked here instead. Each one is
  //    an id in the contract, so the message a deployer gets and the behaviour
  //    they will meet come from the same place.
  const refusal = (id) => contract.refusals.find((one) => one.id === id)

  const googleId = set(env, 'BOOKSCAN_OIDC_GOOGLE_CLIENT_ID')
  const googleSecret = set(env, 'BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET')
  if (googleId !== googleSecret) {
    const missing = googleId
      ? 'BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET'
      : 'BOOKSCAN_OIDC_GOOGLE_CLIENT_ID'
    errors.push(`${missing} is missing and the other half of the pair is set. ${refusal('half-a-google').result}`)
  }

  /*
   * Microsoft, and three names rather than two (#537). The tenant is in the set
   * because Microsoft's issuer is scoped to one and there is deliberately no
   * default: a deployment says which authority it admits, or the process refuses
   * to start.
   */
  const microsoft = [
    'BOOKSCAN_OIDC_MICROSOFT_CLIENT_ID',
    'BOOKSCAN_OIDC_MICROSOFT_CLIENT_SECRET',
    'BOOKSCAN_OIDC_MICROSOFT_TENANT',
  ]
  const microsoftSet = microsoft.filter((name) => set(env, name))
  const microsoftMissing = microsoft.filter((name) => !set(env, name))
  if (microsoftSet.length > 0 && microsoftMissing.length > 0) {
    errors.push(
      `${microsoftMissing.join(' and ')} ${microsoftMissing.length === 1 ? 'is' : 'are'} ` +
      `missing and the rest of the set is present. ${refusal('half-a-microsoft').result}`,
    )
  }

  /*
   * The one this file exists to catch early, because the alternative is a
   * deployer reading "common" in every example on the internet, setting it, and
   * meeting the refusal at start with the container already scheduled.
   */
  const tenant = (env.BOOKSCAN_OIDC_MICROSOFT_TENANT ?? '').trim().toLowerCase()
  if (tenant === 'common' || tenant === 'organizations') {
    errors.push(
      `BOOKSCAN_OIDC_MICROSOFT_TENANT is "${tenant}". ` +
      `${refusal('microsoft-authority-with-no-issuer').result}`,
    )
  }

  const hasRealProvider = (googleId && googleSecret) || microsoftMissing.length === 0 && microsoftSet.length === 3
  if (hasRealProvider && !set(env, 'BOOKSCAN_PUBLIC_ORIGIN')) {
    errors.push(`BOOKSCAN_PUBLIC_ORIGIN is empty and a sign-in provider is configured. ${refusal('provider-without-origin').result}`)
  }

  if (hasRealProvider && set(env, 'BOOKSCAN_DEV_SIGN_IN')) {
    errors.push(`BOOKSCAN_DEV_SIGN_IN is set beside a real sign-in provider. ${refusal('dev-door-beside-a-real-provider').result}`)
  }

  // 4. The origin, when there is one, has to be an absolute origin with a
  //    scheme, because it is concatenated into a redirect URI. A host on its
  //    own produces a URI no provider will accept, and the app does not check.
  if (set(env, 'BOOKSCAN_PUBLIC_ORIGIN')) {
    const value = env.BOOKSCAN_PUBLIC_ORIGIN.trim()
    let parsed = null
    try {
      parsed = new URL(value)
    } catch {
      errors.push('BOOKSCAN_PUBLIC_ORIGIN is not an absolute URL. It is the origin a browser reaches this app on, scheme included, and it is concatenated into the redirect URI a provider is given.')
    }
    if (parsed && parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      errors.push(`BOOKSCAN_PUBLIC_ORIGIN is not https. ${contract.network.tls.why}`)
    }
  } else if (!hasRealProvider) {
    notes.push('No sign-in provider is configured, so nobody new can get in. Anyone already holding a session keeps it. This is a supported state and the server says so on every start.')
  }

  // 5. The mount, which is the failure that does not announce itself.
  const dataMount = contract.mounts.find((one) => one.required)
  if (set(env, 'BOOKSCAN_DATA') && env.BOOKSCAN_DATA.trim() !== dataMount.path) {
    warnings.push(`BOOKSCAN_DATA is set to something other than ${dataMount.path}, which is the directory the image declares and the one this contract describes as the mount. Only do this if the mount moved with it: ${dataMount.whenMissing}`)
  }

  // 6. Names that look like they were meant for this app and are not read by it.
  //    A typo in an optional variable is otherwise completely silent: the app
  //    starts, and the setting simply does nothing.
  const known = new Set(declared.keys())
  known.add('OTEL_EXPORTER_OTLP_TRACES_PROTOCOL')
  known.add('OTEL_EXPORTER_OTLP_METRICS_PROTOCOL')
  for (const name of Object.keys(env)) {
    if (known.has(name)) continue
    if (!/^(BOOKSCAN_|ConnectionStrings__)/.test(name)) continue
    warnings.push(`${name} is set and nothing reads it. Check the spelling against the contract; an unread variable is silent, and the app will start without it doing anything.`)
  }

  // 7. A port that is not a port.
  if (set(env, 'PORT') && !/^\d+$/.test(env.PORT.trim())) {
    errors.push('PORT is set to something that is not a number. Number(PORT) becomes NaN and the listen call will not do what you meant.')
  }

  // 8. Things that are fine, and that a deployer should know are the state they
  //    are in rather than find out from behaviour. Secrets only: an absent
  //    secret is the one kind of absence that looks like working software and
  //    is not. The sign-in pair is left out because the note above covers it in
  //    one line rather than two, and the two the SDK reads are left out because
  //    this app does not read them.
  const signIn = new Set([
    'BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET', 'BOOKSCAN_OIDC_GOOGLE_CLIENT_ID',
    'BOOKSCAN_OIDC_MICROSOFT_CLIENT_SECRET', 'BOOKSCAN_OIDC_MICROSOFT_CLIENT_ID',
    'BOOKSCAN_OIDC_MICROSOFT_TENANT',
  ])
  for (const entry of contract.environment) {
    if (entry.required || !entry.secret || !entry.readAt) continue
    if (signIn.has(entry.name)) continue
    if (set(env, entry.name)) continue
    notes.push(`${entry.name} is not set. ${entry.whenAbsent}`)
  }

  return { errors, warnings, notes }
}

/** `KEY=value` lines, the subset of dotenv this needs and nothing clever. */
export function parseEnvFile(text) {
  const env = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

const HELP = `Check a deployment's configuration against the contract beside this file.

  node check-config.mjs [--env-file <path>] [--allow-development] [--json]

  --env-file <path>     Read KEY=value lines from a file instead of this process's
                        environment. Nothing is executed and nothing is exported.
  --allow-development   Downgrade "a deployment must not set this" to a warning.
  --json                Machine-readable output.

Prints variable names and never their values. Exits 1 when something is wrong.`

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP)
    return 0
  }

  const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'))

  let env = process.env
  const fileFlag = argv.indexOf('--env-file')
  if (fileFlag !== -1) {
    const path = argv[fileFlag + 1]
    if (!path) {
      console.error('--env-file needs a path.')
      return 1
    }
    env = parseEnvFile(readFileSync(path, 'utf8'))
  }

  const result = checkConfig(env, contract, {
    allowDevelopment: argv.includes('--allow-development'),
  })

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ok: result.errors.length === 0, ...result }, null, 2))
    return result.errors.length === 0 ? 0 : 1
  }

  console.log(`book-scan deployment contract ${contract.contract}, ${contract.image.reference}`)
  console.log('')

  for (const line of result.errors) console.log(`  WRONG    ${line}`)
  for (const line of result.warnings) console.log(`  CHECK    ${line}`)
  for (const line of result.notes) console.log(`  note     ${line}`)

  console.log('')
  if (result.errors.length === 0) {
    console.log('Nothing here will stop this deploying. What this cannot check is on the other side of the network:')
    console.log(`  - ${contract.network.readThisFirst}`)
    console.log(`  - ${contract.mounts[0].whenMissing}`)
    return 0
  }

  const count = result.errors.length
  console.log(`${count} ${count === 1 ? 'thing' : 'things'} to fix before this deploys.`)
  return 1
}

// Only when run, so the tests can import the functions above.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2))
}

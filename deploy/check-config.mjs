#!/usr/bin/env node
/**
 * Check a deployment's configuration against `contract.json`, before anything
 * starts.
 *
 * It prints names and never values: two of the variables it looks at are a
 * Postgres password and an OAuth client secret.
 *
 * It has no dependencies and imports nothing from the app, so it works in the
 * runtime image, in a checkout with no `node_modules`, and in the consumer's CI.
 * It does not open a connection, resolve a hostname, or check that a mount
 * exists, which is what makes it safe to run anywhere.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CONTRACT = fileURLToPath(new URL('./contract.json', import.meta.url))

/** Empty means unset, everywhere in this app. */
function set(env, name) {
  return typeof env[name] === 'string' && env[name].trim() !== ''
}

/**
 * `errors` are configurations the app will refuse or that will be quietly
 * wrong, and the exit code is theirs alone. `warnings` are worth a second look,
 * and `notes` are neither.
 */
export function checkConfig(env, contract, options = {}) {
  const errors = []
  const warnings = []
  const notes = []

  const declared = new Map(contract.environment.map((one) => [one.name, one]))

  for (const entry of contract.environment) {
    if (!entry.required) continue
    if (set(env, entry.name)) continue
    errors.push(
      `${entry.name} is not set, and it is required. ${entry.whenAbsent}`,
    )
  }

  // Driven off the contract's own wording rather than a second list here.
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

  // The refusals the server makes at start, asked here instead. Each is an id in
  // the contract, so the message and the behaviour come from the same place.
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
   * Three names rather than two. The tenant is in the set because Microsoft's
   * issuer is scoped to one and there is deliberately no default.
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

  // `common` is what every example on the internet says, and the server refuses
  // it at start.
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

  // The origin has to carry a scheme, because it is concatenated into a redirect
  // URI. A host on its own produces a URI no provider will accept, and the app
  // does not check.
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

  const dataMount = contract.mounts.find((one) => one.required)
  if (set(env, 'BOOKSCAN_DATA') && env.BOOKSCAN_DATA.trim() !== dataMount.path) {
    warnings.push(`BOOKSCAN_DATA is set to something other than ${dataMount.path}, which is the directory the image declares and the one this contract describes as the mount. Only do this if the mount moved with it: ${dataMount.whenMissing}`)
  }

  // Names that look like they were meant for this app and are not read by it. A
  // typo in an optional variable is otherwise completely silent.
  const known = new Set(declared.keys())
  known.add('OTEL_EXPORTER_OTLP_TRACES_PROTOCOL')
  known.add('OTEL_EXPORTER_OTLP_METRICS_PROTOCOL')
  for (const name of Object.keys(env)) {
    if (known.has(name)) continue
    if (!/^(BOOKSCAN_|ConnectionStrings__)/.test(name)) continue
    warnings.push(`${name} is set and nothing reads it. Check the spelling against the contract; an unread variable is silent, and the app will start without it doing anything.`)
  }

  if (set(env, 'PORT') && !/^\d+$/.test(env.PORT.trim())) {
    errors.push('PORT is set to something that is not a number. Number(PORT) becomes NaN and the listen call will not do what you meant.')
  }

  /*
   * The bind takes a word rather than an address, so `0.0.0.0` is refused on
   * purpose: an interface address inside a container is assigned at start and
   * changes when the container is replaced. A bind that is open is a decision
   * rather than an error, so it is said back to the deployer as a note.
   */
  const bindOptions = contract.network.bindOptions
  const bindWords = Object.keys(bindOptions)
  if (set(env, contract.network.bindVariable)) {
    const asked = env[contract.network.bindVariable].trim().toLowerCase()
    if (!bindWords.includes(asked)) {
      errors.push(
        `${contract.network.bindVariable} is "${asked}", which is not ${bindWords.join(' or ')}. ` +
        'It takes a word rather than an address, and network.bindNote in the contract beside ' +
        `this file says why. On a start with this set: ${refusal('bind-that-is-not-a-word').result}`,
      )
    } else if (asked !== contract.network.bindDefault) {
      notes.push(
        `${contract.network.bindVariable} is ${asked}, so the server listens on ` +
        `${bindOptions[asked]}: every interface in its network namespace, rather than the ` +
        `default ${contract.network.bindDefault}. Anything that can route to this container ` +
        'reaches the sign-in gate, which is then the only thing in front of the catalogue. ' +
        'That is a supported state and the server says so on every start.',
      )
    }
  }

  // Secrets only: an absent secret is the one kind of absence that looks like
  // working software and is not. The sign-in names are left out because the
  // notes above already cover them.
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
    // Only a trap for a deployment on the default. One that asked for `all` has
    // already been told what it chose in the note above.
    const bind = (env[contract.network.bindVariable] ?? '').trim().toLowerCase()
    if (bind !== 'all') console.log(`  - ${contract.network.readThisFirst}`)
    console.log(`  - ${contract.mounts[0].whenMissing}`)
    // TLS belongs on this list rather than in a check: nothing here can see what
    // is in front of the container, and every correct deployment hands this
    // server plain http, so a check would fire on all of them.
    console.log(`  - ${contract.network.tls.whatBreaksWithoutIt}`)
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

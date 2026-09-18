// Two callers, and they differ in where the image is. `.github/workflows/image.yml`
// builds with `load: true`, so its image is in the runner's own daemon.
// `.github/workflows/publish.yml` builds with `push: true` and no `load:`, so its
// image exists only in the registry and nothing else in that workflow pulls it.
// The ref is therefore fetched here by digest rather than read out of a local
// image store.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CONTRACT = fileURLToPath(new URL('../deploy/contract.json', import.meta.url))

// A connection that goes nowhere. `deploy/check-config.mjs` reads names out of
// an environment and never opens one, so this is the shape of the variable
// rather than a destination.
const A_CONNECTION = 'ConnectionStrings__bookscan=postgres://u:p@db:5432/bookscan'

// `::error::` is how a failure gets a red annotation on an Actions run. Outside
// Actions it is noise, so it is only worn there.
function wrong(message) {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : message)
}

function docker(args, options = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...options })
}

/**
 * Both assertions below are `docker run`, which pulls a missing image on its own,
 * so this exists to make the fetch visible: at a tag the pull is itself the
 * assertion that the image coming back by digest is the one just pushed. It also
 * keeps a missing image a single clear failure rather than two confusing ones.
 */
function fetchIfItIsElsewhere(ref) {
  if (docker(['image', 'inspect', ref], { stdio: 'ignore' }).status === 0) {
    console.log(`${ref} is already in this machine's image store.`)
    return true
  }

  console.log(`${ref} is not in this machine's image store, so it is pulled back from the registry.`)
  // Streamed rather than captured: this pull is the longest thing the script
  // does, and a log that says nothing for minutes reads as a hang.
  if (docker(['pull', ref], { stdio: 'inherit' }).status !== 0) {
    wrong(`Could not pull ${ref}. It is neither on this machine nor available to pull.`)
    return false
  }

  console.log(`Pulled ${ref}.`)
  return true
}

/**
 * Compared over bytes rather than over parsed JSON: the promise is that a
 * consumer reading the file out of the image reads the same file this repository
 * published. `.gitattributes` holds `deploy/**` at LF so that a Windows checkout
 * does not make this fail.
 */
function theContractTravelsWithIt(ref) {
  const inside = docker(['run', '--rm', '--entrypoint', 'cat', ref, '/app/deploy/contract.json'], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  })

  if (inside.status !== 0) {
    wrong(`Could not read /app/deploy/contract.json out of ${ref}.`)
    console.error(inside.stderr?.toString() ?? '')
    return false
  }

  const here = readFileSync(CONTRACT)
  if (here.equals(inside.stdout)) {
    console.log(`The contract inside ${ref} is identical to deploy/contract.json.`)
    return true
  }

  wrong(`The image's contract is not this repository's contract.`)

  const strip = (buffer) => buffer.toString('utf8').replace(/\r\n/g, '\n')
  if (strip(here) === strip(inside.stdout)) {
    console.error(
      'The only difference is line endings. `.gitattributes` keeps `deploy/**` at LF for\n' +
        'exactly this comparison, so a checkout that wrote CRLF is what to look at.',
    )
    return false
  }

  const ours = here.toString('utf8').split('\n')
  const theirs = inside.stdout.toString('utf8').split('\n')
  console.error(`deploy/contract.json is ${here.length} bytes, the image's is ${inside.stdout.length}.`)
  for (let line = 0; line < Math.max(ours.length, theirs.length); line += 1) {
    if (ours[line] === theirs[line]) continue
    console.error(`First difference at line ${line + 1}:`)
    console.error(`  repository: ${ours[line] ?? '(end of file)'}`)
    console.error(`  image:      ${theirs[line] ?? '(end of file)'}`)
    break
  }
  return false
}

function theCheckerInsideItRuns(ref) {
  const empty = docker(['run', '--rm', ref, 'node', '/app/deploy/check-config.mjs'])
  console.log(empty.stdout + empty.stderr)
  if (empty.status !== 1) {
    wrong(`The checker exited ${empty.status} on an environment with no connection string, not 1.`)
    return false
  }

  const good = docker(['run', '--rm', '-e', A_CONNECTION, ref, 'node', '/app/deploy/check-config.mjs'])
  if (good.status !== 0) {
    wrong(`The checker refused a configuration that is correct, exiting ${good.status}.`)
    console.error(good.stdout + good.stderr)
    return false
  }

  console.log('The checker refuses what it should and passes what it should.')
  return true
}

const ref = process.argv[2]
if (!ref) {
  console.error('usage: node scripts/check-image.mjs <image ref>')
  process.exit(2)
}

if (!fetchIfItIsElsewhere(ref)) process.exit(1)

// Both, always, rather than stopping at the first failure: they are independent
// questions.
const contract = theContractTravelsWithIt(ref)
const checker = theCheckerInsideItRuns(ref)

if (!contract || !checker) process.exit(1)

// What is asked of a built image, in one place, because it is asked twice.
//
//     node scripts/check-image.mjs <image ref>
//
// Two questions, both about an image that already exists:
//
//   1. Does the contract inside it match this repository's, byte for byte?
//   2. Does the checker inside it run, refusing an environment with no
//      connection string and passing one that has it?
//
// WHY THIS IS A SCRIPT AND NOT THE SHELL IT USED TO BE
// It is run by `.github/workflows/publish.yml` against the image it has just
// pushed, pulled back by digest, and by `.github/workflows/image.yml` against
// the image a pull request has just built and loaded. Those two callers differ
// in exactly one thing, which is the ref they hand it. Everything else about
// the questions is the same, and #549 is about the tag run being the first time
// any of it happens: the answer to that is not a second copy of the same
// twenty lines of shell in a second workflow, because two copies drift and the
// drift is invisible until a tag. So the assertions live here, once, and the
// version that runs at a tag is the version a pull request has already run.
//
// It takes no options and knows nothing about either caller. A ref is a ref.
//
// WHY THERE IS NO check-image.test.mjs BESIDE IT
// Every branch in here is the exit code of a `docker run`, and a fixture that
// simulated those would be asserting on a mock of the one thing worth testing.
// It is instead executed for real, against a real image, on every pull request
// that can change what the image is. That is a better test than a fixture, and
// it is the test #549 exists to add.

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CONTRACT = fileURLToPath(new URL('../deploy/contract.json', import.meta.url))

// A connection that goes nowhere. The checker never opens one — it reads names
// out of an environment and nothing else (`deploy/check-config.mjs`) — so this
// is the shape of the variable rather than a destination, and there is nothing
// site-specific about it.
const A_CONNECTION = 'ConnectionStrings__bookscan=postgres://u:p@db:5432/bookscan'

// `::error::` is how a failure gets a red annotation on the run rather than a
// line somebody has to go looking for in a log. Outside Actions it is noise, so
// it is only worn there.
function wrong(message) {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : message)
}

function docker(args, options = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...options })
}

/**
 * The contract inside the image, against the contract in this repository.
 *
 * The comparison is over bytes rather than over parsed JSON on purpose: the
 * promise being kept is that a consumer reading the file out of the image reads
 * the same file this repository published, and two byte sequences that parse
 * the same are still two different files to anybody diffing them.
 * `.gitattributes` holds `deploy/**` at LF so that a Windows checkout does not
 * make this fail for a reason that is nobody's mistake.
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

  // Enough to say which file is stale, without printing 31 KB of JSON at
  // somebody who only needs to know that it moved.
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

/**
 * The checker runs, rather than merely being present.
 *
 * A file that is copied into an image and never executed is how a shipped tool
 * turns out to have been broken for months, so this makes it refuse what it
 * should refuse and pass what it should pass, as the image's own non-root user,
 * reading the contract from inside the image.
 */
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

try {
  execFileSync('docker', ['image', 'inspect', ref], { stdio: 'ignore' })
} catch {
  wrong(`No image called ${ref} is present. It has to be built or pulled before this can ask it anything.`)
  process.exit(1)
}

// Both, always, rather than stopping at the first failure: they are independent
// questions and a run that answers one of them is half a diagnosis.
const contract = theContractTravelsWithIt(ref)
const checker = theCheckerInsideItRuns(ref)

if (!contract || !checker) process.exit(1)

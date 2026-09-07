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
// the image a pull request has just built and loaded. #549 is about the tag run
// being the first time any of it happens: the answer to that is not a second
// copy of the same twenty lines of shell in a second workflow, because two
// copies drift and the drift is invisible until a tag. So the assertions live
// here, once, and the version that runs at a tag is the version a pull request
// has already run.
//
// THE TWO CALLERS DIFFER IN MORE THAN THE REF, AND THE DIFFERENCE IS WHERE THE
// IMAGE IS
// This header used to say "a ref is a ref" and that they differed in exactly one
// thing. They do not, and the first version of this script was refused in review
// for it. `image.yml` builds with `load: true`, so its image is in the runner's
// own daemon before this is called. `publish.yml` builds with `push: true` and
// no `load:`, on the `docker-container` driver, so **its image exists only in
// the registry** and there is no `docker pull` step anywhere in that workflow.
// A precheck asking `docker image inspect` therefore passed on every pull
// request and would have failed the first tag, one step after the push, with the
// immutable public tag already created and the release never made: the exact
// failure this issue exists to prevent, reintroduced by the fix for it.
//
// So the fetch is part of this script's job rather than an assumption it makes.
// `fetchIfItIsElsewhere` pulls when the ref is not local and says which of the
// two happened, because at a tag "what was just pushed came back" is itself
// something the run is asserting, and an implicit pull inside a `docker run`
// asserts it without ever saying so. That is what the old shell did, and it is
// why the old shell worked.
//
// WHY THERE IS NO check-image.test.mjs BESIDE IT
// Every branch in here is the exit code of a `docker run`, and a fixture that
// simulated those would be asserting on a mock of the one thing worth testing.
// It is instead executed for real, against a real image, on every pull request
// that can change what the image is. That is a better test than a fixture, and
// it is the test #549 exists to add.

import { spawnSync } from 'node:child_process'
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
 * Make sure the ref names something this machine can run, and say which way it
 * got there.
 *
 * Both assertions below are `docker run`, which pulls a missing image on its
 * own, so this is not what makes them work. What it buys is that the fetch is
 * visible: at a tag the pull *is* the assertion — the image that comes back by
 * digest is the one that was just pushed — and a pull that happens silently
 * inside a `cat` cannot be read as one. It also keeps a missing image a single
 * clear failure rather than two confusing ones.
 */
function fetchIfItIsElsewhere(ref) {
  if (docker(['image', 'inspect', ref], { stdio: 'ignore' }).status === 0) {
    console.log(`${ref} is already in this machine's image store.`)
    return true
  }

  console.log(`${ref} is not in this machine's image store, so it is pulled back from the registry.`)
  // Streamed rather than captured: a 1.49 GB pull is the longest thing this
  // script does and a log that says nothing for two minutes reads as a hang.
  if (docker(['pull', ref], { stdio: 'inherit' }).status !== 0) {
    wrong(`Could not pull ${ref}. It is neither on this machine nor available to pull.`)
    return false
  }

  console.log(`Pulled ${ref}.`)
  return true
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

if (!fetchIfItIsElsewhere(ref)) process.exit(1)

// Both, always, rather than stopping at the first failure: they are independent
// questions and a run that answers one of them is half a diagnosis.
const contract = theContractTravelsWithIt(ref)
const checker = theCheckerInsideItRuns(ref)

if (!contract || !checker) process.exit(1)

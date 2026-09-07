// node scripts/npm-install.test.mjs
//
// Two things are pinned here, and they belong to two different issues.
//
// The classification `npm-install.mjs` uses to decide "try again" vs "fail
// now", without spawning a real `npm ci`. Getting this wrong in either
// direction breaks the point of #342: too broad and a real failure gets waved
// through by three silent retries; too narrow and the one timeout it exists
// for stops being retried at all.
//
// And the preflight that decides whether there is anything to install at all
// (#561). The risk there runs one way: a wrong "install" is only slow, and a
// wrong "nothing to do" is a start against dependencies that do not match the
// lock file, which is a defect nobody notices for weeks. So most of what is
// below asks for the *reason*, not for the skip.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isTransient,
  backoffFor,
  installReason,
  preflight,
  BACKOFF_MS,
  MAX_ATTEMPTS,
} from './npm-install.mjs'

let passed = 0
function test(name, body) {
  try {
    body()
    passed += 1
  } catch (error) {
    console.error(`FAIL ${name}\n  ${error.message}`)
    process.exitCode = 1
  }
}

test('the exact failure from #342 is transient', () => {
  const output = [
    'npm error path /home/runner/work/book-scan/book-scan/web/node_modules/onnxruntime-node',
    'npm error command failed',
    'npm error command sh -c node ./script/install',
    'npm error AggregateError [ETIMEDOUT]',
    'npm error Error: connect ETIMEDOUT 150.171.109.74:443',
  ].join('\n')
  assert.equal(isTransient(output), true)
})

test('other network failures the same fetch could hit are transient too', () => {
  assert.equal(isTransient('Error: connect ECONNRESET'), true)
  assert.equal(isTransient('Error: connect ECONNREFUSED 127.0.0.1:443'), true)
  assert.equal(isTransient('Error: getaddrinfo ENOTFOUND registry.npmjs.org'), true)
  assert.equal(isTransient('Error: getaddrinfo EAI_AGAIN registry.npmjs.org'), true)
  assert.equal(isTransient('read ECONNRESET'), true)
  assert.equal(isTransient('Error: socket hang up'), true)
})

test('a package that genuinely does not exist is not transient', () => {
  const output = [
    'npm error code E404',
    "npm error 404 Not Found - GET https://registry.npmjs.org/not-a-real-package - Not found",
    'npm error 404',
    "npm error 404  'not-a-real-package@^1.0.0' is not in this registry.",
  ].join('\n')
  assert.equal(isTransient(output), false)
})

test('a lockfile out of sync with package.json is not transient', () => {
  const output = [
    'npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.',
  ].join('\n')
  assert.equal(isTransient(output), false)
})

test('an empty or missing failure output is not transient', () => {
  assert.equal(isTransient(''), false)
})

test('backoff grows and then holds at the last step, bounded by MAX_ATTEMPTS - 1 entries', () => {
  assert.equal(BACKOFF_MS.length, MAX_ATTEMPTS - 1)
  assert.equal(backoffFor(1), BACKOFF_MS[0])
  assert.equal(backoffFor(2), BACKOFF_MS[1])
  // Past the table: holds at the last configured wait rather than throwing or
  // going undefined, so a future MAX_ATTEMPTS bump does not need a matching
  // BACKOFF_MS bump to avoid crashing.
  assert.equal(backoffFor(3), BACKOFF_MS.at(-1))
})

// ---------------------------------------------------------------------------
// The preflight (#561)
// ---------------------------------------------------------------------------

// One coherent world: a package.json, the lock file npm would write for it,
// and the hidden lock file npm writes into node_modules after installing it.
// Every test below is this with one thing moved.
function world() {
  return {
    pkg: {
      name: 'book-scan-web',
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: { dev: 'vite' },
      dependencies: { react: '^18.3.1' },
      devDependencies: { vite: '^6.4.3' },
    },
    lock: {
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'book-scan-web',
          version: '0.1.0',
          dependencies: { react: '^18.3.1' },
          devDependencies: { vite: '^6.4.3' },
        },
        'node_modules/react': { version: '18.3.1', resolved: 'r.tgz', integrity: 'sha512-r' },
        'node_modules/vite': { version: '6.4.3', resolved: 'v.tgz', integrity: 'sha512-v', dev: true },
        // The platform builds. The lock file lists every one of them and this
        // machine installs one, which is why "in the lock and not installed"
        // cannot on its own mean "install".
        'node_modules/@esbuild/linux-x64': {
          version: '0.25.12',
          resolved: 'l.tgz',
          integrity: 'sha512-l',
          dev: true,
          optional: true,
          os: ['linux'],
          cpu: ['x64'],
        },
        'node_modules/@esbuild/win32-x64': {
          version: '0.25.12',
          resolved: 'w.tgz',
          integrity: 'sha512-w',
          dev: true,
          optional: true,
          os: ['win32'],
          cpu: ['x64'],
        },
      },
    },
    hidden: {
      lockfileVersion: 3,
      packages: {
        'node_modules/react': { version: '18.3.1', resolved: 'r.tgz', integrity: 'sha512-r' },
        'node_modules/vite': { version: '6.4.3', resolved: 'v.tgz', integrity: 'sha512-v', dev: true },
        'node_modules/@esbuild/linux-x64': {
          version: '0.25.12',
          resolved: 'l.tgz',
          integrity: 'sha512-l',
          dev: true,
          optional: true,
        },
      },
    },
    isPresent: () => true,
  }
}

test('a tree that matches the lock file needs no install', () => {
  assert.equal(installReason(world()), null)
})

test('an optional dependency for another platform is not a reason to install', () => {
  // Stated separately from the test above because it is the one exception in
  // the "everything in the lock file is installed" direction, and without it
  // this preflight would answer "install" on every machine and buy nothing.
  const it = world()
  assert.equal(it.lock.packages['node_modules/@esbuild/win32-x64'].optional, true)
  assert.equal(it.hidden.packages['node_modules/@esbuild/win32-x64'], undefined)
  assert.equal(installReason(it), null)
})

test('package.json and the lock file disagreeing about a dependency is a reason to install', () => {
  // The property `npm ci` was here for. The preflight must not skip past this:
  // skipping is what would let a start run against stale dependencies. It hands
  // the disagreement to `npm ci`, which refuses with npm's own message.
  const it = world()
  it.pkg.dependencies.react = '^19.0.0'
  assert.match(installReason(it), /disagree about "dependencies"/)
})

test('a dependency added to package.json and not to the lock file is a reason to install', () => {
  const it = world()
  it.pkg.dependencies.zod = '^3.0.0'
  assert.match(installReason(it), /disagree about "dependencies"/)
})

test('a dependency field package.json has and the lock file has never seen is a reason to install', () => {
  const it = world()
  it.pkg.optionalDependencies = { fsevents: '^2.3.3' }
  assert.match(installReason(it), /"optionalDependencies"/)
})

test('reordering a dependency map is not a reason to install', () => {
  // A person edits package.json by hand and npm writes it sorted. If that read
  // as a disagreement this would reinstall on every start again, which is the
  // defect it exists to remove.
  const it = world()
  it.pkg.dependencies = { react: '^18.3.1' }
  it.lock.packages[''].dependencies = { react: '^18.3.1' }
  it.pkg.devDependencies = { vite: '^6.4.3', tsx: '^4.0.0' }
  it.lock.packages[''].devDependencies = { tsx: '^4.0.0', vite: '^6.4.3' }
  it.hidden.packages['node_modules/tsx'] = { version: '4.0.0', resolved: 't.tgz', integrity: 'sha512-t' }
  it.lock.packages['node_modules/tsx'] = { version: '4.0.0', resolved: 't.tgz', integrity: 'sha512-t' }
  assert.equal(installReason(it), null)
})

test('a package in the lock file that is not installed is a reason to install', () => {
  const it = world()
  delete it.hidden.packages['node_modules/vite']
  assert.match(installReason(it), /node_modules\/vite is in the lock file and is not installed/)
})

test('a package installed at a version the lock file does not pin is a reason to install', () => {
  const it = world()
  it.hidden.packages['node_modules/vite'].version = '6.0.0'
  assert.match(installReason(it), /installed at 6\.0\.0 and the lock file pins 6\.4\.3/)
})

test('a package installed from somewhere the lock file does not resolve is a reason to install', () => {
  const it = world()
  it.hidden.packages['node_modules/react'].integrity = 'sha512-somethingelse'
  assert.match(installReason(it), /from something other than what the lock file resolves/)
})

test('a package installed that the lock file does not list at all is a reason to install', () => {
  const it = world()
  it.hidden.packages['node_modules/left-pad'] = { version: '1.3.0', resolved: 'p.tgz', integrity: 'sha512-p' }
  assert.match(installReason(it), /left-pad is installed and the lock file does not list it/)
})

test('a package npm recorded whose directory is gone is a reason to install', () => {
  // The #561 observation, in one line: `node_modules/vite/package.json` was
  // missing part way through a start. The hidden lock file cannot know that,
  // so the directory is asked directly.
  const it = world()
  it.isPresent = (path) => path !== 'node_modules/vite'
  assert.match(installReason(it), /node_modules\/vite is recorded as installed and its directory is not there/)
})

test('no node_modules at all is a reason to install', () => {
  const it = world()
  it.hidden = null
  assert.match(installReason(it), /no \.package-lock\.json/)
})

test('a node_modules written by a different lockfile version is a reason to install', () => {
  const it = world()
  it.hidden.lockfileVersion = 2
  assert.match(installReason(it), /version 3 and node_modules was written by version 2/)
})

test('a missing package.json or lock file is a reason to install rather than a crash', () => {
  const a = world()
  a.pkg = null
  assert.match(installReason(a), /no package\.json/)
  const b = world()
  b.lock = null
  assert.match(installReason(b), /no package-lock\.json/)
})

// The same decision over real files, because everything above hands the
// function objects it never had to read off a disk, and the reading is where
// a missing file or a path built wrong would show up.
test('preflight reads a real directory, and notices a package deleted out of it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'npm-install-preflight-'))
  try {
    const it = world()
    writeFileSync(join(dir, 'package.json'), JSON.stringify(it.pkg))
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(it.lock))
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', '.package-lock.json'), JSON.stringify(it.hidden))
    for (const path of Object.keys(it.hidden.packages)) {
      mkdirSync(join(dir, path), { recursive: true })
      writeFileSync(join(dir, path, 'package.json'), '{}')
    }

    assert.equal(preflight(dir), null)

    rmSync(join(dir, 'node_modules', 'vite'), { recursive: true, force: true })
    assert.match(preflight(dir), /node_modules\/vite is recorded as installed and its directory is not there/)

    rmSync(join(dir, 'node_modules'), { recursive: true, force: true })
    assert.match(preflight(dir), /no \.package-lock\.json/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('preflight on a directory that holds nothing is a reason to install', () => {
  const dir = mkdtempSync(join(tmpdir(), 'npm-install-preflight-empty-'))
  try {
    assert.match(preflight(dir), /no package\.json/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log(`${passed} passed`)
if (process.exitCode) {
  console.error('FAILED')
}

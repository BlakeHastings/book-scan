// node scripts/npm-install.test.mjs
//
// Exercises the classification `npm-install.mjs` uses to decide "try again"
// vs "fail now", without spawning a real `npm ci`. Getting this wrong in
// either direction breaks the point of #342: too broad and a real failure
// gets waved through by three silent retries; too narrow and the one timeout
// it exists for stops being retried at all.
import assert from 'node:assert/strict'
import { isTransient, backoffFor, BACKOFF_MS, MAX_ATTEMPTS } from './npm-install.mjs'

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

console.log(`${passed} passed`)
if (process.exitCode) {
  console.error('FAILED')
}

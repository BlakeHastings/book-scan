// node scripts/ci-scope.test.mjs
//
// The cost of getting `classify` wrong is asymmetric, so most of these assert
// the safe direction: that something which is not obviously documentation gets
// the full run.
import assert from 'node:assert/strict'
import { classify, isInert } from './ci-scope.mjs'

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

test('markdown anywhere is inert', () => {
  assert.equal(isInert('README.md'), true)
  assert.equal(isInert('AGENTS.md'), true)
  assert.equal(isInert('web/README.md'), true)
  assert.equal(isInert('docs/process/review.md'), true)
})

test('the docs tree is inert including its non-markdown files', () => {
  assert.equal(isInert('docs/shelving.md'), true)
  assert.equal(isInert('docs/images/shelf.png'), true)
})

test('source is not inert', () => {
  assert.equal(isInert('web/server/store.ts'), false)
  assert.equal(isInert('web/src/App.tsx'), false)
  assert.equal(isInert('e2e/features/scan.feature'), false)
})

test('anything that can change what CI itself does is not inert', () => {
  assert.equal(isInert('.github/workflows/ci.yml'), false)
  assert.equal(isInert('scripts/merge-pr.mjs'), false)
  assert.equal(isInert('scripts/ci-scope.mjs'), false)
  assert.equal(isInert('web/package-lock.json'), false)
  assert.equal(isInert('package.json'), false)
  assert.equal(isInert('.gitignore'), false)
  assert.equal(isInert('apphost.mts'), false)
  assert.equal(isInert('aspire.config.json'), false)
})

test('a path that merely mentions docs is not the docs tree', () => {
  assert.equal(isInert('web/src/docs/panel.ts'), false)
  assert.equal(isInert('docsy/thing.ts'), false)
})

test('an all markdown change is documentation only', () => {
  const { docsOnly } = classify(['README.md', 'AGENTS.md', 'docs/process/review.md'])
  assert.equal(docsOnly, true)
})

test('one source file among the markdown forces the full run', () => {
  const { docsOnly, why } = classify(['README.md', 'web/server/store.ts', 'docs/shelving.md'])
  assert.equal(docsOnly, false)
  assert.match(why, /web\/server\/store\.ts/)
})

test('an empty or unreadable file list forces the full run', () => {
  assert.equal(classify([]).docsOnly, false)
  assert.equal(classify(undefined).docsOnly, false)
  assert.equal(classify(null).docsOnly, false)
  assert.equal(classify('README.md').docsOnly, false)
})

test('the reason names the offending files but does not run away', () => {
  const many = Array.from({ length: 12 }, (_, index) => `web/src/f${index}.ts`)
  const { why } = classify(many)
  assert.match(why, /and 7 more/)
})

if (process.exitCode) {
  console.error('ci-scope tests failed.')
} else {
  console.log(`ci-scope: ${passed} tests passed.`)
}

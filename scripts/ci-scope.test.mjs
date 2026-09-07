// node scripts/ci-scope.test.mjs
//
// The cost of getting `classify` wrong is asymmetric, so most of these assert
// the safe direction: that something which is not obviously documentation gets
// the full run.
import assert from 'node:assert/strict'
import { classify, classifyImage, decidesTheImage, isInert } from './ci-scope.mjs'

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

// The second question (#549). The cost of getting this one wrong is asymmetric
// the other way round from `classify`: the expensive answer is `image: true`.

test('the recipe and the context decide the image', () => {
  assert.equal(decidesTheImage('Dockerfile'), true)
  assert.equal(decidesTheImage('.dockerignore'), true)
  assert.equal(decidesTheImage('.gitattributes'), true)
})

test('the contract and its checker decide the image, because it carries them', () => {
  assert.equal(decidesTheImage('deploy/contract.json'), true)
  assert.equal(decidesTheImage('deploy/check-config.mjs'), true)
})

test('the dependency tree decides the image, because the prune is what only it proves', () => {
  assert.equal(decidesTheImage('web/package.json'), true)
  assert.equal(decidesTheImage('web/package-lock.json'), true)
  assert.equal(decidesTheImage('web/scripts/build-server.mjs'), true)
  assert.equal(decidesTheImage('web/scripts/smoke-built-server.mjs'), true)
})

test('the job and its assertions decide the image', () => {
  assert.equal(decidesTheImage('.github/workflows/image.yml'), true)
  assert.equal(decidesTheImage('scripts/check-image.mjs'), true)
  assert.equal(decidesTheImage('scripts/ci-scope.mjs'), true)
})

test('the application does not, because the other two checks build it already', () => {
  assert.equal(decidesTheImage('web/src/App.tsx'), false)
  assert.equal(decidesTheImage('web/server/store.ts'), false)
  assert.equal(decidesTheImage('e2e/features/scan.feature'), false)
  assert.equal(decidesTheImage('.github/workflows/e2e.yml'), false)
  assert.equal(decidesTheImage('scripts/merge-pr.mjs'), false)
  assert.equal(decidesTheImage('apphost.mts'), false)
})

test('documentation never decides the image, wherever it sits', () => {
  assert.equal(decidesTheImage('docs/the-image.md'), false)
  assert.equal(decidesTheImage('docs/publishing.md'), false)
  assert.equal(decidesTheImage('README.md'), false)
})

test('one deciding file among the rest builds the image', () => {
  const { image, why } = classifyImage(['web/src/App.tsx', 'web/package-lock.json', 'README.md'])
  assert.equal(image, true)
  assert.match(why, /web\/package-lock\.json/)
})

test('a change that touches nothing deciding does not build the image', () => {
  assert.equal(classifyImage(['web/src/App.tsx', 'web/server/store.ts']).image, false)
  assert.equal(classifyImage(['README.md']).image, false)
})

test('an empty or unreadable file list builds the image', () => {
  assert.equal(classifyImage([]).image, true)
  assert.equal(classifyImage(undefined).image, true)
  assert.equal(classifyImage(null).image, true)
  assert.equal(classifyImage('Dockerfile').image, true)
})

test('the reason names the deciding files but does not run away', () => {
  const many = Array.from({ length: 9 }, (_, index) => `deploy/f${index}.json`)
  assert.match(classifyImage(many).why, /and 4 more/)
})

if (process.exitCode) {
  console.error('ci-scope tests failed.')
} else {
  console.log(`ci-scope: ${passed} tests passed.`)
}

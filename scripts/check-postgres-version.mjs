// Holds every copy of the Postgres version to the one file that carries it.
//
// `apphost.mts` and `web/server/pgcontainer.ts` read `postgres-version.json` at
// run time, so they cannot drift from it. CI cannot: a workflow's
// `services.<id>.image` is evaluated before any step runs and the `env` context
// is not available to it, so the version there has to be a literal. This is what
// keeps that literal honest.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const source = JSON.parse(readFileSync(join(root, 'postgres-version.json'), 'utf8'))
const expected = `${source.image}:${source.tag}`

const problems = []

// The major is a field of its own because the tag is no longer only a major. The
// two have to agree, or the contract and the image would describe different
// servers.
if (!Number.isInteger(source.major)) {
  problems.push('postgres-version.json has no whole-number "major"')
} else if (!new RegExp(`(^|-)pg${source.major}(-|$)`).test(source.tag)) {
  problems.push(`postgres-version.json says major ${source.major} and its tag ${source.tag} does not say pg${source.major}`)
}
if (source.pgvector && !source.tag.startsWith(`${source.pgvector}-`)) {
  problems.push(`postgres-version.json says pgvector ${source.pgvector} and its tag ${source.tag} does not start with it`)
}

// Every Postgres service image in the workflow has to be the one image, and there
// has to be at least one: a check that passes because it found nothing proves
// nothing. Matched on either name, so a workflow that went back to the plain
// postgres image is caught rather than skipped.
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
const images = [...workflow.matchAll(/^\s*image:\s*((?:postgres|pgvector\/pgvector):\S+)\s*$/gm)].map((m) => m[1])

if (images.length === 0) {
  problems.push('.github/workflows/ci.yml names no postgres image, so this check proves nothing')
}
for (const image of images) {
  if (image !== expected) {
    problems.push(`.github/workflows/ci.yml runs ${image}, postgres-version.json says ${expected}`)
  }
}

// This is what notices if somebody puts a literal back in one of the readers.
for (const file of ['apphost.mts', join('web', 'server', 'pgcontainer.ts')]) {
  const text = readFileSync(join(root, file), 'utf8')
  if (!text.includes('postgres-version.json')) {
    problems.push(`${file} no longer reads postgres-version.json`)
  }
}

if (problems.length > 0) {
  console.error('The Postgres version is written in more than one place:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('\nSee the Postgres version section of AGENTS.md.')
  process.exit(1)
}

console.log(`Postgres ${expected} everywhere.`)

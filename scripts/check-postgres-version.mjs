// Holds every copy of the Postgres version to the one file that carries it.
//
// WHY THIS EXISTS
// The version was written in two places and they disagreed by two major
// versions for a whole stage (#162): `web/server/pgcontainer.ts` pinned
// `postgres:17`, and `apphost.mts` pinned nothing at all and so ran whatever
// tag Aspire defaulted to, which was `postgres:18.3`. Since stage G that meant
// the browser suite proved one major version and the unit suite proved another,
// and nothing anywhere said so. The argument for running a real Postgres per
// test run, recorded in docs/postgres-migration.md, is that a suite which does
// not exercise the database being shipped lets a dialect or collation
// difference pass everything and surface on somebody's shelf. Two majors apart
// is that argument in miniature.
//
// Those two now read `postgres-version.json` at run time, so they cannot drift
// from it. CI cannot: a workflow's `services.<id>.image` is evaluated before
// any step runs and the `env` context is not available to it, so the version
// there has to be a literal. This is what keeps that literal honest, at the
// cost of a few milliseconds inside a job that was going to run anyway rather
// than a job of its own, which GitHub would bill as a whole minute.
//
// Usage, from a workflow step or by hand at the repository root:
//   node scripts/check-postgres-version.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const source = JSON.parse(readFileSync(join(root, 'postgres-version.json'), 'utf8'))
const expected = `${source.image}:${source.tag}`

const problems = []

// The CI service container. Every `image: postgres:...` in the workflow has to
// be the one version, and there has to be at least one: a check that passes
// because it found nothing is the failure mode this whole issue is about.
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
const images = [...workflow.matchAll(/^\s*image:\s*(postgres:\S+)\s*$/gm)].map((m) => m[1])

if (images.length === 0) {
  problems.push('.github/workflows/ci.yml names no postgres image, so this check proves nothing')
}
for (const image of images) {
  if (image !== expected) {
    problems.push(`.github/workflows/ci.yml runs ${image}, postgres-version.json says ${expected}`)
  }
}

// The two run-time readers. They read the file rather than carrying a literal,
// and this is what notices if somebody puts a literal back.
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

/**
 * Put the world back to the baseline, so two runs can be compared.
 *
 * Restarts the api after seeding: the capture queue drain fires once at boot,
 * before the seed lands. See docs/process/agent-hunting-pass.md.
 *
 * The connection is read out of the AppHost and never out of a shell, and the
 * seeder refuses a target on port 5433 in any case.
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT, UX_ROOT, aspire, whereIsTheApp } from './lib/aspire.mjs'
import { worldState } from './lib/world.mjs'

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))))
  })
}

const { web, api, connection } = await whereIsTheApp()

console.log(`[ux] web ${web}`)
console.log(`[ux] api ${api}`)
console.log('[ux] seeding the baseline world')
await run('npm', ['run', 'seed', '--', '--reset', '--target', connection], join(REPO_ROOT, 'web'))

console.log('[ux] restarting the api so the queue drain sees the seeded captures')
await aspire(['resource', 'api', 'restart'], { timeoutMs: 5 * 60 * 1000 }).catch((error) => {
  console.warn(`[ux] could not restart the api: ${error.message}`)
})
await aspire(['wait', 'api', '--timeout', '300'], { timeoutMs: 330 * 1000 })

const state = await worldState(connection, api)
console.log('')
console.log('  The baseline world')
console.log('  ' + '-'.repeat(64))
for (const row of state.furniture) {
  const fixture = row.fixture_name || `bookcase ${row.fixture_position}`
  const area = row.area_id === null ? '(no areas)' : `area ${row.area_position}${row.area_name ? ` "${row.area_name}"` : ''}`
  console.log(`  ${fixture.padEnd(24)} ${area.padEnd(26)} ${row.books} book(s)`)
}
console.log('  ' + '-'.repeat(64))
for (const rule of state.rules) {
  console.log(`  rule ${rule.id} "${rule.name}" -> area ${rule.area_id ?? '-'} fixture ${rule.fixture_id ?? '-'}  [${rule.conditions}]`)
}
console.log('  ' + '-'.repeat(64))
console.log(`  ${state.books.length} shelved or checked out books, ${state.outstanding.length} outstanding move(s)`)
console.log(`  fingerprint ${state.fingerprint}`)
console.log('')

/*
 * The world as it stood before anybody touched it, committed. Ids and the
 * fingerprint move when the seeder changes, and that is the point: a baseline
 * that changed silently is exactly what makes two runs incomparable.
 */
writeFileSync(join(UX_ROOT, 'baseline.json'), `${JSON.stringify({
  seededBy: 'web/scripts/seed-world.ts --reset',
  furniture: state.furniture,
  rules: state.rules,
  books: state.books.length,
  fingerprint: state.fingerprint,
}, null, 2)}\n`)
console.log(`[ux] baseline written to ux/baseline.json`)
console.log(`[ux] ready. Open a run with:  npm run ux -- open --run <name> --theme light`)

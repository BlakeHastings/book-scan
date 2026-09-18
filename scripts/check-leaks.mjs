#!/usr/bin/env node
// Says what this machine is still holding that nothing is using any more: docker
// volumes, docker containers, and processes whose command line names a worktree.
//
// It cannot see a harness background task. A polling loop is a process this
// script cannot tell apart from any other shell, so what it sees is only the
// effect: a process rooted in a directory that is gone, or a volume nothing owns.
//
// It deletes nothing. The AppHost keys its Postgres volume to the checkout path,
// so a stopped environment and an abandoned one are the same picture from here,
// and removing one out from under a running agent destroys hours of work.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const readFileSyncSafe = (url) => {
  try {
    return readFileSync(url, 'utf8')
  } catch {
    return null
  }
}

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/**
 * The volume name the AppHost would give this checkout, and it must stay
 * identical to `apphost.mts`: if that line changes its hash or its prefix, every
 * volume starts reading as an orphan and this becomes a tool that recommends
 * deleting whatever an agent is using. The guard below checks for that.
 */
export const volumeFor = (dir) =>
  `bookscan-pg-${createHash('sha256').update(dir).digest('hex').slice(0, 12)}`

/**
 * Split this repository's volumes into the ones a live worktree owns and the ones
 * nothing does. Exported and pure so the classification can be tested without a
 * Docker daemon.
 */
export const classifyVolumes = (volumes, worktrees) => {
  // `git` prints forward slashes; the AppHost hashes what Node's `dirname` gave
  // it, which on Windows is backslashes. Both spellings are held so that a match
  // is a match rather than a platform accident.
  const expected = new Set()
  for (const tree of worktrees) {
    expected.add(volumeFor(tree))
    expected.add(volumeFor(tree.replace(/\//g, '\\')))
  }
  const ours = volumes.filter((v) => v.startsWith('bookscan-pg-'))
  return { ours, orphans: ours.filter((v) => !expected.has(v)) }
}

// Run as a program, or imported by its test for the two functions above.
const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {

const worktrees = (run('git', ['worktree', 'list', '--porcelain']) ?? '')
  .split('\n')
  .filter((line) => line.startsWith('worktree '))
  .map((line) => line.slice('worktree '.length).trim())
  .filter(Boolean)

const findings = []

const volumes = (run('docker', ['volume', 'ls', '--format', '{{.Name}}']) ?? '')
  .split('\n').map((v) => v.trim()).filter(Boolean)

const { ours, orphans: orphanVolumes } = classifyVolumes(volumes, worktrees)
const matched = ours.length - orphanVolumes.length

console.log(`Worktrees: ${worktrees.length}`)
console.log(`Postgres volumes: ${ours.length}, of which ${matched} belong to a live worktree`)

// The rot guard, which asks the AppHost rather than inferring from the data.
// Zero matches must not be read as the naming having moved: it is the ordinary
// state right after a batch of pull requests land, which is exactly when volumes
// get orphaned and when somebody runs this.
const namingIsIntact = () => {
  const src = readFileSyncSafe(new URL('../apphost.mts', import.meta.url))
  if (src === null) return null // Cannot tell. Say so rather than guess either way.
  return src.includes("createHash('sha256')")
    && src.includes('digest(\'hex\').slice(0, 12)')
    && src.includes('bookscan-pg-')
}

const intact = namingIsIntact()
if (intact === false) {
  console.log('')
  console.log('  STOP. `apphost.mts` no longer names volumes the way this script assumes, so')
  console.log('  every volume above is reported as an orphan for the wrong reason. Fix the')
  console.log('  two together before deleting anything on this script\'s say-so.')
  process.exit(2)
}
if (intact === null) {
  console.log('  (Could not read apphost.mts, so the volume naming was not confirmed.)')
}

if (orphanVolumes.length) {
  findings.push(`${orphanVolumes.length} Postgres volume(s) whose worktree is gone`)
  console.log('')
  console.log('  Volumes with no live worktree. Each was an agent environment whose worktree')
  console.log('  has since been pruned, and whose rows outlived it:')
  for (const v of orphanVolumes) console.log(`    docker volume rm ${v}`)
}

const containers = (run('docker', ['ps', '--format', '{{.Names}}']) ?? '')
  .split('\n').map((c) => c.trim()).filter(Boolean)
console.log('')
console.log(`Running containers: ${containers.length}${containers.length ? ' — ' + containers.join(', ') : ''}`)
// A smell test and not a proof. Aspire and testcontainers both name containers
// randomly, so there is no way from here to say which worktree a given container
// belongs to. More containers than worktrees is definitely wrong; fewer proves
// nothing, and one worktree can legitimately hold two while its suite runs.
if (containers.length > worktrees.length) {
  findings.push('more running containers than worktrees')
  console.log('  More containers than worktrees, so at least one belongs to nothing.')
}

const live = new Set(worktrees.map((t) => t.replace(/\//g, '\\').toLowerCase()))
const ps = run('powershell', [
  '-NoProfile', '-Command',
  'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\' OR Name=\'aspire.exe\'" | ' +
  'ForEach-Object { $_.ProcessId.ToString() + "|" + $_.CommandLine }',
])

if (ps === null) {
  console.log('')
  console.log('Processes: not read. Not a finding; this half is Windows-only.')
} else {
  const rows = ps.split('\n').map((r) => r.trim()).filter(Boolean)
  const stale = []
  for (const row of rows) {
    const at = row.indexOf('|')
    if (at < 0) continue
    const pid = row.slice(0, at)
    const cmd = row.slice(at + 1).toLowerCase()
    const found = cmd.match(/[a-z]:\\[^"]*?\\\.claude\\worktrees\\agent-[0-9a-f]+/)
    if (!found) continue
    if (!live.has(found[0])) stale.push({ pid, dir: found[0] })
  }
  console.log('')
  console.log(`Processes: ${rows.length} node/aspire seen, ${stale.length} rooted in a worktree that is gone`)
  if (stale.length) {
    findings.push(`${stale.length} process(es) rooted in a deleted worktree`)
    console.log('  These outlived their worktree. Stop the AppHost by explicit path if one is')
    console.log('  still up, and only kill a pid when nothing owns it:')
    for (const s of stale) console.log(`    pid ${s.pid}  ${s.dir}`)
  }
}

const commit = run('powershell', [
  '-NoProfile', '-Command',
  '$o = Get-CimInstance Win32_OperatingSystem; "{0}|{1}" -f $o.FreeVirtualMemory, $o.TotalVirtualMemorySize',
])
if (commit) {
  const [free, total] = commit.trim().split('|').map((n) => Number(n) / 1024 / 1024)
  console.log('')
  console.log(`Commit: ${free.toFixed(1)} GB free of ${total.toFixed(1)} GB`)
  if (free < 5) {
    findings.push('commit headroom under 5 GB')
    console.log('  Under 5 GB. Do not start another environment, and do not retry a command that')
    console.log('  failed to spawn: that is the ceiling rather than a flake.')
  }
}

console.log('')
if (findings.length === 0) {
  console.log('Nothing held that nothing is using.')
} else {
  console.log(`${findings.length} finding(s): ${findings.join('; ')}`)
  console.log('Nothing was deleted. The commands above are for a person to run.')
}
process.exit(findings.length ? 1 : 0)

}

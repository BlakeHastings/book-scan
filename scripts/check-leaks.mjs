#!/usr/bin/env node
// Says what this machine is still holding that nothing is using any more.
//
// WHY THIS EXISTS
// On 2026-09-02 the owner asked why his RAM was disappearing with nine shells
// open. Nine `until ... aspire describe ... sleep` loops were still polling in
// worktrees whose AppHosts had been stopped hours earlier, two of them in
// worktrees that had since been deleted. Each poll spawned a .NET process.
// Stopping them took bash from 18 processes to 0 and gave back 4 GB of commit
// on a machine whose whole commit limit is 34 GB.
//
// None of that was visible from inside the session. The orchestrator started
// every one of those loops, believed each had ended when it stopped caring
// about the answer, and was wrong nine times. **An instruction to tidy up would
// have failed the same way**, which is why this is a command that looks rather
// than a paragraph that asks.
//
// The cause was found afterwards and is sharper than "they were unbounded":
// `aspire describe` writes OSC 8 terminal hyperlinks around each resource name,
// which stripping SGR colour codes does not remove, so `grep -E "^| api .*Healthy"`
// was a condition that could never be true. The loops were not slow; they were
// waiting for something that would never happen. An `until` loop has no failure
// path, so nothing said so. `docs/process/handoff.md` carries both halves.
//
// WHAT IT COVERS, AND WHAT IT CANNOT
// It reads the machine: docker volumes, docker containers, and processes whose
// command line names a worktree. That is the residue an agent leaves behind.
//
// **It cannot see a harness background task.** A polling loop is a process this
// script cannot tell apart from any other shell. What it sees is the effect: a
// process rooted in a directory that is gone, or a volume nothing owns. If the
// numbers here look wrong and nothing below explains them, the next place to
// look is the session's own background tasks, listed under `/tasks`.
//
// IT DELETES NOTHING
// A volume that looks unused may be an agent's world between restarts: the
// AppHost keys its Postgres volume to the checkout path, so a stopped
// environment and an abandoned one are the same picture from here. Removing one
// out from under a running agent destroys hours of work. So this prints the
// commands and lets a person decide, the way `prune-worktrees.mjs` refuses
// rather than forcing.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/**
 * The volume name the AppHost would give this checkout.
 *
 * Kept identical to `apphost.mts` on purpose, and it is the one thing here that
 * can silently rot: if that line changes its hash or its prefix, every volume
 * starts reading as an orphan and this becomes a tool that recommends deleting
 * whatever an agent is using. There is a guard for that below.
 */
export const volumeFor = (dir) =>
  `bookscan-pg-${createHash('sha256').update(dir).digest('hex').slice(0, 12)}`

/**
 * Split this repository's volumes into the ones a live worktree owns and the
 * ones nothing does.
 *
 * Exported and pure so the classification can be tested without a Docker
 * daemon, which is the half worth testing: the reading of `docker volume ls` is
 * one line and the deciding is where a mistake deletes somebody's work.
 */
export const classifyVolumes = (volumes, worktrees) => {
  // `git` prints forward slashes; the AppHost hashes what Node's `dirname` gave
  // it, which on Windows is backslashes. Both spellings are held, so a match is
  // a match rather than a platform accident.
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

// --- Docker volumes -------------------------------------------------------

const volumes = (run('docker', ['volume', 'ls', '--format', '{{.Name}}']) ?? '')
  .split('\n').map((v) => v.trim()).filter(Boolean)

const { ours, orphans: orphanVolumes } = classifyVolumes(volumes, worktrees)
const matched = ours.length - orphanVolumes.length

console.log(`Worktrees: ${worktrees.length}`)
console.log(`Postgres volumes: ${ours.length}, of which ${matched} belong to a live worktree`)

// The rot guard the header promises. If nothing at all matches while volumes
// exist, the likelier explanation is that the naming moved than that every
// environment on this machine is abandoned.
if (ours.length > 0 && matched === 0 && worktrees.length > 1) {
  console.log('')
  console.log('  STOP. No volume matches any live worktree, which is suspicious rather than')
  console.log('  informative. Check that the AppHost still names volumes the way this script')
  console.log('  assumes before deleting anything on its say-so.')
  process.exit(2)
}

if (orphanVolumes.length) {
  findings.push(`${orphanVolumes.length} Postgres volume(s) whose worktree is gone`)
  console.log('')
  console.log('  Volumes with no live worktree. Each was an agent environment whose worktree')
  console.log('  has since been pruned, and whose rows outlived it:')
  for (const v of orphanVolumes) console.log(`    docker volume rm ${v}`)
}

// --- Containers -----------------------------------------------------------

const containers = (run('docker', ['ps', '--format', '{{.Names}}']) ?? '')
  .split('\n').map((c) => c.trim()).filter(Boolean)
console.log('')
console.log(`Running containers: ${containers.length}${containers.length ? ' — ' + containers.join(', ') : ''}`)
// A smell test and not a proof, said plainly so nobody trusts it further than
// it goes. Aspire and testcontainers both name containers randomly, so there is
// no way from here to say which worktree a given container belongs to. A count
// higher than the worktrees is definitely wrong; a count lower than them proves
// nothing, and one worktree can legitimately hold two containers while its
// suite runs.
if (containers.length > worktrees.length) {
  findings.push('more running containers than worktrees')
  console.log('  More containers than worktrees, so at least one belongs to nothing.')
}

// --- Processes rooted in a worktree that no longer exists ------------------

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

// --- Commit, which is the ceiling on this machine -------------------------

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

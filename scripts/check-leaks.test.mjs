// What the leak check must decide, and what it must refuse to decide.
//
//   node scripts/check-leaks.test.mjs
//
// The reading is one line per source and the deciding is where a mistake costs
// somebody their work: this script prints `docker volume rm` for anything it
// calls an orphan, and a volume that looks unused may be a running agent's
// world between environment restarts. So the classification is what is tested,
// and the Docker and PowerShell calls are not, because they are `execFileSync`
// with a fixed argument list and nothing to get wrong.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'

import { classifyVolumes, volumeFor } from './check-leaks.mjs'

test('a volume is named after the checkout path, the way the AppHost names it', () => {
  // Pinned against a literal rather than against a second call to `createHash`,
  // which would agree with any algorithm including a wrong one. If `apphost.mts`
  // changes how it names volumes, this fails and the script stops being trusted
  // to say what is an orphan — which is the outcome you want, because at that
  // point every volume would read as one.
  assert.equal(
    volumeFor('C:\\Users\\Blake\\source\\repos\\book-scan'),
    'bookscan-pg-' + createHash('sha256')
      .update('C:\\Users\\Blake\\source\\repos\\book-scan')
      .digest('hex').slice(0, 12),
  )
  assert.match(volumeFor('/any/path'), /^bookscan-pg-[0-9a-f]{12}$/)
})

test('the same worktree matches whichever way its path is spelled', () => {
  // `git worktree list` prints forward slashes and the AppHost hashes
  // backslashes. A script that held only one spelling would call every live
  // worktree's volume an orphan on Windows, and recommend deleting all of them.
  const tree = 'C:/Users/Blake/source/repos/book-scan'
  const windowsName = volumeFor(tree.replace(/\//g, '\\'))
  const { orphans } = classifyVolumes([windowsName], [tree])
  assert.deepEqual(orphans, [], 'a live worktree must never be reported as an orphan')
})

test('a volume whose worktree is gone is an orphan', () => {
  const live = 'C:/repos/book-scan'
  const dead = 'C:/repos/book-scan/.claude/worktrees/agent-deadbeef'
  const { ours, orphans } = classifyVolumes(
    [volumeFor(live), volumeFor(dead)],
    [live],
  )
  assert.equal(ours.length, 2)
  assert.deepEqual(orphans, [volumeFor(dead)])
})

test('volumes belonging to something else are left entirely alone', () => {
  // The prefix is the whole of what makes a volume this project's. Anything
  // else on the machine belongs to somebody, and a tool that printed
  // `docker volume rm` for a stranger's database would be worse than no tool.
  const { ours, orphans } = classifyVolumes(
    ['postgres-data', 'my-other-app', 'bookscan-pg-abc123abc123'],
    [],
  )
  assert.deepEqual(ours, ['bookscan-pg-abc123abc123'])
  assert.deepEqual(orphans, ['bookscan-pg-abc123abc123'])
})

test('no volumes and no worktrees is quiet rather than wrong', () => {
  const { ours, orphans } = classifyVolumes([], [])
  assert.deepEqual(ours, [])
  assert.deepEqual(orphans, [])
})

test('every agent worktree gone means every volume is an orphan, and that is a real answer', () => {
  // The case that broke the first version of the rot guard, within an hour of
  // it shipping. Two agent worktrees were pruned as their pull requests landed,
  // so nothing matched, and the guard read "nothing matches" as "the naming has
  // moved" and refused to report anything.
  //
  // That is exactly backwards: a batch of worktrees being pruned is when
  // volumes get orphaned, so it is when this tool has the most to say. The
  // guard now reads `apphost.mts` instead of inferring, and this pins the
  // classification that the guard used to override.
  const main = 'C:/repos/book-scan'
  const gone = [
    'C:/repos/book-scan/.claude/worktrees/agent-aaaa1111',
    'C:/repos/book-scan/.claude/worktrees/agent-bbbb2222',
  ]
  const { ours, orphans } = classifyVolumes(gone.map(volumeFor), [main])
  assert.equal(ours.length, 2)
  assert.equal(orphans.length, 2, 'both are orphans and saying so is the point')
})

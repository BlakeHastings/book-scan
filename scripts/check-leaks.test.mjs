import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'

import { classifyVolumes, volumeFor } from './check-leaks.mjs'

test('a volume is named after the checkout path, the way the AppHost names it', () => {
  assert.equal(
    volumeFor('C:\\Users\\Blake\\source\\repos\\book-scan'),
    'bookscan-pg-' + createHash('sha256')
      .update('C:\\Users\\Blake\\source\\repos\\book-scan')
      .digest('hex').slice(0, 12),
  )
  assert.match(volumeFor('/any/path'), /^bookscan-pg-[0-9a-f]{12}$/)
})

test('the same worktree matches whichever way its path is spelled', () => {
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
  const main = 'C:/repos/book-scan'
  const gone = [
    'C:/repos/book-scan/.claude/worktrees/agent-aaaa1111',
    'C:/repos/book-scan/.claude/worktrees/agent-bbbb2222',
  ]
  const { ours, orphans } = classifyVolumes(gone.map(volumeFor), [main])
  assert.equal(ours.length, 2)
  assert.equal(orphans.length, 2, 'both are orphans and saying so is the point')
})

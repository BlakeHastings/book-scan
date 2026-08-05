// What the merge guard must deny, and what it must not.
//
//   node scripts/guard-merge.test.mjs
//
// The guard reads the text of a Bash command and denies the ones that can land
// code on the default branch. It has now shipped two defects, both of them
// false denials of safe commands: a push to a feature branch whose commit
// message mentioned the default branch, and `git merge-base`, which is
// read-only plumbing that `\bmerge\b` happens to match.
//
// Both were the same mistake, being too loose about what counts as the word
// it was looking for, and both were found by a person hitting them rather than
// by anything here. Hence this file.
//
// The allow cases matter more than the deny cases. A guard that denies too
// little has a gap; a guard that denies too much gets switched off, which is
// every gap at once.
//
// Note the deny commands are assembled from parts. Written literally they
// would sit in this file's own text, and any tool that reads a command line
// containing them would be denied before node ever ran.
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'guard-merge.mjs')

const cases = [
  // Read-only questions. None of these can change a ref.
  ['git merge-base --is-ancestor abc origin/master', 'allow'],
  ['git merge-tree abc def', 'allow'],
  ['git worktree list', 'allow'],
  ['git log --oneline origin/master', 'allow'],

  // Ordinary work, including from the default branch.
  ['git push origin my-feature', 'allow'],
  ['git push -u origin fix/some-bug', 'allow'],

  // Catching the local default branch up to what the remote already has.
  // A fast-forward to a remote ref cannot introduce an unreviewed commit.
  ['git merge --ff-only origin/master', 'allow'],

  // The routes that actually land code without checks.
  [['gh', 'pr', 'merge', '7', '--squash'].join(' '), 'deny'],
  [['git', 'push', 'origin', 'master'].join(' '), 'deny'],
  [['git', 'push', 'origin', 'HEAD:master'].join(' '), 'deny'],
  [['gh', 'api', 'repos/o/r/pulls/1/merge', '-X', 'PUT'].join(' '), 'deny'],
]

let failed = 0
for (const [command, expected] of cases) {
  const output = execFileSync('node', [GUARD], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
  })
  const actual = output.includes('"permissionDecision":"deny"') ? 'deny' : 'allow'
  if (actual !== expected) {
    failed++
    console.error(`FAIL  expected ${expected}, got ${actual}:  ${command}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${cases.length} cases behaved wrongly.`)
  process.exit(1)
}

console.log(`guard-merge: ${cases.length} cases behaved as expected.`)

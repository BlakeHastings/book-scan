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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'guard-merge.mjs')

// Fixtures for the worktree case (#293). A bare `git push`/`git merge` is
// only dangerous depending on the branch actually standing under the
// command, and that is the branch of the checkout the command runs in, not
// the branch of whatever checkout this test happens to run from. `cd <dir>
// && git push` is how an agent worktree pushes, so these give the guard a
// real directory on a real branch to ask about, instead of depending on
// ambient state.
const fixtureRoot = mkdtempSync(join(tmpdir(), 'guard-merge-'))
const worktreeOnFeature = join(fixtureRoot, 'feature-worktree')
const worktreeOnMaster = join(fixtureRoot, 'master-worktree')
// `git rev-parse --abbrev-ref HEAD` fails on an unborn branch (no commit
// yet), so each fixture needs one empty commit before the guard can ask it
// anything.
function initFixture(dir, branch) {
  execFileSync('git', ['init', '-q', '-b', branch, dir])
  execFileSync('git', [
    '-C',
    dir,
    '-c',
    'user.email=guard-merge-test@example.com',
    '-c',
    'user.name=guard-merge-test',
    'commit',
    '--allow-empty',
    '-q',
    '-m',
    'init',
  ])
}
initFixture(worktreeOnFeature, 'work/293-cd-detection')
initFixture(worktreeOnMaster, 'master')

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

  // The worktree case (#293). A bare push, in a worktree standing on its own
  // feature branch, is safe: the guard must ask about the worktree's branch
  // rather than the hook's own directory, which is the primary checkout and
  // is almost always on master.
  [`cd ${worktreeOnFeature} && git push`, 'allow'],

  // A real push to master must still be denied, from a worktree as much as
  // from anywhere else. The `cd` fix must not become a way to escape this
  // security control.
  [`cd ${worktreeOnMaster} && git push`, 'deny'],

  // The routes that actually land code without checks.
  [['gh', 'pr', 'merge', '7', '--squash'].join(' '), 'deny'],
  [['git', 'push', 'origin', 'master'].join(' '), 'deny'],
  [['git', 'push', 'origin', 'HEAD:master'].join(' '), 'deny'],
  [['gh', 'api', 'repos/o/r/pulls/1/merge', '-X', 'PUT'].join(' '), 'deny'],
]

let failed = 0
try {
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
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}

if (failed > 0) {
  console.error(`\n${failed} of ${cases.length} cases behaved wrongly.`)
  process.exit(1)
}

console.log(`guard-merge: ${cases.length} cases behaved as expected.`)

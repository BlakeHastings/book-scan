// What the worktree sweep must remove, and what it must refuse.
//
//   node scripts/prune-worktrees.test.mjs
//
// The refusals matter more than the removals, and by a wider margin than in any
// other guard here: a wrongly kept worktree costs a gigabyte, and a wrongly
// removed one is somebody's uncommitted afternoon. This file is built so that
// the refusal cases fail loudly if the sweep ever gets keener.
//
// It works on a scratch repository rather than on fixtures, because the thing
// under test is what git says about a squash merge, and no fixture can be
// wrong about that in the same way git is. The repository it builds is the
// shape #577 was filed about, which no unit test would have caught: a branch
// squash-merged into master, and then master moved *on top of the same files*
// by the next merge, so the worktree differs from master in the other
// direction.
//
// The one thing it fakes is GitHub, which is injected. The sweep's own call
// shells out to `gh`, and a test that needed the network, an account and a
// merged pull request could only ever run on one machine.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { judgeMergedPullRequests, main } from './prune-worktrees.mjs'

let failed = 0
const fail = (message) => {
  failed += 1
  console.error(`FAIL  ${message}`)
}
const is = (actual, expected, name) => {
  if (actual !== expected) fail(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ---------------------------------------------------------------------------
// The judgement, on its own. This is the half that can delete something.
// ---------------------------------------------------------------------------

const TIP = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

const judgements = [
  [judgeMergedPullRequests([{ number: 565, headRefOid: TIP }], TIP).landed, true, 'a merged PR at this tip has landed'],
  [judgeMergedPullRequests([{ number: 565, headRefOid: TIP }], TIP).number, 565, 'and it says which'],
  // The 2026-08-14 failure, with the branch deleted for a good reason rather
  // than never pushed: the merge happened, and then somebody committed again.
  [judgeMergedPullRequests([{ number: 565, headRefOid: OTHER }], TIP).landed, false, 'a tip past the merge has not landed'],
  [
    judgeMergedPullRequests([{ number: 565, headRefOid: OTHER }], TIP).note?.includes('#565'),
    true,
    'and the refusal names the pull request so somebody can look',
  ],
  // Every way of not knowing, and all of them keep.
  [judgeMergedPullRequests([], TIP).landed, false, 'no merged pull request keeps'],
  [judgeMergedPullRequests(null, TIP).landed, false, 'gh failing keeps'],
  [judgeMergedPullRequests(undefined, TIP).landed, false, 'gh missing keeps'],
  [judgeMergedPullRequests('not json', TIP).landed, false, 'a nonsense answer keeps'],
  [judgeMergedPullRequests([{ number: 1 }], TIP).landed, false, 'a pull request with no head commit keeps'],
  [judgeMergedPullRequests([{ number: 565, headRefOid: TIP }], null).landed, false, 'an unreadable tip keeps'],
  // A branch name reused after an older pull request merged must not inherit
  // its answer: the tip has to match, not the name.
  [
    judgeMergedPullRequests([{ number: 100, headRefOid: OTHER }, { number: 200, headRefOid: TIP }], TIP).number,
    200,
    'the pull request whose head is this tip is the one that counts',
  ],
]

for (const [actual, expected, name] of judgements) is(actual, expected, name)

// ---------------------------------------------------------------------------
// The sweep, over a real repository with a real squash merge in it.
// ---------------------------------------------------------------------------

const root = realpathSync(mkdtempSync(join(tmpdir(), 'prune-worktrees-')))
const origin = join(root, 'origin.git')
const clone = join(root, 'clone')

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'prune-test',
  GIT_AUTHOR_EMAIL: 'prune-test@example.com',
  GIT_COMMITTER_NAME: 'prune-test',
  GIT_COMMITTER_EMAIL: 'prune-test@example.com',
}

const git = (args, cwd = clone) =>
  execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** A worktree under `.claude/worktrees/`, which is the only kind this sweeps. */
function worktreeAt(name, branch) {
  const path = join(clone, '.claude', 'worktrees', name)
  git(['worktree', 'add', '-q', '-b', branch, path])
  return path
}

function commitIn(path, file, text, message) {
  writeFileSync(join(path, file), text)
  git(['add', '-A'], path)
  git(['commit', '-q', '-m', message], path)
  return git(['rev-parse', 'HEAD'], path)
}

let landedTip
let afterMergeTip
let originalCwd
const asked = []

try {
  git(['init', '-q', '--bare', origin], root)
  git(['init', '-q', '-b', 'master', clone], root)
  writeFileSync(join(clone, 'shared.txt'), 'base\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'base'])
  git(['remote', 'add', 'origin', origin])
  git(['push', '-q', '-u', 'origin', 'master'])

  // 1. The worktree #577 is about. Two commits, both touching a file master
  //    will touch again, squash-merged so neither commit is ever on master.
  const landed = worktreeAt('agent-landed', 'feature/landed')
  commitIn(landed, 'shared.txt', 'base\nlanded\n', 'first')
  landedTip = commitIn(landed, 'landed.txt', 'landed\n', 'second')

  git(['merge', '--squash', 'feature/landed'])
  git(['commit', '-q', '-m', 'The landed change (#565)'])

  // 2. Master moves on top of the same file, which is the half that makes the
  //    content comparison answer in the other direction.
  writeFileSync(join(clone, 'shared.txt'), 'base\nlanded\nsomebody else\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'The next change (#566)'])
  git(['push', '-q', 'origin', 'master'])

  // 3. A worktree holding real unlanded work. Never merged, never pushed.
  const unlanded = worktreeAt('agent-unlanded', 'feature/unlanded')
  commitIn(unlanded, 'unlanded.txt', 'an afternoon\n', 'work nobody has seen')

  // 4. Merged, and then committed in again afterwards. This is the failure of
  //    2026-08-14 and the case the header used to call a blind spot.
  const after = worktreeAt('agent-after', 'feature/after')
  afterMergeTip = commitIn(after, 'after.txt', 'merged\n', 'the merged commit')
  git(['merge', '--squash', 'feature/after'])
  git(['commit', '-q', '-m', 'The other change (#700)'])
  git(['push', '-q', 'origin', 'master'])
  commitIn(after, 'after.txt', 'merged\nand then more\n', 'committed after the merge')

  // 5. Locked, which is how a running agent marks its worktree. Nothing should
  //    ask GitHub about it: the local checks come first and cost nothing.
  const locked = worktreeAt('agent-locked', 'feature/locked')
  commitIn(locked, 'locked.txt', 'in progress\n', 'still working')
  git(['worktree', 'lock', '--reason', 'claude agent agent-locked (pid 1)', locked])

  const say = () => {
    const said = []
    const real = console.log
    console.log = (line) => said.push(line)
    try {
      main({ askGitHub: currentAnswer })
    } finally {
      console.log = real
    }
    return said.join('\n')
  }

  let currentAnswer = () => null
  originalCwd = process.cwd()
  process.chdir(clone)

  // --- Run one: no `gh`, which is also the behaviour before #577. ---
  const withoutGitHub = say()
  is(/agent-landed: \d+ file\(s\) differ from master/.test(withoutGitHub), true,
    'with no answer from GitHub the merged worktree is still refused')
  is(withoutGitHub.includes('Pruned'), false, 'and nothing at all is removed')
  is(existsSync(join(clone, '.claude', 'worktrees', 'agent-landed')), true, 'so it is still on disk')

  // --- Run two: GitHub answers, which is the fix. ---
  currentAnswer = (branch) => {
    asked.push(branch)
    if (branch === 'feature/landed') return [{ number: 565, headRefOid: landedTip }]
    if (branch === 'feature/after') return [{ number: 700, headRefOid: afterMergeTip }]
    return []
  }
  const withGitHub = say()

  // The removal.
  is(withGitHub.includes('Pruned 1 worktree(s): agent-landed (landed as #565)'), true,
    'the squash-merged worktree is released, and says what landed it')
  is(existsSync(join(clone, '.claude', 'worktrees', 'agent-landed')), false, 'and it is gone from disk')

  // The refusals, which are the half that matters.
  is(/agent-unlanded: 1 file\(s\) differ from master.*so this is unlanded work/.test(withGitHub), true,
    'a worktree holding unlanded work is still refused, and named')
  is(existsSync(join(clone, '.claude', 'worktrees', 'agent-unlanded')), true, 'and is still on disk')

  is(/agent-after: .*merged as #700, but this checkout has moved since/.test(withGitHub), true,
    'a worktree committed into after its merge is refused, and told why')
  is(existsSync(join(clone, '.claude', 'worktrees', 'agent-after')), true, 'and is still on disk')

  is(withGitHub.includes('agent-locked: locked, so an agent is using it'), true,
    'a locked worktree is refused before anything else')
  is(asked.includes('feature/locked'), false,
    'and GitHub is not asked about it: the network call is only for the worktrees this would otherwise refuse')
  is(asked.length, 3, 'exactly the three worktrees that reached the content check were asked about')
} finally {
  if (originalCwd) process.chdir(originalCwd)
  rmSync(root, { recursive: true, force: true })
}

const total = judgements.length + 12
if (failed > 0) {
  console.error(`\n${failed} of ${total} checks behaved wrongly.`)
  process.exit(1)
}

console.log(`prune-worktrees: ${total} checks behaved as expected.`)

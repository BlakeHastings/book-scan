// What the merge guard must deny, and what it must not.
//
// The line this file holds the guard to: a command is the head of a segment the
// shell will execute, and everything else on the line is cargo. Cargo may say
// anything at all, including the exact text of a blocked command, and the guard
// must not care.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The guard decides "this repository" from the checkout it was loaded from, so
// the copy under test lives in a fixture repository standing in for book-scan,
// with clones, a worktree and an unrelated repository around it.
const SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'guard-merge.mjs')
const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'guard-merge-')))

const git = (dir, ...args) =>
  execFileSync(
    'git',
    ['-C', dir, '-c', 'user.email=guard-merge-test@example.com', '-c', 'user.name=guard-merge-test', ...args],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )

// `git rev-parse --abbrev-ref HEAD` fails on an unborn branch (no commit yet),
// so each fixture needs one empty commit before the guard can ask it anything.
function initFixture(dir, branch, origin) {
  execFileSync('git', ['init', '-q', '-b', branch, dir])
  git(dir, 'commit', '--allow-empty', '-q', '-m', 'init')
  if (origin) git(dir, 'remote', 'add', 'origin', origin)
}

const guarded = join(fixtureRoot, 'book-scan')
initFixture(guarded, 'master', 'git@github.com:example/guarded.git')
mkdirSync(join(guarded, 'scripts'))
const GUARD = join(guarded, 'scripts', 'guard-merge.mjs')
copyFileSync(SOURCE, GUARD)

// An agent's worktree of it, where the harness puts one.
const worktree = join(guarded, '.claude', 'worktrees', 'agent-x')
git(guarded, 'worktree', 'add', '-q', '-b', 'agent-x', worktree)

// Separate clones of the same repository, spelling its URL another way. A
// bare `git push` and a `git merge` are dangerous or harmless depending on the
// branch of the checkout the command runs in, not of whatever checkout this
// test happens to run from.
const onFeature = join(fixtureRoot, 'feature-clone')
const onMaster = join(fixtureRoot, 'master-clone')
initFixture(onFeature, 'work/293-cd-detection', 'https://github.com/Example/guarded')
initFixture(onMaster, 'master', 'https://github.com/Example/guarded')

// Another repository on the same machine, with its own remote: the one #596
// was met in.
const elsewhereRemote = join(fixtureRoot, 'elsewhere.git')
execFileSync('git', ['init', '-q', '--bare', elsewhereRemote])
const elsewhere = join(fixtureRoot, 'elsewhere')
initFixture(elsewhere, 'master', elsewhereRemote)

// A directory that is no repository at all.
const nowhere = join(fixtureRoot, 'not-a-repo')
mkdirSync(nowhere)

// A guarded repository with no remote, whose worktree is on master. Nothing but
// the shared git directory can tell the guard that worktree is its own.
const unpublished = join(fixtureRoot, 'unpublished')
initFixture(unpublished, 'trunk')
mkdirSync(join(unpublished, 'scripts'))
const UNPUBLISHED_GUARD = join(unpublished, 'scripts', 'guard-merge.mjs')
copyFileSync(SOURCE, UNPUBLISHED_GUARD)
const unpublishedWorktree = join(unpublished, '.claude', 'worktrees', 'agent-y')
git(unpublished, 'worktree', 'add', '-q', '-b', 'master', unpublishedWorktree)

// Where a command with no `cd` in it is taken to run. This is a clone on a
// feature branch, so a case that is denied is denied for what it says rather
// than for where it stands.
const ANYWHERE = onFeature

function decide(command, cwd = ANYWHERE, guard = GUARD) {
  const payload = cwd === null ? { tool_input: { command } } : { tool_input: { command }, cwd }
  const output = execFileSync('node', [guard], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  })
  if (!output.trim()) return { denied: false, reason: '' }
  const parsed = JSON.parse(output).hookSpecificOutput
  return { denied: parsed.permissionDecision === 'deny', reason: parsed.permissionDecisionReason }
}

// [command, expected] or [command, expected, cwd].
const cases = [
  ['gh pr merge 42', 'deny'],
  ['gh pr merge 42 --squash', 'deny'],
  ['gh pr merge --auto 42', 'deny'],
  ['gh   pr   merge   42', 'deny'],
  ['gh pr "merge" 42', 'deny'],
  ['gh pr me"rge" 42', 'deny'],
  ['gh --repo example/guarded pr merge 42', 'deny'],
  ['gh -R Example/Guarded pr merge', 'deny'],
  ['/usr/bin/gh pr merge 42', 'deny'],
  ['\\gh pr merge 42', 'deny'],

  ['gh api --method PUT repos/example/guarded/pulls/42/merge', 'deny'],
  ['gh api repos/{owner}/{repo}/pulls/1/merge -f merge_method=squash', 'deny'],
  ['gh api -X PUT "repos/example/guarded/pulls/9/merge"', 'deny'],

  ['git push origin master', 'deny'],
  ['git push origin HEAD:master', 'deny'],
  ['git push origin master:master', 'deny'],
  ['git push origin refs/heads/master', 'deny'],
  ['git push origin +master', 'deny'],
  ['git push --force origin master', 'deny'],
  ['git push -f origin HEAD:master', 'deny'],
  ['git push --force-with-lease origin master', 'deny'],
  ['git push "origin" "master"', 'deny'],
  ['git push origin :master', 'deny'],
  ['git push --delete origin master', 'deny'],
  ['git -C /work/repo push origin master', 'deny'],
  ['git -c push.default=current push origin master', 'deny'],
  // git's option parser accepts a bundled cluster, so `-nq` is a dry run and is
  // denied anyway. That is the harmless direction: matching any cluster
  // containing `n` would read `-on`, which is `-o n`, a push option, as a dry
  // run and allow a real push.
  ['git push -nq origin master', 'deny'],

  ['git push origin feature && gh pr merge 7', 'deny'],
  ['cd repo; gh pr merge 42', 'deny'],
  ['gh pr view 42 || gh pr merge 42', 'deny'],
  ['git push origin feature\ngh pr merge 7', 'deny'],
  ['yes | gh pr merge 42', 'deny'],
  ['npm run check && git push origin master', 'deny'],
  ['(cd repo && gh pr merge 42)', 'deny'],
  ['(cd repo && gh pr merge)', 'deny'],
  ['(gh pr merge)', 'deny'],
  ['{ gh pr merge; }', 'deny'],
  ['if true; then gh pr merge; fi', 'deny'],
  ['if gh pr checks 42; then gh pr merge 42; fi', 'deny'],
  ['for pr in 1 2; do gh pr merge $pr; done', 'deny'],
  ['! gh pr merge 42', 'deny'],
  ['time gh pr merge', 'deny'],
  ['echo "$(gh pr merge 42)"', 'deny'],
  ['echo `gh pr merge 42`', 'deny'],
  // An unterminated quote is text: read the other way, an apostrophe hides a
  // real merge behind it.
  ["echo don't && gh pr merge 5", 'deny'],

  ['GH_TOKEN=x gh pr merge 42', 'deny'],
  ['FOO=1 BAR=2 gh pr merge 42', 'deny'],
  ['GIT_TRACE=1 git push origin master', 'deny'],

  ['bash -c "gh pr merge 42"', 'deny'],
  ['pwsh -Command "gh pr merge 42"', 'deny'],
  ['bash -c "git push origin master"', 'deny'],

  ['git push', 'deny', onMaster],
  ['git push origin', 'deny', onMaster],
  ['git merge feature', 'deny', onMaster],
  ['git merge --no-ff feature', 'deny', onMaster],
  [`cd "${onMaster}" && git push`, 'deny', onFeature],
  [`cd "${onMaster}" && git merge feature`, 'deny', onFeature],
  ['bash -c "git push"', 'deny', onMaster],

  ['node scripts/merge-pr.mjs 42', 'allow'],
  ['node ./scripts/merge-pr.mjs 42', 'allow'],
  ['node scripts/merge-pr.mjs 42 --dry-run', 'allow'],
  ['if gh pr checks 42; then node scripts/merge-pr.mjs 42; fi', 'allow'],

  ['git push origin platform/444-guard-reads-commands', 'allow'],
  ['git push -u origin HEAD', 'allow'],
  ['git push origin HEAD', 'allow'],
  ['git push --force-with-lease origin platform/444-guard-reads-commands', 'allow'],
  ['git push origin HEAD:refs/heads/platform/444-guard-reads-commands', 'allow'],
  ['gh pr create --fill', 'allow'],
  ['gh pr view 42 --json statusCheckRollup', 'allow'],
  ['gh api repos/{owner}/{repo}/issues/3/sub_issues -F sub_issue_id=9', 'allow'],
  ['', 'allow'],
  ['   ', 'allow'],

  ['git push', 'allow', onFeature],
  [`cd "${onFeature}" && git push`, 'allow', onMaster],
  ['git push origin some-feature', 'allow', onMaster],

  ['git push origin master-fix', 'allow'],
  ['git push origin fix-master', 'allow'],
  ['git push origin release/master', 'allow'],
  ['git push origin HEAD:master-fix', 'allow'],
  ['git push master', 'allow'],
  ['git push master HEAD:feature', 'allow'],

  ['git push --dry-run origin master', 'allow'],
  ['git push -n origin master', 'allow'],
  ['git push --dry-run --force origin HEAD:master', 'allow'],
  ['git -C /work/repo push --dry-run origin master', 'allow'],

  ['git merge-base --is-ancestor abc origin/master', 'allow'],
  ['git merge-base HEAD origin/master', 'allow'],
  ['git merge-tree abc def', 'allow'],
  ['git worktree list', 'allow'],
  ['git log --oneline origin/master', 'allow'],
  ['git checkout -b chore/merges-cleanup', 'allow'],
  ['gh api repos/o/r/branches/merge-queue-test', 'allow'],

  ['git merge --ff-only origin/master', 'allow', onMaster],
  ['git merge --abort', 'allow', onMaster],
  ['git merge --continue', 'allow', onMaster],
  ['git merge feature', 'allow', onFeature],

  ['gh pr create --title "Fix the guard" --body "It denied a comment quoting gh pr merge."', 'allow'],
  ['gh issue comment 45 --body "gh pr merge was denied"', 'allow'],
  ['gh issue comment 45 --body "| Command | Result |\n| gh pr merge --help | denied |"', 'allow'],
  ['gh issue comment 5 --body "git push origin master is denied here"', 'allow'],
  ['git commit -m "Deny gh pr merge before it runs"', 'allow'],
  ['git commit -m "explain why we merge to master this way" && git push origin feature', 'allow'],
  ['echo "gh pr merge 1"', 'allow'],
  ['gh pr create --body "$(cat <<\'EOF\'\n| gh pr merge 42 | denied |\nEOF\n)"', 'allow'],
  ['cat > docs/process/notes.md <<\'EOF\'\nNever run gh pr merge; use node scripts/merge-pr.mjs.\nEOF', 'allow'],
  ['grep -rn "gh pr merge" docs/', 'allow'],
  ['rg "git push origin master" docs/process', 'allow'],
  ['gh api repos/o/r/issues/58/comments -f body="gh pr merge 42 was denied"', 'allow'],
  ['gh api repos/o/r/issues/58/comments -f body="see /merge"', 'allow'],
  ['bash -c "echo gh pr merge 42"', 'allow'],
  ['pwsh -Command "gh issue comment 58 --body \'gh pr merge is denied\'"', 'allow'],

  ['node scripts/guard-merge.mjs --probe', 'deny'],
  ['node ./scripts/guard-merge.mjs --probe', 'deny'],
  ['node C:\\Users\\o\\repo\\scripts\\guard-merge.mjs --probe', 'deny'],
  ['GH_TOKEN=x node scripts/guard-merge.mjs --probe', 'deny'],
  ['node "scripts/guard-merge.mjs" --probe', 'deny'],
  ['bash -c "node scripts/guard-merge.mjs --probe"', 'deny'],
  ['echo "node scripts/guard-merge.mjs --probe"', 'allow'],
  ['cat scripts/guard-merge.mjs', 'allow'],
  ['git commit -m "Give the guard a --probe mode"', 'allow'],
  ['gh issue comment 45 --body "run node scripts/guard-merge.mjs --probe and paste the refusal"', 'allow'],
  ['bash -c "echo node scripts/guard-merge.mjs --probe"', 'allow'],
  ['node scripts/guard-merge.mjs', 'allow'],
  ['node "$CLAUDE_PROJECT_DIR/scripts/guard-merge.mjs"', 'allow'],
  ['node scripts/merge-pr.mjs --probe', 'allow'],
  ['node scripts/guard-live-data.mjs --probe', 'allow'],

  ['git commit -m "fix (again)"', 'allow'],
  ['git add "docs/notes (draft).md"', 'allow'],
  ['gh pr create --body "Denied: (cd repo && gh pr merge)"', 'allow'],
  ['cd C:\\Program Files (x86)\\repo', 'allow'],
  ['mkdir -p docs/{process,architecture}', 'allow'],
  ['echo "{ gh pr merge; }"', 'allow'],
  ['for f in docs/*.md; do git add "$f"; done', 'allow'],
  ['time npm run check', 'allow'],
  ['time', 'allow'],
  ['git commit -m "FOO=1"', 'allow'],
  ['gh issue comment 5 --body "GIT_TRACE=1 git push"', 'allow'],
  ['gh api repos/o/r/issues -f body="a=b"', 'allow'],
  ['FOO=1 BAR=2', 'allow'],
  // A shell reads `=x` as a command name and fails to find it, so stripping it
  // would invent a command that never ran.
  ['=x gh pr merge 42', 'allow'],

  // A gap the guard states rather than half-closes: `$b` expands to `master`
  // and the guard sees `$b`. Pinned as an allow so a later change that appears
  // to close it has to change this line and say why.
  ['for b in master; do git push origin $b; done', 'allow'],

  // Another repository is not this guard's business, whatever it calls its
  // branches. The first is the command #596 quotes.
  ['git push origin --delete master', 'allow', elsewhere],
  ['git push origin :master', 'allow', elsewhere],
  ['git push -d origin master', 'allow', elsewhere],
  ['git push origin HEAD:master', 'allow', elsewhere],
  ['git push --force origin master', 'allow', elsewhere],
  ['git push', 'allow', elsewhere],
  ['git merge feature', 'allow', elsewhere],
  ['gh pr merge 23 --squash', 'allow', elsewhere],
  ['gh api --method PUT repos/{owner}/{repo}/pulls/1/merge', 'allow', elsewhere],
  [`cd "${elsewhere}" && git push origin --delete master`, 'allow', worktree],
  [`git -C "${elsewhere}" push origin HEAD:master`, 'allow', worktree],
  // Named outright, another repository is another repository from in here too.
  ['gh --repo someone/else pr merge 23', 'allow'],
  ['gh pr merge https://github.com/someone/else/pull/23', 'allow'],
  ['gh api --method PUT repos/someone/else/pulls/23/merge', 'allow'],
  [`git push "${elsewhereRemote}" HEAD:master`, 'allow'],

  // Deleting this repository's master is refused, from anywhere it is reached.
  ['git push origin --delete master', 'deny'],
  ['git push -d origin master', 'deny'],
  ['git push origin +:master', 'deny'],
  ['git push origin --delete master', 'deny', worktree],
  ['git push origin --delete old-feature', 'allow', worktree],
  ['git push origin :old-feature', 'allow'],
  ['git push --dry-run origin --delete master', 'allow'],

  // Standing somewhere else is not a way out of this repository.
  [`git -C "${guarded}" push origin HEAD:master`, 'deny', elsewhere],
  [`git -C .. -C book-scan push origin HEAD:master`, 'deny', elsewhere],
  [`cd "${guarded}" && git push origin --delete master`, 'deny', elsewhere],
  [`cd "${elsewhere}" && git -C "${worktree}" push origin HEAD:master`, 'deny', onFeature],
  [`git --git-dir="${guarded}/.git" push origin HEAD:master`, 'deny', elsewhere],
  [`GIT_DIR="${guarded}/.git" git push origin HEAD:master`, 'deny', elsewhere],
  ['git push git@github.com:example/guarded.git HEAD:master', 'deny', elsewhere],
  ['git push https://github.com/EXAMPLE/guarded/ HEAD:master', 'deny', elsewhere],
  ['git -c url.https://github.com/.insteadOf=hub: push hub:example/guarded HEAD:master', 'deny', elsewhere],
  [`git push "${guarded}" HEAD:master`, 'deny', elsewhere],
  [`git push "${worktree}" HEAD:master`, 'deny', elsewhere],
  ['gh --repo example/guarded pr merge 5', 'deny', elsewhere],
  ['gh pr merge https://github.com/example/guarded/pull/5', 'deny', elsewhere],
  ['GH_REPO=example/guarded gh pr merge 5', 'deny', elsewhere],
  ['export GH_REPO=example/guarded; gh pr merge 5', 'deny', elsewhere],
  ['GH_REPO=example/guarded gh api -X PUT repos/{owner}/{repo}/pulls/5/merge', 'deny', elsewhere],
  ['gh api -X PUT repos/example/guarded/pulls/5/merge', 'deny', elsewhere],
  ['GH_REPO=example/guarded bash -c "gh pr merge 5"', 'deny', elsewhere],
  // The guard asks where a remote points before the line runs, so a line that
  // repoints one first cannot be answered by asking.
  ['git remote set-url origin git@github.com:example/guarded.git && git push origin HEAD:master', 'deny', elsewhere],
  ['git remote add up https://github.com/example/guarded && git push up :master', 'deny', elsewhere],
  ['git config remote.origin.pushurl git@github.com:example/guarded.git; git push origin HEAD:master', 'deny', elsewhere],
  ['gh repo set-default example/guarded && gh pr merge 5', 'deny', elsewhere],
  ['git remote -v && git push origin HEAD:master', 'allow', elsewhere],

  // A worktree of this repository is this repository.
  ['git push origin HEAD:master', 'deny', worktree],
  ['gh pr merge 5', 'deny', worktree],
  ['git push origin HEAD', 'allow', worktree],
  ['git push -u origin agent-x', 'allow', worktree],
  // And so is its primary checkout, which is on master.
  ['git push', 'deny', guarded],
  ['git merge agent-x', 'deny', guarded],

  // A directory that is no repository says nothing about where a command lands,
  // so the command is treated as this repository's.
  ['gh pr merge 5', 'deny', nowhere],
  ['git push origin --delete master', 'deny', nowhere],
  ['npm run build', 'allow', nowhere],

  // No working directory at all is a command the guard cannot place: the same
  // answer as a directory that is no repository, for every rule.
  ['gh pr merge 42 --squash', 'deny', null],
  ['git push origin --delete master', 'deny', null],
  ['git push', 'deny', null],
  ['git merge feature', 'deny', null],
  ['cd ../elsewhere && git push origin :master', 'deny', null],
  [`cd "${elsewhere}" && git push origin --delete master`, 'allow', null],
  ['npm run build', 'allow', null],
  ['git push origin HEAD', 'allow', null],
]

let failed = 0
const fail = (message) => {
  failed += 1
  console.error(`FAIL  ${message}`)
}

try {
  for (const [command, expected, cwd] of cases) {
    const { denied } = decide(command, cwd === undefined ? ANYWHERE : cwd)
    const actual = denied ? 'deny' : 'allow'
    if (actual !== expected) {
      fail(`expected ${expected}, got ${actual}:  ${JSON.stringify(command)}`)
    }
  }

  const malformed = execFileSync('node', [GUARD], { input: 'not json', encoding: 'utf8' })
  if (malformed.trim() !== '') fail('a malformed payload produced a decision')

  if (!decide('git merge feature', unpublishedWorktree, UNPUBLISHED_GUARD).denied) {
    fail('a worktree of a repository with no remote was not recognised as that repository')
  }
  if (decide('git merge feature', elsewhere, UNPUBLISHED_GUARD).denied) {
    fail('a repository with no remote claimed an unrelated one as its own')
  }

  // A deletion is refused for what it is, not as though it wrote code.
  const deletion = decide('git push origin --delete master').reason
  if (!/deletes master/.test(deletion)) fail(`deleting master was refused for the wrong reason: ${deletion}`)

  if (!decide(`node ${GUARD} --probe`).denied) {
    fail('the guard does not refuse the probe at its own path')
  }

  // A probe anybody may run must not double as a map of what the guard misses.
  const refusal = decide('node scripts/guard-merge.mjs --probe').reason
  for (const bypass of ['sudo', 'nohup', 'xargs', 'env ', '--mirror', '--all', 'EncodedCommand']) {
    if (refusal.includes(bypass)) fail(`the probe's refusal names a way past the guard: ${bypass}`)
  }
  if (!/loaded/.test(refusal)) fail('the probe\'s refusal does not say the guard is loaded')

  // `npm test` puts `npm_lifecycle_event` in this process's environment and
  // every child inherits it, so a probe run from here would look to itself
  // exactly like one wrapped in a package script. The two states below have to
  // be measured with that removed and with it forced.
  const withoutNpm = () => {
    const env = { ...process.env }
    for (const name of Object.keys(env)) if (name.startsWith('npm_')) delete env[name]
    return env
  }

  const probeSays = (env) => {
    try {
      execFileSync('node', [GUARD, '--probe'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      })
      return null // Exited 0, which is the one answer a probe must never give.
    } catch (error) {
      return error
    }
  }

  const unintercepted = probeSays(withoutNpm())
  if (unintercepted === null) {
    fail('the probe exited 0, so a session cannot tell loaded from inert')
  } else {
    if (unintercepted.status !== 1) fail(`the probe exited ${unintercepted.status}, not 1`)
    for (const expected of [/NOT loaded/, /in this process/, /read once/, /Restart/]) {
      if (!expected.test(unintercepted.stderr)) {
        fail(`the unintercepted probe never says ${expected}`)
      }
    }
  }

  const throughRunner = probeSays({ ...withoutNpm(), npm_lifecycle_event: 'probe' })
  if (throughRunner === null) {
    fail('a probe that cannot be refused still reported')
  } else {
    if (/NOT loaded/.test(throughRunner.stderr)) {
      fail('the probe answered a question it could not observe')
    }
    if (!/not through a package script/.test(throughRunner.stderr)) {
      fail('the probe does not say why it refused to report')
    }
    if (!/node scripts\/guard-merge\.mjs --probe/.test(throughRunner.stderr)) {
      fail('the probe does not print the command that would work')
    }
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}

if (failed > 0) {
  console.error(`\n${failed} check(s) behaved wrongly.`)
  process.exit(1)
}

console.log(`guard-merge: ${cases.length} commands, and every probe check, behaved as expected.`)

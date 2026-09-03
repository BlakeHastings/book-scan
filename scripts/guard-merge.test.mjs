// What the merge guard must deny, and what it must not.
//
//   node scripts/guard-merge.test.mjs
//
// The guard denies the commands that can land code on master. It has now
// shipped four false denials, every one of them a safe command: a push to a
// feature branch whose commit message mentioned the default branch,
// `git merge-base`, which is read-only plumbing that `\bmerge\b` happens to
// match, a `gh pr create` whose *body* quoted the blocked command, and the
// heredoc writing the issue about that one (#444). Nothing was being merged in
// any of the four.
//
// The allow cases matter more than the deny cases. A guard that denies too
// little has a gap; a guard that denies too much gets switched off, which is
// every gap at once. That sentence is why this file is mostly allow cases, and
// why #444's fix had to be "look at the command" rather than "drop a pattern".
//
// THE LINE THIS FILE HOLDS THE GUARD TO
// A command is the head of a segment the shell will execute. Everything else
// on the line is cargo: a `--body`, a `-m`, a heredoc body, an argument to
// `echo` or `grep`, a `-f body=` field. Cargo may say anything at all,
// including the exact text of a blocked command, and the guard must not care.
// The moment it cares, writing about the control becomes impossible through
// the shell, which is where #444 was found and what it cost.
//
// Note the deny commands are written out in full here. They used to be
// assembled from parts, because the old guard read a whole command line as
// text and would have refused any tool that so much as carried them. That the
// literals can now sit in this file, and that `grep`ping for them is an allow
// case below, is the fix stated as a fact about the repository.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'guard-merge.mjs')

// Fixtures for the branch-dependent rules (#293). A bare `git push` and a
// `git merge` are dangerous or harmless depending on the branch standing under
// them, and that is the branch of the checkout the command runs in, not of
// whatever checkout this test happens to run from. Two ways for the guard to
// learn it are exercised below: the `cwd` the hook payload carries, which is
// the directory the tool call runs in, and a leading `cd <dir> &&`, which is
// how an agent worktree pushes.
const fixtureRoot = mkdtempSync(join(tmpdir(), 'guard-merge-'))
const onFeature = join(fixtureRoot, 'feature-worktree')
const onMaster = join(fixtureRoot, 'master-worktree')
// `git rev-parse --abbrev-ref HEAD` fails on an unborn branch (no commit yet),
// so each fixture needs one empty commit before the guard can ask it anything.
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
initFixture(onFeature, 'work/293-cd-detection')
initFixture(onMaster, 'master')

// Where a command with no `cd` in it is taken to run. The fixtures decide the
// branch-dependent cases; everything else runs from a directory that is on a
// feature branch, so a case that is denied is denied for what it says rather
// than for where it stands.
const ANYWHERE = onFeature

function decide(command, cwd = ANYWHERE) {
  const output = execFileSync('node', [GUARD], {
    input: JSON.stringify({ tool_input: { command }, cwd }),
    encoding: 'utf8',
  })
  if (!output.trim()) return { denied: false, reason: '' }
  const parsed = JSON.parse(output).hookSpecificOutput
  return { denied: parsed.permissionDecision === 'deny', reason: parsed.permissionDecisionReason }
}

// [command, expected] or [command, expected, cwd].
const cases = [
  // ------------------------------------------------------------------------
  // The routes that actually land code without checks.
  // ------------------------------------------------------------------------
  ['gh pr merge 42', 'deny'],
  ['gh pr merge 42 --squash', 'deny'],
  ['gh pr merge --auto 42', 'deny'],
  ['gh   pr   merge   42', 'deny'],
  // Quoting comes off a token, so these read as the bare form.
  ['gh pr "merge" 42', 'deny'],
  ['gh pr me"rge" 42', 'deny'],
  // A global flag sits between `gh` and its subcommand, so finding the
  // subcommand means stepping over flags rather than reading tokens 1 and 2.
  ['gh --repo o/r pr merge 42', 'deny'],
  ['gh -R o/r pr merge', 'deny'],
  // A path and a backslash escape are spelling, not a second program.
  ['/usr/bin/gh pr merge 42', 'deny'],
  ['\\gh pr merge 42', 'deny'],

  // The REST merge endpoints, reached directly.
  ['gh api --method PUT repos/o/r/pulls/42/merge', 'deny'],
  ['gh api repos/{owner}/{repo}/pulls/1/merge -f merge_method=squash', 'deny'],
  ['gh api -X PUT "repos/o/r/pulls/9/merge"', 'deny'],

  // A push whose own arguments name master as the destination.
  ['git push origin master', 'deny'],
  ['git push origin HEAD:master', 'deny'],
  ['git push origin master:master', 'deny'],
  ['git push origin refs/heads/master', 'deny'],
  ['git push origin +master', 'deny'],
  ['git push --force origin master', 'deny'],
  ['git push -f origin HEAD:master', 'deny'],
  ['git push --force-with-lease origin master', 'deny'],
  ['git push "origin" "master"', 'deny'],
  // Deleting the default branch is a write to it.
  ['git push origin :master', 'deny'],
  ['git push --delete origin master', 'deny'],
  // git's own flags come before the subcommand, and some swallow a value.
  ['git -C /work/repo push origin master', 'deny'],
  ['git -c push.default=current push origin master', 'deny'],
  // The residual of the `--dry-run` allowance below, named rather than
  // widened. git's option parser accepts a bundled cluster, so `-nq` is a dry
  // run and is denied anyway. That is the harmless direction: matching any
  // cluster containing `n` would read `-on`, which is `-o n`, a push option, as
  // a dry run and allow a real push.
  ['git push -nq origin master', 'deny'],

  // Every way one command follows another. Reading the head of each command
  // rather than the whole line is what stops the guard degrading into a text
  // scan, so each of these has to be recognised as a command boundary.
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
  // An unterminated quote is text, not an argument that swallows the rest of
  // the line. Read the other way, an apostrophe hides a real merge behind it.
  ["echo don't && gh pr merge 5", 'deny'],

  // An assignment prefix binds a variable for the command that follows, so the
  // command is what follows it. `GH_TOKEN=$SOMETHING gh pr merge` is an agent
  // working around an auth problem rather than an agent hiding, which is the
  // case this guard is for.
  ['GH_TOKEN=x gh pr merge 42', 'deny'],
  ['FOO=1 BAR=2 gh pr merge 42', 'deny'],
  ['GIT_TRACE=1 git push origin master', 'deny'],

  // This hook is wired to both shell tools the harness exposes, and each shell
  // can invoke the other one.
  ['bash -c "gh pr merge 42"', 'deny'],
  ['pwsh -Command "gh pr merge 42"', 'deny'],
  ['bash -c "git push origin master"', 'deny'],

  // ------------------------------------------------------------------------
  // The branch-dependent rules (#293), which the skill's asset drops and this
  // copy keeps. A push with no destination and a merge inherit the branch
  // under them, so the command line does not say where they land.
  // ------------------------------------------------------------------------
  ['git push', 'deny', onMaster],
  ['git push origin', 'deny', onMaster],
  ['git merge feature', 'deny', onMaster],
  ['git merge --no-ff feature', 'deny', onMaster],
  // The same, learned from a leading `cd` rather than from the payload.
  [`cd "${onMaster}" && git push`, 'deny', onFeature],
  [`cd "${onMaster}" && git merge feature`, 'deny', onFeature],
  // A shell inside a shell keeps the directory it was given.
  ['bash -c "git push"', 'deny', onMaster],

  // ------------------------------------------------------------------------
  // The sanctioned path. If this ever fails, nothing can land at all.
  // ------------------------------------------------------------------------
  ['node scripts/merge-pr.mjs 42', 'allow'],
  ['node ./scripts/merge-pr.mjs 42', 'allow'],
  ['node scripts/merge-pr.mjs 42 --dry-run', 'allow'],
  ['if gh pr checks 42; then node scripts/merge-pr.mjs 42; fi', 'allow'],

  // ------------------------------------------------------------------------
  // Ordinary work.
  // ------------------------------------------------------------------------
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

  // A bare push from a worktree standing on its own branch, which is what an
  // agent does all day. Both ways of learning the branch.
  ['git push', 'allow', onFeature],
  [`cd "${onFeature}" && git push`, 'allow', onMaster],
  // A push to a feature branch is fine even while standing on master, which is
  // normal when tidying up after a merge.
  ['git push origin some-feature', 'allow', onMaster],

  // A branch whose name merely starts with, contains or ends in the default
  // branch's is a different branch. The destination is compared whole.
  ['git push origin master-fix', 'allow'],
  ['git push origin fix-master', 'allow'],
  ['git push origin release/master', 'allow'],
  ['git push origin HEAD:master-fix', 'allow'],
  // The first positional names the remote, so a remote called `master` is not
  // a push *to* master.
  ['git push master', 'allow'],
  ['git push master HEAD:feature', 'allow'],

  // A dry run contacts the remote and changes nothing, so a rule about landing
  // code has nothing to act on. `git push -h` lists exactly one `-n` and it is
  // `--dry-run`, so the short form is safe to match as a whole token.
  ['git push --dry-run origin master', 'allow'],
  ['git push -n origin master', 'allow'],
  ['git push --dry-run --force origin HEAD:master', 'allow'],
  ['git -C /work/repo push --dry-run origin master', 'allow'],

  // Read-only questions. None of these can change a ref, and `merge-base` is
  // the second false denial this guard shipped.
  ['git merge-base --is-ancestor abc origin/master', 'allow'],
  ['git merge-base HEAD origin/master', 'allow'],
  ['git merge-tree abc def', 'allow'],
  ['git worktree list', 'allow'],
  ['git log --oneline origin/master', 'allow'],
  ['git checkout -b chore/merges-cleanup', 'allow'],
  ['gh api repos/o/r/branches/merge-queue-test', 'allow'],

  // Catching local master up to what the remote already has. A fast-forward to
  // a remote ref cannot introduce an unreviewed commit, and this is the git
  // operation this workflow performs most.
  ['git merge --ff-only origin/master', 'allow', onMaster],
  // Finishing or abandoning a merge that is already halfway through lands
  // nothing new.
  ['git merge --abort', 'allow', onMaster],
  ['git merge --continue', 'allow', onMaster],
  // A merge on a branch that is not master is nobody's business here.
  ['git merge feature', 'allow', onFeature],

  // ------------------------------------------------------------------------
  // #444: cargo. The command is a command; what it carries is a document.
  // Every one of these was denied by the guard this replaces, and none of them
  // merges anything.
  // ------------------------------------------------------------------------
  ['gh pr create --title "Fix the guard" --body "It denied a comment quoting gh pr merge."', 'allow'],
  ['gh issue comment 45 --body "gh pr merge was denied"', 'allow'],
  ['gh issue comment 45 --body "| Command | Result |\n| gh pr merge --help | denied |"', 'allow'],
  ['gh issue comment 5 --body "git push origin master is denied here"', 'allow'],
  ['git commit -m "Deny gh pr merge before it runs"', 'allow'],
  // The first false denial this guard shipped: a commit message mentioning the
  // default branch, on the same line as a push to a feature branch.
  ['git commit -m "explain why we merge to master this way" && git push origin feature', 'allow'],
  ['echo "gh pr merge 1"', 'allow'],
  // A heredoc body is data the shell hands to a command. It is also how a long
  // `--body` gets written, and how #444 itself could not be authored.
  ['gh pr create --body "$(cat <<\'EOF\'\n| gh pr merge 42 | denied |\nEOF\n)"', 'allow'],
  ['cat > docs/process/notes.md <<\'EOF\'\nNever run gh pr merge; use node scripts/merge-pr.mjs.\nEOF', 'allow'],
  // Looking for the phrase is not running it.
  ['grep -rn "gh pr merge" docs/', 'allow'],
  ['rg "git push origin master" docs/process', 'allow'],
  // A comment posted through the API, with the command in the payload, and an
  // endpoint that is not a merge with `/merge` in a field value.
  ['gh api repos/o/r/issues/58/comments -f body="gh pr merge 42 was denied"', 'allow'],
  ['gh api repos/o/r/issues/58/comments -f body="see /merge"', 'allow'],
  // Recursion into a shell payload must read it as a command line too, not
  // scan it, or the nested case reintroduces exactly the bug above.
  ['bash -c "echo gh pr merge 42"', 'allow'],
  ['pwsh -Command "gh issue comment 58 --body \'gh pr merge is denied\'"', 'allow'],

  // ------------------------------------------------------------------------
  // The probe, held to the same standard: being refused is the answer, and
  // talking about it is not running it.
  // ------------------------------------------------------------------------
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
  // The guard invoked as a hook, which is what the wiring does on every
  // command and has no `--probe` in it. Denying this would be the guard
  // refusing itself, on every command, forever.
  ['node scripts/guard-merge.mjs', 'allow'],
  ['node "$CLAUDE_PROJECT_DIR/scripts/guard-merge.mjs"', 'allow'],
  // `--probe` is not a word this guard owns. Another script's flag is another
  // script's business.
  ['node scripts/merge-pr.mjs --probe', 'allow'],
  ['node scripts/guard-live-data.mjs --probe', 'allow'],

  // ------------------------------------------------------------------------
  // Shell text that a rule reading tokens must not misread.
  // ------------------------------------------------------------------------
  ['git commit -m "fix (again)"', 'allow'],
  ['git add "docs/notes (draft).md"', 'allow'],
  ['gh pr create --body "Denied: (cd repo && gh pr merge)"', 'allow'],
  ['cd C:\\Program Files (x86)\\repo', 'allow'],
  ['mkdir -p docs/{process,architecture}', 'allow'],
  ['echo "{ gh pr merge; }"', 'allow'],
  ['for f in docs/*.md; do git add "$f"; done', 'allow'],
  ['time npm run check', 'allow'],
  ['time', 'allow'],
  // An `=` in an argument is not an assignment prefix, and a rule that strips
  // too eagerly turns an argument into a command.
  ['git commit -m "FOO=1"', 'allow'],
  ['gh issue comment 5 --body "GIT_TRACE=1 git push"', 'allow'],
  ['gh api repos/o/r/issues -f body="a=b"', 'allow'],
  ['FOO=1 BAR=2', 'allow'],
  // A shell reads `=x` as a command name and fails to find it, so stripping it
  // would invent a command that never ran.
  ['=x gh pr merge 42', 'allow'],

  // The gap this guard states rather than half-closes: a destination the
  // command line does not spell out. `$b` here expands to `master` and the
  // guard sees `$b`. Pinned as an allow so the file's NOT COVERED section
  // stays true rather than aspirational, and so a later change that appears to
  // close it has to change this line and say why.
  ['for b in master; do git push origin $b; done', 'allow'],
]

let failed = 0
const fail = (message) => {
  failed += 1
  console.error(`FAIL  ${message}`)
}

try {
  for (const [command, expected, cwd] of cases) {
    const { denied } = decide(command, cwd ?? ANYWHERE)
    const actual = denied ? 'deny' : 'allow'
    if (actual !== expected) {
      fail(`expected ${expected}, got ${actual}:  ${JSON.stringify(command)}`)
    }
  }

  // An unparseable payload is not this guard's problem, and a guard that
  // throws on one denies nothing while looking installed.
  const malformed = execFileSync('node', [GUARD], { input: 'not json', encoding: 'utf8' })
  if (malformed.trim() !== '') fail('a malformed payload produced a decision')

  // The probe refuses itself at the path an installer actually has it at, not
  // only at the literal `scripts/guard-merge.mjs` spelled above.
  if (!decide(`node ${GUARD} --probe`).denied) {
    fail('the guard does not refuse the probe at its own path')
  }

  // A probe anybody may run must not double as a map of what the guard misses.
  // The refusal says the guard is loaded and stops there; the gaps are written
  // in the file, for whoever is editing the file.
  const refusal = decide('node scripts/guard-merge.mjs --probe').reason
  for (const bypass of ['sudo', 'nohup', 'xargs', 'env ', '--mirror', '--all', 'EncodedCommand']) {
    if (refusal.includes(bypass)) fail(`the probe's refusal names a way past the guard: ${bypass}`)
  }
  if (!/loaded/.test(refusal)) fail('the probe\'s refusal does not say the guard is loaded')

  // `npm test` puts `npm_lifecycle_event` in this process's environment and
  // every child inherits it, so a probe run from here would look to itself
  // exactly like one an installer wrapped in a package script. The two probe
  // states below have to be measured with that removed and with it forced.
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

  // The half a reader acts on. A probe that exits 0, or that says nothing about
  // which state it observed, is worse than no probe: it turns an ambiguous
  // silence into a confident one.
  const unintercepted = probeSays(withoutNpm())
  if (unintercepted === null) {
    fail('the probe exited 0, so a session cannot tell loaded from inert')
  } else {
    if (unintercepted.status !== 1) fail(`the probe exited ${unintercepted.status}, not 1`)
    // The three things the reader has to leave with: which process is
    // unprotected, why being configured did not help, and what to do about it.
    for (const expected of [/NOT loaded/, /in this process/, /read once/, /Restart/]) {
      if (!expected.test(unintercepted.stderr)) {
        fail(`the unintercepted probe never says ${expected}`)
      }
    }
  }

  // A script runner re-invokes through a shell of its own, so the hook is shown
  // `npm run <name>` and the file name the rule matches on is nowhere in that
  // line. The probe would then run in a session where the guard is loaded and
  // report it absent, which is the one wrong answer that looks like a right one.
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
    // The remedy has to be the command that works, not a restart: a restart
    // cannot fix a state that is not wrong.
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

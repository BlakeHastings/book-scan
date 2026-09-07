// What the live-data guard must deny, and what it must not.
//
//   node scripts/guard-live-data.test.mjs
//
// The allow cases matter more than the deny cases, for the reason
// `guard-merge.test.mjs` had to learn twice and this project learned a third
// time in #444: a guard that denies too little has a gap, and a guard that
// denies too much gets switched off, which is every gap at once. #444 is the
// sharpest example — that guard refused a `gh pr create` because the pull
// request *body* quoted the phrase it denies, and then refused the heredoc
// writing the issue about it.
//
// So this file spends most of its length proving that talking about the live
// catalogue is not touching it.
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verdict, argumentsOf, inAgentWorktree } from './guard-live-data.mjs'

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'guard-live-data.mjs')

// The fixtures describe the machine this test is running on, and #572 is what
// they cost when they described only one of them. They were Windows literals,
// because the guard was written on the Windows desktop where those paths are
// the real thing. The loop now runs on Linux too, where `C:/Users/...` is not
// an absolute path at all, so the helper completed it against the current
// directory and every fixture came out looking like it was inside a worktree.
// Four cases failed, and they failed *only* from inside a worktree: green in
// CI, which is the main checkout, and red in the one place every agent works.
//
// Both shapes are still exercised; the platform decides which is the honest
// one. The Windows cases are the real thing on Windows and are asserted there.
// On POSIX the Windows literal has a case of its own instead: that the helper
// refuses it rather than quietly resolving it, which is this issue by name.
const MAIN = process.platform === 'win32'
  ? 'C:/Users/Blake/source/repos/book-scan'
  : '/home/blake/source/repos/book-scan'
const WORKTREE = `${MAIN}/.claude/worktrees/agent-abc123`
const STABLE = `${MAIN}-stable`

const cases = [
  // --- The live catalogue, named from an agent worktree: denied. ---
  ['docker exec -it book-scan-live-pg psql -U postgres bookscan', WORKTREE, 'deny'],
  ['docker stop book-scan-live-pg', WORKTREE, 'deny'],
  ['docker volume rm book-scan-live-pgdata', WORKTREE, 'deny'],
  ['psql postgres://user:pw@127.0.0.1:5433/bookscan -c "select count(*) from books"', WORKTREE, 'deny'],
  ['psql postgres://user:pw@localhost:5433/bookscan', WORKTREE, 'deny'],
  [`cd ${STABLE} && git pull`, WORKTREE, 'deny'],
  ['pwsh -File scripts/backup-catalogue.ps1', WORKTREE, 'deny'],
  ['pwsh -File scripts/install-backup-task.ps1', WORKTREE, 'deny'],
  ['pwsh -File scripts/write-connection-file.ps1', WORKTREE, 'deny'],

  // --- The same commands from the main checkout: allowed. ---
  // The orchestrator deploys to stable and takes the backups, and answers for
  // both. This guard is about who is running the command, not about the words.
  ['docker exec -it book-scan-live-pg psql -U postgres bookscan', MAIN, 'allow'],
  ['pwsh -File scripts/backup-catalogue.ps1', MAIN, 'allow'],
  [`cd ${STABLE} && git pull`, MAIN, 'allow'],

  // --- Talking about it is not touching it. All from a worktree. ---
  // A comment naming the container.
  ['npm test  # never point this at book-scan-live-pg', WORKTREE, 'allow'],
  // A heredoc writing a document that names it, which is #444's exact shape.
  [
    'cat > notes.md <<\'EOF\'\nDo not connect to book-scan-live-pg or 127.0.0.1:5433.\nEOF',
    WORKTREE,
    'allow',
  ],
  // A commit message explaining the rule.
  [
    'git commit -m "Say why agents may not reach book-scan-live-pg"',
    WORKTREE,
    'allow',
  ],

  // --- Dropping a prose flag's value must not drop the command after it. ---
  // This is the hole the `-m` handling could have opened: a real command
  // chained behind a message that is allowed to mention anything.
  [
    'git commit -m "Say why agents may not reach it" && docker stop book-scan-live-pg',
    WORKTREE,
    'deny',
  ],
  [
    'gh pr create --title "About the live catalogue" --body "prose" ; psql postgres://u@127.0.0.1:5433/bookscan',
    WORKTREE,
    'deny',
  ],

  // --- Ordinary agent work that happens to look close. All allowed. ---
  ['aspire start --non-interactive', WORKTREE, 'allow'],
  ['aspire describe --format json', WORKTREE, 'allow'],
  // A worktree's own Postgres, on a port Aspire assigned.
  ['psql postgres://user:pw@127.0.0.1:62144/bookscan', WORKTREE, 'allow'],
  ['psql postgres://user:pw@localhost:54499/bookscan', WORKTREE, 'allow'],
  // A port that merely contains the digits.
  ['curl http://localhost:15433/api/books', WORKTREE, 'allow'],
  ['curl http://localhost:54330/api/books', WORKTREE, 'allow'],
  // The word "stable" on its own is ordinary English and an ordinary branch.
  ['git log --oneline origin/master', WORKTREE, 'allow'],
  ['echo "the sort is stable"', WORKTREE, 'allow'],
  ['npm run build', WORKTREE, 'allow'],
  // The repo's own name, which is a prefix of the stable checkout's.
  [`cd ${MAIN} && npm test`, WORKTREE, 'allow'],

  // --- No command: nothing to say. ---
  ['', WORKTREE, 'allow'],
  // A payload with no `cwd` used to live here, expecting `allow`. It is now a
  // refusal instead, so it is asserted twice below: as `refuses('')` among the
  // helpers, and spawned through the hook boundary, which is the only place
  // that shows what an agent would actually meet. See #582.
]

let failed = 0
for (const [command, cwd, expected] of cases) {
  const actual = verdict(command, cwd) === null ? 'allow' : 'deny'
  if (actual !== expected) {
    failed++
    console.error(`FAIL  expected ${expected}, got ${actual}:  ${JSON.stringify(command)} in ${cwd || '(no cwd)'}`)
  }
}

/** Whether the helper refused to answer about a path, rather than answering. */
function refuses(cwd) {
  try {
    inAgentWorktree(cwd)
    return false
  } catch {
    return true
  }
}

// The two helpers, checked directly because each has one job that is easy to
// get subtly wrong and hard to see failing through `verdict` alone.
const helpers = [
  [inAgentWorktree(WORKTREE), true, 'an agent worktree'],
  [inAgentWorktree(`${MAIN}/.CLAUDE/Worktrees/a`), true, 'casing'],
  [inAgentWorktree(MAIN), false, 'main checkout'],
  // #582. An absent working directory is the same question as an unplaceable
  // one and now gets the same answer. It used to answer `false`, which is this
  // helper's way of saying "the orchestrator", so a payload with no `cwd`
  // allowed everything.
  [refuses(''), true, 'an empty cwd is refused'],
  [refuses(undefined), true, 'an absent cwd is refused'],
  // A caller handing over a relative path is a caller with a bug, and the
  // helper says so instead of completing it against wherever this process
  // stands. The second is the sharp one: resolved silently it would usually
  // come out right, and the "usually" is the whole of #572.
  [refuses('scripts'), true, 'a relative path is refused'],
  [refuses('.claude/worktrees/agent-x'), true, 'a relative path that looks right is refused too'],
  [argumentsOf('run # book-scan-live-pg').includes('book-scan-live-pg'), false, 'comment stripped'],
  [argumentsOf('docker stop "book-scan-live-pg"').includes('book-scan-live-pg'), true, 'quotes flattened'],
]

if (process.platform === 'win32') {
  // Backslashes are the real separator here, and a path spelled with them must
  // read the same as one spelled without.
  helpers.push([
    inAgentWorktree('C:\\Users\\Blake\\source\\repos\\book-scan\\.claude\\worktrees\\a'),
    true,
    'backslashes',
  ])
} else {
  // #572 itself, asserted on the platform that has it. `C:/...` is not an
  // absolute path here, and the helper used to complete it against the current
  // directory. Run from an agent worktree, that made the *main checkout* answer
  // "yes, an agent" and denied the orchestrator three commands.
  helpers.push([
    refuses('C:/Users/Blake/source/repos/book-scan'),
    true,
    'a Windows path is not an absolute path here, and is refused rather than resolved',
  ])
}

// The hook boundary, driven the way the harness drives it, because letting the
// helper throw is only safe if this catches it. A hook that exits non-zero with
// nothing on stdout is reported as an error and the command then runs, so an
// uncaught exception would be an *allow*. There is no way to reach that path by
// importing, so these spawn the guard.
function decidesAtTheBoundary(command, cwd) {
  let output
  try {
    output = execFileSync('node', [GUARD], {
      input: JSON.stringify({ tool_input: { command }, cwd }),
      encoding: 'utf8',
    })
  } catch {
    return 'crashed' // Never equal to either expectation, so it fails and names itself.
  }
  if (!output.trim()) return false
  return JSON.parse(output).hookSpecificOutput.permissionDecision === 'deny'
}

const boundary = [
  [
    decidesAtTheBoundary('docker stop book-scan-live-pg', 'a/relative/path'),
    true,
    'a cwd the guard cannot place denies rather than crashing',
  ],
  [decidesAtTheBoundary('docker stop book-scan-live-pg', WORKTREE), true, 'the denial still arrives through the hook'],
  [decidesAtTheBoundary('npm run build', WORKTREE), false, 'ordinary work still passes through the hook'],
  // #582, and it has to be spawned: `undefined` here leaves the field out of
  // the JSON altogether, which is the payload shape the issue is about, and
  // `verdict` cannot be handed a missing key by an import.
  [
    decidesAtTheBoundary('docker stop book-scan-live-pg', undefined),
    true,
    'a payload with no cwd field denies instead of allowing everything',
  ],
  // The cost of the line above, asserted rather than left to be discovered.
  // The checkout is asked about before the command is read, so a payload with
  // no `cwd` refuses ordinary work too. That is the loud failure this trades
  // for the silent one, and it is only tolerable because no payload the
  // harness sends is missing the field.
  [
    decidesAtTheBoundary('npm run build', undefined),
    true,
    'and it denies ordinary work too, which is the cost of that answer',
  ],
]

for (const [actual, expected, name] of [...helpers, ...boundary]) {
  if (actual !== expected) {
    failed++
    console.error(`FAIL  helper ${name}: expected ${expected}, got ${actual}`)
  }
}

const total = cases.length + helpers.length + boundary.length
if (failed > 0) {
  console.error(`\n${failed} of ${total} cases behaved wrongly.`)
  process.exit(1)
}

console.log(`guard-live-data: ${total} cases behaved as expected.`)

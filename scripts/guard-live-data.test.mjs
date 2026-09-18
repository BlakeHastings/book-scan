// What the live-data guard must deny, and what it must not. Most of the length
// is spent proving that talking about the live catalogue is not touching it.
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verdict, argumentsOf, inAgentWorktree } from './guard-live-data.mjs'

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'guard-live-data.mjs')

// The fixtures have to be absolute on the platform the test runs on: `C:/...`
// is not an absolute path on POSIX, and the guard refuses a path it cannot
// place. Both spellings are still exercised, each on the platform that has it.
const MAIN = process.platform === 'win32'
  ? 'C:/Users/Blake/source/repos/book-scan'
  : '/home/blake/source/repos/book-scan'
const WORKTREE = `${MAIN}/.claude/worktrees/agent-abc123`
const STABLE = `${MAIN}-stable`

const cases = [
  ['docker exec -it book-scan-live-pg psql -U postgres bookscan', WORKTREE, 'deny'],
  ['docker stop book-scan-live-pg', WORKTREE, 'deny'],
  ['docker volume rm book-scan-live-pgdata', WORKTREE, 'deny'],
  ['psql postgres://user:pw@127.0.0.1:5433/bookscan -c "select count(*) from books"', WORKTREE, 'deny'],
  ['psql postgres://user:pw@localhost:5433/bookscan', WORKTREE, 'deny'],
  [`cd ${STABLE} && git pull`, WORKTREE, 'deny'],
  ['pwsh -File scripts/backup-catalogue.ps1', WORKTREE, 'deny'],
  ['pwsh -File scripts/install-backup-task.ps1', WORKTREE, 'deny'],
  ['pwsh -File scripts/write-connection-file.ps1', WORKTREE, 'deny'],

  ['docker exec -it book-scan-live-pg psql -U postgres bookscan', MAIN, 'allow'],
  ['pwsh -File scripts/backup-catalogue.ps1', MAIN, 'allow'],
  [`cd ${STABLE} && git pull`, MAIN, 'allow'],

  ['npm test  # never point this at book-scan-live-pg', WORKTREE, 'allow'],
  [
    'cat > notes.md <<\'EOF\'\nDo not connect to book-scan-live-pg or 127.0.0.1:5433.\nEOF',
    WORKTREE,
    'allow',
  ],
  [
    'git commit -m "Say why agents may not reach book-scan-live-pg"',
    WORKTREE,
    'allow',
  ],

  // Dropping a prose flag's value must not drop the command chained after it.
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

  ['aspire start --non-interactive', WORKTREE, 'allow'],
  ['aspire describe --format json', WORKTREE, 'allow'],
  ['psql postgres://user:pw@127.0.0.1:62144/bookscan', WORKTREE, 'allow'],
  ['psql postgres://user:pw@localhost:54499/bookscan', WORKTREE, 'allow'],
  ['curl http://localhost:15433/api/books', WORKTREE, 'allow'],
  ['curl http://localhost:54330/api/books', WORKTREE, 'allow'],
  ['git log --oneline origin/master', WORKTREE, 'allow'],
  ['echo "the sort is stable"', WORKTREE, 'allow'],
  ['npm run build', WORKTREE, 'allow'],
  // The repo's own name, which is a prefix of the stable checkout's.
  [`cd ${MAIN} && npm test`, WORKTREE, 'allow'],

  ['', WORKTREE, 'allow'],
]

let failed = 0
for (const [command, cwd, expected] of cases) {
  const actual = verdict(command, cwd) === null ? 'allow' : 'deny'
  if (actual !== expected) {
    failed++
    console.error(`FAIL  expected ${expected}, got ${actual}:  ${JSON.stringify(command)} in ${cwd || '(no cwd)'}`)
  }
}

function refuses(cwd) {
  try {
    inAgentWorktree(cwd)
    return false
  } catch {
    return true
  }
}

const helpers = [
  [inAgentWorktree(WORKTREE), true, 'an agent worktree'],
  [inAgentWorktree(`${MAIN}/.CLAUDE/Worktrees/a`), true, 'casing'],
  [inAgentWorktree(MAIN), false, 'main checkout'],
  [refuses(''), true, 'an empty cwd is refused'],
  [refuses(undefined), true, 'an absent cwd is refused'],
  [refuses('scripts'), true, 'a relative path is refused'],
  [refuses('.claude/worktrees/agent-x'), true, 'a relative path that looks right is refused too'],
  [argumentsOf('run # book-scan-live-pg').includes('book-scan-live-pg'), false, 'comment stripped'],
  [argumentsOf('docker stop "book-scan-live-pg"').includes('book-scan-live-pg'), true, 'quotes flattened'],
]

if (process.platform === 'win32') {
  helpers.push([
    inAgentWorktree('C:\\Users\\Blake\\source\\repos\\book-scan\\.claude\\worktrees\\a'),
    true,
    'backslashes',
  ])
} else {
  helpers.push([
    refuses('C:/Users/Blake/source/repos/book-scan'),
    true,
    'a Windows path is not an absolute path here, and is refused rather than resolved',
  ])
}

// A hook that exits non-zero with nothing on stdout is reported as an error and
// the command then runs, so an uncaught exception would be an allow. That path
// cannot be reached by importing, so these spawn the guard.
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
  // `undefined` here leaves the field out of the JSON altogether, which is the
  // payload shape under test and which an import cannot produce.
  [
    decidesAtTheBoundary('docker stop book-scan-live-pg', undefined),
    true,
    'a payload with no cwd field denies instead of allowing everything',
  ],
  // The checkout is asked about before the command is read, so a payload with
  // no `cwd` refuses ordinary work too.
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

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
import { verdict, argumentsOf, inAgentWorktree } from './guard-live-data.mjs'

const WORKTREE = 'C:/Users/Blake/source/repos/book-scan/.claude/worktrees/agent-abc123'
const MAIN = 'C:/Users/Blake/source/repos/book-scan'

const cases = [
  // --- The live catalogue, named from an agent worktree: denied. ---
  ['docker exec -it book-scan-live-pg psql -U postgres bookscan', WORKTREE, 'deny'],
  ['docker stop book-scan-live-pg', WORKTREE, 'deny'],
  ['docker volume rm book-scan-live-pgdata', WORKTREE, 'deny'],
  ['psql postgres://user:pw@127.0.0.1:5433/bookscan -c "select count(*) from books"', WORKTREE, 'deny'],
  ['psql postgres://user:pw@localhost:5433/bookscan', WORKTREE, 'deny'],
  ['cd C:/Users/Blake/source/repos/book-scan-stable && git pull', WORKTREE, 'deny'],
  ['pwsh -File scripts/backup-catalogue.ps1', WORKTREE, 'deny'],
  ['pwsh -File scripts/install-backup-task.ps1', WORKTREE, 'deny'],
  ['pwsh -File scripts/write-connection-file.ps1', WORKTREE, 'deny'],

  // --- The same commands from the main checkout: allowed. ---
  // The orchestrator deploys to stable and takes the backups, and answers for
  // both. This guard is about who is running the command, not about the words.
  ['docker exec -it book-scan-live-pg psql -U postgres bookscan', MAIN, 'allow'],
  ['pwsh -File scripts/backup-catalogue.ps1', MAIN, 'allow'],
  ['cd C:/Users/Blake/source/repos/book-scan-stable && git pull', MAIN, 'allow'],

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
  ['cd C:/Users/Blake/source/repos/book-scan && npm test', WORKTREE, 'allow'],

  // --- No command, or no directory: nothing to say. ---
  ['', WORKTREE, 'allow'],
  ['docker stop book-scan-live-pg', '', 'allow'],
]

let failed = 0
for (const [command, cwd, expected] of cases) {
  const actual = verdict(command, cwd) === null ? 'allow' : 'deny'
  if (actual !== expected) {
    failed++
    console.error(`FAIL  expected ${expected}, got ${actual}:  ${JSON.stringify(command)} in ${cwd || '(no cwd)'}`)
  }
}

// The two helpers, checked directly because each has one job that is easy to
// get subtly wrong and hard to see failing through `verdict` alone.
const helpers = [
  [inAgentWorktree('C:\\Users\\Blake\\source\\repos\\book-scan\\.claude\\worktrees\\a'), true, 'backslashes'],
  [inAgentWorktree('C:/Users/Blake/source/repos/book-scan/.CLAUDE/Worktrees/a'), true, 'casing'],
  [inAgentWorktree(MAIN), false, 'main checkout'],
  [inAgentWorktree(''), false, 'no cwd'],
  [argumentsOf('run # book-scan-live-pg').includes('book-scan-live-pg'), false, 'comment stripped'],
  [argumentsOf('docker stop "book-scan-live-pg"').includes('book-scan-live-pg'), true, 'quotes flattened'],
]
for (const [actual, expected, name] of helpers) {
  if (actual !== expected) {
    failed++
    console.error(`FAIL  helper ${name}: expected ${expected}, got ${actual}`)
  }
}

const total = cases.length + helpers.length
if (failed > 0) {
  console.error(`\n${failed} of ${total} cases behaved wrongly.`)
  process.exit(1)
}

console.log(`guard-live-data: ${total} cases behaved as expected.`)

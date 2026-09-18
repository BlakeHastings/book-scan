// PreToolUse guard: an agent in a worktree cannot reach the live catalogue.
//
// The checkout decides who is gated, not a flag anybody could pass: an agent is
// a session whose working directory is inside `.claude/worktrees/`, and the
// orchestrator, which deploys `stable` and takes the backups, is not gated here
// at all.
//
// Every pattern below names something with no innocent meaning in this
// repository, and prose about the live system is deliberately allowed through.
//
// What it does not cover. Any session the harness did not load it into at
// startup, and everything that session spawns while it lives. A human at a
// terminal. Anything reaching the database by a route one command line does not
// name: a connection assembled from a variable, a script file the command merely
// names, a compiled binary, a tool that is not a shell. A worktree made outside
// `.claude/worktrees/` is not recognised as an agent's and passes through
// silently. Nothing here notices afterwards that a row changed.
import { isAbsolute, resolve } from 'node:path'

const LIVE = [
  { pattern: /book-scan-live-pgdata\b/, what: "the live catalogue's data volume" },
  { pattern: /book-scan-live-pg\b/, what: 'the container the live catalogue runs in' },
  { pattern: /(?:^|[^\w.:])127\.0\.0\.1:5433\b/, what: "the live catalogue's address" },
  { pattern: /(?:^|[^\w.:])localhost:5433\b/, what: "the live catalogue's address" },
  { pattern: /book-scan-stable\b/, what: 'the checkout that serves `stable`' },
  { pattern: /backup-catalogue\b/, what: 'the catalogue backup' },
  { pattern: /install-backup-task\b/, what: 'the backup schedule' },
  { pattern: /write-connection-file\b/, what: 'the file holding the live connection' },
]

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  )
  process.exit(0)
}

/**
 * Whether the command is running inside an agent's worktree.
 *
 * `.claude/worktrees/` is where the harness puts an isolated worktree, so a
 * command under one is an agent's and a command anywhere else is the
 * orchestrator's or a person's. Normalised so separators and casing cannot
 * decide it.
 *
 * A missing or relative `cwd` throws rather than answering. `false` is how this
 * function says "the orchestrator at the main checkout", so it cannot also mean
 * "could not tell"; and `resolve` on a relative path prepends the directory this
 * process happens to stand in, which from inside a worktree turns every relative
 * path into "yes, an agent". `resolve` stays for an absolute path that is merely
 * unnormalised, which it never completes from `process.cwd()`.
 *
 * Throwing is only safe because the hook boundary below turns a throw into a
 * denial.
 */
export function inAgentWorktree(cwd) {
  if (!cwd) {
    throw new TypeError(
      'inAgentWorktree needs the directory the command runs in, and the payload carried none. '
      + 'Every hook event this harness sends declares `cwd` as required.',
    )
  }
  if (!isAbsolute(cwd)) {
    throw new TypeError(
      `inAgentWorktree needs a path that is absolute on this machine, and was given ${JSON.stringify(cwd)}.`,
    )
  }
  return resolve(cwd).replace(/\\/g, '/').toLowerCase().includes('/.claude/worktrees/')
}

/**
 * The command with its own prose removed and its quotes flattened.
 *
 * Everything after a `#` is a shell comment and cannot reach a database, and a
 * heredoc body is a document rather than a command.
 */
export function argumentsOf(command) {
  const withoutHeredoc = command.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?^\s*\1/gm, ' ')
  const withoutComments = withoutHeredoc.replace(/#[^\n]*/g, ' ')
  const withoutProse = withoutComments.replace(PROSE_FLAG, ' ')
  return withoutProse.replace(/["']/g, ' ').replace(/\s+/g, ' ')
}

/**
 * The flags whose value is a document rather than an instruction: a commit
 * message, a pull request body, an issue title. The value is dropped before
 * matching; the flag itself stays, so nothing about the command's shape is lost.
 */
const PROSE_FLAG = /(?:^|\s)(?:-m|--message|-b|--body|--body-file|--title|-F)(?:=|\s+)(?:"[^"]*"|'[^']*'|\S+)/g

export function refusal(what) {
  return `Blocked: this command names ${what}, and you are working in an agent\n`
    + 'worktree.\n\n'
    + "The catalogue is somebody's real collection, and re-scanning it means\n"
    + 'handling every book again in front of a camera. `AGENTS.md` puts it in one\n'
    + 'line: agents have no permission there at all. It is the orchestrator\'s,\n'
    + 'and the orchestrator answers for it.\n\n'
    + 'Your worktree provisions its own Postgres. Everything you need to reach it\n'
    + "is in the api resource's environment, which `aspire describe` will show\n"
    + 'you. You do not need a connection string from anybody.\n\n'
    + 'If you believe this task genuinely requires the live system, stop and say\n'
    + 'so in your report rather than working around this. That is the owner\'s\n'
    + 'decision, not yours and not the orchestrator\'s.'
}

/** The verdict for one command run from one directory, or null to allow. */
export function verdict(command, cwd) {
  if (!command.trim()) return null
  if (!inAgentWorktree(cwd)) return null

  const args = argumentsOf(command)

  if (/guard-live-data\.mjs/.test(args) && /--probe\b/.test(args)) {
    return 'The live-data guard is loaded in this process, which is what you asked.\n\n'
      + 'You are inside an agent worktree, so commands naming the live catalogue,\n'
      + 'the stable checkout, or the backup scripts are refused.'
  }

  for (const { pattern, what } of LIVE) {
    if (pattern.test(args)) return refusal(what)
  }

  return null
}

// Run as a hook only when this file is the entry point, so the test can import
// the decision without the module waiting on a stdin nobody is writing to.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || process.argv[1]?.endsWith('guard-live-data.mjs')) {
  if (process.argv.includes('--probe')) {
    // Being refused is the answer: from a worktree the rule above denies this
    // line by name, so this text printing there means the guard is not loaded.
    console.log('guard-live-data: not refused here.')
    console.log('')
    console.log('From the main checkout that is correct: the orchestrator is not gated.')
    console.log('From inside .claude/worktrees/ it means the hook is not loaded in this')
    console.log('process, and an agent could reach the live catalogue.')
    process.exit(0)
  }

  let payload = ''
  for await (const chunk of process.stdin) payload += chunk

  let parsed
  try {
    parsed = JSON.parse(payload)
  } catch {
    process.exit(0) // An unparseable payload is not this guard's problem.
  }

  // A hook that throws is a hook that allows: it exits non-zero with nothing on
  // stdout, and the harness reports an error beside the tool call and then runs
  // the command anyway. So the throw from `inAgentWorktree` has to be caught
  // here and turned into a denial.
  let said
  try {
    said = verdict(parsed?.tool_input?.command ?? '', parsed?.cwd)
  } catch (error) {
    deny(
      'Blocked: this guard could not work out which checkout the command runs in,\n'
      + 'so it refused rather than guessed.\n\n'
      + `${error.message}\n\n`
      + 'That is a defect in whatever produced this hook payload rather than in the\n'
      + 'command. Say so in your report rather than working around it.',
    )
  }
  if (said) deny(said)
  process.exit(0)
}

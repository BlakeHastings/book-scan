// PreToolUse guard: an agent in a worktree cannot reach the live catalogue.
//
// WHAT THIS PREVENTS
// `AGENTS.md` says it in one line — "Agents still have no permission here at
// all" — and until now that sentence was the entire control. An implementation
// agent runs unattended with the same shell the orchestrator has, and the only
// thing between it and somebody's real collection was whether it read a 63,000
// character file and remembered one section of it.
//
// That is not a hypothetical worry about a careless agent. On 2026-08-24 an
// agent working #430 stopped and asked the orchestrator for a database
// connection string, having made zero tool calls first. It wanted a database
// and went looking to be handed one. It did not find the live one. Nothing in
// the machine would have stopped it if it had.
//
// The catalogue is the thing this project exists to protect. Re-scanning it
// means physically handling every book again, one at a time, in front of a
// camera. A backup makes that recoverable, not cheap.
//
// WHY THE CHECKOUT DECIDES, AND NOT A FLAG
// The rule in `AGENTS.md` is not "nobody may touch the live catalogue". The
// orchestrator may: it deploys to `stable`, it takes backups, and it answers
// for both. The rule is that *agents* may not, and an agent is exactly a
// session whose working directory is inside `.claude/worktrees/`.
//
// So this reads the directory the command runs in, which is a fact about who is
// running it, rather than a flag anybody could pass. `guard-merge.mjs` already
// established that shape for the branch question (#293).
//
// The orchestrator is not gated here at all. That is deliberate, and it is the
// same division `AGENTS.md` draws.
//
// WHAT THIS DOES NOT COVER
// Any session the harness did not load it into at startup, and everything that
// process spawns while it lives. A human at a terminal. Anything reaching the
// database by a route this cannot read: a connection assembled from a variable,
// a script file the command merely names, a compiled binary, or a tool that is
// not a shell at all. It reads one command line and no more.
//
// **And it believes an agent lives under `/.claude/worktrees/`.** That is where
// this harness puts them, and it is the whole of how `inAgentWorktree` decides.
// A worktree made anywhere else — by hand, by a different harness, or by a
// future version of this one — is not recognised as an agent's and passes
// straight through, silently. Silence is the exact state this file exists to
// end, so it is named here rather than discovered later.
//
// **It is prevention with no detection behind it, which by this project's own
// standard is half a layer.** Nothing here notices afterwards that a row
// changed. `docs/backup-runbook.md` is what makes such a change survivable; it
// is not what makes it visible. That gap is real and is written down rather
// than papered over.
//
// A GUARD THAT DENIES TOO MUCH GETS SWITCHED OFF
// `guard-merge.test.mjs` says it best, having shipped two false denials to earn
// it: "A guard that denies too little has a gap; a guard that denies too much
// gets switched off, which is every gap at once." A third arrived on 2026-08-24
// when that guard refused a `gh pr create` because the pull request *body*
// quoted the command it denies (#444).
//
// So every pattern below names something with no innocent meaning in this
// repository, and prose about the live system is deliberately allowed through.
// An agent writing "do not touch book-scan-live-pg" in a comment is not
// touching it. That is why comments and heredoc bodies are stripped before
// matching, and why the test file has more allow cases than deny cases.
import { resolve } from 'node:path'

/**
 * The live system, in the terms `AGENTS.md` uses for it: the container and its
 * volume, the address it is bound to, the checkout that serves `stable`, and
 * the scripts holding its credentials.
 */
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
 */
export function inAgentWorktree(cwd) {
  if (!cwd) return false
  return resolve(cwd).replace(/\\/g, '/').toLowerCase().includes('/.claude/worktrees/')
}

/**
 * The command with its own prose removed and its quotes flattened.
 *
 * Everything after a `#` is a shell comment and cannot reach a database, and a
 * heredoc body is a document rather than a command. #444 is what both of those
 * clauses are for: that guard denied the writing of a document because of what
 * the document said.
 */
export function argumentsOf(command) {
  const withoutHeredoc = command.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?^\s*\1/gm, ' ')
  const withoutComments = withoutHeredoc.replace(/#[^\n]*/g, ' ')
  const withoutProse = withoutComments.replace(PROSE_FLAG, ' ')
  return withoutProse.replace(/["']/g, ' ').replace(/\s+/g, ' ')
}

/**
 * The flags whose value is a document rather than an instruction.
 *
 * A commit message, a pull request body, an issue title. Writing one of these
 * about the live catalogue is the ordinary way to explain the rule, and denying
 * it is #444 exactly: that guard blocked `gh pr create` because the body it was
 * carrying quoted the command the guard denies. The value is dropped before
 * matching; the flag itself stays, so nothing about the command's shape is lost.
 */
const PROSE_FLAG = /(?:^|\s)(?:-m|--message|-b|--body|--body-file|--title|-F)(?:=|\s+)(?:"[^"]*"|'[^']*'|\S+)/g

/** The refusal, given the thing the command named. */
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
    // Being refused is the answer. From a worktree the rule above denies this
    // line by name, so an agent that sees this text printed knows the guard is
    // not loaded in its process. From the main checkout it prints, because the
    // orchestrator is not gated — which is also the answer.
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

  const said = verdict(parsed?.tool_input?.command ?? '', parsed?.cwd)
  if (said) deny(said)
  process.exit(0)
}

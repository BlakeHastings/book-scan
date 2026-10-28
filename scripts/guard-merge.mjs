// PreToolUse guard: nothing reaches `master` except through
// `node scripts/merge-pr.mjs <n>`.
//
// Every rule reads the program a segment invokes and that program's own
// arguments, never the text of the line, so the blocked command quoted in a
// `--body`, a heredoc, an `echo` or a branch name is cargo and is allowed.
//
// It refuses only what reaches this repository, which is the one this file was
// checked out from: every worktree of it, since they share one git directory,
// and any checkout or URL naming one of its remotes, since that is another
// clone. Where a command lands decides it, not where it stands, so `-C`,
// `--git-dir`, `GIT_DIR`, `--repo`, `GH_REPO` and a URL all count. Anything it
// cannot place, including a payload with no working directory, is treated as
// this repository's. Master in another repository is not its business.
//
// What it does not cover. Any session the harness did not load it into at
// startup, and everything that session spawns while it lives. A merge assembled
// from a variable, a base64 `-EncodedCommand`, or a script file the command
// merely names. A command that runs another command (`sudo`, `env`, `command`,
// `nohup`, `xargs` and the rest of an open-ended set), left allowed on purpose,
// which includes `env GH_REPO=...` in front of a merge from another checkout.
// Shell state set by an earlier tool call, such as an exported `GH_REPO`.
// `git push --all` and `git push --mirror`, which write master without naming
// it. `scripts/check-main-provenance.mjs` is the layer that notices afterwards.
//
// To ask whether the guard is loaded in this process:
//
//   node scripts/guard-merge.mjs --probe
//
// Being refused is the answer you want. The probe printing its own output means
// nothing intercepted it. Settings are read once at CLI startup, so a process
// that began before the hook did never has it.
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_BRANCH = 'master'

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

// BEGIN command reader
//
// A verbatim copy of the `orchestrated-delivery` skill's `assets/guard-merge.mjs`
// as far as END, kept unchanged so the two can be diffed. The rules underneath
// are this repository's own.

// Characters that end one command and begin another when they are not inside
// quotes. A closing `)` is handled separately, because it also restores the
// quote that `$(` interrupted.
const OPERATORS = new Set(['&', '|', ';', '\n', '\r', '(', '`'])

const ESCAPABLE = new Set([...OPERATORS, ')', '"', "'", '\\', '$', ' ', '\t'])

// Split a command line into the commands it will actually run, each one
// tokenised.
//
// Quotes come off the tokens, because `gh pr "merge" 42` has to read the same as
// the bare form, but they still decide structure: an operator inside a quoted
// argument is that argument's text, not the start of a new command.
//
// `literalQuote` demotes one quote character to ordinary text. See the caller.
function parse(line, literalQuote) {
  const segments = []
  let tokens = []
  let token = ''
  let quote = null
  let heredoc = null
  // The quote context each open `$(` interrupted, so that the text after the
  // closing bracket goes back to being that argument's contents.
  const resume = []

  const endToken = () => {
    if (token !== '') tokens.push(token)
    token = ''
  }
  const endSegment = () => {
    endToken()
    if (tokens.length > 0) segments.push(tokens)
    tokens = []
  }

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const opensSubstitution = char === '$' && line[i + 1] === '('

    // `$(...)` runs its contents as a command inside double quotes too, so it
    // interrupts the argument it sits in. A backtick is deliberately not treated
    // the same way, even though a shell would expand it, because markdown writes
    // code spans with backticks.
    if (opensSubstitution && quote !== "'") {
      endSegment()
      resume.push(quote)
      quote = null
      i += 1
      continue
    }
    // A `)` ends a command whether or not this parser saw the thing that opened
    // one, or `(cd repo && gh pr merge)` presents a command named `merge)`.
    // Restoring the interrupted quote stays conditional: only `$(` interrupts one.
    if (char === ')' && quote === null) {
      endSegment()
      if (resume.length > 0) quote = resume.pop()
      continue
    }

    if (quote !== null) {
      if (quote === '"' && char === '\\' && '"\\$`'.includes(line[i + 1])) {
        token += line[i + 1]
        i += 1
      } else if (char === quote) {
        quote = null
      } else {
        token += char
      }
      continue
    }

    // A heredoc body is data the shell hands to a command, not commands.
    if (char === '<' && line[i + 1] === '<') {
      const delimiter = heredocDelimiter(line, i + 2)
      if (delimiter !== null) {
        heredoc = delimiter.word
        i = delimiter.end - 1
        continue
      }
    }

    if (char === '\n' && heredoc !== null) {
      endSegment()
      i = endOfHeredoc(line, i + 1, heredoc) - 1
      heredoc = null
      continue
    }

    // A backslash escapes the next character only when that character is one the
    // shell would otherwise act on. Escaping everything mangles Windows paths.
    if (char === '\\' && ESCAPABLE.has(line[i + 1])) {
      token += line[i + 1]
      i += 1
      continue
    }
    if ((char === '"' || char === "'") && char !== literalQuote) {
      quote = char
      continue
    }
    if (OPERATORS.has(char)) {
      endSegment()
      continue
    }
    if (char === ' ' || char === '\t') {
      endToken()
      continue
    }
    token += char
  }

  endSegment()
  return { segments, unterminated: quote ?? resume.find((open) => open !== null) ?? null }
}

// The word after `<<` or `<<-`, with any quoting removed. Null when what follows
// is not a heredoc, which includes `<<` used as anything else.
function heredocDelimiter(line, from) {
  let i = from
  if (line[i] === '-') i += 1
  while (line[i] === ' ' || line[i] === '\t') i += 1

  let word = ''
  let quote = null
  while (i < line.length && (quote !== null || !/[\s;&|<>()]/.test(line[i]))) {
    const char = line[i]
    if (quote === null && (char === '"' || char === "'")) quote = char
    else if (char === quote) quote = null
    else word += char
    i += 1
  }
  return word === '' ? null : { word, end: i }
}

// The index of the newline that ends the terminator line, or the end of the
// string when the heredoc is never closed.
function endOfHeredoc(line, from, delimiter) {
  let i = from
  for (;;) {
    const eol = line.indexOf('\n', i)
    const text = line.slice(i, eol === -1 ? line.length : eol)
    if (text.trim() === delimiter || eol === -1) return eol === -1 ? line.length : eol
    i = eol + 1
  }
}

// Words that stand in front of a command without being one, so the command is
// whatever follows them.
//
// Only shell reserved words that take no arguments of their own belong here,
// which is what makes stripping them blindly safe. Wrapper commands are not
// those and are left alone. Matching is by whole token, so a brace that is part
// of a word survives: `gh api repos/{owner}/{repo}/pulls/1/merge` is one token.
const LEADING_WORDS = new Set(['{', '!', 'then', 'else', 'elif', 'do', 'time'])

// A variable binding stands in front of a command the same way, so without this
// `GH_TOKEN=x gh pr merge 42` presents a command named `GH_TOKEN=x` and every
// rule looks past it.
//
// The name must be a valid shell identifier, which is what tells an assignment
// from an argument that merely contains `=`: `--field key=value` and a Windows
// path are not assignments, and neither is `=x`, which a shell reads as a
// command name. Only a leading token is examined.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

function withoutLeadingWords(tokens) {
  let at = 0
  while (at < tokens.length && (LEADING_WORDS.has(tokens[at]) || ASSIGNMENT.test(tokens[at]))) {
    at += 1
  }
  return tokens.slice(at)
}

// END command reader
//
// The reader's `segmentsOf` is replaced by `commandsOf` below, because the scope
// rules also need the bindings it drops.

// Each command the line runs, with the `NAME=value` bindings written in front of
// it. `GIT_DIR=... git push` and `GH_REPO=... gh pr merge` land wherever the
// binding says, not where the command stands.
function commandsOf(line) {
  const first = parse(line, null)
  // An apostrophe in ordinary text opens a quote that never closes, and every
  // operator after it would read as that argument's contents, including a real
  // chained merge. A quote with no partner is text, so read it that way.
  const parsed = first.unterminated === null ? first : parse(line, first.unterminated)
  return parsed.segments
    .map((raw) => {
      const tokens = withoutLeadingWords(raw)
      return { tokens, bindings: bindingsIn(raw.slice(0, raw.length - tokens.length)) }
    })
    .filter(({ tokens }) => tokens.length > 0)
}

function bindingsIn(tokens) {
  const bindings = {}
  for (const token of tokens) {
    if (!ASSIGNMENT.test(token)) continue
    const equals = token.indexOf('=')
    bindings[token.slice(0, equals)] = token.slice(equals + 1)
  }
  return bindings
}

const commandName = (token) =>
  token
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/\.exe$/, '')

// Either shell tool can invoke the other, so `pwsh -Command "gh pr merge 42"`
// from a Bash tool call carries a command line that has to be read as one.
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'pwsh', 'powershell', 'cmd'])
const SHELL_COMMAND_FLAGS = new Set(['-c', '-Command', '-command', '/c', '/C'])

function shellPayload(tokens) {
  if (!SHELLS.has(commandName(tokens[0]))) return null
  const at = tokens.findIndex((token) => SHELL_COMMAND_FLAGS.has(token))
  return at === -1 ? null : (tokens[at + 1] ?? null)
}

// `node <anything>/guard-merge.mjs --probe`, however the path is written.
function isLivenessProbe(tokens) {
  if (commandName(tokens[0]) !== 'node') return false
  if (!tokens.includes('--probe')) return false
  const script = tokens.slice(1).find((token) => !token.startsWith('-'))
  return script !== undefined && commandName(script) === 'guard-merge.mjs'
}

const USE_WRAPPER =
  'Push your branch, open the PR, report back, and stop. The orchestrator\n' +
  'reviews and merges with:\n\n' +
  '  node scripts/merge-pr.mjs <pr-number>\n\n' +
  'It refuses unless every required check is green, and always squash merges.\n' +
  'See docs/process/working-an-issue.md.'

// `gh` takes its global flags before the subcommand and no positional argument
// there, so skipping the flags lands on the subcommand path. Null when this
// segment does not invoke `gh` at all. Reading tokens 1 and 2 instead is a hole:
// `gh --repo o/r pr merge 42` is a working merge with a flag in the way.
const GH_FLAGS_WITH_VALUE = new Set(['--repo', '-R', '--hostname'])

function ghArguments(tokens) {
  if (commandName(tokens[0]) !== 'gh') return null
  let at = 1
  while (at < tokens.length && tokens[at].startsWith('-')) {
    at += GH_FLAGS_WITH_VALUE.has(tokens[at]) ? 2 : 1
  }
  return tokens.slice(at)
}

// `git` takes its own flags before the subcommand, and several of them swallow
// the next token. Null when this segment does not invoke git. The flags are kept,
// because `-C`, `--git-dir` and `-c url.<base>.insteadOf=` all change which
// repository the command reaches.
const GIT_FLAGS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--exec-path'])

function gitInvocation(tokens) {
  if (commandName(tokens[0]) !== 'git') return null
  let at = 1
  while (at < tokens.length && tokens[at].startsWith('-')) {
    at += GIT_FLAGS_WITH_VALUE.has(tokens[at]) ? 2 : 1
  }
  return { options: tokens.slice(1, at), args: tokens.slice(at) }
}

// `gh api` takes exactly one endpoint and everything else it is handed is
// payload, including `-f body=...`, which routinely contains the word merge.
//
// Which token the endpoint is has to be worked out without a table of gh's
// flags: it is the first argument that is not a flag, is not the value of one,
// and looks like a path. `--method PUT` is skipped by the second of those and
// `PUT` by the third.
function apiEndpoint(args) {
  for (let at = 0; at < args.length; at += 1) {
    if (args[at].startsWith('-')) continue
    if (at > 0 && args[at - 1].startsWith('-')) continue
    if (args[at].includes('/')) return args[at]
  }
  return null
}

const isMergeEndpoint = (endpoint) => /\/(merge|merges)(\/|$)/.test(endpoint)

// Where a refspec lands. `src:dst` writes `dst`, a bare ref writes the same name
// at the far end, `:dst` deletes `dst`, and a leading `+` is force and says
// nothing about where it goes.
function pushDestination(refspec) {
  const colon = refspec.lastIndexOf(':')
  const destination = colon === -1 ? refspec : refspec.slice(colon + 1)
  return destination.replace(/^\+/, '').replace(/^refs\/heads\//, '')
}

// The first positional names the remote, so `git push master` is a push to a
// remote called `master` and not a push to master. Everything after it is a
// refspec. A flag's value can be mistaken for one, which allows rather than
// denies, and that is the safe direction.
function pushesToDefaultBranch(args) {
  const positional = args.filter((token) => !token.startsWith('-'))
  return positional.slice(1).some((refspec) => pushDestination(refspec) === DEFAULT_BRANCH)
}

// `--delete master`, `-d master` and `:master` all remove the remote's master
// rather than writing to it. Still refused here, with its own reason.
function deletesDefaultBranch(args) {
  const deleting = args.includes('--delete') || args.includes('-d')
  const positional = args.filter((token) => !token.startsWith('-'))
  return positional
    .slice(1)
    .some(
      (refspec) =>
        pushDestination(refspec) === DEFAULT_BRANCH &&
        (deleting || refspec.replace(/^\+/, '').startsWith(':')),
    )
}

// A dry run contacts the remote and changes nothing.
//
// `-n` is matched as a whole token, so a bundled cluster such as `git push -nq`
// stays denied. Do not widen the match to any cluster containing `n`: `-on` is
// `-o n`, a push option named `n`, and reading it as a dry run would allow a
// real push to master.
const isDryRun = (args) => args.includes('--dry-run') || args.includes('-n')

// A push with no refspec inherits its destination from the branch under it, so
// the command line does not say where it lands and the branch has to.
const hasExplicitDestination = (args) =>
  args.filter((token) => !token.startsWith('-')).length >= 2

// `git merge --ff-only origin/master` moves the branch to a commit the remote
// already has, which by definition went through a pull request.
//
// `--ff-only` alone is not enough: a fast-forward from a local branch would land
// unreviewed commits, so the ref has to name a remote.
const isFastForwardFromRemote = (args) =>
  args.includes('--ff-only') &&
  args.some((token) => !token.startsWith('-') && /^[\w.-]+\/[\w./-]+$/.test(token))

// These act on a merge that is already halfway through and land nothing new.
const RESOLVES_A_MERGE = new Set(['--abort', '--continue', '--quit'])
const resolvesAMerge = (args) => args.some((token) => RESOLVES_A_MERGE.has(token))

// Where a command stands: the directory it runs in, the git flags it was given,
// the environment it runs with, and whether something earlier on the line has
// repointed a remote. A null directory is a command the guard cannot place, and
// every question asked of it answers in the refusing direction.

// Variables that would point a query about some other path back at the
// repository the hook or the command happens to sit in.
const LOCATING = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']

function git(place, args) {
  if (place.directory === null) return null
  try {
    return execFileSync('git', [...place.options, ...args], {
      cwd: place.directory,
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...place.environment }).filter(([, value]) => value !== undefined),
      ),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

// A path anywhere outside the command's own git flags and bindings.
const at = (directory) => {
  const environment = {}
  for (const name of LOCATING) environment[name] = undefined
  return { directory, options: [], environment }
}

// The repository's shared git directory, which every worktree of it reports
// identically and nothing else does.
function commonDirOf(place) {
  const output = git(place, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (output === null) return null
  try {
    return realpathSync(output)
  } catch {
    return null
  }
}

// What a remote URL names, spelled one way: `git@github.com:O/r.git` and
// `https://github.com/o/r` are the same repository. A local path names whatever
// repository is at that path. Null when it names nothing the guard can find.
function identityOf(url, base) {
  const schemed = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(url)
  if (schemed !== null && schemed[1].toLowerCase() !== 'file') {
    const slash = schemed[2].indexOf('/')
    return slash === -1 ? null : hostedIdentity(schemed[2].slice(0, slash), schemed[2].slice(slash + 1))
  }
  // `host:path` is scp-like syntax. One letter before the colon is a Windows
  // drive, which is a path.
  const scp = schemed === null ? /^([^/:]{2,}):(.+)$/.exec(url) : null
  if (scp !== null) return hostedIdentity(scp[1], scp[2])

  const path = schemed === null ? url : schemed[2]
  if (!isAbsolute(path) && base === null) return null
  const common = commonDirOf(at(resolve(base ?? '/', path)))
  return common === null ? null : `path:${common}`
}

function hostedIdentity(host, path) {
  const name = host.replace(/^[^@]*@/, '').replace(/:\d*$/, '')
  const repository = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
  return `${name}/${repository}`.toLowerCase()
}

// Every URL a checkout fetches from or pushes to, after git's own rewriting.
function remoteUrlsOf(place) {
  const names = git(place, ['remote'])
  if (names === null) return []
  return names
    .split('\n')
    .filter(Boolean)
    .flatMap((name) => [
      ...(git(place, ['remote', 'get-url', '--all', name]) ?? '').split('\n'),
      ...(git(place, ['remote', 'get-url', '--push', '--all', name]) ?? '').split('\n'),
    ])
    .filter(Boolean)
}

// This repository is the one the guard itself was checked out from: its shared
// git directory, which covers every worktree, and every remote it names, which
// covers another clone of it.
const GUARD_PLACE = at(dirname(fileURLToPath(import.meta.url)))
let ours

function thisRepository() {
  if (ours === undefined) {
    const common = commonDirOf(GUARD_PLACE)
    ours =
      common === null
        ? null
        : new Set([
            `path:${common}`,
            ...remoteUrlsOf(GUARD_PLACE)
              .map((url) => identityOf(url, GUARD_PLACE.directory))
              .filter((identity) => identity !== null),
          ])
  }
  return ours
}

// Each of these answers true when it cannot tell. A guard that cannot place a
// command treats it as this repository's, the same answer it gave before it
// looked at all.

const isOurs = (identity) => identity === null || thisRepository() === null || thisRepository().has(identity)

// Whether the checkout a command stands in is a checkout of this repository.
function standsInOurs(place) {
  if (place.unsettled || thisRepository() === null) return true
  const common = commonDirOf(place)
  if (common === null) return true
  if (thisRepository().has(`path:${common}`)) return true
  return remoteUrlsOf(place).some((url) => thisRepository().has(identityOf(url, base(place))))
}

// Whether `git push <destination> ...` reaches this repository. The destination
// is a remote's name or a URL, and git rewrites either before using it.
function pushReachesOurs(destination, place) {
  if (place.unsettled) return true
  const named = git(place, ['remote', 'get-url', '--push', '--all', destination])
  const urls = named !== null ? named.split('\n') : [git(place, ['ls-remote', '--get-url', destination]) ?? destination]
  return urls.some((url) => isOurs(identityOf(url, base(place))))
}

// The directory git resolves a relative path against, which `-C` moves.
function base(place) {
  let directory = place.directory
  for (let i = 0; i < place.options.length; i += 1) {
    if (place.options[i] === '-C' && directory !== null) directory = resolve(directory, place.options[i + 1] ?? '.')
  }
  return directory
}

// gh names a repository as `owner/repo`, `host/owner/repo` or a URL to it or to
// one of its pull requests.
function ghIdentity(name, environment) {
  if (name.includes('://')) {
    const url = /^[a-z]+:\/\/([^/]+)\/([^/]+)\/([^/]+)/i.exec(name)
    return url === null ? null : hostedIdentity(url[1], `${url[2]}/${url[3]}`)
  }
  const parts = name.split('/')
  if (parts.length === 2) return hostedIdentity(environment.GH_HOST ?? 'github.com', name)
  if (parts.length === 3) return hostedIdentity(parts[0], `${parts[1]}/${parts[2]}`)
  return null
}

// The repository `gh pr merge` acts on: `--repo`, then a pull request named by
// URL, then `GH_REPO`, and failing all three whatever the checkout's remotes say.
// `--repo` may come before the subcommand or after it, so it is looked for in
// the whole command.
function ghPrReachesOurs(tokens, place) {
  const named =
    flagValue(tokens.slice(1), '--repo', '-R') ??
    ghArguments(tokens)
      .slice(2)
      .find((token) => token.includes('://'))
  const repository = named ?? place.environment.GH_REPO ?? process.env.GH_REPO
  return repository === undefined ? standsInOurs(place) : isOurs(ghIdentity(repository, place.environment))
}

// `gh api repos/owner/repo/...` names its repository outright. `{owner}/{repo}`
// is filled from `GH_REPO` or the checkout.
function ghApiReachesOurs(endpoint, place) {
  const named = /^\/?repos\/([^/{}]+)\/([^/{}]+)\//.exec(endpoint)
  if (named !== null) return isOurs(hostedIdentity(place.environment.GH_HOST ?? 'github.com', `${named[1]}/${named[2]}`))
  const repository = place.environment.GH_REPO ?? process.env.GH_REPO
  return repository === undefined ? standsInOurs(place) : isOurs(ghIdentity(repository, place.environment))
}

function flagValue(args, long, short) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === long || args[i] === short) return args[i + 1]
    if (args[i].startsWith(`${long}=`)) return args[i].slice(long.length + 1)
    if (args[i].startsWith(short) && args[i].length > short.length) return args[i].slice(short.length)
  }
  return undefined
}

// The branch a bare `git push` or a `git merge` would land on is a fact about
// where the command runs, not about the hook's own directory. Null means the
// question could not be asked, because that directory is not a git repo.
function branchIn(place) {
  return git(place, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

// A command the guard cannot place might be standing anywhere, master included.
const onDefaultBranch = (place) => place.directory === null || branchIn(place) === DEFAULT_BRANCH

// A leading `cd <dir> &&` arrives as a command of its own, in order, and the
// shell really does change to that directory before the rest of the line runs,
// so the rules below read this rather than the hook process's own directory.
function directoryOf(tokens, current) {
  if (commandName(tokens[0]) !== 'cd') return current
  // `cd /d C:\path` on Windows, and `cd -- <dir>`.
  const target = tokens.slice(1).find((token) => !token.startsWith('-') && token !== '/d')
  if (target === undefined) return current
  const expanded = target.replace(/^(~|\$HOME|\$\{HOME\})(?=$|[\\/])/, homedir())
  if (isAbsolute(expanded)) return expanded
  return current === null ? null : resolve(current, expanded)
}

// The guard asks git where a remote points before the line runs, so a line that
// repoints one first has to be answered without asking.
function repoints(tokens) {
  const invocation = gitInvocation(tokens)
  if (invocation !== null) {
    const [subcommand, action] = invocation.args
    return subcommand === 'config' || (subcommand === 'remote' && ['add', 'set-url', 'rename'].includes(action))
  }
  const gh = ghArguments(tokens)
  return gh !== null && gh[0] === 'repo' && gh[1] === 'set-default'
}

function judge(line, depth, cwd, inherited = {}, unsettledBefore = false) {
  let directory = cwd
  const exported = { ...inherited }
  let unsettled = unsettledBefore
  for (const { tokens, bindings } of commandsOf(line)) {
    directory = directoryOf(tokens, directory)
    if (commandName(tokens[0]) === 'export') Object.assign(exported, bindingsIn(tokens.slice(1)))
    const environment = { ...exported, ...bindings }
    const place = { directory, options: [], environment, unsettled }
    unsettled ||= repoints(tokens)

    if (isLivenessProbe(tokens)) {
      deny(
        'The merge guard is loaded in this process. This probe was refused before it\n' +
          'ran, and being refused is the answer it exists to produce. Nothing is wrong.\n\n' +
          'A status update can now say the guard is loaded rather than configured.',
      )
    }

    const gh = ghArguments(tokens)
    if (gh !== null && gh[0] === 'pr' && gh[1] === 'merge' && ghPrReachesOurs(tokens, place)) {
      deny(
        'Blocked: `gh pr merge` bypasses the green-checks requirement, and agents do\n' +
          `not land pull requests.\n\n${USE_WRAPPER}`,
      )
    }
    const endpoint = gh !== null && gh[0] === 'api' ? apiEndpoint(gh.slice(1)) : null
    if (endpoint !== null && isMergeEndpoint(endpoint) && ghApiReachesOurs(endpoint, place)) {
      deny(`Blocked: merging through \`gh api\` is still merging.\n\n${USE_WRAPPER}`)
    }

    const invocation = gitInvocation(tokens)
    const gitPlace = invocation === null ? place : { ...place, options: invocation.options }
    const subcommand = invocation?.args[0]
    const args = invocation?.args.slice(1) ?? []

    if (subcommand === 'push' && !isDryRun(args)) {
      const destination = args.find((token) => !token.startsWith('-'))
      const reachesOurs = () =>
        destination === undefined ? standsInOurs(gitPlace) : pushReachesOurs(destination, gitPlace)

      if (deletesDefaultBranch(args) && reachesOurs()) {
        deny(
          `Blocked: this deletes ${DEFAULT_BRANCH} on the remote, which is this repository's\n` +
            `default branch. It is not deleted from a session; that is the owner's call.\n\n` +
            `Deleting any other branch is allowed:  git push origin --delete <branch>`,
        )
      }
      if (pushesToDefaultBranch(args) && reachesOurs()) {
        deny(
          `Blocked: pushing to ${DEFAULT_BRANCH} skips review and CI entirely.\n\n` +
            `Push your feature branch instead:  git push -u origin HEAD\n\n` +
            '`git push --dry-run` is allowed: it contacts the remote and changes\n' +
            `nothing. So is \`-n\`.\n\n${USE_WRAPPER}`,
        )
      }
      if (!hasExplicitDestination(args) && onDefaultBranch(gitPlace) && reachesOurs()) {
        deny(
          `Blocked: you are on ${DEFAULT_BRANCH} and this push names no destination, so\n` +
            `it would put code on the default branch without a pull request.\n\n` +
            `Create a branch first:  git checkout -b <area>/<issue>-<slug>\n\n${USE_WRAPPER}`,
        )
      }
    }

    if (
      subcommand === 'merge' &&
      !isFastForwardFromRemote(args) &&
      !resolvesAMerge(args) &&
      onDefaultBranch(gitPlace) &&
      standsInOurs(gitPlace)
    ) {
      deny(
        `Blocked: you are on ${DEFAULT_BRANCH}, so this would put commits on the default\n` +
          `branch without a pull request.\n\n` +
          `\`git merge --ff-only origin/${DEFAULT_BRANCH}\` is allowed: it moves the branch to a\n` +
          `commit the remote already has.\n\n${USE_WRAPPER}`,
      )
    }

    const nested = depth > 0 ? shellPayload(tokens) : null
    if (nested !== null) judge(nested, depth - 1, directory, environment, unsettled)
  }
}

// This runs only when the rule above did not fire, so reaching this code is
// itself the finding.
function probe() {
  // A script runner re-invokes its script through a shell of its own, so the
  // hook is shown `npm run <name>` and the file name it matches on is nowhere in
  // that line. The probe would then report the guard absent in a session where
  // it is loaded and fine.
  if (process.env.npm_lifecycle_event) {
    console.error('Run this directly, not through a package script:\n')
    console.error('  node scripts/guard-merge.mjs --probe\n')
    console.error('npm, pnpm and yarn all hide the file name from the hook, so the probe cannot')
    console.error('be refused, and it would report the guard absent in a session where it is')
    console.error('loaded and fine.')
    process.exit(1)
  }

  console.error('The merge guard is NOT loaded in this process.')
  console.error('')
  console.error('This probe exists in order to be refused. It ran, so nothing intercepted it:')
  console.error('either no PreToolUse hook in .claude/settings.json runs this file, or this')
  console.error('process started before the hook that does. Settings are read once, when the')
  console.error('CLI starts, so a process that began before the hook did never has it, and')
  console.error('neither does anything it spawns for as long as it lives.')
  console.error('')
  console.error('Restart the harness and ask again. Until you have seen a refusal, nothing')
  console.error('here stops an agent landing its own pull request, and only')
  console.error('`scripts/check-main-provenance.mjs` will say afterwards that one did.')
  console.error('')
  console.error('If it still prints after a restart, the hook is not wired rather than')
  console.error('unloaded, which is a different fix: `.claude/settings.json` in this')
  console.error('repository has to name this file under PreToolUse, for every shell tool')
  console.error('this harness exposes.')
  process.exit(1)
}

if (process.argv.includes('--probe')) {
  probe()
} else {
  let payload = ''
  for await (const chunk of process.stdin) payload += chunk

  let parsed
  try {
    parsed = JSON.parse(payload)
  } catch {
    process.exit(0) // Unparseable payload is not this guard's problem.
  }

  const command = parsed?.tool_input?.command ?? ''
  // The directory the command will run in, which the payload knows and the hook
  // process does not: the hook runs from the primary checkout, and an agent's
  // command runs in its worktree. Without it the command cannot be placed, and
  // the hook's own directory is not a stand-in for it.
  const cwd = typeof parsed?.cwd === 'string' && isAbsolute(parsed.cwd) ? parsed.cwd : null
  if (command.trim()) judge(command, 2, cwd)
  process.exit(0)
}

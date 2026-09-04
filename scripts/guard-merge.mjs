// PreToolUse guard: nothing reaches `master` except through the sanctioned path.
//
// WHAT THIS PREVENTS
// This used to say branch protection was unavailable on a private repo on this
// plan, so GitHub would happily accept a merge with CI red or a direct push to
// master. Both premises were false: the repository is public, and rulesets are
// free on a public repository. #540 added one, and since 2026-09-04 GitHub does
// refuse all of that at its end.
//
// That does not make this redundant, and it is worth being precise about why,
// because "the ruleset covers it" is the argument that would delete a layer
// that covers something else. Three things:
//
//   It refuses before the command runs, so nothing is attempted, nothing is
//   half-done, and the agent gets a sentence explaining the rule rather than a
//   405 from an API.
//
//   It works with no network and no GitHub. `git push origin HEAD:master` from
//   a machine that cannot reach github.com fails for the wrong reason and
//   succeeds the moment the network comes back; this refuses it either way.
//
//   It is the layer that survives the ruleset being switched off. A ruleset is
//   a setting on somebody's account, invisible in every diff, and two clicks
//   from gone. This is in the repository, and changing it is a commit.
//
// Agents run unattended, and "I was told not to" is not a control. This is one
// of the controls; `docs/process/working-an-issue.md` lists all five and what
// each one misses.
//
// It denies, before the command runs: `gh pr merge`, a merge through `gh api`,
// a `git push` whose own arguments name master as the destination, and a bare
// `git push` or a `git merge` in a checkout that is standing on master. The
// permitted route is `node scripts/merge-pr.mjs <n>`, which verifies every
// required check is green and then squash-merges. That command does not match
// anything below, and the `gh api` call it makes internally is a child process
// rather than a tool call, so the guard never sees it. Making the safe path the
// only working path beats asking nicely.
//
// WHERE THE LINE IS: A COMMAND, NOT THE TEXT IT CARRIES
// This guard used to normalise the whole command string and run regexes over
// it, so it could not tell a command from a document a command was carrying.
// On 2026-08-24 it refused a `gh pr create` because the pull request *body*
// quoted the command it denies, and then refused the heredoc writing the issue
// about that, so #444 could not be authored through the shell at all. Nothing
// was being merged either time. Recording that the guard worked was the first
// thing it refused to allow.
//
// The line this file now holds, and the one to hold when editing it:
//
//   A command is the head of a segment the shell will execute. Everything
//   else on the line is cargo.
//
// So the reader below splits the line into the commands it will actually run,
// tokenises each one, and every rule reads the *program* a segment invokes and
// that program's own arguments. It never asks what the line contains. That
// makes all of these ordinary work again, because none of them merges
// anything: a `--body` or `-m` whose text quotes the blocked command, a
// heredoc body, an argument to `echo`, a `-f body=` field posted through the
// API, a branch or endpoint whose *name* contains the word merge.
//
// Quoting still decides structure. A quote comes off a token, because
// `gh pr "merge" 42` has to read the same as the bare form, but an operator
// inside a quoted argument is that argument's text and not the start of a new
// command. Both have to stay true at once, and the old flat-string normaliser
// could not hold either.
//
// A gap lets a merge through; a false positive gets the guard switched off,
// which is every gap at once. `guard-merge.test.mjs` says it and has the
// scars: three false denials shipped before this rewrite, all of them safe
// commands. Weigh them that way when you edit this, and note that the allow
// cases in that file outnumber the deny cases on purpose.
//
// ASK IT WHETHER IT IS LOADED
// A hook is written into settings, loaded by a process at startup, and fires on
// a command. Only the third of those denies anything, and the middle one is
// invisible from inside: a gate that was never loaded is silent in exactly the
// way a gate with nothing to deny is silent. Settings are read once, when the
// CLI starts, so "configured" and "loaded" are genuinely different states and
// reading `.claude/settings.json` answers only the first.
//
// So this file answers the question by refusing it:
//
//   node scripts/guard-merge.mjs --probe
//
// Being refused is the answer you want. The rule below denies that line by
// name, so the harness prints this guard's own message and the probe never
// runs. If you see the probe's output instead, nothing intercepted it and the
// guard is not in this process. Absence is the signal, and there is no artifact
// to go stale the way a heartbeat file would.
//
// The probe is this same file rather than a second script, and that is the part
// worth keeping. A probe that is a separate file makes the answer depend on two
// files agreeing about a filename: rename either and the probe becomes a
// permanent, silent "inert". A file cannot disagree with itself about its own
// name.
//
// The refusal says only that the guard is loaded. It does not enumerate what
// the guard misses, because a probe anybody may run is not the place to publish
// the ways past the thing it is reporting on. What is not covered is written
// here, in the file, for whoever is editing the file.
//
// WHAT THIS DOES NOT COVER
// Any session the harness did not load it into at startup, and everything that
// process spawns for as long as it lives. Any human at a terminal. CI. A net,
// not a guarantee, and one whose absence is silent, which is why
// `scripts/check-main-provenance.mjs`, the layer that notices afterwards, runs
// on every push to master.
//
// It reads only what the command line says. A merge assembled from a variable,
// a base64 `-EncodedCommand`, or a script file the command merely names is
// invisible to it, and no amount of pattern work changes that.
//
// Nor does it cover a command that runs another command. Each of these is a
// working merge and each is allowed through:
//
//   sudo gh pr merge      env gh pr merge       command gh pr merge
//   nohup gh pr merge     xargs gh pr merge     time -p gh pr merge
//
// They are left open on purpose, and #444 is wrong to say this shape closes
// them. The threat model is an agent that forgot, or that talked itself into
// it, not one that is hiding, and nobody reaches for `sudo` to land a pull
// request by accident. The set of programs that can launch another program has
// no edge, so closing six of them buys a longer list rather than a closed hole,
// at the cost of this section's accuracy, which is the part of the file worth
// the most. `\gh pr merge` and `/usr/bin/gh pr merge` *are* denied, because a
// path and a backslash-escape are spelling rather than a second program.
//
// Shell *syntax* an ordinary command can contain is a different matter: it is a
// closed set, and it is covered. See LEADING_WORDS and ASSIGNMENT.
//
// `git push --all` and `git push --mirror` write every branch, including this
// one, and neither says so on the command line in a way this guard reads.
// Provenance is what catches that.
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

// This repository's default branch is `master`, not `main`.
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
// Everything between this marker and END is the command reader, taken from the
// `orchestrated-delivery` skill's `assets/guard-merge.mjs`, which is where the
// tokenised rewrite was worked out. The code is unchanged from that copy so a
// later version of it can be diffed against this one rather than re-read; the
// rules underneath are this repository's own and differ deliberately.
//
// It answers one question: which commands will this line actually run, and what
// are the tokens of each. Every rule below reads that answer, and nothing below
// reads the line's text.

// Characters that end one command and begin another when they are not inside
// quotes. A closing `)` is handled separately, because ending the command is
// only half of what it does: when a `$(` opened one, it also restores the
// quote that `$(` interrupted.
const OPERATORS = new Set(['&', '|', ';', '\n', '\r', '(', '`'])

const ESCAPABLE = new Set([...OPERATORS, ')', '"', "'", '\\', '$', ' ', '\t'])

// Split a command line into the commands it will actually run, each one
// tokenised.
//
// Quotes come off the tokens, because `gh pr "merge" 42` has to read the same
// as the bare form. Quotes still decide *structure*, though: an operator
// inside a quoted argument is that argument's text, not the start of a new
// command. Keeping both of those true at once is the whole of the fix. The old
// guard stripped quotes into a flat line and then matched patterns against it,
// so a markdown table cell reading `| gh pr merge 42 |` was indistinguishable
// from an actual merge.
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

    // `$(...)` runs its contents as a command, and it does so inside double
    // quotes as well, so it interrupts the argument it sits in. A backtick is
    // not treated the same way, even though a shell would expand it: markdown
    // writes code spans with backticks, and a body quoting the blocked command
    // is precisely the false positive this guard exists to have stopped
    // producing. That gap is named under NOT COVERED rather than pretended away.
    if (opensSubstitution && quote !== "'") {
      endSegment()
      resume.push(quote)
      quote = null
      i += 1
      continue
    }
    // A `)` ends a command whether or not this parser saw the thing that
    // opened one. Requiring an open `$(` made every other closing bracket fall
    // through to ordinary text, where it glued itself to the preceding token:
    // `(cd repo && gh pr merge)` presented a command named `merge)` and walked
    // past the rule. Restoring the interrupted quote stays conditional, because
    // only `$(` interrupts one.
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

    // A heredoc body is data the shell hands to a command, not commands. It is
    // also how an agent writes a long `--body`, which makes it the second most
    // likely place for the blocked command to appear as prose.
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

    // A backslash escapes the next character only when that character is one
    // the shell would otherwise act on. Escaping everything mangles the
    // Windows paths this hook sees constantly, and both shell tools it is
    // wired to run on Windows here.
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

// The word after `<<` or `<<-`, with any quoting removed. Returns null when
// what follows is not a heredoc, which includes `<<` used as anything else.
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
// whatever follows them. `if gh pr checks 42; then gh pr merge 42; fi` is an
// agent doing ordinary work rather than an agent hiding, and the guard has to
// see the merge inside it.
//
// The set is closed because every word in it is a shell reserved word that
// takes no arguments of its own, which is what makes stripping them blindly
// safe. Wrapper *commands* are the opposite on both counts and are named under
// NOT COVERED instead. `time` is the one that sits on the seam: it is a bash
// reserved word and also a real binary on some systems. It is here because
// both readings run the merge, so there is no wrong answer to get, and because
// timing a command is something an agent does on purpose rather than to hide.
//
// Matching is by whole token, so a brace that is part of a word is not one of
// these: `gh api repos/{owner}/{repo}/pulls/1/merge` still reads as one token
// and is still denied, and `mkdir -p docs/{process,architecture}` keeps its
// brace too.
const LEADING_WORDS = new Set(['{', '!', 'then', 'else', 'elif', 'do', 'time'])

// A variable binding stands in front of a command the same way, and it is the
// same kind of thing: shell syntax with a grammar, not a program that launches
// another program. Without this the segment presents a command named
// `GH_TOKEN=x` and every rule looks straight past it, so
// `GH_TOKEN=x gh pr merge 42` merges.
//
// The name must be a valid shell identifier, which is what tells an assignment
// from an argument that merely contains `=`. `--field key=value` and a Windows
// path are not assignments; neither is `=x`, which a shell reads as a command
// name and fails to find, so stripping it would invent a command that never
// ran. Only a leading token is examined, so `git commit -m "FOO=1"` is untouched.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

function withoutLeadingWords(tokens) {
  let at = 0
  while (at < tokens.length && (LEADING_WORDS.has(tokens[at]) || ASSIGNMENT.test(tokens[at]))) {
    at += 1
  }
  return tokens.slice(at)
}

function segmentsOf(line) {
  const first = parse(line, null)
  // An apostrophe in ordinary text opens a quote that never closes, and every
  // operator after it would read as that argument's contents, including a
  // real chained merge. A quote with no partner is text, so read it that way.
  const parsed = first.unterminated === null ? first : parse(line, first.unterminated)
  // Stripping can empty a segment, since `time` on its own is a whole command
  // and so is `FOO=1`, and every rule below reads the first token.
  return parsed.segments.map(withoutLeadingWords).filter((tokens) => tokens.length > 0)
}

// END command reader

// The program a token names, with its path and its extension taken off, so
// `/usr/bin/gh`, `C:\tools\gh.exe` and `gh` are one program.
const commandName = (token) =>
  token
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/\.exe$/, '')

// This hook is wired to every shell-capable tool the harness offers, and each
// of those shells can invoke the other one, so `pwsh -Command "gh pr merge 42"`
// from a Bash tool call is a real form rather than a contrived one. The
// argument is a command line; read it as one.
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'pwsh', 'powershell', 'cmd'])
const SHELL_COMMAND_FLAGS = new Set(['-c', '-Command', '-command', '/c', '/C'])

function shellPayload(tokens) {
  if (!SHELLS.has(commandName(tokens[0]))) return null
  const at = tokens.findIndex((token) => SHELL_COMMAND_FLAGS.has(token))
  return at === -1 ? null : (tokens[at + 1] ?? null)
}

// `node <anything>/guard-merge.mjs --probe`, however the path is written.
//
// The rule is held to the same standard as the merge rules: talking about the
// probe is not running it. A `--body` quoting the line, an `echo`, a `cat` of
// this file and a commit message about it all pass, because the reader hands
// this function the tokens of a command rather than the text of a line.
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
// there, so skipping the flags lands on the subcommand path. Returns null when
// this segment does not invoke `gh` at all.
//
// Reading tokens 1 and 2 instead is a hole rather than a shortcut:
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
// the next token. Returns the arguments from the subcommand onward, or null
// when this segment does not invoke git.
const GIT_FLAGS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--exec-path'])

function gitArguments(tokens) {
  if (commandName(tokens[0]) !== 'git') return null
  let at = 1
  while (at < tokens.length && tokens[at].startsWith('-')) {
    at += GIT_FLAGS_WITH_VALUE.has(tokens[at]) ? 2 : 1
  }
  return tokens.slice(at)
}

// `gh api` takes exactly one endpoint, and everything else it is handed is
// payload, including `-f body=...`, which routinely contains the word merge and
// a URL. So the rule reads the endpoint and nothing else.
//
// Which token that is has to be worked out without a table of gh's flags,
// because a table of someone else's flags rots silently. The endpoint is the
// first argument that is not a flag, is not the value of one, and looks like a
// path. `--method PUT` is skipped by the second of those and `PUT` by the third.
function apiEndpoint(args) {
  for (let at = 0; at < args.length; at += 1) {
    if (args[at].startsWith('-')) continue
    if (at > 0 && args[at - 1].startsWith('-')) continue
    if (args[at].includes('/')) return args[at]
  }
  return null
}

// A merge endpoint, as a whole path segment, so `branches/merge-queue-test`
// does not trip it.
const isMergeEndpoint = (endpoint) => /\/(merge|merges)(\/|$)/.test(endpoint)

// Where a refspec lands. `src:dst` writes `dst`, a bare ref writes the same name
// at the far end, `:dst` deletes `dst`, and a leading `+` is force and says
// nothing about where it goes.
function pushDestination(refspec) {
  const colon = refspec.lastIndexOf(':')
  const destination = colon === -1 ? refspec : refspec.slice(colon + 1)
  return destination.replace(/^\+/, '').replace(/^refs\/heads\//, '')
}

// Only the push's own arguments, which the reader has already separated from
// the rest of the line. Reading the whole line instead is a real defect this
// guard shipped with: a commit message that merely mentioned the branch, in the
// same line as a push to a feature branch, was read as a push to master and
// denied.
//
// The first positional names the remote, so `git push master` is a push to a
// remote called `master` and not a push *to* master. Everything after it is a
// refspec. A flag's value can be mistaken for one, and that direction is the
// safe one: it allows, and the alternative is the table of someone else's flags
// this file declines to keep everywhere else.
function pushesToDefaultBranch(args) {
  const positional = args.filter((token) => !token.startsWith('-'))
  return positional.slice(1).some((refspec) => pushDestination(refspec) === DEFAULT_BRANCH)
}

// A dry run contacts the remote and changes nothing, so there is nothing for a
// rule about landing code to act on.
//
// `-n` is matched as a whole token, and that is safe rather than assumed:
// `git push -h` lists exactly one `-n`, `--dry-run`, so the token cannot mean
// anything else here. What it does not catch is a bundled cluster, since git's
// option parser accepts `git push -nq`. That stays denied, which is the
// harmless direction; widening the match to any cluster containing `n` would be
// the harmful one, because `-on` is `-o n`, a push option named `n`, and
// reading it as a dry run would allow a real push to master.
const isDryRun = (args) => args.includes('--dry-run') || args.includes('-n')

// A push with no refspec inherits its destination from the branch under it, so
// the command line does not say where it lands and the branch has to.
const hasExplicitDestination = (args) =>
  args.filter((token) => !token.startsWith('-')).length >= 2

// Catching the local default branch up to what the remote already has.
//
// `git merge --ff-only origin/master` is how you move local master forward
// after a pull request lands, and it cannot introduce anything: a fast-forward
// moves the branch to a commit the remote already has, which by definition went
// through a pull request. Denying it made the guard obstruct the one git
// operation this workflow performs most.
//
// Narrow on purpose. `--ff-only` alone is not enough, because a fast-forward
// from a *local* branch would land unreviewed commits, so the ref has to name a
// remote.
const isFastForwardFromRemote = (args) =>
  args.includes('--ff-only') &&
  args.some((token) => !token.startsWith('-') && /^[\w.-]+\/[\w./-]+$/.test(token))

// `--abort`, `--continue` and `--quit` act on a merge that is already halfway
// through and land nothing new. Denying them refused a command that was
// cleaning up after itself.
const RESOLVES_A_MERGE = new Set(['--abort', '--continue', '--quit'])
const resolvesAMerge = (args) => args.some((token) => RESOLVES_A_MERGE.has(token))

// The branch a bare `git push` or a `git merge` would land on is a fact about
// the directory the command runs in, not about the hook's own directory.
// Returns null when that directory is not a git repo at all, which is different
// from "on master": null means the question could not be asked, DEFAULT_BRANCH
// means it was asked and answered.
function branchIn(cwd) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

// THE BRANCH-DEPENDENT RULES ARE KEPT HERE, DELIBERATELY
//
// The skill's asset removed them, on the grounds that a PreToolUse hook runs
// before its command, so a `cd` in that command has not happened yet and the
// hook may read a different tree than the one the command lands in. That is a
// real objection and it is answered rather than ignored:
//
//   - The hook payload carries the directory the tool call runs in, and this
//     reads it rather than the hook process's own. `guard-live-data.mjs`
//     already decides who is running a command that way.
//   - A leading `cd <dir> &&` is the common form an agent worktree pushes with,
//     and the reader hands it over as a command of its own, in order. Reading
//     it is not the same mistake as reading a branch name out of surrounding
//     text: the shell really does change to that directory before the rest of
//     the line runs, so it is a fact about where the command executes.
//
// Dropping the rules would have removed the only thing that denies a bare
// `git push` from a checkout standing on master, which is #293's case and is
// asserted by this repository's tests. A guard that denies less in the course
// of being made quieter is the outcome #444 says to avoid.
function directoryOf(tokens, current) {
  if (commandName(tokens[0]) !== 'cd') return current
  // `cd /d C:\path` on Windows, and `cd -- <dir>`.
  const target = tokens.slice(1).find((token) => !token.startsWith('-') && token !== '/d')
  return target === undefined ? current : resolve(current, target)
}

function judge(line, depth, cwd) {
  let directory = cwd
  for (const tokens of segmentsOf(line)) {
    directory = directoryOf(tokens, directory)

    if (isLivenessProbe(tokens)) {
      deny(
        'The merge guard is loaded in this process. This probe was refused before it\n' +
          'ran, and being refused is the answer it exists to produce. Nothing is wrong.\n\n' +
          'A status update can now say the guard is loaded rather than configured.',
      )
    }

    const gh = ghArguments(tokens)
    if (gh !== null && gh[0] === 'pr' && gh[1] === 'merge') {
      deny(
        'Blocked: `gh pr merge` bypasses the green-checks requirement, and agents do\n' +
          `not land pull requests.\n\n${USE_WRAPPER}`,
      )
    }
    if (gh !== null && gh[0] === 'api' && isMergeEndpoint(apiEndpoint(gh.slice(1)) ?? '')) {
      deny(`Blocked: merging through \`gh api\` is still merging.\n\n${USE_WRAPPER}`)
    }

    const git = gitArguments(tokens)

    if (git !== null && git[0] === 'push' && !isDryRun(git)) {
      const args = git.slice(1)
      if (pushesToDefaultBranch(args)) {
        deny(
          `Blocked: pushing to ${DEFAULT_BRANCH} skips review and CI entirely.\n\n` +
            `Push your feature branch instead:  git push -u origin HEAD\n\n` +
            '`git push --dry-run` is allowed: it contacts the remote and changes\n' +
            `nothing. So is \`-n\`.\n\n${USE_WRAPPER}`,
        )
      }
      if (!hasExplicitDestination(args) && branchIn(directory) === DEFAULT_BRANCH) {
        deny(
          `Blocked: you are on ${DEFAULT_BRANCH} and this push names no destination, so\n` +
            `it would put code on the default branch without a pull request.\n\n` +
            `Create a branch first:  git checkout -b <area>/<issue>-<slug>\n\n${USE_WRAPPER}`,
        )
      }
    }

    if (
      git !== null &&
      git[0] === 'merge' &&
      !isFastForwardFromRemote(git.slice(1)) &&
      !resolvesAMerge(git.slice(1)) &&
      branchIn(directory) === DEFAULT_BRANCH
    ) {
      deny(
        `Blocked: you are on ${DEFAULT_BRANCH}, so this would put commits on the default\n` +
          `branch without a pull request.\n\n` +
          `\`git merge --ff-only origin/${DEFAULT_BRANCH}\` is allowed: it moves the branch to a\n` +
          `commit the remote already has.\n\n${USE_WRAPPER}`,
      )
    }

    const nested = depth > 0 ? shellPayload(tokens) : null
    if (nested !== null) judge(nested, depth - 1, directory)
  }
}

// ---------------------------------------------------------------------------
// --probe, and the hook
// ---------------------------------------------------------------------------

// Everything below runs only when the rule above did not fire, which is the
// whole point: reaching this code *is* the finding.
function probe() {
  // A script runner re-invokes its script through a shell of its own, so the
  // hook is shown `npm run <name>` and the file name it matches on is nowhere
  // in that line. The probe would then run in a session where the guard is
  // perfectly fine and report it absent, which is the one wrong answer that
  // looks like a right one.
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
  // command runs in its worktree.
  const cwd = parsed?.cwd ?? process.cwd()
  if (command.trim()) judge(command, 2, cwd)
  process.exit(0)
}

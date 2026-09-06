// Holds `scripts/run-stable.ps1` and `scripts/run-stable.cmd` to the two
// promises that made committing them possible at all.
//
// WHY THIS EXISTS
// #475 opened because the launcher that starts the owner's live catalogue was
// two files in no version control, in the same directory as the irreplaceable
// data, that survived a machine wipe by luck. Bringing them in only helps if
// two things stay true, and both are exactly the kind of thing that stops being
// true silently in a file nobody runs on CI:
//
//   1. **No live path.** A repository that is careful to hold no connection
//      string should not acquire somebody's directory layout instead. The paths
//      are the next thing along, and the argument against them is weaker, which
//      is why it needs a check rather than a paragraph.
//   2. **No drift from the contract.** The desktop deployment is the one
//      deployment of this app that nothing could check, and in the fortnight
//      before this landed it fell behind the tree by three variables without
//      anybody being able to see it: the gate (#521) went in and the launcher
//      configured no way to sign in, the backup watch (#311) went in and the
//      launcher watched nothing, and the Google Books key (#348) was never set
//      because setting it meant remembering to edit a file outside the tree.
//      `deploy/contract.json` is the list of what this app reads. A variable the
//      launcher sets that the contract does not declare is a variable that does
//      nothing.
//
// It is a text check on two shell scripts, which is a blunt instrument, and it
// is deliberate that it fails closed: an unrecognised `$env:` assignment is a
// complaint rather than a shrug.
//
// Usage, from a workflow step or by hand at the repository root:
//   node scripts/check-stable-launcher.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

export const LAUNCHER = join('scripts', 'run-stable.ps1')
export const ENTRY = join('scripts', 'run-stable.cmd')

/**
 * What a live path looks like, and why each shape is here.
 *
 * A drive-letter absolute path is the whole family: it is the only way to name
 * a location on this machine that another machine would not resolve. The other
 * two are named because they are the specific ones the predecessor carried and
 * because they would otherwise slip through as relative fragments.
 */
export const LIVE_PATHS = [
  { pattern: /[A-Za-z]:[\\/]/, what: 'a drive-letter absolute path' },
  { pattern: /\bUsers[\\/]/i, what: "a path under a named account's profile" },
  { pattern: /book-scan-production-data/, what: "the owner's production data directory" },
  { pattern: /book-scan-stable\b/, what: "the owner's stable checkout by name" },
]

/**
 * Variables the launcher may set that `deploy/contract.json` does not declare.
 *
 * Empty, and it should stay that way. It exists as a named list rather than as
 * an absent concept so that adding one is a decision somebody writes a reason
 * beside, the way `NOT_A_DEPLOYMENT_SURFACE` works in the contract's own
 * checker.
 */
export const NOT_IN_THE_CONTRACT = new Map()

/** Every environment variable a PowerShell source assigns, comments removed. */
export function assignedEnvNames(source) {
  const text = source.replace(/(^|\n)\s*#[^\n]*/g, '$1 ')
  const names = new Set()
  for (const m of text.matchAll(/\$env:([A-Za-z_][\w]*)\s*=/g)) names.add(m[1])
  return names
}

/**
 * Live paths in a source, comments included.
 *
 * Deliberately not comment-stripped, unlike the variable scan above. A comment
 * quoting somebody's directory is still that directory written down in this
 * repository, and the reason to keep them out is the same either way.
 */
export function livePathsIn(source) {
  return LIVE_PATHS.filter((one) => one.pattern.test(source)).map((one) => one.what)
}

/**
 * The whole judgement, as a pure function so the tests drive it rather than a
 * process. Returns a list of complaints, empty when there is nothing wrong.
 */
export function launcherProblems({ launcher, entry, contract }) {
  const problems = []

  for (const [file, source] of [[LAUNCHER, launcher], [ENTRY, entry]]) {
    for (const what of livePathsIn(source)) {
      problems.push(
        `${file} carries ${what}. Nothing site-specific belongs in either of these files: ` +
        'the machine\'s facts arrive as parameters or out of the settings file.',
      )
    }
  }

  const declared = new Map(contract.environment.map((one) => [one.name, one]))
  const set = assignedEnvNames(launcher)

  for (const name of set) {
    if (declared.has(name)) continue
    if (NOT_IN_THE_CONTRACT.has(name)) continue
    problems.push(
      `${LAUNCHER} sets ${name} and deploy/contract.json does not declare it. ` +
      'Either the app stopped reading it, in which case the launcher is handing the server ' +
      'something that does nothing, or the contract is out of date.',
    )
  }

  for (const variable of contract.environment) {
    if (!variable.required) continue
    if (set.has(variable.name)) continue
    problems.push(
      `${LAUNCHER} never sets ${variable.name}, and the contract says it is required. ${variable.whenAbsent}`,
    )
  }

  // The one line that makes everything this file does not check somebody else's
  // job. `deploy/check-config.mjs` reads the environment the launcher built and
  // says which of the contract's refusals it would meet, which is the coverage
  // that would be lost silently if the call were dropped.
  if (!/check-config\.mjs/.test(launcher)) {
    problems.push(
      `${LAUNCHER} does not run deploy/check-config.mjs. That call is what checks this ` +
      'deployment against the contract at the moment it starts, and it is the reason the ' +
      'launcher is in this repository rather than beside the catalogue.',
    )
  }

  // The entry point has to find the script beside it rather than by a path, or
  // the pair cannot travel in the checkout.
  if (!/%~dp0/.test(entry)) {
    problems.push(
      `${ENTRY} does not hand off with %~dp0. It has to run the script beside it, so the task's ` +
      'entry point and the script it runs move together with the checkout.',
    )
  }

  return problems
}

function main() {
  const problems = launcherProblems({
    launcher: readFileSync(join(root, LAUNCHER), 'utf8'),
    entry: readFileSync(join(root, ENTRY), 'utf8'),
    contract: JSON.parse(readFileSync(join(root, 'deploy', 'contract.json'), 'utf8')),
  })

  if (problems.length === 0) {
    console.log('The stable launcher carries no live path and matches the deployment contract.')
    return 0
  }

  for (const line of problems) console.error(`  WRONG    ${line}`)
  console.error('')
  console.error(`${problems.length} ${problems.length === 1 ? 'thing' : 'things'} wrong with the stable launcher.`)
  console.error('docs/the-stable-launcher.md is the argument for both rules.')
  return 1
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main()
}

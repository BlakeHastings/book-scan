// The only sanctioned way to land a PR on the default branch.
//
// A green tick and a green tick against the right base are different claims.
// GitHub computes a pull request's checks from a merge of the branch and the
// base at that moment, so when something else lands in between, the ticks
// describe a tree that no longer exists. The ruleset on `master` checks the
// first claim; the second gate below checks the second, and refuses the merge
// with an instruction to rebase.
//
// Always squash: one issue becomes one commit on master, so reverting a change
// means reverting one commit.
//
//   node scripts/merge-pr.mjs 42
import { execFileSync } from 'node:child_process'
import { isInert } from './ci-scope.mjs'
import { main as pruneWorktrees } from './prune-worktrees.mjs'

// The exact `name:` of each required CI job, as GitHub reports it in the check
// rollup. Take them from a real run, not from the workflow file:
//   gh pr view <n> --json statusCheckRollup --jq '.statusCheckRollup[].name'
// A name that never appears is treated as "never ran" and refuses the merge.
// That is the safe direction, but a typo here looks like a broken script.
//
// All three of these appear on every pull request, including one that changes
// only markdown. Their jobs are never filtered out by `paths:` and never
// skipped by a job-level `if:`: they always start, and decide inside themselves
// whether the expensive steps are worth running (`scripts/ci-scope.mjs`). A
// conditional job here is what makes a README change unmergeable.
//
// This list is deliberately stricter than the ruleset on the default branch,
// which names only the first two. That asymmetry is safe in this direction and
// only this one, because `scripts/guard-merge.mjs` denies every other way to
// land a commit, so a tighter gate here cannot let anything through that the
// ruleset would have stopped.
export const REQUIRED = ['web (typecheck + tests)', 'browser journeys', 'image (build + contract)']

// The compare endpoint lists at most this many files. A list at the cap may be
// truncated, and a truncated list could hide a code change behind a wall of
// markdown, so it is read as "cannot tell" and refuses.
export const COMPARE_FILE_LIMIT = 300

/**
 * Is every required check green on this pull request?
 *
 * `rollup` is the `statusCheckRollup` array from `gh pr view --json`, which is
 * the rollup of the pull request's last commit: one entry per check run, with a
 * `conclusion` once it has finished and a `state` while it has not.
 *
 * A check can be present and not green (FAILURE, CANCELLED, TIMED_OUT, SKIPPED,
 * or still PENDING), or absent from the rollup entirely because its workflow
 * never ran, which reads as a board with nothing wrong on it. Absent is refused
 * as "never ran", the safe direction: "did not run" must not read as "passed".
 *
 * NEUTRAL passes alongside SUCCESS, which is what a job that deliberately did
 * nothing reports.
 */
export function judgeChecks(rollup) {
  // Latest conclusion per check name: the rollup lists a rerun after the run it
  // replaces, and a rerun must not be judged on its first result.
  const latest = new Map()
  for (const check of rollup ?? []) {
    const name = check.name ?? check.context
    if (!name) continue
    const state = check.conclusion || check.state || 'PENDING'
    latest.set(name, state)
  }

  const problems = []
  for (const name of REQUIRED) {
    const state = latest.get(name)
    if (state === undefined) problems.push(`${name}: never ran`)
    else if (state !== 'SUCCESS' && state !== 'NEUTRAL') problems.push(`${name}: ${state}`)
  }

  if (problems.length === 0) return { green: true }

  return {
    green: false,
    why:
      `required checks are not green:\n    ${problems.join('\n    ')}\n\n` +
      `  Fix the run, do not merge around it. If a check is wrong, change the check\n` +
      `  in its own PR and say so.`,
  }
}

/**
 * Did these checks run against the base as it stands now, and if not, could the
 * difference matter?
 *
 * `compared` is the body of
 *
 *   gh api repos/{owner}/{repo}/compare/<pr head sha>...<base branch>
 *
 * which is the three-dot form, so it reads from the merge base forward:
 * `ahead_by` is how many commits the base branch has that this branch has never
 * seen, and `files` is what those commits changed.
 *
 * Only the base side is checked. `statusCheckRollup` is the rollup of the pull
 * request's last commit, so the head the ticks describe is the head that would
 * land, by construction. Nothing in the API says which base commit a check run
 * used: `pull_requests` comes back empty on this repository's workflow runs and
 * check suites, and `mergeStateStatus` only reports BEHIND when a rule requires
 * up-to-date branches, which this repository deliberately does not.
 *
 * A base commit that changed only paths `ci-scope.mjs` calls inert cannot change
 * what any suite here proves, because CI would not have re-run a single step for
 * it. Anything else gets a rebase, and `isInert` is shared rather than restated
 * so the two definitions cannot drift apart.
 *
 * Do not weaken this to "do the intervening commits touch files this branch
 * touches". Two branches can break each other through a type across one
 * TypeScript program while touching no file in common, which is the defect this
 * gate exists for.
 */
export function judgeBase(compared, base) {
  const gained = compared?.ahead_by

  if (!Number.isInteger(gained)) {
    return {
      fresh: false,
      why:
        `could not work out whether its checks ran against the current ${base}.\n\n` +
        `  The compare API did not say how far ${base} has moved. That is an\n` +
        `  answered-nothing, not a green light.\n\n` +
        `  Try again, and if it keeps happening say so rather than merging around it.`,
    }
  }

  if (gained === 0) {
    return { fresh: true, note: `${base} has not moved since these checks ran.` }
  }

  const files = compared.files
  if (!Array.isArray(files)) {
    return {
      fresh: false,
      why: staleMessage(base, gained, `  and the API did not say what they changed.`),
    }
  }

  if (files.length >= COMPARE_FILE_LIMIT) {
    return {
      fresh: false,
      why: staleMessage(
        base,
        gained,
        `  changing ${files.length} files, which is the compare API's cap, so that\n` +
          `  list may be short and cannot be ruled harmless.`,
      ),
    }
  }

  const live = files.map((file) => file.filename).filter((path) => !isInert(path))
  if (live.length === 0) {
    // Includes the case of a base commit with an empty diff: nothing changed,
    // so nothing this branch was proved against changed either.
    return {
      fresh: true,
      note:
        `${base} has gained ${plural(gained, 'commit')} since these checks ran, ` +
        `changing ${plural(files.length, 'file')}, none of them code.`,
    }
  }

  const shown = live.slice(0, 5)
  const more = live.length > 5 ? `\n    and ${live.length - 5} more` : ''
  return {
    fresh: false,
    why: staleMessage(base, gained, `  changing code:\n    ${shown.join('\n    ')}${more}`),
  }
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

function staleMessage(base, gained, detail) {
  return (
    `its checks did not run against the current ${base}.\n\n` +
    `  ${base} has gained ${plural(gained, 'commit')} since this branch last saw it,\n` +
    `${detail}\n\n` +
    `  GitHub built those green ticks from a merge of this branch with the older\n` +
    `  ${base}, so they describe a combination that no longer exists. That is how\n` +
    `  #151 and #152 both merged green and left ${base} red.\n\n` +
    `  Rebase on ${base} and let the checks re-run:\n\n` +
    `    git fetch origin && git rebase origin/${base} && git push --force-with-lease`
  )
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function main() {
  const prNumber = process.argv[2]
  if (!prNumber || !/^\d+$/.test(prNumber)) {
    console.error('Usage: node scripts/merge-pr.mjs <pr-number>')
    process.exit(1)
  }

  let pr
  try {
    pr = JSON.parse(
      gh([
        'pr',
        'view',
        prNumber,
        '--json',
        'number,title,state,isDraft,mergeable,headRefName,headRefOid,baseRefName,statusCheckRollup',
      ]),
    )
  } catch (error) {
    console.error(`Could not read PR #${prNumber}: ${error.stderr || error.message}`)
    process.exit(1)
  }

  const refuse = (why) => {
    console.error(`Refusing to merge PR #${prNumber} (${pr.title}):\n  ${why}`)
    process.exit(1)
  }

  if (pr.state !== 'OPEN') refuse(`state is ${pr.state}, not OPEN.`)
  if (pr.isDraft) refuse('it is a draft.')
  if (pr.mergeable === 'CONFLICTING')
    refuse(`it has conflicts with ${pr.baseRefName}. Rebase on ${pr.baseRefName} first.`)

  const checks = judgeChecks(pr.statusCheckRollup)
  if (!checks.green) refuse(checks.why)

  // Asked second on purpose: a red pull request needs its run fixed, and
  // rebasing it would only produce a red run against a newer base.
  let compared
  try {
    compared = JSON.parse(
      gh(['api', `repos/{owner}/{repo}/compare/${pr.headRefOid}...${pr.baseRefName}`]),
    )
  } catch (error) {
    compared = null
    console.error(`Could not compare against ${pr.baseRefName}: ${error.stderr || error.message}`)
  }

  const base = judgeBase(compared, pr.baseRefName)
  if (!base.fresh) refuse(base.why)

  console.log(`PR #${prNumber}: ${pr.title}`)
  console.log(base.note)
  console.log(`All ${REQUIRED.length} required checks green. Squash merging...`)

  try {
    // The REST endpoint rather than `gh pr merge`, which the guard blocks by name.
    gh([
      'api',
      '--method',
      'PUT',
      `repos/{owner}/{repo}/pulls/${prNumber}/merge`,
      '-f',
      'merge_method=squash',
    ])
  } catch (error) {
    console.error(`Merge failed: ${error.stderr || error.message}`)
    process.exit(1)
  }

  try {
    gh(['api', '--method', 'DELETE', `repos/{owner}/{repo}/git/refs/heads/${pr.headRefName}`])
    console.log(`Merged and deleted branch ${pr.headRefName}.`)
  } catch {
    console.log(`Merged. Branch ${pr.headRefName} could not be deleted; remove it manually.`)
  }

  // Deleting the branch is the moment its worktree is certainly finished with,
  // so the sweep happens here. A failure here must not fail the merge: the
  // merge has already happened, and reporting it as failed would be the worse
  // lie.
  try {
    pruneWorktrees()
  } catch (error) {
    console.log(`Merged. Worktree sweep did not run: ${(error.message || '').split('\n')[0]}`)
  }
}

// Only when run directly, so the test can import `judgeBase` without this
// script trying to merge something. Compared on the entry path because
// `import.meta.url` needs a file:// URL dance to match on Windows.
if (process.argv[1]?.endsWith('merge-pr.mjs')) main()

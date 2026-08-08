// The only sanctioned way to land a PR on the default branch.
//
// WHAT THIS PREVENTS
// GitHub cannot enforce required checks here: branch protection needs a paid
// plan on a private repo. Without enforcement, "check the run first" is a
// habit, and habits lapse exactly when things are busy. This does the check
// mechanically and refuses otherwise.
//
// Always squash: one issue becomes one commit on master, so `git log --oneline`
// stays a readable list of changes rather than a wall of "fix lint" noise, and
// reverting a change means reverting one commit.
//
// GREEN IS NOT ENOUGH ON ITS OWN
// A green tick says a combination of code passed. It does not say that
// combination is the one about to land. GitHub computes a pull request's checks
// from a merge of the branch and the base *at that moment*, so when something
// else lands in between, the ticks describe a tree that no longer exists.
//
// That is not hypothetical here. #151 put the `Db` interface under the stores
// and #152 added a test written against better-sqlite3 directly. Neither
// branch touched a file the other did, so nothing conflicted and GitHub called
// both mergeable. Both merged green, within an hour of each other, and master
// stopped compiling (#154). Every branch in flight then rebased onto a base
// that failed, and this script refused all of them.
//
// So there is a second gate below: the checks must have run against the base as
// it stands now, or the merge is refused with an instruction to rebase.
//
//   node scripts/merge-pr.mjs 42
import { execFileSync } from 'node:child_process'
import { isInert } from './ci-scope.mjs'
import { main as pruneWorktrees } from './prune-worktrees.mjs'

// SETUP: the exact `name:` of each required CI job, as GitHub reports it in
// the check rollup. Take them from a real run, not from the workflow file:
//   gh pr view <n> --json statusCheckRollup --jq '.statusCheckRollup[].name'
// A name that never appears is treated as "never ran" and refuses the merge.
// That is the safe direction, but a typo here looks like a broken script.
//
// Both of these appear on every pull request, including one that changes only
// markdown. Their jobs are never filtered out by `paths:` and never skipped by
// a job-level `if:`: they always start, and decide inside themselves whether
// the expensive steps are worth running (`scripts/ci-scope.mjs`). If you are
// tempted to make a job conditional, read the top of that file first, because
// the version of this list that refuses to merge a README change is the one
// this comment exists to prevent.
//
// `no production data committed` was a third entry until #126. It was a
// five second job billed as a whole minute, so it became the first step of
// `web (typecheck + tests)` and also runs after a merge in `provenance.yml`.
// The check still runs, on more commits than before; it no longer has a check
// name of its own.
const REQUIRED = ['web (typecheck + tests)', 'browser journeys']

// The compare endpoint lists at most this many files. A list at the cap may be
// truncated, and a truncated list could hide a code change behind a wall of
// markdown, so it is read as "cannot tell" and refuses. Same direction
// `ci-scope.mjs` takes with its own truncation, and for the same reason.
export const COMPARE_FILE_LIMIT = 300

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
 * seen, and `files` is what those commits changed. Verified against this
 * repository rather than assumed: comparing `f835b47...master` reports
 * `ahead_by: 2` and the 24 files #151 and #152 changed between them.
 *
 * WHY THE HEAD SIDE IS NOT CHECKED
 * `statusCheckRollup` is the rollup of the pull request's last commit, so the
 * head the ticks describe is the head that would land, by construction. The
 * base side is the unknown, and nothing in the API says which base commit a
 * check run used: `pull_requests` comes back empty on this repository's
 * workflow runs and check suites (checked on run 31042629121 and suite
 * 84200985766), and `mergeStateStatus` only reports BEHIND when a ruleset
 * requires up-to-date branches, which this plan cannot have. So staleness is
 * derived from what the base has gained instead, which is a plain question git
 * can always answer.
 *
 * WHY NOT "THE EXACT TIP", AND WHY NOT SOMETHING LOOSER
 * Refusing on any movement at all is GitHub's "require branches to be up to
 * date", and it would re-run every open pull request on every merge, including
 * a merge that only edited a README. Billed minutes are finite and a refusal
 * that fires constantly gets worked around.
 *
 * The tempting loose test, "do the intervening commits touch files this branch
 * touches", is worse than useless: #151 and #152 touched no file in common and
 * still broke each other, because the coupling was a type across one TypeScript
 * program. Any file-overlap rule would have waved through the exact defect this
 * gate exists for.
 *
 * So the line is drawn where this repository has already drawn it once. A
 * commit that changed only paths `ci-scope.mjs` calls inert cannot change what
 * any suite here proves, because CI would not have re-run a single step for it.
 * Anything else gets a rebase. Sharing `isInert` rather than restating it means
 * the two definitions cannot drift apart.
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

/** A short reason and an instruction, the shape every refusal here takes. */
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

  // Latest conclusion per check name; a rerun should not be judged on its first result.
  const latest = new Map()
  for (const check of pr.statusCheckRollup ?? []) {
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

  if (problems.length > 0) {
    refuse(
      `required checks are not green:\n    ${problems.join('\n    ')}\n\n` +
        `  Fix the run, do not merge around it. If a check is wrong, change the check\n` +
        `  in its own PR and say so.`,
    )
  }

  // Green, and asked second on purpose: a red pull request needs its run fixed,
  // and rebasing it would only produce a red run against a newer base.
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
  // so the sweep happens here rather than being remembered. Each agent worktree
  // carries its own node_modules; on 2026-08-07 the disk reached 1.4 GB free
  // with eight of them and work stopped twice while they were cleared by hand.
  //
  // It refuses anything locked, dirty, or whose branch is still on origin, and
  // says so per worktree. A failure here must not fail the merge: the merge has
  // already happened, and reporting it as failed would be the worse lie.
  try {
    pruneWorktrees()
  } catch (error) {
    console.log(`Merged. Worktree sweep did not run: ${(error.message || '').split('\n')[0]}`)
  }
}

// Only when run directly, so the test can import `judgeBase` without this
// script trying to merge something. Compared on the entry path rather than on
// `import.meta.url`, which needs a file:// URL dance to match on Windows. Same
// pattern as ci-scope.mjs, and the same reason.
if (process.argv[1]?.endsWith('merge-pr.mjs')) main()

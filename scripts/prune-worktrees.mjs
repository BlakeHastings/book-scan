// Remove agent worktrees whose branch is gone from origin.
//
// A worktree is removed only when its branch is gone from origin, it has no
// uncommitted changes, git does not consider it locked (which is how a running
// agent marks one), and nothing in it is missing from master. Anything refused is
// left alone and named. This runs from `merge-pr.mjs`, whose last act is deleting
// the branch from origin.
//
// A branch gone from origin is either one that landed or one that was never
// pushed, which is what every agent has while it is still working, so the fourth
// check is the one that matters. It asks whether anything here is missing from
// master by content rather than by reachability: squash merged, a branch's
// changes are on master under a commit the branch has never seen, so asking
// whether its commits are reachable refuses every worktree forever.
//
// Content has no direction either. Once master moves on top of the same files,
// because the next agent's work touches them too, a landed branch differs from
// master again in the other direction, so both locally available signals say
// "unlanded" about a branch that landed cleanly.
//
// GitHub is the only party that knows what a squash merge did to a branch, so a
// refusal for content gets a second opinion from
// `gh pr list --state merged --head <branch>`, asked last and only of the
// worktrees that would otherwise be refused for content. The question is whether
// a merged pull request's head commit equals this branch's tip, not whether any
// merged pull request exists: commits made locally after the branch was pushed
// and merged move the tip away from what GitHub merged, so the answer is no and
// the worktree is kept and named. Everything about the call fails towards
// keeping: no `gh`, no network, no authentication, an unparseable answer, a pull
// request that is not merged, a tip that does not match.
//
// Patch ids cannot help either: a squash has one patch id and the branch has
// several, so `git cherry origin/master <branch>` marks every commit of a
// squash-merged branch `+`, meaning not upstream, and it gets worse the more
// commits an agent makes.
import { execFileSync } from 'node:child_process'

const DRY_RUN = process.argv.includes('--dry-run')

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * `--porcelain` rather than the human listing, because the human one aligns
 * columns with spaces and a path containing a space then parses wrong.
 */
function worktrees() {
  const found = []
  let current = {}
  for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) current = { path: line.slice(9).trim() }
    else if (line.startsWith('branch ')) current.branch = line.slice(7).trim().replace('refs/heads/', '')
    // `locked`, or `locked <reason>`. The agent harness writes a reason naming
    // the agent and its pid, so an exact match on the word never fires.
    else if (line.trimEnd().startsWith('locked')) current.locked = true
    else if (line.trim() === '' && current.path) {
      found.push(current)
      current = {}
    }
  }
  if (current.path) found.push(current)
  return found
}

/**
 * The files this branch has that `master` does not, compared by content: the
 * files the branch changed since it left master, and whether those same files
 * still differ from master.
 *
 * Returns `null` when the comparison cannot be made at all, which the caller
 * treats as a refusal rather than as permission.
 *
 * `origin/master` has to be fetched first, and the caller does it. This runs
 * from `merge-pr.mjs` immediately after a merge, which is exactly the moment the
 * local ref is one commit behind the branch that was just landed, and comparing
 * against the stale ref makes every freshly merged worktree look like unlanded
 * work.
 */
function worksMasterDoesNotHave(branch) {
  if (!branch) return null
  try {
    const base = git(['merge-base', 'origin/master', branch]).trim()
    const touched = git(['diff', '--name-only', base, branch])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    // Branched and never committed anything of its own.
    if (touched.length === 0) return []

    const differs = git(['diff', '--name-only', 'origin/master', branch, '--', ...touched])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    return differs
  } catch {
    return null
  }
}

function branchesOnOrigin() {
  const out = git(['ls-remote', '--heads', 'origin'])
  return new Set(
    out
      .split('\n')
      .map((line) => line.split('\t')[1])
      .filter(Boolean)
      .map((ref) => ref.replace('refs/heads/', '')),
  )
}

function tipOf(branch) {
  try {
    return git(['rev-parse', branch]).trim() || null
  } catch {
    return null
  }
}

/**
 * The merged pull requests GitHub has for this branch name, or null.
 *
 * `--state merged` and `--head <branch>` still answer after the branch is
 * deleted from origin, which is exactly when this is asked: the pull request
 * remembers the ref name and the commit it merged.
 *
 * Null for every failure, including `gh` not being installed at all, so a
 * machine without it keeps.
 *
 * `--limit 20` because a branch name can have been used more than once and the
 * judgement below wants all of them; the timeout is here because this runs
 * inside a merge, and a sweep that hangs on a network call has turned a
 * finished merge into a stuck one.
 */
function mergedPullRequestsFor(branch) {
  try {
    return JSON.parse(
      execFileSync(
        'gh',
        ['pr', 'list', '--state', 'merged', '--head', branch, '--json', 'number,headRefOid', '--limit', '20'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 },
      ),
    )
  } catch {
    return null
  }
}

/**
 * Did this exact commit land, as a squash, under a pull request?
 *
 * `landed` is true only when a merged pull request's head commit is the branch's
 * tip. Anything else is a keep, and a merged pull request whose head is not the
 * tip means commits were made in the worktree after the merge, which the refusal
 * names so somebody looks at it.
 */
export function judgeMergedPullRequests(pullRequests, tip) {
  if (!Array.isArray(pullRequests) || !tip) return { landed: false }

  const landed = pullRequests.find((pull) => pull?.headRefOid === tip)
  if (landed) return { landed: true, number: landed.number }

  const numbers = pullRequests.map((pull) => pull?.number).filter(Boolean)
  if (numbers.length === 0) return { landed: false }

  return {
    landed: false,
    note:
      `it merged as ${numbers.map((number) => `#${number}`).join(', ')}, ` +
      'but this checkout has moved since, so look at it',
  }
}

function isDirty(path) {
  try {
    return git(['-C', path, 'status', '--porcelain']).trim() !== ''
  } catch {
    // Unreadable is not the same as clean, and guessing wrong here deletes
    // something.
    return true
  }
}

export function main({ askGitHub = mergedPullRequestsFor } = {}) {
  // Only the agent worktrees: the main checkout and the `stable` checkout are
  // off limits, and that includes tidying them.
  const candidates = worktrees().filter((tree) => tree.path.includes('.claude/worktrees/'))
  if (candidates.length === 0) {
    console.log('No agent worktrees.')
    return
  }

  // Before anything is compared. See `worksMasterDoesNotHave`. A failure here is
  // not fatal: the comparison refuses on its own and nothing is deleted.
  try {
    git(['fetch', 'origin', 'master', '--quiet'])
  } catch {
    console.log('Could not fetch origin/master, so nothing will look landed.')
  }

  const onOrigin = branchesOnOrigin()
  const removed = []
  const kept = []

  for (const tree of candidates) {
    const name = tree.path.split('/').pop()
    if (tree.locked) {
      kept.push(`${name}: locked, so an agent is using it`)
      continue
    }
    if (tree.branch && onOrigin.has(tree.branch)) {
      kept.push(`${name}: ${tree.branch} is still on origin`)
      continue
    }
    if (isDirty(tree.path)) {
      kept.push(`${name}: has uncommitted changes, look at it`)
      continue
    }
    const unique = worksMasterDoesNotHave(tree.branch)
    if (unique === null) {
      kept.push(`${name}: could not be compared against master, so left alone`)
      continue
    }
    // Differing files are the ordinary look of a squash-merged branch, so this
    // is the one refusal that gets a second opinion, and only this one.
    let landedAs = null
    if (unique.length > 0) {
      const verdict = judgeMergedPullRequests(askGitHub(tree.branch), tipOf(tree.branch))
      if (!verdict.landed) {
        const files =
          `${unique.length} file(s) differ from master ` +
          `(${unique.slice(0, 3).join(', ')}${unique.length > 3 ? ', ...' : ''})`
        kept.push(
          verdict.note
            ? `${name}: ${files}, and ${verdict.note}`
            : `${name}: ${files}, so this is unlanded work`,
        )
        continue
      }
      landedAs = verdict.number
    }

    const landed = landedAs === null ? '' : `landed as #${landedAs}`

    if (DRY_RUN) {
      removed.push(`${name} (${['would remove', landed].filter(Boolean).join(', ')})`)
      continue
    }
    try {
      git(['worktree', 'remove', '--force', tree.path])
      if (tree.branch) {
        try {
          git(['branch', '-D', tree.branch])
        } catch {
          // The branch outliving its worktree is untidy, not dangerous.
        }
      }
      removed.push(landed ? `${name} (${landed})` : name)
    } catch (error) {
      kept.push(`${name}: could not be removed (${(error.message || '').split('\n')[0]})`)
    }
  }

  try {
    git(['worktree', 'prune'])
  } catch {
    // Nothing to prune is not a failure.
  }

  if (removed.length) console.log(`Pruned ${removed.length} worktree(s): ${removed.join(', ')}`)
  for (const reason of kept) console.log(`Kept ${reason}`)
}

if (process.argv[1]?.endsWith('prune-worktrees.mjs')) main()

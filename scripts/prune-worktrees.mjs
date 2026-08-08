// Remove agent worktrees whose branch is gone from origin.
//
// WHY THIS EXISTS
// Every agent gets a worktree, and every worktree gets its own `npm ci` in
// `web/` and sometimes `e2e/` too. That is gigabytes each. On 2026-08-07 the C:
// drive reached 4.6 GB free and then 1.4 GB free in one afternoon, twice
// stopping work while worktrees were swept by hand, and `docs/orchestrating.md`
// records the same thing happening three times the day before.
//
// Sweeping by hand is the wrong layer. The moment a worktree is certainly
// finished with is the moment its branch is deleted from origin, which is the
// last thing `merge-pr.mjs` does, so that is where this runs.
//
// WHAT IT WILL NOT DO
// A worktree is only removed when all three hold:
//
//   1. its branch no longer exists on origin, so the work has landed or been
//      abandoned deliberately;
//   2. it has no uncommitted changes;
//   3. git does not consider it locked, which is how a running agent marks one.
//
// The second and third are the ones that matter. `docs/orchestrating.md`
// records a worktree in another repository holding a month of work on a branch
// with no upstream, found while pruning. Anything this refuses is left alone
// and named, because a sweep that quietly skips things teaches nobody which
// ones need looking at.
//
// WHAT IT CANNOT CHECK, SAID OUT LOUD
// It does not catch commits made locally *after* the branch was pushed and
// merged. Once origin has deleted the branch there is nothing left to compare
// against, and a squash merge means the branch's own commits are never
// reachable from `master`, so "is this commit on master" would refuse every
// worktree and protect nothing.
//
// What stands in for that check is who deletes the branch: only `merge-pr.mjs`
// does, and only after a merge it has already refused twice over. A branch gone
// from origin is one somebody landed on purpose. If an agent is ever left
// committing after its pull request merges, this assumption stops holding and
// this comment is where to start.
//
//   node scripts/prune-worktrees.mjs            # remove what is safe
//   node scripts/prune-worktrees.mjs --dry-run  # say what would go
import { execFileSync } from 'node:child_process'

const DRY_RUN = process.argv.includes('--dry-run')

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * Every worktree, as git describes them, with the fields this needs.
 *
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
    // the agent and its pid, so an exact match on the word never fires and the
    // one safety check that does not depend on the network silently does
    // nothing. Found by running --dry-run against a locked worktree and reading
    // which reason it gave for keeping it.
    else if (line.trimEnd().startsWith('locked')) current.locked = true
    else if (line.trim() === '' && current.path) {
      found.push(current)
      current = {}
    }
  }
  if (current.path) found.push(current)
  return found
}

/** The branches origin still has, so a deleted one is a finished one. */
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

function isDirty(path) {
  try {
    return git(['-C', path, 'status', '--porcelain']).trim() !== ''
  } catch {
    // Unreadable is not the same as clean, and this is the one place where
    // guessing wrong deletes something.
    return true
  }
}

export function main() {
  // Only the agent worktrees. The main checkout and the `stable` checkout are
  // not this script's business, and `stable` especially is not: AGENTS.md makes
  // it off limits without asking, and that includes tidying it.
  const candidates = worktrees().filter((tree) => tree.path.includes('.claude/worktrees/'))
  if (candidates.length === 0) {
    console.log('No agent worktrees.')
    return
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

    if (DRY_RUN) {
      removed.push(`${name} (would remove)`)
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
      removed.push(name)
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
  // Always printed, never summarised away: this list is the whole reason the
  // script is allowed to delete anything.
  for (const reason of kept) console.log(`Kept ${reason}`)
}

if (process.argv[1]?.endsWith('prune-worktrees.mjs')) main()

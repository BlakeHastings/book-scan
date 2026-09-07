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
// THAT ASSUMPTION WAS WRONG, AND IT COST A WORKTREE
// A branch gone from origin is one of two things, and the paragraph above only
// names one of them. The other is a branch that was **never pushed**, which is
// what every agent has while it is still working.
//
// On 2026-08-14 an agent stopped partway through a task, which released the
// lock the harness holds while it runs. A merge ran this sweep, saw an unlocked
// worktree with a clean tree on a branch origin had never heard of, and removed
// it. The agent was then resumed into a directory that was being torn down
// underneath it, and its test run failed on files that had stopped existing.
// The commit survived only because `git branch -D` happened to fail after
// `git worktree remove` succeeded.
//
// So the three conditions were not enough, and the missing one is the only one
// that actually matters: **is there anything here that master does not have?**
// That is now checked by content rather than by reachability, which is what
// makes it survive a squash merge. A branch whose own files are identical to
// master's has nothing to lose; a branch whose files differ has work on it,
// whatever origin remembers.
//
// AND CONTENT CANNOT TELL THE DIFFERENCE EITHER, ONCE MASTER MOVES
// It refused four merged worktrees in one wave on 2026-09-07 (#577), and the
// reason is that a file comparison has no direction. Squash merged, a branch's
// changes are on master under a commit the branch has never seen. Then master
// moves *on top of the same files*, because the next agent's work touches them
// too, and now the branch differs from master again in the other direction:
// master has work the worktree lacks, not the reverse. Both signals available
// locally say "unlanded" about a branch that landed cleanly.
//
// A refusal that fires on every successful merge is the ordinary case, and the
// argument above is entirely about somebody reading these lines. The one time
// it is right arrives looking exactly like the four times it was not.
//
// SO THE FOURTH CHECK NOW HAS A SECOND OPINION, AND IT IS THE HONEST SIGNAL
// GitHub knows what a squash merge did to a branch, and it is the only party
// that does: `gh pr list --state merged --head <branch>` answers directly. That
// is asked **only of the worktrees this would otherwise refuse for content**,
// which is a handful per sweep rather than a network call each, and never
// before the local checks that need no network at all.
//
// It is not "was there a merged pull request", which would be the eager guess
// this must not make. It is "does a merged pull request's head commit equal
// this branch's tip", which is the same question the header above asks and the
// only form of it that survives the failure this script has already caused:
// commits made locally after the branch was pushed and merged move the tip away
// from what GitHub merged, so the answer is no and the worktree is kept and
// named. That case used to be this file's stated blind spot; it is now the case
// it reports.
//
// Everything about it fails towards keeping. No `gh`, no network, no
// authentication, an unparseable answer, a pull request that is not merged, a
// tip that does not match: all of them leave the refusal exactly as it was.
//
// WHAT `git cherry` AND PATCH IDS SAY, SINCE IT WAS WORTH FINDING OUT
// Nothing usable. Run against `covers/556-cover-cache-header`, whose three
// commits landed as the squash #565, `git cherry origin/master <branch>` marks
// all three `+`, meaning "not upstream". A squash has one patch id and the
// branch has three, so no patch-equivalence test can match them, and it gets
// worse rather than better the more commits an agent makes. It is recorded here
// so the next person does not spend the afternoon on it.
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

/**
 * The files this branch has that `master` does not, compared by content.
 *
 * The question a sweep actually needs answered is not "did this land" but "is
 * anything here that exists nowhere else". Content answers it and reachability
 * does not, which is the whole difficulty: a squash merge puts the branch's
 * changes on master under a commit the branch has never seen, so asking whether
 * the branch's commits are reachable refuses every worktree forever and
 * protects nothing.
 *
 * So: take the files the branch changed since it left master, and ask whether
 * those same files now differ from master. Squash merged, they are identical
 * and this returns nothing. Never pushed, they differ and this returns them,
 * which is an agent's unlanded work and the sweep must leave it alone.
 *
 * Returns `null` when the comparison cannot be made at all, which is treated as
 * a refusal rather than as permission: not being able to tell is the one case
 * where deleting somebody's afternoon is unrecoverable.
 *
 * **`origin/master` has to be fetched first, and the caller does it.** This runs
 * from `merge-pr.mjs` immediately after a merge, which is exactly the moment the
 * local ref is one commit behind the branch that was just landed. Comparing
 * against the stale ref makes every freshly merged worktree look like unlanded
 * work, so the sweep refuses everything and reclaims nothing. That is safe and
 * useless, and it is how a full disk was found rather than prevented.
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

/** The commit this branch is actually standing on, or null if it cannot be read. */
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
 * remembers the ref name and the commit it merged. Verified on the three
 * worktrees #577 was filed about, all of whose branches were already gone.
 *
 * Null for every failure, including `gh` not being installed at all, so a
 * machine without it behaves as this script did before: it keeps.
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
 * Separated from the call to `gh` so the decision can be exercised without a
 * network, because this is the half that can be wrong in the direction that
 * deletes somebody's afternoon.
 *
 * `landed` is true only when a merged pull request's head commit **is** the
 * branch's tip. Anything else is a keep, and the two interesting keeps say
 * different things:
 *
 *   - no merged pull request at all: the ordinary unlanded branch, and the
 *     content refusal it already had is the right message.
 *   - merged, but the tip has moved: commits were made in the worktree after
 *     the pull request was merged. That is the failure of 2026-08-14 with the
 *     branch deleted for a good reason instead of never pushed, and it is the
 *     one this file used to say out loud it could not see. It is named in the
 *     refusal so somebody looks at it.
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
    // Unreadable is not the same as clean, and this is the one place where
    // guessing wrong deletes something.
    return true
  }
}

export function main({ askGitHub = mergedPullRequestsFor } = {}) {
  // Only the agent worktrees. The main checkout and the `stable` checkout are
  // not this script's business, and `stable` especially is not: AGENTS.md makes
  // it off limits without asking, and that includes tidying it.
  const candidates = worktrees().filter((tree) => tree.path.includes('.claude/worktrees/'))
  if (candidates.length === 0) {
    console.log('No agent worktrees.')
    return
  }

  // Before anything is compared. See `worksMasterDoesNotHave`: this runs right
  // after a merge, when the local `origin/master` is the one thing guaranteed
  // to be out of date, and comparing against it refuses every worktree that
  // just landed. A failure here is not fatal; the comparison refuses on its own
  // and nothing is deleted.
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
    // is the one refusal that gets a second opinion, and only this one. Asked
    // last, after every check that needs no network, and asked about the
    // handful of worktrees that reach it rather than about all of them.
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
  // Always printed, never summarised away: this list is the whole reason the
  // script is allowed to delete anything.
  for (const reason of kept) console.log(`Kept ${reason}`)
}

if (process.argv[1]?.endsWith('prune-worktrees.mjs')) main()

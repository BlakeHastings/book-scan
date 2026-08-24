# Handoff

**A snapshot, not a source of truth.** Where this file and the repository
disagree, the repository is right. The backlog says what is left to do, the
issues say why, `docs/orchestrating.md` says what is peculiar about this
project, and the review record on each pull request says what was actually
verified. This file is only the residue: where the work stopped, and what a
successor would otherwise have to reconstruct.

**Written 2026-08-24, at `0cefe09` (`master`, after #441).** It rots quickly.
Three merges from now, distrust the "in flight" section entirely and read
`gh pr list` instead.

## In flight

Three agents dispatched in one wave, each alone in its own worktree, batched so
they do not collide:

| Issue | Surface | Why it is in this wave |
| --- | --- | --- |
| #434 | the spine and shelf view | a phantom bookcase after a tag change, and spine labels clipped at the *start* |
| #433 | the book page and manage screen | an offer that relocates a correctly filed book and deletes its area, without asking |
| #432 | the camera error message and the shelving cascade | a failure message at 1.05:1 in the light theme, and a cascade with no button that obeys it |

**#430 is deliberately held back.** It collides with two of the three: its
"one fixture, two names" is the same defect family as #434's phantom bookcase,
and its overflow-onto-the-wrong-bookcase is the same cascade #432 is inside.
Dispatch it after those two land, and re-check its four items against the
result first, because some of them may already be gone.

## The one thing that is easy to get wrong here

**Check `git log --oneline -1 origin/master` against your own checkout before
you brief anything.** The local `master` in the main checkout was found 13
commits behind on 2026-08-24, while the harness had correctly based every agent
worktree on `origin/master`. A brief written from the stale tree describes code
that is not there. This cost nothing that day only because the issues were read
from `gh` rather than from the working tree.

## The sequence, with the traps beside it

```bash
git fetch origin && git log --oneline -1 origin/master   # first, always
git merge --ff-only origin/master                        # the checkout drifts

node scripts/prune-worktrees.mjs --dry-run               # says what would go
node scripts/prune-worktrees.mjs                         # C: has run out 3x
df -h /c                                                 # 47G free on 2026-08-24

gh issue list --state open                               # never dispatch `shaping`
gh pr list --state open

node scripts/merge-pr.mjs <n>                            # the only way to land
```

Traps, each of which has actually bitten:

- **`prune-worktrees.mjs` cannot see commits made locally after a branch was
  pushed and merged.** Look at a worktree that matters before a big sweep. On
  2026-08-24 the one stale worktree was checked first and its whole chain turned
  out to be the pre-squash counterpart of what had already landed.
- **The merge gate refuses stale bases and that is the point.** Merge docs PRs
  first, code PRs one at a time, each rebased.
- **Never `npm run dev` in a worktree.** Fixed ports, and it collides with
  whoever started first. `aspire start --non-interactive` assigns them.
- **Measure disk with `du`, not PowerShell one-liners.** Escaping has silently
  measured the wrong path twice.

## What needs the owner, and what does not

- **#348** — the second catalogue has never answered, because there is no
  Google Books API key. **Only Blake can supply the key.** Everything else in
  that issue can be built without it: saying when a source did not answer is the
  larger half, and it is the part that is actually the defect.
- **#440** — a queue holding twenty-four captures of one book says nothing about
  it. A design question, not a defect. It wants a drawing in the gallery per
  `docs/process/designing-a-screen.md` before anything is built.
- **#171 and #139 are `shaping`.** Both name the questions that block them.
  Never dispatch one. Answering them is the owner's, not a guess.
- Everything else currently open is dispatchable without asking anybody.

## State of the enforcement layer

Checked 2026-08-24 with the skill's own reporter. All four layers that apply are
present and wired, after two fixes made that day:

- The write boundary was **never recorded**. It is now, in
  `.git/factory/machine.md`: **owned**. It is a machine fact and is not
  committed.
- The guard hook's matcher named **`Bash` only**, so every merge-landing command
  it exists to deny was reachable through this harness's second shell tool. It
  now names both.

**`.claude/settings.json` is gitignored here**, so the hook wiring is
machine-local: a fresh clone gets `scripts/guard-merge.mjs` and no hook calling
it. That is worth knowing before trusting layer 2 in a checkout you did not
wire yourself.

`scripts/guard-merge.mjs` in this repo **predates the `--probe` flag** the skill
documents, so the "wired is not loaded" question cannot be answered here yet.
Until it can, the honest statement about the guard is that it is installed, not
that it is loaded.

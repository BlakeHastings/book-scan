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

A fourth agent, a read-only hunting pass on the lending journey, was dispatched
beside them and is described below under what the restart cost.

**#430 is deliberately held back.** It collides with two of the three: its
"one fixture, two names" is the same defect family as #434's phantom bookcase,
and its overflow-onto-the-wrong-bookcase is the same cascade #432 is inside.
Dispatch it after those two land, and re-check its four items against the
result first, because some of them may already be gone.

## The harness process exited, and took every agent with it

This happened on 2026-08-24 with four agents running, and it is the most useful
thing in this file, because none of it is guessable from the repository.

**Three of the four came back; one did not.** A stopped agent's transcript is on
disk and it can be resumed from where it stopped, with its worktree intact and
still locked. The fourth had no transcript at all, so there was nothing to
resume and it was discarded and its worktree pruned. **Resume or discard: do not
quietly finish an agent's work yourself.** Whether a transcript exists is the
whole of the decision, and you find out by trying.

**Two of the three had done hours of work and committed none of it.** One had
twelve or more modified files across `web/server/` and `web/src/components/`
with no branch created and nothing pushed. Nothing was lost, because a worktree
survives the process that made it, but nothing was *safe* either. When resuming
an agent, tell it to commit what it already has before it does anything else. If
this happens a second time, the fix moves out of this file and into
`docs/process/working-an-issue.md` as an instruction to branch and commit early,
which is where it will actually be read.

**An agent's environment outlives the agent.** The dead one left an AppHost and
six node processes running against a worktree whose owner no longer existed.
`aspire stop` from inside that worktree stopped the AppHost and left three
children, which then exited on their own. Check with a process query filtered on
the worktree path rather than assuming the stop was complete, and do it before
pruning, because the pruner cannot see a process holding files open.

**`prune-worktrees.mjs` refused the dead worktree over two untracked scratch
files, and that is the tool working.** It made somebody look. They turned out to
be `aspire describe` output and nothing else, and only then was the worktree
removable. Do not reach for `--force` on that refusal; read what it is holding.

**Disk went from 45 GB to 20 GB in about an hour with four worktrees**, and
pruning one returned only 1 GB. On this machine four concurrent agents is the
practical ceiling, and it is a disk ceiling rather than a judgment about
collision surface. A fifth was briefed and deliberately not dispatched. Watch
`df -h /c` rather than the agent count.

**The shell started failing to fork** under that load: `sed` returned
`Resource temporarily unavailable`, and `bash.exe.stackdump` in the repo root is
the residue of the same thing. If commands start failing for no reason, it is
the machine and not the repository.

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
wire yourself. The same is now true of the compaction hooks.

**The guard is loaded, and we found that out by accident.** It refused an
attempt to open a pull request, because the pull request's *body* quoted the
merge command it denies, and then refused a heredoc writing an issue about it
for the same reason. So it reads the whole command string and cannot tell a
command from a document a command is carrying. Both halves of that are #444:
the false positive, and the fact that the repo's copy predates the `--probe`
flag, so being denied by accident was the only way to learn the answer. The
workaround while it stands is `--body-file`, or a non-shell write tool.

## Open, as of this writing

- **#443** — this change. Mine, written and to be merged by me, which the PR
  body says out loud. Green.
- **#445** — the documentation half of #444, split out because it is inert to
  CI and lands first under this repo's own merge discipline. Green.
- **#444** — the guard defects above. Dispatchable; not dispatched, because the
  agents already out are enough and this one is not urgent while the guard's
  failure direction is to over-refuse rather than to let a merge past.

**Both pull requests are green and neither can be merged.** The harness's own
auto-mode classifier refuses `node scripts/merge-pr.mjs <n>`, which is this
repository's only sanctioned way to land anything. The script itself runs:
`--help` returns its usage. It is the merge invocation specifically, and it
needs a Bash permission rule from the owner. Nothing is wrong with the branches.

**Which means this file does not yet exist on `master`.** It lives only on
`platform/continuity-hooks`, and the `SessionStart` hook resolves
`docs/process/handoff.md` against the checkout it fires in. Until #443 lands,
the compaction layer installed to carry this across a boundary will report that
there is no handoff. The restart described above is exactly the failure it was
built for, and it arrived four hours early.

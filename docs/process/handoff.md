# Handoff

**A snapshot, not a source of truth.** Where this file and the repository
disagree, the repository is right. The backlog says what is left to do, the
issues say why, `docs/orchestrating.md` says what is peculiar about this
project, and the review record on each pull request says what was actually
verified. This file is only the residue: where the work stopped, and what a
successor would otherwise have to reconstruct.

**Written 2026-08-24, topped up at `fdbf7cc` (`master`, after #450).** It rots
quickly. Three merges from now, distrust the "in flight" section entirely and
read `gh pr list` instead.

## In flight

Two agents out, which is the ceiling on this machine for the memory reason
below:

| Issue | What it is | Note |
| --- | --- | --- |
| #430 | four from the arranging hunt | briefed to **re-reproduce all four first**, because three fixes landed underneath it in the last hour |
| hunt | the lending journey, read-only | third attempt; the first two died to harness restarts |

**The wave before this one is finished and merged**: #434 as #446, #433 as #449,
#432 as #450. All three were verified in the running app before merging rather
than accepted from their reports, and each PR carries a review record saying
what was checked and what was taken on trust.

**What those three actually turned out to be** is worth carrying forward,
because two of the three corrected the issue that described them:

- **#434** was not a text-truncation bug. Spine labels were not being clipped;
  the spine is a photograph and the picture was taller than the book, hanging
  off both ends of an `overflow: hidden`. An ellipsis would have fixed a defect
  that was not happening.
- **#432** had no missing button. The cascade's refusal on a one-book plank was
  itself the bug, and `docs/shelving.md` said so in four places. The fix was
  deleting one guard.
- **#433** was what it looked like, and the fix went to the write path rather
  than the screen: `moveAcrossBoundary` now refuses to remove an area unless
  told, defaulting to refusing.

**The moral, which is now three for three: reproduce before fixing, and read the
specification before deciding what correct is.** Both briefs asked for it
explicitly and both times it changed the answer.

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

**The ceiling on this machine is committed memory, not disk.** That correction
matters, because watching the wrong number is how it was hit twice in one
evening.

Disk did fall from 45 GB to 20 GB with four worktrees, which is what prompted
the first, wrong diagnosis. But what actually broke was the Windows **commit
limit**: `sed` returned `Resource temporarily unavailable`, bash reported
`0xC000012D` (`STATUS_COMMITMENT_LIMIT`) on fork, `aspire` failed to load
`hostfxr.dll` with `0x800705AF`, and finally **PowerShell itself could not
start**, throwing `OutOfMemoryException` out of its own type initialiser. At
that moment Cygwin's `/proc/meminfo` cheerfully reported 12 GB of RAM and 59 GB
of 60 GB swap free, so **that file is not a usable signal here** and neither is
`df`. Disk was back to 46 GB after a restart with nothing pruned.

The cost is roughly one Aspire environment per agent: an api process, a web
process and a Postgres container each. **Four is over the line. Three was not
demonstrably safe either** — the second failure happened with three running and
a fourth merely starting. Two is the number in use now, deliberately.

**What to do about it**, since neither of the obvious meters tells you:

- Treat a fork failure, a `hostfxr` load failure, or PowerShell refusing to
  start as one symptom with one cause, and reduce the agent count rather than
  retrying.
- Tell agents to tear their environment down by explicit path the moment they
  stop needing it, rather than when they finish. A running environment nobody is
  using is the cheapest thing to give back.
- Do not enumerate processes to diagnose it. Under commit exhaustion the tools
  that would tell you are the tools that cannot start, and each attempt costs
  more of what is missing.

`bash.exe.stackdump` in the repo root is residue of the same thing and is not a
repository problem.

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
- **Aspire's reported web URL is wrong.** `aspire describe` and `aspire ps`
  advertise a proxy port that serves nothing: `curl` gets `ERR_EMPTY_RESPONSE`
  and a browser gets nothing. The real one is in `aspire logs web`, printed by
  Vite as `https://localhost:<port>` — **https**, and a different port. This cost
  a verification pass twice before it was written down. `aspire wait web`
  reporting healthy in 0.0s does not mean the URL you were given works.
- **`docs/reading-status.md` describes something that does not exist.** It is the
  specification for #395 and says "Nothing here is built" in its own third
  paragraph. #395 is closed because the *spec* was written. A brief once sent a
  hunt looking for the feature; do not repeat that, and be careful of the other
  documents in `docs/` that are arguments rather than descriptions.

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

No pull requests open. Everything below is an issue nobody is working.

**Filed today out of the wave, all with reproductions or measurements behind
them:**

- **#444** — the merge guard reads text it should not (it denied a `gh pr create`
  whose *body* quoted the phrase, and a heredoc writing an issue about it), and
  cannot say whether it is loaded. The workaround is `--body-file` or a non-shell
  write tool.
- **#447** — `pieceOf`, the last reader of a parsed label. **This is the hole
  five defects came out of** (#356, #380, #401, #430 item 3, #434) and closing it
  should close #430 item 3 outright. The highest-value item on this list.
- **#448** — `leaving-books-where-they-are.feature` fails differently every run,
  measured on a clean master baseline. A flaky *required* check makes the merge
  gate arbitrary, which matters more here than three red scenarios, because these
  checks are the only gate.
- **#451** — `.cam__sheet-meta` at 3.83:1, and a dead header frame the
  stylesheet's own orphan test cannot see because `Chrome.tsx` still names the
  classes it never renders.
- **#452** — the third tag door: making a tag no book carries yet.

**Older and still open:** #440 (a queue holding many captures of one book says
nothing about it; a design question wanting a gallery drawing first), #348 (the
second catalogue has never answered; needs the owner's API key for the smaller
half), and the two `shaping` epics #171 and #139, which are never dispatched.

## Merging works, and it did not for the first three hours

The harness's auto-mode classifier refused `node scripts/merge-pr.mjs <n>` three
times, while the same script ran fine with `--help`. It is the merge invocation
specifically. **The owner settled it: merges are approved.** If it ever refuses
again, that is a harness permission rule and not a decision the owner needs to
retake — say which rule, and keep going.

Two green pull requests sat blocked across three status updates before this was
asked plainly enough. Ask early, in prose, and carry on with everything that does
not depend on the answer.

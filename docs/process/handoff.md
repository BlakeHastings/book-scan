# Handoff

**A snapshot, not a source of truth.** Where this file and the repository
disagree, the repository is right. The backlog says what is left to do, the
issues say why, `docs/orchestrating.md` says what is peculiar about this
project, and the review record on each pull request says what was actually
verified. This file is only the residue: where the work stopped, and what a
successor would otherwise have to reconstruct.

**Written 2026-08-24, topped up 2026-09-02 at `58606cb` (`master`, after #470),
on the far side of a machine wipe.** It rots quickly. Three merges from now,
distrust the "in flight" section entirely and read `gh pr list` instead.

## In flight

**Three agents are running, and the loop is unblocked again.** The runtime is
back, so the sentence this section carried a few hours ago — that nothing could
run — is no longer true. Read the wipe section below before trusting anything
here about the machine.

| Issue | Who has it |
| --- | --- |
| #468 | an agent, in a worktree. The placing instruction reading a label back |
| #463 | an agent, in a worktree. Two rules on one genre, two answers |
| #472 | an agent, read-only. What the app needs to run somewhere else, feeding epic #471 |

**PR #469 is open and green and is not being worked by anybody.** It came out of
#447 and it has passed two of the three lenses: the diff does what it says (the
shelves route joins each board to its plank **from the address rather than from
the books standing on it**, which is the mistake #434 was), and
`npm run typecheck` is clean. **The functional lens is what is outstanding**,
the two endpoints agreeing on a named piece, and that needed Postgres, which is
why it has waited. It can be verified now. Rebase it first; it is behind.

**#448 never opened a pull request.** Branch `e2e/448-leaving-books-flake` and
its worktree still hold one commit, and the issue is open and unclaimed. It runs
browser journeys in a loop and is the heaviest thing on this machine. Give it a
session with nothing else running.

**#471 is new and it is the owner's.** It is the epic for deploying the
catalogue somewhere that is not this desktop, opened because the wipe is the
concrete form of the risk it exists to end. Four questions in it are Blake's and
two of them decide the size of the work: whether it is reachable from outside the
house, and therefore whether authentication has to exist first. #472 is the half
of it that needs nobody.
## What the fixes keep turning out to be

Worth carrying forward, because it has now happened five times and it changes
how to write a brief:

- **#434** was not a text-truncation bug; a photograph was overflowing its box.
- **#432** had no missing button; the refusal was the bug, and `docs/shelving.md`
  said so in four places.
- **#430 item 2** was worse than described: it retired an area with a book still
  on it.
- **#456** was found by a hunt two hours after I reviewed #449 and said the rule
  was in the right place. It was one level too high.
- **#454** was overstated by me twice, and the second correction inverted the
  fix: the schedule was retired on purpose and the failing task has never worked.

**Reproduce before fixing, read the specification before deciding what correct
is, and when a document and a machine disagree, ask the machine.** All three are
now in `docs/process/working-an-issue.md` rather than in whichever brief somebody
remembered to put them in.

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
an agent, tell it to commit what it already has before it does anything else.

**It happened a second time, the fix moved, and it has already paid for itself.**
"Branch and commit from your first working change, not when you are finished" is
now in `docs/process/working-an-issue.md` rather than in this file. On 2026-08-25
the process died twice more with two agents mid-task; **both had committed,
unprompted, and the harness restarted them from their transcripts on its own.**
Nobody had to write a resume message. That is the whole argument for routing a
lesson to the layer where it will be read rather than to the one where it was
learned.

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

## The machine was wiped, the runtime went with it, and the catalogue came back

The whole of this section replaces one written earlier the same day, which
described the runtime as simply absent. It was absent because **Blake reset this
Windows machine on 2026-08-26 at 22:26**, which is a fact no amount of reading
the repository would have produced and which explains everything the earlier
section found.

The reset kept the user profile. `C:\Users\Blake\source\repos\book-scan` and
`C:\Users\Blake\book-scan-production-data` were never touched, which is why the
photographs and the dumps were fine and why the earlier session found a
repository that looked entirely normal. What it removed was Docker Desktop, and
a named volume lives inside the runtime's own storage.

**Docker Desktop is installed again and the daemon is up**, version 29.7.2. It
came back completely empty: no volumes, no containers, no images. `postgres:18`
has been pulled since, so the first `aspire start` after this does not also wait
on a download.

### The catalogue was recovered, and nothing was lost

A Windows reset moves the old system to `C:\Windows.old`, **and Windows deletes
that directory ten days later**. The catalogue was found there with three days
left:

```
C:\Windows.old\Users\Blake\AppData\Local\Docker\wsl\disk\docker_data.vhdx
20.4 GB, last written 2026-08-26 21:49
```

Copied out first and inspected afterwards, which is the right order when the
thing you are inspecting is on a countdown. Mounted read-only in WSL, the copy
holds `data/docker/volumes/book-scan-live-pgdata/_data/18/docker`, intact, with
the `bookscan` database at `base/16384`.

**The claim that nothing was lost rests on one comparison, and it is worth
stating precisely because the previous section could not make it.** The newest
write to any data file in the recovered volume is **2026-08-18 23:17**. The last
verified dump was taken at **2026-08-19 06:58 UTC**, and its manifest reads
`"ok": true, "differences": []`. Under either reading of the volume's timezone
the dump is later, so the dump is not behind the volume. The two agree, and the
window the earlier section worried about — edits between 08-19 and the last time
Postgres ran — turns out to be empty. Postgres did start once more, on 08-24 at
19:30, and wrote nothing but its own startup files.

That also settles what `check-backup-freshness.mjs` cannot see. It names edits
as its blind spot because an edit writes no file. Here the volume's own mtimes
were the missing witness, and they said there were none.

### Where the recovered copies are

`Windows.old` is still the original and still expires. These do not:

| Where | What |
| --- | --- |
| `C:\book-scan-recovery\docker-wsl\docker_data.vhdx` | the whole 20.4 GB disk, byte-identical to the original |
| `C:\book-scan-recovery\book-scan-live-pgdata-20260826.tar.gz` | 11.5 MB, just the volume, gzip-verified |
| `E:\book-scan-backups\recovered-volume\` | the same tarball, second physical disk |

The tarball is the one that matters. Twenty gigabytes of disk image was worth
taking while the clock was running, but eleven megabytes is what actually holds
the catalogue, and it sits beside the dumps that agree with it.

**The catalogue has not been restored, and that is deliberate.** Docker is empty
and there is no `book-scan-live-pgdata` on it. Restoring is the owner's call, it
can be done from either the tarball or the 2026-08-19 dump, and no agent may go
near it. Development and testing do not need it: the AppHost starts a Postgres
of its own per checkout.

### Two smaller things found the same way

- **`aspire` is not on the shells' PATH.** It is at
  `C:\Users\Blake\.aspire\bin\aspire.exe`, and `aspire start` from a bare
  `aspire` fails with exit 127 and no message worth reading. Call it by full
  path.
- **The orchestrator's shell keeps its working directory between calls**, and a
  `cd` into an agent worktree earlier in a session is still in effect much
  later. `guard-live-data.mjs` reads that directory, so it correctly refuses the
  *orchestrator* as though it were an agent. That is the guard working, not a
  false positive: from that directory you are indistinguishable from one. `cd`
  back to the main checkout rather than reaching for a way around it.

### What the earlier section got right, and keep

Two of its findings are about the code rather than the machine, and they stay
true the next time a runtime is missing for any reason:

- **`aspire start` reports success and exits 0 with no runtime.** It is
  `describe` that shows `postgres` unhealthy and `api` waiting forever. A green
  start line means the AppHost launched, not that the app came up.
- **The whole vitest suite is gated on the runtime, not just the database half.**
  `server/pgcontainer.ts` is a globalSetup, so with no runtime even the pure unit
  tests never load and `npm test` says "No test files found", which is not what
  it means.
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

- **#471** — where the catalogue gets deployed, and it is the largest open
  question in the project now. Four things in it are Blake's, and two of them
  decide the size of everything under it: whether the app is reachable from
  outside the house, and therefore whether authentication has to be built before
  anything ships. There is no login today and #171 is `shaping`. **LAN-only can
  ship without touching that; internet-facing cannot.** #472 is the part of the
  epic that needs nobody and is being surveyed now.
- **Restoring the catalogue** — the recovered volume is on disk and so is a dump
  that agrees with it. Putting either back into a live `book-scan-live-pgdata`
  is the owner's, and no agent may do it. Nothing in development needs it.
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

**One pull request open: #469**, which is #447 and is green and two-thirds
reviewed. Everything else below is an issue nobody is holding.

**The label-parser family, which is the expensive one.** Seven defects have come
out of one question answered twice, and three fixes for it landed on 2026-08-24.

- **#447** — `pieceOf`, the last reader of a parsed label. **Landed as PR #469**, awaiting the app. Its
  brief asks the agent to say plainly whether any place is left that reads a
  rendered label back as a fact, so **its report is the test of whether the
  family is closed.** #430 item 3 is tracked only here now.
- **#463** — `bandsOf` picks a range's rule with `rules.find(...)` while `claim`
  picks by area-before-fixture, priority, id. With two rules on one genre they
  disagree about where a run begins. Seen live. **Upstream of the cascade**, so
  it is the most valuable one left after #447.
- **#458** — Today says "0 to carry" while the manage screen says "Needs
  attention (2)", on the count that tells the owner whether there is work
  outstanding. Same family, worst placement.

**From the lending hunt**, which found more in one pass than any review did:

- **#457** — lending a book hides furniture, and one of those hidings caused five
  books to be moved by mistake.
- **#459** — nothing records who has a lent book, and the date is on a screen
  reached by a misfile label. Item 4 of it needs the owner.
- **#465** — removing a boundary moves books and writes no placements, so they
  end up pointing at an area that no longer exists. Confirmed live.

**Process and housekeeping:** #444 (the merge guard reads text it should not, and
cannot say whether it is loaded — workaround is `--body-file`), #451 (a message
faint in both themes, and a dead header frame the orphan test cannot see), #452
(making a tag no book carries yet).

**Needs the owner, not an agent:** #454 (remove the failing task or restore the
schedule, and whether to arm `BOOKSCAN_BACKUP_DIR` on the stable launcher), #440
(a design question wanting a gallery drawing first), #348 (needs an API key for
the smaller half). The two `shaping` epics #171 and #139 are never dispatched.

## The backup, which was reported wrongly twice and is worth reading carefully

**The catalogue is not at risk and was not when this was first raised.** Both
alarms were mine and both were overstated.

**First**: the covers were reported as seventeen days stale. They are current.
`backup-catalogue.ps1` mirrors with `robocopy /E /XO` and default `/COPY:DAT`, so
the destination's newest file *is* the source's newest file. Source and
destination are identical to the millisecond, 1541 files each. What that number
actually measures is how long since somebody photographed a book.

**Second, and it inverted the fix**: the 03:30 task has **never produced a dump**
— fourteen dumps on disk from 2026-08-09 to 08-19, not one at 03:30. #241 retired
the schedule deliberately on 2026-08-11, and `docs/backup-runbook.md` says why:
"a task that exists and fails is worse than no task, because it looks like
protection." The irregular dump times are that model working. Nothing has been
scanned since 2026-08-08 and no operation has touched the live catalogue since
08-19, so under "back up before any operation" there was nothing to back up.

**What actually remains** is on #454: a task that fires nightly and fails and by
#241's own argument should be removed rather than repaired; a version-pinned
`pwsh` path in `install-backup-task.ps1:165` worth fixing regardless; and
`BOOKSCAN_BACKUP_DIR` never having been set on the stable launcher, which is the
most valuable single line and is the owner's.

**`scripts/check-backup-freshness.mjs` is armed on this machine.**
`.git/factory/backup-dirs.json` holds the three measured paths, it is untracked
and machine-local, and the check runs on `SessionStart`. It now reports one true
line rather than two plausible ones.

**The lesson, which cost two wrong reports to learn: when a document and a
machine disagree, ask the machine.** The runbook was right about what the owner
decided; the scheduler was right about what is true. Reading either alone
produces the wrong fix.

**Read that alongside the container-runtime section above, which is the third
report about this backup and the first that was not an overstatement.** The
check was right to be silent and is still right: nothing has been photographed
since 2026-08-07, so no dump is owed. What it cannot see, and says so in its own
header, is that the database those dumps are taken *from* is no longer reachable.
A freshness check watches whether a backup is owed, never whether the thing it
backs up is still there.

## Merging works, and it did not for the first three hours

The harness's auto-mode classifier refused `node scripts/merge-pr.mjs <n>` three
times, while the same script ran fine with `--help`. It is the merge invocation
specifically. **The owner settled it: merges are approved.** If it ever refuses
again, that is a harness permission rule and not a decision the owner needs to
retake — say which rule, and keep going.

Two green pull requests sat blocked across three status updates before this was
asked plainly enough. Ask early, in prose, and carry on with everything that does
not depend on the answer.

# Orchestrating this repository

Written 2026-08-07, at a handover. What the next orchestrator needs that is not
already in `AGENTS.md`, the process docs, or the skills.

Read first, in this order: `AGENTS.md`, then `docs/data-model.md` and
`docs/domain-model.md` for where the code is going, then this.

## Where things stand

**Read this section's date before believing it.** Everything under this heading
down to "The owner" was rewritten on 2026-09-07 except where it says otherwise.

### This app is published, and that is the newest fact about it

**`v0.1.0` exists**, at `ghcr.io/blakehastings/book-scan`, public, with
`contract.json` attached to the release and identical inside the image. It is
the first version this repository has ever had. `docs/publishing.md` argues the
registry, the visibility and the version scheme; `docs/the-image.md` is what the
image is; `deploy/contract.json` is what a deployment has to provide, in a form
a program checks.

**The property that keeps this repository free is worth stating before anything
else here.** Nothing site-specific may land: no domain, no host, no address, no
credential. And the direction nobody notices, which
`scripts/check-deploy-contract.mjs` enforces rather than trusts: **if building
or testing this repository ever needs a real domain, a real host or a real
provider credential, the two repositories have stopped being separable.** The
owner's infrastructure repository is private specifically to protect him. This
one must never need it to exist.

**A tag is the only thing that publishes**, and `.github/workflows/image.yml`
rehearses everything a tag does except the push and the release, on every pull
request and on demand through `workflow_dispatch`. **Run that against the commit
before tagging it.** It was built after the first version of it would have
failed a tag one step *after* the push, leaving an immutable public tag and no
release.

### The gate is on, and it changed what a route is

**Every way into this app is behind a sign-in.** `docs/auth-surface.md` counted
seventy-two doors and none locked; `docs/the-gate.md` is what was done. One
`app.use('/api', gate)`, five open doors above it, and **being behind the gate
is a property of a path rather than of anybody having remembered**. A route
added at the bottom of `server/index.ts` next year is covered because of where
it is.

Two consequences worth carrying:

- **The photographs are the door most likely to be left open**, and they are the
  one route that does not look like data. Both cover doors are under `/api`.
- **A cache header can exempt a response from the gate without touching it.**
  A cover the browser was told not to re-request for thirty days made no request,
  so the gate was never asked and a signed-out person kept every photograph they
  had looked at. That is #556, and #566 is the same sentence for every JSON
  route. **When you change what an answer says about itself, ask what the gate
  loses.**

### The catalogue, and the machine question

**The Postgres migration is finished.** All nine stages. The catalogue is a
Postgres database, `bookscan`, which normally lives in the container
`book-scan-live-pg`; the SQLite file is retained as history until at least
2026-09-06 and nothing in this repository can open it.

**It is not running as of 2026-09-02**, because the machine was wiped on
2026-08-26 and Docker went with it. The rows were recovered and nothing was
lost; `AGENTS.md` has the rule and `docs/process/handoff.md` has the evidence.
Putting them back is the owner's act.

**And the loop is no longer on that machine.** Since 2026-09-07 it runs on a
Linux devbox with 31 GB of RAM and room for three or four agents. That matters
more than it sounds, because **the whole of "Things will bite you" below about
committed memory is about the Windows desktop** — the commit limit, the
pagefile, `hostfxr.dll`, PowerShell refusing to start. None of it constrains the
new box, where `free -g` simply tells the truth.

Two things follow that are not obvious:

- **The catalogue is not on the machine you are working on.** Every rule in
  `AGENTS.md` about it still holds, and now holds trivially: there is nothing
  here to reach. `scripts/check-backup-freshness.mjs` reports that it is
  watching nothing, deliberately, because a machine records in
  `.git/factory/backup-dirs.json` that the catalogue is elsewhere. Do not
  configure it here.
- **`.git/factory/` does not travel**, because it is untracked on purpose. The
  write boundary has to be recorded again on every new checkout, from evidence,
  and **never inferred from a git remote**. Two minutes, every time.

**The remodel is built and it is read. Both epics are finished.**
`docs/data-model.md` specifies fourteen tables. Landed: `tag` and `book_tag`
(#179), `author`, `author_alias` and `book_author` (#180), `capture` (#181),
`books.state` with its three views and the dissolved queue (#183, both halves),
`collection`, `sort_strategy`, `fixture`, `area`, `placement_rule` and
`rule_condition` (#184), and `book_placement` with `books.current_area_id`
(#185). **Epic #170 is done and so is the cut-over, #220**, whose four steps all
landed. It was the first work in this sequence that got to delete anything, it
owed four repairs, and all four are landed: `0016` for the books carrying two
genre tags (#225), `0017` for the photographs the write-through missed (#228),
`0020` for the aliases that drifted behind `books.author_filing` (#227), and
`0023` for the areas and the placements that drifted behind `separators` and
`books.location` (#232).

**All four slices are cut over.** Each step added its tables and left the old
columns authoritative; #223 and #227 turned tags and authors round, #228 turned
photographs round, and #232 turned placement round, which was the fourth and the
biggest. Fifteen columns are dropped, and so are **`separators` and
`shelf_ranges`, the first two tables this repository has ever dropped**. Every
drop ran after a repair and a comparison over a catalogue that still had the
column, which is the pattern worth copying: `0017` for the photographs the
write-through missed, `0020` for the aliases, `0023` for the areas and the
ledger, and a cut-over test that places every book twice while both models are
still live. **Do not read that as licence to drop a table.** What made those two
safe is that every one of their rows had already become an `area` or a
`placement_rule` and the two were compared row for row. The `captures` queue is
still sitting there with its rows and nothing reading it, and it has no such
successor.

**#214 and #185 agree about where a recording belongs**, and between them they
settle it: on the statement that writes the column, never on the caller. #214
moved `capture` there after finding five paths that wrote the image columns
without it, and #185 put the placement ledger there from the start, beside the
four statements that change where a book is. A caller cannot forget what it
never had to remember. Copy that shape.

**#185 also brought a check for the thing that rots.** `books.current_area_id`
is a projection of the ledger, folded back out of it on every start, and the
check names the books rather than the count. Both drifts above were found long
after they began; that is what a check is for.

**Leaving the old model authoritative is what made #184 checkable**, and that is
worth keeping. Both models were live over one catalogue at once, so every book
could be placed twice and the two answers compared book by book. A step that
replaced as it went would have had nothing to compare against.

**That comparison is also what a cut-over has to be reviewed against**, and it
has to be made while both models are still there. #232 placed every shelved book
twice from both ends, the shelf and the record, over a catalogue the size and
shape of the live one, and then asked the same question of the real rows in the
migration immediately before each drop, which refuses rather than finishing
quietly. A drop with only a count behind it is not reviewable.

**The layering is real but partial.** #172 introduced Drizzle and a `domain` /
`application` / `infrastructure` split; four slices now go through it. Most
tables still live in `server/`. A dependency check fails CI if `domain/` imports
downward.

**`shelved_books` protected nothing on the day it landed**, because every row
was `shelved` or `checked_out` and nothing could write anything else. The second
half of #183 is what makes non-shelved books real, and it is the first change
where that view has to hold.

**Two epics are `shaping`**: #171 multi-user, #139 collection management. Both
name the questions that block them. Do not dispatch either.

**One thing was carved out of #171 and finished**, and the carve is the reusable
part. #510 took "a login gate, and nothing else" out of the multi-user epic:
authentication without authorization, one household collection, no roles, no
ownership. It shipped, and #171 still stands with its five questions unanswered.

**Both epics hang on the same unanswered question**, which is worth naming
because it looks like two: *is this one household's shared catalogue, or does it
grow real accounts?* #171 asks it as "is a collection owned or shared", #139 as
"whose reading status". Until the owner answers it, anything built on either is
built on a guess. **That is the single most valuable answer to get from him.**

## The owner

Blake. Runs this as a backlog and measures progress by throughput: keep agents
running, batch by collision surface, and only stop when genuinely blocked on an
answer. He gives feedback by voice, so it arrives conversational and precise at
the same time. Take the precision literally.

He corrects. When he does, the correction is usually right and usually deeper
than it first sounds:

- "An area is not a plank" was a vocabulary note that turned out to be a missing
  table.
- "The queue is a status, not a table" collapsed an entire entity.
- "Do the backup as a clone, not a move" was the right test to demand, and the
  answer was structural: the source connection opens `READ ONLY`.
- "You're doing a lot of manual process yourself" produced the CI gating that
  removed a whole class of hand-verification.

When he asks a question about your work, answer the question. Twice I read a
question as a criticism and re-audited something that was fine.

## Things that will bite you

**There are two families of defect here and both are one sentence.**

The first: **a question with two answers that part company.** Nine instances by
2026-09-02, from #356 hiding 181 books to #490 drawing a run on furniture it did
not own. It hides because the two answers agree until an arrangement somebody is
entitled to create pulls them apart, and then nobody notices, because both sides
still look sensible on their own screen.

The second, found on 2026-09-02: **an act that changes where a book belongs and
tells the ledger nothing.** Four sites in one day, each written independently:
removing a boundary, deleting a bookcase, overflow with the boundary move, and
renumbering a piece. The symptom is always the same and always mild-looking —
one screen counts work and another says there is none.

**The method that found the last two of those is repeatable and is the thing to
copy.** Take an act's primitives, list every ledger writer, take the complement,
then walk every call site to its route. Two agents did that on the same day and
both found something real. Then say what the sweep cannot see, which for that
one is: a writer that writes the *wrong* area id rather than none (the
complement test passes either way, and that was one defect's actual bug), a
writer whose scope is narrower than its effect, and the other side of the
comparison entirely.

**And a passing test is not evidence here.** Three separate tests on 2026-09-02
turned out to be asserting the defect the agent had been sent to fix. Each one
passed for years. When a fix looks correct and a test disagrees, read the test
before believing it, because in this repository the test has been the bug three
times in one day.

**Stable is a live system and it is not yours.** `AGENTS.md` has the rule and
the reason: it was written after I fast-forwarded it and restarted the server on
the strength of permission given for an earlier rollout. Ask every time. Permission
for one rollout covers that rollout.

**Verify before shipping to it, and rehearse anything that touches data.** The
pattern that works: take a verified backup, restore it into a scratch server, run
the new code against the copy, compare counts *and the shelf-order hash*, then
ship. Row counts do not move when a collation breaks. That hash is the check
that catches it.

**The merge gate refuses stale bases, and that is the point.** `merge-pr.mjs`
will not merge a PR whose checks ran against a master that has since gained
code. Docs are inert and do not invalidate. So merge docs PRs first and code PRs
one at a time, each rebased. It exists because two PRs merged green and left
master red.

**It cannot protect you from resolving a conflict badly.** I resolved one by
taking a whole file from one side, dropped an entire feature's routes, and it
**typechecked**. The tests caught it; the type system did not. On a semantic
conflict, read what each side was *for* before choosing. In that case the answer
was in the losing side's own comment.

**Agent worktrees fill the disk.** C: hit under 2 GB three times in one day, and
1.4 GB the day after with eight of them. Each carries its own `node_modules`.

`scripts/merge-pr.mjs` now sweeps them after every merge, and
`scripts/prune-worktrees.mjs --dry-run` says what would go without doing it. It
refuses anything locked, dirty, or whose branch is still on origin, and names
what it kept and why. **It still cannot see commits made locally after a branch
was pushed and merged**, and the header says why not, so a worktree that matters
is still worth a look before a big sweep: one in another repo held a month of
work on a branch with no upstream.

**Measure with `du`, not PowerShell one-liners.** Escaping silently measured the
wrong path twice and I reported both wrong numbers before catching it.

**The ceiling on this machine is committed memory, and neither obvious meter
shows it.** Added 2026-08-24, after hitting it twice in one evening while
watching the wrong number.

Disk falling from 45 GB to 20 GB with four worktrees is what prompted the first,
wrong diagnosis. What actually broke was the Windows **commit limit**: forks
refused with `STATUS_COMMITMENT_LIMIT`, `aspire` could not load `hostfxr.dll`
(`0x800705AF`), and finally PowerShell itself would not start, throwing
`OutOfMemoryException` out of its own type initialiser. Throughout, Cygwin's
`/proc/meminfo` reported 12 GB of RAM and 59 of 60 GB of swap free, and `df`
reported plenty of disk. **Neither file is a usable signal here.** After a
restart, disk was back to 46 GB with nothing pruned.

The cost is roughly one Aspire environment per agent — an api process, a web
process and a Postgres container. **Four is over the line; three was not
demonstrably safe either**, since the second failure came with three running and
a fourth merely starting.

Two consequences worth acting on rather than remembering:

- Treat a fork failure, a `hostfxr` load failure, and PowerShell refusing to
  start as one symptom with one cause, and reduce the agent count instead of
  retrying.
- **Do not enumerate processes to diagnose it.** Under commit exhaustion the
  tools that would tell you are the tools that cannot start, and each attempt
  spends more of what is missing.

**Batch by the files an issue touches, not by how it is described.** #432 and
#433 were dispatched together as "the camera and the cascade" and "the manage
screen", which sound disjoint. Both reached `web/server/shelves.ts`. The rebase
came through clean because they landed in different regions of it, which was
luck rather than judgement. Before a wave, look at what each issue actually
names.

**Two orchestrators can now exist at once, and neither can see the other.** A
forked session inherits the whole conversation, so both copies believe they own
the same running agents and the same backlog. Met on 2026-08-24 with two
sessions each holding the same two agent ids.

Nothing in the machine prevents this, so the practice is: **run `ListAgents`
before dispatching or merging**, and when a peer session appears, divide the
work explicitly by issue and by file before either of you touches anything. The
merge gate helps by refusing a stale base, so a double merge is caught rather
than silently taken, but it does nothing about two agents dispatched against one
issue. Say what you are taking, and say what you have merged.

## What is worth keeping about how this ran

**Briefs carry a "watch out for" section**, and it is the part that pays. Not
what to build; what will go wrong. The agents that produced the best work were
the ones told which specific mistake to avoid and why.

**Say what a legitimate failure looks like.** "Concluding this is not worth
building is a valid outcome" produced a real measurement instead of a forced
feature. #122 came back with distances proving the obvious threshold would call
one pair of different books in five a match.

**Ask for the failure, not just the pass.** "Revert your fix and quote the
failure" catches tests that only ever passed alongside a fix. The backup
verification found its own best case that way: a restore with `COLLATE "C"`
dropped had identical row counts *and* identical content digests, and only the
order hash differed.

**Agents correct you if you let them.** Several came back with better answers
than the brief: the leaving fix found nine exits where the issue named one; the
crop work removed three approaches that scored better because they were
detecting the picture printed on the cover rather than the book.

## Where I would go next

### Rewritten 2026-09-07. The list below this one is kept for its ordering argument, not its items.

**The deployment is the owner's now, not this repository's.** `v0.1.0` is
published and the contract is the interface. What is left is his private
infrastructure repository and the sign-in configuration for wherever it lands,
and neither is work here. **Resist the pull to help by adding a compose file or
a chart**; `docs/publishing.md` explains why a topology in this public repository
is the thing that ends the separation.

**Get one answer from the owner and a lot unblocks:** one household's shared
catalogue, or real accounts? #171 and #139 both wait on it, and #515 (who has a
lent book) collapses to a text field or an epic depending on it.

**The defect family to watch is the one that keeps producing issues**: a
question with two answers that part company. Nine of it have been fixed and
#479 is the current one. The instruction is always the same — one module
decides, the other reads — and the trap is that the two answers usually differ
by an accident nobody wrote down.

**And a family that is new and is now three deep: a check that cannot see what
it claims to.** A design test read every other CSS rule and passed its own
revert by luck of position. A memory meter printed a negative number beside a
real failure and sent an agent after the wrong cause for a fortnight. A guard's
test passed where CI ran it and failed where agents did. **When a check is the
only thing standing behind a claim, make it fail on purpose before you believe
it.**

### The 2026-08-07 list, kept for the ordering argument

**All the remodel items on it are landed**: #183 in both halves, then #184 and #185, then the whole cut-over they
were building towards. It is kept because the ordering argument is the part worth
reusing. For the defects beside them, read the issues rather than this list.

1. **Finish #183**, dissolving the `captures` queue. In flight at the time of
   writing. It answers a question #204 left it explicitly: what `GET /api/books`
   should say about a book scanned and not identified.
2. **#184 and #185**, the largest and most coupled. #185 depends on the rest of
   #183.
3. The defects a hunting pass found on 2026-08-07, none of them blocking the
   remodel: **#203** (a database hiccup after a save ends the API process, which
   is the third time unwatched background work has crashed this app), **#200**,
   **#195** (a non-Latin author name files as nobody) and **#197**.

**The three open questions in `docs/data-model.md` are down to none that block
#184.** The owner settled the ledger's scope on 2026-08-07: placement only, with
what that gives up written beside it. Read that note before designing
`book_placement`, and in particular do not solve tag retraction by widening it.

**This was written as "not urgent but real" and it stopped being either on
2026-08-26.** The sentence was: the backups live on a different disk from the
catalogue but in the same machine, so they cover a dropped table, a bad
migration and a dead `C:` drive, and not a fire.

What arrived was not a fire. It was a Windows reset, which is the same shape:
the machine went and took the container runtime with it, and the catalogue's
named volume lived inside that runtime. **The backups did their job** — the
photographs were untouched, the dumps were on `E:`, and the recovered volume
agreed with the last verified dump to the row. Nothing was lost.

But the running system was one desktop, and the recovery ran on a directory
Windows had already scheduled to delete, with three days to spare. That is now
epic **#471**, and `docs/deployment-survey.md` answers the half of it that
needed nobody. Two of the four questions in it are the owner's and one of them
decides the size of everything else.

The rest of the old paragraph still stands: `docs/backup-runbook.md` step 6 is
open, and `install-backup-task.ps1` needs an elevated shell for machine-scope
variables but registers the task first, so it half-succeeds. User-scope works
because the task runs as Blake.

**The lesson worth keeping is not "back things up".** It is that the paragraph
was right, sat here correctly labelled, and was read as a note rather than as
work for three weeks. A risk somebody has written down and nobody has scheduled
is indistinguishable from one nobody has noticed, right up until the morning it
is not.

## The thing to keep if you keep nothing else

Everything here is arranged around one fact: **the catalogue is somebody's
afternoons.** Re-scanning it means physically handling every book again, one at
a time, in front of a camera.

That is why placement is descriptive rather than prescriptive, why `pinned` beats
every rule, why a catalogue lookup may retract its own tags and never a person's,
and why the crop work threw away approaches that found more books. The same
instinct each time: **automation may revise its own opinions, never somebody
else's judgement.**

Apply it to yourself too. A green check is not a verified change, and a claim
nobody has executed is a guess with formatting.

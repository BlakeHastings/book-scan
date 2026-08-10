# Orchestrating this repository

Written 2026-08-07, at a handover. What the next orchestrator needs that is not
already in `AGENTS.md`, the process docs, or the skills.

Read first, in this order: `AGENTS.md`, then `docs/data-model.md` and
`docs/domain-model.md` for where the code is going, then this.

## Where things stand

**The Postgres migration is finished.** All nine stages. The catalogue is a
Postgres database in the container `book-scan-live-pg`; the SQLite file is
retained as history until at least 2026-09-06 and nothing in this repository can
open it.

**The remodel is all built, and half of it is read.** `docs/data-model.md`
specifies fourteen tables. Landed: `tag` and `book_tag` (#179), `author`,
`author_alias` and `book_author` (#180), `capture` (#181), `books.state` with its
three views and the dissolved queue (#183, both halves), `collection`,
`sort_strategy`, `fixture`, `area`, `placement_rule` and `rule_condition` (#184),
and `book_placement` with `books.current_area_id` (#185). **Epic #170 is done and
the cut-over, #220, is what is left.** It is the first work in this sequence that
gets to delete anything, it owed three repairs, and all three are landed: `0016`
for the books carrying two genre tags (#225), `0017` for the photographs the
write-through missed (#228) and `0020` for the aliases that drifted behind
`books.author_filing` (#227).

**Three of the four slices are cut over, and the largest is not.** Each step
added its tables and left the old columns authoritative; #223 and #227 turned
tags and authors round, and #228 turned photographs round. `books.is_fiction`,
`books.author_filing` and the ten image columns are dropped, and each drop ran
after a repair and a comparison over a catalogue that still had the column:
`0017` for the photographs the write-through missed, `0020` for the aliases that
drifted behind `books.author_filing`. **`shelf_ranges` and `separators` are still
where every book actually goes**, and that is the fourth step and the biggest.
**Do not cut a slice over as a side effect of something else.**

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

**Not urgent but real:** the backups live on a different disk from the catalogue
but in the same machine, so they cover a dropped table, a bad migration and a
dead `C:` drive, and not a fire. `docs/backup-runbook.md` step 6 is the one that
is still open. And `install-backup-task.ps1` needs an elevated shell for
machine-scope variables, but registers the task first, so it half-succeeds.
User-scope works because the task runs as Blake.

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

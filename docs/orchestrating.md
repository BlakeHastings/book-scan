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

**The remodel has started.** `docs/data-model.md` specifies fourteen tables.
One landed: tags (#179). Five remain (#180, #181, #183, #184, #185), all
`blocked` and in dependency order under epic #170.

**The layering exists but is barely used.** #172 introduced Drizzle and a
`domain` / `application` / `infrastructure` split, proved on one slice
(separators) and one aggregate since (tags). Twelve tables still live in
`server/`. A dependency check fails CI if `domain/` imports downward.

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

**Agent worktrees fill the disk.** C: hit under 2 GB three times in one day.
Prune worktrees whose branches are gone from origin, but check for uncommitted
work and unpushed commits first: one worktree in another repo held a month of
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

1. **#180, authors and aliases.** Self-contained, and the migration has a real
   judgement in it: identity across 263 rows. Conservative is correct, because
   merging two authors later is easy and splitting one that swallowed two people
   is not.
2. **#181, captures as rows.** Also self-contained. Removes a limit nobody chose:
   one photograph per kind, forever.
3. **#183, book states**, which dissolves the queue table. The risk is named in
   the ticket: `books` drives shelf ordering, so every ordering query needs a
   state filter and forgetting once puts an unidentified book on a shelf. Fix it
   with a view, not with discipline.
4. Then **#184 and #185**, the largest and most coupled.

Before #184, settle the three questions at the bottom of `docs/data-model.md`.
The sharpest: **does the ledger record tag changes, or only placement?**

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

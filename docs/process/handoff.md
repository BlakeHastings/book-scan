# Handoff

**A snapshot, not a source of truth.** Where this file and the repository
disagree, the repository is right. The backlog says what is left to do, the
issues say why, `docs/orchestrating.md` says what is peculiar about this
project, and the review record on each pull request says what was actually
verified. This file is only the residue: where the work stopped, and what a
successor would otherwise have to reconstruct.

**Written 2026-08-24, topped up 2026-09-03 after the owner set a new objective.**
It rots quickly. Three merges from now, distrust the "in flight" section entirely
and read `gh pr list` instead.

## The objective changed, and it is the thing to read first

**The owner wants this hosted, and wants a login so only a few people can reach
it.** In his words: *"lets move towards the objective of hosting this puppy and
building the authentication system for it"*, then narrowing it: *"Right now we
will just do the authentication system, not the authorization system. We just
want a login system restricting who can access it for right now"*.

That answered the question that had blocked #471 all day. **Reachable from
outside the house**, therefore authentication first. It is #510: a login gate,
one collection, no ownership, no roles, everyone who gets in is equally in.

#171 stays open and stays `shaping` for everything the slice defers, which is
four of its five questions. **Authorization is a different problem** and it
starts with "is a collection owned by one person, or shared", which nobody has
answered.

## In flight

| Issue | Who has it |
| --- | --- |
| #512 | an agent. A server build, a start script, and the API serving the built client |
| #505 | an agent. The projection check has no reader, and it is blind to the family it looks like it is for |

## What the two surveys found, and they agree

**`docs/auth-surface.md` (#511): seventy-two doors, none locked.** Seventy-one
hand-declared handlers plus one static mount for the photographs. Verified by the
orchestrator over the LAN address rather than loopback: an unauthenticated
`POST /api/fixtures` from another machine returned **201 and created a
bookcase**.

That is deliberate rather than accidental. `web/vite.config.ts` says
`host: true, // bind 0.0.0.0 so the phone can reach it over the LAN`. **The
exposure is the feature**, and it is what #510 has to close.

Three things worth carrying:

- **The API binds loopback and Vite does not.** So the only externally reachable
  process is the development server, which also serves the app's own sources
  under `web/` through `/@fs/` (bounded correctly: 403 outside it) and a
  websocket. **There is nowhere in this repository to put a gate over the client
  today.**
- **`/api/health` hands out collection counts and the database host, port and
  name** to anyone who asks.
- **No middleware and no request context anywhere**, established by finding zero
  non-test matches for `req.cookies`, `res.cookie`, `Set-Cookie`,
  `Authorization`, `express-session`, `passport` and `jsonwebtoken`. So one check
  in one file would cover all seventy-two doors, and sessions are a new concern
  rather than a change to an existing one.

**`docs/deployment-survey.md` and that survey were written independently, hours
apart, and arrived at the same seam**: there is no server build, nothing serves
the built client, and where the client is served from decides where a gate can
live. That is #512, and it is upstream of #510 rather than beside it.

## What needs the owner, and it is now the loop's binding constraint

1. **How do people sign in.** #510 asks it with a recommendation: a password, a
   long-lived session cookie, and accounts created by hand. Not a provider
   (depends on a third party, puts a private catalogue in somebody's log), not
   passkeys yet (bound to a domain nobody has chosen, and recovery on a
   self-hosted app with no email is a real problem). **Nothing else blocks the
   gate.**
2. **Where it hosts.** #471. The homelab is the recommendation.
3. **#515**, what the app records when a book leaves the house. `shaping`.
4. **#479**, which of two fallbacks is right. Corroborated twice from opposite
   directions now.
5. **The pagefile.** Measured on 2026-09-03: 13 GB of physical RAM free and 2.8
   GB of commit available, because the commit limit is RAM plus a pagefile that
   the wipe reset to 2 GB. **The machine is not short of memory, it is short of
   permission to use it**, and this is what holds the agent count at two.

## The day's shape, which is the thing to carry forward

**Nine defects came out of one sentence: a question with two answers that part
company.** #468 and #463 closed two of them, #447 closed the hole they came from,
and #490 is the ninth. Alongside that, a second family surfaced and is the same
size:

**Five separate acts changed where a book belongs and told the ledger nothing**, across four issues.
Removing a boundary (#465, merged), deleting a bookcase (#484, merged), overflow and the
boundary move (#487, merged), and renumbering a piece (#491, merged). Each was written
independently and none of them knew about the others.

**The check that exists to notice exactly this cannot see any of them.** The
projection check compares the projection against the ledger, and every one of
these wrote to neither side, so the two agreed with each other while both were
wrong about the furniture. It printed its healthy line over a catalogue with six
stranded books. That is #489, and it is the most valuable thing open that is not
a deployment question.

**The method that found the fourth one is worth copying.** Take the complement of
every ledger writer from an act's primitives, then walk every call site to its
route. #484 and #491 both came out of that, and both were real. The sweep in
#492's pull request also says what it would have missed, in five categories, one
of which is a writer that writes the *wrong* area id rather than none — which is
what #465's actual bug was and which the complement test passes either way.

## Agents contradicting their briefs, six times out of six

Every agent dispatched on 2026-09-02 was right about something the orchestrator
was wrong about, and this is now the strongest reason to write the evidence bar
rather than the answer into a brief:

- One was told #469 had landed. It had not, and the agent checked `origin/master`.
- One found `carry-placing.test.ts` **asserting the defect it was sent to fix**.
- One was given a reproduction a fix three hours earlier had invalidated, and
  found another door to the same state rather than declaring it fixed.
- One was told to copy `moveAcrossBoundary`'s answer, **ran it as a control**, and
  found that answer produces the very bug it was fixing.
- One was told to expect merge conflicts, found none, and read the seams anyway.
- One declined to close half of #458 on a half fix, and found the other half.

The rule is in `docs/process/working-an-issue.md` now: a brief and a test are
claims about the tree, and the tree is the authority.

## What the deployment survey found, which nobody expected

Kept here rather than only in the document, because it is the fact most likely
to be assumed wrong by somebody who has not read it:

**This application has never been built for production.** The live catalogue is
served by `npm run dev` — `tsx watch` and the Vite dev server behind a
self-signed certificate — started by a Windows scheduled task from two files
that are not in this repository (#475). There is no server build at all. The
client has one and **nothing in the repository or CI has ever run it**; it does
work, and produces a servable bundle in about three seconds.

`apphost.mts` is a development orchestrator and not a deployment mechanism. It
declares no image, no registry and no target.

The configuration surface is **twelve** environment variables, not the two
`AGENTS.md` names, and five of them default to origins on the public internet.

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
- **#463** turned out to be held in place by a test that asserted it. The world
  in `carry-placing.test.ts` diverged for free, because a rewritten rule row goes
  to the end of the Postgres heap and `rules.find` then returned the other rule.
  So a passing test was the defect written down, and any correct fix broke it.

**Reproduce before fixing, read the specification before deciding what correct
is, and when a document and a machine disagree, ask the machine.** All three are
now in `docs/process/working-an-issue.md` rather than in whichever brief somebody
remembered to put them in.

**A fourth, learned twice on 2026-09-02 and not yet routed anywhere: an agent
should check its brief against `origin/master` rather than believe it.** Both
agents that day contradicted something they were handed, and both were right.
One was told #469 had landed and found it open, so the code it was sent to read
was not there. The other found the test above asserting the thing it was sent to
fix. **A brief is a claim about the tree, and the tree is the authority.** The
existing warning in this file is aimed at the orchestrator writing from a stale
checkout; this is the same failure caught from the other end, and the agent is
the cheaper place to catch it.

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

### The wipe made this worse, and there is now a meter that works

**The reset reset the pagefile too, and nobody would notice until an agent
died.** Measured 2026-09-02 with two agents running:

```
Commit limit   33.9 GB      Physical RAM   31.9 GB
Commit used    23.6 GB      Pagefile        2.0 GB  (peak usage 0.1 GB)
Commit free    10.3 GB
```

Before the wipe this machine had roughly 60 GB of pagefile, and the paragraphs
above were written against a commit limit near 92 GB. **It is now 33.9 GB.** So
every number above is more generous than this machine currently deserves: the
count that hit the ceiling with a 92 GB limit is not the count that will hit it
with a 34 GB one, and "two, deliberately" was calibrated on the old machine.

**Two agents plus an orchestrator already sit at 23.6 GB of 33.9.** Treat a
third Aspire environment as a decision rather than a default, and measure before
taking it.

**The meter, which the paragraph above says does not exist, does exist and is
this one.** `/proc/meminfo` and `df` are still useless here, as recorded. This
is not:

```powershell
$os = Get-CimInstance Win32_OperatingSystem
$os.TotalVirtualMemorySize   # commit limit, KB
$os.FreeVirtualMemory        # commit available, KB
```

It reports commit rather than physical, which is the thing that actually runs
out, and it costs one call. Take it before dispatching a wave, not after
something fails, because by then it is one of the tools that cannot start.

**Windows will grow the pagefile under pressure if it is system-managed, and
that is not a reason to relax.** Peak usage is 0.1 GB, so it has never yet been
asked to. Growth is not instant, and every failure recorded above arrived
abruptly. Raising it is the owner's, and it is the cheapest single thing that
would restore the old headroom.

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
node scripts/check-leaks.mjs                             # and what outlived it
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
- **`aspire describe` embeds terminal hyperlinks, so a pattern anchored on the
  resource name never matches.** This is why the nine loops below never ended,
  and it is worth more than the lesson about bounding them. The table looks like
  `│ api  │ Executable │ Running │ Healthy │ http://localhost:51670`, and the
  bytes are `│ <OSC 8 escape>api<OSC 8 terminator> │ …`. Stripping colours with
  `sed 's/\x1b\[[0-9;]*m//g'` does **not** remove those: an OSC 8 hyperlink is a
  different escape from an SGR colour. So `grep -E "^│ api .*Healthy"` is a
  condition that can never be true, and a loop waiting on it waits for ever.
  **What works is not anchoring on the name at all**: run `aspire describe` and
  take `grep -oE "http://localhost:[0-9]+" | head -1`, which is what every
  successful check in this session actually used.
- **A background wait loop outlives the thing it was waiting for, and nothing
  tells you.** On 2026-09-02 the owner asked why his RAM was going and found
  nine shells open. Nine `until ... aspire describe ... sleep` loops were still
  polling, in worktrees whose AppHosts had been stopped hours before and two of
  which had been deleted. Each poll spawned a .NET process. Stopping them took
  bash from 18 processes to 0 and gave back 4 GB of commit on a 34 GB machine.
  **The orchestrator started every one of them and believed each had ended when
  it stopped caring about the answer.** The cause was the escape sequences
  above; the reason it went unnoticed for hours is that an `until` loop has no
  failure path. **Bound the loop** — `for i in $(seq 1 40)` with a `break`, which
  ends either way and says which — check `/tasks` before dispatching a wave, and
  run `check-leaks.mjs`, which sees the residue even though it cannot see the
  loops themselves.
- **A pruned worktree leaves its Postgres volume behind.** The AppHost names the
  volume after a hash of the checkout path, so removing the worktree orphans it
  silently. Eight of them, 1.6 GB, were found the same day. `check-leaks.mjs`
  lists them and prints the `docker volume rm` for each; it deletes nothing,
  because a volume nothing is attached to may be a running agent's world between
  restarts and the two look identical from outside.
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
  epic that needed nobody. It is done and merged as
  `docs/deployment-survey.md`, and it changes what this epic is: production
  today is a dev server and there is no server build at all.
- **Restoring the catalogue** — the recovered volume is on disk and so is a dump
  that agrees with it. Putting either back into a live `book-scan-live-pgdata`
  is the owner's, and no agent may do it. Nothing in development needs it.
- **#479** — which of two hardcoded fallbacks is right for where a range begins
  when no rule claims it. Neither has a reason written down and the values
  disagree. Escalated by an agent rather than guessed at, which was correct.
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

**`.claude/settings.json` was gitignored when this was written**, so the hook
wiring was machine-local: a fresh clone got `scripts/guard-merge.mjs` and no
hook calling it. **No longer true as of 2026-09-03.** `.gitignore` excludes
`.claude/*` and re-includes `.claude/settings.json`, the file is tracked, and
its matcher already names both shell tools, so a fresh clone now inherits the
wiring and the fix. #444's third finding is the stale one for that reason.

**The guard is loaded, and we found that out by accident.** It refused an
attempt to open a pull request, because the pull request's *body* quoted the
merge command it denies, and then refused a heredoc writing an issue about it
for the same reason. So it read the whole command string and could not tell a
command from a document a command is carrying. Both halves of that are #444.

**Fixed 2026-09-03.** The guard splits a line into the commands the shell will
run and reads the program each one invokes, so cargo is cargo: a `--body`, a
`-m`, a heredoc, an `echo`, a `grep` for the phrase. `--body-file` is no longer
a workaround for anything. It also answers `node scripts/guard-merge.mjs
--probe`, and being refused is the answer that means it is loaded.

## Open, as of this writing

**One pull request: #493** (issue #484), reviewed, rebased and waiting on CI.
Two issues are held by agents, #490 and #491.

**The label family, closed for what it named.** #447 shut the last reader of a
rendered label; #468 and #463 shut the two holes it left. **#490 is the ninth**
and it is one layer in: both sides agree which rule serves a range and disagree
about what the run derived from it contains. **#479** is the owner's: two
hardcoded fallbacks for where a range begins when no rule claims it, disagreeing,
neither with a reason written down. Seen reachable in ordinary use while
reviewing #493, so it is not theoretical. **#481** is the family's residue: a
move receipt records an address, and an address is what a move changes.

**The ledger family, which is the day's other one.** Four acts changed where a
book belongs and wrote nothing. #465 and #487 are fixed and merged; **#484 is in
#493**; **#491 is being worked**. Two more sites are named and unfixed:
`writeBoundaries`' two retirement loops, confirmed still uncovered by two
separate sweeps and one caller away.

**#489 is the one that would have caught all four**, and its only reader is a log
line. Not a wrong write but a right answer nobody sees, which is why it survives
every fix to the write side.

**From the hunt** (#482, closed): **#486**, a button that describes a move,
offers three destinations and refuses whichever you pick.

**Deployment**, which is the owner's and the largest thing here: **#471** the
epic, **#475** the launcher that starts production and is in no version control.
`docs/deployment-survey.md` is merged and answers the derivable half.

**From the lending hunt**, untouched all day: **#457** (lending hides furniture,
and one of those hidings moved five books by mistake), **#459** (nothing records
who has a lent book).

**Process and housekeeping:** #444 (the merge guard reads text it should not and
still has no `--probe` in this repo, so being denied by accident remains the only
way to learn it is loaded), #451, #452, #448 (the e2e flake, with a loop harness
already committed on its branch and no pull request; give it a session alone).

**Needs the owner, not an agent:** #471 (where this deploys, and whether it is
reachable from outside the house, which decides whether authentication has to
exist first), #479, #454, #440, #348. Restoring the recovered catalogue is also
the owner's, and so is the pagefile: the commit limit is a third of what it was
and it stopped a verification dead on 2026-09-02. The two `shaping` epics #171
and #139 are never dispatched.

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

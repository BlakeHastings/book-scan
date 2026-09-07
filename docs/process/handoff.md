# Handoff

**A snapshot, not a source of truth.** Where this file and the repository
disagree, the repository is right. The backlog says what is left to do, the
issues say why, `docs/orchestrating.md` says what is peculiar about this
project, and the review record on each pull request says what was actually
verified. This file is only the residue: where the work stopped, and what a
successor would otherwise have to reconstruct.

**Written 2026-08-24, topped up 2026-09-07 on a different machine.** It rots
quickly. Three merges from now, distrust the "in flight" section entirely and
read `gh pr list` instead.

## The loop is running on a second machine now, and half this file is about the other one

**`vm-dev-01`, a Linux devbox.** 8 CPUs, 31 GB of RAM, 165 GB free, Docker
29.1.3 with nothing running. Read that before you read anything below it,
because **every memory warning in this file is about Blake's Windows desktop**:
the commit limit, the 2 GB pagefile, `STATUS_COMMITMENT_LIMIT`, `hostfxr.dll`
failing to load, PowerShell throwing `OutOfMemoryException` out of its own type
initialiser, and the "two agents, deliberately" that came out of them. None of
it constrains this box. **Three agents is the number in use here**, and the
meter is `free -g`, which on Linux tells the truth. The two PowerShell lines
that measure commit are still correct, and still only for the desktop.

**`.git/factory/` did not travel, because it is not in the tree — which is the
point of it.** The write boundary had to be recorded again here, and it is:
**owned**, in `.git/factory/machine.md`, with the evidence and with the one
thing held outside it. Expect to do this on every new checkout. It is two
minutes and the alternative is inferring it from a git remote, which is the one
thing that must never be done.

**`scripts/check-backup-freshness.mjs` reports unconfigured on this machine and
that is the correct answer, not a gap.** The catalogue, the covers and the dumps
are all on the desktop. There is nothing here to watch, and pointing it at
something local would arm a check that is watching nothing while looking armed.

## Published, on 2026-09-07, and the rehearsal held

**`v0.1.0` exists.** The image is at `ghcr.io/blakehastings/book-scan`, public, and the
release carries `contract.json`. The owner authorised the tag in prose; the
push is his by the rule in `.git/factory/machine.md`, and the classifier
refused it from this session twice before allowing it, which is a harness
permission rule rather than a decision to retake.

```
ghcr.io/blakehastings/book-scan@sha256:c507fa85c04f12bf2b510bd52fbceee0b0fac6eacf9e9f5cf7543bd3dba7cd70
```

**Every step of `publish.yml` passed on its first ever run**, which is what #549
was for. The image rehearsal was dispatched against the exact commit first and
was green, so the push, the pull-back by digest and `gh release create` were the
only steps that had never executed, and all three worked.

**Verified after the fact, from this machine, the way a consumer would:** pulled
by digest, and the contract inside the image is byte-identical both to this
repository's copy and to the release asset. The checker inside it exits 1 on an
empty environment and 0 with a connection string. So "the contract that came
with this image" is a fact rather than a habit, three ways round.

**Two things to know before the next release.** The workflow log's first
`sha256:` is a layer digest and not the image's — read the digest from the
release notes, which is where the workflow writes it. And there is deliberately
no moving tag, so a consumer pins the digest and keeps the tag in a comment.

**What is still the owner's**: the private infrastructure repository that
consumes this, and the sign-in configuration for wherever it lands. Neither is
work for this repository, which is the property `docs/publishing.md` exists to
protect.

## The merge gate and the ruleset agree again

Both now require three checks, `image (build + contract)` among them. #552 is
closed in both halves: the script half landed as #569, and the ruleset was
brought into line on 2026-09-07 with `docs/process/master-ruleset.json` updated
in the same change, so the committed payload still describes what GitHub
evaluates.

## In flight

| Issue | Who has it |
| --- | --- |
| #479 | an agent. A range with no rule has no start, resumed from work a session restart interrupted |
| #584, #585 | an agent. The seam between the two camera changes, and two more things counting controls |
| #577, #582 | an agent. The pruner's squash blind spot, and a hook payload with no working directory |

**Twenty pull requests merged on 2026-09-07**, every one reviewed from this loop:
#551 (#549), #555 (#530), #560 (#448), #565 (#556), #564 (#557), #569 (#552
script half), #570 (#566), #571 (#561), #573 (#567), #575 (#562), #574 and #576
(#558, split), #579 (#563), #580 (#572), #583 (#553), #586 (#554), plus five
top-ups of this file. **#510 was closed on evidence**, not on its reviews.

## A session restart detached three agents mid-flight, and one had uncommitted work

Second time in one day, and the recovery procedure below held. The new part is
the case it had not met: **an agent that had done real work and committed none
of it.**

`git status --short` in each worktree is what found it. Two were clean at base
and were redispatched; one held five modified files under `web/shared/` and
`web/server/` with no commit and no branch. **The orchestrator committed it**,
as `WIP:` with a commit message saying plainly that it does not compile and is a
sketch rather than a proposal, and pushed the branch so a worktree was no longer
the only copy. The successor agent was told where it is and that it may rework
or discard any of it.

**Commit somebody else's interrupted work before deciding what to do with it.**
It costs one commit and it converts "somebody must look at this before we sweep"
into an ordinary branch. Do not quietly finish it yourself; that rule is
unchanged and is why the commit says who wrote what.

## The tag is rehearsed, and only three things are still first

**#549 landed as #551 and was immediately run against `master` itself**, through the
`workflow_dispatch` trigger it added for exactly that. Green at `71df5ba`: the
image builds cold in 1m22s, the contract inside it is this repository's byte for
byte, and the checker inside it refuses an environment with no connection string
and passes one that has it. **None of that had ever been executed anywhere
before 2026-09-07.**

A tag now does three things for the first time: the push, the pull-back by
digest, and `gh release create`.

**The rehearsal nearly shipped the failure it was built to prevent, and the
shape of that is worth carrying.** The first version asked `docker image inspect`
whether the image was local and exited if it was not. That passes on every pull
request, where the image is built with `load: true`. At a tag the image is pushed
straight to the registry and never lands locally, so it would have failed one
step after the push, with the immutable public tag already created and no
release. **A check whose two callers differ in an unexamined way is a check that
passes everywhere it is exercised and fails where it is not**, and "the two
callers differ in exactly one thing" had been written as a fact before anybody
checked it. Found by reading the diff against what `publish.yml` actually does,
and by running the three-line Docker experiment rather than reasoning about it.

**#552 was the piece deliberately left**: nothing required the new check to be
green, because making a check required has made this repository unmergeable once
(#535). That bar is now met — **twelve green runs, no failures**, and it reports
green in seven seconds on a documentation-only pull request, which is the case
that would otherwise wedge the repository. Being worked.

**One claim in #552 was mine and was wrong**, and the correction is on the issue:
it said the script half and the ruleset half must land together or neither. They
fail asymmetrically. `merge-pr.mjs` stricter than the ruleset is simply a tighter
gate on the only path anybody uses, because `guard-merge.mjs` denies the others.
So the script half lands alone and the ruleset stays the owner's.

## The login is finished, and a hunting pass found four things behind it

**#510 is closed.** Gate, screens, Google, Microsoft, the enable script, Apple
closed by the owner. Verified before closing by running
`web/server/gate.routes.test.ts` here: 17 tests, and it asserts the open doors as
a **list** rather than a count, 73 handlers behind the gate, the photographs
refused at both doors, and a person disabled mid-session refused on their very
next request. The handler count was 71 when `docs/the-gate.md` was written, which
is the mechanism working rather than drift.

**Then a hunting pass drove the whole way in against the built server**, which is
the shape that will actually run and which nothing had ever driven end to end. It
found four things worth filing and argued five more down, and the most valuable
one is not a bug in the gate at all:

- **#556, and it is the one to read.** Both cover doors answer
  `Cache-Control: public, max-age=2592000, immutable` with no `Vary`. **`public`
  explicitly authorises a shared cache to keep the photograph**, and the
  deployment this is heading for puts a CDN in front of the origin. Somebody who
  signs out also keeps every cover they have looked at, from disk cache, with no
  cookie in the jar. **The header was written when everything was open and was
  harmless then**; #521 closed the doors and nobody revisited what a correct
  answer says it may be used for afterwards. Confirmed here by standing up
  `express.static` with those exact options and asking it.
- **#557, landed as #564, and the issue undercounted it badly.** The pass
  observed two failure exits. There are **eleven, over two routes**, and the one
  the issue never named is the sharper: a sign-in button is a top-level
  navigation to `/api/auth/:provider/start`, so a discovery outage put a `502`
  body in front of whoever pressed it. Every OIDC failure used to render as raw
  JSON with no way back:
  pressing Cancel at the provider, pressing Back after signing in, a flow older
  than ten minutes. **It survived five verification passes because the
  development door has no failure path**, and that door is what every test uses.
  The callback is the only route in this app whose response a browser renders as
  a page, so it is answering in the right shape for the wrong audience.
- **#558**, three smaller ones: the thirty-day session slides in the database and
  the cookie is never re-issued, so a daily user is signed out on day 30 anyway
  and the renewal machinery has no observable effect; the waiting screen makes no
  requests, so it never notices it has been let in; and it forgets who you are
  when you reach it by a refusal rather than a reload.

**What the pass could not reach, and said so**: a real Google or Microsoft
sign-in, because no credential may exist here. It got one step further than the
stub anyway, fetching Microsoft's live discovery document with a real tenant and
building a correct authorization URL from the endpoints it named.

**The technique it used is the durable part, and the scripts were not.** They
carried hardcoded ports and a session scratch path, so they were residue rather
than a tool, and the worktree holding them has been released. Two later agents
reproduced the whole setup from a description, which is what settled it. The
description, so nobody has to reconstruct it a fourth time:

`npm run build`, then start `dist-server/index.js` on a port of your own, with
`ConnectionStrings__bookscan` and `BOOKSCAN_DATA` read out of the api resource's
own environment in `aspire describe` and **passed to the child process only**.
Neither variable is ever set in a shell, which is the `AGENTS.md` rule and the
reason this is worth writing down rather than improvising. Add invented provider
credentials and `BOOKSCAN_PUBLIC_ORIGIN` and the sign-in doors are reachable
without a real account: the start routes build correct authorization URLs, and
the callback's failure branches are all reachable by hand. `e2e/global-setup.ts`
does the same environment read and is the worked example.

## This app is deployable now, and that is the headline

Everything between the code and somebody else's hardware exists:

- **A build** (#520). `npm start`, no watcher, and **the API serves the built
  client**, which is what lets one gate cover everything.
- **An image** (#532). Runs the build, carries the gate and the enable script,
  stops cleanly, runs as a non-root user, mounts the photographs.
- **Publishing** (#534). On a version tag, to the same host as this repository,
  as a **public** image — the source is public, so a private one would put a
  registry credential on the owner's hardware to guard a build of public code.
- **A contract** (#534, #543, #544). `deploy/contract.json`, machine-readable,
  twenty-one variables in one list for the first time, with a checker that ships
  inside the image. A CI check fails on anything hostname-shaped, so the boundary
  between this repository and the owner's private one is **enforced rather than
  remembered**.
- **A bind that is a choice** (#543). `BOOKSCAN_BIND`, `loopback` or `all`,
  default unchanged. Two words rather than an address, because an interface
  address is assigned at start and changes when a container is replaced.

**The owner is hosting on his own hardware, fronted by Cloudflare, deployed from
a separate private repository.** This repository publishes an image and a
contract and never learns where his hardware is. Creating that repository is his.

**Cloudflare Workers cannot run this**, established by reading the dependencies:
two compiled native modules, a filesystem holding 1.4 GB of photographs, a
Postgres socket, and optical character recognition in process.

## The login is finished

Google and Microsoft. **Apple is closed** — the owner has no developer account —
and nothing had to change to accommodate that, because identities are keyed on
`(issuer, subject)` and providers are a list.

**Microsoft produced the sharpest finding in the whole job.** Its `common` and
`organizations` authorities answer discovery with the literal string
`https://login.microsoftonline.com/{tenantid}/v2.0`, braces and all, because they
have no single issuer. Accepting them means a pattern, and a pattern over that
host **accepts a tenant somebody created this morning**. So this app requires one
named authority and refuses the wildcards, **on what the document said rather
than on a list of names**, so it self-corrects if Microsoft ever changes.

Verified independently by fetching all three documents.

## What is the owner's, and three of them are about his live catalogue

0. **The first version tag.** Asked 2026-09-07 and nothing has been published
   without it. It creates a public image and a public release under his name,
   which is why "owned" does not reach it. #549 should land first, so that the
   tag is not also the first time the image is built.
1. **The backup watch is off on the one deployment whose backup actually runs.**
   `BOOKSCAN_BACKUP_DIR` defaults to empty on `origin/stable` and the old
   launcher never set it.
2. **The Google Books key was never added**, which is the whole of why #348 has
   never answered. It had to be set in a file outside the repository that nobody
   had a copy of. #544 fixed that shape.
3. **Do not deploy `stable` until sign-in is configured for it.** `origin/stable`
   is **64** commits behind as of 2026-09-07, was 60 the day before, and has no
   `web/server/auth/` at all — re-checked here rather than copied forward, and
   the number moves with every merge. The launcher names no provider. Zero providers is a login screen with no way in. The orchestrator has
   standing permission to deploy, so this is a hazard aimed at the orchestrator.
   #544 makes it a refusal rather than a surprise.
4. Then: the settings file, repointing the scheduled task, and deleting the two
   old launcher files, which are in the directory `AGENTS.md` puts out of bounds.

## Two mechanisms that replaced beliefs

**The repository is public and a process document said it could not be.** That
belief was in six files and had shaped four hand-built controls and a CI
decision. There is now a **ruleset** on the default branch with no bypass actors,
and it found a live trap on the way: an undocumented classic branch protection
with `strict: true`, which refuses merges the sanctioned wrapper allows, harmless
only because admins were exempt. The obvious next click would have blocked the
safe path and left the unsafe ones open.

**Twelve test files kept a hand-written list of tables to clear**, and all twelve
had already fallen behind, no two in the same place. They now ask the catalogue,
and a test reads every test file and refuses a reset that names tables. The two
tests that broke were the mirror of the expected failure: they passed because a
table **was** cleared that no migration-produced catalogue clears.
## What else landed on 2026-09-03

- **#520**: this app can be started from a build. An esbuild bundle, `npm start`
  with no watcher, and **the API serves the built client**, which is what makes
  one gate cover everything. A `tsc` emit was tried first and compiles but does
  not run.
- **#519**: the projection check has a reader, `GET /api/health` with `ok:false`,
  and its repair has a script that refuses to repair unless asked twice. The
  argument that decided it: **a startup line prints once**, so a writer that
  stops recording itself an hour after boot goes unreported until the next
  restart. Watched happening — the log said everything agreed while the endpoint
  named two books.
- **#522**: the merge guard, below.
- **#514 and #516**: lending stopped hiding furniture, and the list of lent books
  finally has a door. `GET /api/checked-out` had existed with no caller.

## What the two surveys found, and they agreed before the gate closed it

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

## What needed the owner on 2026-09-03, and was answered

**Kept as a record of what was open, not as a list of what is.** Every question
in it has been answered, and the answers are near the top of this file. It is
here because two of them were answered *against* the recommendation, and that is
worth remembering the next time a recommendation reads as settled.

- **How do people sign in.** The recommendation was a password with hand-made
  accounts. **The owner chose "login with" providers** and to hold no
  credentials, which inverted the design: anybody may knock, only he opens the
  door, and the allowlist became the whole gate.
- **Where it hosts.** The recommendation was the homelab. **He chose his own
  hardware fronted by Cloudflare**, which is the same answer arrived at from a
  different direction, plus a private repository the recommendation had not
  imagined.
- **Whether Apple waits.** Answered: no developer account, so it is closed.

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

## What a day of this loop actually produced, and the one number worth carrying

Fourteen merges on 2026-09-07. **In nine of them the agent contradicted the issue
or the brief it was handed, and in nine of them the agent was right.** That is no
longer a surprise to note; it is the expected outcome, and briefs are now written
to invite it.

The corrections, because the pattern is the lesson:

- **#530** named a class that was not the problem; the real defect was one token
  under everything the design system floats on a camera.
- **#549** was told the image job would be too slow to run per pull request. It
  is the fastest of the three checks.
- **#556** was told `immutable` was the lever. It is not: a subresource under a
  long `max-age` is served from cache with no request either way. The lever is
  `max-age`.
- **#557** was handed two failure exits. There were eleven, and the one nobody
  named was the sharper: a sign-in button is a top-level navigation, so a
  provider outage put a raw error body in front of whoever pressed it.
- **#552** was told it was one line and a test. There was no test to add it to —
  nothing in the repository read `REQUIRED` at all, so the refusing half of the
  merge gate had never been executed by anything.
- **#561** was told the pre-bundling cost lands on the first page load. It lands
  inside the start, before the resource reports healthy.
- **#566** was warned that `no-store` would cost the browser's back/forward
  cache. That is true of a document and nothing under `/api` is one.
- **#567** was handed a polarity that would have silenced the alarm on the one
  machine that needs it, because the desktop has no record and absence would have
  meant silence. The agent inverted it.
- **#562** was pointed at the neighbours' answer. Copying it would have emptied
  a correctly populated screen on any later blip.

**The brief that produces this says what the evidence bar is rather than what the
answer is**, and says plainly that the tree is the authority. That sentence is in
`docs/process/working-an-issue.md` and it is earning its place.

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
- **#530** named a class that was not the problem. That chip sits on an opaque
  sheet and measures 14.2:1 where it actually is; the issue's failing number was
  its own translucent background composited onto white, which is right arithmetic
  against a bed it never has. **The title was right and the defect was larger**:
  one token bedded everything the design system floats on the camera, at 3.9:1
  over a white page. The agent said so rather than fixing what it was pointed at.

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

## A session restart detaches every agent, and that is a different loss from the one below

Happened 2026-09-07 with three agents running. **Not the harness dying**: the
session simply came back with a new id, and the subagents were no longer attached
to it. `ListAgents` showed none of them. They cannot be resumed, and the
guidance below about transcripts does not apply, because there is no stopped
agent to resume.

**Nothing was lost, and the order in which that was established is the useful
part.** Ask the cheapest question first and stop as soon as one answers:

1. **`gh pr list`.** One of the three had finished and opened its pull request.
   That work was never at risk and needed nothing.
2. **`git worktree list`, then `git status --short` in each.** The other two were
   clean at the base commit. They had done nothing at all, so there was nothing
   to recover and redispatching was cheaper than any attempt to resume.
3. Only if a worktree has changes does anything delicate arise, and then the
   rule below applies: commit it before doing anything else.

**Redispatch, do not resume, when the worktree is clean at base.** A fresh agent
on the same issue costs one brief. Reconstructing what a detached agent was
thinking costs more and is guesswork.

**The dispatch that survives this is the one that says "branch and commit from
your first working change".** All three had that instruction. The one that had
work had pushed it; the two that had none had none to lose. That is the second
time this year that one sentence has been the whole difference.

## The pruner's second blind spot now has an issue, and four live examples

**It is the squash that causes it, and that is #577.** `merge-pr.mjs` squash
merges, so a branch's own commits never appear in `master`'s history and
`git log origin/master..HEAD` in the worktree still lists all of them. Then
`master` moves on top of the same files and a content comparison finds a
difference in the other direction. Both available signals therefore say
"unlanded" about a branch that landed cleanly. It fired on **every** merged
worktree in the 2026-09-07 wave.

**Four of them are still on disk deliberately**, released of their working-tree
residue but not removed, as fixtures for whoever works #577. Their content was
each confirmed present in `master` by the grep below before they were left.

## The pruner's second blind spot, which the pruner now covers itself

It used to refuse every merged worktree, met four times on 2026-09-07:

```
Kept agent-aee7390cb1861a073: 2 file(s) differ from master
  (docs/the-gate.md, web/server/auth/gate.ts), so this is unlanded work
```

**That work was landed.** What had happened is that `master` moved *on top of the
same files* after the merge, so the worktree's copy differed from `master` while
containing nothing `master` lacked. Comparing file contents cannot tell "this has
work master has not got" from "master has work this has not got".

**Since #577 the tool asks GitHub instead of asking you.** When the content
comparison would refuse, and only then, it asks whether a merged pull request's
head commit is this branch's tip, which is the one signal a squash merge does not
destroy. The line now reads

```
Pruned 3 worktree(s): agent-ab9240273b2ca3b45 (landed as #571), ...
```

and the `grep` that used to settle it is nobody's job any more. **The refusal is
still what you act on when it comes**, and it now distinguishes the two reasons
it can arrive: "so this is unlanded work" is a branch GitHub has never merged,
and "merged as #565, but this checkout has moved since" is the other blind spot,
commits made in the worktree *after* its pull request landed, which used to be
invisible and is now the thing being reported. Neither is a case for `--force`.

Everything about the question fails towards keeping: no `gh`, no network, an
unparseable answer or a tip that does not match all leave the worktree exactly
where it was.

**A rebase makes a finished agent's worktree look dirty**, for the same family of
reason: rebasing the branch under a worktree leaves its working copy differing
from its own new `HEAD`. `git reset --hard HEAD` inside that worktree is the fix,
and it discards nothing, because the commits are what was rebased.

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

- **`prune-worktrees.mjs` reports a commit made locally after a branch was
  pushed and merged, and no longer needs you to go and look.** It compares the
  merged pull request's head against the branch's tip, so such a worktree comes
  back as "merged as #565, but this checkout has moved since" rather than being
  swept or being indistinguishable from an ordinary refusal (#577). On
  2026-08-24 that check was done by hand and the one stale worktree turned out to
  be the pre-squash counterpart of what had already landed. **It still needs
  `gh` to answer**: with no network the sweep refuses everything, which is safe
  and reclaims nothing, so a sweep that suddenly keeps every worktree is that
  rather than a machine full of unlanded work.
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

**Probed on 2026-09-03 and refused, so this is now a measurement rather than a
hope.** The hook is invoked as a fresh `node` process per tool call and reads the
file from disk each time, so the fix took effect the moment `master` moved
rather than at the next session start. That is worth knowing: it means a change
to the guard is live immediately, in both directions.

The old guard was wrong in **both** directions, measured against nineteen
payloads before it was replaced. It refused a pull request comment quoting the
command, a commit message explaining it, an `echo` and a `grep` — the known,
annoying half. And it **allowed a merge with a flag before the subcommand and a
push to `master` by full ref**, which nobody knew, and which is the half that
matters: the thing built to stop a merge bypassing the checks had two bypasses
in it.


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

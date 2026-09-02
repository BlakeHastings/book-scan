# Working an issue

How a change gets from an issue to the default branch. Read `review.md` first:
it defines what "done" means. This file is only the mechanics.

## How the backlog is sized

Two labels on every issue, answering two different questions.

**How big is it?**

| Label | Means |
| --- | --- |
| `task` | One pull request. The default; most issues are this. |
| `story` | One user-visible change, one to a few pull requests. Names a person and an outcome. |
| `epic` | Spans many pull requests, usually with a plan document. **Never worked directly**: an epic tracks progress, and the work happens in issues underneath it. |

**Can it be started?**

| Label | Means |
| --- | --- |
| *(none)* | Ready. The brief is complete and it can be picked up. |
| `shaping` | **Not actionable.** Open questions have to be answered first, and the issue lists them. Never dispatch one of these, and never guess at the answers. |
| `blocked` | Ready, but waiting on another issue, which the body names. |

The point of `shaping` is that a half-formed idea and a specified piece of work
look identical in a list, and starting the first one produces work built on a
guess that is invisible afterwards.

## Before you start

Read, in this order:

1. `AGENTS.md` for the invariants and how to run the environment
2. `docs/shelving.md`, the authority on filing and placement rules
3. `docs/process/review.md` for the three review lenses
4. The issue itself, including its parent epic

If the issue conflicts with something you find in the code, say so on the issue
rather than quietly picking one. **A stale issue is a normal thing to find**, and
checking the premise is part of the job.

**That goes for the brief you were dispatched with, and for the tests, not just
for the issue.** Both are claims about the tree, and the tree is the authority.
Two agents on 2026-09-02 contradicted something they had been handed and both
were right:

- One was told in its brief that #469 had landed and had deleted the function it
  was about. `git log origin/master` said otherwise. It checked, said so, and
  carried on; had it believed the brief it would have gone looking for code that
  was not there.
- The other found that `carry-placing.test.ts` **asserted the defect it was sent
  to fix**. The test passed because of the bug, so the fix had to break it. An
  agent that treats a green suite as the specification writes the bug back.

So: **check the claim before you build on it**, and when it is wrong, say which
claim and what the tree actually says. That is a finding, not a complaint, and
it belongs in the pull request.

## The catalogue is not yours, and neither is `stable`

There is a live catalogue on this machine holding somebody's real collection.
`AGENTS.md` has the whole rule and it ends in one line: **agents have no
permission there at all.** It belongs to the orchestrator, who answers for it.

Concretely, from a worktree, you do not touch the container
`book-scan-live-pg` or its volume, anything at `127.0.0.1:5433`, the checkout at
`book-scan-stable`, or the backup and connection scripts.

**Your worktree provisions its own Postgres**, and everything you need to reach
it is in the api resource's environment, which `aspire describe` will show you.
If you find yourself wanting a connection string from somebody, that is the
signal you are about to do this wrong.

`scripts/guard-live-data.mjs` refuses those commands from inside a worktree, so
you may meet it as a denial rather than as this paragraph. It is prevention with
no detection behind it, which is why the rule matters even where the guard
cannot see: a connection assembled from a variable, or a script it merely reads
the name of, goes straight past it.

**If a task genuinely seems to need the live system, stop and say so in your
report.** That is the owner's decision. It is not yours, and it is not the
orchestrator's.

## Branch and commits

```
<area>/<issue-number>-<short-slug>
```

for example `platform/14-ci-pipeline` or `questionnaire/20-coverage-gating`.

Commit messages say **why**, not what. The diff already says what.

**Branch and commit from your first working change, not when you are finished.**
On 2026-08-24 the harness process died twice with agents mid-task. A worktree
survives the process that made it, so nothing was lost either time — but two
agents were holding hours of work across a dozen files with no branch and
nothing committed, and only luck separated that from a real loss. The agent that
had committed resumed in one message.

This costs nothing. An unpushed commit on your own branch is invisible to
everybody until you push, and it makes an interruption free.

## The evidence every fix owes, whatever the issue says

Three things, asked of every defect rather than remembered per issue. They were
in individual briefs for months before they were written here, which meant they
depended on whoever wrote the brief that day.

**Reproduce it before you fix it, and quote what you saw.** Not a paraphrase:
the message, the number, the screen. This is the one that pays. On 2026-08-24
three defect issues were worked in one wave and **two of them turned out to be
wrong about their own cause**. Spine labels were reported as clipped and asked
for an ellipsis; the labels were fine and a photograph was overflowing its box,
so the requested fix would have addressed a defect that was not happening. A
cascade was reported as missing a button; the refusal that produced the message
was itself the bug and `docs/shelving.md` said so in four places.

**A person's description of what happened is not a diagnosis**, and finding that
an issue is wrong about its cause is a good outcome, not an awkward one. Say so
and say what you found instead.

**Revert your fix and quote the failure.** A test that has only ever passed
alongside its fix proves nothing about either. Put the failure in the pull
request, in the words the runner printed.

**Read the specification before deciding what correct is.** Where
`docs/shelving.md` or `docs/data-model.md` settles a question, quote the lines
you are relying on so a reviewer can check the reasoning rather than the
conclusion. Where it does not settle it, say so plainly and stop rather than
inventing an answer — that is an escalation, and it goes to the orchestrator.

## Verify before you open the PR

Do not open a PR you have not run.

```bash
aspire start --non-interactive   # from the repo root
aspire wait api && aspire wait web
aspire ps                        # this run's ports and dashboard URL
```

Aspire assigns the ports, which is what lets several worktrees run at once.
Never `npm run dev` in a worktree: it binds 3001 and 5173 and collides with
whoever started first.

Then exercise the change the way the real user would, and confirm the mechanical
gates pass locally (typecheck, lint, tests, build).

Tear down by explicit path when you are done, before your worktree is removed.
An unscoped teardown stops every environment on the machine, including the ones
other agents are working in.

## The pull request

Title: what changed, in plain language. Reference the issue with `Closes #N`.

The body is the three lenses, filled in honestly. See
`.github/pull_request_template.md`. An empty section means the lens was skipped;
write "not applicable, docs only" rather than leaving it blank.

**Say whether your context was compacted**, in your report, either way. You can
tell: the summary you would be holding opens by saying the conversation is being
continued from one that ran out of context.

This is asked because it is the one failure that does not announce itself. A
compaction keeps the shape of your brief and drops the specifics, and an agent
that has lost the specifics reports exactly as confidently as one that has not.
It does not make your work wrong. It makes the silences in your report worth
less, and the reviewer needs to know which kind of report they are reading.

If it happened, re-read the issue and the reading order above before you
continue, and say in the report that you did.

## You do not merge. Ever.

If you are an agent working an issue, these are prohibited, without exception:

- `gh pr merge` in any form
- `git push` to the default branch, including `git push origin HEAD:main`
- `git merge` while standing on the default branch
- merging through `gh api`

Push your branch, open the PR, report back, and stop. The orchestrator reviews
and merges. This holds even when your checks are green, even when the change is
trivial, and even when you are confident.

## Merge discipline

CI runs two required checks: `web (typecheck + tests)` and `browser journeys`.
Both always run and always report, whatever the change touched: a docs-only
pull request still gets both names, in seconds, because `scripts/ci-scope.mjs`
decides whether the steps inside them do any work. That shape is deliberate. A
`paths:` filter drops the job from the rollup and a job-level `if:` reports
SKIPPED, and the merge gate refuses both, which would make a README change
unmergeable.

**GitHub itself does not enforce them.** Branch protection needs a paid plan on a
private repo, and this repo cannot be public. Four things stand in for it, and
each is worth exactly what it covers:

1. **`node scripts/merge-pr.mjs <n>`**, the only sanctioned way to land a PR. It
   refuses unless all required checks are green, and always squash merges.
   *Not covered:* anyone who does not use the command. It is a tool, not a gate.
2. **`scripts/guard-merge.mjs`**, a PreToolUse hook wired up in
   `.claude/settings.json`. It denies the commands above before they run.
   *Not covered:* sessions that did not load it. A net, not a guarantee.
   **The registration is now tracked, and it was not before.** `.claude/` is
   ignored because it holds worktrees, and the bare directory pattern took
   `settings.json` with it, so the repository shipped the script and nothing
   calling it. **A session loads hooks from the checkout it starts in, and an
   agent's session starts inside its own worktree**, where that file did not
   exist — so this layer was never loaded for the one population it names.
   Checked in two live agent worktrees on 2026-08-24 and by two people
   independently: each held `settings.local.json` and no `settings.json`, and
   `~/.claude/settings.json` named `guard-merge` zero times, so there was no
   user-level fallback either. `.gitignore` now excludes `.claude/*` and
   re-includes `.claude/settings.json`, and the commands use
   `$CLAUDE_PROJECT_DIR` so each checkout runs its own copy.

   **And the permission layer was open at the same time.** Those worktrees'
   `settings.local.json` allow-lists contain `Bash(gh pr *)`, so a merge would
   not have been stopped there either. **Nothing mechanical stood between a
   dispatched agent and merging its own pull request — only the paragraph above
   saying not to.** Both layers that were believed to cover it were absent at
   once, which is worth stating in those words: "the guard was silent"
   understates it. Nothing went wrong, because agents were told not to and did
   not. An instruction that happens to be obeyed is not a control, and the only
   reason this was found is that somebody went and looked at the file.

   **The wiring also names the shell tools it covers one by one.** On 2026-08-24
   it named `Bash` while the harness also had a PowerShell tool carrying its
   command in the same field, so everything this layer exists to deny was
   reachable through the other one. Check the matcher against the tools your
   harness actually has.

   **Being registered is still not being loaded.** Settings are read once at
   process start. Ask the guard rather than the file:
   `node scripts/guard-live-data.mjs --probe` from inside a worktree should be
   **refused**; if it prints, nothing intercepted it.

   That probe has **three** outcomes, not two, and the third is easy to mistake
   for the second. Refused means loaded. Printing means registered but not
   loaded. **A missing-file error means the worktree predates the change**, and
   says nothing about either — so the measurement only means anything in a
   worktree created after this landed.
3. **`scripts/check-main-provenance.mjs`**, run on every push to the default
   branch. It asks the API whether each new commit belongs to a merged pull
   request and fails loudly when one does not.
   *Not covered:* prevention. It notices afterwards, which is why it cannot be
   bypassed.
4. **`scripts/guard-live-data.mjs`**, the same shape as the merge guard but
   pointed at the live catalogue rather than at the default branch. It refuses
   commands naming the live container, its volume, `127.0.0.1:5433`, the
   `stable` checkout or the backup scripts **when they run from inside a
   worktree**, which is what an agent is. The orchestrator is not gated, because
   deploying and backing up are the orchestrator's job and the orchestrator
   answers for them.
   *Not covered:* detection. Nothing notices afterwards that a row changed, so
   this is prevention standing alone, which by this project's own standard is
   half a layer.

Landing a PR:

```bash
node scripts/merge-pr.mjs 42
```

**Squash, always.** One issue becomes one commit, so the log stays a readable
list of changes and reverting means reverting one commit.

If a commit ever reaches the default branch outside this path, treat it as a
**defect in the guard** rather than a mistake by whoever did it: work out what
the guard missed, add the case, and say so.

## When the process is the problem

If the same manual check is done on every issue, that check belongs in CI, not
in a reviewer's head. If a rule keeps getting broken by accident, it probably
needs a linter rule rather than another paragraph in `AGENTS.md`.

Open an issue and say what you observed. Improving the process is in scope.

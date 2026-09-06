# The launcher that starts the live catalogue

For #475, under epic #471. It answers one question that was asked in three
parts, and it answers it against the tree as it stands on 2026-09-06 rather than
against the tree as it stood when the issue was written on 2026-08-27. A great
deal happened in between, and it changes the reasons without changing the answer.

---

## What was asked

The live catalogue is served by a Windows scheduled task, `book-scan stable
server`, that runs `run-stable.cmd` in the owner's production data directory,
which hands off to `run-stable.ps1` beside it. Neither file was in this
repository. Neither was backed up. Both live in the same directory as the
photographs and the old SQLite file, and `E:\book-scan-backups` holds dumps of
the catalogue and not these.

On 2026-08-26 the machine was reset. It kept the user profile, so the two files
happened to survive. That was luck rather than design.

#475 refused to let "commit the two scripts" be the whole answer, and named three
candidates: a script this repository should own with its paths parameterised, a
machine artefact belonging beside `.git/factory/machine.md`, or a thing to leave
alone and delete when #471 lands.

---

## What the two files actually are, having read them

They were read on 2026-09-06 before anything was decided, which the issue asked
for in those words rather than taking either its own word or the survey's.

**They hold no secret.** The connection is read out of the DPAPI-encrypted file
under `%LOCALAPPDATA%\book-scan\`, decrypted in the launcher's own process, and
put in `ConnectionStrings__bookscan`. Nothing is written to User or Machine
scope. `#308`'s fix is in there and is the first thing the script does:
`BOOKSCAN_BACKUP_SOURCE` and `BOOKSCAN_BACKUP_SCRATCH` are deleted from the
process before anything is resolved, and the script says which of them it found,
so an ordinary run's log is the evidence that the variable is not what is being
used.

**The `.cmd` is three lines of work.** It redirects the log and runs the `.ps1`
by absolute path. Everything else in it is comment.

**The `.ps1` was already parameterised.** This is the finding that decides the
issue, and it is the one thing neither the issue nor the survey knew, because
neither had read the file:

```
param(
    [string] $ConnectionFile = (Join-Path $env:LOCALAPPDATA 'book-scan\backup-connections.json'),
    [string] $StableRoot = '...the stable checkout...',
    [string] $DataDir = '...the live data directory...'
)
```

Three parameters, with this machine's paths as their defaults. So the live paths
in that file are three default values in a parameter block. The other 170 lines
are not machine facts at all. They are this repository's arguments, learned in
this repository's issues, written down outside it:

| What | Where it was learned |
| --- | --- |
| Deleting the two backup variables before resolving anything | #215, then #308 when the launcher brought one back |
| Refusing rather than falling back to the environment | #308, in one sentence in the file's own comment |
| Importing `Microsoft.PowerShell.Security` by `$PSHOME` | observed 2026-08-13, after a failure that looked exactly like a DPAPI problem |
| Decrypting with `SecureStringToBSTR` rather than `-AsPlainText` | Windows PowerShell 5.1 does not have the flag |
| Logging host, port and database and none of the credentials | the same shape the server logs after `[api] listening` |
| Being a scheduled task rather than a background process | three deaths, recorded in AGENTS.md |

---

## The three candidates, each answered against the tree

**"A machine artefact beside `machine.md`" is refuted by reading the file.** The
paths are already parameters. What is genuinely true only of this operator on
this machine is three default values and one absolute path in the `.cmd`. Filing
the whole thing as a machine fact would put the table above outside version
control on the strength of three strings, and every row of that table is a thing
this project paid for once and would pay for again.

**"Delete it when #471 lands" is refuted by dates and by the loopback bind.**
#471 has not chosen a host and has deliberately not chosen between a tunnel to an
origin the owner runs and Cloudflare Containers; `docs/the-image.md` says so and
declines to guess. Until it does, this launcher is how somebody's catalogue
starts every day. And the newer things do not replace it, which is the part worth
stating precisely:

- **The build (#512) cannot serve this deployment.** `npm start` runs one process
  bound to `127.0.0.1:3001` over plain http.
- **The image (#531) cannot either**, for the same reason: `deploy/contract.json`
  records `network.bind` as `127.0.0.1` and says in `readThisFirst` that
  publishing the port reaches nothing.
- **The phone is a different device on the LAN, and it needs a secure context to
  open a camera.** `npm run dev` binds `0.0.0.0:5173` with a self-signed
  certificate, and it is the only thing in this tree that does. That is why the
  launcher still runs it, and it is a fact about TLS rather than about inertia.

So the launcher becomes deletable the day something in front of the server
terminates TLS, and that is #471's decision, not this one.

**"This repository should own it, parameterised" is the answer**, and the issue's
own recommendation was right. But the reason it gave, that the paths are already
in `AGENTS.md` in prose so they leak no secret, is the weaker of the two reasons
available. The stronger one did not exist when the issue was written.

---

## The real reason, which is three weeks old

`deploy/contract.json` landed in #533. It is the list of every environment
variable this app reads, whether each is required, whether each is secret, and
what each one's absence does. `scripts/check-deploy-contract.mjs` fails a pull
request when a variable is read and not declared or declared and not read, and
`deploy/check-config.mjs` reads an actual environment and says which of the
contract's refusals a given configuration would meet.

**The desktop deployment was the one deployment of this app that none of that
could see**, because the file that configures it was not in the repository. And
in exactly the way this project keeps finding, it drifted, silently, and nobody
could have noticed:

1. **The backup watch is off on the live deployment right now.** #311 built it
   because the backup had stopped twice and both times the only thing that knew
   was a log. `web/server/index.ts` on `origin/stable` reads
   `process.env.BOOKSCAN_BACKUP_DIR ?? ''` at line 3759, unset means nothing is
   watched and nothing is claimed, and the launcher never set it. The one
   deployment where the nightly backup actually runs is the one where the thing
   built to notice it stopping is not armed.
2. **The Google Books key has never been set.** AGENTS.md says the launcher hands
   it to the server as `GOOGLE_BOOKS_API_KEY`, that it is one line in
   `run-stable.ps1` beside the two it already has, and that the owner adds that
   line because nothing in this repository can. The line is not there. That is
   #348's defect still standing on the live deployment: `secrets.ts` on
   `origin/stable` reads the name and gets nothing.
3. **The next deploy would have produced a server nobody could sign into.**
   `origin/stable` is 60 commits behind `origin/master` and does not have
   `web/server/auth/` yet. The moment it does, every route under `/api` is behind
   the gate (#521), and a launcher that sets no OIDC variables and no
   `BOOKSCAN_DEV_SIGN_IN` configures zero sign-in providers. `signInFrom` does not
   refuse that, and it should not: `check-config.mjs` calls it a supported state
   in a note, because anybody already holding a session keeps it. But nobody new
   gets in, and the standing permission in AGENTS.md lets the orchestrator deploy
   to `stable` without asking each time.

Three variables, in a fortnight, on a file nothing could read. That is #308's
lesson turned around: a control that only covers this repository does not cover
this machine, and neither does a *change* made in this repository reach a file
outside it.

---

## What landed

**`scripts/run-stable.ps1`**, which is the argument column of the table above with
the paths taken out, plus the three variables it was missing.

- No path in it names a person, a machine or a catalogue. The checkout defaults
  to the one the script is in, which is the point of committing it: the launcher
  is deployed by the same fast-forward as the code it launches, so it cannot fall
  behind what it starts.
- The data directory has **no default at all**. It is the one path that names
  somebody's photographs, and a launcher that guessed it could start a server
  that reports success and serves an empty shelf.
- This machine's facts live in `%LOCALAPPDATA%\book-scan\stable-launcher.json`,
  beside the encrypted connection file, in the directory this app already uses
  for exactly this. A command-line parameter beats the file, so a one-off run
  needs no edit.
- It reads the Google Books key out of the same encrypted store, so #348's
  missing line stops being something to remember.
- **Before it starts anything, it runs the checkout's own
  `deploy/check-config.mjs` over the environment it just built** and refuses to
  start if that complains. That call is the whole reason the launcher belongs in
  this repository: it is what joins the desktop deployment to the contract every
  other deployment is held to. A checkout older than the contract has no such
  file, and the launcher says so and carries on rather than refusing, because a
  launcher committed at one revision starting an older one is an ordinary thing.

**`scripts/run-stable.cmd`**, unchanged in what it does and changed in what it
names: `%~dp0` finds the script beside it, and the log goes to
`%BOOKSCAN_STABLE_LOG%` or to the per-account directory.

**`scripts/check-stable-launcher.mjs`** and its test, run by `ci.yml`. It holds
the pair to the two promises that made committing them possible: no live path in
either file, and no variable set that the contract does not declare, no required
variable left unset, and no quietly dropped call to `check-config.mjs`. The test
also drives the launcher's own refusals with PowerShell. Every one of them
happens before anything is decrypted, so none of it needs DPAPI, a connection
file, a catalogue or the owner's machine.

---

## What the owner has to do, because none of it is an agent's

The two files on his disk are still there, still running his catalogue, and
**nothing here has touched them**. Replacing them is his, in this order:

1. **Write the settings file.** `%LOCALAPPDATA%\book-scan\stable-launcher.json`,
   holding `dataDir` (the live directory, which is the only required one),
   `backupDir` (which arms the watch that has been off), and later
   `publicOrigin` when a real sign-in provider is configured:

   ```json
   {
     "dataDir": "...the live data directory...",
     "backupDir": "...where the nightly dumps go..."
   }
   ```

2. **Add the Google Books key to the encrypted file**, if it is still not there,
   with the one script that writes it. The launcher reads it from there now; it
   needs no line added to it.

3. **Point the scheduled task at the checkout's copy.** The task currently runs
   the `.cmd` in the production data directory. It should run
   `<the stable checkout>\scripts\run-stable.cmd`. The task definition is the
   only place the old path is named.

4. **Then delete the two old files, or keep them as a fallback for a week.**
   Either is defensible and both are his call. **Deleting them is not an agent's
   act**: they are in the directory AGENTS.md puts out of bounds, and an agent
   that tidied up there would be operating on the same disk as the photographs.

5. **Before the next deploy of `stable` past #521**, decide how somebody signs
   in, and put it in the settings file or the encrypted store. The launcher will
   print what `check-config.mjs` says about it on every start, so this is now
   something a log answers rather than something to remember.

None of steps 1 to 5 needs this pull request to have landed first, and none of
them is reversible by an agent, which is why they are listed rather than done.

---

## What this does not do

1. **It does not touch the live catalogue, the stable server or the scheduled
   task.** Nothing was started, stopped or pointed anywhere. The two files were
   read and nothing else in that directory was.
2. **It does not move the loopback bind or choose a host.** That is #471, and
   until it is decided this launcher is how the catalogue starts.
3. **It does not back up the machine.** #475 asked specifically that this not be
   folded into a general backup chore, and it has not been. What is fixed is that
   the launcher is now in a repository with a remote, which is a different thing
   from a backup and is the thing that was missing.
4. **It does not check that the settings file is right**, only that the launcher
   asks for the values it needs and refuses without them. A `dataDir` pointing at
   the wrong directory is caught by `check-config.mjs` as a warning and by nobody
   as an error, because from outside, the wrong directory and the right one look
   the same until somebody opens a book's photograph.
5. **It does not install the scheduled task.** `scripts/install-backup-task.ps1`
   is the shape that would, and doing the same for this one would make the
   machine state derivable rather than remembered. It is a good next issue and it
   is not this one.

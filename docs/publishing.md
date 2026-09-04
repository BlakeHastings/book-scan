# Publishing the image, and the contract that comes with it

For #533, under epic #471. `docs/the-image.md` built the image and proved it
runs. This is about shipping it, and about saying what it needs in a form
somebody can check.

The reason it is shaped the way it is: **the owner hosts this on his own
hardware, from a separate repository that is private specifically to protect
him, and this repository is public.** So this one's job is to publish something
that one can consume without ever learning anything about his infrastructure —
and, the half that is easier to get wrong, without this one ever needing to know
anything about his either.

Three decisions were open and each is argued below rather than picked: whether
the image is public, which registry, and what a version means in a repository
that has never had one.

Every transcript here was produced on 2026-09-03 on Docker 29.7.2.

---

## The split, and the direction that fails quietly

The obvious direction is well understood. **Nothing site-specific may land
here**: no domain, no hostname or address, no tunnel credential, no provider
client id or secret, nothing describing the shape of a private network. This
repository is public, so a hostname that arrives here is public permanently.

The other direction is the one nobody notices. **If building or testing this
repository ever starts to need a real domain, a real provider credential or a
real host, the two repositories have stopped being separable** — and the way
that is discovered is that somebody forks it, or a new contributor clones it, and
CI is red for a reason nobody can fix without being the owner.

Here is what keeps that true, item by item, because "we were careful" is not a
control.

**The publishing workflow needs no configured secret at all.** It authenticates
to the registry with `secrets.GITHUB_TOKEN`, which GitHub mints for the run and
expires with it, and it addresses the registry as
`ghcr.io/${{ github.repository }}` folded to lowercase. There is nothing to
configure and nothing to rotate. Checked rather than asserted, on 2026-09-03:

```
$ gh secret list          # nothing
$ gh variable list        # nothing
$ gh api repos/.../environments --jq .total_count
0
```

That is the whole reason the registry decision came out the way it did, and it
is argued below.

**A fork publishes to the fork's own namespace and works.** The workflow reads
the repository it is running in rather than a name written down anywhere. The one
step that compares against `deploy/contract.json`'s declared image steps aside
with a notice when the owner is not `BlakeHastings`, rather than failing. So
somebody who forks this and pushes a tag gets their own image, from their own
token, with no access to anything of the owner's.

**Nothing new is required to build or test.** CI gained two steps, both `node`
against files in the tree: no network, no service, no credential. The image build
needs the npm registry and nothing else. **No compose file, no chart, no
`wrangler.toml`, no deployment descriptor of any kind is in this repository**,
which is the same rule from the other side: a topology written down here would be
the owner's topology, and it would be here in public.

**And the boundary is enforced rather than remembered.**
`scripts/check-deploy-contract.mjs` fails CI if anything that looks like a
hostname appears in the contract. It allows exactly the five public catalogue
origins this app already talks to, the registry, and RFC 2606's `example` and
`localhost`, and complains about everything else:

```
- deploy/contract.json contains books.someones-house.net, which looks like a
  hostname. Nothing site-specific belongs here.
- deploy/contract.json contains nas-01.lan, which looks like a hostname. …
```

Crude on purpose. It matches the *shape* of a host rather than a list of
known-bad strings, because the point is to catch the one somebody has not thought
of.

---

## Decision 1: the image is public

**Recommended: public.**

The argument that settles it is that a private image discloses nothing extra and
costs the consumer a credential. The source is already public: the image is that
source, built. Every dependency and version in it is in `web/package-lock.json`,
every route it answers is in `docs/auth-surface.md`, and the image is
deliberately empty of everything else — `docs/the-image.md` records that it
carries no connection string, no session secret, no provider credential and no
photographs, and the `Dockerfile` says so where each of those would otherwise
have gone. A private image would hide nothing that is not already readable, and
"the deployment is at some address" is not in the image either way.

Against that, a private image would put a registry credential on the owner's
hardware and in his private repository's CI, to protect a build of a public
repository. That is a real secret, with real rotation, guarding nothing. **The
security posture is worse, not better**, because a credential that exists is a
credential that can leak, and this one would be guarding a tarball of MIT-licensed
code.

Two second-order reasons, both small and both pointing the same way. A public
package on GHCR is pulled anonymously, so the owner's deployment needs no
`docker login` and nothing expires at three in the morning. And a 1.49 GB pull is
exactly the sort of thing that gets rate-limited on a shared account; anonymous
pulls of public GHCR packages are not.

**The honest cost.** A public image means anybody can read this app's dependency
tree at a specific version without cloning, which marginally lowers the effort of
finding a vulnerable one. That is worth stating and it is not decisive: the lock
file already carries it, and an attacker still has to reach a deployment whose
address is not published anywhere, behind a gate that answers `401` to strangers.

**One thing to check once, after the first real push.** A package created by a
workflow may be created private, and this is not something the workflow can
change for itself. The job summary says so in as many words. It is a one-time
setting on the package page, and the way it will show up if it is missed is an
anonymous `docker pull` being refused.

---

## Decision 2: the registry is GHCR

**Recommended: `ghcr.io`, the same host as this repository.**

This one is decided by the boundary rather than by features. **GHCR is the only
option that needs no credential configured on this repository**, because a
workflow can authenticate to it with the token GitHub already gives the run:

```yaml
permissions:
  packages: write
- uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}
```

Every alternative costs a secret. Docker Hub means an account and an access token
stored here; a cloud registry means a service principal or a workload identity,
and that identity would belong to the owner's cloud account, which is the thing
this split exists to keep out of this repository. **Adding a secret would be the
first step of exactly the failure described above**: a repository that cannot
build without a credential only its owner can issue.

What Docker Hub would buy, honestly: familiarity, and a marginally shorter
`docker pull` line. Against it: anonymous pull limits that a 1.49 GB image runs
into, and a stored credential. Neither trade is close.

There is one property of GHCR worth knowing before it surprises somebody.
**`github.repository` is `BlakeHastings/book-scan`, verbatim, and a registry
refuses a repository name containing an uppercase letter.** Demonstrated rather
than remembered:

```
$ docker tag book-scan:533 localhost:5533/BlakeHastings/book-scan:v0.1.0
error parsing reference: … invalid reference format: repository name
(BlakeHastings/book-scan) must be lowercase
```

So the workflow folds it, and the comment beside that line says why rather than
leaving it looking like tidiness. `check-deploy-contract.mjs` also fails if the
contract ever declares a repository that is not lowercase.

---

## Decision 3: what a version is here

This repository has **no releases and no tags** — checked, both empty — and two
`version` fields that mean nothing: `1.0.0` at the root and `0.1.0` in `web/`,
neither of which has ever been changed or read. So a scheme has to be proposed,
and the proposal has to answer a question semantic versioning does not answer on
its own: *a version of what, exactly?*

**The thing being versioned is a deployment, not a library.** Nobody imports
this. Nothing compiles against it. The only consumer is a repository that runs
the image and hands it an environment, a mount and a database, so the only
promise worth versioning is **the one the consumer can break their deployment
by ignoring: `deploy/contract.json`.**

So: semantic versioning, where the public API is the contract.

| | Means |
| --- | --- |
| **major** | The deployer has to do something. A new required variable, a mount or a port that moved, the bind changing, a Postgres major, a variable removed. |
| **minor** | New behaviour that deploys unchanged. The contract may gain an optional variable; nothing already set stops working. |
| **patch** | A fix. The contract is byte-identical to the release before it. |

The virtue of that rule is that it is checkable and almost mechanical: `git diff`
of `deploy/contract.json` between two tags says which of the three this is, and
the two directions of `check-deploy-contract.mjs` make sure that diff is real.
The alternative schemes were considered and each fails on the same point.
**Date-based versions** (`2026.09.03`) say when and never say whether it is safe
to upgrade, which is the only question the consumer has. **The commit sha alone**
is precise and unorderable: it cannot say which of two builds is newer, and
rolling back is the ordinary reason somebody needs a version at all.

**It starts at `v0.1.0`, not `v1.0.0`,** and that is a claim about the contract
rather than modesty about the app. The contract still has an open item in it: the
server binds loopback, so the consumer must supply something in the container's
network namespace, and when that is decided (in the private repository, with the
tunnel in hand) the bind may move — which is a major bump under the rule above.
Doing `1.0.0 → 2.0.0` in the first month would tell the consumer something
alarming and untrue. **`0.x` is the honest statement that the contract is still
moving**, and `1.0.0` is the right thing to cut when the bind question is
answered and a deployment has run for a while.

The two `version` fields in the `package.json` files are deliberately left alone.
Nothing reads them, so setting them would create a third and fourth place for a
version to be wrong. **The git tag is the version, and the image and the release
are named from it.**

---

## What the image is tagged with

**One immutable tag per release, spelled exactly as the git tag. No `latest`. No
floating `v0` or `v0.1`.**

A moving tag is what makes "what is running?" unanswerable, and that question
gets asked during an incident, by somebody who cannot afford a guess. A tag that
follows also silently upgrades whatever restarted last, which is the same failure
this project keeps finding in a different costume: something changed and nothing
said so.

**A digest is the only thing that actually pins a build**, so the workflow
records it in the job summary and in the release notes, and every piece of
documentation here says the same sentence: *deploy the digest, keep the tag in a
comment beside it.* Tags on GHCR are mutable by anyone who can push; a digest is
the content.

The release is where the digest lives, so it can be looked up months later
without pulling 1.49 GB to find out what one has.

---

## The contract, which matters more than the pipeline

Before this, a deployer had to read this repository's source to find out what the
server wanted. The environment surface was in two documents that had never agreed
on a list: `docs/deployment-survey.md` counted twelve variables and
`docs/the-gate.md` added four more. Nothing said which were secret, and nothing
said what happens when one is absent, which is the question that actually matters
because **only one of them stops the server**.

`deploy/contract.json` is now the single list: **twenty variables**, each with
whether a deployment must set it, whether the process refuses to start without
it, whether it is a secret, its default, and what absence does. Beside them: the
mount, the port and the bind, the start and stop behaviour, and what has to be
running next to it.

Three things about it are deliberate.

**It is machine-readable because a document alone cannot be checked.** The
consuming repository can validate its own configuration against it in CI, before
a container starts, rather than finding a missing variable at runtime.
`deploy/check-config.mjs` does that, has no dependencies, imports nothing from
the app, and **ships inside the image** so the answer to "what does *this exact
image* need" comes from the image:

```
docker run --rm --env-file <theirs> <image> node /app/deploy/check-config.mjs
```

It prints names and never values, because two of the variables are a Postgres
password and an OAuth client secret and a checker whose output cannot be pasted
into an issue is a checker nobody runs. It restates the four refusals the server
makes at start — no connection string, half a Google client, a provider with no
public origin, the development door beside a real one — so a deployment meets
them in a check rather than in a crash loop.

**It travels with the image, and that is verified rather than intended.** The
publish workflow pulls back what it just pushed, by digest, and `diff`s the
contract inside it against the one in the repository. `.gitattributes` holds
`deploy/**` at LF so that comparison means something on a Windows checkout.

**And it is held to the code.** `scripts/check-deploy-contract.mjs` runs on every
pull request and fails both ways: a variable read and not declared, or declared
and no longer read. It also holds the four facts a deployer trips over to the
files that decide them — the bind to `web/server/index.ts`, the port and the
mount to the `Dockerfile`, the Postgres major to `postgres-version.json` — so
the contract cannot quietly describe a system that has moved. This project has
found a guard that never loaded, a check whose only reader was a log line, and a
build CI never ran; **a contract nobody verifies is the same shape**, and it
would fail in the one place where the failure lands on somebody else.

---

## The thing a deployer will hit first, said here rather than discovered

**The server binds `127.0.0.1` inside the container, so a published port reaches
nothing.** `docker run -p 8080:3001` sets up a route to the container's own
address and nothing is listening there.

This does not look like a configuration mistake. The container is up, the log
says `[api] listening on http://127.0.0.1:3001`, and every request from outside
is refused at the socket. It is in `deploy/contract.json` under
`network.readThisFirst`, it is the last thing `check-config.mjs` prints on a
clean run, and it is in the release notes in bold. Three places, because it is
the one thing that will cost an hour otherwise.

**What the consumer must do:** put whatever fronts this app inside the
container's network namespace — a tunnel daemon or a proxy as a sidecar sharing
it. That is not a workaround; it is the ordinary shape of both options the owner
is choosing between, and `docs/the-image.md` argues it.

**Why it is not simply changed here.** #520 left the bind deliberately, #532 left
it, and this leaves it, for the reason that has not changed: the bind is the
moment this app becomes reachable by somebody who is not at the machine, and it
should move where somebody can see what is in front of it. That is the private
repository, with the tunnel decision in hand. It is one line when it happens, and
under the versioning rule above it is a major bump.

The other one, which costs less time but is just as invisible: **the session
cookie is set `Secure`, always.** A browser will not store it over plain `http`
on anything but `localhost`, so an origin that is not HTTPS gives a sign-in that
appears to succeed and lands back on the login screen. `check-config.mjs` refuses
a non-HTTPS `BOOKSCAN_PUBLIC_ORIGIN` for that reason.

---

## What was proved, and what was not

**The evidence bar for this issue was: do not merge a publishing pipeline you
have not seen publish.** Here is exactly what was and was not run.

### A real push to GHCR could not be exercised from a pull request, and was not faked

A tag push is the only trigger, the workflow does not exist on the default branch
until this merges, and `workflow_dispatch` would only run from there. Publishing
from this branch by pushing a tag was possible and was **not** done: it would
have created a real package and a real release from unreviewed code, and burned
the first version number to prove a point. The workflow also now refuses a tag
whose commit is not on the default branch, which forecloses it on purpose.

### What was done instead: the same steps, against a registry

The image was built, pushed to a `registry:2` container, **deleted locally**, and
pulled back by digest — so what was inspected below came from a registry and not
from the build.

```
$ docker build -t book-scan:533 .            # 7.3s on a warm cache
$ docker push localhost:5533/blakehastings/book-scan:v0.1.0
v0.1.0: digest: sha256:4bc28b19681f5ac077df92f6deb38f87263b3fbb758ae1cbfef1854298e40f49 size: 856

$ docker rmi book-scan:533 localhost:5533/blakehastings/book-scan:v0.1.0
$ docker pull localhost:5533/blakehastings/book-scan@sha256:4bc28b1…
Status: Downloaded newer image for …@sha256:4bc28b1…
```

Then the two verification steps of the workflow, run as they are written:

```
$ docker run --rm --entrypoint cat $REF /app/deploy/contract.json > from-image.json
$ diff -u deploy/contract.json from-image.json
IDENTICAL: the contract inside the pulled image is byte for byte this repository's

$ docker run --rm $REF node /app/deploy/check-config.mjs
  WRONG    ConnectionStrings__bookscan is not set, and it is required. …
1 thing to fix before this deploys.                                     exit 1

$ docker run --rm -e 'ConnectionStrings__bookscan=postgres://u:p@db:5432/bookscan' \
    $REF node /app/deploy/check-config.mjs
Nothing here will stop this deploying. What this cannot check is on the other
side of the network:
  - The server listens on 127.0.0.1 inside the container, so publishing the
    port reaches nothing. …                                              exit 0
```

That last pair is worth naming: the shipped checker was made to **refuse** a bad
environment and **pass** a good one, running as the image's own non-root user,
reading the contract from inside the image. It is not a file that was copied in
and never executed.

The image still refuses to start without its one required variable, from the
pulled copy:

```
$ docker run --rm $REF
[otel] no OTEL_EXPORTER_OTLP_ENDPOINT, telemetry disabled
[api] could not open the catalogue Error: No Postgres connection:
      ConnectionStrings__bookscan is empty. …
```

and it carries its own metadata:

```
$ docker inspect --format '{{index .Config.Labels "org.bookscan.contract"}}' $REF
/app/deploy/contract.json
```

The workflow itself was linted with `actionlint` (which runs `shellcheck` over
every `run:` block) and is clean:

```
$ docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest
$ echo $?
0
```

And the contract check was made to fail against the real tree rather than only
against fixtures, by adding a variable to `web/server/covers.ts` and reverting
it:

```
$ node scripts/check-deploy-contract.mjs
  - BOOKSCAN_A_NEW_THING is read at web/server/covers.ts and
    deploy/contract.json does not declare it. …                          exit 1
```

### What remains unproven, in these words

1. **No image has ever been pushed to `ghcr.io`.** The registry mechanics were
   exercised against a local registry, which speaks the same protocol; GHCR's
   authentication with `GITHUB_TOKEN` and the `packages: write` permission has
   not been exercised at all, and CI in this repository has never published
   anything. **The first real tag is the first time this runs.**
2. **Whether the package is created public is unknown.** It could not be checked
   from here: the local `gh` token lacks `read:packages`, and there is no package
   yet. If it comes up private, an anonymous pull is refused and the fix is one
   setting on the package page. The job summary says so.
3. **The release step has not run.** `gh release create` with an asset is
   ordinary, and it is untested here.
4. **`docker/build-push-action` has never run in this repository.** The build it
   performs is the same `docker build` proved above; the push through that action
   is not.
5. **The ancestry check has not been tripped.** It is four lines of `git
   merge-base` and it has not been made to refuse a tag off the default branch.

The way to close 1 through 4 in one go, when the owner is ready: push
`v0.1.0-rc.1`. The workflow marks anything with a hyphen as a pre-release, and a
release candidate is exactly what an unproven pipeline should publish first.

---

## What this does not do

1. **It does not create the private repository or anything in it.** That is the
   owner's, and this repository's write boundary is this repository.
2. **It does not build the image on pull requests.** A 1.49 GB build on every
   change would be unkind and slow, so the `Dockerfile` is proved when a tag is
   pushed — where the build runs before the push, so a broken tree fails and
   publishes nothing. The cost is real and is named: a change that breaks the
   image is not caught until somebody tags. If that bites, the fix is a build
   step gated on the `Dockerfile` and `web/package-lock.json` changing, and it
   should be an issue rather than a habit.
3. **It does not run the test suite before publishing.** The suite needs a
   Postgres, and it ran on the pull request the tagged commit came from. What the
   image build does run is `npm run build`, which typechecks, and the smoke check
   that loads the bundle after the prune.
4. **It does not move the loopback bind**, for the reasons above.
5. **It does not publish more than `linux/amd64`.** Nothing needs `arm64` yet and
   a second platform doubles a 1.49 GB build. When something does, it is a change
   to one line and a note in the contract.
6. **It does not sign the image or publish an SBOM.** Both are reasonable and
   neither is free to keep working, and the digest already answers the question a
   consumer asks most often: is this the build I deployed last time.

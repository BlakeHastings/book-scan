# The image: something for a host to point at

For #531, under epic #471. `docs/deployment-survey.md` listed what this app
needs in order to run somewhere else; `docs/running-from-a-build.md` made it
startable without a watcher; `docs/the-gate.md` put a lock on it. This is the
last thing that survey named that nobody had built: **there was no `Dockerfile`
in this repository, and every remaining hosting option needs one, because a
tunnel points at something and Containers run something.**

It is an explanation, not a deployment guide. It chooses no host, and it is
careful not to: the owner has chosen Cloudflare and has **not** chosen between a
tunnel pointing at an origin he runs and Cloudflare Containers running this
image. An image is right under both. A `wrangler.toml` would be a guess at
which, so there is not one.

Every number and every transcript below was produced on 2026-09-03 by building
the image and running it, on Docker 29.7.2 with a `linux/amd64` engine.

---

## What it is

Two stages and one artefact.

```
docker build -t book-scan .
docker run -d --name book-scan \
  -e ConnectionStrings__bookscan='postgres://…' \
  -v book-scan-covers:/data \
  book-scan
```

| Stage | What it is for |
| --- | --- |
| `build` | `npm ci`, then `npm run build`. The toolchain: TypeScript, Vite, esbuild, vitest, tsx. |
| `production-tree` | The same tree with `npm prune --omit=dev` run over it, then the smoke check. |
| `runtime` | A clean base plus four things: `node_modules`, `dist`, `dist-server`, `package.json`. |

**`production-tree` is a stage rather than two more `RUN` lines**, and that is
worth one sentence because it paid for itself immediately. It leaves
`--target build` addressable as a complete checkout with the toolchain still in
it, which is how the suite was run for this change on a machine whose worktree
had no `node_modules` at all:

```
$ docker build --target build -t book-scan:build .
$ docker run --rm --network <net> \
    -e BOOKSCAN_TEST_DATABASE_URL=postgres://…@<pg>:5432/postgres \
    book-scan:build npm test

 Test Files  138 passed (139)
      Tests  2755 passed (2756)
```

That is the arrangement CI already uses (`BOOKSCAN_TEST_DATABASE_URL` points the
harness at a Postgres somebody else started, so no testcontainer starts), and it
costs the shipped image nothing, because nothing is copied from that
stage.

*(The one file that did not pass in that first run was `src/styles.test.ts`,
which reads `e2e/` from the repository root. That directory is not in the build
context on purpose; the test passes when it is mounted in, and the failure is a
property of the build context rather than of this change.)*

---

## The native modules, which are the part that could have gone wrong

`sharp` and `onnxruntime-node` are compiled addons. The issue asked for what was
done to be said rather than assumed, so this was measured rather than argued.

**What `npm ci` resolves is decided by the platform it runs on.** Both packages
distribute per-platform binaries as optional dependencies, so an `npm ci` run
inside a `linux/amd64` image installs `@img/sharp-linux-x64` and the linux x64
onnxruntime, and an `npm ci` run on the owner's Windows machine installs neither.
That is the whole reason `.dockerignore` excludes `web/node_modules` rather than
merely saving time: **copying a host tree in would put the wrong compiled addons
next to the right ones**, and the failure would be at load, in the container, not
at build.

**Both stages take their base from one `ARG`.** A build stage and a runtime stage
on different C libraries produce an image that builds and will not start. There
is one version, used twice.

**There is no `apt-get` line, and that is a result rather than an omission.**
Every shared object in the runtime image was scanned with `ldd` rather than
guessed at:

```
$ docker run --rm book-scan:531 sh -c 'for f in $(find /app/web/node_modules \
    -name "*.node" -o -name "*.so" -o -name "*.so.*"); do
      ldd $f 2>/dev/null | grep "not found" && echo MISSING $f; done'

        libcublasLt.so.13 => not found
        …
MISSING …/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_cuda.so
        libnvinfer.so.10 => not found
        …
MISSING …/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_tensorrt.so
```

Two files, and both are GPU execution providers that onnxruntime `dlopen`s only
when a session asks for CUDA or TensorRT. Nothing here does. Everything actually
loaded resolves against what `node:22-bookworm-slim` already carries:

```
$ ldd .../\@img/sharp-linux-x64/lib/sharp-linux-x64-0.35.3.node
        libvips-cpp.so.8.18.3 => .../sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.3
        libstdc++.so.6 => /lib/x86_64-linux-gnu/libstdc++.so.6
        …all present…

$ ldd .../onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1
        libstdc++.so.6, libm.so.6, libgcc_s.so.1, libpthread.so.0, libc.so.6
        …all present…
```

**And the addons were loaded, not merely installed.** The container's own log
says so, because starting this app imports the whole OCR stack:

```
[PaddleOcrService] Downloading resource: PP-OCRv6_tiny_det.ort
                 Cached at: /home/node/.cache/ppu-paddle-ocr
[ocr] tesseract ready in 6015ms
```

That line is onnxruntime running. `sharp` is exercised further down, by the
thumbnail door answering `200 image/jpeg` for `?w=160`, which is
`sharp(join(coverDir, …))` and nothing else.

**One consequence of the model cache is worth naming.** `ppu-paddle-ocr` and
`tesseract.js` cache their models under `os.homedir()`, which is why the image
sets `HOME=/home/node`: `USER` does not set it, and unset, the first OCR of a
container's life writes wherever Node resolves instead. That cache is inside the
container, so a replaced container downloads the models again. It is a few
megabytes and it is not data, so nothing is lost. But a deployment that
restarts often may want `/home/node/.cache` mounted too. It is deliberately not
in `BOOKSCAN_DATA`: `web/server/identify.ts` says why, and it is the same reason
here.

### Where the size goes

| | |
| --- | --- |
| The image | **1.49 GB** |
| `node:22-bookworm-slim` under it | 329 MB |
| `node_modules` | 743 MB |
| of which `onnxruntime-node` | **500 MB** |
| `dist/` (the client) | 3 MB |
| `dist-server/` (the bundle, its map and 32 migrations) | 6 MB |

The app is 9 MB of a 1.49 GB image, exactly as the issue predicted. What is
surprising is where the rest goes: `onnxruntime-node` ships **every** platform's
prebuilt binaries and `npm prune --omit=dev` has no opinion about them, so this
`linux/amd64` image carries 128 MB of Windows libraries and 75 MB of macOS ones
it can never load, plus the 20 MB arm64 build beside the 278 MB x64 one it uses.
Deleting them is a real 220 MB and it is not this issue: it means knowing which
files onnxruntime resolves at runtime and being wrong about it quietly if the
package changes its layout. Named here so the next person shrinking this image
starts where the weight actually is.

---

## What the image is not allowed to contain

**No connection string, no session secret, no provider credential.** Everything
the server reads is `docs/deployment-survey.md` section 1 and `docs/the-gate.md`,
and every one of them arrives as environment. The image is the same everywhere;
what differs is what is handed to it.

**No photographs.** They are 1541 files and about 1.4 GB, addressed by bare
filename joined onto `BOOKSCAN_DATA` at read time, with fifteen code paths
touching that directory. **A container that loses its filesystem loses every
photograph and there is no second copy in the app: the names are in Postgres and
the bytes are not.**

Two things follow, and only one of them is obvious.

`ENV BOOKSCAN_DATA=/data` and `VOLUME ["/data"]` are the obvious one: the
requirement is in the image's own metadata rather than only in a document. The
default is **set** rather than left absent because absent is the hazard the
survey measured: a server with no `BOOKSCAN_DATA` resolves `./data`, creates it,
and comes up reporting success while serving a catalogue whose every photograph
is a 404.

The other one is that **`VOLUME` does not make a missing mount safe**, and this
was demonstrated rather than asserted. A container run with no `-v` gets an
anonymous volume, which looks like it is working:

```
$ docker run -d --name nomount … book-scan:531
$ docker exec nomount touch /data/covers/no-mount-531.jpg
$ docker exec nomount ls /data/covers
no-mount-531.jpg
$ docker inspect -f '{{range .Mounts}}{{.Name}}{{end}}' nomount
f9d69c53e43c6fcbb30f937c87b5574d4e9b42ad82a2038dc9ab3408b0e4950b
```

and then the container is replaced:

```
$ docker rm -f nomount && docker run -d --name nomount2 … book-scan:531
$ docker exec nomount2 ls -la /data/covers
total 8
drwxr-xr-x 2 node node 4096 …
drwxr-xr-x 3 node node 4096 …
$ docker inspect -f '{{range .Mounts}}{{.Name}}{{end}}' nomount2
ae9680f39e168e3c3d41dcce9494492f955114fb847b70119166b5f40feb1158
```

A different volume, an empty directory, and the first one still on the disk
under a name nobody will ever look up. **That is what losing the photographs
looks like: not an error, an empty shelf.** The named-mount version of the same
test is in the transcript at the bottom, and it keeps the file.

**It does not run as root.** `USER node`, and `/data` is `chown`ed to that user
in the image so a fresh volume is writable without anybody having to remember.

---

## Stopping when asked, which needed a change to the app

The issue asked for an image that stops cleanly, and this is the one place where
that was not already true.

**Nothing in this process listened for a signal.** That was invisible while the
only way to stop it was Ctrl+C in a terminal, and it stops being invisible in a
container, because of a rule that catches people out: **a signal with its default
disposition, sent to PID 1, is discarded by the kernel.** A container's entry
point is PID 1. So `docker stop` sent SIGTERM into a process that could not
receive it, waited the full grace period, and sent SIGKILL.

Measured, by building the image from the tree with the handler taken back out:

```
no handler: docker stop --time 10 took 10.29s, exit 137
```

Exit 137 is 128 + 9: killed. And with the handler, on the same image otherwise:

```
with handler: docker stop --time 10 took 0.24s, exit 0
[api] SIGTERM: closing the listener, then the catalogue
[api] stopped
```

The handler closes the listener, closes idle keep-alive connections (a phone
sitting on a shelf holds one open, and without this the close waits for it and
the ten seconds are spent anyway), then closes the pool, which is what actually
lets the process exit, since idle Postgres clients hold the event loop open on
their own. It is bounded: a shutdown that hangs is worse than a hard kill,
because it looks like a working one.

**What it does not do**, said plainly: a background crop or cover download that
is mid-write when the signal arrives is cut off when the process exits, and
those writers do not write-then-rename. Ten seconds is generous for the work
they do and the window is small, but it is not zero, and closing it is a change
to six write paths rather than to this one.

---

## Migrations, and two containers starting at once

`applySchema` runs inside `openPostgres` before the server listens, so every
container start migrates. The issue asked for the concurrent case to be answered
or deferred rather than discovered later. **It is answered, and the answer is
that it was already handled.**

`web/infrastructure/db/migrate.ts:60-71` takes a session-scoped advisory lock
around the whole of it, over the "has this ever been migrated" check, the
adoption decision and Drizzle's migrator alike, for exactly this reason, in its
own words:
*"One advisory lock, so two processes starting at once do not both decide the
database is empty."*

Driven, rather than read. Three containers were created against one **empty**
database and started with a single `docker start a b c`:

```
--- race1 ---
[db] postgres migrations: this database was empty, so the schema was created from them
[api] listening on http://127.0.0.1:3001
--- race2 ---
[db] postgres migrations: this database was already under migration control
[api] listening on http://127.0.0.1:3001
--- race3 ---
[db] postgres migrations: this database was already under migration control
[api] listening on http://127.0.0.1:3001
```

```
$ psql -c 'select count(*) from drizzle.__drizzle_migrations'   -> 32
$ psql -c "select count(*) from information_schema.tables
             where table_schema='public'"                       -> 26
```

One created it, two waited and found it done, all three came up, and the
bookkeeping holds 32 rows, one per migration the build copied, not 96. **So
scaling to more than one container is safe as far as schema goes.**

Three things that are *not* settled by that, kept here so nobody reads this
section as more than it is:

1. **`pg_advisory_lock` waits without a timeout.** A migration that hangs does
   not corrupt anything; it makes every other container's start hang behind it,
   which will look like a deployment that is up and never answers.
2. **The lock says nothing about which database was opened.** The survey's real
   hazard, a first boot against an *empty but wrong* database producing a
   complete, empty catalogue and reporting success, is untouched by this and
   untouched by anything in this issue. The line `[db] postgres migrations: this
   database was empty, so the schema was created from them` is the one to read on
   a deployment's first start, and reading it on the *second* start is the
   finding.
3. **Nothing else about this app has been tested for two of it.** The capture
   queue, the background crop worker and the cover downloader were written for
   one process. This says two can *start* safely, not that two should run.

---

## The loopback bind, which is still there, and what a deployment needs instead

`web/server/index.ts` still listens on `127.0.0.1` only. #520 left it that way
deliberately, `docs/the-gate.md` left it, and this issue does not change it: the
bind belongs with the tunnel work, where somebody can reason about what sits in
front of it.

Inside a container that has a consequence worth stating in one line, because it
is not what anybody expects: **`docker run -p 8080:3001` reaches nothing.**
Publishing a port sets up a route to the container's own address, and nothing is
listening there. The `EXPOSE` line in the `Dockerfile` is documentation, and the
comment beside it says exactly this.

So what a deployment needs is something **in the same network namespace** that
can reach `127.0.0.1:3001` and be reached from outside. That is not a workaround;
it is the ordinary shape of both options the owner is choosing between:

- **A tunnel to an origin he runs**: the tunnel daemon runs beside the container
  and dials out, or runs as a sidecar sharing its namespace. Nothing listens on
  a public interface at all, which is the property that makes the loopback bind
  attractive rather than merely inherited.
- **Containers**: the platform terminates the request and hands it to the
  container. Whether that arrives on loopback or on an interface address is a
  property of the platform, and **it is the one question that has to be answered
  before this image runs there.** If it arrives on an interface address, this
  bind is the change to make, and it is one line, in that issue, with the gate
  and the tunnel decision in hand.

For the verification below, that role was played by the smallest honest thing: a
second container joined to the app container's network namespace, forwarding
`0.0.0.0:8531` to `127.0.0.1:3001`. It is fifteen lines of `node:net` and it is
not in this repository, because it is not part of the image: it is a stand-in
for the decision that has not been taken.

---

## Admitting the first user, which an image could not do

`docs/the-gate.md` decided that who is allowed in is settled outside the app by
`web/scripts/enable-user.ts`, and gave the reason: a route that admits somebody
needs a role, and #171 has not decided one. It also names the bootstrap that
makes a script the only answer. **The first user cannot be enabled by an enabled
user, because there is not one.**

That script runs under `tsx`, which a runtime image does not carry. So an image
that could not run it would be a login screen with nothing behind it, on any
deployment where the database is not reachable from the owner's own machine.

It is now bundled beside the server by `scripts/build-server.mjs`, as a second
esbuild call rather than a second entry point in the same one, because esbuild
derives
output paths from the common ancestor of its entry points, so one call with both
would have written `dist-server/server/index.js` and broken the `../dist/`
sibling relationship the client serving depends on. `smoke-built-server.mjs`
checks it is there, because a build that silently stopped producing it would
surface as a deployment that admits nobody.

```
$ docker run --rm --network <net> book-scan:531 \
    node dist-server/enable-user.js --target 'postgres://…' --enable blake@localhost
Catalogue: postgres …:5432/bookscan
1058131a-… is in. If they are holding a session already, their next request goes
through; they do not have to sign in again.
```

Nothing about the script changed. It still lists by default and writes only when
told to, and it still takes its target from the command line rather than from
`ConnectionStrings__bookscan`.

---

## What was proved by running it

Against a Postgres 18 container started for the purpose, with no Aspire, no
`tsx` and no `npm run dev` anywhere: the image, a database, and a namespace-mate
forwarding to the loopback bind.

**It starts, and says what it is:**

```
[otel] no OTEL_EXPORTER_OTLP_ENDPOINT, telemetry disabled
[db] postgres migrations: this database was empty, so the schema was created from them
[api] listening on http://127.0.0.1:3001
[api] database postgres bookscan-531-pg:5432/bookscan
[api] no backup directory watched; set BOOKSCAN_BACKUP_DIR to watch one
[api] serving the built client from /app/web/dist/
[auth] no sign-in provider is configured, so nobody new can get in. …
[auth] the development door is OPEN: … This is BOOKSCAN_DEV_SIGN_IN and it must
       not be set on a deployment.
```

**The client is served, and the API is not:**

```
GET /                       -> 200 text/html
GET /assets/index-DiTSo8re.js
                            -> 200 application/javascript, 386336 bytes
                               Cache-Control: public, max-age=31536000, immutable
GET /api/health             -> 401  {"state":"anonymous","error":"Sign in to use this."}
GET /api/nope               -> 401 application/json
GET /api/auth/session       -> {"state":"anonymous"}
GET /api/auth/providers     -> {"providers":[{"id":"dev","label":"this machine",
                                "start":"/api/auth/dev/start"}]}
```

**401 on `/api/health` is the point rather than a nuisance.** It is a running
server saying so to a stranger, which is what `docs/the-gate.md` decided and what
`AGENTS.md` now says.

**Signing in, through the development door this run was given:**

```
$ curl -si $APP/api/auth/dev/start
HTTP/1.1 302 Found
Set-Cookie: bookscan_session=WTPW…g1g; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax
Location: /

$ curl -H "$C" $APP/api/auth/session
{"state":"admitted","user":{"id":"1058131a-…","enabled":true,
 "email":"blake@localhost","name":"blake"}}
$ curl -H "$C" $APP/api/health   -> 200, the counts, the database
```

**Then the same person on the waiting list, by the script running inside the
image, on the same cookie:**

```
$ docker run --rm --network <net> book-scan:531 \
    node dist-server/enable-user.js --target '…' --disable 1058131a-…
1058131a-… is back on the waiting list. …

$ curl -H "$C" $APP/api/auth/session
{"state":"waiting","user":{…"enabled":false…}}
GET /api/health              -> 403
GET /api/books               -> 403
GET /api/covers/anything.jpg -> 403
```

and enabled again, on the same cookie, with no second sign-in: `admitted`, and
`/api/health` back to `200`.

*(The development door admits on sight, `admitsOnSight: true` in
`web/server/auth/providers.ts`, because a checkout has no owner sitting beside it
to run the enable script. So the waiting state is reached with `--disable`, which
is the same order `docs/the-gate.md` drove it in. On a real deployment the
development door is refused beside a configured provider, and a first Google
sign-in lands on `waiting` with no script run at all.)*

**In a browser, which is the part a `curl` transcript cannot claim:** the app was
opened at the forwarded port, signed in through the development door, and it
loaded: the header, the five counts, the search card, the four tabs, and
**0 console errors and 0 warnings**. Disabled by the script and reloaded, the
same browser got the waiting screen: *"You are signed in, and not in yet."* with
the sign-out button under it. Enabled again and reloaded, the app came back. All
three states of the gate, in one browser, against the image.

**A photograph, written by the app's own write path:**

```
$ curl -X POST $APP/api/captures -H "$C" -H 'content-type: application/json' \
       -d '{"slot":"front","image":"data:image/jpeg;base64,…"}'
{"capture":{"id":1,…,"front_image":"1788475886153_noisbn_front.jpg",…}}

$ docker exec book-scan ls -la /data/covers
-rw-r--r-- 1 node node 340 Sep  3 22:51 1788475886153_noisbn_front.jpg
```

**and it survives the container being replaced**, which is the whole question:

```
$ docker stop book-scan        # 0.34s, exit 0
$ docker rm book-scan
$ docker run -d --name book-scan … -v book-scan-covers:/data book-scan:531
[db] postgres migrations: this database was already under migration control

$ docker exec book-scan ls -la /data/covers
-rw-r--r-- 1 node node 340 Sep  3 22:51 1788475886153_noisbn_front.jpg

GET /api/covers/1788475886153_noisbn_front.jpg        -> 200 image/jpeg 340 bytes
GET /api/covers/1788475886153_noisbn_front.jpg?w=160  -> 200 image/jpeg
```

The second of those two is `sharp` re-encoding on the fly, so the same request
that proves the mount proves the addon.

The session survived the replacement too, on the same cookie, because sessions
are rows in Postgres rather than state in the process.

---

## What this does not do

1. **It does not choose a host, and it adds nothing Cloudflare-shaped.** No
   `wrangler.toml`, no edge assumption, no registry, no tag scheme, and nothing
   in CI builds this image. That is the next decision, not this one.

   > **Superseded in part, 2026-09-03, by #533.** There is a registry and a tag
   > scheme now, and CI builds and pushes this image when a version tag is
   > pushed: `ghcr.io`, one immutable tag per release, and no `latest`.
   > `docs/publishing.md` argues all three. Still true, and deliberately: no
   > host is chosen, nothing Cloudflare-shaped is here, and there is no compose
   > file or any other descriptor that encodes topology. The image also now
   > carries `deploy/contract.json` at `/app/deploy/`, which is the list of
   > everything a deployment must provide.
2. **It does not move the loopback bind.** See above for what a deployment needs
   instead, and which of the two options has to answer the question first.
3. **It does not solve TLS.** `docs/running-from-a-build.md` already says a
   deployment needs a real certificate and that a phone will not open a camera
   outside a secure context. Whatever terminates TLS is the same thing that has
   to sit in the container's network namespace or in front of it.
4. **It does not carry a `HEALTHCHECK`**, deliberately. Since #521 the health
   route answers `401` to anything without a session, so a probe would have to
   understand that `401` is the healthy answer, and it would need a second Node
   process every interval to say so. The deployment that wants one should write
   it knowing that.
5. **It does not back anything up.** The photographs are a mount and
   `docs/deployment-survey.md` section 2 is explicit that they must be backed up
   separately from the database and restored to the same moment. An image cannot
   do that for anybody.
6. **It does not replace the secret mechanism.** `web/server/secrets.ts` is a
   DPAPI-encrypted file on one Windows account, and a container cannot read it.
   The shape it has to preserve is in that file's own comment: what travels is a
   path or a value in the environment, never a credential in an image.
7. **`aspire start` is untouched.** `apphost.mts` is not modified, and it still
   declares no image, no registry and no target. What did change in the app is
   the signal handler, which the development entry point now also has: the
   `tsx server/index.ts` path was run from the toolchain stage and starts
   unchanged.

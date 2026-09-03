# Running this app from a build

For #512, under epic #471. `docs/deployment-survey.md` established that there
was no server build at all, that nothing served the built client, and that what
runs the owner's live catalogue today is `npm run dev`: a file watcher and a
development server. This document is what was done about that, and why each
choice was made rather than the other one.

It is an explanation, not a deployment guide. Nothing here chooses a host, and
nothing here is a deployment mechanism. The three things a deployment still
needs that this does not provide are in the last section, named rather than
implied.

Every number below was measured on 2026-09-03 in a worktree of this repository,
by running the command beside it.

---

## The commands

All from `web/`.

```
npm run build          # typecheck, then the client, then the server
npm run build:client   # vite build            -> web/dist
npm run build:server   # scripts/build-server.mjs -> web/dist-server
npm start              # node --enable-source-maps dist-server/index.js
```

`npm start` runs one process. There is no `tsx` in it, no watcher, and no second
process serving the client. It needs what the server has always needed:
`ConnectionStrings__bookscan` set, and `BOOKSCAN_DATA` pointed at the
photographs.

What that process says on a real start, quoted from one:

```
[db] postgres migrations: this database was already under migration control
[api] listening on http://127.0.0.1:3998
[api] database postgres localhost:54804/bookscan
[api] no backup directory watched; set BOOKSCAN_BACKUP_DIR to watch one
[api] serving the built client from ...\web\dist\
```

The fourth line is new and it is said both ways round, like the two beside it.
"There is no built client here" and "the built client is being served" are
invisible from outside the process and look identical when something is wrong.

**Development is unchanged.** `aspire start` still runs `tsx watch
server/index.ts` for the api and the Vite dev server for the client, Vite still
proxies `/api`, and the ports are still assigned per checkout, which is what
lets several worktrees run at once. Verified by running both at the same time:
Vite answered `200 text/html` at its own HTTPS port and `200 application/json`
for `/api/health` through its proxy, while a built server served the same
catalogue on a port of its own.

---

## Decision 1: the API serves the client

#512 recommended this. It was checked rather than taken, and it holds. The
reasoning it rests on is worth writing out, because the alternative is not
obviously wrong and #510 needs to know which one it inherited.

**The constraint that is not in dispute.** The client addresses the API with
same-origin relative paths and has no configurable base: `/api/...` appears
about a hundred times under `web/src/` and there is no base-URL constant. So the
client and the API share an origin, whatever else is decided. #512 is explicit
that adding a base to avoid this is not on the table, and it is right: two
origins is a second front door for #510 to defend.

**What that does not settle.** A reverse proxy in front of two processes also
produces one origin. So "same origin" alone does not choose between one process
and two, and an argument that stops there has not finished.

**What does settle it is where a gate can be written.** `docs/auth-surface.md`
counted seventy-two unauthenticated doors and found that all of them are one
Express app, built by one factory, in one file, with no middleware between the
body parser and the handlers. A check placed there covers all seventy-one
handlers and the cover mount together. If this same process also serves the app
shell and the bundle, that one check covers those too, and a session cookie it
sets is sent with the request for a page, for a script and for a photograph
alike, because they are all the same origin and the same server.

If instead a proxy or a static host serves the client, the client's bytes never
enter Express. The gate then has to exist twice: once in `web/server/index.ts`
and once in the proxy, in a different language, agreeing with the first about
the cookie name, the session lifetime and what happens when it expires. Two
implementations of one rule is the arrangement in which one of them is wrong and
nobody notices, and the one that would be wrong is the one guarding the front
door.

**So: if you conclude otherwise, this is what #510 owes.** A proxy-served client
needs an authentication layer of its own (`auth_request`, `forward_auth`, an
oauth2-proxy sidecar), it needs to share session state with the API or delegate
to it, and `/api/covers` has to stay behind whichever of the two is authoritative.
None of that is needed here.

**What it costs.** Two `app.use` calls and a fallback, and the Node process
serving 450 kB of hashed assets in addition to the photographs it already
serves. `express.static` is already how every cover reaches a phone, so this is
not a new kind of work for this process.

### The four mounts, and why their order is the design

In order, after the API routes:

1. the `/api` catch-all 404, which answers JSON;
2. `express.static` over `web/dist`, serving files that exist;
3. the single-page fallback, GET and HEAD only, answering `index.html`;
4. the error handler.

A single-page fallback answers **every** path it is asked for. Put it before the
`/api` catch-all and a mistyped API path comes back as `<!doctype html>`, which
`src/lib/api.ts` then fails to parse as JSON, and the banner shows the parser's
message rather than the API's. That is #332 returning through a different door.
`server/client-serving.routes.test.ts` holds that case, and it was watched
failing before it was kept: with the fallback registered first, `still answers an
unknown /api path with JSON` reports `expected 200 to be 404`.

The two cache policies are the other half. Everything under `assets/` carries a
content hash in its filename and is served `public, max-age=31536000, immutable`.
`index.html` names those hashes and is served `no-cache`, because a cached shell
pins a deployment that has been replaced.

### A finding: the client has no URL routing, and the fallback is still right

`web/src/app/navigation.tsx` says in its own header that the route is held in
memory and not in the URL, deliberately, with three reasons. So no screen in
this app produces a deep path today, and the fallback catches nothing the app
itself generates.

It is kept anyway, for two reasons that are about behaviour rather than about
screens. First, it is what the Vite dev server does: `docs/auth-surface.md`
verified `GET /library/anything` answering `200 text/html` through Vite, and a
deployed server that 404s where the development server serves is a difference
nobody would find until somebody typed a path. Second, `navigation.tsx` leaves
the door to URL routing explicitly open, and a server that already answers means
that change stays inside the client.

---

## Decision 2: a bundler, not a `tsc` emit

#512 asked for the choice to be made and defended, and specifically for the
layers not to be flattened.

**A `tsc` emit was tried first, and what it emits does not run.** The sources
address each other without file extensions (`import './db.pg'`), which is what
`tsx` and Vite resolve and what Node's ESM loader refuses:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'...\dist-server-trial\instrumentation' imported from
'...\dist-server-trial\server\index.js'
```

`tsc` preserves the directory tree exactly, which is the property that made it
attractive, and it will not rewrite a single specifier. Making its output
runnable therefore means one of two things: putting `.js` on **359 relative
imports across 75 files** in `server/`, `infrastructure/`, `application/`,
`domain/` and `shared/`, which is a change to every layer made for the build's
benefit; or writing a resolver here to add them afterwards, which is a resolver
this repository would then own and test. `moduleResolution: nodenext` does not
help: it turns the same problem into a compile error rather than a runtime one.

esbuild resolves exactly what `tsx` and Vite resolve, so the build agrees with
development by construction rather than by a second implementation of module
resolution.

**The layers are not flattened by this**, and the reason is worth being precise
about, because a bundle really is one file.

`npm run lint:layers` is `dependency-cruiser` over the **source** graph. It runs
unchanged in CI as a step of `web (typecheck + tests)`, and a domain file
importing from infrastructure still fails the pull request exactly as it did.
The boundaries were never enforced by the module layout at runtime, so nothing
about the artefact can weaken them. And the client half of this repository has
bundled `src/`, `shared/` and `domain/` into two chunks since `vite build`
existed, which nobody has called a layering change. This is the same operation
on the other half.

**What the bundle deliberately does not contain.** `packages: 'external'`, so
nothing from `node_modules` goes in. `sharp`, `onnxruntime-node`, the wasm OCR
and barcode stacks and everything else are loaded at runtime from the tree
`npm ci` installed, exactly as they are today. There is no native-binary
bundling problem, because nothing native is bundled. A deployment ships
`node_modules` either way; what it stops shipping is the TypeScript and a
compiler to read it.

**The one thing bundling does change**, and it is the reason for a copy step:
`import.meta.url` stops meaning "this module" and starts meaning "the bundle".
Five files use it and three are test-only. The one that runs in production is
`MIGRATIONS_FOLDER` in `infrastructure/db/migrate.ts`, which reads the migration
`.sql` files off disk before the process listens, and
`docs/deployment-survey.md` section 3 flagged this in advance. So
`scripts/build-server.mjs` copies `infrastructure/db/migrations` next to the
bundle and compares the counts, and `scripts/smoke-built-server.mjs` checks the
journal is there. A missing copy is a failed build, not a failed start against
somebody's catalogue.

**The output location is a constraint, not a preference.** The server finds the
built client at `../dist/` relative to its entry module. That names `web/dist`
from `web/server/index.ts` under `tsx` and from `web/dist-server/index.js` under
`npm start`, because both are one directory below `web/`. Move the bundle a
directory deeper and the server stops finding the client. Both the build script
and `web/.gitignore` say so where the path is chosen.

### What it costs

| | |
| --- | --- |
| Client | 173 modules, 1.75s. `index.html` 0.74 kB, CSS 57.9 kB, `Gallery` 72.4 kB, `index` 380.6 kB |
| Server | 84 modules, one file, 519.7 kB, 48 ms, with 31 migrations copied beside it |

---

## Decision 3: source maps, said out loud rather than changed quietly

**The client's source maps are kept on, and that is now a decision rather than a
line nobody had looked at.** `web/vite.config.ts` carries the argument at the
setting itself.

The numbers, because they are the reason it was worth deciding: about 2.4 MB of
maps against about 450 kB of code, and since the API now serves `web/dist` they
are fetched from the same origin as everything else. Anyone who can open this
app's devtools can read its original TypeScript.

The case for keeping them: what a map discloses is the shape of the client's
code. It is not a credential and it is not a row. The client bundle holds no
secret to find, because every origin it talks to is its own, the Google Books
key lives on the server (`web/server/secrets.ts`) and the connection never
leaves it. The real exposure this app has is the seventy-two unauthenticated
doors `docs/auth-surface.md` counted, and a source map is not one of them.
Against that, the maps are what makes a fault on somebody's phone readable, on
the one deployment that will have no compiler and no watcher behind it.

**What would flip it:** this app becoming reachable by anybody who is not the
owner, or more than one person's catalogue on one origin. That is #510 and
#471's call to make with the gate in hand, and it is one line in
`web/vite.config.ts` and nothing else.

> **The gate arrived and this did not flip, 2026-09-03, #521.** Asked directly:
> the gate makes this app *less* reachable rather than more, the bind is still
> `127.0.0.1`, and there is still one person's catalogue on one origin, so
> nothing this paragraph names has happened. The maps are also on the open side
> of the gate along with the shell and the bundle, because those three are the
> login screen and a person who cannot sign in yet has to be able to load it.
> The decision is still #471's to take, now with the gate in hand.
> See `docs/the-gate.md`.

**The server bundle's maps are a different question and are on.** Nothing serves
`web/dist-server`: `express.static` is mounted over `web/dist` and over the
cover directory, and never over the bundle. So a map there reaches nobody but
whoever is reading the server's own logs, and what it buys is a stack trace
naming `server/db.pg.ts:554` instead of `index.js:4312`. Observed, on the built
server started with no connection string:

```
[api] could not open the catalogue Error: No Postgres connection:
ConnectionStrings__bookscan is empty.
    at catalogueConnection (...\web\server\db.pg.ts:554:11)
    at openCatalogue (...\web\server\index.ts:4118:15)
```

`npm start` passes `--enable-source-maps` so Node reads it.

---

## What CI now does, and what it deliberately does not

`vite build` was in `package.json` and in no workflow, no script and no AppHost.
The `web (typecheck + tests)` job now runs `npm run build`, the whole script
rather than its halves, because the script a deployment runs is the script worth
proving. It typechecks a second time as a result, about ten seconds.

It then runs `scripts/smoke-built-server.mjs`, because a build that compiles is
not a build that runs. That starts the bundle with no connection string and
requires it to exit 1 naming the variable, which exercises the whole load path:
every external package resolved against the installed tree, the entry module
evaluated, and execution as far as the one refusal this app makes on purpose. It
sets every variable that could point a process at somebody's catalogue rather
than inheriting it, which is the rule the AppHost and `run-stable.ps1` both
follow.

**It does not prove the built server serves.** That needs a database. The
routing is proved by `server/client-serving.routes.test.ts` over real HTTP, and
the whole thing was proved by hand; see below.

---

## What was proved by running it

The built server was started from `npm start` with no `tsx` anywhere, against
the Postgres the AppHost provisions for this checkout, on a port of its own,
with a world from `npm run seed`. Then a browser was pointed at it.

- `GET /` answered the app shell, `Cache-Control: no-cache`.
- `GET /assets/index-Cke8Vx8n.js` answered the bundle,
  `Cache-Control: public, max-age=31536000, immutable`.
- `GET /api/nope` answered `404 application/json`, not the shell.
- The app loaded, reported 27 catalogued and 2 checked out, and drew the library
  with every cover fetched from `/api/covers` on the same origin.
- A book was opened, checked out through the UI, and the screen came back with
  "Out of the house" and "Checked out today".
- The page was then loaded fresh at `/library/anything`, a path no file matches.
  The single-page fallback answered, the app booted, and the count read 3
  checked out, so the write had gone through the built server to Postgres and
  back.
- Browser console: 0 errors, 0 warnings.

---

## What this does not do

Three of `docs/deployment-survey.md`'s requirements are deliberately still open,
and one of its statements is now out of date.

1. **The API still binds `127.0.0.1`** (`web/server/index.ts`, `app.listen`).
   That is survey requirement 16 and it is one line, and it is not this change.
   The bind is the moment this app becomes reachable by somebody who is not
   sitting at the machine, and `docs/auth-surface.md` closes with the finding
   that hosting this app and gating it are the same decision. Opening it in the
   change that is upstream of the gate is exactly the move that document warns
   against. #471 should take it with #510's gate in hand.
2. **There is no TLS here.** The phone will not open a camera outside a secure
   context, which is why the dev server speaks HTTPS with a self-signed
   certificate. A deployment needs a real one. A TLS-terminating proxy that
   forwards everything to this one origin is fine and does not reintroduce
   Decision 1's problem; a proxy that *serves the client itself* does.
3. **The AppHost is not a deployment mechanism and this did not make it one.**
   It declares no image, no registry and no target. It still runs `tsx watch`
   for the api and the Vite dev server for the client, on purpose, because that
   is what several worktrees at once depends on.

And the correction: `docs/deployment-survey.md` section 3, "there is no server
build at all" and "nothing serves the built client", was true when it was
written and is not any more. The rest of that section, including its list of
what constrains the choice, is what this change was built from.

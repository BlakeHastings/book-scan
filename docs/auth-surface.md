# The auth surface: every way into this app, counted

For #511, which is part of #510. This is a survey, not a design. It says what is
true today, and it is deliberately the half that does not depend on how people
sign in, because that question is still open and this count is the same under
every answer to it.

**Nothing here designs a gate.** No schema, no table, no session shape, no
provider, not even a sketch. #510 says why: an unused column that looks like
authorization is worse than none, because the next person builds against it.

Every claim below cites a file and a line, or is marked **unestablished**.

## Method, and what was verified rather than repeated

Read at `origin/master`, commit `3690dc5`, on 2026-09-03. The enumeration is a
reading job against `web/server/index.ts`. Line numbers were taken from that
commit and checked one by one. That file grows, and `docs/deployment-survey.md`
is a recent and useful document whose citations into it are already stale by a
few dozen lines even where every one of its claims is still correct, so nothing
below is copied from it.

Three of its claims are load-bearing here, and each was checked against the code:

| Claim | Where it is said | Verdict |
| --- | --- | --- |
| The photographs are "written by six code paths, read by eight, deleted by one" | `docs/deployment-survey.md:36` | **Confirmed.** Counted independently below. |
| "The client has one, it works, and nothing serves it" | `docs/deployment-survey.md:37`, and the section at `:325` | **Confirmed.** No `express.static` over `dist`, no `sendFile`, no SPA fallback, no server build. |
| A cover is a bare filename joined onto a directory | `docs/deployment-survey.md:36` | **Confirmed**, and the join is copy-pasted in four places rather than shared. |

The behavioural facts were established by booting the app with `aspire start`,
planting a known file in this checkout's own cover directory, and issuing the
requests. Every request quoted below carried no cookie, no header and no
credential of any kind.

## The answer in one line

**There are seventy-two doors and not one of them is locked.** Seventy-one
hand-declared route handlers over fifty-five distinct paths, plus one static
file mount that answers one path per photograph on disk. An unauthenticated
`GET` of a known cover filename returns `200` and the image bytes. An
unauthenticated `POST /api/fixtures` returns `201` and creates the row. Both are
true from the LAN address as well as from loopback.

## The single most important line

```
$ curl -i http://127.0.0.1:62808/api/covers/survey-511-known.jpg
HTTP/1.1 200 OK
Cache-Control: public, max-age=2592000, immutable
Content-Type: image/jpeg
Content-Length: 160
```

**An unauthenticated request for a known cover filename gets the photograph, at
200, with a thirty day immutable cache header on it.** Observed 2026-09-03
against the app booted by `aspire start`. The same request through the Vite dev
server, on the LAN address the phone actually uses, gets the same 200 and the
same bytes:

```
$ curl -k https://192.168.0.148:62810/api/covers/survey-511-known.jpg
200 image/jpeg 160
```

The thumbnail door beside it answers too. `GET /api/covers/<name>?w=160` returns
`200 image/jpeg` with a freshly resized body, from the same file, on the same
absence of any credential.

A filename nothing has gets a clean `404 {"error":"Not found."}`. That is the
error handler at `web/server/index.ts:3910` catching the `fallthrough: false`
miss, and the comment at `:3911-3919` explains why it is a 404 rather than a
500. So the covers surface will also tell a stranger which photographs exist and
which do not, without asking anything of them.

Path traversal is refused. `%2e%2e%2f%2e%2e%2fpackage.json` gets `403` both on
the static mount and through the thumbnail route. That is a real guard
(`web/server/index.ts:1010`, plus `send`'s own protection under
`express.static`), and it is worth saying plainly what it is: it stops a
stranger reading arbitrary files, and does nothing whatever to stop a stranger
reading every photograph in the collection.

## Every route

Seventy-one hand-declared handlers: 32 `GET`, 24 `POST`, 7 `PATCH`, 6 `DELETE`,
2 `PUT`, over fifty-five distinct paths. All of them are in
`web/server/index.ts`. There is no `Router`, no second route file, and nothing
under `web/application/`, `web/infrastructure/` or `web/domain/` registers a
path.

| # | Method | Path | Line | What it does |
| --- | --- | --- | --- | --- |
| 1 | GET | `/api/covers/:name` | 1003 | A resized copy of a photograph, at one of three fixed widths. Falls through to the static mount on a miss. |
| 2 | POST | `/api/captures` | 1049 | Accept three photos and return at once; reading them happens in the background. |
| 3 | GET | `/api/captures/:id` | 1133 | One capture, and whether it is a second photographing of a book already held. |
| 4 | GET | `/api/captures` | 1170 | The whole queue, deliberately unpaged. |
| 5 | POST | `/api/captures/:id/claim` | 1177 | Somebody takes a capture to work on. Reads a `who` from the body. |
| 6 | PATCH | `/api/captures/:id` | 1220 | Persist what somebody worked out about a queued capture. Reads a `who`. |
| 7 | POST | `/api/captures/:id/read` | 1286 | Read a capture's photographs again. |
| 8 | DELETE | `/api/captures/:id` | 1326 | Discard a scan. Nothing is actually deleted. |
| 9 | POST | `/api/identify/isbn` | 1368 | Read an ISBN out of one photo and answer straight away. |
| 10 | GET | `/api/lookup/isbn/:isbn` | 1434 | Look an ISBN up in the external catalogues. |
| 11 | GET | `/api/lookup/title` | 1464 | Search the external catalogues by title. |
| 12 | POST | `/api/placement/preview` | 1487 | Where would this book go, without saving it. |
| 13 | GET | `/api/placement/run` | 1574 | Where a run lives, what it is cut into, whether it can move. |
| 14 | POST | `/api/placement/run/plan` | 1595 | What moving a run would cost in books carried. |
| 15 | POST | `/api/placement/run` | 1606 | Apply that move. |
| 16 | GET | `/api/placement/rule` | 1642 | The rules on one place. |
| 17 | POST | `/api/placement/rule/plan` | 1650 | What a rule change would do. |
| 18 | POST | `/api/placement/rule` | 1665 | Apply the rule change. |
| 19 | GET | `/api/placement/unclaimed` | 1702 | Which books no rule claims. |
| 20 | GET | `/api/placement/drift` | 1738 | Every book the shelf and the rules disagree about. |
| 21 | POST | `/api/books` | 1747 | Save a book, out of the queue or from scratch. |
| 22 | GET | `/api/books` | 1930 | The listing, paged. |
| 23 | GET | `/api/shelves` | 1971 | What somebody standing at a bookcase is looking at. |
| 24 | POST | `/api/shelves/overflow/plan` | 2036 | What an overflow cascade would move. |
| 25 | POST | `/api/shelves/overflow` | 2078 | Apply it. |
| 26 | POST | `/api/shelves/move` | 2154 | Bounce a book onto the plank next door. |
| 27 | POST | `/api/shelves/retract` | 2196 | Take back a move nobody acted on. |
| 28 | DELETE | `/api/shelves/:id` | 2226 | Remove the line between two areas. |
| 29 | GET | `/api/books/:id` | 2293 | One book, and who it credits. |
| 30 | GET | `/api/books/:id/placements` | 2316 | Where a book has been. |
| 31 | PUT | `/api/books/:id` | 2327 | Edit a book. |
| 32 | GET | `/api/tags` | 2399 | The tag vocabulary, whole or under one slug. |
| 33 | PATCH | `/api/tags` | 2435 | Relabel a tag. |
| 34 | GET | `/api/books/:id/claim` | 2463 | Which rule put this book here, and which ones lost. |
| 35 | GET | `/api/books/:id/tags` | 2476 | A book's tags. |
| 36 | POST | `/api/books/:id/tags` | 2494 | Put a book under a tag. |
| 37 | DELETE | `/api/books/:id/tags` | 2518 | Take it off. |
| 38 | POST | `/api/books/:id/tags/refresh` | 2547 | Re-run the catalogue lookup for a book. |
| 39 | GET | `/api/fixtures` | 2635 | All the furniture. |
| 40 | PATCH | `/api/collection` | 2650 | What the whole collection falls back on. |
| 41 | GET | `/api/fixtures/:id` | 2659 | One piece of furniture. |
| 42 | POST | `/api/fixtures` | 2672 | Add a piece. |
| 43 | PATCH | `/api/fixtures/:id` | 2690 | Rename, renumber, or retype a piece. |
| 44 | GET | `/api/fixtures/:id/removal` | 2703 | What removing it would do. |
| 45 | DELETE | `/api/fixtures/:id` | 2721 | Take a piece of furniture away. |
| 46 | GET | `/api/fixtures/:id/books` | 2741 | The books standing on it, in order. |
| 47 | POST | `/api/fixtures/:id/areas` | 2760 | Cut another area into a piece. |
| 48 | PATCH | `/api/areas/:id` | 2782 | Rename, move, re-anchor or reorder an area. |
| 49 | GET | `/api/areas/:id/books` | 2804 | The books in one area, in order. |
| 50 | GET | `/api/areas/:id/removal` | 2823 | What removing the area would do. Writes nothing. |
| 51 | DELETE | `/api/areas/:id` | 2845 | Take an area off a piece. |
| 52 | GET | `/api/authors` | 2885 | Every author. |
| 53 | GET | `/api/authors/:id/books` | 2897 | Everything by one person. |
| 54 | POST | `/api/authors/merge` | 2919 | Two authors turn out to be one person. |
| 55 | PATCH | `/api/authors/aliases/:id` | 2948 | A name files under something else. |
| 56 | GET | `/api/books/:id/authors` | 2968 | A book's credits. |
| 57 | PUT | `/api/books/:id/authors` | 2987 | Restate who wrote a book. |
| 58 | GET | `/api/books/:id/captures` | 3027 | The photographs held for a book. Read only. |
| 59 | PATCH | `/api/books/:id/location` | 3091 | Say where a book physically is now. |
| 60 | DELETE | `/api/books/:id` | 3148 | Delete a book. |
| 61 | POST | `/api/books/:id/checkout` | 3180 | Take a book off the shelf, or put it back. |
| 62 | POST | `/api/backfill/covers` | 3242 | Kick the cover backfill. Deliberately not under `/api/covers`. |
| 63 | GET | `/api/checked-out` | 3492 | What is currently out. |
| 64 | POST | `/api/books/scan` | 3514 | Photo in, identity out, in one round trip. |
| 65 | GET | `/api/misfiles` | 3702 | The books to physically move, for one range. |
| 66 | GET | `/api/carry` | 3754 | Everything still to be carried, as trips. |
| 67 | GET | `/api/carry/trip` | 3766 | One trip, read at the area the books come off. |
| 68 | POST | `/api/carry/leave` | 3799 | Leave these books where they are. |
| 69 | POST | `/api/carry/restore` | 3815 | Ask for that work again. |
| 70 | GET | `/api/health` | 3845 | Counts, the database label, and the lookup source tallies. |
| 71 | GET | `/api/backup` | 3872 | Whether a backup exists that anybody has proved restores. |

Plus the static mount, which is door seventy-two and is not one path:

| Method | Path | Line | What it does |
| --- | --- | --- | --- |
| GET, HEAD | `/api/covers/*` | 1031-1038 | `express.static(coverDir, { immutable: true, maxAge: '30d', fallthrough: false })`. One answerable path per file in the cover directory. |

### Which of these an unauthenticated person would still have to reach

This is a real question rather than a rhetorical one, and the honest answer today
is: **none of them, which is not the same as saying the number after a gate is
zero.**

- **Nothing today is a login screen or a login endpoint**, so nothing on this
  list has to stay open on that account. There is no `/api/session`, no
  `/api/login`, nothing that authenticates anything. Verified: a grep across
  `web/server/`, `web/application/`, `web/infrastructure/`, `web/domain/` and
  `web/shared/` for `req.headers`, `req.cookies`, `req.ip`, `res.cookie`,
  `Set-Cookie`, `Authorization`, `Bearer`, `cookie-parser`, `express-session`,
  `passport` and `jsonwebtoken` returns **zero matches in non-test code**.
- **Whatever a login screen is served by, and whatever it posts to, will be new
  paths** rather than existing ones, because neither exists yet. That is the
  shape of the answer under every sign-in option: the set that must stay open is
  the set somebody adds, plus whatever assets that screen needs, and none of it
  is on the table above.
- **`GET /api/health` is the only existing candidate for staying open**, and it
  is a candidate rather than an obligation. Nothing probes it today: `apphost.mts`
  declares no health-check path (read in full, no `withHttpHealthCheck` or
  equivalent), and Aspire's readiness comes from its own resource model. But it
  answers with the collection's counts, the database host, port and database
  name, and the lookup source tallies (observed body, 2026-09-03), so leaving it
  open is a decision about what a stranger may learn rather than a free pass.
- **`GET /api/backup` is health-adjacent** and answers whether the collection is
  backed up. Same consideration, smaller.

Nothing else on the list has an argument for being reachable by a stranger.
Every one of the other sixty-nine handlers, plus the static mount, is either the
collection or a change to it.

## The photographs

The part most likely to be missed, so it gets its own count.

**A bare filename joined onto a directory, in four places, none of them shared.**
The directory is built once at startup:

```
web/server/index.ts:4030  const DATA_DIR = resolve(process.env.BOOKSCAN_DATA ?? 'data')
web/server/index.ts:4031  const COVER_DIR = join(DATA_DIR, 'covers')
```

and the three cover backfill CLIs each re-derive the identical
`resolve(BOOKSCAN_DATA)` then `join(..., 'covers')` shape independently
(`web/server/crop-books.ts:84`, `web/server/crop-captures.ts:84`,
`web/server/rehash-covers.ts:60`). There is no shared function. `coverDir` is
destructured inside the app factory at `web/server/index.ts:384`, and every site
does `join(coverDir, name)` against a name that came out of a database column or
a server-generated string.

**The counts, verified rather than repeated.** `docs/deployment-survey.md:36`
says six writers, eight readers, one deleter. Counted independently:

Writers, six, of which five are in the running app and one is a dev-only script:

| Where | What |
| --- | --- |
| `web/server/index.ts:576` | `saveImage`, a phone photo arriving on the save and capture routes |
| `web/server/index.ts:923` | `cropIo.write`, the background queue's derived crops |
| `web/server/covers.ts:88` | `downloadCover`, the re-encoded publisher cover |
| `web/server/crop-books.ts:148` | the `crop-books` CLI backfill |
| `web/server/crop-captures.ts:151` | the `crop-captures` CLI backfill |
| `web/scripts/seed-world.ts:256` | dev-only fixture generation |

Readers, eight:

| Where | What |
| --- | --- |
| `web/server/index.ts:1033` | the `express.static` mount, the main serve path |
| `web/server/index.ts:1011`, `:1014` | the thumbnail route's `sharp(...)` read |
| `web/server/index.ts:922` | `cropIo.read` |
| `web/server/index.ts:929-935` | the capture queue's photograph reader, for OCR and barcode decoding |
| `web/server/index.ts:3300` | `hashBook`, the perceptual hash |
| `web/server/crop-books.ts:147` | CLI backfill |
| `web/server/crop-captures.ts:150` | CLI backfill |
| `web/server/rehash-covers.ts:118` | CLI backfill |

Deleter, one: `web/server/index.ts:968`, `deleteOrphanedImages`, guarded by
`store.imageInUse` (`web/server/store.ts:841`).

**The count is right.** What matters for a gate is which of those fifteen are
HTTP, and the answer is two: the static mount and the thumbnail route, both
under `/api/covers`, both reached by the same prefix. The other thirteen reach
the directory directly from inside the process or from a CLI. So a gate over
`/api/covers` covers the whole HTTP-reachable cover surface, and nothing has to
be threaded through the backfills or the queue.

**And the request parameter does reach the filesystem.** The thumbnail route is
the only place a filename comes from a request rather than from the database
(`web/server/index.ts:1007-1011`). It rejects both separators explicitly and
`basename`s what is left. That guard was verified in behaviour, not only read:
an encoded traversal gets `403`.

## The client

**Nothing serves the built client. Confirmed against the code.**

- The only `express.static` in the whole server is the covers mount
  (`web/server/index.ts:1031-1038`). A grep of `web/server/*.ts` for `static`,
  `index.html`, `sendFile` and `dist` finds nothing else.
- `web/package.json:10` is `"build": "tsc --noEmit && vite build"`. That is the
  client only. **There is no server build step anywhere in the repository**, and
  no `start` script.
- The catch-all 404 is scoped to `/api` on purpose
  (`web/server/index.ts:3897-3899`, reasoning at `:3893-3895`). Verified in
  behaviour: `GET /` on the API returns Express's own default `404 text/html`,
  not the app.

**How it is served today.** By the Vite dev server, in development and in what
passes for production. `apphost.mts:238-254` wires the `web` resource as
`addViteApp` running the `dev:client` script, which is `vite`
(`web/package.json:9`). `AGENTS.md:251-261` records that the live machine runs
the same thing: a Windows scheduled task calling two files outside this
repository which set the connection and the data directory and run `npm run dev`.
`docs/process/handoff.md:75-80` says the same and adds that nothing in the
repository or CI has ever run the client build.

**Where that puts the two processes.** They bind differently, and it matters:

| Process | Binds | Cited | Verified by |
| --- | --- | --- | --- |
| API (Express) | `127.0.0.1` only | `web/server/index.ts:4079` | `curl http://<LAN ip>:<api port>/api/health` fails to connect |
| Client (Vite) | `0.0.0.0`, HTTPS, self-signed | `web/vite.config.ts:30`, `:28` | Vite prints `Network: https://192.168.0.148:62810/` |

Vite proxies `/api` to the API (`web/vite.config.ts:35-40`, target
`process.env.API_URL ?? 'http://127.0.0.1:3001'` at `:25`). So today **the Vite
dev server is the only externally reachable process, and everything the API can
do is reachable through it.** Verified from the LAN address, no credentials:

```
$ curl -k https://192.168.0.148:62810/api/covers/survey-511-known.jpg    -> 200 image/jpeg, 160 bytes
$ curl -k -X POST https://192.168.0.148:62810/api/fixtures -d '{...}'    -> 201
```

**Therefore, where a gate can sit.** Stated as what is true, not as a design.

- A gate **inside the API** would cover every `/api` path including both cover
  doors, and would cover nothing Vite serves itself: the app shell, the client
  bundle, and the dev-server surface below.
- A gate **in front of the static files** has nowhere to be written today,
  because no process in this repository serves static files for the client.
  Whatever would host them is a thing #471 has not chosen.
- The one structural finding of this survey follows: **hosting this app and
  gating it are the same decision.** For as long as the externally reachable
  process is `vite`, there is no place in this repository where a gate over the
  client can be written, because Express is not in that request path at all.
  #510 already notes that this epic and #471 touch at the certificate. They touch
  here too, and harder.

## Everything that is not a hand-declared HTTP route

The category this document exists to prevent a hole in.

**Websockets and server-sent events in the application: none.** Grepped `web/`
for `WebSocket`, `socket.io`, `EventSource`, `text/event-stream`, `res.write(`
and `flushHeaders`. The only hit outside comments is a transitive
`@opentelemetry/instrumentation-socket.io` package in `web/package-lock.json`,
pulled in by the auto-instrumentation bundle to add spans if a socket.io server
existed. There is none.

**A websocket that does exist, and it is Vite's.** The HMR channel runs on the
same port and the same HTTPS listener as the client (`web/vite.config.ts:27-34`,
no `server.hmr` override, so Vite's default). Because `host: true` binds
`0.0.0.0`, it is reachable from the LAN. **Verified**: an unauthenticated
`Upgrade: websocket` request carrying `Sec-WebSocket-Protocol: vite-hmr` to
`https://localhost:62810/` returns **`101 Switching Protocols`** and the socket
stays open. This is not an Express route, it is not in `web/server/`, it is not
covered by the deployment survey's static-mount analysis, and it is on the
production machine today because production is `npm run dev`.

**The rest of the Vite dev surface, all unauthenticated, all verified:**

| Request | Result |
| --- | --- |
| `GET /` | `200 text/html`, the app shell |
| `GET /library/anything` | `200 text/html`, the SPA fallback answers any path |
| `GET /@vite/client` | `200 text/javascript` |
| `GET /src/main.tsx` | `200 text/javascript`, transformed source |
| `GET /@fs/<abs path>/web/vite.config.ts` | `200`, 4306 bytes of source |
| `GET /@fs/<abs path>/AGENTS.md` | `403`, outside Vite's root, which is `web/` |

So `/@fs/` will hand any file under `web/` to anybody who asks. No
`server.fs.allow` is configured; `web/vite.config.ts` has no `fs` block.

**OpenTelemetry: export only, nothing listens.** `web/instrumentation.ts:16-190`
builds a `NodeSDK` with an OTLP trace exporter and a
`PeriodicExportingMetricReader` wrapping a push exporter. Both are outbound
clients. Nothing in that file calls `.listen()`, opens a socket, or registers a
route. The auto-instrumentation at `:131-134` patches `http` and `express` to
emit spans about requests already being served; it adds no path. If
`OTEL_EXPORTER_OTLP_ENDPOINT` is unset the whole block is skipped (`:87-90`).
`web/server/otel.ts:1-69` is pure helper logic with no network code. **There is
no metrics scrape endpoint and no Prometheus exporter**, so the OpenTelemetry
surface is not a way in.

**The Aspire dashboard listens, and it is not this app.** A separate process with
its own OTLP receiver and web UI on a port that changes every start, gated by a
token embedded in the URL (`AGENTS.md:625`). It is development tooling and is not
part of any deployment this repository describes, but it is named here so nobody
counts it as covered by a gate written in `web/`.

**Ports bound, in the whole repository:**

| Where | What |
| --- | --- |
| `web/server/index.ts:4079` | The one production bind. `127.0.0.1` only, guarded by the `isMainModule` check at `:3997-3998` so an import never binds. |
| Vite, via `web/vite.config.ts:24`, `:30`, `:34` | `0.0.0.0` on `VITE_PORT`, HTTPS, `strictPort: true` |
| Thirteen `*.routes.test.ts` and `index.test.ts` files, `app.listen(0)` | Test only, ephemeral port |
| `catalogue-sru.test.ts`, `lookup-*.test.ts`, `e2e/support/catalogue-stub.ts` | Test only, stub external catalogues on `127.0.0.1:0` |

Nothing else in `web/`, `apphost.mts` or `scripts/` creates a server. The `spawn`
and `execFile` calls that exist run `pg_dump`, `npm ci`, git tooling and a
browser, none of which accept a connection.

**Middleware mounted by a library: none.** There are exactly four `app.use` calls
and all four are Express core or hand-written:

| Line | What |
| --- | --- |
| `web/server/index.ts:979` | `express.json({ limit: '12mb' })`, the body parser |
| `web/server/index.ts:1031-1038` | `express.static` over the cover directory |
| `web/server/index.ts:3897-3899` | Hand-written `/api` catch-all 404 |
| `web/server/index.ts:3910` | Hand-written four-argument error handler |

`web/package.json` has no `helmet`, no `cors`, no `compression`, no `morgan`, no
`body-parser`, no `multer`, no `passport` and no `express-*` package of any kind.
**Nothing mounts a route this survey has not seen.**

**Caller-controlled outbound fetch: none.** Every external origin is a
module-level constant read from server configuration (`web/server/lookup.ts:72-77`,
`web/server/covers.ts:25-29`, `web/server/catalogue-sru.ts:85-97`), and every
request goes through one chokepoint (`web/server/bounded-fetch.ts:57-102`). A
grep for `body\.\w*[Uu]rl`, `query\.\w*[Uu]rl` and `params\.\w*[Uu]rl` across
`web/server/*.ts` returns **zero matches**. No route reads a URL out of a request
at all.

## What the server already knows about a request

**Almost nothing, and there is no place a check currently goes once.**

There are four `app.use` calls, listed above. Two are terminal (the 404 and the
error handler), one is the body parser, one is the static mount. **There is no
middleware between the parser and the handlers**, so there is no seam today. There
is also nothing in the way of one: anything mounted after
`web/server/index.ts:979` and before `:1003` would see every request the app
answers, including both cover doors. Saying that is not designing the gate; it is
saying that the shape of this file does not obstruct one.

**There is no request context.** No `AsyncLocalStorage`, no `res.locals`
convention, no augmented `Request` type. `asyncRoute`
(`web/server/index.ts:291-297`) is the only wrapper any handler wears and it does
exactly one thing, `handler(req, res).catch(next)`. It carries nothing.

**The nearest thing to identity is free text in a body.** Exactly two handlers
read anything that names a person, and both read it from the JSON body rather
than from any header or cookie:

```
web/server/index.ts:1181  const who = String((req.body ?? {}).who ?? '').trim() || 'unknown'
web/server/index.ts:1222  const who = String(body.who ?? '').trim() || 'unknown'
```

That is `POST /api/captures/:id/claim` and `PATCH /api/captures/:id`. It is
whatever the client sent, it defaults to the string `unknown`, and #510 has
already decided that `claimed_by` and `edited_by` stay free text. **They are not
a place a session hangs from**, and they are recorded here only so nobody
mistakes them for one.

**What shape a gate would take, given what is there.** Every request the app
answers passes through one Express app built by one factory in one file. A check
placed as middleware in that file would cover all seventy-one handlers and the
static mount together, without touching a single handler. That is the whole of
what the API answers. It does not, and cannot, cover anything Vite serves: the
app shell, the client bundle, the HMR websocket and `/@fs/`. Those are the two
halves, and only one of them is inside this repository.

## State, and what a session would attach to

**The server keeps nothing per request.** No session store, no cache keyed by
caller, no in-memory map of anything a request identifies itself with. Verified
by the same zero-match grep as above: no `express-session`, no `cookie-parser`,
no `res.cookie`, no `Set-Cookie` anywhere in non-test code.

What the server does hold is process-wide and unrelated to callers:

- `settled()` (`web/server/index.ts:480`), which waits for background work that
  routes started and did not await. An app-level handle exposed for tests, not a
  per-request thing.
- The catalogue connection, opened once during bootstrap
  (`web/server/index.ts:4069`).
- The OCR and cover warmup, kicked once, three seconds after listen.

**So sessions are a new concern rather than an existing one.** There is nothing
today to attach one to and nothing today that would conflict with one. That is a
finding rather than a recommendation: it means the storage question is open in
both directions, and #510 is right that it should stay open until the sign-in
question is answered.

One detail worth recording because it is easy to get wrong later. The client's
only path to the server is `web/src/lib/api.ts`, which makes exactly one `fetch`
call (`web/src/lib/api.ts:1378`) with a `Content-Type` header and **no
`credentials` option**. Browsers default `fetch` to `same-origin` credentials,
and the client's requests are same-origin because Vite proxies `/api`, so a
cookie would in fact be sent today without that line changing. **Read, not
observed**: no browser was driven to confirm it.

## What this survey did not establish

- **Whether any of this is reachable from outside the house.** That is #471's
  question. This document says what is reachable from the LAN, which was
  verified, and nothing about what is reachable from the internet, which was not.
- **What the live machine's two launcher files actually contain.** They are
  outside this repository, under `book-scan-production-data`, which is out of
  bounds. `AGENTS.md:251-261` and `docs/process/handoff.md:75-80` describe them
  and agree with each other; this survey repeats their description and marks it
  **not independently verified**.
- **Whether the Aspire dashboard's URL token is the only thing in front of it.**
  Read at `AGENTS.md:625`, not tested. Development tooling and out of scope, but
  unestablished rather than established.
- **Anything about how people sign in.** Deliberately. That question is open, and
  every count above is the same under every answer to it.

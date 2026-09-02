# What this app needs in order to run somewhere else

A survey for #472, under epic #471. It answers one question: **what does this
repository actually require in order to run on a machine that is not Blake's
Windows desktop?**

It is a description, not a design. Nothing here recommends a host. Every claim
is read out of the repository at a named file and line, or is marked as
unestablished. The app was deliberately not booted for this survey, on the
issue's instruction, because other agents were holding Aspire environments on
the same machine at the time. Where something could not be established by
reading, section 8 lists it as an open question rather than guessing.

`docs/` in this repository holds arguments and specifications as well as
descriptions. `docs/reading-status.md` says in its own third paragraph that
nothing in it is built. So nothing below is repeated from a document; documents
are cited only where the document itself is the subject.

Line numbers are as of `58606cb`.

---

## Summary

| Question | The short answer |
| --- | --- |
| Configuration surface | **Not two variables. Twelve are read at runtime.** One must be set or the process exits. One carries a secret. Five default to origins on the public internet. |
| The photographs | One directory of files addressed by bare filename, written by five code paths and read by six. A deployment must provide one writable directory that every process touching the catalogue shares, and back it up separately from Postgres. |
| A production build | **The client has one and nothing serves it. The server has none at all**: every path that exists today runs the server from TypeScript source under `tsx`. |
| The database | Schema is applied on **every server start**, inside `openPostgres`. An empty database silently becomes a complete, empty catalogue and the process reports success. |
| `apphost.mts` | **A development orchestrator only.** It launches `npm run dev:server` and `npm run dev:client`. It is not a deployment mechanism. |
| Windows-shaped | The backup toolchain and the secret-at-rest mechanism are PowerShell and DPAPI and do not survive Linux. The application code itself is not obviously Windows-bound. |

---

## 1. Configuration

`AGENTS.md` says the surface is `ConnectionStrings__bookscan` and
`BOOKSCAN_DATA`. **Those are the two that matter, and they are not the whole
surface.** A search for `process.env` across `web/`, `scripts/`, `apphost.mts`
and `e2e/`, discounting test files, finds twelve variables read at runtime by
the server or by the client's dev server.

### Read by the API server process

| Variable | Read at | When absent | Secret |
| --- | --- | --- | --- |
| `ConnectionStrings__bookscan` | `web/server/db.pg.ts:552` | **Throws, naming itself; the process exits 1.** | Yes: carries the Postgres password |
| `BOOKSCAN_DATA` | `web/server/index.ts:3935` | `./data`, resolved against the process working directory | No |
| `PORT` | `web/server/index.ts:3934` | `3001` | No |
| `BOOKSCAN_BACKUP_DIR` | `web/server/index.ts:3965` | `''`: nothing is watched, said out loud in the startup log | No |
| `GOOGLE_BOOKS_API_KEY` | `web/server/secrets.ts:48` | `''`. A supported state; requests then go out anonymously into a shared quota that is permanently exhausted | **Yes** |
| `BOOKSCAN_OPENLIBRARY_URL` | `web/server/lookup.ts:72` | `https://openlibrary.org` | No |
| `BOOKSCAN_GOOGLE_BOOKS_URL` | `web/server/lookup.ts:73` | `https://www.googleapis.com` | No |
| `BOOKSCAN_COVERS_URL` | `web/server/covers.ts:25` | `https://covers.openlibrary.org` | No |
| `BOOKSCAN_LOC_SRU_URL` | `web/server/catalogue-sru.ts:87` | `https://lx2.loc.gov:210/lcdb` | No |
| `BOOKSCAN_K10PLUS_SRU_URL` | `web/server/catalogue-sru.ts:94` | `https://sru.k10plus.de/opac-de-627` | No |
| `BOOKSCAN_SRU_PACE_MS` | `web/server/source-pace.ts:46` | The built-in pace between SRU requests | No |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_LOG_LEVEL` | `web/instrumentation.ts:22`, `:79`, `:108` | No endpoint, so nothing is exported | No |

`BOOKSCAN_TEST_DATABASE_URL` (`web/server/pgcontainer.ts:70`,
`web/server/testdb.ts:189`), `BOOKSCAN_SEED_TARGET`
(`web/scripts/seed-world.ts:109`), `BOOKSCAN_E2E_RUN` (`apphost.mts:56`) and the
`BOOKSCAN_E2E_*` family (`e2e/global-setup.ts:225-233`) are read by the test and
seed harnesses only. They are not part of a deployment's surface, but they are
part of its **blast radius**: an ambient value in a shell can redirect a
harness. `web/server/db.pg.ts:539-548` explains why the server deliberately
accepts one spelling of the connection and nothing else, not `DATABASE_URL` and
not `PG*`, precisely so an inherited shell variable cannot decide what gets
written to.

### What that changes about the deployment picture

**Only one variable is mandatory.** `catalogueConnection()` at
`web/server/db.pg.ts:551-560` throws when the value is empty, and the
`bootstrap().catch` at `web/server/index.ts:4020-4026` turns that into
`process.exitCode = 1`. Nothing else refuses to start.

**`BOOKSCAN_DATA` is not mandatory, and that is the hazard.** Absent, the server
resolves `./data` against wherever the process was started
(`web/server/index.ts:3935`), joins `covers` onto it (`:3936`), creates that
directory with `mkdirSync(..., { recursive: true })` (`:3967`), and comes up
reporting success. A deployment that forgets it does not fail. It serves a
catalogue whose every photograph is a 404, and whose new photographs are written
somewhere ephemeral.

**Five origins default to the public internet.** Open Library metadata, Open
Library covers, Google Books, the Library of Congress SRU endpoint and K10plus
are all `||`-defaulted to real hosts. A deployment needs outbound HTTPS to
`openlibrary.org`, `covers.openlibrary.org`, `www.googleapis.com`,
`lx2.loc.gov` (port 210) and `sru.k10plus.de`, or scanning identifies nothing.
That is not optional behaviour; identifying a book is what the app is for.

**Two values are secrets, and both are handled today by a Windows-only
mechanism.** `web/server/secrets.ts:1-27` documents it: the secret at rest is a
DPAPI-encrypted file at `%LOCALAPPDATA%\book-scan\backup-connections.json`,
written by `scripts/write-connection-file.ps1` and by nothing else, which
"decrypts only for the account that wrote it, on that machine". A launcher
decrypts it into its own process environment. **None of that moves to another
host.** Any deployment has to replace it, and the shape it must preserve is
stated in the same comment: what travels on a command line is a path, never a
value, and the server reads one variable by one function and consults nothing
else. Section 6 lists the files.

### Read by the client

The client reads **no** environment variables at runtime. There is no
`import.meta.env` use anywhere under `web/src/`. Two variables are read by
`web/vite.config.ts`, and both configure the **dev server** only:

| Variable | Read at | Effect |
| --- | --- | --- |
| `VITE_PORT` | `web/vite.config.ts:24` | Dev server port, default `5173` |
| `API_URL` | `web/vite.config.ts:25` | Dev server proxy target for `/api`, default `http://127.0.0.1:3001` |

`vite.config.ts:35-40` puts the `/api` proxy inside the `server:` block, which
`vite build` does not emit. The client addresses the API with same-origin
relative paths and nothing else: `/api/...` appears about a hundred times under
`web/src/`, for example `web/src/components/PlacementCard.tsx:8` building
`/api/covers/${encodeURIComponent(filename)}`, and there is no base-URL constant
to point elsewhere. **A deployment must therefore serve the built client and the
API on the same origin**, with something in front routing `/api` to the API
process. Nothing in this repository is that something today. See section 3.

---

## 2. The photographs

The photographs are not in the database and not in the repository. The database
holds a **bare filename**, and every path to a file is built at read time by
joining that filename onto one directory. There are two joins in the whole
system and they compose: `<BOOKSCAN_DATA>` joined with `covers`
(`web/server/index.ts:3935-3936`), and that joined with the filename.

`#471` gives the count as 1541 files. That is the epic's number, not one
measured here: the live directory is out of bounds to agents, so nothing in this
survey counted them.

### Every path that writes a file

| Where | What it writes | Name it chooses |
| --- | --- | --- |
| `web/server/index.ts:570-574` (`saveImage`) | A photograph taken on the phone, from `POST /api/captures` and the book-save routes | `${Date.now()}_${isbn or 'noisbn'}_${slot}.jpg` |
| `web/server/covers.ts:87-88` (`downloadCover`) | The publisher's cover, fetched from Open Library or Google Books and re-encoded | `${Date.now()}_${isbn or 'noisbn'}_${8 hex}_cover.jpg` |
| `web/server/index.ts:911` (`cropIo.write`) | Derived crops, written by the background capture queue | chosen by the crop code |
| `web/server/crop-books.ts:148` | Derived crops, from the `crop-books` command-line backfill | as above |
| `web/server/crop-captures.ts:151` | Derived crops, from the `crop-captures` command-line backfill | as above |
| `web/scripts/seed-world.ts:256` | Generated fixtures. Development only | as above |

Two of those are **background** writers in the server process: `cropIo.write`,
and the cover download reached from the save path at `web/server/index.ts:3117`
and `:3127`. Writing is not confined to the request that triggered it.

### Every path that reads one

| Where | What it reads for |
| --- | --- |
| `web/server/index.ts:1019-1026` | `express.static(coverDir, { immutable: true, maxAge: '30d', fallthrough: false })`, mounted at `/api/covers`. This is how every photograph reaches a phone. |
| `web/server/index.ts:995-1013` | On-the-fly thumbnails, `GET /api/covers/:name?w=`, through `sharp(join(coverDir, basename(name)))`. Nothing is written; a miss falls through to the static mount. |
| `web/server/index.ts:910` (`cropIo.read`) | The crop detector reading a photograph |
| `web/server/index.ts:917-924` | The capture queue reading a photograph for OCR and barcode decoding |
| `web/server/index.ts:3200-3208` (`hashBook`) | `coverHash(readFileSync(join(coverDir, name)))`, so a book can be recognised by its cover |
| `web/server/crop-books.ts:147`, `web/server/crop-captures.ts:150`, `web/server/rehash-covers.ts:118` | The three command-line backfills |

### And the one that deletes

`deleteOrphanedImages` at `web/server/index.ts:951-963`: `rmSync(join(coverDir,
name), { force: true })` at `:956`, but only for a name `store.imageInUse`
(`web/server/store.ts:841`) says nothing points at any more. The comment above it
at `:946-949` says why the check is not optional: a capture hands its filenames
to the book it becomes, so a capture and a shelved book routinely name the same
file.

### What a deployment has to provide

1. **One writable directory, and every process that touches the catalogue must
   see the same one.** The API writes it on the request path and from background
   jobs; the three backfill tools each resolve `BOOKSCAN_DATA` independently
   (`crop-books.ts:84-85`, `crop-captures.ts:84-85`, `rehash-covers.ts:60-61`)
   and write into it too. A deployment that runs the API in a container and the
   backfills anywhere else has to mount the same storage into both.
2. **It must outlive the process.** A container that loses its filesystem loses
   every photograph, and there is no second copy inside the app. The names are in
   Postgres; the bytes are not.
3. **It must be backed up separately from the database, and restored to the same
   moment.** `web/server/backup-catalogue.ts:108` says so in its own help text:
   "The cover photographs are NOT in the dump. pg_dump moves rows, not files." A
   database restored from one moment against a covers directory from another
   gives rows naming files that are not there, and `express.static(...,
   { fallthrough: false })` turns every one of those into a 404 rather than
   anything the app explains.
4. **Space that grows per book.** Fetched covers are re-encoded to at most
   1000px wide JPEG at quality 82 (`web/server/covers.ts:73-75`); phone
   photographs are stored as the camera produced them
   (`web/server/index.ts:570-574`), with the request body limit at 12 MB
   (`web/server/index.ts:967`). AGENTS.md line 448 records 1.1 GB of copied cover
   files lost to one test run during the stage H rehearsal, which is the only
   size figure written down in this repository. That is a claim from that
   document, not a measurement made here.

### Is any of it Windows-shaped?

**No, and the one risky place was deliberately written not to be.** Every path is
built with `node:path`'s `join` and `resolve`, which are platform-correct. Where
a filename off a URL becomes a path, both separators are refused outright
(`web/server/index.ts:996-998`), under the comment "A filename, never a path.
`basename` on its own is enough on POSIX and both separators are refused outright
so this reads the same everywhere."

The **filenames themselves** are the thing to check on a move, not the code. They
are built from `Date.now()`, an ISBN, and a slot or hex suffix, so they hold no
character that differs between filesystems. Case sensitivity is the residual risk
and it is not established here: whether any name stored in Postgres differs from
its on-disk spelling only by case has never mattered on NTFS and would matter on
ext4. Section 8 records it as open.

---

## 3. The build

### What exists

`web/package.json:10`: `"build": "tsc --noEmit && vite build"`.

The first half is exactly `npm run typecheck` (`web/package.json:11`), which CI
runs on every non-documentation pull request
(`.github/workflows/ci.yml:170-173`). That half is therefore proven green
continuously.

The second half, `vite build`, is run by **nothing in this repository**. It is
not in `.github/workflows/ci.yml`, not in `.github/workflows/e2e.yml`, not in
`apphost.mts`, and not in any script under `scripts/`. The only other mention of
`npm run build` anywhere is `scripts/guard-live-data.test.mjs:81`, where it is a
fixture in the guard's allow-list.

`web/vite.config.ts:42-45` configures it: `outDir: 'dist'`, `sourcemap: true`.
It would produce `web/dist`, which `.gitignore` excludes.

**Whether `vite build` succeeds today is not established.** It was not run: this
worktree has no `node_modules`, so running it would have meant a multi-gigabyte
install on a machine other agents were holding environments on. Section 8 records
it as the one question a deployment design should settle by running, and settling
it is cheap.

### What does not exist

**There is no server build at all.** Every path that starts the server runs
TypeScript source through `tsx`:

- `web/package.json:8`: `"dev:server": "tsx watch server/index.ts"`
- `apphost.mts:202-204`: `addNodeApp('api', './web', 'server/index.ts')` with
  `.withRunScript('dev:server')`, and the comment at `:203` says why: "tsx,
  because the server is TypeScript and is not built before running."
- The backfill and backup tools are invoked as `npx tsx server/<tool>.ts`, for
  example `scripts/backup-catalogue.ps1:178`.

There is no `tsc` emit for the server, no bundler step, no `start` script, and no
Dockerfile or compose file anywhere in the repository. **A deployment therefore
either ships the TypeScript sources plus `tsx` and the whole dependency tree, or
somebody adds a server build.** Either is a decision, and nothing here makes it
today.

Two things constrain that decision:

- **The migration `.sql` files are read from disk at runtime**, relative to the
  module: `MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations',
  import.meta.url))` at `web/infrastructure/db/migrate.ts:55`, and
  `migrate.ts:299-301` reads `./migrations/meta/_journal.json` the same way. Any
  bundling has to carry `web/infrastructure/db/migrations/` as files beside the
  output rather than inlining them.
- **Native and self-downloading dependencies.** `web/package.json` depends on
  `sharp`, `onnxruntime-node`, `@grpc/grpc-js`, and the OCR and barcode stacks
  `tesseract.js`, `ppu-paddle-ocr`, `zxing-wasm` and `@undecaf/zbar-wasm`. The
  AppHost comment at `apphost.mts:180-186` records that `onnxruntime-node`
  "fetches its own binary during install, from a host that is not always
  reachable". An image has to be built for the target platform and architecture,
  and its install step needs network access to more than the npm registry.
  `package.json:8` at the repository root pins `engines.node` to
  `^20.19.0 || ^22.13.0 || >=24`, and CI runs Node 22
  (`.github/workflows/ci.yml:121-124`).

### Nothing serves the built client

The API mounts exactly one static directory and it is the covers
(`web/server/index.ts:1019-1026`). There is no `express.static` over `dist`, no
`sendFile`, and no SPA fallback: `web/server/index.ts:3802-3804` 404s everything
under `/api` that matched no route, and the comment above it at `:3798-3800` says
the rest is not its job. "Everything else this server does not answer belongs to
Vite in development, and the client's own routing is not this file's to 404."

In development Vite serves the client and proxies `/api` to the API
(`web/vite.config.ts:29-41`). **In a deployment there is no Vite.** So the
deployment has to supply what Vite was supplying:

- a static file server for `web/dist`, with an SPA fallback to `index.html`;
- a reverse proxy putting `/api` on the **same origin** as that client, because
  the client has no configurable API base and addresses `/api/...` relatively
  (section 1);
- TLS. `web/vite.config.ts:5-9` records why the dev server speaks HTTPS at all:
  Safari refuses `getUserMedia` a camera stream outside a secure context, and
  `http://192.168.x.x` is not one. **A phone-first scanning app served over plain
  HTTP will not open the camera.** The dev server's answer is
  `@vitejs/plugin-basic-ssl`, a self-signed certificate, which is a development
  answer and not a deployment one.

### The API binds loopback

`web/server/index.ts:3984`: `app.listen(PORT, '127.0.0.1', ...)`. The API accepts
connections from its own host only. That is right today, because only Vite on the
same machine talks to it. Where the reverse proxy is a different container or a
different host, **this line has to change**, or the proxy has to share the
network namespace. It is one of very few places where running this app somewhere
else requires an application-code edit rather than configuration.

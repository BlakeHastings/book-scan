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

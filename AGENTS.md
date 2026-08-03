# AGENTS.md

Instructions for coding agents working in this repository. Read this before
touching anything.

## What this is

A phone-first web app for cataloguing a physical book collection. You hold a
book up to a phone camera, it decodes the barcode or reads the printed ISBN,
confirms the record against Open Library, and tells you which two shelved books
the new one belongs between.

All the code lives under `web/`. It is a TypeScript project: React 18 and Vite
on the client, Express and better-sqlite3 on the server.

## The one rule that matters most

**There is real production data, and it is not in this repository.**

The catalogue is a live record of someone's actual book collection: 57 books
and 286 cover photographs at the time of writing. Re-scanning it means
physically handling every book again. Treat it as irreplaceable, because it is.

It lives outside this repo, at:

```
C:\Users\Blake\book-scan-production-data\live\
```

Agents must never read from, write to, point a dev server at, run a migration
against, or delete anything in that directory or any sibling under
`book-scan-production-data\`.

You do not need it. Everything you need to develop and test is generated
locally. If you believe a task requires production data, stop and ask the owner
instead of proceeding.

### Why you are unlikely to reach it by accident

The safety here is structural, not just a request:

- The server resolves its data directory as
  `process.env.BOOKSCAN_DATA ?? 'data'` (`web/server/index.ts:40`). With no env
  var set, it uses `web/data/` inside your checkout, never the live path.
- **Do not set `BOOKSCAN_DATA`.** It is the only thing standing between a dev
  server and the real catalogue.
- Every server test opens an in-memory database (`:memory:`) and generates its
  own barcode and cover fixtures. `npm test` cannot reach real data.
- `web/.gitignore` excludes `data/`, so a database or cover photo cannot be
  committed. CI re-checks this on the result, because an ignore rule is silent
  when someone forces past it.

If you add a test that needs a database, open `:memory:` like the existing ones
do (see `web/server/store.test.ts`). Never write a test that touches a path
outside the repository.

## Running things

All commands run from `web/`.

```
npm ci             # install
npm run dev        # server on :3001 and client on :5173, over HTTPS
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run build      # typecheck then vite build
```

`npm run dev` binds `0.0.0.0:5173` with a self-signed certificate. That is
deliberate: Safari refuses `getUserMedia` a camera stream over plain HTTP on a
LAN address, so the phone needs HTTPS.

Both checks must pass before a pull request is ready. As of this writing
`npm run typecheck` is clean and `npm test` reports 203 tests passing across 10
files in about 18 seconds. If the count drops, you removed a test.

## Layout

| Path | What lives there |
| --- | --- |
| `web/src/` | React UI |
| `web/src/lib/api.ts` | Typed fetch wrapper, the only client to server path |
| `web/server/index.ts` | Express routes, data directory resolution |
| `web/server/identify.ts` | Barcode decoding then OCR of the printed ISBN |
| `web/server/paddle.ts` | PaddleOCR, the primary OCR engine |
| `web/server/lookup.ts` | Open Library primary, Google Books top-up |
| `web/server/store.ts` | All SQL |
| `web/server/shelves.ts` | Shelf capacity and derived locations |
| `web/shared/` | Domain rules shared by client and server |
| `docs/shelving.md` | The shelving specification |

## Conventions

- `docs/shelving.md` is the authority on filing and placement rules. If code
  and that document disagree, the document wins, unless the owner has said
  otherwise in an issue. Do not silently change behaviour that it specifies.
- Client and server never share a database connection. The client talks to the
  server only through `web/src/lib/api.ts`.
- Tests run against real dependencies where it is affordable: real SQLite in
  memory, real barcode decoding, real OCR against generated images. Prefer that
  over mocks.
- Do not use em dashes in code comments, commit messages, or documentation.

## History

This repository previously held a Python and Tkinter desktop implementation of
the same product. It was retired in `e8b6808` and is preserved in history at
`6f1ff08`. Do not reintroduce it, and do not try to keep it in sync.

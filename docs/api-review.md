# The API layer, read (#328)

A reading of every route in `web/server/index.ts`, every request `web/src` makes,
and the layering underneath both. Nothing was changed. Where this claims
something is slow, the number was measured against a real Postgres and the
harness that produced it is described so it can be re-run.

> **Findings 1 to 4 were fixed by #332, and finding 5 was not.** This page is
> left as it was written, because it is the reading rather than the changelog and
> because the numbers in it are what the fix was measured against. What has
> changed since: `GET /api/shelves` is flat in the number of checked-out books,
> a malformed id is a 404 on every route and `Number(req.params.id)` appears
> nowhere in `index.ts`, an unmatched path under `/api` answers `{ "error":
> "Not found." }`, `GET /api/books` answers at most one page when nobody asks for
> one, `api.listBooks` is deleted, and `summary.tsx` fetches the capture queue on
> the two screens that read it rather than on every navigation. The fourteen dead
> routes of finding 5 are still there, deliberately: it is the one finding this
> page itself calls bloat rather than risk.

## The short answer

**It is one API, and it is broadly sound.** That is the honest verdict and it is
worth saying before the list, because a list always reads worse than the thing
it describes.

The evidence for it, briefly:

- Every error in the whole surface is `{ "error": "..." }`. Sixty routes, one
  error body, no exceptions. That is rarer than it sounds and it is what makes
  the client's single `Refusal` class (`web/src/lib/api.ts:864`) possible.
- Every identifier is a numeric path parameter in the same position. There is no
  route taking an id in a body where a sibling takes it in a path.
- The layering check passes: `depcruise domain application infrastructure server
  shared src` reports no violations across 353 modules and 1576 dependencies. The
  application layer is not decorative either. Thirteen of its files exist and
  twelve are instantiated and called from `server/`.
- The listing screen, which is the one that would fall over first, already pages
  properly (`web/server/index.ts:1376`, `web/src/app/listing.ts`), with `total`
  meaning what the query matched rather than what the page holds.
- There are no N+1 request loops in the client and no per-book cover fetches.
  Covers are asked for at draw size.

Five things below are real problems. Two of them are bugs. The rest of the
document is taste, and is labelled as such.

---

## 1. `GET /api/shelves` is quadratic, and it is the shelves screen

**Real problem. The most serious thing here.**

`web/server/index.ts:1406-1413`:

```ts
checkedOut: await Promise.all(
  (await store.checkedOut())
    .filter((book) => book.shelf_range === range)
    .map(async (book) => ({
      book,
      label: await shelves.shelfForSortKey(range, book.sort_key),
    })),
),
```

`shelfForSortKey` (`web/server/shelves.ts:292`) calls `layoutWith`, which calls
`booksIn(range)` and lays out the entire run. So this reads and sorts every book
in the range once **per checked-out book**. It is O(checked-out x books-in-range),
issued on a screen somebody opens while standing at a bookcase.

Measured, 600 books in one range, best of three, warm:

| Checked out | `GET /api/shelves` |
| --- | --- |
| 0 | 52 ms |
| 25 | 294 ms |
| 50 | 474 ms |
| 100 | 834 ms |
| 200 | 1379 ms |

Both factors grow with the catalogue. At ten times the books and the same
proportion checked out, the same arithmetic gives roughly a hundred times that
last figure. The screen stops being usable long before that.

`GET /api/checked-out` (`web/server/index.ts:2710`) answers the same set of books
in 9 ms at the same scale, because it does not do this. The cost is entirely the
per-book relayout.

*How it was measured:* a temporary vitest file beside `web/server/index.test.ts`,
using the same harness (`startApp` in that file), seeding books through
`Store.addBook`, checking them out through `POST /api/books/:id/checkout`, and
timing the route over real HTTP against the testcontainers Postgres. The file was
deleted afterwards; nothing in the repository changed.

Also, separately: the same response carries every book in the range with no
paging, 646 KB at 600 books. See finding 4.

## 2. A malformed id is a 500, and it is not a 500 on every route

**Real problem, and a bug.**

`web/server/index.ts:1635-1636`:

```ts
const id = Number(req.params.id)
const book = await store.getBook(id)
```

`Number('notanumber')` is `NaN`, which reaches Postgres and comes back as
`invalid input syntax for type integer: "NaN"`. Measured:

```
GET /api/books/notanumber     -> 500 {"error":"Something went wrong."}
GET /api/fixtures/notanumber  -> 404 {"error":"No such piece of furniture."}
```

The furniture routes answer correctly because `web/server/furniture.ts` guards
the parse behind its `Refused` union. The book, capture, tag, author and area
routes do not: `Number(req.params.id)` appears unguarded at
`web/server/index.ts:881, 899, 940, 997, 1635, 1656, 1665, 1798, 1808, 1824,
1846, 1873, 2210, 2228, 2245, 2283, 2337, 2375, 2405`.

Concrete consequences, in order of how much they matter:

1. A client mistake is logged as a server fault, with a Postgres stack trace, on
   a path a stranger can hit. `web/server/index.ts:3015` writes `[api] unhandled
   route error:` with the full error object. That is the log line somebody will
   one day be scrolling past looking for a real fault.
2. Two adjacent routes answer the same class of bad input two different ways,
   which is exactly the "two ways of saying one thing" the issue was asking
   about. The furniture routes are the ones that are right.

Nothing in `web/src` currently sends a non-numeric id, so this is not breaking a
screen today. It is a bug in the API's contract, not in the app.

## 3. An unknown `/api/` path answers HTML

**Real problem, and a bug.** Measured:

```
GET /api/does-not-exist -> 404 <!DOCTYPE html> ... <pre>Cannot GET /api/does-not-exist</pre>
```

There is no catch-all under `/api`. The error middleware at
`web/server/index.ts:2992` only runs for errors that were forwarded to it, so an
unmatched path falls through to Express's built-in HTML finaliser.

The consequence is specific rather than theoretical: every client call goes
through `web/src/lib/api.ts`, which parses the body as JSON to find the `error`
field. A typo'd or removed route therefore surfaces in the app as a JSON parse
failure rather than as the "Not found." the rest of the API would give, and the
banner shows the parser's message instead of the API's. The next person to rename
a route will debug this rather than read it.

Four lines of middleware before the error handler would close it. Not fixed here
because this issue said to change nothing.

## 4. Paging is opt-in, and only one caller opted in

**Real problem, though a slower-burning one than 1 to 3.**

`GET /api/books` (`web/server/index.ts:1376-1385`) reads `limit` and `offset` and
passes `undefined` when they are absent, which `Store.listing`
(`web/server/store.ts:993-1006`) turns into a query with no `LIMIT` clause at
all. Measured at 1200 books:

| Request | Payload |
| --- | --- |
| `GET /api/books?limit=50` | 0.1 KB |
| `GET /api/books?range=all` | **1204 KB** |

About a kilobyte per book, unbounded, over somebody's mobile data. At ten times
the books it is a twelve megabyte response.

Today this is safe, because the only caller is `useListing`
(`web/src/app/listing.ts:69`) and it always sends a limit. The problem is the
default. An unbounded list is what you get for forgetting a parameter, and the
client already ships a wrapper that forgets it: `api.listBooks`
(`web/src/lib/api.ts:1138`) is defined, takes no limit, and is called by nothing.
It is a loaded gun sitting in the client for the next screen to pick up.

The same shape, without even the option:

- `GET /api/captures` (`web/server/index.ts:893`) takes no parameters at all and
  returns the whole queue. It is fetched on **every route change in the app**
  (`web/src/app/summary.tsx:66-71`, keyed on `[route]`) and polled every two
  seconds while anything is pending (`web/src/components/QueuePane.tsx:378-383`).
  `HomePane` receives all of it to display three rows
  (`web/src/components/HomePane.tsx:158,196`).
- `GET /api/misfiles` (`web/server/index.ts:2920`) returns every misfile in a run
  and cannot be narrowed to one book. `web/src/app/shelfState.ts:121` calls it to
  answer "is this one book misfiled" every time the review screen opens for a
  catalogued book.
- `GET /api/authors/:id/books` (`web/server/index.ts:2161`) has no limit;
  `web/src/components/BookPane.tsx:300-303` downloads an author's whole
  bibliography to show five rows.

Ranked honestly: the captures one is the one that will bite, because its
frequency is tied to navigation rather than to the catalogue and it is already
the app's most-issued request.

## 5. Fourteen routes are dead

**Real, but cheap. This is bloat, not risk.**

Nothing outside `web/server/*.test.ts` calls these:

| Route | Line |
| --- | --- |
| `GET /api/lookup/title` | 1125 |
| `PATCH /api/tags` | 1769 |
| `POST /api/books/:id/tags` | 1823 |
| `DELETE /api/books/:id/tags` | 1845 |
| `POST /api/books/:id/tags/refresh` | 1872 |
| `GET /api/fixtures/:id` | 1970 |
| `GET /api/authors` | 2149 |
| `POST /api/authors/merge` | 2180 |
| `PATCH /api/authors/aliases/:id` | 2209 |
| `GET /api/books/:id/authors` | 2227 |
| `PUT /api/books/:id/authors` | 2244 |
| `GET /api/books/:id/captures` | 2282 |
| `POST /api/backfill/covers` | 2460 |
| `GET /api/checked-out` | 2710 |

They divide into two kinds and the distinction matters:

- **Built ahead of a screen.** The whole author-curation set (merge, alias,
  credit editing) and the manual tagging set are complete, tested, and documented
  in `docs/data-model.md:244,491`, with no UI. That is a decision somebody made,
  not an accident, and the tests keep them honest.
- **Superseded.** `GET /api/checked-out` answers a question `GET /api/shelves`
  now folds in. `GET /api/books/:id/authors` answers what `GET /api/books/:id`
  already embeds. `POST /api/backfill/covers` duplicates the background loop the
  server starts for itself at `web/server/index.ts:3028`. These are the three
  where two routes genuinely answer one question, and they are the three worth
  deleting.

Five of them also have client wrappers that nothing calls: `searchTitle`
(`api.ts:939`), `listBooks` (1138), `bookAuthors` (1172), `backfillCovers`
(1080), `checkedOut` (1078).

---

## Where the layering is honest and where it is nominal

The check is real and it passes. `domain/` imports nothing below it, including no
npm packages, and `application/` never reaches into `infrastructure/`. Confirmed
by running it, not by reading it.

**It just does not cover most of the code.** `depcruise` guards
`domain + application + infrastructure + shared`, which is 10,944 lines of
non-test source. `server/` alone is 17,443 lines, sixty percent more than all
four checked layers put together, and it is entirely unruled.

What lives in that unruled space is not trivial glue. It is a second, complete
persistence layer, written in raw SQL against a hand-rolled `Db` interface
(`web/server/driver.ts`), implemented once in `web/server/db.pg.ts` (941 lines,
`new Pool` at line 933), and consumed by `store.ts` (1357 lines, 35 raw SQL
sites), `queue.ts` (1301 lines, 29 sites), `shelves.ts`, `furniture.ts`,
`carry.ts`, `claim.ts` and `placement-ledger.ts`. It sits **beside**
`infrastructure/`, not on top of it, and shares nothing with the Drizzle
repositories except the database and the table names.

To be fair to it: `index.ts` itself is clean. Sixty route handlers, zero raw SQL,
zero `drizzle-orm` or `pg` imports. It delegates every single time. The 3116 lines
are route registration and orchestration, not a pile of queries. That is better
than the line count suggests and it should be said.

Where orchestration tips into business logic that has a layer waiting for it:

- `POST /api/books/scan`, `web/server/index.ts:2732-2908`. About 175 lines of
  identification ladder (fast barcode, then cover hash, then confidence gate,
  then queue hash, then thorough barcode and OCR, then multi-barcode
  disambiguation). Only the last line of each branch touches `res`. Everything
  before it is a decision procedure.
- The matching thresholds, `web/server/index.ts:2531-2678`. The cutoff of 24 bits
  in `looksLike`, and the rule in `duplicatesOf` that an ISBN match always beats a
  hash match, are catalogue policy expressed as private functions in a route file.
  `shared/confidence.ts` is where their siblings live.
- `POST /api/books`, `web/server/index.ts:1205-1333`. Which write path, then
  settle genre, then resolve a location the client did not send. That is the
  shape of `application/tagging/restate-tags.ts`, written as procedural handler
  code instead.

**Verdict: honest where it is checked, nominal where it is not, and the unchecked
part is the majority.** This is a real observation, not a real problem yet. None
of it is currently wrong. It is the thing that will make the next architectural
change expensive.

One genuinely dead port: `web/application/placement/ports.ts` is named by nothing
in `server/`. `DrizzlePlacementLedger` satisfies it structurally without ever
importing it, so the interface is exercised without being referenced.

---

## What the front end actually asks for

Credit first, because the client is in better shape than the route list is. There
is no N+1 anywhere. Covers go through `coverArt(book, 320)` rather than at full
size. `useListing` pages. `bookInHand.tsx` correctly hoists shelf state into one
provider so Review and Shelve share it instead of each fetching.

The problems are repetition, not scale:

- **Every navigation refetches health and the whole capture queue.**
  `web/src/app/summary.tsx:66-71` keys its effect on `[route]`, not on
  `route === 'home'`. Opening a book, opening the camera, changing a filter: each
  one re-issues `GET /api/health` and `GET /api/captures`. The file's own comment
  argues for this and the argument is good for counts. It was not meant to carry
  an unbounded list along with them.
- **`api.health()` is fetched twice on the shelves screen.**
  `web/src/components/ShelfView.tsx:129-131` fetches it again, for tab counts the
  summary provider already holds.
- **The whole room is refetched on every furniture screen.**
  `web/src/app/room.ts:39-52` is a hook, not a provider, and is called
  independently from seven screens (`FurnitureScreen.tsx:31`,
  `FixtureScreen.tsx:32`, `AreaScreen.tsx:29`, `AddAreaScreen.tsx:33`,
  `BelongsScreen.tsx:20`, `SortingScreen.tsx:25`, `ClaimedScreen.tsx:24`).
  Walking Furniture to Fixture to Area to Belongs is four full `GET /api/fixtures`
  reads of data none of those taps changed.
- **`BookPane` refetches an author's books when you check a book out.**
  `web/src/components/BookPane.tsx:134-147` keys the effect on `[credits]`, and
  `credits` is a fresh array from every `getBook` response
  (`BookPane.tsx:97-100`). The check-out handler at `BookPane.tsx:168-181` calls
  `reread()`, so flipping checked-out status re-triggers `authorBooks`. The
  `[book]`-keyed placement preview at `BookPane.tsx:122-131` has the same defect.
- **Two fetch effects have no cancellation guard.**
  `web/src/app/shelfState.ts:63-81` and `115-134` lack the `let live = true`
  pattern the other fifteen call sites use, so a slow response can set state on a
  route the user has left. Everything else in `web/src` has the guard, copied by
  hand fifteen times.
- **Errors have three homes.** A shared banner (`web/src/app/errorBanner.tsx`),
  per-component `useState('')` (BookPane, LibraryPane, ShelfView, QueuePane,
  TagsPane, MoveRunView), and a third instance inside `useRoom`. `FindPane`
  destructures `useListing` without taking `error` (`FindPane.tsx:93`), so a
  failed search on that one screen fails silently while the identical
  `LibraryPane.tsx:113` shows a message. That last one is a small real bug.

## Two ways of saying one thing

These are **taste**, with one exception noted. They are real inconsistencies and
none of them is currently breaking anything.

**The response envelope is not consistent.** Most routes wrap: `{ book }`,
`{ books, total, counts }`, `{ tags }`, `{ authors }`, `{ fixture }`, `{ area }`.
Some return the payload bare: `web/server/index.ts:1185` (`planned.plan`), 1661
(`historyOf`), 1967 (`describeFurniture`), 2957 (`outstandingWork`), 2976
(`trip`), 1158 (`inDerivedScheme`).

The sharpest instance is a pair the file itself calls one idea. `POST
/api/placement/run/plan` returns the plan bare (line 1185); `POST
/api/placement/run`, three lines of docstring later, returns
`{ plan, wrote }` (line 1198). A client cannot read the two the same way.

**`DELETE /api/shelves/:id` does not delete a shelf.** Line 1611. It removes a
*separator*, and `:id` is a separator id, while `GET /api/shelves` on the line
above answers with groups, separators and loads. This is the one item in this
section I would not call pure taste: a route whose noun does not name what it
deletes is how somebody eventually deletes the wrong thing.

**Refusals are said two ways.** The furniture module returns a `Refused`
discriminated union that the route renders through one helper
(`web/server/index.ts:1958`). Everywhere else, handlers hand-roll
`res.status(404).json({ error: 'No such book.' })`. Adjacent routes differ:
`GET /api/books/:id/claim` (1797) uses `refused()`, while
`GET /api/books/:id/tags` immediately below it (1807) hand-rolls the same answer.
The `Refused` pattern is the better of the two and it is the newer one.

**Identifiers arrive four ways.** Path parameters for entities
(`/api/books/:id`), query parameters for a trip (`/api/carry/trip?from=&to=`,
line 2968), body fields for a shelf operation (`{ range, label, kind, sortKey }`,
line 1444, addressing a plank by derived label rather than by id), and a bookcase
*number* in a body for a run move (line 1177). Each is defended in its own
docstring, and each defence is good. There is simply no single convention a
reader can carry from one to the next.

---

## What the next person adding a screen will get wrong

In the order they will trip on it:

1. **They will call a list route without a limit**, because that is the default
   and because `api.listBooks` is already sitting in the client doing exactly
   that. Nothing refuses it, nothing warns, and the response is correct: just
   very large. Cap `Store.listing` at a default page rather than leaving
   `undefined` meaning "everything".
2. **They will add their fetch to `summary.tsx`**, because that is where "data
   the app needs" already lives, and it will then be fetched on every navigation
   in the app.
3. **They will call a hook like `useRoom` from their screen**, matching seven
   existing screens, and add an eighth full room fetch.
4. **They will copy the fifteen-line `let live = true` block**, and there is a
   fair chance they will copy the two call sites that forgot it.
5. **They will hand-roll `res.status(404).json({ error })`**, because eighteen
   routes do, rather than the `Refused` union that six routes do better.
6. **They will pick an envelope by looking at the route above theirs**, and get
   whichever convention that route happened to use.
7. **They will `Number(req.params.id)` and not guard it**, because nineteen
   existing lines do exactly that.

None of these is the next person being careless. Each one is the shape of the
file suggesting the wrong thing, which is what the issue asked about.

---

## If only three things are done

1. Fix `GET /api/shelves` (finding 1). It is the only measured failure and it is
   on the screen somebody uses standing at a bookcase.
2. Add the `/api` 404 catch-all and an id guard (findings 2 and 3). Between them
   they are a few dozen lines and they close both bugs.
3. Give `GET /api/books` and `GET /api/captures` a default page size (finding 4),
   so the unbounded response stops being what you get for forgetting a parameter.

Everything after that is tidying, and the API will still be one API without it.

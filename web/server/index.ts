/**
 * API server. Plain HTTP on localhost only; the phone never talks to it
 * directly. Vite proxies /api to it over the loopback interface, which is what
 * keeps the HTTPS page free of mixed content.
 */

// First, and deliberately above express: the OpenTelemetry auto
// instrumentations patch http and express as those modules load, so this has
// to be evaluated before them. ESM evaluates a module's imports in source
// order, so being the first line is what makes that true.
//
// This was previously preloaded with `tsx watch --import ./instrumentation.ts`,
// which depended on tsx registering its loader before Node processed the flag.
// That ordering is not guaranteed, and when it lost the race Node tried to read
// a .ts file itself and killed the server with ERR_UNKNOWN_FILE_EXTENSION.
// Importing it here puts it in the normal module graph, where resolving .ts is
// tsx's ordinary job rather than a race.
import '../instrumentation'

import express from 'express'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { catalogueConnection, describeConnection, openPostgres } from './db.pg'
import type { Db } from './driver'

import { lookupIsbn, searchTitle } from './lookup'
import { sourceStandings } from './source-watch'
import { googleBooksApiKey, googleBooksKeyConfigured } from './secrets'
import { ReadingTimedOut } from './deadline'
import { identify, warmOcr } from './identify'
import { warmPaddle } from './paddle'
import { downloadCover, openLibraryCover, upgradeGoogleCover } from './covers'
import { coverHash, distance } from './imagehash'
import { cropPhotos } from './crop'
import { CaptureQueue, type CaptureEdit, type CaptureRow } from './queue'
import { rangeLock, Shelves, type Planks, type ShelvedBook } from './shelves'
import { plankLabels, type Plank, type RunPlanks } from '../infrastructure/shelving/areas'
// The two books a gap is between, said the one way the placing card says them.
import { toNeighbour } from '../infrastructure/books/book-repository'
import type { Move, PlankAt } from '../shared/layout'
import { RemoveSeparatorHandler } from '../application/shelving/remove-separator'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { DbTransactions } from '../infrastructure/shelving/transactions'
import {
  ApplyTagHandler, RelabelTagHandler, RemoveTagHandler,
} from '../application/tagging/apply-tag'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { ReidentifyBookHandler } from '../application/tagging/reidentify-book'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DbBookTransactions } from '../infrastructure/tagging/transactions'
import { CreditBookHandler, nameFor } from '../application/authorship/credit-book'
import {
  FileAliasHandler, MergeAuthorsHandler,
} from '../application/authorship/curate-authors'
import type { StoredAuthor } from '../application/authorship/ports'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { claimsFrom } from '../domain/tagging/catalogue-claims'
import {
  asConfidence, genreStatedBy, statedGenre,
} from '../domain/tagging/genre'
import { TagSlug } from '../domain/tagging/tags'
import { DrizzleCaptureRepository } from '../infrastructure/capture/capture-repository'
import { shownFile, verdictOf } from '../domain/capture/photographs'
import { filesOf } from './photographs'
import { PAGE_LIMIT, Store, type DraftBook } from './store'
// The two steps every save takes, lifted out so the seed takes the same ones
// (#237). What a book's shelf range and filing name are derived from.
import { recordCredits as recordCreditsStep, settleGenre as settleGenreStep } from './book-save'
// A location naming a plank nobody has is refused rather than recorded (#232).
// See the location route, and `recordPlaced`.
import { historyOf, UnknownPlank } from './placement-ledger'
import { applyRunMove, planRunMove, runMoveOffer } from './relocate-run'
import { applyRuleChange, draftFrom, planRuleChange, rulesOnPlace } from './place-rule'
// The work list the ledger already holds, grouped into trips (#314).
import { leaveWhereTheyAre, outstandingWork, putBackOnTheList, tripAtArea } from './carry'
import { watchBackups } from './backup-watch'
import {
  addAreaTo, addFixture, booksInArea, booksOnFixture,
  describeFixture, describeFurniture, dropArea, dropFixture,
  editArea, editCollection, editFixture, planAreaRemoval, planFixtureRemoval,
} from './furniture'
// How this API says no, and how it reads an id out of a request (#332). One
// line replaces `Number(req.params.id)`, and a client typo is a 404 rather than
// a 500 with a Postgres stack trace in the log.
import { idIn, refuse, refused } from './refusal'
// Why a book is here: which rule claimed it, and which ones lost (#323).
import { booksNoRuleClaims, claimOfBook } from './claim'
// The check that places every shelved book twice, by the shelf and by the
// rules, and says which books the two answers disagree about (#213). It ran on
// every start and printed to the log, and nothing else read it (#489).
import { areaDisagreements } from '../infrastructure/shelving/area-drift'
import { confidentPick, hasCloseMatch, queueMatches } from '../shared/confidence'
import { normaliseIsbn, resolveIsbnPair } from '../shared/isbn'
import {
  bookCover, buildPlacement, formatLocation, parseLocation, placementOnAPlank,
  shelfImage,
  type Neighbour, type Placement, type ShelfRange, type ShelfSlot,
} from '../shared/shelving'

export type Slot = 'front' | 'back' | 'edge'

/** Strip a data URL down to the bytes. Returns null if it is not an image. */
function decodeDataUrl(value: string): Buffer | null {
  if (!value.startsWith('data:image/')) return null
  const comma = value.indexOf(',')
  if (comma < 0) return null
  return Buffer.from(value.slice(comma + 1), 'base64')
}

function asDraft(body: Record<string, unknown>): DraftBook {
  const authors = Array.isArray(body.authors)
    ? (body.authors as unknown[]).map(String)
    : String(body.authors ?? '').split(',').map((s) => s.trim())

  return {
    isbn13: String(body.isbn13 ?? ''),
    isbn10: String(body.isbn10 ?? ''),
    title: String(body.title ?? '').trim(),
    subtitle: String(body.subtitle ?? ''),
    authors: authors.filter(Boolean),
    publisher: String(body.publisher ?? ''),
    published: String(body.published ?? ''),
    pages: String(body.pages ?? ''),
    notes: String(body.notes ?? ''),
    genre: statedGenre(body.genre),
    classificationSource: String(body.classificationSource ?? 'auto'),
    classificationConfidence: String(body.classificationConfidence ?? 'unknown'),
    seriesName: body.seriesName ? String(body.seriesName) : '',
    seriesIndex:
      body.seriesIndex === null || body.seriesIndex === undefined || body.seriesIndex === ''
        ? null
        : Number(body.seriesIndex),
    location: String(body.location ?? ''),
    lookupSource: String(body.lookupSource ?? ''),
    isbnSource: String(body.isbnSource ?? ''),
    authorFilingOverride: body.authorFilingOverride
      ? String(body.authorFilingOverride)
      : null,
  }
}

/**
 * The one ISBN a row names, or '' when it names none.
 *
 * Resolved rather than compared as stored, so the ten and thirteen digit forms
 * of one book are one identity. The fallback to the bare digits is for the row a
 * failed relookup leaves behind: the client records digits nobody's catalogue
 * has, and "not a valid ISBN" is still an identity somebody's tags were about.
 */
function identityOf(row: { isbn13?: string; isbn10?: string }): string {
  const named = row.isbn13 || row.isbn10 || ''
  const pair = resolveIsbnPair(named)
  return pair.isbn13 || pair.isbn10 || normaliseIsbn(named)
}

/**
 * Whether a save is correcting which book a row is, rather than editing the
 * book it already is.
 *
 * A row that named no ISBN cannot have carried anything about a different book,
 * so filling one in is an identification rather than a correction and takes
 * nothing away.
 */
function namesADifferentBook(
  before: { isbn13: string; isbn10: string },
  draft: DraftBook,
): boolean {
  const was = identityOf(before)
  return was !== '' && was !== identityOf(draft)
}

/**
 * The fields of an edit to a queued capture, taken one at a time.
 *
 * Absent and empty are different here, and the difference is load bearing. The
 * worker fills in whatever a person has not stated, so a key that is present
 * says "a person decided this" and a key that is absent says "nobody has".
 * Copying the whole body across would make every unmentioned field a silent
 * human decision and freeze the worker out of the capture entirely, so only
 * keys the request actually carries are taken.
 */
function asCaptureEdit(body: Record<string, unknown>): CaptureEdit {
  const edit: CaptureEdit = {}
  const text = (key: keyof CaptureEdit) => {
    if (body[key] !== undefined) (edit as Record<string, unknown>)[key] = String(body[key] ?? '')
  }

  for (const key of [
    'isbn13', 'isbn10', 'isbnSource', 'title', 'subtitle', 'publisher',
    'published', 'pages', 'notes', 'classificationSource',
    'classificationConfidence', 'seriesName', 'location', 'lookupSource',
  ] as const) {
    text(key)
  }

  if (body.authors !== undefined) {
    edit.authors = (Array.isArray(body.authors)
      ? (body.authors as unknown[]).map(String)
      : String(body.authors ?? '').split(',').map((a) => a.trim())
    ).filter(Boolean)
  }
  if (body.genre !== undefined) edit.genre = statedGenre(body.genre)
  if (body.seriesIndex !== undefined) {
    edit.seriesIndex =
      body.seriesIndex === null || body.seriesIndex === '' ? null : Number(body.seriesIndex)
  }
  if (body.authorFilingOverride !== undefined) {
    edit.authorFilingOverride = body.authorFilingOverride
      ? String(body.authorFilingOverride)
      : null
  }

  return edit
}

/**
 * Turn what `Store.setCheckedOut` actually did into the outcome vocabulary the
 * checkout route reports.
 *
 * Four words rather than two, because asking for the state a book is already
 * in is not a failure and is not the same as changing it. Telling somebody a
 * book is off the shelf when they took it off a moment ago reads as an error,
 * and telling them nothing is worse.
 */
function checkoutOutcome(out: boolean, changed: boolean): 'checked-out' | 'already-out' | 'checked-in' | 'already-in' {
  if (out) return changed ? 'checked-out' : 'already-out'
  return changed ? 'checked-in' : 'already-in'
}

function stripBook(row: ShelvedBook, withPhoto: boolean) {
  // Same precedence as a neighbour thumbnail, and the same function: the
  // spine is what you see looking at a shelf, and a cover is only a fallback.
  // The slot travels with the filename so the client can say which it got
  // rather than calling a front cover a spine.
  const photo = shelfImage({
    front: row.front_image ?? '',
    back: row.back_image ?? '',
    edge: row.edge_image ?? '',
  })

  return {
    id: row.id,
    title: row.title,
    authorFiling: row.author_filing,
    spine: withPhoto ? photo.name : '',
    spineSlot: withPhoto ? photo.slot : ('' as ShelfSlot),
    /*
     * How thick the book is, which is the one measurement a drawing of a shelf
     * may take from the catalogue (#315).
     *
     * A spine's width comes off the page count or off the median of the books
     * that have one, and there is no third answer; a strip without this draws
     * every book at the median, which is a row of identical books rather than a
     * picture of a shelf. It is text, because it is whatever a catalogue said.
     */
    pages: row.pages ?? '',
  }
}

/**
 * Which image to show for a candidate, and whether it is really theirs.
 *
 * The catalogue cover is the last resort rather than the first, and is
 * labelled when used, so a design they do not recognise is explained instead
 * of quietly undermining the match.
 *
 * The precedence itself lives in `shared/shelving` as `bookCover`, because the
 * library's gallery asks the same question of the same book and two copies of
 * this would be two screens disagreeing about whose picture they are showing.
 */
function ownPhoto(row: {
  front_image: string; edge_image: string; back_image: string; cover_image: string
}) {
  const picked = bookCover({
    front: row.front_image ?? '',
    back: row.back_image ?? '',
    edge: row.edge_image ?? '',
    catalogue: row.cover_image ?? '',
  })
  return { cover: picked.name, fromCatalogue: picked.fromCatalogue }
}

/**
 * Express 4 does not catch a rejected async handler, and an uncaught one
 * takes the process down. Wrapping a handler in this forwards its rejection
 * to `next`, which the error middleware registered below turns into a clean
 * 500 instead of a crash.
 */
function asyncRoute(
  handler: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next)
  }
}

/**
 * The trip a body names, or `null` for all of the work, or `undefined` once the
 * request has been refused.
 *
 * Three answers rather than two, because "no trip" and "not a trip" are
 * different requests: an empty body is somebody saying the whole list, and half
 * a trip is a mistake. Silently widening `{ from: 4 }` into the whole list would
 * withdraw every outstanding book on the strength of a typo, which is the one
 * way this route could do harm.
 */
function tripIn(
  body: unknown,
  res: express.Response,
): { fromAreaId: number; toAreaId: number } | null | undefined {
  const named = (body ?? {}) as Record<string, unknown>
  if (named.from === undefined && named.to === undefined) return null

  const missing = 'That trip names an area this collection does not have.'
  const from = idIn(named.from, res, missing)
  if (from === null) return undefined
  const to = idIn(named.to, res, missing)
  if (to === null) return undefined

  return { fromAreaId: from, toAreaId: to }
}

export interface CreateAppOptions {
  db: Db
  coverDir: string
  googleApiKey?: string
  /**
   * A label for /api/health only. Production reports the database file path;
   * tests have no file to name.
   */
  dbLabel?: string
  /**
   * Where the dumps of this catalogue are kept, read only, for `/api/backup`.
   *
   * Empty or absent means nothing is watched and nothing is claimed, which is
   * what every test and every development checkout wants. Production passes the
   * real directory; see the startup path at the bottom of this file and
   * `docs/backup-runbook.md`.
   */
  backupDir?: string
  /**
   * Resume any pending capture, warm the OCR engine, and start the background
   * hash/cover-backfill loops.
   *
   * Off by default is not an option in production, so this defaults to on.
   * Tests pass false: none of that work is safe to run against a scratch
   * :memory: database, and warming Paddle or reaching out for a cover would
   * be exactly the kind of real network dependency the suite must not have.
   */
  startBackgroundWork?: boolean
}

/**
 * The app, and the one question about it Express has no word for.
 *
 * A save answers before the work it started has finished, so "the request is
 * over" and "the app is idle" are different moments. Anything that takes the
 * database away, which in practice means a test file's teardown, has to wait
 * for the second one.
 */
export interface BookScanApp extends express.Express {
  /**
   * Resolves when nothing the app started is still running.
   *
   * Never rejects, and it is not an assertion that the work succeeded. A
   * failure is reported by `backgroundFailed` at the moment it happens; this
   * reports quiet.
   */
  settled(): Promise<void>
}

/**
 * Build the Express app.
 *
 * Pulled out of module scope so a test can construct one against an
 * in-memory database and a scratch cover directory, without opening the real
 * data directory, binding a port, or kicking off the background OCR warmup
 * and cover-backfill loops. See the bottom of this file for the only other
 * caller, which wires it up for a real run.
 */
export function createApp(options: CreateAppOptions): BookScanApp {
  const { db, coverDir } = options
  const googleApiKey = options.googleApiKey ?? ''
  const startBackgroundWork = options.startBackgroundWork ?? true

  /*
   * The composition root for the third converted slice, authors (#180).
   *
   * Above `Store` rather than beside the other three, because since #227 the
   * class that writes `books` asks this one what the first-listed name files
   * under. That is the whole of the coupling: `Store` reads through the port and
   * writes nothing here. See `Store.filingFor`.
   */
  const authors = new DrizzleAuthorRepository(db)
  const creditBook = new CreditBookHandler(authors)
  const fileAlias = new FileAliasHandler(authors)
  const mergeAuthors = new MergeAuthorsHandler(authors)

  const store = new Store(db, authors)

  /*
   * The work a save starts and nobody waits for.
   *
   * `POST /api/books` answers as soon as the row is written and then fetches a
   * cover, hashes it and crops the photographs. Not awaiting that is the whole
   * point: somebody is standing at a shelf holding a book. The consequence is
   * that the app can still be querying the database after the request that
   * started it is over, and after the last assertion of a test file has passed.
   *
   * Untracked, that is a rejection nobody is waiting for: the pool is closed in
   * a teardown, the next query fails with "Cannot use a pool after calling end
   * on the pool", and the run reports an unhandled error beside a full count of
   * passing tests. #201 tracked the work so `settled` could wait for it, and
   * deliberately stopped there, because tracking work is not the same decision
   * as owning how it fails.
   *
   * This is that second decision (#203). Every caller below names what its work
   * is, and a rejection is reported against that name rather than rethrown into
   * a promise nobody holds. Rethrowing it was the default `void` had, and since
   * Node 15 the default for a rejection nobody handles is to end the process:
   * the cover, the hash and the crops each read the catalogue, so a connection
   * that hiccups in the seconds after a save took the API down with it, in
   * front of somebody holding a book. Reproduced against a running app in #203
   * by killing the database container immediately after a save.
   */
  const outstanding = new Set<Promise<unknown>>()

  /**
   * Say that background work failed, at error level, naming what it was.
   *
   * **Reported rather than swallowed**, because a crop or a cover that fails in
   * silence is the distinction #192 built the `capture` table around being
   * quietly corrupted: a book with no cover would be indistinguishable from a
   * book nobody ever looked for a cover for.
   *
   * Nothing here is lost by carrying on. The row the person is waiting on is
   * already committed, and every column this work writes is derived and
   * refetchable: a cover the save could not stamp stays unstamped, which is
   * exactly the "never looked" state `missingCovers` selects on, so the backfill
   * asks again rather than recording a "looked and found nothing" that never
   * happened.
   *
   * **Staying up is only defensible because nothing here answers from
   * anywhere but the catalogue.** A process that outlives its database and
   * then serves a stale or empty shelf is worse than one that crashes, because
   * a wrong answer given confidently is what nobody checks. Nothing is cached:
   * every listing, every count and `/api/health` itself run a query, so a
   * database that has gone away for good rather than blinked shows as requests
   * that fail rather than as a catalogue with no books in it. Checked in #203
   * by killing the container and asking: `/api/health` and
   * `GET /api/books?range=fiction` both stopped answering, and neither
   * answered empty. They hung rather than erroring, which is an Aspire
   * artifact rather than a design: its proxy keeps accepting on the database
   * port after the container is gone, so the pool's connect never refuses.
   *
   * What that costs: the failure is in this log and in a red health check
   * rather than on the phone, and a person watching a book fail to grow a
   * cover has to be told to look here.
   */
  function backgroundFailed(what: string, reason: unknown): void {
    console.error(`[api] background work failed, ${what}:`, reason)
  }

  function inTheBackground(work: Promise<unknown>, what: string): void {
    outstanding.add(work)
    void work.then(
      () => outstanding.delete(work),
      (reason: unknown) => {
        outstanding.delete(work)
        backgroundFailed(what, reason)
      },
    )
  }

  // `allSettled`, because waiting for the work is not the same as owning how it
  // failed: `backgroundFailed` above is what reports that. A loop, because the
  // chain being waited on adds to the set as it goes.
  async function settled(): Promise<void> {
    while (outstanding.size) await Promise.allSettled([...outstanding])
  }

  /*
   * The composition root for the one slice #172 converted.
   *
   * Assembled here rather than inside `Shelves` because the route below calls
   * the handler itself: a request to remove a shelf boundary is a command, and
   * what it needs is a thing that carries it out, not a class that also knows
   * how to lay out a range. Everything the handler needs arrives through the
   * two interfaces in `application/shelving/ports.ts`, so this is the only
   * place in the server that names a Drizzle repository at all.
   */
  const separators = new DrizzleSeparatorRepository(db)
  const removeSeparator = new RemoveSeparatorHandler(
    separators, new DbTransactions(db, rangeLock),
  )
  const shelves = new Shelves(db, separators, removeSeparator)

  /*
   * The composition root for the second converted slice, tags (#179).
   *
   * Same shape as the one above and for the same reason: the routes below call
   * handlers, the handlers depend on the two interfaces in
   * `application/tagging/ports.ts`, and this is the only place in the server
   * that names a Drizzle repository.
   */
  const tags = new DrizzleTagRepository(db)
  // One instance, because it is a lock namespace as much as a transaction: two
  // of them are still the same advisory lock, and sharing it says so.
  const bookTransactions = new DbBookTransactions(db)
  const restateTags = new RestateTagsHandler(tags, bookTransactions)
  const reidentifyBook = new ReidentifyBookHandler(tags, bookTransactions)
  const applyTag = new ApplyTagHandler(tags)
  const removeTag = new RemoveTagHandler(tags)
  const relabelTag = new RelabelTagHandler(tags)

  // Every catalogue has the tag tables now. #188 gated this on the driver,
  // because `tag` and `book_tag` arrive in a migration and there were
  // migrations only for Postgres; its comment said the gate goes away with the
  // SQLite driver, and stage I is where that happens.

  /**
   * Write what this save says a book is under, and answer the range that puts
   * it in.
   *
   * A thin binding of `settleGenre` in `server/book-save.ts` to this app's own
   * `restateTags` handler and `tags` repository. The function itself moved
   * there (#234) so `scripts/seed-world.ts` can call the exact same steps
   * rather than restate them.
   *
   * **Null is a range** (#304): a save that states no genre writes no genre
   * tag, and a book no genre tag claims is in neither run.
   */
  async function settleGenre(bookId: number, draft: DraftBook): Promise<ShelfRange | null> {
    return settleGenreStep(restateTags, tags, bookId, draft)
  }

  /**
   * Keep the credits in step with what was just saved about a book, and file
   * the first-listed name when somebody has said what it files under.
   *
   * A thin binding of `recordCredits` in `server/book-save.ts` to this app's
   * own `creditBook`, `authors` and `fileAlias`. **Every save carries it now,
   * where only `POST /api/books` used to**, and only when the client asked. An
   * override typed against an already-saved book used to reach
   * `books.author_filing` and stop there, which was survivable while that
   * column decided where the book went and is not survivable once the alias
   * does: the correction would have applied to one book and then vanished.
   */
  async function recordCredits(bookId: number, draft: DraftBook): Promise<void> {
    return recordCreditsStep(creditBook, authors, fileAlias, bookId, draft)
  }

  /*
   * The composition root for the fourth converted slice, captures (#181).
   *
   * Same shape as the three above: the route below calls this repository
   * through the one interface in `application/capture/ports.ts`.
   *
   * It is not quite the only place in the server that names a Drizzle
   * repository any more. `server/photographs.ts` names this one too, because
   * `capture` is the record of every photograph since #228 and that file is
   * where a filename becomes a row, on the way in and back out again.
   *
   * **There is no step here that records a save's photographs.** There used to
   * be, reading the row back after `Store` had written the columns. `Store` and
   * `CaptureQueue` write the rows themselves now, on the transaction handle that
   * writes the book, so a route cannot save a book and forget its photographs
   * and a book cannot commit without them.
   */
  const captures = new DrizzleCaptureRepository(db)

  function saveImage(buffer: Buffer, isbn: string, slot: Slot): string {
    const name = `${Date.now()}_${isbn || 'noisbn'}_${slot}.jpg`
    writeFileSync(join(coverDir, name), buffer)
    return name
  }

  /**
   * Moves are a to-do list a person works through, so they name books rather
   * than row ids, and each group reports whether it is over its capacity.
   *
   * The two planks are named off the furniture rather than off the layout's own
   * ordinals (#359). Somebody reading this list is being asked to walk to a
   * plank and put a book on it, and every other screen names that plank the way
   * its owner named the bookcase.
   */
  async function describeMoves(range: 'fiction' | 'nonfiction', moves: Move[]) {
    const titles = new Map((await shelves.layout(range)).map((p) => [p.book.id, p.book.title]))
    const planks = await shelves.planks(range)
    return moves.map((move) => ({
      id: move.id,
      title: titles.get(move.id) ?? '',
      ...named({ from: planks.at(move.fromAt), to: planks.at(move.toAt) }),
    }))
  }

  /**
   * A pair of planks flattened for the wire: what a person reads, and what the
   * app writes down.
   *
   * The shape `Misfile` has carried since #356, `toAreaId` beside `to`, applied
   * to everything that decides where a book goes (#359). A label is a rendering
   * and changes the moment somebody names a bookcase; the id does not, and it is
   * the id a screen sends back when the person says they have carried the book.
   */
  function named(planks: Planks) {
    return {
      from: planks.from.label,
      to: planks.to.label,
      fromAreaId: planks.from.areaId,
      toAreaId: planks.to.areaId,
    }
  }

  /**
   * The plank a request names, or null once the refusal has been answered.
   *
   * **This route writes, so a wrong answer moves a real book.** An id that names
   * no plank of this run is refused before anything is read or planned: it can
   * be an id from the other run, an id for a plank somebody has since taken out,
   * or a stale id off a screen drawn before the shelves changed, and not one of
   * those is a place this cascade can act on. The alternative is guessing, and
   * the thing guessed at is which plank a person is standing in front of.
   */
  async function plankIn(
    range: 'fiction' | 'nonfiction',
    raw: unknown,
    res: express.Response,
  ): Promise<PlankAt | null> {
    const areaId = Number(raw)
    const at = Number.isInteger(areaId) && areaId > 0
      ? await shelves.addressOf(range, areaId)
      : null
    if (!at) {
      const said = (await shelves.planks(range)).labels()
      res.status(400).json({
        error: said.length
          ? `That is not a plank of this run. The planks here are ${said.join(', ')}.`
          : 'That is not a plank of this run, and this run has none.',
      })
      return null
    }
    return at
  }

  /**
   * Restate a placement in the derived scheme.
   *
   * store.placementFor still answers in the old per-book scheme, where a
   * location is a string somebody typed and the range starts at "1A". Those
   * shelves no longer exist. Everything the user reads has to come from the
   * layout, or the card tells them to put a book on a shelf the app cannot
   * find, which is what "1A" was.
   *
   * **Every plank named here is named by `labelFor` and identified by its area**
   * (#359). This is the screen somebody stands at a bookcase with, and the
   * answer they give on it is written into the ledger: it said `1B` while the
   * same book's own page said `Hall shelf · B`, and it handed that string back
   * as the key for the write.
   */
  async function inDerivedScheme<T extends Awaited<ReturnType<typeof store.placementFor>>>(
    range: 'fiction' | 'nonfiction',
    placement: T,
    /** The book being edited, which must not appear as its own neighbour. */
    excludeId?: number,
  ) {
    const layout = await shelves.layout(range)
    const planks = await shelves.planks(range)
    /*
     * The plank, name and id together, out of the one row (#468). Taking only
     * the label here is what left `buildPlacement` with two strings to decide
     * "same plank" from, and the id it needed was on the row the label was read
     * off. `Plank` is that pair, so neither half can be fetched without the
     * other.
     */
    const plankOf = (id: number | undefined): Plank => {
      const at = id === undefined ? undefined : layout.find((p) => p.book.id === id)
      return at ? planks.at({ shelf: at.shelf, area: at.area }) : { areaId: null, label: '' }
    }

    const on = (neighbour: Neighbour) => {
      const plank = plankOf(neighbour.id)
      return { ...neighbour, location: plank.label, areaId: plank.areaId }
    }

    const predecessor = placement.predecessor ? on(placement.predecessor) : null
    const successor = placement.successor ? on(placement.successor) : null

    /*
     * The plank, and then its name. The other way round is what #356 was: a
     * label is a rendering, and working back from one to the row it renders is
     * a question with two answers the moment somebody names a bookcase.
     *
     * Null when the run has no plank for this book, which is a rule pointing at
     * furniture that has been taken out. The step then has nothing to record a
     * book on and says so rather than offering a plank nobody owns.
     */
    const derivedAreaId = await shelves.areaForSortKey(range, placement.sortKey)
    const derivedLocation = derivedAreaId === null
      ? await shelves.shelfForSortKey(range, placement.sortKey)
      : planks.labelOf(derivedAreaId)

    // Rebuilt rather than patched: the instruction has the old labels baked
    // into its wording.
    const restated = buildPlacement(range, predecessor, successor, derivedLocation)

    return {
      ...placement,
      ...restated,
      suggestedLocation: derivedLocation,
      derivedLocation,
      derivedAreaId,
      strip: await stripFor(range, placement.sortKey, excludeId, planks),
    }
  }

  /**
   * The same answer, about the plank a walk is taking this book to (#429).
   *
   * **`inDerivedScheme` above asks where the book belongs; this is told where it
   * is going.** They are different questions and the app had only the first,
   * which is the whole of #429: a carry list said "4A to 3A", the placing screen
   * worked out for itself where the book belonged *now*, answered a plank on
   * another piece of furniture, and the person who did exactly what it asked put
   * the book somewhere no assignment named. So the trip came straight back, the
   * finished screen said a book was on a plank it had never written to, and the
   * count never moved. Nothing was wrong with what got written down; what was
   * wrong was what the app asked for next.
   *
   * There is no second placing screen and there must not be one: the carry flow
   * calls the same `ShelveView` a newly scanned book gets, and `carrying.test`
   * pins that. What changed is what it is handed.
   *
   * **The plank is not re-derived here and is not checked against the rules.**
   * It is where the person is standing, taken from the trip they are walking,
   * and the trip is fixed the moment the books are lifted (`app/armful.tsx`).
   * Asking the rules again is what this exists to stop.
   *
   * Everything drawn is therefore read off that plank rather than out of the
   * run: the two books the gap is between are the two either side of it among
   * what is standing there, and the strip is that plank as it looks. A run laid
   * out by sort key would draw books that are still on the plank the person just
   * took this armful off.
   */
  async function atThePlankItIsGoingTo<
    T extends Awaited<ReturnType<typeof store.placementFor>>,
  >(
    range: 'fiction' | 'nonfiction',
    placement: T,
    goingTo: { areaId: number; label: string },
    /** The book being carried, which must not appear as its own neighbour. */
    excludeId?: number,
  ) {
    const standing = await shelves.standingOn(goingTo.areaId, excludeId)

    // Where along the plank the book goes: the first book standing there that
    // sorts at or after it. One split rather than two filters, so a book keying
    // exactly alongside another cannot fall out of both halves and off the row.
    const found = standing.findIndex((row) => row.sortKey >= placement.sortKey)
    const gapIndex = found === -1 ? standing.length : found

    const predecessor = toNeighbour(standing[gapIndex - 1])
    const successor = toNeighbour(standing[gapIndex])

    /*
     * Rebuilt rather than patched, for `inDerivedScheme`'s reason: the
     * instruction carries the plank's name inside its wording. `buildPlacement`
     * is not what rebuilds it, because its sentences are about a whole range and
     * these neighbours are two books on one plank. See `placementOnAPlank`.
     */
    const restated = placementOnAPlank(range, goingTo.label, predecessor, successor)

    return {
      ...placement,
      ...restated,
      suggestedLocation: goingTo.label,
      derivedLocation: goingTo.label,
      derivedAreaId: goingTo.areaId,
      /*
       * Null for a plank with nothing on it, which is the ordinary first book of
       * a trip rather than an error. The screen draws the sentence instead, the
       * same as it does for the first book of an empty run: there is no row of
       * spines to put a gap in yet.
       */
      strip: standing.length
        ? {
          label: goingTo.label,
          gapIndex,
          placedIndex: null,
          books: standing.map((row) => stripBook(row, true)),
        }
        : null,
    }
  }

  /**
   * The shelf drawn end on, for the placing view.
   *
   * Every book carries its photo, the same as the settled row below. This
   * used to send two, the pair touching the gap, on the grounds that they are
   * the ones you look for and the rest are only counted along. That was true
   * of a strip nobody could tap, and it stopped being true when the same
   * drawing became the way through to a book (#81): a checked out book's page
   * would otherwise show two photographs in a run of blank blocks, which
   * reads as missing data rather than as a design.
   *
   * The photo files are immutable, their names carry a timestamp, and they
   * are served with a long cache, so a row costs its requests once.
   */
  async function stripFor(
    range: 'fiction' | 'nonfiction',
    sortKey: string,
    excludeId?: number,
    /** The run's planks, read once by the caller and passed down. */
    known?: RunPlanks,
  ) {
    const planks = known ?? await shelves.planks(range)
    // A book that is already on the shelf where it belongs is drawn in the
    // row, not as a hole in it. Only when its filing has actually changed
    // does it become something that has to move, and then it wants a gap
    // again.
    const settled = excludeId ? await settledRow(range, sortKey, excludeId, planks) : null
    if (settled) return settled

    const strip = await shelves.strip(range, sortKey, excludeId)
    if (!strip) return null

    return {
      // Named off the furniture, because the sentence above this drawing names
      // the same plank and the two are read together (#359).
      label: planks.at(strip.at).label,
      gapIndex: strip.gapIndex,
      placedIndex: null,
      books: strip.books.map((placed) => stripBook(placed.book, true)),
    }
  }

  /**
   * The row as it stands, when this book is already in it and in the right
   * place.
   *
   * Every book carries its photo here, unlike the placing strip above. This
   * row is not an instruction with two landmarks either side of a gap: it is
   * the area drawn as it looks, and each spine is a way through to that book
   * (#81). A run of blank blocks with two photographs in it would be neither.
   * The files are immutable and served with a long cache, so a row scrolled
   * back to costs nothing the second time.
   *
   * "In the right place" means two things agree, not one. The sort key check
   * only says the save landed; it says nothing about the shelf, because a
   * save never touches `location` (#61, #5, both read-only about it). A book
   * whose author or series just moved it in the sequence has not moved on the
   * shelf, since nobody has carried it anywhere, so its recorded location is
   * still the old area. That is exactly what `shelves.review` calls a misfile
   * (`../shared/shelving`, `reviewShelving`), and this has to reach the same
   * verdict the Library does (#90): drawing the book into the row here while
   * "Needs attention" says it belongs elsewhere would be the same book shown
   * settled in one place and unsettled in the other, and the detail view is
   * where somebody decides whether there is anything left to do.
   *
   * Matches `reviewShelving`'s own carve-outs, not just its misfile test: a
   * book nobody has ever placed, and a run with no area to put it on, are not
   * disagreements to draw a gap over, so those still settle here exactly as
   * they did before this book had a recorded location at all.
   *
   * **And it compares the same way, which is by area** (#356). It used to parse
   * both labels, so a named bookcase made the recorded one unreadable and every
   * book on that piece drew as settled here while the misfile list, once that
   * was fixed, said it was not. Two screens disagreeing about one book is
   * exactly what #90 says must not happen, so there is one comparison and this
   * is it.
   */
  async function settledRow(
    range: 'fiction' | 'nonfiction',
    sortKey: string,
    id: number,
    planks: RunPlanks,
  ) {
    const row = await store.getBook(id)
    if (!row || row.shelf_range !== range || row.sort_key !== sortKey) return null

    const strip = await shelves.stripOf(range, id)
    if (!strip) return null

    if (row.area_id !== null) {
      const belongs = await shelves.areaForSortKey(range, sortKey)
      if (belongs !== null && belongs !== row.area_id) return null
    }

    return {
      // The plank named off the furniture, which is what the boundary buttons
      // below now say too, and what this book's own recorded location says.
      label: planks.at(strip.at).label,
      gapIndex: -1,
      placedIndex: strip.index,
      books: strip.books.map((placed) => stripBook(placed.book, true)),
      /*
       * Offered only here, where the book is genuinely where the catalogue
       * says it is. A hypothetical strip built for an unsaved edit carries no
       * boundary to move, because the book has not earned that position yet
       * (#96): the detail view reads this to decide whether to show the
       * button at all, and the write route re-checks it regardless.
       */
      boundary: await shelves.boundaryOptions(range, id, planks),
    }
  }

  async function shelfGroups(range: 'fiction' | 'nonfiction') {
    return shelves.groups(range)
  }

  /**
   * Reading and writing derived pictures in the cover directory.
   *
   * Declared here rather than beside the crop helpers below because the
   * capture queue is built next and takes it: a `const` referenced before its
   * declaration is a temporal dead zone error, not a hoisted function.
   */
  const cropIo = {
    read: (name: string) => readFileSync(join(coverDir, name)),
    write: (name: string, data: Buffer) => { writeFileSync(join(coverDir, name), data) },
  }

  const queue = new CaptureQueue(
    db,
    (name) => {
      if (!name) return null
      try {
        return readFileSync(join(coverDir, name))
      } catch {
        return null
      }
    },
    { googleApiKey },
    // Where a capture's derived pictures are read and written: the crops, on
    // the same background pass that reads its photographs, and the front hash,
    // which since #294 is its own job beside that pass rather than part of it.
    // A crop that finished after its capture was discarded goes to the same
    // orphan sweep the discard itself uses; `deleteOrphanedImages` is a
    // function declaration below and so is hoisted into scope here.
    { ...cropIo, orphaned: deleteOrphanedImages },
    // So the queue can name a duplicate the same way GET /api/lookup/isbn/:isbn
    // does below, on both the doors it reads a lookup through: the automatic
    // pass that identifies a fresh scan and a person correcting one with
    // Change ISBN (#233). Since #435 it is also what answers the third door,
    // which is not a lookup at all: `GET /api/captures/:id` asking the
    // catalogue about a capture's ISBN whether or not anything looked it up.
    (isbn) => store.findByIsbn(isbn),
  )

  /**
   * Remove photo files that nothing points at any more.
   *
   * Call this only AFTER the owning row is gone, so it does not count itself.
   *
   * The reference check is not optional. A capture hands its filenames to the
   * book it becomes, so a capture and a shelved book routinely name the same
   * files on disk. Deleting a capture's photos without checking would take
   * the book's photos with them, and there is no getting those back.
   */
  async function deleteOrphanedImages(names: string[]): Promise<string[]> {
    const removed: string[] = []
    for (const name of names.filter(Boolean)) {
      if (await store.imageInUse(name)) continue
      try {
        rmSync(join(coverDir, name), { force: true })
        removed.push(name)
      } catch {
        // A missing file is already in the state we want.
      }
    }
    return removed
  }

  const app = express() as BookScanApp
  app.settled = settled
  app.use(express.json({ limit: '12mb' })) // cover stills arrive as data URLs

  /**
   * Ask for a picture smaller than the one on disk.
   *
   * Everything stored here is full size: a catalogue cover is up to 1000px
   * wide and a phone photo is whatever the camera produced. That is right for
   * a screen showing one book, and wrong for the library's gallery, which is a
   * grid of a hundred of them at about 120 CSS pixels each. Sending the
   * originals there is tens of megabytes over somebody's mobile data to draw
   * thumbnails.
   *
   * A closed set of widths, because the width is in a URL and a URL is a
   * request anybody can make. An open one would let a caller ask the server to
   * re-encode the whole catalogue at a hundred sizes it will never show.
   *
   * Nothing is written. The resize happens per request and the answer is
   * cached by the browser under the same immutable, thirty day policy as the
   * original, so a cover is resized at most once per phone rather than once
   * per scroll. A miss falls through to the static mount below, which is what
   * turns it into the same 404 as the full size file.
   */
  const THUMB_WIDTHS = [160, 320, 640]

  app.get('/api/covers/:name', (req, res, next) => {
    const width = Number(req.query.w)
    if (!THUMB_WIDTHS.includes(width)) return next()

    const name = req.params.name
    // A filename, never a path. `basename` on its own is enough on POSIX and
    // both separators are refused outright so this reads the same everywhere.
    if (name.includes('/') || name.includes('\\')) return next()
    const file = join(coverDir, basename(name))
    if (!existsSync(file)) return next()

    void sharp(file)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer()
      .then((body) => {
        res.type('jpeg')
          .set('Cache-Control', 'public, max-age=2592000, immutable')
          .send(body)
      })
      // Not an image, or an image sharp cannot read. The full size file is
      // still there and still servable, so send that rather than failing.
      .catch(() => next())
  })

  // Captured photos. Immutable once written (the filename carries a
  // timestamp), so they can be cached hard: the placement card renders
  // neighbour spines on every scan and should not refetch them.
  app.use(
    '/api/covers',
    express.static(coverDir, {
      immutable: true,
      maxAge: '30d',
      fallthrough: false,
    }),
  )

  // ---------------------------------------------------------------------------
  // Capture queue
  // ---------------------------------------------------------------------------

  /**
   * Accept three photos and return at once. Reading them happens in the
   * background, so the person holding the books can move straight to the
   * next one instead of waiting on OCR.
   */
  app.post('/api/captures', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    // The client knows which side it just photographed, so the slot is
    // required rather than inferred or defaulted. Quietly falling back to
    // 'back' would file a cover photo as the barcode side, and the worker
    // would then read it expecting an ISBN and report an honest-looking
    // failure for the wrong reason. Better to refuse the request.
    const slot = body.slot as Slot
    if (slot !== 'front' && slot !== 'back' && slot !== 'edge') {
      res.status(400).json({
        error: `Expected slot to be front, back or edge; got ${JSON.stringify(body.slot)}.`,
      })
      return
    }

    const captureId = Number(body.captureId ?? 0) || null

    const buffer = decodeDataUrl(String(body.image ?? ''))
    if (!buffer) {
      res.status(400).json({ error: 'Expected an image data URL.' })
      return
    }

    const capture = await queue.attach(captureId, slot, saveImage(buffer, '', slot))

    /*
     * Two background jobs, not one, and they are separate on purpose (#294).
     *
     * The hash is what tells the next person this book is already in the queue,
     * and it used to be written by the drain, after the reading. That put a
     * local computation of a few milliseconds behind OCR, a catalogue lookup
     * and every capture already queued in front of this one, on a worker that
     * runs one job at a time and a reader that serialises every caller in the
     * process. Slow reading, late hash; a reading that never returns, no hash
     * at all, and nothing anywhere would ever fill it in.
     *
     * Firing them side by side is the fix. Neither waits on the other, and the
     * shutter still waits on neither.
     */
    inTheBackground(
      queue.hashFrontOf(capture.id).then((outcome) => {
        // Said out loud rather than swallowed. `refused` is a frame with no
        // detail in it and `unreadable` is a file that has gone missing;
        // either way this capture cannot be matched against, and the one
        // thing that must not happen is that nobody hears about it.
        if (outcome === 'refused' || outcome === 'unreadable') {
          console.warn(
            `[queue] capture ${capture.id} ${slot}: front not hashed (${outcome}), ` +
            'so this book will not be recognised if somebody photographs it again',
          )
        }
      }),
      `hashing the front of capture ${capture.id}`,
    )
    // Not awaited: the shutter must not wait on OCR. Tracked for the same
    // reason the chain after a save is: it is still running when the request
    // that started it is over, and a teardown has to be able to wait for it.
    inTheBackground(queue.drain(), `reading the photographs of capture ${capture.id}`)

    res.status(201).json({ capture, counts: await queue.counts() })
  }))

  /**
   * One capture: whether it is a second photographing of a book already in the
   * queue (#146), and whether the catalogue already holds its ISBN (#435).
   *
   * Answered here rather than on the way in, and that is the whole shape of
   * the fix. `POST /api/captures` returns the moment the photograph exists,
   * before anything has read it: there is no ISBN yet and no hash yet, so a
   * check made there would have nothing to check. The reading happens on the
   * background pass and this route is what the camera already polls for it, so
   * the answer arrives with the reading, on the request the camera was making
   * anyway, and the shutter waits for nothing.
   *
   * **`catalogued` is a second question and it is asked separately** (#435).
   * `duplicates` is about the queue and `catalogued` is about the shelves, and
   * neither of them is the lookup. The already-catalogued warning used to ride
   * on the lookup result, so a book no source could answer for was never asked
   * about at all, even though the ISBN was printed at the top of the same
   * screen: the app knew it and never put the question. It is one indexed
   * query against the database the request is already talking to, on the poll
   * the camera is already making, and nothing at all is in front of the
   * shutter.
   */
  app.get('/api/captures/:id', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such capture.')
    if (id === null) return

    const capture = await queue.get(id)
    if (!capture) {
      res.status(404).json({ error: 'No such capture.' })
      return
    }
    res.json({
      capture,
      duplicates: await duplicatesOf(capture),
      // The row's own ISBN, which is where a person's correction is mirrored
      // as well as where a barcode reading lands, so this is the number on the
      // screen whether a catalogue confirmed it or nobody did.
      catalogued: await queue.cataloguedAs(capture.isbn13, capture.id),
      counts: await queue.counts(),
    })
  }))

  /**
   * The whole queue, and the two things about it that are not rows.
   *
   * `reading` is which capture the worker has in its hands, or null. It is not
   * a column and it is not stored: it is true for the seconds one reading
   * takes, and it exists because a row that says "Reading photos" while nothing
   * is reading is the state #436 is about. With it, the queue can say which of
   * its waiting books is being read and which are waiting to be.
   *
   * **And a read that finds pending work arms the sweep** (#436). Nothing in
   * this process knows about a capture another process wrote, so the moment
   * somebody looks at a queue with unread books in it is the moment to make
   * sure something is reading them. It is fired and not awaited: this answers
   * with what the queue says now, and the sweep is a background pass that stops
   * itself. Only where background work is on at all, which is the same
   * condition the boot resume is under and for the same reason.
   */
  app.get('/api/captures', asyncRoute(async (_req, res) => {
    const captures = await queue.list()
    const counts = await queue.counts()
    if (startBackgroundWork && counts.pending > 0) queue.wake()
    res.json({ captures, counts, reading: queue.reading })
  }))

  app.post('/api/captures/:id/claim', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such capture.')
    if (id === null) return

    const who = String((req.body ?? {}).who ?? '').trim() || 'unknown'
    const result = await queue.claim(id, who)
    if (!result.ok) {
      res.status(409).json({
        error: `That book is being worked on by ${result.heldBy}.`,
      })
      return
    }
    res.json({ capture: result.row })
  }))

  /**
   * Persist what somebody worked out about a capture that is still queued.
   *
   * The route the queue was missing. Every other capture route creates, reads,
   * claims, releases or deletes; nothing updated one, so a corrected ISBN or a
   * fixed title lived in one browser tab and reached the database only when the
   * book was finally saved. Navigating away lost it, which meant resolving and
   * shelving had to be the same person in one sitting.
   *
   * PATCH rather than PUT: the body is the fields somebody stated, not a whole
   * capture. Everything is optional, including all of it, so a request that
   * states nothing is still meaningful and records that a person looked at this
   * book and left it as it was.
   *
   * Holding the claim is required, and the claim is the existing one from
   * POST /claim rather than anything new. `queue.edit` renews the lease as a
   * side effect of a successful edit, and a lease that has gone stale is
   * takeable, on exactly the terms opening the capture already uses.
   *
   * `release` says the person is putting the book down. It travels with the
   * edit rather than in a request of its own, and this is now the only way a
   * capture is released, because on the way out the two cannot be separate
   * calls (#150). An edit needs the claim, so it has to go first; a page that
   * is going away cannot be relied on to send a second request once the first
   * has answered; and two fired at once race, with an edit landing after a
   * release taking the claim straight back. One request has no order to get
   * wrong.
   */
  app.patch('/api/captures/:id', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const who = String(body.who ?? '').trim() || 'unknown'
    const id = idIn(req.params.id, res, 'No such capture.')
    if (id === null) return

    const lettingGo = body.release === true

    const result = await queue.edit(id, who, asCaptureEdit(body))

    /*
     * Unconditional, and deliberately outside the success branch below. What
     * becomes of the typing and whether the book is handed back are two
     * separate questions, and only the first of them can be refused: a
     * capture that has just become a book rejects the edit, and holding on to
     * the claim because of that would leave the next person told the book is
     * being worked on by somebody who has gone. Releasing what you do not
     * hold is already a no-op, so the refusals that are somebody else's claim
     * change nothing here either.
     */
    if (lettingGo) await queue.release(id, who)

    if (!result.ok) {
      if (result.reason === 'missing') {
        res.status(404).json({ error: 'No such capture.', released: lettingGo })
      } else if (result.reason === 'done') {
        res.status(409).json({
          error: 'That book has already been shelved. Edit the book itself.',
          released: lettingGo,
        })
      } else {
        res.status(409).json({
          error: `That book is being worked on by ${result.heldBy}.`,
          released: lettingGo,
        })
      }
      return
    }

    res.json({
      capture: result.row,
      lookup: result.lookup,
      released: lettingGo,
      counts: await queue.counts(),
    })
  }))

  /**
   * Read a capture's photographs again (#299).
   *
   * The way back from a reading that was given up on. `identify` has a bound on
   * it now, so a reader that stops costs one capture and a minute instead of
   * the whole queue for the life of the process, but the capture it costs is
   * left `failed` saying so, and a state somebody can see is only half of it:
   * the other half is being able to act on it without going and finding the
   * book again.
   *
   * A POST rather than a PATCH of the capture, because this states nothing
   * about the book. It asks for work to be done, which is what `POST` is for
   * here, and it deliberately does not go through `PATCH /api/captures/:id`:
   * that route is a person's statements about a book, and the whole precedence
   * rule rests on nothing else writing there.
   *
   * Answers as soon as the capture is back in the queue. The reading itself is
   * the background pass, as it always is, and the client already polls for it.
   */
  app.post('/api/captures/:id/read', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such capture.')
    if (id === null) return

    const capture = await queue.readAgain(id)
    if (!capture) {
      // Told apart, because the two need different things said. A capture that
      // has left the queue is not a typo, it is a book somebody has already
      // dealt with, and telling them "no such capture" would send them looking
      // for one.
      const existing = await queue.get(id)
      res.status(existing ? 409 : 404).json({
        error: existing
          ? 'That book has left the queue, so there is nothing left to read.'
          : 'No such capture.',
      })
      return
    }

    inTheBackground(
      queue.drain(), `reading the photographs of capture ${id} again`,
    )

    res.json({ capture, counts: await queue.counts() })
  }))

  /**
   * Discard a scan. **Nothing is deleted (#183).**
   *
   * This used to remove the row, and with it the record that somebody had ever
   * photographed the thing. `discarded` is one of the seven states in
   * `docs/data-model.md` for exactly that reason: the book stops being in the
   * queue, cannot reach a shelf, and is still there to be counted and looked at.
   *
   * The photographs are still deleted, because deleting them is what somebody
   * discarding a scan is asking for and they are the bulk of what a mistaken
   * scan costs. The filenames stay on the row as the record of what was thrown
   * away, and `Store.imageInUse` does not count a discarded book's filenames as
   * a claim on a file, which is what lets this sweep still find them.
   */
  app.delete('/api/captures/:id', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such capture.')
    if (id === null) return

    const capture = await queue.get(id)
    if (!capture) {
      res.status(404).json({ error: 'No such capture.' })
      return
    }

    /*
     * The crops go with the photographs.
     *
     * They are files this scan caused to exist, named after photographs that are
     * about to stop being referenced by anything, so leaving them behind fills
     * the data directory with pictures nobody can attribute to anything. They go
     * through the same orphan check rather than a second mechanism, which is
     * what stops a discard taking a photograph a shelved book still names.
     */
    // Every photograph this scan produced, not the current one of each kind
    // (#228). A slot re-shot while somebody was working the queue is two files
    // on disk and two rows, and both were taken of the thing being thrown away.
    const images = await filesOf(db, id)
    await queue.discard(id)
    const removed = await deleteOrphanedImages(images)

    res.json({ ok: true, counts: await queue.counts(), photosRemoved: removed.length })
  }))

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------

  /**
   * Read an ISBN out of one photo and answer straight away.
   *
   * Deliberately synchronous, which the capture path is not. There the queue
   * owns the work so the person can keep shooting; here they are sat in
   * front of a dialog waiting for the number, and handing them a job id to
   * poll would be a worse version of waiting. Nothing is stored: this reads
   * the image, returns what it found, and forgets it.
   */
  app.post('/api/identify/isbn', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const buffer = decodeDataUrl(String(body.image ?? ''))
    if (!buffer) {
      res.status(400).json({ error: 'Send an image as a data URL.' })
      return
    }

    const result = await identify(buffer, { wantTitle: false })
    const settled = await settleAmbiguity(result)

    res.json({
      isbn13: settled.isbn13,
      isbn10: settled.isbn10,
      source: result.source,
      candidates: result.isbnCandidates,
      barcodes: result.barcodes,
    })
  }))

  /**
   * Choose between barcode readings that cannot be told apart by arithmetic.
   *
   * One photo can decode as several EAN-13s and more than one can survive
   * both its own check digit and the Bookland test. Mary Barton's back cover
   * reads as 9781240286898 and 9781840226898; only the second is a book, and
   * taking whichever came back first filled the dialog with the wrong
   * number.
   *
   * At the shelf the catalogue settles this, because the book is already in
   * it. Here it usually is not, so the question goes to the same source the
   * dialog is about to consult anyway: the one that resolves to a real title
   * wins.
   *
   * Only runs when there is genuine ambiguity, so the ordinary single-barcode
   * read pays nothing.
   */
  async function settleAmbiguity(
    result: { isbn13: string; isbn10: string; barcodes: string[] },
  ): Promise<{ isbn13: string; isbn10: string }> {
    const readings = [...new Set(
      result.barcodes.map((code) => resolveIsbnPair(code).isbn13).filter(Boolean),
    )]
    if (readings.length < 2) return result

    // All at once, then chosen in reading order. Asked one at a time this
    // cost a lookup per wrong guess, and the wrong guesses come first.
    //
    // `supplement: false` because the only thing read off these answers is
    // `found`. Most of them are a barcode misread and belong to no book at all,
    // and the one that is right is looked up again properly by whoever asked.
    // Topping up a page count here would be several requests to two national
    // catalogues, per wrong guess, for a result that is discarded on the next
    // line (#305).
    const checked = await Promise.all(
      readings.map(async (isbn) => ({
        isbn,
        real: (await lookupIsbn(isbn, { googleApiKey, supplement: false })
          .catch(() => null))?.found ?? false,
      })),
    )

    const winner = checked.find((entry) => entry.real)
    return winner ? resolveIsbnPair(winner.isbn) : result
  }

  app.get('/api/lookup/isbn/:isbn', asyncRoute(async (req, res) => {
    // asyncRoute's handler type is express.Request, not the route-literal
    // type app.get would otherwise infer, so :isbn is a plain indexed lookup
    // under noUncheckedIndexedAccess. Express only calls this handler when
    // the segment matched, so it is always a string.
    const isbnParam = req.params.isbn ?? ''
    const raw = normaliseIsbn(isbnParam)
    const pair = resolveIsbnPair(raw)

    // The old guard tested `isbn13 && !isValidIsbn13(isbn13)`, which let an
    // invalid 10-digit entry straight through: the conversion returned '',
    // making the left side falsy and skipping the check entirely.
    if (!pair.isbn13 && raw.length >= 10) {
      res.status(400).json({
        error: `"${isbnParam}" is not a valid ISBN-10 or ISBN-13.`,
      })
      return
    }

    const result = await lookupIsbn(raw, { googleApiKey })
    const existing = await store.findByIsbn(result.isbn13 || pair.isbn13)

    res.json({
      ...result,
      duplicateOf: existing
        ? { id: existing.id, title: existing.title, location: existing.location }
        : null,
    })
  }))

  app.get('/api/lookup/title', asyncRoute(async (req, res) => {
    const result = await searchTitle(String(req.query.q ?? ''), { googleApiKey })
    res.json({ ...result, duplicateOf: null })
  }))

  // ---------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------

  /**
   * Where would this book go, without saving it? Drives the live placement
   * card as the user edits the review fields.
   *
   * **And, since #429, where does it go on the plank a walk is taking it to.**
   * `goingTo` names that plank, and it is the difference between the two
   * questions this route can be asked. Without it the answer is the rules':
   * where does this book belong, which is what somebody typing into the review
   * pane is asking. With it the answer is about one plank a person is standing
   * in front of, and the rules are not consulted about which plank that is.
   *
   * The carry flow sends it, because a trip already knows where it is going and
   * the placing screen never did. See `atThePlankItIsGoingTo`.
   */
  app.post('/api/placement/preview', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const draft = asDraft(body)
    if (!draft.title) {
      res.status(400).json({ error: 'A title is required to work out placement.' })
      return
    }
    /*
     * The plank a caller says the book is going onto, named by its area and
     * refused when this collection has no such area.
     *
     * Refused rather than ignored, and this is the one thing here that must not
     * be lenient: quietly falling back to "where does it belong" is exactly the
     * answer #429 is about, and a screen would have no way of telling that it
     * had been given it.
     *
     * `plankLabels` rather than the run's own planks, so a plank somebody has
     * taken out of a bookcase still counts. That is half of every trip a run
     * move creates, and the carry list already names those at the other end of
     * the walk; a check that only knew the face would refuse the one place a
     * person is most likely to be standing.
     */
    let goingTo: { areaId: number; label: string } | null = null
    if (body.goingTo !== undefined && body.goingTo !== null) {
      const areaId = Number(body.goingTo)
      const label = Number.isInteger(areaId) && areaId > 0
        ? (await plankLabels(db)).get(areaId)
        : undefined
      if (label === undefined) {
        res.status(400).json({ error: 'There is no such plank to put a book on.' })
        return
      }
      goingTo = { areaId, label }
    }
    // When editing a saved book, it must not turn up as its own neighbour.
    const excludeId = Number(body.excludeId ?? 0) || undefined
    /*
     * The range this draft states, rather than the one the book's tags settle
     * on. Nothing is written here, so there is no restatement to read back, and
     * what the person is being shown is the answer to what they have typed.
     *
     * The two differ only for a book carrying a person's genre tag that no save
     * put there, applied through `POST /api/books/:id/tags` and disagreeing with
     * what the review pane says. That book's save follows the person's tag and
     * the preview is one step behind it, which is the trade of not writing.
     */
    const { range } = genreStatedBy(draft)
    /*
     * Nothing states a genre, so there is no run to find a gap in (#304).
     *
     * Refused on the same terms as a missing title above, because it is the
     * same kind of missing: a placement is a position in one of two ordered
     * lists, and this draft is in neither. Answering a position anyway is what
     * this issue exists to stop. The client does not ask when it knows the
     * answer is this, and says so on the screen instead.
     */
    if (range === null) {
      res.status(400).json({
        error:
          'Nothing says whether this is fiction or non-fiction, '
          + 'so there is nowhere to work out.',
      })
      return
    }
    const placement = await store.placementFor(draft, range, excludeId)
    res.json(goingTo
      ? await atThePlankItIsGoingTo(placement.range, placement, goingTo, excludeId)
      : await inDerivedScheme(placement.range, placement, excludeId))
  }))

  /**
   * Where a run lives, what it is cut into, and whether it can be moved.
   *
   * **The read the arrange screen draws itself from**, and it is a read rather
   * than a refusal because both of the things it answers were being worked out
   * from something other than this. The screen took the bookcase off the first
   * group of books it was showing, which is a different question and a
   * different answer the moment the leading bookcase of a run is empty (#500);
   * and it could not find out that a run was one no move may pick up until
   * somebody had chosen a destination and been refused (#486).
   *
   * A run that cannot be moved answers 200 with the reason. It is an ordinary
   * arrangement rather than a fault: an area rule serving a range is what "say
   * what belongs here" on a plank writes, and #430 item 1 keeps two rules on
   * one genre legal. A 400 here would put the same sentence in the same error
   * banner at the same late moment.
   */
  app.get('/api/placement/run', asyncRoute(async (req, res) => {
    const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    res.json(await runMoveOffer(db, range))
  }))

  /**
   * What moving a run would cost in books carried, and then the move.
   *
   * Two routes and one idea, the same pair as `/api/shelves/overflow/plan` and
   * the route beside it: the first computes and **writes nothing**, the second
   * makes the change and hands back what it wrote. Splitting them across two
   * screens or two releases would leave half an idea, since a plan nobody can
   * apply is a report and an apply nobody can preview is a leap.
   *
   * The bookcase is a number because that is what a person reads off a shelf,
   * and moving non-fiction from bookcase 4 to bookcase 3 is the sentence this
   * exists for. What it does **not** do is renumber bookcase 4: a label is
   * derived from a fixture's position, so renumbering would carry every book's
   * recorded location along with it and nobody would have anything to carry. See
   * `domain/placement/relocate.ts`.
   */
  app.post('/api/placement/run/plan', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const range = body.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const planned = await planRunMove(db, range, Number(body.bookcase ?? 0))
    if (!planned.ok) {
      res.status(400).json({ error: planned.error })
      return
    }
    res.json(planned.plan)
  }))

  app.post('/api/placement/run', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const range = body.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const applied = await applyRunMove(
      db, range, Number(body.bookcase ?? 0), new Date().toISOString(),
    )
    if (!applied.ok) {
      res.status(400).json({ error: applied.error })
      return
    }
    res.json({ plan: applied.plan, wrote: applied.wrote })
  }))

  /**
   * Changing what a place allows: the plan, and then the write.
   *
   * Two routes rather than one with a flag, the way the run move already does
   * it, and for the reason the whole feature turns on: **the first writes
   * nothing.** A person is shown what their change does to every book in the
   * collection before any of it exists as a row, and the same function answers
   * both, so what they approved is what gets recorded.
   *
   * Under `/api/placement` beside the run move, because both are the same kind
   * of question: what the rules want, and the ledger rows that follow from it.
   * Neither of them moves a book.
   */
  /**
   * The rules on one place, as the screen that changes them needs them.
   *
   * **The one read that speaks slugs.** Everything else answers a rule in the
   * labels a person reads, and `furniture.routes.test.ts` holds the whole of
   * `/api/fixtures` and `/api/books/:id/claim` to containing no slug at all.
   * Writing needs the identity, because a label matched back against the
   * vocabulary would start asking for a different tag the day two of them read
   * alike, so the identity travels here and only here.
   */
  app.get('/api/placement/rule', asyncRoute(async (req, res) => {
    const about = req.query.about === 'fixture' ? 'fixture' : 'area'
    const id = idIn(req.query.placeId, res, 'No such place.')
    if (id === null) return

    res.json({ rules: await rulesOnPlace(db, about, id) })
  }))

  app.post('/api/placement/rule/plan', asyncRoute(async (req, res) => {
    const read = await draftFrom(db, (req.body ?? {}) as Record<string, unknown>)
    if (!read.ok) {
      refused(res, read)
      return
    }

    const planned = await planRuleChange(db, read.draft)
    if (!planned.ok) {
      refused(res, planned)
      return
    }
    res.json({ plan: planned.plan })
  }))

  app.post('/api/placement/rule', asyncRoute(async (req, res) => {
    const read = await draftFrom(db, (req.body ?? {}) as Record<string, unknown>)
    if (!read.ok) {
      refused(res, read)
      return
    }

    const applied = await applyRuleChange(db, read.draft, new Date().toISOString())
    if (!applied.ok) {
      refused(res, applied)
      return
    }
    res.json({ plan: applied.plan, wrote: applied.wrote })
  }))

  /**
   * Which books no rule claims, and how many there are altogether.
   *
   * **The question #341 says nothing could answer.** It is absent from both
   * range listings, both misfile reviews, the first screen and every area's
   * claimed-by-nothing card, and the tag filter cannot express it: "no rule
   * claims it" is a question about the rules, not about a slug, and negating a
   * tag would answer a different question that happens to overlap today.
   *
   * `total` beside a capped page, the same pair and the same cap `listing`
   * answers with, for the same reason: this list is one a first screen shows a
   * count of and a person walks a few rows of, and the worst case is a room
   * whose rules have all been switched off, which is the whole catalogue.
   *
   * Under `/api/placement` rather than under `/api/books`, because it is a
   * question about where the rules put things, and because `/api/books/:id`
   * would have swallowed the word.
   *
   * **It writes nothing, and it must not learn to.** Answering this by writing a
   * genre tag is exactly what #304 stopped doing on the owner's explicit
   * instruction. What settles one of these books is a person saying what it is.
   */
  app.get('/api/placement/unclaimed', asyncRoute(async (_req, res) => {
    const found = await booksNoRuleClaims(db)
    res.json({ books: found.slice(0, PAGE_LIMIT), total: found.length })
  }))

  /**
   * Every book the shelf and the rules put in different places (#489).
   *
   * **The check is not new and neither is its answer.** `areaDisagreements` has
   * placed every shelved book twice since #213, once the way the app draws it
   * and once the way the rules claim it, and `applySchema` has run it on every
   * start ever since. It was right through the whole of #485: it named twelve
   * books on every restart of the api, it printed `every book lands where the
   * rules claim it` the moment that was fixed, and **the only place either
   * sentence appeared was the server log**. Nothing on any screen said anything
   * was wrong, so the one person who could act on it had no way to know.
   *
   * This route is the reading half, and #311 is the shape it copies: that issue
   * put the backup check behind `GET /api/backup` and a card on the first
   * screen, for the identical reason. A detection nobody reads is silent in
   * exactly the way a prevention that gets bypassed is silent.
   *
   * `total` beside a capped page, which is `/api/placement/unclaimed`'s pair
   * directly above and `findBooks`' before that: the count is what the first
   * screen says, the names are what explain it, and the worst case is a
   * catalogue whose every book disagrees.
   *
   * **It reports and it must never repair.** That is `area-drift.ts`'s own rule
   * and it is the reason the state in #485 was diagnosable at all: the broken
   * shelf was stable and survived restarts, so it could be read three weeks
   * later. A route that wrote the disagreement away would have destroyed the
   * evidence of a defect nobody had found yet. There is deliberately no
   * `POST` beside this, and the screens say out loud that nothing will be moved
   * so that nobody adds one later on the grounds that the card looked
   * unfinished without it.
   */
  app.get('/api/placement/drift', asyncRoute(async (_req, res) => {
    const found = await areaDisagreements(db)
    res.json({ books: found.slice(0, PAGE_LIMIT), total: found.length })
  }))

  // ---------------------------------------------------------------------------
  // Books
  // ---------------------------------------------------------------------------

  app.post('/api/books', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const draft = asDraft(body)
    if (!draft.title) {
      res.status(400).json({ error: 'A title is required.' })
      return
    }

    const captureId = Number(body.captureId ?? 0)

    /*
     * A book saved out of the queue is a row that already exists (#183).
     *
     * This is the second of the two steps `docs/data-model.md` describes.
     * `identified` says somebody worked out what the book is; this route is
     * somebody standing at a shelf saying where it went, and the two are
     * separate facts established at separate moments by possibly different
     * people. The row was created by the first photograph, so what happens here
     * is an update that moves it to `shelved`, not an insert.
     *
     * It still carries the photographs across explicitly, because the draft is
     * what `store` writes from and the client does not re-upload them. For a
     * book that is still queued this restates photographs it already has, which
     * costs a statement each and changes nothing: recording is idempotent per
     * book and file. It is not redundant on the other path. A capture that has
     * already left the queue is saved as a *new* book, and this is what hands
     * the new one the filenames the old one was photographed with.
     */
    const capture = captureId ? await queue.get(captureId) : undefined
    const queued = capture && capture.status !== 'done' ? capture : undefined
    if (capture) {
      draft.frontImage = capture.front_image
      draft.backImage = capture.back_image
      draft.edgeImage = capture.edge_image
    }

    // Photos arrive as data URLs and are written beside the database rather
    // than into it, so the SQLite file stays small enough to copy around.
    // Anything uploaded here wins over the capture's copy.
    const images = (body.images ?? {}) as Record<string, unknown>
    for (const slot of ['front', 'back', 'edge'] as const) {
      const buffer = decodeDataUrl(String(images[slot] ?? ''))
      if (!buffer) continue
      const name = saveImage(buffer, draft.isbn13 ?? '', slot)
      if (slot === 'front') draft.frontImage = name
      if (slot === 'back') draft.backImage = name
      if (slot === 'edge') draft.edgeImage = name
    }

    /*
     * The genre is settled before the row, because `books.shelf_range` is
     * derived from the tags now rather than from `books.is_fiction` (#223).
     *
     * A queued book already exists and may already carry a genre somebody
     * applied, so its tags are restated and read back and that answer is what
     * the row is written with. A book that does not exist yet carries none, so
     * `addBook` files it under the one claim this save makes and the tag is
     * written the moment there is a row to hang it on.
     */
    let id: number
    /**
     * Where the book goes, or null when nothing files it (#304).
     *
     * A save that states no genre writes no genre tag, so no rule claims the
     * book and it joins neither run. The row is written all the same, with
     * everything anybody said about it: what it has no answer to is where on a
     * shelf it belongs, and there is nothing here that could invent one.
     */
    let placement: Placement | null
    if (queued) {
      id = queued.id
      placement = await store.updateBook(id, draft, await settleGenre(id, draft))
    } else {
      const added = await store.addBook(draft)
      id = added.id
      placement = added.placement
      await settleGenre(id, draft)
    }

    await recordCredits(id, draft)

    /*
     * Record where the book physically went.
     *
     * Saving happens at the end of the shelving step, with the person
     * standing at the shelf having just answered "it fits" about this exact
     * label. That answer is an observation and it is the only one anybody
     * will ever make about this book unless it moves, so losing it leaves
     * the catalogue with no idea where the book is and misfile detection
     * with nothing to reconcile.
     *
     * A location sent by the client wins, since that came from a person too.
     *
     * **A book nothing files has no derived plank to fall back on** (#304), so
     * nothing is recorded and the ledger keeps saying nobody has put it
     * anywhere. A location the client did send is written as it always was:
     * somebody can stand a book somewhere without the app knowing what it is
     * about, and that observation is theirs rather than the shelving's.
     *
     * **The plank, not what the plank is called** (#359). This used to hand the
     * ledger the label the layout drew, which is a string of ordinals, and
     * `areaForLabel` then read it back into the area it had come from. That is a
     * round trip through a rendering to reach a row the layout already knew, and
     * #356 is what a rendering does when somebody names a bookcase.
     */
    if (!draft.location?.trim() && placement) {
      const landed = await shelves.areaOf(placement.range, id)
      if (landed !== null) await store.setLocationIn(id, landed)
    }

    // Deliberately not awaited. The person is waiting to be told where the
    // book goes, and a cover that arrives a second later costs them nothing.
    //
    // There is no fourth step recording the photographs again. Each of these
    // three writes a photograph down itself, through `server/photographs.ts`,
    // which is what makes the same true of the backfills and of the two command
    // line tools: they go through the same three functions.
    //
    // Handed to `inTheBackground` rather than voided, so that a teardown can
    // wait for it and so a failure has an owner. Nothing about when it runs
    // changes.
    //
    // The `.catch(() => undefined)` that used to sit on the last step is gone
    // (#203). It was there because a rejection nobody caught took the process
    // down, and swallowing it was the price of staying up; `inTheBackground`
    // now reports it instead, so the price is no longer worth paying. Carrying
    // on is still safe: a cover, a hash and a crop are things a book can be
    // without, every reader draws a book that has none, and `record` is
    // idempotent, so the next pass catches up.
    inTheBackground(
      fetchCoverFor(id)
        .then(() => hashBook(id))
        .then(() => cropBookPhotos(id)),
      `filling in the cover, hashes and crops of book ${id}`,
    )

    res.status(201).json({
      id,
      // The freshly computed placement, not whatever the client previewed.
      // With two people scanning, a neighbour can appear between preview
      // and save, and the stale one would send the book to the wrong gap.
      //
      // Null when no genre tag claims the book, which is a saved book with
      // nowhere the rules can put it rather than a save that failed (#304).
      placement: placement && await inDerivedScheme(
        placement.range,
        { ...placement, ...(await store.resolveKey(draft)) },
      ),
      counts: await store.counts(),
      queue: await queue.counts(),
    })
  }))

  /**
   * The listing, and the four questions the library and the find screen ask of
   * it.
   *
   * **What this answered before is exactly what it answers now**: `?range=` and
   * nothing else, coerced to fiction, every catalogued book in that run in
   * `sort_key` order. Every parameter below is additive and every one of them is
   * absent in what the shelving screens send, which is why the route was widened
   * rather than a second listing route added beside it. `#315` is where the
   * reasoning is: a screen showing books asks this, and it should not have to
   * know which of two routes answers its particular narrowing.
   *
   * - `range=all` is the whole collection, fiction then non-fiction, which is
   *   the order the bookcases stand in. It is spelled explicitly because an
   *   absent `range` has meant fiction since this route existed, and a listing
   *   that silently doubled would be a change to every caller.
   * - `q=` is titles and the names on the cover, folded and near enough.
   * - `isbn=` has at most one answer.
   * - `tag=` may be given more than once, and all of them must hold. A tag
   *   matches itself and anything under it.
   * - `limit=` and `offset=` are a page, and `total` says how many the query
   *   matched rather than how many this page holds. **An absent `limit` is the
   *   largest page rather than every book** (#332): see `PAGE_LIMIT`. It used to
   *   mean no limit at all, which made an unbounded response the thing you got
   *   for forgetting a parameter.
   *
   * `counts` is unchanged and is still the whole catalogue rather than this
   * query: two screens read it for the number under the title, and it is the
   * denominator in "6 of 1,204" rather than the numerator.
   */
  app.get('/api/books', asyncRoute(async (req, res) => {
    const asked = String(req.query.range ?? '')
    const range = asked === 'all' ? null : asked === 'nonfiction' ? 'nonfiction' : 'fiction'

    const tags: string[] = []
    for (const raw of [req.query.tag ?? []].flat()) {
      const slug = TagSlug.parse(String(raw))
      if (!slug) {
        res.status(400).json({ error: `"${String(raw)}" is not a tag.` })
        return
      }
      tags.push(slug.value)
    }

    const limit = Number(req.query.limit)
    const offset = Number(req.query.offset)

    const found = await store.listing({
      range,
      words: String(req.query.q ?? ''),
      isbn: String(req.query.isbn ?? ''),
      tags,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      offset: Number.isFinite(offset) && offset > 0 ? offset : undefined,
    })

    res.json({ books: found.books, total: found.total, counts: await store.counts() })
  }))

  /**
   * The shelves screen, which is somebody standing at a bookcase holding a
   * phone.
   *
   * Three reads, and it used to be three plus one per checked-out book. Each of
   * those laid the whole run out to answer where one absent book would go, so
   * the screen got slower the more books were off the shelf, which is the state
   * a busy household is permanently in (#332, and `docs/api-review.md`). The
   * answer is unchanged in every field: `Shelves.shelvesForSortKeys` says why
   * asking about a hundred keys at once gives each the answer asking about it
   * alone gave.
   */
  app.get('/api/shelves', asyncRoute(async (req, res) => {
    const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'

    const drawn = await shelves.shelving(range)
    /*
     * Books off the shelf, each with the shelf it would land on.
     *
     * They hold no position, so they are absent from the groups above and
     * the numbering there counts only what is physically there. This is
     * display only: it lets the library show a gap where a book belongs
     * instead of making an absent book invisible from the shelf it came
     * off.
     */
    const off = (await store.checkedOut()).filter((book) => book.shelf_range === range)
    /*
     * The plank, and then its name, which is the order #356 settled and the
     * order the placing step already asks in. The screen puts an absent book in
     * the gap it belongs in by matching it to a board, and matching two
     * renderings of one plank is the comparison that hid 181 books; so the area
     * is what it matches on and the label is what it reads. `shelvesForSortKeys`
     * renders the ordinal walk and is the answer only where the run has no plank
     * to name.
     */
    const areas = await shelves.areasForSortKeys(range, off.map((book) => book.sort_key))
    const walked = await shelves.shelvesForSortKeys(range, off.map((book) => book.sort_key))

    res.json({
      groups: drawn.groups,
      separators: drawn.separators,
      loads: drawn.loads,
      checkedOut: off.map((book, at) => ({
        book,
        areaId: areas[at] ?? null,
        label: areas[at] == null ? walked[at]! : drawn.planks.labelOf(areas[at]!),
      })),
    })
  }))

  /**
   * The person at the shelf says it will not take another book.
   *
   * Answers with the one physical step to perform, and there are two kinds.
   * `carry` means the book in their hand is the one that moves, which is the
   * answer whenever it belongs at the end of the full shelf: nothing already
   * shelved is touched. `step` means a book has to come off the end to open a
   * gap in the middle. Whether the shelf either lands on can cope is not
   * knowable here, so the client asks and calls again if not.
   *
   * `sortKey` is the book being placed. It is optional because this route is
   * also walked for a book that is already shelved and has no gap of its own,
   * and it is what makes the first answer visible at all: a book that is not
   * saved yet appears in no layout the database can produce.
   */
  /**
   * The same question asked without answering it: what would move, and what
   * would the shelf look like afterwards.
   *
   * Strictly read only, and it is what the shelving step calls first. The
   * boundary used to shift the moment a step was proposed, so the book left
   * the plank the person was still standing at before they had touched it,
   * and stayed gone if they walked away (#111). A proposal is not an
   * observation. The strip is that proposal drawn, on the same route the
   * placing preview uses, because every level of a cascade is the same
   * question and deserves the same picture (#112).
   */
  app.post('/api/shelves/overflow/plan', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const range = body.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const kind = body.kind === 'area' ? 'area' : 'shelf'
    const placing = String(body.sortKey ?? '')

    const plank = await plankIn(range, body.areaId, res)
    if (!plank) return

    const result = await shelves.proposeOverflow(range, plank, kind, placing)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }

    const moved = result.step
      ? (await shelves.layout(range)).find((p) => p.book.id === result.step!.moved.id)?.book
      : undefined

    res.json({
      carry: result.carry ? named(result.planks!) : null,
      step: result.step
        ? {
            id: result.step.moved.id,
            ...named(result.planks!),
            title: moved?.title ?? '',
            /* Written down the spine hanging under the gap, the same as the
               book being catalogued. */
            authorFiling: moved?.author_filing ?? '',
          }
        : null,
      strip: result.strip
        ? {
            label: (await shelves.planks(range)).at(result.strip.at).label,
            gapIndex: result.strip.gapIndex,
            placedIndex: null,
            books: result.strip.books.map((placed) => stripBook(placed.book, true)),
          }
        : null,
    })
  }))

  app.post('/api/shelves/overflow', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const range = body.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const kind = body.kind === 'area' ? 'area' : 'shelf'
    const placing = String(body.sortKey ?? '')
    /*
     * The book the person was told to move, when there was one. A cascade
     * confirms its outermost frame last (#110), so the shelves can have moved
     * under a proposal since it was drawn, and applying it to whatever book
     * happens to be on the end now is exactly the stale answer #106 fixed.
     */
    const expectId = Number(body.expectId ?? 0) || 0

    const plank = await plankIn(range, body.areaId, res)
    if (!plank) return

    const result = await shelves.overflow(range, plank, kind, placing, expectId)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }

    res.json({
      /*
       * The book being placed, moved on rather than put down here.
       *
       * No id of its own, because it has none yet. Where it lands is recorded
       * when it is saved, on the plank `toAreaId` names.
       */
      carry: result.carry ? named(result.planks!) : null,
      /*
       * The one book to move, named by id as well as by title.
       *
       * The id is what lets the client record where that book ended up once
       * the person says it is there. Without it a shuffle moved the boundary
       * and left every displaced book recorded on the shelf it came off, so
       * misfile detection reported a move the person had just been walked
       * through making.
       *
       * `toAreaId` beside `to` is the second half of the same idea (#359), and
       * the same shape `Misfile` has carried since #356: the label is what the
       * person reads on the way to the shelf, and the id is what gets written
       * down when they say the book is there. On a bookcase somebody has named,
       * those two strings are not even the same string.
       */
      step: result.step
        ? {
            id: result.step.moved.id,
            ...named(result.planks!),
            title: (await shelves.layout(range))
              .find((p) => p.book.id === result.step!.moved.id)?.book.title ?? '',
          }
        : null,
      moves: await describeMoves(range, result.moves ?? []),
      groups: await shelfGroups(range),
    })
  }))

  /**
   * Bounce the first or last book of an area onto the plank next door.
   *
   * Where a plank ends is decided by where somebody ran out of room, so it is
   * the one thing in this model that needs adjusting by hand. Restricting it
   * to the first or last book is not a guard bolted onto a general move: it is
   * the complete set of moves that leave every neighbour in the sequence where
   * it was, which is why the operation is shaped like the rule.
   *
   * Nothing here writes a location. The furniture moves; a person then says
   * the book is on the new plank through PATCH /api/books/:id/location, which
   * is still the only route that changes where the catalogue thinks a book is.
   *
   * **`theAreaGoes` is somebody having been asked** (#433). Moving the only book
   * off a plank takes the area with it, and a request that has not said it knows
   * that is refused with the sentence and a room exactly as it was. The dialog
   * is the screen's; being unable to do it silently is the route's.
   */
  app.post('/api/shelves/move', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const range = body.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const direction = body.direction === 'previous' ? 'previous' : 'next'
    const id = Number(body.id ?? 0)
    const theAreaGoes = body.theAreaGoes === true

    // Read before the move, as it always was: afterwards the book may have
    // left this layout, and the title is what the person is told to carry.
    const title = (await shelves.layout(range)).find((p) => p.book.id === id)?.book.title ?? ''
    const result = await shelves.moveAcrossBoundary(range, id, direction, { theAreaGoes })
    if (!result.ok) {
      // The refusal carries what it refused to do, so a caller that asked
      // without knowing can put the question in front of somebody rather than
      // reading it back out of a sentence.
      res.status(400).json({ error: result.error, empties: result.empties ?? null })
      return
    }

    res.json({
      // Named the same way the overflow step is, so the client records where
      // the book landed through exactly the same call.
      move: result.move ? { id, title, ...named(result.planks!) } : null,
      moves: await describeMoves(range, result.moves ?? []),
      groups: await shelfGroups(range),
    })
  }))

  /**
   * Take back a move nobody acted on.
   *
   * The other way out of the shelving step, and the reason the step has one at
   * all. A move is offered on a phone, one mistap from a book somebody was only
   * looking at, and until this route existed the only way past it was to tap
   * "Moved it" and then move the book back: two statements about the room, both
   * false, to undo one tap. docs/shelving.md has said the list offers the move
   * back since the move was specified; this is that sentence (#196).
   *
   * Nothing here writes a location, and that is what separates it from every
   * other button near it. The book never moved, so the catalogue has nothing
   * new to record about where it is; what gets undone is the furniture.
   */
  app.post('/api/shelves/retract', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const range = body.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const id = Number(body.id ?? 0)

    const result = await shelves.retractMove(range, id)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }

    res.json({
      move: result.planks ? named(result.planks) : null,
      moves: await describeMoves(range, result.moves ?? []),
      groups: await shelfGroups(range),
    })
  }))

  /**
   * Somebody pressed Remove on the line between two areas.
   *
   * **Refused until they have been told what it does** (#456). Removing a
   * boundary takes an area off the furniture and hands its books to the area in
   * front, and until this route carried an assent one tap did both with nothing
   * said: the only thing the person saw was a carry list drawn afterwards,
   * which is a list of what has already happened rather than a question. The
   * refusal is the act's, not this route's; what belongs here is the sentence
   * and the rows a dialog puts in front of somebody, which is the same shape
   * `PATCH /api/areas/:id` refuses a strategy change with.
   */
  app.delete('/api/shelves/:id', asyncRoute(async (req, res) => {
    // Before the layout below, so a request that names nothing costs no read.
    const separatorId = idIn(req.params.id, res, 'No such boundary.')
    if (separatorId === null) return

    const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const before = await shelves.layout(range)
    // The one route that goes through the application layer. It says what was
    // asked for and nothing about how it is stored, which is the whole of what
    // #172 is demonstrating; the reads either side of it still go through
    // `Shelves` because books have not been converted.
    const removal = await removeSeparator.handle({
      separatorId,
      theAreaGoes: req.query.theAreaGoes === 'true',
    })

    if (!removal.ok) {
      /*
       * The act would not do it at all, which is not the same answer as "nobody
       * has been asked" and must not be dressed up as one (#465). Its sentence
       * already names the area and says what to do instead, so it is passed on
       * whole rather than rebuilt from a cost this route would have to read a
       * second time.
       */
      if (removal.reason === 'refused') {
        refused(res, refuse(removal.status, removal.error))
        return
      }

      // The boundary's own range rather than the one asked for, so the labels
      // are of the run the area actually stands in.
      const going = await shelves.removalCost(removal.range, separatorId)
      /*
       * Two sentences for the two costs, which is the answer to whether this is
       * the same act as the one #433 guards. It is: an area comes off the
       * furniture. What differs is whether anything was standing on it, and a
       * sentence about books joining another area when there are none would be
       * the app describing something that is not going to happen.
       */
      refused(res, refuse(
        409,
        going.books === 0
          ? `Removing this line takes ${going.area} off the furniture. `
            + 'Nothing has been changed.'
          : `Removing this line takes ${going.area} off the furniture, and its `
            + `${going.books} book${going.books === 1 ? ' joins ' : 's join '}${going.into}. `
            + 'Nothing has been changed.',
        going,
      ))
      return
    }

    res.json({
      moves: await describeMoves(range, await shelves.movesSince(range, before)),
      groups: await shelfGroups(range),
    })
  }))

  /**
   * One book, and who it credits.
   *
   * The credits travel with it because the review pane's filing field is about
   * the first-listed name, and what that name files under is a fact about the
   * alias rather than a column on the book since #227. A listing answers rows
   * that carry `author_filing`, joined on from the same place; this is the one
   * route that reads a single book, and it reads the model.
   */
  app.get('/api/books/:id', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    const book = await store.getBook(id)
    if (!book) {
      res.status(404).json({ error: 'No such book.' })
      return
    }
    res.json({ book, authors: await describeCredits(id) })
  }))

  /**
   * Where a book has been (#315).
   *
   * The ledger has held this since #185 and nothing has ever read it back: every
   * route asks it where a book is now, through the projection. A book's own page
   * asks the other question, and the answer is rows that already exist rather
   * than a record kept for a screen.
   *
   * Read only, by construction. There are four statements that write a placement
   * and all four are in `Store`; this is not a fifth and cannot become one.
   */
  app.get('/api/books/:id/placements', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    if (!(await store.getBook(id))) {
      res.status(404).json({ error: 'No such book.' })
      return
    }
    res.json(await historyOf(db, id))
  }))

  app.put('/api/books/:id', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    const before = await store.getBook(id)
    if (!before) {
      res.status(404).json({ error: 'No such book.' })
      return
    }

    const draft = asDraft(req.body ?? {})
    if (!draft.title) {
      res.status(400).json({ error: 'A title is required.' })
      return
    }

    /*
     * The one place a book stops being the book it was.
     *
     * Changing the ISBN is the person telling the app this row is a different
     * book, so what was on record about the old one is withdrawn here, before
     * the new record is written over the top of it. `ReidentifyBookHandler`
     * carries the reasoning and the boundary; the reason it is one call rather
     * than a rule inside `settleGenre` is that genre will not stay the only
     * thing a person can say about a book.
     *
     * It runs before the genre is settled, and now that the genre decides the
     * shelf range that ordering is load bearing rather than tidy: the old
     * book's genre tag has to be off the row before the new one is read back,
     * or a corrected book would file under what it used to be.
     */
    if (namesADifferentBook(before, draft)) await reidentifyBook.handle({ bookId: id })

    const placement = await store.updateBook(id, draft, await settleGenre(id, draft))
    await recordCredits(id, draft)
    res.json({
      id,
      // Null when no genre tag claims the book. See `POST /api/books` (#304).
      placement: placement && await inDerivedScheme(placement.range, placement),
      counts: await store.counts(),
    })
  }))

  /*
   * ---------------------------------------------------------------------
   * Tags (#179). Every one of these goes through the application layer.
   * ---------------------------------------------------------------------
   *
   * The routes say what somebody asked for and nothing about how it is stored,
   * the way `DELETE /api/shelves/:id` already does. What is different here is
   * that the reads go through the port as well, because there is no `Store`
   * method for tags and there is deliberately never going to be one.
   *
   * A slug is a path, so it arrives in the query string rather than in the URL:
   * `genre/fantasy` in a path segment is two segments, and the alternative is
   * asking every caller to encode a slash into a route the router then decodes
   * back. `?slug=` costs nothing and cannot be got wrong.
   */

  /** The slug a request means, or a 400 saying what was wrong with it. */
  function slugFrom(raw: unknown, res: express.Response): TagSlug | null {
    const slug = TagSlug.parse(String(raw ?? ''))
    if (!slug) res.status(400).json({ error: `"${String(raw ?? '')}" is not a tag.` })
    return slug
  }

  /**
   * The vocabulary, or the part of it under one slug.
   *
   * `?under=genre` is the prefix question, and it is answered as an index range
   * over the slug rather than by filtering here. See the note on the repository.
   */
  app.get('/api/tags', asyncRoute(async (req, res) => {
    const raw = String(req.query.under ?? '')
    const under = raw ? TagSlug.parse(raw) : null
    if (raw && !under) {
      res.status(400).json({ error: `"${raw}" is not a tag.` })
      return
    }

    const vocabulary = await tags.vocabulary(under ?? undefined)
    /*
     * How many books each one has, counting the ones under it (#315).
     *
     * A tag with no count beside it is a door with nothing written on it: the
     * screen that lists somebody's tags is the screen they choose one from, and
     * "Fantasy" alone does not say whether choosing it shows a hundred books or
     * none. It rolls up, because choosing Fantasy shows the books tagged Urban
     * fantasy too, and a number that disagreed with the list one tap later would
     * be the screen contradicting itself.
     *
     * Counted by `Store` rather than through the tagging port, deliberately.
     * `TagRepository` is about the vocabulary and says in its own words that it
     * is not a place to ask which books match something; this is a listing
     * question about `catalogued_books`, which is what `Store` is for.
     */
    const counts = new Map((await store.tagCounts()).map((one) => [one.slug, one.books]))
    res.json({
      tags: vocabulary.map((one) => ({
        slug: one.slug.value,
        label: one.label,
        note: one.note,
        books: counts.get(one.slug.value) ?? 0,
      })),
    })
  }))

  /** Rename a tag. The label moves; the slug is the identity and does not. */
  app.patch('/api/tags', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const slug = slugFrom(body.slug, res)
    if (!slug) return

    const label = String(body.label ?? '').trim()
    if (!label) {
      res.status(400).json({ error: 'A tag needs a label somebody can read.' })
      return
    }

    await relabelTag.handle({ slug, label })
    res.json({ tags: (await tags.vocabulary(slug)).map((one) => ({
      slug: one.slug.value, label: one.label, note: one.note,
    })) })
  }))

  /**
   * Why this book is here: which rule claimed it and which ones lost.
   *
   * The one screen that makes the rules legible to somebody who did not write
   * them, which is the whole household except the owner. Two screen groups reach
   * it, the furniture and the book page, so it is one read for both.
   *
   * **A book no rule claims is a real answer** and not an error: since #304
   * nothing has to state a genre, so no tag gets written and no rule matches.
   * The list comes back empty and the screen says so.
   */
  app.get('/api/books/:id/claim', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    const claimed = await claimOfBook(db, id)
    if (!claimed.ok) {
      refused(res, claimed)
      return
    }
    res.json({ claim: claimed.claim })
  }))

  /** What a book is under, and who said so. */
  app.get('/api/books/:id/tags', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    if (!(await store.getBook(id))) {
      res.status(404).json({ error: 'No such book.' })
      return
    }
    res.json({ tags: await describeTags(id) })
  }))

  /**
   * A person puts a book under a tag.
   *
   * The slug is normalised from what they typed, and the label is what they
   * typed, so "Lent Out" reads back as "Lent Out" and files as `mine/lent-out`
   * along with everybody else's spelling of it.
   */
  app.post('/api/books/:id/tags', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    if (!(await store.getBook(id))) {
      res.status(404).json({ error: 'No such book.' })
      return
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const typed = String(body.slug ?? body.label ?? '')
    const slug = slugFrom(typed, res)
    if (!slug) return

    await applyTag.handle({
      bookId: id,
      slug,
      label: String(body.label ?? typed).trim() || slug.value,
      now: new Date().toISOString(),
    })
    res.status(201).json({ tags: await describeTags(id) })
  }))

  /** A person takes a book back out of a tag, whoever put it there. */
  app.delete('/api/books/:id/tags', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    if (!(await store.getBook(id))) {
      res.status(404).json({ error: 'No such book.' })
      return
    }

    const slug = slugFrom(req.query.slug, res)
    if (!slug) return

    await removeTag.handle({ bookId: id, slug })
    res.json({ tags: await describeTags(id) })
  }))

  /**
   * Re-run the catalogue lookup for a book and restate what it claims.
   *
   * The route the retraction rule exists for. A tag the catalogue has stopped
   * claiming goes away, one it has started claiming appears, and **a tag a
   * person applied is untouched, because the only rows this can delete are the
   * ones carrying `source = 'catalogue'`.** See `RestateTagsHandler`.
   *
   * A lookup that finds nothing is not an empty claim: the catalogue being down
   * or the ISBN being unknown says nothing about the book, and treating it as a
   * retraction would strip a book's subjects because somebody's API had a bad
   * minute. It is reported as `found: false` and nothing is written.
   */
  app.post('/api/books/:id/tags/refresh', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    const book = await store.getBook(id)
    if (!book) {
      res.status(404).json({ error: 'No such book.' })
      return
    }

    const isbn = book.isbn13 || book.isbn10
    if (!isbn) {
      res.status(400).json({ error: 'This book has no ISBN to look up.' })
      return
    }

    const found = await lookupIsbn(isbn, { googleApiKey })
    if (!found.found) {
      res.json({ found: false, tags: await describeTags(id) })
      return
    }

    await restateTags.handle({
      bookId: id,
      source: 'catalogue',
      claims: claimsFrom({
        genre: found.classification.genre,
        confidence: asConfidence(found.classification.confidence),
        categories: found.categories,
        subjects: found.subjects,
      }),
      now: new Date().toISOString(),
    })

    res.json({ found: true, source: found.source, tags: await describeTags(id) })
  }))

  /**
   * A book's tags, said the way a client reads them: with the label.
   *
   * The label is looked up rather than carried on `AppliedTag`, because the
   * domain rule about who may retract what has no use for a display string and
   * a type that carried one would invite somebody to match on it. The whole
   * vocabulary is a few dozen rows and is read once per response.
   */
  async function describeTags(bookId: number) {
    const [applied, vocabulary] = await Promise.all([tags.of(bookId), tags.vocabulary()])
    const labels = new Map(vocabulary.map((one) => [one.slug.value, one.label]))
    return applied.map((one) => ({
      slug: one.slug.value,
      label: labels.get(one.slug.value) ?? one.slug.value,
      source: one.source,
      confidence: one.confidence,
    }))
  }

  /*
   * ---------------------------------------------------------------------
   * Authors (#180). Every one of these goes through the application layer.
   * ---------------------------------------------------------------------
   *
   * The same shape as the tag routes above: what somebody asked for, and
   * nothing about how it is stored.
   *
   * **Nothing here decides where a book files.** `books.author_filing` and
   * `books.sort_key` are still what the shelving code reads, and #180 changes
   * neither, exactly as #179 left `books.is_fiction` in place. These routes are
   * the vocabulary of names and the two corrections a person makes to it.
   */

  // ---------------------------------------------------------------------------
  // The furniture
  // ---------------------------------------------------------------------------

  /*
   * Fixtures and areas: the tables have been here since #184 and nothing in the
   * app could touch them. This is the owner's first objective (#302), which is
   * modelling the furniture he actually owns against the live catalogue, and
   * every route here is a write somebody makes standing in front of a bookcase.
   *
   * **No route here accepts or returns a stored label**, because there is no such
   * thing: a label is worked out from a fixture's number and name and an area's
   * ordinal and name at the moment it is read. What every write answers with
   * instead is `becomes`, which is every label that reads differently once the
   * change lands. See `server/furniture.ts`.
   */

  /** The whole room: every piece on the floor and every area on its face. */
  app.get('/api/fixtures', asyncRoute(async (_req, res) => {
    res.json(await describeFurniture(db))
  }))

  /**
   * What the whole collection falls back on (#350).
   *
   * The one write about the collection itself, and there is no `GET` beside it:
   * `GET /api/fixtures` already answers `defaultSortStrategy` and a second read
   * of one column would be a second answer to keep agreeing with the first.
   *
   * No id in the path, because there is one collection. The day there is more
   * than one is #171, and it is a change to every route here rather than to the
   * shape of this one.
   */
  app.patch('/api/collection', asyncRoute(async (req, res) => {
    const edited = await editCollection(db, (req.body ?? {}) as Record<string, unknown>)
    if (!edited.ok) {
      refused(res, edited)
      return
    }
    res.json({ collection: { defaultSortStrategy: edited.defaultSortStrategy } })
  }))

  app.get('/api/fixtures/:id', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such piece of furniture.')
    if (id === null) return

    const fixture = await describeFixture(db, id)
    if (!fixture) {
      res.status(404).json({ error: 'No such piece of furniture.' })
      return
    }
    res.json({ fixture })
  }))

  /** Put a piece of furniture in the room. It arrives with no areas on it. */
  app.post('/api/fixtures', asyncRoute(async (req, res) => {
    const added = await addFixture(db, (req.body ?? {}) as Record<string, unknown>)
    if (!added.ok) {
      refused(res, added)
      return
    }
    res.status(201).json({ fixture: added.fixture })
  }))

  /**
   * Rename a piece, renumber it, or change what it is and how it orders.
   *
   * Renumbering moves nothing: every area keeps its id, so every book keeps the
   * area it was placed in and its recorded location travels with the furniture.
   * What changes is what the planks are called, which is `becomes`. Pointing a
   * run of books at a different piece is `POST /api/placement/run` and is the
   * one that produces books in somebody's hands.
   */
  app.patch('/api/fixtures/:id', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such piece of furniture.')
    if (id === null) return

    const edited = await editFixture(db, id, (req.body ?? {}) as Record<string, unknown>)
    if (!edited.ok) {
      refused(res, edited)
      return
    }
    res.json({ fixture: edited.fixture, becomes: edited.becomes })
  }))

  /** What removing this piece would mean, before anybody agrees to it. */
  app.get('/api/fixtures/:id/removal', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such piece of furniture.')
    if (id === null) return

    const planned = await planFixtureRemoval(db, id)
    if (!planned.ok) {
      refused(res, planned)
      return
    }
    res.json({ removal: planned.removal })
  }))

  /**
   * Take a piece of furniture away.
   *
   * Refused while books are standing on it, and it says how many: they move to
   * other furniture first, which is a real carry and has a plan in front of it.
   */
  app.delete('/api/fixtures/:id', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such piece of furniture.')
    if (id === null) return

    const removed = await dropFixture(db, id)
    if (!removed.ok) {
      refused(res, removed)
      return
    }
    res.json({ removed: removed.removed })
  }))

  /**
   * The books standing on one piece of furniture, in the order they stand.
   *
   * A piece's own page says how it is ordered and shows what that ordering does
   * to these books, which is the half the owner said was missing: naming a sort
   * rule does not answer why the books read in the order they do. Asking area by
   * area would be one request per plank and a screen putting them back in order.
   */
  app.get('/api/fixtures/:id/books', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such piece of furniture.')
    if (id === null) return

    const read = await booksOnFixture(db, id)
    if (!read.ok) {
      refused(res, read)
      return
    }
    res.json({ fixture: read.fixture, books: read.books })
  }))

  /**
   * Cut another area into a piece, at the end or between two that exist.
   *
   * **With no `startsAt` the server works out where it opens** (#381), which is
   * what makes the fixtures screen's button add an area rather than open a
   * screen asking which book the new one starts at. See `anchorForNewArea`.
   */
  app.post('/api/fixtures/:id/areas', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such piece of furniture.')
    if (id === null) return

    const added = await addAreaTo(db, id, (req.body ?? {}) as Record<string, unknown>)
    if (!added.ok) {
      refused(res, added)
      return
    }
    res.status(201).json({ area: added.area, becomes: added.becomes })
  }))

  /**
   * Rename an area, move it along its piece, re-anchor it, or give it an order
   * of its own.
   *
   * A strategy of its own makes an area self-contained: nothing overflows into
   * it from the area before, because a continuous run only works while every
   * area in it orders the same way. That is refused with the effect attached
   * until the body carries `acknowledge`, so the change cannot happen without
   * somebody having been shown what it does to the run.
   */
  app.patch('/api/areas/:id', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such area.')
    if (id === null) return

    const edited = await editArea(db, id, (req.body ?? {}) as Record<string, unknown>)
    if (!edited.ok) {
      refused(res, edited)
      return
    }
    res.json({ area: edited.area, becomes: edited.becomes, effect: edited.effect })
  }))

  /**
   * The books standing in one area, in the order they stand there.
   *
   * **This is what replaces the label match #313 had to make.** Splitting an
   * area needs the books in it, because a boundary is a book, and nothing
   * answered that: the screen asked for both stretches of shelving and found the
   * area whose *label* matched. Labels are derived at read time precisely so
   * nothing depends on their stability, and the owner already has two pieces of
   * furniture both standing at 4. This answers by identity instead.
   */
  app.get('/api/areas/:id/books', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such area.')
    if (id === null) return

    const read = await booksInArea(db, id)
    if (!read.ok) {
      refused(res, read)
      return
    }
    res.json({ area: read.area, books: read.books })
  }))

  /**
   * What removing this area would do to its books. Writes nothing.
   *
   * The dialog #281 settled is drawn from this: which area takes the books in,
   * how many join it, how many are left alone because somebody pinned them, and
   * every label that reads differently afterwards.
   */
  app.get('/api/areas/:id/removal', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such area.')
    if (id === null) return

    const planned = await planAreaRemoval(db, id)
    if (!planned.ok) {
      refused(res, planned)
      return
    }
    res.json({ plan: planned.plan })
  }))

  /**
   * Take an area off a piece and let its books fall into the next one along.
   *
   * Closer to a merge than to a deletion. No book is deleted, no placement is,
   * and the removed area is retired rather than dropped whenever the ledger
   * names it, so a book recorded on that plank is still recorded on it. What
   * gets written is an `assigned` row per book naming the area that took them
   * in, which is #185's rule, and the difference between that and where somebody
   * last saw the book is the needs-attention list that already exists.
   */
  app.delete('/api/areas/:id', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such area.')
    if (id === null) return

    const removed = await dropArea(db, id, new Date().toISOString())
    if (!removed.ok) {
      refused(res, removed)
      return
    }
    res.json({ plan: removed.plan })
  }))

  /** An author and every name they publish under, as a client reads them. */
  function describeAuthor(stored: StoredAuthor) {
    return {
      id: stored.id,
      isCorporate: stored.author.isCorporate,
      note: stored.author.note,
      primary: stored.author.primary.name.value,
      aliases: stored.aliases.map((alias) => ({
        id: alias.id,
        displayName: alias.name.value,
        filingName: alias.filing,
        isPrimary: alias.isPrimary,
      })),
    }
  }

  /** A book's credits, said the way a client reads them. */
  async function describeCredits(bookId: number) {
    return (await authors.creditsOf(bookId)).map((alias, at) => ({
      position: at + 1,
      aliasId: alias.id,
      authorId: alias.authorId,
      displayName: alias.name.value,
      filingName: alias.filing,
    }))
  }

  /** Everybody this collection has read, with every name they publish under. */
  app.get('/api/authors', asyncRoute(async (_req, res) => {
    res.json({ authors: (await authors.everyone()).map(describeAuthor) })
  }))

  /**
   * Everything by this person, which is the question the joined string could not
   * answer in either direction.
   *
   * Asked of the author rather than of one name, so Banks and Banks M come back
   * together while each still files where it is printed. That is the whole
   * reason an author holds no name.
   */
  app.get('/api/authors/:id/books', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such author.')
    if (id === null) return

    const found = await authors.find(id)
    if (!found) {
      res.status(404).json({ error: 'No such author.' })
      return
    }

    const ids = await authors.booksCreditedTo(found.aliases.map((alias) => alias.id))
    const books = await Promise.all(ids.map((id) => store.getBook(id)))
    res.json({ author: describeAuthor(found), books: books.filter(Boolean) })
  }))

  /**
   * Two authors turn out to be one person.
   *
   * The route the backfill's conservatism was banking on. It moves names between
   * authors and nothing else, so no book changes places: the books still credit
   * the same aliases, and the aliases still file under the same names.
   */
  app.post('/api/authors/merge', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const intoId = Number(body.intoId)
    const fromId = Number(body.fromId)
    if (!Number.isInteger(intoId) || !Number.isInteger(fromId)) {
      res.status(400).json({ error: 'Two author ids are needed.' })
      return
    }
    if (intoId === fromId) {
      res.status(400).json({ error: 'An author is already themselves.' })
      return
    }
    if (!(await authors.find(intoId)) || !(await authors.find(fromId))) {
      res.status(404).json({ error: 'No such author.' })
      return
    }

    await mergeAuthors.handle({ intoId, fromId })
    const merged = await authors.find(intoId)
    res.json({ author: merged ? describeAuthor(merged) : null })
  }))

  /**
   * A person says this name files under something else.
   *
   * `author_filing`'s override, arrived at its destination. The printed name is
   * not changeable and is not accepted here: a book credits it, and rewriting it
   * would change what the book says on its cover.
   */
  app.patch('/api/authors/aliases/:id', asyncRoute(async (req, res) => {
    const aliasId = idIn(req.params.id, res, 'No such name.')
    if (aliasId === null) return

    const filing = String(((req.body ?? {}) as Record<string, unknown>).filingName ?? '').trim()
    if (!filing) {
      res.status(400).json({ error: 'A name has to file under something.' })
      return
    }
    if (!(await authors.everyone()).some((one) =>
      one.aliases.some((alias) => alias.id === aliasId))) {
      res.status(404).json({ error: 'No such name.' })
      return
    }

    await fileAlias.handle({ aliasId, filing })
    res.json({ authors: (await authors.everyone()).map(describeAuthor) })
  }))

  /** Who a book credits, in the order the names are printed on it. */
  app.get('/api/books/:id/authors', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    if (!(await store.getBook(id))) {
      res.status(404).json({ error: 'No such book.' })
      return
    }
    res.json({ authors: await describeCredits(id) })
  }))

  /**
   * A person restates who wrote a book.
   *
   * The whole list, in order, because that is what the question means: an edit
   * that drops a co-author has to drop the credit, and one that reorders them
   * has to reorder them. A name nobody has seen gets an author of its own, and
   * saying it is really somebody already here is `POST /api/authors/merge`.
   */
  app.put('/api/books/:id/authors', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    if (!(await store.getBook(id))) {
      res.status(404).json({ error: 'No such book.' })
      return
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const printed = Array.isArray(body.authors) ? body.authors.map(String) : []
    const unusable = printed.find((name) => name.trim() && !nameFor(name))
    if (unusable) {
      res.status(400).json({ error: `"${unusable}" is not a name.` })
      return
    }

    await creditBook.handle({
      bookId: id,
      authors: printed,
      filingOverride: body.filingOverride == null ? null : String(body.filingOverride),
    })
    res.json({ authors: await describeCredits(id) })
  }))

  /*
   * ---------------------------------------------------------------------
   * Captures (#181). The photographs of one book, as rows.
   * ---------------------------------------------------------------------
   *
   * Read only, and that is the whole of the route surface this issue adds.
   * Photographs are written by the paths that already take them, through
   * `recordPhotographs`, because a photograph arrives as part of saving a book
   * and never on its own. An endpoint that could post one would be an endpoint
   * for a workflow nobody has.
   *
   * Nothing in the client reads this yet. It is here because `capture` is
   * otherwise a table with no way to look at it, which is a thing to have to
   * open a database to review.
   */
  app.get('/api/books/:id/captures', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    if (!(await store.getBook(id))) {
      res.status(404).json({ error: 'No such book.' })
      return
    }

    const photographs = await captures.of(id)
    res.json({
      captures: photographs.list.map((one) => ({
        kind: one.kind,
        file: one.file,
        cropFile: one.cropFile,
        examined: one.examined,
        /*
         * The three states, named, so a reader does not have to reconstruct
         * them from a flag and an empty string. `declined` is the one worth
         * having: it says a detector looked at this photograph and could not
         * find the book in it, which is a different fact from `unexamined` and
         * is what licenses a caption to say so.
         */
        verdict: verdictOf(one),
        /** The crop where there is one, the whole photograph otherwise. */
        shown: shownFile(one),
        hash: one.hash,
        takenAt: one.takenAt,
      })),
    })
  }))

  /**
   * A person says where this book physically is now.
   *
   * The only way a recorded location ever changes. Misfile detection reports
   * and never corrects: a book stays recorded where it was last seen until
   * somebody has actually walked to the shelf and moved it, because the ledger
   * is the record of where the book really is and a guess written into it is
   * worse than an empty one.
   *
   * **Two labels this used to take are refused since #232**, and both refusals
   * are the price of there being one record instead of two.
   *
   * A label naming a plank the collection does not have was recordable, because
   * `books.location` was a string and would hold anything `parseLocation`
   * accepted. There is nowhere in the ledger for `9Z` to go, and `0015` spent a
   * migration counting the books that had one. So it is refused, and the message
   * says what a plank is.
   *
   * An empty label used to take a book back to never-placed. The ledger is
   * append only and none of its six kinds says that: `withdrawn` means given
   * away and `checked_out` means it is in somebody's bag. So it is refused too,
   * and the message says which of the two was probably meant. No screen sends
   * either one.
   *
   * **It also takes an `areaId`, and that is the form a screen should send**
   * (#356). A label is derived from where a piece stands and what it is called,
   * so a list drawn a minute ago and acted on now can name a plank by a name
   * nobody uses any more. The misfile list sends the id for the same reason
   * `/api/carry/trip` takes two of them. The label form stays because a person
   * standing at a shelf types `1A`, and because that is what every screen that
   * reads a plank off a layout already sends.
   */
  app.patch('/api/books/:id/location', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    if (!(await store.getBook(id))) {
      res.status(404).json({ error: 'No such book.' })
      return
    }

    const body = (req.body ?? {}) as { location?: unknown; areaId?: unknown }
    if (body.areaId !== undefined) {
      const areaId = idIn(body.areaId, res, 'There is no such plank to put a book on.')
      if (areaId === null) return

      try {
        await store.setLocationIn(id, areaId)
      } catch (error) {
        if (!(error instanceof UnknownPlank)) throw error
        res.status(400).json({ error: error.message })
        return
      }
      await shelves.clearOutstandingMove(id)
      res.json({ book: await store.getBook(id) })
      return
    }

    const label = String(body.location ?? '').trim()
    if (!label) {
      res.status(400).json({
        error: 'Say which plank the book is on. A book that has left the shelves ' +
          'is checked out or withdrawn rather than nowhere.',
      })
      return
    }
    if (!parseLocation(label)) {
      res.status(400).json({ error: `${label} is not a location, e.g. 1A or 4B.` })
      return
    }

    try {
      await store.setLocation(id, formatLocation(parseLocation(label)!))
    } catch (error) {
      if (!(error instanceof UnknownPlank)) throw error
      res.status(400).json({ error: error.message })
      return
    }
    /*
     * A person has said where the book is, so a boundary move waiting on them
     * is no longer waiting: whatever they said, this is the observation the
     * move was outstanding for. Leaving the receipt would leave "take it back"
     * on offer for a move that has been answered, and taking it back then would
     * move the furniture out from under what they just wrote down.
     */
    await shelves.clearOutstandingMove(id)
    res.json({ book: await store.getBook(id) })
  }))

  app.delete('/api/books/:id', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    const book = await store.getBook(id)
    if (!book) {
      res.status(404).json({ error: 'No such book.' })
      return
    }

    // Every photograph of this book and every crop cut from one. The crops are
    // derived, but they are still files on disk and nothing else will ever name
    // them once this row and its photographs are gone.
    const images = await filesOf(db, id)
    await store.deleteBook(id)
    const removed = await deleteOrphanedImages(images)

    res.json({ ok: true, counts: await store.counts(), photosRemoved: removed.length })
  }))

  /**
   * Take a book off the shelf, or put it back.
   *
   * The point is that the model can be corrected by hand. A book that will
   * not physically fit where the layout says it goes can be pulled out; the
   * shelf closes up behind it here exactly as it does in the room, and
   * nothing is told to file itself next to a book that is sitting on the
   * table.
   *
   * Nothing is deleted. The entry, its photos and its filing all survive,
   * and putting it back is the same flow as shelving it the first time.
   */
  app.post('/api/books/:id/checkout', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such book.')
    if (id === null) return

    const book = await store.getBook(id)
    if (!book) {
      res.status(404).json({ error: 'No such book.' })
      return
    }

    const out = (req.body ?? {}).out !== false
    const result = await store.setCheckedOut(id, out)
    res.json({
      outcome: checkoutOutcome(out, result.changed),
      book: await store.getBook(id),
      counts: await store.counts(),
    })
  }))

  /**
   * Fetch and store the publisher cover for one book.
   *
   * Open Library indexes covers by ISBN, so the common case needs no
   * metadata lookup. Only when it has nothing do we spend a full lookup to
   * see whether Google has one.
   */
  async function fetchCoverFor(id: number): Promise<string> {
    const book = await store.getBook(id)
    if (!book || book.cover_image) return book?.cover_image ?? ''

    const isbn = book.isbn13 || book.isbn10
    if (!isbn) return ''

    let name = await downloadCover(openLibraryCover(isbn), isbn, coverDir)

    if (!name) {
      // `supplement: false`: the one field read here is `coverUrl`, which no SRU
      // catalogue carries. This also runs as a backfill over every book in the
      // collection at once, which is the shape of request two free national
      // catalogues publish a rate limit about (#305).
      const found = await lookupIsbn(isbn, { googleApiKey, supplement: false })
        .catch(() => null)
      if (found?.coverUrl) {
        name = await downloadCover(upgradeGoogleCover(found.coverUrl), isbn, coverDir)
      }
    }

    // Stamped either way, so a book with no cover anywhere is asked about
    // once.
    await store.setCoverImage(id, name)
    return name
  }

  /**
   * Work through books that have no cover yet, a batch at a time.
   *
   * Batched rather than all at once because it is someone else's API and
   * there is no hurry: every book in the library predates this column, and
   * they only need fetching once.
   */
  // Not under /api/covers: that path is a static mount with fallthrough off,
  // which answers anything beneath it and would reject this as a 405.
  app.post('/api/backfill/covers', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const limit = Math.min(50, Math.max(1, Number(body.limit ?? 10)))
    // Ask again about the ones that came up empty, for when a cover has
    // since been added upstream or a lookup was simply down at the time.
    const retry = body.retry === true
    const todo = await store.missingCovers(limit, retry)

    let fetched = 0
    for (const book of todo) {
      if (await fetchCoverFor(book.id)) fetched += 1
    }

    res.json({
      tried: todo.length,
      fetched,
      remaining: (await store.missingCovers(1000)).length,
      withoutCover: (await store.missingCovers(1000, true)).length,
    })
  }))

  /**
   * Cut a freshly saved book's photographs down to the book itself.
   *
   * Server side, after the save, and not awaited. The phone is the wrong place
   * for this: the shutter path already takes a burst and scores it for
   * sharpness (#92) on a device somebody is straining to hold steady, sharp is
   * already available here and does the pixel work in a fraction of a second,
   * and cropping before upload would mean the only copy that reached the disk
   * was the cropped one. The photograph has to land first, whole, and then be
   * cropped from.
   *
   * Failure does not disturb the save: a crop is derived data and a book with
   * none is a book shown whole. It is no longer silent, though (#203). A crop
   * that failed and said nothing is indistinguishable from a photograph the
   * detector looked at and declined, which is the distinction #192 built the
   * `capture` table around, so the failure is reported and only then dropped.
   */
  async function cropBookPhotos(id: number): Promise<void> {
    const book = await store.getBook(id)
    if (!book) return
    try {
      await cropPhotos(store, book, cropIo, { apply: true })
    } catch (reason) {
      // Left uncropped, which is a state the views already draw, and said out
      // loud so that "uncropped" never has to stand in for "nobody tried".
      backgroundFailed(`cropping the photographs of book ${id}`, reason)
    }
  }

  /** Hash whatever images a book has, so it can be recognised by its cover. */
  async function hashBook(id: number): Promise<void> {
    const book = await store.getBook(id)
    if (!book) return

    const read = async (name: string) => {
      if (!name) return ''
      try {
        return await coverHash(readFileSync(join(coverDir, name)))
      } catch {
        return ''
      }
    }

    await store.setHashes(
      id,
      book.front_hash || (await read(book.front_image)),
      book.cover_hash || (await read(book.cover_image)),
    )
  }

  /**
   * Books that look like the one in the photo, best first.
   *
   * A shortlist, never an answer. Measured over thirty generated covers and
   * five kinds of re-photograph, this puts the right book first about nine
   * times in ten and in the top three about nineteen times in twenty, which
   * is worth showing somebody and not worth acting on by itself, so the
   * caller confirms. It also puts a wrong book first and inside the cutoff
   * on roughly one query in ten, which is the reason confirming is not
   * optional.
   */
  async function looksLike(query: string | null, limit = 4) {
    // A frame with nothing in it, or bytes that are not an image at all.
    // Either way there is nothing to compare, and an empty shortlist is the
    // honest answer. The caller falls through to reading the page, which is
    // what happens when no book is recognised.
    if (!query) return []

    const scored = (await store.hashIndex()).map((row) => ({
      row,
      // Whichever of the two stored images is the better likeness. A photo
      // of a book usually resembles another photo of it more than it
      // resembles the publisher's clean artwork, but not always.
      d: Math.min(
        row.front_hash ? distance(query, row.front_hash) : 64,
        row.cover_hash ? distance(query, row.cover_hash) : 64,
      ),
    }))

    // 32 of 64 bits is what two unrelated images average, so anything past
    // the mid twenties is noise wearing a number.
    return scored
      .filter((entry) => entry.d <= 24)
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map(({ row, d }) => ({
        id: row.id,
        title: row.title,
        authorFiling: row.author_filing,
        // The photo taken of this actual copy, in preference to the
        // catalogue's. An ISBN often has several cover designs against it,
        // and showing one the person has never seen makes them doubt a
        // correct match. Their own photo is of the book in their hands.
        ...ownPhoto(row),
        checkedOut: row.checked_out,
        distance: d,
      }))
  }

  /**
   * The hash of the photograph being asked about, or nothing.
   *
   * Taken once and handed to both comparisons. Hashing twice would be fifty
   * wasted milliseconds, but the reason it lives here is that the books path
   * and the queue path must be asking with the same string: two hashes of one
   * buffer are equal today and a divergence would be invisible, which is the
   * kind of bug this file keeps arguing against.
   */
  async function queryHash(input: Buffer): Promise<string | null> {
    try {
      return await coverHash(input)
    } catch {
      return null
    }
  }

  /**
   * Captures already waiting to be shelved that look like the book being held
   * up, nearest first (#122).
   *
   * A different answer from `looksLike`, not a section of it, and held to a
   * much tighter bar. `QUEUE_LIMIT` says why in full; the short version is
   * that these are photographs compared against photographs taken in the same
   * room, which share a background the hash can see, so two different books
   * land as close as 16 bits apart and `MATCH_CUTOFF` would call about one
   * pair in five a match.
   *
   * Nothing here writes and nothing here is acted on without a tap.
   */
  async function alreadyInQueue(query: string | null, limit = 3, exceptId: number | null = null) {
    if (!query) return []

    const scored = (await queue.waiting())
      .filter((row) => row.id !== exceptId)
      .map((row) => ({
        capture: row,
        // The front photograph only. A capture's hash is of its front, and the
        // books path already refuses to compare hashes it cannot line up.
        distance: distance(query, row.front_hash),
      }))

    return queueMatches(scored, limit).map((match) => ({ ...match, basis: 'cover' as const }))
  }

  /**
   * Captures already waiting that carry this exact ISBN, in the shape the
   * cover comparison answers in (#146).
   *
   * `distance` is null rather than 0. Zero is a measurement, and there is no
   * measurement here: nothing was compared. A caller that printed "looks the
   * same, 100%" off a fabricated zero would be dressing an identifier up as a
   * likeness, and the two are not the same kind of evidence.
   */
  async function queuedWithIsbn(isbn13: string, limit = 3, exceptId: number | null = null) {
    const rows = await queue.sharingIsbn(isbn13, exceptId)
    return rows.slice(0, limit).map((capture) => ({
      capture,
      distance: null,
      basis: 'isbn' as const,
    }))
  }

  /**
   * Whether this capture is a second photographing of a book already in the
   * queue, and which captures say so (#146).
   *
   * **An ISBN is stronger evidence than a hash, not weaker.** #138 answered
   * this question with a perceptual comparison, because it was asked from the
   * scan route on a front cover, where a hash is the only signal there is. A
   * capture is different: the back cover is the first shot the Add flow takes
   * and it carries the barcode, so by the time this is asked there is usually
   * an ISBN, and an ISBN-13 either satisfies its check digit or is thrown
   * away. So the identifier is asked first and answers alone when it answers
   * at all. The hash is what is left when nothing could be read.
   *
   * The cover comparison is unchanged and still held to `QUEUE_LIMIT`, which
   * is `CLOSE_LIMIT` and about a third of the shortlist's `MATCH_CUTOFF`.
   * Nothing here loosens it and nothing here reuses `MATCH_CUTOFF`: on the
   * owner's own photographs that cutoff calls nearly one pair of different
   * books in five a match, because a shared table and carpet pull two books
   * together rather than apart (#122). A wrong answer here says two different
   * books are one book, and the way that ends is a book nobody catalogues.
   *
   * Nothing here writes, and nothing here stops a capture existing. Two copies
   * of one book genuinely turn up, so this is a finding to put in front of a
   * person, not a refusal.
   */
  async function duplicatesOf(capture: CaptureRow, limit = 3) {
    const byIsbn = await queuedWithIsbn(capture.isbn13, limit, capture.id)
    if (byIsbn.length) return byIsbn

    // Only now, and only if the front has been hashed. A capture with no hash
    // has not been through the background pass yet, or carried no detail worth
    // hashing; either way there is nothing to compare and no answer to give.
    if (!capture.front_hash) return []

    return alreadyInQueue(capture.front_hash, limit, capture.id)
  }

  /**
   * Work through missing covers quietly in the background.
   *
   * Slow on purpose. It is someone else's API, nobody is waiting on the
   * result, and cover_checked_at means the work converges: once every book
   * has been asked about, this finds nothing and stops until new books
   * arrive.
   */
  async function backfillCoversInBackground(): Promise<void> {
    for (;;) {
      const todo = await store.missingCovers(5)
      if (!todo.length) return

      for (const book of todo) {
        await fetchCoverFor(book.id)
        await hashBook(book.id)
        await new Promise((done) => setTimeout(done, 400))
      }
    }
  }

  /** Hashing is local and cheap, so it runs flat out until it is done. */
  async function hashInBackground(): Promise<void> {
    for (;;) {
      const todo = await store.missingHashes(25)
      if (!todo.length) return
      for (const book of todo) await hashBook(book.id)
    }
  }

  app.get('/api/checked-out', asyncRoute(async (_req, res) => {
    res.json({ books: await store.checkedOut() })
  }))

  /**
   * Hold a book up to the camera and find out which book it is.
   *
   * One round trip from photo to an identity, because the alternative is
   * three and the person is stood there holding the book.
   *
   * **This route answers a question. It never writes.** There is no direction
   * to give it and no state for it to change, in any branch, for any input.
   * The scanner is one entry point now rather than a check-out camera and a
   * check-in camera, so there is nothing here that could know which of the
   * two the person meant, and guessing from the book's current state is
   * exactly what was deferred until identification is measurably better than
   * one wrong first candidate in ten (#49). The client opens the book's
   * detail view, which reads the state and offers the actions that fit it,
   * and the person chooses. A checkout still happens in one place only:
   * `POST /api/books/:id/checkout`, which takes an id and a direction and no
   * photograph at all.
   */
  app.post('/api/books/scan', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>

    const buffer = decodeDataUrl(String(body.image ?? ''))
    if (!buffer) {
      res.status(400).json({ error: 'Send an image as a data URL.' })
      return
    }

    /*
     * Barcode only to begin with, and no OCR.
     *
     * Someone is stood at a shelf holding a book, so the order of the
     * fallbacks is the order of their cost. Reading a barcode takes about
     * a fifth of a second when it works. Hashing the cover to shortlist
     * books takes about fifty milliseconds. A full OCR pass takes five to
     * ten seconds and, for a book being held front-out, almost always
     * returns nothing: it used to run every single time, before the
     * cover match that actually answers.
     *
     * So OCR is last, and only runs when the cover is not recognised
     * either.
     */
    const read = await identify(buffer, {
      wantTitle: false,
      ocrEnabled: false,
      // zxing only, and only as a first look. A front held up to the camera
      // has no barcode at all, and the thorough ladder spends seconds proving
      // it before the cover match answers in fifty milliseconds. What the
      // fast pass may not do is settle the question: when it reads nothing,
      // the branch below gives the barcode its thorough look before any
      // shortlist that is not certain of itself gets to answer.
      barcodeEffort: 'fast',
    })

    if (!read.isbn13) {
      const query = await queryHash(buffer)
      const candidates = await looksLike(query)

      /*
       * A barcode is evidence. A cover hash is a guess.
       *
       * An ISBN-13 carries a check digit, so a decoded one either validates
       * or is discarded. A hash distance is a similarity score that puts the
       * wrong book first about one lookup in ten. Precedence has to follow
       * that, and it did not: any candidate inside the shortlist cutoff used
       * to return here, which meant the thorough barcode read never ran on
       * the very photo a person takes when they want the barcode read (#66).
       *
       * So only one shortlist may answer before the barcode has had its
       * second look: a single candidate in the `close` band, which is the
       * same bar the scanner already opens a book on without asking. That
       * keeps the common path at the shelf, a front cover held up and
       * recognised, exactly as fast as it was.
       */
      if (confidentPick(candidates)) {
        res.json({ outcome: 'candidates', barcodes: read.barcodes, candidates })
        return
      }

      /*
       * Then: is this book already sitting in the queue, scanned by somebody
       * else and not shelved yet? (#122)
       *
       * Asked here rather than folded into the shortlist above because it is
       * a different answer to a different question. A book on a shelf is a
       * catalogued record with a title and a place; a capture is three
       * photographs and a job somebody started. It has no catalogue id, it
       * may have no title, and the useful thing to say about it is not "is it
       * one of these" but "somebody has already done this, go and finish it".
       * Folding it into one list would have to pick a title for a row that
       * has none, and would have to present two very different cutoffs, 24
       * and 8, as one scale of likeness.
       *
       * After the books, not before, and only when no book was close. A
       * catalogued row is a settled fact and a capture is work in progress,
       * so when both look identical the person gets the shortlist they get
       * today rather than being sent to the queue. In practice they rarely
       * collide: a book still in the queue is by definition not catalogued.
       *
       * Before the thorough barcode read, for the same reason a confident
       * shortlist is: somebody is stood there holding the book, and this
       * costs a hash comparison per queued capture against seconds of zbar
       * and OCR that will find nothing on a front cover.
       */
      const waiting = hasCloseMatch(candidates) ? [] : await alreadyInQueue(query)
      if (waiting.length) {
        res.json({ outcome: 'in-queue', matches: waiting })
        return
      }

      /*
       * Now look properly. `thorough` is the default effort, so this adds the
       * zbar ladder underneath zxing: measured on a phone-sized photo it
       * turns a 0.14s look into a 1.5s one when there is no barcode to find,
       * and it reads small, distant and low-contrast barcodes that the fast
       * pass misses outright.
       *
       * OCR only when there is no shortlist at all. Reading the printed page
       * costs five to ten seconds, and a shortlist is something to show the
       * person now rather than a reason to make them wait for it.
       */
      const slow = await identify(buffer, {
        wantTitle: false,
        ocrEnabled: candidates.length === 0,
      })

      if (!slow.isbn13) {
        if (candidates.length) {
          res.json({ outcome: 'candidates', barcodes: slow.barcodes, candidates })
          return
        }
        res.json({ outcome: 'no-isbn', barcodes: slow.barcodes, candidates: [] })
        return
      }
      read.isbn13 = slow.isbn13
      // The thorough pass saw the barcodes the fast one did not, and the
      // disambiguation below is only as good as the list it is given.
      read.barcodes = slow.barcodes
    }

    /*
     * One photo can decode several barcodes, and not all of them are real.
     * A back cover carries the EAN-13 and often an EAN-5 price add-on, and
     * zbar will occasionally return a misread alongside the true one: Mary
     * Barton decodes as 9781240286898, 9781840226898 and 9181840826898,
     * and only the middle one is the book. All three pass their own check
     * digit or are discarded by the Bookland test, so arithmetic cannot
     * separate them.
     *
     * The catalogue can. Here we are looking for a book that is already in
     * the library, so the reading that names one is the reading that is
     * right, whatever order zbar happened to return them in.
     */
    // Every reading looked up, then the first that named a row taken, exactly
    // as before. Promise.all keeps them in reading order, which is what the
    // choice between them rests on.
    const fromBarcodes = await Promise.all(
      read.barcodes
        .map((code) => resolveIsbnPair(code).isbn13)
        .filter(Boolean)
        .map((isbn) => store.findByIsbn(isbn)),
    )

    const book = fromBarcodes.find(Boolean) ?? await store.findByIsbn(read.isbn13)

    if (!book) {
      /*
       * No shelf has it, but the queue might (#146).
       *
       * The barcode branch never asked this. #138 only ever ran the queue
       * comparison where no barcode read, so holding up a book somebody
       * photographed an hour ago and not yet shelved answered "not in the
       * library yet, add it first", which is an instruction to scan it a
       * second time.
       *
       * By ISBN, not by hash, and that is the point: the digits are already in
       * hand and validated by their own check digit, so there is nothing for a
       * perceptual comparison to add. It is asked only after the catalogue has
       * said no, because a shelved book is a settled fact and a capture is
       * work in progress.
       */
      const waiting = await queuedWithIsbn(read.isbn13)
      if (waiting.length) {
        res.json({ outcome: 'in-queue', matches: waiting })
        return
      }

      res.json({ outcome: 'not-catalogued', isbn13: read.isbn13 })
      return
    }

    // A barcode is self-validating and this one named a row in the catalogue,
    // so the identity is settled. What to do about it is not, and is not this
    // route's to decide: the book is handed back exactly as it was found.
    res.json({ outcome: 'identified', book })
  }))

  /**
   * The books to physically move, for one range.
   *
   * Per range because fiction and non-fiction are independent ordered lists:
   * a fiction book on bookcase 1 and a non-fiction book on bookcase 4 are
   * not out of order with respect to each other and never can be.
   *
   * Read only. Nothing on this path writes a location. A location changes
   * only when a person says the book moved, which is the PATCH below.
   */
  app.get('/api/misfiles', asyncRoute(async (req, res) => {
    const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const review = await shelves.review(range)
    const outstanding = await shelves.outstandingMoves(range)

    res.json({
      ...review,
      /*
       * Which of these the app put there, so the list can offer to take those
       * back and only those. A book pushed onto the next plank by a newcomer is
       * a misfile too, and it is not one anybody can undo: there is no
       * assignment to withdraw, and moving the boundary to close it would be a
       * new decision about the furniture made on the person's behalf.
       *
       * Both planks have to still agree with the receipt. If they do not, the
       * shelves have moved on since the move and taking it back would not put
       * the book back, which `retractMove` would refuse anyway. Better not to
       * offer it than to offer it and refuse.
       *
       * **Four area ids, and not one address among them** (#481). The receipt
       * used to say where the move went as `4B`, so this had to parse it back
       * into a plank before it could be compared with `misfile.book.areaId`, and
       * an address is a statement about position, which is exactly what a
       * boundary move changes: renumbering a face makes the row that read `1C`
       * read `1B`, and two pieces can stand on one number. The receipt now names
       * the planks it was between, so the comparison is four ids and no
       * rendering, and it says the same thing on a piece somebody has named, on
       * a face that has been renumbered since, and on a plank the move itself
       * took off the furniture.
       *
       * A receipt written before that migration can carry no id for a plank the
       * collection no longer has, and a null never matches. That is the answer
       * parsing its address gave for the same row, so nothing is offered now
       * that was not offered then, and nothing withheld that was not.
       */
      outstandingMoves: review.misfiles
        .filter((misfile) => outstanding.some((receipt) =>
          receipt.bookId === misfile.book.id
          && receipt.fromArea !== null && receipt.fromArea === misfile.book.areaId
          && receipt.toArea !== null && receipt.toArea === misfile.toAreaId))
        .map((misfile) => misfile.book.id),
    })
  }))

  /**
   * Everything still to be carried, as the trips somebody would walk.
   *
   * **Read only, and there is no plan to go stale**: this is recomputed every
   * time it is asked for, out of `assigned` disagreeing with `placed`. See
   * `server/carry.ts` for why neither `/api/placement/run/plan` nor
   * `/api/misfiles` could answer it.
   */
  app.get('/api/carry', asyncRoute(async (_req, res) => {
    res.json(await outstandingWork(db))
  }))

  /**
   * One trip, read at the area the books come off.
   *
   * The two areas are ids rather than labels, because this is the one screen
   * where a label would be the wrong key: it is derived from where a piece
   * stands, and somebody renaming a bookcase between the list and the trip
   * would send the request to a plank that no longer answers to that name.
   */
  app.get('/api/carry/trip', asyncRoute(async (req, res) => {
    const missing = 'That trip names an area this collection does not have.'
    const from = idIn(req.query.from, res, missing)
    if (from === null) return
    const to = idIn(req.query.to, res, missing)
    if (to === null) return

    const trip = await tripAtArea(db, from, to)
    if (!trip) {
      res.status(404).json({ error: 'That trip names an area this collection does not have.' })
      return
    }
    res.json(trip)
  }))

  /**
   * Leave these books where they are, and stop the list asking for them.
   *
   * **The half of applying that was missing.** Applying a plan writes what the
   * rules want and moves nothing; there was no way to say that answer is not one
   * this person is going to act on, so forty-six books sat on somebody's list
   * that he had already decided against. This writes one row per book saying so.
   *
   * **It moves no book and rewrites no placement.** Every book stands where it
   * stood, books already carried keep the home they were carried to, and pinned
   * books cannot be reached from here at all. `PATCH /api/books/:id/location` is
   * still the only route that changes where the catalogue thinks a book is.
   *
   * A body naming a trip narrows it to that trip; an empty body is the whole of
   * the outstanding work, which is the state somebody is in who has changed his
   * mind about the lot. Both answer with the list redrawn, so the screen shows
   * what the ledger says rather than what it hoped.
   */
  app.post('/api/carry/leave', asyncRoute(async (req, res) => {
    const trip = tripIn(req.body, res)
    if (trip === undefined) return

    const left = await leaveWhereTheyAre(db, trip, new Date().toISOString())
    res.json({ books: left.books, work: await outstandingWork(db) })
  }))

  /**
   * Ask for that work again, which is the way back out of the sentence above.
   *
   * A withdrawal somebody could not withdraw would be the one-way door this
   * whole change exists to remove, one door along. It writes the assignment
   * again, by a person rather than by a rule, and the books are back on the list
   * where they came off it.
   */
  app.post('/api/carry/restore', asyncRoute(async (req, res) => {
    const trip = tripIn(req.body, res)
    if (trip === undefined) return

    const back = await putBackOnTheList(db, trip, new Date().toISOString())
    res.json({ books: back.books, work: await outstandingWork(db) })
  }))

  /**
   * The one command AGENTS.md tells anybody to run against a running server.
   *
   * It settled which database was opened. Since #348 it also settles **which
   * catalogues have answered**, which is the other question about this process
   * whose wrong answer is invisible from the outside. `lookup_source` read
   * `Open Library + Google Books` for zero of 238 books because Google Books
   * answered 429 to every request ever made to it, and nothing anywhere said
   * so. Now something does.
   *
   * `ok` stays `true` when a catalogue is quiet, on purpose. A source being
   * down is not this server being unhealthy: somebody can still catalogue a
   * book, which is the whole reason a failed source does not fail a lookup.
   *
   * `googleBooksKeyConfigured` is a boolean and will stay one. It answers "is
   * that why it is quiet" without going anywhere near the key. Nothing here may
   * grow a length, a prefix or a masked form of it.
   *
   * `web/src/lib/api.ts` types this response as `{ ok, counts, db }` and reads
   * only `counts`. That is left alone deliberately: this is a fact for whoever
   * curls the server, and the interface has no screen it belongs on.
   */
  app.get('/api/health', asyncRoute(async (_req, res) => {
    res.json({
      ok: true,
      counts: await store.counts(),
      db: options.dbLabel ?? '',
      lookups: {
        googleBooksKeyConfigured: googleApiKey.length > 0,
        sources: sourceStandings(),
      },
    })
  }))

  /**
   * Whether there is a backup of this collection anybody has proved restores.
   *
   * **Files on a disk, and no connection to anything** (#311). It reads the
   * names in the backup directory and the manifests beside the newest few, and
   * that is the whole of it: it does not ask the catalogue anything, and it
   * could not, because the answer it wants is not in there. See
   * `server/backup-watch.ts` for why the question is about the artefact rather
   * than about whether a scheduled job ran.
   *
   * Answers `unwatched` when no directory was given, which is every development
   * checkout and every test. Nothing is claimed in that state and no screen
   * draws anything for it: an app that said "your collection is unprotected" on
   * a scratch catalogue nobody owns is the alarm everybody learns to ignore.
   */
  app.get('/api/backup', asyncRoute(async (_req, res) => {
    res.json(await watchBackups(options.backupDir ?? ''))
  }))

  /*
   * Anything under /api that no route above matched (#332).
   *
   * Without this, Express's own finaliser answers, and it answers with an HTML
   * page: `<!DOCTYPE html> ... <pre>Cannot GET /api/does-not-exist</pre>`. Every
   * request the client makes goes through `src/lib/api.ts`, which parses the
   * body as JSON to find the `error` field, so a renamed or mistyped route
   * surfaced in the app as a JSON parse failure and the banner showed the
   * parser's message rather than the API's. Whoever went looking would have
   * debugged the parser.
   *
   * Sixty routes answer `{ error }` and now so does the gap between them. The
   * words are the error handler's own, because a path that matched nothing and a
   * cover file that is not there are the same answer to the same question.
   *
   * Registered last of all the routes and before the error handler, which is the
   * only place it can go: earlier and it would swallow whatever came after it,
   * later and it would never run. It is scoped to `/api` on purpose. Everything
   * else this server does not answer belongs to Vite in development, and the
   * client's own routing is not this file's to 404.
   */
  app.use('/api', (_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not found.' })
  })

  // Express identifies error-handling middleware solely by arity: a function
  // of exactly four parameters. Dropping the unused `next` here would
  // silently demote this to ordinary middleware, which Express would then
  // never call. The underscore keeps `noUnusedParameters` quiet without
  // deleting the parameter that is the whole reason this runs.
  //
  // The message stays generic. This is a phone-facing API, and whatever
  // `asyncRoute` forwarded here (a database error, a filesystem path, a
  // stack trace) is not something a stranger holding the app should see.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // The `/api/covers` static mount runs with `fallthrough: false`, so a
    // missing file arrives here as an error carrying `status: 404` (Express
    // itself sets `statusCode` too, depending on where the error came from).
    // That is not a server fault: books catalogued before a cover slot
    // existed have no image for it, and a publisher cover can simply be
    // absent. Answering 500 for a routine absence trains everyone to ignore
    // 500s, which is exactly when a real one gets missed. A genuine fault
    // (no status on the error at all) still answers 500 with the generic
    // message below, never the underlying detail.
    const carried = err as { status?: unknown; statusCode?: unknown } | null
    const status = carried?.status ?? carried?.statusCode
    const httpStatus = typeof status === 'number' && status >= 400 && status < 600 ? status : 500

    if (httpStatus === 404) {
      // A miss like this is routine, not exceptional, so it does not earn a
      // stack trace or the absolute filesystem path ENOENT carries. A count
      // is still useful if misses ever spike, so note that much and stop.
      console.warn('[api] not found:', _req.path)
      res.status(404).json({ error: 'Not found.' })
      return
    }

    /*
     * A reading that was given up on, answered as itself (#299).
     *
     * `POST /api/identify/isbn` and `POST /api/books/scan` read a photograph
     * with somebody stood in front of the result, so a reader that has stopped
     * reaches a person rather than a background pass. 504 rather than 500,
     * because nothing here is broken in a way a retry cannot fix, and the
     * message says what happened instead of "something went wrong": a person
     * who is told the reader gave up will hold the book up again, and one who
     * is told nothing will decide the app is broken. Handled here rather than
     * at each route so a route added later cannot forget it.
     */
    if (err instanceof ReadingTimedOut) {
      console.warn('[api] a reading was given up on:', err.message)
      res.status(504).json({
        error: `${err.message} Nothing was stored. Try that photograph again.`,
      })
      return
    }

    console.error('[api] unhandled route error:', err)
    res.status(httpStatus).json({ error: 'Something went wrong.' })
  })

  if (startBackgroundWork) {
    inTheBackground(queue.resumeOnStartup(), 'resuming the captures left pending at startup')

    // After the port is open, so a slow or unreachable cover service never
    // delays the server being usable.
    //
    // `warmOcr` joins `warmPaddle` here, and it is the third symptom of #299.
    // tesseract.js fetches about 15 MB of language data the first time a worker
    // exists on a machine, and nothing was warming it, so that download landed
    // on the first person to photograph a book with no readable barcode after
    // every restart. On a phone-facing server, on a poor connection, that is
    // indistinguishable from the wedged reader this issue is about. Both warms
    // report how long they took, which is what tells the two apart afterwards.
    setTimeout(() => {
      void warmPaddle()
        .then(() => warmOcr())
        .then(() => hashInBackground())
        .then(() => backfillCoversInBackground())
        .catch((caught) => {
          console.error('[covers] backfill stopped:', (caught as Error).message)
        })
    }, 3_000)
  }

  return app
}

// ---------------------------------------------------------------------------
// Production wiring. The only caller of createApp that binds a port, opens
// the real data directory and starts the background work.
//
// Guarded so importing createApp (as every test in index.test.ts does) never
// runs any of this. Without the guard, `import { createApp } from './index'`
// still executes every line below it: a real file database opened under
// web/data, a real port bound, and the background OCR warmup and cover
// backfill started, none of which a test may do. This is the standard ESM
// "am I the entry module" check: it is true when node (or tsx) was started
// directly on this file, and false whenever something else imported it.
// ---------------------------------------------------------------------------

const isMainModule = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

/**
 * The catalogue the server opens.
 *
 * The connection is `catalogueConnection()` and nothing else. The test harness
 * deliberately ignores that variable and every other ambient connection
 * variable (server/testdb.ts), for the same reason as `BOOKSCAN_DATA`.
 *
 * **There is nothing to choose any more.** Stages G and H each left a
 * `BOOKSCAN_DB` switch here, and with it a refusal to start when a deployment
 * had `BOOKSCAN_DATA` and no connection string: on those revisions the default
 * had flipped to Postgres while the real catalogue was still a file beside it,
 * so coming up empty would have looked exactly like a catalogue that had lost
 * every book. The catalogue is in Postgres, the file is not read by anything in
 * this repository, and a switch with one position is a thing to get wrong.
 *
 * What is left is the case that is still worth saying out loud: no connection
 * at all. A process that exits naming the variable is recoverable in one
 * command; one that comes up on an empty database is not obviously anything.
 */
export async function openCatalogue(): Promise<{ db: Db; label: string }> {
  const url = catalogueConnection()

  // Host, port and database, never the credentials. This reaches /api/health,
  // and a password on a health endpoint is a password in every log that scrapes
  // one.
  return { db: await openPostgres(url), label: describeConnection(url) }
}

if (isMainModule) {
  const PORT = Number(process.env.PORT ?? 3001)
  const DATA_DIR = resolve(process.env.BOOKSCAN_DATA ?? 'data')
  const COVER_DIR = join(DATA_DIR, 'covers')
  /*
   * The second catalogue's key, through the one accessor that reads it (#348).
   *
   * `server/secrets.ts` says where it comes from and why it comes from there:
   * the same DPAPI-encrypted file that holds this machine's catalogue
   * connection, written by `scripts/write-connection-file.ps1`, decrypted by
   * the launcher into its own process environment and nowhere else. Empty is a
   * supported state, said out loud below rather than passed over.
   */
  const GOOGLE_API_KEY = googleBooksApiKey()

  /*
   * Where this server looks for evidence that the catalogue has been backed up
   * (#311). Read only, and never created: if the directory is not there, that
   * is the answer rather than something to fix by making one.
   *
   * **Unset means nothing is watched**, and an empty value means the same
   * deliberately, so the AppHost can switch it off for a development checkout
   * by setting it rather than by hoping nothing in the shell has set it. That is
   * the arrangement `BOOKSCAN_DATA` already uses and it exists for the same
   * reason: an inherited value must not be able to decide what this process
   * touches.
   *
   * The name is not new. `server/backup-catalogue.ts` has read
   * `BOOKSCAN_BACKUP_DIR` for the directory it writes into since it was
   * written, so the tool that fills the directory and the server that watches it
   * take the same answer from the same place.
   */
  const BACKUP_DIR = process.env.BOOKSCAN_BACKUP_DIR ?? ''

  mkdirSync(COVER_DIR, { recursive: true })

  // Connecting is asynchronous where opening a file was not, so the wiring
  // moves into a function rather than running as the module evaluates. Nothing
  // else about the startup path changes: the same createApp with the same
  // options, and listen still happens once.
  const bootstrap = async () => {
    const { db, label } = await openCatalogue()

    const app = createApp({
      db,
      coverDir: COVER_DIR,
      googleApiKey: GOOGLE_API_KEY,
      dbLabel: label,
      backupDir: BACKUP_DIR,
    })

    app.listen(PORT, '127.0.0.1', () => {
      console.log(`[api] listening on http://127.0.0.1:${PORT}`)
      console.log(`[api] database ${label}`)
      /*
       * Said on every start, both ways round, for the reason the stable
       * launcher says which variables it threw away: the state this line
       * reports is otherwise invisible until something goes wrong, and "the
       * check was never switched on" and "the check says everything is fine"
       * look identical from the outside. That is the shape of the failure this
       * whole thing exists to end.
       */
      console.log(
        BACKUP_DIR
          ? `[api] watching ${BACKUP_DIR} for backups of this catalogue`
          : '[api] no backup directory watched; set BOOKSCAN_BACKUP_DIR to watch one',
      )
      /*
       * Said on every start, both ways round, for exactly the reason the line
       * above it is (#348). The state it reports was invisible for the whole
       * life of the catalogue: every Google Books request went out anonymously
       * into a shared quota that is permanently exhausted, came back 429, and
       * the second of two catalogues contributed to none of 238 books while
       * `lookup_source` said nothing was wrong.
       *
       * Whether there is a key, never the key. See server/secrets.ts.
       */
      console.log(
        googleBooksKeyConfigured()
          ? '[api] Google Books: a key is configured'
          : '[api] Google Books: no key configured. Requests go out anonymously, the shared ' +
            'anonymous quota is exhausted, and the second catalogue will answer nothing. ' +
            'See scripts/write-connection-file.ps1 and AGENTS.md.',
      )
    })
  }

  bootstrap().catch((error) => {
    // A database that will not open is not something to limp on: every route
    // needs it, and a process that exits says so where a stack trace on the
    // first request would not.
    console.error('[api] could not open the catalogue', error)
    process.exitCode = 1
  })
}

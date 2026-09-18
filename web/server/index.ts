/**
 * API server. Plain HTTP: the phone never talks to it directly, and Vite
 * proxies /api to it over the loopback interface, which is what keeps the HTTPS
 * page free of mixed content.
 */

// First, and deliberately above express: the OpenTelemetry auto
// instrumentations patch http and express as those modules load, so this has
// to be evaluated before them. ESM evaluates a module's imports in source
// order, so being the first line is what makes that true.
import '../instrumentation'

import express from 'express'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, type Stats } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
import { plankLabels, tagsRulesName, type Plank, type RunPlanks } from '../infrastructure/shelving/areas'
import { toNeighbour } from '../infrastructure/books/book-repository'
import {
  countProjectionDisagreements, projectionDisagreements, REBUILD_COMMAND,
} from '../infrastructure/placement/projection'
import { countStrandedBooks, strandedBooks } from '../infrastructure/placement/stranded'
import type { Move, PlankAt } from '../shared/layout'
import { RemoveSeparatorHandler } from '../application/shelving/remove-separator'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { DbTransactions } from '../infrastructure/shelving/transactions'
import {
  ApplyTagHandler, DefineTagHandler, ForgetTagHandler, RelabelTagHandler, RemoveTagHandler,
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
import { CATALOGUED_STATES, type BookState } from '../domain/books/state'
import { DrizzleCaptureRepository } from '../infrastructure/capture/capture-repository'
import { shownFile, verdictOf } from '../domain/capture/photographs'
import { filesOf } from './photographs'
import { PAGE_LIMIT, Store, type DraftBook } from './store'
import { mountCachePolicy, mountGate, mountSignIn } from './auth/gate'
import { describeSignIn, signInFrom, type SignInConfig } from './auth/providers'
import { bindFrom, describeBind } from './bind'
import { AuthStore } from '../infrastructure/auth/auth-store'
import { recordCredits as recordCreditsStep, settleGenre as settleGenreStep } from './book-save'
import { historyOf, UnknownPlank } from './placement-ledger'
import { applyRunMove, planRunMove, runMoveOffer } from './relocate-run'
import { applyRuleChange, draftFrom, planRuleChange, rulesOnPlace } from './place-rule'
import { leaveWhereTheyAre, outstandingWork, putBackOnTheList, tripAtArea } from './carry'
import { watchBackups } from './backup-watch'
import {
  addAreaTo, addFixture, booksInArea, booksOnFixture,
  describeFixture, describeFurniture, dropArea, dropFixture,
  editArea, editCollection, editFixture, planAreaRemoval, planFixtureRemoval,
} from './furniture'
import { idIn, refuse, refused } from './refusal'
import { booksNoRuleClaims, claimOfBook } from './claim'
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
 * of one book are one identity. The fallback to the bare digits is for the row
 * a failed relookup leaves behind: "not a valid ISBN" is still an identity
 * somebody's tags were about.
 */
function identityOf(row: { isbn13?: string; isbn10?: string }): string {
  const named = row.isbn13 || row.isbn10 || ''
  const pair = resolveIsbnPair(named)
  return pair.isbn13 || pair.isbn10 || normaliseIsbn(named)
}

/**
 * Whether a save is correcting which book a row is, rather than editing the
 * book it already is. A row that named no ISBN cannot have carried anything
 * about a different book, so filling one in is an identification rather than a
 * correction and takes nothing away.
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
 * human decision and freeze the worker out of the capture entirely.
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
 * checkout route reports. Four words rather than two, because asking for the
 * state a book is already in is not a failure and is not the same as changing
 * it.
 */
function checkoutOutcome(out: boolean, changed: boolean): 'checked-out' | 'already-out' | 'checked-in' | 'already-in' {
  if (out) return changed ? 'checked-out' : 'already-out'
  return changed ? 'checked-in' : 'already-in'
}

function stripBook(row: ShelvedBook, withPhoto: boolean) {
  // The spine is what you see looking at a shelf, and a cover is only a
  // fallback. The slot travels with the filename so the client can say which it
  // got rather than calling a front cover a spine.
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
     * may take from the catalogue: a spine's width comes off the page count or
     * off the median of the books that have one. It is text, because it is
     * whatever a catalogue said.
     */
    pages: row.pages ?? '',
  }
}

/**
 * Which image to show for a candidate, and whether it is really theirs. The
 * catalogue cover is the last resort and is labelled when used, so a design
 * they do not recognise is explained rather than quietly undermining the
 * match. The precedence lives in `shared/shelving` as `bookCover`, because the
 * library's gallery asks the same question of the same book.
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
 * Express 4 does not catch a rejected async handler, and an uncaught one takes
 * the process down. Wrapping a handler in this forwards its rejection to
 * `next`, which the error middleware registered below turns into a clean 500.
 */
function asyncRoute(
  handler: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next)
  }
}

/**
 * The trip a body names, `null` for all of the work, or `undefined` once the
 * request has been refused. Three answers rather than two: an empty body is
 * somebody saying the whole list, and half a trip is a mistake, so widening
 * `{ from: 4 }` would withdraw every outstanding book on the strength of a typo.
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
  /** A label for /api/health only, never used to open anything. */
  dbLabel?: string
  /**
   * Where the dumps of this catalogue are kept, read only, for `/api/backup`.
   * Empty or absent means nothing is watched and nothing is claimed, which is
   * what every test and every development checkout wants. See
   * `docs/backup-runbook.md`.
   */
  backupDir?: string
  /**
   * The built client, served from this same origin.
   *
   * Absent means this process answers `/api` and nothing else, which is every
   * test and every development run, where the Vite dev server serves the client
   * and proxies `/api` here.
   *
   * Present means one process serves both halves. The client addresses the API
   * with same-origin relative paths, so a session cookie set by this process is
   * sent for a page, a script and a photograph alike and one gate covers all
   * three. See `docs/running-from-a-build.md`.
   */
  clientDir?: string
  /**
   * Resume any pending capture, warm the OCR engine, and start the background
   * hash and cover-backfill loops. Defaults to on; tests pass false, because
   * none of that is safe against a scratch database and warming Paddle or
   * fetching a cover would be a real network dependency.
   */
  startBackgroundWork?: boolean
  /**
   * The ways in, and the whole of what configuration decides about the gate.
   *
   * There is deliberately no option here that turns the gate off. Absent means
   * no way to sign in has been configured, so nobody can obtain a session and
   * every route under `/api` answers 401. See `docs/the-gate.md`.
   */
  signIn?: SignInConfig
  /**
   * The clock the gate and the sign-in read, injected so a test can drive an
   * expiry without waiting thirty days for one. Defaults to the real one.
   */
  now?: () => Date
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
   * Never rejects, and it is not an assertion that the work succeeded: a failure
   * is reported by `backgroundFailed` at the moment it happens.
   */
  settled(): Promise<void>
}

export function createApp(options: CreateAppOptions): BookScanApp {
  const { db, coverDir } = options
  const googleApiKey = options.googleApiKey ?? ''
  const startBackgroundWork = options.startBackgroundWork ?? true

  /*
   * Above `Store` rather than beside the other composition roots, because the
   * class that writes `books` asks this one what the first-listed name files
   * under. `Store` reads through the port and writes nothing here. See
   * `Store.filingFor`.
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
   * cover, hashes it and crops the photographs, so the app can still be querying
   * the database after the request that started it is over and after the last
   * assertion of a test file has passed.
   *
   * Tracked so `settled` can wait for it, and so a rejection is reported against
   * the name of the work rather than ending the process.
   */
  const outstanding = new Set<Promise<unknown>>()

  /**
   * Say that background work failed, at error level, naming what it was.
   *
   * Reported rather than swallowed, because a book with no cover would otherwise
   * be indistinguishable from a book nobody ever looked for a cover for.
   *
   * Nothing is lost by carrying on: every column this work writes is derived and
   * refetchable, and a cover the save could not stamp stays in the "never
   * looked" state `missingCovers` selects on, so the backfill asks again.
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

  // A loop, because the chain being waited on adds to the set as it goes.
  // `allSettled`, because waiting for the work is not the same as owning how it
  // failed: `backgroundFailed` above is what reports that.
  async function settled(): Promise<void> {
    while (outstanding.size) await Promise.allSettled([...outstanding])
  }

  const separators = new DrizzleSeparatorRepository(db)
  const removeSeparator = new RemoveSeparatorHandler(
    separators, new DbTransactions(db, rangeLock),
  )
  const shelves = new Shelves(db, separators, removeSeparator)

  const tags = new DrizzleTagRepository(db)
  // One instance, because it is a lock namespace as much as a transaction: two
  // of them are still the same advisory lock, and sharing it says so.
  const bookTransactions = new DbBookTransactions(db)
  const restateTags = new RestateTagsHandler(tags, bookTransactions)
  const reidentifyBook = new ReidentifyBookHandler(tags, bookTransactions)
  const applyTag = new ApplyTagHandler(tags)
  const removeTag = new RemoveTagHandler(tags)
  const relabelTag = new RelabelTagHandler(tags)
  const defineTag = new DefineTagHandler(tags)
  /* The rules are read per request rather than once, because a rule naming a
     tag is exactly what changes between one of these and the next. */
  const forgetTag = new ForgetTagHandler(tags, () => tagsRulesName(db))

  /**
   * Write what this save says a book is under, and answer the range that puts it
   * in.
   *
   * A thin binding of `settleGenre` in `server/book-save.ts`, which lives there
   * so `scripts/seed-world.ts` can call the exact same steps. Null is a range: a
   * save that states no genre writes no genre tag, and a book no genre tag
   * claims is in neither run.
   */
  async function settleGenre(bookId: number, draft: DraftBook): Promise<ShelfRange | null> {
    return settleGenreStep(restateTags, tags, bookId, draft)
  }

  /**
   * Keep the credits in step with what was just saved about a book, and file the
   * first-listed name when somebody has said what it files under. Every save
   * carries it, because the alias rather than `books.author_filing` decides
   * where a book goes: an override that stopped at the column would apply to one
   * book and then vanish.
   */
  async function recordCredits(bookId: number, draft: DraftBook): Promise<void> {
    return recordCreditsStep(creditBook, authors, fileAlias, bookId, draft)
  }

  /*
   * There is no step here that records a save's photographs. `Store` and
   * `CaptureQueue` write those rows themselves, on the transaction handle that
   * writes the book, so a route cannot save a book and forget its photographs
   * and a book cannot commit without them. `server/photographs.ts` is where a
   * filename becomes a row, on the way in and back out again.
   */
  const captures = new DrizzleCaptureRepository(db)

  function saveImage(buffer: Buffer, isbn: string, slot: Slot): string {
    const name = `${Date.now()}_${isbn || 'noisbn'}_${slot}.jpg`
    writeFileSync(join(coverDir, name), buffer)
    return name
  }

  /**
   * Moves are a to-do list a person works through, so they name books rather
   * than row ids. The two planks are named off the furniture rather than off the
   * layout's own ordinals, because somebody is being asked to walk to a plank
   * and every other screen names it the way its owner named the bookcase.
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
   * A label is a rendering and changes the moment somebody names a bookcase; the
   * id does not, and it is the id a screen sends back when the person says they
   * have carried the book.
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
   * This route writes, so a wrong answer moves a real book. An id that names no
   * plank of this run is refused before anything is read or planned: it can be
   * an id from the other run, an id for a plank somebody has since taken out, or
   * a stale id off a screen drawn before the shelves changed. The alternative is
   * guessing which plank a person is standing in front of.
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
   * `store.placementFor` still answers in the old per-book scheme, where a
   * location is a string somebody typed and the range starts at "1A". Those
   * shelves no longer exist, so everything the user reads has to come from the
   * layout. Every plank named here is identified by its area, because the answer
   * a person gives on this screen is written into the ledger.
   */
  async function inDerivedScheme<T extends Awaited<ReturnType<typeof store.placementFor>>>(
    range: 'fiction' | 'nonfiction',
    placement: T,
    /** The book being edited, which must not appear as its own neighbour. */
    excludeId?: number,
  ) {
    const layout = await shelves.layout(range)
    const planks = await shelves.planks(range)
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
     * The plank, and then its name. Null when the run has no plank for this
     * book, which is a rule pointing at furniture that has been taken out; the
     * step then has nothing to record a book on and says so rather than offering
     * a plank nobody owns.
     */
    const derivedAreaId = await shelves.areaForSortKey(range, placement.sortKey)
    const derivedLocation = derivedAreaId === null
      ? await shelves.shelfForSortKey(range, placement.sortKey)
      : planks.labelOf(derivedAreaId)

    /*
     * Where the range begins, which is a different question from where this book
     * lands. `shelvesForSortKeys` answers '' for every key of a range with no
     * run, and '' is not null, so the start comes from `beginsAt` and the
     * location stays the location. A null start makes `buildPlacement` say so.
     */
    const begins = await shelves.beginsAt(range)

    // Rebuilt rather than patched: the instruction has the old labels baked
    // into its wording.
    const restated = buildPlacement(
      range, predecessor, successor, begins === null ? null : derivedLocation,
    )

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
   * The same answer, about the plank a walk is taking this book to.
   *
   * `inDerivedScheme` above asks where the book belongs; this is told where it
   * is going. The plank is not re-derived here and is not checked against the
   * rules: it is where the person is standing, taken from the trip they are
   * walking, and asking the rules again is what this exists to stop.
   *
   * Everything drawn is therefore read off that plank rather than out of the
   * run: the two books the gap is between are the two either side of it among
   * what is standing there. There is no second placing screen and there must not
   * be one, which `carrying.test` pins.
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
     * instruction carries the plank's name inside its wording. Not
     * `buildPlacement`, whose sentences are about a whole range where these
     * neighbours are two books on one plank. See `placementOnAPlank`.
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
       * a trip rather than an error: there is no row of spines to put a gap in
       * yet, so the screen draws the sentence instead.
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
   * Every book carries its photo, because the drawing is also the way through to
   * a book. The files never change once written, their names carrying a
   * timestamp, so a row costs its bytes once and a conditional request
   * afterwards. See `COVER_CACHE`.
   */
  async function stripFor(
    range: 'fiction' | 'nonfiction',
    sortKey: string,
    excludeId?: number,
    /** The run's planks, read once by the caller and passed down. */
    known?: RunPlanks,
  ) {
    const planks = known ?? await shelves.planks(range)
    // A book that is already on the shelf where it belongs is drawn in the row,
    // not as a hole in it. Only when its filing has actually changed does it
    // become something that has to move, and then it wants a gap again.
    const settled = excludeId ? await settledRow(range, sortKey, excludeId, planks) : null
    if (settled) return settled

    const strip = await shelves.strip(range, sortKey, excludeId)
    if (!strip) return null

    return {
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
   * Every book carries its photo here, unlike the placing strip above: this row
   * is the area drawn as it looks, and each spine is a way through to that book.
   *
   * "In the right place" means two things agree, not one. The sort key only says
   * the save landed; a save never touches `location`, so a book whose author or
   * series just moved it in the sequence is still recorded on the old area. That
   * is what `reviewShelving` calls a misfile, and this has to reach the same
   * verdict, or one book would read settled here and unsettled in the Library.
   * It compares by area rather than by label for the same reason, and it keeps
   * `reviewShelving`'s carve-outs: a book nobody has placed, and a run with no
   * area to put it on, are not disagreements to draw a gap over.
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
      label: planks.at(strip.at).label,
      gapIndex: -1,
      placedIndex: strip.index,
      books: strip.books.map((placed) => stripBook(placed.book, true)),
      /*
       * Offered only here, where the book is genuinely where the catalogue says
       * it is. A hypothetical strip built for an unsaved edit carries no boundary
       * to move, because the book has not earned that position yet; the detail
       * view reads this to decide whether to show the button at all, and the
       * write route re-checks it regardless.
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
   * Declared here rather than beside the crop helpers below because the capture
   * queue is built next and takes it: a `const` referenced before its declaration
   * is a temporal dead zone error, not a hoisted function.
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
    // Where a capture's derived pictures are read and written. A crop that
    // finished after its capture was discarded goes to the same orphan sweep the
    // discard itself uses; `deleteOrphanedImages` is a function declaration below
    // and so is hoisted into scope here.
    { ...cropIo, orphaned: deleteOrphanedImages },
    // So the queue can name a duplicate the same way `GET /api/lookup/isbn/:isbn`
    // does below, and so `GET /api/captures/:id` can ask the catalogue about a
    // capture's ISBN whether or not anything looked it up.
    (isbn) => store.findByIsbn(isbn),
  )

  /**
   * Remove photo files that nothing points at any more.
   *
   * Call this only AFTER the owning row is gone, so it does not count itself.
   * The reference check is not optional: a capture hands its filenames to the
   * book it becomes, so deleting a capture's photos without checking would take
   * the book's photos with them.
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

  /*
   * The gate, and the doors in front of it.
   *
   * The order of these calls is the design and is the whole of the open set.
   * What `mountSignIn` registers is above the gate and is open; everything
   * registered after `mountGate` is under `/api` and is behind it, including the
   * thumbnail route, the static mount over the photographs and the `/api`
   * catch-all. Nothing has to remember to be gated, and
   * `server/gate.routes.test.ts` walks the router stack and fails if anything
   * else is above the mount.
   *
   * The client's own files are not under `/api` and are therefore open, which is
   * the login screen: see the mounts at the bottom of this file.
   *
   * `mountCachePolicy` is not a door. It says, once, on everything under `/api`,
   * what an answer may be done with after it has left, and it is above both so
   * the refusals and the open doors carry it too. See `API_CACHE`.
   */
  const signInConfig = options.signIn ?? { providers: [], publicOrigin: '' }
  const signInDeps = {
    store: new AuthStore(db),
    config: signInConfig,
    now: options.now,
  }
  mountCachePolicy(app)
  mountSignIn(app, signInDeps)
  mountGate(app, signInDeps)

  /**
   * How long a photograph may be held, and by whom. One string, both doors, and
   * the one answer that overrides `API_CACHE`.
   *
   * `private` because `public` authorises an intermediary to store the response,
   * and a caching proxy in front of this origin would then be entitled to hand
   * somebody's photographs to a request carrying no session.
   *
   * Five minutes rather than thirty immutable days, because one `Cache-Control`
   * governs both the bytes and the reader's right to see them, and the
   * permission is the shorter of the two: a cover that is never re-requested has
   * no next request on which a disabled reader is noticed. `must-revalidate`
   * because a stale entry is one whose reader may no longer be a reader. No
   * `Vary`, because `Vary: Cookie` would make every re-sign-in throw away every
   * cached cover, since `admit()` mints a fresh session token.
   *
   * Both doors set it on the way out: `res.set` on the thumbnail route, and
   * `setHeaders` on the static mount, which `send` emits before writing a
   * `Cache-Control` of its own.
   */
  const COVER_CACHE = 'private, max-age=300, must-revalidate'

  /**
   * Ask for a picture smaller than the one on disk. Everything stored here is
   * full size, which is right for a screen showing one book and wrong for the
   * library's gallery, a grid of a hundred of them at about 120 CSS pixels each.
   *
   * A closed set of widths, because the width is in a URL and a URL is a request
   * anybody can make: an open one would let a caller ask the server to re-encode
   * the whole catalogue at a hundred sizes it will never show.
   *
   * Nothing is written, and a miss falls through to the static mount below,
   * which is what turns it into the same 404 as the full size file.
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
    let source: Stats
    try {
      source = statSync(file)
    } catch {
      // Missing, or something this process cannot read. Either way the static
      // mount below is what answers, and it is what turns this into a 404.
      return next()
    }
    if (!source.isFile()) return next()

    /*
     * The validator is taken from the file on disk and the width asked for, never
     * from the resized body: `res.send` computes its weak ETag only after the
     * resize has run, so a conditional request would cost a full re-encode and
     * save only the bytes. From the file it is one `stat`.
     *
     * The width is in the tag because the same photograph at 160 and at 640 are
     * different bytes, and a cache holding both must not validate one against the
     * other.
     */
    res.set('Cache-Control', COVER_CACHE)
      .set('Last-Modified', source.mtime.toUTCString())
      .set('ETag', `W/"${source.size.toString(16)}-${Math.floor(source.mtimeMs).toString(16)}-w${width}"`)
    if (req.fresh) {
      res.status(304).end()
      return
    }

    void sharp(file)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer()
      .then((body) => {
        res.type('jpeg').send(body)
      })
      // Not an image, or an image sharp cannot read. The full size file is still
      // there and still servable, so send that rather than failing.
      .catch(() => {
        // The validator above names a width, and what answers now is the whole
        // file. `send` keeps an ETag it finds already set, so leaving these would
        // describe the response it is about to write as something else.
        res.removeHeader('ETag')
        res.removeHeader('Last-Modified')
        next()
      })
  })

  /*
   * Captured photos, the other cover door and the one that serves the originals.
   *
   * `setHeaders` rather than `express.static`'s own `maxAge` and `immutable`,
   * which can only render `public, max-age=N[, immutable]`. It runs before `send`
   * writes its own `Cache-Control`, and `send` only writes one when nothing has,
   * so this is the value that survives. The client mount at the bottom of this
   * file sets its header the same way.
   */
  app.use(
    '/api/covers',
    express.static(coverDir, {
      fallthrough: false,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', COVER_CACHE)
      },
    }),
  )

  /**
   * Accept three photos and return at once. Reading them happens in the
   * background, so the person holding the books can move straight to the next
   * one instead of waiting on OCR.
   */
  app.post('/api/captures', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    // The client knows which side it just photographed, so the slot is required
    // rather than inferred or defaulted. Falling back to 'back' would file a
    // cover photo as the barcode side, and the worker would then read it
    // expecting an ISBN and report an honest-looking failure.
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
     * Two background jobs, not one. The hash is what tells the next person this
     * book is already in the queue, and behind the reading it would wait on OCR,
     * a catalogue lookup and every capture already queued in front of this one.
     * Neither waits on the other, and the shutter waits on neither.
     */
    inTheBackground(
      queue.hashFrontOf(capture.id).then((outcome) => {
        // `refused` is a frame with no detail in it and `unreadable` is a file
        // that has gone missing. Either way this capture cannot be matched
        // against, which is the one thing nobody must fail to hear about.
        if (outcome === 'refused' || outcome === 'unreadable') {
          console.warn(
            `[queue] capture ${capture.id} ${slot}: front not hashed (${outcome}), ` +
            'so this book will not be recognised if somebody photographs it again',
          )
        }
      }),
      `hashing the front of capture ${capture.id}`,
    )
    // Not awaited: the shutter must not wait on OCR. Tracked because it is
    // still running when the request that started it is over, and a teardown
    // has to be able to wait for it.
    inTheBackground(queue.drain(), `reading the photographs of capture ${capture.id}`)

    res.status(201).json({ capture, counts: await queue.counts() })
  }))

  /**
   * One capture: whether it is a second photographing of a book already in the
   * queue, and whether the catalogue already holds its ISBN.
   *
   * Answered here rather than on the way in, where there is no ISBN and no hash
   * yet. This is the route the camera already polls for the reading, so the
   * answer arrives with it and the shutter waits for nothing.
   *
   * `duplicates` is about the queue and `catalogued` is about the shelves, and
   * neither of them is the lookup.
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
      // The row's own ISBN, where a person's correction is mirrored as well as
      // where a barcode reading lands, so this is the number on the screen
      // whether a catalogue confirmed it or nobody did.
      catalogued: await queue.cataloguedAs(capture.isbn13, capture.id),
      counts: await queue.counts(),
    })
  }))

  /**
   * The whole queue, and the two things about it that are not rows.
   *
   * `reading` is which capture the worker has in its hands, or null. It is not a
   * column and it is not stored: it is true for the seconds one reading takes.
   *
   * A read that finds pending work wakes the sweep, because nothing in this
   * process knows about a capture another process wrote. Fired and not awaited,
   * and only where background work is on at all.
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
   * PATCH rather than PUT: the body is the fields somebody stated, not a whole
   * capture, and everything is optional including all of it.
   *
   * Holding the claim is required, and `queue.edit` renews the lease as a side
   * effect of a successful edit. `release` travels with the edit rather than in a
   * request of its own, and is the only way a capture is released: an edit needs
   * the claim so it has to go first, a page that is going away cannot be relied
   * on to send a second request, and two fired at once race.
   */
  app.patch('/api/captures/:id', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const who = String(body.who ?? '').trim() || 'unknown'
    const id = idIn(req.params.id, res, 'No such capture.')
    if (id === null) return

    const lettingGo = body.release === true

    const result = await queue.edit(id, who, asCaptureEdit(body))

    /*
     * Unconditional, and deliberately outside the success branch below. A
     * capture that has just become a book rejects the edit, and holding on to
     * the claim because of that would leave the next person told the book is
     * being worked on by somebody who has gone. Releasing what you do not hold
     * is already a no-op.
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
   * Read a capture's photographs again.
   *
   * A POST rather than a PATCH of the capture, because this states nothing about
   * the book, and it deliberately does not go through `PATCH /api/captures/:id`:
   * that route is a person's statements about a book, and the precedence rule
   * rests on nothing else writing there.
   */
  app.post('/api/captures/:id/read', asyncRoute(async (req, res) => {
    const id = idIn(req.params.id, res, 'No such capture.')
    if (id === null) return

    const capture = await queue.readAgain(id)
    if (!capture) {
      // Told apart: a capture that has left the queue is a book somebody has
      // already dealt with, and "no such capture" would send them looking for
      // one.
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
   * Discard a scan. The row is not deleted: `discarded` is one of the states in
   * `docs/data-model.md`, so the book stops being in the queue, cannot reach a
   * shelf, and is still there to be counted.
   *
   * The photographs are deleted, because that is what somebody discarding a scan
   * is asking for. The filenames stay on the row as the record of what was thrown
   * away, and `Store.imageInUse` does not count a discarded book's filenames as a
   * claim on a file, which is what lets this sweep find them.
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
     * The crops go with the photographs, through the same orphan check rather
     * than a second mechanism, which is what stops a discard taking a
     * photograph a shelved book still names.
     *
     * Every photograph this scan produced, not the current one of each kind: a
     * slot re-shot while somebody was working the queue is two files on disk and
     * two rows, and both were taken of the thing being thrown away.
     */
    const images = await filesOf(db, id)
    await queue.discard(id)
    const removed = await deleteOrphanedImages(images)

    res.json({ ok: true, counts: await queue.counts(), photosRemoved: removed.length })
  }))

  /**
   * Read an ISBN out of one photo and answer straight away.
   *
   * Deliberately synchronous, which the capture path is not: somebody is sat in
   * front of a dialog waiting for the number, and handing them a job id to poll
   * would be a worse version of waiting. Nothing is stored.
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
   * One photo can decode as several EAN-13s and more than one can survive both
   * its own check digit and the Bookland test: Mary Barton's back cover reads as
   * 9781240286898 and 9781840226898, and only the second is a book. So the
   * question goes to the source the dialog is about to consult anyway, and the
   * reading that resolves to a real title wins. Only runs on genuine ambiguity.
   */
  async function settleAmbiguity(
    result: { isbn13: string; isbn10: string; barcodes: string[] },
  ): Promise<{ isbn13: string; isbn10: string }> {
    const readings = [...new Set(
      result.barcodes.map((code) => resolveIsbnPair(code).isbn13).filter(Boolean),
    )]
    if (readings.length < 2) return result

    // All at once, then chosen in reading order. `supplement: false` because the
    // only thing read off these answers is `found`: most of them are a barcode
    // misread and belong to no book at all, and topping up a page count here
    // would be several requests to two national catalogues per wrong guess.
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
    // `asyncRoute`'s handler type is `express.Request`, not the route-literal
    // type `app.get` would otherwise infer, so `:isbn` is a plain indexed lookup
    // under noUncheckedIndexedAccess. Express only calls this handler when the
    // segment matched, so it is always a string.
    const isbnParam = req.params.isbn ?? ''
    const raw = normaliseIsbn(isbnParam)
    const pair = resolveIsbnPair(raw)

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

  /**
   * Where would this book go, without saving it? Drives the live placement card
   * as the user edits the review fields.
   *
   * `goingTo` names the plank a walk is taking the book to: without it the
   * answer is where the book belongs, with it the answer is about one plank a
   * person is standing in front of and the rules are not consulted about which
   * plank that is. See `atThePlankItIsGoingTo`.
   */
  app.post('/api/placement/preview', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const draft = asDraft(body)
    if (!draft.title) {
      res.status(400).json({ error: 'A title is required to work out placement.' })
      return
    }
    /*
     * The plank a caller says the book is going onto, refused when this
     * collection has no such area rather than ignored: falling back to "where
     * does it belong" is the answer this exists to stop.
     *
     * `plankLabels` rather than the run's own planks, so a plank somebody has
     * taken out of a bookcase still counts, which is half of every trip a run
     * move creates.
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
     * on. Nothing is written here, so what the person is shown is the answer to
     * what they have typed. The two differ only for a book carrying a person's
     * genre tag that no save put there, and that book's save follows the tag.
     */
    const { range } = genreStatedBy(draft)
    /*
     * Nothing states a genre, so there is no run to find a gap in. Refused on
     * the same terms as a missing title above, because it is the same kind of
     * missing: a placement is a position in one of two ordered lists, and this
     * draft is in neither.
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
   * The read the arrange screen draws itself from. A run that cannot be moved
   * answers 200 with the reason: it is an ordinary arrangement rather than a
   * fault, since two rules on one genre are legal, and a 400 would put the same
   * sentence in an error banner at the same late moment.
   */
  app.get('/api/placement/run', asyncRoute(async (req, res) => {
    const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    res.json(await runMoveOffer(db, range))
  }))

  /**
   * What moving a run would cost in books carried, and then the move. Two routes
   * and one idea, the same pair as `/api/shelves/overflow/plan` and the route
   * beside it: the first writes nothing.
   *
   * What it does not do is renumber the bookcase the run came off: a label is
   * derived from a fixture's position, so renumbering would carry every book's
   * recorded location with it and nobody would have anything to carry.
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
   * Changing what a place allows: the plan, and then the write. Two routes rather
   * than one with a flag, and the first writes nothing, so a person is shown what
   * their change does to every book before any of it exists as a row.
   */
  /**
   * The rules on one place, as the screen that changes them needs them.
   *
   * The one read that speaks slugs. Everything else answers a rule in the labels
   * a person reads; writing needs the identity, because a label matched back
   * against the vocabulary would start asking for a different tag the day two of
   * them read alike.
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
   * The tag filter cannot express this: "no rule claims it" is a question about
   * the rules rather than about a slug.
   *
   * `total` beside a capped page, the pair `listing` answers with, because the
   * worst case is a room whose rules have all been switched off.
   *
   * It writes nothing, and it must not learn to. What settles one of these books
   * is a person saying what it is.
   */
  app.get('/api/placement/unclaimed', asyncRoute(async (_req, res) => {
    const found = await booksNoRuleClaims(db)
    res.json({ books: found.slice(0, PAGE_LIMIT), total: found.length })
  }))

  /**
   * Every book the shelf and the rules put in different places.
   *
   * `areaDisagreements` places every shelved book twice, once the way the app
   * draws it and once the way the rules claim it. This route is the reading half:
   * before it, the only place either answer appeared was the server log.
   *
   * It reports and it must never repair. That is `area-drift.ts`'s own rule, and
   * it is what keeps a broken shelf stable enough to diagnose. There is
   * deliberately no `POST` beside this.
   */
  app.get('/api/placement/drift', asyncRoute(async (_req, res) => {
    const found = await areaDisagreements(db)
    res.json({ books: found.slice(0, PAGE_LIMIT), total: found.length })
  }))

  app.post('/api/books', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const draft = asDraft(body)
    if (!draft.title) {
      res.status(400).json({ error: 'A title is required.' })
      return
    }

    const captureId = Number(body.captureId ?? 0)

    /*
     * A book saved out of the queue is a row that already exists: it was created
     * by the first photograph, so what happens here is an update that moves it to
     * `shelved` rather than an insert. See `docs/data-model.md`.
     *
     * It carries the photographs across explicitly, because the draft is what
     * `store` writes from and the client does not re-upload them. For a still
     * queued book that restates what it already has; for a capture that has left
     * the queue, saved as a new book, it is what hands the new one the filenames
     * the old was photographed with.
     */
    const capture = captureId ? await queue.get(captureId) : undefined
    const queued = capture && capture.status !== 'done' ? capture : undefined
    if (capture) {
      draft.frontImage = capture.front_image
      draft.backImage = capture.back_image
      draft.edgeImage = capture.edge_image
    }

    // Photos arrive as data URLs and are written beside the database rather
    // than into it. Anything uploaded here wins over the capture's copy.
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
     * derived from the tags rather than from a column of its own. A queued book
     * already exists and may already carry a genre somebody applied, so its tags
     * are restated and read back and that answer is what the row is written
     * with.
     */
    let id: number
    /**
     * Where the book goes, or null when nothing files it. A save that states no
     * genre writes no genre tag, so no rule claims the book and it joins neither
     * run. The row is written all the same, with everything anybody said about
     * it.
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
     * Record where the book physically went. The person is standing at the shelf
     * having just answered "it fits" about this exact plank, and that is the only
     * observation anybody will make about this book unless it moves.
     *
     * A location sent by the client wins, since that came from a person too. A
     * book nothing files has no derived plank to fall back on, so nothing is
     * recorded and the ledger keeps saying nobody has put it anywhere.
     *
     * The plank, not what the plank is called: reading a label back into the area
     * it came from breaks the moment somebody names a bookcase.
     */
    if (!draft.location?.trim() && placement) {
      const landed = await shelves.areaOf(placement.range, id)
      if (landed !== null) await store.setLocationIn(id, landed)
    }

    // Deliberately not awaited: the person is waiting to be told where the book
    // goes. There is no fourth step recording the photographs again, because each
    // of these three writes a photograph down itself through
    // `server/photographs.ts`, and carrying on after a failure is safe since
    // `record` is idempotent and the next pass catches up.
    inTheBackground(
      fetchCoverFor(id)
        .then(() => hashBook(id))
        .then(() => cropBookPhotos(id)),
      `filling in the cover, hashes and crops of book ${id}`,
    )

    res.status(201).json({
      id,
      // The freshly computed placement, not whatever the client previewed: with
      // two people scanning, a neighbour can appear between preview and save and
      // the stale one would send the book to the wrong gap.
      //
      // Null when no genre tag claims the book, which is a saved book with
      // nowhere the rules can put it rather than a save that failed.
      placement: placement && await inDerivedScheme(
        placement.range,
        { ...placement, ...(await store.resolveKey(draft)) },
      ),
      counts: await store.counts(),
      queue: await queue.counts(),
    })
  }))

  /**
   * The listing, and the questions the library and the find screen ask of it.
   *
   * An absent `range` has meant fiction since this route existed, so `range=all`
   * is spelled explicitly; it is the whole collection, fiction then non-fiction.
   * `tag=` may be given more than once and all of them must hold, and a tag
   * matches itself and anything under it. An absent `limit` is the largest page
   * rather than every book: see `PAGE_LIMIT`.
   *
   * `counts` is the whole catalogue rather than this query.
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

    /*
     * Which state, refused rather than ignored when it is not one. A narrowing
     * nobody can spell is worse than no narrowing, because it answers the whole
     * catalogue, which is exactly what this field exists to fix.
     * `CATALOGUED_STATES` and not `BOOK_STATES`, because the other four are not
     * in the relation being read.
     */
    const wanted = String(req.query.state ?? '')
    if (wanted && !(CATALOGUED_STATES as readonly string[]).includes(wanted)) {
      res.status(400).json({
        error: `"${wanted}" is not a state a catalogued book is in.`,
      })
      return
    }

    const limit = Number(req.query.limit)
    const offset = Number(req.query.offset)

    const found = await store.listing({
      range,
      words: String(req.query.q ?? ''),
      isbn: String(req.query.isbn ?? ''),
      tags,
      state: (wanted || undefined) as BookState | undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      offset: Number.isFinite(offset) && offset > 0 ? offset : undefined,
    })

    res.json({ books: found.books, total: found.total, counts: await store.counts() })
  }))

  /**
   * The shelves screen, which is somebody standing at a bookcase holding a
   * phone.
   *
   * Three reads whatever the collection looks like. Asking about one absent book
   * at a time laid the whole run out per book, so the screen got slower the more
   * books were off the shelf; `Shelves.shelvesForSortKeys` says why asking about
   * a hundred keys at once gives each the answer asking about it alone gave.
   */
  app.get('/api/shelves', asyncRoute(async (req, res) => {
    const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'

    const drawn = await shelves.shelving(range)
    /*
     * Books off the shelf, each with the shelf it would land on. They hold no
     * position, so they are absent from the groups above and the numbering there
     * counts only what is physically there. Display only: it lets the library
     * show a gap where a book belongs instead of making an absent book
     * invisible.
     */
    const off = (await store.checkedOut()).filter((book) => book.shelf_range === range)
    /*
     * The plank, and then its name. The screen puts an absent book in the gap it
     * belongs in by matching it to a board, so the area is what it matches on
     * and the label is what it reads; matching two renderings of one plank is
     * the comparison that hid 181 books. `shelvesForSortKeys` renders the
     * ordinal walk and is the answer only where the run has no plank to name.
     */
    const areas = await shelves.areasForSortKeys(range, off.map((book) => book.sort_key))
    const walked = await shelves.shelvesForSortKeys(range, off.map((book) => book.sort_key))

    res.json({
      groups: drawn.groups,
      separators: drawn.separators,
      loads: drawn.loads,
      /*
       * Where this range opens, or null when no rule says. On the wire because
       * an empty `groups` has two causes the screen cannot tell apart from
       * here: a range with nothing catalogued in it, and a range nothing says
       * the whereabouts of.
       */
      begins: drawn.begins,
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
   * `carry` means the book in their hand is the one that moves and nothing
   * already shelved is touched. `step` means a book has to come off the end to
   * open a gap in the middle. Whether the shelf either lands on can cope is not
   * knowable here, so the client asks and calls again if not.
   *
   * `sortKey` is the book being placed, optional because this route is also
   * walked for a book that is already shelved and has no gap of its own.
   */
  /**
   * The same question asked without answering it. Strictly read only: a proposal
   * is not an observation, so nothing moves until somebody says it has, and the
   * strip is that proposal drawn.
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
     * confirms its outermost frame last, so the shelves can have moved under a
     * proposal since it was drawn, and applying it to whatever book happens to
     * be on the end now would be a stale answer.
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
       * The book being placed, moved on rather than put down here. No id of its
       * own, because it has none yet: where it lands is recorded when it is
       * saved, on the plank `toAreaId` names.
       */
      carry: result.carry ? named(result.planks!) : null,
      /*
       * The one book to move, named by id as well as by title. The id is what
       * lets the client record where that book ended up; without it a shuffle
       * left every displaced book recorded on the shelf it came off. `toAreaId`
       * beside `to` is the same idea: the label is what the person reads on the
       * way to the shelf, and on a bookcase somebody has named the two are not
       * the same string.
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
   * First or last is not a guard bolted onto a general move: it is the complete
   * set of moves that leave every neighbour in the sequence where it was.
   *
   * Nothing here writes a location. The furniture moves; a person then says the
   * book is on the new plank through `PATCH /api/books/:id/location`.
   *
   * `theAreaGoes` is somebody having been asked: moving the only book off a plank
   * takes the area with it, and a request that has not said it knows that is
   * refused.
   */
  app.post('/api/shelves/move', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const range = body.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const direction = body.direction === 'previous' ? 'previous' : 'next'
    const id = Number(body.id ?? 0)
    const theAreaGoes = body.theAreaGoes === true

    // Read before the move: afterwards the book may have left this layout, and
    // the title is what the person is told to carry.
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
      // Named the same way the overflow step is, so the client records where the
      // book landed through exactly the same call.
      move: result.move ? { id, title, ...named(result.planks!) } : null,
      moves: await describeMoves(range, result.moves ?? []),
      groups: await shelfGroups(range),
    })
  }))

  /**
   * Take back a move nobody acted on.
   *
   * Nothing here writes a location, and that is what separates it from every
   * other button near it: the book never moved, so the catalogue has nothing new
   * to record about where it is. What gets undone is the furniture.
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
   * Refused until they have been told what it does: removing a boundary takes an
   * area off the furniture and hands its books to the area in front. The refusal
   * is the act's, not this route's; what belongs here is the sentence and the
   * rows a dialog puts in front of somebody, which is the same shape `PATCH
   * /api/areas/:id` refuses a strategy change with.
   */
  app.delete('/api/shelves/:id', asyncRoute(async (req, res) => {
    // Before the layout below, so a request that names nothing costs no read.
    const separatorId = idIn(req.params.id, res, 'No such boundary.')
    if (separatorId === null) return

    const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const before = await shelves.layout(range)
    const removal = await removeSeparator.handle({
      separatorId,
      theAreaGoes: req.query.theAreaGoes === 'true',
    })

    if (!removal.ok) {
      /*
       * The act would not do it at all, which is not the same answer as "nobody
       * has been asked" and must not be dressed up as one. Its sentence already
       * names the area and says what to do instead, so it is passed on whole
       * rather than rebuilt from a cost this route would have to read again.
       */
      if (removal.reason === 'refused') {
        refused(res, refuse(removal.status, removal.error))
        return
      }

      // The boundary's own range rather than the one asked for, so the labels
      // are of the run the area actually stands in.
      const going = await shelves.removalCost(removal.range, separatorId)
      /*
       * Two sentences for the two costs. An area comes off the furniture either
       * way; what differs is whether anything was standing on it, and a sentence
       * about books joining another area when there are none would be the app
       * describing something that is not going to happen.
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
   * alias rather than a column on the book.
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
   * Where a book has been.
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
     * The one place a book stops being the book it was. Changing the ISBN is the
     * person telling the app this row is a different book, so what was on record
     * about the old one is withdrawn here, before the new record is written over
     * the top of it. `ReidentifyBookHandler` carries the reasoning.
     *
     * It runs before the genre is settled, and that ordering is load bearing:
     * the old book's genre tag has to be off the row before the new one is read
     * back, or a corrected book would file under what it used to be.
     */
    if (namesADifferentBook(before, draft)) await reidentifyBook.handle({ bookId: id })

    const placement = await store.updateBook(id, draft, await settleGenre(id, draft))
    await recordCredits(id, draft)
    res.json({
      id,
      // Null when no genre tag claims the book. See `POST /api/books`.
      placement: placement && await inDerivedScheme(placement.range, placement),
      counts: await store.counts(),
    })
  }))

  /*
   * A slug is a path, so it arrives in the query string rather than in the URL:
   * `genre/fantasy` in a path segment is two segments, and the alternative is
   * asking every caller to encode a slash into a route the router then decodes
   * back.
   */

  /** The slug a request means, or a 400 saying what was wrong with it. */
  function slugFrom(raw: unknown, res: express.Response): TagSlug | null {
    const slug = TagSlug.parse(String(raw ?? ''))
    if (!slug) res.status(400).json({ error: `"${String(raw ?? '')}" is not a tag.` })
    return slug
  }

  /**
   * The vocabulary, or the part of it under one slug. `?under=genre` is the
   * prefix question, answered as an index range over the slug rather than by
   * filtering here.
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
     * How many books each one has, counting the ones under it. It rolls up,
     * because choosing Fantasy shows the books tagged Urban fantasy too, and a
     * number that disagreed with the list one tap later would be the screen
     * contradicting itself.
     *
     * Counted by `Store` rather than through the tagging port, which is about
     * the vocabulary and not a place to ask which books match something.
     */
    const counts = new Map((await store.tagCounts()).map((one) => [one.slug, one.books]))
    /*
     * Which of these a placement rule asks for. A word nothing carries and
     * nothing points at is litter; a word nothing carries that a rule asks for is
     * somebody setting up a bookcase before they own anything in it, and nothing
     * else in the table separates the two. It is the truth about every tag rather
     * than only the empty ones, because a flag that meant something different
     * depending on the count beside it is a flag two readers will read two ways.
     */
    const ruled = await tagsRulesName(db)
    res.json({
      tags: vocabulary.map((one) => ({
        slug: one.slug.value,
        label: one.label,
        note: one.note,
        books: counts.get(one.slug.value) ?? 0,
        ruled: ruled.has(one.slug.value),
      })),
    })
  }))

  /**
   * Somebody makes a word, with no book in their hand.
   *
   * The body is the shape the book route takes, read by the same `slugFrom`, so
   * every door normalises a typed word identically.
   *
   * `define` is idempotent, so naming a word that already exists answers the row
   * that is there and the label already on it wins. That is what stops a rule
   * quietly beginning to match something new: a rule names a slug as a string,
   * and making that tag for real has to produce the row the string already meant.
   */
  app.post('/api/tags', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const typed = String(body.slug ?? body.label ?? '')
    const slug = slugFrom(typed, res)
    if (!slug) return

    const made = await defineTag.handle({
      slug,
      label: String(body.label ?? typed).trim() || slug.value,
    })

    /*
     * Answered with the count on it, which is nought, and whether a rule asks
     * for it. This is the one door whose whole result is a word nothing is
     * standing under, so a 201 with no body would leave the person who just made
     * one with nothing but the screen's own optimism.
     */
    res.status(201).json({
      tag: {
        slug: made.slug.value,
        label: made.label,
        note: made.note,
        books: 0,
        ruled: (await tagsRulesName(db)).has(made.slug.value),
      },
    })
  }))

  /**
   * Somebody unmakes a word, and the two answers that are not "gone".
   *
   * Deliberately narrower than the door it undoes: only a word nothing carries
   * and no rule asks for. `book_tag` cascades from `tag`, so an unguarded delete
   * would take somebody's tag off every book they had put it on rather than
   * failing. A rule asking for it means somebody laid it out on purpose, and
   * nothing here retracts one of those.
   */
  app.delete('/api/tags', asyncRoute(async (req, res) => {
    const slug = slugFrom(req.query.slug, res)
    if (!slug) return

    const answer = await forgetTag.handle({ slug })
    if (answer.kind === 'gone') {
      res.json({ removed: slug.value })
      return
    }
    if (answer.kind === 'unknown') {
      res.status(404).json({ error: 'No such tag.' })
      return
    }

    /*
     * 409 and not 400: nothing is wrong with the request, and the same one will
     * work once the last book comes off the tag or the rule stops asking. The
     * words say which of the two it is.
     */
    res.status(409).json({
      error: answer.kind === 'ruled'
        ? 'A rule asks for this tag, so it is kept even with no books on it.'
        : 'Books are under this tag. Take them out of it first.',
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
   * A book no rule claims is a real answer and not an error: nothing has to
   * state a genre, so no tag gets written and no rule matches. The list comes
   * back empty and the screen says so.
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
   * A person puts a book under a tag. The slug is normalised from what they
   * typed and the label is what they typed, so "Lent Out" reads back as "Lent
   * Out" and files as `mine/lent-out` along with everybody else's spelling.
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
   * A tag a person applied is untouched, because the only rows this can delete
   * are the ones carrying `source = 'catalogue'`. See `RestateTagsHandler`.
   *
   * A lookup that finds nothing is not an empty claim: the catalogue being down
   * or the ISBN being unknown says nothing about the book, so it is reported as
   * `found: false` and nothing is written.
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
   * a type that carried one would invite somebody to match on it.
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
   * Nothing in the author routes below decides where a book files.
   * `books.author_filing` and `books.sort_key` are still what the shelving code
   * reads.
   */

  /*
   * No route here accepts or returns a stored label, because there is no such
   * thing: a label is worked out from a fixture's number and name and an area's
   * ordinal and name at the moment it is read. What every write answers with
   * instead is `becomes`, which is every label that reads differently once the
   * change lands. See `server/furniture.ts`.
   */

  app.get('/api/fixtures', asyncRoute(async (_req, res) => {
    res.json(await describeFurniture(db))
  }))

  /**
   * What the whole collection falls back on.
   *
   * No `GET` beside it: `GET /api/fixtures` already answers
   * `defaultSortStrategy`, and a second read of one column would be a second
   * answer to keep agreeing with the first. No id in the path, because there is
   * one collection.
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
   * run of books at a different piece is `POST /api/placement/run`.
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
   * Take a piece of furniture away. Refused while books are standing on it, and
   * it says how many: they move to other furniture first, which is a real carry
   * and has a plan in front of it.
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
   * Asking area by area would be one request per plank and a screen putting
   * them back in order.
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
   * With no `startsAt` the server works out where it opens, which is what makes
   * the fixtures screen's button add an area rather than open a screen asking
   * which book the new one starts at. See `anchorForNewArea`.
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
   * until the body carries `acknowledge`.
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
   * Answered by identity rather than by label: labels are derived at read time
   * precisely so nothing depends on their stability, and the owner already has
   * two pieces of furniture both standing at 4.
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
   * What removing this area would do to its books. Writes nothing: which area
   * takes the books in, how many join it, how many are left alone because
   * somebody pinned them, and every label that reads differently afterwards.
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
   * in.
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

  async function describeCredits(bookId: number) {
    return (await authors.creditsOf(bookId)).map((alias, at) => ({
      position: at + 1,
      aliasId: alias.id,
      authorId: alias.authorId,
      displayName: alias.name.value,
      filingName: alias.filing,
    }))
  }

  app.get('/api/authors', asyncRoute(async (_req, res) => {
    res.json({ authors: (await authors.everyone()).map(describeAuthor) })
  }))

  /**
   * Everything by this person. Asked of the author rather than of one name, so
   * Banks and Banks M come back together while each still files where it is
   * printed.
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
   * Two authors turn out to be one person. It moves names between authors and
   * nothing else, so no book changes places: the books still credit the same
   * aliases, and the aliases still file under the same names.
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
   * A person says this name files under something else. The printed name is not
   * changeable and is not accepted here: a book credits it, and rewriting it
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
   * The photographs of one book, as rows. Read only: photographs are written by
   * the paths that already take them, through `recordPhotographs`, because a
   * photograph arrives as part of saving a book and never on its own.
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
         * The three states, named. `declined` says a detector looked at this
         * photograph and could not find the book in it, which is a different
         * fact from `unexamined`.
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
   * The only way a recorded location ever changes. Misfile detection reports and
   * never corrects: a book stays recorded where it was last seen until somebody
   * has walked to the shelf and moved it, because a guess written into the ledger
   * is worse than an empty one.
   *
   * A label naming a plank the collection does not have is refused, because there
   * is nowhere in the ledger for `9Z` to go. An empty label is refused too: the
   * ledger is append only and none of its kinds says never-placed.
   *
   * It also takes an `areaId`, and that is the form a screen should send: a label
   * is derived from where a piece stands and what it is called, so a list drawn a
   * minute ago can name a plank by a name nobody uses any more.
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
     * is no longer waiting. Leaving the receipt would leave "take it back" on
     * offer for a move that has been answered, and taking it back then would
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
    // derived, but nothing else will ever name them once this row and its
    // photographs are gone.
    const images = await filesOf(db, id)
    await store.deleteBook(id)
    const removed = await deleteOrphanedImages(images)

    res.json({ ok: true, counts: await store.counts(), photosRemoved: removed.length })
  }))

  /**
   * Take a book off the shelf, or put it back.
   *
   * The shelf closes up behind it here exactly as it does in the room, so a book
   * that will not physically fit where the layout says can be pulled out.
   * Nothing is deleted: the entry, its photos and its filing all survive, and
   * putting it back is the same flow as shelving it the first time.
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
      // catalogue carries, and this also runs as a backfill over every book at
      // once, which is the shape of request a free national catalogue publishes
      // a rate limit about.
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
   * Work through books that have no cover yet, a batch at a time. Batched
   * because it is someone else's API and there is no hurry.
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
   * Server side, after the save, and not awaited. Cropping before upload would
   * mean the only copy that reached the disk was the cropped one: the photograph
   * has to land first, whole, and then be cropped from.
   *
   * Failure is reported and then dropped, because a crop that failed in silence
   * is indistinguishable from a photograph the detector declined.
   */
  async function cropBookPhotos(id: number): Promise<void> {
    const book = await store.getBook(id)
    if (!book) return
    try {
      await cropPhotos(store, book, cropIo, { apply: true })
    } catch (reason) {
      // Left uncropped, which is a state the views already draw, and said out
      // loud so that "uncropped" never stands in for "nobody tried".
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
   * A shortlist, never an answer: it puts a wrong book first and inside the
   * cutoff on roughly one query in ten, which is why the caller confirms.
   */
  async function looksLike(query: string | null, limit = 4) {
    // A frame with nothing in it, or bytes that are not an image at all. Either
    // way there is nothing to compare, and the caller falls through to reading
    // the page.
    if (!query) return []

    const scored = (await store.hashIndex()).map((row) => ({
      row,
      // Whichever of the two stored images is the better likeness. A photo of a
      // book usually resembles another photo of it more than it resembles the
      // publisher's clean artwork, but not always.
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
        // The photo taken of this actual copy, in preference to the catalogue's.
        // An ISBN often has several cover designs against it, and showing one the
        // person has never seen makes them doubt a correct match.
        ...ownPhoto(row),
        checkedOut: row.checked_out,
        distance: d,
      }))
  }

  /**
   * The hash of the photograph being asked about, or nothing. Taken once and
   * handed to both comparisons, so the books path and the queue path are asking
   * with the same string.
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
   * up, nearest first.
   *
   * A different answer from `looksLike` and held to a much tighter bar: these
   * are photographs compared against photographs taken in the same room, which
   * share a background the hash can see, so two different books land as close as
   * 16 bits apart. `QUEUE_LIMIT` says why in full.
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
   * Captures already waiting that carry this exact ISBN, in the shape the cover
   * comparison answers in.
   *
   * `distance` is null rather than 0. Zero is a measurement and there is none
   * here, because nothing was compared: a caller printing "looks the same,
   * 100%" off a fabricated zero would be dressing an identifier up as a
   * likeness.
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
   * queue, and which captures say so.
   *
   * An ISBN is stronger evidence than a hash, not weaker: an ISBN-13 either
   * satisfies its check digit or is thrown away. So the identifier is asked first
   * and answers alone when it answers at all, and the hash is what is left when
   * nothing could be read.
   *
   * The cover comparison is held to `QUEUE_LIMIT` and must not reuse
   * `MATCH_CUTOFF`: on the owner's own photographs that cutoff calls nearly one
   * pair of different books in five a match, because a shared table and carpet
   * pull two books together rather than apart.
   *
   * Nothing here writes and nothing here stops a capture existing: two copies of
   * one book genuinely turn up.
   */
  async function duplicatesOf(capture: CaptureRow, limit = 3) {
    const byIsbn = await queuedWithIsbn(capture.isbn13, limit, capture.id)
    if (byIsbn.length) return byIsbn

    // Only if the front has been hashed. A capture with no hash has not been
    // through the background pass yet, or carried no detail worth hashing;
    // either way there is nothing to compare.
    if (!capture.front_hash) return []

    return alreadyInQueue(capture.front_hash, limit, capture.id)
  }

  /**
   * Work through missing covers quietly in the background.
   *
   * Slow on purpose: it is someone else's API and nobody is waiting on the
   * result. It converges, because `cover_checked_at` means that once every book
   * has been asked about this finds nothing and stops until new books arrive.
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
   * Hold a book up to the camera and find out which book it is, in one round trip
   * because the person is stood there holding the book.
   *
   * This route answers a question. It never writes, in any branch, for any input:
   * the scanner is one entry point rather than a check-out camera and a check-in
   * camera, so nothing here could know which of the two the person meant. A
   * checkout happens in one place only, `POST /api/books/:id/checkout`, which
   * takes an id and a direction and no photograph.
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
     * Someone is stood at a shelf holding a book, so the order of the fallbacks
     * is the order of their cost. Reading a barcode takes about a fifth of a
     * second when it works; hashing the cover to shortlist books takes about
     * fifty milliseconds; a full OCR pass takes five to ten seconds and, for a
     * book being held front-out, almost always returns nothing. So OCR is last,
     * and only runs when the cover is not recognised either.
     */
    const read = await identify(buffer, {
      wantTitle: false,
      ocrEnabled: false,
      // zxing only, and only as a first look: a front held up to the camera has
      // no barcode at all, and the thorough ladder spends seconds proving it.
      // What the fast pass may not do is settle the question, so when it reads
      // nothing the branch below gives the barcode its thorough look before any
      // shortlist that is not certain of itself answers.
      barcodeEffort: 'fast',
    })

    if (!read.isbn13) {
      const query = await queryHash(buffer)
      const candidates = await looksLike(query)

      /*
       * A barcode is evidence. A cover hash is a guess: an ISBN-13 carries a
       * check digit, so a decoded one either validates or is discarded, while a
       * hash distance puts the wrong book first about one lookup in ten.
       *
       * So only one shortlist may answer before the barcode has had its second
       * look: a single candidate in the `close` band, which is the same bar the
       * scanner already opens a book on without asking.
       */
      if (confidentPick(candidates)) {
        res.json({ outcome: 'candidates', barcodes: read.barcodes, candidates })
        return
      }

      /*
       * Then: is this book already sitting in the queue, scanned by somebody else
       * and not shelved yet?
       *
       * A different question rather than a section of the shortlist above: a
       * capture has no catalogue id and may have no title, and folding it in would
       * present two very different cutoffs, 24 and 8, as one scale of likeness.
       *
       * After the books and only when no book was close, because a catalogued row
       * is a settled fact and a capture is work in progress. Before the thorough
       * barcode read, because this costs a hash comparison per queued capture
       * against seconds of zbar and OCR.
       */
      const waiting = hasCloseMatch(candidates) ? [] : await alreadyInQueue(query)
      if (waiting.length) {
        res.json({ outcome: 'in-queue', matches: waiting })
        return
      }

      /*
       * Now look properly. `thorough` is the default effort, so this adds the
       * zbar ladder underneath zxing: on a phone-sized photo it turns a 0.14s
       * look into a 1.5s one when there is no barcode to find, and it reads
       * small, distant and low-contrast barcodes the fast pass misses.
       *
       * OCR only when there is no shortlist at all, because reading the printed
       * page costs five to ten seconds.
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
     * One photo can decode several barcodes, and not all of them are real. A
     * back cover carries the EAN-13 and often an EAN-5 price add-on, and zbar
     * will occasionally return a misread alongside the true one: Mary Barton
     * decodes as 9781240286898, 9781840226898 and 9181840826898, and only the
     * middle one is the book. All three pass their own check digit or are
     * discarded by the Bookland test, so arithmetic cannot separate them.
     *
     * The catalogue can. Here we are looking for a book that is already in the
     * library, so the reading that names one is the reading that is right,
     * whatever order zbar happened to return them in. `Promise.all` keeps them
     * in reading order, which is what the choice between them rests on.
     */
    const fromBarcodes = await Promise.all(
      read.barcodes
        .map((code) => resolveIsbnPair(code).isbn13)
        .filter(Boolean)
        .map((isbn) => store.findByIsbn(isbn)),
    )

    const book = fromBarcodes.find(Boolean) ?? await store.findByIsbn(read.isbn13)

    if (!book) {
      /*
       * No shelf has it, but the queue might.
       *
       * By ISBN, not by hash: the digits are already in hand and validated by
       * their own check digit, so there is nothing for a perceptual comparison
       * to add. Asked only after the catalogue has said no, because a shelved
       * book is a settled fact and a capture is work in progress.
       */
      const waiting = await queuedWithIsbn(read.isbn13)
      if (waiting.length) {
        res.json({ outcome: 'in-queue', matches: waiting })
        return
      }

      res.json({ outcome: 'not-catalogued', isbn13: read.isbn13 })
      return
    }

    // The identity is settled, and what to do about it is not this route's to
    // decide: the book is handed back exactly as it was found.
    res.json({ outcome: 'identified', book })
  }))

  /**
   * The books to physically move, for one range.
   *
   * Per range because fiction and non-fiction are independent ordered lists: a
   * fiction book on bookcase 1 and a non-fiction book on bookcase 4 can never be
   * out of order with respect to each other. Read only: a location changes only
   * when a person says the book moved, which is the PATCH below.
   */
  app.get('/api/misfiles', asyncRoute(async (req, res) => {
    const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const review = await shelves.review(range)
    const outstanding = await shelves.outstandingMoves(range)

    res.json({
      ...review,
      /*
       * Which of these the app put there, so the list can offer to take those back
       * and only those. A book pushed onto the next plank by a newcomer is a
       * misfile nobody can undo: there is no assignment to withdraw.
       *
       * Both planks have to still agree with the receipt. If they do not, the
       * shelves have moved on and taking the move back would not put the book
       * back, which `retractMove` would refuse anyway.
       *
       * Four area ids and not one address among them: an address is a statement
       * about position, which is exactly what a boundary move changes. A receipt
       * carrying no id for a plank never matches.
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
   * Read only, and there is no plan to go stale: this is recomputed every time
   * it is asked for, out of `assigned` disagreeing with `placed`. See
   * `server/carry.ts`.
   */
  app.get('/api/carry', asyncRoute(async (_req, res) => {
    res.json(await outstandingWork(db))
  }))

  /**
   * One trip, read at the area the books come off.
   *
   * The two areas are ids rather than labels: a label is derived from where a
   * piece stands, so somebody renaming a bookcase between the list and the trip
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
   * It moves no book and rewrites no placement. Every book stands where it
   * stood, books already carried keep the home they were carried to, and pinned
   * books cannot be reached from here at all. A body naming a trip narrows it to
   * that trip; an empty body is the whole of the outstanding work.
   */
  app.post('/api/carry/leave', asyncRoute(async (req, res) => {
    const trip = tripIn(req.body, res)
    if (trip === undefined) return

    const left = await leaveWhereTheyAre(db, trip, new Date().toISOString())
    res.json({ books: left.books, work: await outstandingWork(db) })
  }))

  /**
   * Ask for that work again, which is the way back out of the sentence above.
   * It writes the assignment again, by a person rather than by a rule, and the
   * books are back on the list where they came off it.
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
   * `ok` stays `true` when a catalogue is quiet, on purpose: somebody can still
   * catalogue a book. `googleBooksKeyConfigured` is a boolean and must stay one,
   * and nothing here may grow a length, a prefix or a masked form of the key.
   *
   * Two conditions make `ok` false, and the rule is narrow on purpose:
   * `books.current_area_id` disagreeing with `book_placement`, and a book whose
   * ledger folds to a plank the furniture no longer has. Both mean this server
   * wrote something it cannot account for, which is the only bad news here a
   * person cannot fix by walking to a shelf. A drifted shelf and a book no rule
   * claims leave `ok` true, because a person resolves those by carrying books.
   *
   * There is no repair here and there will not be one: a projection rebuilt on
   * sight erases the evidence of which writer is missing, and neither side of the
   * stranded check is derived from the other. See
   * `infrastructure/placement/projection.ts` and
   * `infrastructure/placement/stranded.ts`.
   */
  app.get('/api/health', asyncRoute(async (_req, res) => {
    const disagreeing = await countProjectionDisagreements(db)
    const stranded = await countStrandedBooks(db)

    res.json({
      ok: disagreeing === 0 && stranded === 0,
      counts: await store.counts(),
      db: options.dbLabel ?? '',
      lookups: {
        googleBooksKeyConfigured: googleApiKey.length > 0,
        sources: sourceStandings(),
      },
      placement: {
        projection: {
          disagreeing,
          // Bounded and newest first: a list of every book is not a report.
          books: disagreeing === 0 ? [] : await projectionDisagreements(db),
          // Empty when there is nothing to repair, so the answer never suggests
          // running a write against a catalogue that does not need one.
          repair: disagreeing === 0 ? '' : REBUILD_COMMAND,
        },
        stranded: {
          books: stranded,
          // Bounded and newest first, as above. There is no `repair` key beside
          // this one, and its absence is the answer rather than an omission.
          where: stranded === 0 ? [] : await strandedBooks(db),
        },
      },
    })
  }))

  /**
   * Whether there is a backup of this collection anybody has proved restores.
   *
   * Files on a disk, and no connection to anything: it reads the names in the
   * backup directory and the manifests beside the newest few, and asks the
   * catalogue nothing. See `server/backup-watch.ts`. Answers `unwatched` when no
   * directory was given, which is every development checkout and every test, and
   * claims nothing in that state.
   */
  app.get('/api/backup', asyncRoute(async (_req, res) => {
    res.json(await watchBackups(options.backupDir ?? ''))
  }))

  /*
   * Anything under /api that no route above matched.
   *
   * Without this, Express's own finaliser answers with an HTML page, and every
   * request the client makes parses the body as JSON to find the `error` field,
   * so a mistyped route surfaced as a JSON parse failure.
   *
   * Registered last of all the API routes, and before both the client mount and
   * the error handler, which is the only place it can go: earlier it would
   * swallow whatever came after it, later and the single-page fallback below
   * would answer a mistyped `/api` path with the app shell. Scoped to `/api`,
   * because everything else belongs to Vite in development and to the client's
   * own routing in a deployment.
   */
  app.use('/api', (_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not found.' })
  })

  /*
   * The built client, on this origin.
   *
   * Registered after the `/api` catch-all above and before the error handler, and
   * the order is the design: a single-page fallback answers any path it is asked
   * for, so mounting it earlier would hand `index.html` to a mistyped `/api/...`
   * request.
   *
   * Two mounts, because the two halves of a Vite build want opposite cache
   * policies. Everything under `assets/` carries a content hash in its filename
   * and can be cached for a year; `index.html` names those hashes and is the one
   * file that must not be cached.
   */
  if (options.clientDir) {
    const clientDir = resolve(options.clientDir)
    const indexHtml = join(clientDir, 'index.html')
    if (!existsSync(indexHtml)) {
      // At construction rather than per request. A process told to serve a
      // client it does not have should say so while somebody is still watching
      // it start.
      throw new Error(`No built client at ${clientDir}: run \`npm run build\` in web/.`)
    }

    app.use(express.static(clientDir, {
      index: false,
      setHeaders: (res, path) => {
        res.setHeader(
          'Cache-Control',
          path.startsWith(join(clientDir, 'assets') + sep)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        )
      },
    }))

    /*
     * Everything left is the client's own routing. `/library/anything` is a
     * screen, not a file, and the browser asks this server for it on a reload or
     * a shared link; without this a refresh anywhere but `/` is a 404.
     *
     * GET and HEAD only. A POST to a path nothing answers is a mistake, and
     * handing it an HTML page instead of a 404 hides it.
     */
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next()
      // The header goes through sendFile's own options rather than res.set:
      // `send` writes its own Cache-Control as it streams, and applies these
      // afterwards, so anything set beforehand is overwritten.
      res.sendFile(indexHtml, { headers: { 'Cache-Control': 'no-cache' } }, (error) => {
        if (error) next(error)
      })
    })
  }

  // Express identifies error-handling middleware solely by arity: a function of
  // exactly four parameters. Dropping the unused `next` here would silently
  // demote this to ordinary middleware, which Express would then never call.
  //
  // The message stays generic. This is a phone-facing API, and whatever
  // `asyncRoute` forwarded here is not something a stranger holding the app
  // should see.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // The `/api/covers` static mount runs with `fallthrough: false`, so a
    // missing file arrives here as an error carrying `status: 404` (Express
    // itself sets `statusCode` too, depending on where the error came from).
    // That is not a server fault: a book catalogued before a cover slot existed
    // has no image for it. A genuine fault, with no status on the error at all,
    // still answers 500 with the generic message below.
    const carried = err as { status?: unknown; statusCode?: unknown } | null
    const status = carried?.status ?? carried?.statusCode
    const httpStatus = typeof status === 'number' && status >= 400 && status < 600 ? status : 500

    if (httpStatus === 404) {
      // Routine rather than exceptional, so it does not earn a stack trace or
      // the absolute path ENOENT carries. A count is still useful if misses
      // ever spike.
      console.warn('[api] not found:', _req.path)
      res.status(404).json({ error: 'Not found.' })
      return
    }

    /*
     * A reading that was given up on, answered as itself. 504 rather than 500,
     * because nothing here is broken in a way a retry cannot fix, and the
     * message says what happened: a person told the reader gave up will hold
     * the book up again. Handled here rather than at each route so a route
     * added later cannot forget it.
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
    // tesseract.js fetches about 15 MB of language data the first time a worker
    // exists on a machine, so unwarmed that download lands on the first person
    // to photograph a book with no readable barcode after every restart. Both
    // warms report how long they took.
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

// Production wiring: the only caller of createApp that binds a port, opens the
// real data directory and starts the background work.
//
// Guarded so importing createApp never runs any of it. Without the guard,
// `import { createApp } from './index'` would open a real file database under
// web/data, bind a real port and start the background work, none of which a
// test may do. This is the standard ESM "am I the entry module" check: true
// when node or tsx was started directly on this file, false when something
// else imported it.

const isMainModule = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

/**
 * The catalogue the server opens.
 *
 * The connection is `catalogueConnection()` and nothing else: the test harness
 * deliberately ignores that variable and every other ambient connection
 * variable (server/testdb.ts), for the same reason as `BOOKSCAN_DATA`. No
 * connection at all exits naming the variable, because a process that comes up
 * on an empty database is not obviously anything.
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
   * The second catalogue's key, through the one accessor that reads it.
   * `server/secrets.ts` says where it comes from and why. Empty is a supported
   * state, said out loud below rather than passed over.
   */
  const GOOGLE_API_KEY = googleBooksApiKey()

  /*
   * Where this server looks for evidence that the catalogue has been backed up.
   * Read only, and never created: if the directory is not there, that is the
   * answer rather than something to fix by making one.
   *
   * Unset means nothing is watched, and an empty value means the same
   * deliberately, so a deployment can switch it off by setting it rather than by
   * hoping nothing in the shell has set it. `server/backup-catalogue.ts` writes
   * into the directory this same variable names.
   */
  const BACKUP_DIR = process.env.BOOKSCAN_BACKUP_DIR ?? ''

  /*
   * The built client, if there is one beside this process.
   *
   * Not an environment variable, on purpose: where the client is has one right
   * answer, and every variable this process reads is another thing an inherited
   * value can decide. This expression names `web/dist` from either of the two
   * files that can be the entry point, both one directory below `web/`, which is
   * a constraint on where the build may put the server bundle.
   *
   * Absent is the ordinary development state, where the Vite dev server serves
   * the client and proxies `/api` here.
   */
  const CLIENT_DIR = fileURLToPath(new URL('../dist/', import.meta.url))
  const CLIENT_BUILT = existsSync(join(CLIENT_DIR, 'index.html'))

  /*
   * The ways in, read once, here, and refused rather than guessed at.
   *
   * `signInFrom` throws for the configurations that would otherwise produce a
   * server nobody can sign into, or one whose development door is open on a
   * deployment. It is evaluated before `bootstrap` so the process exits at start
   * with the variable named rather than on the first person's first sign-in.
   *
   * Unset is a supported state: nobody can obtain a session, so every route under
   * `/api` answers 401.
   */
  const SIGN_IN = signInFrom(process.env)

  /*
   * Which interface to listen on, read here for the same reason `SIGN_IN` is:
   * `bindFrom` refuses a value it does not recognise, and it is evaluated
   * before `bootstrap` so a deployment that spelled it wrong exits at start
   * with the variable named rather than listening somewhere nobody chose.
   *
   * Unset is loopback. `server/bind.ts` is the argument for the default and for
   * why the variable takes two words rather than an address.
   */
  const BIND = bindFrom(process.env)

  mkdirSync(COVER_DIR, { recursive: true })

  const bootstrap = async () => {
    const { db, label } = await openCatalogue()

    const app = createApp({
      db,
      coverDir: COVER_DIR,
      googleApiKey: GOOGLE_API_KEY,
      dbLabel: label,
      backupDir: BACKUP_DIR,
      clientDir: CLIENT_BUILT ? CLIENT_DIR : undefined,
      signIn: SIGN_IN,
    })

    const server = app.listen(PORT, BIND.address, () => {
      console.log(`[api] listening on http://${BIND.address}:${PORT}`)
      for (const line of describeBind(BIND)) console.log(line)
      console.log(`[api] database ${label}`)
      console.log(
        BACKUP_DIR
          ? `[api] watching ${BACKUP_DIR} for backups of this catalogue`
          : '[api] no backup directory watched; set BOOKSCAN_BACKUP_DIR to watch one',
      )
      console.log(
        CLIENT_BUILT
          ? `[api] serving the built client from ${CLIENT_DIR}`
          : '[api] no built client here; run `npm run build` in web/ to serve one. '
            + 'In development the Vite dev server serves it and proxies /api here.',
      )
      for (const line of describeSignIn(SIGN_IN)) console.log(line)
      // Whether there is a key, never the key. See server/secrets.ts.
      console.log(
        googleBooksKeyConfigured()
          ? '[api] Google Books: a key is configured'
          : '[api] Google Books: no key configured. Requests go out anonymously, the shared ' +
            'anonymous quota is exhausted, and the second catalogue will answer nothing. ' +
            'See scripts/write-connection-file.ps1 and AGENTS.md.',
      )
    })

    /*
     * Stopping when asked.
     *
     * A default-disposition signal sent to PID 1 is discarded by the kernel, so
     * installing a handler is what makes the signal deliverable at all: without
     * one, `docker stop` waits ten seconds and then sends SIGKILL.
     *
     * The order matters. Stop the listener, so nothing new arrives while requests
     * in flight finish. Close idle keep-alive connections, because a phone sitting
     * on a shelf holds one open and the close would wait for it. Close the pool,
     * which is what actually lets the process exit, since idle Postgres clients
     * hold the event loop open on their own.
     *
     * The timer is unref'd so it cannot itself keep the process up.
     */
    let stopping = false
    const stop = (signal: NodeJS.Signals) => {
      if (stopping) {
        console.log(`[api] ${signal} again; exiting now`)
        process.exit(1)
      }
      stopping = true
      console.log(`[api] ${signal}: closing the listener, then the catalogue`)

      const giveUp = setTimeout(() => {
        console.log('[api] still busy after 10s; exiting anyway')
        process.exit(1)
      }, 10_000)
      giveUp.unref()

      server.close(() => {
        db.close()
          .catch((error) => console.error('[api] the catalogue did not close cleanly', error))
          .finally(() => {
            console.log('[api] stopped')
            process.exit(0)
          })
      })
      server.closeIdleConnections()
    }

    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
  }

  bootstrap().catch((error) => {
    // A database that will not open is not something to limp on: every route
    // needs it, and a process that exits says so where a stack trace on the
    // first request would not.
    console.error('[api] could not open the catalogue', error)
    process.exitCode = 1
  })
}

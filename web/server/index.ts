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
import { identify } from './identify'
import { warmPaddle } from './paddle'
import { downloadCover, openLibraryCover, upgradeGoogleCover } from './covers'
import { coverHash, distance } from './imagehash'
import { cropPhotos } from './crop'
import { CaptureQueue, type CaptureEdit, type CaptureRow } from './queue'
import { rangeLock, Shelves, type ShelvedBook } from './shelves'
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
import { claimsFrom, genreClaim } from '../domain/tagging/catalogue-claims'
import { TagSlug, type TagConfidence } from '../domain/tagging/tags'
import { RecordPhotographsHandler } from '../application/capture/record-photographs'
import { DrizzleCaptureRepository } from '../infrastructure/capture/capture-repository'
import { shownFile, verdictOf } from '../domain/capture/photographs'
import { photographsOf } from './photographs'
import { Store, type DraftBook } from './store'
import { confidentPick, hasCloseMatch, queueMatches } from '../shared/confidence'
import { normaliseIsbn, resolveIsbnPair } from '../shared/isbn'
import {
  bookCover, buildPlacement, compareLocations, formatLocation, parseLocation, shelfImage,
  type ShelfSlot,
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
    isFiction: Boolean(body.isFiction),
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

/** The classifier's confidence, back from a string, defaulting to unknown. */
function asConfidence(raw: string | undefined): TagConfidence {
  return raw === 'high' || raw === 'medium' || raw === 'weak' ? raw : 'unknown'
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
  if (body.isFiction !== undefined) edit.isFiction = Boolean(body.isFiction)
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
   * Never rejects: the work owns its own failures exactly as it did before it
   * was tracked, and this reports quiet rather than success.
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

  const store = new Store(db)

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
   * passing tests. A `catch` here would only mean the work still ran late and
   * said nothing about it, so the work is tracked instead and `settled` is how
   * a teardown waits for it.
   */
  const outstanding = new Set<Promise<unknown>>()

  function inTheBackground(work: Promise<unknown>): void {
    outstanding.add(work)
    void work.then(
      () => outstanding.delete(work),
      (reason: unknown) => {
        outstanding.delete(work)
        /*
         * Rethrown into a promise nobody holds, which is exactly what `void`
         * did with it before this was tracked. **Tracking work must not become
         * handling it.** A rejection swallowed here would mean a save's cover
         * or crop failing in silence, and in a test it would mean the work
         * still running after the database went away with nothing saying so,
         * which is the thing being fixed rather than a way of hiding it.
         */
        throw reason
      },
    )
  }

  // `allSettled`, because waiting for the work is not the same as owning how it
  // failed: the line above still reports that. A loop, because the chain being
  // waited on adds to the set as it goes.
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
   * Keep the tags in step with what was just saved about a book.
   *
   * `books.is_fiction` is still the column the shelf range is derived from, and
   * still what the client reads, so every save writes both: the column, by
   * `Store`, and the tag, here. They cannot disagree, because this runs from the
   * same draft the row was written from.
   *
   * The source is the provenance the draft already carries. `manual` is what
   * `Store.updateBook` records when somebody saved an edit, and that is a
   * person; anything else is the classifier, and that is a guess. Restating
   * rather than applying is what makes an edit from fiction to non-fiction take
   * the old tag off, and it takes off only the tags of the source doing the
   * restating, so a person's tag is not disturbed by a lookup and a guess is not
   * left behind by a person.
   */
  async function recordGenreTag(bookId: number, draft: DraftBook): Promise<void> {
    const decidedByPerson = draft.classificationSource === 'manual'
    const now = new Date().toISOString()

    await restateTags.handle({
      bookId,
      source: decidedByPerson ? 'person' : 'guess',
      claims: [genreClaim(
        draft.isFiction,
        decidedByPerson ? 'high' : asConfidence(draft.classificationConfidence),
      )],
      now,
    })

    // A person having answered, the guess is withdrawn: it was this app's
    // inference about the same question, and leaving it behind would show a book
    // as both fiction and non-fiction with no way to tell which is current. That
    // is the guess taking back its own claim, which is the only thing it is
    // allowed to do, and it is why the person's row is written first.
    //
    // The other way round is not this function's to do and never will be. A
    // saved guess leaves a person's answer exactly where it is; the only thing
    // that takes one off is the book turning out to be a different book, which
    // `PUT /api/books/:id` settles before this runs (#194).
    if (decidedByPerson) {
      await restateTags.handle({ bookId, source: 'guess', claims: [], now })
    }
  }

  /*
   * The composition root for the third converted slice, authors (#180).
   */
  const authors = new DrizzleAuthorRepository(db)
  const creditBook = new CreditBookHandler(authors)
  const fileAlias = new FileAliasHandler(authors)
  const mergeAuthors = new MergeAuthorsHandler(authors)

  /**
   * Keep the credits in step with what was just saved about a book.
   *
   * The same arrangement `recordGenreTag` has and for the same reason: `Store`
   * still writes `books.authors`, `books.author_filing` and `book_authors`, all
   * of which decide where the book files and what the client reads, and #180
   * drops none of them. So every save writes both, from the same draft, and they
   * cannot disagree.
   *
   * The filing override travels with it, because it is about the first-listed
   * name and that is what the alias files under. `introduce` ignores it for a
   * name somebody has already filed, which is the point: re-saving a book must
   * not undo a correction.
   */
  async function recordCredits(bookId: number, draft: DraftBook): Promise<void> {
    await creditBook.handle({
      bookId,
      authors: draft.authors,
      filingOverride: draft.authorFilingOverride,
    })
  }

  /*
   * The composition root for the fourth converted slice, captures (#181).
   *
   * Same shape as the three above and for the same reason: the route below and
   * `recordPhotographs` call handlers, the handler depends on the one interface
   * in `application/capture/ports.ts`, and this is the only place in the server
   * that names a Drizzle repository.
   */
  const captures = new DrizzleCaptureRepository(db)
  const recordPhotographsHandler = new RecordPhotographsHandler(captures)

  /**
   * Keep the capture rows in step with what was just saved about a book.
   *
   * The eight image columns on `books` are still what `Store`, the crop
   * backfill, the gallery, the queue panel and the shelf row read, so every
   * save writes both: the columns, by `Store`, and the rows, here. They cannot
   * disagree, because this reads the row that was just written rather than the
   * draft it was written from. That is the same arrangement #179 left behind for
   * `books.is_fiction` and the tag tables, and it goes away with the columns.
   *
   * Called again after the cover fetch, the hash and the crop, because each of
   * those writes a column this reads. Repeating it costs a statement per
   * photograph and cannot lose anything: every field `record` writes moves in
   * one direction only. See `CaptureRepository.record`.
   *
   * A photograph whose file has changed since the last call is a **new
   * photograph and gets a new row**, which is the whole point of the table: a
   * blurred spine re-shot after today keeps the blurred one.
   */
  async function recordPhotographs(bookId: number): Promise<void> {
    const book = await store.getBook(bookId)
    if (!book) return
    await recordPhotographsHandler.handle({ bookId, photographs: photographsOf(book) })
  }

  function saveImage(buffer: Buffer, isbn: string, slot: Slot): string {
    const name = `${Date.now()}_${isbn || 'noisbn'}_${slot}.jpg`
    writeFileSync(join(coverDir, name), buffer)
    return name
  }

  /**
   * Moves are a to-do list a person works through, so they name books rather
   * than row ids, and each group reports whether it is over its capacity.
   */
  async function describeMoves(range: 'fiction' | 'nonfiction', moves: { id: number; from: string; to: string }[]) {
    const titles = new Map((await shelves.layout(range)).map((p) => [p.book.id, p.book.title]))
    return moves.map((move) => ({ ...move, title: titles.get(move.id) ?? '' }))
  }

  /**
   * Restate a placement in the derived scheme.
   *
   * store.placementFor still answers in the old per-book scheme, where a
   * location is a string somebody typed and the range starts at "1A". Those
   * shelves no longer exist. Everything the user reads has to come from the
   * layout, or the card tells them to put a book on a shelf the app cannot
   * find, which is what "1A" was.
   */
  async function inDerivedScheme<T extends Awaited<ReturnType<typeof store.placementFor>>>(
    range: 'fiction' | 'nonfiction',
    placement: T,
    /** The book being edited, which must not appear as its own neighbour. */
    excludeId?: number,
  ) {
    const layout = await shelves.layout(range)
    const labelOf = (id: number | undefined) =>
      id === undefined ? '' : layout.find((p) => p.book.id === id)?.label ?? ''

    const predecessor = placement.predecessor
      ? { ...placement.predecessor, location: labelOf(placement.predecessor.id) }
      : null
    const successor = placement.successor
      ? { ...placement.successor, location: labelOf(placement.successor.id) }
      : null

    const derivedLocation = await shelves.shelfForSortKey(range, placement.sortKey)

    // Rebuilt rather than patched: the instruction has the old labels baked
    // into its wording.
    const restated = buildPlacement(range, predecessor, successor, derivedLocation)

    return {
      ...placement,
      ...restated,
      suggestedLocation: derivedLocation,
      derivedLocation,
      strip: await stripFor(range, placement.sortKey, excludeId),
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
  ) {
    // A book that is already on the shelf where it belongs is drawn in the
    // row, not as a hole in it. Only when its filing has actually changed
    // does it become something that has to move, and then it wants a gap
    // again.
    const settled = excludeId ? await settledRow(range, sortKey, excludeId) : null
    if (settled) return settled

    const strip = await shelves.strip(range, sortKey, excludeId)
    if (!strip) return null

    return {
      label: strip.label,
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
   * location nobody has ever recorded, or one that does not parse, is not a
   * disagreement to draw a gap over, so those still settle here exactly as
   * they did before this book had a recorded location at all.
   */
  async function settledRow(range: 'fiction' | 'nonfiction', sortKey: string, id: number) {
    const row = await store.getBook(id)
    if (!row || row.shelf_range !== range || row.sort_key !== sortKey) return null

    const strip = await shelves.stripOf(range, id)
    if (!strip) return null

    const recorded = (row.location ?? '').trim()
    if (recorded) {
      const at = parseLocation(recorded)
      const belongs = parseLocation(strip.label)
      if (at && belongs && compareLocations(recorded, strip.label) !== 0) return null
    }

    return {
      label: strip.label,
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
      boundary: await shelves.boundaryOptions(range, id),
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
    // So a capture gets its crops and its front hash on the same background
    // pass that reads its photographs, with nobody waiting on either. A crop
    // that finished after its capture was discarded goes to the same orphan
    // sweep the discard itself uses; `deleteOrphanedImages` is a function
    // declaration below and so is hoisted into scope here.
    { ...cropIo, orphaned: deleteOrphanedImages },
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
    // Not awaited: the shutter must not wait on OCR. Tracked for the same
    // reason the chain after a save is: it is still running when the request
    // that started it is over, and a teardown has to be able to wait for it.
    inTheBackground(queue.drain())

    res.status(201).json({ capture, counts: await queue.counts() })
  }))

  /**
   * One capture, and whether it is a second photographing of a book already in
   * the queue (#146).
   *
   * Answered here rather than on the way in, and that is the whole shape of
   * the fix. `POST /api/captures` returns the moment the photograph exists,
   * before anything has read it: there is no ISBN yet and no hash yet, so a
   * check made there would have nothing to check. The reading happens on the
   * background pass and this route is what the camera already polls for it, so
   * the answer arrives with the reading, on the request the camera was making
   * anyway, and the shutter waits for nothing.
   */
  app.get('/api/captures/:id', asyncRoute(async (req, res) => {
    const capture = await queue.get(Number(req.params.id))
    if (!capture) {
      res.status(404).json({ error: 'No such capture.' })
      return
    }
    res.json({
      capture,
      duplicates: await duplicatesOf(capture),
      counts: await queue.counts(),
    })
  }))

  app.get('/api/captures', asyncRoute(async (_req, res) => {
    res.json({ captures: await queue.list(), counts: await queue.counts() })
  }))

  app.post('/api/captures/:id/claim', asyncRoute(async (req, res) => {
    const who = String((req.body ?? {}).who ?? '').trim() || 'unknown'
    const result = await queue.claim(Number(req.params.id), who)
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
    const id = Number(req.params.id)
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
    const id = Number(req.params.id)
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
    const images = [
      capture.front_image, capture.back_image, capture.edge_image,
      capture.front_crop, capture.back_crop, capture.edge_crop,
    ]
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
    const checked = await Promise.all(
      readings.map(async (isbn) => ({
        isbn,
        real: (await lookupIsbn(isbn, { googleApiKey })
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
   */
  app.post('/api/placement/preview', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const draft = asDraft(body)
    if (!draft.title) {
      res.status(400).json({ error: 'A title is required to work out placement.' })
      return
    }
    // When editing a saved book, it must not turn up as its own neighbour.
    const excludeId = Number(body.excludeId ?? 0) || undefined
    const placement = await store.placementFor(draft, excludeId)
    res.json(await inDerivedScheme(placement.range, placement, excludeId))
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
     * what `store` writes from and the client does not re-upload them. The
     * columns already hold these values; sending them again costs nothing and
     * means the two paths through this route write the same fields.
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

    if (body.saveFilingOverride && draft.authorFilingOverride) {
      const primary = draft.authors[0] ?? ''
      if (primary) await store.saveFilingOverride(primary, draft.authorFilingOverride)
    }

    const { id, placement } = queued
      ? { id: queued.id, placement: await store.updateBook(queued.id, draft) }
      : await store.addBook(draft)
    await recordGenreTag(id, draft)
    await recordCredits(id, draft)
    await recordPhotographs(id)

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
     */
    if (!draft.location?.trim()) {
      const landed = await shelves.labelFor(placement.range, id)
      if (landed) await store.setLocation(id, landed)
    }

    // Deliberately not awaited. The person is waiting to be told where the
    // book goes, and a cover that arrives a second later costs them
    // nothing. The cover, the hash and the crops each write a column
    // `recordPhotographs` reads, so it runs once more at the end of the chain.
    // Not instead of the awaited call above: the rows exist from the save, and
    // this fills in only what arrives afterwards.
    //
    // Handed to `inTheBackground` rather than voided, so that a teardown can
    // wait for it. Nothing about when it runs changes.
    inTheBackground(
      fetchCoverFor(id).then(() => hashBook(id)).then(() => cropBookPhotos(id))
        // Caught here and nowhere else this is called. On the awaited path a
        // failure to record is a failure to save and should be seen; out here
        // nothing is waiting to be told, and a rejection nobody catches takes
        // the process down. The columns are still the record while the client
        // reads them, and `record` is idempotent, so the next save catches up.
        .then(() => recordPhotographs(id).catch(() => undefined)),
    )

    res.status(201).json({
      id,
      // The freshly computed placement, not whatever the client previewed.
      // With two people scanning, a neighbour can appear between preview
      // and save, and the stale one would send the book to the wrong gap.
      placement: await inDerivedScheme(
        placement.range,
        { ...placement, ...(await store.resolveKey(draft)) },
      ),
      counts: await store.counts(),
      queue: await queue.counts(),
    })
  }))

  app.get('/api/books', asyncRoute(async (req, res) => {
    const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    res.json({ books: await store.listRange(range), counts: await store.counts() })
  }))

  app.get('/api/shelves', asyncRoute(async (req, res) => {
    const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    res.json({
      groups: await shelfGroups(range),
      separators: await shelves.list(range),
      loads: await shelves.loads(range),
      /*
       * Books off the shelf, each with the shelf it would land on.
       *
       * They hold no position, so they are absent from the groups above and
       * the numbering there counts only what is physically there. This is
       * display only: it lets the library show a gap where a book belongs
       * instead of making an absent book invisible from the shelf it came
       * off.
       */
      checkedOut: await Promise.all(
        (await store.checkedOut())
          .filter((book) => book.shelf_range === range)
          .map(async (book) => ({
            book,
            label: await shelves.shelfForSortKey(range, book.sort_key),
          })),
      ),
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
    const label = String(body.label ?? '')
    const placing = String(body.sortKey ?? '')

    const result = await shelves.proposeOverflow(range, label, kind, placing)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }

    const moved = result.step
      ? (await shelves.layout(range)).find((p) => p.book.id === result.step!.moved.id)?.book
      : undefined

    res.json({
      carry: result.carry
        ? { from: result.carry.from, to: result.carry.to }
        : null,
      step: result.step
        ? {
            id: result.step.moved.id,
            from: result.step.from,
            to: result.step.to,
            title: moved?.title ?? '',
            /* Written down the spine hanging under the gap, the same as the
               book being catalogued. */
            authorFiling: moved?.author_filing ?? '',
          }
        : null,
      strip: result.strip
        ? {
            label: result.strip.label,
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
    const label = String(body.label ?? '')
    const placing = String(body.sortKey ?? '')
    /*
     * The book the person was told to move, when there was one. A cascade
     * confirms its outermost frame last (#110), so the shelves can have moved
     * under a proposal since it was drawn, and applying it to whatever book
     * happens to be on the end now is exactly the stale answer #106 fixed.
     */
    const expectId = Number(body.expectId ?? 0) || 0

    const result = await shelves.overflow(range, label, kind, placing, expectId)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }

    res.json({
      /*
       * The book being placed, moved on rather than put down here.
       *
       * No id, because it has none yet. Where it lands is recorded when it is
       * saved, from the shelf the layout now puts it on, which is this label.
       */
      carry: result.carry
        ? { from: result.carry.from, to: result.carry.to }
        : null,
      /*
       * The one book to move, named by id as well as by title.
       *
       * The id is what lets the client record where that book ended up once
       * the person says it is there. Without it a shuffle moved the boundary
       * and left every displaced book recorded on the shelf it came off, so
       * misfile detection reported a move the person had just been walked
       * through making.
       */
      step: result.step
        ? {
            id: result.step.moved.id,
            from: result.step.from,
            to: result.step.to,
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
   */
  app.post('/api/shelves/move', asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const range = body.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const direction = body.direction === 'previous' ? 'previous' : 'next'
    const id = Number(body.id ?? 0)

    // Read before the move, as it always was: afterwards the book may have
    // left this layout, and the title is what the person is told to carry.
    const title = (await shelves.layout(range)).find((p) => p.book.id === id)?.book.title ?? ''
    const result = await shelves.moveAcrossBoundary(range, id, direction)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }

    res.json({
      // Named the same way the overflow step is, so the client records where
      // the book landed through exactly the same call.
      move: result.move
        ? { id, title, from: result.move.from, to: result.move.to }
        : null,
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
      move: result.move ?? null,
      moves: await describeMoves(range, result.moves ?? []),
      groups: await shelfGroups(range),
    })
  }))

  app.delete('/api/shelves/:id', asyncRoute(async (req, res) => {
    const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
    const before = await shelves.layout(range)
    // The one route that goes through the application layer. It says what was
    // asked for and nothing about how it is stored, which is the whole of what
    // #172 is demonstrating; the reads either side of it still go through
    // `Shelves` because books have not been converted.
    await removeSeparator.handle({ separatorId: Number(req.params.id) })
    res.json({
      moves: await describeMoves(range, await shelves.movesSince(range, before)),
      groups: await shelfGroups(range),
    })
  }))

  app.get('/api/books/:id', asyncRoute(async (req, res) => {
    const book = await store.getBook(Number(req.params.id))
    if (!book) {
      res.status(404).json({ error: 'No such book.' })
      return
    }
    res.json({ book })
  }))

  app.put('/api/books/:id', asyncRoute(async (req, res) => {
    const id = Number(req.params.id)
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
     * than a rule inside `recordGenreTag` is that genre will not stay the only
     * thing a person can say about a book.
     */
    if (namesADifferentBook(before, draft)) await reidentifyBook.handle({ bookId: id })

    const placement = await store.updateBook(id, draft)
    await recordGenreTag(id, draft)
    await recordCredits(id, draft)
    await recordPhotographs(id)
    res.json({
      id,
      placement: await inDerivedScheme(placement.range, placement),
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
    res.json({
      tags: vocabulary.map((one) => ({ slug: one.slug.value, label: one.label, note: one.note })),
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

  /** What a book is under, and who said so. */
  app.get('/api/books/:id/tags', asyncRoute(async (req, res) => {
    const id = Number(req.params.id)
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
    const id = Number(req.params.id)
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
    const id = Number(req.params.id)
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
    const id = Number(req.params.id)
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
        isFiction: found.classification.isFiction,
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
    const found = await authors.find(Number(req.params.id))
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
    const aliasId = Number(req.params.id)
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
    const id = Number(req.params.id)
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
    const id = Number(req.params.id)
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
    const id = Number(req.params.id)
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
   * somebody has actually walked to the shelf and moved it, because that
   * column is the record of where the book really is and a guess written
   * into it is worse than an empty one.
   */
  app.patch('/api/books/:id/location', asyncRoute(async (req, res) => {
    const id = Number(req.params.id)
    if (!(await store.getBook(id))) {
      res.status(404).json({ error: 'No such book.' })
      return
    }

    const label = String((req.body ?? {}).location ?? '').trim()
    // An empty label is meaningful: it takes the book back to never-placed.
    if (label && !parseLocation(label)) {
      res.status(400).json({ error: `${label} is not a location, e.g. 1A or 4B.` })
      return
    }

    await store.setLocation(id, label ? formatLocation(parseLocation(label)!) : '')
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
    const id = Number(req.params.id)
    const book = await store.getBook(id)
    if (!book) {
      res.status(404).json({ error: 'No such book.' })
      return
    }

    const images = [
      book.front_image, book.back_image, book.edge_image, book.cover_image,
      // Derived, but still files on disk, and nothing else will ever name
      // them once this row is gone.
      book.front_crop, book.back_crop, book.edge_crop,
    ]
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
    const id = Number(req.params.id)
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
      const found = await lookupIsbn(isbn, { googleApiKey })
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
   * Failure is silent on purpose: a crop is derived data, a book with none is
   * a book shown whole, and nothing about the save it followed should be
   * disturbed by it.
   */
  async function cropBookPhotos(id: number): Promise<void> {
    const book = await store.getBook(id)
    if (!book) return
    try {
      await cropPhotos(store, book, cropIo, { apply: true })
    } catch {
      // Left uncropped, which is a state the views already draw.
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
        checkedOut: row.checked_out_at !== null,
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
       * Both labels have to still agree with the receipt. If they do not, the
       * shelves have moved on since the move and taking it back would not put
       * the book back, which `retractMove` would refuse anyway. Better not to
       * offer it than to offer it and refuse.
       */
      outstandingMoves: review.misfiles
        .filter((misfile) => outstanding.some((move) =>
          move.bookId === misfile.book.id
          && move.from === misfile.from
          && move.to === misfile.to))
        .map((misfile) => misfile.book.id),
    })
  }))

  app.get('/api/health', asyncRoute(async (_req, res) => {
    res.json({ ok: true, counts: await store.counts(), db: options.dbLabel ?? '' })
  }))

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

    console.error('[api] unhandled route error:', err)
    res.status(httpStatus).json({ error: 'Something went wrong.' })
  })

  if (startBackgroundWork) {
    queue.resumeOnStartup()

    // After the port is open, so a slow or unreachable cover service never
    // delays the server being usable.
    setTimeout(() => {
      void warmPaddle()
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
  const GOOGLE_API_KEY = process.env.GOOGLE_BOOKS_API_KEY ?? ''

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
    })

    app.listen(PORT, '127.0.0.1', () => {
      console.log(`[api] listening on http://127.0.0.1:${PORT}`)
      console.log(`[api] database ${label}`)
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

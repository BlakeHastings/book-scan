/**
 * API server. Plain HTTP on localhost only; the phone never talks to it
 * directly. Vite proxies /api to it over the loopback interface, which is what
 * keeps the HTTPS page free of mixed content.
 */

import express from 'express'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openDatabase } from './db'

import { lookupIsbn, searchTitle } from './lookup'
import { identify } from './identify'
import { downloadCover, openLibraryCover, upgradeGoogleCover } from './covers'
import { coverHash, distance } from './imagehash'
import { CaptureQueue } from './queue'
import { Shelves, type ShelvedBook } from './shelves'
import { Store, type DraftBook } from './store'
import { normaliseIsbn, resolveIsbnPair } from '../shared/isbn'
import { buildPlacement } from '../shared/shelving'

export type Slot = 'front' | 'back' | 'edge'

/** Strip a data URL down to the bytes. Returns null if it is not an image. */
function decodeDataUrl(value: string): Buffer | null {
  if (!value.startsWith('data:image/')) return null
  const comma = value.indexOf(',')
  if (comma < 0) return null
  return Buffer.from(value.slice(comma + 1), 'base64')
}

function saveImage(buffer: Buffer, isbn: string, slot: Slot): string {
  const name = `${Date.now()}_${isbn || 'noisbn'}_${slot}.jpg`
  writeFileSync(join(COVER_DIR, name), buffer)
  return name
}

const PORT = Number(process.env.PORT ?? 3001)
const DATA_DIR = resolve(process.env.BOOKSCAN_DATA ?? 'data')
const DB_PATH = join(DATA_DIR, 'books.db')
const COVER_DIR = join(DATA_DIR, 'covers')
const GOOGLE_API_KEY = process.env.GOOGLE_BOOKS_API_KEY ?? ''

mkdirSync(COVER_DIR, { recursive: true })

const db = openDatabase(DB_PATH)
const store = new Store(db)
const shelves = new Shelves(db)

/**
 * Moves are a to-do list a person works through, so they name books rather
 * than row ids, and each group reports whether it is over its capacity.
 */
function describeMoves(range: 'fiction' | 'nonfiction', moves: { id: number; from: string; to: string }[]) {
  const titles = new Map(shelves.layout(range).map((p) => [p.book.id, p.book.title]))
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
function inDerivedScheme<T extends ReturnType<typeof store.placementFor>>(
  range: 'fiction' | 'nonfiction',
  placement: T,
  /** The book being edited, which must not appear as its own neighbour. */
  excludeId?: number,
) {
  const layout = shelves.layout(range)
  const labelOf = (id: number | undefined) =>
    id === undefined ? '' : layout.find((p) => p.book.id === id)?.label ?? ''

  const predecessor = placement.predecessor
    ? { ...placement.predecessor, location: labelOf(placement.predecessor.id) }
    : null
  const successor = placement.successor
    ? { ...placement.successor, location: labelOf(placement.successor.id) }
    : null

  const derivedLocation = shelves.shelfForSortKey(range, placement.sortKey)

  // Rebuilt rather than patched: the instruction has the old labels baked
  // into its wording.
  const restated = buildPlacement(range, predecessor, successor, derivedLocation)

  return {
    ...placement,
    ...restated,
    suggestedLocation: derivedLocation,
    derivedLocation,
    strip: stripFor(range, placement.sortKey, excludeId),
  }
}

/**
 * The shelf drawn end on, for the placing view.
 *
 * Only the two books either side of the gap carry a photo. They are the ones
 * you actually look for on the shelf; sending thirty spine filenames so the
 * client can render thirty thumbnails it will not look at costs a request
 * each and tells you nothing extra.
 */
function stripFor(
  range: 'fiction' | 'nonfiction',
  sortKey: string,
  excludeId?: number,
) {
  // A book that is already on the shelf where it belongs is drawn in the row,
  // not as a hole in it. Only when its filing has actually changed does it
  // become something that has to move, and then it wants a gap again.
  const settled = excludeId ? settledRow(range, sortKey, excludeId) : null
  if (settled) return settled

  const strip = shelves.strip(range, sortKey, excludeId)
  if (!strip) return null

  return {
    label: strip.label,
    gapIndex: strip.gapIndex,
    placedIndex: null,
    books: strip.books.map((placed, i) =>
      stripBook(placed.book, i === strip.gapIndex - 1 || i === strip.gapIndex),
    ),
  }
}

/** The row as it stands, when this book is already in it and in the right place. */
function settledRow(range: 'fiction' | 'nonfiction', sortKey: string, id: number) {
  const row = store.getBook(id)
  if (!row || row.shelf_range !== range || row.sort_key !== sortKey) return null

  const strip = shelves.stripOf(range, id)
  if (!strip) return null

  return {
    label: strip.label,
    gapIndex: -1,
    placedIndex: strip.index,
    books: strip.books.map((placed, i) =>
      // The book itself and the two it sits between.
      stripBook(placed.book, Math.abs(i - strip.index) <= 1),
    ),
  }
}

function stripBook(row: ShelvedBook, withPhoto: boolean) {
  return {
    id: row.id,
    title: row.title,
    authorFiling: row.author_filing,
    // Same precedence as a neighbour thumbnail: the spine is what you see
    // looking at a shelf, and a cover is only a fallback.
    spine: withPhoto ? row.edge_image || row.front_image || row.back_image || '' : '',
    spineSlot: withPhoto && !row.edge_image ? 'front' : 'edge',
  }
}

function shelfGroups(range: 'fiction' | 'nonfiction') {
  return shelves.groups(range)
}

const queue = new CaptureQueue(
  db,
  (name) => {
    if (!name) return null
    try {
      return readFileSync(join(COVER_DIR, name))
    } catch {
      return null
    }
  },
  { googleApiKey: GOOGLE_API_KEY },
)

/**
 * Remove photo files that nothing points at any more.
 *
 * Call this only AFTER the owning row is gone, so it does not count itself.
 *
 * The reference check is not optional. A capture hands its filenames to the
 * book it becomes, so a capture and a shelved book routinely name the same
 * files on disk. Deleting a capture's photos without checking would take the
 * book's photos with them, and there is no getting those back.
 */
function deleteOrphanedImages(names: string[]): string[] {
  const usedByBook = db.prepare(
    `SELECT 1 FROM books
      WHERE front_image = ?1 OR back_image = ?1 OR edge_image = ?1 OR cover_image = ?1
      LIMIT 1`,
  )
  const usedByCapture = db.prepare(
    'SELECT 1 FROM captures WHERE front_image = ? OR back_image = ? OR edge_image = ? LIMIT 1',
  )

  const removed: string[] = []
  for (const name of names.filter(Boolean)) {
    if (usedByBook.get(name) || usedByCapture.get(name, name, name)) continue
    try {
      rmSync(join(COVER_DIR, name), { force: true })
      removed.push(name)
    } catch {
      // A missing file is already in the state we want.
    }
  }
  return removed
}

const app = express()
app.use(express.json({ limit: '12mb' })) // cover stills arrive as data URLs

// Captured photos. Immutable once written (the filename carries a timestamp),
// so they can be cached hard: the placement card renders neighbour spines on
// every scan and should not refetch them.
app.use(
  '/api/covers',
  express.static(COVER_DIR, {
    immutable: true,
    maxAge: '30d',
    fallthrough: false,
  }),
)

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
    ocrText: String(body.ocrText ?? ''),
    authorFilingOverride: body.authorFilingOverride
      ? String(body.authorFilingOverride)
      : null,
  }
}

// ---------------------------------------------------------------------------
// Capture queue
// ---------------------------------------------------------------------------

/**
 * Accept three photos and return at once. Reading them happens in the
 * background, so the person holding the books can move straight to the next
 * one instead of waiting on OCR.
 */
app.post('/api/captures', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  // The client knows which side it just photographed, so the slot is required
  // rather than inferred or defaulted. Quietly falling back to 'back' would
  // file a cover photo as the barcode side, and the worker would then read it
  // expecting an ISBN and report an honest-looking failure for the wrong
  // reason. Better to refuse the request.
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

  const capture = queue.attach(captureId, slot, saveImage(buffer, '', slot))
  // Not awaited: the shutter must not wait on OCR.
  void queue.drain()

  res.status(201).json({ capture, counts: queue.counts() })
})

app.get('/api/captures/:id', (req, res) => {
  const capture = queue.get(Number(req.params.id))
  if (!capture) {
    res.status(404).json({ error: 'No such capture.' })
    return
  }
  res.json({ capture, counts: queue.counts() })
})

app.get('/api/captures', (_req, res) => {
  res.json({ captures: queue.list(), counts: queue.counts() })
})

app.post('/api/captures/:id/claim', (req, res) => {
  const who = String((req.body ?? {}).who ?? '').trim() || 'unknown'
  const result = queue.claim(Number(req.params.id), who)
  if (!result.ok) {
    res.status(409).json({
      error: `That book is being worked on by ${result.heldBy}.`,
    })
    return
  }
  res.json({ capture: result.row })
})

app.post('/api/captures/:id/release', (req, res) => {
  queue.release(Number(req.params.id), String((req.body ?? {}).who ?? ''))
  res.json({ ok: true })
})

app.delete('/api/captures/:id', (req, res) => {
  const id = Number(req.params.id)
  const capture = queue.get(id)
  if (!capture) {
    res.status(404).json({ error: 'No such capture.' })
    return
  }

  const images = [capture.front_image, capture.back_image, capture.edge_image]
  queue.remove(id)
  const removed = deleteOrphanedImages(images)

  res.json({ ok: true, counts: queue.counts(), photosRemoved: removed.length })
})

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Read an ISBN out of one photo and answer straight away.
 *
 * Deliberately synchronous, which the capture path is not. There the queue
 * owns the work so the person can keep shooting; here they are sat in front of
 * a dialog waiting for the number, and handing them a job id to poll would be
 * a worse version of waiting. Nothing is stored: this reads the image, returns
 * what it found, and forgets it.
 */
app.post('/api/identify/isbn', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const buffer = decodeDataUrl(String(body.image ?? ''))
  if (!buffer) {
    res.status(400).json({ error: 'Send an image as a data URL.' })
    return
  }

  try {
    const result = await identify(buffer, { wantTitle: false })
    res.json({
      isbn13: result.isbn13,
      isbn10: result.isbn10,
      source: result.source,
      candidates: result.isbnCandidates,
      barcodes: result.barcodes,
    })
  } catch (caught) {
    res.status(500).json({ error: (caught as Error).message })
  }
})

app.get('/api/lookup/isbn/:isbn', async (req, res) => {
  const raw = normaliseIsbn(req.params.isbn)
  const pair = resolveIsbnPair(raw)

  // The old guard tested `isbn13 && !isValidIsbn13(isbn13)`, which let an
  // invalid 10-digit entry straight through: the conversion returned '',
  // making the left side falsy and skipping the check entirely.
  if (!pair.isbn13 && raw.length >= 10) {
    res.status(400).json({
      error: `"${req.params.isbn}" is not a valid ISBN-10 or ISBN-13.`,
    })
    return
  }

  const result = await lookupIsbn(raw, { googleApiKey: GOOGLE_API_KEY })
  const existing = store.findByIsbn(result.isbn13 || pair.isbn13)

  res.json({
    ...result,
    duplicateOf: existing
      ? { id: existing.id, title: existing.title, location: existing.location }
      : null,
  })
})

app.get('/api/lookup/title', async (req, res) => {
  const result = await searchTitle(String(req.query.q ?? ''), {
    googleApiKey: GOOGLE_API_KEY,
  })
  res.json({ ...result, duplicateOf: null })
})

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/**
 * Where would this book go, without saving it? Drives the live placement card
 * as the user edits the review fields.
 */
app.post('/api/placement/preview', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const draft = asDraft(body)
  if (!draft.title) {
    res.status(400).json({ error: 'A title is required to work out placement.' })
    return
  }
  // When editing a saved book, it must not turn up as its own neighbour.
  const excludeId = Number(body.excludeId ?? 0) || undefined
  const placement = store.placementFor(draft, excludeId)
  res.json(inDerivedScheme(placement.range, placement, excludeId))
})

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

app.post('/api/books', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const draft = asDraft(body)
  if (!draft.title) {
    res.status(400).json({ error: 'A title is required.' })
    return
  }

  const captureId = Number(body.captureId ?? 0)

  // A book promoted from the queue already has its photos on disk. The client
  // does not re-upload them, so carry the filenames across here or the book
  // silently loses every image it was scanned with.
  const capture = captureId ? queue.get(captureId) : undefined
  if (capture) {
    draft.frontImage = capture.front_image
    draft.backImage = capture.back_image
    draft.edgeImage = capture.edge_image
  }

  // Photos arrive as data URLs and are written beside the database rather than
  // into it, so the SQLite file stays small enough to copy around. Anything
  // uploaded here wins over the capture's copy.
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
    if (primary) store.saveFilingOverride(primary, draft.authorFilingOverride)
  }

  const { id, placement } = store.addBook(draft)

  if (captureId) queue.markDone(captureId, id)

  // Deliberately not awaited. The person is waiting to be told where the book
  // goes, and a cover that arrives a second later costs them nothing.
  void fetchCoverFor(id).then(() => hashBook(id))

  res.status(201).json({
    id,
    // The freshly computed placement, not whatever the client previewed.
    // With two people scanning, a neighbour can appear between preview and
    // save, and the stale one would send the book to the wrong gap.
    placement: inDerivedScheme(placement.range, { ...placement, ...store.resolveKey(draft) }),
    counts: store.counts(),
    queue: queue.counts(),
  })
})

app.get('/api/books', (req, res) => {
  const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
  res.json({ books: store.listRange(range), counts: store.counts() })
})

app.get('/api/shelves', (req, res) => {
  const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
  res.json({
    groups: shelfGroups(range),
    separators: shelves.list(range),
    loads: shelves.loads(range),
    /*
     * Books off the shelf, each with the shelf it would land on.
     *
     * They hold no position, so they are absent from the groups above and the
     * numbering there counts only what is physically there. This is display
     * only: it lets the library show a gap where a book belongs instead of
     * making an absent book invisible from the shelf it came off.
     */
    checkedOut: store.checkedOut()
      .filter((book) => book.shelf_range === range)
      .map((book) => ({ book, label: shelves.shelfForSortKey(range, book.sort_key) })),
  })
})

/**
 * The person at the shelf says it will not take another book.
 *
 * Returns the one physical step to perform. Whether the shelf it moves onto
 * can cope is not knowable here, so the client asks and calls again if not.
 */
app.post('/api/shelves/overflow', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const range = body.range === 'nonfiction' ? 'nonfiction' : 'fiction'
  const kind = body.kind === 'area' ? 'area' : 'shelf'
  const label = String(body.label ?? '')

  const result = shelves.overflow(range, label, kind)
  if (!result.ok) {
    res.status(400).json({ error: result.error })
    return
  }

  res.json({
    step: result.step
      ? { ...result.step, title: shelves.layout(range)
            .find((p) => p.book.id === result.step!.moved.id)?.book.title ?? '' }
      : null,
    moves: describeMoves(range, result.moves ?? []),
    groups: shelfGroups(range),
  })
})

app.delete('/api/shelves/:id', (req, res) => {
  const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
  const before = shelves.layout(range)
  shelves.remove(Number(req.params.id))
  res.json({
    moves: describeMoves(range, shelves.movesSince(range, before)),
    groups: shelfGroups(range),
  })
})

app.get('/api/books/:id', (req, res) => {
  const book = store.getBook(Number(req.params.id))
  if (!book) {
    res.status(404).json({ error: 'No such book.' })
    return
  }
  res.json({ book })
})

app.put('/api/books/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!store.getBook(id)) {
    res.status(404).json({ error: 'No such book.' })
    return
  }

  const draft = asDraft(req.body ?? {})
  if (!draft.title) {
    res.status(400).json({ error: 'A title is required.' })
    return
  }

  const placement = store.updateBook(id, draft)
  res.json({ id, placement: inDerivedScheme(placement.range, placement), counts: store.counts() })
})

app.patch('/api/books/:id/location', (req, res) => {
  const id = Number(req.params.id)
  store.setLocation(id, String((req.body ?? {}).location ?? ''))
  res.json({ ok: true })
})

app.delete('/api/books/:id', (req, res) => {
  const id = Number(req.params.id)
  const book = store.getBook(id)
  if (!book) {
    res.status(404).json({ error: 'No such book.' })
    return
  }

  const images = [book.front_image, book.back_image, book.edge_image, book.cover_image]
  store.deleteBook(id)
  const removed = deleteOrphanedImages(images)

  res.json({ ok: true, counts: store.counts(), photosRemoved: removed.length })
})

/**
 * Take a book off the shelf, or put it back.
 *
 * The point is that the model can be corrected by hand. A book that will not
 * physically fit where the layout says it goes can be pulled out; the shelf
 * closes up behind it here exactly as it does in the room, and nothing is
 * told to file itself next to a book that is sitting on the table.
 *
 * Nothing is deleted. The entry, its photos and its filing all survive, and
 * putting it back is the same flow as shelving it the first time.
 */
app.post('/api/books/:id/checkout', (req, res) => {
  const id = Number(req.params.id)
  const book = store.getBook(id)
  if (!book) {
    res.status(404).json({ error: 'No such book.' })
    return
  }

  const out = (req.body ?? {}).out !== false
  store.setCheckedOut(id, out)
  res.json({ book: store.getBook(id), counts: store.counts() })
})

/**
 * Fetch and store the publisher cover for one book.
 *
 * Open Library indexes covers by ISBN, so the common case needs no metadata
 * lookup. Only when it has nothing do we spend a full lookup to see whether
 * Google has one.
 */
async function fetchCoverFor(id: number): Promise<string> {
  const book = store.getBook(id)
  if (!book || book.cover_image) return book?.cover_image ?? ''

  const isbn = book.isbn13 || book.isbn10
  if (!isbn) return ''

  let name = await downloadCover(openLibraryCover(isbn), isbn, COVER_DIR)

  if (!name) {
    const found = await lookupIsbn(isbn, { googleApiKey: GOOGLE_API_KEY })
      .catch(() => null)
    if (found?.coverUrl) {
      name = await downloadCover(upgradeGoogleCover(found.coverUrl), isbn, COVER_DIR)
    }
  }

  // Stamped either way, so a book with no cover anywhere is asked about once.
  store.setCoverImage(id, name)
  return name
}

/**
 * Work through books that have no cover yet, a batch at a time.
 *
 * Batched rather than all at once because it is someone else's API and there
 * is no hurry: every book in the library predates this column, and they only
 * need fetching once.
 */
// Not under /api/covers: that path is a static mount with fallthrough off,
// which answers anything beneath it and would reject this as a 405.
app.post('/api/backfill/covers', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const limit = Math.min(50, Math.max(1, Number(body.limit ?? 10)))
  // Ask again about the ones that came up empty, for when a cover has since
  // been added upstream or a lookup was simply down at the time.
  const retry = body.retry === true
  try {
    const todo = store.missingCovers(limit, retry)

    let fetched = 0
    for (const book of todo) {
      if (await fetchCoverFor(book.id)) fetched += 1
    }

    res.json({
      tried: todo.length,
      fetched,
      remaining: store.missingCovers(1000).length,
      withoutCover: store.missingCovers(1000, true).length,
    })
  } catch (caught) {
    // Express 4 does not catch a rejected async handler, and an uncaught one
    // takes the process down. Fetching covers is not worth the server.
    res.status(500).json({ error: (caught as Error).message })
  }
})

/** Hash whatever images a book has, so it can be recognised by its cover. */
async function hashBook(id: number): Promise<void> {
  const book = store.getBook(id)
  if (!book) return

  const read = async (name: string) => {
    if (!name) return ''
    try {
      return await coverHash(readFileSync(join(COVER_DIR, name)))
    } catch {
      return ''
    }
  }

  store.setHashes(
    id,
    book.front_hash || (await read(book.front_image)),
    book.cover_hash || (await read(book.cover_image)),
  )
}

/**
 * Books that look like the one in the photo, best first.
 *
 * A shortlist, never an answer. Measured against re-photographed covers this
 * puts the right book first about nineteen times in twenty and in the top
 * three every time, which is worth showing somebody and not worth acting on
 * by itself, so the caller confirms.
 */
async function looksLike(input: Buffer, limit = 4) {
  const query = await coverHash(input)

  const scored = store.hashIndex().map((row) => ({
    row,
    // Whichever of the two stored images is the better likeness. A photo of a
    // book usually resembles another photo of it more than it resembles the
    // publisher's clean artwork, but not always.
    d: Math.min(
      row.front_hash ? distance(query, row.front_hash) : 64,
      row.cover_hash ? distance(query, row.cover_hash) : 64,
    ),
  }))

  // 32 of 64 bits is what two unrelated images average, so anything past the
  // mid twenties is noise wearing a number.
  return scored
    .filter((entry) => entry.d <= 24)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ row, d }) => ({
      id: row.id,
      title: row.title,
      authorFiling: row.author_filing,
      cover: row.cover_image || row.front_image,
      checkedOut: row.checked_out_at !== null,
      distance: d,
    }))
}

/**
 * Work through missing covers quietly in the background.
 *
 * Slow on purpose. It is someone else's API, nobody is waiting on the result,
 * and cover_checked_at means the work converges: once every book has been
 * asked about, this finds nothing and stops until new books arrive.
 */
async function backfillCoversInBackground(): Promise<void> {
  for (;;) {
    const todo = store.missingCovers(5)
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
    const todo = store.missingHashes(25)
    if (!todo.length) return
    for (const book of todo) await hashBook(book.id)
  }
}

app.get('/api/checked-out', (_req, res) => {
  res.json({ books: store.checkedOut() })
})

/**
 * Hold a book up to the camera and take it off the shelf, or bring it back.
 *
 * One round trip from photo to decision, because the alternative is three and
 * the person is stood there holding the book. It reads the ISBN, finds the
 * catalogue entry and applies the change, and the reply says which of the
 * several ways this can go actually happened so the screen can say something
 * true rather than just "no".
 *
 * Checking in only clears the flag here. Where the book physically goes is
 * the shelving step's business, and the client takes them there.
 */
app.post('/api/books/scan-checkout', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const out = body.out !== false

  const buffer = decodeDataUrl(String(body.image ?? ''))
  if (!buffer) {
    res.status(400).json({ error: 'Send an image as a data URL.' })
    return
  }

  try {
    const read = await identify(buffer, { wantTitle: false })
    if (!read.isbn13) {
      // No barcode to go on, so fall back to what the book looks like. The
      // person is holding it up to the camera; the front is what they are
      // showing us whether or not there is a barcode on it.
      const candidates = await looksLike(buffer)
      res.json({
        outcome: candidates.length ? 'candidates' : 'no-isbn',
        barcodes: read.barcodes,
        candidates,
      })
      return
    }

    const book = store.findByIsbn(read.isbn13)
    if (!book) {
      res.json({ outcome: 'not-catalogued', isbn13: read.isbn13 })
      return
    }

    // Already in the state being asked for. Worth its own answer: telling
    // someone a book is off the shelf when they just took it off reads as a
    // failure, and telling them nothing is worse.
    const alreadyOut = book.checked_out_at !== null
    if (alreadyOut === out) {
      res.json({
        outcome: out ? 'already-out' : 'already-in',
        book,
        counts: store.counts(),
      })
      return
    }

    store.setCheckedOut(book.id, out)
    res.json({
      outcome: out ? 'checked-out' : 'checked-in',
      book: store.getBook(book.id),
      counts: store.counts(),
    })
  } catch (caught) {
    res.status(500).json({ error: (caught as Error).message })
  }
})

app.get('/api/misfiles', (_req, res) => {
  res.json({ misfiles: store.misfiles() })
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, counts: store.counts(), db: DB_PATH })
})

queue.resumeOnStartup()

// After the port is open, so a slow or unreachable cover service never
// delays the server being usable.
setTimeout(() => {
  void hashInBackground()
    .then(() => backfillCoversInBackground())
    .catch((caught) => {
      console.error('[covers] backfill stopped:', (caught as Error).message)
    })
}, 3_000)

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[api] listening on http://127.0.0.1:${PORT}`)
  console.log(`[api] database ${DB_PATH}`)
})

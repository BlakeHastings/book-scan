/**
 * API server. Plain HTTP on localhost only; the phone never talks to it
 * directly. Vite proxies /api to it over the loopback interface, which is what
 * keeps the HTTPS page free of mixed content.
 */

import express from 'express'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openDatabase } from './db'
import { identify } from './identify'
import { lookupIsbn, searchTitle } from './lookup'
import { Store, type DraftBook } from './store'
import { normaliseIsbn, resolveIsbnPair } from '../shared/isbn'

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
// Identify
// ---------------------------------------------------------------------------

/**
 * Read an ISBN off one captured photo, and look the book up if one is found.
 *
 * Both steps happen in a single round trip because the caller is a phone on
 * wifi: two sequential requests is a visibly slower shutter-to-answer time.
 */
app.post('/api/identify', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const slot: Slot = body.slot === 'front' || body.slot === 'edge' ? body.slot : 'back'

  const image = decodeDataUrl(String(body.image ?? ''))
  if (!image) {
    res.status(400).json({ error: 'Expected an image data URL.' })
    return
  }

  // The title guess is the expensive part: it forces a full OCR pass even
  // when the barcode already answered. The client asks for it only when it
  // still has no title, so once a book is identified the remaining photos
  // come back fast.
  const wantTitle = body.wantTitle === undefined
    ? slot === 'front'
    : Boolean(body.wantTitle)

  const result = await identify(image, { wantTitle })

  const lookup = result.isbn13
    ? await lookupIsbn(result.isbn13, { googleApiKey: GOOGLE_API_KEY })
    : null

  const existing = result.isbn13 ? store.findByIsbn(result.isbn13) : undefined

  res.json({
    identify: result,
    lookup: lookup
      ? {
          ...lookup,
          duplicateOf: existing
            ? { id: existing.id, title: existing.title, location: existing.location }
            : null,
        }
      : null,
  })
})

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

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
  const draft = asDraft(req.body ?? {})
  if (!draft.title) {
    res.status(400).json({ error: 'A title is required to work out placement.' })
    return
  }
  res.json(store.placementFor(draft))
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

  // Photos arrive as data URLs and are written beside the database rather than
  // into it, so the SQLite file stays small enough to copy around.
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
  res.status(201).json({ id, placement, counts: store.counts() })
})

app.get('/api/books', (req, res) => {
  const range = req.query.range === 'nonfiction' ? 'nonfiction' : 'fiction'
  res.json({ books: store.listRange(range), counts: store.counts() })
})

app.patch('/api/books/:id/location', (req, res) => {
  const id = Number(req.params.id)
  store.setLocation(id, String((req.body ?? {}).location ?? ''))
  res.json({ ok: true })
})

app.delete('/api/books/:id', (req, res) => {
  store.deleteBook(Number(req.params.id))
  res.json({ ok: true, counts: store.counts() })
})

app.get('/api/misfiles', (_req, res) => {
  res.json({ misfiles: store.misfiles() })
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, counts: store.counts(), db: DB_PATH })
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[api] listening on http://127.0.0.1:${PORT}`)
  console.log(`[api] database ${DB_PATH}`)
})

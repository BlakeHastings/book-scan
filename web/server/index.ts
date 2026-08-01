/**
 * API server. Plain HTTP on localhost only; the phone never talks to it
 * directly. Vite proxies /api to it over the loopback interface, which is what
 * keeps the HTTPS page free of mixed content.
 */

import express from 'express'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openDatabase } from './db'
import { lookupIsbn, searchTitle } from './lookup'
import { Store, type DraftBook } from './store'
import { isValidIsbn13, isbn10To13, normaliseIsbn } from '../shared/isbn'

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
    authorFilingOverride: body.authorFilingOverride
      ? String(body.authorFilingOverride)
      : null,
  }
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

app.get('/api/lookup/isbn/:isbn', async (req, res) => {
  const raw = normaliseIsbn(req.params.isbn)
  const isbn13 = raw.length === 10 ? isbn10To13(raw) : raw

  if (isbn13 && !isValidIsbn13(isbn13)) {
    res.status(400).json({ error: `"${req.params.isbn}" is not a valid ISBN.` })
    return
  }

  const result = await lookupIsbn(isbn13 || raw, { googleApiKey: GOOGLE_API_KEY })
  const existing = store.findByIsbn13(result.isbn13 || isbn13)

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

  // Cover still arrives as a data URL and is written beside the database
  // rather than into it, so the SQLite file stays small enough to copy around.
  const coverData = String(body.coverImageData ?? '')
  if (coverData.startsWith('data:image/')) {
    const base64 = coverData.slice(coverData.indexOf(',') + 1)
    const name = `${Date.now()}_${draft.isbn13 || 'noisbn'}.jpg`
    writeFileSync(join(COVER_DIR, name), Buffer.from(base64, 'base64'))
    draft.coverImage = name
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

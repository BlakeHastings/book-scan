import type { Placement, ShelfRange } from '../../shared/shelving'

export interface Classification {
  isFiction: boolean
  confidence: 'high' | 'medium' | 'weak' | 'unknown'
  reason: string
}

export interface LookupResponse {
  found: boolean
  title: string
  subtitle: string
  authors: string[]
  publisher: string
  published: string
  pages: string
  isbn13: string
  isbn10: string
  seriesName: string
  seriesIndex: number | null
  coverUrl: string
  source: string
  classification: Classification
  notes: string[]
  duplicateOf: { id: number; title: string; location: string } | null
}

/** What the review pane edits and what gets posted. */
export interface Draft {
  isbn13: string
  isbn10: string
  title: string
  subtitle: string
  authors: string
  publisher: string
  published: string
  pages: string
  notes: string
  isFiction: boolean
  classificationSource: string
  classificationConfidence: string
  seriesName: string
  seriesIndex: string
  location: string
  lookupSource: string
  isbnSource: string
  ocrText: string
  authorFilingOverride: string
}

export interface PlacementResponse extends Placement {
  authorFiling: string
  sortKey: string
}

export interface Counts {
  total: number
  fiction: number
  nonfiction: number
  unshelved: number
}

export interface BookRow {
  id: number
  title: string
  subtitle: string
  authors: string
  author_filing: string
  publisher: string
  published: string
  pages: string
  notes: string
  series_name: string
  series_index: number | null
  location: string
  shelf_range: ShelfRange
  is_fiction: number
  classification_source: string
  classification_confidence: string
  isbn13: string
  isbn10: string
  isbn_source: string
  lookup_source: string
  front_image: string
  back_image: string
  edge_image: string
}

export interface Move {
  id: number
  from: string
  to: string
  /** Filled in by the server so the list reads as books, not row ids. */
  title?: string
}

export interface ShelfGroupDto {
  area: number
  shelf: number
  label: string
  books: { book: BookRow }[]
  capacity: number | null
  separatorId: number | null
  kind: 'shelf' | 'area' | null
  over?: boolean
}

export interface Misfile {
  book: { id: number; title: string; location: string }
  previous: { id: number; title: string; location: string }
  reason: string
}

export interface IdentifyResult {
  isbn13: string
  isbn10: string
  source: 'barcode' | 'ocr' | ''
  barcodes: string[]
  titleGuess: string
  coverLines: string[]
  text: string
  notes: string[]
}

export interface IdentifyResponse {
  identify: IdentifyResult
  lookup: LookupResponse | null
}

export type CaptureStatus = 'pending' | 'ready' | 'failed' | 'done'

export interface Capture {
  id: number
  status: CaptureStatus
  front_image: string
  back_image: string
  edge_image: string
  isbn13: string
  isbn10: string
  isbn_source: string
  title_guess: string
  cover_text: string
  analysed: string
  draft_json: string
  note: string
  claimed_by: string
  claimed_at: string | null
  book_id: number | null
  created_at: string
  processed_at: string | null
}

export type QueueCounts = Record<CaptureStatus, number>

/**
 * Stable per-device name, so a claim can say who holds a capture and the same
 * browser can reclaim its own work after a refresh.
 */
export function deviceName(): string {
  const key = 'bookscan.device'
  let name = localStorage.getItem(key)
  if (!name) {
    name = `device-${Math.random().toString(36).slice(2, 6)}`
    localStorage.setItem(key, name)
  }
  return name
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

/** Body shape shared by the preview and save endpoints. */
function draftBody(draft: Draft) {
  return {
    ...draft,
    authors: draft.authors.split(',').map((a) => a.trim()).filter(Boolean),
    seriesIndex: draft.seriesIndex.trim() === '' ? null : Number(draft.seriesIndex),
    authorFilingOverride: draft.authorFilingOverride.trim() || null,
  }
}

export const api = {
  lookupIsbn: (isbn: string) =>
    request<LookupResponse>(`/api/lookup/isbn/${encodeURIComponent(isbn)}`),

  searchTitle: (title: string) =>
    request<LookupResponse>(`/api/lookup/title?q=${encodeURIComponent(title)}`),

  /** `excludeId` keeps a book being edited out of its own neighbour search. */
  previewPlacement: (draft: Draft, excludeId?: number) =>
    request<PlacementResponse>('/api/placement/preview', {
      method: 'POST',
      body: JSON.stringify({ ...draftBody(draft), excludeId }),
    }),

  /**
   * Hand one photo to the queue as it is taken and return at once. The queue
   * reads it in the background; poll getCapture for the outcome.
   */
  addPhoto: (image: string, slot: 'front' | 'back' | 'edge', captureId: number | null) =>
    request<{ capture: Capture; counts: QueueCounts }>('/api/captures', {
      method: 'POST',
      body: JSON.stringify({ image, slot, captureId }),
    }),

  getCapture: (id: number) =>
    request<{ capture: Capture; counts: QueueCounts }>(`/api/captures/${id}`),

  listCaptures: () =>
    request<{ captures: Capture[]; counts: QueueCounts }>('/api/captures'),

  claimCapture: (id: number, who: string) =>
    request<{ capture: Capture }>(`/api/captures/${id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ who }),
    }),

  releaseCapture: (id: number, who: string) =>
    request<{ ok: true }>(`/api/captures/${id}/release`, {
      method: 'POST',
      body: JSON.stringify({ who }),
    }),

  deleteCapture: (id: number) =>
    request<{ ok: true; counts: QueueCounts }>(`/api/captures/${id}`, {
      method: 'DELETE',
    }),

  saveBook: (
    draft: Draft,
    images: Partial<Record<'front' | 'back' | 'edge', string>>,
    saveFilingOverride: boolean,
    captureId?: number,
  ) =>
    request<{ id: number; placement: PlacementResponse; counts: Counts; queue: QueueCounts }>(
      '/api/books',
      {
        method: 'POST',
        body: JSON.stringify({
          ...draftBody(draft), images, saveFilingOverride, captureId,
        }),
      },
    ),

  getBook: (id: number) => request<{ book: BookRow }>(`/api/books/${id}`),

  updateBook: (id: number, draft: Draft) =>
    request<{ id: number; placement: PlacementResponse; counts: Counts }>(
      `/api/books/${id}`,
      { method: 'PUT', body: JSON.stringify(draftBody(draft)) },
    ),

  listBooks: (range: ShelfRange) =>
    request<{ books: BookRow[]; counts: Counts }>(`/api/books?range=${range}`),

  deleteBook: (id: number) =>
    request<{ ok: true; counts: Counts }>(`/api/books/${id}`, { method: 'DELETE' }),

  shelves: (range: ShelfRange) =>
    request<{ groups: ShelfGroupDto[] }>(`/api/shelves?range=${range}`),

  /** Tell the software a shelf is physically full at this book. */
  markShelfFull: (range: ShelfRange, bookId: number, kind: 'shelf' | 'area') =>
    request<{ groups: ShelfGroupDto[]; moves: Move[] }>('/api/shelves/full-after', {
      method: 'POST',
      body: JSON.stringify({ range, bookId, kind }),
    }),

  removeSeparator: (id: number, range: ShelfRange) =>
    request<{ groups: ShelfGroupDto[]; moves: Move[] }>(
      `/api/shelves/${id}?range=${range}`, { method: 'DELETE' },
    ),

  misfiles: () => request<{ misfiles: Misfile[] }>('/api/misfiles'),

  health: () => request<{ ok: boolean; counts: Counts; db: string }>('/api/health'),
}

export const emptyDraft: Draft = {
  isbn13: '', isbn10: '', title: '', subtitle: '', authors: '', publisher: '',
  published: '', pages: '', notes: '', isFiction: true,
  classificationSource: 'auto', classificationConfidence: 'unknown',
  seriesName: '', seriesIndex: '', location: '', lookupSource: '',
  isbnSource: '', ocrText: '', authorFilingOverride: '',
}

export function draftFromLookup(result: LookupResponse): Draft {
  return {
    ...emptyDraft,
    isbn13: result.isbn13,
    isbn10: result.isbn10,
    title: result.title,
    subtitle: result.subtitle,
    authors: result.authors.join(', '),
    publisher: result.publisher,
    published: result.published,
    pages: result.pages,
    isFiction: result.classification.isFiction,
    classificationSource: 'auto',
    classificationConfidence: result.classification.confidence,
    seriesName: result.seriesName,
    seriesIndex: result.seriesIndex === null ? '' : String(result.seriesIndex),
    lookupSource: result.source,
  }
}

/** Load a saved book back into the shape the detail view edits. */
export function draftFromBook(book: BookRow): Draft {
  return {
    ...emptyDraft,
    isbn13: book.isbn13 ?? '',
    isbn10: book.isbn10 ?? '',
    title: book.title ?? '',
    subtitle: book.subtitle ?? '',
    authors: book.authors ?? '',
    publisher: book.publisher ?? '',
    published: book.published ?? '',
    pages: book.pages ?? '',
    notes: book.notes ?? '',
    isFiction: book.is_fiction === 1,
    classificationSource: book.classification_source || 'manual',
    classificationConfidence: book.classification_confidence || 'unknown',
    seriesName: book.series_name ?? '',
    seriesIndex: book.series_index === null ? '' : String(book.series_index),
    location: book.location ?? '',
    lookupSource: book.lookup_source ?? '',
    isbnSource: book.isbn_source ?? '',
    // The filing name is stored, but only counts as an override if it differs
    // from what the heuristic would derive. App decides that.
    authorFilingOverride: '',
  }
}

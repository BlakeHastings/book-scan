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
  authors: string
  author_filing: string
  series_name: string
  series_index: number | null
  location: string
  shelf_range: ShelfRange
  isbn13: string
  front_image: string
  back_image: string
  edge_image: string
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
  text: string
  notes: string[]
}

export interface IdentifyResponse {
  identify: IdentifyResult
  lookup: LookupResponse | null
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
  /** Read an ISBN off one photo, and look the book up if one is found. */
  identify: (image: string, slot: 'front' | 'back' | 'edge') =>
    request<IdentifyResponse>('/api/identify', {
      method: 'POST',
      body: JSON.stringify({ image, slot }),
    }),

  lookupIsbn: (isbn: string) =>
    request<LookupResponse>(`/api/lookup/isbn/${encodeURIComponent(isbn)}`),

  searchTitle: (title: string) =>
    request<LookupResponse>(`/api/lookup/title?q=${encodeURIComponent(title)}`),

  previewPlacement: (draft: Draft) =>
    request<PlacementResponse>('/api/placement/preview', {
      method: 'POST',
      body: JSON.stringify(draftBody(draft)),
    }),

  saveBook: (
    draft: Draft,
    images: Partial<Record<'front' | 'back' | 'edge', string>>,
    saveFilingOverride: boolean,
  ) =>
    request<{ id: number; placement: Placement; counts: Counts }>('/api/books', {
      method: 'POST',
      body: JSON.stringify({ ...draftBody(draft), images, saveFilingOverride }),
    }),

  listBooks: (range: ShelfRange) =>
    request<{ books: BookRow[]; counts: Counts }>(`/api/books?range=${range}`),

  deleteBook: (id: number) =>
    request<{ ok: true; counts: Counts }>(`/api/books/${id}`, { method: 'DELETE' }),

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

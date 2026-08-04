import type {
  Excluded, ExcludedReason, Misfile, Placement, ShelfRange, ShelvingReview,
} from '../../shared/shelving'

/**
 * Naming boundary, recorded here because this file is the only client to
 * server path.
 *
 * The wire and database field `shelf` (also `shelf_range`, `ShelfRange`,
 * `ShelfGroupDto.shelf`, the `kind: 'shelf'` separator tag) names a whole
 * bookcase. Nothing in the code or schema is being renamed, per issue #8.
 * The UI, however, never shows the word "shelf": that same unit is displayed
 * to the person holding a book as "Bookcase". The plank within it is `area`
 * on both sides of this boundary, and reads as "Area" in the UI too.
 *
 * So exactly one term differs between what a user reads and what the code
 * calls it, in one direction: server/DB `shelf` == UI "Bookcase". If you are
 * reading a `shelf` value here and about to put it on screen, it needs that
 * translation first.
 */

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
  authorFilingOverride: string
}

/** One book already on the shelf, as drawn in the placing strip. */
export interface StripBook {
  id: number
  title: string
  authorFiling: string
  /** Filename, and only for the two books either side of the gap. */
  spine: string
  spineSlot: 'edge' | 'front'
}

/** A single shelf seen end on, with the space the new book goes in. */
export interface PlacementStrip {
  label: string
  books: StripBook[]
  /** How many books sit to the left of the gap, or -1 when there is no gap. */
  gapIndex: number
  /**
   * Where the book itself sits in the row, when it is already shelved and
   * still filed correctly. Null when it has yet to be put anywhere.
   */
  placedIndex: number | null
}

export interface PlacementResponse extends Placement {
  authorFiling: string
  sortKey: string
  /** Shelf in the derived scheme (A1, B2). What the shelving step asks about. */
  derivedLocation?: string
  strip?: PlacementStrip | null
}

export interface Counts {
  total: number
  fiction: number
  nonfiction: number
  /** Catalogued but physically off the shelf. */
  checkedOut: number
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
  /** Set while the book is off the shelf; null while it is on one. */
  checked_out_at: string | null
  /** Publisher cover from the catalogue, for comparing against the real book. */
  cover_image: string
  /** Flattened filing key. What the whole ordering hangs off. */
  sort_key: string
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
  separatorId: number | null
  kind: 'shelf' | 'area' | null
}

/**
 * What happened when a book was held up to the camera.
 *
 * Every way this can go has its own outcome, because the useful thing to say
 * next differs: an unreadable barcode wants you to move the book, a book that
 * is not in the catalogue wants scanning properly, and one already in the
 * state you asked for is not an error at all.
 */
/** A book that looks like the one held up. Never acted on without a tap. */
export interface CoverMatch {
  id: number
  title: string
  authorFiling: string
  /** Filename under /api/covers. Your own photo of this copy where there is one. */
  cover: string
  /** True when no photo exists and this is the catalogue's cover instead. */
  fromCatalogue: boolean
  checkedOut: boolean
  /** Differing bits out of 64. Lower is more alike. */
  distance: number
}

/**
 * What actually happened to a book's checked-out state.
 *
 * Asking to check out a book that is already out, or in one that is already
 * in, does not touch its timestamp, so both routes that can change this state
 * report it with the same four words rather than pretending a no-op is a
 * fresh action.
 */
export type CheckoutOutcome = 'checked-out' | 'already-out' | 'checked-in' | 'already-in'

/**
 * What the scanner made of a photograph.
 *
 * None of these is an action, and none of them changed anything. `identified`
 * is a barcode that named a catalogued row, which settles what the book is and
 * says nothing about what should happen to it; `candidates` is a shortlist to
 * put in front of a person. Where the flow goes next is the client's decision,
 * and what happens to the book is the person's.
 */
export type ScanResult =
  | { outcome: 'no-isbn'; barcodes: string[]; candidates: CoverMatch[] }
  | { outcome: 'candidates'; barcodes: string[]; candidates: CoverMatch[] }
  | { outcome: 'not-catalogued'; isbn13: string }
  | { outcome: 'identified'; book: BookRow }

/** A book off the shelf, with the shelf it would go back on. */
export interface CheckedOutAt {
  book: BookRow
  label: string
}

export type { Misfile, Excluded, ExcludedReason, ShelvingReview }

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

const updateBook = (id: number, draft: Draft) =>
  request<{ id: number; placement: PlacementResponse; counts: Counts }>(
    `/api/books/${id}`,
    { method: 'PUT', body: JSON.stringify(draftBody(draft)) },
  )

/**
 * Say where a book physically is now.
 *
 * The only call that changes a recorded location, and it exists so that a
 * person who has actually walked to the shelf can say so. Nothing derives
 * this and nothing writes it on their behalf.
 */
const setLocation = (id: number, location: string) =>
  request<{ book: BookRow }>(`/api/books/${id}/location`, {
    method: 'PATCH',
    body: JSON.stringify({ location }),
  })

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

  /** One-shot read of an ISBN from a photo, for the Change ISBN dialog. */
  identifyIsbn: (image: string) =>
    request<{
      isbn13: string
      isbn10: string
      source: 'barcode' | 'ocr' | ''
      candidates: string[]
      barcodes: string[]
    }>('/api/identify/isbn', {
      method: 'POST',
      body: JSON.stringify({ image }),
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
    request<{ ok: true; counts: QueueCounts; photosRemoved: number }>(
      `/api/captures/${id}`, { method: 'DELETE' },
    ),

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

  /**
   * Take a book off the shelf, or put it back. Nothing is deleted either way.
   *
   * Asking for the state it is already in is a no-op: `outcome` says whether
   * anything changed, and `book` always carries the real, unmodified value.
   */
  setCheckedOut: (id: number, out: boolean) =>
    request<{ outcome: CheckoutOutcome; book: BookRow; counts: Counts }>(
      `/api/books/${id}/checkout`,
      { method: 'POST', body: JSON.stringify({ out }) },
    ),

  checkedOut: () => request<{ books: BookRow[] }>('/api/checked-out'),

  backfillCovers: (limit = 10) =>
    request<{ tried: number; fetched: number; remaining: number }>(
      '/api/backfill/covers',
      { method: 'POST', body: JSON.stringify({ limit }) },
    ),

  /**
   * Photo in, an identity out. See ScanResult for what each outcome means.
   *
   * Deliberately has no direction argument and no way to gain one: the scanner
   * finds out which book is being held up and nothing else. Changing a book's
   * state is `setCheckedOut`, which takes an id.
   */
  scanBook: (image: string) =>
    request<ScanResult>('/api/books/scan', {
      method: 'POST',
      body: JSON.stringify({ image }),
    }),

  updateBook,

  /**
   * Save a catalogued book and record the shelf it has just been put on.
   *
   * Two calls, because they are two different kinds of statement. The PUT
   * carries what the catalogue says about the book, and the server
   * deliberately will not let an edit change a position: where a book
   * physically is was observed by a person, and a metadata edit knows nothing
   * about it. The shelving step does know, having just told somebody where to
   * put the book and been told it fits, so it says so through the one route
   * that changes a position.
   *
   * `shelvedAt` empty means this is an ordinary edit and nobody observed
   * anything, which leaves the recorded location exactly where it was.
   *
   * Without this the guidance the person had just followed was never written
   * down, and misfile detection then reported that same book as needing to
   * make the move they had already made.
   */
  updateAndShelve: async (id: number, draft: Draft, shelvedAt: string) => {
    const result = await updateBook(id, draft)
    if (shelvedAt.trim()) await setLocation(id, shelvedAt.trim())
    return result
  },

  listBooks: (range: ShelfRange) =>
    request<{ books: BookRow[]; counts: Counts }>(`/api/books?range=${range}`),

  deleteBook: (id: number) =>
    request<{ ok: true; counts: Counts; photosRemoved: number }>(
      `/api/books/${id}`, { method: 'DELETE' },
    ),

  shelves: (range: ShelfRange) =>
    request<{ groups: ShelfGroupDto[]; checkedOut: CheckedOutAt[] }>(
      `/api/shelves?range=${range}`,
    ),

  /**
   * The person at the shelf says it will not take another book. Returns the
   * single step to perform; ask again if the shelf it lands on is full too.
   *
   * `sortKey` is the book being placed, and passing it is what lets the server
   * answer with `carry`: when the book belongs at the end of the full shelf it
   * is the one that moves, and nothing already shelved is touched. Without it
   * the server can only see the shelves, so it can only offer to displace a
   * book that is on one, which is the extra handling #77 was about.
   */
  overflowShelf: (
    range: ShelfRange,
    label: string,
    kind: 'shelf' | 'area',
    sortKey = '',
  ) =>
    request<{
      /** The book in your hand goes on instead. No id: it is not saved yet. */
      carry: { from: string; to: string } | null
      /** `id` is the displaced book, so where it lands can be recorded. */
      step: { id: number; title: string; from: string; to: string } | null
      groups: ShelfGroupDto[]
      moves: Move[]
    }>('/api/shelves/overflow', {
      method: 'POST',
      body: JSON.stringify({ range, label, kind, sortKey }),
    }),

  /**
   * Move the boundary so the first or last book of an area belongs on the
   * plank next door.
   *
   * Only the furniture changes here, and deliberately nothing else. Saying
   * which plank the book is physically on is an observation about the room,
   * made by somebody who has walked over and put it there, so it goes through
   * the shelving step and its `PATCH .../location` like every other placement
   * (#79). Until they say so the book is genuinely not where the catalogue
   * has it, and the library reports exactly that, which is the same shape the
   * overflow cascade has always had.
   *
   * The server refuses a book that is not at a boundary; the controls that
   * call this are only offered on ones that are. Both, deliberately.
   */
  moveAcrossBoundary: (
    range: ShelfRange,
    id: number,
    direction: 'next' | 'previous',
  ) =>
    request<{
      move: { id: number; title: string; from: string; to: string } | null
      groups: ShelfGroupDto[]
      moves: Move[]
    }>('/api/shelves/move', {
      method: 'POST',
      body: JSON.stringify({ range, id, direction }),
    }),

  removeSeparator: (id: number, range: ShelfRange) =>
    request<{ groups: ShelfGroupDto[]; moves: Move[] }>(
      `/api/shelves/${id}?range=${range}`, { method: 'DELETE' },
    ),

  /** Books in this range that are not where they now belong. Read only. */
  misfiles: (range: ShelfRange) =>
    request<ShelvingReview>(`/api/misfiles?range=${range}`),

  setLocation,

  health: () => request<{ ok: boolean; counts: Counts; db: string }>('/api/health'),
}

export const emptyDraft: Draft = {
  isbn13: '', isbn10: '', title: '', subtitle: '', authors: '', publisher: '',
  published: '', pages: '', notes: '', isFiction: true,
  classificationSource: 'auto', classificationConfidence: 'unknown',
  seriesName: '', seriesIndex: '', location: '', lookupSource: '',
  isbnSource: '', authorFilingOverride: '',
}

/**
 * Fill a draft from what the catalogue returned.
 *
 * `isbnSource` is not in the lookup and cannot be: the catalogue only knows
 * the number it was asked about, not how the number was read. It comes from
 * whoever did the reading, so the caller passes it, and a book catalogued at
 * the camera keeps the difference between a self-validating barcode and an
 * OCR guess the lookup happened to agree with.
 */
export function draftFromLookup(result: LookupResponse, isbnSource = ''): Draft {
  return {
    ...emptyDraft,
    isbnSource,
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

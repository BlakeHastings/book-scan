import type {
  Excluded, ExcludedReason, Misfile, Placement, ShelfRange, ShelfSlot,
  ShelvingReview,
} from '../../shared/shelving'
import type { FailureCounts } from '../../shared/captureFailure'
import { genreOfRange, type GenreSlug } from '../../domain/tagging/genre'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'

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
  /**
   * Which genre the classifier guessed, as the tag it means.
   *
   * A slug rather than a boolean since #227. `books.is_fiction` is gone and the
   * genre tag is what decides a shelf range, so there is one vocabulary for a
   * book's genre from the ladder in `server/classify.ts` through to the field
   * beside the title.
   */
  genre: GenreSlug
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
  /** The genre this draft states, as a slug. See `Classification.genre`. */
  genre: GenreSlug
  classificationSource: string
  classificationConfidence: string
  seriesName: string
  seriesIndex: string
  location: string
  lookupSource: string
  isbnSource: string
  authorFilingOverride: string
}

/** One book already on the shelf, as drawn end on in a row of spines. */
export interface StripBook {
  id: number
  title: string
  authorFiling: string
  /**
   * Filename of the photo standing in for this book's spine, or '' when
   * there is none to show or none was asked for.
   */
  spine: string
  /**
   * Which face `spine` actually is. A book catalogued before the spine slot
   * existed falls back to a cover, and this says so rather than letting a
   * front cover pass for a spine.
   */
  spineSlot: ShelfSlot
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
  /**
   * Which plank a boundary move would land this book on, in each direction.
   * Null in a direction this book cannot move that way; absent altogether
   * when `placedIndex` is null, since only a book settled in its recorded
   * position can be offered one (#96). The server refuses the move itself
   * regardless of what this said a moment ago.
   */
  boundary?: { next: string | null; previous: string | null }
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
  publisher: string
  published: string
  pages: string
  notes: string
  series_name: string
  series_index: number | null
  location: string
  /**
   * Which run this book is in, which is what its genre tag settled on.
   *
   * There is no `is_fiction` beside it any more (#227). The column is dropped,
   * and this is the answer the genre tag gave, so the field beside the title
   * comes up from here: see `draftFromBook`.
   */
  shelf_range: ShelfRange
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
  /**
   * The three photos cut to the book, so a view can leave the room out. Empty
   * where the detector has not looked or could not find the book.
   */
  front_crop: string
  back_crop: string
  edge_crop: string
  /** Slots the detector has looked at, comma separated. Empty means none. */
  cropped: string
  /** Flattened filing key. What the whole ordering hangs off. */
  sort_key: string
}

/**
 * A book as a listing answers it: the row, and the name it files under.
 *
 * **One column `books` does not have**, since #227 dropped
 * `books.author_filing`. What a book files under is a fact about its first
 * credit's alias, and the three views on the server join it back on, so every
 * listing and every shelf row reads exactly what it read before. A lookup of one
 * book answers a `BookRow` with its credits beside it: see `getBook`.
 */
export interface FiledBookRow extends BookRow {
  author_filing: string
}

/**
 * One name a book credits, in the order the names are printed on it.
 *
 * The first is the one the shelf orders by, and `filingName` is what it files
 * under: the alias's own answer, which is either the heuristic's or the
 * correction somebody made to it.
 */
export interface Credit {
  position: number
  aliasId: number
  authorId: number
  displayName: string
  filingName: string
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
  books: { book: FiledBookRow }[]
  /**
   * The boundary this area begins at, if it is not the first.
   *
   * Its own boundary, never the one after it, exactly as `ShelfGroup` on the
   * server says (#145). The line for it is drawn above this area's heading,
   * and `libraryRows` in shared/layout.ts is what decides that, so the words
   * on the line and the boundary its Remove deletes come from one place.
   */
  opensWith: { id: number; kind: 'shelf' | 'area' } | null
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
  | { outcome: 'in-queue'; matches: QueueMatch[] }
  | { outcome: 'not-catalogued'; isbn13: string }
  | { outcome: 'identified'; book: FiledBookRow }

/**
 * A capture already waiting to be shelved that looks like the book being held
 * up (#122).
 *
 * The whole capture row, not a summary of it. A capture has no catalogue id
 * and may have no title, so there is no short form of it that means anything;
 * what a person needs to recognise it is the photograph somebody took and
 * whatever has been worked out about it so far, which is exactly what
 * `draftFromCapture` already reads off this row for the queue. Handing back
 * the row means the scanner and the queue describe a capture the same way,
 * and means opening one costs no second request.
 */
export interface QueueMatch {
  capture: Capture
  /**
   * Differing bits out of 64, held to `QUEUE_LIMIT`, which is much tighter
   * than the shortlist's cutoff.
   *
   * Null when the match came from the ISBN rather than from the pictures, and
   * null rather than 0 on purpose: zero is a measurement and there is no
   * measurement, because nothing was compared. Printing "looks the same, 100%"
   * off a fabricated zero would dress an identifier up as a likeness.
   */
  distance: number | null
  /**
   * What settled it. `isbn` is an exact identifier with its own check digit
   * and beats any comparison of photographs; `cover` is the perceptual hash,
   * which is what is left when nothing could be read (#146).
   */
  basis: 'isbn' | 'cover'
}

/** A book off the shelf, with the shelf it would go back on. */
export interface CheckedOutAt {
  book: FiledBookRow
  label: string
}

export type { Misfile, Excluded, ExcludedReason, ShelfSlot, ShelvingReview }

/**
 * The review, plus which of its misfiles the app is responsible for.
 *
 * `ShelvingReview` stays exactly what `reviewShelving` returns: a comparison of
 * where books are with where they belong, decided per book and knowing nothing
 * about how any of them got that way. Whether a particular disagreement was
 * opened by a boundary move is a fact about what somebody asked the app to do,
 * so it arrives beside the review rather than inside it.
 *
 * It is what tells "you moved this and have not carried it yet", which can be
 * taken back, from "a newcomer pushed this along", which cannot: there is no
 * assignment to withdraw, and closing it is a walk to the shelf.
 */
export interface ShelvingReviewResponse extends ShelvingReview {
  /** Book ids whose misfile is an outstanding boundary move. */
  outstandingMoves: number[]
}

/**
 * Moving a whole run onto another bookcase, as the plan screen reads it.
 *
 * Grouped rather than flat, and that is the shape rather than a decoration: 187
 * moves is not a list on a phone held in one hand. `groups` is what somebody
 * acts on and `books` inside one is what they open when a number looks wrong.
 *
 * The wire types are restated here rather than imported from `domain/`, the way
 * every other response on this path is: `src/` is the client and the server is
 * reached through this file alone.
 */
export interface PlannedBook {
  id: number
  title: string
  authorFiling: string
}

export interface PlanGroup {
  from: string
  to: string
  books: PlannedBook[]
}

export type SkipReason = 'pinned' | 'checked-out' | 'withdrawn' | 'never-placed'

export interface SkippedBooks {
  reason: SkipReason
  books: PlannedBook[]
}

export interface RunMovePlan {
  /** The bookcase the run starts on now. */
  from: number
  /** The one it would start on. */
  to: number
  /** Every plank of the run, old label to new. Empty when it is already there. */
  planks: { from: string; to: string }[]
  groups: PlanGroup[]
  /** Books to carry. The headline number. */
  moving: number
  /** Books the rules leave exactly where they are. */
  staying: number
  /** Everything the rules will not touch, and why. Never silently dropped. */
  skipped: SkippedBooks[]
  /** Books no rule claims at all. */
  unclaimed: PlannedBook[]
}

/*
 * --- The furniture -------------------------------------------------------
 *
 * The room as the screens read it (#313). The wire types are restated here
 * rather than imported from the server, the way every other response on this
 * path is.
 *
 * **No label is stored anywhere and none is sent back up.** Every `label` here
 * is worked out by the server at the moment it answered, from a piece's number
 * and name and an area's ordinal and name, so a screen that kept one in state
 * would be drawing a name for a piece somebody has since renamed. Every write
 * answers with `becomes`, which is each label that reads differently now, and
 * with the piece or area re-described. Read from the answer; never from memory.
 */

/** A label that reads differently after a change, old to new. */
export interface LabelChange {
  from: string
  to: string
}

/** What a rule asks for, in labels rather than in the slugs it stores. */
export interface RuleDto {
  id: number
  name: string
  /** One area, or a whole piece and everything the run flows onto after it. */
  about: 'area' | 'fixture'
  place: string
  /** Which area or piece that is, so a screen can name a piece its own way. */
  placeId: number | null
  enabled: boolean
  conditions: { operator: 'is' | 'under'; tag: string }[]
  /** The whole of it as one phrase: "Anything tagged Cookery". */
  said: string
}

export type SortStrategyCode = 'inherit' | 'author' | 'title' | 'published' | 'tag'

export interface AreaDto {
  id: number
  position: number
  label: string
  name: string
  startsAt: string
  sortStrategy: SortStrategyCode
  /** What it is actually ordered by, folded through the piece and collection. */
  ordering: Exclude<SortStrategyCode, 'inherit'>
  /** Anything but `inherit` means it takes no overflow from the area before. */
  selfContained: boolean
  note: string
  /** Books standing in it, which is where somebody last said they were. */
  books: number
  holds: string
  entry: boolean
  rule: RuleDto | null
}

export interface FixtureDto {
  id: number
  position: number
  label: string
  kind: string
  name: string
  sortStrategy: SortStrategyCode
  note: string
  books: number
  areas: AreaDto[]
  /** Other pieces standing on this piece's number. Reported, never refused. */
  sharing: number[]
  holds: string
  rule: RuleDto | null
}

export interface FurnitureDto {
  fixtures: FixtureDto[]
  defaultSortStrategy: SortStrategyCode
  strategies: { code: SortStrategyCode; label: string; isInherit: boolean }[]
}

/** What a piece still holds, which is what has to leave before it can go. */
export interface FixtureRemoval {
  books: number
  areas: number
  rules: number
  /** True when the row stays behind, off the floor, because history names it. */
  retires: boolean
}

/** What removing an area would do to its books. Nothing here moves one. */
export interface AreaRemovalPlan {
  area: { id: number; label: string; books: number }
  into: { id: number; label: string }
  joins: 'previous' | 'next'
  /**
   * How many books the rules refile into `into`.
   *
   * **Not how many books that area then holds.** An assignment is what the
   * rules want; where a book is is what somebody last said, and only the
   * location route changes that. See `AreaPane`.
   */
  joining: number
  skipped: { reason: SkipReason; books: number }[]
  becomes: LabelChange[]
}

/** What an apply wrote, in the numbers the ledger counts. */
export interface AssignmentReport {
  assigned: number
  unchanged: number
  skipped: number
  unclaimed: number[]
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
  /** What the background worker read. Nobody but the worker writes this. */
  draft_json: string
  /** What a person stated while it sat in the queue. The worker never writes it. */
  edit_json: string
  edited_by: string
  /** Set the first time a person looked, whether or not they changed anything. */
  edited_at: string | null
  note: string
  claimed_by: string
  claimed_at: string | null
  book_id: number | null
  created_at: string
  processed_at: string | null
  /**
   * The three photos cut to the book, as filenames under /api/covers. The same
   * columns books carry and the same contract: a crop is derived from the
   * photograph, never a replacement for it, so a view that has one shows it and
   * a view that does not shows the whole frame.
   *
   * Empty where the detector has not looked, and also empty where it looked and
   * declined. `cropped` is what tells those two apart.
   */
  front_crop: string
  back_crop: string
  edge_crop: string
  /**
   * Slots the detector has looked at, comma separated, whether or not it found
   * a book. A slot named here with an empty crop column was examined and
   * declined, which is a different fact from a photo taken before crops
   * existed. Empty means none have been looked at.
   */
  cropped: string
}

/**
 * The fields a person may state about a queued capture. Mirrors the server's
 * `CaptureEdit`: only what somebody resolving details decides, and every field
 * optional, because a request carries only what was actually stated.
 */
export interface CaptureEdit {
  isbn13?: string
  isbn10?: string
  isbnSource?: string
  title?: string
  subtitle?: string
  authors?: string[]
  publisher?: string
  published?: string
  pages?: string
  notes?: string
  genre?: GenreSlug
  classificationSource?: string
  classificationConfidence?: string
  seriesName?: string
  seriesIndex?: number | null
  location?: string
  lookupSource?: string
  authorFilingOverride?: string | null
}

/**
 * How much is waiting, and what kind of wrong the failed ones are.
 *
 * `failed` covers three situations that need different things from a person,
 * so the server sends the breakdown rather than leaving Home to infer one from
 * a single total, which is what it got wrong in #148. Mirrors the server's
 * `QueueCounts`.
 */
export interface QueueCounts extends Record<CaptureStatus, number> {
  failures: FailureCounts
}

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

/**
 * A refusal the caller can do something about, with what it has to show first.
 *
 * The furniture routes answer 409 with an `effect` attached wherever the
 * request was well formed and the room was not in a state to take it: giving an
 * area an order of its own cuts the run it was in, and the server refuses until
 * the caller says it has shown somebody what that does. A plain `Error` throws
 * that away and leaves a screen with nothing to show but the sentence, so the
 * body travels with the throw.
 */
export class Refusal extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly effect: unknown,
  ) {
    super(message)
    this.name = 'Refusal'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
      effect?: unknown
    }
    throw new Refusal(
      body.error ?? `${response.status} ${response.statusText}`,
      response.status,
      body.effect,
    )
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
  request<{ book: FiledBookRow }>(`/api/books/${id}/location`, {
    method: 'PATCH',
    body: JSON.stringify({ location }),
  })

/**
 * Check a book out, or check it in. Nothing is deleted either way.
 *
 * Asking for the state it is already in is a no-op: `outcome` says whether
 * anything changed, and `book` always carries the real, unmodified value.
 */
const setCheckedOut = (id: number, out: boolean) =>
  request<{ outcome: CheckoutOutcome; book: FiledBookRow; counts: Counts }>(
    `/api/books/${id}/checkout`,
    { method: 'POST', body: JSON.stringify({ out }) },
  )

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

  /**
   * One capture, and whether it is a second photographing of a book already in
   * the queue (#146).
   *
   * `duplicates` rides along on the poll the camera is already making rather
   * than being its own request or its own poll. It cannot be answered when the
   * photograph is handed over, because nothing has read it yet: the ISBN and
   * the hash both arrive on the background pass, and this is the call that
   * waits for that pass anyway.
   */
  getCapture: (id: number) =>
    request<{ capture: Capture; duplicates: QueueMatch[]; counts: QueueCounts }>(
      `/api/captures/${id}`,
    ),

  listCaptures: () =>
    request<{ captures: Capture[]; counts: QueueCounts }>('/api/captures'),

  claimCapture: (id: number, who: string) =>
    request<{ capture: Capture }>(`/api/captures/${id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ who }),
    }),

  /**
   * Persist what somebody has worked out about a capture still in the queue.
   *
   * Send only what was actually stated: on the server an absent key means
   * "nobody has decided this" and leaves the background worker free to fill it
   * in, while a present one means a person did and the worker must not touch
   * it. An empty body is a legitimate call and records that somebody looked at
   * this book and left it as it was.
   *
   * A changed `isbn13` re-runs the lookup server side and comes back in
   * `lookup`, so the correction and everything that hangs off it land in one
   * write rather than two the browser has to survive.
   *
   * `release` hands the capture back to the queue in the same request, and is
   * the only way to release one. `keepalive` asks the browser to send the
   * request even though the page that made it is going away, which is what
   * makes a closing tab still let go of the book. Both are explained in
   * `lib/leaveCapture.ts`, which is the only thing that passes them.
   */
  updateCapture: (
    id: number,
    who: string,
    edit: CaptureEdit = {},
    options: { release?: boolean; keepalive?: boolean } = {},
  ) =>
    request<{
      capture: Capture
      lookup: LookupResponse | null
      released: boolean
      counts: QueueCounts
    }>(
      `/api/captures/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          who,
          ...edit,
          ...(options.release ? { release: true } : {}),
        }),
        keepalive: options.keepalive,
      },
    ),

  deleteCapture: (id: number) =>
    request<{ ok: true; counts: QueueCounts; photosRemoved: number }>(
      `/api/captures/${id}`, { method: 'DELETE' },
    ),

  /**
   * There is no `saveFilingOverride` flag any more (#227).
   *
   * It used to decide whether a filing name somebody typed was kept for the
   * next book by the same author or applied to this one and forgotten, and the
   * client set it whenever the field had anything in it, so the two were never
   * really separate answers. A filing name belongs to the name now, on
   * `author_alias`, and every save that carries one files it.
   */
  saveBook: (
    draft: Draft,
    images: Partial<Record<'front' | 'back' | 'edge', string>>,
    captureId?: number,
  ) =>
    request<{ id: number; placement: PlacementResponse; counts: Counts; queue: QueueCounts }>(
      '/api/books',
      {
        method: 'POST',
        body: JSON.stringify({ ...draftBody(draft), images, captureId }),
      },
    ),

  /**
   * One book, and who it credits.
   *
   * The credits come with it because the review pane's filing field is about the
   * first-listed name, and what that name files under is a fact about the alias
   * rather than a column on the book (#227). A listing answers a `FiledBookRow`
   * because a listing joins it back on; a lookup of one book reads the model.
   */
  getBook: (id: number) => request<{ book: BookRow; authors: Credit[] }>(`/api/books/${id}`),

  setCheckedOut,

  checkedOut: () => request<{ books: FiledBookRow[] }>('/api/checked-out'),

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
   * anything, which leaves the recorded location exactly where it was, and now
   * leaves whether the book is on the bookcase alone for the same reason (#87).
   * Both are physical facts, both are observed at the shelf and nowhere else,
   * so one condition governs both: correcting a note cannot state where a book
   * is, and it cannot state that it is back either.
   *
   * Putting the book back is safe to say on every confirmed placement rather
   * than only when the caller believes the book was down, because asking for
   * the state a book is already in is a no-op and not a write (#15). So this
   * never invents a check-in, and never has to be told about one.
   *
   * Without this the guidance the person had just followed was never written
   * down, and misfile detection then reported that same book as needing to
   * make the move they had already made.
   */
  updateAndShelve: async (id: number, draft: Draft, shelvedAt: string) => {
    const result = await updateBook(id, draft)
    const observed = shelvedAt.trim()
    if (observed) {
      await setLocation(id, observed)
      await setCheckedOut(id, false)
    }
    return result
  },

  listBooks: (range: ShelfRange) =>
    request<{ books: FiledBookRow[]; counts: Counts }>(`/api/books?range=${range}`),

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
   * single step they would have to perform, and draws it, without changing
   * anything.
   *
   * Asking and doing are two calls because they are two different things. The
   * shelves are the record of where books physically are, so nothing about
   * them may change until somebody has actually carried a book: proposing a
   * move used to shift the boundary at once, which took the book off the plank
   * the person was still standing at and left it off if they walked away
   * (#111).
   *
   * `sortKey` is the book being placed, and passing it is what lets the server
   * answer with `carry`: when the book belongs at the end of the full shelf it
   * is the one that moves, and nothing already shelved is touched. Without it
   * the server can only see the shelves, so it can only offer to displace a
   * book that is on one, which is the extra handling #77 was about.
   */
  planOverflow: (
    range: ShelfRange,
    label: string,
    kind: 'shelf' | 'area',
    sortKey = '',
  ) =>
    request<{
      /** The book in your hand goes on instead. No id: it is not saved yet. */
      carry: { from: string; to: string } | null
      /** `id` is the displaced book, so where it lands can be recorded. */
      step: {
        id: number; title: string; from: string; to: string; authorFiling: string
      } | null
      /** The plank it is going on, with the gap where it goes. */
      strip: PlacementStrip | null
    }>('/api/shelves/overflow/plan', {
      method: 'POST',
      body: JSON.stringify({ range, label, kind, sortKey }),
    }),

  /**
   * The person says they have carried it, so the shelves change to match.
   *
   * `expectId` is the book they were told to move. The server recomputes the
   * step and refuses if the plank now ends with a different book, because a
   * cascade confirms its outermost move last (#110) and an answer given
   * against an arrangement that predates the last move is the bug #106 fixed.
   */
  overflowShelf: (
    range: ShelfRange,
    label: string,
    kind: 'shelf' | 'area',
    sortKey = '',
    expectId = 0,
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
      body: JSON.stringify({ range, label, kind, sortKey, expectId }),
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

  /**
   * Take a boundary move back, for a book nobody picked up.
   *
   * Not `moveAcrossBoundary` with the direction reversed. That asks where the
   * rules would put the book now; this puts the boundaries back where they were
   * before the move, which after a move that emptied an area is a different
   * plank. And it writes no location at all: the book never left the one the
   * catalogue records, so there is nothing about the room to say.
   *
   * Offered only for a misfile the server lists under `outstandingMoves`. The
   * server checks again, and rolls the whole thing back if putting the
   * boundaries back does not put the book back.
   */
  retractMove: (range: ShelfRange, id: number) =>
    request<{
      /** Which way the book went back, or null when nothing was outstanding. */
      move: { from: string; to: string } | null
      groups: ShelfGroupDto[]
      moves: Move[]
    }>('/api/shelves/retract', {
      method: 'POST',
      body: JSON.stringify({ range, id }),
    }),

  removeSeparator: (id: number, range: ShelfRange) =>
    request<{ groups: ShelfGroupDto[]; moves: Move[] }>(
      `/api/shelves/${id}?range=${range}`, { method: 'DELETE' },
    ),

  /** Books in this range that are not where they now belong. Read only. */
  misfiles: (range: ShelfRange) =>
    request<ShelvingReviewResponse>(`/api/misfiles?range=${range}`),

  /**
   * What moving a whole run onto another bookcase would mean. **Writes
   * nothing**, which is why it is safe to call as somebody changes their mind
   * about the number.
   */
  planRunMove: (range: ShelfRange, bookcase: number) =>
    request<RunMovePlan>('/api/placement/run/plan', {
      method: 'POST',
      body: JSON.stringify({ range, bookcase }),
    }),

  /**
   * Move it, and record where the rules now want every book.
   *
   * This still moves no books. What comes back is the plan that was applied and
   * the count of assignments written; the books are carried afterwards, and the
   * list of what is outstanding is the same needs-attention list the library
   * already shows.
   */
  applyRunMove: (range: ShelfRange, bookcase: number) =>
    request<{ plan: RunMovePlan; wrote: AssignmentReport }>('/api/placement/run', {
      method: 'POST',
      body: JSON.stringify({ range, bookcase }),
    }),

  setLocation,

  /*
   * The furniture (#307's routes, #313's screens).
   *
   * Ten calls, and not one of them takes a label: a label is worked out from
   * where a thing sits, so there is nothing to send and nothing worth keeping.
   * Every write answers with the thing re-described and with `becomes`, and a
   * screen redraws from that rather than from what it had.
   */

  /** The whole room: every piece on the floor and every area on its face. */
  furniture: () => request<FurnitureDto>('/api/fixtures'),

  addFixture: (piece: { kind?: string; name?: string; position?: number }) =>
    request<{ fixture: FixtureDto }>('/api/fixtures', {
      method: 'POST',
      body: JSON.stringify(piece),
    }),

  /**
   * Rename a piece, renumber it, or say what kind of thing it is.
   *
   * **Renumbering moves no book.** Every area keeps its id, so a book's
   * recorded location travels with the furniture; what changes is what the
   * areas are called, which is `becomes`.
   */
  editFixture: (
    id: number,
    piece: { kind?: string; name?: string; position?: number; sortStrategy?: SortStrategyCode },
  ) =>
    request<{ fixture: FixtureDto; becomes: LabelChange[] }>(`/api/fixtures/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(piece),
    }),

  /** What taking this piece away would mean, without taking it away. */
  fixtureRemoval: (id: number) =>
    request<{ removal: FixtureRemoval }>(`/api/fixtures/${id}/removal`),

  /** Refused while books stand on it, and the refusal says how many. */
  dropFixture: (id: number) =>
    request<{ removed: FixtureRemoval }>(`/api/fixtures/${id}`, { method: 'DELETE' }),

  addArea: (
    fixtureId: number,
    area: { name?: string; startsAt?: string; position?: number },
  ) =>
    request<{ area: AreaDto; becomes: LabelChange[] }>(`/api/fixtures/${fixtureId}/areas`, {
      method: 'POST',
      body: JSON.stringify(area),
    }),

  /**
   * Rename an area, move it along its piece, or give it an order of its own.
   *
   * The last one is refused with the effect attached until `acknowledge` is
   * set, because an area that orders itself takes no overflow and that cuts the
   * run it was in. The refusal arrives as a `Refusal` carrying what to show.
   */
  editArea: (
    id: number,
    area: {
      name?: string
      startsAt?: string
      position?: number
      sortStrategy?: SortStrategyCode
      acknowledge?: boolean
    },
  ) =>
    request<{ area: AreaDto; becomes: LabelChange[] }>(`/api/areas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(area),
    }),

  /** What removing an area would do to its books. Writes nothing. */
  areaRemoval: (id: number) =>
    request<{ plan: AreaRemovalPlan }>(`/api/areas/${id}/removal`),

  /**
   * Take an area off a piece and let its books fall into the next one along.
   *
   * Closer to a merge than a deletion: no book is deleted and none is moved.
   * What is written is where the rules now want each book, and the difference
   * between that and where somebody last saw it is the needs-attention list.
   */
  dropArea: (id: number) =>
    request<{ plan: AreaRemovalPlan }>(`/api/areas/${id}`, { method: 'DELETE' }),

  health: () => request<{ ok: boolean; counts: Counts; db: string }>('/api/health'),
}

export const emptyDraft: Draft = {
  isbn13: '', isbn10: '', title: '', subtitle: '', authors: '', publisher: '',
  published: '', pages: '', notes: '', genre: FICTION_SLUG,
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
    genre: result.classification.genre,
    classificationSource: 'auto',
    classificationConfidence: result.classification.confidence,
    seriesName: result.seriesName,
    seriesIndex: result.seriesIndex === null ? '' : String(result.seriesIndex),
    lookupSource: result.source,
  }
}

/** Parse a capture's JSON column without letting a bad one break the page. */
function parseJson<T>(raw: string): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** What the background worker made of a capture's photographs. */
export function lookupOn(capture: Capture): LookupResponse | null {
  return parseJson<LookupResponse>(capture.draft_json)
}

/** What a person stated about a capture while it sat in the queue. */
export function editsOn(capture: Capture): CaptureEdit {
  return parseJson<CaptureEdit>(capture.edit_json) ?? {}
}

/**
 * A queued capture as the worker left it, with nothing a person said on top.
 *
 * `title_guess` is deliberately not in here (#156). It is `coverLines[0]`, the
 * first line OCR read off a photograph, and this draft is what the review
 * pane's Title box is filled from and what Save writes to the catalogue. A
 * guess poured into that box is saved by the next person who agrees with
 * everything on the screen, and the catalogue then holds a machine's reading
 * of a photograph that is indistinguishable from a title somebody confirmed.
 * That is the whole of #147, and it was still true one field over.
 *
 * The guess is not thrown away: it names the row in the queue, through
 * `captureName`, which is a use it is good enough for. An ISBN read off a
 * barcode is kept because it is self-validating and was confirmed against a
 * catalogue before it was written.
 */
function machineDraft(capture: Capture): Draft {
  const looked = lookupOn(capture)
  return looked?.found
    ? draftFromLookup(looked, capture.isbn_source)
    : {
        ...emptyDraft,
        isbn13: capture.isbn13,
        isbn10: capture.isbn10,
        isbnSource: capture.isbn_source,
      }
}

/**
 * A queued capture in the shape the review pane edits.
 *
 * The whole precedence rule, on the reading side: the worker's lookup is the
 * base, and whatever a person stated goes on top of it, field by field. That
 * is what makes the middle person's work durable across a handoff. The two
 * live in separate columns, so a re-analysis can improve the base underneath
 * without ever displacing a correction laid over it.
 */
export function draftFromCapture(capture: Capture): Draft {
  const base = machineDraft(capture)
  const stated = editsOn(capture)
  const patch: Partial<Draft> = {}
  for (const key of [
    'isbn13', 'isbn10', 'isbnSource', 'title', 'subtitle', 'publisher',
    'published', 'pages', 'notes', 'classificationSource',
    'classificationConfidence', 'seriesName', 'location', 'lookupSource',
  ] as const) {
    if (stated[key] !== undefined) patch[key] = stated[key] as string
  }
  if (stated.authors !== undefined) patch.authors = stated.authors.join(', ')
  if (stated.genre !== undefined) patch.genre = stated.genre
  if (stated.seriesIndex !== undefined) {
    patch.seriesIndex = stated.seriesIndex === null ? '' : String(stated.seriesIndex)
  }
  if (stated.authorFilingOverride !== undefined) {
    patch.authorFilingOverride = stated.authorFilingOverride ?? ''
  }

  return { ...base, ...patch }
}

/** What to call a capture on a screen that lists several of them. */
export interface CaptureName {
  /** What to draw. Never empty, because a row with no name is unworkable. */
  text: string
  /**
   * True when `text` is the OCR guess and nothing better. Callers draw that
   * differently, so somebody reading a stack of rows can tell a title the app
   * was told from one it read off a photograph.
   *
   * False for the number, which is not a guess: it is the capture's own id.
   */
  guessed: boolean
}

/**
 * Naming a capture, which is a different job from filling in its Title box.
 *
 * Those two used to be one value and that is the defect in #156. A queue of
 * unresolved captures that all read "Book #41", "Book #42" is unworkable, so
 * the machine's reading has to be allowed to name a row; but a name is read
 * and discarded, and a field is saved. So the guess names rows here, marked as
 * a guess, and reaches no draft anywhere.
 *
 * Order: what anybody stated or a catalogue confirmed, then the guess, then
 * the number. A capture has no catalogue id and often no title at all.
 */
export function captureName(capture: Capture): CaptureName {
  const confirmed = draftFromCapture(capture).title.trim()
  if (confirmed) return { text: confirmed, guessed: false }

  const guess = capture.title_guess.trim()
  if (guess) return { text: guess, guessed: true }

  return { text: `Book #${capture.id}`, guessed: false }
}

/**
 * What changed between the capture as it was put in front of somebody and the
 * draft they are looking at now.
 *
 * A difference, not the whole draft, and that is the point. On the server a
 * key that is present means a person decided that field and the background
 * worker must leave it alone, so sending every field would freeze the worker
 * out of a capture because somebody fixed one word in the title. Fields the
 * person did not touch are not claimed on their behalf.
 *
 * Returns an empty object when nothing changed, which is still worth sending:
 * it records that somebody looked and left the book as it was.
 */
export function editFromDraft(draft: Draft, shown: Draft): CaptureEdit {
  const edit: CaptureEdit = {}

  for (const key of [
    'isbn13', 'isbn10', 'isbnSource', 'title', 'subtitle', 'publisher',
    'published', 'pages', 'notes', 'classificationSource',
    'classificationConfidence', 'seriesName', 'location', 'lookupSource',
  ] as const) {
    if (draft[key] !== shown[key]) edit[key] = draft[key]
  }

  if (draft.authors !== shown.authors) {
    edit.authors = draft.authors.split(',').map((a) => a.trim()).filter(Boolean)
  }
  if (draft.genre !== shown.genre) edit.genre = draft.genre
  if (draft.seriesIndex !== shown.seriesIndex) {
    edit.seriesIndex = draft.seriesIndex.trim() === '' ? null : Number(draft.seriesIndex)
  }
  if (draft.authorFilingOverride !== shown.authorFilingOverride) {
    edit.authorFilingOverride = draft.authorFilingOverride.trim() || null
  }

  return edit
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
    // The genre tag's own answer, read back off the range it settled on. The
    // client sends a slug and reads one, and `books.is_fiction` is gone (#227).
    genre: genreOfRange(book.shelf_range),
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

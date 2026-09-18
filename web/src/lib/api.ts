import type {
  AreaStanding, Excluded, ExcludedReason, Misfile, Placement, ShelfRange, ShelfSlot,
  ShelvingReview,
} from '../../shared/shelving'
import type { AuthState, SessionAnswer, SignInProvider } from '../../shared/auth'
import type { FailureCounts } from '../../shared/captureFailure'
import { genreOfRange, type GenreSlug } from '../../domain/tagging/genre'
import type { BookState } from '../../domain/books/state'

/**
 * Naming boundary, recorded here because this file is the only client to
 * server path. The wire and database field `shelf` (also `shelf_range`,
 * `ShelfRange`, `ShelfGroupDto.shelf`, the `kind: 'shelf'` separator tag) names
 * a whole bookcase, and the UI shows that same unit as "Bookcase". The plank
 * within it is `area` on both sides. A `shelf` value needs that translation
 * before it goes on screen.
 */

export interface Classification {
  /** Null when no catalogue stated a genre. The classifier does not guess one. */
  genre: GenreSlug | null
  confidence: 'high' | 'medium' | 'weak' | 'unknown'
  reason: string
}

export interface CataloguedBook {
  id: number
  title: string
  location: string
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
  duplicateOf: CataloguedBook | null
}

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
  /** Null when nothing states a genre, and a save then writes no genre tag. */
  genre: GenreSlug | null
  classificationSource: string
  classificationConfidence: string
  seriesName: string
  seriesIndex: string
  location: string
  lookupSource: string
  isbnSource: string
  authorFilingOverride: string
}

export interface StripBook {
  id: number
  title: string
  authorFiling: string
  /** Filename of the photo standing in for the spine, or '' when there is none. */
  spine: string
  /** Which face `spine` actually is. A cover never passes for a spine. */
  spineSlot: ShelfSlot
  /**
   * Thickness, which is pages, as the catalogue holds it: text, and empty where
   * the catalogue has no page count. A book with no count is drawn at the median
   * of the ones that have one.
   */
  pages?: string
}

/**
 * The label is what somebody reads and the id is what the app sends back: a
 * label is derived from where a piece stands and what its owner called it, so it
 * can name a plank by a name nobody uses now. `areaId` is null only for a plank
 * a proposal would make and has not made yet.
 */
export interface Plank {
  areaId: number | null
  label: string
}

export interface LabelChange {
  from: string
  to: string
}

/**
 * `empties` is set for the one move that removes furniture: a book alone in an
 * area is both its first and its last book, so both directions are open and
 * either leaves the area with no books to name.
 */
export interface BoundaryOffer extends Plank {
  empties: {
    areas: string[]
    /** Every label that reads differently once they are gone. */
    becomes: LabelChange[]
  } | null
}

/**
 * A boundary move empties the area before it takes it. Removing the line itself
 * takes an area with its books still on it, and they join the one above.
 */
export interface AreaGoing {
  area: string
  /** The area its books join. Empty when there are none to hand over. */
  into: string
  books: number
  /** Every label that reads differently once it is gone. */
  becomes: LabelChange[]
}

export interface PlacementStrip {
  label: string
  books: StripBook[]
  /** How many books sit to the left of the gap, or -1 when there is no gap. */
  gapIndex: number
  /**
   * Where the book sits in the row when it is shelved and still filed
   * correctly. Null when it has yet to be put anywhere.
   */
  placedIndex: number | null
  /**
   * Which plank a boundary move would land this book on, in each direction.
   * Null in a direction this book cannot move; absent altogether when
   * `placedIndex` is null, since only a book settled in its recorded position
   * can be offered one. The server refuses the move itself regardless.
   */
  boundary?: { next: BoundaryOffer | null; previous: BoundaryOffer | null }
}

export interface PlacementResponse extends Placement {
  authorFiling: string
  sortKey: string
  derivedLocation?: string
  /**
   * That same plank, said as the plank. Null when the run has no plank to put
   * this book on, which is a rule pointing at furniture somebody has taken out.
   */
  derivedAreaId?: number | null
  strip?: PlacementStrip | null
}

export interface Counts {
  total: number
  fiction: number
  nonfiction: number
  checkedOut: number
}

/** The counters and not a verdict. `server/source-watch.ts` defines each. */
export interface SourceStanding {
  source: string
  asked: number
  /** Requests it replied to, whether or not it had the book. */
  answered: number
  silent: number
  /** Replies that had a record of the book. */
  held: number
  /** Replies that had no record of the book. Ordinary, and not a failure. */
  noRecord: number
  /** Requests it heard and refused: 401, 403 or 429. */
  declined: number
  /** Requests that failed for any other reason. */
  failed: number
  /** Times it was wanted and not asked, to stay inside its rate. */
  skipped: number
  /** When it last did not answer, ISO 8601, or empty. */
  lastSilentAt: string
  /** Why it last did not answer, from a closed vocabulary. Never a key. */
  lastSilence: string
}

/**
 * `googleBooksKeyConfigured` is a boolean and stays one: a length, a prefix or a
 * masked form would all leak the key.
 */
export interface LookupStandings {
  googleBooksKeyConfigured: boolean
  sources: SourceStanding[]
}

/**
 * The states are the server's own words rather than a sentence, so the interface
 * decides how to say each one. `server/backup-watch.ts` explains each.
 */
export interface BackupWatch {
  state: 'unwatched' | 'unreachable' | 'none' | 'unverified' | 'stale' | 'fresh'
  /** Where it looked. Empty when nothing is watched. */
  where: string
  /** The age a proved backup is allowed to reach, in hours. */
  limitHours: number
  /** Why the directory could not be read. Only on `unreachable`. */
  why?: string
  /** The newest backup on the disk, whatever its verification says. */
  newest?: { dump: string; takenAt: string }
  /** The newest backup a verification passed on. */
  verified?: { dump: string; takenAt: string }
  /** How old `verified` is, in whole hours. */
  ageHours?: number
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
  /**
   * Where a person last said this book physically is, as a label to read. A
   * rendering and only that: nothing is decided from it and nothing is grouped
   * by it. See `area_id` and `standing`.
   */
  location: string
  /** The area `location` renders, or null for a book nobody has placed. */
  area_id: number | null
  /** The piece that area hangs on and where the two of them stand. Null with `area_id`. */
  standing: AreaStanding | null
  /** Which run this book is in, which is what its genre tag settled on. */
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
  state: BookState
  /** Publisher cover from the catalogue, not a photograph of this copy. */
  cover_image: string
  /**
   * The three photos cut to the book. Empty where the detector has not looked or
   * could not find the book.
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
 * `author_filing` is not a column on `books`: it is a fact about the first
 * credit's alias, and the server's views join it back on.
 */
export interface FiledBookRow extends BookRow {
  author_filing: string
}

/**
 * The names come in the order they are printed on the book, and the first is the
 * one the shelf orders by. `filingName` is the alias's own answer, either the
 * heuristic's or a correction somebody made to it.
 */
export interface Credit {
  position: number
  aliasId: number
  authorId: number
  displayName: string
  filingName: string
}

/**
 * Every field is optional and an absent one narrows nothing. `range` must be
 * spelled `'all'` for the whole collection: an absent one means fiction.
 */
export interface BookQuery {
  range?: 'all' | ShelfRange
  /** Titles and the names on the cover, near enough rather than exact. */
  q?: string
  /** Either form of the number. At most one answer. */
  isbn?: string
  /** Slugs, all of which a book must carry, itself or under. */
  tags?: readonly string[]
  /** One of the three states a catalogued book is in. Absent means all of them. */
  state?: BookState
  limit?: number
  offset?: number
}

function bookQuery(query: BookQuery): string {
  const asked = new URLSearchParams()
  if (query.range) asked.set('range', query.range)
  if (query.q) asked.set('q', query.q)
  if (query.isbn) asked.set('isbn', query.isbn)
  if (query.state) asked.set('state', query.state)
  for (const tag of query.tags ?? []) asked.append('tag', tag)
  if (query.limit !== undefined) asked.set('limit', String(query.limit))
  if (query.offset) asked.set('offset', String(query.offset))
  return asked.toString()
}

/**
 * The count rolls up: choosing Fantasy shows the books tagged Urban fantasy too.
 * `slug` is the identity and no screen may draw it; `label` is what a person
 * reads.
 */
export interface TagRow {
  slug: string
  label: string
  note: string
  books: number
  /**
   * A placement rule asks for this tag. The only thing that separates two tags
   * with no books on them: a word somebody made and never used, and a bookcase
   * set up for a subject before anything was bought for it.
   */
  ruled: boolean
}

export interface AppliedTag {
  slug: string
  label: string
  source: 'person' | 'catalogue' | 'guess'
  confidence: string
}

/** One row of a book's ledger: something that happened to where it is. */
export interface Been {
  /** `placed`, `assigned`, `checked_out`, `checked_in`, `pinned`, `withdrawn`. */
  kind: string
  location: string
  /** `person` or `app`, which is what makes a carry different from a decision. */
  actor: string
  reason: string
  at: string
}

/** An author, who holds no name: the names are the aliases. */
export interface AuthorDto {
  id: number
  isCorporate: boolean
  note: string
  primary: string
  aliases: { id: number; displayName: string; filingName: string; isPrimary: boolean }[]
}

/**
 * The two labels are what somebody reads on the way to the shelf; the two ids are
 * what gets written down. Neither will do on its own: on a named bookcase the
 * label is not the string the layout numbers the plank with, and a label read off
 * a screen a minute old can name a plank by a name nobody uses now. `toAreaId` is
 * null for one plank only, the one a proposal would make and has not made yet.
 */
export interface PlankStep {
  from: string
  to: string
  fromAreaId: number | null
  toAreaId: number | null
}

export interface Move extends PlankStep {
  id: number
  title?: string
}

export interface ShelfGroupDto {
  area: number
  shelf: number
  /**
   * What the board is called, worked out from the furniture: `4A` on a piece
   * nobody has named and `Hall shelf · A` on one somebody has.
   */
  label: string
  /**
   * The area this board is, or null where the furniture has no row for it. What
   * says two boards are one board: `label` is a rendering and two pieces standing
   * on one number render the same, so nothing decides anything from it.
   */
  areaId: number | null
  /**
   * The piece the board hangs on, and where on it. `standing.kind` is the owner's
   * own word, so a crate reads as a crate.
   */
  standing: AreaStanding | null
  books: { book: FiledBookRow }[]
  /**
   * The boundary this area begins at, if it is not the first: its own boundary,
   * never the one after it. The line for it is drawn above this area's heading,
   * and `libraryRows` in shared/layout.ts is what decides that.
   */
  opensWith: { id: number; kind: 'shelf' | 'area' } | null
}

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
 * Asking to check out a book that is already out, or in one that is already in,
 * does not touch its timestamp, so a no-op is reported as one.
 */
export type CheckoutOutcome = 'checked-out' | 'already-out' | 'checked-in' | 'already-in'

/**
 * None of these is an action and none of them changed anything. `identified` is a
 * barcode that named a catalogued row; `candidates` is a shortlist to put in
 * front of a person. Where the flow goes next is the client's decision.
 */
export type ScanResult =
  | { outcome: 'no-isbn'; barcodes: string[]; candidates: CoverMatch[] }
  | { outcome: 'candidates'; barcodes: string[]; candidates: CoverMatch[] }
  | { outcome: 'in-queue'; matches: QueueMatch[] }
  | { outcome: 'not-catalogued'; isbn13: string }
  | { outcome: 'identified'; book: FiledBookRow }

export interface QueueMatch {
  capture: Capture
  /**
   * Differing bits out of 64, held to `QUEUE_LIMIT`. Null, and not 0, when the
   * match came from the ISBN rather than from the pictures: nothing was compared,
   * so there is no measurement.
   */
  distance: number | null
  /**
   * What settled it. `isbn` is an exact identifier with its own check digit and
   * beats any comparison of photographs; `cover` is the perceptual hash.
   */
  basis: 'isbn' | 'cover'
}

export interface CheckedOutAt {
  book: FiledBookRow
  /**
   * The area it would go back on. Null where the run has no plank to name, which
   * is a rule pointing at furniture that has been taken out.
   */
  areaId: number | null
  label: string
}

export type { Misfile, Excluded, ExcludedReason, ShelfSlot, ShelvingReview }

/**
 * `outstandingMoves` tells "you moved this and have not carried it yet", which
 * can be taken back, from "a newcomer pushed this along", which cannot.
 */
export interface ShelvingReviewResponse extends ShelvingReview {
  /** Book ids whose misfile is an outstanding boundary move. */
  outstandingMoves: number[]
}

/**
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
  /**
   * Every piece the move would leave standing with nothing on its face. Nothing
   * is deleted and the piece keeps standing.
   */
  emptied: { name: string; position: number; planks: number }[]
  groups: PlanGroup[]
  moving: number
  /** Books the rules leave exactly where they are. */
  staying: number
  /** Everything the rules will not touch, and why. Never silently dropped. */
  skipped: SkippedBooks[]
  /** Books no rule claims at all. */
  unclaimed: PlannedBook[]
}

/**
 * Everything the arrange screen needs before it offers anything, as the server's
 * answer rather than the screen's reading of a list of books.
 */
export interface RunMoveOffer {
  /** The bookcase the run starts on, or null when its rule points nowhere. */
  from: number | null
  /**
   * Every plank a move would take with it, in the order they read. A plank
   * holding no books is in this list, because it is a plank of the run.
   */
  planks: { label: string; books: number }[]
  /** Why this run cannot be moved, or null when it can. */
  why: string | null
}

/**
 * The slug and not the label: a rule stored against a label would stop matching
 * the day the tag was renamed, and every book it claimed would move with nothing
 * saying why.
 */
export interface RuleDraftLine {
  operator: 'is' | 'under'
  tag: string
  /**
   * What to call it, for a word the collection has not used yet, and set on
   * nothing else: a line quoting a tag somebody already keeps has its label on
   * the row, and sending one up would be a rename arriving through a rule.
   */
  label?: string
}

/** `id` is null for a rule that has not been written yet. */
export interface DraftRule {
  id: number | null
  conditions: RuleDraftLine[]
}

/**
 * A list, because a list is how this app says "or": "and" is another line on one
 * rule, "or" is another rule on the same place. Both point at the same area, and
 * there is no group inside a group anywhere in it.
 */
export interface RuleDraft {
  about: 'area' | 'fixture'
  placeId: number
  rules: DraftRule[]
}

/**
 * Nothing has been written when this arrives: it is the sentence in front of the
 * write, and the write answers with the same thing again.
 */
export interface RuleChangePlan {
  groups: PlanGroup[]
  moving: number
  staying: number
  skipped: SkippedBooks[]
  unclaimed: PlannedBook[]
  /** What the place would hold, every rule on it joined by "or". */
  holds: string
  /** What each rule would be called, worked out from its own lines. */
  names: string[]
  /**
   * How many rules are written on this place today, which is what tells taking
   * the last rule off a place from a draft that is not a change at all.
   */
  already: number
  /** How many books anywhere in the collection any of these rules claim. */
  claiming: number
  /** Whether the place gains its first rule, and so stops taking overflow. */
  opens: boolean
  /** Stretches of books that would be left with no rule anchoring them. */
  losing: string[]
  /**
   * The other places asking for books these rules ask for, and how the tie went.
   * Two places wanting one tag is allowed, and it is the one thing the counts
   * cannot say.
   */
  alsoClaims: AlsoClaims[]
}

export interface AlsoClaims {
  /** What that place reads as: a plank for an area rule, a piece for a fixture. */
  place: string
  /** How many books both places ask for. */
  books: number
  /** How many of those that place keeps, because its rule is tried first. */
  keeps: number
}

/*
 * No label is stored anywhere and none is sent back up. Every `label` here is
 * worked out by the server at the moment it answered, from a piece's number and
 * name and an area's ordinal and name, so a screen that kept one in state would
 * be drawing a name for a piece somebody has since renamed. Every write answers
 * with the piece or area re-described and with `becomes`: read from the answer,
 * never from memory.
 */

export interface LabelChange {
  from: string
  to: string
}

export interface CarriedBook {
  id: number
  title: string
  authorFiling: string
  /**
   * Filename under `/api/covers` for the photograph this book is drawn by
   * standing up, already chosen by the server. '' where it has none, which is a
   * real book and not a missing one.
   */
  spine: string
  /** The same for a book lying face up. */
  cover: string
}

export interface CarryTrip {
  /** The areas as rows rather than as labels: a label is derived and can move. */
  fromAreaId: number
  toAreaId: number
  /** Where the books are now, as the label reads off the furniture. */
  from: string
  to: string
  /**
   * The number two pieces stand on, when both ends of this trip read the same: a
   * trip nobody can walk, and a real arrangement rather than a mistake. Null on
   * nearly every trip.
   */
  sharedNumber: number | null
  books: CarriedBook[]
  /** How many of this trip are already at the other end. */
  carried: number
}

/** What the newest change of mind did to a list somebody was part way through. */
export interface CarryChange {
  left: number
  joined: number
  /** Of those, the ones somebody had already carried once. */
  again: { book: CarriedBook; from: string; to: string }[]
}

/**
 * A trip somebody decided not to walk, kept on the list rather than forgotten.
 * The books stand where they stood and nothing asks for them any more.
 */
export interface SetAside {
  fromAreaId: number
  toAreaId: number
  from: string
  to: string
  books: number
  /** The rules that asked, named as they were when they asked. */
  rules: string[]
}

export interface CarryWork {
  moving: number
  trips: CarryTrip[]
  /** Everything the rules will not move, and why. Never silently dropped. */
  skipped: { reason: SkipReason; books: number }[]
  /** What was carried on the most recent day anybody carried anything. */
  carried: { books: number; when: string }
  changed: CarryChange | null
  /** Work taken off the list by leaving the books where they are. */
  setAside: SetAside[]
}

/** One book on the carry list, flattened out of its trip. */
export interface CarryItem {
  book: CarriedBook
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
  placeId: number | null
  enabled: boolean
  /**
   * What it asks, in the words a person reads: labels, and no slugs. The identity
   * never travels on a reading route. Writing has a read of its own,
   * `api.placeRules`.
   */
  conditions: {
    operator: 'is' | 'under'
    tag: string
    /**
     * Books carrying it, counting the ones under it. Zero is a real state: a
     * shelf somebody prepared before the books arrived.
     */
    carried: number
  }[]
  /** The whole of it as one phrase: "Anything tagged Cookery". */
  said: string
  /**
   * Which stretch of books this is the rule for. A rule with one of these is the
   * row `planRunMove` and `applyRunMove` retarget; null says this app cannot
   * point that rule anywhere yet.
   */
  range: ShelfRange | null
}

/**
 * A `StripBook` with the ordering components added. Keeping the same three fields
 * under the same three names is what lets `spineLabel` and the shelf mapping in
 * `lib/bookLook.ts` take either without a second spelling of them.
 */
export interface AreaBook {
  id: number
  title: string
  authorFiling: string
  /** The photograph standing in for the spine, or '' when there is none. */
  spine: string
  /** Which face `spine` really is. A cover never passes for a spine. */
  spineSlot: ShelfSlot
  /** How thick it is, as the catalogue holds it, which is text. */
  pages: string
  /** How it files by title, which is what the title ordering reads. */
  titleFiling: string
  /** As printed, usually a bare year, which is what the year ordering reads. */
  published: string
  /** Where it sits in the order, which is what a boundary is anchored to. */
  sortKey: string
  /** Every slug it carries, in slug order, which is what a rule matches on. */
  tagSlugs: string[]
  /** The same tags as a person reads them, in the same order. Never a slug. */
  tags: string[]
  /** The rule that claims it, by name, or null when nothing claims it. */
  claimedBy: string | null
}

export interface FixtureBooks {
  fixture: { id: number; label: string; books: number }
  books: AreaBook[]
}

/**
 * Asked by identity rather than by label: a label is derived at read time from
 * four things any of which can change.
 */
export interface AreaBooks {
  /**
   * `gone` is a plank that has been taken out with books still standing on it.
   * The page opens rather than 404ing, because those books are recorded there
   * until somebody carries them, but it must not offer to take the area out again.
   */
  area: { id: number; label: string; books: number; gone: boolean }
  books: AreaBook[]
}

export interface AtAPlace {
  areaId: number
  label: string
}

export interface RuleClaim {
  rule: RuleDto
  won: boolean
  why: string
}

/**
 * `claims` is empty for a book no rule claims at all, which is a real state
 * rather than a gap: nothing states a genre, no tag is written, and the rules
 * have nowhere to put it.
 */
export interface BookClaim {
  book: { id: number; title: string; authorFiling: string }
  /** Where somebody last said it is. Null when nobody ever has. */
  standing: AtAPlace | null
  /** Where the rules want it. Null when no rule claims it. */
  wanted: AtAPlace | null
  claims: RuleClaim[]
  /** The tags it carries, by label. Never by slug: a slug is an identity. */
  tags: string[]
  /** A person put it here for good, which beats every rule. */
  pinned: boolean
  checkedOut: boolean
  withdrawn: boolean
}

/**
 * `untagged` is a book carrying no tag at all, so every rule fails at its first
 * condition and the only way out is somebody saying what it is. `unmatched` is a
 * book carrying tags no rule asks for, where what is missing is a rule.
 */
export type Unclaimed = 'untagged' | 'unmatched'

export interface UnclaimedBook {
  id: number
  title: string
  authorFiling: string
  /** Where somebody last said it stands. Null when nobody ever has. */
  standing: AtAPlace | null
  /** What it carries, by label and never by slug. Empty when `untagged`. */
  tags: string[]
  why: Unclaimed
}

/**
 * The two fields are the two readings, named after where each one comes from
 * rather than after which is right, because neither of them is known to be. A
 * disagreement says one of the two is wrong and never which.
 */
export interface DriftingBook {
  bookId: number
  title: string
  /** The place the app draws it in, which is where somebody will look for it. */
  fromLayout: string
  /** The place the rules claim it into. Empty when no rule claims it. */
  fromRules: string
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
  /** True for a plank taken out that books are still standing on. */
  gone: boolean
  holds: string
  entry: boolean
  /** The rule whose stretch of books reaches here, which may be the piece's. */
  rule: RuleDto | null
  /**
   * Every rule written on this area, which is a different question from `rule`:
   * that one is about the stretch and may belong to the piece. There can be more
   * than one, because two rules on a place is how this app says "or".
   */
  own: RuleDto[]
}

export interface FixtureDto {
  id: number
  position: number
  label: string
  kind: string
  name: string
  sortStrategy: SortStrategyCode
  note: string
  /** Every book standing on the piece, planks taken out included. */
  books: number
  /** The areas the piece has, in the order they sit on its face. */
  areas: AreaDto[]
  /**
   * The planks taken out that still have books standing on them. Apart from
   * `areas` because they are not on the piece: they cannot be reordered,
   * renumbered or counted as part of the face.
   */
  gone: AreaDto[]
  /** Other pieces standing on this piece's number. Reported, never refused. */
  sharing: number[]
  holds: string
  rule: RuleDto | null
  /** Every rule written on the piece itself. Two of them is "or". */
  own: RuleDto[]
}

export interface FurnitureDto {
  fixtures: FixtureDto[]
  defaultSortStrategy: SortStrategyCode
  strategies: { code: SortStrategyCode; label: string; isInherit: boolean }[]
}

export interface FixtureRemoval {
  /** Standing on one of its planks, or assigned to one and not carried yet. */
  books: number
  /** How many of `books` are on their way to it rather than standing on it. */
  assigned: number
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
   * How many books the rules refile into `into`, not how many books that area
   * then holds. An assignment is what the rules want; where a book is is what
   * somebody last said, and only the location route changes that.
   */
  joining: number
  skipped: { reason: SkipReason; books: number }[]
  becomes: LabelChange[]
}

export interface StandingBook extends CarriedBook {
  pages: number
  going: boolean
  /**
   * Why it is not going. Null for the ones that are. `left` is a book somebody
   * decided to leave where it stands, which is not `settled`: settled means the
   * rules want it here.
   */
  staying: 'pinned' | 'elsewhere' | 'settled' | 'left' | null
}

export interface TripAtAnArea {
  from: string
  to: string
  fromAreaId: number
  toAreaId: number
  /** See `CarryTrip.sharedNumber`. The same walk, drawn at the shelf. */
  sharedNumber: number | null
  /** Everything on the area, in shelf order, staying books included. */
  books: StandingBook[]
}

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
   * The three photos cut to the book, as filenames under /api/covers. A crop is
   * derived from the photograph, never a replacement for it. Empty both where the
   * detector has not looked and where it looked and declined; `cropped` is what
   * tells those two apart.
   */
  front_crop: string
  back_crop: string
  edge_crop: string
  /**
   * Slots the detector has looked at, comma separated, whether or not it found a
   * book. A slot named here with an empty crop column was examined and declined.
   * Empty means none have been looked at.
   */
  cropped: string
}

/**
 * Every field is optional, because a request carries only what was actually
 * stated. Mirrors the server's `CaptureEdit`.
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
  /** See `Draft.genre`. Absent is nobody having said; null is nobody knowing. */
  genre?: GenreSlug | null
  classificationSource?: string
  classificationConfidence?: string
  seriesName?: string
  seriesIndex?: number | null
  location?: string
  lookupSource?: string
  authorFilingOverride?: string | null
}

/**
 * `failures` breaks `failed` down, because the three situations behind it need
 * different things from a person.
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
 * A refusal the caller can do something about, with the body attached. The
 * furniture routes answer 409 with an `effect` a screen has to show first, and a
 * plain `Error` would throw that away.
 */
export class Refusal extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly effect: unknown,
    /**
     * Which of the three states the gate said this caller is in, when the gate is
     * what refused, and absent on every other refusal. Carried rather than
     * inferred from `status`, so this client never decides for itself that a 403
     * somewhere else means somebody is on the waiting list.
     */
    readonly authState?: AuthState,
  ) {
    super(message)
    this.name = 'Refusal'
  }
}

/**
 * Any request can be the one that finds out the session has died, and the screen
 * that has to change is the whole app, so the answer travels out of here rather
 * than back to the caller. `app/gate.tsx` is the one listener. A set rather than
 * a single slot because `StrictMode` mounts an effect twice in development, and
 * the second mount would silently replace the first.
 */
const watchers = new Set<(state: AuthState) => void>()

/**
 * Returns the way to stop listening. Called by the gate provider and by nothing
 * else: two listeners deciding what the app draws would be two answers.
 */
export function whenTheGateRefuses(watcher: (state: AuthState) => void): () => void {
  watchers.add(watcher)
  return () => { watchers.delete(watcher) }
}

export function theGateSaid(state: AuthState): void {
  for (const watcher of watchers) watcher(state)
}

function stateIn(body: { state?: unknown }): AuthState | undefined {
  return body.state === 'anonymous' || body.state === 'waiting' || body.state === 'admitted'
    ? body.state
    : undefined
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    /*
     * Stated although it is also what `fetch` does by default: every path this
     * client asks for is relative, so every request is same-origin. The cost of
     * the default moving, or of an `init` overriding it, is every request in this
     * app answering 401 with nothing saying why. See `docs/auth-surface.md`.
     */
    credentials: 'same-origin',
    ...init,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
      effect?: unknown
      state?: unknown
    }
    const state = stateIn(body)
    /*
     * Told before the throw, so the app has already begun changing by the time
     * whichever caller this was decides what to do with its own error.
     */
    if (state && state !== 'admitted') theGateSaid(state)
    throw new Refusal(
      body.error ?? `${response.status} ${response.statusText}`,
      response.status,
      body.effect,
      state,
    )
  }
  return (await response.json()) as T
}

function draftBody(draft: Draft) {
  return {
    ...draft,
    authors: draft.authors.split(',').map((a) => a.trim()).filter(Boolean),
    seriesIndex: draft.seriesIndex.trim() === '' ? null : Number(draft.seriesIndex),
    authorFilingOverride: draft.authorFilingOverride.trim() || null,
  }
}

/**
 * Write the edits to a book the catalogue already holds. It deliberately sends
 * an empty `location`: the draft's own `location` is a label the app rendered,
 * nothing on the edit form changes it, and on a named bookcase nothing parses
 * that label back to a plank, so sending it would be refused. `setLocation` is
 * the only call that changes a recorded location.
 */
const updateBook = (id: number, draft: Draft) =>
  request<{ id: number; placement: PlacementResponse; counts: Counts }>(
    `/api/books/${id}`,
    { method: 'PUT', body: JSON.stringify({ ...draftBody(draft), location: '' }) },
  )

/**
 * Say where a book physically is now. The only call that changes a recorded
 * location: nothing derives this and nothing writes it on somebody's behalf.
 */
const setLocation = (id: number, location: string) =>
  request<{ book: FiledBookRow }>(`/api/books/${id}/location`, {
    method: 'PATCH',
    body: JSON.stringify({ location }),
  })

/**
 * The same, said as the plank rather than as its name, for a screen acting on a
 * row the server drew. A label is derived from where a piece stands and what it
 * is called, so a list read a minute ago can name a plank by a name nobody uses
 * now.
 */
const setLocationIn = (id: number, areaId: number) =>
  request<{ book: FiledBookRow }>(`/api/books/${id}/location`, {
    method: 'PATCH',
    body: JSON.stringify({ areaId }),
  })

/**
 * Check a book out, or check it in. Asking for the state it is already in is a
 * no-op: `outcome` says whether anything changed, and `book` always carries the
 * real value.
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

  /**
   * `excludeId` keeps a book being edited out of its own neighbour search.
   * `goingTo` is the plank a walk is taking this book to: without it the answer
   * is where the rules say the book belongs. Only the carry flow sends it, and it
   * sends the trip's own destination, fixed when the armful was lifted.
   */
  previewPlacement: (draft: Draft, excludeId?: number, goingTo?: number) =>
    request<PlacementResponse>('/api/placement/preview', {
      method: 'POST',
      body: JSON.stringify({ ...draftBody(draft), excludeId, goingTo }),
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
   * `duplicates` and `catalogued` are two different findings: one is a book
   * somebody has photographed and not shelved, the other a book on a shelf.
   * `catalogued` is null both when the collection does not hold this ISBN and
   * when nobody has read an ISBN off the photographs yet.
   */
  getCapture: (id: number) =>
    request<{
      capture: Capture
      duplicates: QueueMatch[]
      catalogued: CataloguedBook | null
      counts: QueueCounts
    }>(`/api/captures/${id}`),

  /**
   * `reading` is the capture id the background pass has in its hands, null when
   * it is not reading anything, and absent from an older server.
   */
  listCaptures: () =>
    request<{ captures: Capture[]; counts: QueueCounts; reading?: number | null }>(
      '/api/captures',
    ),

  claimCapture: (id: number, who: string) =>
    request<{ capture: Capture }>(`/api/captures/${id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ who }),
    }),

  /**
   * Send only what was actually stated: on the server an absent key leaves the
   * background worker free to fill that field in, and a present one means a
   * person decided it and the worker must not touch it. An empty body is
   * legitimate and records that somebody looked and left the book as it was. A
   * changed `isbn13` re-runs the lookup server side and comes back in `lookup`.
   * `release` is the only way to release a capture, and `keepalive` is what makes
   * a closing tab still let go of one; see `lib/leaveCapture.ts`.
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

  /**
   * Send a capture back through the reader. It comes back `pending`, and the
   * queue is already polling while anything is pending, so the row updates itself
   * from there without this having to wait.
   */
  readCaptureAgain: (id: number) =>
    request<{ capture: Capture; counts: QueueCounts }>(
      `/api/captures/${id}/read`, { method: 'POST' },
    ),

  deleteCapture: (id: number) =>
    request<{ ok: true; counts: QueueCounts; photosRemoved: number }>(
      `/api/captures/${id}`, { method: 'DELETE' },
    ),

  /**
   * A filing name belongs to the name, on `author_alias`, so every save that
   * carries one files it.
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
   * One book, and who it credits. The credits come with it because what a name
   * files under is a fact about the alias rather than a column on the book.
   */
  getBook: (id: number) => request<{ book: BookRow; authors: Credit[] }>(`/api/books/${id}`),

  setCheckedOut,

  backfillCovers: (limit = 10) =>
    request<{ tried: number; fetched: number; remaining: number }>(
      '/api/backfill/covers',
      { method: 'POST', body: JSON.stringify({ limit }) },
    ),

  /**
   * Photo in, an identity out. Deliberately has no direction argument and no way
   * to gain one: the scanner finds out which book is being held up and nothing
   * else. Changing a book's state is `setCheckedOut`.
   */
  scanBook: (image: string) =>
    request<ScanResult>('/api/books/scan', {
      method: 'POST',
      body: JSON.stringify({ image }),
    }),

  updateBook,

  /**
   * Save a catalogued book and record the shelf it has just been put on. Two
   * calls, because they are two kinds of statement: the server will not let an
   * edit change a position, and the shelving step is the one that observed it.
   * `shelvedAt` null is an ordinary edit, which leaves both the recorded location
   * and whether the book is on the bookcase alone. It is the plank and not its
   * label, because on a named bookcase there are two strings for a row. Putting
   * the book back is safe to say on every confirmed placement, because asking for
   * the state a book is already in is a no-op rather than a write.
   */
  updateAndShelve: async (id: number, draft: Draft, shelvedAt: number | null) => {
    const result = await updateBook(id, draft)
    if (shelvedAt !== null) {
      await setLocationIn(id, shelvedAt)
      await setCheckedOut(id, false)
    }
    return result
  },

  /**
   * The listing, narrowed and a page at a time. `total` is what the query matched
   * and `counts` is the whole collection, which is what makes "6 of 1,204 books"
   * one response rather than two.
   */
  findBooks: (query: BookQuery = {}) =>
    request<{ books: FiledBookRow[]; total: number; counts: Counts }>(
      `/api/books?${bookQuery(query)}`,
    ),

  tags: () => request<{ tags: TagRow[] }>('/api/tags'),

  bookTags: (id: number) => request<{ tags: AppliedTag[] }>(`/api/books/${id}/tags`),

  /**
   * Somebody saying what a book is, which is `source: 'person'`, the only kind of
   * tag no automatic rewrite may take back. The tag is defined if the collection
   * has not got it yet and applied in the one call. Which slug and which label is
   * decided by `domain/tagging/naming.ts` before this is called. It reaches a
   * queued capture as readily as a shelved book, because a capture is a row in
   * `books` from its first photograph.
   */
  applyTag: (id: number, tag: { slug: string; label: string }) =>
    request<{ tags: AppliedTag[] }>(`/api/books/${id}/tags`, {
      method: 'POST',
      body: JSON.stringify(tag),
    }),

  /** Taking one back off, whoever put it there. */
  removeTag: (id: number, slug: string) =>
    request<{ tags: AppliedTag[] }>(
      `/api/books/${id}/tags?slug=${encodeURIComponent(slug)}`,
      { method: 'DELETE' },
    ),

  /**
   * Making a word with no book in your hand. The same body `applyTag` sends, and
   * which slug and which label are `domain/tagging/naming.ts` before either is
   * called, so the doors onto naming a tag cannot drift apart.
   */
  defineTag: (tag: { slug: string; label: string }) =>
    request<{ tag: TagRow }>('/api/tags', {
      method: 'POST',
      body: JSON.stringify(tag),
    }),

  /**
   * Refused with a 409 and a sentence when a book carries the tag or a rule asks
   * for it. The screen draws that sentence rather than working the reason out
   * again from the row it happens to be holding.
   */
  forgetTag: (slug: string) =>
    request<{ removed: string }>(`/api/tags?slug=${encodeURIComponent(slug)}`, {
      method: 'DELETE',
    }),

  /**
   * Where a book has been, newest first. Read only: the four statements that
   * write a placement are all on the server.
   */
  placements: (id: number) =>
    request<{ been: Been[]; total: number }>(`/api/books/${id}/placements`),

  bookAuthors: (id: number) => request<{ authors: Credit[] }>(`/api/books/${id}/authors`),

  /** Everything else by the person behind one of a book's credits. */
  authorBooks: (id: number) =>
    request<{ author: AuthorDto; books: BookRow[] }>(`/api/authors/${id}/books`),

  deleteBook: (id: number) =>
    request<{ ok: true; counts: Counts; photosRemoved: number }>(
      `/api/books/${id}`, { method: 'DELETE' },
    ),

  /**
   * `begins` is what the first plank of the run is called, and null when no rule
   * says where the range begins. It is the only thing that tells an empty
   * `groups` apart from a range nothing places.
   */
  shelves: (range: ShelfRange) =>
    request<{
      groups: ShelfGroupDto[]
      checkedOut: CheckedOutAt[]
      begins?: string | null
    }>(
      `/api/shelves?range=${range}`,
    ),

  /**
   * The person at the shelf says it will not take another book. Returns the
   * single step they would have to perform, without changing anything: the
   * shelves record where books physically are, so nothing about them may change
   * until somebody has actually carried a book. `sortKey` is the book being
   * placed, and passing it is what lets the server answer with `carry`, where the
   * book in hand moves and nothing already shelved is touched.
   */
  planOverflow: (
    range: ShelfRange,
    areaId: number,
    kind: 'shelf' | 'area',
    sortKey = '',
  ) =>
    request<{
      /** The book in your hand goes on instead. No id: it is not saved yet. */
      carry: PlankStep | null
      /** `id` is the displaced book, so where it lands can be recorded. */
      step: (PlankStep & { id: number; title: string; authorFiling: string }) | null
      /** The plank it is going on, with the gap where it goes. */
      strip: PlacementStrip | null
    }>('/api/shelves/overflow/plan', {
      method: 'POST',
      body: JSON.stringify({ range, areaId, kind, sortKey }),
    }),

  /**
   * The person says they have carried it, so the shelves change to match.
   * `expectId` is the book they were told to move: the server recomputes the step
   * and refuses if the plank now ends with a different book, because a cascade
   * confirms its outermost move last.
   */
  overflowShelf: (
    range: ShelfRange,
    areaId: number,
    kind: 'shelf' | 'area',
    sortKey = '',
    expectId = 0,
  ) =>
    request<{
      /** The book in your hand goes on instead. No id: it is not saved yet. */
      carry: PlankStep | null
      /** `id` is the displaced book, so where it lands can be recorded. */
      step: (PlankStep & { id: number; title: string }) | null
      groups: ShelfGroupDto[]
      moves: Move[]
    }>('/api/shelves/overflow', {
      method: 'POST',
      body: JSON.stringify({ range, areaId, kind, sortKey, expectId }),
    }),

  /**
   * Move the boundary so the first or last book of an area belongs on the plank
   * next door. Only the furniture changes, deliberately: saying which plank the
   * book is physically on goes through the shelving step and its
   * `PATCH .../location`, so until somebody says so the book is genuinely not
   * where the catalogue has it. `theAreaGoes` means a person read what the one
   * move that removes furniture would do and pressed the button that does it, and
   * the server refuses without it.
   */
  moveAcrossBoundary: (
    range: ShelfRange,
    id: number,
    direction: 'next' | 'previous',
    theAreaGoes = false,
  ) =>
    request<{
      move: (PlankStep & { id: number; title: string }) | null
      groups: ShelfGroupDto[]
      moves: Move[]
    }>('/api/shelves/move', {
      method: 'POST',
      body: JSON.stringify({ range, id, direction, theAreaGoes }),
    }),

  /**
   * Take a boundary move back, for a book nobody picked up. Not
   * `moveAcrossBoundary` with the direction reversed: that asks where the rules
   * would put the book now, while this puts the boundaries back where they were,
   * which after a move that emptied an area is a different plank. It writes no
   * location at all, because the book never left the one the catalogue records.
   */
  retractMove: (range: ShelfRange, id: number) =>
    request<{
      /** Which way the book went back, or null when nothing was outstanding. */
      move: PlankStep | null
      groups: ShelfGroupDto[]
      moves: Move[]
    }>('/api/shelves/retract', {
      method: 'POST',
      body: JSON.stringify({ range, id }),
    }),

  /**
   * Take the line between two areas out, merging the one below into the one above
   * it. `theAreaGoes` says somebody has been asked, and the server refuses
   * without it; the refusal arrives as a `Refusal` carrying an `AreaGoing` as its
   * `effect`, which is what the dialog reads.
   */
  removeSeparator: (id: number, range: ShelfRange, theAreaGoes = false) =>
    request<{ groups: ShelfGroupDto[]; moves: Move[] }>(
      `/api/shelves/${id}?range=${range}&theAreaGoes=${theAreaGoes}`, { method: 'DELETE' },
    ),

  /** Books in this range that are not where they now belong. Read only. */
  misfiles: (range: ShelfRange) =>
    request<ShelvingReviewResponse>(`/api/misfiles?range=${range}`),

  /**
   * Where a run lives, what it is cut into, and whether it can be moved. Writes
   * nothing.
   */
  runMoveOffer: (range: ShelfRange) =>
    request<RunMoveOffer>(`/api/placement/run?range=${range}`),

  /**
   * What moving a whole run onto another bookcase would mean. Writes nothing, so
   * it is safe to call as somebody changes their mind about the number.
   */
  planRunMove: (range: ShelfRange, bookcase: number) =>
    request<RunMovePlan>('/api/placement/run/plan', {
      method: 'POST',
      body: JSON.stringify({ range, bookcase }),
    }),

  /**
   * Move it, and record where the rules now want every book. This still moves no
   * books: what comes back is the plan that was applied and the count of
   * assignments written, and the books are carried afterwards.
   */
  applyRunMove: (range: ShelfRange, bookcase: number) =>
    request<{ plan: RunMovePlan; wrote: AssignmentReport }>('/api/placement/run', {
      method: 'POST',
      body: JSON.stringify({ range, bookcase }),
    }),

  /**
   * The rules on one place, in the shape they go back in. The one read in this
   * app that answers a tag by its identity rather than by its label, because that
   * is what writing needs.
   */
  placeRules: (about: 'area' | 'fixture', placeId: number) =>
    request<{ rules: DraftRule[] }>(
      `/api/placement/rule?about=${about}&placeId=${placeId}`,
    ),

  /** What changing what a place allows would do. Writes nothing. */
  planRuleChange: (draft: RuleDraft) =>
    request<{ plan: RuleChangePlan }>('/api/placement/rule/plan', {
      method: 'POST',
      body: JSON.stringify(draft),
    }),

  /**
   * Write the rule, and record where the rules now want every book. Still moves
   * no books: they go on the carry list.
   */
  applyRuleChange: (draft: RuleDraft) =>
    request<{ plan: RuleChangePlan; wrote: AssignmentReport }>('/api/placement/rule', {
      method: 'POST',
      body: JSON.stringify(draft),
    }),

  /**
   * Everything still to be carried. Read only, and worked out afresh. See
   * `server/carry.ts`.
   */
  carry: () => request<CarryWork>('/api/carry'),

  /**
   * One trip, read at the area the books come off. The areas go over as ids
   * rather than labels, because somebody renaming a bookcase between the list and
   * the trip would send this at a plank that no longer answers to the label.
   */
  carryTrip: (from: number, to: number) =>
    request<TripAtAnArea>(`/api/carry/trip?from=${from}&to=${to}`),

  /**
   * Leave these books where they are, and stop the list asking for them. No book
   * moves: it writes down that the answer was declined and nothing else. A trip,
   * or the whole of the outstanding work when none is named.
   */
  carryLeave: (trip?: { from: number; to: number }) =>
    request<{ books: number; work: CarryWork }>('/api/carry/leave', {
      method: 'POST',
      body: JSON.stringify(trip ?? {}),
    }),

  /** Ask for that work again, which is the way back out of the one above. */
  carryRestore: (trip?: { from: number; to: number }) =>
    request<{ books: number; work: CarryWork }>('/api/carry/restore', {
      method: 'POST',
      body: JSON.stringify(trip ?? {}),
    }),

  setLocation,
  setLocationIn,

  /*
   * The furniture. Not one of these calls takes a label: a label is worked out
   * from where a thing sits, so there is nothing to send and nothing worth
   * keeping. Every write answers with the thing re-described and with `becomes`,
   * and a screen redraws from that rather than from what it had.
   */

  furniture: () => request<FurnitureDto>('/api/fixtures'),

  /**
   * What the whole collection falls back on when nothing nearer has an opinion.
   * Refused for `inherit`, which has nothing above it to ask, and for `tag`,
   * which is a way to order one area and not a way to order a house.
   */
  editCollection: (defaultSortStrategy: SortStrategyCode) =>
    request<{ collection: { defaultSortStrategy: SortStrategyCode } }>('/api/collection', {
      method: 'PATCH',
      body: JSON.stringify({ defaultSortStrategy }),
    }),

  addFixture: (piece: { kind?: string; name?: string; position?: number }) =>
    request<{ fixture: FixtureDto }>('/api/fixtures', {
      method: 'POST',
      body: JSON.stringify(piece),
    }),

  /**
   * Rename a piece, renumber it, or say what kind of thing it is. Renumbering
   * moves no book: every area keeps its id, so a book's recorded location travels
   * with the furniture, and what changes is what the areas are called.
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

  /**
   * Add an area to a piece. Given nothing, the server decides where it opens.
   * `startsAt` is still how a boundary is placed deliberately, and the empty
   * string means "from the beginning" rather than "you choose".
   */
  addArea: (
    fixtureId: number,
    area: { name?: string; startsAt?: string; position?: number } = {},
  ) =>
    request<{ area: AreaDto; becomes: LabelChange[] }>(`/api/fixtures/${fixtureId}/areas`, {
      method: 'POST',
      body: JSON.stringify(area),
    }),

  /**
   * Rename an area, move it along its piece, or give it an order of its own. The
   * last is refused with the effect attached until `acknowledge` is set, because
   * an area that orders itself takes no overflow and that cuts the run it was in.
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

  /**
   * The books standing in one area, by identity rather than by label: a rename, a
   * reorder or two pieces standing on one number would each pick the wrong books
   * without saying anything.
   */
  areaBooks: (id: number) => request<AreaBooks>(`/api/areas/${id}/books`),

  /** The same, about a whole piece: every book standing on its face, in order. */
  fixtureBooks: (id: number) => request<FixtureBooks>(`/api/fixtures/${id}/books`),

  /**
   * Why a book is where it is. Read only, and an empty `claims` is the honest
   * answer for a book no rule claims rather than an error.
   */
  bookClaim: (id: number) => request<{ claim: BookClaim }>(`/api/books/${id}/claim`),

  /**
   * Every book no rule claims, and how many there are. `total` sits beside a
   * capped page. Read only, and it must stay that way: what settles one of these
   * books is a person saying what it is, through `applyTag`.
   */
  unclaimed: () =>
    request<{ books: UnclaimedBook[]; total: number }>('/api/placement/unclaimed'),

  /**
   * Every book the shelf and the rules disagree about, and how many. `total` sits
   * beside a capped page. Read only, and there is nothing to write to: repairing
   * a disagreement erases how it happened.
   */
  drift: () =>
    request<{ books: DriftingBook[]; total: number }>('/api/placement/drift'),

  /** What removing an area would do to its books. Writes nothing. */
  areaRemoval: (id: number) =>
    request<{ plan: AreaRemovalPlan }>(`/api/areas/${id}/removal`),

  /**
   * Take an area off a piece and let its books fall into the next one along.
   * Closer to a merge than a deletion: no book is deleted and none is moved, and
   * what is written is where the rules now want each book.
   */
  dropArea: (id: number) =>
    request<{ plan: AreaRemovalPlan }>(`/api/areas/${id}`, { method: 'DELETE' }),

  /**
   * The counts on the first screen, and what the catalogues have been doing. The
   * endpoint also answers `db` and `placement`, which have no screen and are
   * typed here only as far as this client reads them.
   */
  health: () =>
    request<{ ok: boolean; counts: Counts; db: string; lookups: LookupStandings }>(
      '/api/health',
    ),

  /**
   * Whether there is a backup of this collection anybody has proved restores.
   * Nothing here says whether a scheduled job started. See
   * `server/backup-watch.ts`.
   */
  backup: () => request<BackupWatch>('/api/backup'),

  /**
   * The only calls here that answer to somebody with no session, grouped so that
   * is visible. Everything else on this object is behind the gate and answers
   * `401` or `403` to the same caller.
   */
  auth: {
    /**
     * Which of the three states this browser is in, asked of the server. The
     * client never decides this and never caches it: the gate reads `enabled` off
     * the user row on every request so that disabling somebody takes effect on
     * their next one, and a cached answer here would throw that away.
     */
    session: () => request<SessionAnswer>('/api/auth/session'),

    /**
     * The ways in, as the server lists them: the sign-in screen draws this answer
     * rather than a list written into it. The development door is in here like
     * any other and is deliberately not told apart.
     */
    providers: () => request<{ providers: SignInProvider[] }>('/api/auth/providers'),

    /**
     * Give up the session in this browser's cookie. Not `request`, because this
     * answers `204` with no body and `request` parses one.
     */
    signOut: async (): Promise<void> => {
      const response = await fetch('/api/auth/signout', {
        method: 'POST',
        credentials: 'same-origin',
      })
      if (!response.ok) {
        throw new Refusal(
          `${response.status} ${response.statusText}`,
          response.status,
          undefined,
        )
      }
    },
  },
}

export const emptyDraft: Draft = {
  isbn13: '', isbn10: '', title: '', subtitle: '', authors: '', publisher: '',
  // No genre, because an empty draft is nothing having been said about a book
  // and fiction is something.
  published: '', pages: '', notes: '', genre: null,
  classificationSource: 'auto', classificationConfidence: 'unknown',
  seriesName: '', seriesIndex: '', location: '', lookupSource: '',
  isbnSource: '', authorFilingOverride: '',
}

/**
 * `isbnSource` is not in the lookup and cannot be: the catalogue only knows the
 * number it was asked about, not how the number was read, so the caller passes
 * it.
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
 * `title_guess` is deliberately not in here: it is the first line OCR read off a
 * photograph, and this draft fills the Title box that Save writes to the
 * catalogue, so the guess would become indistinguishable from a confirmed title.
 * It names the row in the queue instead, through `captureName`.
 */
function machineDraft(capture: Capture): Draft {
  const looked = lookupOn(capture)
  const base = looked?.found
    ? draftFromLookup(looked, capture.isbn_source)
    : {
        ...emptyDraft,
        isbn13: capture.isbn13,
        isbn10: capture.isbn10,
        isbnSource: capture.isbn_source,
      }
  /*
   * The row's own columns have the last word about the identifier, and only about
   * the identifier: a catalogue's record is not obliged to carry the number it was
   * found by, and Open Library answers plenty of editions with no ISBN-13 on them
   * at all. Nothing else falls back like this, because a title or an author off
   * the row would be a machine's reading promoted into a box somebody saves.
   */
  return {
    ...base,
    isbn13: base.isbn13 || capture.isbn13,
    isbn10: base.isbn10 || capture.isbn10,
  }
}

/**
 * The precedence rule on the reading side: the worker's lookup is the base, and
 * whatever a person stated goes on top of it, field by field. The two live in
 * separate columns, so a re-analysis can improve the base underneath without
 * displacing a correction laid over it.
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

/**
 * The identifier a reading produced, laid into a draft that has none, for the
 * camera, where there is no draft to read a capture into. The identifier and
 * nothing else, because no catalogue answered and what OCR read off the cover is
 * evidence rather than an answer. An empty box is filled in; one somebody has
 * already answered is left exactly as it is.
 */
export function withReadIsbn(
  draft: Draft,
  capture: Pick<Capture, 'isbn13' | 'isbn10' | 'isbn_source'>,
): Draft {
  if (!capture.isbn13 && !capture.isbn10) return draft
  if (draft.isbn13 || draft.isbn10) return draft
  return {
    ...draft,
    isbn13: capture.isbn13,
    isbn10: capture.isbn10,
    isbnSource: capture.isbn_source,
  }
}

export interface CaptureName {
  /** What to draw. Never empty, because a row with no name is unworkable. */
  text: string
  /**
   * True when `text` is the OCR guess and nothing better, so callers can draw it
   * differently. False for the number, which is not a guess but the capture's own
   * id.
   */
  guessed: boolean
}

/**
 * Naming a capture, which is a different job from filling in its Title box: a
 * name is read and discarded, and a field is saved, so the guess names rows here,
 * marked as a guess, and reaches no draft anywhere. Order: what anybody stated or
 * a catalogue confirmed, then the guess, then the number.
 */
export function captureName(capture: Capture): CaptureName {
  const confirmed = draftFromCapture(capture).title.trim()
  if (confirmed) return { text: confirmed, guessed: false }

  const guess = capture.title_guess.trim()
  if (guess) return { text: guess, guessed: true }

  return { text: `Book #${capture.id}`, guessed: false }
}

/**
 * A difference, not the whole draft: on the server a key that is present means a
 * person decided that field and the background worker must leave it alone, so
 * sending every field would freeze the worker out of a capture because somebody
 * fixed one word in the title. An empty object is still worth sending, because it
 * records that somebody looked and left the book as it was.
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
    // The genre tag's own answer, read back off the range it settled on. Null for
    // a book in neither run, which must not come up showing a tag nothing stated.
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

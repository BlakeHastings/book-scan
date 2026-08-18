import type {
  Excluded, ExcludedReason, Misfile, Placement, ShelfRange, ShelfSlot,
  ShelvingReview,
} from '../../shared/shelving'
import type { FailureCounts } from '../../shared/captureFailure'
import { genreOfRange, type GenreSlug } from '../../domain/tagging/genre'

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
   *
   * **Null when no source stated one** (#304). The ladder in
   * `server/classify.ts` reasons from what a catalogue said, and its last rung
   * has nothing to reason from; a slug there would be a guess the save then
   * wrote as a tag.
   */
  genre: GenreSlug | null
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
  /**
   * The genre this draft states, as a slug, or null when nothing states one.
   *
   * See `Classification.genre`. Null is what the review pane draws with neither
   * option highlighted, and what a save writes no genre tag for (#304).
   */
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
  /**
   * How thick the book is, as the catalogue holds it, which is text.
   *
   * The one measurement a drawing of a shelf may take from a book: pages are
   * thickness and thickness is width seen end on. Empty for about one book in
   * four, which is drawn at the median of the ones that are not.
   */
  pages?: string
}

/**
 * One plank, said both ways.
 *
 * **The label is what somebody reads and the id is what the app sends back.** A
 * label is derived from where a piece stands and what its owner called it, so a
 * screen drawn a minute ago can name a plank by a name nobody uses now, and on a
 * named bookcase it is not even the string the layout numbers the plank with.
 * The id is the plank. See #356, and #359 for the writing half of it.
 *
 * Null only for a plank a proposal would make and has not made yet.
 */
export interface Plank {
  areaId: number | null
  label: string
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
  boundary?: { next: Plank | null; previous: Plank | null }
}

export interface PlacementResponse extends Placement {
  authorFiling: string
  sortKey: string
  /** What the plank the shelving step asks about is called, for the person. */
  derivedLocation?: string
  /**
   * That same plank, said as the plank (#359).
   *
   * What "It fits, save" writes down and what "no room" is asked about. Null
   * when the run has no plank to put this book on, which is a rule pointing at
   * furniture somebody has taken out, and the step refuses rather than guessing.
   */
  derivedAreaId?: number | null
  strip?: PlacementStrip | null
}

export interface Counts {
  total: number
  fiction: number
  nonfiction: number
  /** Catalogued but physically off the shelf. */
  checkedOut: number
}

/**
 * What the server found where the backups are kept.
 *
 * The states are the server's own words and the wire carries them rather than a
 * sentence, so the interface decides how to say each one and the server keeps
 * deciding what is true. `server/backup-watch.ts` explains each.
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

/**
 * What a listing is being narrowed to.
 *
 * Every field is optional and an absent one narrows nothing, so `{}` is what
 * the library opens on. `range` is `'all'` for the whole collection, which is
 * spelled out because an absent one has meant fiction since the route existed.
 */
export interface BookQuery {
  range?: 'all' | ShelfRange
  /** Titles and the names on the cover, near enough rather than exact. */
  q?: string
  /** Either form of the number. At most one answer. */
  isbn?: string
  /** Slugs, all of which a book must carry, itself or under. */
  tags?: readonly string[]
  limit?: number
  offset?: number
}

function bookQuery(query: BookQuery): string {
  const asked = new URLSearchParams()
  if (query.range) asked.set('range', query.range)
  if (query.q) asked.set('q', query.q)
  if (query.isbn) asked.set('isbn', query.isbn)
  for (const tag of query.tags ?? []) asked.append('tag', tag)
  if (query.limit !== undefined) asked.set('limit', String(query.limit))
  if (query.offset) asked.set('offset', String(query.offset))
  return asked.toString()
}

/**
 * One tag in the vocabulary, and how many books it has.
 *
 * The count rolls up: choosing Fantasy shows the books tagged Urban fantasy
 * too, so this is the number of books choosing it produces.
 *
 * **`slug` is the identity and no screen may draw it.** `label` is what a
 * person reads, and the nesting is said with an indent and in words.
 */
export interface TagRow {
  slug: string
  label: string
  note: string
  books: number
}

/** A tag on one book, drawn as firmly as whoever said it. */
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
  /** The plank it names, as the label reads off the furniture. */
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
 * A book going from one plank to another, said both ways at both ends.
 *
 * The two labels are what somebody reads on the way to the shelf; the two ids
 * are what gets written down when they say the book is there (#359). Both are
 * needed and neither will do on its own: on a bookcase whose owner has named it,
 * the label is not the string the layout numbers the plank with, and a label
 * read off a screen a minute old can name a plank by a name nobody uses now.
 *
 * `toAreaId` is null for one plank only: the one a proposal would make and has
 * not made yet, which cannot be written to because it does not exist.
 */
export interface PlankStep {
  from: string
  to: string
  fromAreaId: number | null
  toAreaId: number | null
}

export interface Move extends PlankStep {
  id: number
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
  /**
   * Every piece the move would leave standing with nothing on its face.
   *
   * A run flows on past the bookcase its rule points at, so a piece somebody put
   * up after it and has not filled yet is the tail of that run whether or not
   * they think of it that way, and moving the run takes its planks. Nothing is
   * deleted and the piece keeps standing (#391); this is what says so before
   * anybody presses anything.
   */
  emptied: { name: string; position: number; planks: number }[]
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

/**
 * One line of a rule as a screen sends it back, which is a slug and a question.
 *
 * **The slug and not the label.** The label is what somebody read on the way to
 * choosing the tag; the slug is what the rule is about. A rule stored against a
 * label would stop matching the day the tag was renamed, and every book it
 * claimed would move with nothing anywhere saying why.
 */
export interface RuleDraftLine {
  operator: 'is' | 'under'
  /** A tag slug, taken off the vocabulary this app already reads. */
  tag: string
  /**
   * What to call it, for a word the collection has not used yet (#392).
   *
   * **Set on nothing else.** A line quoting a tag somebody already keeps has its
   * label on the row, and sending one up would be a rename arriving through a
   * rule. This is the one case where the label is not yet anywhere: the word
   * becomes a tag at the same press the rule becomes a row, so until then the
   * draft is the only thing that knows what it is to be called.
   *
   * The server does not take it on trust. It goes back through the same rule
   * that decides what a word means anywhere else in this app, and a word
   * something already means is refused rather than written a second time.
   */
  label?: string
}

/** One rule being written: the row it already is, and what it now asks. */
export interface DraftRule {
  id: number | null
  conditions: RuleDraftLine[]
}

/**
 * Every rule written on one place, which is what is planned and written.
 *
 * A list, because a list is how this app says "or" (#384): **and** is another
 * line on one rule, **or** is another rule on the same place. Both point at the
 * same area, so which one `claim` picks makes no difference to where a book
 * lands, and there is no group inside a group anywhere in it.
 */
export interface RuleDraft {
  about: 'area' | 'fixture'
  placeId: number
  rules: DraftRule[]
}

/**
 * What changing what a place allows would do, over the whole catalogue.
 *
 * The same shape a run move answers with, plus the facts a count cannot carry.
 * Nothing has been written when this arrives: it is the sentence in front of the
 * write, and the write answers with the same thing again.
 */
export interface RuleChangePlan {
  groups: PlanGroup[]
  /** Books to carry. The headline number. */
  moving: number
  staying: number
  skipped: SkippedBooks[]
  unclaimed: PlannedBook[]
  /** What the place would hold, every rule on it joined by "or". */
  holds: string
  /** What each rule would be called, worked out from its own lines. */
  names: string[]
  /**
   * How many rules are written on this place today, beside how many there would
   * be. The pair is what tells taking the last rule off a place from a draft
   * that is not a change at all (#391).
   */
  already: number
  /** How many books anywhere in the collection any of these rules claim. */
  claiming: number
  /** Whether the place gains its first rule, and so stops taking overflow. */
  opens: boolean
  /** Stretches of books that would be left with no rule anchoring them. */
  losing: string[]
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

/**
 * The books still to be carried, as the trips somebody would walk.
 *
 * **The unit is a trip, not a book**, which is the whole shape of the flow: a
 * list of fifty books in book order is fifty walks across a room, and "22 books,
 * 4C to 3C" is one. Ordered by where the books come off, biggest piece of
 * furniture first, because taking a book off means finding it among the ones
 * that are staying and putting one down does not.
 *
 * There is nothing stored behind this and nothing to go stale: it is `assigned`
 * disagreeing with `placed`, worked out afresh every time it is asked for.
 */
export interface CarriedBook {
  id: number
  title: string
  authorFiling: string
  /**
   * The photograph this book is drawn by standing up, or '' where it has none.
   *
   * Filenames under `/api/covers`, already chosen: the server asks
   * `shared/shelving.ts` which photograph stands in for a spine and which for a
   * cover, so a book on a carry screen is drawn by the same picture the library
   * draws it by. **A book with no photograph is a real book**, and '' is what
   * says so; the cloth behind the picture is what it is drawn in, here exactly
   * as everywhere else.
   */
  spine: string
  /** The same for a book lying face up, which is what a row shows. */
  cover: string
}

export interface CarryTrip {
  /** The areas as rows rather than as labels: a label is derived and can move. */
  fromAreaId: number
  toAreaId: number
  /** Where the books are now, as the label reads off the furniture. */
  from: string
  to: string
  books: CarriedBook[]
  /** How many of this trip are already at the other end. */
  carried: number
}

/** What the newest change of mind did to a list somebody was part way through. */
export interface CarryChange {
  /** Books it took off the list. */
  left: number
  /** Books it put on. */
  joined: number
  /** Of those, the ones somebody had already carried once. */
  again: { book: CarriedBook; from: string; to: string }[]
}

/**
 * A trip somebody decided not to walk, kept on the list rather than forgotten.
 *
 * The books stand where they stood and nothing asks for them any more. What is
 * still true is that a rule on that place wants them somewhere else, and only
 * the person can decide whether to change it, so the pair and the count and the
 * rule's name stay on the screen.
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
  /** Books to carry. The headline number. */
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

/**
 * One book on the carry list, flattened out of its trip.
 *
 * The first screen names three books and counts the rest, which is a list of
 * books rather than of trips. It is the shape `reviewShelving` answered in,
 * kept, so that screen did not have to change: **what changed under it is which
 * question is being asked.** This is `assigned` disagreeing with `placed`, the
 * ledger's own list, rather than a recorded label compared against one derived
 * from the sort order.
 */
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
  /** Which area or piece that is, so a screen can name a piece its own way. */
  placeId: number | null
  enabled: boolean
  /**
   * What it asks, in the words a person reads. **Labels, and no slugs.**
   *
   * The identity is what a rule is really about, and it never travels on a
   * reading route. Writing has a read of its own, `api.placeRules`, which
   * answers the same rules in the shape they go back in.
   */
  conditions: {
    operator: 'is' | 'under'
    tag: string
    /**
     * Books carrying it, counting the ones under it. **Zero is a real state**:
     * a shelf somebody prepared before the books arrived asks for a word nothing
     * has yet, and the screen says it is waiting rather than drawing it exactly
     * like a rule that claims forty books.
     */
    carried: number
  }[]
  /** The whole of it as one phrase: "Anything tagged Cookery". */
  said: string
  /**
   * Which stretch of books this is the rule for, or null.
   *
   * **This is what makes a rule changeable from the furniture screens** (#323).
   * A rule with one of these is the row `planRunMove` and `applyRunMove`
   * retarget, so "point it somewhere else" is the journey #244 already built
   * rather than a second way to do the same thing. A null says this app cannot
   * point that rule anywhere yet, which is what the screen says.
   */
  range: ShelfRange | null
}

/**
 * One book standing somewhere, in the order it stands there.
 *
 * It carries every component any ordering reads, because the screens about a
 * place now show what its sort rule does to these books rather than only naming
 * the rule. Picking another ordering reorders the books in front of somebody,
 * which is the answer to "why do they sort like that" and is also the warning
 * before the change is written.
 */
/**
 * One book standing in a place.
 *
 * **It is a `StripBook` with the ordering components added**, and that is not a
 * coincidence: since #405 an area's books are drawn standing on a board, and a
 * board is drawn from a photograph and a thickness. Keeping the same three
 * fields under the same three names is what lets `spineLabel` and the shelf
 * mapping in `lib/bookLook.ts` take either without a second spelling of them.
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

/** What is standing on one piece of furniture, across all of its areas. */
export interface FixtureBooks {
  fixture: { id: number; label: string; books: number }
  books: AreaBook[]
}

/**
 * What is standing in one area, asked **by identity**.
 *
 * The route #318 said was missing. Splitting an area needs the books in it, and
 * until this existed the screen asked for both stretches of shelving and matched
 * an area by its *label*, which is derived at read time from four things any of
 * which can change. This asks for the area by its row instead.
 */
export interface AreaBooks {
  /**
   * `gone` is a plank that has been taken out with books still standing on it.
   *
   * The page opens rather than 404ing, because those books are recorded there
   * until somebody carries them and this is the one screen that can show them.
   * What it must not do is offer to take the area out again.
   */
  area: { id: number; label: string; books: number; gone: boolean }
  books: AreaBook[]
}

/** A place, as a screen names one: the row, and what it reads as today. */
export interface AtAPlace {
  areaId: number
  label: string
}

/** A rule that wanted a book, and whether it got it. The losers are the point. */
export interface RuleClaim {
  rule: RuleDto
  won: boolean
  why: string
}

/**
 * Why a book is where it is.
 *
 * `claims` is empty for a book **no rule claims at all**, which is a real state
 * since #304 rather than a gap: nothing states a genre, no tag is written, and
 * the rules have nowhere to put it. `wanted` is null for the same book.
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
 * Why no rule claims a book, which is two states and not one (#341).
 *
 * - `untagged`: it carries no tag at all, which is the state #304 made real. No
 *   catalogue stated a genre, so none was written, so every rule fails at its
 *   first condition. The only way out is somebody saying what it is.
 * - `unmatched`: it carries tags and no rule asks for any of them. Somebody has
 *   already said something about it; what is missing is a rule.
 *
 * Both are unclaimed and both have the same consequence, and the sentence a
 * screen writes about them is not the same sentence, which is why the read says
 * which rather than leaving a screen to guess it from an empty list of tags.
 */
export type Unclaimed = 'untagged' | 'unmatched'

/** One book no rule claims, as the list of them needs it. */
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
  /** True for a plank taken out that books are still standing on. See #401. */
  gone: boolean
  holds: string
  entry: boolean
  /** The rule whose stretch of books reaches here, which may be the piece's. */
  rule: RuleDto | null
  /**
   * Every rule written **on this area**, which is a different question.
   *
   * `rule` is about the stretch and may belong to the piece, carrying on through
   * here. This is what the area itself allows, and there can be more than one,
   * because two rules on a place is how this app says "or" (#384).
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
  /** Every book standing on the piece, planks taken out included (#401). */
  books: number
  /** The areas the piece has, in the order they sit on its face. */
  areas: AreaDto[]
  /**
   * The planks taken out that still have books standing on them.
   *
   * Apart from `areas` because they are not on the piece: they cannot be
   * reordered, renumbered or counted as part of the face. What they have is
   * books nobody has carried yet, and a screen that leaves them out is the
   * screen that said a bookcase was empty over forty-six books.
   */
  gone: AreaDto[]
  /** Other pieces standing on this piece's number. Reported, never refused. */
  sharing: number[]
  holds: string
  rule: RuleDto | null
  /** Every rule written on the piece itself. Two of them is "or" (#384). */
  own: RuleDto[]
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

/** One book standing on the area a trip comes off, going or staying. */
export interface StandingBook extends CarriedBook {
  pages: number
  going: boolean
  /**
   * Why it is not going. Null for the ones that are.
   *
   * `left` is a book somebody decided to leave where it stands, which is its own
   * answer and not `settled`: settled means the rules want it here.
   */
  staying: 'pinned' | 'elsewhere' | 'settled' | 'left' | null
}

export interface TripAtAnArea {
  from: string
  to: string
  fromAreaId: number
  toAreaId: number
  /** Everything on the area, in shelf order, staying books included. */
  books: StandingBook[]
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
 * The same, said as the plank rather than as its name.
 *
 * For a screen acting on a row the server drew, which is where a label is the
 * wrong key: it is derived from where a piece stands and what it is called, so
 * a list read a minute ago can name a plank by a name nobody uses now. The same
 * reason `/api/carry/trip` is asked with two ids. See #356.
 */
const setLocationIn = (id: number, areaId: number) =>
  request<{ book: FiledBookRow }>(`/api/books/${id}/location`, {
    method: 'PATCH',
    body: JSON.stringify({ areaId }),
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

  /**
   * Send a capture back through the reader (#299).
   *
   * For the one whose reading was given up on rather than finishing. It comes
   * back `pending`, and the queue is already polling while anything is pending,
   * so the row updates itself from there without this having to wait.
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
   * `shelvedAt` null means this is an ordinary edit and nobody observed
   * anything, which leaves the recorded location exactly where it was, and now
   * leaves whether the book is on the bookcase alone for the same reason (#87).
   * Both are physical facts, both are observed at the shelf and nowhere else,
   * so one condition governs both: correcting a note cannot state where a book
   * is, and it cannot state that it is back either.
   *
   * **It is the plank, not what the plank is called** (#359). The step drew that
   * plank a moment ago and knows which one it is; handing the label back would
   * make the server work out from a string which row the screen had meant, and
   * on a bookcase somebody has named there are two strings for that row.
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
  updateAndShelve: async (id: number, draft: Draft, shelvedAt: number | null) => {
    const result = await updateBook(id, draft)
    if (shelvedAt !== null) {
      await setLocationIn(id, shelvedAt)
      await setCheckedOut(id, false)
    }
    return result
  },

  /*
   * `listBooks(range)` was here and is gone (#332).
   *
   * It asked `/api/books?range=` with no page, which meant the whole run, and
   * nothing had ever called it: #315 added `findBooks` beside it and every
   * screen went to that one. So it was a wrapper whose only remaining job was
   * to be the first thing the next person found when they wanted a listing, and
   * what it would have handed them is every book in the run in one response.
   * `findBooks` answers the same question and takes a page.
   */

  /**
   * The listing, narrowed and a page at a time (#315).
   *
   * One call for all three ways of looking at the library and for every state
   * of the find screen, because they are one question with different narrowings:
   * a screen showing books should not have to know which of two routes answers
   * its particular one.
   *
   * `total` is what the query matched and `counts` is the whole collection, which
   * is what makes "6 of 1,204 books" one response rather than two.
   */
  findBooks: (query: BookQuery = {}) =>
    request<{ books: FiledBookRow[]; total: number; counts: Counts }>(
      `/api/books?${bookQuery(query)}`,
    ),

  /** Every tag somebody keeps, with how many books each one has. */
  tags: () => request<{ tags: TagRow[] }>('/api/tags'),

  /** What one book is under, and who said each one. */
  bookTags: (id: number) => request<{ tags: AppliedTag[] }>(`/api/books/${id}/tags`),

  /**
   * Somebody saying what a book is, which is `source: 'person'` and the only
   * kind of tag no automatic rewrite may take back.
   *
   * The tag is defined if the collection has not got it yet and applied in the
   * one call, because it is one act: nothing here creates a word nobody has put
   * on a book. Which slug and which label is decided before this is called, by
   * `domain/tagging/naming.ts`, so that the rule about two spellings of one idea
   * is testable without a network.
   *
   * It reaches a queued capture as readily as a shelved book, because since #183
   * a capture is a row in `books` from its first photograph. That is what lets
   * the check-the-details screen write a person's tag at the moment they say it,
   * rather than carrying it in a draft as far as the shelving step and hoping
   * the walk between the two screens survives.
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
   * Where a book has been, newest first.
   *
   * Read only. There are four statements that write a placement and all four are
   * on the server; this reads the rows they wrote and adds nothing.
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
   *
   * `expectId` is the book they were told to move. The server recomputes the
   * step and refuses if the plank now ends with a different book, because a
   * cascade confirms its outermost move last (#110) and an answer given
   * against an arrangement that predates the last move is the bug #106 fixed.
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
      move: (PlankStep & { id: number; title: string }) | null
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
      move: PlankStep | null
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

  /**
   * The rules on one place, in the shape they go back in.
   *
   * The one read in this app that answers a tag by its identity rather than by
   * its label, because that is what writing needs and a label matched back
   * against the vocabulary would start asking for a different tag the day two
   * of them read alike.
   */
  placeRules: (about: 'area' | 'fixture', placeId: number) =>
    request<{ rules: DraftRule[] }>(
      `/api/placement/rule?about=${about}&placeId=${placeId}`,
    ),

  /**
   * What changing what a place allows would do. **Writes nothing**, which is
   * what lets the rule stay a draft on the screen until somebody has read this.
   */
  planRuleChange: (draft: RuleDraft) =>
    request<{ plan: RuleChangePlan }>('/api/placement/rule/plan', {
      method: 'POST',
      body: JSON.stringify(draft),
    }),

  /**
   * Write the rule, and record where the rules now want every book.
   *
   * Still moves no books. What comes back is the plan that was applied and the
   * count of assignments written, and the books themselves are on the carry
   * list, which is the one this app already keeps.
   */
  applyRuleChange: (draft: RuleDraft) =>
    request<{ plan: RuleChangePlan; wrote: AssignmentReport }>('/api/placement/rule', {
      method: 'POST',
      body: JSON.stringify(draft),
    }),

  /**
   * Everything still to be carried. **Read only, and worked out afresh.**
   *
   * Neither `planRunMove` nor `misfiles` could answer this. The first answers a
   * question about furniture that does not exist yet and never reads an
   * assignment; the second compares a recorded label against one derived from
   * the sort order, one run at a time, and answers a flat list. See
   * `server/carry.ts`.
   */
  carry: () => request<CarryWork>('/api/carry'),

  /**
   * One trip, read at the area the books come off.
   *
   * The areas go over as ids rather than labels, because a label is worked out
   * from where a piece stands and somebody renaming a bookcase between the list
   * and the trip would send this at a plank that no longer answers to it.
   */
  carryTrip: (from: number, to: number) =>
    request<TripAtAnArea>(`/api/carry/trip?from=${from}&to=${to}`),

  /**
   * Leave these books where they are, and stop the list asking for them.
   *
   * **No book moves.** It writes down that the answer was declined and nothing
   * else: where every book is stays exactly what somebody last said it was, the
   * ones already carried keep the home they were carried to, and pinned books
   * are not reachable from here at all.
   *
   * A trip, or the whole of the outstanding work when none is named. The list
   * comes back redrawn rather than being patched here, for the reason every
   * write on these screens answers with the thing re-described: a screen that
   * subtracted its own number would be a screen with an opinion.
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
   * The furniture (#307's routes, #313's screens).
   *
   * Eleven calls, and not one of them takes a label: a label is worked out from
   * where a thing sits, so there is nothing to send and nothing worth keeping.
   * Every write answers with the thing re-described and with `becomes`, and a
   * screen redraws from that rather than from what it had.
   */

  /** The whole room: every piece on the floor and every area on its face. */
  furniture: () => request<FurnitureDto>('/api/fixtures'),

  /**
   * What the whole collection falls back on when nothing nearer has an opinion.
   *
   * The eleventh call, and the only one about the collection rather than about
   * a piece of it. There is no read beside it because `furniture()` already
   * answers `defaultSortStrategy`, and no id in the path because there is one
   * collection.
   *
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

  /**
   * Add an area to a piece.
   *
   * **Given nothing, the server decides where it opens** (#381), which is what
   * lets the fixtures screen add one on a press. `startsAt` is still how a
   * boundary is placed deliberately, and the empty string still means "from the
   * beginning" rather than "you choose".
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

  /**
   * The books standing in one area, by identity (#323).
   *
   * **This is what the label match became.** Cutting an area in two needs the
   * books in it, and #313 got them by asking for both stretches of shelving and
   * finding the group whose label matched the area's. A label is worked out from
   * a piece's number and name and an area's ordinal and name, so a rename, a
   * reorder or two pieces standing on one number would each have picked the
   * wrong books without saying anything.
   */
  areaBooks: (id: number) => request<AreaBooks>(`/api/areas/${id}/books`),

  /**
   * The same, about a whole piece: every book standing on its face, in order.
   *
   * A piece's page shows what its sort rule does to its books, and that is a
   * question about the piece rather than about any one plank of it.
   */
  fixtureBooks: (id: number) => request<FixtureBooks>(`/api/fixtures/${id}/books`),

  /**
   * Why a book is where it is: which rule claimed it, and which ones lost.
   *
   * Read only. An empty `claims` is the honest answer for a book no rule claims,
   * not an error.
   */
  bookClaim: (id: number) => request<{ claim: BookClaim }>(`/api/books/${id}/claim`),

  /**
   * Every book no rule claims, and how many there are (#341).
   *
   * **The question nothing in the app could ask.** No listing expresses it: the
   * tag filter has no negation and negating a tag would answer a different
   * question anyway, because "no rule claims it" is about the rules rather than
   * about a slug. `booksNoRuleClaims` puts it to the same function that places a
   * book, so this list and the claim screen cannot disagree about one.
   *
   * `total` beside a capped page, which is `findBooks`' pair: the count is what
   * the first screen's door is drawn from, and the names are what explain it.
   *
   * Read only, and it must stay that way. Answering it by writing a genre tag is
   * exactly what #304 stopped doing on the owner's explicit instruction; what
   * settles one of these books is a person saying what it is, through
   * `applyTag`.
   */
  unclaimed: () =>
    request<{ books: UnclaimedBook[]; total: number }>('/api/placement/unclaimed'),

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

  /**
   * Whether there is a backup of this collection anybody has proved restores.
   *
   * Files on a disk, asked about once, on the first screen. Nothing here says
   * whether a scheduled job started, because it started on both of the two
   * occasions this went unnoticed for days (#239, #311). See
   * `server/backup-watch.ts`.
   */
  backup: () => request<BackupWatch>('/api/backup'),
}

export const emptyDraft: Draft = {
  isbn13: '', isbn10: '', title: '', subtitle: '', authors: '', publisher: '',
  // No genre, because an empty draft is nothing having been said about a book
  // and fiction is something (#304). The review pane comes up with neither
  // option highlighted until a lookup or a person states one.
  published: '', pages: '', notes: '', genre: null,
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
    // Null for a book in neither run, which is a book no genre tag claims
    // (#304) and which must not come up showing a tag nothing stated.
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

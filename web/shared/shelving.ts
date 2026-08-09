/**
 * The shelving algorithm. See docs/shelving.md for the reasoning.
 *
 * Everything here is a pure function over plain data: no database, no network,
 * no DOM. That is deliberate, because it is the part most worth testing and
 * the part most likely to need tweaking once real books hit real shelves.
 */

export type ShelfRange = 'fiction' | 'nonfiction'

/** Unit separator. Sorts below every character that survives normalise(), so
 *  comparing whole joined keys reproduces tuple comparison exactly. */
export const SEP = '\x1f'

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Fold text down to letters, digits and single spaces, so a byte order
 * collation orders it correctly without the ICU extension.
 *
 * Space (0x20) sorting below every letter is load-bearing: it is what makes
 * `SMITH ANN` come before `SMITHSON A`. `SEP` sorts below the space, which is
 * what makes the flattened sort key reproduce tuple comparison.
 *
 * **Letters, not `[A-Z]`, and that is issue #195.** This dropped everything
 * outside `[A-Z0-9 ]` until then, which is not a fold at all for a name written
 * in a script that has no `A-Z` in it: `Фёдор Достоевский` came back empty, so
 * the book's author component of the sort key was empty and it sorted ahead of
 * every book in its range, its filing name could not be looked up or overridden
 * (both are keyed on this), and the needs-attention list called it "unknown
 * author" while its own page named the author. Keeping the letters is the
 * smallest change that makes all four of those one answer again.
 *
 * Accents are still folded away, and only by the combining marks Latin
 * decomposes into: `Böll` is `BOLL` and `García` is `GARCIA` exactly as before,
 * so nothing that was already filed moves. `domain/authorship/nameKey` keeps
 * accents on purpose and says at itself why the two differ.
 *
 * **The one place this is not exactly the stored order.** `books.sort_key`
 * collates `C`, which is UTF-8 byte order, and this code compares the same keys
 * with `<`, which is UTF-16 code unit order. Those agree for every character in
 * the basic plane and disagree only for one outside it compared against
 * U+E000..U+FFFF, which is a rare CJK ideograph filed against a private use
 * character. Worth knowing rather than worth guarding: the pre-#195 fold agreed
 * with the collation by having nothing but ASCII in it, and this one does not.
 */
export function normalise(value: string): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '') // drop combining marks (accented letters fold to plain ASCII)
    .toUpperCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Zero-pad digit runs so `BOOK 2` sorts before `BOOK 10`. */
export function padNumbers(value: string): string {
  return value.replace(/\d+/g, (digits) => digits.padStart(6, '0'))
}

// ---------------------------------------------------------------------------
// Author filing name
// ---------------------------------------------------------------------------

const PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'della', 'der', 'den', 'di', 'da', 'du', 'das',
  'dos', 'la', 'le', 'las', 'los', 'lo', 'ter', 'ten', 'af', 'av', 'bin',
  'ibn', 'al', 'el', 'st', 'saint', 'mac', 'mc',
])

const SUFFIXES = new Set([
  'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'dds', 'esq',
])

const HONORIFICS = new Set([
  'dr', 'prof', 'sir', 'dame', 'lady', 'lord', 'rev', 'fr',
])

/** Strip a token down to comparable letters. Keeps the apostrophe so
 *  `O'Brien` stays one word and never looks like the particle `o`. */
function bare(token: string): string {
  return token.replace(/[^A-Za-z']/g, '').toLowerCase()
}

/**
 * Turn a printed author name into a filing name: `Ursula K. Le Guin` becomes
 * `Le Guin, Ursula K.`
 *
 * This gets the common cases right and is knowingly wrong on two:
 *   - Spanish compound surnames (`Gabriel García Márquez` files as
 *     `Márquez, Gabriel García`, should be `García Márquez`)
 *   - the Dutch/German convention that files `Beethoven, Ludwig van` under B
 *
 * Neither is separable by heuristic, which is why the author_filing override
 * table exists. Do not try to fix these here.
 *
 * **This is the only derivation of a filing name in the app**, and it is in
 * `shared/` so that it can be. The client renders it as you type, `Store.
 * filingFor` stores it when no override exists, and `PrintedName.derivedFiling`
 * is it. Two of those disagreeing is not a cosmetic difference: opening a book
 * whose stored filing name is not what the client would derive pins the stored
 * one into the draft as an override (`App.tsx`), so the disagreement is written
 * back the next time somebody saves.
 *
 * **It answers a name for anything with a name in it**, falling back to what was
 * printed. Nothing that files a book can use an empty answer: the empty string
 * sorts ahead of every real one, so a book with an author would be shelved as
 * though it had none (#195).
 */
export function filingName(display: string): string {
  const printed = (display ?? '').replace(/\s+/g, ' ').trim()

  let tokens = printed
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  while (tokens.length && HONORIFICS.has(bare(tokens[0]!))) tokens.shift()

  const suffixes: string[] = []
  while (tokens.length && SUFFIXES.has(bare(tokens[tokens.length - 1]!))) {
    suffixes.unshift(tokens.pop()!)
  }

  // Everything that was there was an honorific or a suffix, so the heuristic
  // has nothing to invert. What is printed on the book is the answer, and an
  // empty string is not one: see the note above.
  if (!tokens.length) return printed

  const withSuffix = (base: string) =>
    suffixes.length ? `${base} ${suffixes.join(' ')}` : base

  // Mononyms (Homer, Voltaire) and corporate names never get inverted.
  if (tokens.length === 1) return withSuffix(tokens[0]!)

  let i = tokens.length - 1
  while (i > 0 && PARTICLES.has(bare(tokens[i - 1]!))) i -= 1

  const last = tokens.slice(i).join(' ')
  const first = tokens.slice(0, i).join(' ')
  return withSuffix(first ? `${last}, ${first}` : last)
}

/** The filing author is whoever is listed first. */
export function primaryAuthor(authors: string[]): string {
  return authors.find((name) => name.trim().length > 0)?.trim() ?? ''
}

// ---------------------------------------------------------------------------
// Title filing name
// ---------------------------------------------------------------------------

const LEADING_ARTICLES = ['THE', 'A', 'AN']

/** Normalised title with a leading English article removed. */
export function titleFiling(title: string): string {
  const value = normalise(title)
  for (const article of LEADING_ARTICLES) {
    if (value.startsWith(`${article} `)) return value.slice(article.length + 1)
  }
  return value
}

// ---------------------------------------------------------------------------
// Sort key
// ---------------------------------------------------------------------------

export interface SortKeyInput {
  /** Filing name, already overridden if an override exists. */
  authorFiling: string
  title: string
  seriesName?: string | null
  seriesIndex?: number | null
}

/**
 * Flatten `(author, hasSeries, series, index, title)` into one comparable
 * string. `hasSeries` is 0 for series books so an author's series blocks sit
 * ahead of their standalone titles.
 *
 * To interleave series at their alphabetical position instead, drop the
 * hasSeries component and fall back to the title for standalones.
 */
export function buildSortKey(input: SortKeyInput): string {
  const author = padNumbers(normalise(input.authorFiling))
  const series = normalise(input.seriesName ?? '')
  const hasSeries = series ? '0' : '1'
  // %010.3f keeps novellas at 5.5 between books 5 and 6.
  const index = (input.seriesIndex ?? 0).toFixed(3).padStart(10, '0')
  const title = padNumbers(titleFiling(input.title))

  return [author, hasSeries, padNumbers(series), index, title].join(SEP)
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export interface ParsedLocation {
  shelf: number
  section: string
}

/** Accepts `1A`, `S1A`, `S4`, `s4 b`. Returns null if it is not a location. */
export function parseLocation(label: string): ParsedLocation | null {
  const match = /^\s*[Ss]?(\d+)\s*([A-Za-z]*)\s*$/.exec(label ?? '')
  if (!match) return null
  return { shelf: Number.parseInt(match[1]!, 10), section: match[2]!.toUpperCase() }
}

/** Canonical label, so `s4 b` and `S4B` compare equal. */
export function formatLocation(location: ParsedLocation): string {
  return `${location.shelf}${location.section}`
}

/**
 * Order two locations. Shelf first, then section, with a bare shelf (`S4`)
 * sorting ahead of any section on it (`S4A`).
 * Unparseable labels sort last so they surface rather than hide.
 */
export function compareLocations(a: string, b: string): number {
  const left = parseLocation(a)
  const right = parseLocation(b)
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  if (left.shelf !== right.shelf) return left.shelf - right.shelf
  return left.section < right.section ? -1 : left.section > right.section ? 1 : 0
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export interface Neighbour {
  id: number
  title: string
  authorFiling: string
  location: string
  sortKey: string
  /**
   * Filenames of this book's photos, served from /api/covers.
   *
   * The spine is the one that matters when placing a book: it is what you
   * actually see looking at a shelf. Front and back are there as fallbacks
   * for books photographed before the spine slot was filled.
   */
  images: { front: string; back: string; edge: string }
}

/** Which photo of a book is being shown in place of its spine. */
export type ShelfSlot = 'edge' | 'front' | 'back' | ''

/** Crops of the three photos, cut to the book. Absent where there is none. */
export interface BookCrops {
  front?: string
  back?: string
  edge?: string
}

/**
 * The best photo for recognising a book on a shelf, and which slot it is.
 *
 * Spine first, by a mile: it is the only face you can see with the book
 * shelved. Front then back are fallbacks for books catalogued before the
 * spine slot existed, and the slot comes back with the filename so a caller
 * can crop it correctly and say what it is looking at. A cover standing in
 * for a spine should not be passed off as one.
 *
 * The single place this precedence is written down. The server sends strips
 * through it and the library draws its rows through it, and two copies of
 * this would be two rows of books that disagree about the same shelf.
 */
export function shelfImage(images: {
  front: string
  back: string
  edge: string
  /**
   * Crops cut to the book itself. As in `bookCover`, the slot is chosen first
   * and the crop of that slot then stands in for the whole frame, so the three
   * views agree about which face of a book they are drawing whether or not any
   * of them cropped.
   */
  crops?: BookCrops
}): {
  name: string
  slot: ShelfSlot
  whole: string
} {
  const pick = (name: string, slot: ShelfSlot, crop: string) =>
    ({ name: crop || name, slot, whole: name })

  if (images.edge) return pick(images.edge, 'edge', images.crops?.edge ?? '')
  if (images.front) return pick(images.front, 'front', images.crops?.front ?? '')
  if (images.back) return pick(images.back, 'back', images.crops?.back ?? '')
  return { name: '', slot: '', whole: '' }
}

/** Which picture of a book is on screen, when the picture is the point. */
export type CoverSlot = ShelfSlot | 'catalogue'

export interface BookCover {
  /** Filename under /api/covers. Empty when the book has no picture at all. */
  name: string
  /** The whole photograph this was cut from, or the same file when it is one. */
  whole: string
  slot: CoverSlot
  /**
   * True when this is the publisher's picture rather than a photograph of this
   * copy. Whoever draws it has to say so.
   */
  fromCatalogue: boolean
  /** True when `name` is a crop cut to the book rather than the whole frame. */
  cropped: boolean
}

/**
 * The picture of a book, for a view whose whole content is pictures.
 *
 * The opposite question from `shelfImage`, and so the opposite order. There the
 * spine wins because it is the only face you can see with the book shelved;
 * here the book is lying face up on a screen, so the front comes first.
 *
 * A photograph of this copy beats the catalogue's picture every time. An ISBN
 * often has several cover designs against it, and a design somebody has never
 * seen looks like the wrong book. The catalogue's is the last resort and comes
 * back labelled, so a grid can say whose picture it is instead of quietly
 * passing it off. That precedence, and that honesty, is the one the scan view
 * has always used; this is the same rule with the slot travelling alongside,
 * moved next to `shelfImage` so the two views cannot drift apart.
 */
export function bookCover(images: {
  front: string
  back: string
  edge: string
  /** The publisher's cover for this ISBN. Not a photo of this copy. */
  catalogue: string
  /**
   * Crops of the three photos, cut to the book itself.
   *
   * Which slot wins is decided first and is unaffected by these: a front photo
   * still beats a spine whether or not either has been cropped. Only once the
   * slot is chosen does the crop of that slot stand in for the whole frame, so
   * a view showing the surrounding room is never showing it because a
   * different photo happened to crop better.
   */
  crops?: BookCrops
}): BookCover {
  const pick = (name: string, slot: CoverSlot, crop: string): BookCover => ({
    name: crop || name,
    whole: name,
    slot,
    fromCatalogue: false,
    cropped: Boolean(crop),
  })

  if (images.front) return pick(images.front, 'front', images.crops?.front ?? '')
  if (images.edge) return pick(images.edge, 'edge', images.crops?.edge ?? '')
  if (images.back) return pick(images.back, 'back', images.crops?.back ?? '')
  if (images.catalogue) {
    // Already a picture of just the book: there is no room around a publisher's
    // cover to cut away.
    return {
      name: images.catalogue, whole: images.catalogue,
      slot: 'catalogue', fromCatalogue: true, cropped: false,
    }
  }
  return { name: '', whole: '', slot: '', fromCatalogue: false, cropped: false }
}

/** Best photo for recognising a book on a shelf. Spine first, by a mile. */
export function shelfPhoto(neighbour: Neighbour | null): string {
  return neighbour ? shelfImage(neighbour.images).name : ''
}

/**
 * Which slot shelfPhoto picked, so a thumbnail can be framed accordingly.
 *
 * A spine and a cover want opposite crops at thumbnail size: the useful part
 * of a spine is its top, where the title starts, while a cover reads best from
 * its middle.
 */
export function shelfPhotoSlot(neighbour: Neighbour | null): ShelfSlot {
  return neighbour ? shelfImage(neighbour.images).slot : ''
}

export type PlacementKind =
  | 'between-same-location'
  | 'between-different-locations'
  | 'start-of-range'
  | 'end-of-range'
  | 'first-in-range'

export interface Placement {
  kind: PlacementKind
  range: ShelfRange
  predecessor: Neighbour | null
  successor: Neighbour | null
  /** Pre-filled location for the user to confirm or override. */
  suggestedLocation: string
  /** One line, ready to render large on a phone held next to a shelf. */
  instruction: string
}

const RANGE_LABEL: Record<ShelfRange, string> = {
  fiction: 'fiction',
  nonfiction: 'non-fiction',
}

function describe(neighbour: Neighbour): string {
  const author = neighbour.authorFiling || 'Unknown author'
  return `${neighbour.title} (${author})`
}

/**
 * Build the instruction shown to the user. Neighbours come from the store;
 * this function only decides how to say it.
 *
 * Location is descriptive rather than prescriptive: we never claim a book
 * *must* go in a section, only which two books it belongs between. The
 * suggested location is a starting point the user can override, which is what
 * makes a full shelf a non-event.
 */
export function buildPlacement(
  range: ShelfRange,
  predecessor: Neighbour | null,
  successor: Neighbour | null,
  rangeStart: string,
): Placement {
  const label = RANGE_LABEL[range]

  if (predecessor && successor) {
    const samePlace =
      predecessor.location &&
      compareLocations(predecessor.location, successor.location) === 0

    if (samePlace) {
      return {
        kind: 'between-same-location',
        range,
        predecessor,
        successor,
        suggestedLocation: predecessor.location,
        instruction:
          `${predecessor.location}: between ${describe(predecessor)} ` +
          `and ${describe(successor)}`,
      }
    }

    return {
      kind: 'between-different-locations',
      range,
      predecessor,
      successor,
      suggestedLocation: predecessor.location || successor.location || rangeStart,
      instruction:
        `After ${describe(predecessor)} at ${predecessor.location || '?'}, ` +
        `before ${describe(successor)} at ${successor.location || '?'}. ` +
        `This is the boundary between them.`,
    }
  }

  if (successor) {
    return {
      kind: 'start-of-range',
      range,
      predecessor: null,
      successor,
      suggestedLocation: successor.location || rangeStart,
      instruction:
        `First in ${label}. Goes before ${describe(successor)} ` +
        `at ${successor.location || rangeStart}.`,
    }
  }

  if (predecessor) {
    return {
      kind: 'end-of-range',
      range,
      predecessor,
      successor: null,
      suggestedLocation: predecessor.location || rangeStart,
      instruction:
        `Last in ${label}. Goes after ${describe(predecessor)} ` +
        `at ${predecessor.location || rangeStart}.`,
    }
  }

  return {
    kind: 'first-in-range',
    range,
    predecessor: null,
    successor: null,
    suggestedLocation: rangeStart,
    instruction: `First book in ${label}. Start at ${rangeStart}.`,
  }
}

// ---------------------------------------------------------------------------
// Misfile detection
// ---------------------------------------------------------------------------

/**
 * One book, seen from both sides of the disagreement this section exists to
 * find.
 */
export interface FiledBook {
  id: number
  title: string
  authorFiling: string
  /**
   * Where a person last said this book physically is.
   *
   * Empty when nobody has ever said. That is not the same as the book being in
   * the wrong place, and the difference is the whole reason this is a separate
   * field rather than something derived.
   */
  location: string
  /**
   * Where sort order and the shelf boundaries put it now.
   *
   * Recomputed from the catalogue every time, so editing an author, a series
   * or the fiction flag moves this while `location` stays where it was. That
   * is exactly the re-shelving case: the book has to physically move, and the
   * gap between these two fields is what says so.
   */
  derivedLocation: string
  sortKey: string
  /** Off the shelf entirely, so it holds no physical position at all. */
  checkedOut: boolean
}

/** Why a book was left out of the list rather than reported in it. */
export type ExcludedReason =
  /** Physically off the shelf, so there is no position to disagree with. */
  | 'checked-out'
  /** Catalogued but never confirmed onto a shelf. Nothing to compare. */
  | 'never-placed'
  /** A label that does not parse as a location, so ranks are not comparable. */
  | 'unreadable-location'

export interface Excluded {
  book: FiledBook
  reason: ExcludedReason
}

/** A book whose physical position disagrees with where it now belongs. */
export interface Misfile {
  book: FiledBook
  /** Canonical label for where it is. */
  from: string
  /** Canonical label for where it belongs. */
  to: string
  /** One line, ready to read standing in front of the shelves. */
  instruction: string
}

export interface ShelvingReview {
  /** Books to physically pick up and move. */
  misfiles: Misfile[]
  /** Books deliberately not judged, and why. Reported, never counted as errors. */
  excluded: Excluded[]
}

/**
 * Reconcile where books are with where they belong.
 *
 * Locations are descriptive, not prescriptive. Sort order is the truth about
 * what sequence books should be in; the recorded location is the truth about
 * where a book physically is. The two drift apart as books are shelved, and
 * this is the only thing that notices.
 *
 * A misfile is a book that is *on a shelf*, whose recorded location is
 * readable, and which does not compare equal to the location its sort position
 * now lands on. Nothing else. In particular this function never writes: a book
 * reported here stays exactly where the catalogue says it is until a person
 * says they moved it.
 *
 * ## Why this rather than the ordering invariant
 *
 * docs/shelving.md states the check as "location rank must be non-decreasing
 * down the sort order". Comparing against the derived location is strictly
 * stronger and strictly kinder:
 *
 *   - It cannot miss anything the rank check catches. Derived locations are
 *     non-decreasing by construction, so an inversion among recorded locations
 *     is impossible unless at least one of them already disagrees with its
 *     derived one.
 *   - It blames the right book. A rank check compares each book with its
 *     neighbour and flags the second of the pair, so a single book put on the
 *     wrong bookcase gets its innocent successor reported instead of itself.
 *   - It names the destination. "Move this to 2A" is actionable; "this sorts
 *     after that" leaves the person to work out where it goes.
 *
 * ## What is deliberately not reported
 *
 * False positives are expensive here: the output is a list somebody walks to
 * the shelf and physically handles, so a list that is mostly wrong gets
 * ignored and hides the real misfiles inside it. Three cases are therefore
 * excluded rather than flagged, and returned under `excluded` so the exclusion
 * is visible instead of silent.
 *
 * Call this once per range. Fiction and non-fiction are independent ordered
 * lists that never interact, so their locations are not comparable and must
 * never arrive in the same call.
 *
 * The input does not need to be sorted. Every judgement is per book.
 */
export function reviewShelving(books: FiledBook[]): ShelvingReview {
  const misfiles: Misfile[] = []
  const excluded: Excluded[] = []

  for (const book of books) {
    if (book.checkedOut) {
      excluded.push({ book, reason: 'checked-out' })
      continue
    }

    const recorded = (book.location ?? '').trim()
    if (!recorded) {
      excluded.push({ book, reason: 'never-placed' })
      continue
    }

    // Compare parsed ranks, not strings, or `s4 b` and `S4B` read as a book
    // that needs carrying across the room.
    const at = parseLocation(recorded)
    const belongs = parseLocation(book.derivedLocation ?? '')
    if (!at || !belongs) {
      excluded.push({ book, reason: 'unreadable-location' })
      continue
    }

    if (compareLocations(recorded, book.derivedLocation) === 0) continue

    const from = formatLocation(at)
    const to = formatLocation(belongs)
    misfiles.push({
      book,
      from,
      to,
      instruction:
        `${book.title} (${book.authorFiling || 'unknown author'}) is at ` +
        `${from} and belongs at ${to}.`,
    })
  }

  // Ordered by where the book currently is, because that is the order somebody
  // walks the shelves picking them up.
  misfiles.sort((a, b) =>
    compareLocations(a.from, b.from) ||
    (a.book.sortKey < b.book.sortKey ? -1 : a.book.sortKey > b.book.sortKey ? 1 : 0))

  return { misfiles, excluded }
}

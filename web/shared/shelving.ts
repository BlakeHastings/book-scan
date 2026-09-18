/**
 * The shelving algorithm. See docs/shelving.md for the reasoning.
 */

export type ShelfRange = 'fiction' | 'nonfiction'

/** Unit separator. Sorts below every character that survives normalise(), so
 *  comparing whole joined keys reproduces tuple comparison exactly. */
export const SEP = '\x1f'

/**
 * Fold text down to letters, digits and single spaces, so a byte order
 * collation orders it correctly without the ICU extension. Space (0x20)
 * sorting below every letter is load-bearing: it is what makes `SMITH ANN`
 * come before `SMITHSON A`, and `SEP` sorts below the space, which is what
 * makes the flattened sort key reproduce tuple comparison.
 *
 * `books.sort_key` collates UTF-8 byte order and this code compares the same
 * keys in UTF-16 code unit order. Those agree for every character in the basic
 * plane and disagree only for one outside it compared against U+E000..U+FFFF.
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

/** Keeps the apostrophe so `O'Brien` stays one word and never looks like the
 *  particle `o`. */
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
 * It answers a name for anything with a name in it, falling back to what was
 * printed. The empty string sorts ahead of every real one, so a book with an
 * author would otherwise be shelved as though it had none.
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

  // Everything there was an honorific or a suffix, so there is nothing to
  // invert, and an empty answer is not usable: see the note above.
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

export function primaryAuthor(authors: string[]): string {
  return authors.find((name) => name.trim().length > 0)?.trim() ?? ''
}

const LEADING_ARTICLES = ['THE', 'A', 'AN']

export function titleFiling(title: string): string {
  const value = normalise(title)
  for (const article of LEADING_ARTICLES) {
    if (value.startsWith(`${article} `)) return value.slice(article.length + 1)
  }
  return value
}

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

export interface Neighbour {
  id: number
  title: string
  authorFiling: string
  /**
   * The printed string this book carries, `books.authors` unjoined. The filing
   * name comes from a credit row and a book can be missing one, so this is what
   * `describe` falls back to before it says nobody knows.
   */
  authors: string
  /**
   * Where this book stands, as a person reads it. Empty when nobody has said.
   * A rendering, and nothing is decided from it: see `areaId`.
   */
  location: string
  /**
   * The area `location` is a rendering of, or null when nobody has said. The
   * identity half, and the half `buildPlacement` asks whether two neighbours
   * are on one plank.
   */
  areaId: number | null
  sortKey: string
  /** Filenames of this book's photos, served from /api/covers. */
  images: { front: string; back: string; edge: string }
}

export type ShelfSlot = 'edge' | 'front' | 'back' | ''

export interface BookCrops {
  front?: string
  back?: string
  edge?: string
}

/**
 * The best photo for recognising a book on a shelf, and which slot it is.
 *
 * Spine first, by a mile: it is the only face you can see with the book
 * shelved. The slot comes back with the filename so a caller can crop it
 * correctly and say what it is looking at, rather than pass a cover off as a
 * spine. The single place this precedence is written down.
 */
export function shelfImage(images: {
  front: string
  back: string
  edge: string
  /**
   * Crops cut to the book itself. As in `bookCover`, the slot is chosen first
   * and the crop of that slot then stands in for the whole frame.
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
 * The opposite order from `shelfImage`: the book is lying face up on a screen,
 * so the front comes first. A photograph of this copy beats the catalogue's
 * picture every time, because an ISBN often has several cover designs against
 * it and a design somebody has never seen looks like the wrong book. The
 * catalogue's is the last resort and comes back labelled so a grid can say
 * whose picture it is.
 */
export function bookCover(images: {
  front: string
  back: string
  edge: string
  /** The publisher's cover for this ISBN. Not a photo of this copy. */
  catalogue: string
  /**
   * Crops of the three photos, cut to the book itself. Which slot wins is
   * decided first and is unaffected by these: only once the slot is chosen does
   * the crop of that slot stand in for the whole frame.
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

export function shelfPhoto(neighbour: Neighbour | null): string {
  return neighbour ? shelfImage(neighbour.images).name : ''
}

/**
 * Which slot shelfPhoto picked. A spine and a cover want opposite crops at
 * thumbnail size: the useful part of a spine is its top, where the title
 * starts, while a cover reads best from its middle.
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
  /**
   * A position on one plank rather than a position in a run. Every kind above
   * is a statement about a whole range, so "first in non-fiction" and "last in
   * non-fiction" are both false of a book being carried to one plank. See
   * `placementOnAPlank`.
   */
  | 'on-a-plank'
  /**
   * No rule says where this range begins, so nothing says where the book goes.
   * Not an error and not a wait: it is the state every collection is in before
   * anybody has written a rule. A book carrying no genre tag gets no placement
   * at all, which is a different absence.
   */
  | 'range-has-no-start'

export interface Placement {
  kind: PlacementKind
  range: ShelfRange
  predecessor: Neighbour | null
  successor: Neighbour | null
  /** Pre-filled location for the user to confirm or override. */
  suggestedLocation: string
  instruction: string
}

const RANGE_LABEL: Record<ShelfRange, string> = {
  fiction: 'fiction',
  nonfiction: 'non-fiction',
}

/**
 * The best name to show for a book when nothing is to be invented: the filing
 * name if there is one, the string the book itself carries otherwise, and empty
 * only when neither exists. Each caller decides what to say when it comes up
 * empty, because "Unknown author" and "unknown author" are two different
 * sentences to two different readers.
 */
export function bestKnownAuthor(authorFiling: string, authors: string): string {
  return authorFiling || authors.trim()
}

function describe(neighbour: Neighbour): string {
  const author = bestKnownAuthor(neighbour.authorFiling, neighbour.authors) || 'Unknown author'
  return `${neighbour.title} (${author})`
}

/**
 * Build the instruction shown to the user. Neighbours come from the store;
 * this function only decides how to say it.
 *
 * Location is descriptive rather than prescriptive: we never claim a book must
 * go in a section, only which two books it belongs between.
 *
 * `rangeStart` is null when no rule says where the range begins, and that
 * answer is `bandsOf`'s rather than anything invented here or by a caller: a
 * range begins wherever the rule set says, and where it says nothing there is
 * nowhere.
 */
export function buildPlacement(
  range: ShelfRange,
  predecessor: Neighbour | null,
  successor: Neighbour | null,
  rangeStart: string | null,
): Placement {
  const label = RANGE_LABEL[range]

  /*
   * Asked before the four sentences below, because every one of them names the
   * range's start where a neighbour cannot be named, and here there is no plank
   * to name. The two books either side are still carried: they are the
   * sequence, which is a fact about the books rather than the furniture.
   */
  if (rangeStart === null) {
    return {
      kind: 'range-has-no-start',
      range,
      predecessor,
      successor,
      suggestedLocation: '',
      instruction:
        `Nothing says where ${label} begins, so there is nowhere to put this book. ` +
        'Say what belongs on a bookcase or a shelf first.',
    }
  }

  if (predecessor && successor) {
    /*
     * On ids, never on the two labels. A label is a rendering; only the area
     * says whether two books stand in the same place.
     */
    const samePlace =
      predecessor.areaId !== null && predecessor.areaId === successor.areaId

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

/**
 * The same sentence about one plank, for a book somebody is carrying to it.
 *
 * The neighbours here are the two books either side of it on that plank, so the
 * plank is the subject of every sentence and each one names it. Nothing here is
 * a second opinion about which plank: that is settled by the trip before this is
 * called.
 */
export function placementOnAPlank(
  range: ShelfRange,
  plank: string,
  predecessor: Neighbour | null,
  successor: Neighbour | null,
): Placement {
  const between = predecessor && successor
    ? `${plank}: between ${describe(predecessor)} and ${describe(successor)}`
    : predecessor
      ? `${plank}: after ${describe(predecessor)}, at the end.`
      : successor
        ? `${plank}: before ${describe(successor)}, at the start.`
        : `${plank} has nothing on it yet, so this book starts it.`

  return {
    kind: 'on-a-plank',
    range,
    predecessor,
    successor,
    suggestedLocation: plank,
    instruction: between,
  }
}

/**
 * The piece a book's area hangs on, and where the two of them stand in the room.
 * The other half of `location`, which is only a rendering and cannot be asked
 * these questions without being taken apart again.
 *
 * The ordinals rather than the label for the ordering, for the reason
 * `FiledBook.standing` gives: the walk goes in the order the furniture stands in
 * the room, and a name sorts alphabetically. `fixtureId` beside the ordinal
 * because two pieces really can stand on one number, which is an arrangement
 * this catalogue has.
 */
export interface AreaStanding {
  fixtureId: number
  /** The piece's ordinal, 1-based, which is the `1` in `1A`. */
  fixture: number
  /**
   * The area's ordinal on that piece, 0-based, which is the `A` in `1A`. The
   * face it reads as, so an area somebody retired while books were still
   * standing on it keeps the plank a person would walk to rather than the
   * negative the row stores.
   */
  plank: number
  /** What the owner called the piece. Empty when nobody has named it. */
  name: string
  /** The owner's word for what the piece is. Nothing branches on it. */
  kind: string
}

export interface FiledBook {
  id: number
  title: string
  authorFiling: string
  /** The printed string this book carries. See `Neighbour.authors`. */
  authors: string
  /**
   * Where a person last said this book physically is, as a label to read. Empty
   * when nobody has ever said. Nothing is decided from this: it is a rendering
   * of `areaId`, and the label a piece of furniture reads as changes the moment
   * somebody names it.
   */
  location: string
  /**
   * The area a person last put this book in, which is where it actually is.
   * Null when nobody has ever said. This is the identity half of `location` and
   * it is the half the judgement is made on.
   */
  areaId: number | null
  /**
   * Where sort order and the furniture put it now, as a label to read.
   * Recomputed from the catalogue every time, so editing an author, a series or
   * the genre moves this while `location` stays where it was.
   */
  derivedLocation: string
  /** The area the order now puts it in. Null when the run has none to give. */
  derivedAreaId: number | null
  /**
   * Where the area it is in stands, for ordering the walk. Null with `areaId`.
   * Ordinals rather than the label, because the list is walked in the order the
   * furniture stands in the room and a name sorts alphabetically.
   */
  standing: { fixture: number; plank: number } | null
  sortKey: string
  /** Off the shelf entirely, so it holds no physical position at all. */
  checkedOut: boolean
}

export type ExcludedReason =
  /** Physically off the shelf, so there is no position to disagree with. */
  | 'checked-out'
  /** Catalogued but never confirmed onto a shelf. Nothing to compare. */
  | 'never-placed'
  /**
   * The run this book files into has no area to put it on, so there is nothing
   * to compare where it is against. It means the furniture is missing rather
   * than the book: a range whose rule points at a piece that has been taken out
   * has no run at all. A count of these is a fact somebody needs and never a
   * row to drop quietly.
   */
  | 'unplaceable'

export interface Excluded {
  book: FiledBook
  reason: ExcludedReason
}

export interface Misfile {
  book: FiledBook
  /** What to read for where it is. */
  from: string
  /** What to read for where it belongs. */
  to: string
  /**
   * The area it belongs in, which is what saying "moved it" writes. The label
   * is for the person and the id is for the request: a label is derived from
   * where a piece stands and what it is called, so somebody naming a bookcase
   * between drawing this list and acting on a row would send the write to a
   * plank that no longer answers to that name.
   */
  toAreaId: number
  instruction: string
  /**
   * The number both ends stand at when the two planks read the same, else null.
   * `fixture.position` is deliberately not unique (`schema.ts`), so two pieces
   * standing at one number draw two planks with one letter.
   *
   * Filled in by the caller rather than here, because working it out needs the
   * pieces the two planks hang on and `shared/` may not reach the furniture.
   * `sharedNumberOf` in `domain/placement/carry.ts` is the one reading.
   */
  sharedNumber: number | null
}

export interface ShelvingReview {
  misfiles: Misfile[]
  /** Reported, never counted as errors. */
  excluded: Excluded[]
}

/**
 * Reconcile where books are with where they belong. A misfile is a book that is
 * on a shelf and is not in the area its sort position now lands in. This never
 * writes: a book reported here stays exactly where the catalogue says it is
 * until a person says they moved it.
 *
 * The judgement is `areaId` against `derivedAreaId`, and the labels are only
 * ever shown to somebody. Nothing here parses a label: the two sides are
 * rendered by different code and agree only while no furniture is named.
 *
 * Three cases are excluded rather than flagged, and returned under `excluded`
 * so the exclusion is visible instead of silent.
 *
 * Call this once per range. Fiction and non-fiction are independent ordered
 * lists that never interact, so their locations are not comparable and must
 * never arrive in the same call. The input does not need to be sorted; every
 * judgement is per book.
 */
export function reviewShelving(books: FiledBook[]): ShelvingReview {
  const misfiles: Misfile[] = []
  const excluded: Excluded[] = []

  for (const book of books) {
    if (book.checkedOut) {
      excluded.push({ book, reason: 'checked-out' })
      continue
    }

    if (book.areaId === null) {
      excluded.push({ book, reason: 'never-placed' })
      continue
    }

    if (book.derivedAreaId === null) {
      excluded.push({ book, reason: 'unplaceable' })
      continue
    }

    if (book.areaId === book.derivedAreaId) continue

    const from = book.location
    const to = book.derivedLocation
    misfiles.push({
      book,
      from,
      to,
      toAreaId: book.derivedAreaId,
      // Null until a caller that can see the furniture says otherwise. See
      // `Misfile.sharedNumber`.
      sharedNumber: null,
      instruction:
        `${book.title} (${bestKnownAuthor(book.authorFiling, book.authors) || 'unknown author'}) is at ` +
        `${from} and belongs at ${to}.`,
    })
  }

  // Ordered by where the book currently is, because that is the order somebody
  // walks the shelves picking them up. Where the furniture stands rather than
  // what it is called: a piece named "Hall shelf" is not walked to between 1
  // and 2 because H sorts there.
  misfiles.sort((a, b) =>
    (a.book.standing?.fixture ?? 0) - (b.book.standing?.fixture ?? 0) ||
    (a.book.standing?.plank ?? 0) - (b.book.standing?.plank ?? 0) ||
    (a.book.sortKey < b.book.sortKey ? -1 : a.book.sortKey > b.book.sortKey ? 1 : 0))

  return { misfiles, excluded }
}

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
 * Fold text down to `[A-Z0-9 ]` so SQLite's default BINARY collation orders it
 * correctly without the ICU extension.
 *
 * Space (0x20) sorting below every letter is load-bearing: it is what makes
 * `SMITH ANN` come before `SMITHSON A`.
 */
export function normalise(value: string): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '') // drop combining marks (accented letters fold to plain ASCII)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
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
 */
export function filingName(display: string): string {
  let tokens = (display ?? '')
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

  if (!tokens.length) return ''

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

/** Best photo for recognising a book on a shelf. Spine first, by a mile. */
export function shelfPhoto(neighbour: Neighbour | null): string {
  if (!neighbour) return ''
  return neighbour.images.edge || neighbour.images.front || neighbour.images.back || ''
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

export interface ShelvedBook {
  id: number
  title: string
  authorFiling: string
  location: string
  sortKey: string
}

export interface Misfile {
  book: ShelvedBook
  previous: ShelvedBook
  reason: string
}

/**
 * The invariant: within a range, when books are ordered by sort key their
 * location rank must never go backwards.
 *
 * An inversion means the book is physically in the wrong place or a location
 * was mistyped. Since locations are hand-entered, this check is the only thing
 * standing between this system and slow silent drift.
 *
 * `books` must already be sorted by sortKey. Books with no location yet are
 * skipped, not reported: they are unshelved, not misfiled.
 */
export function findMisfiles(books: ShelvedBook[]): Misfile[] {
  const misfiles: Misfile[] = []
  let previous: ShelvedBook | null = null

  for (const book of books) {
    if (!book.location) continue
    if (previous && compareLocations(previous.location, book.location) > 0) {
      misfiles.push({
        book,
        previous,
        reason:
          `${book.title} sorts after ${previous.title} but is shelved at ` +
          `${book.location}, ahead of ${previous.location}.`,
      })
    }
    previous = book
  }

  return misfiles
}

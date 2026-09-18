/**
 * The arithmetic and the wording the furniture screens share: pure functions, no
 * fetching and no React.
 *
 * `labelFor` is taken from `domain/placement/geography` rather than restated
 * here, in a file that otherwise touches nothing below `src/`. A second spelling
 * of it in the client is how a screen ends up previewing `Hall shelf A` for
 * something the server will call `Hall shelf · A`.
 */

import { labelFor } from '../../domain/placement/geography'
import { orderBy } from '../../domain/placement/strategies'
import type { OrderEnds, SampleBook } from '../design/Rules'
import type {
  AreaBook, AreaDto, FixtureDto, FixtureRemoval, FurnitureDto, RuleDto, SortStrategyCode,
} from './api'
import type { AreaStanding } from '../../shared/shelving'

export interface Standing {
  id: number
  name: string
  position: number
}

/**
 * The numbers the room already uses, in order: the places a piece can stand.
 *
 * Not one to however many pieces there are. A gap is somebody's room and not a
 * mistake, and closing it to tidy the numbers would relabel every location
 * recorded on the pieces after it. Two pieces standing on one number is a real
 * arrangement too, so a duplicate stays in this list.
 */
export const places = (order: readonly Standing[]): number[] =>
  order.map((piece) => piece.position).sort((a, b) => a - b)

/**
 * The places stay where they are and the pieces move through them, so the writes
 * are exactly the pieces that ended up on a different number. A drag that ends
 * where it started writes nothing at all.
 */
export function renumbering(order: readonly Standing[]): { id: number; position: number }[] {
  const numbers = places(order)
  return order.flatMap((piece, at) =>
    (piece.position === numbers[at]! ? [] : [{ id: piece.id, position: numbers[at]! }]))
}

/**
 * What the areas of a piece will read as, once it is called this and stands
 * there. Worked out by the same function the server uses, because a preview that
 * disagreed with the answer would be worse than no preview.
 */
export function labelsIfNamed(
  fixture: { position: number; kind: string; name: string },
  areas: readonly { position: number; name: string }[],
  named: { name: string; position: number },
): string[] {
  return areas.map((area) => labelFor({
    fixture: {
      id: 0,
      position: named.position,
      kind: fixture.kind,
      name: named.name.trim(),
      sortStrategy: 'inherit',
    },
    area: {
      id: 0,
      fixtureId: 0,
      position: area.position,
      name: area.name,
      startsAt: '',
      sortStrategy: 'inherit',
    },
  }))
}

/** Numbers written out to twelve, and in digits above that. */
const WORDS = [
  'no', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
]

export function counted(n: number, one: string, many = `${one}s`): string {
  const word = n >= 0 && n < WORDS.length ? WORDS[n]! : String(n)
  return `${word} ${n === 1 ? one : many}`
}

/** The same, with digits, where a count is the point rather than prose. */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`

/**
 * Why a piece cannot be taken out of the room yet, in the words the server
 * refuses in. Two clauses, because a book standing on the piece and a book the
 * carry list is still sending to it need different things done, and the second
 * is not on the piece at all. Undefined when nothing holds it.
 */
export function stillHolds(removal: FixtureRemoval | null): string | undefined {
  if (!removal || removal.books <= 0) return undefined

  const standing = removal.books - removal.assigned
  const said = [
    standing ? `its ${plural(standing, 'book')} move to other furniture first` : '',
    removal.assigned
      ? `the carry list is still sending ${plural(removal.assigned, 'book')} to it`
      : '',
  ].filter(Boolean).join(', and ')

  return said.charAt(0).toUpperCase() + said.slice(1)
}

/** What the whole room adds up to, as the line under "Your fixtures". */
export function roomSaid(fixtures: readonly FixtureDto[]): string {
  const areas = fixtures.reduce((total, piece) => total + piece.areas.length, 0)
  const sentence = `${counted(fixtures.length, 'piece')}, ${counted(areas, 'area')}`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/**
 * The piece's `kind` is the owner's own word and nothing branches on it, so it
 * goes into the sentence rather than being looked up in a table.
 */
export function addAreaSaid(kind: string): string {
  const thing = kind.trim().toLowerCase()
  if (!thing || thing === 'bookshelf') return 'Add an area to this bookcase'
  return `Add an area to this ${thing}`
}

/** What a piece is, as a word somebody would use rather than a schema value. */
export function kindSaid(kind: string): string {
  const thing = kind.trim()
  if (!thing || thing.toLowerCase() === 'bookshelf') return 'Bookcase'
  return thing.charAt(0).toUpperCase() + thing.slice(1)
}

/**
 * What a piece is called when nobody has called it anything. `label` answers `2`,
 * which is right on an area (`2A`) and is not something anybody says out loud
 * about a piece of furniture, so this is the kind and the number, and the kind is
 * the owner's own word.
 */
export const pieceSaid = (piece: Pick<FixtureDto, 'name' | 'kind' | 'position'>): string =>
  piece.name.trim() || `${kindSaid(piece.kind)} ${piece.position}`

/**
 * The same answer, asked of the little of a piece that an `AreaStanding` carries.
 * A second spelling of "what is this piece called" is how one screen ends up
 * saying something else.
 */
export const pieceOn = (standing: AreaStanding): string =>
  pieceSaid({ name: standing.name, kind: standing.kind, position: standing.fixture })

export interface Renaming {
  from: string
  to: string
}

/**
 * Everything a person reads that reads differently once the pieces stand in this
 * order, worked out before anything is written and in the same shape the server
 * answers a write with.
 *
 * A piece with a name is not renamed by moving it, and neither are its areas: a
 * label is worked out from the name where there is one and from the position
 * where there is not, so a room somebody has named reads the same wherever the
 * pieces stand. The pieces and the areas come back apart because a screen says
 * them differently.
 */
export function renamings(order: readonly FixtureDto[]): {
  pieces: Renaming[]
  areas: Renaming[]
} {
  const numbers = places(order)
  const pieces: Renaming[] = []
  const areas: Renaming[] = []

  order.forEach((piece, at) => {
    const position = numbers[at]!
    if (position === piece.position) return

    const called = pieceSaid(piece)
    const willBe = pieceSaid({ ...piece, position })
    if (called !== willBe) pieces.push({ from: called, to: willBe })

    const before = labelsIfNamed(piece, piece.areas, { name: piece.name, position: piece.position })
    const after = labelsIfNamed(piece, piece.areas, { name: piece.name, position })
    before.forEach((label, index) => {
      if (label !== after[index]) areas.push({ from: label, to: after[index]! })
    })
  })

  return { pieces, areas }
}

/**
 * Where a rule points, said the way this app says a place. A rule about a whole
 * piece answers `4`, which is the label of the piece and not something anybody
 * says out loud about furniture, so the piece itself is asked, which is why the
 * rule carries `placeId`. See `docs/data-model.md`.
 */
export function rulePlace(room: FurnitureDto | null, rule: RuleDto): string {
  if (rule.about === 'area') return rule.place
  const standing = room?.fixtures.find((one) => one.id === rule.placeId)
  return standing ? pieceSaid(standing) : rule.place
}

/**
 * The count line beside a piece's name. Two pieces standing on one number is a
 * real arrangement, and also two pieces whose areas draw the same labels, so the
 * line says so rather than showing `4A` twice with no explanation.
 */
export function pieceNote(piece: Pick<FixtureDto, 'books' | 'sharing' | 'position'>): string {
  const books = plural(piece.books, 'book')
  if (!piece.sharing.length) return books
  return `${books} · ${counted(piece.sharing.length + 1, 'piece')} stand at ${piece.position}`
}

/**
 * The vocabulary is a table in the database and its labels are written for the
 * schema: `inherit` is stored as "Same as the shelf it is on", and "shelf" is a
 * word this interface never says. So the codes are given their words here, and
 * an unknown code falls back to whatever the server called it.
 */
const ORDER_WORD: Record<Exclude<SortStrategyCode, 'inherit'>, string> = {
  author: 'By the author',
  title: 'By the title',
  published: 'By the year it came out',
  tag: 'By tag',
}

export function orderingSaid(code: SortStrategyCode, from: string, fallback = ''): string {
  if (code === 'inherit') return `The way ${from} does`
  return ORDER_WORD[code] ?? fallback
}

/** Why a book is being left exactly where it is. */
export const SKIP_SAID: Record<string, string> = {
  pinned: 'pinned where they are, which beats every rule',
  'checked-out': 'checked out, so they are not standing here to be refiled',
  withdrawn: 'withdrawn from the collection',
  'never-placed': 'never confirmed onto a piece of furniture',
}

export const skippedSaid = (reason: string, books: number): string =>
  `${plural(books, 'book')} ${SKIP_SAID[reason] ?? 'left alone'}`

/**
 * What one ordering files a book under, which is the thing that changes when the
 * ordering does. A tag is drawn by its label: a slug is an identity, and putting
 * one on a screen is the same mistake as showing somebody a row id.
 */
export function filedUnder(code: Exclude<SortStrategyCode, 'inherit'>, book: AreaBook): string {
  if (code === 'title') return book.titleFiling || book.title
  if (code === 'published') return book.published || 'no year'
  if (code === 'tag') return book.tags[0] ?? 'no tag'
  return book.authorFiling || 'unknown author'
}

/**
 * The book beside what it is filed under, said by whatever that is not. Ordering
 * by the title and printing the title beside it would be the same string twice,
 * so the second column is the author there and the title everywhere else.
 */
export const saidBeside = (code: Exclude<SortStrategyCode, 'inherit'>, book: AreaBook): string =>
  (code === 'title' ? book.authorFiling || 'unknown author' : book.title)

/** How many books a place shows as its own evidence before saying "and more". */
export const SAMPLE = 6

/**
 * The books of a place, in the order an ordering would put them, by the same
 * function the shelf itself is built by. Capped, because this is evidence rather
 * than a listing.
 */
export function sampleOrdered(
  code: Exclude<SortStrategyCode, 'inherit'>,
  books: readonly AreaBook[],
  limit = SAMPLE,
): { sample: SampleBook[]; more: number } {
  const ordered = orderBy(code, [...books])
  return {
    sample: ordered.slice(0, limit).map((book) => ({
      id: book.id,
      by: filedUnder(code, book),
      said: saidBeside(code, book),
    })),
    more: Math.max(0, ordered.length - limit),
  }
}

/**
 * Every one of these books, in the order an ordering puts them. The read answers
 * by filing key, which is the author's, so an area ordered by the year would
 * otherwise draw a board contradicting the card directly above it.
 */
export const inOrder = (
  code: Exclude<SortStrategyCode, 'inherit'>,
  books: readonly AreaBook[],
): AreaBook[] => orderBy(code, [...books])

/**
 * The two ends of these books, as one ordering files them. `filedUnder` at both
 * ends rather than the title, so it reads as the ordering reads.
 *
 * Undefined under two books, because a place with one book in it is not in any
 * order, and undefined where the two ends read the same, which is a real area:
 * eleven Frank Herberts filed by the author say nothing twice.
 */
export function orderEnds(
  code: Exclude<SortStrategyCode, 'inherit'>,
  books: readonly AreaBook[],
): OrderEnds | undefined {
  if (books.length < 2) return undefined

  const ordered = orderBy(code, [...books])
  const first = filedUnder(code, ordered[0]!)
  const last = filedUnder(code, ordered[ordered.length - 1]!)
  return first === last ? undefined : { first, last }
}

/**
 * Where an area's ordering is actually settled, in one sentence. It names the
 * place that decides and stops: an area that follows a piece that follows the
 * library is told about the library, because changing the piece would be
 * changing a level that is currently deciding nothing.
 */
export function areaSettled(piece: FixtureDto, area: AreaDto): string {
  if (area.sortStrategy !== 'inherit') {
    return 'Set on this area, so nothing above it decides how these books read.'
  }
  if (piece.sortStrategy !== 'inherit') {
    return `Set on ${pieceSaid(piece)}, which this area follows.`
  }
  return `Set for the whole library, which ${pieceSaid(piece)} and this area both follow.`
}

/** The same sentence one level up. Nothing stands between a piece and the library. */
export function fixtureSettled(piece: FixtureDto): string {
  if (piece.sortStrategy !== 'inherit') {
    return 'Set here, and every area on it that orders nothing of its own follows it.'
  }
  return `Set for the whole library, which ${pieceSaid(piece)} follows, and so does `
    + 'every area on it that orders nothing of its own.'
}

/**
 * What picking this ordering would do to the books flowing into an area, said
 * before anything is pressed: an area with an ordering of its own is a place of
 * its own and takes no overflow from the area before it. Silent on an area the
 * books already start in, because nothing overflows into the first area of a
 * stretch whatever it is ordered by.
 */
export function orderingWarning(area: AreaDto, chosen: SortStrategyCode, from: string): string {
  if (area.entry) return ''
  if (chosen === area.sortStrategy) return ''

  if (chosen !== 'inherit' && area.sortStrategy === 'inherit') {
    return 'Ordering this area its own way also means it stops taking what overflows '
      + 'from the area before it.'
  }
  if (chosen === 'inherit' && area.sortStrategy !== 'inherit') {
    return `Following ${from} again also means it starts taking what overflows from `
      + 'the area before it.'
  }
  return ''
}

/**
 * What inheriting means is not the same in the two places that ask, which is why
 * the fallback is a parameter rather than a sentence written here: an area with
 * no ordering of its own takes the piece it stands on, and a piece with none
 * takes the whole library.
 */
export function sortOptions(
  room: FurnitureDto,
  from: string,
  falls: Exclude<SortStrategyCode, 'inherit'>,
): { value: SortStrategyCode; word: string; sub?: string }[] {
  return room.strategies.map((strategy) => ({
    value: strategy.code,
    word: strategy.isInherit ? `The way ${from} does` : orderingSaid(strategy.code, from, strategy.label),
    sub: strategy.isInherit ? `${orderingSaid(falls, from)} today` : undefined,
  }))
}

/** What a piece falls back on when it orders nothing itself: the library's. */
export const collectionOrdering = (room: FurnitureDto): Exclude<SortStrategyCode, 'inherit'> =>
  (room.defaultSortStrategy === 'inherit' ? 'author' : room.defaultSortStrategy)

/** What an area falls back on: the piece's answer, or the library's behind it. */
export function fixtureOrdering(
  room: FurnitureDto,
  piece: FixtureDto,
): Exclude<SortStrategyCode, 'inherit'> {
  if (piece.sortStrategy !== 'inherit') return piece.sortStrategy
  return collectionOrdering(room)
}

/**
 * Every rule that reaches a place, smaller place first, which is the order that
 * settles a tie.
 */
export function reaching(
  room: FurnitureDto | null,
  place: { rule: RuleDto | null },
  wider: { rule: RuleDto | null } | null,
): { id: number; name: string; place: string; wide: boolean }[] {
  return [place.rule, wider?.rule ?? null]
    .filter((rule): rule is RuleDto => rule !== null)
    .filter((rule, at, all) => all.findIndex((one) => one.id === rule.id) === at)
    .sort((a, b) => Number(b.about === 'area') - Number(a.about === 'area'))
    .map((rule) => ({
      id: rule.id,
      name: rule.name,
      place: rulePlace(room, rule),
      wide: rule.about === 'fixture',
    }))
}

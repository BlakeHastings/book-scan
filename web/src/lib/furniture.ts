/**
 * The arithmetic and the wording the furniture screens share.
 *
 * Pure functions, no fetching and no React, so the awkward cases are checked
 * here rather than driven through six screens: two pieces standing on one
 * number, a drag that renumbers four of five pieces, a count that excludes
 * pinned books, and the difference between what the rules want and where a book
 * actually is.
 *
 * ## The one import from `domain/`
 *
 * `labelFor` is taken from `domain/placement/geography` rather than restated
 * here, and that is deliberate in a file that otherwise touches nothing below
 * `src/`. A label is worked out from a piece's number and name and an area's
 * ordinal and name, and `labelFor` says so it is "the only place a label comes
 * from". A second spelling of it in the client is exactly how a screen ends up
 * previewing `Hall shelf A` for something the server will call `Hall shelf · A`.
 * It is a pure function over two plain objects: nothing else comes with it.
 */

import { labelFor } from '../../domain/placement/geography'
import type { AreaDto, FixtureDto, SortStrategyCode } from './api'

/** A piece as the ordering column holds it while somebody drags it about. */
export interface Standing {
  id: number
  /** What it is called, or what it is called when it is called nothing. */
  name: string
  position: number
}

/**
 * The numbers the room already uses, in order: the places a piece can stand.
 *
 * **Not one to however many pieces there are.** This catalogue's own furniture
 * stands at 1, 2 and 4, and non-fiction lives on the one called 4, so every
 * non-fiction book in it is recorded on a plank whose label begins with that
 * digit. Closing the gap to make the numbers tidy would relabel all of them,
 * which is a hundred and eighty-seven recorded locations rewritten because
 * somebody dragged something else. The gap is somebody's room, not a mistake.
 *
 * The same argument keeps a duplicate: **two pieces both standing at 4** is an
 * arrangement this catalogue has, so 4 appears twice in this list and two
 * pieces can still land on it.
 */
export const places = (order: readonly Standing[]): number[] =>
  order.map((piece) => piece.position).sort((a, b) => a - b)

/**
 * The writes a reordering of the room comes down to, and no more of them.
 *
 * The places stay where they are and the pieces move through them, so the
 * writes are exactly the pieces that ended up on a different number. A drag
 * that ends where it started writes nothing at all, and neither does saving a
 * screen where only the name was typed into.
 */
export function renumbering(order: readonly Standing[]): { id: number; position: number }[] {
  const numbers = places(order)
  return order.flatMap((piece, at) =>
    (piece.position === numbers[at]! ? [] : [{ id: piece.id, position: numbers[at]! }]))
}

/**
 * What the areas of a piece will read as, once it is called this and stands
 * there.
 *
 * The preview under the ordering column, and the reason the fixture screen can
 * be a form with a Save on it rather than a write per keystroke. It is worked
 * out the way the server works it out, by the same function, because a preview
 * that disagreed with the answer would be worse than no preview.
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

/**
 * How this app says a number of things.
 *
 * Written out to twelve and then in digits, which is the line the rest of the
 * interface already draws: "Five pieces, sixteen areas" reads as a sentence and
 * "1,204 books" reads as a count, and somewhere around a dozen is where one
 * turns into the other.
 */
const WORDS = [
  'no', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
]

export function counted(n: number, one: string, many = `${one}s`): string {
  const word = n >= 0 && n < WORDS.length ? WORDS[n]! : String(n)
  return `${word} ${n === 1 ? one : many}`
}

/** The same, with digits, for the places a count is the point rather than prose. */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`

/** What the whole room adds up to, as the line under "Your furniture". */
export function roomSaid(fixtures: readonly FixtureDto[]): string {
  const areas = fixtures.reduce((total, piece) => total + piece.areas.length, 0)
  const sentence = `${counted(fixtures.length, 'piece')}, ${counted(areas, 'area')}`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/**
 * The word for adding an area to this particular piece.
 *
 * "Add an area to this desk" is right because that piece is a desk, and "add an
 * area to this bookcase" would be wrong on the next one, which is a crate. The
 * piece's `kind` is the owner's own word and nothing branches on it, so it is
 * put in the sentence rather than looked up in a table.
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
 * What a piece is called when nobody has called it anything.
 *
 * `label` answers `2`, which is right on an area (`2A`) and is not something
 * anybody says out loud about a piece of furniture. So the kind and the
 * number, and the kind is the owner's own word: the fifth piece in his room is
 * a desk, and calling it a bookcase would be the app telling him what he owns.
 */
export const pieceSaid = (piece: Pick<FixtureDto, 'name' | 'kind' | 'position'>): string =>
  piece.name.trim() || `${kindSaid(piece.kind)} ${piece.position}`

/**
 * The count line beside a piece's name, which says the awkward thing when
 * there is one.
 *
 * **Two pieces standing on one number is an arrangement this catalogue has**,
 * and it is also two pieces whose areas draw the same labels. A screen that did
 * not say so would show `4A` twice with no explanation, and somebody would go
 * looking for the mistake in the wrong place.
 */
export function pieceNote(piece: Pick<FixtureDto, 'books' | 'sharing' | 'position'>): string {
  const books = plural(piece.books, 'book')
  if (!piece.sharing.length) return books
  return `${books} · ${counted(piece.sharing.length + 1, 'piece')} stand at ${piece.position}`
}

/**
 * How an area is ordered, in the same voice the rest of these screens use.
 *
 * The vocabulary is a table in the database and its labels are written for the
 * schema: `inherit` is stored as "Same as the shelf it is on", and "shelf" is a
 * word this code says and this interface never does. So the codes are given
 * their words here, and an unknown code falls back to whatever the server
 * called it rather than being dropped.
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

/** What an area is ordered by today, whoever settled it. */
export const orderedSaid = (area: AreaDto, from: string): string =>
  (area.selfContained ? orderingSaid(area.sortStrategy, from) : `The way ${from} does`)

/**
 * Why a book is being left exactly where it is.
 *
 * A count with no reason beside it is worse than no count: the person cannot
 * tell whether it is expected. Pinned is the one that always is, and it is the
 * one the model promises can never be overridden.
 */
export const SKIP_SAID: Record<string, string> = {
  pinned: 'pinned where they are, which beats every rule',
  'checked-out': 'checked out, so they are not standing here to be refiled',
  withdrawn: 'withdrawn from the collection',
  'never-placed': 'never confirmed onto a piece of furniture',
}

export const skippedSaid = (reason: string, books: number): string =>
  `${plural(books, 'book')} ${SKIP_SAID[reason] ?? 'left alone'}`

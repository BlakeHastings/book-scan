/**
 * The arithmetic and the wording behind the furniture screens.
 *
 * Every case here is one a wireframe cannot show you, because a wireframe's
 * numbers were chosen: a room numbered 1, 2 and 4 with a gap in it, two pieces
 * both standing at 4, an area holding one book, and a piece that is a crate
 * rather than a bookcase.
 */

import { describe, expect, it } from 'vitest'
import { moveWithin } from '../design/Furniture'
import {
  addAreaSaid, counted, kindSaid, labelsIfNamed, orderedSaid, orderingSaid,
  pieceNote, pieceSaid, places, plural, renamings, renumbering, roomSaid, skippedSaid,
  type Standing,
} from './furniture'
import type { AreaDto, FixtureDto } from './api'

const standing = (id: number, position: number, name = ''): Standing =>
  ({ id, name, position })

/** The owner's room as it is: pieces at 1, 2 and 4, and non-fiction on the 4. */
const room = [standing(1, 1), standing(3, 2), standing(2, 4)]

describe('moving a piece in the column', () => {
  it('carries one entry to another place and leaves the rest in order', () => {
    expect(moveWithin(['a', 'b', 'c', 'd'], 2, 0)).toEqual(['c', 'a', 'b', 'd'])
    expect(moveWithin(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('changes nothing when a finger comes down and goes up again', () => {
    expect(moveWithin(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })
})

describe('the numbers a room stands on', () => {
  /**
   * The one that matters. This catalogue's furniture is numbered 1, 2 and 4,
   * non-fiction lives on the piece called 4, and every non-fiction book in it
   * is recorded on a plank whose label starts with that digit. Tidying the gap
   * away would rewrite all of them because somebody dragged something else.
   */
  it('keeps the gap in them', () => {
    expect(places(room)).toEqual([1, 2, 4])
  })

  it('keeps a number two pieces both stand on', () => {
    const shared = [standing(1, 1), standing(2, 4), standing(3, 4)]
    expect(places(shared)).toEqual([1, 4, 4])
  })
})

describe('what a reordering comes down to', () => {
  it('writes nothing when nothing moved', () => {
    expect(renumbering(room)).toEqual([])
  })

  /**
   * The places stay where they are and the pieces move through them, so a piece
   * dragged to the front takes the number that was at the front. Nothing lands
   * on a number the room did not already have.
   */
  it('hands the room its own numbers back, in the new order', () => {
    const moved = moveWithin(room, 2, 0)
    expect(renumbering(moved)).toEqual([
      { id: 2, position: 1 },
      { id: 1, position: 2 },
      { id: 3, position: 4 },
    ])
  })

  it('writes only the pieces whose number actually changed', () => {
    const moved = moveWithin(room, 0, 1)
    expect(renumbering(moved)).toEqual([
      { id: 3, position: 1 },
      { id: 1, position: 2 },
    ])
  })
})

describe('what a piece is called', () => {
  it('uses the name where there is one', () => {
    expect(pieceSaid({ name: 'By the window', kind: 'bookshelf', position: 1 }))
      .toBe('By the window')
  })

  /** `1` is a label for a plank and not a thing anybody says about furniture. */
  it('says the kind and the number where there is not', () => {
    expect(pieceSaid({ name: '', kind: 'bookshelf', position: 2 })).toBe('Bookcase 2')
    expect(pieceSaid({ name: '', kind: 'crate', position: 4 })).toBe('Crate 4')
  })

  it('calls the schema default a bookcase and anything else what it is', () => {
    expect(kindSaid('bookshelf')).toBe('Bookcase')
    expect(kindSaid('')).toBe('Bookcase')
    expect(kindSaid('desk')).toBe('Desk')
  })

  it('adds an area to the piece somebody actually owns', () => {
    expect(addAreaSaid('bookshelf')).toBe('Add an area to this bookcase')
    expect(addAreaSaid('desk')).toBe('Add an area to this desk')
    expect(addAreaSaid('crate')).toBe('Add an area to this crate')
  })
})

describe('two pieces standing on one number', () => {
  const piece = (over: Partial<FixtureDto> = {}) => ({
    books: 7, sharing: [] as number[], position: 4, ...over,
  })

  it('is said where it can be seen, because both draw the same labels', () => {
    expect(pieceNote(piece({ sharing: [9] }))).toBe('7 books · two pieces stand at 4')
  })

  it('says nothing extra about a piece standing on its own number', () => {
    expect(pieceNote(piece())).toBe('7 books')
  })
})

describe('counting', () => {
  it('writes small numbers out and leaves large ones as digits', () => {
    expect(counted(3, 'piece')).toBe('three pieces')
    expect(counted(1, 'area')).toBe('one area')
    expect(counted(40, 'area')).toBe('40 areas')
  })

  it('never says "1 books"', () => {
    expect(plural(1, 'book')).toBe('1 book')
    expect(plural(0, 'book')).toBe('0 books')
  })

  it('opens the room with a sentence', () => {
    const fixtures = [
      { areas: [{}, {}] }, { areas: [{}] },
    ] as unknown as FixtureDto[]
    expect(roomSaid(fixtures)).toBe('Two pieces, three areas')
  })
})

describe('what the areas of a piece will be called', () => {
  /**
   * Worked out by the same function the server works the real one out with, so
   * the preview cannot promise a name the answer disagrees with. Naming either
   * side turns the label into a phrase, which is what the separator is for.
   */
  const areas = [{ position: 0, name: '' }, { position: 1, name: 'Cookery' }]

  it('runs the number and the letter together while nothing is named', () => {
    expect(labelsIfNamed(
      { position: 2, kind: 'bookshelf', name: '' },
      areas,
      { name: '', position: 2 },
    )).toEqual(['2A', '2 · Cookery'])
  })

  it('follows the piece to the number it is being dragged to', () => {
    expect(labelsIfNamed(
      { position: 2, kind: 'bookshelf', name: '' },
      areas,
      { name: '', position: 4 },
    )).toEqual(['4A', '4 · Cookery'])
  })

  it('reads as a phrase once the piece has a name', () => {
    expect(labelsIfNamed(
      { position: 2, kind: 'bookshelf', name: '' },
      areas,
      { name: 'Hall shelf', position: 2 },
    )).toEqual(['Hall shelf · A', 'Hall shelf · Cookery'])
  })
})

/**
 * What a person sees change when the room is put in order, which is what the
 * card promising "what they will be numbered" was trying and failing to say.
 * The numbers do not change: they are the room's and the pieces move through
 * them. What changes is what an unnamed piece and its areas are called.
 */
describe('what a reordering renames', () => {
  const piece = (id: number, position: number, name = ''): FixtureDto => ({
    id,
    position,
    label: String(position),
    kind: 'bookshelf',
    name,
    sortStrategy: 'inherit',
    note: '',
    books: 8,
    areas: [
      { position: 0, name: '' },
      { position: 1, name: 'Cookery' },
    ] as FixtureDto['areas'],
    gone: [],
    sharing: [],
    holds: '',
    rule: null,
    own: [],
  })

  /** The owner's own room, with the gap in it: pieces at 1, 2 and 4. */
  const room = [piece(1, 1), piece(3, 2), piece(2, 4)]

  it('renames an unnamed piece and every area on it, because both are its number', () => {
    expect(renamings(moveWithin(room, 2, 0))).toEqual({
      pieces: [
        { from: 'Bookcase 4', to: 'Bookcase 1' },
        { from: 'Bookcase 1', to: 'Bookcase 2' },
        { from: 'Bookcase 2', to: 'Bookcase 4' },
      ],
      areas: [
        { from: '4A', to: '1A' },
        { from: '4 · Cookery', to: '1 · Cookery' },
        { from: '1A', to: '2A' },
        { from: '1 · Cookery', to: '2 · Cookery' },
        { from: '2A', to: '4A' },
        { from: '2 · Cookery', to: '4 · Cookery' },
      ],
    })
  })

  /**
   * The owner's four bookshelves, which he has named. This is the answer to
   * the number that made no sense beside them: dragging them about renames
   * nothing at all, and the screen can say so.
   */
  it('renames nothing at all in a room where every piece has a name', () => {
    const named = [piece(1, 1, 'Bookshelf 1'), piece(2, 4, 'Bookshelf 2'), piece(3, 5, 'Bookshelf 3')]
    expect(renamings(moveWithin(named, 2, 0))).toEqual({ pieces: [], areas: [] })
  })

  it('renames nothing when nothing moved', () => {
    expect(renamings(room)).toEqual({ pieces: [], areas: [] })
  })

  /**
   * Two pieces both standing at 4 is this catalogue today. Swapping them lands
   * each on the number the other held, which is the same number, so neither is
   * renamed and neither is renumbered.
   */
  it('survives two pieces sharing a number, and renames neither of them', () => {
    const shared = [piece(1, 1), piece(2, 4), piece(3, 4)]
    expect(renamings(moveWithin(shared, 2, 1))).toEqual({ pieces: [], areas: [] })
  })
})

describe('how an area is ordered', () => {
  /**
   * The vocabulary is a table in the database and its labels are written for
   * the schema: `inherit` is stored as "Same as the shelf it is on", and shelf
   * is a word this code says and this interface never does.
   */
  it('says inheriting as the piece it inherits from', () => {
    expect(orderingSaid('inherit', 'Bookcase 2')).toBe('The way Bookcase 2 does')
    expect(orderingSaid('author', 'Bookcase 2')).toBe('By the author')
    expect(orderingSaid('published', 'Bookcase 2')).toBe('By the year it came out')
  })

  it('says an area that orders itself by what it orders itself by', () => {
    const own = { sortStrategy: 'title', selfContained: true } as AreaDto
    const takes = { sortStrategy: 'inherit', selfContained: false } as AreaDto
    expect(orderedSaid(own, 'Bookcase 2')).toBe('By the title')
    expect(orderedSaid(takes, 'Bookcase 2')).toBe('The way Bookcase 2 does')
  })
})

/**
 * A plan that says "18 books join 2B" having quietly left three pinned ones out
 * of the eighteen is lying by omission at the one moment somebody is deciding
 * about their own books. Every reason gets a sentence, and pinned says why it
 * cannot be overridden.
 */
describe('books a change leaves exactly where they are', () => {
  it('gives every reason a sentence with the count in it', () => {
    expect(skippedSaid('pinned', 3))
      .toBe('3 books pinned where they are, which beats every rule')
    expect(skippedSaid('checked-out', 1)).toMatch(/^1 book checked out/)
    expect(skippedSaid('withdrawn', 2)).toMatch(/^2 books withdrawn/)
  })

  it('says something rather than nothing for a reason it has never heard of', () => {
    expect(skippedSaid('something-new', 4)).toBe('4 books left alone')
  })
})

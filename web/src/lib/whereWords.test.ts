import { describe, expect, it } from 'vitest'
import { whereItGoes } from './whereWords'
import type { PlacementResponse, StripBook } from './api'

const book = (id: number, title: string, authorFiling: string) => ({
  id, title, authorFiling, authors: '', location: '1A', areaId: 11, sortKey: '',
  images: { front: '', back: '', edge: '' },
})

const spine = (id: number, title: string, authorFiling: string): StripBook => ({
  id, title, authorFiling, spine: '', spineSlot: 'edge',
})

const at = (over: Partial<PlacementResponse>): PlacementResponse => ({
  kind: 'between-same-location',
  range: 'fiction',
  instruction: '',
  suggestedLocation: '1A',
  derivedLocation: '1A',
  authorFiling: 'Ishiguro, Kazuo',
  sortKey: '',
  predecessor: null,
  successor: null,
  strip: null,
  ...over,
})

describe('the sentence that says where a book goes', () => {
  it('names the shelf and the two surnames', () => {
    expect(whereItGoes(at({
      predecessor: book(1, 'Children of Dune', 'Herbert, Frank'),
      successor: book(2, 'The Dispossessed', 'Le Guin, Ursula K.'),
    }), 'The Remains of the Day')).toBe('Shelf 1A, between Herbert and Le Guin')
  })

  it('falls back to titles when one author is on both sides', () => {
    expect(whereItGoes(at({
      authorFiling: 'Herbert, Frank',
      predecessor: book(1, 'Dune', 'Herbert, Frank'),
      successor: book(2, 'Dune Messiah', 'Herbert, Frank'),
    }), 'Children of Dune')).toBe('Shelf 1A, between Dune and Dune Messiah')
  })

  it('says next to your other copy when the other copy stands beside the gap', () => {
    expect(whereItGoes(at({
      predecessor: book(1, 'Children of Dune', 'Herbert, Frank'),
      successor: book(2, 'The Dispossessed', 'Le Guin, Ursula K.'),
      strip: {
        label: '1A', gapIndex: 2, placedIndex: null,
        books: [
          spine(1, 'Children of Dune', 'Herbert, Frank'),
          spine(46, 'The Remains of the Day', 'Ishiguro, Kazuo'),
          spine(2, 'The Dispossessed', 'Le Guin, Ursula K.'),
        ],
      },
    }), 'The Remains of the Day', 46)).toBe('Shelf 1A, next to your other copy')
  })

  it('knows a second copy by its title and author when nothing names it', () => {
    expect(whereItGoes(at({
      predecessor: book(46, 'The Remains of the Day', 'Ishiguro, Kazuo'),
    }), 'The Remains of the Day')).toBe('Shelf 1A, next to your other copy')
  })

  it('says after, before, or first when a side is empty', () => {
    expect(whereItGoes(at({ predecessor: book(1, 'Dune', 'Herbert, Frank') }), 'X'))
      .toBe('Shelf 1A, after Herbert')
    expect(whereItGoes(at({ successor: book(2, 'Beloved', 'Morrison, Toni') }), 'X'))
      .toBe('Shelf 1A, before Morrison')
    expect(whereItGoes(at({}), 'X')).toBe('Shelf 1A, the first book on it')
  })

  it('names a book with no author by its title', () => {
    expect(whereItGoes(at({ predecessor: book(1, 'Beowulf', '') }), 'X'))
      .toBe('Shelf 1A, after Beowulf')
  })
})

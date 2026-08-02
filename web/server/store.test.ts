/**
 * Integration coverage for the path that actually matters: a book goes in,
 * the two index seeks find its neighbours, and the instruction names them.
 * Runs against a real in-memory SQLite database, not a mock.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './db'
import { Store, type DraftBook } from './store'

function draft(over: Partial<DraftBook> & { title: string; authors: string[] }): DraftBook {
  return { isFiction: true, ...over }
}

let store: Store

beforeEach(() => {
  store = new Store(openDatabase(':memory:'))
})

describe('placement as books arrive one at a time', () => {
  it('calls the very first book the start of its range', () => {
    const placement = store.placementFor(
      draft({ title: 'Dune', authors: ['Frank Herbert'] }),
    )
    expect(placement.kind).toBe('first-in-range')
    expect(placement.suggestedLocation).toBe('1A')
  })

  it('sends non-fiction to shelf 4, independent of fiction', () => {
    store.addBook(draft({ title: 'Dune', authors: ['Frank Herbert'], location: '1A' }))

    const placement = store.placementFor(
      draft({ title: 'Sapiens', authors: ['Yuval Noah Harari'], isFiction: false }),
    )
    // Fiction already has a book, but the non-fiction range is still empty,
    // so this must not be told to go next to Herbert.
    expect(placement.kind).toBe('first-in-range')
    expect(placement.range).toBe('nonfiction')
    expect(placement.suggestedLocation).toBe('S4')
  })

  it('names both neighbours once there is something either side', () => {
    store.addBook(draft({ title: 'Dune', authors: ['Frank Herbert'], location: '1A' }))
    store.addBook(draft({ title: 'Neuromancer', authors: ['William Gibson'], location: '1A' }))

    // Gibson < Haldeman < Herbert.
    const placement = store.placementFor(
      draft({ title: 'The Forever War', authors: ['Joe Haldeman'] }),
    )

    expect(placement.predecessor?.title).toBe('Neuromancer')
    expect(placement.successor?.title).toBe('Dune')
    expect(placement.kind).toBe('between-same-location')
    expect(placement.instruction).toContain('Neuromancer')
    expect(placement.instruction).toContain('Dune')
  })

  it('reports the boundary when the neighbours are on different shelves', () => {
    store.addBook(draft({ title: 'Neuromancer', authors: ['William Gibson'], location: '1C' }))
    store.addBook(draft({ title: 'Dune', authors: ['Frank Herbert'], location: '2A' }))

    const placement = store.placementFor(
      draft({ title: 'The Forever War', authors: ['Joe Haldeman'] }),
    )
    expect(placement.kind).toBe('between-different-locations')
    expect(placement.instruction).toContain('1C')
    expect(placement.instruction).toContain('2A')
  })

  it('keeps a series in reading order ahead of the standalones', () => {
    store.addBook(draft({
      title: 'Good Omens', authors: ['Terry Pratchett'], location: '3A',
    }))
    store.addBook(draft({
      title: 'The Colour of Magic', authors: ['Terry Pratchett'],
      seriesName: 'Discworld', seriesIndex: 1, location: '3A',
    }))

    // Discworld 2 belongs after Discworld 1 and before the standalone.
    const placement = store.placementFor(draft({
      title: 'The Light Fantastic', authors: ['Terry Pratchett'],
      seriesName: 'Discworld', seriesIndex: 2,
    }))
    expect(placement.predecessor?.title).toBe('The Colour of Magic')
    expect(placement.successor?.title).toBe('Good Omens')
  })

  it('files Le Guin under L, not under G', () => {
    const resolved = store.resolveKey(
      draft({ title: 'The Dispossessed', authors: ['Ursula K. Le Guin'] }),
    )
    expect(resolved.authorFiling).toBe('Le Guin, Ursula K.')
  })
})

describe('author filing overrides', () => {
  it('prefers a saved override over the heuristic', () => {
    // The documented failure case: the heuristic files this under M.
    expect(
      store.resolveKey(draft({ title: 'x', authors: ['Gabriel García Márquez'] }))
        .authorFiling,
    ).toBe('Márquez, Gabriel García')

    store.saveFilingOverride('Gabriel García Márquez', 'García Márquez, Gabriel')

    expect(
      store.resolveKey(draft({ title: 'x', authors: ['Gabriel García Márquez'] }))
        .authorFiling,
    ).toBe('García Márquez, Gabriel')
  })

  it('applies the override to placement, moving the book on the shelf', () => {
    store.addBook(draft({ title: 'A', authors: ['Ann Foster'], location: '1A' }))
    store.addBook(draft({ title: 'B', authors: ['Zoe Nash'], location: '1B' }))

    store.saveFilingOverride('Gabriel García Márquez', 'García Márquez, Gabriel')
    const placement = store.placementFor(
      draft({ title: 'Cien Años', authors: ['Gabriel García Márquez'] }),
    )
    // Garcia sorts between Foster and Nash. Under the raw heuristic (Marquez)
    // it would land after Nash instead.
    expect(placement.predecessor?.title).toBe('A')
    expect(placement.successor?.title).toBe('B')
  })
})

describe('bookkeeping', () => {
  it('stores authors positionally so the filing author is unambiguous', () => {
    const { id } = store.addBook(
      draft({ title: 'Good Omens', authors: ['Terry Pratchett', 'Neil Gaiman'] }),
    )
    const row = store.listRange('fiction').find((b) => b.id === id)
    expect(row?.author_filing).toBe('Pratchett, Terry')
    expect(row?.authors).toBe('Terry Pratchett, Neil Gaiman')
  })

  it('counts shelved and unshelved separately', () => {
    store.addBook(draft({ title: 'A', authors: ['X Y'], location: '1A' }))
    store.addBook(draft({ title: 'B', authors: ['X Z'] }))
    store.addBook(draft({ title: 'C', authors: ['Q R'], isFiction: false, location: 'S4' }))

    expect(store.counts()).toEqual({
      total: 3, fiction: 2, nonfiction: 1, unshelved: 1,
    })
  })

  it('flags a book recorded at a location that contradicts its order', () => {
    store.addBook(draft({ title: 'Alpha', authors: ['Ann Author'], location: '2A' }))
    store.addBook(draft({ title: 'Beta', authors: ['Zoe Zulu'], location: '1A' }))

    const misfiles = store.misfiles()
    expect(misfiles).toHaveLength(1)
    expect(misfiles[0]!.book.title).toBe('Beta')
  })

  it('does not treat an unshelved book as misfiled', () => {
    store.addBook(draft({ title: 'Alpha', authors: ['Ann Author'], location: '1A' }))
    store.addBook(draft({ title: 'Beta', authors: ['Bob Baker'] }))
    store.addBook(draft({ title: 'Gamma', authors: ['Cal Church'], location: '1B' }))

    expect(store.misfiles()).toHaveLength(0)
  })
})

describe('editing a shelved book', () => {
  it('updates in place rather than adding a second copy', () => {
    const { id } = store.addBook(
      draft({ title: 'Dark Angel', authors: ['V.C. Andrews'], location: '1A' }),
    )
    store.updateBook(id, draft({ title: 'Dune', authors: ['Frank Herbert'], location: '1A' }))

    expect(store.counts().total).toBe(1)
    expect(store.getBook(id)?.title).toBe('Dune')
  })

  it('moves the book when the author changes', () => {
    // The sort key has to be rebuilt, or the row keeps its old shelf position
    // and the ordering quietly breaks.
    const { id } = store.addBook(draft({ title: 'X', authors: ['Zoe Zulu'] }))
    const before = store.getBook(id)!.sort_key

    store.updateBook(id, draft({ title: 'X', authors: ['Ann Author'] }))
    const after = store.getBook(id)!

    expect(after.sort_key).not.toBe(before)
    expect(after.author_filing).toBe('Author, Ann')
  })

  it('moves the book between ranges when the fiction flag flips', () => {
    const { id } = store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))
    expect(store.getBook(id)?.shelf_range).toBe('fiction')

    store.updateBook(id, draft({ title: 'X', authors: ['Ann Author'], isFiction: false }))
    expect(store.getBook(id)?.shelf_range).toBe('nonfiction')
    expect(store.listRange('fiction')).toHaveLength(0)
    expect(store.listRange('nonfiction')).toHaveLength(1)
  })

  it('does not report the edited book as its own neighbour', () => {
    store.addBook(draft({ title: 'Alpha', authors: ['Ann Author'], location: '1A' }))
    const { id } = store.addBook(draft({ title: 'Beta', authors: ['Bob Baker'], location: '1A' }))

    const placement = store.updateBook(
      id, draft({ title: 'Beta', authors: ['Bob Baker'], location: '1A' }),
    )
    expect(placement.predecessor?.id).not.toBe(id)
    expect(placement.successor?.id).not.toBe(id)
    expect(placement.predecessor?.title).toBe('Alpha')
  })

  it('replaces the author list rather than appending to it', () => {
    const { id } = store.addBook(
      draft({ title: 'X', authors: ['Ann Author', 'Bob Baker'] }),
    )
    store.updateBook(id, draft({ title: 'X', authors: ['Cal Church'] }))
    expect(store.getBook(id)?.authors).toBe('Cal Church')
    expect(store.getBook(id)?.author_filing).toBe('Church, Cal')
  })

  it('fills in both ISBN forms on an edit, as on an insert', () => {
    const { id } = store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))
    store.updateBook(id, draft({
      title: 'Dune', authors: ['Frank Herbert'], isbn13: '9780441013593',
    }))
    expect(store.getBook(id)?.isbn10).toBe('0441013597')
  })
})

/**
 * Integration coverage for the path that actually matters: a book goes in,
 * the two index seeks find its neighbours, and the instruction names them.
 * Runs against a real in-memory SQLite database, not a mock.
 */

import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from './db'
import { Store, type DraftBook } from './store'

function draft(over: Partial<DraftBook> & { title: string; authors: string[] }): DraftBook {
  return { isFiction: true, ...over }
}

let store: Store
let db: Database

beforeEach(() => {
  db = openDatabase(':memory:')
  store = new Store(db)
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
    expect(placement.suggestedLocation).toBe('4A')
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

  it('counts by range, and does not pretend a book can be unshelved', () => {
    // Every catalogued book has a derived shelf, whether or not the vestigial
    // location column was ever filled in, so there is nothing to count as
    // unshelved. Two of these carry no location and still count normally.
    store.addBook(draft({ title: 'A', authors: ['X Y'], location: '1A' }))
    store.addBook(draft({ title: 'B', authors: ['X Z'] }))
    store.addBook(draft({ title: 'C', authors: ['Q R'], isFiction: false }))

    expect(store.counts()).toEqual({ total: 3, fiction: 2, nonfiction: 1, checkedOut: 0 })
  })

  it('keeps a recorded location through an edit that does not mention one', () => {
    // Where the book physically is was observed by a person. A metadata edit
    // knows nothing about it, so blanking the column would throw that away and
    // leave misfile detection with nothing to reconcile.
    const { id } = store.addBook(
      draft({ title: 'Alpha', authors: ['Ann Author'], location: '2C' }),
    )
    store.updateBook(id, draft({ title: 'Alpha', authors: ['Ann Author'] }))
    expect(store.getBook(id)?.location).toBe('2C')
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

describe('checking a book out and back in', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('records the moment a book comes off the shelf', () => {
    const { id } = store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))

    const result = store.setCheckedOut(id, true)

    expect(result.changed).toBe(true)
    expect(result.checkedOutAt).not.toBeNull()
    expect(store.getBook(id)?.checked_out_at).toBe(result.checkedOutAt)
  })

  it('does not overwrite the original time when an already-out book is checked out again', () => {
    const { id } = store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))
    const first = store.setCheckedOut(id, true)

    // A minute later, someone taps the same book a second time. Without the
    // guard this would replace `first.checkedOutAt` with the later time.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse(first.checkedOutAt!) + 60_000))
    const second = store.setCheckedOut(id, true)

    expect(second.changed).toBe(false)
    expect(second.checkedOutAt).toBe(first.checkedOutAt)
    expect(store.getBook(id)?.checked_out_at).toBe(first.checkedOutAt)
  })

  it('checks a book back in, clearing the timestamp', () => {
    const { id } = store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))
    store.setCheckedOut(id, true)

    const result = store.setCheckedOut(id, false)

    expect(result.changed).toBe(true)
    expect(result.checkedOutAt).toBeNull()
    expect(store.getBook(id)?.checked_out_at).toBeNull()
  })

  it('treats checking in a book that is already on the shelf as a no-op', () => {
    const { id } = store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))

    const result = store.setCheckedOut(id, false)

    expect(result.changed).toBe(false)
    expect(result.checkedOutAt).toBeNull()
    expect(store.getBook(id)?.checked_out_at).toBeNull()
  })

  it('reports no change for a book that does not exist, rather than throwing', () => {
    const result = store.setCheckedOut(999, true)
    expect(result).toEqual({ changed: false, checkedOutAt: null })
  })
})

describe('setCrop', () => {
  it('records the crop without disturbing the photograph', () => {
    const { id } = store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], frontImage: 'front.jpg' }),
    )

    store.setCrop(id, 'front', 'front_crop.jpg')

    const book = store.getBook(id)!
    expect(book.front_image).toBe('front.jpg')
    expect(book.front_crop).toBe('front_crop.jpg')
  })

  it('marks a slot examined even when no book was found in it', () => {
    const { id } = store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], frontImage: 'front.jpg' }),
    )

    store.setCrop(id, 'front', '')

    expect(store.getBook(id)!.front_crop).toBe('')
    // The distinction the detail view's caption rests on: looked at and found
    // nothing, rather than never looked at.
    expect(store.getBook(id)!.cropped).toBe('front')
  })

  it('adds each slot to the list rather than replacing it', () => {
    const { id } = store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))

    store.setCrop(id, 'front', 'a.jpg')
    store.setCrop(id, 'edge', 'b.jpg')
    store.setCrop(id, 'front', 'a.jpg')

    expect(store.getBook(id)!.cropped).toBe('front,edge')
  })
})

describe('photographed', () => {
  it('lists only the books that have a photo to crop', () => {
    store.addBook(draft({ title: 'No Photos', authors: ['Ann Author'] }))
    const { id } = store.addBook(
      draft({ title: 'Has One', authors: ['Ann Author'], edgeImage: 'edge.jpg' }),
    )

    const rows = store.photographed()
    expect(rows.map((row) => row.id)).toEqual([id])
    expect(rows[0]!.edge_image).toBe('edge.jpg')
  })
})

describe('imageInUse', () => {
  it('reports false for a name nothing on file references', () => {
    expect(store.imageInUse('ghost.jpg')).toBe(false)
  })

  it('counts a crop as in use, so tidying orphans cannot delete one', () => {
    const { id } = store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], frontImage: 'front.jpg' }),
    )
    store.setCrop(id, 'front', 'front_crop.jpg')

    expect(store.imageInUse('front_crop.jpg')).toBe(true)
  })

  it("checks all four of a book's image columns, not just the front photo", () => {
    const { id } = store.addBook(
      draft({
        title: 'X',
        authors: ['Ann Author'],
        frontImage: 'front.jpg',
        backImage: 'back.jpg',
        edgeImage: 'edge.jpg',
      }),
    )
    store.setCoverImage(id, 'cover.jpg')

    expect(store.imageInUse('front.jpg')).toBe(true)
    expect(store.imageInUse('back.jpg')).toBe(true)
    expect(store.imageInUse('edge.jpg')).toBe(true)
    expect(store.imageInUse('cover.jpg')).toBe(true)
  })

  it('reports true when only a capture names the file, across all three of its columns', () => {
    // Raw insert: nothing on Store creates a capture, and the fixture only
    // needs the row to exist, not the queue machinery around it.
    for (const column of ['front_image', 'back_image', 'edge_image']) {
      db.prepare(
        `INSERT INTO captures (status, ${column}, created_at) VALUES ('pending', 'shared.jpg', ?)`,
      ).run(new Date().toISOString())
      expect(store.imageInUse('shared.jpg')).toBe(true)
      db.prepare('DELETE FROM captures').run()
    }
  })

  it("does not report a book's image as orphaned merely because a finished capture also names it", () => {
    // This is the case deleteOrphanedImages exists to protect. A capture
    // hands its filenames to the book it becomes, so a capture and the book
    // it produced routinely name the same file. Deleting on the capture's
    // behalf must not take the book's copy of that file with it.
    const { id } = store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], backImage: 'shared.jpg' }),
    )
    db.prepare(
      `INSERT INTO captures (status, back_image, created_at, book_id)
       VALUES ('done', 'shared.jpg', ?, ?)`,
    ).run(new Date().toISOString(), id)

    expect(store.imageInUse('shared.jpg')).toBe(true)
  })
})

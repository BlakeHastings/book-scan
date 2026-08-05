/**
 * Integration coverage for the path that actually matters: a book goes in,
 * the two index seeks find its neighbours, and the instruction names them.
 * Runs against a real in-memory SQLite database, not a mock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from './db'
import type { Db } from './driver'
import { SEP } from '../shared/shelving'
import { Store, type DraftBook } from './store'

function draft(over: Partial<DraftBook> & { title: string; authors: string[] }): DraftBook {
  return { isFiction: true, ...over }
}

let store: Store
let db: Db

beforeEach(() => {
  db = openDatabase(':memory:')
  store = new Store(db)
})

describe('placement as books arrive one at a time', () => {
  it('calls the very first book the start of its range', async () => {
    const placement = await store.placementFor(
      draft({ title: 'Dune', authors: ['Frank Herbert'] }),
    )
    expect(placement.kind).toBe('first-in-range')
    expect(placement.suggestedLocation).toBe('1A')
  })

  it('sends non-fiction to shelf 4, independent of fiction', async () => {
    await store.addBook(draft({ title: 'Dune', authors: ['Frank Herbert'], location: '1A' }))

    const placement = await store.placementFor(
      draft({ title: 'Sapiens', authors: ['Yuval Noah Harari'], isFiction: false }),
    )
    // Fiction already has a book, but the non-fiction range is still empty,
    // so this must not be told to go next to Herbert.
    expect(placement.kind).toBe('first-in-range')
    expect(placement.range).toBe('nonfiction')
    expect(placement.suggestedLocation).toBe('4A')
  })

  it('names both neighbours once there is something either side', async () => {
    await store.addBook(draft({ title: 'Dune', authors: ['Frank Herbert'], location: '1A' }))
    await store.addBook(draft({ title: 'Neuromancer', authors: ['William Gibson'], location: '1A' }))

    // Gibson < Haldeman < Herbert.
    const placement = await store.placementFor(
      draft({ title: 'The Forever War', authors: ['Joe Haldeman'] }),
    )

    expect(placement.predecessor?.title).toBe('Neuromancer')
    expect(placement.successor?.title).toBe('Dune')
    expect(placement.kind).toBe('between-same-location')
    expect(placement.instruction).toContain('Neuromancer')
    expect(placement.instruction).toContain('Dune')
  })

  it('reports the boundary when the neighbours are on different shelves', async () => {
    await store.addBook(draft({ title: 'Neuromancer', authors: ['William Gibson'], location: '1C' }))
    await store.addBook(draft({ title: 'Dune', authors: ['Frank Herbert'], location: '2A' }))

    const placement = await store.placementFor(
      draft({ title: 'The Forever War', authors: ['Joe Haldeman'] }),
    )
    expect(placement.kind).toBe('between-different-locations')
    expect(placement.instruction).toContain('1C')
    expect(placement.instruction).toContain('2A')
  })

  it('keeps a series in reading order ahead of the standalones', async () => {
    await store.addBook(draft({
      title: 'Good Omens', authors: ['Terry Pratchett'], location: '3A',
    }))
    await store.addBook(draft({
      title: 'The Colour of Magic', authors: ['Terry Pratchett'],
      seriesName: 'Discworld', seriesIndex: 1, location: '3A',
    }))

    // Discworld 2 belongs after Discworld 1 and before the standalone.
    const placement = await store.placementFor(draft({
      title: 'The Light Fantastic', authors: ['Terry Pratchett'],
      seriesName: 'Discworld', seriesIndex: 2,
    }))
    expect(placement.predecessor?.title).toBe('The Colour of Magic')
    expect(placement.successor?.title).toBe('Good Omens')
  })

  it('files Le Guin under L, not under G', async () => {
    const resolved = await store.resolveKey(
      draft({ title: 'The Dispossessed', authors: ['Ursula K. Le Guin'] }),
    )
    expect(resolved.authorFiling).toBe('Le Guin, Ursula K.')
  })
})

describe('author filing overrides', () => {
  it('prefers a saved override over the heuristic', async () => {
    // The documented failure case: the heuristic files this under M.
    expect(
      (await store.resolveKey(draft({ title: 'x', authors: ['Gabriel García Márquez'] })))
        .authorFiling,
    ).toBe('Márquez, Gabriel García')

    await store.saveFilingOverride('Gabriel García Márquez', 'García Márquez, Gabriel')

    expect(
      (await store.resolveKey(draft({ title: 'x', authors: ['Gabriel García Márquez'] })))
        .authorFiling,
    ).toBe('García Márquez, Gabriel')
  })

  it('applies the override to placement, moving the book on the shelf', async () => {
    await store.addBook(draft({ title: 'A', authors: ['Ann Foster'], location: '1A' }))
    await store.addBook(draft({ title: 'B', authors: ['Zoe Nash'], location: '1B' }))

    await store.saveFilingOverride('Gabriel García Márquez', 'García Márquez, Gabriel')
    const placement = await store.placementFor(
      draft({ title: 'Cien Años', authors: ['Gabriel García Márquez'] }),
    )
    // Garcia sorts between Foster and Nash. Under the raw heuristic (Marquez)
    // it would land after Nash instead.
    expect(placement.predecessor?.title).toBe('A')
    expect(placement.successor?.title).toBe('B')
  })
})

describe('bookkeeping', () => {
  it('stores authors positionally so the filing author is unambiguous', async () => {
    const { id } = await store.addBook(
      draft({ title: 'Good Omens', authors: ['Terry Pratchett', 'Neil Gaiman'] }),
    )
    const row = (await store.listRange('fiction')).find((b) => b.id === id)
    expect(row?.author_filing).toBe('Pratchett, Terry')
    expect(row?.authors).toBe('Terry Pratchett, Neil Gaiman')
  })

  it('counts by range, and does not pretend a book can be unshelved', async () => {
    // Every catalogued book has a derived shelf, whether or not the vestigial
    // location column was ever filled in, so there is nothing to count as
    // unshelved. Two of these carry no location and still count normally.
    await store.addBook(draft({ title: 'A', authors: ['X Y'], location: '1A' }))
    await store.addBook(draft({ title: 'B', authors: ['X Z'] }))
    await store.addBook(draft({ title: 'C', authors: ['Q R'], isFiction: false }))

    expect(await store.counts()).toEqual({ total: 3, fiction: 2, nonfiction: 1, checkedOut: 0 })
  })

  it('counts as numbers, not as strings that look like numbers', async () => {
    // COUNT and SUM are wider than an int, and a driver entitled to refuse to
    // narrow them hands back strings instead. A total of "3" renders exactly
    // like 3 everywhere it is shown and behaves nothing like it in arithmetic,
    // so the CASTs that stop that are asserted rather than assumed.
    await store.addBook(draft({ title: 'A', authors: ['X Y'] }))
    const counts = await store.counts()

    expect(typeof counts.total).toBe('number')
    expect(typeof counts.fiction).toBe('number')
    expect(typeof counts.nonfiction).toBe('number')
    // Reached at all only because the alias is quoted: an unquoted camelCase
    // alias is folded to one case by some dialects and kept verbatim by others.
    expect(typeof counts.checkedOut).toBe('number')
  })

  it('keeps a recorded location through an edit that does not mention one', async () => {
    // Where the book physically is was observed by a person. A metadata edit
    // knows nothing about it, so blanking the column would throw that away and
    // leave misfile detection with nothing to reconcile.
    const { id } = await store.addBook(
      draft({ title: 'Alpha', authors: ['Ann Author'], location: '2C' }),
    )
    await store.updateBook(id, draft({ title: 'Alpha', authors: ['Ann Author'] }))
    expect((await store.getBook(id))?.location).toBe('2C')
  })
})

describe('editing a shelved book', () => {
  it('updates in place rather than adding a second copy', async () => {
    const { id } = await store.addBook(
      draft({ title: 'Dark Angel', authors: ['V.C. Andrews'], location: '1A' }),
    )
    await store.updateBook(id, draft({ title: 'Dune', authors: ['Frank Herbert'], location: '1A' }))

    expect((await store.counts()).total).toBe(1)
    expect((await store.getBook(id))?.title).toBe('Dune')
  })

  it('moves the book when the author changes', async () => {
    // The sort key has to be rebuilt, or the row keeps its old shelf position
    // and the ordering quietly breaks.
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Zoe Zulu'] }))
    const before = (await store.getBook(id))!.sort_key

    await store.updateBook(id, draft({ title: 'X', authors: ['Ann Author'] }))
    const after = (await store.getBook(id))!

    expect(after.sort_key).not.toBe(before)
    expect(after.author_filing).toBe('Author, Ann')
  })

  it('moves the book between ranges when the fiction flag flips', async () => {
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))
    expect((await store.getBook(id))?.shelf_range).toBe('fiction')

    await store.updateBook(id, draft({ title: 'X', authors: ['Ann Author'], isFiction: false }))
    expect((await store.getBook(id))?.shelf_range).toBe('nonfiction')
    expect(await store.listRange('fiction')).toHaveLength(0)
    expect(await store.listRange('nonfiction')).toHaveLength(1)
  })

  it('does not report the edited book as its own neighbour', async () => {
    await store.addBook(draft({ title: 'Alpha', authors: ['Ann Author'], location: '1A' }))
    const { id } = await store.addBook(draft({ title: 'Beta', authors: ['Bob Baker'], location: '1A' }))

    const placement = await store.updateBook(
      id, draft({ title: 'Beta', authors: ['Bob Baker'], location: '1A' }),
    )
    expect(placement.predecessor?.id).not.toBe(id)
    expect(placement.successor?.id).not.toBe(id)
    expect(placement.predecessor?.title).toBe('Alpha')
  })

  it('replaces the author list rather than appending to it', async () => {
    const { id } = await store.addBook(
      draft({ title: 'X', authors: ['Ann Author', 'Bob Baker'] }),
    )
    await store.updateBook(id, draft({ title: 'X', authors: ['Cal Church'] }))
    expect((await store.getBook(id))?.authors).toBe('Cal Church')
    expect((await store.getBook(id))?.author_filing).toBe('Church, Cal')
  })

  it('fills in both ISBN forms on an edit, as on an insert', async () => {
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))
    await store.updateBook(id, draft({
      title: 'Dune', authors: ['Frank Herbert'], isbn13: '9780441013593',
    }))
    expect((await store.getBook(id))?.isbn10).toBe('0441013597')
  })
})

describe('checking a book out and back in', () => {
  afterEach(async () => {
    vi.useRealTimers()
  })

  it('records the moment a book comes off the shelf', async () => {
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))

    const result = await store.setCheckedOut(id, true)

    expect(result.changed).toBe(true)
    expect(result.checkedOutAt).not.toBeNull()
    expect((await store.getBook(id))?.checked_out_at).toBe(result.checkedOutAt)
  })

  it('does not overwrite the original time when an already-out book is checked out again', async () => {
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))
    const first = await store.setCheckedOut(id, true)

    // A minute later, someone taps the same book a second time. Without the
    // guard this would replace `first.checkedOutAt` with the later time.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse(first.checkedOutAt!) + 60_000))
    const second = await store.setCheckedOut(id, true)

    expect(second.changed).toBe(false)
    expect(second.checkedOutAt).toBe(first.checkedOutAt)
    expect((await store.getBook(id))?.checked_out_at).toBe(first.checkedOutAt)
  })

  it('checks a book back in, clearing the timestamp', async () => {
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))
    await store.setCheckedOut(id, true)

    const result = await store.setCheckedOut(id, false)

    expect(result.changed).toBe(true)
    expect(result.checkedOutAt).toBeNull()
    expect((await store.getBook(id))?.checked_out_at).toBeNull()
  })

  it('treats checking in a book that is already on the shelf as a no-op', async () => {
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))

    const result = await store.setCheckedOut(id, false)

    expect(result.changed).toBe(false)
    expect(result.checkedOutAt).toBeNull()
    expect((await store.getBook(id))?.checked_out_at).toBeNull()
  })

  it('reports no change for a book that does not exist, rather than throwing', async () => {
    const result = await store.setCheckedOut(999, true)
    expect(result).toEqual({ changed: false, checkedOutAt: null })
  })
})

describe('setCrop', () => {
  it('records the crop without disturbing the photograph', async () => {
    const { id } = await store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], frontImage: 'front.jpg' }),
    )

    await store.setCrop(id, 'front', 'front_crop.jpg')

    const book = (await store.getBook(id))!
    expect(book.front_image).toBe('front.jpg')
    expect(book.front_crop).toBe('front_crop.jpg')
  })

  it('marks a slot examined even when no book was found in it', async () => {
    const { id } = await store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], frontImage: 'front.jpg' }),
    )

    await store.setCrop(id, 'front', '')

    expect((await store.getBook(id))!.front_crop).toBe('')
    // The distinction the detail view's caption rests on: looked at and found
    // nothing, rather than never looked at.
    expect((await store.getBook(id))!.cropped).toBe('front')
  })

  it('adds each slot to the list rather than replacing it', async () => {
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))

    await store.setCrop(id, 'front', 'a.jpg')
    await store.setCrop(id, 'edge', 'b.jpg')
    await store.setCrop(id, 'front', 'a.jpg')

    expect((await store.getBook(id))!.cropped).toBe('front,edge')
  })
})

describe('photographed', () => {
  it('lists only the books that have a photo to crop', async () => {
    await store.addBook(draft({ title: 'No Photos', authors: ['Ann Author'] }))
    const { id } = await store.addBook(
      draft({ title: 'Has One', authors: ['Ann Author'], edgeImage: 'edge.jpg' }),
    )

    const rows = await store.photographed()
    expect(rows.map((row) => row.id)).toEqual([id])
    expect(rows[0]!.edge_image).toBe('edge.jpg')
  })
})

describe('imageInUse', () => {
  it('reports false for a name nothing on file references', async () => {
    expect(await store.imageInUse('ghost.jpg')).toBe(false)
  })

  it('counts a crop as in use, so tidying orphans cannot delete one', async () => {
    const { id } = await store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], frontImage: 'front.jpg' }),
    )
    await store.setCrop(id, 'front', 'front_crop.jpg')

    expect(await store.imageInUse('front_crop.jpg')).toBe(true)
  })

  it("checks all four of a book's image columns, not just the front photo", async () => {
    const { id } = await store.addBook(
      draft({
        title: 'X',
        authors: ['Ann Author'],
        frontImage: 'front.jpg',
        backImage: 'back.jpg',
        edgeImage: 'edge.jpg',
      }),
    )
    await store.setCoverImage(id, 'cover.jpg')

    expect(await store.imageInUse('front.jpg')).toBe(true)
    expect(await store.imageInUse('back.jpg')).toBe(true)
    expect(await store.imageInUse('edge.jpg')).toBe(true)
    expect(await store.imageInUse('cover.jpg')).toBe(true)
  })

  it('reports true when only a capture names the file, across all three of its columns', async () => {
    // Raw insert: nothing on Store creates a capture, and the fixture only
    // needs the row to exist, not the queue machinery around it.
    for (const column of ['front_image', 'back_image', 'edge_image']) {
      await db.run(
        `INSERT INTO captures (status, ${column}, created_at) VALUES ('pending', 'shared.jpg', ?)`,
        [new Date().toISOString()],
      )
      expect(await store.imageInUse('shared.jpg')).toBe(true)
      await db.run('DELETE FROM captures')
    }
  })

  it("counts a capture's crop, so a discard cannot delete another capture's copy", async () => {
    // A crop is named after the photograph it came from, so two captures of
    // the same photograph produce the same crop filename. Deleting on one
    // capture's behalf must not take the other's picture with it.
    await db.run(
      `INSERT INTO captures (status, front_image, front_crop, cropped, created_at)
       VALUES ('ready', 'shared.jpg', 'shared_crop.jpg', 'front', ?)`,
      [new Date().toISOString()],
    )

    expect(await store.imageInUse('shared_crop.jpg')).toBe(true)
  })

  it("does not report a book's image as orphaned merely because a finished capture also names it", async () => {
    // This is the case deleteOrphanedImages exists to protect. A capture
    // hands its filenames to the book it becomes, so a capture and the book
    // it produced routinely name the same file. Deleting on the capture's
    // behalf must not take the book's copy of that file with it.
    const { id } = await store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], backImage: 'shared.jpg' }),
    )
    await db.run(
      `INSERT INTO captures (status, back_image, created_at, book_id)
       VALUES ('done', 'shared.jpg', ?, ?)`,
      [new Date().toISOString(), id],
    )

    expect(await store.imageInUse('shared.jpg')).toBe(true)
  })
})

/**
 * The order the whole product rests on, pinned to a fixture.
 *
 * `sort_key` ordering is not a detail of the store: `neighbours` compares it
 * with `<` and `>`, `Shelves.booksIn` orders by it, separators are anchored to
 * it, and the layout believes the sequence it is handed. Get the comparison
 * wrong and nothing throws. A shelf comes back in a slightly different order,
 * one book crosses a boundary, and the app tells somebody with total confidence
 * to put a book in the wrong place.
 *
 * SQLite compares text byte by byte and has no other option. A database whose
 * collation folds case, ignores punctuation or sorts accents next to their
 * plain forms would order some of these pairs the other way round, so this is
 * written now, while it can be seen to pass, and is the acceptance test for
 * anything that changes what does the comparing. Every case below is one the
 * fold in shared/shelving.ts exists to handle.
 *
 * It follows that this test must never be relaxed to make a database pass. If
 * it goes red the database is wrong, not the fixture.
 */
describe('text ordering, which every shelf depends on', () => {
  /** One book per ordering hazard, deliberately added out of order. */
  const FIXTURE: { title: string; authors: string[] }[] = [
    { title: 'Nana', authors: ['Émile Zola'] },              // accented letter
    { title: 'Alpha', authors: ['Ed Smithers'] },            // longer surname
    { title: 'Zenith', authors: ['Zoe Smith'] },             // shorter surname
    { title: 'Beta', authors: ["Ann O'Brien"] },             // punctuation
    { title: 'The Alpha', authors: ["Ann O'Brien"] },        // leading article
    { title: 'Chapter 10', authors: ['Ian McEwan'] },        // digits
    { title: 'Chapter 2', authors: ['Ian McEwan'] },         // digits
    { title: 'Flowers in the Attic', authors: ['V.C. Andrews'] }, // mixed case
  ]

  const EXPECTED = [
    'Flowers in the Attic', // Andrews
    'Chapter 2',            // McEwan, and 2 before 10 because runs are padded
    'Chapter 10',
    'The Alpha',            // O'Brien, filed under A: the article is dropped
    'Beta',
    'Zenith',               // Smith, before Smithers
    'Alpha',                // Smithers
    'Nana',                 // Zola, filed under Z with the accent folded away
  ]

  beforeEach(async () => {
    for (const book of FIXTURE) await store.addBook(draft(book))
  })

  it('returns the shelf in the one order the model says it is in', async () => {
    const shelf = await store.listRange('fiction')
    expect(shelf.map((row) => row.title)).toEqual(EXPECTED)
  })

  it('orders by bytes, so the database and JavaScript never disagree', async () => {
    // The invariant underneath every case above, and the one a different
    // collation breaks without breaking anything else: the sequence the
    // database returns is the sequence a plain string comparison gives. Pure
    // code either side of the store sorts and merges these same keys, so the
    // two orders being the same order is not an implementation detail.
    const keys = (await store.listRange('fiction')).map((row) => row.sort_key)
    const byBytes = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    expect(keys).toEqual(byBytes)
  })

  it('puts a shorter surname first, because a space sorts below every letter', async () => {
    // Smith before Smithers. A collation that ignores the separating space
    // compares SMITHZOE against SMITHERSED and returns these the other way
    // round, which is a real book on a real shelf in the wrong place.
    const shelf = await store.listRange('fiction')
    const titles = shelf.map((row) => row.title)

    expect(titles.indexOf('Zenith')).toBeLessThan(titles.indexOf('Alpha'))
  })

  it('finds the neighbours that order implies, through < and > rather than ORDER BY', async () => {
    // The other half of the risk. Placement does not sort; it seeks either side
    // of a key with two inequalities, and an index that compares differently
    // from the query would answer these two questions inconsistently.
    const shelf = await store.listRange('fiction')
    const zenith = shelf.find((row) => row.title === 'Zenith')!

    const { predecessor, successor } = await store.neighbours(
      'fiction', zenith.sort_key, zenith.id,
    )

    expect(predecessor?.title).toBe('Beta')
    expect(successor?.title).toBe('Alpha')
  })

  it('stores only the characters the fold leaves behind', async () => {
    // Why the cases above are safe to compare byte by byte at all: an accent,
    // an apostrophe and a full stop never reach the column. What does reach it
    // is A-Z, 0-9, the space, the unit separator between components and the
    // full stop in the padded series index, and this says so, because those
    // are exactly the characters a collation gets to have an opinion about.
    const shelf = await store.listRange('fiction')

    for (const row of shelf) {
      expect(row.sort_key.split(SEP).join('')).toMatch(/^[A-Z0-9 .]+$/)
    }
  })
})

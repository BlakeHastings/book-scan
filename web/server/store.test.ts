/**
 * Integration coverage for the path that actually matters: a book goes in,
 * the two index seeks find its neighbours, and the instruction names them.
 * Runs against a real database, not a mock, and since stage F against both of
 * them: in-memory SQLite, and a real Postgres in a container. Nothing below
 * knows which, deliberately. See server/testdb.ts.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { SEP } from '../shared/shelving'
import { photographTaken, recordCrop } from './photographs'
import { UnknownPlank } from './placement-ledger'
import { Store, type DraftBook } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { PrintedName } from '../domain/authorship/authors'
import { genreStatedBy } from '../domain/tagging/genre'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'
import type { SeparatorKind } from '../shared/layout'

function draft(over: Partial<DraftBook> & { title: string; authors: string[] }): DraftBook {
  return { genre: FICTION_SLUG, ...over }
}

let store: Store
let db: Db

/**
 * Cut the fiction run into more planks, so a fixture has somewhere to put a book.
 *
 * A test database stands as migration `0013` leaves it: one area per run, so
 * `1A` and `4A` are the only planks the furniture has. Since #232 a book cannot
 * be recorded at a plank that does not exist, so a fixture naming `1B` or `2A`
 * has to build one first, which is what `POST /api/shelves/overflow` does at a
 * shelf. Each `area` adds a plank to the current bookcase and each `shelf`
 * starts the next one.
 *
 * The anchors sort above every Latin sort key this file writes, so what these
 * add is furniture rather than a rearrangement of the books already on it.
 */
async function splitFiction(...kinds: SeparatorKind[]): Promise<void> {
  const separators = new DrizzleSeparatorRepository(db)
  for (const [at, kind] of kinds.entries()) {
    await separators.add({
      range: 'fiction',
      kind,
      startsAt: `~${at}`,
      position: at,
      note: '',
      createdAt: new Date().toISOString(),
    })
  }
}

/**
 * Where a draft would go, and saving an edit, both filed under the genre the
 * draft itself states.
 *
 * Since #223 the shelf range arrives beside the draft, because it is settled
 * against `book_tag` before the row is written and this class does not write
 * tags. There is no tagging layer in this file, and for a book carrying no
 * other genre the draft's own claim is the answer `settleGenre` would reach,
 * which is the same reasoning `Store.addBook` uses for a book that does not
 * exist yet.
 */
const placementFor = (of: DraftBook, excludeId?: number) =>
  store.placementFor(of, genreStatedBy(of).range, excludeId)

const updateBook = (id: number, of: DraftBook) =>
  store.updateBook(id, of, genreStatedBy(of).range)

beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
})

afterAll(closeTestDatabase)

describe('placement as books arrive one at a time', () => {
  it('calls the very first book the start of its range', async () => {
    const placement = await placementFor(
      draft({ title: 'Dune', authors: ['Frank Herbert'] }),
    )
    expect(placement.kind).toBe('first-in-range')
    expect(placement.suggestedLocation).toBe('1A')
  })

  it('sends non-fiction to shelf 4, independent of fiction', async () => {
    await store.addBook(draft({ title: 'Dune', authors: ['Frank Herbert'], location: '1A' }))

    const placement = await placementFor(
      draft({ title: 'Sapiens', authors: ['Yuval Noah Harari'], genre: NON_FICTION_SLUG }),
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
    const placement = await placementFor(
      draft({ title: 'The Forever War', authors: ['Joe Haldeman'] }),
    )

    expect(placement.predecessor?.title).toBe('Neuromancer')
    expect(placement.successor?.title).toBe('Dune')
    expect(placement.kind).toBe('between-same-location')
    expect(placement.instruction).toContain('Neuromancer')
    expect(placement.instruction).toContain('Dune')
  })

  it('reports the boundary when the neighbours are on different shelves', async () => {
    await splitFiction('area', 'area', 'shelf')
    await store.addBook(draft({ title: 'Neuromancer', authors: ['William Gibson'], location: '1C' }))
    await store.addBook(draft({ title: 'Dune', authors: ['Frank Herbert'], location: '2A' }))

    const placement = await placementFor(
      draft({ title: 'The Forever War', authors: ['Joe Haldeman'] }),
    )
    expect(placement.kind).toBe('between-different-locations')
    expect(placement.instruction).toContain('1C')
    expect(placement.instruction).toContain('2A')
  })

  it('keeps a series in reading order ahead of the standalones', async () => {
    await splitFiction('shelf', 'shelf')
    await store.addBook(draft({
      title: 'Good Omens', authors: ['Terry Pratchett'], location: '3A',
    }))
    await store.addBook(draft({
      title: 'The Colour of Magic', authors: ['Terry Pratchett'],
      seriesName: 'Discworld', seriesIndex: 1, location: '3A',
    }))

    // Discworld 2 belongs after Discworld 1 and before the standalone.
    const placement = await placementFor(draft({
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

describe('a name somebody has filed by hand', () => {
  /*
   * The override table's job, on the alias it moved to (#227).
   *
   * `Store.saveFilingOverride` used to write `author_filing`, keyed on a
   * normalised spelling, and `Store.filingFor` consulted it on the way past.
   * The same fact is a column on the name now, so filing one is the two
   * statements the save routes make: introduce the name, then file it. What
   * this file checks is the half that decides where a book goes, which is that
   * `Store` reads the alias rather than the heuristic when there is one.
   */
  const fileAs = async (printed: string, filing: string): Promise<void> => {
    const authors = new DrizzleAuthorRepository(db)
    const alias = await authors.introduce(PrintedName.of(printed), filing)
    await authors.file(alias.id, filing)
  }

  it('prefers what the alias files under over the heuristic', async () => {
    // The documented failure case: the heuristic files this under M.
    expect(
      (await store.resolveKey(draft({ title: 'x', authors: ['Gabriel García Márquez'] })))
        .authorFiling,
    ).toBe('Márquez, Gabriel García')

    await fileAs('Gabriel García Márquez', 'García Márquez, Gabriel')

    expect(
      (await store.resolveKey(draft({ title: 'x', authors: ['Gabriel García Márquez'] })))
        .authorFiling,
    ).toBe('García Márquez, Gabriel')
  })

  it('reads the alias however the name is spelled on the book', async () => {
    // A lookup folds case, punctuation and whitespace, so a book printed
    // `J.R.R. Tolkien` files under the name somebody filed as `J. R. R.
    // Tolkien` rather than starting a second one beside it.
    await fileAs('J. R. R. Tolkien', 'Tolkien, John Ronald Reuel')

    expect(
      (await store.resolveKey(draft({ title: 'The Hobbit', authors: ['J.R.R. Tolkien'] })))
        .authorFiling,
    ).toBe('Tolkien, John Ronald Reuel')
  })

  it('applies it to placement, moving the book on the shelf', async () => {
    await splitFiction('area')
    await store.addBook(draft({ title: 'A', authors: ['Ann Foster'], location: '1A' }))
    await store.addBook(draft({ title: 'B', authors: ['Zoe Nash'], location: '1B' }))

    await fileAs('Gabriel García Márquez', 'García Márquez, Gabriel')
    const placement = await placementFor(
      draft({ title: 'Cien Años', authors: ['Gabriel García Márquez'] }),
    )
    // Garcia sorts between Foster and Nash. Under the raw heuristic (Marquez)
    // it would land after Nash instead.
    expect(placement.predecessor?.title).toBe('A')
    expect(placement.successor?.title).toBe('B')
  })

  it('can be filed for a name written in another script', async () => {
    // Issue #195 from the other side. The override table keyed on a fold that
    // deleted such a name entirely, so there was no key to store one under: the
    // row went nowhere and the correction could not be made at all.
    // `author_alias` is keyed on the printed name, so there is nowhere for that
    // to happen.
    await fileAs('村上春樹', 'Murakami, Haruki')

    expect(
      (await store.resolveKey(draft({ title: 'Norwegian Wood', authors: ['村上春樹'] })))
        .authorFiling,
    ).toBe('Murakami, Haruki')
  })
})

describe('a name written in a script with no A-Z in it', () => {
  // Issue #195. `Store.filingFor` guarded its override lookup with the fold and
  // returned '' when the key came back empty, which is what every such name
  // folded to, so the book was stored filing under nobody.
  it('files under the author the reader can see, not under nobody', async () => {
    const resolved = await store.resolveKey(
      draft({ title: 'Crime and Punishment', authors: ['Фёдор Достоевский'] }),
    )

    expect(resolved.authorFiling).toBe('Достоевский, Фёдор')
    expect(resolved.sortKey.startsWith(SEP)).toBe(false)
  })

  it('lands among the shelved books instead of ahead of all of them', async () => {
    await splitFiction('shelf', 'area', 'area')
    await store.addBook(draft({ title: 'Persuasion', authors: ['Jane Austen'], location: '1A' }))
    await store.addBook(draft({ title: 'The Book Thief', authors: ['Markus Zusak'], location: '2C' }))

    const placement = await placementFor(
      draft({ title: 'Crime and Punishment', authors: ['Фёдор Достоевский'] }),
    )

    // Every letter outside A-Z sorts after Z, so the Cyrillic block is at the
    // end of the range. Before the fix this was 'first-in-range', ahead of
    // Austen, which is the one answer that is certainly wrong.
    expect(placement.kind).not.toBe('first-in-range')
    expect(placement.predecessor?.title).toBe('The Book Thief')
    expect(placement.successor).toBeNull()
  })

  it('keeps a Greek and a CJK name apart instead of stacking them on one key', async () => {
    const greek = await store.resolveKey(
      draft({ title: 'Zorba the Greek', authors: ['Νίκος Καζαντζάκης'] }),
    )
    const cjk = await store.resolveKey(
      draft({ title: 'Norwegian Wood', authors: ['村上春樹'] }),
    )

    expect(greek.authorFiling).toBe('Καζαντζάκης, Νίκος')
    expect(cjk.authorFiling).toBe('村上春樹')
    // Two books by two people used to share one sort key prefix, the empty
    // one, so which came first was decided by the id tiebreak.
    expect(greek.sortKey).not.toBe(cjk.sortKey)
    expect(greek.sortKey < cjk.sortKey).toBe(true)
  })

  it('keeps the Latin half of a mixed name filing where it did', async () => {
    // The surprising one. `Smith, Иван` folded to `SMITH`, so this book filed
    // on top of an author called plainly Smith. It now files inside the Smith
    // block rather than merged into it, which the space rule puts before
    // Smithson.
    await splitFiction('area')
    await store.addBook(draft({ title: 'A', authors: ['Ann Smith'], location: '1A' }))
    await store.addBook(draft({ title: 'B', authors: ['Ada Smithson'], location: '1B' }))

    const placement = await placementFor(
      draft({ title: 'C', authors: ['Иван Smith'] }),
    )
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
    // The first-listed name is the one the key is built from, and the joined
    // string keeps both in the order they are printed. The view's
    // `author_filing` is empty here because nothing in this file credits a book:
    // that is `CreditBookHandler`, from the save routes, and
    // `authors.routes.test.ts` is where the two are asserted together.
    expect(row?.sort_key.split(SEP)[0]).toBe('PRATCHETT TERRY')
    expect(row?.authors).toBe('Terry Pratchett, Neil Gaiman')
  })

  it('counts by range, and does not pretend a book can be unshelved', async () => {
    // Every catalogued book has a derived shelf, whether or not anybody has ever
    // said where it physically is, so there is nothing to count as unshelved.
    // Two of these were never placed and still count normally.
    await store.addBook(draft({ title: 'A', authors: ['X Y'], location: '1A' }))
    await store.addBook(draft({ title: 'B', authors: ['X Z'] }))
    await store.addBook(draft({ title: 'C', authors: ['Q R'], genre: NON_FICTION_SLUG }))

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
    // knows nothing about it, so recording it nowhere would throw that away and
    // leave misfile detection with nothing to reconcile.
    await splitFiction('shelf', 'area', 'area')
    const { id } = await store.addBook(
      draft({ title: 'Alpha', authors: ['Ann Author'], location: '2C' }),
    )
    await updateBook(id, draft({ title: 'Alpha', authors: ['Ann Author'] }))
    expect((await store.getBook(id))?.location).toBe('2C')
  })
})

/**
 * What `Store.setLocation` can and cannot be told, now that the ledger is the
 * only record of where a book is (#232).
 *
 * The column would hold any string somebody typed, so `9Z` was storable and the
 * app then disagreed with itself about the same book: the location said one
 * plank and the ledger had no row for it at all. There is nothing behind the
 * ledger to hold such a label, so the write refuses rather than half-happening.
 */
describe('recording where a book physically is', () => {
  it('records the plank a person names', async () => {
    await splitFiction('area')
    const { id } = await store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], location: '1A' }),
    )

    await store.setLocation(id, '1B')

    expect((await store.getBook(id))?.location).toBe('1B')
  })

  it('refuses a label naming a plank the collection does not have', async () => {
    const { id } = await store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], location: '1A' }),
    )

    // The furniture stops at `1A` until a boundary is added, so `9Z` names a
    // plank nobody owns and there is nowhere to record the book.
    await expect(store.setLocation(id, '9Z')).rejects.toThrow(UnknownPlank)
    await expect(store.setLocation(id, '9Z')).rejects.toThrow('9Z')

    // Thrown from inside the transaction, so nothing moved: the book is still
    // where the last person to carry it said it was.
    expect((await store.getBook(id))?.location).toBe('1A')
  })
})

describe('editing a shelved book', () => {
  it('updates in place rather than adding a second copy', async () => {
    const { id } = await store.addBook(
      draft({ title: 'Dark Angel', authors: ['V.C. Andrews'], location: '1A' }),
    )
    await updateBook(id, draft({ title: 'Dune', authors: ['Frank Herbert'], location: '1A' }))

    expect((await store.counts()).total).toBe(1)
    expect((await store.getBook(id))?.title).toBe('Dune')
  })

  it('moves the book when the author changes', async () => {
    // The sort key has to be rebuilt, or the row keeps its old shelf position
    // and the ordering quietly breaks.
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Zoe Zulu'] }))
    const before = (await store.getBook(id))!.sort_key

    await updateBook(id, draft({ title: 'X', authors: ['Ann Author'] }))
    const after = (await store.getBook(id))!

    expect(after.sort_key).not.toBe(before)
    // The key's first component is what the book files under, and there is no
    // column beside it holding a copy any more (#227).
    expect(after.sort_key.split(SEP)[0]).toBe('AUTHOR ANN')
  })

  it('moves the book between ranges when the fiction flag flips', async () => {
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))
    expect((await store.getBook(id))?.shelf_range).toBe('fiction')

    await updateBook(id, draft({ title: 'X', authors: ['Ann Author'], genre: NON_FICTION_SLUG }))
    expect((await store.getBook(id))?.shelf_range).toBe('nonfiction')
    expect(await store.listRange('fiction')).toHaveLength(0)
    expect(await store.listRange('nonfiction')).toHaveLength(1)
  })

  it('does not report the edited book as its own neighbour', async () => {
    await store.addBook(draft({ title: 'Alpha', authors: ['Ann Author'], location: '1A' }))
    const { id } = await store.addBook(draft({ title: 'Beta', authors: ['Bob Baker'], location: '1A' }))

    const placement = await updateBook(
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
    await updateBook(id, draft({ title: 'X', authors: ['Cal Church'] }))
    expect((await store.getBook(id))?.authors).toBe('Cal Church')
    expect((await store.getBook(id))?.sort_key.split(SEP)[0]).toBe('CHURCH CAL')
  })

  it('fills in both ISBN forms on an edit, as on an insert', async () => {
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))
    await updateBook(id, draft({
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

  it('puts the book back on the plank it came off', async () => {
    // A round trip used to cost nothing, because a checkout never touched
    // `books.location` and the book simply reappeared where the column said.
    // The ledger is append only, so coming back has to be written down (#232),
    // and what is written is where the book actually was rather than where the
    // rules would send it.
    const { id } = await store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], location: '1A' }),
    )

    await store.setCheckedOut(id, true)
    // A book in somebody's bag holds no position on a shelf.
    expect((await store.getBook(id))?.location).toBe('')

    await store.setCheckedOut(id, false)
    expect((await store.getBook(id))?.location).toBe('1A')
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
    const { id } = await store.addBook(draft({
      title: 'X', authors: ['Ann Author'],
      frontImage: 'front.jpg', edgeImage: 'edge.jpg',
    }))

    await store.setCrop(id, 'front', 'a.jpg')
    await store.setCrop(id, 'edge', 'b.jpg')
    await store.setCrop(id, 'front', 'a.jpg')

    expect((await store.getBook(id))!.cropped).toBe('front,edge')
  })

  it('says nothing about a slot that has no photograph in it', async () => {
    /*
     * `examined` is a fact about a photograph, and a slot with nothing in it is
     * not a photograph. It used to be a name in a string on the book, so a crop
     * pass could record that a detector had looked at a photograph that did not
     * exist. There is nowhere to write that now, which is the point (#228).
     */
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))

    await store.setCrop(id, 'front', '')

    expect((await store.getBook(id))!.cropped).toBe('')
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

  it('reports true when only a queued book names the file, whichever slot it is in', async () => {
    // Raw insert of the row, and the photograph written the way a shutter
    // writes one: nothing on Store creates a queued book, and the fixture only
    // needs the row to exist, not the queue machinery around it.
    for (const slot of ['front', 'back', 'edge'] as const) {
      const created = await db.get<{ id: number }>(
        `INSERT INTO books (title, shelf_range, sort_key, state, scanned_at)
         VALUES ('', '', '', 'scanned', ?) RETURNING id`,
        [new Date().toISOString()],
      )
      await photographTaken(db, created!.id, slot, 'shared.jpg', new Date().toISOString())
      expect(await store.imageInUse('shared.jpg')).toBe(true)
      await db.run("DELETE FROM books WHERE state = 'scanned'")
    }
  })

  it("counts a queued book's crop, so a discard cannot delete another one's copy", async () => {
    // A crop is named after the photograph it came from, so two scans of the
    // same photograph produce the same crop filename. Deleting on one scan's
    // behalf must not take the other's picture with it.
    const created = await db.get<{ id: number }>(
      `INSERT INTO books (title, shelf_range, sort_key, state, scanned_at)
       VALUES ('', '', '', 'identified', ?) RETURNING id`,
      [new Date().toISOString()],
    )
    await photographTaken(db, created!.id, 'front', 'shared.jpg', new Date().toISOString())
    await recordCrop(db, created!.id, 'front', 'shared_crop.jpg')

    expect(await store.imageInUse('shared_crop.jpg')).toBe(true)
  })

  /**
   * The one judgement in `imageInUse`, and the reason discarding still frees
   * the photographs it was taken with.
   *
   * A discarded scan keeps its filenames, because they are the record of what
   * was thrown away. Counting them as a claim on the file would mean the sweep
   * behind a discard found nothing to delete, and deleting the photographs is
   * most of what discarding a mistaken scan is for.
   */
  it('does not count a discarded scan, whose filenames are history rather than a claim', async () => {
    const created = await db.get<{ id: number }>(
      `INSERT INTO books (title, shelf_range, sort_key, state, scanned_at)
       VALUES ('', '', '', 'discarded', ?) RETURNING id`,
      [new Date().toISOString()],
    )
    await photographTaken(db, created!.id, 'front', 'gone.jpg', new Date().toISOString())
    await recordCrop(db, created!.id, 'front', 'gone_crop.jpg')

    expect(await store.imageInUse('gone.jpg')).toBe(false)
    expect(await store.imageInUse('gone_crop.jpg')).toBe(false)
  })

  it("still protects a shelved book's photograph from a discard beside it", async () => {
    // The case `deleteOrphanedImages` exists for. Two scans of one book name
    // one file, and deleting on the discarded one's behalf must not take the
    // shelved one's picture with it.
    await store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], backImage: 'shared.jpg' }),
    )
    const created = await db.get<{ id: number }>(
      `INSERT INTO books (title, shelf_range, sort_key, state, scanned_at)
       VALUES ('', '', '', 'discarded', ?) RETURNING id`,
      [new Date().toISOString()],
    )
    await photographTaken(db, created!.id, 'back', 'shared.jpg', new Date().toISOString())

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

/**
 * Two requests in flight at once, which is what the whole migration is for.
 *
 * This is the rehearsal docs/postgres-migration.md asks for at stage G, and
 * these are the only tests in this file that would pass for the wrong reason if
 * they were written carelessly. Each one was watched failing with its fix
 * removed before it was kept: two placements both saying "first in the range",
 * a checkout timestamp overwritten by the second tap, and a crop list with one
 * of its two slots missing.
 *
 * Nothing here is conditional on the driver. On SQLite the guarantee comes from
 * a transaction holding the one connection; on Postgres it comes from the
 * advisory lock behind `TxOptions.serialiseOn`. The assertion is the same
 * either way, which is the point: what the caller is promised does not depend
 * on which database is underneath.
 */
describe('two people scanning at once', () => {
  /**
   * Make the pool hold more than one connection before the race starts.
   *
   * Without this the second caller waits for the first to give its connection
   * back, so the two never overlap and the test cannot fail however broken the
   * code is. All three of these passed with their fix removed until this was
   * added, which is the whole reason it is a named function with a paragraph on
   * it rather than a line somebody tidies away. Costs nothing on SQLite, which
   * has one connection and serialises for real reasons.
   */
  const warmTheConnections = () =>
    Promise.all([db.get('SELECT 1'), db.get('SELECT 1'), db.get('SELECT 1')])

  it('tells the second book about the first, rather than sending both to the same gap', async () => {
    await warmTheConnections()

    // Gibson sorts before Herbert, so whichever of these commits first, the
    // other has a neighbour and cannot be the first book in the range.
    const [gibson, herbert] = await Promise.all([
      store.addBook(draft({ title: 'Neuromancer', authors: ['William Gibson'] })),
      store.addBook(draft({ title: 'Dune', authors: ['Frank Herbert'] })),
    ])

    const kinds = [gibson.placement.kind, herbert.placement.kind]
    expect(
      kinds.filter((kind) => kind === 'first-in-range'),
      `both saves were told the shelf was empty: ${kinds.join(' and ')}`,
    ).toHaveLength(1)

    // And the one that was not first names the other, so the person holding it
    // is sent to a book that is genuinely on the shelf.
    const second = gibson.placement.kind === 'first-in-range' ? herbert : gibson
    const named = [second.placement.predecessor?.title, second.placement.successor?.title]
    expect(named).toContain(second === herbert ? 'Neuromancer' : 'Dune')

    // Whoever won, the shelf itself is in order. That held before the fix too:
    // the sort keys decide it, not the placement.
    expect((await store.listRange('fiction')).map((row) => row.title))
      .toEqual(['Neuromancer', 'Dune'])
  })

  it('keeps the moment a book left when two checkouts arrive together', async () => {
    const { id } = await store.addBook(draft({ title: 'X', authors: ['Ann Author'] }))
    await warmTheConnections()

    const [first, second] = await Promise.all([
      store.setCheckedOut(id, true),
      store.setCheckedOut(id, true),
    ])

    // Exactly one of them took the book off the shelf. The other is told
    // nothing changed, and is handed the timestamp that stands.
    const changed = [first, second].filter((result) => result.changed)
    expect(changed, 'both callers were told they checked the book out').toHaveLength(1)

    const stored = (await store.getBook(id))?.checked_out_at
    expect(stored).toBe(changed[0]!.checkedOutAt)
    expect(first.checkedOutAt).toBe(stored)
    expect(second.checkedOutAt).toBe(stored)
  })

  it('keeps both slots when two crop passes finish at the same time', async () => {
    const { id } = await store.addBook(
      draft({ title: 'X', authors: ['Ann Author'], frontImage: 'f.jpg', edgeImage: 'e.jpg' }),
    )
    await warmTheConnections()

    await Promise.all([
      store.setCrop(id, 'front', 'f_crop.jpg'),
      store.setCrop(id, 'edge', ''),
    ])

    const book = (await store.getBook(id))!
    expect(book.cropped.split(',').sort()).toEqual(['edge', 'front'])
    expect(book.front_crop).toBe('f_crop.jpg')
    // The slot that was looked at and declined still says so, which is the
    // state the lost update used to erase.
    expect(book.edge_crop).toBe('')
  })
})

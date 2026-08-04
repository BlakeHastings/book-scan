/**
 * Separators against a real database, including the case the feature exists
 * for: a shelf that is physically full and a book that belongs in the middle
 * of it.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './db'
import { Shelves } from './shelves'
import { Store } from './store'

let store: Store
let shelves: Shelves

beforeEach(() => {
  const db = openDatabase(':memory:')
  store = new Store(db)
  shelves = new Shelves(db)
})

/** Authors chosen so alphabetical order matches the argument order. */
const add = (author: string, title = 'Book') =>
  store.addBook({ title, authors: [author], isFiction: true }).id

const labels = () => shelves.layout('fiction').map((p) => p.label)

describe('before anything is marked full', () => {
  it('puts every book on the first shelf', () => {
    add('Ann Author')
    add('Bob Baker')
    expect(labels()).toEqual(['1A', '1A'])
  })
})

describe('saying a shelf is full', () => {
  it('moves its last book to a new shelf and reports the step', () => {
    add('Ann Author')
    const bob = add('Bob Baker')
    expect(labels()).toEqual(['1A', '1A'])

    const result = shelves.overflow('fiction', '1A', 'area')
    expect(result.ok).toBe(true)
    expect(result.step?.moved.id).toBe(bob)
    expect(result.step?.from).toBe('1A')
    expect(result.step?.to).toBe('1B')
    expect(labels()).toEqual(['1A', '1B'])
    expect(result.moves).toEqual([{ id: bob, from: '1A', to: '1B' }])
  })

  it('can start a whole new bookcase instead', () => {
    add('Ann Author')
    add('Bob Baker')
    shelves.overflow('fiction', '1A', 'shelf')
    expect(labels()).toEqual(['1A', '2A'])
  })

  it('refuses a shelf with only one book on it', () => {
    add('Ann Author')
    const result = shelves.overflow('fiction', '1A', 'area')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('holds only one book')
  })

  it('walks the cascade one answer at a time', () => {
    add('Ann Author')
    const bob = add('Bob Baker')
    const cal = add('Cal Church')
    shelves.overflow('fiction', '1A', 'area')      // Cal to A2
    expect(labels()).toEqual(['1A', '1A', '1B'])

    // A1 still will not do; say so again.
    const second = shelves.overflow('fiction', '1A', 'area')
    expect(second.step?.moved.id).toBe(bob)
    expect(labels()).toEqual(['1A', '1B', '1B'])
    expect(cal).toBeGreaterThan(0)
  })
})

describe('placing a book on a shelf that is full', () => {
  /** Add a book and record where it landed, as saving does. */
  const shelve = (author: string, title = 'Book') => {
    const id = add(author, title)
    store.setLocation(id, shelves.labelFor('fiction', id))
    return id
  }

  /** The sort key of a book that is not saved yet. */
  const keyFor = (author: string, title = 'Book') =>
    store.placementFor({ title, authors: [author], isFiction: true } as never).sortKey

  it('sends the book in hand on when nothing on the shelf follows it', () => {
    // The bug in #77. Ann and Bob fill 1A, Cal is on 1B, and the book being
    // placed is Baxter, who sorts after Bob and before Cal. Saying 1A is full
    // used to take Bob off the shelf and carry him to 1B for no reason.
    const ann = shelve('Ann Author')
    const bob = shelve('Bob Baker')
    const cal = shelve('Cal Church')
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(cal, '1B')
    expect(labels()).toEqual(['1A', '1A', '1B'])

    const result = shelves.overflow('fiction', '1A', 'area', keyFor('Bob Baxter'))
    expect(result.ok).toBe(true)
    expect(result.carry).toMatchObject({ from: '1A', to: '1B' })
    // Nobody was displaced, and no book already on a shelf changed shelf.
    expect(result.step).toBeUndefined()
    expect(result.moves).toEqual([])
    expect(labels()).toEqual(['1A', '1A', '1B'])
    expect(store.getBook(ann)?.location).toBe('1A')
    expect(store.getBook(bob)?.location).toBe('1A')
  })

  it('lands the book where it was told once it is saved', () => {
    shelve('Ann Author')
    shelve('Bob Baker')
    const cal = shelve('Cal Church')
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(cal, '1B')

    const carried = shelves.overflow('fiction', '1A', 'area', keyFor('Bob Baxter'))
    const baxter = add('Bob Baxter')
    expect(shelves.labelFor('fiction', baxter)).toBe(carried.carry?.to)
    expect(labels()).toEqual(['1A', '1A', '1B', '1B'])
  })

  it('still displaces a book when the gap is in the middle', () => {
    // The cascade is not weakened. Something genuinely has to move to open a
    // gap here, and it is the last book on the shelf that moves.
    shelve('Ann Author')
    const bob = shelve('Bob Baker')
    const cal = shelve('Cal Church')
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(cal, '1B')

    // Bailey sorts between Author and Baker, so Baker is still to his right.
    const result = shelves.overflow('fiction', '1A', 'area', keyFor('Ann Bailey'))
    expect(result.carry).toBeUndefined()
    expect(result.step?.moved.id).toBe(bob)
    expect(result.step?.from).toBe('1A')
    expect(result.step?.to).toBe('1B')
  })

  it('makes a shelf at the end of the run rather than displacing anything', () => {
    // The last area of the last bookcase. Nothing follows the book anywhere,
    // so there is nothing to displace and the plank it goes on gets made.
    shelve('Ann Author')
    shelve('Bob Baker')

    const result = shelves.overflow('fiction', '1A', 'area', keyFor('Cal Church'))
    expect(result.ok).toBe(true)
    expect(result.carry).toMatchObject({ from: '1A', to: '1B' })
    expect(result.moves).toEqual([])
    expect(labels()).toEqual(['1A', '1A'])

    const cal = add('Cal Church')
    expect(shelves.labelFor('fiction', cal)).toBe('1B')
  })

  it('starts a new bookcase for the book in hand when asked', () => {
    shelve('Ann Author')
    shelve('Bob Baker')

    const result = shelves.overflow('fiction', '1A', 'shelf', keyFor('Cal Church'))
    expect(result.carry?.to).toBe('2A')
    const cal = add('Cal Church')
    expect(shelves.labelFor('fiction', cal)).toBe('2A')
    expect(labels()).toEqual(['1A', '1A', '2A'])
  })

  it('answers for a shelf with one book on it, which the cascade cannot', () => {
    // A shelf holding one book has nothing to give up, so the cascade refuses.
    // That refusal was the only answer available, and it is the wrong one when
    // the book in hand goes at the end: it moves, not the one on the shelf.
    shelve('Ann Author')
    const bob = shelve('Bob Baker')
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(bob, '1B')
    expect(labels()).toEqual(['1A', '1B'])

    expect(shelves.overflow('fiction', '1A', 'area').ok).toBe(false)
    // Bailey goes after Author and before Baker, so 1A is where he belongs and
    // there is nothing on it to his right.
    expect(shelves.overflow('fiction', '1A', 'area', keyFor('Ann Bailey')).carry)
      .toMatchObject({ from: '1A', to: '1B' })
  })

  it('ignores the book in hand while the chain walks other shelves', () => {
    // The key is passed on every rung, and the special case only fires for the
    // shelf the book is actually going on. A rung about some other shelf still
    // gets the cascade.
    const ids = ['Ann Author', 'Bob Baker', 'Cal Church', 'Dot Downs'].map((a) => shelve(a))
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(ids[3]!, '1B')
    expect(labels()).toEqual(['1A', '1A', '1A', '1B'])

    const result = shelves.overflow('fiction', '1B', 'area', keyFor('Ann Baxter'))
    expect(result.carry).toBeUndefined()
    // 1B holds one book, so the cascade has nothing to give up and says so.
    expect(result.ok).toBe(false)
    expect(result.error).toContain('holds only one book')
  })

  it('leaves nothing needing attention once the book is saved', () => {
    // It went where the app said, so the record and the room agree.
    shelve('Ann Author')
    shelve('Bob Baker')
    const cal = shelve('Cal Church')
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(cal, '1B')
    expect(shelves.review('fiction').misfiles).toEqual([])

    const carried = shelves.overflow('fiction', '1A', 'area', keyFor('Bob Baxter'))
    const baxter = add('Bob Baxter')
    store.setLocation(baxter, carried.carry!.to)

    expect(shelves.review('fiction').misfiles).toEqual([])
    expect(store.getBook(baxter)?.location).toBe('1B')
  })
})

describe('a book inserted into a shelf', () => {
  it('is allowed to simply fit, without displacing anyone', () => {
    // A thin book may well fit, and only a person can say otherwise, so
    // nothing moves on its own.
    add('Bob Baker')
    add('Cal Church')
    shelves.overflow('fiction', '1A', 'area')
    const before = shelves.layout('fiction')

    add('Ann Author')
    expect(labels()).toEqual(['1A', '1A', '1B'])
    expect(shelves.movesSince('fiction', before)).toEqual([])
  })
})

describe('removing a boundary', () => {
  it('merges the shelves back and reports the books coming home', () => {
    add('Ann Author')
    const bob = add('Bob Baker')
    const created = shelves.overflow('fiction', '1A', 'area')
    expect(labels()).toEqual(['1A', '1B'])

    const before = shelves.layout('fiction')
    shelves.remove(shelves.list('fiction')[0]!.id)

    expect(labels()).toEqual(['1A', '1A'])
    expect(shelves.movesSince('fiction', before)).toEqual([
      { id: bob, from: '1B', to: '1A' },
    ])
    expect(created.ok).toBe(true)
  })
})

describe('ranges are independent', () => {
  it('does not let a fiction boundary move non-fiction books', () => {
    add('Ann Author')
    add('Bob Baker')
    store.addBook({ title: 'Sapiens', authors: ['Yuval Harari'], isFiction: false })

    shelves.overflow('fiction', '1A', 'shelf')
    expect(shelves.layout('nonfiction').map((p) => p.label)).toEqual(['4A'])
  })
})

describe('every catalogued book has a shelf', () => {
  /**
   * The property behind dropping the "unshelved" count. A shelf is derived,
   * so being in the catalogue and being on a shelf are the same fact. If this
   * ever fails, an unshelved state exists again and needs reporting somewhere.
   */
  it('places every book exactly once, whatever the boundaries', () => {
    const ids = ['Austen, Jane', 'Brontë, Emily', 'Carter, Angela', 'Dickens, Charles',
      'Eliot, George', 'Forster, E M'].map((a) => add(a))

    for (const label of ['1A', '1A', '1B']) {
      shelves.overflow('fiction', label, 'area')
    }

    const placed = shelves.layout('fiction')
    expect(placed).toHaveLength(ids.length)
    expect(new Set(placed.map((p) => p.book.id))).toEqual(new Set(ids))
    // And every one of them names a real shelf.
    expect(placed.every((p) => /^\d+[A-Z]+$/.test(p.label))).toBe(true)
  })

  it('places a book saved without ever touching the location column', () => {
    // Which is every book saved since locations became derived.
    const id = add('Zola, Émile')
    const placed = shelves.layout('fiction')
    expect(placed.find((p) => p.book.id === id)?.label).toBe('1A')
    expect(store.getBook(id)?.location).toBe('')
  })
})

describe('a book taken off the shelf', () => {
  it('stops taking up room, so the shelf closes up behind it', () => {
    const ids = ['Jane Austen', 'Emily Bronte', 'Angela Carter'].map((a) => add(a))
    expect(labels()).toEqual(['1A', '1A', '1A'])

    store.setCheckedOut(ids[1]!, true)
    expect(shelves.layout('fiction').map((p) => p.book.id)).toEqual([ids[0], ids[2]])
  })

  it('is never offered as a neighbour to file against', () => {
    // The reason the column exists. A book in a pile on the table is not
    // something to put another book beside.
    add('Jane Austen')
    const middle = add('Emily Bronte')
    add('Angela Carter')

    const before = store.placementFor({
      title: 'X', authors: ['Ann Baxter'], isFiction: true,
    } as never)
    expect(before.successor?.id).toBe(middle)

    store.setCheckedOut(middle, true)
    const after = store.placementFor({
      title: 'X', authors: ['Ann Baxter'], isFiction: true,
    } as never)
    expect(after.successor?.id).not.toBe(middle)
  })

  it('comes back to the position its filing gives it, not the one it left', () => {
    const ids = ['Jane Austen', 'Emily Bronte', 'Angela Carter'].map((a) => add(a))
    store.setCheckedOut(ids[1]!, true)
    store.setCheckedOut(ids[1]!, false)
    expect(shelves.layout('fiction').map((p) => p.book.id)).toEqual(ids)
  })

  it('leaves the catalogue entry and its photos alone', () => {
    const id = add('Jane Austen', 'Persuasion')
    store.setCheckedOut(id, true)
    const book = store.getBook(id)
    expect(book?.title).toBe('Persuasion')
    expect(book?.checked_out_at).toBeTruthy()
    expect(store.checkedOut().map((b) => b.id)).toEqual([id])
  })

  it('counts as off the shelf without leaving its range tally', () => {
    add('Jane Austen')
    const id = add('Emily Bronte')
    store.setCheckedOut(id, true)
    expect(store.counts()).toEqual({
      total: 2, fiction: 2, nonfiction: 0, checkedOut: 1,
    })
  })
})

describe('moving a book across an area boundary', () => {
  /** Add a book and record the plank it landed on, as saving does. */
  const shelve = (author: string, title = 'Book') => {
    const id = add(author, title)
    store.setLocation(id, shelves.labelFor('fiction', id))
    return id
  }

  /** The move, followed by the person saying the book is on the new plank. */
  const carry = (id: number, direction: 'next' | 'previous') => {
    const result = shelves.moveAcrossBoundary('fiction', id, direction)
    if (result.ok && result.move) store.setLocation(id, result.move.to)
    return result
  }

  it('sends the last book of an area to the front of the next one', () => {
    const ann = shelve('Ann Author')
    const bob = shelve('Bob Baker')
    const cal = shelve('Cal Church')
    shelves.overflow('fiction', '1A', 'area')       // Cal alone on 1B
    store.setLocation(cal, '1B')
    expect(labels()).toEqual(['1A', '1A', '1B'])

    const result = carry(bob, 'next')
    expect(result.ok).toBe(true)
    expect(result.move?.from).toBe('1A')
    expect(result.move?.to).toBe('1B')
    expect(labels()).toEqual(['1A', '1B', '1B'])
    expect(store.getBook(ann)?.location).toBe('1A')
  })

  it('sends the first book of an area back to the end of the previous one', () => {
    shelve('Ann Author')
    shelve('Bob Baker')
    const cal = shelve('Cal Church')
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(cal, '1B')

    expect(carry(cal, 'previous').ok).toBe(true)
    expect(labels()).toEqual(['1A', '1A', '1A'])
    // Nothing was left for that boundary to start at, so it went.
    expect(shelves.list('fiction')).toEqual([])
  })

  it('refuses a book in the middle of its area', () => {
    const ann = shelve('Ann Author')
    shelve('Bob Baker')
    const cal = shelve('Cal Church')
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(cal, '1B')

    const result = shelves.moveAcrossBoundary('fiction', ann, 'next')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('first or last book of 1A')
    expect(labels()).toEqual(['1A', '1A', '1B'])
  })

  it('refuses the first book of the first area', () => {
    const ann = shelve('Ann Author')
    shelve('Bob Baker')
    shelves.overflow('fiction', '1A', 'area')

    const result = shelves.moveAcrossBoundary('fiction', ann, 'previous')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no area before 1A')
  })

  it('refuses the last book of the last area, and says where areas come from', () => {
    shelve('Ann Author')
    const bob = shelve('Bob Baker')
    shelves.overflow('fiction', '1A', 'area')

    const result = shelves.moveAcrossBoundary('fiction', bob, 'next')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no area after 1B')
    expect(result.error).toContain('full')
  })

  it('lets the only book in an area leave it, and empties the area', () => {
    // Capacity is not modelled, so nothing here says an area must hold a
    // book. The plank is simply bare, and a bare plank has no books to name.
    shelve('Ann Author')
    const bob = shelve('Bob Baker')
    const cal = shelve('Cal Church')
    shelves.overflow('fiction', '1A', 'area')       // Cal to 1B
    store.setLocation(cal, '1B')
    shelves.overflow('fiction', '1A', 'area')       // Bob to 1B as well
    store.setLocation(bob, '1B')
    shelves.overflow('fiction', '1B', 'area')       // Cal on to 1C
    store.setLocation(cal, '1C')
    expect(labels()).toEqual(['1A', '1B', '1C'])

    expect(carry(bob, 'next').ok).toBe(true)
    expect(labels()).toEqual(['1A', '1C', '1C'])
    expect(shelves.groups('fiction').map((g) => g.label)).toEqual(['1A', '1C'])
  })

  it('moves nothing but the book in your hand', () => {
    const ids = ['Ann Author', 'Bob Baker', 'Cal Church', 'Dot Downs'].map((a) => shelve(a))
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(ids[3]!, '1B')
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(ids[2]!, '1B')

    const result = shelves.moveAcrossBoundary('fiction', ids[1]!, 'next')
    expect(result.moves).toEqual([])
  })

  it('does not undo an overflow, and is not undone by one', () => {
    // The manual bounce and the automatic shuffle solve the same physical
    // problem two ways, so they must compose rather than fight.
    const ids = ['Ann Author', 'Bob Baker', 'Cal Church', 'Dot Downs'].map((a) => shelve(a))
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(ids[3]!, '1B')
    expect(labels()).toEqual(['1A', '1A', '1A', '1B'])

    carry(ids[2]!, 'next')                          // Cal joins Dot on 1B
    expect(labels()).toEqual(['1A', '1A', '1B', '1B'])

    // 1B will not take the pair after all: its last book goes on to 1C.
    const step = shelves.overflow('fiction', '1B', 'area')
    expect(step.step?.moved.id).toBe(ids[3])
    expect(labels()).toEqual(['1A', '1A', '1B', '1C'])
  })

  it('leaves the misfile list empty once the person has said the book moved', () => {
    // The failure this is most likely to have: a legitimate move reported
    // straight back as a book to go and move.
    const ids = ['Ann Author', 'Bob Baker', 'Cal Church'].map((a) => shelve(a))
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(ids[2]!, '1B')
    expect(shelves.review('fiction').misfiles).toEqual([])

    carry(ids[1]!, 'next')
    expect(shelves.review('fiction').misfiles).toEqual([])

    carry(ids[1]!, 'previous')
    expect(shelves.review('fiction').misfiles).toEqual([])
  })

  it('does not write a location itself', () => {
    // The boundary is furniture; where a book physically is was observed by a
    // person and is written through the one route that takes an observation.
    shelve('Ann Author')
    const bob = shelve('Bob Baker')
    const cal = shelve('Cal Church')
    shelves.overflow('fiction', '1A', 'area')
    store.setLocation(cal, '1B')

    shelves.moveAcrossBoundary('fiction', bob, 'next')
    expect(store.getBook(bob)?.location).toBe('1A')
    // And so it now reads as a book to move, which is correct until somebody
    // says otherwise.
    expect(shelves.review('fiction').misfiles.map((m) => [m.from, m.to]))
      .toEqual([['1A', '1B']])
  })

  it('sends the first book of a bookcase back to the last area of the one before', () => {
    /*
     * #79. Within a range the areas are one continuous sequence and a bookcase
     * break is only where it crosses furniture, so this is the same move. It
     * is the bookcase break that gets re-anchored, which is why the books past
     * it stay on the bookcase they were on.
     */
    const ann = shelve('Ann Author')
    const bob = shelve('Bob Baker')
    const cal = shelve('Cal Church')
    shelves.overflow('fiction', '1A', 'shelf')       // Cal on to bookcase 2
    store.setLocation(cal, '2A')
    shelves.overflow('fiction', '1A', 'shelf')       // Bob joins him there
    store.setLocation(bob, '2A')
    expect(labels()).toEqual(['1A', '2A', '2A'])
    expect(shelves.review('fiction').misfiles).toEqual([])

    const result = carry(bob, 'previous')
    expect(result.ok).toBe(true)
    expect(result.move?.from).toBe('2A')
    expect(result.move?.to).toBe('1A')
    expect(labels()).toEqual(['1A', '1A', '2A'])
    // Cal did not follow him back, and Ann never moved.
    expect(store.getBook(cal)?.location).toBe('2A')
    expect(store.getBook(ann)?.location).toBe('1A')
    expect(result.moves).toEqual([])
    expect(shelves.review('fiction').misfiles).toEqual([])
  })

  it('sends the last book of a bookcase on to the next one', () => {
    const ann = shelve('Ann Author')
    const bob = shelve('Bob Baker')
    const cal = shelve('Cal Church')
    shelves.overflow('fiction', '1A', 'shelf')
    store.setLocation(cal, '2A')
    expect(labels()).toEqual(['1A', '1A', '2A'])

    expect(carry(bob, 'next').ok).toBe(true)
    expect(labels()).toEqual(['1A', '2A', '2A'])
    expect(store.getBook(ann)?.location).toBe('1A')
    expect(shelves.review('fiction').misfiles).toEqual([])
  })

  it('keeps refusing at the ends of the range, bookcases or not', () => {
    // Making new furniture is what declaring a plank full is for. That holds
    // at the two ends of the run and nowhere else.
    const ann = shelve('Ann Author')
    const bob = shelve('Bob Baker')
    shelves.overflow('fiction', '1A', 'shelf')
    store.setLocation(bob, '2A')

    expect(shelves.moveAcrossBoundary('fiction', ann, 'previous').error)
      .toContain('no area before 1A')
    expect(shelves.moveAcrossBoundary('fiction', bob, 'next').error)
      .toContain('no area after 2A')
  })

  it('never lets a fiction move touch non-fiction', () => {
    shelve('Ann Author')
    const harari = store.addBook({
      title: 'Sapiens', authors: ['Yuval Harari'], isFiction: false,
    }).id

    const result = shelves.moveAcrossBoundary('fiction', harari, 'next')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not on a bookcase in this range')
  })
})

describe('misfile detection', () => {
  /** Add a book and record the shelf it actually landed on, as saving does. */
  const shelve = (author: string, title = 'Book') => {
    const id = add(author, title)
    store.setLocation(id, shelves.labelFor('fiction', id))
    return id
  }

  const flagged = (range: 'fiction' | 'nonfiction' = 'fiction') =>
    shelves.review(range).misfiles.map((m) => [m.book.id, m.from, m.to])

  it('says nothing while the shelves and the catalogue agree', () => {
    shelve('Ann Author')
    shelve('Bob Baker')
    expect(flagged()).toEqual([])
  })

  it('reports the book a full shelf pushed along, and where it goes', () => {
    shelve('Ann Author')
    const bob = shelve('Bob Baker')

    // The person says 1A will not take another. Bob physically moves to 1B,
    // but nobody has said so yet, so the catalogue still has him at 1A.
    shelves.overflow('fiction', '1A', 'area')

    expect(flagged()).toEqual([[bob, '1A', '1B']])
  })

  it('drops a book off the list once a person says they moved it', () => {
    shelve('Ann Author')
    const bob = shelve('Bob Baker')
    shelves.overflow('fiction', '1A', 'area')
    expect(flagged()).toHaveLength(1)

    store.setLocation(bob, '1B')
    expect(flagged()).toEqual([])
  })

  it('never rewrites a location to make the disagreement go away', () => {
    // The whole constraint in one assertion. Running the check twice must
    // leave the row exactly as it was, or the record of where the book really
    // is has been destroyed by the thing that only meant to notice.
    shelve('Ann Author')
    const bob = shelve('Bob Baker')
    shelves.overflow('fiction', '1A', 'area')

    const before = store.getBook(bob)
    shelves.review('fiction')
    shelves.review('fiction')
    expect(store.getBook(bob)).toEqual(before)
    expect(store.getBook(bob)?.location).toBe('1A')
  })

  it('reports the book an edit moved, which is the re-shelving case', () => {
    // Zola sits last. Renaming the author to Adams moves the book to the front
    // of the range, and the physical book has to follow it.
    shelve('Ann Author')
    shelve('Mary Mills')
    const id = shelve('Zoe Zola')
    shelves.overflow('fiction', '1A', 'area')       // Zola alone on 1B
    store.setLocation(id, '1B')
    expect(flagged()).toEqual([])

    store.updateBook(id, { title: 'Book', authors: ['Al Adams'], isFiction: true })
    expect(flagged()).toEqual([[id, '1B', '1A']])
  })

  it('leaves a book nobody ever placed out of it', () => {
    add('Ann Author')                                // saved, never confirmed
    shelve('Bob Baker')

    expect(flagged()).toEqual([])
    expect(shelves.review('fiction').excluded.map((e) => e.reason))
      .toEqual(['never-placed'])
  })

  it('leaves a checked-out book out of it, and says that it did', () => {
    const ann = shelve('Ann Author')
    shelve('Bob Baker')
    store.setCheckedOut(ann, true)

    const review = shelves.review('fiction')
    expect(review.misfiles).toEqual([])
    // Absent from the layout, so it has to be pulled in deliberately or the
    // caller cannot tell "fine" from "not looked at".
    expect(review.excluded.map((e) => [e.book.id, e.reason])).toEqual([
      [ann, 'checked-out'],
    ])
  })

  it('never compares fiction against non-fiction', () => {
    // Bookcase 4 is non-fiction's own. A non-fiction book at 4A is not ahead
    // of or behind a fiction book at 1A; the two runs never interact.
    shelve('Ann Author')
    const harari = store.addBook({
      title: 'Sapiens', authors: ['Yuval Harari'], isFiction: false,
    }).id
    store.setLocation(harari, shelves.labelFor('nonfiction', harari))

    expect(shelves.review('fiction').misfiles).toEqual([])
    expect(shelves.review('nonfiction').misfiles).toEqual([])
    // And each range only ever reports its own books.
    expect(shelves.review('nonfiction').excluded.map((e) => e.book.id)).toEqual([])
  })

  it('sets a label it cannot read aside rather than guessing', () => {
    const id = shelve('Ann Author')
    store.setLocation(id, 'in the loft')

    const review = shelves.review('fiction')
    expect(review.misfiles).toEqual([])
    expect(review.excluded.map((e) => e.reason)).toEqual(['unreadable-location'])
  })
})

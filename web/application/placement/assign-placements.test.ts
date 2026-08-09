/**
 * The engine, over a ledger it can be handed row by row.
 *
 * `infrastructure/db/placement-ledger.test.ts` runs this handler over a real
 * catalogue of 236 books and counts what it wrote; this file is the other half,
 * where each case is one book whose history is stated outright. The two are
 * worth having separately because the interesting inputs here are histories a
 * seeded catalogue does not have yet: a pinned book, a withdrawn one, a book two
 * rules both claim.
 */

import { describe, expect, it } from 'vitest'
import type { Area, Fixture, Slot } from '../../domain/placement/geography'
import type { Placement } from '../../domain/placement/ledger'
import type { PlacementRule } from '../../domain/placement/rules'
import { AssignPlacementsHandler, type AssignableBook } from './assign-placements'
import type { NewPlacement, PlacementLedger } from './ports'

const fixture = (id: number, position: number): Fixture =>
  ({ id, position, kind: 'bookshelf', name: '', sortStrategy: 'inherit' })

const areaAt = (id: number, fixtureId: number, position: number, startsAt: string): Area =>
  ({ id, fixtureId, position, name: '', startsAt, sortStrategy: 'inherit' })

/** Two bookcases, two planks each, and a rule pointing at each bookcase. */
const ORDER: Slot[] = [
  { fixture: fixture(1, 1), area: areaAt(10, 1, 0, '') },
  { fixture: fixture(1, 1), area: areaAt(11, 1, 1, 'm') },
  { fixture: fixture(2, 4), area: areaAt(20, 2, 0, '') },
  { fixture: fixture(2, 4), area: areaAt(21, 2, 1, 'm') },
]

const RULES: PlacementRule[] = [
  {
    id: 1, areaId: null, fixtureId: 1, priority: 1, name: 'Fiction', enabled: true,
    conditions: [{ field: 'tag', operator: 'is', value: 'genre/fiction' }],
  },
  {
    id: 2, areaId: null, fixtureId: 2, priority: 2, name: 'Non-fiction', enabled: true,
    conditions: [{ field: 'tag', operator: 'is', value: 'genre/non-fiction' }],
  },
]

/** A ledger in a list, so a book's history is stated rather than built up. */
class LedgerInMemory implements PlacementLedger {
  readonly written: NewPlacement[] = []

  constructor(private readonly rows: Placement[] = []) {}

  async record(placement: NewPlacement): Promise<void> {
    this.written.push(placement)
    this.rows.push({
      id: this.rows.length + 1,
      bookId: placement.bookId,
      kind: placement.kind,
      areaId: placement.areaId,
      sortKey: placement.sortKey,
      ruleId: placement.ruleId ?? null,
      actor: placement.actor,
      reason: placement.reason ?? '',
      createdAt: placement.createdAt,
    })
  }

  async forBooks(bookIds: readonly number[]): Promise<Placement[]> {
    return this.rows.filter((row) => bookIds.includes(row.bookId))
  }
}

let nextRowId = 0

const rowFor = (
  bookId: number,
  kind: Placement['kind'],
  areaId: number | null = null,
): Placement => ({
  id: (nextRowId += 1),
  bookId,
  kind,
  areaId,
  sortKey: 'a',
  ruleId: null,
  actor: 'person',
  reason: '',
  createdAt: '2026-08-01T00:00:00.000Z',
})

const fictionBook = (id: number, sortKey = 'a'): AssignableBook =>
  ({ id, sortKey, tagSlugs: ['genre/fiction'] })

async function run(ledger: LedgerInMemory, books: AssignableBook[]) {
  return new AssignPlacementsHandler(ledger).handle({
    books, rules: RULES, order: ORDER, actor: 'rules', now: '2026-08-09T00:00:00.000Z',
  })
}

describe('assigning placements', () => {
  it('writes nothing for a book already where the rules want it', async () => {
    const ledger = new LedgerInMemory([rowFor(1, 'placed', 10)])
    expect(await run(ledger, [fictionBook(1)]))
      .toEqual({ assigned: 0, unchanged: 1, skipped: 0, unclaimed: [] })
    expect(ledger.written).toEqual([])
  })

  it('writes one for a book on the wrong plank, naming the rule that wanted it', async () => {
    const ledger = new LedgerInMemory([rowFor(1, 'placed', 11)])
    expect((await run(ledger, [fictionBook(1)])).assigned).toBe(1)
    expect(ledger.written).toEqual([{
      bookId: 1, kind: 'assigned', areaId: 10, sortKey: 'a', ruleId: 1,
      actor: 'rules', reason: 'Fiction', createdAt: '2026-08-09T00:00:00.000Z',
    }])
  })

  it('does not write the same assignment again on the next run', async () => {
    // The flood this rule exists to prevent. Nobody has carried the book, the
    // answer has not changed, and a second identical row would say nothing while
    // doubling the history of every book that is out of place.
    const ledger = new LedgerInMemory([rowFor(1, 'placed', 11)])
    await run(ledger, [fictionBook(1)])
    expect(await run(ledger, [fictionBook(1)]))
      .toEqual({ assigned: 0, unchanged: 1, skipped: 0, unclaimed: [] })
    expect(ledger.written).toHaveLength(1)
  })

  it('writes a second one when the rules change their mind again', async () => {
    const ledger = new LedgerInMemory([rowFor(1, 'placed', 11), rowFor(1, 'assigned', 11)])
    expect((await run(ledger, [fictionBook(1)])).assigned).toBe(1)
    expect(ledger.written.map((row) => row.areaId)).toEqual([10])
  })

  it('writes one for a book nobody has placed at all', async () => {
    const ledger = new LedgerInMemory()
    expect((await run(ledger, [fictionBook(1)])).assigned).toBe(1)
  })

  it('skips a pinned book, a withdrawn one and one that is checked out', async () => {
    const ledger = new LedgerInMemory([
      rowFor(1, 'placed', 11), rowFor(1, 'pinned', 11),
      rowFor(2, 'placed', 11), rowFor(2, 'withdrawn'),
      rowFor(3, 'placed', 11), rowFor(3, 'checked_out'),
    ])

    expect(await run(ledger, [fictionBook(1), fictionBook(2), fictionBook(3)]))
      .toEqual({ assigned: 0, unchanged: 0, skipped: 3, unclaimed: [] })
    expect(ledger.written).toEqual([])
  })

  it('picks the pin back up once it is lifted', async () => {
    // Unpinning is another row rather than a flag anybody clears, so the engine
    // finds the book by folding the same history it always folds.
    const ledger = new LedgerInMemory([
      rowFor(1, 'pinned', 11), rowFor(1, 'placed', 11),
    ])
    expect((await run(ledger, [fictionBook(1)])).assigned).toBe(1)
  })

  it('reports a book no rule claims rather than putting it somewhere', async () => {
    const ledger = new LedgerInMemory()
    const report = await run(ledger, [{ id: 9, sortKey: 'a', tagSlugs: ['genre/poetry'] }])
    expect(report.unclaimed).toEqual([9])
    expect(ledger.written).toEqual([])
  })

  it('follows the sort key into the right plank of the run', async () => {
    const ledger = new LedgerInMemory([rowFor(1, 'placed', 10)])
    expect((await run(ledger, [fictionBook(1, 'zzz')])).assigned).toBe(1)
    expect(ledger.written[0]!.areaId).toBe(11)
  })
})

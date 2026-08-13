/**
 * Arranging a fixture's face, with no database anywhere near it.
 *
 * The three shapes of removing an area are the ones worth pinning, because they
 * are what a person is agreeing to in the dialog #281 settled, and the second
 * and third are the ones that get skipped. The rest is the arithmetic every
 * write here is built on: which ordinals move, and which labels read
 * differently afterwards.
 */

import { describe, expect, it } from 'vitest'
import {
  anchorsAscend, moveArea, removeArea, strategyChange,
} from './arrangement'
import type { Area, Fixture, Slot } from './geography'

const bookcase = (over: Partial<Fixture> = {}): Fixture => ({
  id: 1, position: 2, kind: 'bookshelf', name: '', sortStrategy: 'inherit', ...over,
})

const plank = (position: number, over: Partial<Area> = {}): Area => ({
  id: 10 + position,
  fixtureId: 1,
  position,
  name: '',
  startsAt: position === 0 ? '' : `key-${position}`,
  sortStrategy: 'inherit',
  ...over,
})

const face = (count: number, fixture = bookcase(), over: Partial<Area>[] = []): Slot[] =>
  Array.from({ length: count }, (_, at) => ({
    fixture, area: plank(at, over[at] ?? {}),
  }))

describe('moving an area along its piece', () => {
  it('renumbers everything between where it was and where it is going', () => {
    const change = moveArea(face(4), 13, 1)!

    expect(change.order).toEqual([10, 13, 11, 12])
    expect(change.moves).toEqual([
      { id: 13, from: 3, to: 1 },
      { id: 11, from: 1, to: 2 },
      { id: 12, from: 2, to: 3 },
    ])
    expect(change.becomes).toEqual([
      { from: '2D', to: '2B' },
      { from: '2B', to: '2C' },
      { from: '2C', to: '2D' },
    ])
  })

  it('is a change of nothing when the area is already there', () => {
    const change = moveArea(face(3), 11, 1)!
    expect(change.moves).toEqual([])
    expect(change.becomes).toEqual([])
  })

  it('leaves a named area reading the same wherever it sits', () => {
    const change = moveArea(face(3, bookcase(), [{}, {}, { name: 'Cookery' }]), 12, 0)!

    // The named one keeps its label because a name is what somebody chose; the
    // two it moved past do not, because a letter is only where they sit.
    expect(change.becomes).toEqual([
      { from: '2A', to: '2B' },
      { from: '2B', to: '2C' },
    ])
  })

  it('clamps rather than refusing, so a drag to the bottom of a list lands', () => {
    expect(moveArea(face(3), 10, 99)!.order).toEqual([11, 12, 10])
  })

  it('answers nothing about an area that is not on this face', () => {
    expect(moveArea(face(3), 99, 0)).toBeNull()
  })
})

describe('the anchors on a face', () => {
  it('may repeat, because a boundary move that empties an area leaves two', () => {
    const slots = face(3, bookcase(), [{}, { startsAt: 'k' }, { startsAt: 'k' }])
    expect(anchorsAscend(slots, [10, 11, 12])).toBe(true)
  })

  it('may not run backwards, because the books do not', () => {
    expect(anchorsAscend(face(3), [10, 12, 11])).toBe(false)
  })
})

describe('removing an area', () => {
  it('sends its books back into the area before it, which keeps its own anchor', () => {
    const slots = face(3, bookcase(), [{}, {}, { name: 'Cookery' }])
    const removal = removeArea(slots, 12)
    if (!removal.ok) throw new Error(removal.error)

    expect(removal.removal.joins).toBe('previous')
    expect(removal.removal.into).toEqual({ id: 11, label: '2B' })
    // Nothing before it moves, so nothing else is relabelled: the one label that
    // changes is the one those books read under.
    expect(removal.removal.anchor).toBeNull()
    expect(removal.removal.order).toEqual([10, 11])
    expect(removal.removal.becomes).toEqual([{ from: '2 · Cookery', to: '2B' }])
  })

  it('brings the next area forward when the first one goes, and shuffles the rest', () => {
    const window = bookcase({ name: 'By the window' })
    const removal = removeArea(face(5, window), 10)
    if (!removal.ok) throw new Error(removal.error)

    expect(removal.removal.joins).toBe('next')
    expect(removal.removal.into).toEqual({ id: 11, label: 'By the window · B' })
    // It takes over the removed area's place in the sequence, so it opens where
    // the removed one opened. Without this the books before its own anchor land
    // in an area nobody asked about.
    expect(removal.removal.anchor).toBe('')
    expect(removal.removal.becomes).toEqual([
      { from: 'By the window · B', to: 'By the window · A' },
      { from: 'By the window · C', to: 'By the window · B' },
      { from: 'By the window · D', to: 'By the window · C' },
      { from: 'By the window · E', to: 'By the window · D' },
    ])
  })

  it('refuses the only area on a piece, because its books have nowhere to go', () => {
    const desk = bookcase({ name: 'Desk' })
    const removal = removeArea(face(1, desk, [{ name: 'Left side' }]), 10)

    expect(removal.ok).toBe(false)
    if (removal.ok) return
    expect(removal.error).toContain('Desk · Left side')
    expect(removal.error).toContain('Deleting the piece')
  })
})

describe('giving an area an order of its own', () => {
  const run = (): Slot[] => [
    { fixture: bookcase({ id: 1, position: 1 }), area: plank(0, { id: 20, fixtureId: 1 }) },
    { fixture: bookcase({ id: 1, position: 1 }), area: plank(1, { id: 21, fixtureId: 1 }) },
    { fixture: bookcase({ id: 1, position: 1 }), area: plank(2, { id: 22, fixtureId: 1 }) },
  ]

  it('cuts the run, and names every area that leaves it', () => {
    const change = strategyChange(run(), new Set([20]), 21, 'title')!

    expect(change.selfContained).toBe(true)
    expect(change.cuts).toBe(true)
    expect(change.affected).toEqual(['1B', '1C'])
  })

  it('cuts nothing when a rule already points at the area', () => {
    const change = strategyChange(run(), new Set([20, 21]), 21, 'title')!
    expect(change.selfContained).toBe(true)
    expect(change.cuts).toBe(false)
  })

  it('cuts nothing at the very first area, which has nothing to overflow from', () => {
    const change = strategyChange(run(), new Set(), 20, 'title')!
    expect(change.cuts).toBe(false)
  })

  it('says the run rejoins when a strategy is given up', () => {
    const ordered = run()
    ordered[1]!.area = { ...ordered[1]!.area, sortStrategy: 'title' }

    const change = strategyChange(ordered, new Set([20]), 21, 'inherit')!
    expect(change.selfContained).toBe(false)
    expect(change.cuts).toBe(true)
    expect(change.affected).toEqual(['1B', '1C'])
  })
})

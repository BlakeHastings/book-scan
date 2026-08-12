/**
 * What the plan tells somebody standing in front of a bookcase.
 *
 * The failure this guards against is the plan being read and believed: 50 books
 * carried, three pinned ones silently left behind, and no way to tell from the
 * screen that anything was omitted. So the counts are held to the groups, and
 * every skipped book is held to a reason said in words.
 *
 * Rendered as markup rather than driven in a browser, the same way
 * `ShelveView.test.tsx` does it. `RunPlanPanel` holds no state, which is what
 * makes that possible and is why it is split out of the screen at all.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RunPlanPanel } from './MoveRunView'
import type { PlannedBook, RunMovePlan } from '../lib/api'

const book = (id: number): PlannedBook =>
  ({ id, title: `Title ${id}`, authorFiling: `Author, ${id}` })

const books = (from: number, count: number) =>
  Array.from({ length: count }, (_, at) => book(from + at))

const plan = (over: Partial<RunMovePlan> = {}): RunMovePlan => ({
  from: 4,
  to: 3,
  planks: [{ from: '4A', to: '3A' }, { from: '4B', to: '3B' }, { from: '4C', to: '3C' }],
  groups: [
    { from: '4A', to: '3A', books: books(1, 8) },
    { from: '4B', to: '3B', books: books(9, 20) },
    { from: '4C', to: '3C', books: books(29, 22) },
  ],
  moving: 50,
  staying: 0,
  skipped: [],
  unclaimed: [],
  ...over,
})

const drawn = (over: Partial<RunMovePlan> = {}) =>
  renderToStaticMarkup(RunPlanPanel({ plan: plan(over) }))

describe('the plan for moving a run', () => {
  it('leads with the number of books to carry, not with fifty lines', () => {
    const html = drawn()
    expect(html).toContain('50 books to carry')
    expect(html).toContain('4A → 3A, 4B → 3B, 4C → 3C')
  })

  it('groups by the two planks each move names, with the count on the summary', () => {
    // What somebody acts on is "22 books, 4C to 3C". The titles are underneath,
    // folded away, for when a number looks wrong.
    const html = drawn()
    /*
     * The spaces are asserted because they were lost once and this is not where
     * they went: the markup was always right, and `display: flex` on the summary
     * dropped the whitespace at each flex item's edge, so a phone read "8books ·
     * 4A →3A". That is a CSS defect no markup test can catch, which is worth
     * knowing rather than being caught by this passing.
     */
    expect(html).toContain('<strong>8</strong> books · 4A → <strong>3A</strong>')
    expect(html).toContain('<strong>20</strong> books · 4B → <strong>3B</strong>')
    expect(html).toContain('<strong>22</strong> books · 4C → <strong>3C</strong>')
    // Folded, so the page is three lines rather than fifty until somebody asks.
    expect(html).not.toContain('<details class="runmove__group" open')
  })

  it('says how many books it left alone and why, in words', () => {
    const html = drawn({
      moving: 47,
      skipped: [
        { reason: 'pinned', books: books(1, 3) },
        { reason: 'checked-out', books: books(90, 1) },
      ],
    })
    expect(html).toContain('47 books to carry')
    expect(html).toContain('3 left alone: pinned to where they are, which beats every rule')
    expect(html).toContain('1 left alone: checked out')
  })

  it('names the books no rule claims rather than counting them as staying put', () => {
    const html = drawn({ unclaimed: [book(77)] })
    expect(html).toContain('1 that no rule claims')
    expect(html).toContain('Title 77')
  })

  it('says what it is leaving where it is', () => {
    expect(drawn({ moving: 0, groups: [], staying: 12 }))
      .toContain('12 books stay exactly where they are.')
  })

  it('draws no plank line for a run that is already there', () => {
    const html = drawn({ planks: [], groups: [], moving: 0, staying: 50 })
    expect(html).not.toContain('runmove__planks')
    expect(html).toContain('0 books to carry')
  })

  it('names every book it says it is moving', () => {
    // The count and the list are one claim. A summary that said 8 over a list
    // of 7 would be the same omission the skipped reasons exist to prevent.
    const html = drawn({
      groups: [{ from: '4A', to: '3A', books: books(1, 3) }], moving: 3,
    })
    expect(html).toContain('Title 1')
    expect(html).toContain('Title 2')
    expect(html).toContain('Title 3')
    expect(html).toContain('Author, 1')
  })
})

/**
 * The area screen, and the dialog that has to be right about somebody's books.
 *
 * This is where the design and the model can most easily be made to disagree,
 * so most of this file is about one sentence.
 *
 * **`becomes` is a projection and not a promise.** The drawn dialog said "2B
 * holds 42 books afterwards", which reads as the count on 2B going up the
 * moment the area goes. It does not: a count on an area is where somebody last
 * said the books were, and only the location route changes that. Removing an
 * area writes what the rules now want, and the difference between the two is
 * the needs-attention list. So the screen says what is written and who has to
 * confirm it, and the number in it is the one the server answers with.
 *
 * **`pinned` is never a silent subtraction.** Where the plan leaves books
 * alone it says how many and why, in the dialog, under the sentence.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AreaPane, type Asking } from './AreaPane'
import type { AreaDto, AreaRemovalPlan, FixtureDto } from '../lib/api'

const area: AreaDto = {
  id: 5, position: 2, label: '2 · Cookery', name: 'Cookery', startsAt: '',
  sortStrategy: 'inherit', ordering: 'author', selfContained: false, note: '',
  books: 18, holds: 'Anything tagged Cookery', entry: true, rule: null,
}

const piece: FixtureDto = {
  id: 2, position: 2, label: '2', kind: 'bookshelf', name: '', sortStrategy: 'inherit',
  note: '', books: 63, areas: [area], sharing: [],
  holds: 'Anything tagged Non-fiction', rule: null,
}

const plan = (over: Partial<AreaRemovalPlan> = {}): AreaRemovalPlan => ({
  area: { id: 5, label: '2 · Cookery', books: 18 },
  into: { id: 4, label: '2B' },
  joins: 'previous',
  joining: 18,
  skipped: [],
  becomes: [{ from: '2 · Cookery', to: '2B' }],
  ...over,
})

const nothing = () => {}

function drawn(asking: Asking | null, over: Partial<AreaDto> = {}, typed?: string): string {
  return renderToStaticMarkup(
    <AreaPane
      piece={piece}
      area={{ ...area, ...over }}
      name={typed ?? over.name ?? area.name}
      asking={asking}
      busy={false}
      error=""
      tabs={{ home: nothing, library: nothing, scan: nothing, queue: nothing }}
      onBack={nothing}
      onName={nothing}
      onSaveName={nothing}
      onBelongs={nothing}
      onSorting={nothing}
      onSplit={nothing}
      onAsk={nothing}
      onKeep={nothing}
      onRemove={nothing}
      onPiece={nothing}
    />,
  )
}

const words = (markup: string): string => markup.replace(/<[^>]*>/g, ' ')
const title = (markup: string): string | undefined =>
  markup.match(/<h2 class="wf-sure__title">([^<]+)<\/h2>/)?.[1]

describe('the area screen', () => {
  it('says which piece it is on without drawing the piece', () => {
    const said = words(drawn(null))
    expect(said).toMatch(/18 books, on Bookcase 2/)
    expect(drawn(null)).not.toMatch(/wf-nest/)
  })

  /**
   * The way to remove an area did not exist anywhere in the interface until
   * #281, which is how the dialog started; a tidy-up that loses the button
   * leaves the dialog written and unreachable and every screen still renders.
   */
  it('offers exactly one destructive thing, behind a fence', () => {
    const markup = drawn(null)
    expect(markup.match(/wf-btn--danger/g)).toHaveLength(1)
    expect(words(markup)).toMatch(/Remove this area/)
  })

  it('offers to keep a name only once the name has been changed', () => {
    expect(words(drawn(null))).not.toMatch(/Call it/)
    expect(words(drawn(null, {}, 'Baking'))).toMatch(/Call it Baking/)
  })

  it('says whether the area takes what overflows into it', () => {
    expect(words(drawn(null))).toMatch(/It takes what overflows from the area before it/)
    expect(words(drawn(null, { selfContained: true, sortStrategy: 'title' })))
      .toMatch(/It orders itself, so nothing overflows into it/)
  })
})

describe('being asked whether to remove an area', () => {
  it('says it about their own books, with the count in it', () => {
    expect(title(drawn({ kind: 'merge', plan: plan() })))
      .toBe('Its 18 books join 2B')
  })

  /**
   * The one the drawing got wrong. "2B holds 42 books afterwards" is a count
   * this app cannot honestly print, because a count is where somebody last said
   * the books were and nothing here has been to the shelf.
   */
  it('never claims the area they join holds more books afterwards', () => {
    const said = words(drawn({ kind: 'merge', plan: plan() }))
    expect(said).not.toMatch(/holds \d+ books afterwards/)
    expect(said).toMatch(/18 books will be filed under 2B from now on/)
    expect(said).toMatch(/confirm each one where it stands/)
  })

  it('says nothing is carried by the removal itself', () => {
    expect(words(drawn({ kind: 'merge', plan: plan() })))
      .toMatch(/They stay on Bookcase 2 where they are, and nothing is carried/)
  })

  /**
   * A label is worked out from where a thing sits, so removing one area renames
   * every area after it. A sentence claiming that is worth less than the rows
   * showing it.
   */
  it('draws the labels that read differently rather than describing them', () => {
    const markup = drawn({ kind: 'merge', plan: plan({
      becomes: [{ from: '2 · Cookery', to: '2B' }, { from: '2D', to: '2C' }],
    }) })
    expect(markup).toMatch(/wf-sure__becomes/)
    expect(words(markup)).toMatch(/2 · Cookery\s*becomes\s*2B/)
    expect(words(markup)).toMatch(/2D\s*becomes\s*2C/)
  })

  /** `pinned` beats every rule, forever, and a count that excludes it says so. */
  it('names every book it is leaving alone, and why', () => {
    const said = words(drawn({ kind: 'merge', plan: plan({
      joining: 15, skipped: [{ reason: 'pinned', books: 3 }],
    }) }))
    expect(said).toMatch(/15 books will be filed under 2B/)
    expect(said).toMatch(/3 books pinned where they are, which beats every rule/)
  })

  /**
   * The first area on a piece has nothing before it, and a dialog saying its
   * books join "the area before" is promising something this app cannot do at
   * the top of every piece of furniture in the room.
   */
  it('never promises an area before the first one', () => {
    const markup = drawn({ kind: 'merge', plan: plan({
      area: { id: 1, label: 'By the window · A', books: 22 },
      into: { id: 2, label: 'By the window · B' },
      joins: 'next',
      joining: 22,
      becomes: [{ from: 'By the window · B', to: 'By the window · A' }],
    }) })

    expect(title(markup)).not.toMatch(/before/i)
    expect(title(markup)).toMatch(/join By the window · B/)
    expect(words(markup)).toMatch(/Nothing comes before it, so its books join the area after it/)
  })

  /** An area with nothing standing in it has no count to lead on. */
  it('does not say "its 0 books" about an empty area', () => {
    const markup = drawn({ kind: 'merge', plan: plan({
      area: { id: 5, label: '2 · Cookery', books: 0 }, joining: 0,
    }) })
    expect(title(markup)).toBe('No books stand in 2 · Cookery')
    expect(words(markup)).toMatch(/No book has to be refiled/)
  })

  /**
   * The only area on a piece: there is nowhere on that piece for its books, so
   * the dialog refuses by offering the thing somebody meant.
   */
  it('offers the piece itself where the area is the only one on it', () => {
    const markup = drawn({ kind: 'only', said: 'It is the only area on the piece.' })
    expect(title(markup)).toBe('Its 18 books have nowhere else on the bookcase 2')
    expect(words(markup)).toMatch(/Deleting the bookcase 2 moves them to other furniture/)
    expect(words(markup)).toMatch(/Take the bookcase 2 out of the room/)
  })

  /** The safe answer is the one a thumb lands on without aiming. */
  it('puts the destructive answer first and the safe one beside it', () => {
    for (const asking of [
      { kind: 'merge', plan: plan() } as Asking,
      { kind: 'only', said: '' } as Asking,
    ]) {
      const markup = drawn(asking)
      const acts = markup.slice(markup.indexOf('class="wf-sure__acts"'))
      expect(acts).toMatch(/Keep it/)
      expect(acts.indexOf('wf-btn--danger')).toBeLessThan(acts.indexOf('Keep it'))
    }
  })
})

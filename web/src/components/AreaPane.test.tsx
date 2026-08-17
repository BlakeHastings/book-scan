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
import { AreaPane, type Asking, type Sorting } from './AreaPane'
import type {
  AreaBook, AreaDto, AreaRemovalPlan, FixtureDto, FurnitureDto, RuleDto,
} from '../lib/api'

const rule = (over: Partial<RuleDto> = {}): RuleDto => ({
  id: 2,
  name: 'Cookery',
  about: 'area',
  place: '2 · Cookery',
  placeId: 5,
  enabled: true,
  conditions: [{ operator: 'is', tag: 'Non-fiction' }, { operator: 'under', tag: 'Cookery' }],
  said: 'Anything tagged Cookery',
  range: 'nonfiction',
  ...over,
})

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

const room: FurnitureDto = {
  fixtures: [piece],
  defaultSortStrategy: 'author',
  strategies: [
    { code: 'inherit', label: 'Same as the shelf it is on', isInherit: true },
    { code: 'author', label: 'By author', isInherit: false },
    { code: 'title', label: 'By title', isInherit: false },
  ],
}

const shelved = (over: Partial<AreaBook> = {}): AreaBook => ({
  id: 1,
  title: 'On Food and Cooking',
  authorFiling: 'McGee, Harold',
  titleFiling: 'On Food and Cooking',
  published: '1984',
  sortKey: 'MCGEE',
  tagSlugs: [],
  tags: [],
  claimedBy: 'Cookery',
  ...over,
})

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

function drawn(
  asking: Asking | null,
  over: Partial<AreaDto> = {},
  typed?: string,
  books: AreaBook[] = [],
  sorting: Sorting = { open: false, chosen: 'inherit', effect: '', busy: false },
  on: FixtureDto = piece,
): string {
  return renderToStaticMarkup(
    <AreaPane
      room={{ ...room, fixtures: [on] }}
      piece={on}
      area={{ ...area, ...over }}
      name={typed ?? over.name ?? area.name}
      books={books}
      sorting={sorting}
      asking={asking}
      busy={false}
      error=""
      tabs={{ home: nothing, library: nothing, scan: nothing, queue: nothing }}
      onBack={nothing}
      onName={nothing}
      onSaveName={nothing}
      onChange={nothing}
      onOpenSort={nothing}
      onChooseSort={nothing}
      onSaveSort={nothing}
      onCloseSort={nothing}
      onClaimed={nothing}
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
  it('offers exactly one destructive thing, and it is the last thing on the page', () => {
    const markup = drawn(null)
    expect(markup.match(/wf-btn--danger/g)).toHaveLength(1)
    expect(words(markup)).toMatch(/Remove this area/)
  })

  /**
   * "I also don't like how 'remove this area' is surrounded in a dotted box."
   *
   * The box is `Card weight="quiet"`, which is the dashed outline this system
   * draws for something that is not there yet, and it was doing a real job:
   * keeping the irreversible thing from sitting shoulder to shoulder with the
   * thing the page is for. What replaces it is where the button sits, so both
   * halves are checked, because the way this comes back is somebody restoring
   * the fence and the way it gets worse is somebody moving the button up.
   */
  it('draws no dashed box around it, and nothing to press after it', () => {
    const markup = drawn(null)

    expect(markup).not.toMatch(/wf-card--quiet/)
    // The last button on the page, tabs aside, which is what the fence did by
    // standing something between it and everything else.
    const after = markup.slice(markup.indexOf('wf-btn--danger') + 1)
    expect(after).not.toMatch(/wf-btn wf-btn--/)
  })

  /**
   * The screen that asked which book a new area starts at is gone (#381), and
   * so is the button that opened it. A boundary is still moved from the book
   * that starts one, which is the screen somebody is on when they notice.
   */
  it('does not offer to split the area, which was a screen and is not one', () => {
    expect(words(drawn(null))).not.toMatch(/Split this area/)
  })

  it('offers to keep a name only once the name has been changed', () => {
    expect(words(drawn(null))).not.toMatch(/Call it/)
    expect(words(drawn(null, {}, 'Baking'))).toMatch(/Call it Baking/)
  })

  /**
   * Three answers, not two, and the third is the one that was wrong.
   *
   * Found by opening it: 4A reads "Non-fiction starts here" and the pane told
   * somebody standing in front of it that it takes what overflows from the area
   * before. Nothing comes before the area a rule points at, so that sentence
   * was false at the top of every stretch of books in the room.
   */
  it('says whether the area takes what overflows into it', () => {
    expect(words(drawn(null, { entry: false })))
      .toMatch(/It takes what overflows from the area before it/)
    expect(words(drawn(null, { entry: true })))
      .toMatch(/The books start here, so nothing overflows into it/)
    expect(words(drawn(null, { selfContained: true, sortStrategy: 'title' })))
      .toMatch(/It orders itself, so nothing overflows into it/)
  })
})

/**
 * What the page says about the two rules, which is the whole of #381.
 *
 * Both used to be a link to a screen that explained them, and the owner walked
 * that and said what was wrong with it: "instead of 'see what belongs here' we
 * should just show what belongs there, and then have the ability to edit it if
 * the user clicks it. And then how it's ordered is another one."
 *
 * The checks that matter are the ones a helpful edit undoes. **A rule shown as a
 * name only** is the page saying less than the screen it replaced. **A second
 * way to change a rule** is what #323 settled deliberately against, and it is
 * one `Field` away from existing on this page. And **an ordering named but not
 * shown** is the half the owner said was missing: "it's hard to see how things
 * sort, or why they sort."
 */
describe('the two rules on an area', () => {
  it('shows what belongs here rather than a way to go and look', () => {
    const said = words(drawn(null, { rule: rule() }))

    expect(said).toMatch(/Anything tagged Cookery/)
    expect(said).toMatch(/Tagged\s*Non-fiction/)
    expect(said).toMatch(/Tagged anything under\s*Cookery/)
    expect(said).not.toMatch(/See what belongs here/)
  })

  it('offers the one journey that changes a rule, and no editor of its own', () => {
    const markup = drawn(null, { rule: rule() })

    expect(words(markup)).toMatch(/Point Cookery somewhere else/)
    /*
     * One field on the page and it is the name. A second box, to type a tag or
     * a condition into, would be the second way to change a rule that #323
     * decided against on purpose: a rule change is what makes books need
     * carrying, so it goes through the journey that says where they would go.
     */
    expect(markup.match(/wf-field__input/g)).toHaveLength(1)
    expect(markup).not.toMatch(/wf-add-tag|Add another thing that must be true/)
  })

  it('offers nothing of the sort for a rule it cannot point anywhere', () => {
    const said = words(drawn(null, { rule: rule({ range: null }) }))

    expect(said).not.toMatch(/Point Cookery somewhere else/)
    expect(said).toMatch(/is about this one area/)
  })

  it('names both rules that reach here, the smaller place first', () => {
    const wider = rule({ id: 9, name: 'Non-fiction', about: 'fixture', placeId: 2, place: '2' })
    const said = words(drawn(null, { rule: rule() }, undefined, [], undefined, {
      ...piece, rule: wider,
    }))

    expect(said).toMatch(/the one about the smaller place wins/i)
    expect(said.indexOf('Cookery,')).toBeLessThan(said.indexOf('Non-fiction,'))
    expect(said).toMatch(/and everything after it/)
  })

  it('calls it a sort rule, which is what the owner calls it', () => {
    expect(words(drawn(null))).toMatch(/Sort rule/)
    expect(words(drawn(null))).toMatch(/Change the sort rule/)
  })

  /**
   * The answer to "why do they sort like that", which a name cannot give. The
   * books are drawn under the ordering, in it, with what it files each one
   * under beside it.
   */
  it('shows what the ordering does to these books rather than only naming it', () => {
    const said = words(drawn(null, {}, undefined, [
      shelved({ id: 1, authorFiling: 'McGee, Harold', sortKey: 'MCGEE' }),
      shelved({ id: 2, authorFiling: 'David, Elizabeth', sortKey: 'DAVID' }),
    ]))

    expect(said).toMatch(/David, Elizabeth/)
    expect(said.indexOf('David, Elizabeth')).toBeLessThan(said.indexOf('McGee, Harold'))
  })

  /**
   * And the same books under the ordering being *picked*, before anything is
   * written. That is what makes an edit one tap from a reading page honest: the
   * warning is the books themselves.
   */
  it('reorders them as an ordering is picked, before anything is saved', () => {
    const books = [
      shelved({ id: 1, authorFiling: 'David, Elizabeth', sortKey: 'DAVID', titleFiling: 'Zed' }),
      shelved({ id: 2, authorFiling: 'McGee, Harold', sortKey: 'MCGEE', titleFiling: 'Alpha' }),
    ]
    const said = words(drawn(null, {}, undefined, books, {
      open: true, chosen: 'title', effect: '', busy: false,
    }))

    expect(said.indexOf('Alpha')).toBeLessThan(said.indexOf('Zed'))
  })

  /** The server refuses until this has been shown, and the widget is where. */
  it('carries the sentence the server refused with, above the answer', () => {
    const said = words(drawn(null, {}, undefined, [], {
      open: true,
      chosen: 'title',
      effect: '2 · Cookery would order itself, so nothing overflows into it.',
      busy: false,
    }))

    expect(said).toMatch(/would order itself, so nothing overflows into it/)
    expect(said).toMatch(/Order it that way/)
  })

  it('lists what stands here so each book can say why it is here', () => {
    expect(words(drawn(null, {}, undefined, [shelved()]))).toMatch(/On Food and Cooking/)
  })

  it('counts the books here that no rule claims, which no count shows', () => {
    const said = words(drawn(null, {}, undefined, [
      shelved(),
      shelved({ id: 2, title: 'A Book With No Tags', claimedBy: null }),
    ]))

    expect(said).toMatch(/No rule claims it/)
    // A card title is a sentence, so the number written out starts it in caps.
    expect(said).toMatch(/One book here matches no rule at all/)
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

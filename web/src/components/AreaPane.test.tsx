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
import { RESTING, type Writing } from '../app/writing'
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
  conditions: [
    { operator: 'is', tag: 'Non-fiction', carried: 412 },
    { operator: 'under', tag: 'Cookery', carried: 18 },
  ],
  said: 'Anything tagged Cookery',
  range: 'nonfiction',
  ...over,
})

const area: AreaDto = {
  id: 5, position: 2, label: '2 · Cookery', name: 'Cookery', startsAt: '',
  sortStrategy: 'inherit', ordering: 'author', selfContained: false, note: '',
  books: 18, holds: 'Anything tagged Cookery', entry: true, rule: null, own: [], gone: false,
}

const piece: FixtureDto = {
  id: 2, position: 2, label: '2', kind: 'bookshelf', name: '', sortStrategy: 'inherit',
  note: '', books: 63, areas: [area], sharing: [], gone: [],
  holds: 'Anything tagged Non-fiction', rule: null, own: [],
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
  spine: '',
  spineSlot: '',
  pages: '',
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
  writing: Writing = RESTING,
): string {
  return renderToStaticMarkup(
    <AreaPane
      room={{ ...room, fixtures: [on] }}
      piece={on}
      area={{ ...area, ...over }}
      name={typed ?? over.name ?? area.name}
      books={books}
      writing={writing}
      sorting={sorting}
      asking={asking}
      busy={false}
      error=""
      tabs={{ home: nothing, library: nothing, scan: nothing, queue: nothing }}
      onBack={nothing}
      onLeave={nothing}
      onName={nothing}
      onSaveName={nothing}
      onChange={nothing}
      onCarry={nothing}
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

  /**
   * Two doors and they are not the same door (#384).
   *
   * The loud one changes what this area **allows**, which is what the owner
   * asked for and what four earlier issues told an agent not to build. The
   * quiet one under it moves the whole stretch of books to other furniture,
   * which is #244's journey and is still the only thing that does that. It is
   * named for what it does rather than for the rule it does it to, because a
   * word carrying the rule's name grows with the name: a rule asking for two
   * tags is called "Comic books and Fiction", and "Point Comic books and
   * Fiction somewhere else" was two lines of button saying one thing.
   */
  it('offers changing what belongs here, and moving it elsewhere quietly', () => {
    const markup = drawn(null, { rule: rule(), own: [rule()] })

    expect(words(markup)).toMatch(/Change what belongs here/)
    expect(words(markup)).toMatch(/Move these books to another bookcase/)
    // Nothing is being written, so nothing is under a thumb: one field on the
    // page and it is the name.
    expect(markup.match(/wf-field__input/g)).toHaveLength(1)
    expect(markup).not.toMatch(/wf-write/)
  })

  it('still offers to change what belongs here on a rule it cannot move', () => {
    const said = words(drawn(null, {
      rule: rule({ range: null }), own: [rule({ range: null })],
    }))

    expect(said).not.toMatch(/Move these books to another bookcase/)
    expect(said).toMatch(/is about this one area/)
    /*
     * The two questions came apart here. A rule this app cannot point at other
     * furniture is still a rule whose lines are somebody's to change, and
     * before #384 the refusal was the whole answer: an area rule got a sentence
     * saying no and no way to do the thing they actually wanted.
     */
    expect(said).toMatch(/Change what belongs here/)
  })

  /**
   * #391, and it is the whole of the second defect in it.
   *
   * A plank at the end of a run holds no rule of its own: the run's rule reaches
   * it and the card says so, "Non-fiction, carrying on". The button said "Change
   * what belongs here" and opened an editor holding nothing, because the editor
   * is seeded with the rules written **on the place** and there were none.
   * Somebody read a preview of that empty draft, pressed "Write it down" and was
   * told "Nothing changed about where the books belong", which was true and read
   * as the app losing an afternoon's work.
   *
   * So the word comes from what pressing it opens. There is no rule here to
   * change; writing one is a new thing, and that is what "Say" means.
   */
  it('offers to say what belongs here, not to change it, where the rule is not this area\'s',
    () => {
      const said = words(drawn(null, {
        rule: rule({ id: 9, name: 'Non-fiction', about: 'fixture', placeId: 2, place: '2' }),
        own: [],
      }))

      expect(said).toMatch(/Say what belongs here/)
      expect(said).not.toMatch(/Change what belongs here/)
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

  /**
   * The books stand on a board now rather than in a list (#405).
   *
   * > At the bottom where we say "standing on Bookshelf X" and we show all the
   * > books that are in the area: let's switch that to a shelf view instead of
   * > a list.
   *
   * A spine is a picture, so what it says out loud is a different string from
   * what is written down it: the filing name is printed down the spine because
   * that is what you read walking along a row, and the book's own name is what
   * the target is called for anybody not looking at pixels.
   */
  it('stands the books on a board rather than listing them', () => {
    const markup = drawn(null, {}, undefined, [shelved()])

    expect(markup).toMatch(/wf-shelf__board/)
    expect(markup).toMatch(/aria-label="On Food and Cooking, no photo"/)
    // Printed down the spine, which is not what the spine is called.
    expect(words(markup)).toMatch(/McGee, Harold/)
  })

  /** Every spine is the way into why that book is here, which the rows were. */
  it('makes every book on the board a way into why it is here', () => {
    const markup = drawn(null, {}, undefined, [shelved(), shelved({ id: 2 })])

    expect(markup.match(/<button[^>]*class="wf-spine/g) ?? []).toHaveLength(2)
  })

  /**
   * A board is a picture of a row of books, so it is drawn in the order that
   * row reads. The read answers by filing key, which is the author's, so an
   * area ordered by the year would have drawn a board contradicting the card
   * directly above it.
   */
  it('draws the board in the ordering in force, not in the order it was read', () => {
    const said = words(drawn(null, { ordering: 'published' }, undefined, [
      shelved({ id: 1, authorFiling: 'Acton, Eliza', sortKey: 'ACTON', published: '1990' }),
      shelved({ id: 2, authorFiling: 'Zed, Zoe', sortKey: 'ZED', published: '1845' }),
    ]))

    expect(said.indexOf('Zed, Zoe')).toBeLessThan(said.indexOf('Acton, Eliza'))
  })

  /**
   * An area holding nothing draws an empty board, where the list drew nothing
   * at all. A bare plank with its label on it is the truthful picture of a
   * shelf somebody has cleared and written a rule for, which is the state #392
   * made real: a place can be waiting for its books.
   */
  it('draws an empty board for an area with no books, rather than nothing', () => {
    const markup = drawn(null, { books: 0 }, undefined, [])

    expect(markup).toMatch(/wf-shelf__board/)
    expect(words(markup)).toMatch(/Empty/)
    expect(markup).not.toMatch(/wf-spine/)
  })

  it('counts the books here that no rule claims, and names them', () => {
    const said = words(drawn(null, {}, undefined, [
      shelved(),
      shelved({ id: 2, title: 'A Book With No Tags', claimedBy: null }),
    ]))

    // A card title is a sentence, so the number written out starts it in caps.
    expect(said).toMatch(/One book here matches no rule at all/)
    /*
     * Which one, by name. The list said "No rule claims it" against each row
     * and a board cannot: a spine is a picture of a book and there is nowhere
     * on it to write a fact about a rule.
     */
    expect(said).toMatch(/A Book With No Tags/)
  })
})

/**
 * How the books here are ordered, at the third attempt (#405).
 *
 * > The way that we are representing the sort rule in the widget is not very
 * > understandable at all, to the reader or to the user looking at it.
 *
 * Round nine drew the model: a numbered stack of the three levels an ordering
 * can be settled at, two of which always said "the way the thing above me
 * does", with the deciding one badged. So the loudest line on the card was a
 * pointer and the answer was three rows down.
 *
 * These pin the three questions the card now answers in the order a person
 * arrives with them.
 */
describe('what order the books here are in', () => {
  /** What order they are in. Always a real ordering, never a deferral. */
  it('leads with the ordering itself and never with where it came from', () => {
    const said = words(drawn(null))

    expect(said).toMatch(/By the author/)
    expect(said).not.toMatch(/The way Bookcase 2 does/)
    expect(said).not.toMatch(/This one decides/)
  })

  /** Why: the two ends of the books, said the way the ordering reads. */
  it('says the two ends of the books, in whatever the ordering reads', () => {
    const said = words(drawn(null, {}, undefined, [
      shelved({ id: 1, authorFiling: 'McGee, Harold', sortKey: 'MCGEE' }),
      shelved({ id: 2, authorFiling: 'David, Elizabeth', sortKey: 'DAVID' }),
    ]))

    expect(said).toMatch(/David, Elizabeth\s+to\s+McGee, Harold/)
  })

  /**
   * And why, part two: one sentence naming the place the ordering is really
   * set, which is the place somebody would go to change it. The middle of a
   * chain is not somewhere anybody goes, so an area following a piece that
   * follows the library is told about the library.
   */
  it('names the place the ordering is really set, and not the chain to it', () => {
    const said = words(drawn(null))

    expect(said).toMatch(/Set for the whole library, which Bookcase 2 and this area both follow/)
  })

  it('names the piece where the piece is the one that decides', () => {
    const own = { ...piece, sortStrategy: 'author' as const }
    const said = words(drawn(null, {}, undefined, [], undefined, own))

    expect(said).toMatch(/Set on Bookcase 2, which this area follows/)
  })

  it('names the area itself where the area decides', () => {
    const said = words(drawn(null, { sortStrategy: 'title', selfContained: true, ordering: 'title' }))

    expect(said).toMatch(/Set on this area/)
    expect(said).toMatch(/By the title/)
  })

  /**
   * The consequence, said while the answers are open and before anything is
   * pressed. The server says it again once it has refused a save, and that was
   * the only place it was ever said: somebody learned that ordering an area its
   * own way cuts it off from what overflows into it at the moment the save came
   * back refused.
   */
  it('warns that ordering it its own way stops the overflow, before the press', () => {
    const said = words(drawn(null, { entry: false }, undefined, [], {
      open: true, chosen: 'title', effect: '', busy: false,
    }))

    expect(said).toMatch(/stops taking what overflows from the area before it/)
  })

  /**
   * The card keeps saying what is true while somebody is picking.
   *
   * Found by opening it. What is under a thumb is drawn under "How they would
   * stand"; if the title renamed itself to that as well there would be nothing
   * left on the screen saying what "Leave it as it is" goes back to.
   */
  it('keeps the ordering in force at the top while the answers are open', () => {
    const said = words(drawn(null, {}, undefined, [shelved()], {
      open: true, chosen: 'title', effect: '', busy: false,
    }))

    expect(said).toMatch(/By the author\s+Sort rule/)
    expect(said).toMatch(/How they would stand/)
  })

  /** Nothing overflows into the first area of a stretch whatever it is ordered
      by, so warning about it there would be inventing a consequence. */
  it('says nothing of the sort about an area the books already start in', () => {
    const said = words(drawn(null, { entry: true }, undefined, [], {
      open: true, chosen: 'title', effect: '', busy: false,
    }))

    expect(said).not.toMatch(/stops taking what overflows/)
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

  /**
   * #430 item 4, which looks like a nicety and is a data-loss defect. Somebody
   * typed a name for an area, pressed Back, and it was gone: no prompt, no
   * trace, and nothing anywhere saying it had never been saved.
   *
   * The dialog quotes the word back and names the button that keeps it, because
   * that button is under the field and Back is at the top of the screen, which
   * is the right place for both.
   */
  it('quotes back the name Back was about to throw away', () => {
    const markup = drawn({ kind: 'unsaved' }, {}, 'Cookery')

    expect(title(markup)).toBe('Cookery has not been saved')
    expect(words(markup)).toMatch(/Going back now throws it away/)
    expect(words(markup)).toMatch(/Call it Cookery/)
    expect(words(markup)).toMatch(/Go back without it/)
  })

  /** Clearing a name is a change too, and there is no word to quote. */
  it('still asks where the name was typed out rather than in', () => {
    const markup = drawn({ kind: 'unsaved' }, { name: 'Cookery' }, '')

    expect(title(markup)).toBe('What you typed has not been saved')
    expect(words(markup)).toMatch(/Call it nothing/)
  })

  /** The safe answer is the one a thumb lands on without aiming. */
  it('puts the destructive answer first and the safe one beside it', () => {
    for (const asking of [
      { kind: 'merge', plan: plan() } as Asking,
      { kind: 'only', said: '' } as Asking,
      { kind: 'unsaved' } as Asking,
    ]) {
      const markup = drawn(asking)
      const acts = markup.slice(markup.indexOf('class="wf-sure__acts"'))
      expect(acts).toMatch(/Keep it/)
      expect(acts.indexOf('wf-btn--danger')).toBeLessThan(acts.indexOf('Keep it'))
    }
  })
})

/**
 * Writing the rule, which is what #384 put on this page.
 *
 * Drawn against a `Writing` handed in rather than driven, because there is no
 * DOM in this project's test setup and the pane holds nothing: what it says can
 * therefore be held to a claim. The states that matter are the ones a drawing
 * would skip.
 */
describe('writing what belongs here', () => {
  const writing = (over: Partial<Writing> = {}): Writing => ({
    ...RESTING,
    on: true,
    rules: [{ id: 2, conditions: [{ operator: 'is', tag: 'subject/comic-books' }] }],
    editing: {
      groups: [[{ operator: 'is', tag: 'Comic books' }]],
      choosing: null,
    },
    ...over,
  })

  it('draws the lines with a way to change what each one means', () => {
    const said = words(drawn(null, { rule: rule() }, undefined, [], undefined, piece, writing()))

    expect(said).toMatch(/Comic books/)
    expect(said).toMatch(/That tag/)
    expect(said).toMatch(/That and under it/)
    expect(said).toMatch(/Take it off/)
    expect(said).toMatch(/Add a tag/)
  })

  /**
   * The one way out of the editor that leads anywhere. There is no Save: what
   * makes a rule change safe is that somebody reads what it would do first, and
   * a button that wrote on the spot would be the second answer to where books go
   * that four issues in a row were about.
   */
  it('offers no way to save, only a way to see what would move', () => {
    const said = words(drawn(null, { rule: rule() }, undefined, [], undefined, piece, writing()))

    expect(said).toMatch(/Show me what would move/)
    expect(said).toMatch(/Leave it as it is/)
    expect(said).not.toMatch(/\bSave\b/)
  })

  /**
   * A rule with nothing on it is a real state and it is where somebody halfway
   * through swapping one tag for another is standing. It says which of the two
   * it is, because "all of no conditions hold" is true and the interface has to
   * be the thing that says the model does not read it that way.
   */
  it('says a rule with nothing on it claims nothing', () => {
    const said = words(drawn(
      null, { rule: rule() }, undefined, [], undefined, piece,
      writing({ editing: { groups: [[]], choosing: null } }),
    ))

    expect(said).toMatch(/It asks for nothing, so it claims nothing/)
    expect(said).toMatch(/no book files here until it does/)
  })

  /**
   * "This tag or that tag", which is a second rule on the same place, and both
   * halves come apart again one at a time.
   */
  it('draws a second rule as an alternative, each with its own way off', () => {
    const markup = drawn(
      null, { rule: rule() }, undefined, [], undefined, piece,
      writing({
        editing: {
          groups: [[{ operator: 'is', tag: 'Comic books' }], [{ operator: 'is', tag: 'Poetry' }]],
          choosing: null,
        },
      }),
    )

    expect(markup).toMatch(/wf-or__word/)
    expect(words(markup)).toMatch(/Comic books/)
    expect(words(markup)).toMatch(/Poetry/)
    expect(markup.match(/Take this one off/g)).toHaveLength(2)
    expect(words(markup)).toMatch(/Allow something else as well/)
  })

  /**
   * A tag is drawn by its label and never by its identity, and this is the one
   * screen where the identity is in the room: the draft holds slugs, because
   * slugs are what go back. Held here as well as in the gallery, because the
   * gallery draws a rule somebody made up and this draws one out of a draft.
   */
  it('draws no slug anywhere, while holding one behind every line', () => {
    const markup = drawn(
      null, { rule: rule() }, undefined, [], undefined, piece,
      writing({
        rules: [{ id: 2, conditions: [{ operator: 'is', tag: 'subject/comic-books' }] }],
      }),
    )

    expect(words(markup)).not.toMatch(/[a-z][a-z0-9]*\/[a-z][a-z0-9-]*/)
    expect(words(markup)).toMatch(/Comic books/)
  })

  it('offers the tags it has, with how many books carry each one', () => {
    const said = words(drawn(
      null, { rule: rule() }, undefined, [], undefined, piece,
      writing({
        editing: {
          groups: [[]],
          choosing: {
            group: 0,
            query: 'co',
            offering: [{ tag: 'Comic books', books: 46 }, { tag: 'Cookery', books: 18 }],
          },
        },
      }),
    ))

    expect(said).toMatch(/Which tag has to be on a book/)
    expect(said).toMatch(/Comic books · 46/)
    expect(said).toMatch(/Cookery · 18/)
  })

  /**
   * The plan, which is the only door between editing a rule and a book moving.
   * Every count that matters is on it, and the pinned ones are never a silent
   * subtraction.
   */
  it('draws what would happen, pinned books counted and named', () => {
    const said = words(drawn(
      null, { rule: rule() }, undefined, [], undefined, piece,
      writing({
        plan: {
          groups: [{ from: '2 · Cookery', to: '2B', books: [
            { id: 1, title: 'One', authorFiling: 'A' },
          ] }],
          moving: 1,
          staying: 1147,
          skipped: [{ reason: 'pinned', books: [{ id: 2, title: 'Two', authorFiling: 'B' }] }],
          unclaimed: [{ id: 3, title: 'Three', authorFiling: 'C' }],
          holds: 'Anything tagged Comic books',
          names: ['Comic books'],
          already: 1,
          claiming: 46,
          opens: false,
          losing: [],
          alsoClaims: [],
        },
      }),
    ))

    expect(said).toMatch(/1 book to carry/)
    expect(said).toMatch(/1147\s*stay exactly where they are/)
    expect(said).toMatch(/pinned where they are, which beats every rule/)
    expect(said).toMatch(/Nothing moves until you carry the books yourself/)
    expect(said).toMatch(/Write it down/)
  })

  /**
   * And what applying did, which ends on the work rather than on a tick. The
   * two numbers are never the same number: rows written is not books to carry.
   */
  it('ends on the carry list rather than on a report of success', () => {
    const said = words(drawn(
      null, { rule: rule() }, undefined, [], undefined, piece,
      writing({ on: false, editing: null, applied: { wrote: 29, carrying: 29 } }),
    ))

    expect(said).toMatch(/29 books now belong somewhere else/)
    expect(said).toMatch(/Go and carry them/)
  })
})


/**
 * Preparing a shelf before the books arrive (#392).
 *
 * The usability baseline could not do this at all, and the two halves it needed
 * are both drawings: a word the collection has never used has to be offerable
 * where the rule is written, and the rule it leaves behind has to read as
 * waiting rather than as broken. Held on the pane rather than only in the
 * gallery, because the gallery draws a rule somebody made up and this draws one
 * out of a draft and out of the room the server answered with.
 */
describe('a shelf prepared before its books', () => {
  const writing = (over: Partial<Writing> = {}): Writing => ({
    ...RESTING,
    on: true,
    rules: [{ id: null, conditions: [] }],
    editing: { groups: [[]], choosing: null },
    ...over,
  })

  it('offers to make a word nothing of theirs means, and says where it goes', () => {
    const said = words(drawn(
      null, { rule: rule() }, undefined, [], undefined, piece,
      writing({
        editing: {
          groups: [[]],
          choosing: {
            group: 0,
            query: 'manga',
            offering: [],
            make: { name: 'Manga', where: 'Subject' },
          },
        },
      }),
    ))

    expect(said).toMatch(/Manga/)
    expect(said).toMatch(/New, under Subject/)
    expect(said).toMatch(/a rule can ask for it/)
    // And the wall the baseline hit is gone: nothing tells somebody to go and
    // tag a book first.
    expect(said).not.toMatch(/tag a book with it first/)
  })

  /**
   * Refused, and told why, in the words #377 already refuses in. Being refused
   * without being told why reads as the box being broken, and the second comic
   * book somebody scans making the second comic book tag is the whole thing
   * that rule exists to stop.
   */
  it('says why a second spelling of a word they keep is not offered', () => {
    const said = words(drawn(
      null, { rule: rule() }, undefined, [], undefined, piece,
      writing({
        editing: {
          groups: [[]],
          choosing: {
            group: 0,
            query: 'comic book',
            offering: [{ tag: 'Comic books', books: 46 }],
            make: null,
            said: 'That is the same word to this app as one you already keep, so there is '
              + 'one tag rather than two.',
          },
        },
      }),
    ))

    expect(said).toMatch(/one tag rather than two/)
    expect(said).toMatch(/Comic books · 46/)
  })

  /**
   * The rule as it stands afterwards. Without this line it reads exactly like a
   * rule claiming forty books, and somebody who has cleared a shelf wants to
   * know it is waiting.
   */
  it('says a written rule is waiting where nothing carries its word yet', () => {
    const said = words(drawn(null, {
      holds: 'Anything tagged Manga',
      own: [rule({
        name: 'Manga',
        conditions: [{ operator: 'is', tag: 'Manga', carried: 0 }],
        said: 'Anything tagged Manga',
        range: null,
      })],
    }))

    expect(said).toMatch(/Anything tagged Manga/)
    expect(said).toMatch(/Nothing carries Manga yet, so it claims nothing until something does/)
  })

  /** And says nothing of the sort the moment a book carries it. */
  it('stops saying it once something carries the word', () => {
    const said = words(drawn(null, {
      holds: 'Anything tagged Manga',
      own: [rule({
        name: 'Manga',
        conditions: [{ operator: 'is', tag: 'Manga', carried: 4 }],
        said: 'Anything tagged Manga',
        range: null,
      })],
    }))

    expect(said).not.toMatch(/Nothing carries/)
  })
})

/**
 * #401: an area somebody took out that books are still standing on.
 *
 * This screen answered nothing at all for one, because the read behind it asked
 * for an area on a face and there is no longer one. So the eight books recorded
 * on `4A` after a stretch of books was moved off bookcase 4 had no page anywhere
 * in the app, while the carrying list was telling somebody to go and fetch them.
 *
 * What it draws now is what is true of it: what happened, and the books. Every
 * part it leaves off would be a lie here, and the one that matters is the last
 * one: it cannot be taken out again, and offering that would be a button whose
 * only possible answer is a refusal.
 */
describe('an area that was taken out with books still standing on it', () => {
  const gone = { gone: true, label: '4A', books: 8 }

  it('says it was taken out, and how many books are still recorded there', () => {
    const said = words(drawn(null, gone))
    expect(said).toMatch(/4A was taken out/)
    expect(said).toMatch(/Eight books are still recorded there, on Bookcase 2/)
  })

  it('says nothing has moved and what has to happen before anything does', () => {
    const said = words(drawn(null, gone))
    expect(said).toMatch(/Nothing has moved/)
    expect(said).toMatch(/until you carry them/)
  })

  it('draws the books standing on it, each a way into why it is here', () => {
    const markup = drawn(null, gone, undefined, [
      shelved({ id: 1, title: 'On Food and Cooking' }),
      shelved({ id: 2, title: 'Italian Food', authorFiling: 'David, Elizabeth' }),
    ])

    // The board carries the plank's own label, which is what the heading over
    // the list used to say. One drawing rather than a drawing and a caption.
    expect(words(markup)).toMatch(/4A/)
    expect(markup).toMatch(/aria-label="On Food and Cooking, no photo"/)
    expect(markup).toMatch(/aria-label="Italian Food, no photo"/)
  })

  /* It is already off the piece, so there is nothing on the piece to take off. */
  it('does not offer to remove it', () => {
    expect(words(drawn(null, gone))).not.toMatch(/Remove this area/)
  })

  /*
   * No rule sends books to a place that is not there, nothing overflows into
   * one, and renaming it names nothing. Drawing any of the three would be the
   * screen saying something plainly untrue about somebody's room.
   */
  it('offers none of the things that would be untrue of a place that is gone', () => {
    const said = words(drawn(null, gone))
    expect(said).not.toMatch(/What you call this area/)
    expect(said).not.toMatch(/overflows/)
    expect(said).not.toMatch(/belongs here/i)
  })

  it('says the one book on it in the singular', () => {
    const said = words(drawn(null, { ...gone, books: 1 }))
    expect(said).not.toMatch(/1 books/)
    expect(said).toMatch(/One book is still recorded there/)
  })

  it('leaves an area that is still on its piece exactly as it was', () => {
    expect(words(drawn(null))).toMatch(/Remove this area/)
  })
})

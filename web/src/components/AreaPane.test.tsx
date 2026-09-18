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
      onAskLeave={nothing}
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

  it('offers exactly one destructive thing, and it is the last thing on the page', () => {
    const markup = drawn(null)
    expect(markup.match(/wf-btn--danger/g)).toHaveLength(1)
    expect(words(markup)).toMatch(/Remove this area/)
  })

  it('draws no dashed box around it, and nothing to press after it', () => {
    const markup = drawn(null)

    expect(markup).not.toMatch(/wf-card--quiet/)
    const after = markup.slice(markup.indexOf('wf-btn--danger') + 1)
    expect(after).not.toMatch(/wf-btn wf-btn--/)
  })

  it('does not offer to split the area, which was a screen and is not one', () => {
    expect(words(drawn(null))).not.toMatch(/Split this area/)
  })

  it('offers to keep a name only once the name has been changed', () => {
    expect(words(drawn(null))).not.toMatch(/Call it/)
    expect(words(drawn(null, {}, 'Baking'))).toMatch(/Call it Baking/)
  })

  it('says whether the area takes what overflows into it', () => {
    expect(words(drawn(null, { entry: false })))
      .toMatch(/It takes what overflows from the area before it/)
    expect(words(drawn(null, { entry: true })))
      .toMatch(/The books start here, so nothing overflows into it/)
    expect(words(drawn(null, { selfContained: true, sortStrategy: 'title' })))
      .toMatch(/It orders itself, so nothing overflows into it/)
  })
})

describe('the two rules on an area', () => {
  it('shows what belongs here rather than a way to go and look', () => {
    const said = words(drawn(null, { rule: rule() }))

    expect(said).toMatch(/Anything tagged Cookery/)
    expect(said).toMatch(/Tagged\s*Non-fiction/)
    expect(said).toMatch(/Tagged anything under\s*Cookery/)
    expect(said).not.toMatch(/See what belongs here/)
  })

  it('offers changing what belongs here, and moving it elsewhere quietly', () => {
    const markup = drawn(null, { rule: rule(), own: [rule()] })

    expect(words(markup)).toMatch(/Change what belongs here/)
    expect(words(markup)).toMatch(/Move these books to another bookcase/)
    expect(markup.match(/wf-field__input/g)).toHaveLength(1)
    expect(markup).not.toMatch(/wf-write/)
  })

  it('still offers to change what belongs here on a rule it cannot move', () => {
    const said = words(drawn(null, {
      rule: rule({ range: null }), own: [rule({ range: null })],
    }))

    expect(said).not.toMatch(/Move these books to another bookcase/)
    expect(said).toMatch(/is about this one area/)
    expect(said).toMatch(/Change what belongs here/)
  })

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

  it('shows what the ordering does to these books rather than only naming it', () => {
    const said = words(drawn(null, {}, undefined, [
      shelved({ id: 1, authorFiling: 'McGee, Harold', sortKey: 'MCGEE' }),
      shelved({ id: 2, authorFiling: 'David, Elizabeth', sortKey: 'DAVID' }),
    ]))

    expect(said).toMatch(/David, Elizabeth/)
    expect(said.indexOf('David, Elizabeth')).toBeLessThan(said.indexOf('McGee, Harold'))
  })

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

  it('stands the books on a board rather than listing them', () => {
    const markup = drawn(null, {}, undefined, [shelved()])

    expect(markup).toMatch(/wf-shelf__board/)
    expect(markup).toMatch(/aria-label="On Food and Cooking, no photo"/)
    expect(words(markup)).toMatch(/McGee, Harold/)
  })

  it('makes every book on the board a way into why it is here', () => {
    const markup = drawn(null, {}, undefined, [shelved(), shelved({ id: 2 })])

    expect(markup.match(/<button[^>]*class="wf-spine/g) ?? []).toHaveLength(2)
  })

  it('draws the board in the ordering in force, not in the order it was read', () => {
    const said = words(drawn(null, { ordering: 'published' }, undefined, [
      shelved({ id: 1, authorFiling: 'Acton, Eliza', sortKey: 'ACTON', published: '1990' }),
      shelved({ id: 2, authorFiling: 'Zed, Zoe', sortKey: 'ZED', published: '1845' }),
    ]))

    expect(said.indexOf('Zed, Zoe')).toBeLessThan(said.indexOf('Acton, Eliza'))
  })

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

    expect(said).toMatch(/One book here matches no rule at all/)
    expect(said).toMatch(/A Book With No Tags/)
  })
})

describe('what order the books here are in', () => {
  it('leads with the ordering itself and never with where it came from', () => {
    const said = words(drawn(null))

    expect(said).toMatch(/By the author/)
    expect(said).not.toMatch(/The way Bookcase 2 does/)
    expect(said).not.toMatch(/This one decides/)
  })

  it('says the two ends of the books, in whatever the ordering reads', () => {
    const said = words(drawn(null, {}, undefined, [
      shelved({ id: 1, authorFiling: 'McGee, Harold', sortKey: 'MCGEE' }),
      shelved({ id: 2, authorFiling: 'David, Elizabeth', sortKey: 'DAVID' }),
    ]))

    expect(said).toMatch(/David, Elizabeth\s+to\s+McGee, Harold/)
  })

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

  it('warns that ordering it its own way stops the overflow, before the press', () => {
    const said = words(drawn(null, { entry: false }, undefined, [], {
      open: true, chosen: 'title', effect: '', busy: false,
    }))

    expect(said).toMatch(/stops taking what overflows from the area before it/)
  })

  it('keeps the ordering in force at the top while the answers are open', () => {
    const said = words(drawn(null, {}, undefined, [shelved()], {
      open: true, chosen: 'title', effect: '', busy: false,
    }))

    expect(said).toMatch(/By the author\s+Sort rule/)
    expect(said).toMatch(/How they would stand/)
  })

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

  it('draws the labels that read differently rather than describing them', () => {
    const markup = drawn({ kind: 'merge', plan: plan({
      becomes: [{ from: '2 · Cookery', to: '2B' }, { from: '2D', to: '2C' }],
    }) })
    expect(markup).toMatch(/wf-sure__becomes/)
    expect(words(markup)).toMatch(/2 · Cookery\s*becomes\s*2B/)
    expect(words(markup)).toMatch(/2D\s*becomes\s*2C/)
  })

  it('names every book it is leaving alone, and why', () => {
    const said = words(drawn({ kind: 'merge', plan: plan({
      joining: 15, skipped: [{ reason: 'pinned', books: 3 }],
    }) }))
    expect(said).toMatch(/15 books will be filed under 2B/)
    expect(said).toMatch(/3 books pinned where they are, which beats every rule/)
  })

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

  it('does not say "its 0 books" about an empty area', () => {
    const markup = drawn({ kind: 'merge', plan: plan({
      area: { id: 5, label: '2 · Cookery', books: 0 }, joining: 0,
    }) })
    expect(title(markup)).toBe('No books stand in 2 · Cookery')
    expect(words(markup)).toMatch(/No book has to be refiled/)
  })

  it('offers the piece itself where the area is the only one on it', () => {
    const markup = drawn({ kind: 'only', said: 'It is the only area on the piece.' })
    expect(title(markup)).toBe('Its 18 books have nowhere else on the bookcase 2')
    expect(words(markup)).toMatch(/Deleting the bookcase 2 moves them to other furniture/)
    expect(words(markup)).toMatch(/Take the bookcase 2 out of the room/)
  })

  it('quotes back the name Back was about to throw away', () => {
    const markup = drawn({ kind: 'unsaved' }, {}, 'Cookery')

    expect(title(markup)).toBe('Cookery has not been saved')
    expect(words(markup)).toMatch(/Going back now throws it away/)
    expect(words(markup)).toMatch(/Call it Cookery/)
    expect(words(markup)).toMatch(/Go back without it/)
  })

  it('still asks where the name was typed out rather than in', () => {
    const markup = drawn({ kind: 'unsaved' }, { name: 'Cookery' }, '')

    expect(title(markup)).toBe('What you typed has not been saved')
    expect(words(markup)).toMatch(/Call it nothing/)
  })

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

  it('offers no way to save, only a way to see what would move', () => {
    const said = words(drawn(null, { rule: rule() }, undefined, [], undefined, piece, writing()))

    expect(said).toMatch(/Show me what would move/)
    expect(said).toMatch(/Leave it as it is/)
    expect(said).not.toMatch(/\bSave\b/)
  })

  it('says a rule with nothing on it claims nothing', () => {
    const said = words(drawn(
      null, { rule: rule() }, undefined, [], undefined, piece,
      writing({ editing: { groups: [[]], choosing: null } }),
    ))

    expect(said).toMatch(/It asks for nothing, so it claims nothing/)
    expect(said).toMatch(/no book files here until it does/)
  })

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

  it('ends on the carry list rather than on a report of success', () => {
    const said = words(drawn(
      null, { rule: rule() }, undefined, [], undefined, piece,
      writing({ on: false, editing: null, applied: { wrote: 29, carrying: 29 } }),
    ))

    expect(said).toMatch(/29 books now belong somewhere else/)
    expect(said).toMatch(/Go and carry them/)
  })
})

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
    expect(said).not.toMatch(/tag a book with it first/)
  })

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

    expect(words(markup)).toMatch(/4A/)
    expect(markup).toMatch(/aria-label="On Food and Cooking, no photo"/)
    expect(markup).toMatch(/aria-label="Italian Food, no photo"/)
  })

  it('does not offer to remove it', () => {
    expect(words(drawn(null, gone))).not.toMatch(/Remove this area/)
  })

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

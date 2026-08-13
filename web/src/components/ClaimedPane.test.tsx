/**
 * What the two rule screens say, held to a claim rather than only looked at.
 *
 * Rendered as markup the way `CarryPane.test.tsx` does it: this project has no
 * DOM in its test setup and neither screen holds state.
 *
 * Three things here are the ones that come back wrong. **A book no rule claims**
 * is a real state since #304 and is the first thing either screen has to
 * survive; it is invisible from every count, so a screen that quietly drew
 * nothing would look like it was working. **A losing rule** is the whole reason
 * the claim screen exists, so a version that showed only the winner would be
 * answering half the question. And **the way to change a rule** is offered only
 * where this app can honestly change one, because a button that would refuse is
 * worse than no button.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { BelongsPane } from './BelongsPane'
import { ClaimedPane } from './ClaimedPane'
import type {
  AreaBook, AreaDto, BookClaim, FixtureDto, FurnitureDto, RuleClaim, RuleDto,
} from '../lib/api'

const tabs = { home: () => {}, library: () => {}, scan: () => {}, queue: () => {} }

/** The words on the screen, with the markup and the class names gone. */
const words = (markup: string) => markup.replace(/<[^>]*>/g, ' ')

const rule = (over: Partial<RuleDto> = {}): RuleDto => ({
  id: 2,
  name: 'Non-fiction',
  about: 'fixture',
  place: '4',
  placeId: 40,
  enabled: true,
  conditions: [{ operator: 'is', tag: 'Non-fiction' }],
  said: 'Anything tagged Non-fiction',
  range: 'nonfiction',
  ...over,
})

const claimed = (over: Partial<RuleClaim> = {}): RuleClaim => ({
  rule: rule(),
  won: true,
  why: 'It asks for a tag this book has, and nothing about a smaller place does.',
  ...over,
})

const claim = (over: Partial<BookClaim> = {}): BookClaim => ({
  book: { id: 7, title: 'Salt Fat Acid Heat', authorFiling: 'Nosrat, Samin' },
  standing: { areaId: 41, label: '4B' },
  wanted: { areaId: 41, label: '4B' },
  claims: [claimed()],
  tags: ['Non-fiction', 'Cookery'],
  pinned: false,
  checkedOut: false,
  withdrawn: false,
  ...over,
})

const why = (over: Partial<BookClaim> = {}): string =>
  renderToStaticMarkup(ClaimedPane({
    claim: claim(over),
    room: room(),
    error: '',
    tabs,
    onBack: () => {},
    onRule: () => {},
  }) as ReactElement)

const area = (over: Partial<AreaDto> = {}): AreaDto => ({
  id: 41,
  position: 1,
  label: '4B',
  name: '',
  startsAt: 'davis',
  sortStrategy: 'inherit',
  ordering: 'author',
  selfContained: false,
  note: '',
  books: 3,
  holds: 'Non-fiction, carrying on',
  entry: false,
  rule: rule(),
  ...over,
})

const piece = (over: Partial<FixtureDto> = {}): FixtureDto => ({
  id: 40,
  position: 4,
  label: '4',
  kind: 'bookshelf',
  name: '',
  sortStrategy: 'inherit',
  note: '',
  books: 3,
  areas: [area()],
  sharing: [],
  holds: 'Anything tagged Non-fiction',
  rule: rule(),
  ...over,
})

const room = (): FurnitureDto => ({
  fixtures: [piece()],
  defaultSortStrategy: 'author',
  strategies: [],
})

const shelved = (id: number, title: string, claimedBy: string | null): AreaBook =>
  ({ id, title, authorFiling: `Author ${id}`, sortKey: `k${id}`, claimedBy })

const belongs = (over: Partial<Parameters<typeof BelongsPane>[0]> = {}): string =>
  renderToStaticMarkup(BelongsPane({
    room: room(),
    piece: piece(),
    area: area(),
    books: [shelved(1, 'On Food and Cooking', 'Non-fiction')],
    error: '',
    tabs,
    onBack: () => {},
    onChange: () => {},
    onClaimed: () => {},
    ...over,
  }) as ReactElement)

describe('why a book is here', () => {
  it('names the rule that claimed it and where the book stands', () => {
    const said = words(why())

    expect(said).toContain('It is on 4B because of the rule called Non-fiction')
    expect(said).toContain('4B')
  })

  it('draws the rule that lost as well as the one that won', () => {
    const html = why({
      claims: [
        claimed({ rule: rule({ id: 3, name: 'Cookery', about: 'area', place: '4B' }) }),
        claimed({
          won: false,
          why: 'It fits too, but a rule about one area beats a rule about a whole piece of furniture.',
        }),
      ],
    })

    expect(html.match(/class="wf-claim[ "]/g) ?? []).toHaveLength(2)
    expect(words(html)).toContain('Claimed it')
    expect(words(html)).toContain('Not this one')
    expect(words(html)).toContain('beats a rule about a whole piece of furniture')
  })

  it('survives a book no rule claims at all, and says so out loud', () => {
    const html = why({ claims: [], wanted: null, tags: [] })

    expect(words(html)).toContain('No rule claims this book')
    expect(words(html)).toContain('a book carrying none matches nothing')
    // Nothing to open, because there is no rule to open.
    expect(html).not.toContain('wf-claim')
  })

  it('says a pin beats the rule that would otherwise have had it', () => {
    const html = why({ pinned: true, wanted: { areaId: 30, label: '3A' } })

    expect(words(html)).toContain('You pinned it to 4B')
    expect(words(html)).toContain('beats every rule')
    // The rule is still drawn: hiding it leaves nobody able to see what the
    // pin is overruling.
    expect(html).toContain('wf-claim')
  })

  it('says why the book is on the carry list when the two disagree', () => {
    expect(words(why({ wanted: { areaId: 30, label: '3A' } })))
      .toContain('The rules want it on 3A, and it was last seen on 4B')
  })

  it('draws a tag by its label and never by its slug', () => {
    expect(words(why())).not.toMatch(/\bgenre\/[a-z-]+/)
  })

  /**
   * A rule about a whole piece of furniture carries `4` as its place, because
   * that is the piece's label. Nobody says "the rule about 4", and the fix is
   * not on the wire: the piece knows it is called Bookcase 4, so it is asked.
   * Found by opening the screen and reading it.
   */
  it('names a piece of furniture the way a person does, not by its number', () => {
    const said = words(why())

    expect(said).toContain('The one about Bookcase 4 won')
    expect(said).toContain('About the whole of Bookcase 4')
    expect(said).not.toContain('the whole of 4 ')
  })
})

describe('what belongs here', () => {
  it('offers to point the rule somewhere else when the app can', () => {
    expect(words(belongs())).toContain('Point Non-fiction somewhere else')
  })

  it('offers nothing of the sort for a rule it cannot point anywhere', () => {
    const only = rule({ about: 'area', place: '4B', placeId: 41, range: null })
    const html = belongs({
      piece: piece({ rule: only, areas: [area({ rule: only })] }),
      area: area({ rule: only }),
    })

    // No target at all, rather than one that would be refused. The sentence
    // saying so is what a person gets instead.
    expect(html).not.toContain('wf-btn--primary')
    expect(words(html)).toContain('cannot be pointed somewhere else yet')
  })

  it('lists what stands here so each book can say why it is here', () => {
    expect(words(belongs())).toContain('On Food and Cooking')
  })

  it('counts the books here that no rule claims, which no count shows', () => {
    const said = words(belongs({
      books: [
        shelved(1, 'On Food and Cooking', 'Non-fiction'),
        shelved(2, 'A Book With No Tags', null),
      ],
    }))

    expect(said).toContain('No rule claims it')
    // A card title is a sentence, so the number written out starts it in caps.
    expect(said).toContain('One book here matches no rule at all')
  })
})

/**
 * What the screen that says why a book is here says, held to a claim rather
 * than only looked at.
 *
 * Rendered as markup the way `CarryPane.test.tsx` does it: this project has no
 * DOM in its test setup and the screen holds no state.
 *
 * Two things here are the ones that come back wrong. **A book no rule claims**
 * is a real state since #304 and is the first thing this screen has to survive;
 * it is invisible from every count, so a screen that quietly drew nothing would
 * look like it was working. **A losing rule** is the whole reason this screen
 * exists, so a version that showed only the winner would be answering half the
 * question.
 *
 * **What belongs here used to be checked from this file** and is now checked in
 * `AreaPane.test.tsx`, because the screen that answered it is gone (#381): the
 * area's own page says what belongs on it, which is where the door to changing
 * a rule now lives too.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { ClaimedPane } from './ClaimedPane'
import type {
  AreaDto, BookClaim, FixtureDto, FurnitureDto, RuleClaim, RuleDto,
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
  conditions: [{ operator: 'is', tag: 'Non-fiction', carried: 412 }],
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
    /* Saying what the book is (#341). What that opens is `SayingPane` and its
       own file checks it; what this file is about is when the way in is drawn
       at all. */
    onSay: () => {},
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
  own: [],
  gone: false,
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
  sharing: [], gone: [],
  holds: 'Anything tagged Non-fiction',
  rule: rule(),
  own: [rule()],
  ...over,
})

const room = (): FurnitureDto => ({
  fixtures: [piece()],
  defaultSortStrategy: 'author',
  strategies: [],
})

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

  /*
   * #341's complaint about this screen, in one check each way round.
   *
   * "The claim screen offers an unclaimed book no action at all." Every other
   * state here offers something, and the way this regresses is not somebody
   * deleting the card: it is somebody drawing it for a book that already has a
   * rule, where the actions are opening that rule and pinning the book, and the
   * screen would then be offering three things for one decision.
   */
  it('offers an unclaimed book something to do, which it never used to', () => {
    const said = words(why({ claims: [], wanted: null, tags: [] }))

    expect(said).toContain('Say what it is')
    expect(said).toContain('Nobody has said anything about it')
  })

  it('names the other repair for a book carrying a tag no rule asks for', () => {
    // The two unclaimed states are not one, and the sentence is not the same:
    // somebody has already said this book is Crime, so telling it that it is
    // also Fiction is the wrong answer and a rule about Crime is the right one.
    const said = words(why({ claims: [], wanted: null, tags: ['Crime'] }))

    expect(said).toContain('A rule about Crime would take them all')
    expect(said).not.toContain('Nobody has said anything about it')
  })

  it('offers it to nobody for a book that already has a rule', () => {
    expect(words(why())).not.toContain('Say what it is')
  })

  it('offers it to nobody for a book that has left the collection', () => {
    // A withdrawn book is unclaimed by design, which the sentence above already
    // says. Inviting somebody to classify a book they no longer own is the row
    // that teaches people to ignore this screen.
    const said = words(why({ claims: [], wanted: null, tags: [], withdrawn: true }))

    expect(said).toContain('It has left the collection')
    expect(said).not.toContain('Say what it is')
  })

  it('opens that on a screen of its own rather than writing a tag here', () => {
    // This screen explains a claim. A box to type a tag into on it would be a
    // second place a tag can be applied from, and the one that got the next fix
    // would be whichever screen somebody happened to be looking at.
    const html = why({ claims: [], wanted: null, tags: [] })

    expect(html).not.toContain('wf-name')
    expect(html).not.toContain('wf-field')
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

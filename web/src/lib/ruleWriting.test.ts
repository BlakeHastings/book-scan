/**
 * The arithmetic and the wording behind writing a rule, checked here rather
 * than driven through two screens.
 *
 * These are the cases a drawing cannot show: a vocabulary of four hundred
 * narrowed by two letters, a change that would leave a stretch of books with
 * nothing anchoring it, and a count of assignments written that is not the same
 * number as the books somebody has to carry.
 */

import { describe, expect, it } from 'vitest'
import {
  draftHolds, leaving, linesSaid, movesOf, noteOf, offering, saidRules, slugFor, wroteSaid,
} from './ruleWriting'
import type { RuleChangePlan, RuleDto, TagRow } from './api'

const tag = (slug: string, label: string, books = 0): TagRow =>
  ({ slug, label, note: '', books })

const vocabulary: TagRow[] = [
  tag('subject/comic-books', 'Comic books', 46),
  tag('subject/cookery', 'Cookery', 18),
  tag('subject/economics', 'Economics', 22),
  tag('genre/fiction', 'Fiction', 740),
  tag('subject/poetry', 'Poetry', 41),
  tag('subject/second-world-war', 'Second World War', 31),
]

describe('the tags a rule can be given', () => {
  /**
   * Matched anywhere in the label rather than at the front. Somebody who has to
   * remember how a tag begins is somebody scrolling a vocabulary instead, and
   * "Second World War" is exactly the tag a person looks for by its middle.
   */
  it('narrows on the letters wherever they fall in the word', () => {
    expect(offering(vocabulary, 'co', []).map((one) => one.tag))
      .toEqual(['Comic books', 'Cookery', 'Economics', 'Second World War'])
  })

  it('leaves out the tags already on the rule', () => {
    expect(offering(vocabulary, 'co', ['subject/cookery']).map((one) => one.tag))
      .toEqual(['Comic books', 'Economics', 'Second World War'])
  })

  /**
   * The count travels with the word, and it is what makes the choice a
   * decision. A tag forty books carry and a tag nothing carries are different
   * answers to "what should belong here", and the word alone does not say which
   * of the two somebody is about to pick.
   */
  it('carries how many books each one has', () => {
    expect(offering(vocabulary, 'poetry', [])).toEqual([{ tag: 'Poetry', books: 41 }])
  })

  it('offers everything it has when nothing has been typed, up to the cap', () => {
    expect(offering(vocabulary, '   ', [])).toHaveLength(6)
    expect(offering(vocabulary, '', [], 2).map((one) => one.tag))
      .toEqual(['Comic books', 'Cookery'])
  })

  it('finds the identity behind a word, which is what goes back', () => {
    expect(slugFor(vocabulary, 'Comic books')).toBe('subject/comic-books')
    expect(slugFor(vocabulary, 'Nothing like this')).toBeNull()
  })

  /**
   * One direction only. The slug is what the rule is about and the label is
   * what a person reads; a slug that reached a screen would be the same mistake
   * as showing somebody a row id.
   */
  it('names a line by its label and never by its identity', () => {
    expect(linesSaid(vocabulary, [{ operator: 'under', tag: 'genre/fiction' }]))
      .toEqual([{ operator: 'under', tag: 'Fiction' }])
  })
})

describe('the phrase at the top of what belongs here', () => {
  it('says nothing files here for a place with no rules', () => {
    expect(draftHolds(vocabulary, [])).toBe('Nothing files here yet')
  })

  it('joins the lines of one rule with "and"', () => {
    expect(draftHolds(vocabulary, [{
      id: null,
      conditions: [
        { operator: 'is', tag: 'subject/comic-books' },
        { operator: 'is', tag: 'genre/fiction' },
      ],
    }])).toBe('Anything tagged Comic books and tagged Fiction')
  })

  /**
   * And joins two rules with "or", which is the whole of what alternation is
   * here. One sentence about one place, rather than a list headed "rule 1 of 2".
   */
  it('joins two rules on one place with "or"', () => {
    expect(draftHolds(vocabulary, [
      { id: 1, conditions: [{ operator: 'is', tag: 'subject/comic-books' }] },
      { id: null, conditions: [{ operator: 'under', tag: 'subject/poetry' }] },
    ])).toBe('Anything tagged Comic books, or anything tagged under Poetry')
  })

  it('says a rule with no lines claims nothing, even beside one that does', () => {
    expect(draftHolds(vocabulary, [
      { id: 1, conditions: [{ operator: 'is', tag: 'subject/poetry' }] },
      { id: null, conditions: [] },
    ])).toBe('Anything tagged Poetry, or nothing files here yet')
  })

  it('draws a rule the same way whether it is a row yet or not', () => {
    const written: RuleDto = {
      id: 3,
      name: 'Poetry',
      about: 'area',
      place: '2B',
      placeId: 5,
      enabled: true,
      conditions: [{ operator: 'is', tag: 'Poetry' }],
      said: 'Anything tagged Poetry',
      range: null,
    }
    expect(saidRules([written]))
      .toEqual([{ name: 'Poetry', lines: written.conditions, enabled: true }])
  })
})

const plan = (over: Partial<RuleChangePlan> = {}): RuleChangePlan => ({
  groups: [],
  moving: 0,
  staying: 0,
  skipped: [],
  unclaimed: [],
  holds: 'Anything tagged Poetry',
  names: ['Poetry'],
  claiming: 41,
  opens: false,
  losing: [],
  ...over,
})

const book = (id: number) => ({ id, title: `Title ${id}`, authorFiling: 'Author' })

describe('what a change comes to', () => {
  /**
   * The biggest moves first and the rest counted. A hundred and one lines is
   * not something anybody reads standing in a room, and the books themselves
   * are named a screen later, on the trip they belong to.
   */
  it('draws the biggest moves and counts the others', () => {
    const groups = [
      { from: '2A', to: '2B', books: [book(1)] },
      { from: '2C', to: '2A', books: [book(2), book(3), book(4)] },
      { from: '4A', to: '2A', books: [book(5), book(6)] },
    ]

    expect(movesOf(plan({ groups }), 2)).toEqual({
      moving: [
        { from: '2C', to: '2A', books: 3 },
        { from: '4A', to: '2A', books: 2 },
      ],
      more: 1,
    })
  })

  /**
   * Nothing is quietly left out. A change that said "84 books move" having left
   * three pinned ones out of the eighty-four would be believed, and the person
   * would come back from the furniture three books short.
   */
  it('names every book the rules will not touch, with the reason', () => {
    expect(leaving([
      { reason: 'pinned', books: [book(1), book(2)] },
      { reason: 'checked-out', books: [book(3)] },
      { reason: 'withdrawn', books: [] },
    ])).toEqual([
      { said: 'pinned where they are, which beats every rule', books: 2 },
      { said: 'checked out, so they are not standing here to be refiled', books: 1 },
    ])
  })

  /**
   * The consequence a count cannot carry: an area a rule points at begins a
   * stretch, so it stops taking overflow **and** the areas after it come with
   * it. The second half was found by running it against a real room.
   */
  it('says what an area gaining its first rule does to the ones after it', () => {
    const said = noteOf(plan({ opens: true }))

    expect(said).toMatch(/stops taking what overflows/)
    expect(said).toMatch(/areas after it on the same piece come with it/)
  })

  it('says when a stretch of books would be left with nothing anchoring it', () => {
    expect(noteOf(plan({ losing: ['nonfiction'] })))
      .toMatch(/Nothing would file non-fiction any more/)
  })

  it('says when the rules would claim no book at all', () => {
    expect(noteOf(plan({ claiming: 0 })))
      .toMatch(/No book in the collection carries all of these/)
  })

  it('says nothing where there is nothing to add to the counts', () => {
    expect(noteOf(plan())).toBe('')
  })

  /**
   * Two numbers that are never the same number. `wrote` is rows saying where
   * the rules want a book; a second apply of the same change writes none of them
   * and still leaves the same books to carry.
   */
  it('reports what was written rather than what has to be carried', () => {
    expect(wroteSaid(29)).toBe('29 books now belong somewhere else.')
    expect(wroteSaid(1)).toBe('1 book now belongs somewhere else.')
    expect(wroteSaid(0)).toBe('Nothing changed about where the books belong.')
  })
})

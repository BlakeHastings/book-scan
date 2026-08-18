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
  draftHolds, leaving, linesSaid, making, movesOf, noteOf, offering, saidRules, slugFor,
  wroteSaid,
} from './ruleWriting'
import { waitingSaid } from '../design/Rules'
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
      .toEqual([{ operator: 'under', tag: 'Fiction', carried: 740 }])
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
      conditions: [{ operator: 'is', tag: 'Poetry', carried: 9 }],
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
  already: 1,
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
   * #391's second half. A rule nothing carries and no rule at all were given the
   * same sentence, so somebody who opened the editor on a plank that files by
   * overflow, added nothing and asked what would move read "No book in the
   * collection carries all of these" about lines that did not exist. Writing it
   * down then answered "Nothing changed about where the books belong", which was
   * true, and read as their work being lost.
   */
  it('tells a draft that is not a change from a rule that claims nothing', () => {
    const said = noteOf(plan({ names: [], already: 0, claiming: 0 }))

    expect(said).toMatch(/no rule here to write/)
    expect(said).toMatch(/writing it down would change nothing/)
    expect(said).not.toMatch(/carries all of these/)
  })

  /** The other empty draft, which is taking the last rule off and is a change. */
  it('says what taking the last rule off a place does', () => {
    const said = noteOf(plan({ names: [], already: 1, claiming: 0 }))

    expect(said).toMatch(/Nothing would file here by rule any more/)
    expect(said).toMatch(/overflows from the area before it/)
    expect(said).not.toMatch(/no rule here to write/)
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


/**
 * Naming a word where the rule is written (#392).
 *
 * The decision itself is `domain/tagging/naming.ts` and it has its own tests;
 * what is checked here is the half this file owns, which is turning its four
 * answers into a drawing without inventing a fifth.
 */
describe('a word the collection has never used', () => {
  it('offers to make one, under the collection\'s own heading', () => {
    const { make, slug, said } = making(vocabulary, 'Manga', [])
    expect(make).toEqual({ name: 'Manga', where: 'Subject' })
    expect(slug).toBe('subject/manga')
    // Nothing under the box: the offer says both halves of it already, and both
    // sentences were on screen together until it was looked at.
    expect(said).toBe('')
  })

  /**
   * The one thing this must not become is a second way to make a tag.
   *
   * "Comic Book" and "comic books" are one tag to this app, so a rule may not
   * make the second of them, and being refused without being told why reads as
   * the box being broken.
   */
  it('refuses a second spelling and says which word it already means', () => {
    const { make, said } = making(vocabulary, 'comic book', [])
    expect(make).toBeNull()
    expect(said).toMatch(/one tag rather than two/)
  })

  /** #304: those two are stated on a book, and typing the word is not stating it. */
  it('sends the two genre answers back to the tags there already are', () => {
    const { make, said } = making(vocabulary, 'fiction', [])
    expect(make).toBeNull()
    expect(said).toMatch(/Fiction and non-fiction/)
  })

  /** A word spelled exactly as a tag already is needs no sentence: it is listed. */
  it('says nothing where the word is one of theirs, spelled their way', () => {
    expect(making(vocabulary, 'Poetry', [])).toEqual({ make: null, slug: null, said: '' })
  })

  /**
   * A word named on the first rule of an "or" is vocabulary for the second.
   *
   * Without this the picker would offer to make it again and the two lines
   * would then disagree about which tag they meant, which is the two-spellings
   * defect arriving inside one draft.
   */
  it('will not make a word this draft has already named', () => {
    const drafted = [{ tag: 'subject/manga', label: 'Manga' }]
    expect(making(vocabulary, 'Manga', drafted).make).toBeNull()
  })

  /**
   * One word said twice on purpose is not a duplicate.
   *
   * "Tagged Comics and Fiction, or tagged Comics and Poetry" is two rules that
   * share a tag, and the picker narrows by the lines on the rule being written
   * rather than by the place's, or the second half of an "or" is unwritable.
   */
  it('still offers a tag another rule on the place already names', () => {
    expect(offering(vocabulary, 'comic', ['subject/poetry']).map((one) => one.tag))
      .toEqual(['Comic books'])
  })

  /**
   * A tag they keep under another spelling is offered, not hidden.
   *
   * "comic books" typed against a tag labelled "Comic Book" is a substring of
   * nothing, so matching the label alone offered no tag and an offer to make a
   * second one. The fold that answers that on a book answers it here.
   */
  it('offers the tag a near spelling means, first', () => {
    const theirs: TagRow[] = [tag('subject/comic-book', 'Comic Book', 46), ...vocabulary.slice(1)]
    expect(offering(theirs, 'comic books', []).map((one) => one.tag)).toContain('Comic Book')
    expect(offering(theirs, 'comic books', [])[0]!.tag).toBe('Comic Book')
  })
})

/**
 * A shelf somebody prepared before the books arrived, said in one line.
 *
 * The wording is the empty rule's own clause, deliberately: "so it claims
 * nothing" is already how this widget says a rule is a real state rather than a
 * fault, and this is the neighbouring case with one word added.
 */
describe('a rule waiting on a word nothing carries', () => {
  it('names the word, and ends the way the empty rule ends', () => {
    expect(waitingSaid([{ operator: 'is', tag: 'Manga', carried: 0 }]))
      .toBe('Nothing carries Manga yet, so it claims nothing until something does.')
  })

  it('names every one of them, because every line has to hold', () => {
    expect(waitingSaid([
      { operator: 'is', tag: 'Manga', carried: 0 },
      { operator: 'is', tag: 'Comic books', carried: 46 },
      { operator: 'is', tag: 'Zines', carried: 0 },
    ])).toBe('Nothing carries Manga or Zines yet, so it claims nothing until something does.')
  })

  /** Silent where the count was never asked for. A screen may not invent a fact. */
  it('says nothing at all where nothing is waiting, and where nobody counted', () => {
    expect(waitingSaid([{ operator: 'is', tag: 'Poetry', carried: 41 }])).toBe('')
    expect(waitingSaid([{ operator: 'is', tag: 'Poetry' }])).toBe('')
  })

  /**
   * The draft's own word reads back as the word rather than as the slug.
   *
   * A line naming a tag that is not a row yet has no label in the vocabulary,
   * and the fallback is the slug, which is a bug worth seeing. So the label
   * rides with the line until the write.
   */
  it('draws a word being named by the word, and counts it as carried by nothing', () => {
    expect(linesSaid(vocabulary, [{ operator: 'is', tag: 'subject/manga', label: 'Manga' }]))
      .toEqual([{ operator: 'is', tag: 'Manga', carried: 0 }])
  })
})

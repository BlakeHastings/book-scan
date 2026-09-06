/**
 * Settings, which had to be a screen that changes real things and not a page of
 * switches.
 *
 * Three kinds of check, and each is a different way this screen goes wrong.
 *
 * **It offers what a collection can actually be ordered by, and no more.** The
 * area's ordering screen offers five; two of those cannot apply to a whole
 * collection and the server refuses both. A screen offering a choice the server
 * refuses is a control that fails when it is used, which is worse than one that
 * is not there.
 *
 * **It draws what is stored rather than what was last pressed.** A settings
 * screen showing the wrong current value is the one defect that makes every
 * other thing on it untrustworthy, and it is the one that arrives the day
 * somebody optimises the re-read away.
 *
 * **It promises no account.** The corner above it is a profile icon now, and
 * the owner's instruction was explicit: no sign-in, no sign-out, no account
 * name, and nothing greyed out and labelled coming soon. That is the kind of
 * thing a helpful edit adds in six months, so it is checked as words rather
 * than described in a comment.
 *
 * Rendered as markup rather than driven in a browser, the way
 * `HomePane.test.tsx` does it: this project has no DOM in its test setup and
 * this pane holds no state.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SettingsPane } from './SettingsPane'
import type {
  FurnitureDto, LookupStandings, SortStrategyCode, SourceStanding,
} from '../lib/api'
import type { FirstPicture } from '../design/Shots'
import type { Hand } from '../design/Camera'
import type { TabName } from '../design/Chrome'

const tabs: Record<TabName, () => void> = {
  home: () => {}, library: () => {}, scan: () => {}, queue: () => {},
}

/** The room, with only the one value this screen is about filled in. */
function room(defaultSortStrategy: SortStrategyCode = 'author'): FurnitureDto {
  return {
    fixtures: [],
    defaultSortStrategy,
    strategies: [
      { code: 'inherit', label: 'Same as the shelf it is on', isInherit: true },
      { code: 'author', label: 'Author', isInherit: false },
      { code: 'title', label: 'Title', isInherit: false },
      { code: 'published', label: 'Year published', isInherit: false },
      { code: 'tag', label: 'Tag', isInherit: false },
    ],
  }
}

/** One catalogue at nought. */
function catalogue(over: Partial<SourceStanding> & { source: string }): SourceStanding {
  return {
    asked: 0, answered: 0, silent: 0, held: 0, noRecord: 0,
    declined: 0, failed: 0, skipped: 0, lastSilentAt: '', lastSilence: '',
    ...over,
  }
}

/** The four catalogues, in the state a test puts them in (#348). */
function catalogues(
  over: Partial<Record<string, Partial<SourceStanding>>> = {},
  googleBooksKeyConfigured = true,
): LookupStandings {
  return {
    googleBooksKeyConfigured,
    sources: ['Open Library', 'Google Books', 'Library of Congress', 'K10plus']
      .map((source) => catalogue({ source, ...(over[source] ?? {}) })),
  }
}

function drawn(over: {
  room?: FurnitureDto | null
  hand?: Hand
  firstPicture?: FirstPicture
  busy?: boolean
  error?: string
  lookups?: LookupStandings | null
} = {}): string {
  return renderToStaticMarkup(
    <SettingsPane
      room={over.room === undefined ? room() : over.room}
      hand={over.hand ?? 'right'}
      firstPicture={over.firstPicture ?? 'catalogue'}
      busy={over.busy ?? false}
      error={over.error ?? ''}
      tabs={tabs}
      lookups={over.lookups === undefined ? catalogues() : over.lookups}
      onBack={() => {}}
      onOrder={() => {}}
      onHand={() => {}}
      onFirstPicture={() => {}}
    />,
  )
}

/** The words on the screen, with the markup and therefore the class names gone. */
const words = (markup: string): string => markup.replace(/<[^>]*>/g, ' ')

/**
 * One segmented control, by the name it carries.
 *
 * There are two of them on this screen now, one per answer the phone
 * remembers, so "exactly one option is marked" has to be asked of a control
 * rather than of the page. Asking it of the page passed while there was one
 * and would pass again on a screen where one control had both options lit and
 * the other had none.
 */
function segmented(markup: string, label: string): string {
  const found = markup.match(
    new RegExp(`<div class="wf-seg" role="group" aria-label="${label}">.*?</div>`, 's'),
  )
  expect(found, `there is no control called "${label}"`).not.toBeNull()
  return found![0]
}

describe('how your books are ordered', () => {
  it('offers the three a whole collection can take, in this app words', () => {
    const said = words(drawn())

    expect(said).toMatch(/By the author/)
    expect(said).toMatch(/By the title/)
    expect(said).toMatch(/By the year it came out/)
  })

  /*
   * The two that are refused, and each for its own reason. `inherit` has
   * nothing above a collection to ask, which is a check constraint on the
   * column. `tag` files a whole house by an accident of the vocabulary and its
   * own seed row has said "Never the collection default" since the table was
   * written. Both come off `COLLECTION_STRATEGIES`, and offering either would
   * be a button the server answers 400 to.
   */
  it('offers neither of the two the server refuses', () => {
    const markup = drawn()

    expect(words(markup)).not.toMatch(/By tag/i)
    expect(words(markup)).not.toMatch(/the way .* does/i)
    expect((markup.match(/class="wf-choice__opt[ "]/g) ?? []).length).toBe(3)
  })

  it('draws no option that is present and unpressable', () => {
    // The drawing had "By tag" greyed out under "Not ready to be offered yet".
    // It is not unfinished, it is not for this question, and a permanently
    // greyed row is a promise nobody will keep.
    expect(drawn()).not.toMatch(/wf-choice__opt--off/)
  })

  it('marks the one the collection is actually on, and only that one', () => {
    const said: Record<string, RegExp> = {
      author: /By the author/,
      title: /By the title/,
      published: /By the year it came out/,
    }

    for (const code of ['author', 'title', 'published'] as SortStrategyCode[]) {
      const markup = drawn({ room: room(code) })
      const chosen = markup.match(/<button[^>]*wf-choice__opt--on[^>]*>(.*?)<\/button>/s)?.[1]

      expect(chosen, `nothing is marked when the collection is on ${code}`).toBeDefined()
      expect((markup.match(/wf-choice__opt--on/g) ?? []).length).toBe(1)
      expect(words(chosen!), `${code} is stored and something else is marked`)
        .toMatch(said[code]!)
      expect(words(chosen!)).toMatch(/Chosen/)
    }
  })

  it('says nothing about the order until the room has answered', () => {
    // Drawing "By the author" over a collection ordered by title is a setting
    // showing somebody the wrong answer, which is worse than showing none.
    const markup = drawn({ room: null })

    expect(markup).not.toMatch(/wf-choice/)
    expect(words(markup)).toMatch(/Reading how your books are ordered/)
  })

  it('says that everything else follows it, which is what makes it a setting', () => {
    expect(words(drawn())).toMatch(
      /Every bookcase and every area follows this unless it says otherwise/,
    )
  })
})

describe('which hand you hold the phone in', () => {
  it('draws the hand that is stored as the one that is on', () => {
    for (const hand of ['left', 'right'] as Hand[]) {
      const seg = segmented(drawn({ hand }), 'Which hand you hold the phone in')
      const on = seg.match(/<button[^>]*wf-seg__opt--on[^>]*>([^<]+)</)?.[1]

      expect(on?.toLowerCase(), `${hand} is stored and something else is drawn`).toBe(hand)
      expect((seg.match(/wf-seg__opt--on/g) ?? []).length).toBe(1)
    }
  })

  it('says what choosing one does, since the camera is another screen', () => {
    expect(words(drawn())).toMatch(/The shutter goes to that edge/)
  })
})

/**
 * Which picture of a book comes first, which is the one setting on this screen
 * that arrived because a screen elsewhere wanted it (#365).
 *
 * The same two checks the hand gets, because they are the two ways a setting
 * lies: drawing something other than what is stored, and not saying what
 * choosing it does. The third is this one's own, and it is the sentence about
 * a book with no downloaded cover. Most books in a young collection have none,
 * so somebody who chooses the downloaded one and then opens four books that
 * ignore the choice needs that said on the screen where they chose.
 */
describe('which picture of a book comes first', () => {
  it('draws the answer that is stored as the one that is on', () => {
    const said: Record<FirstPicture, RegExp> = {
      catalogue: /The downloaded one/,
      yours: /The one you took/,
    }

    for (const first of ['catalogue', 'yours'] as FirstPicture[]) {
      const seg = segmented(drawn({ firstPicture: first }), 'Which picture of a book comes first')
      const on = seg.match(/<button[^>]*wf-seg__opt--on[^>]*>([^<]+)</)?.[1]

      expect(on, `${first} is stored and nothing is drawn as chosen`).toBeDefined()
      expect(on!, `${first} is stored and something else is drawn`).toMatch(said[first])
      expect((seg.match(/wf-seg__opt--on/g) ?? []).length).toBe(1)
    }
  })

  it('says the one thing that would otherwise read as the setting being broken', () => {
    expect(words(drawn())).toMatch(
      /A book with no downloaded cover opens on the photograph you took/,
    )
  })

  it('offers the two answers and no third', () => {
    const said = words(drawn())

    expect(said).toMatch(/The downloaded one/)
    expect(said).toMatch(/The one you took/)
  })

  it('never calls the downloaded picture the catalogue one', () => {
    /*
     * The word the model uses for that picture is "catalogue" and no screen
     * says it to anybody; the book page calls it the downloaded one.
     *
     * **Asked of this section rather than of the page**, which it was until
     * #348 put a card about the book catalogues on the same screen. That card
     * uses the word in its ordinary sense, the one the first screen's
     * "Catalogued" count has always used, so a page-wide ban was banning two
     * different words at once and would have made the wrong one the casualty.
     */
    const markup = drawn()
    const from = markup.indexOf('Which picture of a book comes first')
    const to = markup.indexOf('either way.')
    const said = words(markup.slice(from, to))

    expect(said, 'the setting calls it something no screen calls it').not.toMatch(/catalogue/i)
  })
})

describe('the card at the foot', () => {
  it('says plainly that everybody in the house shares one collection', () => {
    const said = words(drawn())

    expect(said).toMatch(/Nobody signs in/)
    expect(said).toMatch(/Everybody in the house shares one collection/)
  })

  it('offers no account, in any of the forms one arrives in', () => {
    const said = words(drawn())

    for (const promise of [
      /sign in/i, /sign out/i, /log ?in/i, /log ?out/i,
      /switch account/i, /your name/i, /coming soon/i,
    ]) {
      expect(said, `the settings screen offers ${promise}`).not.toMatch(promise)
    }
  })
})

/**
 * Where the catalogues are named, which is the second half of #348's reader.
 *
 * The first screen carries the news and this carries the names, which is #504's
 * split applied to a different pair of facts. There the names were books and
 * went where books live; here they are the catalogues themselves, so they go
 * where the app's own arrangements are.
 *
 * The sentences are `lib/catalogueWords.test.ts`'s. What is asked here is that
 * they reach this screen, that every catalogue is on it including the ones that
 * have done nothing, and that nothing about a key beyond its existence is.
 */
describe('where your books are described from', () => {
  it('names every catalogue, including the ones nobody has asked', () => {
    /*
     * The rule the whole issue produced, at the last place it could still be
     * lost. "Google Books was asked and described nothing" and "Google Books is
     * not on this screen" read very differently, and the second is
     * indistinguishable from a phone nobody has scanned a book on.
     */
    const said = words(drawn())

    for (const source of ['Open Library', 'Google Books', 'Library of Congress', 'K10plus']) {
      expect(said, `${source} is not on the screen`).toContain(source)
    }
  })

  it('says all four numbers for a catalogue, noughts included', () => {
    const said = words(drawn({
      lookups: catalogues({
        'Open Library': { asked: 12, answered: 12, held: 10, noRecord: 2 },
      }),
    }))

    expect(said).toContain(
      'Asked about 12 books: described 10, had no record of 2, turned away 0, failed on 0.',
    )
  })

  it('tells a catalogue that refused from one that failed, on one screen', () => {
    // The pair that used to be one number. Both are "did not answer" and only
    // one of them is answered by anything a person can do.
    const said = words(drawn({
      lookups: catalogues({
        'Google Books': { asked: 12, silent: 12, declined: 12 },
        K10plus: { asked: 3, silent: 3, failed: 3 },
      }),
    }))

    expect(said).toContain('turned away 12, failed on 0')
    expect(said).toContain('turned away 0, failed on 3')
  })

  it('says whether there is a key, and never anything else about one', () => {
    expect(words(drawn({ lookups: catalogues({}, true) })))
      .toContain('Google Books is being asked with a key')

    const without = words(drawn({ lookups: catalogues({}, false) }))
    expect(without).toContain('without a key')
    // And where one is set, which is not here: a field for a secret on a phone
    // is what this card exists instead of.
    expect(without).toContain('where the server runs, not here')
  })

  it('offers nothing to press, because nothing here is a control', () => {
    const markup = drawn()
    const card = markup.slice(markup.indexOf('Where your books are described from'))
    const body = card.slice(0, card.indexOf('</section>'))

    expect(body).not.toContain('<button')
  })

  it('draws no card at all when the read has not answered', () => {
    // A card of noughts built from a failed request would claim every catalogue
    // had been asked nothing, which is a claim and not a silence.
    expect(words(drawn({ lookups: null })))
      .not.toContain('Where your books are described from')
  })
})

describe('the frame', () => {
  it('carries a way back and four tabs, like every screen in the room', () => {
    const markup = drawn()

    expect(markup).toMatch(/wf-top__back/)
    expect((markup.match(/class="wf-tab(?: |")/g) ?? []).length).toBe(4)
  })

  it('draws whatever refused a write, in the words it used', () => {
    expect(words(drawn({ error: 'A whole collection cannot be ordered by tag.' })))
      .toMatch(/A whole collection cannot be ordered by tag/)
  })
})

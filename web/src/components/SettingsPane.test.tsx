/** Rendered as markup rather than driven in a browser: this project has no DOM in its test setup, and this pane holds no state. */

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

/** The four catalogues, in the state a test puts them in. */
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

/** Needed because there are two segmented controls on this screen: asking "exactly one option is marked" of the whole page would pass even if one control had two marked and the other had none. */
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

  // `inherit` is refused by a check constraint on the column; `tag` is
  // refused by its own seed row, since filing a whole house by tag is an
  // accident of vocabulary rather than a deliberate ordering.
  it('offers neither of the two the server refuses', () => {
    const markup = drawn()

    expect(words(markup)).not.toMatch(/By tag/i)
    expect(words(markup)).not.toMatch(/the way .* does/i)
    expect((markup.match(/class="wf-choice__opt[ "]/g) ?? []).length).toBe(3)
  })

  it('draws no option that is present and unpressable', () => {
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
    // Scoped to this section rather than the whole page: the catalogues card
    // elsewhere on this screen uses the word "catalogue" in its ordinary
    // sense, so a page-wide check would ban that too.
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

describe('where your books are described from', () => {
  it('names every catalogue, including the ones nobody has asked', () => {
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
    // Both are "did not answer", but only one is something a person can act on.
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
    // Deliberately not a field for a secret on a phone: a key is set where the server runs.
    expect(without).toContain('where the server runs, not here')
  })

  it('offers nothing to press, because nothing here is a control', () => {
    const markup = drawn()
    const card = markup.slice(markup.indexOf('Where your books are described from'))
    const body = card.slice(0, card.indexOf('</section>'))

    expect(body).not.toContain('<button')
  })

  it('draws no card at all when the read has not answered', () => {
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

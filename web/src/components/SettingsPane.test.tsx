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
import type { FurnitureDto, SortStrategyCode } from '../lib/api'
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

function drawn(over: {
  room?: FurnitureDto | null
  hand?: Hand
  busy?: boolean
  error?: string
} = {}): string {
  return renderToStaticMarkup(
    <SettingsPane
      room={over.room === undefined ? room() : over.room}
      hand={over.hand ?? 'right'}
      busy={over.busy ?? false}
      error={over.error ?? ''}
      tabs={tabs}
      onBack={() => {}}
      onOrder={() => {}}
      onHand={() => {}}
    />,
  )
}

/** The words on the screen, with the markup and therefore the class names gone. */
const words = (markup: string): string => markup.replace(/<[^>]*>/g, ' ')

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
      const markup = drawn({ hand })
      const on = markup.match(/<button[^>]*wf-seg__opt--on[^>]*>([^<]+)</)?.[1]

      expect(on?.toLowerCase(), `${hand} is stored and something else is drawn`).toBe(hand)
      expect((markup.match(/wf-seg__opt--on/g) ?? []).length).toBe(1)
    }
  })

  it('says what choosing one does, since the camera is another screen', () => {
    expect(words(drawn())).toMatch(/The shutter goes to that edge/)
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

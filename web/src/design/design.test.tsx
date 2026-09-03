/**
 * The rules the owner named, checked mechanically, plus the cheapest possible
 * proof that every screen in the gallery still renders.
 *
 * These are here because every one of them is the kind that gets broken by
 * somebody being helpful six months from now, in a file nobody re-reads. A
 * paragraph in a design document does not survive that; a red test does.
 *
 * Rendered as markup rather than driven in a browser, the way
 * `src/components/HomePane.test.tsx` does it: this project has no DOM in its
 * test setup and no screen here holds state.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Doors, InHand, IN_HAND } from './Controls'
import { SCREENS, TAB_SCREENS, type Go, type Screen } from './gallery/screens'
import { MEDIAN_PAGES, spineWidth, spines } from './Shelf'
import { Shots, deckOrder, threeSlots, type Shot } from './Shots'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** Every source file of the design system, css and tsx alike. */
function sources(dir = HERE): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : []
  })
}

/*
 * Pictographs, dingbats, flags and the variation selector that turns a plain
 * character into one. Deliberately wider than "emoji" as most people mean it:
 * a check mark from the dingbats block is the same fingerprint as a smiling
 * face, and it is the one somebody reaches for first.
 */
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u

describe('no emoji, anywhere', () => {
  it('is true of every source file in the design system', () => {
    const offenders = sources()
      .map((path) => [path, readFileSync(path, 'utf8')] as const)
      .filter(([, text]) => EMOJI.test(text))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })

  it('is true of every screen once rendered', () => {
    for (const screen of SCREENS) {
      const markup = renderToStaticMarkup(screen.render(() => {}))
      expect(markup, `${screen.id} renders an emoji`).not.toMatch(EMOJI)
    }
  })
})

/**
 * Two components of one name, which is how a shared namespace starts.
 *
 * `Book.tsx` and `Camera.tsx` both exported `Shots`. Both emitted `.wf-shots`
 * and `.wf-shot`, so `library.css` ended up with two blocks of rules for one
 * set of names and each screen was drawn by whichever block came last. Every
 * photograph on the book page went to an empty dashed outline and the review's
 * three collapsed into one. It typechecked, it passed everything here, and it
 * was found by opening the screen.
 *
 * There is no cheap test for "these two blocks of CSS fight", because a class
 * legitimately appears in many rules and the outcome depends on the order and
 * the weight of all of them. There is a cheap test for the thing that comes
 * first: two components with one name. This is it. It would have gone red on
 * the merge that introduced the second `Shots`, before anybody opened a
 * browser, and it is not about `Shots`: the next collision is the one it is
 * really for.
 */
describe('no two things in the library share a name', () => {
  it('is true of every name the design system exports', () => {
    const homes = new Map<string, string[]>()

    for (const path of sources().filter((one) => /\.tsx?$/.test(one) && !/\.test\./.test(one))) {
      const text = readFileSync(path, 'utf8')
      for (const found of text.matchAll(/^export (?:function|const|class|interface|type) (\w+)/gm)) {
        const name = found[1]!
        homes.set(name, [...(homes.get(name) ?? []), path])
      }
    }

    const shared = [...homes]
      .filter(([, paths]) => paths.length > 1)
      .map(([name, paths]) => `${name}: ${paths.join(', ')}`)

    expect(shared).toEqual([])
    expect(homes.size, 'nothing was scanned at all').toBeGreaterThan(20)
  })
})

describe('no coloured rail down the side of a card', () => {
  it('is true because nothing in the library sets a side border at all', () => {
    const css = readFileSync(join(HERE, 'library.css'), 'utf8')

    expect(css).not.toMatch(/border-left\s*:/)
    expect(css).not.toMatch(/border-right\s*:/)
    expect(css).not.toMatch(/border-inline-start\s*:/)
    expect(css).not.toMatch(/border-inline-end\s*:/)
  })
})

describe('the shelf has one edge', () => {
  it('is true because the board draws no pseudo-element beside its border', () => {
    const css = readFileSync(join(HERE, 'library.css'), 'utf8')

    // The doubling that got spotted immediately last time was a board edge
    // plus a pseudo-element bar under it. One border, no ::before, no ::after.
    expect(css).not.toMatch(/\.wf-shelf__board\s*::?(before|after)/)
    expect(css.match(/\.wf-shelf__board\s*\{[^}]*border-bottom/)).not.toBeNull()
  })
})

/**
 * The words this codebase says to itself.
 *
 * The owner found "run" on the library screen and named the general rule
 * rather than the instance: "a run doesn't make any sense to the user, we
 * shouldn't expose that as a user translation of concepts." So the list is
 * every word `docs/shelving.md` and the schema use for something a person owns
 * or does, in the spelling the code uses rather than the one a person would.
 *
 * **Bookcase, area and book are not on it**, because those are the words a
 * person actually uses; the vocabulary note in `docs/shelving.md` is explicit
 * that an area is chosen by a person. "Shelve" is not on it either: it is what
 * you do with a book, and it is not "shelf", which is.
 *
 * **Fixture is not on it, and it is a table name.** That looks like the rule
 * being bent and it is not. The list is words the code says that a person does
 * not; the owner reached for this one himself, unprompted and twice in the
 * same breath: "they're not bookcases. They are fixtures, not bookcases", and
 * "we shouldn't be rendering the fixture that it's a part of here." A word
 * somebody uses about their own room is theirs, whatever else it also names.
 * The test is about translation, not about which strings the schema owns.
 */
const JARGON = [
  'run',
  'runs',
  'range',
  'ranges',
  'shelf',
  'shelves',
  'plank',
  'planks',
  'separator',
  'separators',
  'capture',
  'captures',
  'sort key',
  'placement',
  'cut',
  'cuts',
]

/** The words on a screen, with the markup and therefore the class names gone. */
function words(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ')
}

describe('no word out of the model reaches the interface', () => {
  it('is true of every screen once rendered', () => {
    for (const screen of SCREENS) {
      const text = words(renderToStaticMarkup(screen.render(() => {})))
      for (const word of JARGON) {
        expect(text, `${screen.id} says "${word}"`).not.toMatch(
          new RegExp(`\\b${word}\\b`, 'i'),
        )
      }
    }
  })

  it('is true of the names the index lists them under', () => {
    for (const screen of [...SCREENS]) {
      for (const word of JARGON) {
        const named = new RegExp(`\\b${word}\\b`, 'i')
        expect(screen.name, `the screen named "${screen.name}"`).not.toMatch(named)
        expect(screen.group, `the group named "${screen.group}"`).not.toMatch(named)
      }
    }
  })
})

/**
 * A tag has two halves and a person only ever sees one of them.
 *
 * `docs/data-model.md`: "`slug` is the identity, `label` is what a person
 * reads", and the hierarchy lives in the slug, Obsidian style, so the identity
 * of the fantasy tag is the string `genre/fantasy`. That string is a key, and
 * putting a key on a screen is the same mistake as showing somebody a row id.
 * Nesting is drawn with an indent and said in words ("under Genre"); it is
 * never written out with a stroke in it.
 *
 * The pattern is deliberately about the shape rather than about a list of
 * known slugs, because the next slug is the one that gets rendered by
 * accident.
 */
const SLUG = /\b[a-z][a-z0-9]*\/[a-z][a-z0-9-]*\b/

describe('a tag is drawn by its label and never by its slug', () => {
  it('is true of every screen once rendered', () => {
    for (const screen of SCREENS) {
      const text = words(renderToStaticMarkup(screen.render(() => {})))
      expect(text, `${screen.id} renders something shaped like a slug`).not.toMatch(SLUG)
    }
  })
})

/**
 * Find is not a place you can be.
 *
 * The owner took it out of the tab bar: "I think we should just have the find
 * system as part of the library rather than a completely separate system." It
 * is now the one action in the library's top right, and the thing that would
 * quietly undo that is somebody adding a fifth tab back. Four is the count,
 * and it is checked on the rendered markup rather than on the array, because
 * the array is not what a person taps.
 */
describe('the tab bar has four places in it', () => {
  it('is true of every screen that draws one', () => {
    let drawn = 0

    for (const screen of SCREENS) {
      const markup = renderToStaticMarkup(screen.render(() => {}))
      const tabs = markup.match(/class="wf-tab(?: |")/g) ?? []
      if (tabs.length === 0) continue
      drawn += 1
      expect(tabs.length, `${screen.id} draws ${tabs.length} tabs`).toBe(4)
    }

    expect(drawn, 'no screen draws a tab bar at all').toBeGreaterThan(1)
  })
})

describe('the one action in a corner is an icon with a name', () => {
  it('is true because no screen renders a bare glyph there', () => {
    let found = 0

    for (const screen of SCREENS) {
      const markup = renderToStaticMarkup(screen.render(() => {}))
      for (const button of markup.match(/<button[^>]*wf-top__action[^>]*>/g) ?? []) {
        found += 1
        expect(button, `${screen.id} has an unnamed corner action`).toMatch(
          /aria-label="[^"]+"/,
        )
      }
    }

    // Without this the loop above passes by finding nothing, which is the way
    // a test like this dies: the class gets renamed and it goes quiet.
    expect(found, 'no screen draws a corner action at all').toBeGreaterThan(1)
  })
})

/**
 * The corner opens onto the viewport, not onto the document (#393).
 *
 * `.wf-corner` was `position: absolute; inset: 0` inside `.wf-screen`, which
 * is right sized to whatever it is drawing rather than to the phone: the
 * library is taller than the screen the moment there is more than a shelf or
 * two of books. `inset: 0` on an absolute sheet reaches the top of *that*, so
 * opening the corner from a page somebody had scrolled down put the sheet
 * above where they were looking, off the top of the glass. The one door to
 * fixtures and settings looked like it did nothing, which is the worst
 * failure mode a button has.
 *
 * A render check does not catch this: `renderToStaticMarkup` has no layout
 * and no scroll position, so a markup assertion sees the same `<div
 * className="wf-corner">` whether the sheet lands on the icon or a screen
 * above it. What is checked here is the one line that decides which of those
 * happens: `position: fixed` pins the sheet to the glass the way `.wf-name`
 * already does for the same reason, and no amount of scrolling the page
 * underneath moves it.
 */
describe('the corner opens onto the glass, not onto wherever the document happens to be scrolled', () => {
  /*
   * Every sheet that opens over a screen, not only the corner.
   *
   * `.wf-sure` was absolute and was the same defect waiting to be found, on the
   * argument that the screens it sat on were about as tall as the phone. The
   * book's own page is not, and correcting its ISBN asks here since #408: the
   * field is near the top, the card was centred in a document three screens
   * long, and pressing the camera on it looked like it did nothing. Which is
   * the sentence above, about a different button.
   *
   * So the rule is the family rather than the one member of it that has been
   * caught, because the next sheet is the one this is really for.
   *
   * ## And the fourth is not a sheet at all (#414)
   *
   * `.wf-tabs` was `position: sticky; bottom: 0`, which is the same defect
   * wearing a different keyword. A sticky box is pinned only while its
   * containing block is under it, and the tab bar's containing block is
   * `.wf-screen`, so the four places were on the glass exactly as long as
   * nothing was drawn after the screen inside the same scroller. The gallery
   * draws its Next button there, and the bar came to rest 47px up the phone on
   * every screen in it.
   *
   * `absolute` is therefore not the only way to fail this. What the rule is
   * about is the family of things that belong to the glass, and `sticky` puts
   * a box back in the document's hands the moment the document is taller than
   * whatever it happens to be nested in.
   */
  const PINNED = ['wf-corner', 'wf-name', 'wf-sure', 'wf-tabs']

  it.each(PINNED)(
    '.%s is fixed to the viewport rather than positioned inside the screen',
    (pinned) => {
      const css = readFileSync(join(HERE, 'library.css'), 'utf8')
      const rule = css.match(new RegExp(`\\.${pinned}\\s*\\{[^}]*\\}`))?.[0] ?? ''

      expect(rule, `no rule was found for .${pinned} at all`).not.toBe('')
      expect(rule, `.${pinned} is not pinned to the viewport`).toMatch(
        /position:\s*fixed/,
      )
      expect(rule, 'a document-relative sheet would still open off-screen').not.toMatch(
        /position:\s*absolute/,
      )
      expect(
        rule,
        `.${pinned} would come unstuck wherever its containing block ends`,
      ).not.toMatch(/position:\s*sticky/)
    },
  )

  /**
   * And the bar that is out of flow has its room kept for it.
   *
   * The half of the fix a `position` assertion cannot see. A fixed bar reserves
   * nothing, so unless something keeps the bottom of every screen clear, the
   * last card on it goes under the bar and the change trades a floating tab bar
   * for a button nobody can reach. `--tabs` is that number, and this is the
   * check that both ends still read the same one: the bar keeps that height,
   * and the body of the screen keeps that much clear.
   */
  it('keeps the height it now covers clear at the bottom of every screen', () => {
    const css = readFileSync(join(HERE, 'library.css'), 'utf8')
    const tokens = readFileSync(join(HERE, 'tokens.css'), 'utf8')

    expect(tokens, 'nothing says how tall the tab bar is').toMatch(
      /--tabs:\s*\d+px/,
    )

    const bar = css.match(/\.wf-tabs\s*\{[^}]*\}/)?.[0] ?? ''
    expect(bar, 'the tab bar does not keep a height of its own').toMatch(
      /min-height:\s*calc\(var\(--tabs\)/,
    )

    const body = css.match(/\.wf-screen__body\s*\{[^}]*\}/)?.[0] ?? ''
    expect(
      body,
      'the body of a screen does not keep the tab bar its room, so the last card is under it',
    ).toMatch(/var\(--tabs\)/)
  })
})

/**
 * The three ways of looking at the library cost a button, not a row.
 *
 * > Instead of showing covers, list and spines as this very big thing that we
 * > can select one of three options for, can we put it to the right of the
 * > "every book" filter [...] That way you don't take up all this space for
 * > choosing between those different views.
 *
 * Two halves, and the second is the one that comes back. A segmented control
 * is the obvious thing to reach for when a fourth view turns up, or when
 * somebody decides the circle is too clever, and it is the thing that was
 * measured at 64px of every visit to a screen whose job is showing books.
 *
 * The first half is the accessibility rule the corner action already carries,
 * arriving somewhere new: this is the second target in the app drawn as a
 * glyph with no word, so it is named or it says nothing at all. Checked as the
 * general rule rather than against three known labels, because the next
 * switcher is the one it is really for.
 *
 * The filter is checked too, and deliberately: the switcher was asked to move
 * beside that row, not to replace it.
 */
describe('the way of looking at the books is one named button beside the filter', () => {
  const LIBRARY = ['library', 'covers', 'listing']

  const drawn = (id: string) => {
    const screen = SCREENS.find((one) => one.id === id)
    expect(screen, `there is no screen called "${id}"`).toBeDefined()
    return renderToStaticMarkup(screen!.render(() => {}))
  }

  it('draws exactly one of them per library screen, named, beside the filter', () => {
    for (const id of LIBRARY) {
      const markup = drawn(id)
      const buttons = markup.match(/<button[^>]*wf-cycle[^>]*>/g) ?? []

      expect(buttons.length, `${id} draws ${buttons.length} view switchers`).toBe(1)
      expect(buttons[0], `${id} has an unnamed view switcher`).toMatch(/aria-label="[^"]+"/)
      expect(markup, `${id} lost the filter above its books`).toMatch(/class="wf-picked"/)
      expect(markup, `${id} draws the switcher outside the filter row`).toMatch(
        /<div class="wf-filter">.*wf-cycle/s,
      )
    }
  })

  it('is true because no library screen spends a row on the three views', () => {
    for (const id of LIBRARY) {
      expect(drawn(id), `${id} is back to a segmented control`).not.toMatch(/wf-seg/)
    }
  })
})

/**
 * Finding stayed as easy to reach as it was when it owned the corner.
 *
 * The corner became the portrait, so find moved to the row above the books,
 * and the whole risk in that trade is named in #329: "losing a corner action
 * and gaining a harder-to-find one is a downgrade dressed as a tidy-up." That
 * is not a thing that happens on the pull request that makes the trade; it is
 * a thing that happens a year later, when somebody tidies a row that has two
 * circles on it and leaves the one that draws.
 *
 * So what is pinned is the requirement rather than the drawing: **on every
 * screen that lists books there is a named target to find one, on the row
 * above them, and it is one press.** If the owner would rather it were a field,
 * or a word, or back in the corner, this goes red and is rewritten with it,
 * which is what a rule that is one round old should do.
 *
 * The name is checked and its wording is not, for the reason the corner action
 * and the view switcher are checked that way: the fault that actually arrives
 * is a glyph with nothing announcing it.
 */
describe('finding is one press from every screen that lists books', () => {
  const LIBRARY = ['library', 'covers', 'listing']

  it('draws one named way to find a book, in the row above the books', () => {
    for (const id of LIBRARY) {
      const screen = SCREENS.find((one) => one.id === id)
      expect(screen, `there is no screen called "${id}"`).toBeDefined()

      const markup = renderToStaticMarkup(screen!.render(() => {}))
      const buttons = markup.match(/<button[^>]*wf-round[^>]*>/g) ?? []

      expect(buttons.length, `${id} offers ${buttons.length} ways to find a book`).toBe(1)
      expect(buttons[0], `${id} has an unnamed way to find a book`).toMatch(
        /aria-label="[^"]+"/,
      )
      expect(markup, `${id} draws it outside the row above the books`).toMatch(
        /<div class="wf-filter">.*wf-round/s,
      )
    }
  })
})

/**
 * What a book's page is about, which the owner had to say twice.
 *
 * > This is the detailed view for a book. Where it is, is one part of that.
 * > It's not the whole picture. And I don't like the "where it is" widget
 * > right here. That's just taking up way too much space.
 *
 * Both halves of that are here as a check rather than as a paragraph, because
 * both are the kind of thing that comes back one helpful edit at a time: a
 * page that leads with where the book sits is the screen he rejected, and a
 * page that is a location widget with something small above it is that screen
 * wearing a different heading.
 *
 * Deliberately not a measurement of how tall the section is. Pixels are not
 * available here, and a character count of markup would fail on somebody
 * writing a longer sentence, which is not the thing being protected.
 *
 * ## What round eight changed here, and what it did not
 *
 * This used to count the page's headings and require at least four of them,
 * with "Where it is" among them. Three of those headings are gone now: the
 * tags moved up beside the picture, the actions are a row of buttons with
 * nothing over them, the board is not introduced, and the ledger of where a
 * book has been went entirely. Counting headings would now count one.
 *
 * **The rule did not move and has not been weakened.** It was never "a book
 * page has four headings"; that was a proxy for it, and the proxy is what the
 * owner's change broke. What the rule says is that the page is about the book,
 * and every piece of material this page carries about the book is now named
 * here and required to be above the place: the book itself, its facts, what it
 * is about, and what can be done with it. That is a stricter statement than a
 * count of headings, and it is stricter in the direction the rule cares about,
 * because the way back to the screen he rejected is the place climbing rather
 * than a heading going missing. Removing location material, which is all this
 * round did to this section, agrees with the rule rather than straining it.
 */
describe('a book screen is about the book, not about where it sits', () => {
  /* The three details screens are on this list from the round they were drawn
     (#409), and that is the point of adding them: the notice at the top of one
     of them is the only thing on any book screen allowed to be about where the
     book sits, and it survives that by being an instruction. Everything under
     it answers to the same rule the book's own page does. */
  const BOOKS = ['book', 'thin', 'lone', 'details', 'amiss', 'detailsout']

  it('draws the book, its facts, its tags and its actions before the place', () => {
    for (const id of BOOKS) {
      const screen = SCREENS.find((one) => one.id === id)
      expect(screen, `there is no screen called "${id}"`).toBeDefined()

      const markup = renderToStaticMarkup(screen!.render(() => {}))
      const where = markup.indexOf('aria-label="Where it is"')
      expect(where, `${id} never says where the book is`).toBeGreaterThan(-1)

      /* Each one is a thing the page says about the book rather than about the
         shelf, and each has to be above the place. Named individually so a
         failure says which of them slipped below it. */
      const about: Record<string, string> = {
        'the book itself': 'class="wf-book"',
        'its photographs': 'wf-shots--book',
        'its facts': 'class="wf-book__fact"',
        'what it is about': 'class="wf-voices"',
        'what you can do': 'class="wf-actions"',
      }

      for (const [what, mark] of Object.entries(about)) {
        const at = markup.indexOf(mark)
        expect(at, `${id} does not draw ${what}`).toBeGreaterThan(-1)
        expect(at, `${id} says where the book is before it draws ${what}`).toBeLessThan(where)
      }
    }
  })

  /*
   * The section is still named on the element even though the name is not
   * written on the screen, and that is deliberate rather than an oversight
   * left over from the heading. A sighted reader has the board in front of
   * them, which is the owner's whole point; a screen reader has a run of
   * spines and nothing saying what the run is. Taking the label off as well
   * would be reading his "we don't need that text there" as an instruction
   * about the accessibility tree, which it is not.
   */
  it('still names the place for somebody who cannot look at the drawing', () => {
    for (const id of BOOKS) {
      const markup = renderToStaticMarkup(
        SCREENS.find((one) => one.id === id)!.render(() => {}),
      )
      expect(markup, `${id} draws the place with nothing naming it`).toMatch(
        /<section class="wf-part" aria-label="Where it is"/,
      )
    }
  })
})

/**
 * Doing before knowing, which is the order of the whole page.
 *
 * > We should have the actions available to the user the moment they get to
 * > this detail view, so they can do whatever it is that they intend to do. And
 * > then if they don't intend to take action, when they scroll down they see
 * > the current shelving view, and that shows them where it is, which might be
 * > what they're here for.
 *
 * Somebody arriving at a book either wants to do something or wants to know
 * where it is, and the knowing is what they scroll to anyway. The order is
 * therefore the decision, not a layout, and it is exactly the kind of thing
 * that comes back one helpful edit at a time: where a book sits is the most
 * concrete thing on the page and it will keep trying to climb.
 *
 * Checked as the order things are drawn in rather than as a list of what each
 * one contains. It used to be checked as the order of the headings, and round
 * eight took four of the five headings off:
 *
 * > And "what you can do", we don't need that text there either. We should
 * > just enable them to take action on a book with a series of buttons. [...]
 * > And instead of "where it is", once again, we don't need that text there.
 * > Looking at this tells them where it is.
 *
 * The order he settled in round six is untouched by that and is still what is
 * pinned: what a book is about, then what you can do with it, then where it
 * sits, then the rest of the author. Only the way of reading the order off the
 * page changed, because a page with one heading on it cannot be checked by its
 * headings.
 */
describe('a book page puts what you can do above where the book sits', () => {
  const BOOKS = ['book', 'thin', 'lone', 'details', 'amiss', 'detailsout']

  const drawn = (id: string) => {
    const screen = SCREENS.find((one) => one.id === id)
    expect(screen, `there is no screen called "${id}"`).toBeDefined()
    return renderToStaticMarkup(screen!.render(() => {}))
  }

  const headsOf = (id: string) =>
    [...drawn(id).matchAll(/<h2 class="wf-part__title">([^<]+)</g)].map((found) => found[1]!)

  it('draws the tags, then the actions, then where it is', () => {
    for (const id of BOOKS) {
      const markup = drawn(id)
      const at = (what: string, mark: string) => {
        const found = markup.indexOf(mark)
        expect(found, `${id} does not draw ${what}`).toBeGreaterThan(-1)
        return found
      }

      const tags = at('what it is about', 'class="wf-voices"')
      const actions = at('what you can do', 'class="wf-actions"')
      const where = at('where it is', 'aria-label="Where it is"')

      expect(actions, `${id} offers nothing to do until after the place`).toBeGreaterThan(tags)
      expect(where, `${id} says where the book sits before offering anything`)
        .toBeGreaterThan(actions)
    }
  })

  /*
   * The one heading left, and the one screen that must not have it. "More by
   * this author" is drawn last where the catalogue has something else by them,
   * and is not drawn at all where it has not: a heading whose only content is
   * that there is no content is on most books in a new collection.
   */
  it('finishes with the author, and leaves the author out where there is no more', () => {
    for (const id of ['book', 'thin']) {
      const markup = drawn(id)
      expect(headsOf(id), `${id} does not finish with the author`).toEqual([
        'More by this author',
      ])
      expect(
        markup.indexOf('aria-label="More by this author"'),
        `${id} puts the author above where the book sits`,
      ).toBeGreaterThan(markup.indexOf('aria-label="Where it is"'))
    }

    expect(headsOf('lone'), 'a book with nothing else by its author still asks').toEqual([])
    expect(drawn('lone')).not.toMatch(/More by this author/)
  })

  it('has no section left called "who wrote it", which is what that one was', () => {
    for (const id of BOOKS) {
      expect(headsOf(id), `${id} still asks who wrote it`).not.toContain('Who wrote it')
    }
  })

  /*
   * The four headings the owner took off, checked as words on the screen
   * rather than as sections, because the way each of them comes back is
   * somebody writing the sentence again somewhere slightly different. Each one
   * was replaced by nothing: the tags read as facts, the buttons say what they
   * do, and the board says where the book is by being looked at.
   */
  it('writes none of the four headings he took off, in any form', () => {
    for (const id of BOOKS) {
      const said = words(drawn(id))
      for (const gone of [
        /What it is about/i,
        /What you can do/i,
        /Where it is/i,
        /Where it has been/i,
      ]) {
        expect(said, `${id} writes ${gone} on the screen again`).not.toMatch(gone)
      }
    }
  })

  /*
   * The sentence over the board went with #262's rule reaching the last place
   * it had survived: "literally the view we have below that shows it. We don't
   * need to explain it verbally with words." It had a class of its own, so the
   * cheapest proof it has not been rewritten shorter is that the class is
   * nowhere: not in a screen, not in the stylesheet waiting for one.
   */
  it('says where the book is by drawing it, and not in a sentence over the drawing', () => {
    for (const screen of SCREENS) {
      const markup = renderToStaticMarkup(screen.render(() => {}))
      expect(markup, `${screen.id} says where the book is in words again`).not.toMatch(
        /wf-here/,
      )
    }

    expect(readFileSync(join(HERE, 'library.css'), 'utf8')).not.toMatch(/\.wf-here/)
  })
})

/**
 * A book that is supposed to be moved says so in words, and is a door.
 *
 * > Instead of "moved it, there is an option", we should remove any button
 * > there, but let the user click on the needs-attention pop up to take them to
 * > the shelving step for that book [...] instead of "needs attention"
 * > explaining that it was last seen on a bookcase and now needs to be put on a
 * > different one, we can just have a message like "book is supposed to be
 * > moved" or something. A little less intense, taking up so much of the screen.
 *
 * Four ways this comes undone, and each one is a check rather than a paragraph.
 *
 * **It grows a button back.** A card with an answer along the bottom is what
 * this was, and one small button beside the sentence is how it returns. The
 * notice is one target and there is nothing inside it to aim at.
 *
 * **It grows back into a location report.** Both places are still on the
 * screen: the board draws the row with the gap in it, and the step this opens
 * names the plank on arrival. A sentence reciting them is the paragraph coming
 * back, and it is also the pinned rule about what a book screen is for being
 * strained by the one thing on the page allowed to be about where a book sits.
 *
 * **It starts telling somebody something with its colour.** He asked for
 * orange-ish and this system does not say anything with a hue: the words carry
 * the meaning and the colour is emphasis. So what is checked is that the notice
 * still reads with every class and every attribute stripped off it, which is
 * what greyscale is, and separately that no rail was painted down its side.
 *
 * **The delete starts explaining itself again.** The sentence over that button
 * went the same round, and the warning it carried is in the dialog rather than
 * gone. What must not come back is the page saying it.
 */
describe('a book supposed to be moved is told in words, and pressing it goes somewhere', () => {
  const drawn = (id: string) => {
    const screen = SCREENS.find((one) => one.id === id)
    expect(screen, `there is no screen called "${id}"`).toBeDefined()
    return renderToStaticMarkup(screen!.render(() => {}))
  }

  /** The notice on a screen, markup and all, or an empty string. */
  const noticeOn = (id: string) =>
    drawn(id).match(/<button[^>]*class="wf-amiss"[\s\S]*?<\/button>/)?.[0] ?? ''

  it('is one press, and the whole of it is the press', () => {
    const markup = drawn('amiss')

    expect(markup.match(/class="wf-amiss"/g) ?? [], 'the notice is drawn once')
      .toHaveLength(1)
    expect(noticeOn('amiss'), 'the notice is not a target at all').not.toBe('')
    /* Nothing inside it: the one button is the notice itself. A card with an
       answer along the bottom is exactly what this stopped being. */
    expect(
      noticeOn('amiss').match(/<button/g) ?? [],
      'the notice holds an answer of its own',
    ).toHaveLength(1)
  })

  it('says what is wrong in words, so it reads with the colour taken out', () => {
    const said = words(noticeOn('amiss')).replace(/\s+/g, ' ').trim()

    expect(said, 'the notice says nothing without its paint')
      .toMatch(/supposed to be moved/i)
    /* One sentence. Two is the paragraph starting again, and the length is not
       what is being pinned: the full stop count is. */
    expect(said.match(/[.!?]/g) ?? [], 'the notice says more than one sentence')
      .toHaveLength(1)
  })

  it('recites neither the place it was nor the place it goes', () => {
    const said = words(noticeOn('amiss'))

    expect(said, 'the notice names a place again').not.toMatch(/\b\d[A-Z]\b/)
    expect(said, 'the notice reports where the book was').not.toMatch(/last seen/i)
    expect(said, 'the notice offers an answer instead of a walk')
      .not.toMatch(/moved it|undo the move/i)
  })

  /* And it is on the one screen that is about a book being out of place. A
     notice drawn on every book is an alarm nobody would design around. */
  it('is on no book screen that has nothing wrong with it', () => {
    for (const id of ['book', 'thin', 'lone', 'details', 'detailsout']) {
      expect(drawn(id), `${id} says a book is out of place when it is not`)
        .not.toContain('wf-amiss')
    }
  })

  it('leaves the delete unexplained on the page, wherever a book can be deleted', () => {
    for (const screen of SCREENS) {
      const markup = renderToStaticMarkup(screen.render(() => {}))
      if (!markup.includes('Delete this book')) continue

      const said = words(markup)
      expect(said, `${screen.id} explains the delete on the page again`)
        .not.toMatch(/off disk|put them back/i)
    }

    // Without this the loop above passes by finding nothing at all.
    expect(
      SCREENS.filter((screen) =>
        renderToStaticMarkup(screen.render(() => {})).includes('Delete this book')).length,
      'no screen offers to delete a book',
    ).toBeGreaterThan(0)
  })
})

/**
 * How the one book a screen is about is marked, which had to stop being a ring.
 *
 * > How we're highlighting the book doesn't look very good to me with the white
 * > outline that we have there. It may even be cute to put the cat on top of
 * > the edge. Something that makes it more visually apparent and isn't clipping
 * > the way that's clipping here.
 *
 * Two faults with one cause. An outline is painted outside the element it is
 * on, a run scrolls inside itself with `overflow-y: hidden`, and a spine is the
 * tallest thing on the board, so the top of that ring was outside the scroller
 * every time. **Anything drawn around the books is drawn outside the run**, so
 * the fix is not a thicker ring or a different colour: the mark stands on the
 * book and takes its room from inside the board.
 *
 * What is checked is the two halves that would bring the clipping back. The
 * ring is gone from the spine and has nowhere to be reattached, and the room
 * kept above the book is the cat's own height rather than a second number that
 * agrees with it today. Pixels are not available here, and a wrapper that
 * reserves the wrong amount of space is exactly the fault that cannot be seen
 * in markup, which is why the two numbers are one number.
 */
describe('the book a screen is about is marked on itself, not ringed', () => {
  it('wraps it with the cat on top, and the cat says what he means', () => {
    let marked = 0

    for (const screen of SCREENS) {
      const markup = renderToStaticMarkup(screen.render(() => {}))
      for (const perch of markup.match(/<div class="wf-perch"[^>]*>.*?<\/svg>/gs) ?? []) {
        marked += 1
        expect(perch, `${screen.id} marks a book with an unnamed cat`).toMatch(
          /aria-label="[^"]+"/,
        )
      }
    }

    expect(marked, 'no screen marks a book at all').toBeGreaterThan(1)
  })

  it('keeps the cat and the room kept for him one number', () => {
    for (const screen of SCREENS) {
      const markup = renderToStaticMarkup(screen.render(() => {}))
      for (const perch of markup.match(/<div class="wf-perch"[^>]*>.*?<\/svg>/gs) ?? []) {
        const room = perch.match(/--perch:\s*(\d+)px/)
        const tall = perch.match(/height="(\d+)"/)
        expect(room, `${screen.id} keeps no room above the marked book`).not.toBeNull()
        expect(tall, `${screen.id} draws no cat on the marked book`).not.toBeNull()
        expect(tall![1], `${screen.id} keeps ${room![1]}px for a cat ${tall![1]}px tall`).toBe(
          room![1],
        )
      }
    }
  })

  it('has no ring left on a spine for anybody to thicken', () => {
    const css = readFileSync(join(HERE, 'library.css'), 'utf8')
    const shelf = readFileSync(join(HERE, 'Shelf.tsx'), 'utf8')

    expect(css).not.toMatch(/\.wf-spine--here/)
    expect(shelf).not.toMatch(/wf-spine--here'/)
    // Nothing on this shelf is drawn outside its own box, which is the whole
    // of why the old mark was cut off. Every other outline in the stylesheet
    // is `none` with a shadow instead, so this stays a one-line check.
    expect(css).not.toMatch(/outline-offset/)
  })
})

/**
 * What the first screen is for, which the owner cut down to one thing.
 *
 * > Let's not even have the book scanning part here. Let's just have metrics,
 * > useful information. Like, for example, "six are ready to shelve" or "three
 * > books to carry".
 *
 * Two halves, and both are the kind that come back one helpful edit at a time.
 * A card offering the camera is a second door to the room the tab bar already
 * opens, and it is the one that eats the middle of the screen. A count nobody
 * can act on is decoration, and decoration is what a screen made of counts
 * fills up with.
 *
 * The second is the general one and it is checked mechanically: every count on
 * this screen is a target. The tab bar is deliberately not covered by either:
 * photographing a book is one tap away from here and from everywhere else, and
 * that is the point of taking the card off.
 *
 * ## Round eight: the counts lost their headings and gained a list of doors
 *
 * > So we get rid of the collection, and we get rid of "needs you", and instead
 * > we just have those numbers there [...] And then underneath those, we have
 * > the button for "find the book in your hand" [...] And any of the other most
 * > meaningful actions in the application.
 *
 * So this screen now has buttons on it, deliberately, and the answer to "may
 * another one be added" stopped being a flat no. What replaces the flat no is
 * the two things that made it worth having, and both are checked below rather
 * than described:
 *
 * **There are few of them.** Three is the ceiling, and it is a ceiling rather
 * than a count because the fault is a screen of buttons, which is the thing he
 * was complaining about in the first place said another way.
 *
 * **None of them goes where a tab goes.** A room the tab bar already opens is
 * one press from here whatever this screen does, so a button for it is the
 * camera card being reinvented under another name. Checked by pressing every
 * door and comparing where it lands against the tab table itself.
 *
 * ## And one of them is pinned by name, because it is a camera (#355)
 *
 * There is **exactly one** way from here to the camera you point at a book you
 * already own, its wording is `IN_HAND`, and pressing it lands on that camera.
 * The wording is checked because it is the only thing that says which of this
 * app's two cameras it is, and getting that wrong is the fault that costs
 * somebody a book catalogued twice.
 */
describe('the first screen is counts, and every count goes somewhere', () => {
  const screen = () => {
    const found = SCREENS.find((one) => one.id === 'home')
    expect(found, 'there is no screen called "home"').toBeDefined()
    return found!
  }

  const home = () => renderToStaticMarkup(screen().render(() => {}))

  it('draws no count that is only a label', () => {
    const markup = home()
    const counts = markup.match(/class="wf-stat[ "]/g) ?? []

    expect(counts.length, 'the first screen draws no counts at all').toBeGreaterThan(2)
    expect(markup, 'a count on the first screen is not a target').not.toMatch(
      /<(?!button)[a-z]+ class="wf-stat[ "]/,
    )
  })

  it('does not offer the camera', () => {
    expect(words(home())).not.toMatch(/camera|photograph/i)
  })

  /*
   * The headings were the whole shape of this screen for two rounds and their
   * class is still in the stylesheet for every other screen that uses it, so
   * the cheapest proof they have not crept back is that this screen draws none.
   */
  it('says the counts in one ungrouped run, with no heading over them', () => {
    const markup = home()
    const said = [...markup.matchAll(/class="wf-stat__word">([^<]+)</g)].map((one) => one[1])

    expect(markup, 'the first screen has a heading on it again').not.toMatch(/wf-heading/)
    expect(said, 'the counts are not the five he named, in his order').toEqual([
      'catalogued', 'checked out', 'ready to shelve', 'to carry', 'stuck',
    ])
  })

  /*
   * Where the cat is, which is a decision rather than a detail (#427).
   *
   * > This is the cat. It is supposed to be sleeping on the actions, not as
   * > part of the metrics grid.
   *
   * He closed the counts from #361 and #410 stretched him across them, and on a
   * phone that read as a sixth count with a long tail. He belongs to the things
   * you can do now, and the counts are five counts. Both halves are checked,
   * because "he moved" and "he moved and took a hole with him" are different
   * outcomes and only one of them was asked for.
   */
  it('sleeps on the things you can do, and leaves the counts five', () => {
    const markup = home()

    expect(markup, 'the cat has gone off the first screen').toMatch(/wf-doors__cat/)
    expect(markup, 'the cat is back in the counts grid').not.toMatch(/wf-stats__cat/)
    expect((markup.match(/class="wf-stat[ "]/g) ?? []).length, 'the grid is not five counts')
      .toBe(5)
  })

  it('offers few things to do, and none of them where a tab already goes', () => {
    let went = ''
    const doors = doorsOf(screen(), (to) => { went = to })

    expect(doors.length, 'the first screen offers nothing to do at all').toBeGreaterThan(0)
    expect(doors.length, 'the first screen is becoming a screen of buttons').toBeLessThanOrEqual(3)

    const tabs = Object.values(TAB_SCREENS)
    for (const door of doors) {
      went = ''
      ;(door.props as { onPress?: () => void }).onPress?.()

      expect(SCREENS.some((one) => one.id === went), `a door goes nowhere: "${went}"`).toBe(true)
      expect(tabs, `a door on the first screen goes to "${went}", which is a tab`)
        .not.toContain(went)
    }
  })

  it('has one door to the camera that reads a book you already own, and one only', () => {
    const markup = home()
    const doors = markup.match(/class="wf-door wf-door--inhand"/g) ?? []

    expect(doors.length, `the first screen draws ${doors.length} of these`).toBe(1)
    expect(words(markup), 'the door does not say which camera it opens').toContain(IN_HAND)
  })

  it('is one press from the camera that reads a book you already own', () => {
    // The measurement #355 exists to restore, taken the way that issue takes
    // it: from this screen, with nothing opened first. A door that was named
    // right and landed somewhere else would pass every check above and still
    // be the regression, so what is pinned is where pressing it goes.
    let went = ''
    const door = findIn(screen().render((to) => { went = to }), InHand)

    expect(door, 'the first screen has no way to the book in your hand').toBeDefined()
    ;(door!.props as { onPress?: () => void }).onPress?.()

    expect(went, 'the first screen presses through to the wrong screen').toBe('inhand')
    expect(SCREENS.some((one) => one.id === went), 'it goes nowhere').toBe(true)
  })
})

/**
 * Every door on a screen, as elements that can still be pressed.
 *
 * They are the children of the one `Doors` on the screen rather than a search
 * for a component type, and that is the point: the rule is about how many
 * things this screen offers and where they go, so a door added tomorrow as some
 * other component is covered by it without anybody remembering to add a name
 * here.
 */
function doorsOf(screen: Screen, go: Go = () => {}): ReactElement[] {
  const list = findIn(screen.render(go), Doors)
  if (!list) return []

  const inside = (list.props as { children?: ReactNode }).children
  return (Array.isArray(inside) ? inside : [inside]).filter((one) => isValidElement(one))
}

/**
 * The first element of a given kind in a drawn screen, or nothing.
 *
 * Rendered markup cannot be pressed, and what a target does is exactly the
 * part of a wireframe that markup does not carry. So a screen's own tree is
 * walked instead, which is the cheapest way to ask "and where does that one
 * go" without putting a DOM in this project's test setup.
 */
function findIn(node: ReactNode, kind: unknown): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const one of node) {
      const found = findIn(one, kind)
      if (found) return found
    }
    return undefined
  }

  if (!isValidElement(node)) return undefined
  if (node.type === kind) return node

  return findIn((node.props as { children?: ReactNode }).children, kind)
}

/**
 * One row of books is one area, and nothing splits a row.
 *
 * > A is an area itself, so it really would be bookcase one, 1A, and then
 * > underneath that would be another row that's 1B. You wouldn't have this
 * > actual physical split like you have there.
 *
 * The library drew bookcase 1 as one row labelled `1A` with a post partway
 * along it and an area either side, which says `1A` holds areas. It does not:
 * an area is the unit a person owns and the unit a book is placed in, and this
 * app has never known which areas share a plank. So a row is an area, every
 * row wears exactly one label, and the drawing that said otherwise is gone.
 *
 * Checked on the rendered markup and on the source, because there are two ways
 * back: somebody redraws the post, or somebody writes a label that names two
 * places at once. The count of boards against the count of labels is what
 * catches a third row appearing inside a second one.
 */
describe('one row of books is one area', () => {
  it('is true because no screen draws anything dividing a row', () => {
    let boards = 0

    for (const screen of SCREENS) {
      const markup = renderToStaticMarkup(screen.render(() => {}))
      expect(markup, `${screen.id} splits a row`).not.toMatch(/wf-divider/)

      const drawn = markup.match(/class="wf-shelf__board"/g) ?? []
      const labels = markup.match(/class="wf-shelf__label"/g) ?? []
      boards += drawn.length
      expect(labels.length, `${screen.id} draws ${drawn.length} rows under ${labels.length} labels`).toBe(
        drawn.length,
      )
    }

    expect(boards, 'no screen draws a row of books at all').toBeGreaterThan(1)
  })

  it('is true because the library has no such thing to draw with', () => {
    const shelf = readFileSync(join(HERE, 'Shelf.tsx'), 'utf8')
    const css = readFileSync(join(HERE, 'library.css'), 'utf8')

    expect(shelf).not.toMatch(/kind: 'divider'/)
    expect(css).not.toMatch(/^\.wf-divider\s*\{/m)
  })
})

/**
 * The catalogue holds no gender, so no screen may speak as though it did.
 *
 * The owner found one instance and named the rule under it:
 *
 * > You have "all nine of hers". We need to change that to "theirs", because
 * > we're not gonna be able to tell if it's male or female probably for the
 * > author.
 *
 * It is structural rather than a wording preference. A book has a name, an
 * alias and a filing name behind it and there is no fourth field waiting to be
 * filled in, so any sentence that picks a pronoun is inventing one, and it is
 * wrong the first time a name does not read the way somebody assumed. There
 * were four of them, on the two book screens, and a fifth would arrive the
 * same way: one helpful edit written about one author who happens to be known.
 *
 * The only foreseeable false positive is a real book title with a pronoun in
 * it, and there is none in the gallery today. If one ever arrives, the title
 * is not the problem and neither is this check: it is worth the minute it
 * costs to say so where the exception is made.
 *
 * **Bare "he" is deliberately not on the list**, and that is the one honest
 * hole in it. The comparison screens narrate the owner's own choices back to
 * him in the app's voice, which is a different fault with a different fix
 * (#262, and not this screen's), and every form the author defect actually
 * took is here: a possessive and an object are what you reach for when you are
 * writing about somebody, and "all nine of hers" is both.
 */
const GENDERED = ['him', 'his', 'himself', 'she', 'her', 'hers', 'herself']

describe('nothing on a screen has a gender in it', () => {
  it('is true of every screen once rendered', () => {
    for (const screen of SCREENS) {
      const text = words(renderToStaticMarkup(screen.render(() => {})))
      for (const word of GENDERED) {
        expect(text, `${screen.id} says "${word}"`).not.toMatch(
          new RegExp(`\\b${word}\\b`, 'i'),
        )
      }
    }
  })
})

/**
 * A book's photographs are the book, and there is nothing underneath it.
 *
 * > We should have the spine on the left side of the book image and the book
 * > cover there [...] and then the user should be able to swipe on the front of
 * > the book to see the other pictures, rather than us show them all
 * > underneath it.
 *
 * Both halves are checked, because the rail is the half that comes back: it is
 * the obvious way to add a fourth kind of photograph to this screen, and it
 * was the arrangement here for two rounds.
 */
describe('a book wears its photographs rather than listing them', () => {
  it('draws the spine against the front, and no rail under either', () => {
    for (const id of ['book', 'thin', 'lone']) {
      const markup = renderToStaticMarkup(
        SCREENS.find((one) => one.id === id)!.render(() => {}),
      )

      expect(markup, `${id} does not draw the book`).toMatch(/wf-shots--book/)
      expect(markup, `${id} still has a rail of photographs`).not.toMatch(
        /class="wf-shots"/,
      )

      const sliver = markup.indexOf('wf-shot--sliver')
      const face = markup.indexOf('wf-shot--face')
      expect(sliver, `${id} draws no cropped spine`).toBeGreaterThan(-1)
      expect(face, `${id} draws the spine after the front`).toBeGreaterThan(sliver)
    }
  })
})

/**
 * The other pictures are reachable, by a swipe and by something that is not one.
 *
 * > It should be possible to swipe on the book cover to be able to see the
 * > catalogue image, the front picture, the back picture. Right now we can't
 * > swipe on it.
 *
 * The gesture itself cannot be driven from here: this suite renders markup and
 * has no DOM to move a finger across. What it can hold is the three things the
 * gesture rests on, each of which is a way the swipe has already been lost or
 * could be lost again by somebody tidying.
 *
 * **Every photograph is in the strip**, not only the front. Drawing `deck[0]`
 * and nothing else is what this screen did for two rounds, and it is the state
 * a swipe silently degrades back to.
 *
 * **The strip is a scroll container.** That is the only reason a sideways
 * gesture and the page scrolling down do not fight: the browser picks the axis
 * and gives the other one away. Take `overflow-x` or the snapping off and the
 * pictures stop moving without anything else looking wrong.
 *
 * **The dots are buttons.** A swipe is undiscoverable and a mouse has none, so
 * a person who never swipes still reaches every photograph. They were spans
 * with a `listitem` role and no behaviour, which read the same and did nothing.
 */
describe("a book's photographs answer to a swipe, and to somebody who does not", () => {
  const css = readFileSync(join(HERE, 'library.css'), 'utf8')

  it('puts every photograph in the strip rather than only the front', () => {
    for (const id of ['book', 'thin', 'lone']) {
      const markup = renderToStaticMarkup(
        SCREENS.find((one) => one.id === id)!.render(() => {}),
      )

      // Front, Back and Downloaded. The spine is the sliver and is never
      // swiped past: it is the one you look for a book by.
      expect(
        (markup.match(/wf-shot--face/g) ?? []).length,
        `${id} draws only the front of the deck`,
      ).toBe(3)
      expect(markup, `${id} has no strip to swipe`).toMatch(/wf-deck__track/)
    }
  })

  it('scrolls that strip natively, which is what leaves the page its own axis', () => {
    const rule = css.match(/\.wf-deck__track\s*\{[^}]*\}/)?.[0] ?? ''

    expect(rule, 'the strip is not a scroll container').toMatch(/overflow-x:\s*auto/)
    expect(rule, 'a swipe would not land on a photograph').toMatch(/scroll-snap-type:\s*x/)
    expect(rule, 'a swipe past the end would reach the browser').toMatch(
      /overscroll-behavior-x:\s*contain/,
    )
  })

  it('leaves a way through the photographs for somebody with no swipe', () => {
    for (const id of ['book', 'thin', 'lone']) {
      const markup = renderToStaticMarkup(
        SCREENS.find((one) => one.id === id)!.render(() => {}),
      )
      const dots = markup.match(/<button[^>]*class="wf-dot[^"]*"[^>]*>/g) ?? []

      expect(dots.length, `${id} draws no dot that can be pressed`).toBe(3)
      // Every one names the photograph it goes to, and says whether there is
      // one to go to at all.
      for (const dot of dots) expect(dot, `${id} has an unnamed dot`).toMatch(/aria-label="/)
    }
  })
})

/**
 * The picture a catalogue holds is the one a book opens on, where there is one.
 *
 * > On the book detail view, we should show the catalogue picture of the front
 * > of the book first if possible, instead of the one the user took.
 *
 * **"If possible" is the half that has to be checked.** Bringing a downloaded
 * cover to the front is three lines; bringing one to the front when there is
 * none is a book that opens on an empty dashed box with "No photograph"
 * written in it, and every book in a new collection is that book. So both
 * cases are pinned, and they are pinned on the dots, which are what name the
 * pictures in the order they are swiped through.
 *
 * The arithmetic itself is `deckOrder`, which is pure and is checked here
 * directly as well: the drawn screens prove the component reads it and these
 * prove it answers correctly for the cases no screen happens to draw.
 */
describe('a book opens on the picture a catalogue holds, where there is one', () => {
  /** The photographs in the order the swipe reaches them, off the dots. */
  const deckOf = (id: string) => {
    const markup = renderToStaticMarkup(
      SCREENS.find((one) => one.id === id)!.render(() => {}),
    )
    return [...markup.matchAll(/<button[^>]*class="wf-dot[^"]*"[^>]*aria-label="([^"]+)"/g)]
      .map((found) => found[1]!)
  }

  it('leads with the downloaded one on a book that has one', () => {
    for (const id of ['book', 'lone']) {
      expect(deckOf(id)[0], `${id} opens on somebody's photograph`).toBe('Downloaded')
    }
  })

  it('leads with the photograph somebody took when nothing was downloaded', () => {
    // Not "Downloaded, not photographed", which is the empty first frame this
    // exists to prevent. The kind is still in the deck and still has a dot.
    expect(deckOf('thin')[0], 'a book with no downloaded cover opens on an empty frame')
      .toBe('Front, not photographed')
    expect(deckOf('thin'), 'the downloaded one fell out of the deck entirely')
      .toContain('Downloaded, not photographed')
  })

  it('moves nothing else, whichever way round it is', () => {
    const front = { word: 'Front', cloth: 'plum' as const }
    const back = { word: 'Back', cloth: 'wood' as const }
    const downloaded = { word: 'Downloaded', cloth: 'sky' as const, catalogue: true }
    const deck = [front, back, downloaded]

    expect(deckOrder(deck, 'catalogue')).toEqual([downloaded, front, back])
    expect(deckOrder(deck, 'yours')).toEqual(deck)
    expect(deckOrder([front, back], 'catalogue')).toEqual([front, back])
    expect(
      deckOrder([front, back, { word: 'Downloaded', catalogue: true }], 'catalogue'),
      'an absent downloaded cover was brought to the front',
    ).toEqual([front, back, { word: 'Downloaded', catalogue: true }])
  })

  /*
   * The queue row draws this same component and hands it one photograph
   * (#363), so this ordering has to be incapable of touching it. It is, by
   * arithmetic rather than by a caller remembering to opt out: with one
   * picture in the deck there is nothing at an index above zero to bring to
   * the front. Checked on the drawn row as well as on the function, because
   * the row is where a regression would actually be seen.
   */
  it('leaves a deck of one exactly as it was, which is what a queue row has', () => {
    const only = { word: 'Front', cloth: 'moss' as const }
    const alone = { word: 'Downloaded', cloth: 'moss' as const, catalogue: true }

    expect(deckOrder([only], 'catalogue')).toEqual([only])
    expect(deckOrder([alone], 'catalogue')).toEqual([alone])

    const markup = renderToStaticMarkup(
      SCREENS.find((one) => one.id === 'queue')!.render(() => {}),
    )
    const rows = (markup.match(/wf-shots--book-small/g) ?? []).length
    expect(rows, 'the queue draws no books at all').toBeGreaterThan(1)
    expect(
      (markup.match(/wf-shot--face/g) ?? []).length,
      'a queue row grew a second picture',
    ).toBe(rows)
    expect(markup, 'a queue row grew dots it cannot deliver a swipe for').not.toMatch(
      /class="wf-dot/,
    )
  })
})

/**
 * The details screen is three slots, and the spine leads them.
 *
 * > At the top of this screen we need to show the catalogue image if it's
 * > available. If it's not available, we don't show it. The spine should be on
 * > the far left, not on the far right. [...] When the catalogue image is
 * > available, you should be able to swipe on our front picture to be able to
 * > see the back picture.
 *
 * Three things would each undo it on their own and each is checked. The spine
 * came last because `SLOTS` is the order the camera fills them in, and that
 * list is still there and still right for the camera, so the ordering is the
 * thing a tidy-up would reunify. A downloaded cover drawn as an empty dashed
 * box is the obvious way to add a fourth kind and is what the book's own page
 * correctly does with the same kind, so the two screens differ on purpose. And
 * the swipe is only there in one of the two states, which is the sort of thing
 * that gets drawn for both because it is fewer branches.
 */
describe('the details screen is three slots, and the spine is the first', () => {
  const drawn = (id: string) =>
    renderToStaticMarkup(SCREENS.find((one) => one.id === id)!.render(() => {}))

  /** The words under the photographs, in the order they are drawn. */
  const words = (markup: string) =>
    [...markup.matchAll(/<span class="wf-shot__word">([^<]+)<\/span>/g)].map((one) => one[1]!)

  it('leads with the spine on both, which is not the order they are taken in', () => {
    for (const id of ['review', 'reviewnone']) {
      expect(words(drawn(id))[0], `${id} does not lead with the spine`).toBe('Spine')
    }
  })

  it('draws the downloaded cover between the spine and ours, where there is one', () => {
    expect(words(drawn('review'))).toEqual(['Spine', 'Downloaded', 'Front', 'Back'])
    // Three slots for four pictures: the two somebody took share the last one.
    expect(drawn('review'), 'the photographs somebody took have no strip').toMatch(
      /wf-shot-deck/,
    )
    expect(
      (drawn('review').match(/<button[^>]*class="wf-dot[^"]*"/g) ?? []).length,
      'the front and the back are not both reachable',
    ).toBe(2)
  })

  it('draws no frame at all for a cover nobody downloaded', () => {
    const markup = drawn('reviewnone')

    expect(words(markup)).toEqual(['Spine', 'Front', 'Back'])
    expect(markup, 'an empty downloaded frame is drawn').not.toMatch(/Downloaded/)
    // And nothing to swipe: the room the cover would have taken is theirs, so
    // the two photographs have a slot each.
    expect(markup, 'a strip was drawn for a slot with one picture in it').not.toMatch(
      /wf-shot-deck/,
    )
    expect(markup, 'dots were drawn for a rail with nothing to move').not.toMatch(
      /class="wf-dot/,
    )
  })

  /*
   * The arithmetic itself, for the cases no screen happens to draw. A cloth
   * and a photograph both count as a picture, the way they do everywhere else
   * in this component, and neither counts when there is neither.
   */
  it('decides on the picture rather than on the caller remembering', () => {
    const spine: Shot = { word: 'Spine', sliver: true, cloth: 'moss' }
    const front: Shot = { word: 'Front', cloth: 'wood' }
    const back: Shot = { word: 'Back' }
    const ours = [front, back]

    const held: Shot = { word: 'Downloaded', catalogue: true, cloth: 'sky' }
    expect(threeSlots(spine, held, ours)).toEqual({ shots: [spine, held], deck: ours })

    const none: Shot = { word: 'Downloaded', catalogue: true }
    expect(threeSlots(spine, none, ours)).toEqual({ shots: [spine, front, back] })

    // A real photograph counts as much as the gallery's cloth does.
    const real: Shot = { word: 'Downloaded', catalogue: true, photo: '/api/covers/x.jpg' }
    expect(threeSlots(spine, real, ours)).toEqual({ shots: [spine, real], deck: ours })
  })
})

/**
 * A picture opens whole, and whole means the whole photograph.
 *
 * > It should be possible that if we just tap the image of the spine or of the
 * > book, that we get a full screen view of it that can be exited out of, or
 * > you can swipe on to go see any of the other images.
 *
 * The view itself cannot be opened from here: this suite renders markup and has
 * no DOM to tap. What it holds is the four things it rests on, each of which is
 * a way it has already been lost once somewhere in this app or would be lost by
 * somebody tidying.
 *
 * **A picture is a target and an empty box is not.** Blowing a dashed box with
 * "No photograph" in it up to fill a phone is the same sentence in a bigger
 * room, and a swipe that lands on one reads as nothing having happened.
 *
 * **The strip is a scroll container**, which is the only reason a swipe between
 * pictures and a tap that closes the view are two different gestures. Take the
 * snapping off and both stop working, in opposite directions.
 *
 * **The picture is not cropped.** This is the one that would go quietly: every
 * other picture of a book here is `object-fit: cover` on a crop, because a wall
 * of uncropped photographs is a wall of carpet, and the app's lightbox has
 * carried the exception since it existed.
 *
 * **There is a named way out.** A handler on a box is not something a keyboard
 * or a screen reader can find.
 */
describe('a picture opens whole, and whole is the whole photograph', () => {
  const css = readFileSync(join(HERE, 'library.css'), 'utf8')

  const drawn = (id: string) =>
    renderToStaticMarkup(SCREENS.find((one) => one.id === id)!.render(() => {}))

  /** The pictures of the book that can be pressed, off the drawn page. */
  const targets = (markup: string) =>
    markup.match(/<button[^>]*class="wf-shot[^"]*"[^>]*>/g) ?? []

  it('makes every picture there is a target, and no empty box one', () => {
    // The spine, the front, the back and the downloaded cover on the full
    // record; one photograph and three empty boxes on the thin one; three of
    // four on the third, which has no back.
    const each: Record<string, number> = { book: 4, thin: 1, lone: 3 }

    for (const [id, wanted] of Object.entries(each)) {
      const found = targets(drawn(id))
      expect(found.length, `${id} opens ${found.length} of its pictures`).toBe(wanted)
      for (const one of found) {
        expect(one, `${id} has an unnamed picture`).toMatch(/aria-label="[^"]+"/)
      }
    }
  })

  it('leaves a queue row with nothing to press, because a row is one button', () => {
    const markup = drawn('queue')

    expect(markup, 'the queue draws no books at all').toMatch(/wf-shots--book-small/)
    expect(targets(markup), 'a queue row grew a button inside its button').toEqual([])
  })

  it('swipes it the way everything else here swipes', () => {
    const rule = css.match(/\.wf-whole__track\s*\{[^}]*\}/)?.[0] ?? ''

    expect(rule, 'the strip is not a scroll container').toMatch(/overflow-x:\s*auto/)
    expect(rule, 'a swipe would not land on a picture').toMatch(/scroll-snap-type:\s*x/)
    expect(rule, 'a swipe past the end would reach the browser').toMatch(
      /overscroll-behavior-x:\s*contain/,
    )
  })

  it('shows the whole picture rather than the crop of it', () => {
    const rule = css.match(/\.wf-whole__img\s*\{[^}]*\}/)?.[0] ?? ''

    expect(rule, 'the full screen view crops the photograph').toMatch(
      /object-fit:\s*contain/,
    )
    expect(rule, 'the photograph is cut off by the screen').toMatch(/max-height:\s*100%/)
  })

  it('has a way out that is a word rather than a handler on a box', () => {
    const markup = renderToStaticMarkup(
      <Shots
        mode="book"
        full
        shots={[
          { word: 'Spine', sliver: true, cloth: 'moss' },
          { word: 'Front', cloth: 'wood' },
        ]}
      />,
    )

    // The view is not open, so what is checked here is the door: both pictures
    // are pressable and each says what pressing does.
    expect(targets(markup).length, 'neither picture opens anything').toBe(2)
    for (const one of targets(markup)) {
      expect(one, 'a picture says nothing about what it opens').toMatch(
        /aria-label="See the whole [a-z]+ picture"/,
      )
    }
    expect(css, 'the way out is not drawn at all').toMatch(/\.wf-whole__away\s*\{/)
  })
})

/**
 * The queue row's drawing is unchanged, said as the exact string it draws.
 *
 * #363 gave the row the book page's own component and #374 had to prove the
 * ordering could not reach it. This round adds two more things that could:
 * a strip that a rail can now hold, and a picture that can now be pressed.
 * Neither is reachable from a row, and neither is kept out by anything the row
 * says: they are kept out by nobody asking for them.
 *
 * That is a good argument and it is the same argument that was made about the
 * ordering, so it gets the same proof, one round stronger. The row's markup is
 * pinned here in full. Anything at all that leaks into it fails, including the
 * things nobody has thought of yet, which is the whole point of a string rather
 * than a list of absences.
 *
 * **If this fails, look at what changed before changing the string.** The
 * string is the record of a decision, not a snapshot to be refreshed.
 */
describe('a queue row draws exactly what it drew', () => {
  it('is byte for byte the markup it was', () => {
    const row: Shot[] = [
      { word: 'Spine', cloth: 'wood', sliver: true },
      { word: 'Front', cloth: 'moss' },
    ]

    expect(renderToStaticMarkup(<Shots shots={row} mode="book" size="small" />)).toBe(
      '<span class="wf-shots wf-shots--book wf-shots--book-small">'
        + '<span class="wf-shot wf-shot--sliver wf-shot--taken" aria-hidden="true">'
        + '<span class="wf-shot__box wf-spine--wood"></span>'
        + '</span>'
        + '<span class="wf-deck">'
        + '<span class="wf-deck__track">'
        + '<span class="wf-shot wf-shot--face wf-shot--taken" aria-hidden="true">'
        + '<span class="wf-shot__box wf-spine--moss"></span>'
        + '</span>'
        + '</span>'
        + '</span>'
        + '</span>',
    )
  })
})

/**
 * A spine is cropped to a spine, on every screen that draws or takes one.
 *
 * > In our current world, that is a cropped shot where we crop to the spine
 * > shape. [...] Whenever we're on the spine shot, it should be a cropped shot
 * > of the spine.
 *
 * and, on the review:
 *
 * > Once again, the spine is gonna be thin, so it may not need to take up all
 * > that space right there.
 *
 * One fact behind both, `sliver` on the shot, so what is checked is that every
 * screen reads it rather than that each one looks a particular way. The frame
 * changes shape only when the spine is the photograph about to be taken, which
 * is the half that would come back as a slot on every shot; and the review's
 * spine wears the same marker its cropped drawing on the book page does, which
 * is the half that would come back as a second treatment.
 */
describe('a spine is photographed and drawn in the shape of a spine', () => {
  const drawn = (id: string) =>
    renderToStaticMarkup(SCREENS.find((one) => one.id === id)!.render(() => {}))

  it('frames the spine in a slot, and only when the spine is what is next', () => {
    expect(drawn('spine'), 'the spine is framed like a cover').toMatch(
      /wf-view__guide--slot/,
    )
    expect(drawn('camera'), 'every shot is framed like a spine').not.toMatch(
      /wf-view__guide--slot/,
    )
  })

  it('gives the spine a sliver of the review rather than a third of it', () => {
    const markup = drawn('review')

    expect(markup, 'the review draws no photographs').toMatch(/wf-shots--big/)
    expect(markup, 'the review gives the spine a cover shape').toMatch(
      /wf-shot--sliver/,
    )
    // One of the three, not all of them: a row of slivers is the same mistake
    // in the other direction.
    expect((markup.match(/wf-shot--sliver/g) ?? []).length).toBe(1)
  })

  it('keeps the way to take it again, which is what the sliver is', () => {
    expect(drawn('review'), 'the review lost the retake').toMatch(/wf-shot__again/)
  })
})

/**
 * Thirteen digits are read off a book, not typed by somebody holding one.
 *
 * > On the ISBN, on the right side of it, we should show like a camera icon
 * > for them to change the ISBN. They can click on that and it opens up to
 * > scan the ISBN in the back of the book, like our current flow.
 *
 * The thing that would undo it is not somebody deleting the button; it is
 * somebody adding a second field action with no accessible name, because the
 * target carries an icon and no word. So the check is the general one: every
 * action inside a field is named.
 */
describe('a field with another way to answer it says what that way is', () => {
  it('is true of every screen that draws one, and the review draws one', () => {
    let found = 0

    for (const screen of SCREENS) {
      const markup = renderToStaticMarkup(screen.render(() => {}))
      for (const button of markup.match(/<button[^>]*wf-field__act[^>]*>/g) ?? []) {
        found += 1
        expect(button, `${screen.id} has an unnamed action in a field`).toMatch(
          /aria-label="[^"]+"/,
        )
      }
    }

    expect(found, 'no field offers another way to answer it at all').toBeGreaterThan(0)
  })
})

/**
 * The one thing on a shelf that is a claim about a physical object.
 *
 * A page count is thickness, so it decides width. Height is uniform, because
 * the catalogue holds no height at all and the owner spotted that before this
 * was written.
 *
 * **This test used to say a width comes off a book or it does not get drawn**,
 * and it is now allowed one exception, on purpose rather than by being relaxed.
 * 183 of the owner's 238 books carried a page count on 2026-08-12, so a quarter
 * of a shelf has no honest width, and the fallback he chose is the median of
 * the ones that do. The exception is therefore pinned harder than the rule: it
 * is not a free number, it is `MEDIAN_PAGES` and nothing else, it sits strictly
 * inside the range real books occupy, and a shelf drawn from it varies. The way
 * this loosens is somebody picking a round number that "looks about right", and
 * the second test below is what goes red when they do.
 */
describe('a spine is only as big as the catalogue can justify', () => {
  it('is wider for a thicker book, always', () => {
    expect(spineWidth(120)).toBeLessThan(spineWidth(320))
    expect(spineWidth(320)).toBeLessThan(spineWidth(900))
  })

  it('stays inside what a phone can draw, at both ends', () => {
    expect(spineWidth(1)).toBeGreaterThanOrEqual(16)
    expect(spineWidth(20000)).toBeLessThanOrEqual(56)
  })

  it('draws a book with no page count at the median and at nothing else', () => {
    expect(spineWidth(undefined)).toBe(spineWidth(MEDIAN_PAGES))
    expect(spineWidth(undefined)).not.toBe(spineWidth(54))
    expect(spineWidth(undefined)).not.toBe(spineWidth(1168))
  })

  it('keeps that fallback inside the range the real catalogue covers', () => {
    // 54 and 1168 are the thinnest and thickest books he owns. A fallback
    // outside them would be a book nobody has, which is the visibly-different
    // width this decision rejected.
    expect(spineWidth(undefined)).toBeGreaterThan(spineWidth(54))
    expect(spineWidth(undefined)).toBeLessThan(spineWidth(1168))
  })

  it('draws every book the same height, and offers no other answer', () => {
    const shelf = readFileSync(join(HERE, 'Shelf.tsx'), 'utf8')

    // Flat tops, settled. The variant that estimated a height from the shape of
    // a spine photograph is gone, and the way it comes back is a second prop.
    expect(shelf).not.toMatch(/spineHeight/)
    expect(shelf).not.toMatch(/heights/)
    expect(shelf).not.toMatch(/ratio[?:]/)
    expect(shelf.match(/height: SPINE_HEIGHT/g)?.length).toBe(1)
  })
})

/**
 * The gallery's own books have the same holes in them the real ones do.
 *
 * A fixture where every book has a page count draws a shelf that does not
 * exist, and it would make the fallback width the one piece of this system that
 * only ever appears in a test. So `spines` leaves roughly one name in four
 * without a count, and this is here because filling them back in is a helpful
 * edit somebody would make without knowing what it hides.
 */
describe('a shelf in the gallery is missing the page counts a real one is', () => {
  it('leaves about a quarter of thirty books without one', () => {
    const thirty = spines([
      'Adams, Douglas',
      'Atwood, Margaret',
      'Banks, Iain M.',
      'Bradbury, Ray',
      'Calvino, Italo',
      'Chambers, Becky',
      'Clarke, Susanna',
      'Eco, Umberto',
      'Ellison, Ralph',
      'Ferrante, Elena',
      'Gaiman, Neil',
      'Greene, Graham',
      'Harkaway, Nick',
      'Ishiguro, Kazuo',
      'Jemisin, N. K.',
      'Le Guin, Ursula K.',
      'Mantel, Hilary',
      'Miéville, China',
      'Mitchell, David',
      'Morrison, Toni',
      'Murakami, Haruki',
      'Nabokov, Vladimir',
      "O'Brian, Patrick",
      'Pratchett, Terry',
      'Robinson, Marilynne',
      'Smith, Zadie',
      'Stephenson, Neal',
      'Tartt, Donna',
      'Woolf, Virginia',
      'Zusak, Markus',
    ])

    const missing = thirty.filter(
      (item) => item.kind === 'spine' && item.pages === undefined,
    ).length

    expect(missing, 'every book in the gallery has a page count').toBeGreaterThan(3)
    expect(missing, 'the gallery is mostly books nobody has looked up').toBeLessThan(11)
  })
})

/**
 * The stop before an area goes, which is the one place this design system is
 * allowed to explain itself at length.
 *
 * > I think deleting an area, we should show a pop up that explains to them
 * > what's gonna happen with the books, so they can decide whether they wanna
 * > do that or not.
 *
 * Three things are checked and each one is a different way this comes back
 * wrong six months from now.
 *
 * **A dialog that talks about books in general.** "Books will be reassigned"
 * is the sentence somebody writes when they are describing the feature rather
 * than answering the question, and it is what the count is for: the owner is
 * deciding about his own twenty-four books, not about a policy. So every
 * dialog title carries a number and the word it counts.
 *
 * **A dialog whose safe answer is the easy one to miss.** The destructive
 * button comes first and the one that changes nothing is beside it, which is
 * `ConfirmDialog`'s arrangement in the working app and is checked here rather
 * than described, because the order is the sort of thing a tidy-up reverses.
 *
 * **A way in that quietly disappears.** There was no way to remove an area
 * anywhere in the interface at all until #281, which is how this started; a
 * refactor that loses the button leaves the dialogs drawn and unreachable, and
 * the screens would still all render.
 */
describe('removing an area explains itself before it happens', () => {
  const drawn = (id: string) => {
    const screen = SCREENS.find((one) => one.id === id)
    expect(screen, `there is no screen called "${id}"`).toBeDefined()
    return renderToStaticMarkup(screen!.render(() => {}))
  }

  const asked = SCREENS.filter((screen) =>
    renderToStaticMarkup(screen.render(() => {})).includes('class="wf-sure"'),
  )

  it('is offered on the area screen itself', () => {
    const markup = drawn('area')
    const danger = markup.match(/<button[^>]*wf-btn--danger[^>]*>/g) ?? []

    expect(danger.length, 'the area screen offers no way to remove it').toBe(1)
    expect(words(markup)).toMatch(/Remove this area/)
  })

  it('says it about their books, with the count, in every state', () => {
    expect(asked.length, 'no screen draws the dialog at all').toBeGreaterThan(2)

    for (const screen of asked) {
      const title = renderToStaticMarkup(screen.render(() => {})).match(
        /<h2 class="wf-sure__title">([^<]+)<\/h2>/,
      )?.[1]

      expect(title, `${screen.id} draws a dialog with no title`).toBeDefined()
      expect(title, `${screen.id} does not count the books`).toMatch(/\d/)
      expect(title, `${screen.id} does not say what it is about`).toMatch(/books/i)
    }
  })

  it('puts the destructive answer first and the safe one beside it', () => {
    for (const screen of asked) {
      const markup = renderToStaticMarkup(screen.render(() => {}))
      const acts = markup.slice(markup.indexOf('class="wf-sure__acts"'))

      expect(acts, `${screen.id} has no way out of the dialog`).toMatch(/Keep it/)
      expect(
        acts.indexOf('wf-btn--danger'),
        `${screen.id} draws the safe answer after the dangerous one`,
      ).toBeLessThan(acts.indexOf('Keep it'))
    }
  })

  /**
   * The first area on a piece has nothing before it, and a dialog that says
   * its books join "the area before" is promising something the app cannot do
   * at the top of every piece of furniture in the room. The promise is made in
   * the title, so that is where this looks, and it is checked positively as
   * well: the title names the area they do join.
   *
   * The body is deliberately left out of it. Saying "the area after it rather
   * than the one before" is the sentence that makes the difference legible to
   * somebody who has seen the ordinary dialog, and a check that forbade the
   * words would be forbidding the explanation this issue asked for.
   */
  it('never promises an area before the first one', () => {
    const markup = drawn('removefirst')
    const title = markup.match(/<h2 class="wf-sure__title">([^<]+)<\/h2>/)?.[1]

    expect(title, 'the first area claims to join something before it').not.toMatch(/before/i)
    expect(title, 'the first area does not say where its books go').toMatch(
      /join By the window · B/,
    )
    expect(markup, 'the shuffle of labels is described rather than drawn').toMatch(
      /wf-sure__becomes/,
    )
  })
})

/**
 * A book a rule change displaced is put back by the screen a new book is put
 * back by.
 *
 * > There needs to be a flow inside the application to look at all those books
 * > that are marked as needing to be moved and be able to go through and
 * > reshelve each one [...] the same way as whenever we're initially shelving
 * > them.
 *
 * The owner has said twice that he likes the where-it-goes screen, and #291
 * asks for it rather than for a second one. `screens.tsx` obeys that
 * structurally, with one `Placing` called by both, and the way that comes apart
 * is somebody hand-building the carry version to add one thing to it: a
 * heading, a count, a button above the drawing. Then the two drift for a year.
 *
 * So this pins the shape rather than the call: the sentence naming the
 * neighbours, the area drawn with the gap in it, the book in the hand, and the
 * answer, in that order, on both. Anything that reorders or drops one of the
 * four is a second implementation whatever it is spelled as.
 */
describe('a carried book is placed by the screen a new book is placed by', () => {
  const marks = ['wf-instruction', 'wf-gap', 'wf-shelf__inhand', 'wf-btn--primary']

  it('draws the same four things in the same order on both', () => {
    for (const id of ['where', 'carrying']) {
      const screen = SCREENS.find((one) => one.id === id)
      expect(screen, `there is no screen called "${id}"`).toBeDefined()

      const markup = renderToStaticMarkup(screen!.render(() => {}))
      const at = marks.map((mark) => markup.indexOf(mark))

      expect(at, `${id} is missing one of ${marks.join(', ')}`).not.toContain(-1)
      expect([...at].sort((a, b) => a - b), `${id} draws them in another order`).toEqual(at)
    }
  })
})

/**
 * A pill with no word in it is a colour, and this system does not tell anybody
 * anything with a colour.
 *
 * The rule is older than the pills: it is what the corner action, the view
 * switcher and every dot in a strip of photographs are each checked for
 * separately, and #363 is the round that made it worth stating generally. A
 * queue row is now three pills and no prose, so three facts a person acts on
 * are carried by small boxes, and the cheapest way to lose one is a helpful
 * edit that keeps a tint and drops the word inside it.
 *
 * Two of the three pills on that row are tinted for exactly one reason each,
 * and both reasons are about the screen rather than the thing: a tag narrowing
 * what you are looking at, and a book saying it needs a person. Neither is
 * allowed to be the only thing said. Checked on every screen rather than on the
 * queue, because the next pill is the one this is really for.
 */
describe('a pill says what it is, and is never only a colour', () => {
  it('is true of every pill on every screen', () => {
    let found = 0

    for (const screen of SCREENS) {
      const markup = renderToStaticMarkup(screen.render(() => {}))
      for (const pill of markup.match(/<(span|button) class="wf-tag[^"]*".*?<\/\1>/gs) ?? []) {
        found += 1
        expect(words(pill).trim(), `${screen.id} draws a pill with no word in it`)
          .not.toBe('')
      }
    }

    expect(found, 'no screen draws a pill at all').toBeGreaterThan(4)
  })
})

/**
 * A person who is not let in is offered the one thing that is theirs, and
 * nothing that pretends to be.
 *
 * #524 is explicit about what this screen owes somebody. They have signed in,
 * proved exactly who they are, done nothing wrong, and can do nothing about it,
 * and what they can see the edge of is somebody else's collection. So the
 * screen says what happened, says the owner is the one who can change it, and
 * offers a way out.
 *
 * **The thing to keep out is a second button**, and it is the one somebody will
 * add. A "try again" here is the login loop #521 warned about with a coat of
 * paint on it: the request that would be retried is the one that has just
 * answered `403`, and it will answer `403` again until a decision is made in a
 * different place. There is exactly one thing to press on this screen and it is
 * the way out.
 *
 * The address is checked too. It is not decoration: it is what makes signing
 * out worth offering to somebody who arrived on the wrong account, and without
 * it the button is a way to lose a session for no stated reason.
 */
describe('the screen for somebody who is signed in and not let in', () => {
  const waiting = () => {
    const screen = SCREENS.find((one) => one.id === 'waiting')
    expect(screen, 'the waiting screen is not in the gallery').toBeTruthy()
    return renderToStaticMarkup(screen!.render(() => {}))
  }

  it('offers exactly one thing to press, and it is the way out', () => {
    const markup = waiting()
    const buttons = markup.match(/<button/g) ?? []

    expect(buttons.length, 'a second press on the waiting screen').toBe(1)
    expect(words(markup)).toMatch(/\bSign out\b/)
  })

  it('says who this browser is signed in as', () => {
    expect(words(waiting())).toMatch(/Signed in as \S+@\S+/)
  })

  it('says the owner is the one who lets somebody in', () => {
    // Not "an administrator" and not "support": the whole shape of #510 is that
    // there is one person, and a script they run, and no role anywhere.
    expect(words(waiting())).toMatch(/\bowns\b/)
  })

  it('is not the sign-in screen wearing different words', () => {
    // The failure this issue exists to prevent, said as a drawing: somebody
    // holding a good session must never be offered a way to sign in again.
    expect(words(waiting())).not.toMatch(/Continue with/)
  })

  it('wears no tab bar, because there is nowhere it could go', () => {
    expect(waiting()).not.toMatch(/wf-tab(?: |")/)
    expect(renderToStaticMarkup(
      SCREENS.find((one) => one.id === 'wayin')!.render(() => {}),
    )).not.toMatch(/wf-tab(?: |")/)
  })
})

/**
 * The way in draws the answer, and there is no list of providers in the client.
 *
 * `GET /api/auth/providers` says which buttons there are, which is what makes
 * adding Microsoft later a configuration change rather than a screen change.
 * The gallery draws it twice for that reason, so the claim is a thing somebody
 * can look at rather than a sentence in a comment.
 */
describe('the way in', () => {
  const drawn = (id: string) => renderToStaticMarkup(
    SCREENS.find((one) => one.id === id)!.render(() => {}),
  )

  it('draws one press per way in, and the second one changes nothing else', () => {
    expect((drawn('wayin').match(/<button/g) ?? []).length).toBe(1)
    expect((drawn('wayintwo').match(/<button/g) ?? []).length).toBe(2)
  })

  it('does not tell the development door apart from any other', () => {
    // #524: "Do not special-case it in the client; if it needs distinguishing,
    // the server should say so." Both buttons are drawn the same way, and what
    // separates them is the label the server sent.
    const markup = drawn('wayintwo')
    const classes = [...markup.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1])

    expect(new Set(classes).size, 'one of the doors is drawn differently').toBe(1)
  })
})

describe('the gallery', () => {
  it('renders every screen to markup', () => {
    for (const screen of SCREENS) {
      expect(renderToStaticMarkup(screen.render(() => {})).length).toBeGreaterThan(400)
    }
  })

  it('gives every screen an id of its own', () => {
    const ids = SCREENS.map((screen) => screen.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

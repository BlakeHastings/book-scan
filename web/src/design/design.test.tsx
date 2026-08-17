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
import { InHand, IN_HAND } from './Controls'
import { SCREENS } from './gallery/screens'
import { MEDIAN_PAGES, spineWidth, spines } from './Shelf'

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
 * page with one section on it is that screen wearing a different heading.
 *
 * Deliberately not a measurement of how tall the section is. Pixels are not
 * available here, and a character count of markup would fail on somebody
 * writing a longer sentence, which is not the thing being protected. What is
 * protected is the order and the count: the book itself is drawn before the
 * page says where it sits, and where it sits is one of several sections.
 */
describe('a book screen is about the book, not about where it sits', () => {
  const BOOKS = ['book', 'thin']

  it('draws several sections, and the book before where it is', () => {
    for (const id of BOOKS) {
      const screen = SCREENS.find((one) => one.id === id)
      expect(screen, `there is no screen called "${id}"`).toBeDefined()

      const markup = renderToStaticMarkup(screen!.render(() => {}))
      const heads = [
        ...markup.matchAll(/<section class="wf-part" aria-label="([^"]+)"/g),
      ].map((found) => found[1])

      expect(heads.length, `${id} draws ${heads.length} sections`).toBeGreaterThanOrEqual(4)
      expect(heads, `${id} never says where the book is`).toContain('Where it is')

      const book = markup.indexOf('class="wf-book"')
      const where = markup.indexOf('aria-label="Where it is"')
      expect(book, `${id} never draws the book itself`).toBeGreaterThan(-1)
      expect(where, `${id} says where the book is before saying what it is`).toBeGreaterThan(
        book,
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
 * Checked as the order of the section headings rather than as a list of what
 * the sections contain, because the headings are what a person scrolling reads
 * and they are what the owner named. The three that moved are all here: the
 * tags went up under the ISBN, the actions went up above everything about
 * where the book is, and "who wrote it" became "more by this author" and went
 * to the bottom with the same content under it.
 */
describe('a book page puts what you can do above where the book sits', () => {
  const BOOKS = ['book', 'thin']

  const headsOf = (id: string) => {
    const screen = SCREENS.find((one) => one.id === id)
    expect(screen, `there is no screen called "${id}"`).toBeDefined()
    const markup = renderToStaticMarkup(screen!.render(() => {}))
    return [...markup.matchAll(/<section class="wf-part" aria-label="([^"]+)"/g)].map(
      (found) => found[1]!,
    )
  }

  it('draws the tags, then the actions, then everything about where it is', () => {
    for (const id of BOOKS) {
      const heads = headsOf(id)
      const at = (head: string) => {
        expect(heads, `${id} has no section called "${head}"`).toContain(head)
        return heads.indexOf(head)
      }

      expect(at('What it is about'), `${id} leads with something other than the book`).toBe(0)
      expect(at('What you can do')).toBeGreaterThan(at('What it is about'))
      expect(at('Where it is')).toBeGreaterThan(at('What you can do'))
      expect(at('Where it has been')).toBeGreaterThan(at('Where it is'))
      expect(at('More by this author')).toBeGreaterThan(at('Where it has been'))
    }
  })

  it('has no section left called "who wrote it", which is what that one was', () => {
    for (const id of BOOKS) {
      expect(headsOf(id), `${id} still asks who wrote it`).not.toContain('Who wrote it')
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
 * ## The one exception, and it is pinned as an exception (#355)
 *
 * There is one door on this screen and it is the way to the *other* camera:
 * the one you point at a book you already own. It is here because the rule
 * above is about doors to rooms the tab bar already opens, and no tab opens
 * that one. It lost this screen's corner to the portrait and went from one
 * press to three without anybody choosing that, and one press is what the
 * owner already approved.
 *
 * What is pinned is that there is **exactly one** of them, so the answer to
 * "may this screen have a button on it" stays no for everything else, and that
 * it goes to the book in your hand rather than to a room with a tab. The
 * wording is checked because the wording is the only thing that says which of
 * the two cameras it is, and getting that wrong is the fault that costs
 * somebody a book catalogued twice.
 */
describe('the first screen is counts, and every count goes somewhere', () => {
  const home = () => {
    const screen = SCREENS.find((one) => one.id === 'home')
    expect(screen, 'there is no screen called "home"').toBeDefined()
    return renderToStaticMarkup(screen!.render(() => {}))
  }

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

  it('has one door on it, and it is the book in your hand', () => {
    const markup = home()
    const doors = markup.match(/class="wf-inhand"/g) ?? []

    expect(doors.length, `the first screen draws ${doors.length} of these`).toBe(1)
    expect(words(markup), 'the door does not say which camera it opens').toContain(IN_HAND)
  })

  it('is one press from the camera that reads a book you already own', () => {
    // The measurement #355 exists to restore, taken the way that issue takes
    // it: from this screen, with nothing opened first. A door that was named
    // right and landed somewhere else would pass every check above and still
    // be the regression, so what is pinned is where pressing it goes.
    let went = ''
    const screen = SCREENS.find((one) => one.id === 'home')!
    const door = findIn(screen.render((to) => { went = to }), InHand)

    expect(door, 'the first screen has no way to the book in your hand').toBeDefined()
    ;(door!.props as { onPress?: () => void }).onPress?.()

    expect(went, 'the first screen presses through to the wrong screen').toBe('inhand')
    expect(SCREENS.some((one) => one.id === went), 'it goes nowhere').toBe(true)
  })
})

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
    for (const id of ['book', 'thin']) {
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
    for (const id of ['book', 'thin']) {
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
    for (const id of ['book', 'thin']) {
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

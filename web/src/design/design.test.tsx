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
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SCREENS } from './gallery/screens'
import { spineHeight, spineWidth } from './Shelf'

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
})

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
 * was the arrangement here for two rounds. What cannot be checked from markup
 * is that a swipe works, and that is deliberate; there is no gesture behind
 * the drawing and this test does not pretend there is one.
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
 * The one thing on a shelf that is a claim about a physical object.
 *
 * A page count is thickness, so it decides width. Height is uniform unless a
 * photograph says otherwise, because the catalogue holds no height at all and
 * the owner spotted that before this was written.
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

  it('is the uniform height for a book with no photograph', () => {
    expect(spineHeight(320, undefined)).toBe(116)
    expect(spineHeight(undefined, 8)).toBe(116)
  })

  it('never draws a book outside the range real books live in', () => {
    for (const pages of [24, 320, 1400]) {
      for (const ratio of [0.5, 8, 40]) {
        const height = spineHeight(pages, ratio)
        expect(height).toBeGreaterThanOrEqual(96)
        expect(height).toBeLessThanOrEqual(140)
      }
    }
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

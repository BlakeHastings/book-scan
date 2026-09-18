/**
 * Rendered as markup rather than driven in a browser: this project has no DOM
 * in its test setup and no screen here holds state.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AA_BODY_TEXT, AA_NON_TEXT, BEHIND, contrast, over, parse, type Rgb } from './contrast'
import { Doors, InHand, IN_HAND } from './Controls'
import { SCREENS, TAB_SCREENS, type Go, type Screen } from './gallery/screens'
import { MEDIAN_PAGES, spineWidth, spines } from './Shelf'
import { Shots, deckOrder, threeSlots, type Shot } from './Shots'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

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

/** Every definition of a custom property in `tokens.css`, in file order. */
function token(name: string): string[] {
  const css = readFileSync(join(HERE, 'tokens.css'), 'utf8')
  return [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))].map((m) => m[1]!.trim())
}

/**
 * `library.css` as a list of rules. The comments come out first, because prose
 * in that file quotes selectors and properties that are not declarations.
 */
function rules(): { selector: string; body: string }[] {
  const css = readFileSync(join(HERE, 'library.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector!.trim(), body: body! }))
}

describe('a word on the picture can be read whatever the lens is pointed at', () => {
  /**
   * The two beds a word on this screen is allowed to be written on:
   * `--picture` is opaque and lets nothing through, and `--picture-scrim` is
   * the one every floating control paints for itself.
   */
  const BEDS = [
    { bed: '--picture-scrim', what: 'the bed under every floating control' },
    { bed: '--picture', what: 'the opaque one, under a sheet or a pressed chip' },
  ]

  it.each(BEDS)('$bed: $what', ({ bed }) => {
    const values = token(bed)
    /*
     * One value and no second one under a dark block: what is behind these is a
     * photograph rather than a page, so a colour that followed the phone's theme
     * would disappear on somebody's black paperback.
     */
    expect(new Set(values).size, `${bed} changes with the theme`).toBe(1)

    const ink = parse(token('--picture-ink')[0]!)
    const paint = parse(values[0]!)

    for (const behind of BEHIND) {
      const laid = over(paint, behind)
      const ratio = contrast(over(ink, laid), laid)
      expect(
        ratio,
        `--picture-ink on ${bed} is ${ratio.toFixed(2)} to 1 over rgb(${behind.join(',')})`,
      ).toBeGreaterThanOrEqual(AA_BODY_TEXT)
    }
  })

  /*
   * `opacity` on something that beds itself thins the bed at exactly the rate
   * it thins the ink, so on a photograph it cannot demote a word, only hide it.
   * It has to follow the class rather than the rule, because the fade and the
   * bed are routinely written in different rules for the same element.
   *
   * `:disabled` is the one carve-out and it is WCAG's own: 1.4.3 exempts an
   * inactive component, and a control faded because it cannot be pressed is
   * saying so with the fade.
   */
  it('is not undone by fading something that beds itself', () => {
    const found = rules()

    const classesIn = (selector: string): string[] =>
      [...selector.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((found) => found[1]!)

    const bedded = new Set(
      found
        .filter(({ body }) => /background:\s*var\(--picture-scrim\)/.test(body))
        .flatMap(({ selector }) => classesIn(selector)),
    )
    expect(bedded.size, 'nothing beds itself on the scrim at all').toBeGreaterThan(3)

    /** A modifier of a bedded class is the same element, so it counts. */
    const isBedded = (name: string): boolean =>
      [...bedded].some((one) => name === one || name.startsWith(`${one}--`))

    const faded = found
      .filter(({ body }) => /(^|[\s;])opacity\s*:/.test(body))
      .filter(({ selector }) => !selector.includes(':disabled'))
      .filter(({ selector }) => classesIn(selector).some(isBedded))
      .map(({ selector }) => selector)

    expect(faded, 'these fade the bed they are standing on').toEqual([])
  })
})

/*
 * A frame is aimed with rather than read, so the threshold here is WCAG
 * 1.4.11's 3 to 1 and not 1.4.3's 4.5 to 1.
 *
 * It measures `.wf-view__guide` and nothing else. The three modifiers beside it
 * are drawings of the candidates and two of them fail this on purpose, so a
 * rule that swept up every selector mentioning the guide would have to be
 * switched off to draw the argument for itself.
 */
describe('the frame you aim the book inside can be seen whatever the lens is pointed at', () => {
  const guide = (): { selector: string; body: string } => {
    const found = rules().find(({ selector }) => selector === '.wf-view__guide')
    expect(found, 'nothing in library.css draws .wf-view__guide any more').toBeDefined()
    return found!
  }

  /**
   * Not implied by the ratio check below. One ring passes the ratios, at the
   * cost of a line 3px thick where the tones fall its way and 1.5px where they
   * do not, so the edge somebody is lining a book up against changes weight
   * along its own length. The second ring buys not having to know which side of
   * the line the book is on, which is a fact about a room.
   */
  it('carries a second tone on both sides of the line', () => {
    const { body } = guide()
    const shadow = body.match(/box-shadow:([^;]+);/)?.[1] ?? ''
    const layers = shadow.split(/,(?![^()]*\))/).map((one) => one.trim()).filter(Boolean)

    expect(
      layers.filter((one) => !one.startsWith('inset')),
      'the frame has no tone outside it, so it disappears into a dark room',
    ).not.toEqual([])
    expect(
      layers.filter((one) => one.startsWith('inset')),
      'the frame has no tone inside it, so it disappears into a white page',
    ).not.toEqual([])
  })

  /**
   * A `max` and not a `min` on purpose: a two-tone line is legible when either
   * of its tones clears the threshold, and no one colour is at once light
   * enough for black and dark enough for white.
   */
  it.each(BEHIND)('is at least 3 to 1 over rgb(%s, %s, %s)', (...behind) => {
    const { body } = guide()
    /* `[0-9]` is not padding: `--picture-ink-2` is a real token and a plausible
       thing to reach for here, and a pattern that could not spell it would have
       counted it as no tone at all rather than as a failing one. */
    const tones = [...new Set(
      [...body.matchAll(/var\((--picture-[a-z0-9-]+)\)/g)].map((m) => m[1]!),
    )]

    expect(
      tones.length,
      'the frame is drawn in one tone, which is fine at one end of a photograph and gone at the other',
    ).toBeGreaterThanOrEqual(2)

    const ratios = tones.map((name) => {
      /* One value and no second one under a dark block: what is behind this
         frame is a photograph rather than a page, and a photograph is not a
         theme. */
      const values = token(name)
      expect(new Set(values).size, `${name} changes with the theme`).toBe(1)

      const paint = parse(values[0]!)
      return { name, ratio: contrast(over(paint, behind as Rgb), behind as Rgb) }
    })
    const best = ratios.reduce((a, b) => (a.ratio > b.ratio ? a : b))

    expect(
      best.ratio,
      `the best the frame manages over rgb(${behind.join(',')}) is ${best.name} at `
      + `${best.ratio.toFixed(2)} to 1`,
    ).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })
})

describe('the shelf has one edge', () => {
  it('is true because the board draws no pseudo-element beside its border', () => {
    const css = readFileSync(join(HERE, 'library.css'), 'utf8')

    expect(css).not.toMatch(/\.wf-shelf__board\s*::?(before|after)/)
    expect(css.match(/\.wf-shelf__board\s*\{[^}]*border-bottom/)).not.toBeNull()
  })
})

/**
 * Every word `docs/shelving.md` and the schema use for something a person owns
 * or does, in the spelling the code uses rather than the one a person would.
 *
 * Bookcase, area, book and fixture are deliberately not on it: those are the
 * words a person actually uses about their own room, whatever else they also
 * name. Neither is "shelve", which is what you do with a book rather than
 * "shelf", which is on it.
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
 * A tag's `slug` is its identity and its `label` is what a person reads, and
 * the hierarchy lives in the slug, so a slug on a screen is a row id on a
 * screen. Matched by shape rather than against a list of known slugs, because
 * the next slug is the one that gets rendered by accident.
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
 * Four is the count, and it is checked on the rendered markup rather than on
 * the array, because the array is not what a person taps.
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

    // Without this the loop above passes by finding nothing.
    expect(found, 'no screen draws a corner action at all').toBeGreaterThan(1)
  })
})

/**
 * `renderToStaticMarkup` has no layout and no scroll position, so a markup
 * assertion cannot tell whether a sheet lands on the glass or above where
 * somebody is looking. What is checked instead is the one line that decides
 * which of those happens.
 */
describe('the corner opens onto the glass, not onto wherever the document happens to be scrolled', () => {
  /*
   * Every sheet that opens over a screen, not only the corner, because the next
   * sheet is the one this is really for.
   *
   * `absolute` is not the only way to fail it. A sticky box is pinned only
   * while its containing block is under it, so `sticky` puts a box back in the
   * document's hands the moment the document is taller than whatever it is
   * nested in.
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
   * A fixed bar reserves no room, so unless something keeps the bottom of every
   * screen clear the last card goes under it. `--tabs` is that number, and this
   * is the check that both ends still read the same one.
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
 * Checked as the general rule, a glyph with a name on it, rather than against
 * three known labels, because the next switcher is the one this is really for.
 * The filter row is checked too, deliberately: the switcher was asked to move
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
 * Deliberately not a measurement of how tall the section is. Pixels are not
 * available here, and a character count of markup would fail on somebody
 * writing a longer sentence, which is not the thing being protected.
 */
describe('a book screen is about the book, not about where it sits', () => {
  /* The notice at the top of one of the details screens is the only thing on a
     book screen allowed to be about where the book sits, and it survives that
     by being an instruction. */
  const BOOKS = ['book', 'thin', 'lone', 'details', 'amiss', 'detailsout']

  it('draws the book, its facts, its tags and its actions before the place', () => {
    for (const id of BOOKS) {
      const screen = SCREENS.find((one) => one.id === id)
      expect(screen, `there is no screen called "${id}"`).toBeDefined()

      const markup = renderToStaticMarkup(screen!.render(() => {}))
      const where = markup.indexOf('aria-label="Where it is"')
      expect(where, `${id} never says where the book is`).toBeGreaterThan(-1)

      /* Named individually so a failure says which of them slipped below the
         place. */
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
   * written on the screen, and that is deliberate. A sighted reader has the
   * board in front of them; a screen reader has a run of spines and nothing
   * saying what the run is.
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
 * The order is the decision rather than a layout: what a book is about, then
 * what you can do with it, then where it sits, then the rest of the author.
 * Read off the order things are drawn in rather than off the headings, because
 * the page has one heading left on it.
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
   * Checked as words on the screen rather than as sections, because the way one
   * of them comes back is somebody writing the sentence again somewhere
   * slightly different.
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
   * The sentence had a class of its own, so the cheapest proof it has not been
   * rewritten shorter is that the class is nowhere: not in a screen, and not in
   * the stylesheet waiting for one.
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
 * This system says nothing with a hue: the words carry the meaning and the
 * colour is emphasis. So what is checked is that the notice still reads with
 * every class and every attribute stripped off it, which is what greyscale is,
 * and separately that no rail was painted down its side.
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
    expect(
      noticeOn('amiss').match(/<button/g) ?? [],
      'the notice holds an answer of its own',
    ).toHaveLength(1)
  })

  it('says what is wrong in words, so it reads with the colour taken out', () => {
    const said = words(noticeOn('amiss')).replace(/\s+/g, ' ').trim()

    expect(said, 'the notice says nothing without its paint')
      .toMatch(/supposed to be moved/i)
    /* One sentence, and the full stop count is what pins it rather than the
       length. */
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
 * An outline is painted outside the element it is on, and a run scrolls inside
 * itself, so anything drawn around the books is drawn outside the run and
 * clipped. The mark therefore stands on the book and takes its room from inside
 * the board, and the room kept above it is the cat's own height rather than a
 * second number that agrees with it today.
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
    // Every other outline in the stylesheet is `none` with a shadow instead, so
    // nothing needs `outline-offset` and this stays a one-line check.
    expect(css).not.toMatch(/outline-offset/)
  })
})

/**
 * Three doors is a ceiling rather than a count, and none of them may go where a
 * tab already goes: a room the tab bar opens is one press from here whatever
 * this screen does, so a door to it is the camera card under another name.
 *
 * The wording of the one door to the camera is checked because it is the only
 * thing that says which of this app's two cameras it opens.
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

  it('says the counts in one ungrouped run, with no heading over them', () => {
    const markup = home()
    const said = [...markup.matchAll(/class="wf-stat__word">([^<]+)</g)].map((one) => one[1])

    expect(markup, 'the first screen has a heading on it again').not.toMatch(/wf-heading/)
    expect(said, 'the counts are not the five he named, in his order').toEqual([
      'catalogued', 'checked out', 'ready to shelve', 'to carry', 'stuck',
    ])
  })

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
    // A door that was named right and landed somewhere else would pass every
    // check above, so what is pinned here is where pressing it goes.
    let went = ''
    const door = findIn(screen().render((to) => { went = to }), InHand)

    expect(door, 'the first screen has no way to the book in your hand').toBeDefined()
    ;(door!.props as { onPress?: () => void }).onPress?.()

    expect(went, 'the first screen presses through to the wrong screen').toBe('inhand')
    expect(SCREENS.some((one) => one.id === went), 'it goes nowhere').toBe(true)
  })
})

/**
 * Every door on a screen, as elements that can still be pressed. They are the
 * children of the one `Doors` on the screen rather than a search for a
 * component type, so a door added as some other component is covered without
 * anybody remembering to name it here.
 */
function doorsOf(screen: Screen, go: Go = () => {}): ReactElement[] {
  const list = findIn(screen.render(go), Doors)
  if (!list) return []

  const inside = (list.props as { children?: ReactNode }).children
  return (Array.isArray(inside) ? inside : [inside]).filter((one) => isValidElement(one))
}

/**
 * The first element of a given kind in a drawn screen, or nothing. Rendered
 * markup cannot be pressed and this project's test setup has no DOM, so the
 * screen's own tree is walked instead.
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
 * An area is the unit a person owns and the unit a book is placed in, and this
 * app has never known which areas share a plank. So a row is an area, and every
 * row wears exactly one label.
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
 * A book has a name, an alias and a filing name behind it and no field for a
 * pronoun, so any sentence that picks one is inventing it.
 *
 * Bare "he" is deliberately not on the list. The comparison screens narrate the
 * owner's own choices back to him in the app's voice, which is a different
 * fault with a different fix.
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
      for (const dot of dots) expect(dot, `${id} has an unnamed dot`).toMatch(/aria-label="/)
    }
  })
})

/**
 * Both cases are pinned, the book with a downloaded cover and the book without
 * one, and they are pinned on the dots, which are what name the pictures in the
 * order a swipe reaches them.
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
   * The queue row draws this same component and hands it one photograph, so the
   * ordering cannot touch it: with one picture there is nothing at an index
   * above zero to bring to the front. Checked on the drawn row as well as on
   * the function.
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
 * The two screens differ on purpose. A book's own page draws a kind nobody has
 * photographed as an empty dashed box; this screen draws no frame at all for a
 * cover nobody downloaded. `SLOTS` is still the order the camera fills the
 * photographs in, which is why the spine leading here is pinned separately.
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

  /* A cloth and a photograph both count as a picture, the way they do
     everywhere else in this component, and neither counts when there is
     neither. */
  it('decides on the picture rather than on the caller remembering', () => {
    const spine: Shot = { word: 'Spine', sliver: true, cloth: 'moss' }
    const front: Shot = { word: 'Front', cloth: 'wood' }
    const back: Shot = { word: 'Back' }
    const ours = [front, back]

    const held: Shot = { word: 'Downloaded', catalogue: true, cloth: 'sky' }
    expect(threeSlots(spine, held, ours)).toEqual({ shots: [spine, held], deck: ours })

    const none: Shot = { word: 'Downloaded', catalogue: true }
    expect(threeSlots(spine, none, ours)).toEqual({ shots: [spine, front, back] })

    const real: Shot = { word: 'Downloaded', catalogue: true, photo: '/api/covers/x.jpg' }
    expect(threeSlots(spine, real, ours)).toEqual({ shots: [spine, real], deck: ours })
  })
})

/**
 * The view cannot be opened from here, so what is held is the four things it
 * rests on. The one that would go quietly is the crop: every other picture of a
 * book in this app is `object-fit: cover` on a crop, because a wall of
 * uncropped photographs is a wall of carpet, and this view is the exception.
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

    // The view is not open, so what is checked here is the door.
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
 * The row's markup is pinned here in full, so anything at all that leaks into
 * it fails, including the things nobody has thought of yet. If this fails, look
 * at what changed before changing the string: it is the record of a decision,
 * not a snapshot to be refreshed.
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
 * One fact behind both screens, `sliver` on the shot, so what is checked is
 * that each screen reads it rather than that either looks a particular way.
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
 * The target carries an icon and no word, so the check is the general one:
 * every action inside a field is named.
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
 * A page count is thickness, so it decides width. Height is uniform, because
 * the catalogue holds no height at all.
 *
 * A book with no page count is drawn at `MEDIAN_PAGES` and at nothing else, and
 * that exception is pinned harder than the rule because the way it loosens is
 * somebody picking a round number that looks about right.
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
    // 54 and 1168 are the thinnest and thickest books in the real catalogue. A
    // fallback outside them would be a book nobody has.
    expect(spineWidth(undefined)).toBeGreaterThan(spineWidth(54))
    expect(spineWidth(undefined)).toBeLessThan(spineWidth(1168))
  })

  it('draws every book the same height, and offers no other answer', () => {
    const shelf = readFileSync(join(HERE, 'Shelf.tsx'), 'utf8')

    // Flat tops. A second prop is the way a per-book height comes back.
    expect(shelf).not.toMatch(/spineHeight/)
    expect(shelf).not.toMatch(/heights/)
    expect(shelf).not.toMatch(/ratio[?:]/)
    expect(shelf.match(/height: SPINE_HEIGHT/g)?.length).toBe(1)
  })
})

/**
 * A fixture where every book has a page count draws a shelf that does not
 * exist, and it would make the fallback width the one piece of this system that
 * only ever appears in a test. Filling these counts back in is the helpful edit
 * this guards against.
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
 * Every dialog title carries a number and the word it counts, because somebody
 * is deciding about their own books rather than about a policy. The destructive
 * button comes first and the one that changes nothing is beside it, which is
 * `ConfirmDialog`'s arrangement in the working app.
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
   * The promise is made in the title, so that is where this looks, and it is
   * checked positively as well: the title names the area the books do join.
   *
   * The body is deliberately left out of it. Saying "the area after it rather
   * than the one before" is what makes the difference legible, and a check that
   * forbade the words would forbid the explanation.
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
 * `screens.tsx` draws both screens with one `Placing`, and this pins the shape
 * rather than the call: the sentence naming the neighbours, the area drawn with
 * the gap in it, the book in the hand, and the answer, in that order, on both.
 * A hand-built second version fails however it is spelled.
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
 * Checked on every screen rather than on the queue, because the next pill is
 * the one this is really for.
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
 * The thing to keep out is a second button. A "try again" here would retry the
 * request that has just answered 403, and it will answer 403 again until a
 * decision is made in a different place, so there is exactly one thing to press
 * on this screen and it is the way out.
 *
 * The address is what makes signing out worth offering to somebody who arrived
 * on the wrong account.
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
    // Not "an administrator" and not "support": there is one person, a script
    // they run, and no role anywhere.
    expect(words(waiting())).toMatch(/\bowns\b/)
  })

  it('is not the sign-in screen wearing different words', () => {
    // Somebody holding a good session must never be offered a way to sign in
    // again.
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
 * `GET /api/auth/providers` says which buttons there are, which is what makes
 * adding another provider a configuration change rather than a screen change.
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
    // Both doors are drawn the same way, and what separates them is the label
    // the server sent.
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

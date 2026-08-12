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

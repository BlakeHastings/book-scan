/**
 * The two rules the owner named, checked mechanically, plus the cheapest
 * possible proof that every screen in the gallery still renders.
 *
 * These are here because both rules are the kind that get broken by somebody
 * being helpful six months from now, in a file nobody re-reads. A paragraph in
 * a design document does not survive that; a red test does.
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

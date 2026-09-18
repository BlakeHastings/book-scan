/**
 * Back is where somebody came from, on every one of these screens.
 *
 * A screen that names its own way out is guessing on behalf of every
 * door into it: adding an area, an area, and what belongs in an area are
 * each reached from more than one place, and each was making the same
 * guess. So this is checked as a rule over the screens rather than as
 * one fixed destination in one file.
 *
 * Read as source rather than driven through the DOM: there is no DOM in
 * this project's test setup, so a walk of four screens and two presses
 * cannot be driven here at all; `design.test.tsx` pins its rules the
 * same way.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The screens `app/arranging.tsx` is about, and the trail is theirs. The
 * rule this file pins is not about these particular screens: it is that
 * no screen in this group names its own way out, and it applies to
 * whatever is in the group.
 */
const SCREENS = ['Furniture', 'Fixture', 'Area']

const source = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../screens/${name}Screen.tsx`, import.meta.url)), 'utf8')

describe('the way back off an arranging screen', () => {
  /**
   * `setRoute` is the guess: anything these screens do to the route goes
   * through the trail, so a second door into a screen is a call rather
   * than another branch in whichever screen draws the back arrow.
   */
  it.each(SCREENS)('is not a destination %s names for itself', (name) => {
    expect(source(name)).not.toMatch(/setRoute\(/)
  })

  it.each(SCREENS)('is drawn by %s as the screen that opened it', (name) => {
    // The room is the floor of the group and leaves it entirely, which
    // is its own remembered door and not a step on this trail.
    expect(source(name)).toMatch(/onBack=\{(\(\) => back\(|leaveRoom\})/)
  })

  /**
   * Each of the room, the piece and the area is reached from more than
   * one place, so every step between them has to be recorded, or `back`
   * cannot undo it.
   *
   * The room's own two doors go through `openFixture` and `openArea`, so
   * what is checked here is that it opens them at all rather than
   * reaching for the route.
   */
  it('is recorded by every screen that opens another one', () => {
    expect(source('Furniture')).toMatch(/onFixture=\{openFixture\}/)
    expect(source('Furniture')).toMatch(/onArea=\{openArea\}/)
    expect(source('Area')).toMatch(/onward\('fixture'\)/)
  })

  /**
   * The door from outside this group: the screen that says why a book is
   * where it is opens the rule on the area it points at, and back off
   * that is the book somebody was reading about.
   */
  it('is recorded by the screen that opens a rule from a book', () => {
    const claimed = readFileSync(
      fileURLToPath(new URL('../screens/ClaimedScreen.tsx', import.meta.url)),
      'utf8',
    )
    expect(claimed).toMatch(/onward\('area'\)/)
    expect(claimed).not.toMatch(/setRoute\(/)
  })

  /**
   * Adding an area is a write and not a step, so nothing is pushed onto
   * the trail by it and there is nothing to walk back out of.
   */
  it('is not grown by adding an area, which goes nowhere at all', () => {
    expect(source('Furniture')).toMatch(/api\.addArea\(/)
    expect(source('Furniture')).not.toMatch(/onward\(/)
  })
})

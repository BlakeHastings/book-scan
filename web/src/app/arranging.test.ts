/**
 * Back is where somebody came from, on every one of these screens.
 *
 * #367 was reported against one of them: "the back button does not seem to work
 * correctly. When I go back from an area that I'm attempting to add, it takes me
 * out to the edit page for the fixture I was attempting to add the area to. It
 * should just take us back to where we came from, which was the overall fixtures
 * view." The screen was not broken. It was doing exactly what it said, which was
 * `setRoute('fixture')`, and a screen that names its own way out is guessing on
 * behalf of every door into it.
 *
 * Adding an area is reached from the room and from an area; an area is reached
 * from the room; what belongs in an area is reached from an area and from the
 * screen that says why a book is where it is. **Every one of those was the same
 * guess**, which is why this is checked as a rule over the screens rather than
 * as one fixed destination in one file.
 *
 * ## Why it is read as source
 *
 * The rule is "no screen in this group names its own way back", and that is a
 * property of the files rather than of any one render. There is no DOM in this
 * project's test setup, so a walk of four screens and two presses cannot be
 * driven here at all; `design.test.tsx` pins its rules the same way, by reading
 * what the source does rather than by watching it do it.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The screens `app/arranging.tsx` is about, and the trail is theirs.
 *
 * **Three, where there were six** (#381). Adding an area stopped being a screen
 * and became a press; what belongs in a place and how it is ordered stopped
 * being screens that explained them and became two widgets on the page of the
 * place itself. The rule this file pins did not change with them: it was never
 * about six particular screens, it is that no screen in this group names its own
 * way out, and it applies to whatever is in the group.
 */
const SCREENS = ['Furniture', 'Fixture', 'Area']

const source = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../screens/${name}Screen.tsx`, import.meta.url)), 'utf8')

describe('the way back off an arranging screen', () => {
  /**
   * `setRoute` is the guess. Anything these screens do to the route goes
   * through the trail, so that a second door into a screen is a call rather
   * than another branch in whichever screen draws the back arrow.
   */
  it.each(SCREENS)('is not a destination %s names for itself', (name) => {
    expect(source(name)).not.toMatch(/setRoute\(/)
  })

  it.each(SCREENS)('is drawn by %s as the screen that opened it', (name) => {
    // The room is the floor of the group and leaves it entirely, which is its
    // own remembered door (#350) and not a step on this trail.
    expect(source(name)).toMatch(/onBack=\{(\(\) => back\(|leaveRoom\})/)
  })

  /**
   * The room, the piece and the area are each reached from more than one place,
   * so every step between them has to be recorded. A step that is not is a step
   * `back` cannot undo: it pops whatever the screen before had put there and
   * lands somebody two screens out.
   *
   * The room's own two doors go through `openFixture` and `openArea`, which is
   * the same trail with the ids set on the way through, so what is checked here
   * is that it opens them at all rather than reaching for the route.
   */
  it('is recorded by every screen that opens another one', () => {
    expect(source('Furniture')).toMatch(/onFixture=\{openFixture\}/)
    expect(source('Furniture')).toMatch(/onArea=\{openArea\}/)
    expect(source('Area')).toMatch(/onward\('fixture'\)/)
  })

  /**
   * And the door from outside this group: the screen that says why a book is
   * where it is opens the rule on the area it points at, and back off that is
   * the book somebody was reading about.
   *
   * **It lands on the area itself since #381.** What it used to open was the
   * screen that explained what belongs in an area, and there is no such screen:
   * the area's own page says it.
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
   * Adding an area is a write and not a step (#381), so nothing is pushed onto
   * the trail by it and there is nothing to walk back out of. The check is that
   * the room did not gain a route for it again: "it should just add the area."
   */
  it('is not grown by adding an area, which goes nowhere at all', () => {
    expect(source('Furniture')).toMatch(/api\.addArea\(/)
    expect(source('Furniture')).not.toMatch(/onward\(/)
  })
})

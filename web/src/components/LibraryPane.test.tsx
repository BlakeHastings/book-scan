/**
 * Finding stayed as easy to reach in the app as it was when it owned the corner.
 *
 * The corner became the profile icon (#350), so find moved down one row to the
 * filter the library already drew, and the whole risk in that trade was named
 * in #329: "losing a corner action and gaining a harder-to-find one is a
 * downgrade dressed as a tidy-up." `design.test.tsx` pins the requirement for
 * the drawing, on every gallery screen that lists books, and nothing pinned it
 * for the screen somebody actually uses.
 *
 * ## Why this reads the source rather than the markup
 *
 * `LibraryPane` fetches, holds a listing and sits inside four providers, so it
 * cannot be rendered as a tree the way `HomePane` and `SettingsPane` can. And
 * the failure this is really for would survive being rendered anyway: the round
 * target is drawn by `Filter` whether or not anything is handed to it, so a
 * library that forgot `onFind` would draw a search glyph, announce its name,
 * pass the design rule, and do nothing when pressed. That is a fact about a
 * call and the call is what is checked.
 *
 * It is deliberately about the requirement rather than about the arrangement.
 * If the owner would rather finding were a field, or a word, or back in the
 * corner, this goes red and is rewritten with the design, which is what a rule
 * one round old should do.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const source = (file: string) => readFileSync(join(HERE, file), 'utf8')

describe('finding, on the library screen somebody really uses', () => {
  it('is offered on the row above the books and goes somewhere', () => {
    const library = source('LibraryPane.tsx')

    expect(library, 'the library draws no filter row').toMatch(/<Filter/)
    expect(library, 'the filter row offers no way to find a book').toMatch(
      /onFind=\{\(\) => setRoute\('find'\)\}/,
    )
  })

  it('is not back in the corner, which is the profile icon now', () => {
    // Both halves matter. The corner is `room.action`, which is the menu; a
    // second target up there would be the corner carrying two things, and the
    // pinned rule is that it carries one.
    const library = source('LibraryPane.tsx')

    expect(library).toMatch(/action=\{room\.action\}/)
    expect(library, 'the library corner is a search glyph again').not.toMatch(/IconFind/)
  })
})

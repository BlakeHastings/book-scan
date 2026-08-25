/**
 * "It moved" is a walk, and it has to open the screen a walk ends on (#433).
 *
 * Driving the app as a person found it opening the form that corrects a record,
 * which offers check out, edit, back to library and delete and nothing at all
 * about where the book now is. Nothing happened and nothing said why.
 *
 * `docs/shelving.md`: "There is one way to say where a book is, not two." That
 * way is the shelving step, which is where a newly scanned book, a book coming
 * back off the table and the notice saying this one is supposed to be moved all
 * end up, and it is the only place `PATCH /api/books/:id/location` is called
 * from. So the button opens it.
 *
 * ## Why this reads the source rather than the markup
 *
 * The same reason `LibraryPane.test.tsx` gives, and it applies harder here:
 * `BookPane` fetches four times and sits inside four providers, so it cannot be
 * rendered as a tree. And the failure this is for would survive being rendered
 * anyway, because it was never about what the button looked like. The button
 * was on the screen, correctly worded, and wired to the wrong door. That is a
 * fact about a call, and the call is what is checked.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const source = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('saying a book has moved', () => {
  it('is offered on the book\'s own page', () => {
    expect(source('BookPane.tsx')).toContain('It moved')
  })

  /*
   * `openBook` is the door to the form. Three buttons on this page go through
   * it and they are all corrections; this one is not, and wiring it there is
   * the defect rather than an arrangement to prefer.
   */
  it('goes to the step that places a book, not to the form that corrects one', () => {
    const pane = source('BookPane.tsx')
    const press = pane.slice(pane.indexOf('It moved') - 400, pane.indexOf('It moved'))

    expect(press, 'it still opens the record form').not.toContain('openBook(book.id)')
    expect(press).toContain('moveBook(book.id)')
  })

  /* And the door itself goes there, so this is not two halves that agree. */
  it('and that door really is the shelving step', () => {
    expect(source('../app/openBook.ts')).toMatch(
      /const moveBook = async \(id: number\) => \{\s*if \(await openBook\(id\)\) setRoute\('shelve'\)/,
    )
  })

  /*
   * A book that could not be read is not a book in anybody's hands, and the
   * shelving step in front of somebody holding nothing is the failure this
   * would have if `openBook` answered nothing.
   */
  it('does not open it for a book that could not be picked up', () => {
    expect(source('../app/openBook.ts')).toContain('return false')
  })
})

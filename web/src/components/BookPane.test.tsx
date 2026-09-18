/** `BookPane` fetches four times and sits inside four providers, so it cannot be rendered as a tree; this reads the source instead. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const source = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('saying a book has moved', () => {
  it('is offered on the book\'s own page', () => {
    expect(source('BookPane.tsx')).toContain('It moved')
  })

  // `openBook` is the door to the correction form; the other three buttons on
  // this page go through it, but moving is not a correction.
  it('goes to the step that places a book, not to the form that corrects one', () => {
    const pane = source('BookPane.tsx')
    const word = /\n\s*It moved\s*\n/.exec(pane)
    expect(word, 'no button on this page says "It moved"').not.toBeNull()
    const press = pane.slice(pane.lastIndexOf('<Button', word!.index), word!.index)

    expect(press, 'it still opens the record form').not.toContain('openBook(book.id)')
    expect(press).toContain('moveBook(book.id)')
  })

  it('and that door really is the shelving step', () => {
    expect(source('../app/openBook.ts')).toMatch(
      /const moveBook = async \(id: number\) => \{\s*if \(await openBook\(id\)\) setRoute\('shelve'\)/,
    )
  })

  // `false` means the book could not be picked up at all; opening the
  // shelving step for nobody holding anything would be the failure this guards against.
  it('does not open it for a book that could not be picked up', () => {
    expect(source('../app/openBook.ts')).toContain('return false')
  })
})

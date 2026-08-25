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
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Covers } from '../design/Covers'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const source = (file: string) => readFileSync(join(HERE, file), 'utf8')

/**
 * One of the three views of the library, read on its own.
 *
 * The whole risk in #407 is that the label it takes off is handed to a shared
 * drawing, so taking it off in the obvious place would have taken it off all
 * three views and off the find results as well. Each view is a top-level
 * function in `LibraryPane.tsx`, so each can be read by itself, and that is
 * what makes "only the covers view" a checkable claim rather than an
 * intention.
 */
function viewOf(file: string, name: string): string {
  const text = source(file)
  const from = text.indexOf(`function ${name}(`)
  expect(from, `there is no ${name} in ${file}`).toBeGreaterThan(-1)

  const rest = text.slice(from + 1)
  const next = rest.search(/\nfunction /)
  return next === -1 ? rest : rest.slice(0, next)
}

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

/**
 * A cover and a name, and nothing about where the book stands (#407).
 *
 * > Whenever we're in the gallery view in the library, let's not put underneath
 * > the books where they're currently located. We can just show the book covers
 * > and the author name underneath the book.
 *
 * The same rule as the book page (#282) and the confirmation (#290): where a
 * book sits is drawn rather than recited, and a wall of covers is somebody
 * browsing what they own rather than auditing where it is. It is the kind of
 * line that comes back one helpful edit at a time, because a place is the most
 * concrete thing there is to write under a picture.
 *
 * **Half of this test is the views he did not name.** A list of authors and a
 * board of spines are different questions, the label is drawn by a component
 * all three share, and a change made in that component would have answered a
 * question nobody asked. So the list is checked for still saying it.
 */
describe('the library covers view is a cover and a name', () => {
  it('hands the covers nothing about where a book is', () => {
    const covers = viewOf('LibraryPane.tsx', 'CoverView')

    expect(covers, 'the covers still carry a place').not.toMatch(/place:/)
    expect(covers, 'the covers still read a location off the book').not.toMatch(
      /book\.location/,
    )
    /* "Checked out" is the same line by another name: `CoverItem` calls it "a
       word instead of a place", and it is where a book is when the answer is
       not a shelf. A tile keeping it would be a third line on some tiles and
       not others, which is the ragged grid. */
    expect(covers, 'the covers still say a book is out').not.toMatch(/checked_out_at/)
  })

  it('still says who wrote it, and falls back to what the book carries', () => {
    const covers = viewOf('LibraryPane.tsx', 'CoverView')

    /* `filedAs` is the fallback itself: what this collection files the book
       under, then what is printed on the book, then nothing. Spelling either
       half out here would be a second copy of that decision. */
    expect(covers, 'the covers name nobody').toMatch(/author: filedAs\(book\)/)
  })

  it('leaves the list beside it saying both, because he named neither', () => {
    const list = viewOf('LibraryPane.tsx', 'ListView')

    expect(list, 'the list stopped saying where a book is').toMatch(/place=\{/)
    expect(list, 'the list stopped saying a book is out').toMatch(/Checked out/)
  })

  it('leaves the find results saying it, which is a different question', () => {
    /* Somebody who has just searched for one book is usually on their way to
       go and fetch it, and the results are drawn by the same component. This
       is the one that fails if the label is taken off in `Covers` instead of
       in the view that draws it. */
    const found = viewOf('FindPane.tsx', 'asCover')

    expect(found, 'the find results stopped saying where a book is').toMatch(
      /place: book\.location/,
    )
  })
})

/**
 * The tile with nobody credited on it, which is a real book and not a bug.
 *
 * An uncredited book falls back to what the book itself carries and then to
 * nothing, never to the words "Unknown author". Now that the name is the only
 * thing written under a cover, that state is the whole of the difference
 * between two tiles, so it is worth drawing on purpose: the cover, and a line
 * held open with nothing in it.
 */
describe('a cover with nobody credited on it', () => {
  const drawn = (author: string) =>
    renderToStaticMarkup(
      <Covers
        label="Your books"
        items={[{ id: 7, title: 'The Anglo-Saxon Chronicle', author, cloth: 'moss' }]}
      />,
    )

  it('writes no name and invents none', () => {
    const markup = drawn('')

    expect(markup, 'a name was invented for a book that carries none').not.toMatch(
      /Unknown/i,
    )
    expect(markup, 'the line under the cover is not drawn at all').toMatch(
      /<span class="wf-cover__by"><\/span>/,
    )
  })

  it('is called by its title alone, with no comma trailing off it', () => {
    /* A screen reader announcing "The Anglo-Saxon Chronicle," and then silence
       is the spoken version of "Unknown author", and is refused for the same
       reason. */
    expect(drawn('')).toMatch(/aria-label="The Anglo-Saxon Chronicle"/)

    expect(drawn('Swanton, Michael')).toMatch(
      /aria-label="The Anglo-Saxon Chronicle, Swanton, Michael"/,
    )
  })
})

/**
 * One book is one book (#433).
 *
 * "1 books" was over every area a single book stands in, and over the whole
 * collection on the day it held one. `plural` is what every other count in this
 * app goes through and it existed the whole time; this row was written with a
 * template string instead.
 *
 * Read as a call rather than rendered, the same way finding is above and for the
 * same reason: `SpineView` is not exported, and what is actually being claimed
 * is that these counts go through the one function that knows about the letter
 * s, not that a particular markup came out today.
 */
describe('the counts on the library screen', () => {
  it('says "1 book" over an area holding one, through the one plural there is', () => {
    const spines = viewOf('LibraryPane.tsx', 'SpineView')

    expect(spines, 'the area count is concatenated rather than counted').not.toMatch(
      /\$\{run\.books\.length\} books/,
    )
    expect(spines).toMatch(/plural\(run\.books\.length, 'book'\)/)
  })

  it('says it over the collection too, which held one book on its first day', () => {
    const library = source('LibraryPane.tsx')

    expect(library).not.toMatch(/\$\{grouped\(counts\.total\)\} books/)
    expect(library).not.toMatch(/\$\{grouped\(total\)\} books/)
    expect(library).toMatch(/plural\(counts\.total, 'book'\)/)
    expect(library).toMatch(/plural\(total, 'book'\)/)
  })
})

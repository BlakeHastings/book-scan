import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Covers } from '../design/Covers'
import { Picked } from '../design/Finding'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const source = (file: string) => readFileSync(join(HERE, file), 'utf8')

/**
 * `LibraryPane` fetches and sits inside four providers, so it cannot be
 * rendered as a tree. Each view is a top-level function in `LibraryPane.tsx`,
 * read here by name rather than rendered.
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
    const library = source('LibraryPane.tsx')

    expect(library).toMatch(/action=\{room\.action\}/)
    expect(library, 'the library corner is a search glyph again').not.toMatch(/IconFind/)
  })
})

describe('the library covers view is a cover and a name', () => {
  it('hands the covers nothing about where a book is', () => {
    const covers = viewOf('LibraryPane.tsx', 'CoverView')

    expect(covers, 'the covers still carry a place').not.toMatch(/place:/)
    expect(covers, 'the covers still read a location off the book').not.toMatch(
      /book\.location/,
    )
    expect(covers, 'the covers still say a book is out').not.toMatch(/checked_out_at/)
  })

  it('still says who wrote it, and falls back to what the book carries', () => {
    const covers = viewOf('LibraryPane.tsx', 'CoverView')

    expect(covers, 'the covers name nobody').toMatch(/author: filedAs\(book\)/)
  })

  it('leaves the list beside it saying both, because he named neither', () => {
    const list = viewOf('LibraryPane.tsx', 'ListView')

    expect(list, 'the list stopped saying where a book is').toMatch(/place=\{/)
    expect(list, 'the list stopped saying a book is out').toMatch(/Checked out/)
  })

  it('leaves the find results saying it, which is a different question', () => {
    const found = viewOf('FindPane.tsx', 'asCover')

    expect(found, 'the find results stopped saying where a book is').toMatch(
      /place: book\.location/,
    )
  })
})

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
    // A trailing comma before an empty author would read aloud as if a name
    // were about to follow, so the aria-label must omit it entirely.
    expect(drawn('')).toMatch(/aria-label="The Anglo-Saxon Chronicle"/)

    expect(drawn('Swanton, Michael')).toMatch(
      /aria-label="The Anglo-Saxon Chronicle, Swanton, Michael"/,
    )
  })
})

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

describe('a library narrowed to one state a book is in', () => {
  it('says what it is showing instead of "Every book"', () => {
    const row = renderToStaticMarkup(
      <Picked showing="Out of the house" note="2 books" />,
    )

    expect(row).toContain('Out of the house')
    expect(row, 'the row still claims to be showing everything').not.toContain('Every book')
  })

  it('still says "Every book" when nothing is narrowing it', () => {
    expect(renderToStaticMarkup(<Picked note="27 books" />)).toContain('Every book')
  })

  it('asks the listing for that state rather than filtering what came back', () => {
    // The narrowing must be part of the query, not client-side filtering:
    // pagination assumes the server already applied it.
    expect(source('LibraryPane.tsx')).toMatch(/state: showing \?\? undefined/)
  })

  it('offers the way back out, which the tags screen cannot give', () => {
    const library = source('LibraryPane.tsx')

    expect(library).toContain('Show every book')
    expect(library).toMatch(/onPress=\{\(\) => setShowing\(null\)\}/)
  })

  it('does not draw a picture of a bookcase for books that are not on one', () => {
    const library = source('LibraryPane.tsx')

    // A view left reading `look` directly rather than the decided `drawn`
    // value would be a view the narrowing cannot turn off.
    expect(library).toMatch(/const drawn = standing \|\| look !== 'spines' \? look : 'list'/)
    for (const view of ['covers', 'list', 'spines']) {
      expect(library, `the ${view} view still draws on the chosen look`)
        .toMatch(new RegExp(`drawn === '${view}'`))
    }
    expect(library).toMatch(/looks=\{looks\}/)
  })
})

describe('the books the boards do not draw', () => {
  it('counts the lending ones apart from the rest', () => {
    const spines = viewOf('LibraryPane.tsx', 'SpineView')

    expect(spines, 'the boards still say one number for three situations')
      .not.toMatch(/\$\{grouped\(off\)\} books are not on a bookcase/)
    expect(spines).toMatch(/off\.out/)
  })

  it('makes the lending ones a way in rather than a sentence', () => {
    const spines = viewOf('LibraryPane.tsx', 'SpineView')
    const button = /<Button[\s\S]*?<\/Button>/.exec(spines)?.[0] ?? ''

    expect(button, 'the boards offer nothing to press at all').not.toBe('')
    expect(button, 'the lending count is still a sentence').toContain('out of the house')
    expect(button).toContain('onOut()')
  })

  it('opens this same library on them, rather than a fourth list of books', () => {
    expect(source('LibraryPane.tsx')).toMatch(/onOut=\{\(\) => setShowing\(CHECKED_OUT\)\}/)
  })
})

import { describe, expect, it } from 'vitest'
import { offerFitsReading, readTitleAndAuthor } from './cover-reading'

describe('which line of a cover is the title and which the author', () => {
  it('takes the first line as the title and the first name-shaped line as the author', () => {
    expect(readTitleAndAuthor(['Middlemarch', 'George Eliot', 'ANOVEL']))
      .toEqual({ title: 'Middlemarch', author: 'George Eliot' })
  })

  it('passes over a tagline to find the name', () => {
    expect(readTitleAndAuthor(['Dune', 'NEW YORK TIMES BESTSELLER', 'FRANK HERBERT']))
      .toEqual({ title: 'Dune', author: 'FRANK HERBERT' })
  })

  it('reads no author rather than guessing one', () => {
    expect(readTitleAndAuthor(['Middlemarch', 'A NOVEL'])).toEqual({ title: 'Middlemarch', author: '' })
    expect(readTitleAndAuthor([])).toEqual({ title: '', author: '' })
  })
})

describe('whether a book a catalogue offered is the one whose cover was read', () => {
  const lines = ['Middlemarch', 'George Eliot', 'ANOVEL']
  const read = readTitleAndAuthor(lines)

  it('accepts the book whose title and author are on the cover', () => {
    expect(offerFitsReading(lines, read, { title: 'Middlemarch', authors: ['George Eliot'] })).toBe(true)
  })

  it('refuses a namesake by somebody else', () => {
    expect(offerFitsReading(lines, read, { title: 'Middlemarch', authors: ['A. Critic'] })).toBe(false)
  })

  it('refuses the first volume for a cover of the second', () => {
    const messiah = ['Dune Messiah', 'Frank Herbert']
    expect(offerFitsReading(messiah, readTitleAndAuthor(messiah), { title: 'Dune', authors: ['Frank Herbert'] }))
      .toBe(false)
  })

  it('refuses a longer title the cover does not carry', () => {
    expect(offerFitsReading(lines, read, { title: 'Middlemarch Revisited Essays', authors: ['George Eliot'] }))
      .toBe(false)
  })
})

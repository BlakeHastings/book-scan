import { describe, expect, it } from 'vitest'
import { readQuery, saysWhat } from './findQuery'

describe('reading what was typed into the one box', () => {
  it('reads an empty box as the state the screen is designed around', () => {
    expect(readQuery('')).toEqual({ kind: 'nothing' })
    expect(readQuery('   ')).toEqual({ kind: 'nothing' })
  })

  it('reads thirteen digits as an ISBN, however they were spaced', () => {
    expect(readQuery('9780571224142')).toEqual({ kind: 'isbn', isbn: '9780571224142' })
    expect(readQuery('978 0571 224142')).toEqual({ kind: 'isbn', isbn: '9780571224142' })
    expect(readQuery('978-0-571-22414-2')).toEqual({ kind: 'isbn', isbn: '9780571224142' })
  })

  it('reads ten digits as an ISBN too, which is what an old book carries', () => {
    expect(readQuery('0571224148')).toEqual({ kind: 'isbn', isbn: '0571224148' })
  })

  /*
   * The case that decides where the length check goes. Somebody typing an ISBN
   * passes through every length on the way to thirteen, and answering "no book
   * has that ISBN" at nine digits is the silent failure the reading exists to
   * avoid. Words are a search that finds nothing yet; an ISBN is an assertion
   * that there is exactly one answer.
   */
  it('does not call a half-typed ISBN an ISBN', () => {
    expect(readQuery('978057122').kind).toBe('words')
    expect(readQuery('97805712241423').kind).toBe('words')
  })

  it('reads a # as a tag, with whatever has been typed after it', () => {
    expect(readQuery('#fan')).toEqual({ kind: 'tag', part: 'fan' })
    expect(readQuery('#')).toEqual({ kind: 'tag', part: '' })
    expect(readQuery('#urban fantasy')).toEqual({ kind: 'tag', part: 'urban fantasy' })
  })

  it('reads anything else as titles and authors together', () => {
    expect(readQuery('mieville')).toEqual({ kind: 'words', words: 'mieville' })
    // A title that is nothing but digits is still a title, because no book has
    // a four digit ISBN and every collection has a copy of this one.
    expect(readQuery('1984')).toEqual({ kind: 'words', words: '1984' })
    expect(readQuery('catch-22')).toEqual({ kind: 'words', words: 'catch-22' })
  })
})

describe('the line the field says out loud', () => {
  it('says so for the two readings nobody can see for themselves', () => {
    expect(saysWhat(readQuery('9780571224142'))).toMatch(/Thirteen digits/)
    expect(saysWhat(readQuery('0571224148'))).toMatch(/Ten digits/)
    expect(saysWhat(readQuery('#fan'))).toMatch(/tags/)
  })

  it('says nothing about a search that looks like what it is', () => {
    expect(saysWhat(readQuery('mieville'))).toBe('')
    expect(saysWhat(readQuery(''))).toBe('')
  })
})

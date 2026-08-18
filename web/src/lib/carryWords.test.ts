import { describe, expect, it } from 'vitest'
import {
  leftBooks, leftSaid, plural, said, skipSaid, stretchOf, surnameOf, whenSaid, words,
} from './carryWords'

describe('numbers, as the carry screens say them', () => {
  it('writes out the ones the drawn design writes out', () => {
    expect(words(0)).toBe('no')
    expect(words(1)).toBe('one')
    expect(words(19)).toBe('nineteen')
    expect(words(20)).toBe('twenty')
    expect(words(45)).toBe('forty-five')
    expect(words(99)).toBe('ninety-nine')
  })

  it('gives up on words where a table would stop being mechanical', () => {
    expect(words(100)).toBe('100')
    expect(words(1204)).toBe('1,204')
  })

  it('starts a sentence with a capital and keeps the rest of it', () => {
    expect(said(3)).toBe('Three')
    expect(said(53)).toBe('Fifty-three')
    expect(said(187)).toBe('187')
  })

  it('counts books in digits, singular and plural', () => {
    expect(plural(1, 'book')).toBe('1 book')
    expect(plural(53, 'book')).toBe('53 books')
    expect(plural(1204, 'book')).toBe('1,204 books')
  })
})

describe('the stretch of shelf a trip covers', () => {
  const at = (...names: string[]) => stretchOf(names)

  it('is the two ends of it, as they read down the spines', () => {
    expect(at('Bryson, Bill', 'Carson, Rachel', 'Didion, Joan')).toBe('Bryson to Didion')
  })

  it('joins a pair with "and", because two books are not a stretch', () => {
    expect(at('Tartt, Donna', 'Tolkien, J. R. R.')).toBe('Tartt and Tolkien')
  })

  it('says one name for one book', () => {
    expect(at('Zusak, Markus')).toBe('Zusak')
  })

  /*
   * "Tartt to Tartt" is a sentence somebody reads twice to learn nothing, and a
   * run of one author is exactly what a small trip off a full shelf looks like.
   */
  it('says one name when both ends are the same author', () => {
    expect(at('Pratchett, Terry', 'Pratchett, Terry', 'Pratchett, Terry')).toBe('Pratchett')
  })

  it('says nothing at all when nobody is credited', () => {
    expect(at('', '')).toBe('')
    expect(stretchOf([])).toBe('')
  })

  it('reads a filing name as the surname it starts with', () => {
    expect(surnameOf('Le Guin, Ursula K.')).toBe('Le Guin')
    expect(surnameOf('Homer')).toBe('Homer')
    expect(surnameOf('  ')).toBe('')
  })
})

describe('when the carrying happened', () => {
  const today = new Date('2026-08-13T09:00:00.000Z')

  it('says today and yesterday rather than naming the day', () => {
    expect(whenSaid('2026-08-13', today)).toBe('today')
    expect(whenSaid('2026-08-12', today)).toBe('yesterday')
  })

  it('names the weekday inside the last week', () => {
    expect(whenSaid('2026-08-09', today)).toBe('on Sunday')
  })

  it('gives a date beyond it, where a weekday is a puzzle', () => {
    expect(whenSaid('2026-07-01', today)).toBe('on 1 July')
  })

  it('says something rather than nothing when nobody has carried anything', () => {
    expect(whenSaid('', today)).toBe('earlier')
  })
})

/*
 * One voice for two screens (#325). The plan and the carry list are one job of
 * work read twice, minutes apart, by the same person, and they used to disagree
 * about whether a checked out book had been left alone at all.
 */
describe('why a book is not being carried', () => {
  it('says every reason, in the order it is given them', () => {
    expect(skipSaid([
      { reason: 'pinned', books: 3 },
      { reason: 'checked-out', books: 2 },
      { reason: 'never-placed', books: 1 },
    ])).toBe('Three you pinned. Two checked out. One never confirmed onto a bookcase.')
  })

  it('says a reason it has never heard of rather than swallowing it', () => {
    expect(skipSaid([{ reason: 'melted' as never, books: 2 }])).toBe('Two left alone.')
  })

  it('says nothing at all when nothing was left alone', () => {
    expect(skipSaid([])).toBe('')
  })
})

/*
 * What somebody left where it is, said back to them (#402). The rule is in the
 * sentence on purpose: leaving books where they are answers the rules for those
 * books and changes nothing about the rules, so what a person needs afterwards
 * is to know there is still something on that place wanting them elsewhere.
 */
describe('work somebody left where it is', () => {
  const aside = {
    fromAreaId: 40, toAreaId: 30, from: '4A', to: '3A', books: 22, rules: ['Non-fiction'],
  }

  it('says how many, off where, wanted where, and by which rule', () => {
    expect(leftSaid(aside))
      .toBe('Twenty-two on 4A the rules want on 3A, asked for by Non-fiction.')
  })

  it('names both rules when two of them wanted the same place', () => {
    expect(leftSaid({ ...aside, rules: ['Non-fiction', 'Big books'] }))
      .toBe('Twenty-two on 4A the rules want on 3A, asked for by Non-fiction and Big books.')
  })

  /*
   * A rule taken off a place since is a real case, and the sentence still has to
   * read: what was recorded is the answer, and a missing name is not a reason to
   * say nothing about twenty-two books.
   */
  it('still says it when nothing recorded a name', () => {
    expect(leftSaid({ ...aside, rules: [] })).toBe('Twenty-two on 4A the rules want on 3A.')
  })

  it('counts every group, because the card counts them all', () => {
    expect(leftBooks([aside, { ...aside, books: 8 }])).toBe(30)
    expect(leftBooks([])).toBe(0)
  })
})

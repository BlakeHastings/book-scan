import { describe, expect, it } from 'vitest'
import { grouped, shortDate } from './say'

describe('a number, as this interface says it', () => {
  it('groups a collection that has reached four digits', () => {
    expect(grouped(1204)).toBe('1,204')
    expect(grouped(288)).toBe('288')
    expect(grouped(1000000)).toBe('1,000,000')
  })

  it('says nothing odd about none of them', () => {
    expect(grouped(0)).toBe('0')
  })
})

describe('a date, as short as it can be and still be a date', () => {
  const now = new Date('2026-08-13T00:00:00Z')

  it('leaves this year off, because the column is full of it', () => {
    expect(shortDate('2026-08-04T09:00:00Z', now)).toBe('4 Aug')
  })

  it('says the year when it is not this one', () => {
    expect(shortDate('2024-05-14T09:00:00Z', now)).toBe('14 May 2024')
  })

  /*
   * A row of the ledger that says "Invalid Date" is the app telling somebody
   * about its own internals on a page about their book.
   */
  it('says nothing at all about something that is not a date', () => {
    expect(shortDate('', now)).toBe('')
    expect(shortDate('whenever', now)).toBe('')
  })
})

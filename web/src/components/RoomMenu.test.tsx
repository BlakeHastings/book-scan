import { describe, expect, it } from 'vitest'
import { roomLine, signOutNote } from './RoomMenu'

describe('what the corner says where a name would be', () => {
  it('says the collection when both answers are in', () => {
    expect(roomLine(1204, 5)).toBe('1,204 books, five fixtures')
  })

  it('counts one of either without reading as a template', () => {
    expect(roomLine(1, 1)).toBe('1 book, one fixture')
  })

  it('says only what has come back, and never a zero it has not been told', () => {
    expect(roomLine(null, 5)).toBe('five fixtures')
    expect(roomLine(1204, null)).toBe('1,204 books')
  })

  it('still says something when neither has answered yet', () => {
    expect(roomLine(null, null)).toBe('Everything you own')
  })

  it('says a real zero, because an empty collection is an answer', () => {
    expect(roomLine(0, 0)).toBe('0 books, no fixtures')
  })
})

describe('what the sign-out says about itself', () => {
  it('says who this browser is signed in as', () => {
    expect(signOutNote('alex@example.com', 'no')).toBe('alex@example.com')
  })

  it('says nothing rather than something empty when the provider sent no address', () => {
    // Returns undefined rather than an empty string: a blank line would read
    // as a value that failed to arrive.
    expect(signOutNote('', 'no')).toBeUndefined()
  })

  it('says the press is happening, because it is a request and not a toggle', () => {
    expect(signOutNote('alex@example.com', 'going')).toBe('Signing out.')
  })

  // Deliberately replaces the address while refused is shown: what matters
  // now is that it did not work, not who it did not work for.
  it('says so when it did not work, instead of going quiet', () => {
    expect(signOutNote('alex@example.com', 'refused'))
      .toBe('That did not work. Try again.')
  })
})

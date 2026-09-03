/**
 * The line where an account menu says who you are signed in as.
 *
 * It is the part of #329 that survived the owner overruling the cat, and it is
 * the reason the ring above it does not read as a login somebody forgot to
 * wire up: an account menu opens with who you are, and this one opens with
 * what you have. So the thing worth pinning is that it never opens with a
 * guess. Both halves of it arrive from separate requests, one the first screen
 * makes and one this menu makes when it is opened, and either can still be in
 * flight when somebody presses the corner.
 */

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
    // A menu that drew "0 books" for the length of one request would be saying
    // somebody's library is empty, which is the one thing this app must not
    // say by accident.
    expect(roomLine(null, 5)).toBe('five fixtures')
    expect(roomLine(1204, null)).toBe('1,204 books')
  })

  it('still says something when neither has answered yet', () => {
    // The row above it is a profile icon and this line is what stops it
    // reading as a login. Blank for the length of a request is the moment that
    // reading happens.
    expect(roomLine(null, null)).toBe('Everything you own')
  })

  it('says a real zero, because an empty collection is an answer', () => {
    expect(roomLine(0, 0)).toBe('0 books, no fixtures')
  })
})

/**
 * The line under the one thing on this sheet that leaves rather than opens.
 *
 * There is a session to end since #521 and a way to end it since #524, and the
 * address under the words is what makes the press worth offering: it is the
 * only line anywhere in this app that says which person the collection is
 * being shown to. The two states that are not an address are both real: the
 * request takes as long as it takes, and it can be refused.
 */
describe('what the sign-out says about itself', () => {
  it('says who this browser is signed in as', () => {
    expect(signOutNote('alex@example.com', 'no')).toBe('alex@example.com')
  })

  it('says nothing rather than something empty when the provider sent no address', () => {
    // Drawn as no second line at all. A blank one would leave a gap under the
    // words that reads as a value that failed to arrive.
    expect(signOutNote('', 'no')).toBeUndefined()
  })

  it('says the press is happening, because it is a request and not a toggle', () => {
    expect(signOutNote('alex@example.com', 'going')).toBe('Signing out.')
  })

  /* A press that failed silently is a person pressing it again and again. The
     address goes for as long as this is on screen, on purpose: what matters
     now is that it did not work, not who it did not work for. */
  it('says so when it did not work, instead of going quiet', () => {
    expect(signOutNote('alex@example.com', 'refused'))
      .toBe('That did not work. Try again.')
  })
})

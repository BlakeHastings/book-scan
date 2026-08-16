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
import { roomLine } from './RoomMenu'

describe('what the corner says where a name would be', () => {
  it('says the collection when both answers are in', () => {
    expect(roomLine(1204, 5)).toBe('1,204 books, five pieces of furniture')
  })

  it('counts one of either without reading as a template', () => {
    expect(roomLine(1, 1)).toBe('1 book, one piece of furniture')
  })

  it('says only what has come back, and never a zero it has not been told', () => {
    // A menu that drew "0 books" for the length of one request would be saying
    // somebody's library is empty, which is the one thing this app must not
    // say by accident.
    expect(roomLine(null, 5)).toBe('five pieces of furniture')
    expect(roomLine(1204, null)).toBe('1,204 books')
  })

  it('still says something when neither has answered yet', () => {
    // The row above it is a profile icon and this line is what stops it
    // reading as a login. Blank for the length of a request is the moment that
    // reading happens.
    expect(roomLine(null, null)).toBe('Everything you own')
  })

  it('says a real zero, because an empty collection is an answer', () => {
    expect(roomLine(0, 0)).toBe('0 books, no pieces of furniture')
  })
})

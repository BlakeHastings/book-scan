/**
 * What a stored answer about pictures is allowed to be.
 *
 * The value sits in a phone's localStorage across deploys and outlives the code
 * that wrote it, so anything unrecognised falls back rather than being trusted.
 * The failure this prevents is the quiet one: a book page handed a word it does
 * not understand and drawing its pictures in no particular order, on every book
 * in the collection, until somebody opens the settings screen again.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FIRST_PICTURE,
  FIRST_PICTURE_WORD,
  parseFirstPicture,
} from './firstPicture'

describe('parseFirstPicture', () => {
  it('keeps an answer somebody actually chose', () => {
    expect(parseFirstPicture('catalogue')).toBe('catalogue')
    expect(parseFirstPicture('yours')).toBe('yours')
  })

  it('opens on the downloaded cover for somebody who has never chosen', () => {
    expect(parseFirstPicture(null)).toBe('catalogue')
    expect(parseFirstPicture(undefined)).toBe(DEFAULT_FIRST_PICTURE)
    expect(DEFAULT_FIRST_PICTURE, 'the owner asked for the downloaded one first')
      .toBe('catalogue')
  })

  it('falls back rather than trusting a value it does not recognise', () => {
    expect(parseFirstPicture('mine')).toBe(DEFAULT_FIRST_PICTURE)
    expect(parseFirstPicture('front')).toBe(DEFAULT_FIRST_PICTURE)
    expect(parseFirstPicture('')).toBe(DEFAULT_FIRST_PICTURE)
    expect(parseFirstPicture('{"first":"yours"}')).toBe(DEFAULT_FIRST_PICTURE)
  })
})

describe('what each answer is called', () => {
  it('names both of them, since the setting is two words on a pill', () => {
    expect(FIRST_PICTURE_WORD.catalogue).toBeTruthy()
    expect(FIRST_PICTURE_WORD.yours).toBeTruthy()
  })

  it('calls it what the book page calls it, which is downloaded', () => {
    // The dot under that picture is named "Downloaded" and the empty box says
    // the same. A setting that called it the catalogue cover would be a third
    // word for one thing, and the only one nobody would recognise.
    expect(FIRST_PICTURE_WORD.catalogue).toMatch(/downloaded/i)
    expect(FIRST_PICTURE_WORD.catalogue).not.toMatch(/catalogue/i)
  })
})

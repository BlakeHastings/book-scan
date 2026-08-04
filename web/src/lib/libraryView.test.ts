/**
 * What a stored view choice is allowed to be.
 *
 * The stored value outlives the code that wrote it: it sits in a phone's
 * localStorage across deploys, and a build that renamed or dropped a view
 * would otherwise hand somebody a library that draws nothing at all. So
 * anything unrecognised falls back rather than being trusted.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW, LIBRARY_VIEWS, parseView, VIEW_LABEL } from './libraryView'

describe('parseView', () => {
  it('keeps a view somebody actually chose', () => {
    for (const view of LIBRARY_VIEWS) expect(parseView(view)).toBe(view)
  })

  it('opens on the default for somebody who has never chosen', () => {
    expect(parseView(null)).toBe(DEFAULT_VIEW)
    expect(parseView(undefined)).toBe(DEFAULT_VIEW)
  })

  it('falls back rather than trusting a value it does not recognise', () => {
    expect(parseView('spines')).toBe(DEFAULT_VIEW)
    expect(parseView('')).toBe(DEFAULT_VIEW)
    expect(parseView('{"view":"list"}')).toBe(DEFAULT_VIEW)
  })
})

describe('the set of views', () => {
  it('starts on the spine rows, which is what the library already looked like', () => {
    expect(LIBRARY_VIEWS[0]).toBe(DEFAULT_VIEW)
    expect(DEFAULT_VIEW).toBe('shelf')
  })

  it('names every one of them, since the switcher has only a word of room', () => {
    for (const view of LIBRARY_VIEWS) expect(VIEW_LABEL[view]).toBeTruthy()
  })
})

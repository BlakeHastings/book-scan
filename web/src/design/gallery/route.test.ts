/**
 * The one thing in the wireframe that can break the working app.
 *
 * Everything else here is static markup behind a lazy import. This function
 * decides whether the app renders itself or the gallery, so the case worth
 * pinning is the negative one: an ordinary hash, an empty hash, and a hash
 * that merely starts with the same letters must all leave the app alone.
 */

import { describe, expect, it } from 'vitest'
import { galleryRoute, hashFor } from './route'

describe('galleryRoute', () => {
  it('is the index at the bare hash', () => {
    expect(galleryRoute('#/design')).toEqual({ screen: null })
    expect(galleryRoute('#/design/')).toEqual({ screen: null })
  })

  it('names the screen after it', () => {
    expect(galleryRoute('#/design/where')).toEqual({ screen: 'where' })
    expect(galleryRoute('#/design/carry/')).toEqual({ screen: 'carry' })
  })

  it('leaves every other hash to the app', () => {
    expect(galleryRoute('')).toBeNull()
    expect(galleryRoute('#')).toBeNull()
    expect(galleryRoute('#queue')).toBeNull()
    // The prefix trap: a hash that begins with the same letters and is not it.
    expect(galleryRoute('#/designs')).toBeNull()
    expect(galleryRoute('#/design-notes')).toBeNull()
  })
})

describe('hashFor', () => {
  it('round-trips through galleryRoute', () => {
    expect(galleryRoute(hashFor())).toEqual({ screen: null })
    expect(galleryRoute(hashFor('plan'))).toEqual({ screen: 'plan' })
  })
})

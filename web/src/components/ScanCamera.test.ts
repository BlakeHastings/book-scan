/** `ScanCamera` opens a media stream the moment it mounts, so it cannot be rendered in a project with no browser in its test setup; this holds the shape of its source instead. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  new URL('./ScanCamera.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  'utf8',
)

/** No drawing in the gallery has an answer over a live picture, so this offset positioning stays in the app, the same arrangement `QueuedAlready` uses; everything else here is a card, a row or a button from the design system. */
describe('what the shortlist is drawn with', () => {
  it('draws the panel as a card of rows out of the design system', () => {
    expect(SOURCE).toMatch(/from '\.\.\/design\/Card'/)
    expect(SOURCE).toMatch(/from '\.\.\/design\/List'/)
    expect(SOURCE, 'the shortlist stopped calling the row it shares').toMatch(/<Row\b/)
  })

  it('paints no rows, thumbnails or buttons of its own', () => {
    expect(SOURCE, 'the app is drawing a book row again').not.toMatch(/"choice/)
    expect(SOURCE, 'the app is drawing its own button again').not.toMatch(/"btn/)
  })

  it('keeps only where the panel sits, which the gallery has no answer for', () => {
    expect(SOURCE).toMatch(/isbncam__choices/)
  })
})

/** These behaviours took real testing on real phones to get right: the burst, the stream, the lens pinning, and the one call that reads the photograph. */
describe('nothing about taking a photograph moved', () => {
  it('still reads the steadiest frame of a burst', () => {
    expect(SOURCE).toMatch(/captureSteadiest\(video\)/)
  })

  it('still makes exactly one call to identify what is in front of it', () => {
    expect((SOURCE.match(/api\.scanBook\(/g) ?? []).length).toBe(1)
  })

  it('still opens the stream with the remembered lens and the focus hints', () => {
    expect(SOURCE).toMatch(/applyFocusHints/)
    expect(SOURCE).toMatch(/preferredLens|rememberedLens/)
  })

  // The two things it waits on: the request it started, and a stream that failed to open.
  it('still puts nothing in front of the shutter', () => {
    expect(SOURCE).toMatch(/onShutter=\{\(\) => void shoot\(\)\}/)
    expect(SOURCE).toMatch(/shutterOff=\{reading \|\| Boolean\(error\)\}/)
  })
})

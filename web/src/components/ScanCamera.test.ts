/**
 * The shortlist a cover match produces, and the promise that nothing else on
 * this screen moved.
 *
 * `ScanCamera` opens a media stream the moment it mounts, so it cannot be
 * rendered in a project with no browser in its test setup. What can be held is
 * the shape of its source, which is what the two rules here are about, and both
 * of them are about the same risk: this is the riskiest file in the app, and
 * every pass over it has been a chrome pass that must not become a behaviour
 * pass. #408 said that, #387 said it again, and the way it stops being true is
 * a helpful edit six months from now.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  new URL('./ScanCamera.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  'utf8',
)

/**
 * The panel is the app's position with the design system inside it, which is
 * the arrangement `QueuedAlready` already wears beside it on the same screen.
 * No drawing in the gallery has an answer over a live picture, so the offset
 * stays here; everything that is a card, a book or a button does not.
 */
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

/**
 * What a chrome pass is not allowed to touch. The burst, the stream, the lens
 * pinning and the one call that reads a photograph are the behaviour this
 * screen exists for, and they took real work on real phones to get right.
 */
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

  /* A shutter with work in front of it is #294, and it cost a session's worth
     of photographs. The two things it waits on are the request it started and
     a stream that failed to open. */
  it('still puts nothing in front of the shutter', () => {
    expect(SOURCE).toMatch(/onShutter=\{\(\) => void shoot\(\)\}/)
    expect(SOURCE).toMatch(/shutterOff=\{reading \|\| Boolean\(error\)\}/)
  })
})

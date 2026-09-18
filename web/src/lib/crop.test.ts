/** Getting this wrong saves a rectangle other than the one the user framed, and it is invisible until you look at the saved photo. */

import { describe, expect, it } from 'vitest'
import { cropToSource, SPINE_CROP } from './scanner'

/** Minimal stand-in for the bits of the element cropToSource reads. */
function fakeVideo(videoWidth: number, videoHeight: number, boxWidth: number, boxHeight: number) {
  return { videoWidth, videoHeight, clientWidth: boxWidth, clientHeight: boxHeight } as HTMLVideoElement
}

describe('cropToSource', () => {
  it('maps a centred crop to a centred source rect when aspects match', () => {
    const rect = cropToSource(fakeVideo(1000, 1000, 500, 500), {
      x: 0.25, y: 0.25, width: 0.5, height: 0.5,
    })
    expect(rect).toEqual({ sx: 250, sy: 250, sw: 500, sh: 500 })
  })

  it('accounts for the sides cover clips off a wide source', () => {
    // `cover` scales to the larger ratio and clips the other axis; a naive mapping would ignore that and crop the wrong strip.
    const rect = cropToSource(fakeVideo(1600, 900, 400, 800), {
      x: 0.4, y: 0.1, width: 0.2, height: 0.8,
    })
    expect(Math.round(rect.sx)).toBe(755)
    expect(Math.round(rect.sw)).toBe(90)
    expect(Math.round(rect.sy)).toBe(90)
    expect(Math.round(rect.sh)).toBe(720)
  })

  it('never returns a rect that runs off the source frame', () => {
    const rect = cropToSource(fakeVideo(640, 480, 400, 900), {
      x: -0.5, y: -0.5, width: 3, height: 3,
    })
    expect(rect.sx).toBeGreaterThanOrEqual(0)
    expect(rect.sy).toBeGreaterThanOrEqual(0)
    expect(rect.sx + rect.sw).toBeLessThanOrEqual(640)
    expect(rect.sy + rect.sh).toBeLessThanOrEqual(480)
  })

  it('produces a portrait rectangle for the spine crop', () => {
    const rect = cropToSource(fakeVideo(1920, 1080, 393, 852), SPINE_CROP)
    expect(rect.sh).toBeGreaterThan(rect.sw)
  })

  it('keeps the spine crop centred horizontally', () => {
    const rect = cropToSource(fakeVideo(1920, 1080, 393, 852), SPINE_CROP)
    const centre = rect.sx + rect.sw / 2
    expect(Math.abs(centre - 1920 / 2)).toBeLessThan(1)
  })

  it('leaves the whole spine guide in clear screen', () => {
    // A crop that runs past the top bar or shutter row would hide its own boundary behind the controls.
    const topBar = 70 / 844
    const bottomBand = 682 / 844
    expect(SPINE_CROP.y).toBeGreaterThan(topBar)
    expect(SPINE_CROP.y + SPINE_CROP.height).toBeLessThan(bottomBand)
  })
})

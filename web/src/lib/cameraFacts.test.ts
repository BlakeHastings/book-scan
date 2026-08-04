/**
 * The readable camera report.
 *
 * It exists to be read on a phone nobody here owns, which is exactly why it is
 * tested: the only feedback available is somebody reading a screen out loud,
 * so a line that says the wrong thing is worse than no line at all.
 */

import { describe, expect, it } from 'vitest'
import { cameraFacts, cameraFactsText } from './scanner'

interface FakeTrackOptions {
  label?: string
  settings?: Record<string, unknown>
  capabilities?: Record<string, unknown>
}

function fakeStream(options: FakeTrackOptions | null): MediaStream {
  if (!options) return { getVideoTracks: () => [] } as unknown as MediaStream
  const { label = 'Back Camera', settings = {}, capabilities = {} } = options
  const track = {
    label,
    getSettings: () => settings,
    getCapabilities: () => capabilities,
  }
  return { getVideoTracks: () => [track] } as unknown as MediaStream
}

describe('cameraFacts', () => {
  const say = (facts: { label: string; value: string }[], label: string) =>
    facts.find((fact) => fact.label === label)?.value

  it('reports the size and speed the camera actually granted', () => {
    // Not what was asked for. The whole point is to find out whether asking
    // for 4K got 4K, and at what frame rate, which sets the exposure ceiling.
    const facts = cameraFacts(fakeStream({
      settings: { width: 2160, height: 3840, frameRate: 30 },
    }))
    expect(say(facts, 'Picture size')).toBe('2160 by 3840')
    expect(say(facts, 'Frames a second')).toBe('30')
  })

  it('names the lens, so which one is pinned can be read off the screen', () => {
    const facts = cameraFacts(fakeStream({ label: 'Back Ultra Wide Camera' }))
    expect(say(facts, 'Lens in use')).toBe('Back Ultra Wide Camera')
  })

  it('says plainly when the phone offers no torch', () => {
    expect(say(cameraFacts(fakeStream({ capabilities: {} })), 'Torch'))
      .toBe('not offered by this phone')
    expect(say(cameraFacts(fakeStream({ capabilities: { torch: true } })), 'Torch'))
      .toBe('available')
  })

  it('gives the minimum focus distance in centimetres, not metres', () => {
    // Reported in metres by the browser. Somebody holding a book at arm's
    // length does not think in metres, and 0.12 reads like a mistake.
    const facts = cameraFacts(fakeStream({ capabilities: { focusDistance: { min: 0.12 } } }))
    expect(say(facts, 'Closest it can focus')).toBe('12 cm')
  })

  it('admits when something was not reported instead of inventing a number', () => {
    const facts = cameraFacts(fakeStream({ settings: {}, capabilities: {} }))
    expect(say(facts, 'Picture size')).toBe('not reported')
    expect(say(facts, 'Frames a second')).toBe('not reported')
    expect(say(facts, 'Closest it can focus')).toBe('not reported')
    expect(say(facts, 'Zoom range')).toBe('not adjustable')
  })

  it('counts the pixels the spine crop will actually reach the OCR with', () => {
    // The number that reframed this whole issue. A 2160x3840 portrait frame in
    // a 390x844 viewport leaves the spine strip only a few hundred pixels
    // across, which is why blur ruins that shot in particular.
    const video = {
      videoWidth: 2160, videoHeight: 3840, clientWidth: 390, clientHeight: 844,
    } as HTMLVideoElement
    const value = say(cameraFacts(fakeStream({}), video), 'Spine strip') ?? ''
    const pixels = Number(value.replace(/\D+/g, ''))
    expect(pixels).toBeGreaterThan(300)
    expect(pixels).toBeLessThan(700)
  })

  it('leaves the spine strip out when there is no video element to measure', () => {
    expect(cameraFacts(fakeStream({})).some((f) => f.label === 'Spine strip')).toBe(false)
  })

  it('says the camera is not running rather than listing empty facts', () => {
    expect(cameraFacts(null)).toEqual([{ label: 'Camera', value: 'not running' }])
  })
})

describe('cameraFactsText', () => {
  it('lays the facts out one per line so they can be pasted into a message', () => {
    expect(cameraFactsText([
      { label: 'Lens in use', value: 'Back Camera' },
      { label: 'Torch', value: 'available' },
    ])).toBe('Lens in use: Back Camera\nTorch: available')
  })
})

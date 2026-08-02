import { describe, expect, it } from 'vitest'
import { lensName, preferredLens, type Lens } from './scanner'

const lens = (deviceId: string, label: string): Lens => ({ deviceId, label })

describe('preferredLens', () => {
  it('picks the plain back camera over the virtual combined one', () => {
    // Verbatim labels an iPhone reports. "Back Triple Camera" is the virtual
    // device that swaps lens mid-shot, which is what moves the framing.
    expect(preferredLens([
      lens('triple', 'Back Triple Camera'),
      lens('wide', 'Back Camera'),
      lens('ultra', 'Back Ultra Wide Camera'),
    ])).toBe('wide')
  })

  it('avoids the combined device when there is no plain one', () => {
    expect(preferredLens([
      lens('dual', 'Back Dual Wide Camera'),
      lens('ultra', 'Back Ultra Wide Camera'),
    ])).toBe('ultra')
  })

  it('falls back to whatever exists rather than returning nothing', () => {
    expect(preferredLens([lens('only', 'Back Dual Camera')])).toBe('only')
  })

  it('returns empty for a device that names no rear lens', () => {
    // A laptop, or a phone before permission has been granted.
    expect(preferredLens([])).toBe('')
  })

  it('is not fooled by a label that merely contains "back camera"', () => {
    // Anchored on purpose: "Back Camera 2" is a distinct physical lens, but
    // "Back Dual Wide Camera" must not match the plain rule.
    expect(preferredLens([
      lens('dual', 'Back Dual Wide Camera'),
      lens('plain', 'Back Camera'),
    ])).toBe('plain')
  })
})

describe('lensName', () => {
  it('shortens iPhone labels to something that fits on a chip', () => {
    expect(lensName('Back Ultra Wide Camera')).toBe('Ultra Wide')
    expect(lensName('Back Triple Camera')).toBe('Triple')
  })

  it('names the plain rear lens rather than rendering an empty button', () => {
    expect(lensName('Back Camera')).toBe('Main')
  })

  it('strips whole words only', () => {
    // Guards the word boundaries. Written without them once, and a stray
    // escape turned \b into a literal backspace that read fine on screen.
    expect(lensName('Backlit Camera')).toBe('Backlit')
  })
})

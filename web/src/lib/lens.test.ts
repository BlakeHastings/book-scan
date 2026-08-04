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

  it('takes the combined device over the ultra wide when there is no plain one', () => {
    // Reversed deliberately (#92). This used to answer 'ultra', on the rule
    // "anything but a virtual device", and that is the wrong trade on the two
    // things that actually matter for a spine. The ultra wide has no optical
    // stabilisation at all on a non-Pro iPhone, and its field of view is so
    // much wider that the spine lands on a fraction of the pixels, in a crop
    // that is already only a few hundred pixels across. A virtual device sits
    // on the wide lens by default, so it gives up neither. The framing jump it
    // can cause is a real cost, and still the smaller one.
    //
    // This branch never runs on the phones in question: they all label a lens
    // "Back Camera" and the rule above catches it first.
    expect(preferredLens([
      lens('dual', 'Back Dual Wide Camera'),
      lens('ultra', 'Back Ultra Wide Camera'),
    ])).toBe('dual')
  })

  it('prefers a plain physical lens to the combined device', () => {
    // The original reason for this function, unchanged: a named physical lens
    // that is neither ultra wide nor telephoto outranks the virtual device.
    expect(preferredLens([
      lens('triple', 'Back Triple Camera'),
      lens('other', 'Rear Lens'),
    ])).toBe('other')
  })

  it('puts the ultra wide behind the telephoto too', () => {
    expect(preferredLens([
      lens('ultra', 'Back Ultra Wide Camera'),
      lens('tele', 'Back Telephoto Camera'),
    ])).toBe('tele')
  })

  it('still takes the ultra wide when it is genuinely the only lens', () => {
    expect(preferredLens([lens('ultra', 'Back Ultra Wide Camera')])).toBe('ultra')
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

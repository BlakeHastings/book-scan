/**
 * The torch controls.
 *
 * Feature-detected on every path, because the phone this is for is not the
 * phone anyone here is testing on, and a torch that is asked for and refused
 * must leave the shutter working exactly as it did.
 */

import { describe, expect, it, vi } from 'vitest'
import { setTorch, torchAvailable } from './scanner'

function fakeStream(options: {
  capabilities?: Record<string, unknown> | (() => never)
  applyConstraints?: (constraints: unknown) => Promise<void>
} | null): MediaStream {
  if (!options) return { getVideoTracks: () => [] } as unknown as MediaStream
  const { capabilities = {}, applyConstraints } = options
  const track = {
    label: 'Back Camera',
    getSettings: () => ({}),
    getCapabilities: typeof capabilities === 'function' ? capabilities : () => capabilities,
    applyConstraints: applyConstraints ?? (() => Promise.resolve()),
  }
  return { getVideoTracks: () => [track] } as unknown as MediaStream
}

describe('torchAvailable', () => {
  it('is true only when the phone reports the capability', () => {
    expect(torchAvailable(fakeStream({ capabilities: { torch: true } }))).toBe(true)
    expect(torchAvailable(fakeStream({ capabilities: {} }))).toBe(false)
  })

  it('is false when there is no camera at all', () => {
    expect(torchAvailable(null)).toBe(false)
    expect(torchAvailable(fakeStream(null))).toBe(false)
  })

  it('is false rather than throwing when reading capabilities throws', () => {
    // Some engines throw on an ended track. The shutter must survive it.
    expect(torchAvailable(fakeStream({
      capabilities: () => { throw new Error('track ended') },
    }))).toBe(false)
  })
})

describe('setTorch', () => {
  it('asks the track for the torch and reports that it took', async () => {
    const applyConstraints = vi.fn(() => Promise.resolve())
    const stream = fakeStream({ capabilities: { torch: true }, applyConstraints })

    expect(await setTorch(stream, true)).toBe(true)
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] })
  })

  it('turns it off again the same way', async () => {
    const applyConstraints = vi.fn(() => Promise.resolve())
    const stream = fakeStream({ capabilities: { torch: true }, applyConstraints })

    await setTorch(stream, false)
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: false }] })
  })

  it('does not ask a phone that never offered a torch', async () => {
    const applyConstraints = vi.fn(() => Promise.resolve())
    const stream = fakeStream({ capabilities: {}, applyConstraints })

    expect(await setTorch(stream, true)).toBe(false)
    expect(applyConstraints).not.toHaveBeenCalled()
  })

  it('stays dark rather than breaking the shutter when the constraint is refused', async () => {
    // A phone can advertise the capability and still refuse it. Somebody in
    // the middle of photographing a book must not get an error for that.
    const stream = fakeStream({
      capabilities: { torch: true },
      applyConstraints: () => Promise.reject(new Error('not supported')),
    })
    expect(await setTorch(stream, true)).toBe(false)
  })
})

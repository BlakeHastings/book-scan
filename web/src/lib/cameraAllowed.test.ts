import { afterEach, describe, expect, it, vi } from 'vitest'
import { cameraAlreadyAllowed } from './scanner'

afterEach(() => {
  vi.unstubAllGlobals()
})

function browserAnswering(query: unknown) {
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn() },
    permissions: { query },
  })
}

describe('cameraAlreadyAllowed', () => {
  it('is true only when the browser has stored a yes', async () => {
    browserAnswering(vi.fn().mockResolvedValue({ state: 'granted' }))
    expect(await cameraAlreadyAllowed()).toBe(true)
  })

  it('leaves a browser that would still ask to the button', async () => {
    browserAnswering(vi.fn().mockResolvedValue({ state: 'prompt' }))
    expect(await cameraAlreadyAllowed()).toBe(false)
  })

  it('leaves a refused camera to the button, which says why', async () => {
    browserAnswering(vi.fn().mockResolvedValue({ state: 'denied' }))
    expect(await cameraAlreadyAllowed()).toBe(false)
  })

  it('falls back to the button where the camera cannot be asked about', async () => {
    browserAnswering(vi.fn().mockRejectedValue(new TypeError('camera is not a valid PermissionName')))
    expect(await cameraAlreadyAllowed()).toBe(false)
  })

  it('falls back to the button where there is no Permissions API at all', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } })
    expect(await cameraAlreadyAllowed()).toBe(false)
  })

  it('is false where there is no camera to open', async () => {
    vi.stubGlobal('navigator', {
      permissions: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
    })
    expect(await cameraAlreadyAllowed()).toBe(false)
  })
})
